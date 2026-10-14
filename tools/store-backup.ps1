<#
.SYNOPSIS
  takgon-mods의 $.store 파일을 백업·복원한다(마켓플레이스 이름을 바꾸거나 store 파일을 만지기 전에 쓴다).

.DESCRIPTION
  store 파일은 <설정 폴더>\plugins\store\takgon-mods_<마켓플레이스 이름>-<해시>.json 한 개다.
  해시는 sha256("takgon-mods@<마켓플레이스 이름>")의 앞 12자리라서, 마켓플레이스 이름을 바꾸면 파일명이 달라진다.

  List     store 파일과 백업 폴더 목록(크기, 수정 시각, 키 개수)을 보여 준다. 아무것도 바꾸지 않는다.
  Backup   store 파일을 <설정 폴더>\backup-takgon-store-<시각> 폴더에 복사하고, 복사본이 원본과 같은지 확인한다.
  Restore  백업한 파일을 현재 설치된 마켓플레이스 이름에 맞는 파일명으로 복사한다.
           - 파일명이 백업과 같으면 그 파일을 덮어쓴다.
           - 파일명이 다르면(마켓플레이스 이름이 바뀐 경우) 백업을 새 파일명으로 복사한다.
           덮어쓰기 전에 현재 파일을 백업 폴더에 before-restore-* 로 남긴다.

  Claude Code 세션이 열려 있으면 엔진이 파일을 덮어쓸 수 있어, Restore는 열린 세션이 있으면 멈춘다(-Force로 무시).
  실제 설정 폴더는 CLAUDE_CONFIG_DIR 환경변수가 있으면 그 값, 없으면 %USERPROFILE%\.claude 이다.

.PARAMETER Action
  List, Backup, Restore 중 하나.
.PARAMETER ConfigDir
  Claude Code 설정 폴더. 기본: $env:CLAUDE_CONFIG_DIR, 없으면 $env:USERPROFILE\.claude.
.PARAMETER BackupDir
  Backup: 저장할 폴더(기본: <설정 폴더>\backup-takgon-store-<시각>).
  Restore: 복원할 백업 폴더(기본: 가장 최근 backup-takgon-store-* 폴더).
.PARAMETER Marketplace
  Restore 대상 마켓플레이스 이름. 기본: installed_plugins.json에 있는 takgon-mods@<이름>의 <이름>.
.PARAMETER Force
  Restore에서 열린 Claude Code 세션이 있어도 계속한다(권장하지 않는다).

.EXAMPLE
  # 마켓플레이스를 바꾸기 전: 열린 세션을 모두 닫고 백업
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\store-backup.ps1 Backup

.EXAMPLE
  # 전환 후 데이터가 비어 있으면: 세션을 모두 닫고 복원(미리 보려면 -WhatIf)
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\store-backup.ps1 Restore

.NOTES
  프로젝트 해시(키 p/<해시>/…)는 프로젝트 루트 경로로 정해져, 경로가 바뀐 프로젝트의 데이터는 복원해도 새 경로에서 보이지 않는다.
  새 파일에만 있는 데이터는 덮어쓰면 사라진다. 그래서 덮어쓰기 전에 현재 파일을 before-restore-* 로 보관한다.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('List', 'Backup', 'Restore')]
  [string]$Action,
  [string]$ConfigDir,
  [string]$BackupDir,
  [string]$Marketplace,
  [switch]$Force
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$PluginName = 'takgon-mods'
$MaxBytes = 4MB   # store 파일 상한(4 MiB)

if (-not $ConfigDir) {
  if ($env:CLAUDE_CONFIG_DIR) { $ConfigDir = $env:CLAUDE_CONFIG_DIR } else { $ConfigDir = Join-Path $env:USERPROFILE '.claude' }
}
$ConfigDir = [System.IO.Path]::GetFullPath($ConfigDir)
$StoreDir = Join-Path $ConfigDir 'plugins\store'

function Get-StoreFileName([string]$market) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$PluginName@$market"))
  $hash = (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 12)
  return "${PluginName}_${market}-${hash}.json"
}

