<?php

declare(strict_types=1);

/**
 * Transform the reviewed AWH HTTPS site from server-wide Basic Auth to the
 * application-auth boundary. This helper only writes a candidate file; the
 * deployment engine owns backup, install, nginx -t, reload and rollback.
 */

if ($argc !== 4) {
    fwrite(STDERR, "Usage: transform-owner-auth.php INPUT OUTPUT HOSTNAME\n");
    exit(2);
}

[, $input, $output, $hostname] = $argv;
if ($input === '' || $output === '' || $hostname === '' || preg_match('/[\x00-\x1F\x7F]/', $input . $output . $hostname)) {
    fwrite(STDERR, "Invalid owner-auth transformation input\n");
    exit(2);
}
if (preg_match('/^[A-Za-z0-9.-]+$/', $hostname) !== 1 || str_contains($hostname, '*') || strcasecmp($hostname, 'localhost') === 0 || filter_var($hostname, FILTER_VALIDATE_IP) !== false || str_starts_with($hostname, '.') || str_ends_with($hostname, '.')) {
    fwrite(STDERR, "Owner-auth hostname is not a reviewed DNS authority\n");
    exit(2);
}

$lines = @file($input, FILE_IGNORE_NEW_LINES);
if (!is_array($lines) || $lines === []) {
    fwrite(STDERR, "Authoritative Nginx configuration is unavailable\n");
    exit(3);
}

/** @return array{open:int,close:int} */
function brace_delta(string $line): array
{
    $withoutComment = preg_replace('/#.*/', '', $line) ?? $line;
    return ['open' => substr_count($withoutComment, '{'), 'close' => substr_count($withoutComment, '}')];
}

$beforeDepth = [];
$afterDepth = [];
$depth = 0;
foreach ($lines as $index => $line) {
    $beforeDepth[$index] = $depth;
    $delta = brace_delta($line);
    $depth += $delta['open'] - $delta['close'];
    if ($depth < 0) {
        fwrite(STDERR, "Nginx braces are unbalanced\n");
        exit(4);
    }
    $afterDepth[$index] = $depth;
}
if ($depth !== 0) {
    fwrite(STDERR, "Nginx braces are unbalanced\n");
    exit(4);
}

$servers = [];
$active = null;
foreach ($lines as $index => $line) {
    if ($active === null && preg_match('/^\s*server\s*\{/', $line) === 1) {
        $active = ['start' => $index, 'startDepth' => $beforeDepth[$index], 'end' => null];
    }
    if ($active !== null && $afterDepth[$index] === $active['startDepth']) {
        $active['end'] = $index;
        $servers[] = $active;
        $active = null;
    }
}
if ($active !== null) {
    fwrite(STDERR, "Nginx server block is incomplete\n");
    exit(4);
}

/** @return array<string,mixed> */
function server_metadata(array $lines, array $beforeDepth, array $afterDepth, array $server): array
{
    $directDepth = $server['startDepth'] + 1;
    $names = [];
    $directAuth = [];
    $directIncludes = [];
    $locations = [];
    $activeLocation = null;
    for ($index = $server['start'] + 1; $index < $server['end']; $index++) {
        $line = $lines[$index];
        if ($activeLocation === null && $beforeDepth[$index] === $directDepth && preg_match('/^\s*location\b.*\{/', $line) === 1) {
            $activeLocation = ['start' => $index, 'depth' => $beforeDepth[$index] + 1, 'end' => null, 'header' => $line];
        }
        if ($beforeDepth[$index] === $directDepth) {
            if (preg_match('/^\s*server_name\s+([^;]+);/i', $line, $match) === 1) {
                $names = array_merge($names, preg_split('/\s+/', trim($match[1])) ?: []);
            }
            if (preg_match('/^\s*auth_basic(?:_user_file)?\b[^;]*;/i', $line) === 1) $directAuth[] = $index;
            if (preg_match('/^\s*include\s+([^;]+);/i', $line, $match) === 1) $directIncludes[] = trim($match[1]);
        }
        if ($activeLocation !== null && $beforeDepth[$index] === $activeLocation['depth'] && $afterDepth[$index] === $activeLocation['depth'] - 1) {
            $activeLocation['end'] = $index;
            $locations[] = $activeLocation;
            $activeLocation = null;
        }
    }
    return ['names' => $names, 'directAuth' => $directAuth, 'directIncludes' => $directIncludes, 'locations' => $locations];
}

function location_matches(string $header, string $path): bool
{
    return preg_match('/^\s*location\s+(?:\^~\s+)?' . preg_quote($path, '/') . '\s*\{/', $header) === 1;
}

