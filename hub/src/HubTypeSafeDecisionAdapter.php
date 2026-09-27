<?php

declare(strict_types=1);

final class HubTypeSafeDecisionException extends RuntimeException
{
    /** @param array<string,mixed> $diagnostic */
    public function __construct(string $message, public readonly string $codeName = 'JEV_UNAVAILABLE', public readonly array $diagnostic = [])
    {
        parent::__construct($message);
    }
}

final class HubTypeSafeDecisionAdapter
{
    public const PROVIDER_ID = 'typesafe';
    public const DEFAULT_MODEL = 'jev-latest';
    private const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
    /** @var null|callable(array<string,mixed>,string):array<string,mixed> */
    private $transport;

    public function __construct(?callable $transport = null) { $this->transport = $transport; }
    public function providerId(): string { return self::PROVIDER_ID; }

    /** @param array<string,mixed> $payload @return array<string,mixed> */
    public function decide(array $payload, string $credential): array
    {
        if ($this->transport !== null) return ($this->transport)($payload, $credential);
        $curl = curl_init(self::ENDPOINT);
        if ($curl === false) throw new HubTypeSafeDecisionException('Jev transport is unavailable', 'JEV_UNAVAILABLE', $this->diagnostic('network', true));
        $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $retryAfterHeader = null;
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $encoded,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 4,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $credential, 'Accept: application/json'],
            CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$retryAfterHeader): int {
                $length = strlen($line);
                if (preg_match('/^Retry-After\s*:\s*(.+)$/i', trim($line), $match) === 1) $retryAfterHeader = trim($match[1]);
                return $length;
            },
        ]);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $curlError = curl_errno($curl);
        curl_close($curl);
        if ($curlError !== 0 || !is_string($body)) throw new HubTypeSafeDecisionException('Jev transport is unavailable', 'JEV_UNAVAILABLE', $this->diagnostic('network', true, null, $curlError));
        if (strlen($body) > 1024 * 1024) throw new HubTypeSafeDecisionException('Jev response exceeded the safe limit', 'JEV_RESPONSE_INVALID', $this->diagnostic('invalid_response', false, $status));
        try { $value = json_decode($body, true, 64, JSON_THROW_ON_ERROR); } catch (Throwable) { $value = null; }
        if ($status < 200 || $status >= 300) throw $this->failure($status, $retryAfterHeader);
        if (!is_array($value) || !is_array($value['answers'] ?? null)) throw new HubTypeSafeDecisionException('Jev response is invalid', 'JEV_RESPONSE_INVALID', $this->diagnostic('invalid_response', false, $status));
        return $value;
    }

    private function failure(int $status, ?string $retryAfter): HubTypeSafeDecisionException
    {
        $code = 'JEV_REQUEST_INVALID'; $category = 'invalid_request'; $retryable = false;
        if ($status === 401) { $code = 'JEV_AUTH_FAILED'; $category = 'auth'; }
        elseif ($status === 403) { $code = 'JEV_PERMISSION_DENIED'; $category = 'permission'; }
        elseif ($status === 429) { $code = 'JEV_RATE_LIMITED'; $category = 'rate_limit'; $retryable = true; }
        elseif ($status === 408 || $status >= 500) { $code = 'JEV_UNAVAILABLE'; $category = 'temporary'; $retryable = true; }
        elseif ($status === 404) { $code = 'JEV_MODEL_UNAVAILABLE'; $category = 'model'; }
        $diagnostic = $this->diagnostic($category, $retryable, $status);
        if ($retryable && is_string($retryAfter) && preg_match('/^[0-9]{1,5}$/', $retryAfter) === 1) $diagnostic['retryAfterSeconds'] = min(3600, max(1, (int)$retryAfter));
        return new HubTypeSafeDecisionException('Jev rejected the decision request', $code, $diagnostic);
    }

    /** @return array<string,mixed> */
    private function diagnostic(string $category, bool $retryable, ?int $status = null, ?int $transportCode = null): array
    {
        $out = ['provider'=>self::PROVIDER_ID, 'operation'=>'systemone', 'model'=>self::DEFAULT_MODEL, 'category'=>$category, 'retryable'=>$retryable];
        if ($status !== null && $status >= 100 && $status <= 599) $out['httpStatus'] = $status;
        if ($transportCode !== null && $transportCode > 0 && $transportCode < 1000) $out['transportCode'] = $transportCode;
        return $out;
    }
}
