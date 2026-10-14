<#
.SYNOPSIS
  `claude plugin marketplace add` 간헐 실패(EPERM rename / "Failed to finalize marketplace cache")의
  원인을 가를 증거를 자동으로 남긴다.

.DESCRIPTION
  실행마다 새 임시 CLAUDE_CONFIG_DIR(<BaseDir>\takgon-evidence-<번호>)을 만들고
  `claude plugin marketplace add <Source>`를 실행한다. 종료코드가 0이 아니면 실패로 보고
  <BaseDir>\takgon-evidence-<타임스탬프>.txt 에 아래를 저장한다.
    - 명령 종료코드, 시작/종료 시각(ms), 소요시간, stdout/stderr 전문 (EPERM 문구 포함 여부 표시)
    - 실패한 설정 폴더의 plugins\marketplaces\ 하위 폴더 이름, 파일 수, 속성
    - 그 순간의 후보 프로세스(V3SUI/ASDSvc/AhnLab, SearchIndexer, OneDrive*, MsMpEng, node/git 등)
    - CPU 사용률 상위 10개, 시스템 시간대
    - Restart Manager로 본 폴더 내 파일 점유 프로세스 (못 찾으면 "확인 불가")
  성공한 실행의 임시 폴더는 즉시 삭제한다. 실패한 폴더는 증거로 남긴다.
  실제 ~/.claude 는 건드리지 않는다. CLAUDE_CONFIG_DIR 는 이 PowerShell 프로세스 안에서만 설정하고
  종료 시 원복한다.

.PARAMETER Runs
  최대 반복 횟수 (기본 50).
.PARAMETER StopOnFail
  첫 실패에서 멈춘다 (기본 켜짐). 끄려면 -File 대신 -Command 로 실행한다(-File 에서는 -StopOnFail:$false 가 문자열로 전달돼 오류).
  예: powershell -NoProfile -ExecutionPolicy Bypass -Command "& 'tools\capture-add-failure.ps1' -Runs 30 -StopOnFail:$false"
.PARAMETER BaseDir
  임시 설정 폴더들의 부모 (기본 $env:TEMP). 실제 ~/.claude 와 비슷한 경로 조건을 시험하려면
  $env:USERPROFILE 아래 폴더를 지정한다. 예: -BaseDir "$env:USERPROFILE\tmp-evidence" (폴더가 없으면 만든다)
.PARAMETER Source
  marketplace 소스 (기본 astromelon/takgon-marketplace).

.EXAMPLE
  # 실패할 때까지 최대 50회 반복 (첫 실패에서 중단)
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\capture-add-failure.ps1 -Runs 50

