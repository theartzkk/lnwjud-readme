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
                'versionPrefix'=>'Platform','ownerApprovalRequired'=>true,'hostGlobal'=>true,'visibility'=>'PRIMARY',
            ],
            'awh'=>[
                'name'=>'AWH','kind'=>'CORE','repository'=>'awh',
                'sourceRef'=>'refs/heads/main','productionRef'=>'refs/heads/production',
                'capability'=>'system.core.release','deployResource'=>'CANONICAL:DEPLOY:AWH',
                'versionPrefix'=>'AWH','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'awh-agent'=>[
                'name'=>'AWH Agent','kind'=>'AGENT','repository'=>'awh-local-agent',
                'sourceRef'=>'refs/heads/main','productionRef'=>'refs/heads/main',
                'capability'=>'system.agent.release','deployResource'=>'CANONICAL:DEPLOY:AWH_AGENT',
                'versionPrefix'=>'Agent','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'awh-line-gateway'=>[
                'name'=>'AWH LINE OA / KRUART LINE Gateway','kind'=>'INTEGRATION','repository'=>null,
                'sourceAuthority'=>'AWH_VAULT','projectId'=>'124ae148-3ed1-4e45-8f50-75ff45a39e5c',
                'siteId'=>'ed911e13-ccfa-44d9-8214-6425cb252240','domain'=>'line.kruart.online',
                'healthPath'=>'/healthz','webhookPath'=>'/webhook','secretScope'=>'KRUART_LINE_GATEWAY',
                'productionRef'=>null,'capability'=>'hosting.site.deploy','deployResource'=>'RESOURCE:HOSTING',
                'versionPrefix'=>'LINE Gateway','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-excuse-x'=>[
                'name'=>'BAY EXCUSE X','kind'=>'SYSTEM','repository'=>'bay-excuse-x',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,'packageTrack'=>'bay-excuse-core',
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:BAY_EXCUSE',
                'versionPrefix'=>'BAY','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'line-oa'=>[
                'name'=>'BAY Excuse LINE OA','kind'=>'INTEGRATION','repository'=>'bay-excuse-x',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,'packageTrack'=>'line-oa',
                'secretScope'=>'BAY_EXCUSE_LINE_OA',
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:LINE_OA',
                'versionPrefix'=>'BAY LINE','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-cooperative'=>[
                'name'=>'ศูนย์งานสหกรณ์โรงเรียน','kind'=>'PRODUCT','repository'=>'bay-excuse-x',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,'packageTrack'=>'cooperative-center',
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:BAY_COOPERATIVE',
                'versionPrefix'=>'Cooperative','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-pp'=>[
                'name'=>'ศูนย์ ปพ.','kind'=>'PRODUCT','repository'=>'bay-excuse-x',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,'packageTrack'=>'pp-center',
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:BAY_PP',
                'versionPrefix'=>'PP','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-assessment'=>[
                'name'=>'BAY Assessment','kind'=>'PRODUCT','repository'=>'bay-assessment',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'system.assessment.release','deployResource'=>'CANONICAL:DEPLOY:BAY_ASSESSMENT',
                'versionPrefix'=>'Assessment','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-learnlab'=>[
                'name'=>'BAY LearnLab','kind'=>'PRODUCT','repository'=>'bay-learnlab',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'system.learnlab.release','deployResource'=>'CANONICAL:DEPLOY:BAY_LEARNLAB',
                'versionPrefix'=>'LearnLab','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-computer-lab'=>[
                'name'=>'BAY Computer Lab','kind'=>'SYSTEM','repository'=>'bay-computer-lab',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'bay.remote_update.install','deployResource'=>'CANONICAL:DEPLOY:PROJECT',
                'versionPrefix'=>'Computer Lab','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'school-website'=>[
                'name'=>'School Website','kind'=>'HOSTING','repository'=>'school-website',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'project.mutate.deploy','deployResource'=>'CANONICAL:DEPLOY:PROJECT',
                'versionPrefix'=>'School','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'PRIMARY',
            ],
            'bay-hub'=>[
                'name'=>'BAY Hub','kind'=>'HUB','repository'=>'bay-hub',
                'sourceRef'=>'refs/heads/main','productionRef'=>null,
                'capability'=>'project.mutate.deploy','deployResource'=>'CANONICAL:DEPLOY:PROJECT',
                'versionPrefix'=>'Hub','ownerApprovalRequired'=>true,'hostGlobal'=>false,'visibility'=>'ADVANCED',
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
        return count($tracks)===1?(string)array_key_first($tracks):null;
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
            'config/ecosystem-release-contract.json',
            'config/execution-policy.json',
            'config/repository-governance-contract.json',
            'docs/AWH-AUTHORITY-MAP.md',
            'docs/AWH_OPERATOR_BRIDGE.md',
            'docs/AWH_SUSTAINABILITY_CONTRACT.md',
            'docs/OPERATIONS.md',
            'docs/RELEASE.md',
            'hub/bin/ecosystem-source-drift.php',
            'hub/src/HubCapabilityRegistryService.php',
            'hub/src/HubCoreReleaseOperator.php',
            'hub/src/HubCoreReleaseService.php',
            'hub/src/HubDeployExecutionAuthorityService.php',
            'hub/src/HubOperatorBridgeService.php',
            'hub/src/HubTrustPolicy.php',
            'hub/src/HubUpdateTargetRegistry.php',
            'hub/tests/assessment-release-operator.php',
            'hub/tests/core-release-operator.php',
            'hub/tests/deploy-execution-authority.php',
            'hub/tests/execution-resource-policy.php',
            'hub/tests/learnlab-release-operator.php',
            'hub/tests/m13-anywhere-execution.php',
            'hub/tests/operator-bridge.php',
            'scripts/deploy/verify-control-plane-bundle-closure.mjs',
            'scripts/ops/bounded-deploy-mission.mjs',
            'scripts/ops/canonical-source-preflight.mjs',
            'scripts/ops/execution-policy.mjs',
            'scripts/ops/guarded-control-plane-deploy.mjs',
            'scripts/qa/test-singleflight.mjs',
            'test/account-hosting-deployment.test.ts',
            'test/central-project-authority-deployment.test.ts',
            'test/ecosystem-platform-hardening.test.ts',
            'test/execution-policy.test.mjs',
            'test/identity-convergence-deployment.test.ts',
            'test/repository-governance-contract.test.ts',
            'test/source-drift-systemd.test.ts',
            'test/test-singleflight.test.mjs',
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
