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
Remove-Item -Recurse -Force $workspace -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $workspace -Force | Out-Null
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

$request = @{
  jsonrpc = '2.0'
  id = 1
  method = 'initialize'
  params = @{
    protocolVersion = '2025-06-18'
    capabilities = @{}
    clientInfo = @{ name = 'art-agent-ci'; version = '1.0.0' }
  }
} | ConvertTo-Json -Depth 8 -Compress

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $exe.FullName
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.Environment['ELECTRON_RUN_AS_NODE'] = '1'
$startInfo.Environment['ART_AGENT_DATA_DIR'] = $dataDir
$startInfo.Environment.Remove('ART_AGENT_SMOKE_TEST') | Out-Null
$startInfo.Environment.Remove('ELECTRON_ENABLE_LOGGING') | Out-Null
$startInfo.ArgumentList.Add($entrypoint)
$startInfo.ArgumentList.Add('--workspace')
$startInfo.ArgumentList.Add($workspace)

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
if (-not $process.Start()) { throw 'Failed to start packaged ArtAgent.exe in Electron Node mode' }

$stderrTask = $process.StandardError.ReadToEndAsync()
$firstLineTask = $process.StandardOutput.ReadLineAsync()
$process.StandardInput.WriteLine($request)
$process.StandardInput.Flush()

if (-not $firstLineTask.Wait(10000)) {
  if (-not $process.HasExited) {
    try { $process.Kill($true) } catch {}
    try { $process.WaitForExit() } catch {}
  }
  $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($stderr) { Write-Host $stderr }
  throw 'Timed out waiting for packaged MCP initialize response in Electron Node mode'
}

$firstLine = $firstLineTask.GetAwaiter().GetResult()
$remainingTask = $process.StandardOutput.ReadToEndAsync()
$process.StandardInput.Close()
if (-not $process.WaitForExit(2000)) {
  try { $process.Kill($true) } catch {}
  $process.WaitForExit()
}
$remaining = $remainingTask.GetAwaiter().GetResult()
$stderr = $stderrTask.GetAwaiter().GetResult()
if ($stderr) { Write-Host $stderr }

$lines = @()
if (-not [string]::IsNullOrWhiteSpace($firstLine)) { $lines += $firstLine }
if (-not [string]::IsNullOrWhiteSpace($remaining)) {
  $lines += @($remaining -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}
if ($lines.Count -ne 1) {
  throw "Expected exactly one MCP stdout line, found $($lines.Count): $($lines -join ' | ')"
}

try {
  $response = $lines[0] | ConvertFrom-Json
} catch {
  throw "Packaged MCP stdout is not JSON-RPC: $($lines[0])"
}
if ($response.jsonrpc -ne '2.0' -or $response.id -ne 1) {
  throw "Packaged MCP response envelope invalid: $($lines[0])"
}
if ($response.result.serverInfo.name -ne 'art-agent') {
  throw "Packaged MCP server name mismatch: $($response.result.serverInfo.name)"
}
if ($response.result.serverInfo.version -ne $Version) {
  throw "Packaged MCP version mismatch: expected $Version, got $($response.result.serverInfo.version)"
}
if ($stderr -notmatch [regex]::Escape("Art Agent MCP $Version running on stdio")) {
  throw 'Packaged MCP stderr did not contain the expected readiness banner'
}

Write-Host "Packaged MCP stdio initialize passed via Electron Node mode for Art Agent $Version"