/** @return array{start:int,end:int,header:string,depth:int} */
function require_one_location(array $locations, string $path): array
{
    $matches = array_values(array_filter($locations, static fn (array $location): bool => location_matches($location['header'], $path)));
    if (count($matches) > 1) throw new RuntimeException("Duplicate reviewed location: $path");
    return $matches[0] ?? ['start' => -1, 'end' => -1, 'header' => '', 'depth' => -1];
}

/** @return array{start:int,end:int,header:string,depth:int} */
function add_auth_location(array $lines, array $server, string $hostname): array
{
    $insert = [
        '    location ^~ /preview/ {',
        '        auth_basic "AWH Remote Preview";',
        '        auth_basic_user_file /etc/nginx/.awh-preview-users;',
        '        try_files $uri $uri/ =404;',
        '    }',
    ];
    return ['insertAt' => $server['end'], 'lines' => $insert];
}

$metadata = [];
foreach ($servers as $server) $metadata[] = server_metadata($lines, $beforeDepth, $afterDepth, $server);
$authoritative = [];
foreach ($servers as $position => $server) {
    $meta = $metadata[$position];
    $block = implode("\n", array_slice($lines, $server['start'], $server['end'] - $server['start'] + 1));
    $https = preg_match('/\blisten\s+(?:\[[^]]+\]:)?443\b[^;]*\bssl\b/i', $block) === 1;
    $default = preg_match('/\blisten\s+(?:\[[^]]+\]:)?443\b[^;]*\bdefault_server\b/i', $block) === 1;
    $authoritativeMarkers = str_contains($block, 'AWH_HUB_DB_PATH') && str_contains($block, 'web-gateway.php');
    $nameMatches = in_array($hostname, $meta['names'], true);
    $safeNames = $meta['names'] !== [] && count(array_filter($meta['names'], static fn (string $name): bool => $name === '_' || str_contains($name, '*') || strcasecmp($name, 'localhost') === 0 || filter_var($name, FILTER_VALIDATE_IP) !== false)) === 0;
    if ($https && !$default && $authoritativeMarkers && $nameMatches && $safeNames) $authoritative[] = ['server' => $server, 'meta' => $meta];
}
if (count($authoritative) !== 1) {
    fwrite(STDERR, "Exactly one authoritative AWH HTTPS server is required\n");
    exit(5);
}
$target = $authoritative[0]['server'];
$meta = $authoritative[0]['meta'];
if (count($meta['names']) !== 1 || $meta['names'][0] !== $hostname) {
    fwrite(STDERR, "Authoritative AWH HTTPS server name is ambiguous\n");
    exit(6);
}

$requiredIncludes = [
    '/opt/awh-hub/enrollment-current/deploy/nginx/awh-enrollment.conf',
    '/opt/awh-hub/control-plane-current/deploy/nginx/awh-control-plane.conf',
];
foreach ($requiredIncludes as $include) {
    $count = count(array_filter($meta['directIncludes'], static fn (string $value): bool => $value === $include));
    if ($count !== 1) {
        fwrite(STDERR, "Reviewed AWH include topology is incomplete or duplicated\n");
        exit(7);
    }
}

$locations = $meta['locations'];
$generic = require_one_location($locations, '/api/v1/');
$auth = require_one_location($locations, '/api/v1/auth/');
$root = require_one_location($locations, '/');
$preview = require_one_location($locations, '/preview/');
if ($generic['start'] < 0 || $root['start'] < 0) {
    fwrite(STDERR, "AWH root and generic API locations are required\n");
    exit(8);
}

$remove = [];
$insertBefore = [];
$canonicalTechnical = [
    '        auth_basic "AWH Remote Preview";',
    '        auth_basic_user_file /etc/nginx/.awh-preview-users;',
];
$canonicalPublic = ['        auth_basic off;'];
$rewriteLocation = static function (array $location, array &$remove, array &$insertBefore, array $technical, array $lines): void {
    for ($index = $location['start'] + 1; $index < $location['end']; $index++) {
        if (preg_match('/^\s*auth_basic(?:_user_file)?\b[^;]*;/i', $lines[$index]) === 1) $remove[$index] = true;
    }
    $insertBefore[$location['start'] + 1] = array_merge($insertBefore[$location['start'] + 1] ?? [], $technical);
};

