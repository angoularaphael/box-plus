param(
  [switch]$Check
)
$root = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $root 'data\tmp-pw'
$sessionSrc = Join-Path $root 'data\session'
$sessionDst = Join-Path $root 'data\session-mig-minimes'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path $sessionDst | Out-Null
if (Test-Path (Join-Path $sessionSrc 'storage-state.json')) {
  Copy-Item (Join-Path $sessionSrc 'storage-state.json') (Join-Path $sessionDst 'storage-state.json') -Force
}
$env:TEMP = $tmp
$env:TMP = $tmp
$env:TMPDIR = $tmp
$env:BOT_SESSION_DIR = $sessionDst
$out = Join-Path $root 'data\migrate-minimes-run.log'
$err = Join-Path $root 'data\migrate-minimes-run.err'
$nodeArgs = @(
  'scripts/migrate-balma-etats-unis-to-minimes.js',
  '--since=2026-08-01'
)
if ($Check) { $nodeArgs += '--check' } else { $nodeArgs += '--apply' }
$p = Start-Process -FilePath 'node' -ArgumentList $nodeArgs -WorkingDirectory $root `
  -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
Write-Output "started pid=$($p.Id) log=$out apply=$(-not $Check)"
