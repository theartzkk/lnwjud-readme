<?php

declare(strict_types=1);

/**
 * Browser-origin policy shared by the owner-auth and control-plane routers.
 *
 * Unsafe requests always require the exact configured Origin. Safe reads use
 * the same rule when Origin is supplied, while browser navigations/fetches
 * which truthfully identify themselves as same-origin but omit Origin remain
 * valid. This is required for Safari and normal browser GET semantics; it is
 * deliberately not an exception for cross-site or state-changing requests.
 */
final class HubBrowserOriginPolicy
{
    public static function mutationAllowed(array $server): bool
    {
        $origin = self::header($server, 'HTTP_ORIGIN');
        $configured = self::controlOrigin($server);
        return $origin !== '' && $configured !== '' && hash_equals($configured, $origin);
    }

    public static function safeReadAllowed(array $server): bool
    {
        $origin = self::header($server, 'HTTP_ORIGIN');
        if ($origin !== '') return self::mutationAllowed($server);

        // `Origin` is intentionally absent on ordinary same-origin GETs. A
        // browser that provides Fetch Metadata must state same-origin; legacy
        // clients without Fetch Metadata retain the existing safe-read path.
        $fetchSite = self::header($server, 'HTTP_SEC_FETCH_SITE');
        return $fetchSite === '' || $fetchSite === 'same-origin';
    }

    private static function controlOrigin(array $server): string
    {
        $requestValue = $server['AWH_CONTROL_ORIGIN'] ?? null;
        if (is_string($requestValue) && $requestValue !== '') return $requestValue;
        $environmentValue = getenv('AWH_CONTROL_ORIGIN');
        return is_string($environmentValue) ? $environmentValue : '';
    }

    private static function header(array $server, string $name): string
    {
        $value = $server[$name] ?? '';
        return is_string($value) ? $value : '';
    }
}
