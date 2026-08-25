$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$desktopDirectory = Join-Path $repositoryRoot 'apps\desktop'
$installerDirectory = Join-Path $desktopDirectory 'dist\installers'
$previousBuildCacheFlag = $env:ELECTRON_BUILDER_DISABLE_BUILD_CACHE

# electron-builder 26 may initialize winCodeSign solely for its executable cache
# before rcedit runs. Disable that cache for packaging so Windows does not need
# Developer Mode just to extract unrelated symlinks from the vendor archive.
$env:ELECTRON_BUILDER_DISABLE_BUILD_CACHE = 'true'

Push-Location $repositoryRoot
try {
    & corepack pnpm@10.15.0 --filter @lnwjud/desktop package:windows
    if ($LASTEXITCODE -ne 0) {
        throw "Windows packaging failed with exit code $LASTEXITCODE"
    }

    if (-not (Test-Path -LiteralPath $installerDirectory -PathType Container)) {
        throw "Installer directory was not created: $installerDirectory"
    }

    $installers = @(Get-ChildItem -LiteralPath $installerDirectory -Filter '*.exe' -File)
    if ($installers.Count -eq 0) {
        throw "No Windows installer was produced in $installerDirectory"
    }

    $installers | Select-Object -ExpandProperty FullName
}
finally {
    Pop-Location
    if ($null -eq $previousBuildCacheFlag) {
        Remove-Item Env:ELECTRON_BUILDER_DISABLE_BUILD_CACHE -ErrorAction SilentlyContinue
    }
    else {
        $env:ELECTRON_BUILDER_DISABLE_BUILD_CACHE = $previousBuildCacheFlag
    }
}
