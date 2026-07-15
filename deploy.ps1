# ============================================================
# deploy.ps1 - One-click deploy to 192.168.20.156:8080
# Usage: .\deploy.ps1
# ============================================================

$APP_DIR   = "D:\TAVL_V2\tavl-lite-v2"
$SERVER    = "iteckadmin@192.168.20.156"
$PASS      = 'Developer@#$81'
$REMOTE    = "/home/iteckadmin/icc_lite_v1/tavl-lite-v2"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  iTeck iCC Deploy → 192.168.20.156:8080" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Step 1 — Build frontend
Write-Host ""
Write-Host "[1/4] Building frontend (npm run build)..." -ForegroundColor Yellow
Set-Location $APP_DIR
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "BUILD FAILED" -ForegroundColor Red; exit 1 }
Write-Host "      Build complete." -ForegroundColor Green

# Step 2 — Upload dist/ to server
Write-Host ""
Write-Host "[2/4] Uploading dist/ to server..." -ForegroundColor Yellow
pscp -batch -pw $PASS -r "$APP_DIR\dist\*" "${SERVER}:${REMOTE}/dist/"
if ($LASTEXITCODE -ne 0) { Write-Host "DIST UPLOAD FAILED" -ForegroundColor Red; exit 1 }
Write-Host "      Dist upload complete." -ForegroundColor Green

# Step 3 — Upload server/ source to server (backend runs via tsx, so .ts source is what executes)
Write-Host ""
Write-Host "[3/4] Uploading server/ source to server..." -ForegroundColor Yellow
pscp -batch -pw $PASS -r "$APP_DIR\server\*" "${SERVER}:${REMOTE}/server/"
if ($LASTEXITCODE -ne 0) { Write-Host "SERVER UPLOAD FAILED" -ForegroundColor Red; exit 1 }
Write-Host "      Server source upload complete." -ForegroundColor Green

# Step 4 — Restart backend on server
Write-Host ""
Write-Host "[4/4] Restarting backend on server..." -ForegroundColor Yellow
plink -batch -pw $PASS $SERVER "pm2 restart icc-lite-backend && pm2 save"
if ($LASTEXITCODE -ne 0) { Write-Host "RESTART FAILED" -ForegroundColor Red; exit 1 }
Write-Host "      Backend restarted." -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DEPLOYED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "  Open: http://192.168.20.156:8080" -ForegroundColor Cyan
Write-Host "  Hard refresh: Ctrl+Shift+R" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
