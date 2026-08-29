<?php

declare(strict_types=1);

final class HubSecretContentPolicy
{
    /**
     * High-confidence credential detection only. Ordinary placeholders and
     * configuration examples remain valid project text.
     */
    public static function containsCredential(string $content): bool
    {
        if ($content === '' || str_contains($content, "\0")) return false;
        if (preg_match('/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i', $content) === 1) return true;
        if (preg_match('/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/i', $content) === 1) return true;
        if (preg_match('/\bsk-[A-Za-z0-9_-]{20,}\b/', $content) === 1) return true;
        if (preg_match('/\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/i', $content) === 1) return true;
        if (preg_match('/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/i', $content) === 1) return true;
        if (preg_match('/\bAKIA[0-9A-Z]{16}\b/', $content) === 1) return true;
        if (preg_match('/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/', $content) === 1) return true;
        return false;
    }
}
