<?php

declare(strict_types=1);

/** Verify every manifest-declared Web byte before a Production pointer switch. */
function awh_web_release_fail(string $code): never
{
    fwrite(STDERR, $code . "\n");
    exit(1);
}

if (PHP_SAPI !== 'cli' || !in_array($argc, [2, 3], true)) awh_web_release_fail('WEB_RELEASE_ARGUMENT_INVALID');
$rootInput = $argv[1] ?? '';
$expectedReleaseId = $argv[2] ?? null;
if ($expectedReleaseId !== null && (!is_string($expectedReleaseId) || preg_match('/^[A-Za-z0-9._-]{1,80}$/D', $expectedReleaseId) !== 1 || strtolower($expectedReleaseId) === 'local')) awh_web_release_fail('WEB_RELEASE_EXPECTED_ID_INVALID');
if (!is_string($rootInput) || $rootInput === '' || str_contains($rootInput, "\0") || !str_starts_with($rootInput, '/')) awh_web_release_fail('WEB_RELEASE_ROOT_INVALID');
$root = realpath($rootInput);
if (!is_string($root) || !is_dir($root) || is_link($rootInput)) awh_web_release_fail('WEB_RELEASE_ROOT_INVALID');
$manifestPath = $root . '/release.json';
if (!is_file($manifestPath) || is_link($manifestPath)) awh_web_release_fail('WEB_RELEASE_MANIFEST_INVALID');
$manifestBytes = @filesize($manifestPath);
if (!is_int($manifestBytes) || $manifestBytes < 2 || $manifestBytes > 262144) awh_web_release_fail('WEB_RELEASE_MANIFEST_INVALID');
try { $manifest = json_decode((string) @file_get_contents($manifestPath), true, 32, JSON_THROW_ON_ERROR); }
catch (Throwable) { awh_web_release_fail('WEB_RELEASE_MANIFEST_INVALID'); }
if (!is_array($manifest) || ($manifest['schemaVersion'] ?? null) !== 1 || !is_array($manifest['files'] ?? null) || !array_is_list($manifest['files']) || count($manifest['files']) < 1 || count($manifest['files']) > 100) awh_web_release_fail('WEB_RELEASE_MANIFEST_INVALID');
$manifestReleaseId = $manifest['releaseId'] ?? null;
if (!is_string($manifestReleaseId) || preg_match('/^[A-Za-z0-9._-]{1,80}$/D', $manifestReleaseId) !== 1) awh_web_release_fail('WEB_RELEASE_MANIFEST_INVALID');
if ($expectedReleaseId !== null && !hash_equals($expectedReleaseId, $manifestReleaseId)) awh_web_release_fail('WEB_RELEASE_ID_MISMATCH');

$seen = [];
foreach ($manifest['files'] as $entry) {
    if (!is_array($entry)) awh_web_release_fail('WEB_RELEASE_ENTRY_INVALID');
    $keys = array_keys($entry); sort($keys); if ($keys !== ['path','sha256','sizeBytes']) awh_web_release_fail('WEB_RELEASE_ENTRY_INVALID');
    $path = $entry['path'] ?? null; $sha = $entry['sha256'] ?? null; $size = $entry['sizeBytes'] ?? null;
    if (!is_string($path) || preg_match('#^(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+$#D', $path) !== 1 || str_contains($path, '..') || isset($seen[$path])) awh_web_release_fail('WEB_RELEASE_ENTRY_INVALID');
    if (!is_string($sha) || preg_match('/^[0-9a-f]{64}$/D', $sha) !== 1 || !is_int($size) || $size < 1 || $size > 1073741824) awh_web_release_fail('WEB_RELEASE_ENTRY_INVALID');
    $file = $root . '/' . $path; $resolved = realpath($file);
    if (!is_string($resolved) || !str_starts_with($resolved, $root . '/') || !is_file($file) || is_link($file)) awh_web_release_fail('WEB_RELEASE_FILE_MISSING');
    $actualSize = @filesize($file); $actualSha = @hash_file('sha256', $file);
    if (!is_int($actualSize) || $actualSize !== $size || !is_string($actualSha) || !hash_equals($sha, $actualSha)) awh_web_release_fail('WEB_RELEASE_FILE_MISMATCH');
    $seen[$path] = true;
}
foreach (['index.html','styles.css','awh-design-system.css','responsive-layout.css','app.js','navigation.js','dashboard.css','dashboard.js', 'hosting.html', 'hosting.css', 'hosting.js', 'panel.html', 'panel.css', 'panel.js','web-config.json','data.json','sw.js'] as $required) if (!isset($seen[$required])) awh_web_release_fail('WEB_RELEASE_REQUIRED_FILE_MISSING');
if ($expectedReleaseId !== null) {
    $index = (string) file_get_contents($root . '/index.html');
    $worker = (string) file_get_contents($root . '/sw.js');
    if (str_contains($index, 'release=local') || str_contains($worker, 'awh-shell-local') || str_contains($index . $worker, '__AWH_WEB_RELEASE_ID__')) awh_web_release_fail('WEB_RELEASE_ID_LOCAL_OR_UNRENDERED');
    if (!str_contains($index, 'release=' . $expectedReleaseId) || !str_contains($worker, 'awh-shell-' . $expectedReleaseId)) awh_web_release_fail('WEB_RELEASE_ID_MISMATCH');
}
fwrite(STDOUT, 'WEB_RELEASE_MANIFEST=PASS files=' . count($seen) . "\n");
