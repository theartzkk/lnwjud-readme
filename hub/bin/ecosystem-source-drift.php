<?php

declare(strict_types=1);

if ($argc < 3) {
    fwrite(STDERR, "usage: ecosystem-source-drift.php <database> <git-root> [runtime-release-json]\n");
    exit(64);
}

$db = $argv[1]; $gitRoot = rtrim($argv[2], '/'); $runtime = $argv[3] ?? null;
$pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$rows = $pdo->query("SELECT p.project_id,p.name,p.type,p.canonical_source_authority,p.canonical_source_vault_revision_id,p.canonical_source_content_sha256,v.active_revision_id,v.sync_state,v.file_count,r.state,r.content_sha256 FROM projects p JOIN control_project_vaults v USING(project_id) LEFT JOIN control_project_vault_revisions r ON r.revision_id=v.active_revision_id ORDER BY p.name")->fetchAll();
$repos = ['BAY EXCUSE X'=>'bay-excuse-x.git','BAY Hub'=>'bay-hub.git','BAY LearnLab'=>'bay-learnlab.git','BAY Computer Lab'=>'bay-computer-lab.git','เว็บไซต์โรงเรียน'=>'school-website.git'];
$projectClass = static function(array $row): string {
    $name=(string)($row['name']??''); $type=(string)($row['type']??'general');
    if (preg_match('/(?:field\s*proof|หลักฐานภาคสนาม)/iu',$name)===1) return 'FIELD_PROOF';
    if ($type==='teacher-evaluation') return 'CONTENT';
    return 'PRODUCTION';
};
$findings = [];
$pending = [];
$activeProjects = [];
try {
    $activeRows = $pdo->query("SELECT DISTINCT project_id FROM control_task_executions WHERE state IN ('LEASED','RUNNING') AND required_capability<>'operator.project_mission' AND (lease_expires_at IS NULL OR datetime(lease_expires_at)>datetime('now'))")->fetchAll();
    foreach ($activeRows as $activeRow) $activeProjects[(string)$activeRow['project_id']] = true;
} catch (Throwable) {
    $activeProjects = [];
}
foreach ($rows as $row) {
    $name=(string)$row['name'];
    if ($projectClass($row)!=='PRODUCTION') continue;
    $vault=(string)$row['active_revision_id']; $sha=strtolower((string)$row['content_sha256']);
    $authorityFindings=[];
    if (($row['canonical_source_authority']??null)!=='AWH_VAULT') $authorityFindings[]="$name: authority is not AWH_VAULT";
    if (($row['sync_state']??null)!=='SYNCED' || ($row['state']??null)!=='ACTIVE') $authorityFindings[]="$name: Vault is not SYNCED/ACTIVE";
    if (!hash_equals(strtolower((string)$row['canonical_source_vault_revision_id']),strtolower($vault))) $authorityFindings[]="$name: canonical Vault revision drift";
    if (!hash_equals(strtolower((string)$row['canonical_source_content_sha256']),$sha)) $authorityFindings[]="$name: canonical content hash drift";
    if ($authorityFindings!==[]) {
        if (isset($activeProjects[(string)$row['project_id']])) {
            foreach ($authorityFindings as $item) $pending[]=$item.' (active mutation)';
        } else {
            array_push($findings,...$authorityFindings);
        }
    }
    if (!isset($repos[$name])) continue;
    $repo=$gitRoot.'/'.$repos[$name];
    if (!is_dir($repo)) {
        $item="$name: VPS Git projection missing";
        if (isset($activeProjects[(string)$row['project_id']])) $pending[]=$item.' (active mutation)'; else $findings[]=$item;
        continue;
    }
    $head=trim((string)shell_exec('git --git-dir='.escapeshellarg($repo).' rev-parse refs/heads/main 2>/dev/null'));
    if (!preg_match('/^[0-9a-f]{40}$/',$head)) {
        $item="$name: projection main is unresolved";
        if (isset($activeProjects[(string)$row['project_id']])) $pending[]=$item.' (active mutation)'; else $findings[]=$item;
        continue;
    }
    $body=(string)shell_exec('git --git-dir='.escapeshellarg($repo).' show -s --format=%B '.escapeshellarg($head).' 2>/dev/null');
    $projectionFindings=[];
    if (!str_contains($body,"Vault-Revision: $vault")) $projectionFindings[]="$name: projection Vault revision drift";
    if (!str_contains($body,"Content-SHA256: $sha")) $projectionFindings[]="$name: projection content hash drift";
    if (!str_contains($body,'Authority: AWH_VAULT') || !str_contains($body,'Projection: true')) $projectionFindings[]="$name: projection provenance missing";
    $count=(int)trim((string)shell_exec('git --git-dir='.escapeshellarg($repo).' ls-tree -r --name-only '.escapeshellarg($head).' 2>/dev/null | wc -l'));
    if ($count!==(int)$row['file_count']) $projectionFindings[]="$name: projection file-count drift ($count != {$row['file_count']})";
    if ($projectionFindings!==[]) {
        if (isset($activeProjects[(string)$row['project_id']])) {
            foreach ($projectionFindings as $item) $pending[]=$item.' (active mutation)';
        } else {
            array_push($findings,...$projectionFindings);
        }
    }
}
if (is_string($runtime) && $runtime!=='') {
    $manifest=json_decode((string)@file_get_contents($runtime),true);
    $awh=$gitRoot.'/awh.git';
    $runtimeProduction=is_dir($awh)?trim((string)shell_exec('git --git-dir='.escapeshellarg($awh).' rev-parse refs/heads/runtime/production 2>/dev/null')):'';
    $legacyProduction=is_dir($awh)?trim((string)shell_exec('git --git-dir='.escapeshellarg($awh).' rev-parse refs/heads/production 2>/dev/null')):'';
    $platformProduction=is_dir($awh)?trim((string)shell_exec('git --git-dir='.escapeshellarg($awh).' rev-parse refs/heads/platform/production 2>/dev/null')):'';
    if (!preg_match('/^[0-9a-f]{40}$/',$runtimeProduction) && preg_match('/^[0-9a-f]{40}$/',$legacyProduction)) $runtimeProduction=$legacyProduction;
    $main=is_dir($awh)?trim((string)shell_exec('git --git-dir='.escapeshellarg($awh).' rev-parse refs/heads/main 2>/dev/null')):'';
    $source=is_array($manifest)?strtolower((string)($manifest['sourceSha']??'')):'';
    $releaseId=is_array($manifest)?(string)($manifest['releaseId']??''):'';
    $controlManifestPath=getenv('AWH_CONTROL_RELEASE_MANIFEST');
    if(!is_string($controlManifestPath)||$controlManifestPath==='')$controlManifestPath=str_starts_with($runtime,'/var/www/awh-web/')?'/opt/awh-hub/control-plane-current/dist-web/release.json':$runtime;
    $controlManifest=json_decode((string)@file_get_contents($controlManifestPath),true);
    $controlSource=is_array($controlManifest)?strtolower((string)($controlManifest['sourceSha']??'')):'';
    $intentionalPlatformWebSplit=false;
    if(preg_match('/^[0-9a-f]{40}$/',$source)===1&&preg_match('/^[0-9a-f]{40}$/',$runtimeProduction)===1&&preg_match('/^[0-9a-f]{40}$/',$controlSource)===1&&preg_match('/^[0-9a-f]{40}$/',$platformProduction)===1&&preg_match('/^[0-9a-f]{40}$/',$legacyProduction)===1&&!hash_equals($source,strtolower($runtimeProduction))&&hash_equals($controlSource,strtolower($runtimeProduction))&&hash_equals(strtolower($platformProduction),strtolower($runtimeProduction))&&hash_equals(strtolower($legacyProduction),$source)){
        $splitBase=trim((string)shell_exec('git --git-dir='.escapeshellarg($awh).' merge-base '.escapeshellarg($source).' '.escapeshellarg($runtimeProduction).' 2>/dev/null'));
        $intentionalPlatformWebSplit=preg_match('/^[0-9a-f]{40}$/',$splitBase)===1&&hash_equals(strtolower($splitBase),$source);
        if($intentionalPlatformWebSplit)$pending[]='AWH web intentionally behind VPS Platform runtime';
    }
    $manifestFiles=[];
    if (is_array($manifest['files']??null)) foreach ($manifest['files'] as $entry) {
        if (is_array($entry) && is_string($entry['path']??null) && is_string($entry['sha256']??null)) $manifestFiles[(string)$entry['path']]=strtolower((string)$entry['sha256']);
    }
    if (preg_match('/^[0-9a-f]{40}$/',$source)===1 && preg_match('/^[A-Za-z0-9._-]{1,80}$/',$releaseId)===1) {
        $runtimeRoot=dirname($runtime);
        foreach (['updates.html'=>'web/updates.html','updates.js'=>'web/updates.js','control-plane-adapter.js'=>'web/control-plane-adapter.js'] as $asset=>$sourcePath) {
            $sourceBody=(string)shell_exec('git --git-dir='.escapeshellarg($awh).' show '.escapeshellarg($source.':'.$sourcePath).' 2>/dev/null');
            $declared=$manifestFiles[$asset]??'';
            $livePath=$runtimeRoot.'/'.$asset;
            $liveHash=is_file($livePath)?strtolower((string)@hash_file('sha256',$livePath)):'';
            if ($sourceBody==='') {$findings[]="AWH web source provenance unavailable: $asset";continue;}
            $expectedHash=hash('sha256',str_replace('__AWH_WEB_RELEASE_ID__',$releaseId,$sourceBody));
            if (!preg_match('/^[0-9a-f]{64}$/',$declared) || !hash_equals($expectedHash,$declared)) $findings[]="AWH web source provenance drift: $asset";
            if (!preg_match('/^[0-9a-f]{64}$/',$liveHash) || !hash_equals($declared,$liveHash)) $findings[]="AWH web runtime/manifest drift: $asset";
        }
    }
    if (!preg_match('/^[0-9a-f]{40}$/',$controlSource) || !preg_match('/^[0-9a-f]{40}$/',$runtimeProduction) || !hash_equals($controlSource,strtolower($runtimeProduction))) $findings[]='AWH runtime/Git runtime-production drift';
    if (preg_match('/^[0-9a-f]{40}$/',$source)!==1 || preg_match('/^[0-9a-f]{40}$/',$runtimeProduction)!==1 || (!hash_equals($source,strtolower($runtimeProduction))&&!$intentionalPlatformWebSplit)) $findings[]='AWH web/runtime production drift';
    if (!preg_match('/^[0-9a-f]{40}$/',$main) || !preg_match('/^[0-9a-f]{40}$/',$runtimeProduction)) {
        $findings[]='AWH main/runtime production authority unresolved';
    } elseif (!hash_equals(strtolower($main),strtolower($runtimeProduction))) {
        $mergeBase=trim((string)shell_exec('git --git-dir='.escapeshellarg($awh).' merge-base '.escapeshellarg($runtimeProduction).' '.escapeshellarg($main).' 2>/dev/null'));
        if (preg_match('/^[0-9a-f]{40}$/',$mergeBase) && hash_equals(strtolower($mergeBase),strtolower($runtimeProduction))) $pending[]='AWH canonical main ahead of runtime production';
        else $findings[]='AWH main/runtime production divergence';
    }
    if (preg_match('/^[0-9a-f]{40}$/',$runtimeProduction)) {
        $policy=(string)shell_exec('git --git-dir='.escapeshellarg($awh).' show '.escapeshellarg($runtimeProduction).':hub/src/HubCapabilityRegistryService.php 2>/dev/null');
        $protocol=(string)shell_exec('git --git-dir='.escapeshellarg($awh).' show '.escapeshellarg($runtimeProduction).':ART_AI_WORKING_PROTOCOL.md 2>/dev/null');
        if (!str_contains($policy,"'mode'=>'CONTEXT_ONLY'") || !str_contains($policy,"'enforcement'=>'ADVISORY'")) $findings[]='AWH execution context runtime drift';
        if (!str_contains($protocol,'# AWH Working Context') || !str_contains($protocol,'Mode: context-only')) $findings[]='AWH working context drift';
    }
}

