<?php

declare(strict_types=1);

final class HubEnrollmentRouter
{
    private const MAX_BODY_BYTES = 16384;
    private const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

    public static function dispatch(string $method, string $requestUri, array $server, HubEnrollmentService $service, string $body): array
    {
        $requestId = self::requestId();
        $headers = ['Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff', 'Referrer-Policy' => 'no-referrer', 'Content-Security-Policy' => "default-src 'none'"];
        if ($method !== 'POST') return self::response(405, self::error('METHOD_NOT_ALLOWED', $requestId, 'Only POST is supported by enrollment'), $headers + ['Allow' => 'POST']);
        $parts = parse_url($requestUri);
        $path = is_array($parts) && is_string($parts['path'] ?? null) ? $parts['path'] : '';
        $query = is_array($parts) && is_string($parts['query'] ?? null) ? $parts['query'] : '';
        if (preg_match('/(?:^|[&])(access_token|refresh_token|token|secret|password|authorization|credential)=/i', $query)) return self::response(400, self::error('AUTHORIZATION_IN_URL', $requestId, 'Credentials are forbidden in request URLs'), $headers);
        if (isset($server['HTTP_ORIGIN']) && is_string($server['HTTP_ORIGIN']) && trim($server['HTTP_ORIGIN']) !== '') return self::response(403, self::error('ORIGIN_FORBIDDEN', $requestId, 'Browser-origin enrollment is not allowed'), $headers);
        if (strlen($body) > self::MAX_BODY_BYTES) return self::response(413, self::error('BODY_TOO_LARGE', $requestId, 'Enrollment request is too large'), $headers);
        if (!isset($server['CONTENT_TYPE']) || !is_string($server['CONTENT_TYPE']) || stripos($server['CONTENT_TYPE'], 'application/json') !== 0) return self::response(415, self::error('CONTENT_TYPE_REQUIRED', $requestId, 'JSON content type is required'), $headers);
        try {
            $payload = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
            if (!is_array($payload) || (array_is_list($payload) && $payload !== [])) throw new HubEnrollmentException('Enrollment JSON object is required', 'PAYLOAD_INVALID');
            $service->assertApiSchemaReady();
            if ($path === '/api/v1/enrollment/bootstrap') {
                self::exactKeys($payload, ['displayName', 'projectIds', 'schemaVersion', 'userId']);
                self::bootstrapNonce($server);
                return self::response(200, $service->initializeOwner((string) $payload['userId'], (string) $payload['displayName'], is_array($payload['projectIds']) ? $payload['projectIds'] : []) + ['requestId' => $requestId], $headers);
            }
            if ($path === '/api/v1/enrollment/pairing-codes') {
                $token = self::bearer($server);
                $allowed = ['projectIds', 'schemaVersion', 'ttlSeconds'];
                self::exactKeys($payload, $allowed);
                return self::response(200, $service->issuePairingCodeForToken($token, is_array($payload['projectIds']) ? $payload['projectIds'] : [], null, is_int($payload['ttlSeconds']) ? $payload['ttlSeconds'] : 0) + ['requestId' => $requestId], $headers);
            }
            if ($path === '/api/v1/enrollment/devices') return self::response(200, $service->enrollDeviceRateLimited($payload, (string) ($payload['now'] ?? gmdate('c'))) + ['requestId' => $requestId], $headers);
            if ($path === '/api/v1/enrollment/token/rotate') {
                $token = self::bearer($server);
                self::exactKeys($payload, ['deviceId', 'schemaVersion']);
                return self::response(200, $service->rotateToken($token, (string) ($payload['deviceId'] ?? ''), null) + ['requestId' => $requestId], $headers);
            }
            if ($path === '/api/v1/enrollment/token/revoke') {
                $token = self::bearer($server);
                self::exactKeys($payload, ['deviceId', 'schemaVersion']);
                $service->revokeToken($token, (string) ($payload['deviceId'] ?? ''), null);
                return self::response(200, ['schemaVersion' => 1, 'revoked' => true, 'deviceId' => strtolower((string) $payload['deviceId']), 'requestId' => $requestId], $headers);
            }
            if (preg_match('#^/api/v1/enrollment/devices/(' . self::UUID . ')/revoke$#i', $path, $match) === 1) {
                self::exactKeys($payload, []);
                $service->revokeDeviceForToken(self::bearer($server), $match[1]);
                return self::response(200, ['schemaVersion' => 1, 'revoked' => true, 'deviceId' => strtolower($match[1]), 'requestId' => $requestId], $headers);
            }
            return self::response(404, self::error('NOT_FOUND', $requestId, 'Enrollment route was not found'), $headers);
        } catch (JsonException) {
            return self::response(400, self::error('PAYLOAD_INVALID', $requestId, 'Enrollment JSON is invalid'), $headers);
        } catch (HubEnrollmentException $error) {
            $status = match ($error->codeName) {
                'RATE_LIMITED' => 429,
                'BOOTSTRAP_CLOSED', 'PAIRING_REPLAY', 'DEVICE_DUPLICATE' => 409,
                'TOKEN_REJECTED', 'TOKEN_INVALID', 'BOOTSTRAP_INVALID' => 401,
                'DEVICE_FORBIDDEN', 'PROJECT_FORBIDDEN' => 403,
                'ENROLLMENT_SCHEMA_NOT_READY', 'DATABASE_UNAVAILABLE', 'BOOTSTRAP_NOT_CONFIGURED' => 503,
                default => 400,
            };
            return self::response($status, self::error($error->codeName, $requestId, self::safeMessage($error->codeName)), $headers);
        } catch (Throwable) {
            return self::response(503, self::error('ENROLLMENT_UNAVAILABLE', $requestId, 'Enrollment is unavailable'), $headers);
        }
    }

