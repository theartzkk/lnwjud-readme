<?php

declare(strict_types=1);

/**
 * Single verification policy for candidate and release workflows.
 * It classifies risk, chooses a bounded verification budget, derives read-only
 * golden journeys, detects flaky evidence and turns failures into stable
 * regression fingerprints. It never promotes or deploys source itself.
 */
final class HubVerificationIntelligence
{
    private const RANK = ['LOW'=>0,'MEDIUM'=>1,'HIGH'=>2,'CRITICAL'=>3];

    /** @param list<string> $paths @return array<string,mixed> */
    public static function plan(array $paths): array
    {
        $normalized=[];
        foreach ($paths as $path) {
            if (!is_string($path)) continue;
            $path=strtolower(trim(str_replace('\\','/',$path)));
            if ($path==='' || str_contains($path,"\0") || str_starts_with($path,'/')) continue;
            $normalized[$path]=true;
        }
        $files=array_keys($normalized); sort($files,SORT_STRING);
        $risk='LOW'; $reasons=[]; $journeys=['production-identity'=>true];
        foreach ($files as $path) {
            $candidate='LOW'; $reason='documentation-or-low-impact';
            if ($path==='config/execution-policy.json'
                || preg_match('#^(?:hub/migrations/|deploy/|scripts/ops/|package(?:-lock)?\.json$)#',$path)===1
                || preg_match('#^hub/src/hub(?:ownerauth|projectvault|controlplane|verification|operatorbridge|providercredential|secret)#',$path)===1
                || $path==='hub/public/control-plane.php') {
                $candidate='CRITICAL'; $reason='authority-auth-db-deploy-or-verification';
            } elseif (preg_match('#^(?:hub/src/|hub/public/|hub/bin/|scripts/qa/|src/)#',$path)===1) {
                $candidate='HIGH'; $reason='runtime-or-control-logic';
            } elseif (preg_match('#^(?:web/|desktop/|assets/|design/|test/|hub/tests/)#',$path)===1) {
                $candidate='MEDIUM'; $reason='user-surface-or-regression-contract';
            }
            if (self::RANK[$candidate] > self::RANK[$risk]) $risk=$candidate;
            if ($candidate!=='LOW') $reasons[$reason]=true;
            if (preg_match('#^(?:web/|hub/public/|hub/src/hubcontrolplane|deploy/nginx/)#',$path)===1) {
                $journeys['public-shell']=true; $journeys['auth-boundary']=true;
            }
            if (preg_match('#(?:projectvault|vault-source|source-authority|project-source|hubverification)#',$path)===1) $journeys['vault-source-authority']=true;
            if (preg_match('#^(?:desktop/|src/desktop/)|^package(?:-lock)?\.json$#',$path)===1) $journeys['desktop-release-identity']=true;
        }
        $budget=match($risk){'LOW'=>'FAST','MEDIUM'=>'STANDARD',default=>'DEEP'};
        $checks=['syntax','targeted-contracts','exact-revision'];
        if ($budget!=='FAST') array_push($checks,'regression','golden-journeys','visual-if-applicable');
        if ($budget==='DEEP') array_push($checks,'repeat-regression','backup-proof','rollback-proof','source-drift','database-integrity');
        return [
            'schemaVersion'=>1,'riskLevel'=>$risk,'budget'=>$budget,'changedFileCount'=>count($files),
            'reasons'=>array_keys($reasons),'requiredChecks'=>$checks,'goldenJourneys'=>array_keys($journeys),
        ];
    }

    /** @param list<string> $statuses @return array{schemaVersion:int,status:string,samples:int,pass:int,fail:int} */
    public static function stability(array $statuses): array
    {
        $pass=0; $fail=0;
        foreach ($statuses as $status) {
            $status=strtoupper(trim((string)$status));
            if ($status==='PASS') $pass++; elseif ($status!=='') $fail++;
        }
        $state=$pass>0&&$fail>0?'UNSTABLE':($fail>0?'FAIL':($pass>0?'PASS':'NOT_RUN'));
        return ['schemaVersion'=>1,'status'=>$state,'samples'=>$pass+$fail,'pass'=>$pass,'fail'=>$fail];
    }

    /** @param array<string,mixed> $context */
    public static function incident(string $code, array $context=[]): array
    {
        $clean=[]; ksort($context,SORT_STRING);
        foreach ($context as $key=>$value) {
            if (!is_string($key) || strlen($key)>80) continue;
            if (is_scalar($value) || $value===null) $clean[$key]=$value;
        }
        $code=strtoupper(preg_replace('/[^A-Z0-9_.:-]+/i','_',trim($code))??'UNKNOWN');
        if ($code==='') $code='UNKNOWN';
        $canonical=json_encode(['code'=>$code,'context'=>$clean],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
        $fingerprint=hash('sha256',$canonical);
        return ['schemaVersion'=>1,'fingerprint'=>$fingerprint,'regressionId'=>'reg-'.substr($fingerprint,0,12),'code'=>$code,'context'=>$clean,'required'=>true];
    }
}
