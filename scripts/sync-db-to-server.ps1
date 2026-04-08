# Sync Local DB to Server (Overwrite) script
# Uses Docker to perform pg_dump and psql restore

$LOCAL_URL = "postgresql://postgres:trunghieu2003Hh%40@host.docker.internal:5432/video_production?schema=public"
$REMOTE_URL = "postgresql://postgres:trunghieu2003Hh%40@34.143.247.162:5432/video_production?sslmode=require&schema=public"

Write-Host "--- DATABASE SYNC START ---" -ForegroundColor Cyan

Write-Host "[1/2] Dumping Local DB via Docker..." -ForegroundColor Yellow
docker run --rm -v "${PWD}:/tmp" postgres:16 pg_dump "$LOCAL_URL" -f /tmp/local_db_dump.sql --clean --no-owner --no-privileges

if ($LASTEXITCODE -ne 0) {
    Write-Host "Dump failed! Make sure your local Postgres is running and accessible." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "[2/2] Restoring to Server DB (Overwrite)..." -ForegroundColor Yellow
docker run --rm -v "${PWD}:/tmp" postgres:16 psql "$REMOTE_URL" -f /tmp/local_db_dump.sql

if ($LASTEXITCODE -ne 0) {
    Write-Host "Restore failed! Check server connection and credentials." -ForegroundColor Red
    exit $LASTEXITCODE
}

# Cleanup
Remove-Item -Path "local_db_dump.sql" -ErrorAction SilentlyContinue

Write-Host "--- SYNC COMPLETED SUCCESSFULLY ---" -ForegroundColor Green