foreach ($meta['directAuth'] as $index) $remove[$index] = true;
if (count($meta['directAuth']) !== 0 && count($meta['directAuth']) !== 2 && !(count($meta['directAuth']) === 1 && preg_match('/^\s*auth_basic\s+off\s*;/i', $lines[$meta['directAuth'][0]]) === 1)) {
    fwrite(STDERR, "Server-level Basic Auth directives must be a complete reviewed pair\n");
    exit(9);
}
$insertBefore[$target['start'] + 1] = array_merge($insertBefore[$target['start'] + 1] ?? [], ['    auth_basic off;']);
$rewriteLocation($generic, $remove, $insertBefore, $canonicalTechnical, $lines);
$publicAuth = [
    '    location = /api/v1/auth/login {',
    '        auth_basic off;',
    '        client_max_body_size 16k;',
    '        access_log off;',
    '        include fastcgi_params;',
    '        fastcgi_param SCRIPT_FILENAME /opt/awh-hub/control-plane-current/hub/public/control-plane.php;',
    '        fastcgi_param AWH_HUB_DB_PATH /var/lib/awh-hub/awh.sqlite;',
    '        fastcgi_param AWH_CONTROL_ORIGIN https://' . $hostname . ';',
    '        fastcgi_param HTTP_ORIGIN $http_origin;',
    '        fastcgi_param HTTP_COOKIE $http_cookie;',
    '        fastcgi_param HTTP_X_AWH_CSRF $http_x_awh_csrf;',
    '        fastcgi_param REMOTE_ADDR $remote_addr;',
    '        fastcgi_param HTTP_USER_AGENT $http_user_agent;',
    '        fastcgi_param QUERY_STRING $query_string;',
    '        fastcgi_pass unix:/run/php/php8.3-fpm-awh.sock;',
    '    }',
    '    location = /api/v1/auth/session {',
    '        auth_basic off;',
    '        client_max_body_size 16k;',
    '        access_log off;',
    '        include fastcgi_params;',
    '        fastcgi_param SCRIPT_FILENAME /opt/awh-hub/control-plane-current/hub/public/control-plane.php;',
    '        fastcgi_param AWH_HUB_DB_PATH /var/lib/awh-hub/awh.sqlite;',
    '        fastcgi_param AWH_CONTROL_ORIGIN https://' . $hostname . ';',
    '        fastcgi_param HTTP_ORIGIN $http_origin;',
    '        fastcgi_param HTTP_COOKIE $http_cookie;',
    '        fastcgi_param HTTP_X_AWH_CSRF $http_x_awh_csrf;',
    '        fastcgi_param REMOTE_ADDR $remote_addr;',
    '        fastcgi_param HTTP_USER_AGENT $http_user_agent;',
    '        fastcgi_param QUERY_STRING $query_string;',
    '        fastcgi_pass unix:/run/php/php8.3-fpm-awh.sock;',
    '    }',
    '    location ^~ /api/v1/auth/ {',
    '        auth_basic off;',
    '        client_max_body_size 16k;',
    '        access_log off;',
    '        include fastcgi_params;',
    '        fastcgi_param SCRIPT_FILENAME /opt/awh-hub/control-plane-current/hub/public/control-plane.php;',
    '        fastcgi_param AWH_HUB_DB_PATH /var/lib/awh-hub/awh.sqlite;',
    '        fastcgi_param AWH_CONTROL_ORIGIN https://' . $hostname . ';',
    '        fastcgi_param HTTP_ORIGIN $http_origin;',
    '        fastcgi_param HTTP_COOKIE $http_cookie;',
    '        fastcgi_param HTTP_X_AWH_CSRF $http_x_awh_csrf;',
    '        fastcgi_param REMOTE_ADDR $remote_addr;',
    '        fastcgi_param HTTP_USER_AGENT $http_user_agent;',
    '        fastcgi_param QUERY_STRING $query_string;',
    '        fastcgi_pass unix:/run/php/php8.3-fpm-awh.sock;',
    '    }',
];
if ($auth['start'] >= 0) $rewriteLocation($auth, $remove, $insertBefore, ['        auth_basic off;'], $lines);
else $insertBefore[$generic['start']] = array_merge($insertBefore[$generic['start']] ?? [], $publicAuth);
$rewriteLocation($root, $remove, $insertBefore, $canonicalPublic, $lines);
if ($preview['start'] >= 0) $rewriteLocation($preview, $remove, $insertBefore, $canonicalTechnical, $lines);
else {
    $candidate = add_auth_location($lines, $target, $hostname);
    $insertBefore[$candidate['insertAt']] = array_merge($insertBefore[$candidate['insertAt']] ?? [], $candidate['lines']);
}

$outputLines = [];
foreach ($lines as $index => $line) {
    if (isset($insertBefore[$index])) foreach ($insertBefore[$index] as $extra) $outputLines[] = $extra;
    if (!isset($remove[$index])) $outputLines[] = $line;
}
$rendered = implode(PHP_EOL, $outputLines) . PHP_EOL;
if (substr_count($rendered, 'auth_basic "AWH Remote Preview";') < 2 || substr_count($rendered, 'auth_basic_user_file /etc/nginx/.awh-preview-users;') < 2) {
    fwrite(STDERR, "Technical Basic Auth locations were not established\n");
    exit(10);
}
if (@file_put_contents($output, $rendered) === false) {
    fwrite(STDERR, "Unable to write Nginx candidate\n");
    exit(12);
}