function Get-InstalledMarketplace {
  $path = Join-Path $ConfigDir 'plugins\installed_plugins.json'
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $json = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not ($json.PSObject.Properties.Name -contains 'plugins')) { return $null }
  $names = @($json.plugins.PSObject.Properties.Name | Where-Object { $_ -like "$PluginName@*" })
  if ($names.Count -eq 0) { return $null }
  return $names[0].Substring($PluginName.Length + 1)
}

# store 파일이 올바른 JSON 객체인지 확인하고 키 개수를 돌려준다. 문제가 있으면 예외.
function Test-StoreFile([string]$path) {
  $item = Get-Item -LiteralPath $path
  if ($item.Length -gt $MaxBytes) { throw "크기가 4 MiB 상한을 넘는다: $path ($($item.Length) 바이트)" }
  $obj = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -eq $obj) { throw "비어 있거나 JSON 객체가 아니다: $path" }
  return @($obj.PSObject.Properties).Count
}

function Get-OpenSessionCount {
  return @(Get-Process -Name 'claude' -ErrorAction SilentlyContinue).Count
}

# Get-FileHash cmdlet 대신 .NET을 쓴다(PowerShell 7 모듈 경로를 물려받은 5.1에서는 cmdlet을 못 찾는다).
function Get-FileHashHex([string]$path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $bytes = $sha.ComputeHash([System.IO.File]::ReadAllBytes($path)) } finally { $sha.Dispose() }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-LatestBackupDir {
  $dirs = @(Get-ChildItem -LiteralPath $ConfigDir -Directory -Filter 'backup-takgon-store-*' -ErrorAction SilentlyContinue | Sort-Object Name)
  if ($dirs.Count -eq 0) { return $null }
  return $dirs[-1].FullName
}

Write-Host "설정 폴더 : $ConfigDir"
Write-Host "store 폴더: $StoreDir"

