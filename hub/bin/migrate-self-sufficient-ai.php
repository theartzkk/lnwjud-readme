<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSelfSufficientAiMigration.php';

if ($argc !== 2) { fwrite(STDERR, "usage: migrate-self-sufficient-ai.php <database>\n"); exit(2); }
try {
    $result = HubSelfSufficientAiMigration::apply($argv[1], dirname(__DIR__) . '/migrations/015_self_sufficient_ai.sql');
    fwrite(STDOUT, "M16_SELF_SUFFICIENT_AI=" . strtoupper(str_replace('-', '_', $result)) . "\n");
} catch (Throwable $error) {
    $code = property_exists($error, 'codeName') ? $error->codeName : 'MIGRATION_FAILED';
    fwrite(STDERR, "M16_SELF_SUFFICIENT_AI_FAILED=" . $code . "\n"); exit(1);
}
