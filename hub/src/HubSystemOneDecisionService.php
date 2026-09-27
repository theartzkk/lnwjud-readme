<?php

declare(strict_types=1);

require_once __DIR__ . '/HubTypeSafeDecisionAdapter.php';
require_once __DIR__ . '/HubProviderCredentialStore.php';
require_once __DIR__ . '/HubCapabilityRegistryService.php';
require_once __DIR__ . '/HubSecretContentPolicy.php';

final class HubSystemOneDecisionService
{
    public const POLICY_VERSION = 'awh-system-one-v1';
    public const CONFIDENCE_THRESHOLD = 0.82;
    private readonly HubProviderCredentialStore $credentials;

    public function __construct(
        private readonly HubTypeSafeDecisionAdapter $adapter = new HubTypeSafeDecisionAdapter(),
        ?HubProviderCredentialStore $credentials = null
    ) {
        $this->credentials = $credentials ?? HubProviderCredentialStore::fromEnvironment(HubTypeSafeDecisionAdapter::PROVIDER_ID);
    }

    public static function fromEnvironment(): self { return new self(); }

    /** @return array<string,mixed> */
    public function status(): array
    {
        $configured = false;
        try { $configured = $this->credentials->configured(); } catch (Throwable) {}
        return [
            'provider'=>HubTypeSafeDecisionAdapter::PROVIDER_ID,
            'model'=>HubTypeSafeDecisionAdapter::DEFAULT_MODEL,
            'configured'=>$configured,
            'active'=>$configured,
            'policyVersion'=>self::POLICY_VERSION,
            'confidenceThreshold'=>self::CONFIDENCE_THRESHOLD,
            'authority'=>'ADVISORY_ONLY',
        ];
    }

    public function replaceCredential(string $secret): void { $this->credentials->replace($secret); }
    public function removeCredential(): void { $this->credentials->remove(); }

    /** @return array<string,mixed> */
    public function testConnection(): array
    {
        $key = $this->credentials->read();
        if ($key === null) return ['status'=>'NOT_CONFIGURED','model'=>HubTypeSafeDecisionAdapter::DEFAULT_MODEL];
        $result = $this->adapter->decide([
            'state'=>'AWH Jev connection test',
            'model'=>HubTypeSafeDecisionAdapter::DEFAULT_MODEL,
            'questions'=>[
                'connection'=>[
                    'type'=>'choice',
                    'instructions'=>'Select whether the supplied state is exactly an AWH Jev connection test.',
                    'criteria'=>['ok'=>'The state is exactly an AWH Jev connection test.','not_ok'=>'The state is not an AWH Jev connection test.'],
                ],
            ],
        ], $key);
        $answer = $result['answers']['connection'] ?? null;
        if (!is_array($answer) || ($answer['choice'] ?? null) !== 'ok') throw new HubTypeSafeDecisionException('Jev connection response is invalid','JEV_RESPONSE_INVALID');
        return ['status'=>'PASS','model'=>is_string($result['model'] ?? null) ? $result['model'] : HubTypeSafeDecisionAdapter::DEFAULT_MODEL];
    }

