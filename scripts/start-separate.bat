@echo off
echo ============================================
echo  ROA Services - Lancement serveaux locaux
echo ============================================
echo.
echo Backend  : http://localhost:4100
echo Frontend : http://localhost:5173
echo.
echo Appuyez sur Ctrl+C dans chaque fenetre pour arreter.
echo ============================================
echo.

set DATABASE_URL=postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
set JWT_SECRET=roa_services_super_secret_change_me_8f3a2c91
set JWT_REFRESH_SECRET=roa_services_refresh_secret_b7e1d4a6
set PORT=4100
set NODE_OPTIONS=--max_old_space_size=4096

cd /d D:\roaservcies\roaserv

start "ROA-Backend (port 4100)" cmd /k "node dist\api-test.cjs"
timeout /t 2 /nobreak > nul
start "ROA-Frontend (port 5173)" cmd /k "node node_modules\@angular\cli\bin\ng.js serve --port=5173 --host=0.0.0.0 --allowed-hosts=true"

echo Les deux serveaux sont dans des fenetres separees.
echo Cette fenetre peut etre fermee.
