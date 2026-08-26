<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthService.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthRouter.php';

try {
    $database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
    $path = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '');
    $workerCandidate = preg_match('#^/api/v1/control/worker/executions/[0-9a-f-]{36}/candidate$#i', $path) === 1 && (string) ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST';
    $workerOfficeArtifact = preg_match('#^/api/v1/control/worker/executions/[0-9a-f-]{36}/office-artifact$#i', $path) === 1 && (string) ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST';
    $candidateFile = []; $officeArtifactFile = [];
    if ($workerCandidate || $workerOfficeArtifact) {
        $maxUpload = $workerOfficeArtifact ? 50 * 1024 * 1024 : 1024 * 1024 * 1024;
        $length = isset($_SERVER['CONTENT_LENGTH']) ? filter_var($_SERVER['CONTENT_LENGTH'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => $maxUpload]]) : false;
        if (!is_int($length)) throw new RuntimeException('Candidate content length is invalid');
        $temporary = tmpfile();
        if (!is_resource($temporary)) throw new RuntimeException('Candidate storage is unavailable');
        $meta = stream_get_meta_data($temporary); $tmpPath = $meta['uri'] ?? null; $input = fopen('php://input', 'rb');
        $copied = is_resource($input) ? stream_copy_to_stream($input, $temporary, $length + 1) : false;
        if (is_resource($input)) fclose($input);
        if (!is_int($copied) || $copied !== $length || !is_string($tmpPath) || !is_file($tmpPath)) { fclose($temporary); throw new RuntimeException('Worker upload is incomplete'); }
        fflush($temporary);
        if ($workerOfficeArtifact) $officeArtifactFile = ['officeArtifact' => ['tmp_name' => $tmpPath, 'size' => $length]];
        else $candidateFile = ['candidate' => ['tmp_name' => $tmpPath, 'size' => $length]];
        $body = '';
    } else $body = file_get_contents('php://input', false, null, 0, 16385);
    if (str_starts_with($path, '/api/v1/auth/')) {
        $auth = HubOwnerAuthService::openExisting($database);
        $response = HubOwnerAuthRouter::dispatch((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'), (string) ($_SERVER['REQUEST_URI'] ?? '/'), $_SERVER, $auth, is_string($body) ? $body : '');
    } else {
        $control = HubControlPlaneService::openExisting($database);
        $uploadFiles = $workerCandidate ? $candidateFile : ($workerOfficeArtifact ? $officeArtifactFile : $_FILES);
        $response = HubControlPlaneRouter::dispatch((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'), (string) ($_SERVER['REQUEST_URI'] ?? '/'), $_SERVER, $control, is_string($body) ? $body : '', $uploadFiles);
    }
    if (isset($temporary) && is_resource($temporary)) fclose($temporary);
} catch (Throwable) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo "{\"schemaVersion\":1,\"error\":\"ERROR\",\"code\":\"CONTROL_PLANE_UNAVAILABLE\",\"message\":\"AWH control plane is unavailable\"}\n";
    exit;
}
http_response_code($response['status']);
foreach ($response['headers'] as $name => $value) {
    if (is_array($value)) foreach ($value as $line) header($name . ': ' . $line, false);
    else header($name . ': ' . $value);
}
if (isset($response['streamPath'])) {
    $path = $response['streamPath'];
    if (!is_string($path) || $path === '' || !is_file($path) || is_link($path)) { http_response_code(404); exit; }
    $handle = fopen($path, 'rb');
    if ($handle === false) { http_response_code(404); exit; }
    fpassthru($handle); fclose($handle); exit;
}
echo $response['body'];