switch ($Action) {
  'List' {
    $files = @(Get-ChildItem -LiteralPath $StoreDir -Filter "${PluginName}_*.json" -ErrorAction SilentlyContinue)
    Write-Host ''
    Write-Host '[store 파일]'
    if ($files.Count -eq 0) { Write-Host '  (없음)' }
    foreach ($f in $files) {
      try { $keys = "키 $(Test-StoreFile $f.FullName)개" } catch { $keys = "읽기 실패: $($_.Exception.Message)" }
      Write-Host ("  {0}  {1:N0} 바이트  {2:yyyy-MM-dd HH:mm}  {3}" -f $f.Name, $f.Length, $f.LastWriteTime, $keys)
    }
    $market = Get-InstalledMarketplace
    if ($market) { Write-Host ("  현재 설치: {0}@{1} → 기대 파일명 {2}" -f $PluginName, $market, (Get-StoreFileName $market)) }
    Write-Host ''
    Write-Host '[백업 폴더]'
    $dirs = @(Get-ChildItem -LiteralPath $ConfigDir -Directory -Filter 'backup-takgon-store-*' -ErrorAction SilentlyContinue | Sort-Object Name)
    if ($dirs.Count -eq 0) { Write-Host '  (없음)' }
    foreach ($d in $dirs) {
      $n = @(Get-ChildItem -LiteralPath $d.FullName -Filter "${PluginName}_*.json").Count
      Write-Host ("  {0}  store 파일 {1}개" -f $d.Name, $n)
    }
  }

  'Backup' {
    $files = @(Get-ChildItem -LiteralPath $StoreDir -Filter "${PluginName}_*.json" -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { throw "백업할 store 파일이 없다: $StoreDir\${PluginName}_*.json" }
    if (-not $BackupDir) { $BackupDir = Join-Path $ConfigDir ("backup-takgon-store-{0:yyyyMMdd-HHmmss}" -f (Get-Date)) }
    $BackupDir = [System.IO.Path]::GetFullPath($BackupDir)
    if ((Test-Path -LiteralPath $BackupDir) -and @(Get-ChildItem -LiteralPath $BackupDir -Force).Count -gt 0) {
      throw "백업 폴더가 비어 있지 않다: $BackupDir"
    }
    if ((Get-OpenSessionCount) -gt 0) {
      Write-Warning '열린 Claude Code 세션이 있다. 세션이 쓰는 중이면 복사본이 최신이 아닐 수 있으니 모두 닫고 다시 하는 편이 안전하다.'
    }
    foreach ($f in $files) { [void](Test-StoreFile $f.FullName) }   # 깨진 파일을 백업본으로 믿지 않도록 먼저 읽어 본다
    if ($PSCmdlet.ShouldProcess($BackupDir, "store 파일 $($files.Count)개 백업")) {
      New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
      foreach ($f in $files) {
        $dest = Join-Path $BackupDir $f.Name
        Copy-Item -LiteralPath $f.FullName -Destination $dest
        if ((Get-FileHashHex $f.FullName) -ne (Get-FileHashHex $dest)) { throw "복사본이 원본과 다르다: $dest" }
        Write-Host ("백업 완료: {0}  ({1:N0} 바이트, 원본과 해시 동일)" -f $dest, $f.Length)
      }
    }
  }

  'Restore' {
    if (-not $BackupDir) { $BackupDir = Get-LatestBackupDir }
    if (-not $BackupDir -or -not (Test-Path -LiteralPath $BackupDir)) { throw "복원할 백업 폴더가 없다. -BackupDir로 지정한다." }
    $BackupDir = [System.IO.Path]::GetFullPath($BackupDir)
    $sources = @(Get-ChildItem -LiteralPath $BackupDir -Filter "${PluginName}_*.json")
    if ($sources.Count -eq 0) { throw "백업 폴더에 ${PluginName}_*.json 이 없다: $BackupDir" }

    if (-not $Marketplace) { $Marketplace = Get-InstalledMarketplace }
    if (-not $Marketplace) { throw "설치된 마켓플레이스 이름을 알 수 없다(installed_plugins.json에 $PluginName@<이름>이 없다). -Marketplace로 지정한다." }
    $targetName = Get-StoreFileName $Marketplace
    $target = Join-Path $StoreDir $targetName

    $same = @($sources | Where-Object { $_.Name -eq $targetName })
    if ($same.Count -eq 1) { $source = $same[0]; $mode = '같은 파일명(덮어쓰기)' }
    elseif ($sources.Count -eq 1) { $source = $sources[0]; $mode = "파일명이 다름(마켓플레이스 이름 변경): $($source.Name) → $targetName" }
    else { throw "백업에 store 파일이 여러 개이고 현재 파일명($targetName)과 같은 것이 없다. 하나만 남긴 폴더를 -BackupDir로 지정한다." }

    $count = Test-StoreFile $source.FullName
    Write-Host "복원 원본 : $($source.FullName)  (키 ${count}개)"
    Write-Host "복원 대상 : $target"
    Write-Host "방식      : $mode"

    $open = Get-OpenSessionCount
    if ($open -gt 0 -and -not $Force) {
      throw "열린 Claude Code 세션이 $open 개 있다. 모두 닫고 다시 실행한다(무시하려면 -Force)."
    }
    if ($open -gt 0) { Write-Warning "열린 세션이 $open 개 있지만 -Force라 계속한다." }

    if ($PSCmdlet.ShouldProcess($target, "백업 $($source.Name) 로 복원")) {
      New-Item -ItemType Directory -Force -Path $StoreDir | Out-Null
      if (Test-Path -LiteralPath $target) {
        $keep = Join-Path $BackupDir ("before-restore-{0:yyyyMMdd-HHmmss}-{1}" -f (Get-Date), $targetName)
        Copy-Item -LiteralPath $target -Destination $keep
        Write-Host "현재 파일 보관: $keep"
      }
      Copy-Item -LiteralPath $source.FullName -Destination $target -Force
      if ((Get-FileHashHex $source.FullName) -ne (Get-FileHashHex $target)) { throw "복원된 파일이 백업과 다르다: $target" }
      Write-Host '복원 완료. Claude Code를 다시 열어 /pin list·/panel로 데이터가 보이는지 확인한다.'
    }
  }
}
