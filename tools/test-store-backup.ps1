<#
.SYNOPSIS
  tools/store-backup.ps1을 가짜 설정 폴더에서 시험한다(실제 ~/.claude와 Claude Code 세션은 쓰지 않는다).

.DESCRIPTION
  임시 폴더에 가짜 plugins\store\*.json 과 plugins\installed_plugins.json 을 만들고, store-backup.ps1을
  Windows PowerShell 5.1(powershell.exe, 기본) 또는 -Shell pwsh.exe(PowerShell 7)로 실행해 List·Backup·Restore의 동작을 확인한다.
  하나라도 틀리면 종료 코드 1.
  이 PC의 claude 프로세스 유무에 영향을 받는 항목(열린 세션 거부)은 프로세스가 있을 때만 확인한다.
  실제 엔진 세션과 함께 돌린 검증은 이 스크립트가 아니라 README의 수동 절차로 한다.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\test-store-backup.ps1
  pwsh -NoProfile -File tools\test-store-backup.ps1 -Shell pwsh.exe
#>
param(
  [string]$Script = (Join-Path $PSScriptRoot 'store-backup.ps1'),
  # store-backup.ps1을 실행할 PowerShell: powershell.exe(Windows PowerShell 5.1, 기본) 또는 pwsh.exe(PowerShell 7)
  [ValidateSet('powershell.exe', 'pwsh.exe')][string]$Shell = 'powershell.exe'
)

$ErrorActionPreference = 'Continue'
$base = Join-Path $env:TEMP ("takgon-sbtest-{0}" -f ([guid]::NewGuid().ToString('N').Substring(0, 8)))
$cfg = Join-Path $base 'cfg'
$store = Join-Path $cfg 'plugins\store'
New-Item -ItemType Directory -Force $store | Out-Null
$results = New-Object System.Collections.Generic.List[object]

function Check([string]$name, [bool]$ok) { $results.Add([pscustomobject]@{ Ok = $ok; Name = $name }) }
function Run([string[]]$extra) {
  $out = & $Shell -NoProfile -ExecutionPolicy Bypass -File $Script @extra 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Out = $out }
}
function Sha([string]$p) {
  $s = [System.Security.Cryptography.SHA256]::Create()
  $b = $s.ComputeHash([System.IO.File]::ReadAllBytes($p))
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}
function Write-Installed([string[]]$markets) {
  $plugins = [ordered]@{}
  foreach ($m in $markets) { $plugins["takgon-mods@$m"] = @(@{ scope = 'user'; version = '0.4.8' }) }
  $o = [ordered]@{ version = 2; plugins = $plugins }
  [System.IO.File]::WriteAllText((Join-Path $cfg 'plugins\installed_plugins.json'), ($o | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
}
function Put([string]$path, [string]$text) { [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false))) }