    private static function bearer(array $server): string
    {
        $header = $server['HTTP_AUTHORIZATION'] ?? '';
        if (!is_string($header) || preg_match('/^Bearer\s+([^\s]+)$/i', $header, $match) !== 1 || strlen($match[1]) > 512 || preg_match('/[\x00-\x1F\x7F]/', $match[1])) throw new HubEnrollmentException('Bearer authentication is required', 'TOKEN_INVALID');
        return $match[1];
    }

    private static function bootstrapNonce(array $server): void
    {
        $configured = getenv('AWH_ENROLLMENT_BOOTSTRAP_NONCE_HASH');
        $provided = $server['HTTP_X_AWH_BOOTSTRAP_NONCE'] ?? '';
        if (!is_string($configured) || !preg_match('/^[a-f0-9]{64}$/i', $configured) || !is_string($provided) || $provided === '' || strlen($provided) > 512 || preg_match('/[\x00-\x1F\x7F]/', $provided) || !hash_equals(strtolower($configured), hash('sha256', $provided))) {
            throw new HubEnrollmentException('Bootstrap authentication failed', 'BOOTSTRAP_NOT_CONFIGURED');
        }
    }

    private static function exactKeys(array $payload, array $allowed): void
    {
        $actual = array_keys($payload); sort($actual); sort($allowed);
        if ($actual !== $allowed) throw new HubEnrollmentException('Enrollment payload contains unsupported fields', 'SCHEMA_FIELDS');
    }

    private static function requestId(): string
    {
        $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
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
            'RATE_LIMITED' => 'Pairing attempts are temporarily limited',
            'ENROLLMENT_SCHEMA_NOT_READY' => 'Enrollment API migration is not ready',
            'BOOTSTRAP_CLOSED' => 'Owner bootstrap is already closed',
            'PAIRING_REPLAY' => 'Pairing code was already used',
            'DEVICE_DUPLICATE' => 'Device is already enrolled',
            'TOKEN_REJECTED', 'TOKEN_INVALID', 'BOOTSTRAP_INVALID' => 'Enrollment authentication failed',
            'DEVICE_FORBIDDEN', 'PROJECT_FORBIDDEN' => 'Enrollment authorization failed',
            default => 'Enrollment request was rejected',
        };
    }
}
