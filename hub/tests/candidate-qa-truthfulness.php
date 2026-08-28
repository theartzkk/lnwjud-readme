<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';

function candidate_qa_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }

$reflection = new ReflectionClass(HubDurableExecutionService::class);
$validate = $reflection->getMethod('validateCandidateText');
$validate->setAccessible(true);
$php = $validate->invoke(null, 'src/example.php', "<?php\nreturn ['ok' => true];\n");
$json = $validate->invoke(null, 'config/example.json', '{"ok":true}');
$markdown = $validate->invoke(null, 'README.md', "# Safe candidate\n");
candidate_qa_assert($php === ['syntax'=>'PASS','reviewRequired'=>false], 'valid PHP must receive deterministic syntax PASS');
candidate_qa_assert($json === ['syntax'=>'PASS','reviewRequired'=>false], 'valid JSON must receive deterministic syntax PASS');
candidate_qa_assert($markdown === ['syntax'=>'NOT_RUN','reviewRequired'=>true], 'unvalidated syntax must be reported as review required');
foreach ([['bad.php', "<?php function broken( {"], ['bad.json', '{bad'] ] as [$path, $content]) {
    try { $validate->invoke(null, $path, $content); throw new RuntimeException('invalid syntax was accepted'); }
    catch (ReflectionException $error) { throw $error; }
    catch (Throwable $error) {
        $cause = $error instanceof ReflectionException ? $error : ($error->getPrevious() ?? $error);
        candidate_qa_assert($cause instanceof HubDurableExecutionException && $cause->codeName === 'CANDIDATE_QA_FAILED', 'invalid syntax must fail closed');
    }
}
$source = file_get_contents(dirname(__DIR__) . '/src/HubDurableExecutionService.php');
candidate_qa_assert(is_string($source) && str_contains($source, "'schemaVersion' => 2") && str_contains($source, "'candidate' => $qa"), 'candidate report must persist truthful QA evidence');
fwrite(STDOUT, "AWH Candidate QA Truthfulness: PASS\n");
