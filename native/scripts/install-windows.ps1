# PowerShell script for Windows installation
$ErrorActionPreference = "Stop"

$EXTENSION_ID = "aigaiddilbifffjcgfocgiaceflchjdn"
$APP_NAME = "com.vidown.native"
$MANIFEST_NAME = "$APP_NAME.json"

# Build binary for Windows
Write-Host "Building vidown-native for Windows..."
Set-Location (Split-Path -Parent $PSScriptRoot)

# Detect architecture
$ARCH = $env:PROCESSOR_ARCHITECTURE
if ($ARCH -eq "AMD64") {
    $GOARCH = "amd64"
    Write-Host "  → Building for x64 (amd64)..."
} elseif ($ARCH -eq "ARM64") {
    $GOARCH = "arm64"
    Write-Host "  → Building for ARM64..."
} else {
    Write-Error "Unsupported architecture: $ARCH"
    exit 1
}

$env:GOOS = "windows"
$env:GOARCH = $GOARCH
go build -o vidown-native.exe cmd/vidown-native/main.go

# Get absolute path to binary
$BINARY_PATH = Join-Path (Get-Location) "vidown-native.exe"
$BINARY_PATH = $BINARY_PATH -replace "\\", "\\"
Write-Host "✓ Binary created: $BINARY_PATH"

# Create manifest
$MANIFEST_DIR = "$env:APPDATA\Google\Chrome\NativeMessagingHosts"
New-Item -ItemType Directory -Force -Path $MANIFEST_DIR | Out-Null

$MANIFEST_CONTENT = @"
{
  "name": "$APP_NAME",
  "description": "Vidown Native Companion for HLS/DASH downloads",
  "path": "$BINARY_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
"@

$MANIFEST_PATH = Join-Path $MANIFEST_DIR $MANIFEST_NAME
Set-Content -Path $MANIFEST_PATH -Value $MANIFEST_CONTENT

# Create registry entry
$REG_PATH = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$APP_NAME"
New-Item -Path $REG_PATH -Force | Out-Null
Set-ItemProperty -Path $REG_PATH -Name "(Default)" -Value $MANIFEST_PATH

Write-Host "✓ Installed to: $MANIFEST_PATH"
Write-Host "✓ Registry key: $REG_PATH"
Write-Host "✓ Binary path: $BINARY_PATH"
Write-Host ""
Write-Host "Reload Chrome extension to connect to native host"
