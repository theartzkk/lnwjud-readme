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
    if ($path === '/api/v1/control/updates/stream' && (string) ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        if (!HubBrowserOriginPolicy::safeReadAllowed($_SERVER)) {
            http_response_code(403);
            header('Content-Type: text/event-stream; charset=utf-8');
            header('Cache-Control: no-store');
            echo "event: error
";
            echo 'data: {"schemaVersion":1,"code":"ORIGIN_NOT_ALLOWED"}'."

";
            exit;
        }
        $token=is_string($_COOKIE['__Host-awh_control_session']??null)?(string)$_COOKIE['__Host-awh_control_session']:'';
        $control=HubControlPlaneService::openExisting($database);
        $initial=$control->updateCenterLiveForSession($token,null);
        http_response_code(200);
        header('Content-Type: text/event-stream; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate');
        header('X-Accel-Buffering: no');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        @set_time_limit(30);
        @ini_set('zlib.output_compression','0');
        while(ob_get_level()>0)@ob_end_flush();
        ob_implicit_flush(true);
        $cursor=(string)$initial['cursor'];$deadline=microtime(true)+25.0;$lastPing=microtime(true);
        echo "retry: 1000
";
        $initialData=json_encode(['schemaVersion'=>1,'cursor'=>$cursor,'snapshot'=>$initial['snapshot']],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
        echo 'id: '.$cursor."
";
        echo "event: update
";
        echo 'data: '.$initialData."

";
        @flush();
        do {
            $payload=$control->updateCenterLiveForSession($token,$cursor);
            if(($payload['changed']??false)===true&&is_array($payload['snapshot']??null)){
                $cursor=(string)$payload['cursor'];
                $data=json_encode(['schemaVersion'=>1,'cursor'=>$cursor,'snapshot'=>$payload['snapshot']],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
                echo 'id: '.$cursor."
";
                echo "event: update
";
                echo 'data: '.$data."

";
                $lastPing=microtime(true);
            }elseif(microtime(true)-$lastPing>=10.0){
                echo ': keepalive '.gmdate('c')."

";$lastPing=microtime(true);
            }
            @flush();
            if(connection_aborted())break;
            usleep(500000);
        } while(microtime(true)<$deadline);
        exit;
    }
    $workerCandidate = preg_match('#^/api/v1/control/worker/executions/[0-9a-f-]{36}/candidate$#i', $path) === 1 && (string) ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST';
    $workerOfficeArtifact = preg_match('#^/api/v1/control/worker/executions/[0-9a-f-]{36}/office-artifact$#i', $path) === 1 && (string) ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST';
    $workerProjectSource = preg_match('#^/api/v1/control/worker/projects/[0-9a-f-]{36}/source/[0-9a-f]{40,64}$#i', $path) === 1 && (string) ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST';
    $candidateFile = []; $officeArtifactFile = []; $projectSourceFile = [];
    if ($workerCandidate || $workerOfficeArtifact || $workerProjectSource) {
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
        elseif ($workerProjectSource) $projectSourceFile = ['projectSource' => ['tmp_name' => $tmpPath, 'size' => $length]];
        else $candidateFile = ['candidate' => ['tmp_name' => $tmpPath, 'size' => $length]];
        $body = '';
    } else $body = file_get_contents('php://input', false, null, 0, 16385);
    if (str_starts_with($path, '/api/v1/auth/')) {
        $auth = HubOwnerAuthService::openExisting($database);
        $response = HubOwnerAuthRouter::dispatch((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'), (string) ($_SERVER['REQUEST_URI'] ?? '/'), $_SERVER, $auth, is_string($body) ? $body : '');
    } else {
        $control = HubControlPlaneService::openExisting($database);
        $uploadFiles = $workerCandidate ? $candidateFile : ($workerOfficeArtifact ? $officeArtifactFile : ($workerProjectSource ? $projectSourceFile : $_FILES));
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

// AiPASS delivery is a presentation of an already-authorized Artifact object.
// HubControlPlaneRouter + artifactDownload have already validated the session,
// same-origin read policy and project.read capability before streamPath exists.
if ((string) ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET'
    && (int) ($response['status'] ?? 0) === 200
    && isset($response['streamPath'])
    && preg_match('#^/api/v1/control/artifacts/[0-9a-f-]{36}/download$#i', $path) === 1) {
    $query = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_QUERY) ?: '');
    parse_str($query, $queryValues);
    $mode = $queryValues['aipass'] ?? null;
    $bundlePath = $response['streamPath'];
    $isAiPassBundle = false;
    if (is_string($bundlePath) && $bundlePath !== '' && is_file($bundlePath) && !is_link($bundlePath)) {
        try { HubAiPassBundleDelivery::manifest($bundlePath); $isAiPassBundle = true; }
        catch (HubAiPassProjectExportException) { $isAiPassBundle = false; }
    }
    if ($mode === null && $isAiPassBundle) $mode = 'page';
    if ($mode !== null) {
        try {
            if (!$isAiPassBundle || !is_string($bundlePath)) throw new HubAiPassProjectExportException('AiPASS bundle is unavailable', 'AIPASS_EXPORT_FAILED');
            if ($mode === 'page' && !array_key_exists('index', $queryValues)) {
                $html = HubAiPassBundleDelivery::landingPage($bundlePath, $path);
                http_response_code(200);
                header('Content-Type: text/html; charset=utf-8');
                header('Cache-Control: no-store');
                header('X-Content-Type-Options: nosniff');
                header('Referrer-Policy: no-referrer');
                header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
                echo $html;
                exit;
            }
            if ($mode === 'docx') {
                $index = $queryValues['index'] ?? null;
                if (!is_string($index) || preg_match('/^(?:0|[1-9][0-9]?)$/', $index) !== 1) throw new HubAiPassProjectExportException('AiPASS DOCX index is invalid', 'AIPASS_EXPORT_INVALID');
                $file = HubAiPassBundleDelivery::document($bundlePath, (int) $index);
                http_response_code(200);
                header('Content-Type: ' . HubAiPassProjectExportService::DOCX_MIME);
                header('Content-Length: ' . (int) $file['sizeBytes']);
                header('Content-Disposition: attachment; filename="' . (string) $file['name'] . '"');
                header('Cache-Control: no-store');
                header('X-Content-Type-Options: nosniff');
                header('Referrer-Policy: no-referrer');
                echo $file['bytes'];
                exit;
            }
            throw new HubAiPassProjectExportException('AiPASS delivery mode is invalid', 'AIPASS_EXPORT_INVALID');
        } catch (Throwable) {
            http_response_code(400);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
            echo "{\"schemaVersion\":1,\"error\":\"ERROR\",\"code\":\"AIPASS_DELIVERY_INVALID\",\"message\":\"AiPASS DOCX delivery could not be verified\"}\n";
            exit;
        }
    }
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