<?php

declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubVerificationIntelligence.php';

function vi_assert(bool $condition,string $message):void{if(!$condition)throw new RuntimeException($message);}

$low=HubVerificationIntelligence::plan(['docs/README.md']);
vi_assert($low['riskLevel']==='LOW'&&$low['budget']==='FAST','docs-only change must stay FAST');

$medium=HubVerificationIntelligence::plan(['web/styles.css']);
vi_assert($medium['riskLevel']==='MEDIUM'&&$medium['budget']==='STANDARD','web surface must use STANDARD');
vi_assert(in_array('public-shell',$medium['goldenJourneys'],true),'web surface must require public-shell journey');

$critical=HubVerificationIntelligence::plan(['hub/src/HubVerificationGate.php','deploy/awh-control-plane/deploy-control-plane.sh']);
vi_assert($critical['riskLevel']==='CRITICAL'&&$critical['budget']==='DEEP','verification/deploy authority must use DEEP');
vi_assert(in_array('repeat-regression',$critical['requiredChecks'],true),'DEEP must repeat regression');
vi_assert(in_array('database-integrity',$critical['requiredChecks'],true),'DEEP must require DB integrity proof');
vi_assert(in_array('vault-source-authority',$critical['goldenJourneys'],true),'verification changes must prove Vault/source authority');

$stable=HubVerificationIntelligence::stability(['PASS','PASS']);
vi_assert($stable['status']==='PASS'&&$stable['samples']===2,'two passes must be stable');
$flaky=HubVerificationIntelligence::stability(['PASS','FAIL']);
vi_assert($flaky['status']==='UNSTABLE','mixed outcomes must be UNSTABLE');
$failed=HubVerificationIntelligence::stability(['FAIL','FAIL']);
vi_assert($failed['status']==='FAIL','repeated failures must remain FAIL');

$a=HubVerificationIntelligence::incident('MISSION_QA_FAILED',['releaseSha'=>'abc','phase'=>'qa']);
$b=HubVerificationIntelligence::incident('MISSION_QA_FAILED',['phase'=>'qa','releaseSha'=>'abc']);
vi_assert($a['fingerprint']===$b['fingerprint'],'incident fingerprint must be deterministic');
vi_assert(str_starts_with($a['regressionId'],'reg-')&&$a['required']===true,'incident must produce a required regression case');

fwrite(STDOUT,"AWH Verification Intelligence: PASS\n");
