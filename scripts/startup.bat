@echo off
REM ROA Services - Lancement automatique au demarrage de Windows
REM Ce fichier doit etre place dans le dossier Startup:
REM C:\Users\servi\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup

set DATABASE_URL=postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
set JWT_SECRET=roa_services_super_secret_change_me_8f3a2c91
set JWT_REFRESH_SECRET=roa_services_refresh_secret_b7e1d4a6
set PORT=4100
set NODE_OPTIONS=--max_old_space_size=4096

cd /d D:\roaservcies\roaserv
start /B node scripts\roa-server.cjs > D:\roaservcies\roaserv\logs\roa.log 2>&1
echo ROA Services demarre sur http://localhost:4100
timeout /t 2 /nobreak > nul
