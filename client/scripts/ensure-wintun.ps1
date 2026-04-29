param(
    [string]$BinPath = "",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$version = "0.14.1"
$url = "https://www.wintun.net/builds/wintun-$version.zip"
$expectedZipSha256 = "07C256185D6EE3652E09FA55C0B673E2624B565E02C4B9091C79CA7D2F24EF51"
$expectedDllSha256 = "E5DA8447DC2C320EDC0FC52FA01885C103DE8C118481F683643CACC3220DAFCE"

if ($OutputDir -eq "" -and $BinPath -ne "") {
    $OutputDir = Split-Path -Parent $BinPath
}
if ($OutputDir -eq "") {
    $OutputDir = Join-Path (Get-Location) "build\bin"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$dest = Join-Path $OutputDir "wintun.dll"
if (Test-Path $dest) {
    $hash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($hash -eq $expectedDllSha256) {
        Write-Host "wintun.dll already present"
        exit 0
    }
    Write-Host "Replacing unexpected wintun.dll hash: $hash"
}

$cacheDir = Join-Path $env:TEMP "AntiJitter\wintun-$version"
$zipPath = Join-Path $cacheDir "wintun-$version.zip"
$extractDir = Join-Path $cacheDir "extract"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

if (-not (Test-Path $zipPath)) {
    Write-Host "Downloading official Wintun $version"
    Invoke-WebRequest $url -OutFile $zipPath
}

$zipHash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($zipHash -ne $expectedZipSha256) {
    Remove-Item -LiteralPath $zipPath -Force
    throw "Wintun archive hash mismatch. Expected $expectedZipSha256, got $zipHash"
}

if (Test-Path $extractDir) {
    Remove-Item -LiteralPath $extractDir -Recurse -Force
}
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

$source = Join-Path $extractDir "wintun\bin\amd64\wintun.dll"
if (-not (Test-Path $source)) {
    throw "Official archive did not contain amd64\wintun.dll"
}

$dllHash = (Get-FileHash $source -Algorithm SHA256).Hash.ToUpperInvariant()
if ($dllHash -ne $expectedDllSha256) {
    throw "Wintun DLL hash mismatch. Expected $expectedDllSha256, got $dllHash"
}

Copy-Item -LiteralPath $source -Destination $dest -Force
Unblock-File $dest
Write-Host "Bundled wintun.dll -> $dest"