.NOTES
  증거 파일을 이슈(재발 시 #1을 다시 열거나 새 이슈)에 올리는 방법:
    - 증거 파일(takgon-evidence-<타임스탬프>.txt)을 열어 내용을 확인하고, 개인 정보(사용자명, 경로,
      회사 내부 프로세스 이름 등)가 걸리면 가린 뒤 이슈 코멘트에 파일을 끌어다 놓아 첨부하거나
      <details> 블록 안에 코드 펜스로 붙여 넣는다.
    - 실패한 임시 설정 폴더(takgon-evidence-<번호>)는 증거로 남아 있으니 확인 후 직접 삭제한다.
      (삭제 자체가 EPERM 이면 그것도 증거이므로 증거 파일에 덧붙인다.)

  한계:
    - 이 스크립트는 원인을 확정하지 못한다. 실패 순간의 정황 증거(프로세스 목록, 파일 점유)만 남긴다.
    - 관리자 권한이 아니므로 다른 사용자/보호된 프로세스(백신 드라이버 등)의 핸들은 볼 수 없다.
    - Restart Manager는 "열려 있는 파일 핸들"만 알려 준다. 디렉터리 핸들이나 이미 닫힌 뒤의 점유,
      실패 직후 몇 초가 지나 풀린 점유는 잡히지 않는다. 폴더를 잡은 프로세스를 못 찾으면 "확인 불가"로 기록한다.
    - 실패 폴더 스냅샷은 명령 종료 이후에 찍으므로, 명령 도중의 일시 점유는 놓칠 수 있다.
#>
[CmdletBinding()]
param(
  [int]$Runs = 50,
  [switch]$StopOnFail = $true,
  [string]$BaseDir = $env:TEMP,
  [string]$Source = 'astromelon/takgon-marketplace'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:Prefix = 'takgon-evidence'

function Get-Stamp([datetime]$d) { $d.ToString('yyyy-MM-dd HH:mm:ss.fff zzz') }

# 삭제 전 경로 검증: BaseDir 바로 아래이며 이름이 takgon-evidence 로 시작해야 한다.
function Remove-EvidenceItem([string]$Path, [string]$Parent) {
  if (-not (Test-Path -LiteralPath $Path)) { return $true }
  $full = [System.IO.Path]::GetFullPath($Path)
  $par = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\')
  $leaf = [System.IO.Path]::GetFileName($full.TrimEnd('\'))
  $dir = [System.IO.Path]::GetDirectoryName($full.TrimEnd('\'))
  if (-not $leaf.StartsWith($script:Prefix) -or $dir.TrimEnd('\') -ne $par) {
    Write-Warning "삭제 거부(경로 검증 실패): $full"
    return $false
  }
  try { Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop; return $true }
  catch { Write-Warning "삭제 실패: $full : $($_.Exception.Message)"; return $false }
}

# Restart Manager P/Invoke (실패해도 스크립트는 계속)
$script:RmReady = $false
try {
  if (-not ('TkRm' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TkRm {
  [StructLayout(LayoutKind.Sequential)]
  struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
    public int ApplicationType; public uint AppStatus; public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmStartSession(out uint h, int flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmRegisterResources(uint h, uint nFiles, string[] files, uint nApps, RM_UNIQUE_PROCESS[] apps, uint nSvc, string[] svc);
  [DllImport("rstrtmgr.dll")]
  static extern int RmGetList(uint h, out uint needed, ref uint count, [In, Out] RM_PROCESS_INFO[] info, out uint reasons);
  [DllImport("rstrtmgr.dll")]
  static extern int RmEndSession(uint h);

  // 반환: 점유 프로세스 "pid:이름" 목록. 오류면 예외.
  public static List<string> WhoHolds(string[] files) {
    uint h; StringBuilder key = new StringBuilder(33);
    int r = RmStartSession(out h, 0, key);
    if (r != 0) throw new Exception("RmStartSession=" + r);
    try {
      r = RmRegisterResources(h, (uint)files.Length, files, 0, null, 0, null);
      if (r != 0) throw new Exception("RmRegisterResources=" + r);
      uint needed = 0, count = 0, reasons = 0;
      r = RmGetList(h, out needed, ref count, null, out reasons);
      List<string> res = new List<string>();
      if (r == 0) return res;
      if (r != 234) throw new Exception("RmGetList=" + r);
      RM_PROCESS_INFO[] info = new RM_PROCESS_INFO[needed];
      count = needed;
      r = RmGetList(h, out needed, ref count, info, out reasons);
      if (r != 0) throw new Exception("RmGetList(2)=" + r);
      for (int i = 0; i < count; i++) res.Add(info[i].Process.dwProcessId + ":" + info[i].strAppName);
      return res;
    } finally { RmEndSession(h); }
  }
}
'@
  }
  $script:RmReady = $true
} catch {
  Write-Warning "Restart Manager 준비 실패(계속 진행): $($_.Exception.Message)"
}

# --- 사전 확인 ---------------------------------------------------------------
$claudeCmd = Get-Command claude -CommandType Application, ExternalScript -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $claudeCmd) { throw 'claude 실행 파일을 PATH 에서 찾지 못했다.' }
$exe = $claudeCmd.Source
$exeArgsPrefix = @()
if ($exe -like '*.ps1') {
  $exeArgsPrefix = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $exe)
  $exe = (Get-Command powershell.exe).Source
}

if (-not (Test-Path -LiteralPath $BaseDir)) { New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null }
$BaseDir = (Resolve-Path -LiteralPath $BaseDir).ProviderPath.TrimEnd('\')
$realClaude = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.claude')).TrimEnd('\')
if ($BaseDir -eq $realClaude -or $BaseDir.StartsWith($realClaude + '\')) {
  throw "BaseDir 가 실제 ~/.claude 아래다. 거부: $BaseDir"
}

Write-Host "claude        : $exe"
Write-Host "BaseDir       : $BaseDir"
Write-Host "실제 ~/.claude : $realClaude (변경하지 않음)"
Write-Host "Source/Runs   : $Source / $Runs / StopOnFail=$([bool]$StopOnFail)"

$origConfigDir = $env:CLAUDE_CONFIG_DIR
$failCount = 0
$done = 0
$evidenceFiles = @()
$failedDirs = @()
$nextNo = 1

try {
  for ($i = 1; $i -le $Runs; $i++) {
    # 비어 있는 번호 찾기 (이전 증거 폴더를 건드리지 않는다)
    while (Test-Path -LiteralPath (Join-Path $BaseDir "$($script:Prefix)-$nextNo")) { $nextNo++ }
    $no = $nextNo; $nextNo++
    $cfg = Join-Path $BaseDir "$($script:Prefix)-$no"
    if ($cfg -eq $realClaude -or -not ([System.IO.Path]::GetFileName($cfg)).StartsWith($script:Prefix)) {
      throw "설정 폴더 경로 검증 실패: $cfg"
    }
    New-Item -ItemType Directory -Path $cfg -Force | Out-Null
    $so = Join-Path $BaseDir "$($script:Prefix)-out-$no.stdout.tmp"
    $se = Join-Path $BaseDir "$($script:Prefix)-out-$no.stderr.tmp"

    $env:CLAUDE_CONFIG_DIR = $cfg
    $start = Get-Date
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $exitCode = -1
    $launchErr = $null
    try {
      $argList = @($exeArgsPrefix) + @('plugin', 'marketplace', 'add', $Source)
      $p = Start-Process -FilePath $exe -ArgumentList $argList -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $so -RedirectStandardError $se
      $p.WaitForExit()
      $exitCode = $p.ExitCode
    } catch {
      $launchErr = $_.Exception.Message
    }
    $sw.Stop()
    $end = Get-Date
    $env:CLAUDE_CONFIG_DIR = $origConfigDir
    $done++

    $stdout = ''; $stderr = ''
    if (Test-Path -LiteralPath $so) { $t = Get-Content -LiteralPath $so -Raw -Encoding UTF8; if ($t) { $stdout = $t } }
    if (Test-Path -LiteralPath $se) { $t = Get-Content -LiteralPath $se -Raw -Encoding UTF8; if ($t) { $stderr = $t } }
    [void](Remove-EvidenceItem $so $BaseDir)
    [void](Remove-EvidenceItem $se $BaseDir)

    $failed = ($exitCode -ne 0) -or [bool]$launchErr
    if (-not $failed) {
      $ok = Remove-EvidenceItem $cfg $BaseDir
      Write-Host ("[{0}/{1}] 성공 exit=0 {2} ms 폴더삭제={3}" -f $i, $Runs, $sw.ElapsedMilliseconds, $ok)
      continue
    }

    # --- 실패: 가능한 한 빨리 프로세스 스냅샷 -------------------------------
    $failCount++
    $snapTime = Get-Date
    $procLines = @(); $cpuLines = @()
    try {
      $cim = @(Get-CimInstance Win32_Process)
      $pat = '^(V3|ASDSvc|AhnLab|Asd|SearchIndexer|SearchProtocolHost|SearchFilterHost|OneDrive|MsMpEng|NisSrv|node|git|claude)'
      foreach ($c in ($cim | Where-Object { $_.Name -match $pat -or $_.Name -match 'V3|AhnLab|ASD' } | Sort-Object Name, ProcessId)) {
        $cl = [string]$c.CommandLine
        if ($cl.Length -gt 300) { $cl = $cl.Substring(0, 300) + '...(절단)' }
        $procLines += ("PID {0,-6} PPID {1,-6} {2}  | {3}" -f $c.ProcessId, $c.ParentProcessId, $c.Name, $cl)
      }
      if (-not $procLines) { $procLines = @('(후보 프로세스 없음)') }
    } catch { $procLines = @("프로세스 목록 확인 불가: $($_.Exception.Message)") }
    try {
      $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
        Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } |
        Sort-Object PercentProcessorTime -Descending | Select-Object -First 10
      foreach ($q in $perf) { $cpuLines += ("{0,5}%  PID {1,-6} {2}" -f $q.PercentProcessorTime, $q.IDProcess, $q.Name) }
    } catch {
      try {
        foreach ($q in (Get-Process | Sort-Object CPU -Descending | Select-Object -First 10)) {
          $cpuLines += ("누적CPU {0,10:N1}s PID {1,-6} {2}  (사용률 확인 불가, 누적 시간으로 대체)" -f $q.CPU, $q.Id, $q.ProcessName)
        }
      } catch { $cpuLines = @("CPU 정보 확인 불가: $($_.Exception.Message)") }
    }

    # --- 폴더 상태 ----------------------------------------------------------
    $folderLines = @(); $allFiles = @()
    $mpDir = Join-Path $cfg 'plugins\marketplaces'
    try {
      $pl = Join-Path $cfg 'plugins'
      if (Test-Path -LiteralPath $pl) {
        $folderLines += "plugins 하위: " + ((Get-ChildItem -LiteralPath $pl -Force | ForEach-Object { $_.Name }) -join ', ')
      } else { $folderLines += 'plugins 폴더 없음' }
      if (Test-Path -LiteralPath $mpDir) {
        $subs = @(Get-ChildItem -LiteralPath $mpDir -Force)
        if (-not $subs) { $folderLines += 'marketplaces 폴더는 있으나 비어 있음' }
        foreach ($s in $subs) {
          if ($s.PSIsContainer) {
            $files = @(Get-ChildItem -LiteralPath $s.FullName -Force -Recurse -File -ErrorAction SilentlyContinue)
            $allFiles += $files | Select-Object -First 300 | ForEach-Object { $_.FullName }
            $ro = @($files | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReadOnly }).Count
            $folderLines += ("[폴더] {0}  파일수={1}  읽기전용파일={2}  속성={3}  수정={4}" -f $s.Name, $files.Count, $ro, $s.Attributes, (Get-Stamp $s.LastWriteTime))
          } else {
            $folderLines += ("[파일] {0}  크기={1}  속성={2}  수정={3}" -f $s.Name, $s.Length, $s.Attributes, (Get-Stamp $s.LastWriteTime))
          }
        }
      } else { $folderLines += "marketplaces 폴더 없음: $mpDir" }
    } catch { $folderLines += "폴더 조사 실패: $($_.Exception.Message)" }

    # --- Restart Manager ----------------------------------------------------
    $rmLines = @()
    if (-not $script:RmReady) { $rmLines = @('확인 불가 (Restart Manager 준비 실패)') }
    elseif (-not $allFiles) { $rmLines = @('확인 불가 (조사할 파일이 없음. 폴더 핸들은 Restart Manager로 볼 수 없다)') }
    else {
      try {
        $holders = [TkRm]::WhoHolds([string[]]$allFiles)
        if ($holders.Count -eq 0) {
          $rmLines = @("점유 프로세스 확인 불가: 조사한 파일 $($allFiles.Count)개에서 열린 핸들 없음 (이미 풀렸거나 디렉터리 핸들/권한 밖일 수 있음)")
        } else { $rmLines = @($holders | ForEach-Object { "점유: $_" }) }
      } catch { $rmLines = @("확인 불가 (Restart Manager 오류: $($_.Exception.Message))") }
    }

    # --- 증거 파일 ----------------------------------------------------------
    $eperm = ($stdout + "`n" + $stderr) -match 'EPERM'
    $fin = ($stdout + "`n" + $stderr) -match 'Failed to finalize marketplace cache'
    $tz = Get-TimeZone
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('=== takgon marketplace add 실패 증거 ===')
    [void]$sb.AppendLine("Source          : $Source")
    [void]$sb.AppendLine("실행 번호       : $i / $Runs  (설정 폴더 번호 $no)")
    [void]$sb.AppendLine("CLAUDE_CONFIG_DIR: $cfg  (증거로 남김)")
    [void]$sb.AppendLine("명령            : $exe $($argList -join ' ')")
    [void]$sb.AppendLine("종료코드        : $exitCode")
    if ($launchErr) { [void]$sb.AppendLine("실행 오류       : $launchErr") }
    [void]$sb.AppendLine("시작            : $(Get-Stamp $start)")
    [void]$sb.AppendLine("종료            : $(Get-Stamp $end)")
    [void]$sb.AppendLine("소요시간        : $($sw.ElapsedMilliseconds) ms")
    [void]$sb.AppendLine("스냅샷 시각     : $(Get-Stamp $snapTime)  (종료 후 $([int]($snapTime - $end).TotalMilliseconds) ms)")
    [void]$sb.AppendLine("EPERM 문구 포함 : $(if ($eperm) { '예' } else { '아니오' })")
    [void]$sb.AppendLine("'Failed to finalize marketplace cache' 포함: $(if ($fin) { '예' } else { '아니오' })")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('--- STDOUT (전문) ---'); [void]$sb.AppendLine($stdout)
    [void]$sb.AppendLine('--- STDERR (전문) ---'); [void]$sb.AppendLine($stderr)
    [void]$sb.AppendLine('--- plugins\marketplaces 상태 ---')
    foreach ($l in $folderLines) { [void]$sb.AppendLine($l) }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('--- 폴더 점유 프로세스 (Restart Manager, 읽기 전용) ---')
    foreach ($l in $rmLines) { [void]$sb.AppendLine($l) }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('--- 후보 프로세스 (백신/검색 인덱서/OneDrive/Defender/node/git/claude) ---')
    foreach ($l in $procLines) { [void]$sb.AppendLine($l) }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('--- CPU 사용률 상위 10 ---')
    foreach ($l in $cpuLines) { [void]$sb.AppendLine($l) }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('--- 시스템 시간대 ---')
    [void]$sb.AppendLine("$($tz.Id) / $($tz.DisplayName) / StandardName=$($tz.StandardName) / UTC오프셋=$($tz.BaseUtcOffset) / DST=$($tz.SupportsDaylightSavingTime)")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('--- 한계 ---')
    [void]$sb.AppendLine('원인 확정 불가. 관리자 권한 없이 수집한 정황 증거이며, 핸들 점유 프로세스를 못 찾으면 "확인 불가"다.')

    $evFile = Join-Path $BaseDir ("{0}-{1}.txt" -f $script:Prefix, (Get-Date).ToString('yyyyMMdd-HHmmss-fff'))
    [System.IO.File]::WriteAllText($evFile, $sb.ToString(), (New-Object System.Text.UTF8Encoding($true)))
    $evidenceFiles += $evFile
    $failedDirs += $cfg
    Write-Host ("[{0}/{1}] 실패 exit={2} {3} ms EPERM={4}" -f $i, $Runs, $exitCode, $sw.ElapsedMilliseconds, $(if ($eperm) { '예' } else { '아니오' })) -ForegroundColor Red
    Write-Host "  증거 파일: $evFile"
    Write-Host "  실패한 설정 폴더는 증거로 남겼다. 확인 후 직접 삭제하라: $cfg"

    if ($StopOnFail) { break }
  }
} finally {
  $env:CLAUDE_CONFIG_DIR = $origConfigDir
}

Write-Host ''
Write-Host "=== 요약: $done 회 실행 중 실패 $failCount 회 ==="
foreach ($f in $evidenceFiles) { Write-Host "증거 파일: $f" }
if ($failCount -eq 0) { Write-Host '증거 파일 없음 (실패 미재현)' }