    /** @return array<string,mixed> */
    public function decideGoal(string $goal): array
    {
        $deterministic = HubCapabilityRegistryService::workProfileForGoal($goal);
        if (($deterministic['primaryRoute'] ?? 'AUTO_FIT') !== 'AUTO_FIT') return $this->fallback('DETERMINISTIC_ROUTE', $deterministic, null);
        if (HubSecretContentPolicy::containsCredential($goal) || self::containsGenericSecret($goal)) return $this->fallback('SECRET_GUARD', $deterministic, null);
        $safeGoal = self::sanitizeGoal($goal);
        if ($safeGoal === '') return $this->fallback('EMPTY_STATE', $deterministic, null);

        try { $key = $this->credentials->read(); }
        catch (Throwable) { return $this->fallback('CREDENTIAL_UNAVAILABLE', $deterministic, null); }
        if ($key === null) return $this->fallback('NOT_CONFIGURED', $deterministic, null);

        try {
            $result = $this->adapter->decide([
                'state'=>['request'=>$safeGoal],
                'model'=>HubTypeSafeDecisionAdapter::DEFAULT_MODEL,
                'questions'=>[
                    'intent'=>[
                        'type'=>'choice',
                        'instructions'=>'Classify the primary work intent. This is advisory metadata only.',
                        'criteria'=>[
                            'read_or_explain'=>'Read, explain, summarize, or answer without changing a system.',
                            'research'=>'Gather or compare information from external or connected sources.',
                            'code_change'=>'Change source code, configuration, tests, or application behavior.',
                            'visual_design'=>'Create or edit visual, UI, image, video, layout, or design work.',
                            'document'=>'Create or modify a document, report, worksheet, spreadsheet, or presentation.',
                            'release_deploy'=>'Release, deploy, promote, publish, or roll back an existing build.',
                            'infrastructure'=>'Operate server, network, database, runtime, service, storage, or infrastructure.',
                            'communication'=>'Prepare or send a message, notification, email, or channel communication.',
                            'other'=>'None of the other intents is sufficiently supported.',
                        ],
                    ],
                    'route'=>[
                        'type'=>'choice',
                        'instructions'=>'Choose the minimum execution environment needed. Do not infer permissions or approvals.',
                        'criteria'=>[
                            'auto_fit'=>'No special environment is clearly required.',
                            'vps_direct'=>'Server, runtime, database, deployment, or backend state is central.',
                            'remote_device'=>'A named device, GUI, local application, or native desktop state is central.',
                            'connected_files'=>'Durable files or connected source material are central.',
                            'direct_plus_remote'=>'Both server state and a real device or GUI state are central.',
                        ],
                    ],
                ],
            ], $key);
        } catch (Throwable $error) {
            return $this->fallback('PROVIDER_FALLBACK', $deterministic, $error instanceof HubTypeSafeDecisionException ? $error->codeName : 'JEV_FAILED');
        }

        $intent = self::choice($result['answers']['intent'] ?? null);
        $route = self::choice($result['answers']['route'] ?? null);
        if ($intent === null || $route === null) return $this->fallback('INVALID_DECISION', $deterministic, 'JEV_RESPONSE_INVALID');
        if ($route['confidence'] < self::CONFIDENCE_THRESHOLD) return $this->fallback('LOW_CONFIDENCE', $deterministic, null, $intent['choice'], $route['confidence']);
        $mapped = self::mapRoute($route['choice']);
        if ($mapped === null) return $this->fallback('INVALID_ROUTE', $deterministic, null, $intent['choice'], $route['confidence']);

        return [
            'schemaVersion'=>1,
            'policyVersion'=>self::POLICY_VERSION,
            'state'=>'APPLIED',
            'provider'=>HubTypeSafeDecisionAdapter::PROVIDER_ID,
            'model'=>is_string($result['model'] ?? null) ? substr($result['model'],0,80) : HubTypeSafeDecisionAdapter::DEFAULT_MODEL,
            'intent'=>$intent['choice'],
            'route'=>$mapped,
            'confidence'=>$route['confidence'],
            'authority'=>'ADVISORY_ONLY',
        ];
    }

    /** @return array{choice:string,confidence:float}|null */
    private static function choice(mixed $value): ?array
    {
        if (!is_array($value) || ($value['type'] ?? null) !== 'choice' || !is_string($value['choice'] ?? null) || !is_numeric($value['confidence'] ?? null)) return null;
        $confidence = (float)$value['confidence'];
        if (!is_finite($confidence) || $confidence < 0 || $confidence > 1) return null;
        return ['choice'=>substr((string)$value['choice'],0,80),'confidence'=>$confidence];
    }

    private static function mapRoute(string $route): ?string
    {
        return match ($route) {
            'auto_fit'=>'AUTO_FIT',
            'vps_direct'=>'VPS_DIRECT',
            'remote_device'=>'REMOTE_DEVICE',
            'connected_files'=>'CONNECTED_FILES',
            'direct_plus_remote'=>'DIRECT_PLUS_REMOTE',
            default=>null,
        };
    }

    /** @param array<string,mixed> $deterministic @return array<string,mixed> */
    private function fallback(string $state, array $deterministic, ?string $errorCode, ?string $intent = null, ?float $confidence = null): array
    {
        $out = [
            'schemaVersion'=>1,
            'policyVersion'=>self::POLICY_VERSION,
            'state'=>$state,
            'provider'=>HubTypeSafeDecisionAdapter::PROVIDER_ID,
            'model'=>HubTypeSafeDecisionAdapter::DEFAULT_MODEL,
            'intent'=>$intent,
            'route'=>(string)($deterministic['primaryRoute'] ?? 'AUTO_FIT'),
            'confidence'=>$confidence,
            'authority'=>'ADVISORY_ONLY',
        ];
        if ($errorCode !== null) $out['errorCode'] = substr($errorCode,0,80);
        return $out;
    }

    private static function containsGenericSecret(string $goal): bool
    {
        return preg_match('/\\b(?:api[_ -]?key|token|password|secret)\\s*[:=]\\s*[^\\s]{8,}/i', $goal) === 1;
    }

    private static function sanitizeGoal(string $goal): string
    {
        $value = str_replace(["\r\n","\r"], "\n", trim($goal));
        $value = preg_replace('#(?<![A-Za-z0-9])(?:/[A-Za-z0-9._~:@%+,-]+){2,}#', '[path]', $value) ?? $value;
        $value = preg_replace('/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i', '[id]', $value) ?? $value;
        $value = preg_replace('/\b[0-9a-f]{40,64}\b/i', '[revision]', $value) ?? $value;
        return substr($value, 0, 4000);
    }
}
