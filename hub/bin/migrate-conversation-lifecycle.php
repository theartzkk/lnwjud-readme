<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubConversationLifecycleMigration.php';

if ($argc !== 2) { fwrite(STDERR, "usage: migrate-conversation-lifecycle.php <database>\n"); exit(2); }
try {
    $result = HubConversationLifecycleMigration::apply($argv[1], dirname(__DIR__) . '/migrations/018_conversation_lifecycle.sql');
    fwrite(STDOUT, "M19_CONVERSATION_LIFECYCLE=" . strtoupper(str_replace('-', '_', $result)) . "\n");
} catch (Throwable $error) {
    $code = property_exists($error, 'codeName') ? $error->codeName : 'MIGRATION_FAILED';
    fwrite(STDERR, "M19_CONVERSATION_LIFECYCLE_FAILED=" . $code . "\n"); exit(1);
}
