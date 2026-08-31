@echo off
setlocal
set DATABASE_URL=postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
set JWT_SECRET=roa_services_super_secret_change_me_8f3a2c91
set JWT_REFRESH_SECRET=roa_services_refresh_secret_b7e1d4a6
set PORT=4100
cd /d D:\roaservcies\roaserv
echo ============================================
echo  ROA Services - Serveur unifie
echo ============================================
echo.
echo  Backend + Frontend sur UN SEUL port: 4100
echo  URL: http://localhost:4100
echo.
echo  Identifiants: admin / Roa0629605450
echo ============================================
echo.
node dist\roa-server.cjs
endlocal
pause