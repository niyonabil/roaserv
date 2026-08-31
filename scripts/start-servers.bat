@echo off
set DATABASE_URL=postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
set JWT_SECRET=roa_services_super_secret_change_me_8f3a2c91
set JWT_REFRESH_SECRET=roa_services_refresh_secret_b7e1d4a6
set PORT=4100
cd /d D:\roaservcies\roaserv
start "ROA-Backend" /B node dist\api-test.cjs
start "ROA-Frontend" /B node node_modules\@angular\cli\bin\ng.js serve --port=5173 --host=0.0.0.0 --allowed-hosts=true
