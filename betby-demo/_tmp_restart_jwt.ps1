$ErrorActionPreference = "SilentlyContinue"
$cwd = (Get-Location).Path
$statusFile = Join-Path $cwd "betby-demo\status_check.txt"
Remove-Item $statusFile -Force -ErrorAction SilentlyContinue
function Write-Status($s) {
  Add-Content -Path $statusFile -Value $s
}
Write-Status "=== JWT-SERVICE RESTART CHECK $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Write-Status "CWD=$cwd"

Write-Status "--- KILLING NODES ---"
for ($i=0; $i -lt 8; $i++) {
  $nodes = @(Get-Process node -ErrorAction SilentlyContinue)
  if ($nodes.Count -eq 0) { Write-Status "  Loop $i : 0 nodes remaining"; break }
  Write-Status "  Loop $i : Killing $($nodes.Count) node(s) PIDs=$($nodes.Id -join ',')"
  foreach ($n in $nodes) { try { Stop-Process -Id $n.Id -Force -ErrorAction Stop } catch { Write-Status "    FAIL kill PID=$($n.Id): $($_.Exception.Message)" } }
  Start-Sleep -Milliseconds 700
}

Write-Status "--- WAIT PORT 8787 FREE ---"
$portFree = $false
for ($i=0; $i -lt 20; $i++) {
  $l = netstat -ano | Select-String ":8787" | Select-String "LISTENING"
  if (-not $l) { $portFree = $true; Write-Status "  Port :8787 free after $($i+1)*700ms"; break }
  Start-Sleep -Milliseconds 700
}
if (-not $portFree) { Write-Status "  FAIL :8787 not free!" }

Write-Status "--- START NEW JWT-SERVICE ---"
$outLog = Join-Path $cwd "betby-demo\jwt-service.out.log"
$errLog = Join-Path $cwd "betby-demo\jwt-service.err.log"
foreach ($f in @($outLog,$errLog)) { if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue } }
$nodeExe = (Get-Command node.exe).Source
$p = Start-Process -FilePath $nodeExe -ArgumentList "betby-demo\jwt-service.mjs" `
  -WorkingDirectory $cwd `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden -PassThru
Write-Status "  Started PID=$($p.Id)"

Write-Status "--- WAIT PORT 8787 UP ---"
$portUp = $false
for ($i=0; $i -lt 30; $i++) {
  $l = netstat -ano | Select-String ":8787" | Select-String "LISTENING"
  if ($l) { $portUp = $true; Write-Status "  Port :8787 UP after $($i+1)*800ms — $l"; break }
  Start-Sleep -Milliseconds 800
}
if (-not $portUp) {
  Write-Status "  FAIL :8787 not up after 24s"
  if (Test-Path $errLog) { Write-Status "  STDERR:"; Get-Content $errLog -Tail 20 | ForEach-Object { Write-Status "    $_" } }
  exit 1
}

Start-Sleep -Milliseconds 1500
Write-Status "--- FETCH /health ---"
try {
  $r = Invoke-WebRequest -Uri "http://localhost:8787/health" -UseBasicParsing -TimeoutSec 30
  Write-Status "  StatusCode=$($r.StatusCode)"
  $j = $r.Content | ConvertFrom-Json
  Write-Status "  authenticated=$($j.authenticated)"
  Write-Status "  brandId=$($j.brandId)"
  Write-Status "  defaultTreeIdBanner=$($j.v4Patterns?.shortcutsHosted[0])"
  $auto = $j.v4Patterns?.autoResolve
  if ($auto) {
    Write-Status "  autoResolve EXISTS (NEW CODE!)"
    Write-Status "  autoResolve.userIds = $($auto.userIds -join ', ')"
    Write-Status "  autoResolve.defaultLive = $($auto.live?.treeId) events=$($auto.live?.events) score=$($auto.live?.score)"
    Write-Status "  autoResolve.defaultPrematch = $($auto.prematch?.treeId) events=$($auto.prematch?.events) score=$($auto.prematch?.score)"
    $routesStr = $j.routes -join ' | '
    Write-Status "  hasDebugRoute = $($routesStr -match 'debug')"
    Write-Status "  hasEventRoute = $($routesStr -match 'event')"
  } else {
    Write-Status "  FAIL: autoResolve MISSING (running OLD code!)"
  }
  if (Test-Path $outLog) {
    $bannerLine = Get-Content $outLog | Select-String "v4/live.*treeId" | Select-Object -First 1
    if ($bannerLine) { Write-Status "  startup banner line: $bannerLine" }
  }
} catch {
  Write-Status "  /health FETCH ERROR: $($_.Exception.Message)"
}
Write-Status "=== DONE ==="
