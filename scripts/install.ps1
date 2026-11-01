# =====================================================================
# Shine Browser — standalone installer (Windows)
# Copies the packaged build into your user profile, creates the Desktop
# shortcut, Start menu shortcut and pins the app to the taskbar.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# =====================================================================

$ErrorActionPreference = 'Stop'

$Source   = Join-Path $PSScriptRoot '..'
$ExeSrc   = Join-Path $Source 'dist\win-unpacked\Shine Browser.exe'

$LocalApp = Join-Path $env:LOCALAPPDATA 'Shine Browser'
$Desktop  = [Environment]::GetFolderPath('Desktop')
$StartDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Shine Browser'
$StartLnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Shine Browser.lnk'
$DeskLnk  = Join-Path $Desktop 'Shine Browser.lnk'

Write-Host ''
Write-Host '  Shine Browser installer' -ForegroundColor White
Write-Host '  ----------------------' -ForegroundColor DarkGray
Write-Host ''

if (-not (Test-Path $ExeSrc)) {
    Write-Host "  Packaged build not found at $ExeSrc" -ForegroundColor Red
    Write-Host '  Run "npm run dist" first, then re-run this installer.' -ForegroundColor Yellow
    exit 1
}

# 1. Copy application files --------------------------------------------------
Write-Host '  [1/4] Installing Shine Browser files...' -NoNewline
New-Item -ItemType Directory -Force -Path $LocalApp | Out-Null
Copy-Item -Path (Join-Path $Source 'dist\win-unpacked\*') -Destination $LocalApp -Recurse -Force
Write-Host ' done' -ForegroundColor Green

$Exe = Join-Path $LocalApp 'Shine Browser.exe'

# 2. Desktop shortcut --------------------------------------------------------
Write-Host '  [2/4] Creating Desktop shortcut...' -NoNewline
$sh = New-Object -ComObject WScript.Shell
$l = $sh.CreateShortcut($DeskLnk)
$l.TargetPath = $Exe
$l.WorkingDirectory = $LocalApp
$l.IconLocation = "$LocalApp\resources\app\build\icon.ico,0"
$l.Description = 'Shine Browser — browse with Shine AI side by side'
$l.Save()
Write-Host ' done' -ForegroundColor Green

# 3. Start menu shortcut -----------------------------------------------------
Write-Host '  [3/4] Adding Start menu shortcut...' -NoNewline
New-Item -ItemType Directory -Force -Path $StartDir | Out-Null
$l2 = $sh.CreateShortcut((Join-Path $StartDir 'Shine Browser.lnk'))
$l2.TargetPath = $Exe
$l2.WorkingDirectory = $LocalApp
$l2.IconLocation = "$LocalApp\resources\app\build\icon.ico,0"
$l2.Description = 'Shine Browser — browse with Shine AI side by side'
$l2.Save()
# flat copy so Windows Search finds it immediately
$l3 = $sh.CreateShortcut($StartLnk)
$l3.TargetPath = $Exe
$l3.WorkingDirectory = $LocalApp
$l3.IconLocation = "$LocalApp\resources\app\build\icon.ico,0"
$l3.Save()
Write-Host ' done' -ForegroundColor Green

# 4. Pin to taskbar ----------------------------------------------------------
# The TaskBar folder under the Quick Launch profile is the canonical pin store.
# Windows 10/11 no longer expose "Pin to taskbar" through Shell verbs, so we
# copy the shortcut there directly and refresh the icon cache.
Write-Host '  [4/4] Pinning to taskbar...' -NoNewline
$TaskBarDir = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
try {
    New-Item -ItemType Directory -Force -Path $TaskBarDir | Out-Null
    Copy-Item -Path $DeskLnk -Destination (Join-Path $TaskBarDir 'Shine Browser.lnk') -Force
    ie4uinit.exe -show | Out-Null
    Write-Host ' done' -ForegroundColor Green
} catch {
    Write-Host ' skipped' -ForegroundColor Yellow
}

Write-Host ''
Write-Host "  Installed to $LocalApp" -ForegroundColor White
Write-Host "  Desktop shortcut   : $DeskLnk" -ForegroundColor DarkGray
Write-Host "  Start menu shortcut: $StartLnk" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Launching Shine Browser...' -ForegroundColor White
Start-Process $Exe
