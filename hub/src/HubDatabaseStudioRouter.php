<?php

declare(strict_types=1);

require_once __DIR__ . '/HubBrowserOriginPolicy.php';
require_once __DIR__ . '/HubDatabaseStudioService.php';

final class HubDatabaseStudioRouter
{
    private const MAX_BODY_BYTES = 16384;

    public static function dispatch(string $method, string $requestUri, array $server, HubDatabaseStudioService $service, string $body): array
    {
        $headers = [
            'Content-Type' => 'application/json; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer',
            'Content-Security-Policy' => "default-src 'none'",
        ];
        $requestId = self::requestId();
        try {
            $parts = parse_url($requestUri); $query = [];
            if (is_array($parts) && is_string($parts['query'] ?? null)) parse_str($parts['query'], $query);
            $action = isset($query['action']) && is_string($query['action']) ? strtolower(trim($query['action'])) : 'overview';
            if ($method === 'GET') {
                if (!HubBrowserOriginPolicy::safeReadAllowed($server)) throw new HubDatabaseStudioException('Origin is not authorized', 'ORIGIN_FORBIDDEN');
                $token = self::cookie($server, '__Host-awh_control_session');
                $result = match ($action) {
                    'overview' => $service->overview($token),
                    'tables' => $service->tables($token),
                    'browse' => $service->browse($token, self::queryString($query, 'table', true), self::queryString($query, 'q'), self::queryInt($query, 'page', 1), self::queryInt($query, 'limit', 50), self::queryString($query, 'sort'), self::queryString($query, 'dir') ?? 'ASC'),
                    'schema' => $service->schema($token, self::queryString($query, 'table', true)),
                    'export' => $service->export($token, self::queryString($query, 'table', true), self::queryString($query, 'format', true), self::queryString($query, 'q'), self::queryString($query, 'sort'), self::queryString($query, 'dir') ?? 'ASC'),
                    'health' => $service->health($token),
                    'migrations' => $service->migrations($token),
                    'audit' => $service->audit($token, self::queryInt($query, 'limit', 50)),
                    default => throw new HubDatabaseStudioException('Database Studio action was not found', 'DATABASE_ROUTE_NOT_FOUND'),
                };
                return self::response(200, $result + ['requestId' => $requestId], $headers);
            }
            if ($method !== 'POST') return self::response(405, self::error('METHOD_NOT_ALLOWED', $requestId), $headers + ['Allow' => 'GET, POST']);
            if (!HubBrowserOriginPolicy::mutationAllowed($server)) throw new HubDatabaseStudioException('Origin is not authorized', 'ORIGIN_FORBIDDEN');
            $contentType = $server['CONTENT_TYPE'] ?? ''; if (!is_string($contentType) || stripos($contentType, 'application/json') !== 0) throw new HubDatabaseStudioException('JSON content type is required', 'CONTENT_TYPE_REQUIRED');
            if (strlen($body) > self::MAX_BODY_BYTES) throw new HubDatabaseStudioException('Request body is too large', 'DATABASE_REQUEST_INVALID');
            if ($action !== 'query') throw new HubDatabaseStudioException('Database Studio action was not found', 'DATABASE_ROUTE_NOT_FOUND');
            $payload = self::json($body); self::exactKeys($payload, ['explain', 'schemaVersion', 'sql']);
            if (($payload['schemaVersion'] ?? null) !== 1 || !is_bool($payload['explain'] ?? null) || !is_string($payload['sql'] ?? null)) throw new HubDatabaseStudioException('SQL request is invalid', 'DATABASE_REQUEST_INVALID');
            $result = $service->runReadOnlySql(self::cookie($server, '__Host-awh_control_session'), self::csrf($server), (string) $payload['sql'], (bool) $payload['explain']);
            return self::response(200, $result + ['requestId' => $requestId], $headers);
        } catch (Throwable $error) {
            return self::exceptionResponse($error, $requestId, $headers);
        }
    }

    private static function json(string $body): array
    {
        try { $value = json_decode($body, true, 16, JSON_THROW_ON_ERROR); }
        catch (JsonException) { throw new HubDatabaseStudioException('JSON is invalid', 'DATABASE_REQUEST_INVALID'); }
        if (!is_array($value) || array_is_list($value)) throw new HubDatabaseStudioException('JSON object is required', 'DATABASE_REQUEST_INVALID'); return $value;
    }

