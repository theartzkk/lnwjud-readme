<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubVerificationGate.php';

function vg_assert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pass = HubVerificationGate::evaluateCandidate([
    'workspaceCapture' => 'PASS',
    'manifestIntegrity' => 'PASS',
    'candidate' => [
        'status' => 'PASS',
        'projectDefinedTests' => 'PASS',
        'files' => [['path' => 'config/example.json', 'syntax' => 'PASS']],
    ],
]);
vg_assert($pass['status'] === 'PASS', 'fully proven candidate must PASS');
vg_assert($pass['exactRevisionRequired'] === true, 'verification must require exact revision binding');
HubVerificationGate::assertPromotable($pass);

$review = HubVerificationGate::evaluateCandidate([
    'candidate' => [
        'status' => 'REVIEW_REQUIRED',
        'workerWorkspaceIsolation' => 'PASS',
        'candidateArchiveValidation' => 'PASS',
        'manifestIntegrity' => 'PASS',
        'projectDefinedTests' => 'NOT_CONFIGURED',
        'visualReview' => ['status' => 'REVIEW_REQUIRED'],
    ],
]);
vg_assert($review['status'] === 'REVIEW', 'missing project tests or visual proof must require REVIEW');
HubVerificationGate::assertPromotable($review);

$block = HubVerificationGate::evaluateCandidate([
    'workspaceCapture' => 'PASS',
    'manifestIntegrity' => 'FAIL',
    'candidate' => ['status' => 'PASS'],
]);
vg_assert($block['status'] === 'BLOCK', 'failed manifest integrity must BLOCK');
try {
    HubVerificationGate::assertPromotable($block);
    throw new RuntimeException('blocked candidate was promotable');
} catch (RuntimeException $error) {
    vg_assert($error->getMessage() === 'VERIFICATION_BLOCKED', 'blocked candidate must fail closed');
}


$deepReview = HubVerificationGate::evaluateCandidate([
    'candidate' => ['status' => 'PASS', 'projectDefinedTests' => 'PASS'],
    'intelligence' => ['schemaVersion'=>1,'riskLevel'=>'CRITICAL','budget'=>'DEEP'],
]);
vg_assert($deepReview['status'] === 'REVIEW', 'DEEP candidate without repeated stability evidence must REVIEW');

$deepStable = HubVerificationGate::evaluateCandidate([
    'candidate' => ['status' => 'PASS', 'projectDefinedTests' => 'PASS'],
    'intelligence' => ['schemaVersion'=>1,'riskLevel'=>'HIGH','budget'=>'DEEP'],
    'stability' => ['status'=>'PASS'],
]);
vg_assert($deepStable['status'] === 'PASS', 'DEEP candidate with stable repeated evidence may PASS');

$deepFlaky = HubVerificationGate::evaluateCandidate([
    'candidate' => ['status' => 'PASS', 'projectDefinedTests' => 'PASS'],
    'intelligence' => ['schemaVersion'=>1,'riskLevel'=>'HIGH','budget'=>'DEEP'],
    'stability' => ['status'=>'UNSTABLE'],
]);
vg_assert($deepFlaky['status'] === 'BLOCK', 'UNSTABLE repeated verification must BLOCK');

$unknown = HubVerificationGate::evaluateCandidate(['candidate' => ['status' => 'UNKNOWN']]);
vg_assert($unknown['status'] === 'BLOCK', 'unknown QA state must BLOCK');
fwrite(STDOUT, "AWH Verification Gate: PASS\n");
