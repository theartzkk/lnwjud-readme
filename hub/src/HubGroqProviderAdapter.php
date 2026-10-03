<?php
declare(strict_types=1);

require_once __DIR__ . '/HubAiProviderAdapter.php';

final class HubGroqProviderAdapter implements HubAiProviderAdapter
{
    private const BASE_URL = 'https://api.groq.com/openai/v1';
    private const MAX_RESPONSE_BYTES = 2097152;
    private const UNSUPPORTED_RESPONSE_FIELDS = [
        'previous_response_id',
        'store',
        'truncation',
        'include',
        'safety_identifier',
        'prompt',
    ];

    /** @var null|callable(array<string,mixed>,string):array<string,mixed> */
    private $transport;

    public function __construct(?callable $transport = null)
    {
        $this->transport = $transport;
    }

    public function providerId(): string
    {
        return 'groq';
    }
    public function call(array $payload, string $credential): array
    {
        $payload = $this->sanitizeResponsesPayload($payload);
        if ($this->transport !== null) return ($this->transport)($payload, $credential);
        return $this->request('POST', '/responses', $credential, $payload);
    }

    /** @return list<string> */
    public function activeModels(string $credential): array
    {
        $value = $this->request('GET', '/models', $credential);
        $models = [];
        foreach (($value['data'] ?? []) as $row) {
            if (!is_array($row) || !is_string($row['id'] ?? null)) continue;
            $id = trim($row['id']);
            if (preg_match('/^[A-Za-z0-9][A-Za-z0-9._:\/-]{1,127}$/', $id) !== 1) continue;
            $models[$id] = true;
        }
        $ids = array_keys($models);
        sort($ids, SORT_STRING);
        return $ids;
    }

    /** @param array<string,mixed> $payload @return array<string,mixed> */
    private function sanitizeResponsesPayload(array $payload): array
    {
        foreach (self::UNSUPPORTED_RESPONSE_FIELDS as $field) unset($payload[$field]);
        return $payload;
    }
    /** @param array<string,mixed>|null $payload @return array<string,mixed> */
    private function request(string $method, string $path, string $credential, ?array $payload = null): array
    {
        $curl = curl_init(self::BASE_URL . $path);
        if ($curl === false) throw $this->error('Provider is unavailable', 'PROVIDER_UNAVAILABLE', 'network', true);
        $retryAfterHeader = null;
        $headers = ['Authorization: Bearer ' . $credential, 'Accept: application/json'];
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 45,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$retryAfterHeader): int {
                $length = strlen($line);
                if (preg_match('/^Retry-After\s*:\s*(.+)$/i', trim($line), $match) === 1) {
                    $candidate = trim($match[1]);
                    if ($candidate !== '' && strlen($candidate) <= 100) $retryAfterHeader = $candidate;
                }
                return $length;
            },
        ];
        if ($method === 'POST') {
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = json_encode($payload ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $options[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json';
        }
        curl_setopt_array($curl, $options);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $curlError = curl_errno($curl);
        curl_close($curl);
        if ($curlError !== 0 || !is_string($body)) throw $this->error('Provider is unavailable', 'PROVIDER_UNAVAILABLE', 'network', true, null, null, $curlError);
        if (strlen($body) > self::MAX_RESPONSE_BYTES) throw $this->error('Provider response exceeded the safe limit', 'PROVIDER_FAILED', 'invalid_response', true, $status);
        try { $value = json_decode($body, true, 64, JSON_THROW_ON_ERROR); } catch (Throwable) { $value = null; }
        if ($status < 200 || $status >= 300) {
            [$code, $category, $retryable] = $this->classifyFailure($status, is_array($value) ? $value : null);
            throw $this->error('Provider rejected the request', $code, $category, $retryable, $status, $this->retryAfterSeconds($retryAfterHeader));
        }
        if (!is_array($value)) throw $this->error('Provider did not return a usable response', 'PROVIDER_FAILED', 'invalid_response', true, $status);
        return $value;
    }

    /** @return array{0:string,1:string,2:bool} */
    private function classifyFailure(int $status, ?array $body): array
    {
        $error = is_array($body['error'] ?? null) ? $body['error'] : [];
        $needle = strtolower((string)($error['type'] ?? '') . ' ' . (string)($error['code'] ?? '') . ' ' . (string)($error['message'] ?? ''));
        if ($status === 401) return ['PROVIDER_AUTH_FAILED', 'auth', false];
        if ($status === 403) return ['PROVIDER_PERMISSION_DENIED', 'permission', false];
        if ($status === 429 && preg_match('/quota|billing|credit|insufficient/', $needle) === 1) return ['PROVIDER_QUOTA_EXHAUSTED', 'quota', false];
        if ($status === 429) return ['PROVIDER_RATE_LIMITED', 'rate_limit', true];
        if ($status === 404 || preg_match('/model/', $needle) === 1) return ['PROVIDER_MODEL_UNAVAILABLE', 'model', false];
        if ($status === 408 || $status >= 500) return ['PROVIDER_UNAVAILABLE', 'temporary', true];
        if ($status >= 400) return ['PROVIDER_REQUEST_INVALID', 'invalid_request', false];
        return ['PROVIDER_FAILED', 'provider_error', false];
    }

    private function error(string $message, string $code, string $category, bool $retryable, ?int $status = null, ?int $retryAfterSeconds = null, ?int $transportCode = null): HubAiProviderAdapterException
    {
        $diagnostic = ['provider' => $this->providerId(), 'operation' => 'responses', 'category' => $category, 'retryable' => $retryable];
        if ($status !== null && $status >= 100 && $status <= 599) {
            $diagnostic['httpStatus'] = $status;
            $diagnostic['httpStatusClass'] = intdiv($status, 100) . 'xx';
        }
        if ($retryable && $retryAfterSeconds !== null) $diagnostic['retryAfterSeconds'] = $retryAfterSeconds;
        if ($transportCode !== null && $transportCode > 0 && $transportCode < 1000) $diagnostic['transportCode'] = $transportCode;
        return new HubAiProviderAdapterException($message, $code, $diagnostic);
    }

    private function retryAfterSeconds(?string $value): ?int
    {
        if (!is_string($value)) return null;
        $value = trim($value);
        if ($value === '') return null;
        if (preg_match('/^[0-9]{1,10}$/', $value) === 1) {
            $seconds = (int)$value;
            return $seconds >= 1 ? min(3600, $seconds) : null;
        }
        $target = strtotime($value);
        if ($target === false) return null;
        $seconds = $target - time();
        return $seconds >= 1 ? min(3600, $seconds) : null;
    }
}
