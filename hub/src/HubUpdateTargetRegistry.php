<?php
declare(strict_types=1);

final class HubUpdateTargetRegistry
{
    /** @return array<string,array{directory:string,project:string,projection:bool,kind:string,defaultBranch:string,releaseTrack:string}> */
    public static function repositories(): array
    {
        return [
            'awh'=>['directory'=>'awh.git','project'=>'Art’s Workspace Hub','projection'=>false,'kind'=>'CORE','defaultBranch'=>'production','releaseTrack'=>'awh'],
            'bay-excuse-x'=>['directory'=>'bay-excuse-x.git','project'=>'BAY EXCUSE X','projection'=>true,'kind'=>'SYSTEM','defaultBranch'=>'main','releaseTrack'=>'bay-excuse-x'],
            'bay-hub'=>['directory'=>'bay-hub.git','project'=>'BAY Hub','projection'=>true,'kind'=>'HUB','defaultBranch'=>'main','releaseTrack'=>'bay-hub'],
            'bay-learnlab'=>['directory'=>'bay-learnlab.git','project'=>'BAY LearnLab','projection'=>true,'kind'=>'PRODUCT','defaultBranch'=>'main','releaseTrack'=>'bay-learnlab'],
            'bay-assessment'=>['directory'=>'bay-assessment.git','project'=>'BAY Assessment','projection'=>false,'kind'=>'PRODUCT','defaultBranch'=>'main','releaseTrack'=>'bay-assessment'],
            'school-website'=>['directory'=>'school-website.git','project'=>'เว็บไซต์โรงเรียน','projection'=>true,'kind'=>'HOSTING','defaultBranch'=>'main','releaseTrack'=>'school-website'],
            'bay-computer-lab'=>['directory'=>'bay-computer-lab.git','project'=>'BAY Computer Lab','projection'=>true,'kind'=>'SYSTEM','defaultBranch'=>'main','releaseTrack'=>'bay-computer-lab'],
        ];
    }


