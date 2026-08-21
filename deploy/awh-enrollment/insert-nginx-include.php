<?php

declare(strict_types=1);

if ($argc !== 4) {
    fwrite(STDERR, "Usage: insert-nginx-include.php INPUT OUTPUT INCLUDE\n");
    exit(2);
}

[$script, $input, $output, $includePath] = $argv;
if ($input === '' || $output === '' || $includePath === '' || preg_match('/[\x00-\x1F\x7F]/', $input . $output . $includePath)) {
    fwrite(STDERR, "Invalid Nginx insertion path\n");
    exit(2);
}

$lines = @file($input, FILE_IGNORE_NEW_LINES);
if (!is_array($lines) || $lines === []) {
    fwrite(STDERR, "Nginx configuration is unavailable\n");
    exit(3);
}

/** @return array{open:int,close:int} */
function nginx_braces(string $line): array
{
    $withoutComment = preg_replace('/#.*/', '', $line) ?? $line;
    return ['open' => substr_count($withoutComment, '{'), 'close' => substr_count($withoutComment, '}')];
}

$depth = 0;
$active = null;
$servers = [];
foreach ($lines as $index => $line) {
    if ($active === null && preg_match('/^\s*server\s*\{/', $line) === 1) {
        $active = [
            'start' => $index,
            'startDepth' => $depth,
            'https' => false,
            'database' => false,
            'gateway' => false,
            'includeCount' => 0,
            'hasEnrollmentReference' => false,
        ];
    }
    if ($active !== null) {
        if (preg_match('/\blisten\s+(?:\[[^]]+\]:)?443\b[^;]*\bssl\b/i', $line) === 1) $active['https'] = true;
        if (str_contains($line, 'AWH_HUB_DB_PATH')) $active['database'] = true;
        if (str_contains($line, 'web-gateway.php')) $active['gateway'] = true;
        if (str_contains($line, 'enrollment-current')) $active['hasEnrollmentReference'] = true;
        if (preg_match('/^\s*include\s+' . preg_quote('' . $includePath, '/') . '\s*;\s*$/', $line) === 1) $active['includeCount']++;
    }
    $braces = nginx_braces($line);
    $depth += $braces['open'] - $braces['close'];
    if ($active !== null && $depth === $active['startDepth']) {
        $active['end'] = $index;
        $servers[] = $active;
        $active = null;
    }
}
if ($active !== null || $depth !== 0) {
    fwrite(STDERR, "Nginx server block braces are unbalanced\n");
    exit(4);
}

$authoritative = array_values(array_filter($servers, static fn (array $server): bool => $server['https'] && $server['database'] && $server['gateway']));
if (count($authoritative) !== 1) {
    fwrite(STDERR, "Exactly one authoritative AWH HTTPS server block is required\n");
    exit(5);
}
$target = $authoritative[0];
$targetIndex = array_search($target, $servers, true);
$totalIncludes = array_sum(array_map(static fn (array $server): int => $server['includeCount'], $servers));
if ($target['hasEnrollmentReference'] && $target['includeCount'] === 0) {
    fwrite(STDERR, "Existing enrollment reference is not the reviewed include\n");
    exit(6);
}
if ($totalIncludes > 1 || ($totalIncludes === 1 && $target['includeCount'] !== 1)) {
    fwrite(STDERR, "Enrollment include is duplicated or outside the authoritative server\n");
    exit(7);
}
if ($target['includeCount'] === 1) {
    if (@file_put_contents($output, implode(PHP_EOL, $lines) . PHP_EOL) === false) {
        fwrite(STDERR, "Unable to write reviewed Nginx configuration\n");
        exit(8);
    }
    exit(0);
}

$insertAt = $target['end'];
$outputLines = [];
foreach ($lines as $index => $line) {
    if ($index === $insertAt) $outputLines[] = '    include ' . $includePath . ';';
    $outputLines[] = $line;
}
if (@file_put_contents($output, implode(PHP_EOL, $outputLines) . PHP_EOL) === false) {
    fwrite(STDERR, "Unable to write reviewed Nginx configuration\n");
    exit(8);
}
