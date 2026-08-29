<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubProjectVault.php';

function search_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function search_clean(string $root): void { if (!is_dir($root)) return; $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($it as $item) { $path = $item->getPathname(); $item->isDir() ? @rmdir($path) : @unlink($path); } @rmdir($root); }

$root = sys_get_temp_dir() . '/awh-vault-search-' . bin2hex(random_bytes(5));
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900'; $revision = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
try {
    $dir = $root . '/projects/' . $project . '/revisions/' . $revision . '/src'; mkdir($dir, 0700, true);
    file_put_contents($root . '/projects/' . $project . '/revisions/' . $revision . '/README.md', "# Search fixture\nNo symbol here.\n");
    file_put_contents($dir . '/main.php', "<?php\nfunction durableSymbol(): void {}\n");
    file_put_contents($dir . '/invalid.txt', "prefix \xC3\x28 durableSymbol\n");
    file_put_contents($dir . '/blob.bin', "abc\0durableSymbol");
    $vault = new HubProjectVault($root); $hits = $vault->search($project, $revision, 'durableSymbol');
    search_assert(count($hits) === 1 && $hits[0]['path'] === 'src/main.php' && $hits[0]['match'] === 'content' && $hits[0]['line'] === 2, 'content search must find text symbol and skip binary data');
    search_assert(str_contains((string) $hits[0]['snippet'], 'durableSymbol'), 'content search returns bounded line evidence');
    json_encode(['candidateFiles' => $hits], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $invalidText = false; try { $vault->readText($project, $revision, 'src/invalid.txt'); } catch (HubProjectVaultException $e) { $invalidText = $e->codeName === 'PROJECT_CONTEXT_FORBIDDEN'; }
    search_assert($invalidText, 'invalid UTF-8 must be rejected as non-text');
    $pathHits = $vault->search($project, $revision, 'README', 1); search_assert(count($pathHits) === 1 && $pathHits[0]['match'] === 'path', 'path match remains first and respects result cap');
    $invalid = false; try { $vault->search($project, $revision, str_repeat('x', 121)); } catch (HubProjectVaultException $e) { $invalid = $e->codeName === 'PROJECT_CONTEXT_INVALID'; }
    search_assert($invalid, 'oversized search query fails closed');
    fwrite(STDOUT, "AWH Project Vault content search: PASS\n");
} finally { search_clean($root); }
