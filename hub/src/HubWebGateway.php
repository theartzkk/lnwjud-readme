<?php

declare(strict_types=1);

final class HubWebGateway
{
    /**
     * Nginx supplies this as a server-controlled FastCGI parameter. HTTP
     * headers from a browser are deliberately not accepted as trust signals.
     */
    public static function isTrusted(array $server): bool
    {
        return ($server['AWH_WEB_GATEWAY_TRUSTED_PERIMETER'] ?? null) === 'nginx';
    }
}
