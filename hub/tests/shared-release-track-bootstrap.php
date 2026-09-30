<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubUpdateTargetRegistry.php';

function shared_release_assert(bool $ok,string $message): void
{
    if(!$ok) throw new RuntimeException($message);
    fwrite(STDOUT,"PASS: {$message}\n");
}

$track=HubUpdateTargetRegistry::releaseTrackForPaths('awh',[
    'hub/src/HubUpdateTargetRegistry.php',
    'test/update-center-contract.test.ts',
]);

shared_release_assert($track==='awh','shared-only AWH delta resolves to the AWH release track');
fwrite(STDOUT,"AWH shared release-track bootstrap: PASS\n");