    private static function queryString(array $query, string $key, bool $required = false): ?string
    {
        $value = $query[$key] ?? null;
        if ($value === null || $value === '') { if ($required) throw new HubDatabaseStudioException('Required query value is missing', 'DATABASE_REQUEST_INVALID'); return null; }
        if (!is_string($value) || strlen($value) > 200 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new HubDatabaseStudioException('Query value is invalid', 'DATABASE_REQUEST_INVALID'); return $value;
    }

    private static function queryInt(array $query, string $key, int $fallback): int
    {
        if (!array_key_exists($key, $query) || $query[$key] === '') return $fallback;
        if (!is_string($query[$key]) || preg_match('/^[0-9]{1,6}$/', $query[$key]) !== 1) throw new HubDatabaseStudioException('Query number is invalid', 'DATABASE_REQUEST_INVALID'); return (int) $query[$key];
    }

    private static function cookie(array $server, string $name): string
    {
        $raw = $server['HTTP_COOKIE'] ?? ''; if (!is_string($raw)) throw new HubDatabaseStudioException('Owner session is required', 'SESSION_INVALID');
        foreach (explode(';', $raw) as $part) { [$key, $value] = array_pad(explode('=', trim($part), 2), 2, ''); if ($key === $name && strlen($value) >= 16 && strlen($value) <= 512 && !preg_match('/[\x00-\x1f\x7f]/', $value)) return $value; }
        throw new HubDatabaseStudioException('Owner session is required', 'SESSION_INVALID');
    }

    private static function csrf(array $server): string
    {
        $value = $server['HTTP_X_AWH_CSRF'] ?? ''; if (!is_string($value) || $value === '' || strlen($value) > 256 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new HubDatabaseStudioException('Request verification is required', 'CSRF_REJECTED'); return $value;
    }

    private static function exactKeys(array $value, array $allowed): void { $actual = array_keys($value); sort($actual); sort($allowed); if ($actual !== $allowed) throw new HubDatabaseStudioException('Unsupported request fields', 'DATABASE_REQUEST_INVALID'); }
    private static function response(int $status, array $body, array $headers): array { return ['status' => $status, 'headers' => $headers, 'body' => json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n"]; }
    private static function error(string $code, string $requestId): array { return ['schemaVersion' => 1, 'error' => 'ERROR', 'code' => $code, 'message' => self::safeMessage($code), 'requestId' => $requestId]; }
    private static function exceptionResponse(Throwable $error, string $requestId, array $headers): array
    {
        $code = $error instanceof HubDatabaseStudioException ? $error->codeName : 'DATABASE_STUDIO_UNAVAILABLE';
        $status = match ($code) {
            'SESSION_INVALID', 'SESSION_EXPIRED' => 401,
            'OWNER_FORBIDDEN', 'ORIGIN_FORBIDDEN', 'CSRF_REJECTED', 'STEP_UP_REQUIRED', 'DATABASE_TABLE_RESTRICTED' => 403,
            'DATABASE_TABLE_NOT_FOUND', 'DATABASE_ROUTE_NOT_FOUND' => 404,
            'DATABASE_UNAVAILABLE', 'DATABASE_STUDIO_UNAVAILABLE' => 503,
            'DATABASE_EXPORT_TOO_LARGE' => 413,
            'METHOD_NOT_ALLOWED' => 405,
            default => 400,
        };
        return self::response($status, self::error($code, $requestId), $headers);
    }
    private static function safeMessage(string $code): string
    {
        return match ($code) {
            'SESSION_INVALID', 'SESSION_EXPIRED' => 'กรุณาเข้าสู่ AWH ด้วยบัญชี Owner อีกครั้ง',
            'OWNER_FORBIDDEN' => 'Database Studio ใช้ได้เฉพาะ Owner',
            'STEP_UP_REQUIRED' => 'กรุณายืนยันรหัสผ่านอีกครั้งก่อนใช้ SQL แบบอ่านอย่างเดียว',
            'DATABASE_TABLE_RESTRICTED' => 'ตารางนี้มีข้อมูลยืนยันตัวตนหรือ credential จึงถูกล็อก',
            'DATABASE_QUERY_REJECTED' => 'SQL Console อนุญาตเฉพาะ SELECT แบบอ่านอย่างเดียว',
            'DATABASE_QUERY_FAILED' => 'คำสั่งอ่านฐานข้อมูลทำงานไม่สำเร็จ',
            'DATABASE_EXPORT_TOO_LARGE' => 'ข้อมูลส่งออกเกินขนาดที่ปลอดภัย',
            'ORIGIN_FORBIDDEN', 'CSRF_REJECTED' => 'ไม่สามารถยืนยันความปลอดภัยของคำขอนี้ได้',
            'DATABASE_TABLE_NOT_FOUND' => 'ไม่พบตารางที่เลือก',
            default => 'Database Studio ไม่สามารถดำเนินการได้ในขณะนี้',
        };
    }
    private static function requestId(): string { $bytes = random_bytes(12); return bin2hex($bytes); }
}
