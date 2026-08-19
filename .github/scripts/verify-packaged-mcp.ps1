param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = 'Stop'

$exe = Get-ChildItem -Path out -Recurse -Filter ArtAgent.exe | Select-Object -First 1
if (-not $exe) { throw 'ArtAgent.exe not found for MCP stdio verification' }

$appAsar = Join-Path $exe.DirectoryName 'resources/app.asar'
if (-not (Test-Path $appAsar)) { throw "Packaged app.asar not found: $appAsar" }
$entrypoint = Join-Path $appAsar 'dist/index.js'

$workspace = Join-Path $env:RUNNER_TEMP 'art-agent-mcp-workspace'
$dataDir = Join-Path $env:RUNNER_TEMP 'art-agent-mcp-data'
$forbiddenPath = Join-Path $workspace 'should-not-exist.txt'
Remove-Item -Recurse -Force $workspace -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $workspace -Force | Out-Null
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $exe.FullName
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.Environment['ELECTRON_RUN_AS_NODE'] = '1'
$startInfo.Environment['ART_AGENT_DATA_DIR'] = $dataDir
# Deliberately enable every local permission. --remote-tunnel must still expose only the remote read-only profile.
$startInfo.Environment['ART_AGENT_ALLOW_WRITE'] = '1'
$startInfo.Environment['ART_AGENT_ALLOW_EXEC'] = '1'
$startInfo.Environment['ART_AGENT_ALLOW_CODEX'] = '1'
$startInfo.Environment.Remove('ART_AGENT_SMOKE_TEST') | Out-Null
$startInfo.Environment.Remove('ELECTRON_ENABLE_LOGGING') | Out-Null
$startInfo.ArgumentList.Add($entrypoint)
$startInfo.ArgumentList.Add('--workspace')
$startInfo.ArgumentList.Add($workspace)
$startInfo.ArgumentList.Add('--remote-tunnel')

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
if (-not $process.Start()) { throw 'Failed to start packaged ArtAgent.exe in Electron Node mode' }

$stderrTask = $process.StandardError.ReadToEndAsync()
$protocolLines = [System.Collections.Generic.List[string]]::new()

function Invoke-McpRequest {
  param(
    [Parameter(Mandatory = $true)] [int]$Id,
    [Parameter(Mandatory = $true)] [string]$Method,
    [Parameter(Mandatory = $false)] $Params
  )

  $payload = @{ jsonrpc = '2.0'; id = $Id; method = $Method }
  if ($null -ne $Params) { $payload.params = $Params }
  $request = $payload | ConvertTo-Json -Depth 12 -Compress

  # Start the read before writing so a fast response cannot race the harness.
  $lineTask = $process.StandardOutput.ReadLineAsync()
  $process.StandardInput.WriteLine($request)
  $process.StandardInput.Flush()
  if (-not $lineTask.Wait(10000)) {
    throw "Timed out waiting for packaged MCP response to $Method"
  }

  $line = $lineTask.GetAwaiter().GetResult()
  if ([string]::IsNullOrWhiteSpace($line)) {
    throw "Packaged MCP returned an empty stdout line for $Method"
  }
  $protocolLines.Add($line)
  try {
    return $line | ConvertFrom-Json
  } catch {
    throw "Packaged MCP stdout is not JSON-RPC for $Method`: $line"
  }
}

function Send-McpNotification {
  param(
    [Parameter(Mandatory = $true)] [string]$Method,
    [Parameter(Mandatory = $false)] $Params
  )
  $payload = @{ jsonrpc = '2.0'; method = $Method }
  if ($null -ne $Params) { $payload.params = $Params }
  $process.StandardInput.WriteLine(($payload | ConvertTo-Json -Depth 8 -Compress))
  $process.StandardInput.Flush()
}

