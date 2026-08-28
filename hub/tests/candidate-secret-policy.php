<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSecretContentPolicy.php';

function secret_gate_assert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$openAi = 'sk-' . str_repeat('A', 24);
$github = 'ghp_' . str_repeat('B', 24);
$bearer = 'Bearer ' . str_repeat('c', 24);
$privateKey = "-----BEGIN PRIVATE KEY-----\n" . str_repeat('D', 32);

secret_gate_assert(HubSecretContentPolicy::containsCredential($openAi), 'OpenAI-style credential is blocked');
secret_gate_assert(HubSecretContentPolicy::containsCredential($github), 'GitHub-style credential is blocked');
secret_gate_assert(HubSecretContentPolicy::containsCredential($bearer), 'Bearer credential is blocked');
secret_gate_assert(HubSecretContentPolicy::containsCredential($privateKey), 'private key material is blocked');
secret_gate_assert(!HubSecretContentPolicy::containsCredential('API_KEY=your_api_key_here'), 'ordinary placeholder remains allowed');
secret_gate_assert(!HubSecretContentPolicy::containsCredential('token = process.env.API_TOKEN'), 'environment references remain allowed');
secret_gate_assert(!HubSecretContentPolicy::containsCredential("<?php echo 'normal source';\n"), 'ordinary source remains allowed');

fwrite(STDOUT, "AWH Candidate Secret Policy: PASS\n");
