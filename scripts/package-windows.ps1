$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'AWH Windows packaging must run on Windows so the private Node runtime is generated natively.'
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$desktopDirectory = Join-Path $repositoryRoot 'apps\desktop'
$installerDirectory = Join-Path $desktopDirectory 'dist\installers'
$unpackedDirectory = Join-Path $installerDirectory 'win-unpacked'
$desktopPackagePath = Join-Path $desktopDirectory 'package.json'
$iconPath = Join-Path $desktopDirectory 'build\icon.ico'
$resourceProductName = 'Art’s Workspace Hub'
$winCodeSignVersion = '2.6.0'
$winCodeSignArchiveSha256 = 'cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4'
$rceditSha256 = 'ab53500d556fd824636621bca7dbecd8583ba181891c3e9efdcf16b72a28b0cd'
$winCodeSignUrl = "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-$winCodeSignVersion/winCodeSign-$winCodeSignVersion.7z"
$toolCache = Join-Path $env:LOCALAPPDATA "AWH\build-tools\winCodeSign-$winCodeSignVersion"
$rceditPath = Join-Path $toolCache 'rcedit-x64.exe'

function Assert-Sha256([string]$Path, [string]$Expected) {
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected) {
        throw "Integrity check failed for $Path. Expected $Expected, got $actual"
    }
}

function Get-AwhRcedit {
    if (Test-Path -LiteralPath $rceditPath -PathType Leaf) {
        Assert-Sha256 $rceditPath $rceditSha256
        return $rceditPath
    }

    New-Item -ItemType Directory -Path $toolCache -Force | Out-Null
    $archivePath = Join-Path $toolCache "winCodeSign-$winCodeSignVersion.7z"
    Invoke-WebRequest -UseBasicParsing -Uri $winCodeSignUrl -OutFile $archivePath
    Assert-Sha256 $archivePath $winCodeSignArchiveSha256

    $sevenZip = Join-Path $repositoryRoot 'node_modules\.pnpm\7zip-bin@5.2.0\node_modules\7zip-bin\win\x64\7za.exe'
    if (-not (Test-Path -LiteralPath $sevenZip -PathType Leaf)) {
        throw "Pinned 7-Zip helper not found: $sevenZip"
    }
    & $sevenZip e -y $archivePath 'rcedit-x64.exe' "-o$toolCache" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to extract rcedit-x64.exe (exit $LASTEXITCODE)" }
    Assert-Sha256 $rceditPath $rceditSha256
    return $rceditPath
}

$desktopPackage = Get-Content -LiteralPath $desktopPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$desktopPackage.version
$windowsVersion = "$version.0"

Push-Location $repositoryRoot
try {
    # Build Windows-only bundled runtime first. Do not use package:windows here:
    # electron-builder's normal resource-edit path expands unrelated macOS
    # symlinks from winCodeSign and requires Developer Mode on locked-down PCs.
    & corepack pnpm@10.15.0 --filter '@lnwjud/desktop' build
    if ($LASTEXITCODE -ne 0) { throw "Desktop build failed with exit code $LASTEXITCODE" }

    Push-Location $desktopDirectory
    try {
        & corepack pnpm@10.15.0 exec electron-builder --config electron-builder.yml --win --dir --x64 --publish never --config.win.signAndEditExecutable=false
        if ($LASTEXITCODE -ne 0) { throw "Unpacked Windows build failed with exit code $LASTEXITCODE" }
    }
    finally { Pop-Location }

    $appExecutablePath = Join-Path $unpackedDirectory "$resourceProductName.exe"
    if (-not (Test-Path -LiteralPath $appExecutablePath -PathType Leaf)) {
        throw "Expected AWH application executable was not produced: $appExecutablePath"
    }
    $appExecutable = Get-Item -LiteralPath $appExecutablePath
    $rcedit = Get-AwhRcedit

    & $rcedit $appExecutable.FullName `
        '--set-version-string' 'FileDescription' $resourceProductName `
        '--set-version-string' 'ProductName' $resourceProductName `
        '--set-version-string' 'CompanyName' $resourceProductName `
        '--set-file-version' $windowsVersion `
        '--set-product-version' $windowsVersion `
        '--set-icon' $iconPath
    if ($LASTEXITCODE -ne 0) { throw "AWH resource branding failed with exit code $LASTEXITCODE" }

    $versionInfo = (Get-Item -LiteralPath $appExecutable.FullName).VersionInfo
    if ($versionInfo.ProductName -ne $resourceProductName -or $versionInfo.FileDescription -ne $resourceProductName) {
        throw 'AWH resource branding verification failed.'
    }
    if ($versionInfo.FileVersion -ne $windowsVersion -or $versionInfo.ProductVersion -ne $windowsVersion) {
        throw "AWH version metadata verification failed: $($versionInfo.FileVersion) / $($versionInfo.ProductVersion)"
    }

    Push-Location $desktopDirectory
    try {
        & corepack pnpm@10.15.0 exec electron-builder --config electron-builder.yml --prepackaged $unpackedDirectory --win nsis --x64 --publish never --config.win.signAndEditExecutable=false
        if ($LASTEXITCODE -ne 0) { throw "NSIS packaging failed with exit code $LASTEXITCODE" }
    }
    finally { Pop-Location }

    $installer = Join-Path $installerDirectory "AWH-Setup-$version.exe"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw "Expected installer was not produced: $installer"
    }

    Write-Output "AWH_APP=$($appExecutable.FullName)"
    Write-Output "AWH_APP_SHA256=$((Get-FileHash -LiteralPath $appExecutable.FullName -Algorithm SHA256).Hash.ToLowerInvariant())"
    Write-Output "AWH_INSTALLER=$installer"
    Write-Output "AWH_INSTALLER_SHA256=$((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant())"
}
finally {
    Pop-Location
}
