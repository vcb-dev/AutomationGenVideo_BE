# Script: start-ngrok.ps1
# Khởi động ngrok, lấy URL tự động, cập nhật .env

$PORT = 3000
$ENV_FILE = Join-Path $PSScriptRoot "..\\.env"
$NGROK_EXE = Join-Path $PSScriptRoot "ngrok.exe"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  NGROK TUNNEL STARTER" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Kill ngrok cũ nếu đang chạy
$existing = Get-Process -Name "ngrok" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[*] Dừng ngrok cũ..." -ForegroundColor Yellow
    $existing | Stop-Process -Force
    Start-Sleep -Seconds 1
}

# Khởi động ngrok background (dùng standalone exe)
Write-Host "[*] Khởi động ngrok trên port $PORT..." -ForegroundColor Yellow
Start-Process -FilePath $NGROK_EXE -ArgumentList "http $PORT" -WindowStyle Minimized

# Chờ ngrok sẵn sàng
Write-Host "[*] Đang chờ ngrok sẵn sàng..." -ForegroundColor Yellow
$ngrokUrl = $null
$retries = 0
while (-not $ngrokUrl -and $retries -lt 20) {
    Start-Sleep -Seconds 1
    $retries++
    try {
        $tunnels = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction SilentlyContinue
        $httpsTunnel = $tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1
        if ($httpsTunnel) {
            $ngrokUrl = $httpsTunnel.public_url.TrimEnd("/")
        }
    } catch {}
}

if (-not $ngrokUrl) {
    Write-Host "[ERROR] Không lấy được URL từ ngrok. Kiểm tra lại ngrok." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[OK] Ngrok URL: $ngrokUrl" -ForegroundColor Green
Write-Host ""

# Đọc .env theo từng dòng và thay thế URL trong các key cụ thể
$lines = Get-Content $ENV_FILE
$updatedLines = $lines | ForEach-Object {
    $line = $_
    # Các key chứa URL tunnel cần cập nhật
    $urlKeys = @(
        'GOOGLE_CALLBACK_URL',
        'FB_REDIRECT_URI',
        'THREADS_REDIRECT_URI',
        'IG_REDIRECT_URI',
        'TT_REDIRECT_URI',
        'YT_REDIRECT_URI',
        'ZALO_REDIRECT_URI'
    )
    foreach ($key in $urlKeys) {
        if ($line -match "^$key\s*=") {
            # Thay thế toàn bộ phần URL (từ https:// đến trước /api/...)
            $line = [regex]::Replace($line, 'https?://[^/\s"]+', $ngrokUrl)
            break
        }
    }
    $line
}
Set-Content -Path $ENV_FILE -Value $updatedLines

Write-Host "[OK] Da cap nhat .env thanh cong!" -ForegroundColor Green
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  CAP NHAT META DEVELOPER CONSOLE" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Vao: https://developers.facebook.com/apps/" -ForegroundColor White
Write-Host ""
Write-Host "1. Facebook Login > Settings > Valid OAuth Redirect URIs:" -ForegroundColor Yellow
Write-Host "   $ngrokUrl/api/social/oauth/facebook/callback" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Threads API > Settings:" -ForegroundColor Yellow
Write-Host "   Callback URL    : $ngrokUrl/api/social/oauth/threads/callback" -ForegroundColor Cyan
Write-Host "   Deauth callback : $ngrokUrl/api/social/oauth/threads/deauth" -ForegroundColor Cyan
Write-Host "   Delete callback : $ngrokUrl/api/social/oauth/threads/delete" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Instagram > Settings:" -ForegroundColor Yellow
Write-Host "   Callback URL    : $ngrokUrl/api/social/oauth/instagram/callback" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Google Console (YouTube/Google Login):" -ForegroundColor Yellow
Write-Host "   $ngrokUrl/api/social/oauth/youtube/callback" -ForegroundColor Cyan
Write-Host "   $ngrokUrl/api/auth/google/callback" -ForegroundColor Cyan
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  KHOI DONG LAI NESTJS SAU KHI CAP NHAT .env" -ForegroundColor Yellow
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Chay: npm run start:dev" -ForegroundColor Green
Write-Host ""
