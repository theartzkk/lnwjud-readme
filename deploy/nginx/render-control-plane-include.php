<?php

declare(strict_types=1);

if ($argc !== 5) {
    exit(2);
}

[, $inputPath, $outputPath, $hostname, $fpmSocket] = $argv;
if ($inputPath === '' || $outputPath === '' || $inputPath === $outputPath || str_contains($inputPath, "\0") || str_contains($outputPath, "\0")) {
    exit(2);
}
if (preg_match('/^[A-Za-z0-9.-]+$/', $hostname) !== 1 || strcasecmp($hostname, 'localhost') === 0 || filter_var($hostname, FILTER_VALIDATE_IP) !== false || str_starts_with($hostname, '.') || str_ends_with($hostname, '.')) {
    exit(2);
}
if (preg_match('#^/run/php/php[0-9]+\.[0-9]+-fpm-awh\.sock$#', $fpmSocket) !== 1) {
    exit(2);
}

$template = @file_get_contents($inputPath);
if (!is_string($template) || $template === '' || str_contains($template, "\0")) {
    exit(2);
}

$originPlaceholder = 'https://PREVIEW_HOSTNAME';
$socketPlaceholder = 'PREVIEW_AWH_FPM_SOCKET';
$expectedOrigin = 'fastcgi_param AWH_CONTROL_ORIGIN ' . $originPlaceholder . ';';
$expectedSocket = 'fastcgi_pass unix:' . $socketPlaceholder . ';';
$originLineCount = preg_match_all('/^\s*' . preg_quote($expectedOrigin, '/') . '\s*$/m', $template, $matches);
$socketLineCount = preg_match_all('/^\s*' . preg_quote($expectedSocket, '/') . '\s*$/m', $template, $matches);
if ($originLineCount !== 1 || $socketLineCount !== 1 || substr_count($template, 'AWH_CONTROL_ORIGIN') !== 1 || substr_count($template, $originPlaceholder) !== 1 || substr_count($template, $socketPlaceholder) !== 1) {
    exit(2);
}

$rendered = str_replace([$originPlaceholder, $socketPlaceholder], ['https://' . $hostname, $fpmSocket], $template, $replacements);
if ($replacements !== 2 || str_contains($rendered, 'PREVIEW_HOSTNAME') || str_contains($rendered, $socketPlaceholder) || substr_count($rendered, 'https://' . $hostname) !== 1 || substr_count($rendered, 'unix:' . $fpmSocket) !== 1) {
    exit(2);
}
if (@file_put_contents($outputPath, $rendered, LOCK_EX) === false || @file_get_contents($outputPath) !== $rendered) {
    exit(2);
}

exit(0);
