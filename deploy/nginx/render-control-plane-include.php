<?php

declare(strict_types=1);

if ($argc !== 4) {
    exit(2);
}

[, $inputPath, $outputPath, $hostname] = $argv;
if ($inputPath === '' || $outputPath === '' || $inputPath === $outputPath || str_contains($inputPath, "\0") || str_contains($outputPath, "\0")) {
    exit(2);
}
if (preg_match('/^[A-Za-z0-9.-]+$/', $hostname) !== 1 || strcasecmp($hostname, 'localhost') === 0 || filter_var($hostname, FILTER_VALIDATE_IP) !== false || str_starts_with($hostname, '.') || str_ends_with($hostname, '.')) {
    exit(2);
}

$template = @file_get_contents($inputPath);
if (!is_string($template) || $template === '' || str_contains($template, "\0")) {
    exit(2);
}

$placeholder = 'https://PREVIEW_HOSTNAME';
$expected = 'fastcgi_param AWH_CONTROL_ORIGIN ' . $placeholder . ';';
$lineCount = preg_match_all('/^\s*' . preg_quote($expected, '/') . '\s*$/m', $template, $matches);
if ($lineCount !== 2 || substr_count($template, 'AWH_CONTROL_ORIGIN') !== 2 || substr_count($template, $placeholder) !== 2) {
    exit(2);
}

$rendered = str_replace($placeholder, 'https://' . $hostname, $template, $replacements);
if ($replacements !== 2 || str_contains($rendered, 'PREVIEW_HOSTNAME') || substr_count($rendered, 'https://' . $hostname) !== 2) {
    exit(2);
}
if (@file_put_contents($outputPath, $rendered, LOCK_EX) === false || @file_get_contents($outputPath) !== $rendered) {
    exit(2);
}

exit(0);