    /**
     * Release tracks are product identities, not repositories. VPS Platform and
     * AWH intentionally share the current source repository while keeping
     * independent release refs, capabilities, history and approval scopes.
     *
     * @return array<string,array<string,mixed>>
     */
    public static function releaseTracks(): array
    {
        return [
            'vps-platform'=>[
                'name'=>'VPS Platform','kind'=>'PLATFORM','repository'=>'awh',
                'sourceRef'=>'refs/heads/main','productionRef'=>'refs/heads/platform/production',
                'capability'=>'system.platform.release','deployResource'=>'CANONICAL:DEPLOY:VPS_PLATFORM',
                'versionPrefix'=>'Platform','deploymentAdapter'=>'PLATFORM_RELEASE','ownerApprovalRequired'=>true,'hostGlobal'=>true,'visibility'=>'PRIMARY',
            ],
            'awh'=>[
                'name'=>'AWH','kind'=>'CORE','repository'=>'awh',
                'sourceRef'=>'refs/heads/main','productionRef'=>'refs/heads/production',
                'capability'=>'system.core.release','deployResource'=>'CANONICAL:DEPLOY:AWH',
                'versionPrefix'=>'AWH','deploymentAdapter'=>'CORE_RELEASE','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'awh-agent'=>[
                'name'=>'AWH Agent','kind'=>'AGENT','repository'=>'awh-local-agent',
                'sourceRef'=>'refs/heads/main','productionRef'=>'refs/heads/main',
                'capability'=>'system.agent.release','deployResource'=>'CANONICAL:DEPLOY:AWH_AGENT',
                'versionPrefix'=>'Agent','deploymentAdapter'=>'AGENT_MANAGED','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'awh-line-gateway'=>[
                'name'=>'AWH LINE OA / KRUART LINE Gateway','kind'=>'INTEGRATION','repository'=>null,
                'sourceAuthority'=>'AWH_VAULT','projectId'=>'124ae148-3ed1-4e45-8f50-75ff45a39e5c',
                'siteId'=>'ed911e13-ccfa-44d9-8214-6425cb252240','domain'=>'line.kruart.online',
                'healthPath'=>'/healthz','webhookPath'=>'/webhook','secretScope'=>'KRUART_LINE_GATEWAY',
                'productionRef'=>null,'capability'=>'hosting.site.deploy','deployResource'=>'RESOURCE:HOSTING',
                'versionPrefix'=>'LINE Gateway','deploymentAdapter'=>'MANAGED_HOSTING','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-excuse-x'=>[
                'name'=>'BAY EXCUSE X','kind'=>'SYSTEM','repository'=>'bay-excuse-x',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,'packageTrack'=>'bay-excuse-core',
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:BAY_EXCUSE',
                'versionPrefix'=>'BAY','deploymentAdapter'=>'BAY_UPDATE_CENTER','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'line-oa'=>[
                'name'=>'BAY Excuse LINE OA','kind'=>'INTEGRATION','repository'=>'bay-excuse-x',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,'packageTrack'=>'line-oa',
                'secretScope'=>'BAY_EXCUSE_LINE_OA',
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:LINE_OA',
                'versionPrefix'=>'BAY LINE','deploymentAdapter'=>'BAY_UPDATE_CENTER','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-cooperative'=>[
                'name'=>'ศูนย์งานสหกรณ์โรงเรียน','kind'=>'PRODUCT','repository'=>'bay-excuse-x',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,'packageTrack'=>'cooperative-center',
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:BAY_COOPERATIVE',
                'versionPrefix'=>'Cooperative','deploymentAdapter'=>'BAY_UPDATE_CENTER','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-pp'=>[
                'name'=>'ศูนย์ ปพ.','kind'=>'PRODUCT','repository'=>'bay-excuse-x',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,'packageTrack'=>'pp-center',
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:BAY_PP',
                'versionPrefix'=>'PP','deploymentAdapter'=>'BAY_UPDATE_CENTER','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-assessment'=>[
                'name'=>'BAY Assessment','kind'=>'PRODUCT','repository'=>'bay-assessment',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'system.assessment.release','deployResource'=>'CANONICAL:DEPLOY:BAY_ASSESSMENT',
                'versionPrefix'=>'Assessment','deploymentAdapter'=>'ASSESSMENT_RELEASE','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-learnlab'=>[
                'name'=>'BAY LearnLab','kind'=>'PRODUCT','repository'=>'bay-learnlab',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'system.learnlab.release','deployResource'=>'CANONICAL:DEPLOY:BAY_LEARNLAB',
                'versionPrefix'=>'LearnLab','deploymentAdapter'=>'LEARNLAB_RELEASE','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-computer-lab'=>[
                'name'=>'BAY Computer Lab','kind'=>'SYSTEM','repository'=>'bay-computer-lab',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:PROJECT',
                'versionPrefix'=>'Computer Lab','deploymentAdapter'=>'SOURCE_ONLY','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'school-website'=>[
                'name'=>'School Website','kind'=>'HOSTING','repository'=>'school-website',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'project.mutate.deploy','deployResource'=>'CANONICAL:DEPLOY:PROJECT',
                'versionPrefix'=>'School','deploymentAdapter'=>'MANAGED_HOSTING','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-hub'=>[
                'name'=>'BAY Hub','kind'=>'HUB','repository'=>'bay-hub',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'project.mutate.deploy','deployResource'=>'CANONICAL:DEPLOY:PROJECT',
                'versionPrefix'=>'Hub','deploymentAdapter'=>'SOURCE_ONLY','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'ADVANCED',
            ],
        ];
    }

    /** @return array<string,array<string,mixed>> */
    public static function releaseGroups(): array
    {
        return [
            'line-oa'=>[
                'name'=>'LINE OA',
                'targets'=>[
                    ['itemKey'=>'awh-line-gateway','releaseTrack'=>'awh-line-gateway'],
                    ['itemKey'=>'bay-excuse-line-oa','releaseTrack'=>'line-oa'],
                ],
                'approvalMode'=>'SIGNED_IN_OWNER',
                'orchestration'=>'SEQUENTIAL_VERIFY_EACH',
                'failurePolicy'=>'STOP_ON_TARGET_FAILURE',
                'historyScope'=>'PER_TARGET',
                'rollbackScope'=>'PER_TARGET',
                'forbiddenImplicitTargets'=>['awh','vps-platform','bay-excuse-x'],
            ],
        ];
    }

    /** @return array<string,mixed>|null */
    public static function byReleaseTrack(string $track): ?array
    {
        $key=strtolower(trim($track));
        $row=self::releaseTracks()[$key]??null;
        return is_array($row)?['track'=>$key]+$row:null;
    }

    public static function releaseVisibility(string $track): string
    {
        $row=self::byReleaseTrack($track);
        return is_array($row)&&($row['visibility']??null)==='PRIMARY'?'PRIMARY':'ADVANCED';
    }

    /**
     * Classify one exact source-promotion delta into one release track.
     * Mixed AWH/VPS Platform deltas are rejected upstream instead of being
     * hidden inside a single product release.
     *
     * @param list<string> $paths
     */
    public static function releaseTrackForPaths(string $repository,array $paths): ?string
    {
        $repository=strtolower(trim($repository));
        $repo=self::repositories()[$repository]??null;
        if(!is_array($repo))return null;
        if($repository==='bay-excuse-x')return self::bayReleaseTrackForPaths($paths);
        if($repository!=='awh')return (string)($repo['releaseTrack']??$repository);
        $tracks=[];
        foreach($paths as $path){
            if(!is_string($path)||$path===''||str_contains($path,"\0"))return null;
            $track=self::awhPathReleaseTrack($path);
            if($track==='shared')continue;
            $tracks[$track]=true;
            if(count($tracks)>1)return null;
        }
        // Shared-only Update Center/control-contract maintenance still belongs
        // to the AWH release track. A real AWH/VPS mixed delta is rejected
        // above as soon as two non-shared owners are observed.
        return count($tracks)===1?(string)array_key_first($tracks):($paths===[]?null:'awh');
    }

    /**
     * Authoritative path ownership projection for mutation-time scope checks.
     * @param list<string> $paths
     * @return array{tracks:list<string>,sharedPaths:list<string>,ownedPaths:array<string,string>}
     */
    public static function pathOwnership(string $repository,array $paths): array
    {
        $repository=strtolower(trim($repository));$tracks=[];$shared=[];$owned=[];
        if(!isset(self::repositories()[$repository]))return ['tracks'=>[],'sharedPaths'=>[],'ownedPaths'=>[]];
        foreach($paths as $path){
            if(!is_string($path)||$path===''||str_contains($path,"\0"))continue;
            $track=$repository==='bay-excuse-x'?self::bayPathReleaseTrack($path):($repository==='awh'?self::awhPathReleaseTrack($path):(string)(self::repositories()[$repository]['releaseTrack']??$repository));
            $owned[$path]=$track;
            if($track==='shared'){$shared[]=$path;continue;}
            $tracks[$track]=true;
        }
        $list=array_keys($tracks);sort($list,SORT_STRING);sort($shared,SORT_STRING);ksort($owned,SORT_STRING);
        return ['tracks'=>$list,'sharedPaths'=>$shared,'ownedPaths'=>$owned];
    }

    /** @param array<string,mixed> $releaseNotes */
    public static function sourceMetadataRepairDigest(string $repository,string $base,string $target,array $releaseNotes,string $repairKind): string
    {
        return hash('sha256',json_encode([
            'schemaVersion'=>1,
            'kind'=>'SOURCE_PROMOTION_METADATA_REPAIR',
            'repository'=>strtolower(trim($repository)),
            'baseSha'=>strtolower(trim($base)),
            'targetSha'=>strtolower(trim($target)),
            'repairKind'=>$repairKind,
            'releaseNotes'=>$releaseNotes,
        ],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR));
    }

    /** @param list<string> $paths */
    private static function bayReleaseTrackForPaths(array $paths): ?string
    {
        $tracks=[];
        foreach($paths as $path){
            if(!is_string($path)||$path===''||str_contains($path,"\0"))return null;
            $track=self::bayPathReleaseTrack($path);
            if($track==='shared')continue;
            $tracks[$track]=true;
            if(count($tracks)>1)return null;
        }
        return count($tracks)===1?(string)array_key_first($tracks):($tracks===[]?'bay-excuse-x':null);
    }

    private static function bayPathReleaseTrack(string $path): string
    {
        $sharedExact=[
            'VERSION','RELEASE_TRACK',
            'app/Controllers/RemoteUpdateController.php',
            'app/Core/CoreReleaseTrackState.php',
            'app/Core/IntegrationManager.php',
            'app/Core/PackageManager.php',
            'app/Core/RuntimeMigrations.php',
            'app/Core/UpdateInboxService.php',
            'app/asset_consolidation_contract.php',
            'app/asset_load_policy.php',
            'app/bootstrap.php',
            'app/cleanup_foundation.php',
            'app/feature_boundaries.php',
            'app/navigation_architecture.php',
            'app/settings_schema.php',
            'tools/ci/build-update-package.py',
            'tools/ci/run-release-source-validation.sh',
            'tools/ci/validate-deployment-scope.sh',
            'tools/qa/cooperative-release-track-contract.php',
            'tools/qa/pp-release-track-contract.php',
            'tools/qa/line-oa-release-track-contract.php',
        ];
        if(in_array($path,$sharedExact,true))return 'shared';
        $lower=strtolower($path);
        $ppExact=[
            'app/Controllers/AcademicRecordsController.php',
            'app/Controllers/ReportPoliciesController.php',
            'app/Core/AcademicDocumentContextService.php',
            'app/Core/AcademicDocumentEngine.php',
            'app/Core/AcademicExportService.php',
            'app/Core/AcademicGoldenSheetPrintService.php',
            'app/Core/AcademicPrintPackageService.php',
            'app/Core/AcademicRecordsCenterService.php',
            'app/Core/AcademicRecordsRepository.php',
            'app/Core/AcademicRecordsService.php',
            'app/Core/AcademicScoreNormalizer.php',
            'app/Core/AcademicScorebookService.php',
            'app/Core/AcademicSheetWorkspaceService.php',
            'app/Core/AcademicWorkbookImporter.php',
            'app/Core/GoldenExcelBridgeService.php',
            'app/Core/GoldenWorkbookCatalog.php',
            'views/layouts/pp-app.php',
            'views/system/report-policies.php',
            'views/system/academic-workbook-import.php',
            'views/operations/documents/golden-workbook-sheet.php',
            'views/operations/documents/grade-class.php',
            'views/operations/documents/grade-percentage.php',
        ];
        if(
            in_array($path,$ppExact,true)||
            str_starts_with($lower,'app/data/golden/')||
            str_starts_with($lower,'app/data/pp56_')||
            str_starts_with($lower,'assets/academic-records-')||
            str_starts_with($lower,'assets/academic-workbook-import')||
            str_starts_with($lower,'assets/pp-app-')||
            str_starts_with($lower,'assets/pp-production-')||
            str_starts_with($lower,'assets/rc4-golden-pp')||
            str_starts_with($lower,'assets/bay-report-image-export')||
            str_starts_with($lower,'views/academic/pp-')||
            str_starts_with($lower,'views/academic/records-center')||
            str_starts_with($lower,'views/academic/subject-golden-workspace')
        )return 'bay-pp';
        if(
            str_contains($lower,'cooperative')||preg_match('#(?:^|/)coop[-_/]#',$lower)===1||
            str_starts_with($lower,'views/cooperative/')||
            str_starts_with($lower,'views/layouts/cooperative')||
            str_starts_with($lower,'assets/bay-coop')||
            str_starts_with($lower,'assets/cooperative')||
            str_starts_with($lower,'templates/cooperative')
        )return 'bay-cooperative';
        $base=strtolower(basename($path));
        if(
            str_starts_with($lower,'app/resources/line-richmenu/')||
            str_starts_with($lower,'assets/line-')||
            str_starts_with($lower,'assets/parent-connect')||
            str_starts_with($lower,'views/parent-connect/')||
            str_starts_with($lower,'line-webhook.php')||
            str_starts_with($lower,'liff-workspace')||
            str_starts_with($lower,'parent-connect')||
            str_contains($base,'richmenu')||
            preg_match('#(?:^|/)(?:line|liff)[-_]#',$lower)===1||
            preg_match('/(?:line|parentconnect)[a-z0-9_-]*\.(?:php|js|css)$/',$base)===1
        )return 'line-oa';
        return 'bay-excuse-x';
    }

    private static function awhPathReleaseTrack(string $path): string
    {
        $sharedExact=[
            'config/ecosystem-release-contract.json',
            'hub/src/HubControlPlaneRouter.php',
            'hub/src/HubControlPlaneService.php',
            'hub/src/HubDurableExecutionService.php',
            'hub/src/HubUpdateTargetRegistry.php',
            'web/control-plane-adapter.js',
            'web/updates.js',
            'test/ecosystem-platform-hardening.test.ts',
            'test/update-center-contract.test.ts',
            'test/web-preview.test.ts',
        ];
        if(in_array($path,$sharedExact,true))return 'shared';
        $platformExact=[
            'AGENTS.md',
            'config/ecosystem-platform-policy.json',
            'config/continuous-improvement-policy.json',
            'config/kruart-engineering-eval.json',
            'config/ecosystem-release-contract.json',
            'config/execution-policy.json',
            'config/repository-governance-contract.json',
            'docs/AWH-AUTHORITY-MAP.md',
            'docs/AWH_OPERATOR_BRIDGE.md',
            'docs/AWH_SUSTAINABILITY_CONTRACT.md',
            'docs/OPERATIONS.md',
            'docs/RELEASE.md',
            'hub/bin/ecosystem-source-drift.php',
            'hub/bin/migrate-platform-maintenance.php',
            'hub/migrations/024_platform_maintenance.sql',
            'hub/src/HubCapabilityRegistryService.php',
            'hub/src/HubPlatformMaintenanceMigration.php',
            'hub/src/HubPlatformMaintenanceService.php',
            'hub/src/HubCoreReleaseOperator.php',
            'hub/src/HubCoreReleaseService.php',
            'hub/src/HubDeployExecutionAuthorityService.php',
            'hub/src/HubExecutionLifecycleService.php',
            'hub/src/HubOperatorBridgeService.php',
            'hub/src/HubVerificationIntelligence.php',
            'hub/src/HubTrustPolicy.php',
            'hub/src/HubUpdateTargetRegistry.php',
            'hub/tests/assessment-release-operator.php',
            'hub/tests/core-release-operator.php',
            'hub/tests/deploy-execution-authority.php',
            'hub/tests/execution-resource-policy.php',
            'hub/tests/learnlab-release-operator.php',
            'hub/tests/m13-anywhere-execution.php',
            'hub/tests/m23-platform-hardening.php',
            'hub/tests/m25-platform-maintenance.php',
            'hub/tests/operator-bridge.php',
            'hub/tests/verification-evidence-registry.php',
            'hub/tests/verification-intelligence.php',
            'scripts/create-web-release-manifest.mjs',
            'scripts/list-web-release-files.mjs',
            'scripts/release/desktop-reuse-fallback.mjs',
            'scripts/deploy/verify-control-plane-bundle-closure.mjs',
            'scripts/ops/bounded-deploy-mission.mjs',
            'scripts/ops/canonical-source-preflight.mjs',
            'scripts/ops/execution-policy.mjs',
            'scripts/ops/guarded-control-plane-deploy.mjs',
            'scripts/ops/run-release-qa-isolated.sh',
            'scripts/qa/test-singleflight.mjs',
            'test/account-hosting-deployment.test.ts',
            'test/bounded-deploy-mission.test.ts',
            'test/central-project-authority-deployment.test.ts',
            'test/deployment-foundation.test.ts',
            'test/desktop-release-reuse.test.ts',
            'test/desktop-reuse-fallback.test.ts',
            'test/ecosystem-platform-hardening.test.ts',
            'test/execution-policy.test.mjs',
            'test/identity-convergence-deployment.test.ts',
            'test/migration-sequence-contract.test.ts',
            'test/repository-governance-contract.test.ts',
            'test/source-drift-systemd.test.ts',
            'test/system-coherence-health.test.ts',
            'test/test-singleflight.test.mjs',
            'test/vps-native-core-release.test.ts',
        ];
        if(in_array($path,$platformExact,true))return 'vps-platform';
        if(str_starts_with($path,'deploy/'))return 'vps-platform';
        if(str_starts_with($path,'history/governance-'))return 'vps-platform';
        return 'awh';
    }

    /**
     * Every canonical patch must carry a compact owner-readable change contract.
     * Legacy metadata stays readable in the UI; strict mode is used for new promotions.
     */
    public static function releaseDetailsReady(mixed $notes,bool $strict=false): bool
    {
        if(!is_array($notes)||array_is_list($notes)||($notes['schemaVersion']??null)!==1)return false;
        $summary=$notes['summary']??null;if(!is_array($summary)||array_is_list($summary))return false;
        $total=0;
        foreach(['features','improvements','fixes','internal'] as $key){
            $rows=$summary[$key]??null;if(!is_array($rows)||!array_is_list($rows))return false;
            foreach($rows as $row){if(!is_string($row)||trim($row)===''||strlen($row)>220)return false;$total++;}
        }
        if($total<1)return false;
        $impact=$notes['impact']??null;
        if(!is_array($impact)||array_is_list($impact)||!is_bool($impact['plannedDowntime']??null))return false;
        foreach(['databaseMigration','serviceReload','appRestart','signIn'] as $key)
            if(!is_string($impact[$key]??null)||trim((string)$impact[$key])==='')return false;
        if(!is_array($notes['knownIssues']??null)||!array_is_list($notes['knownIssues']))return false;
        foreach($notes['knownIssues'] as $issue)if(!is_string($issue)||trim($issue)===''||strlen($issue)>220)return false;
        if(!$strict)return true;
        if(($notes['metadataState']??null)!=='READY'||!is_bool($notes['userVisible']??null)||!is_string($notes['ownerSummary']??null)||trim((string)$notes['ownerSummary'])==='')return false;
        $compat=$notes['compatibility']??null;
        if(!is_array($compat)||array_is_list($compat))return false;
        foreach(['data','runtime','authentication'] as $key)
            if(!is_string($compat[$key]??null)||trim((string)$compat[$key])==='')return false;
        $rollback=$notes['rollback']??null;
        if(!is_array($rollback)||array_is_list($rollback)||($rollback['required']??null)!==true||!is_string($rollback['strategy']??null)||trim((string)$rollback['strategy'])==='')return false;
        $previous=strtolower(trim((string)($rollback['sourceSha']??'')));
        return preg_match('/^[0-9a-f]{40}$/',$previous)===1;
    }

    /** @return array{repository:string,directory:string,project:string,projection:bool,kind:string,defaultBranch:string,releaseTrack:string}|null */
    public static function byProjectName(string $name): ?array
    {
        foreach (self::repositories() as $repository=>$row) if ($row['project']===$name) return ['repository'=>$repository]+$row;
        return null;
    }
}


final class HubScopeAuthorizerException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='SCOPE_AUTHORIZATION_FAILED')
    {
        parent::__construct($message);
    }
}

final class HubScopeAuthorizer
{
    public function __construct(private readonly PDO $pdo)
    {
        $this->pdo->exec('PRAGMA foreign_keys=ON');
        $this->pdo->exec('PRAGMA busy_timeout=5000');
    }

    /** @return array<string,mixed> */
    public function issueOrResolve(
        string $missionExecutionId,
        string $projectId,
        string $releaseTrack,
        string $at,
        string $scopeMode='SINGLE_TRACK',
        array $impactedTracks=[]
    ): array {
        $missionExecutionId=self::uuid($missionExecutionId);
        $projectId=self::uuid($projectId);
        $releaseTrack=self::key($releaseTrack);
        if(!in_array($scopeMode,['SINGLE_TRACK','MULTI_TRACK_MAINTENANCE'],true))
            throw new HubScopeAuthorizerException('Scope mode is invalid','SCOPE_MODE_INVALID');

        $track=HubUpdateTargetRegistry::byReleaseTrack($releaseTrack);
        if(!is_array($track))throw new HubScopeAuthorizerException('Release track is not registered','RELEASE_TRACK_SCOPE_VIOLATION');
        $repository=is_string($track['repository']??null)?self::key((string)$track['repository']):'';
        if($repository==='')throw new HubScopeAuthorizerException('Release track has no repository scope','RELEASE_TRACK_SCOPE_VIOLATION');
        $repo=HubUpdateTargetRegistry::repositories()[$repository]??null;
        if(!is_array($repo))throw new HubScopeAuthorizerException('Repository scope is not registered','RELEASE_TRACK_SCOPE_VIOLATION');

        $project=$this->projectByName((string)$repo['project']);
        if(!hash_equals($projectId,(string)$project['project_id']))
            throw new HubScopeAuthorizerException('Mission project does not own requested release track','PROJECT_SCOPE_VIOLATION');

        $row=$this->mission($missionExecutionId,$projectId);
        $checkpoint=self::decodeCheckpoint((string)$row['checkpoint_json']);
        $existing=$checkpoint['scopeEnvelope']??null;
        if(is_array($existing)&&!array_is_list($existing)){
            $this->assertEnvelopeIntegrity($existing);
            if(!hash_equals((string)$existing['projectId'],$projectId))
                throw new HubScopeAuthorizerException('Mission project scope is immutable','PROJECT_SCOPE_VIOLATION');
            if(!hash_equals((string)$existing['releaseTrack'],$releaseTrack))
                throw new HubScopeAuthorizerException('Mission release track scope is immutable','RELEASE_TRACK_SCOPE_VIOLATION');
            return $existing;
        }

        $impacted=array_values(array_unique(array_map([self::class,'key'],$impactedTracks)));
        if($scopeMode==='SINGLE_TRACK')$impacted=[$releaseTrack];
        else{
            if(!in_array($releaseTrack,$impacted,true))$impacted[]=$releaseTrack;
            sort($impacted,SORT_STRING);
            if(count($impacted)<2)throw new HubScopeAuthorizerException('Multi-track maintenance needs explicit impacted tracks','MULTI_TRACK_MAINTENANCE_INVALID');
            foreach($impacted as $candidate){
                $cfg=HubUpdateTargetRegistry::byReleaseTrack($candidate);
                if(!is_array($cfg)||($cfg['repository']??null)!==$repository)
                    throw new HubScopeAuthorizerException('Multi-track maintenance must remain inside one shared repository','RELEASE_TRACK_SCOPE_VIOLATION');
            }
        }

        $allowed=['TRACK:'.$releaseTrack];
        if($scopeMode==='MULTI_TRACK_MAINTENANCE')$allowed[]='SHARED:'.$repository;
        $resource=(string)($track['deployResource']??'CANONICAL:PROJECT');
        $sourceResource='CANONICAL:SOURCE:'.strtoupper(str_replace('-','_',$repository)).':'.strtoupper(str_replace('-','_',$releaseTrack));
        $base=[
            'scopeVersion'=>1,
            'missionExecutionId'=>$missionExecutionId,
            'projectId'=>$projectId,
            'repository'=>$repository,
            'releaseTrack'=>$releaseTrack,
            'packageTrack'=>is_string($track['packageTrack']??null)?(string)$track['packageTrack']:null,
            'allowedPathClasses'=>$allowed,
            'mutationResources'=>array_values(array_unique([$sourceResource,$resource])),
            'deployAdapter'=>is_string($track['deploymentAdapter']??null)?(string)$track['deploymentAdapter']:(in_array($releaseTrack,['awh','vps-platform'],true)?'AWH_CONTROL_PLANE':null),
            'runtimeTarget'=>is_string($track['productionRef']??null)?(string)$track['productionRef']:(is_string($track['domain']??null)?(string)$track['domain']:(is_string($track['packageTrack']??null)?(string)$track['packageTrack']:null)),
            'scopeMode'=>$scopeMode,
            'impactedTracks'=>$impacted,
            'issuedAt'=>self::timestamp($at),
        ];
        $digest=hash('sha256',self::canonicalJson($base));
        $envelope=['scopeId'=>'scope-'.substr($digest,0,32)]+$base+['scopeDigest'=>$digest];
        $checkpoint['scopeEnvelope']=$envelope;

        try{
            $this->pdo->exec('BEGIN IMMEDIATE');
            $fresh=$this->pdo->prepare("SELECT checkpoint_json FROM control_task_executions WHERE execution_id=:execution AND project_id=:project AND required_capability='operator.project_mission' LIMIT 1");
            $fresh->execute(['execution'=>$missionExecutionId,'project'=>$projectId]);
            $current=$fresh->fetchColumn();
            if(!is_string($current))throw new HubScopeAuthorizerException('Mission scope is unavailable','PROJECT_SCOPE_VIOLATION');
            $currentDecoded=self::decodeCheckpoint($current);
            if(is_array($currentDecoded['scopeEnvelope']??null)){
                $this->pdo->exec('ROLLBACK');
                $resolved=$currentDecoded['scopeEnvelope'];$this->assertEnvelopeIntegrity($resolved);
                if(!hash_equals((string)$resolved['releaseTrack'],$releaseTrack))
                    throw new HubScopeAuthorizerException('Mission release track scope is immutable','RELEASE_TRACK_SCOPE_VIOLATION');
                return $resolved;
            }
            $update=$this->pdo->prepare("UPDATE control_task_executions SET checkpoint_json=:checkpoint,updated_at=:at WHERE execution_id=:execution AND project_id=:project AND required_capability='operator.project_mission'");
            $update->execute(['checkpoint'=>json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),'at'=>self::timestamp($at),'execution'=>$missionExecutionId,'project'=>$projectId]);
            if($update->rowCount()!==1)throw new HubScopeAuthorizerException('Mission scope could not be persisted','SCOPE_PERSIST_FAILED');
            $this->pdo->exec('COMMIT');
        }catch(Throwable $error){
            try{$this->pdo->exec('ROLLBACK');}catch(Throwable){}
            if($error instanceof HubScopeAuthorizerException)throw $error;
            throw new HubScopeAuthorizerException('Mission scope could not be persisted','SCOPE_PERSIST_FAILED');
        }
        return $envelope;
    }

    /** @param list<string> $paths */
    public function assertSourceMutation(array $scope,string $repository,string $releaseTrack,array $paths): void
    {
        $this->assertEnvelopeIntegrity($scope);
        $repository=self::key($repository);$releaseTrack=self::key($releaseTrack);
        if(!hash_equals((string)$scope['repository'],$repository))
            throw new HubScopeAuthorizerException('Repository differs from active Mission scope','PROJECT_SCOPE_VIOLATION');
        if(!hash_equals((string)$scope['releaseTrack'],$releaseTrack))
            throw new HubScopeAuthorizerException('Release track differs from active Mission scope','RELEASE_TRACK_SCOPE_VIOLATION');
        $ownership=HubUpdateTargetRegistry::pathOwnership($repository,$paths);
        foreach($ownership['tracks'] as $track)if(!in_array($track,(array)$scope['impactedTracks'],true))
            throw new HubScopeAuthorizerException('Path is owned by another release track','RELEASE_TRACK_SCOPE_VIOLATION');
        if(($ownership['sharedPaths']??[])!==[]&&(string)$scope['scopeMode']!=='MULTI_TRACK_MAINTENANCE')
            throw new HubScopeAuthorizerException('Shared paths require explicit multi-track maintenance scope','REQUIRE_MULTI_TRACK_MAINTENANCE');
    }

    public function readInspectionAllowed(string $activeProjectId,string $requestedProjectId): bool
    {
        self::uuid($activeProjectId);self::uuid($requestedProjectId);
        return true;
    }

    /** @return array<string,mixed> */
    public function forMission(string $missionExecutionId): array
    {
        $missionExecutionId=self::uuid($missionExecutionId);
        $q=$this->pdo->prepare("SELECT checkpoint_json FROM control_task_executions WHERE execution_id=:execution AND required_capability='operator.project_mission' LIMIT 1");
        $q->execute(['execution'=>$missionExecutionId]);$raw=$q->fetchColumn();
        if(!is_string($raw))throw new HubScopeAuthorizerException('Mission scope is unavailable','PROJECT_SCOPE_VIOLATION');
        $checkpoint=self::decodeCheckpoint($raw);$scope=$checkpoint['scopeEnvelope']??null;
        if(!is_array($scope)||array_is_list($scope))throw new HubScopeAuthorizerException('Mission scope is missing','PROJECT_SCOPE_VIOLATION');
        $this->assertEnvelopeIntegrity($scope);return $scope;
    }

    private function mission(string $execution,string $project): array
    {
        $q=$this->pdo->prepare("SELECT execution_id,project_id,checkpoint_json,state,lease_owner FROM control_task_executions WHERE execution_id=:execution AND project_id=:project AND required_capability='operator.project_mission' LIMIT 1");
        $q->execute(['execution'=>$execution,'project'=>$project]);$row=$q->fetch();
        if(!is_array($row)||!in_array((string)$row['state'],['RUNNING','WAITING_FOR_CAPABILITY'],true)||(string)$row['lease_owner']!=='operator-mission')
            throw new HubScopeAuthorizerException('Mission execution cannot own a mutation scope','PROJECT_SCOPE_VIOLATION');
        return $row;
    }

    private function projectByName(string $name): array
    {
        $q=$this->pdo->prepare('SELECT project_id,name FROM projects WHERE name=:name ORDER BY project_id LIMIT 2');
        $q->execute(['name'=>$name]);$rows=$q->fetchAll();
        if(count($rows)!==1)throw new HubScopeAuthorizerException('Release-track project is not unique','PROJECT_SCOPE_VIOLATION');
        return $rows[0];
    }

    /** @param array<string,mixed> $scope */
    private function assertEnvelopeIntegrity(array $scope): void
    {
        foreach(['scopeId','scopeVersion','missionExecutionId','projectId','repository','releaseTrack','allowedPathClasses','mutationResources','scopeMode','issuedAt','scopeDigest'] as $key)
            if(!array_key_exists($key,$scope))throw new HubScopeAuthorizerException('Scope envelope is incomplete','SCOPE_INTEGRITY_FAILED');
        $digest=(string)$scope['scopeDigest'];$copy=$scope;unset($copy['scopeDigest'],$copy['scopeId']);
        if(!preg_match('/^[a-f0-9]{64}$/',$digest)||!hash_equals($digest,hash('sha256',self::canonicalJson($copy)))||!hash_equals((string)$scope['scopeId'],'scope-'.substr($digest,0,32)))
            throw new HubScopeAuthorizerException('Scope envelope digest is invalid','SCOPE_INTEGRITY_FAILED');
    }

    private static function decodeCheckpoint(string $raw): array
    {
        try{$decoded=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(Throwable){$decoded=[];}
        return is_array($decoded)&&!array_is_list($decoded)?$decoded:[];
    }

    private static function canonicalJson(array $value): string
    {
        ksort($value,SORT_STRING);
        foreach($value as $key=>$item)if(is_array($item)&&!array_is_list($item))$value[$key]=json_decode(self::canonicalJson($item),true,32,JSON_THROW_ON_ERROR);
        return json_encode($value,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
    }

    private static function uuid(string $value): string
    {
        $value=strtolower(trim($value));
        if(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',$value)!==1)
            throw new HubScopeAuthorizerException('Scope UUID is invalid','PROJECT_SCOPE_VIOLATION');
        return $value;
    }

    private static function key(string $value): string
    {
        $value=strtolower(trim($value));
        if(preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/',$value)!==1)
            throw new HubScopeAuthorizerException('Scope key is invalid','RELEASE_TRACK_SCOPE_VIOLATION');
        return $value;
    }

    private static function timestamp(string $value): string
    {
        $time=strtotime($value);if($time===false)throw new HubScopeAuthorizerException('Scope time is invalid','SCOPE_INTEGRITY_FAILED');
        return gmdate('c',$time);
    }
}