$governanceRepositories = 0;
$governanceContract = null;
$awhRepository = $gitRoot . '/awh.git';
$contractPath = dirname(__DIR__, 2) . '/config/repository-governance-contract.json';
$raw = is_file($contractPath) ? (string) file_get_contents($contractPath) : '';
if ($raw === '' && is_dir($awhRepository)) {
    $raw = (string) shell_exec('git --git-dir=' . escapeshellarg($awhRepository) . ' show refs/heads/runtime/production:config/repository-governance-contract.json 2>/dev/null');
    if ($raw === '') $raw = (string) shell_exec('git --git-dir=' . escapeshellarg($awhRepository) . ' show refs/heads/production:config/repository-governance-contract.json 2>/dev/null');
}
if ($raw === '') {
    $findings[] = 'Repository governance contract is unavailable from immutable release and AWH production source';
} else {
    try {
        $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($decoded) || array_is_list($decoded) || ($decoded['schemaVersion'] ?? null) !== 1) throw new RuntimeException('invalid repository governance contract');
        $governanceContract = $decoded;
    } catch (Throwable) {
        $findings[] = 'Repository governance contract is invalid';
    }
}
$continuousPolicy = null;
$continuousPolicyPath = dirname(__DIR__, 2) . '/config/continuous-improvement-policy.json';
$continuousRaw = is_file($continuousPolicyPath) ? (string) file_get_contents($continuousPolicyPath) : '';
if ($continuousRaw === '' && is_dir($awhRepository)) {
    $continuousRaw = (string) shell_exec('git --git-dir=' . escapeshellarg($awhRepository) . ' show refs/heads/runtime/production:config/continuous-improvement-policy.json 2>/dev/null');
    if ($continuousRaw === '') $continuousRaw = (string) shell_exec('git --git-dir=' . escapeshellarg($awhRepository) . ' show refs/heads/production:config/continuous-improvement-policy.json 2>/dev/null');
}
if ($continuousRaw === '') {
    $findings[] = 'AWH continuous-improvement policy is unavailable from immutable release and runtime production source';
} else {
    try {
        $decoded = json_decode($continuousRaw, true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($decoded) || array_is_list($decoded)
            || ($decoded['schemaVersion'] ?? null) !== 1
            || ($decoded['authority'] ?? null) !== 'AWH_CONTINUOUS_IMPROVEMENT'
            || ($decoded['lessonPromotion']['state'] ?? null) !== 'ENFORCED'
            || ($decoded['projectBaseline']['policyInheritanceByRegistry'] ?? null) !== true
            || ($decoded['invariants']['sharedCauseFixedAtHighestSharedLayer'] ?? null) !== true
            || ($decoded['invariants']['unverifiedAutonomousPolicyMutationForbidden'] ?? null) !== true) {
            throw new RuntimeException('invalid continuous-improvement policy');
        }
        $continuousPolicy = $decoded;
    } catch (Throwable) {
        $findings[] = 'AWH continuous-improvement policy is invalid';
    }
}
if (is_array($governanceContract)) {
    $enforcementMode = strtoupper(trim((string)($governanceContract['enforcementMode'] ?? 'ENFORCED')));
    if (!in_array($enforcementMode,['ROLLOUT','ENFORCED'],true)) {$findings[]='Repository governance enforcement mode is invalid';$enforcementMode='ENFORCED';}
    $rules = is_array($governanceContract['rules'] ?? null) ? $governanceContract['rules'] : [];
    if (($rules['continuousImprovementAuthority'] ?? null) !== 'AWH_CONTINUOUS_IMPROVEMENT'
        || ($rules['continuousImprovementPolicyPath'] ?? null) !== 'config/continuous-improvement-policy.json'
        || ($rules['policyInheritanceByRegistry'] ?? null) !== true
        || ($rules['existingAndFutureManagedRepositoriesInheritGlobalPolicy'] ?? null) !== true
        || !is_array($continuousPolicy)) {
        $findings[] = 'Repository governance continuous-improvement inheritance drift';
    }
    $managed = is_array($governanceContract['repositories'] ?? null) ? $governanceContract['repositories'] : [];
    $requiredAgent = is_string($rules['requiredAgentEntrypoint'] ?? null) ? (string)$rules['requiredAgentEntrypoint'] : 'AGENTS.md';
    $manifestPath = is_string($rules['projectManifestPath'] ?? null) ? (string)$rules['projectManifestPath'] : '.awh/project.json';
    $forbidden = is_array($rules['forbiddenAuthorityBasenames'] ?? null) ? $rules['forbiddenAuthorityBasenames'] : [];
    $mutablePatterns = is_array($rules['mutableFactPatterns'] ?? null) ? $rules['mutableFactPatterns'] : [];
    $projectByName = [];
    foreach ($rows as $row) $projectByName[(string)$row['name']] = (string)$row['project_id'];
    $recordGovernanceFinding = static function(string $message, ?string $projectId) use (&$findings,&$pending,$activeProjects,$enforcementMode): void {
        if ($enforcementMode==='ROLLOUT') {$pending[]=$message.' (governance rollout)';return;}
        if (is_string($projectId) && $projectId !== '' && isset($activeProjects[$projectId])) {$pending[]=$message.' (active mutation)';return;}
        $findings[]=$message;
    };
    foreach ($managed as $key=>$cfg) {
        if (!is_string($key)||!is_array($cfg)||array_is_list($cfg)) {$findings[]='Repository governance entry is invalid';continue;}
        $governanceRepositories++;
        $directory=is_string($cfg['directory']??null)?(string)$cfg['directory']:'';
        $branch=is_string($cfg['canonicalBranch']??null)?(string)$cfg['canonicalBranch']:'main';
        $defaultHead=is_string($cfg['defaultHead']??null)?(string)$cfg['defaultHead']:$branch;
        $projectName=is_string($cfg['project']??null)?(string)$cfg['project']:null;
        $expectedProjectId=is_string($cfg['projectId']??null)?strtolower((string)$cfg['projectId']):null;
        $requireManifest=($cfg['requireProjectManifest']??false)===true;
        $contextFiles=is_array($cfg['contextFiles']??null)?$cfg['contextFiles']:[];
        $projectId=$projectName!==null?($projectByName[$projectName]??null):null;
        $label=$projectName??$key;
        if ($directory===''||preg_match('/^[a-z0-9][a-z0-9.-]*\.git$/',$directory)!==1) {$recordGovernanceFinding("$label: governance repository directory is invalid",$projectId);continue;}
        $repo=$gitRoot.'/'.$directory;
        if (!is_dir($repo)||is_link($repo)) {$recordGovernanceFinding("$label: governed repository is unavailable",$projectId);continue;}
        $sha=trim((string)shell_exec('git --git-dir='.escapeshellarg($repo).' rev-parse '.escapeshellarg('refs/heads/'.$branch).' 2>/dev/null'));
        if (preg_match('/^[0-9a-f]{40}$/',$sha)!==1) {$recordGovernanceFinding("$label: canonical governance branch is unresolved",$projectId);continue;}
        $symbolic=trim((string)shell_exec('git --git-dir='.escapeshellarg($repo).' symbolic-ref HEAD 2>/dev/null'));
        if ($symbolic!=='refs/heads/'.$defaultHead) $recordGovernanceFinding("$label: default HEAD drift ($symbolic != refs/heads/$defaultHead)",$projectId);
        $agent=(string)shell_exec('git --git-dir='.escapeshellarg($repo).' show '.escapeshellarg($sha.':'.$requiredAgent).' 2>/dev/null');
        if ($agent==='') $recordGovernanceFinding("$label: $requiredAgent is missing",$projectId);
        $tree=array_values(array_filter(preg_split('/\R/',(string)shell_exec('git --git-dir='.escapeshellarg($repo).' ls-tree -r --name-only '.escapeshellarg($sha).' 2>/dev/null'))?:[],static fn(string $v):bool=>$v!==''));
        foreach ($tree as $path) if (in_array(basename($path),$forbidden,true)) $recordGovernanceFinding("$label: forbidden parallel authority file $path",$projectId);
        if ($projectName!==null) {
            if (!is_string($projectId)||preg_match('/^[0-9a-f-]{36}$/i',$projectId)!==1) $recordGovernanceFinding("$label: Project Registry identity is unavailable",null);
            elseif (!is_string($expectedProjectId)||!hash_equals(strtolower($projectId),$expectedProjectId)) $recordGovernanceFinding("$label: governance contract project id drift",$projectId);
        }
        if ($requireManifest) {
            $manifestRaw=(string)shell_exec('git --git-dir='.escapeshellarg($repo).' show '.escapeshellarg($sha.':'.$manifestPath).' 2>/dev/null');
            try {$manifest=json_decode($manifestRaw,true,16,JSON_THROW_ON_ERROR);} catch (Throwable) {$manifest=null;}
            if (!is_array($manifest)||array_is_list($manifest)) $recordGovernanceFinding("$label: project manifest is missing or invalid",$projectId);
            else {
                $manifestId=strtolower(trim((string)($manifest['projectId']??'')));
                $manifestName=trim((string)($manifest['name']??''));
                if (!is_string($expectedProjectId)||!hash_equals($manifestId,$expectedProjectId)) $recordGovernanceFinding("$label: project manifest id drift",$projectId);
                if ($projectName!==null&&$manifestName!==$projectName) $recordGovernanceFinding("$label: project manifest name drift",$projectId);
            }
        }
        foreach ($contextFiles as $path=>$role) {
            if (!is_string($path)||!is_string($role)||$path===''||$role==='') {$recordGovernanceFinding("$label: context file contract is invalid",$projectId);continue;}
            $body=(string)shell_exec('git --git-dir='.escapeshellarg($repo).' show '.escapeshellarg($sha.':'.$path).' 2>/dev/null');
            if ($body==='') {$recordGovernanceFinding("$label: context file $path is missing",$projectId);continue;}
            if (!str_contains($body,'Document role: '.$role)) $recordGovernanceFinding("$label: context file $path role drift",$projectId);
            foreach ($mutablePatterns as $pattern) {
                if (!is_string($pattern)||$pattern==='') continue;
                $matched=@preg_match('~'.$pattern.'~iu',$body);
                if ($matched===1) {$recordGovernanceFinding("$label: context file $path contains mutable live-state prose",$projectId);break;}
                if ($matched===false) {$findings[]='Repository governance mutable-fact pattern is invalid';break;}
            }
        }
    }
}
$platformBlockingFindings=array_values(array_filter($findings,static fn(string $item):bool=>
    str_starts_with($item,'AWH ')
    || str_starts_with($item,'Art’s Workspace Hub:')
    || str_starts_with($item,'Repository governance ')
));
$externalFindings=array_values(array_filter($findings,static fn(string $item):bool=>!in_array($item,$platformBlockingFindings,true)));
$state=$findings!==[]?'BLOCKED':($pending!==[]?'PENDING_RELEASE':'SYNCED');
$result=['schemaVersion'=>2,'ok'=>$findings===[],'state'=>$state,'projects'=>count($rows),'projectionRepos'=>count($repos),'governanceRepositories'=>$governanceRepositories,'governanceEnforcement'=>$governanceContract['enforcementMode']??null,'continuousImprovementAuthority'=>$continuousPolicy['authority']??null,'continuousImprovementState'=>$continuousPolicy['lessonPromotion']['state']??null,'findings'=>$findings,'platformBlockingFindings'=>$platformBlockingFindings,'externalFindings'=>$externalFindings,'pending'=>$pending];
echo json_encode($result,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE).PHP_EOL;
exit($findings===[]?0:2);
