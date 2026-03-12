# Register-MockmateProtocol.ps1
# This script registers the mockmate:// protocol so the web app can launch your Unity build automatically.

param (
    [Parameter(Mandatory=$true)]
    [string]$ExePath
)

if (-not (Test-Path $ExePath)) {
    Write-Error "Executable not found at: $ExePath"
    exit
}

$RegistryPath = "HKCU:\Software\Classes\mockmate"
$CommandPath = "$RegistryPath\shell\open\command"

# Create the keys
if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
}
New-ItemProperty -Path $RegistryPath -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
Set-Item -Path $RegistryPath -Value "URL:Mockmate Protocol"

if (-not (Test-Path $CommandPath)) {
    New-Item -Path $CommandPath -Recursive -Force | Out-Null
}

# The command line for the deep link
# "%1" will contain the full URL: mockmate://start-vr?bridge_token=...
$CommandValue = "`"$ExePath`" `"%1`""
Set-Item -Path $CommandPath -Value $CommandValue

Write-Host "Successfully registered mockmate:// to launch: $ExePath" -ForegroundColor Green
Write-Host "You can now click 'Take Test in VR' in the web app to launch your build automatically!"
