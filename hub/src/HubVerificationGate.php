<?php

declare(strict_types=1);

/**
 * Deterministic candidate verification shared by native and Codex execution.
 * It never promotes source and never treats missing evidence as PASS.
 */
final class HubVerificationGate
{
    private const PASS = 'PASS';
    private const REVIEW = 'REVIEW';
    private const BLOCK = 'BLOCK';

    /** @param array<string,mixed> $qa @return array<string,mixed> */
    public static function evaluateCandidate(array $qa): array
    {
        $checks = [];
        $review = false;
        $blocked = false;
        $reason = static function (string $id, string $status, string $detail) use (&$checks, &$review, &$blocked): void {
            $checks[] = ['id' => $id, 'status' => $status, 'detail' => $detail];
            if ($status === self::REVIEW) $review = true;
            if ($status === self::BLOCK) $blocked = true;
        };

        $candidate = is_array($qa['candidate'] ?? null) ? $qa['candidate'] : $qa;
        $status = strtoupper((string) ($candidate['status'] ?? ''));
        if ($status === 'PASS') $reason('candidate-qa', self::PASS, 'Candidate QA passed');
        elseif ($status === 'REVIEW_REQUIRED') $reason('candidate-qa', self::REVIEW, 'Candidate QA requires human review');
        else $reason('candidate-qa', self::BLOCK, 'Candidate QA status is missing or unsafe');

        foreach (['workspaceCapture', 'manifestIntegrity'] as $key) {
            if (!array_key_exists($key, $qa)) continue;
            $value = strtoupper((string) $qa[$key]);
            $reason($key, $value === 'PASS' ? self::PASS : self::BLOCK, $value === 'PASS' ? "$key passed" : "$key did not pass");
        }
        foreach (['workerWorkspaceIsolation', 'candidateArchiveValidation', 'manifestIntegrity'] as $key) {
            if (!array_key_exists($key, $candidate)) continue;
            $value = strtoupper((string) $candidate[$key]);
            $reason($key, $value === 'PASS' ? self::PASS : self::BLOCK, $value === 'PASS' ? "$key passed" : "$key did not pass");
        }

        if (array_key_exists('projectDefinedTests', $candidate)) {
            $tests = strtoupper((string) $candidate['projectDefinedTests']);
            if ($tests === 'PASS') $reason('project-defined-tests', self::PASS, 'Project-defined tests passed');
            elseif (in_array($tests, ['NOT_CONFIGURED', 'NOT_RUN', 'SKIP', 'SKIP_PLATFORM'], true)) $reason('project-defined-tests', self::REVIEW, 'Project-defined tests are not proven for this candidate');
            else $reason('project-defined-tests', self::BLOCK, 'Project-defined tests failed or are invalid');
        } else {
            $reason('project-defined-tests', self::REVIEW, 'No project-defined test evidence is attached');
        }

        $visual = is_array($candidate['visualReview'] ?? null) ? $candidate['visualReview'] : null;
        if ($visual !== null) {
            $visualStatus = strtoupper((string) ($visual['status'] ?? ''));
            if (in_array($visualStatus, ['PASS', 'NOT_APPLICABLE'], true)) $reason('visual-review', self::PASS, 'Visual evidence is satisfied or not applicable');
            elseif ($visualStatus === 'REVIEW_REQUIRED') $reason('visual-review', self::REVIEW, 'Visual review is still required');
            else $reason('visual-review', self::BLOCK, 'Visual review failed or is invalid');
        }

        $intelligence = is_array($qa['intelligence'] ?? null) ? $qa['intelligence'] : null;
        if ($intelligence !== null) {
            $risk = strtoupper((string)($intelligence['riskLevel'] ?? ''));
            $budget = strtoupper((string)($intelligence['budget'] ?? ''));
            $valid = ($intelligence['schemaVersion'] ?? null) === 1
                && in_array($risk, ['LOW','MEDIUM','HIGH','CRITICAL'], true)
                && in_array($budget, ['FAST','STANDARD','DEEP'], true);
            $reason('verification-intelligence', $valid ? self::PASS : self::BLOCK, $valid ? "Risk $risk uses $budget verification" : 'Verification intelligence is invalid');
            if ($valid && $budget === 'DEEP') {
                $stability = is_array($qa['stability'] ?? null) ? strtoupper((string)($qa['stability']['status'] ?? '')) : '';
                if ($stability === 'PASS') $reason('stability', self::PASS, 'Repeated verification is stable');
                elseif ($stability === 'UNSTABLE') $reason('stability', self::BLOCK, 'Repeated verification is unstable');
                elseif ($stability === 'FAIL') $reason('stability', self::BLOCK, 'Repeated verification failed');
                else $reason('stability', self::REVIEW, 'Deep verification requires repeated stability evidence before autonomous promotion');
            }
        }

        if (is_array($candidate['files'] ?? null)) {
            foreach ($candidate['files'] as $file) {
                if (!is_array($file)) { $reason('changed-file-syntax', self::BLOCK, 'Changed-file evidence is malformed'); continue; }
                $syntax = strtoupper((string) ($file['syntax'] ?? ''));
                $path = (string) ($file['path'] ?? 'unknown');
                if ($syntax === 'PASS') $reason('syntax:' . $path, self::PASS, 'Deterministic syntax check passed');
                elseif ($syntax === 'NOT_RUN') $reason('syntax:' . $path, self::REVIEW, 'No deterministic syntax checker exists for this file');
                else $reason('syntax:' . $path, self::BLOCK, 'Syntax evidence failed or is invalid');
            }
        }

        $overall = $blocked ? self::BLOCK : ($review ? self::REVIEW : self::PASS);
        return [
            'schemaVersion' => 1,
            'status' => $overall,
            'promotionPolicy' => $overall === self::BLOCK ? 'BLOCKED' : 'OWNER_APPROVAL_REQUIRED',
            'exactRevisionRequired' => true,
            'checks' => $checks,
        ];
    }

    /** @param array<string,mixed> $verification */
    public static function assertPromotable(array $verification): void
    {
        $status = strtoupper((string) ($verification['status'] ?? ''));
        if (!in_array($status, [self::PASS, self::REVIEW], true)) {
            throw new RuntimeException('VERIFICATION_BLOCKED');
        }
    }
}
