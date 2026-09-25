<?php

declare(strict_types=1);

if ($argc < 3) {
    fwrite(STDERR, "usage: ecosystem-source-drift.php <database> <git-root> [runtime-release-json]\n");
    exit(64);
}

$db = $argv[1]; $gitRoot = rtrim($argv[2], '/'); $runtime = $argv[3] ?? null;
$pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$rows = $pdo->query("SELECT p.project_id,p.name,p.canonical_source_authority,p.canonical_source_vault_revision_id,p.canonical_source_content_sha256,v.active_revision_id,v.sync_state,v.file_count,r.state,r.content_sha256 FROM projects p JOIN control_project_vaults v USING(project_id) LEFT JOIN control_project_vault_revisions r ON r.revision_id=v.active_revision_id ORDER BY p.name")->fetchAll();
$repos = ['BAY EXCUSE X'=>'bay-excuse-x.git','BAY Hub'=>'bay-hub.git','BAY LearnLab'=>'bay-learnlab.git','เว็บไซต์โรงเรียน'=>'school-website.git'];
$findings = [];
$pending = [];
foreach ($rows as $row) {
    $name=(string)$row['name']; $vault=(string)$row['active_revision_id']; $sha=strtolower((string)$row['content_sha256']);
    if (($row['canonical_source_authority']??null)!=='AWH_VAULT') $findings[]="$name: authority is not AWH_VAULT";
    if (($row['sync_state']??null)!=='SYNCED' || ($row['state']??null)!=='ACTIVE') $findings[]="$name: Vault is not SYNCED/ACTIVE";
    if (!hash_equals(strtolower((string)$row['canonical_source_vault_revision_id']),strtolower($vault))) $findings[]="$name: canonical Vault revision drift";
    if (!hash_equals(strtolower((string)$row['canonical_source_content_sha256']),$sha)) $findings[]="$name: canonical content hash drift";
    if (!isset($repos[$name])) continue;
    $repo=$gitRoot.'/'.$repos[$name];
    if (!is_dir($repo)) { $findings[]="$name: VPS Git projection missing"; continue; }
    $head=trim((string)shell_exec('git --git-dir='.escapeshellarg($repo).' rev-parse refs/heads/main 2>/dev/null'));
    if (!preg_match('/^[0-9a-f]{40}$/',$head)) { $findings[]="$name: projection main is unresolved"; continue; }
    $body=(string)shell_exec('git --git-dir='.escapeshellarg($repo).' show -s --format=%B '.escapeshellarg($head).' 2>/dev/null');
    if (!str_contains($body,"Vault-Revision: $vault")) $findings[]="$name: projection Vault revision drift";
    if (!str_contains($body,"Content-SHA256: $sha")) $findings[]="$name: projection content hash drift";
    if (!str_contains($body,'Authority: AWH_VAULT') || !str_contains($body,'Projection: true')) $findings[]="$name: projection provenance missing";
    $count=(int)trim((string)shell_exec('git --git-dir='.escapeshellarg($repo).' ls-tree -r --name-only '.escapeshellarg($head).' 2>/dev/null | wc -l'));
    if ($count!==(int)$row['file_count']) $findings[]="$name: projection file-count drift ($count != {$row['file_count']})";
}
if (is_string($runtime) && $runtime!=='') {
    $manifest=json_decode((string)@file_get_contents($runtime),true);
    $awh=$gitRoot.'/awh.git';
    $production=is_dir($awh)?trim((string)shell_exec('git --git-dir='.escapeshellarg($awh).' rev-parse refs/heads/production 2>/dev/null')):'';
    $main=is_dir($awh)?trim((string)shell_exec('git --git-dir='.escapeshellarg($awh).' rev-parse refs/heads/main 2>/dev/null')):'';
    $source=is_array($manifest)?strtolower((string)($manifest['sourceSha']??'')):'';
    if (!preg_match('/^[0-9a-f]{40}$/',$source) || !preg_match('/^[0-9a-f]{40}$/',$production) || !hash_equals($source,strtolower($production))) $findings[]='AWH runtime/Git production drift';
    if (!preg_match('/^[0-9a-f]{40}$/',$main) || !preg_match('/^[0-9a-f]{40}$/',$production)) {
        $findings[]='AWH main/production authority unresolved';
    } elseif (!hash_equals(strtolower($main),strtolower($production))) {
        $mergeBase=trim((string)shell_exec('git --git-dir='.escapeshellarg($awh).' merge-base '.escapeshellarg($production).' '.escapeshellarg($main).' 2>/dev/null'));
        if (preg_match('/^[0-9a-f]{40}$/',$mergeBase) && hash_equals(strtolower($mergeBase),strtolower($production))) $pending[]='AWH main ahead of production';
        else $findings[]='AWH main/production divergence';
    }
    if (preg_match('/^[0-9a-f]{40}$/',$production)) {
        $policy=(string)shell_exec('git --git-dir='.escapeshellarg($awh).' show '.escapeshellarg($production).':hub/src/HubCapabilityRegistryService.php 2>/dev/null');
        $protocol=(string)shell_exec('git --git-dir='.escapeshellarg($awh).' show '.escapeshellarg($production).':ART_AI_WORKING_PROTOCOL.md 2>/dev/null');
        if (!str_contains($policy,"'mode'=>'CONTEXT_ONLY'") || !str_contains($policy,"'enforcement'=>'ADVISORY'")) $findings[]='AWH execution context runtime drift';
        if (!str_contains($protocol,'# AWH Working Context') || !str_contains($protocol,'Mode: context-only')) $findings[]='AWH working context drift';
    }
}
$state=$findings!==[]?'BLOCKED':($pending!==[]?'PENDING_RELEASE':'SYNCED');
$result=['schemaVersion'=>1,'ok'=>$findings===[],'state'=>$state,'projects'=>count($rows),'projectionRepos'=>count($repos),'findings'=>$findings,'pending'=>$pending];
echo json_encode($result,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE).PHP_EOL;
exit($findings===[]?0:2);
