<?php

declare(strict_types=1);

final class HubReadRouter
{
    public static function dispatch(string $method, string $requestUri, array $server, ?HubReadModel $model): array
    {
        $requestId = self::requestId();
        $headers = self::headers();
        if ($method !== 'GET') {
            return self::response(405, ['schemaVersion' => 1, 'error' => 'METHOD_NOT_ALLOWED', 'code' => 'METHOD_NOT_ALLOWED', 'requestId' => $requestId, 'message' => 'Only GET is supported by this read service'], $headers + ['Allow' => 'GET']);
        }
        $parts = parse_url($requestUri);
        $path = is_array($parts) && is_string($parts['path'] ?? null) ? $parts['path'] : '';
        $query = is_array($parts) && is_string($parts['query'] ?? null) ? $parts['query'] : '';
        if (preg_match('/(?:^|[&])(access_token|refresh_token|token|secret|password|authorization|credential)=/i', $query)) {
            return self::response(400, self::error('AUTHORIZATION_IN_URL', $requestId, 'Credentials are forbidden in request URLs'), $headers);
        }

        $isHealth = $path === '/api/v1/health';
        if (!$isHealth && !self::authorized($server)) {
            $configured = getenv('AWH_HUB_READ_TOKEN_HASH');
            $status = is_string($configured) && preg_match('/^[a-f0-9]{64}$/i', $configured) ? 401 : 503;
            $code = $status === 503 ? 'AUTH_NOT_CONFIGURED' : 'AUTH_REQUIRED';
            return self::response($status, self::error($code, $requestId, $status === 503 ? 'Read authentication is not configured' : 'Bearer authentication is required'), $headers);
        }

        if ($model === null) {
            return self::response(503, self::error('DATABASE_UNAVAILABLE', $requestId, 'Hub read data is unavailable'), $headers);
        }
        try {
            if ($isHealth) return self::response(200, $model->health() + ['requestId' => $requestId], $headers);
            if ($path === '/api/v1/status') return self::response(200, $model->status() + ['requestId' => $requestId], $headers);
            if ($path === '/api/v1/projects') return self::response(200, $model->projects() + ['requestId' => $requestId], $headers);
            if ($path === '/api/v1/devices') return self::response(200, $model->devices() + ['requestId' => $requestId], $headers);
            if ($path === '/api/v1/builds') return self::response(200, $model->builds() + ['requestId' => $requestId], $headers);
            if ($path === '/api/v1/releases') return self::response(200, $model->releases() + ['requestId' => $requestId], $headers);
            if (preg_match('#^/api/v1/projects/([0-9a-f-]{36})/memory$#i', $path, $matches) === 1) {
                return self::response(200, $model->memory($matches[1]) + ['requestId' => $requestId], $headers);
            }
            if (preg_match('#^/api/v1/projects/([0-9a-f-]{36})$#i', $path, $matches) === 1) {
                return self::response(200, $model->project($matches[1]) + ['requestId' => $requestId], $headers);
            }
            return self::response(404, self::error('NOT_FOUND', $requestId, 'Hub read route was not found'), $headers);
        } catch (HubReadModelException $error) {
            $status = match ($error->codeName) {
                'PROJECT_NOT_FOUND' => 404,
                'PROJECT_ID_INVALID' => 400,
                default => 503,
            };
            return self::response($status, self::error($error->codeName, $requestId, self::safeMessage($error->codeName)), $headers);
        } catch (Throwable) {
            return self::response(503, self::error('HUB_READ_UNAVAILABLE', $requestId, 'Hub read data is unavailable'), $headers);
        }
    }

    private static function authorized(array $server): bool
    {
        $configured = getenv('AWH_HUB_READ_TOKEN_HASH');
        if (!is_string($configured) || !preg_match('/^[a-f0-9]{64}$/i', $configured)) return false;
        $header = $server['HTTP_AUTHORIZATION'] ?? '';
        if (!is_string($header) || preg_match('/^Bearer\s+([^\s]+)$/i', $header, $matches) !== 1) return false;
        $token = $matches[1];
        if (strlen($token) > 512 || preg_match('/[\x00-\x1F\x7F]/', $token)) return false;
        return hash_equals(strtolower($configured), hash('sha256', $token));
    }

    private static function requestId(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    private static function headers(): array
    {
        return [
            'Content-Type' => 'application/json; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer',
            'Content-Security-Policy' => "default-src 'none'",
        ];
    }

    private static function response(int $status, array $body, array $headers): array
    {
        return ['status' => $status, 'headers' => $headers, 'body' => json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n"];
    }

    private static function error(string $code, string $requestId, string $message): array
    {
        return ['schemaVersion' => 1, 'error' => 'ERROR', 'code' => $code, 'requestId' => $requestId, 'message' => $message];
    }

    private static function safeMessage(string $code): string
    {
        return match ($code) {
            'PROJECT_NOT_FOUND' => 'Project was not found',
            'PROJECT_ID_INVALID' => 'Project identifier is invalid',
            default => 'Hub read data is unavailable',
        };
    }
}
