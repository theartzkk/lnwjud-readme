param(
    [switch]$InstallSmoke
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'AWH Windows package verification must run on Windows.'
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$desktopDirectory = Join-Path $repositoryRoot 'apps\desktop'
$installerDirectory = Join-Path $desktopDirectory 'dist\installers'
$unpackedDirectory = Join-Path $installerDirectory 'win-unpacked'
$desktopPackagePath = Join-Path $desktopDirectory 'package.json'
$productName = 'Art’s Workspace Hub'

$desktopPackage = Get-Content -LiteralPath $desktopPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$desktopPackage.version
$windowsVersion = "$version.0"
$appExecutable = Join-Path $unpackedDirectory "$productName.exe"
$installer = Join-Path $installerDirectory "AWH-Setup-$version.exe"
$blockMap = "$installer.blockmap"

function Assert-Leaf([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label was not found: $Path"
    }
}

function Assert-AwhVersionInfo([string]$Path) {
    $info = (Get-Item -LiteralPath $Path).VersionInfo
    if ($info.ProductName -ne $productName) {
        throw "Unexpected ProductName for $Path: $($info.ProductName)"
    }
    if ($info.FileDescription -ne $productName) {
        throw "Unexpected FileDescription for $Path: $($info.FileDescription)"
    }
    if ($info.CompanyName -ne $productName) {
        throw "Unexpected CompanyName for $Path: $($info.CompanyName)"
    }
    if ($info.FileVersion -ne $windowsVersion -or $info.ProductVersion -ne $windowsVersion) {
        throw "Unexpected version metadata for $Path: $($info.FileVersion) / $($info.ProductVersion)"
    }
}

function Stop-ProcessTree([int]$ProcessId) {
    $taskKill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    & $taskKill /PID $ProcessId /T /F *> $null
}

function Invoke-AwhLaunchSmoke([string]$Executable) {
    Assert-Leaf $Executable 'AWH application executable'
    $smokeData = Join-Path ([IO.Path]::GetTempPath()) ("awh-launch-smoke-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $smokeData -Force | Out-Null
    $previousAwhDataPath = $env:AWH_DATA_PATH
    $previousCompatibilityPath = $env:LNWJUD_DATA_PATH
    $process = $null
    try {
        $env:AWH_DATA_PATH = $smokeData
        Remove-Item Env:LNWJUD_DATA_PATH -ErrorAction SilentlyContinue
        $process = Start-Process -FilePath $Executable -PassThru
        Start-Sleep -Seconds 5
        $process.Refresh()
        if ($process.HasExited) {
            throw "AWH launch smoke exited early with code $($process.ExitCode): $Executable"
        }
        Write-Output "AWH_LAUNCH_SMOKE=PASS"
    }
    finally {
        if ($null -ne $process) {
            try {
                $process.Refresh()
                if (-not $process.HasExited) { Stop-ProcessTree $process.Id }
            }
            catch { }
        }
        if ($null -eq $previousAwhDataPath) { Remove-Item Env:AWH_DATA_PATH -ErrorAction SilentlyContinue }
        else { $env:AWH_DATA_PATH = $previousAwhDataPath }
        if ($null -eq $previousCompatibilityPath) { Remove-Item Env:LNWJUD_DATA_PATH -ErrorAction SilentlyContinue }
        else { $env:LNWJUD_DATA_PATH = $previousCompatibilityPath }
        Remove-Item -LiteralPath $smokeData -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Wait-ForLeaf([string]$Path, [bool]$ShouldExist, [int]$Seconds = 60) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $exists = Test-Path -LiteralPath $Path -PathType Leaf
        if ($exists -eq $ShouldExist) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for file state=$ShouldExist: $Path"
}

Assert-Leaf $appExecutable 'Packaged AWH executable'
Assert-Leaf $installer 'AWH NSIS installer'
Assert-Leaf $blockMap 'AWH installer blockmap'
Assert-AwhVersionInfo $appExecutable
Write-Output "AWH_APP=$appExecutable"
Write-Output "AWH_APP_SHA256=$((Get-FileHash -LiteralPath $appExecutable -Algorithm SHA256).Hash.ToLowerInvariant())"
Write-Output "AWH_INSTALLER=$installer"
Write-Output "AWH_INSTALLER_SHA256=$((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant())"
Invoke-AwhLaunchSmoke $appExecutable

if ($InstallSmoke) {
    $programsDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $shortcut = Join-Path $programsDirectory "$productName.lnk"
    $normalInstall = Join-Path $env:LOCALAPPDATA "Programs\$productName\$productName.exe"
    if (Test-Path -LiteralPath $shortcut -PathType Leaf) {
        throw "Install smoke refused because an AWH Start Menu shortcut already exists: $shortcut"
    }
    if (Test-Path -LiteralPath $normalInstall -PathType Leaf) {
        throw "Install smoke refused because AWH already appears installed: $normalInstall"
    }

    $installRoot = Join-Path $env:LOCALAPPDATA ("AWH-Install-Smoke-" + [guid]::NewGuid().ToString('N'))
    $installedApp = Join-Path $installRoot "$productName.exe"
    try {
        $installProcess = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru
        if ($installProcess.ExitCode -ne 0) { throw "Silent installer exited with code $($installProcess.ExitCode)" }
        Wait-ForLeaf $installedApp $true
        Wait-ForLeaf $shortcut $true
        Assert-AwhVersionInfo $installedApp
        Invoke-AwhLaunchSmoke $installedApp

        $uninstaller = Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File | Select-Object -First 1
        if ($null -eq $uninstaller) { throw "AWH uninstaller was not found under $installRoot" }
        $uninstallProcess = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
        if ($uninstallProcess.ExitCode -ne 0) { throw "Silent uninstaller exited with code $($uninstallProcess.ExitCode)" }
        Wait-ForLeaf $installedApp $false
        Wait-ForLeaf $shortcut $false
        Write-Output 'AWH_INSTALL_LAUNCH_UNINSTALL_SMOKE=PASS'
    }
    finally {
        Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $shortcut -PathType Leaf) {
            Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
        }
    }
}
