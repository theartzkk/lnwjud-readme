<?php

declare(strict_types=1);

final class HubTrustPolicyException extends RuntimeException {}

/** Canonical risk classification for human administrative actions. */
final class HubTrustPolicy
{
    public const LOW = 'LOW';
    public const MEDIUM = 'MEDIUM';
    public const HIGH = 'HIGH';
    public const CRITICAL = 'CRITICAL';

    public static function describe(string $action, array $context = []): array
    {
        $role = strtoupper((string)($context['targetRole'] ?? ''));
        $decision = strtoupper((string)($context['decision'] ?? ''));
        return match ($action) {
            'hosting.site.create' => self::policy(self::LOW, false, false),
            'hosting.site.deploy', 'hosting.site.rollback', 'hosting.site.disable' => self::policy(self::MEDIUM, true, false),
            'hosting.site.delete', 'hosting.database.purge', 'hosting.backup.purge' => self::policy(self::CRITICAL, true, true),
            'account.user.create' => self::policy($role === 'ADMIN' ? self::HIGH : self::MEDIUM, false, $role === 'ADMIN'),
            'account.request.review' => self::policy($decision === 'APPROVE' && $role === 'ADMIN' ? self::HIGH : self::MEDIUM, false, $decision === 'APPROVE' && $role === 'ADMIN'),
            'account.user.access' => self::policy($role === 'ADMIN' ? self::HIGH : self::MEDIUM, true, $role === 'ADMIN'),
            'account.user.revoke' => self::policy(self::MEDIUM, true, false),
            'auth.recovery.codes', 'auth.owner.identity', 'provider.credential', 'cloud.credential' => self::policy(self::HIGH, true, true),
            'provider.policy', 'provider.project.routing', 'database.read.sql' => self::policy(self::MEDIUM, true, false),
            default => throw new HubTrustPolicyException('Unknown trust action'),
        };
    }

    public static function requiresStepUp(string $action, array $context = []): bool
    {
        return self::describe($action, $context)['stepUpRequired'];
    }

    public static function catalog(array $actions): array
    {
        $out = []; foreach ($actions as $action) $out[$action] = self::describe((string)$action); return $out;
    }

    private static function policy(string $risk, bool $confirmation, bool $stepUp): array
    {
        return ['risk' => $risk, 'confirmationRequired' => $confirmation, 'stepUpRequired' => $stepUp];
    }
}