try {
  $claudeRunning = @(Get-Process -Name claude -ErrorAction SilentlyContinue).Count -gt 0
  Write-Installed @('takgon')
  $orig = Join-Path $store 'takgon-mods_takgon-2488473fd961.json'
  Put $orig '{"g/core/modules":{"panel":false},"p/aaaa1111/m6/pins":[{"text":"keep-me"}]}'
  $origHash = Sha $orig

  # List
  $r = Run @('List', '-ConfigDir', $cfg)
  Check 'List: exit 0' ($r.Code -eq 0)
  Check 'List: file name and expected name (hash 2488473fd961)' (($r.Out -match 'takgon-mods_takgon-2488473fd961\.json') -and ($r.Out -match '2488473fd961'))

  # Backup
  $bk = Join-Path $base 'bk1'
  $r = Run @('Backup', '-ConfigDir', $cfg, '-BackupDir', $bk)
  Check 'Backup: exit 0' ($r.Code -eq 0)
  Check 'Backup: copy is identical' ((Test-Path "$bk\takgon-mods_takgon-2488473fd961.json") -and ((Sha "$bk\takgon-mods_takgon-2488473fd961.json") -eq $origHash))
  $r = Run @('Backup', '-ConfigDir', $cfg, '-BackupDir', $bk)
  Check 'Backup: non-empty dir refused' ($r.Code -ne 0)
  $r = Run @('Backup', '-ConfigDir', $cfg, '-BackupDir', (Join-Path $base 'bk-whatif'), '-WhatIf')
  Check 'Backup: -WhatIf creates nothing' (-not (Test-Path (Join-Path $base 'bk-whatif')))

  # Restore, same name
  Put $orig '{"g/core/modules":{"panel":true}}'
  $changedHash = Sha $orig
  if ($claudeRunning) {
    $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $bk)
    Check 'Restore: refused while a claude process exists (no -Force)' (($r.Code -ne 0) -and ((Sha $orig) -eq $changedHash))
  }
  $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $bk, '-WhatIf')
  Check 'Restore: -WhatIf runs even with claude processes and changes nothing' (($r.Code -eq 0) -and ((Sha $orig) -eq $changedHash))
  $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $bk, '-Force')
  Check 'Restore: same name exit 0' ($r.Code -eq 0)
  Check 'Restore: same name content equals backup' ((Sha $orig) -eq $origHash)
  Check 'Restore: pre-restore copy kept' (@(Get-ChildItem $bk -Filter 'before-restore-*').Count -eq 1)

  # Restore, marketplace renamed
  Write-Installed @('takgon-alt')
  $new = Join-Path $store 'takgon-mods_takgon-alt-610bad6656c8.json'
  Put $new '{"p/bbbb2222/core/commands":{"mods":{"isListed":true}}}'
  $newBefore = Sha $new
  $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $bk, '-Force')
  Check 'Restore: renamed exit 0' ($r.Code -eq 0)
  Check 'Restore: renamed -> new file equals backup' ((Sha $new) -eq $origHash)
  Check 'Restore: renamed -> old file untouched' ((Sha $orig) -eq $origHash)
  Check 'Restore: renamed -> previous new file kept as before-restore' (@(Get-ChildItem $bk -Filter 'before-restore-*takgon-alt*' | Where-Object { (Sha $_.FullName) -eq $newBefore }).Count -eq 1)

  # Invalid / ambiguous backups
  $bad = Join-Path $base 'bk-bad'; New-Item -ItemType Directory $bad | Out-Null
  Put (Join-Path $bad 'takgon-mods_takgon-alt-610bad6656c8.json') '{ not json'
  $beforeBad = Sha $new
  $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $bad, '-Force')
  Check 'Restore: invalid JSON refused, target untouched' (($r.Code -ne 0) -and ((Sha $new) -eq $beforeBad))
  foreach ($case in @(@('array', '[1,2]'), @('string', '"hello"'))) {
    $d = Join-Path $base ("bk-" + $case[0]); New-Item -ItemType Directory $d | Out-Null
    Put (Join-Path $d 'takgon-mods_takgon-alt-610bad6656c8.json') $case[1]
    $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $d, '-Force')
    Check ("Restore: non-object JSON ({0}) refused, target untouched" -f $case[0]) (($r.Code -ne 0) -and ((Sha $new) -eq $beforeBad))
  }
  $multi = Join-Path $base 'bk-multi'; New-Item -ItemType Directory $multi | Out-Null
  Put (Join-Path $multi 'takgon-mods_a-111111111111.json') '{}'
  Put (Join-Path $multi 'takgon-mods_b-222222222222.json') '{}'
  $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $multi, '-Force')
  Check 'Restore: ambiguous backup refused' ($r.Code -ne 0)

  # -Marketplace is validated (no path traversal out of the store folder)
  $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $bk, '-Marketplace', '..\..\..\escaped', '-Force')
  Check 'Restore: -Marketplace with path separators refused' (($r.Code -ne 0) -and -not (Test-Path (Join-Path $cfg 'plugins\escaped*')))

  # installed_plugins.json variants
  $ip = Join-Path $cfg 'plugins\installed_plugins.json'
  foreach ($v in @('', '{"plugins":null}', '{"plugins":{}}', '[]', '{"version":1}')) {
    Put $ip $v
    $r = Run @('List', '-ConfigDir', $cfg)
    Check ("List: installed_plugins.json variant [{0}] does not crash" -f $v) ($r.Code -eq 0)
    $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $bk, '-Force')
    Check ("Restore: variant [{0}] asks for -Marketplace instead of crashing" -f $v) (($r.Code -ne 0) -and ($r.Out -match 'Marketplace'))
  }
  Write-Installed @('mkt-one', 'mkt-two')
  $r = Run @('Restore', '-ConfigDir', $cfg, '-BackupDir', $bk, '-Force')
  Check 'Restore: several marketplaces installed -> refuses without -Marketplace' (($r.Code -ne 0) -and ($r.Out -match 'mkt-one'))
  Write-Installed @('takgon')

  # Default backup dir, latest-backup selection skips empty dirs, relative paths follow the PowerShell location
  $r = Run @('Backup', '-ConfigDir', $cfg)
  Check 'Backup: default dir created' (@(Get-ChildItem $cfg -Directory -Filter 'backup-takgon-store-*').Count -eq 1)
  New-Item -ItemType Directory (Join-Path $cfg 'backup-takgon-store-99999999-999999') | Out-Null   # newer name, but empty
  Put $orig '{"g/core/modules":{"panel":true}}'
  $r = Run @('Restore', '-ConfigDir', $cfg, '-Force')
  Check 'Restore: picks the latest backup that has a store file (skips empty newer dir)' ($r.Code -eq 0)
  # Set-Location만 바꾸고 프로세스 cwd는 그대로인 상태에서 상대 경로가 어느 쪽 기준으로 풀리는지 본다(같은 PowerShell 안에서 호출).
  $cmd = "Set-Location -LiteralPath '$store'; & '$Script' List -ConfigDir '..\..'"
  $rel = & $Shell -NoProfile -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String
  Check 'List: relative -ConfigDir resolves against the PowerShell location' ($rel -match 'takgon-mods_takgon-2488473fd961\.json')
} finally {
  if ((Split-Path $base -Leaf) -like 'takgon-sbtest-*' -and (Test-Path $base)) { Remove-Item -Recurse -Force $base }
}

$results | ForEach-Object { "{0}  {1}" -f $(if ($_.Ok) { 'PASS' } else { 'FAIL' }), $_.Name }
$fail = @($results | Where-Object { -not $_.Ok }).Count
"claude process present during test: $claudeRunning"
"{0} checks, {1} failed" -f $results.Count, $fail
if ($fail -gt 0) { exit 1 }
