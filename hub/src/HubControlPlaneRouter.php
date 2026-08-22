<?php

declare(strict_types=1);

require_once __DIR__ . '/HubBrowserOriginPolicy.php';

final class HubControlPlaneRouter
{
    private const MAX_BODY_BYTES = 16384;
    private const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

    public static function dispatch(string $method, string $requestUri, array $server, HubControlPlaneService $service, string $body): array
    {
        $requestId = self::requestId();
        $headers = ['Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff', 'Referrer-Policy' => 'no-referrer', 'Content-Security-Policy' => "default-src 'none'"];
        $parts = parse_url($requestUri);
        $path = is_array($parts) && is_string($parts['path'] ?? null) ? $parts['path'] : '';
        $query = is_array($parts) && is_string($parts['query'] ?? null) ? $parts['query'] : '';
        if (preg_match('/(?:^|[&])(access_token|refresh_token|token|secret|password|authorization|credential)=/i', $query)) return self::response(400, self::error('AUTHORIZATION_IN_URL', $requestId, 'Credentials are forbidden in request URLs'), $headers);
        if (strlen($body) > self::MAX_BODY_BYTES) return self::response(413, self::error('BODY_TOO_LARGE', $requestId, 'Control-plane request is too large'), $headers);
        if ($method === 'POST' && (!isset($server['CONTENT_TYPE']) || !is_string($server['CONTENT_TYPE']) || stripos($server['CONTENT_TYPE'], 'application/json') !== 0)) return self::response(415, self::error('CONTENT_TYPE_REQUIRED', $requestId, 'JSON content type is required'), $headers);
        if ($path === '/api/v1/control/session' && $method === 'POST') {
            try {
                self::sameOrigin($server);
                $payload = self::json($body);
                self::exactKeys($payload, ['appVersion', 'displayName', 'pairingCode', 'schemaVersion']);
                if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported session schema', 'SCHEMA_VERSION');
                $session = $service->openSession((string) $payload['pairingCode'], (string) $payload['displayName'], (string) $payload['appVersion'], null, self::rateKey($server));
                $headers += self::sessionCookies((string) $session['sessionToken'], (string) $session['csrfToken']);
                return self::response(200, ['schemaVersion' => 1, 'authenticated' => true, 'expiresAt' => $session['expiresAt'], 'userId' => $session['userId'], 'requestId' => $requestId], $headers);
            } catch (Throwable $error) { return self::exceptionResponse($error, $requestId, $headers); }
        }
        try {
            if ($method === 'GET') {
                self::sameOriginIfBrowser($server);
                if (preg_match('#^/api/v1/control/worker/results/(' . self::UUID . ')$#i', $path, $match) === 1) return self::response(200, $service->workerResults(self::bearer($server), $match[1]) + ['requestId' => $requestId], $headers);
                $sessionToken = self::cookie($server, '__Host-awh_control_session');
                if ($path === '/api/v1/control/session') return self::response(200, $service->session($sessionToken) + ['requestId' => $requestId], $headers);
                if ($path === '/api/v1/control/projects') return self::response(200, $service->listProjectsForSession($sessionToken) + ['requestId' => $requestId], $headers);
                if ($path === '/api/v1/control/tasks') return self::response(200, $service->listTasks($sessionToken) + ['requestId' => $requestId], $headers);
                if ($path === '/api/v1/control/results') return self::response(200, $service->results($sessionToken) + ['requestId' => $requestId], $headers);
                if ($path === '/api/v1/control/artifacts') return self::response(200, $service->artifacts($sessionToken) + ['requestId' => $requestId], $headers);
                if ($path === '/api/v1/control/approvals') return self::response(200, $service->approvals($sessionToken) + ['requestId' => $requestId], $headers);
                if ($path === '/api/v1/control/workers') return self::response(200, $service->workers($sessionToken) + ['requestId' => $requestId], $headers);
                if (preg_match('#^/api/v1/control/tasks/(' . self::UUID . ')$#i', $path, $match) === 1) return self::response(200, $service->getTask($sessionToken, $match[1]) + ['requestId' => $requestId], $headers);
                if (preg_match('#^/api/v1/control/approvals/(' . self::UUID . ')$#i', $path, $match) === 1) { $all = $service->approvals($sessionToken); foreach ($all['approvals'] as $approval) if (strcasecmp((string) $approval['approvalId'], $match[1]) === 0) return self::response(200, $approval + ['requestId' => $requestId], $headers); throw new HubControlPlaneException('Approval was not found', 'APPROVAL_NOT_FOUND'); }
                return self::response(404, self::error('NOT_FOUND', $requestId, 'Control-plane route was not found'), $headers);
            }
            if ($method !== 'POST') return self::response(405, self::error('METHOD_NOT_ALLOWED', $requestId, 'Only bounded GET and POST routes are supported'), $headers + ['Allow' => 'GET, POST']);
            $payload = self::json($body);
            if ($path === '/api/v1/control/tasks') { self::sameOrigin($server); return self::response(201, $service->submitTask(self::cookie($server, '__Host-awh_control_session'), self::csrf($server), $payload) + ['requestId' => $requestId], $headers); }
            if (preg_match('#^/api/v1/control/approvals/(' . self::UUID . ')/(approve|reject)$#i', $path, $match) === 1) { self::sameOrigin($server); self::exactKeys($payload, ['schemaVersion']); if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported approval schema', 'SCHEMA_VERSION'); return self::response(200, $service->decideApproval(self::cookie($server, '__Host-awh_control_session'), self::csrf($server), $match[1], strtolower($match[2]) === 'approve' ? 'APPROVED' : 'REJECTED') + ['requestId' => $requestId], $headers); }
            if ($path === '/api/v1/control/workers/heartbeat') return self::response(200, $service->heartbeat(self::bearer($server), $payload) + ['requestId' => $requestId], $headers);
            if ($path === '/api/v1/control/workers/claim') return self::response(200, $service->claim(self::bearer($server), $payload) + ['requestId' => $requestId], $headers);
            if (preg_match('#^/api/v1/control/tasks/(' . self::UUID . ')/artifact$#i', $path, $match) === 1) return self::response(201, $service->addArtifact(self::bearer($server), $match[1], $payload) + ['requestId' => $requestId], $headers);
            if (preg_match('#^/api/v1/control/tasks/(' . self::UUID . ')/update$#i', $path, $match) === 1) return self::response(200, $service->updateTask(self::bearer($server), $match[1], $payload) + ['requestId' => $requestId], $headers);
            return self::response(404, self::error('NOT_FOUND', $requestId, 'Control-plane route was not found'), $headers);
        } catch (Throwable $error) { return self::exceptionResponse($error, $requestId, $headers); }
    }

    private static function json(string $body): array { try { $value = json_decode($body, true, 32, JSON_THROW_ON_ERROR); } catch (JsonException) { throw new HubControlPlaneException('JSON payload is invalid', 'PAYLOAD_INVALID'); } if (!is_array($value) || array_is_list($value)) throw new HubControlPlaneException('JSON object is required', 'PAYLOAD_INVALID'); return $value; }
    private static function exactKeys(array $value, array $allowed): void { $actual = array_keys($value); sort($actual); sort($allowed); if ($actual !== $allowed) throw new HubControlPlaneException('Payload contains unsupported fields', 'SCHEMA_FIELDS'); }
    private static function bearer(array $server): string { $header = $server['HTTP_AUTHORIZATION'] ?? ''; if (!is_string($header) || preg_match('/^Bearer\s+([^\s]+)$/i', $header, $match) !== 1) throw new HubControlPlaneException('Worker authentication is required', 'TOKEN_INVALID'); return $match[1]; }
    private static function cookie(array $server, string $name): string { $raw = $server['HTTP_COOKIE'] ?? ''; if (!is_string($raw)) throw new HubControlPlaneException('Control session is required', 'SESSION_INVALID'); foreach (explode(';', $raw) as $part) { [$key, $value] = array_pad(explode('=', trim($part), 2), 2, ''); if ($key === $name && preg_match('/^[A-Za-z0-9_-]{32,128}$/', $value)) return $value; } throw new HubControlPlaneException('Control session is required', 'SESSION_INVALID'); }
    private static function csrf(array $server): string { $value = $server['HTTP_X_AWH_CSRF'] ?? ''; if (!is_string($value) || !preg_match('/^[A-Za-z0-9_-]{32,128}$/', $value)) throw new HubControlPlaneException('CSRF validation is required', 'CSRF_REJECTED'); return $value; }
    private static function rateKey(array $server): string { $address = isset($server['REMOTE_ADDR']) && is_string($server['REMOTE_ADDR']) && filter_var($server['REMOTE_ADDR'], FILTER_VALIDATE_IP) !== false ? $server['REMOTE_ADDR'] : 'unknown'; $agent = isset($server['HTTP_USER_AGENT']) && is_string($server['HTTP_USER_AGENT']) ? substr($server['HTTP_USER_AGENT'], 0, 160) : 'unknown'; return hash('sha256', $address . "\n" . $agent); }
    private static function sameOrigin(array $server): void { if (!HubBrowserOriginPolicy::mutationAllowed($server)) throw new HubControlPlaneException('Browser origin is not authorized', 'ORIGIN_FORBIDDEN'); }
    private static function sameOriginIfBrowser(array $server): void { if (!HubBrowserOriginPolicy::safeReadAllowed($server)) throw new HubControlPlaneException('Browser origin is not authorized', 'ORIGIN_FORBIDDEN'); }
    private static function sessionCookies(string $session, string $csrf): array { return ['Set-Cookie' => ['__Host-awh_control_session=' . $session . '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800', 'awh_csrf=' . $csrf . '; Path=/; Secure; SameSite=Strict; Max-Age=28800']]; }
    private static function exceptionResponse(Throwable $error, string $requestId, array $headers): array { $code = $error instanceof HubControlPlaneException ? $error->codeName : 'CONTROL_PLANE_UNAVAILABLE'; $status = match ($code) { 'ORIGIN_FORBIDDEN', 'CSRF_REJECTED' => 403, 'SESSION_INVALID', 'SESSION_EXPIRED', 'TOKEN_INVALID' => 401, 'PROJECT_FORBIDDEN', 'TASK_FORBIDDEN' => 403, 'TASK_NOT_FOUND', 'APPROVAL_NOT_FOUND' => 404, 'RATE_LIMITED' => 429, 'WORKER_NOT_READY', 'WORKER_BUSY', 'TASK_CLAIM_RACE', 'APPROVAL_ALREADY_DECIDED' => 409, 'SCHEMA_VERSION', 'PAYLOAD_INVALID', 'SCHEMA_FIELDS', 'FIELD_INVALID', 'ID_INVALID', 'GOAL_INVALID', 'IDEMPOTENCY_INVALID', 'PAIRING_CODE_INVALID', 'APPROVAL_DECISION_INVALID' => 400, 'PAIRING_REPLAY', 'APPROVAL_EXPIRED' => 409, 'CONTROL_SCHEMA_NOT_READY', 'DATABASE_UNAVAILABLE' => 503, default => 400 }; return self::response($status, self::error($code, $requestId, self::safeMessage($code)), $headers); }
    private static function safeMessage(string $code): string { return match ($code) { 'ORIGIN_FORBIDDEN' => 'This AWH surface is not authorized', 'CSRF_REJECTED' => 'The request could not be verified', 'SESSION_INVALID', 'SESSION_EXPIRED' => 'Your AWH session has expired', 'TOKEN_INVALID' => 'Worker authentication failed', 'PROJECT_FORBIDDEN' => 'This project is not available to the current device', 'TASK_NOT_FOUND' => 'Task was not found', 'CONTROL_SCHEMA_NOT_READY' => 'AWH control plane is not activated', 'PAIRING_REPLAY' => 'This connection code was already used', default => 'AWH could not complete the request' }; }
    private static function requestId(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private static function response(int $status, array $body, array $headers): array { return ['status' => $status, 'headers' => $headers, 'body' => json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n"]; }
    private static function error(string $code, string $requestId, string $message): array { return ['schemaVersion' => 1, 'error' => 'ERROR', 'code' => $code, 'requestId' => $requestId, 'message' => $message]; }
}
