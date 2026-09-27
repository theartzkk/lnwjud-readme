<?php
declare(strict_types=1);

require_once __DIR__ . '/HubLocalDecisionRouter.php';
require_once __DIR__ . '/HubSystemOneDecisionService.php';

/**
 * Local-first advisory decision fabric.
 * Free local routing is always available; TypeSafe/Jev remains an optional
 * external fallback and never becomes an execution or approval authority.
 */
final class HubDecisionFabricService
{
    public const POLICY_VERSION = 'awh-decision-fabric-v2';

    public function __construct(
        private readonly HubLocalDecisionRouter $local,
        private readonly HubSystemOneDecisionService $external
    ) {}

    public static function fromPdo(PDO $pdo): self
    {
        return new self(new HubLocalDecisionRouter($pdo), HubSystemOneDecisionService::fromEnvironment());
    }

    /** @return array<string,mixed> */
    public function status(): array
    {
        $external = $this->external->status();
        return [
            'provider'=>'awh-local',
            'active'=>true,
            'configured'=>true,
            'mode'=>'LOCAL_FIRST',
            'costClass'=>'LOCAL_INCLUDED',
            'networkRequired'=>false,
            'policyVersion'=>self::POLICY_VERSION,
            'localRouter'=>$this->local->status(),
            'externalFallback'=>[
                'provider'=>'typesafe',
                'configured'=>($external['configured'] ?? false) === true,
                'active'=>($external['active'] ?? false) === true,
                'model'=>$external['model'] ?? null,
                'authority'=>'ADVISORY_ONLY',
                'optional'=>true,
            ],
            'authority'=>'ADVISORY_ONLY',
        ];
    }
    public function replaceExternalCredential(string $secret): void
    {
        $this->external->replaceCredential($secret);
    }

    public function removeExternalCredential(): void
    {
        $this->external->removeCredential();
    }

    /** @return array<string,mixed> */
    public function testExternalConnection(): array
    {
        return $this->external->testConnection();
    }

    /** @return array<string,mixed> */
    public function decideGoal(string $goal): array
    {
        $local = $this->local->decideGoal($goal);
        $state = (string)($local['state'] ?? 'AUTO_FIT');
        if ($state === 'DETERMINISTIC_ROUTE' || $state === 'APPLIED') {
            return $this->decorate($local, 'LOCAL');
        }

        $externalStatus = $this->external->status();
        if (($externalStatus['configured'] ?? false) !== true) return $this->decorate($local, 'LOCAL_ONLY');

        $external = $this->external->decideGoal($goal);
        if (($external['state'] ?? null) === 'APPLIED') return $this->decorate($external, 'EXTERNAL_FALLBACK');
        return $this->decorate($local, 'LOCAL_FALLBACK');
    }

    /** @param array<string,mixed> $decision @return array<string,mixed> */
    private function decorate(array $decision, string $stage): array
    {
        $decision['fabricPolicyVersion'] = self::POLICY_VERSION;
        $decision['fabricStage'] = $stage;
        return $decision;
    }

    /** @param array<string,mixed> $decision */
    public static function accepts(array $decision): bool
    {
        if (($decision['state'] ?? null) !== 'APPLIED' || ($decision['authority'] ?? null) !== 'ADVISORY_ONLY') return false;
        $route = $decision['route'] ?? null;
        if (!is_string($route) || !in_array($route,['VPS_DIRECT','REMOTE_DEVICE','CONNECTED_FILES','DIRECT_PLUS_REMOTE'],true)) return false;
        $provider = $decision['provider'] ?? null;
        if ($provider === 'awh-local') {
            return is_numeric($decision['score'] ?? null)
                && is_numeric($decision['margin'] ?? null)
                && (float)$decision['score'] >= HubLocalDecisionRouter::MIN_SCORE
                && (float)$decision['margin'] >= HubLocalDecisionRouter::MIN_MARGIN;
        }
        if ($provider === HubTypeSafeDecisionAdapter::PROVIDER_ID) {
            return is_numeric($decision['confidence'] ?? null)
                && (float)$decision['confidence'] >= HubSystemOneDecisionService::CONFIDENCE_THRESHOLD;
        }
        return false;
    }
}