try {
  $initialize = Invoke-McpRequest -Id 1 -Method 'initialize' -Params @{
    protocolVersion = '2025-06-18'
    capabilities = @{}
    clientInfo = @{ name = 'art-agent-ci'; version = '1.0.0' }
  }
  if ($initialize.jsonrpc -ne '2.0' -or $initialize.id -ne 1) {
    throw 'Packaged MCP initialize envelope is invalid'
  }
  if ($initialize.result.serverInfo.name -ne 'art-agent') {
    throw "Packaged MCP server name mismatch: $($initialize.result.serverInfo.name)"
  }
  if ($initialize.result.serverInfo.version -ne $Version) {
    throw "Packaged MCP version mismatch: expected $Version, got $($initialize.result.serverInfo.version)"
  }
  Send-McpNotification -Method 'notifications/initialized' -Params @{}

  $listed = Invoke-McpRequest -Id 2 -Method 'tools/list' -Params @{}
  if ($listed.error) { throw "Packaged remote tools/list failed: $($listed.error.message)" }
  $actualTools = @($listed.result.tools | ForEach-Object { $_.name } | Sort-Object)
  $expectedTools = @(
    'git_diff',
    'git_log',
    'git_status',
    'health',
    'read_file',
    'search_text',
    'workspace_info',
    'workspace_tree'
  )
  $toolDiff = @(Compare-Object -ReferenceObject $expectedTools -DifferenceObject $actualTools)
  if ($toolDiff.Count -ne 0) {
    throw "Packaged remote tool surface mismatch. Expected: $($expectedTools -join ', '); actual: $($actualTools -join ', ')"
  }

  $healthResponse = Invoke-McpRequest -Id 3 -Method 'tools/call' -Params @{ name = 'health'; arguments = @{} }
  if ($healthResponse.error) { throw "Packaged remote health call failed: $($healthResponse.error.message)" }
  $healthText = ($healthResponse.result.content | Where-Object { $_.type -eq 'text' } | Select-Object -First 1).text
  if ([string]::IsNullOrWhiteSpace($healthText)) { throw 'Packaged remote health returned no text content' }
  $health = $healthText | ConvertFrom-Json
  if ($health.profile -ne 'remote-readonly') { throw "Unexpected packaged remote profile: $($health.profile)" }
  if ($health.allowWrite -ne $false -or $health.allowExec -ne $false -or $health.allowCodex -ne $false) {
    throw "Packaged remote effective permissions widened unexpectedly: $healthText"
  }

  $forbidden = Invoke-McpRequest -Id 4 -Method 'tools/call' -Params @{
    name = 'write_file'
    arguments = @{ path = 'should-not-exist.txt'; content = 'blocked' }
  }
  if (-not $forbidden.error) {
    throw 'Packaged remote write_file unexpectedly returned a successful protocol response'
  }
  if (Test-Path $forbiddenPath) {
    throw 'Packaged remote write_file created a file despite being outside the registered tool surface'
  }

  $remainingTask = $process.StandardOutput.ReadToEndAsync()
  $process.StandardInput.Close()
  if (-not $process.WaitForExit(2000)) {
    try { $process.Kill($true) } catch {}
    $process.WaitForExit()
  }
  $remaining = $remainingTask.GetAwaiter().GetResult()
  if (-not [string]::IsNullOrWhiteSpace($remaining)) {
    foreach ($line in @($remaining -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
      $protocolLines.Add($line)
      try { $null = $line | ConvertFrom-Json } catch { throw "Non-JSON stdout after packaged MCP requests: $line" }
    }
  }

  $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($stderr) { Write-Host $stderr }
  if ($stderr -notmatch [regex]::Escape("Art Agent MCP $Version running on stdio")) {
    throw 'Packaged MCP stderr did not contain the expected readiness banner'
  }
  if ($stderr -notmatch 'profile=remote-readonly \| write=false \| exec=false \| codex=false') {
    throw "Packaged MCP stderr did not prove remote effective permissions: $stderr"
  }
  if ($protocolLines.Count -ne 4) {
    throw "Expected exactly four packaged MCP response lines, found $($protocolLines.Count)"
  }

  Write-Host "Packaged remote MCP isolation passed via Electron Node mode for Art Agent $Version"
  Write-Host "Remote tools: $($actualTools -join ', ')"
} finally {
  if (-not $process.HasExited) {
    try { $process.Kill($true) } catch {}
    try { $process.WaitForExit() } catch {}
  }
}
