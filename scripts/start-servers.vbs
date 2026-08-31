Set WshShell = CreateObject("WScript.Shell")
WshShell.Environment("Process").Item("DATABASE_URL") = "postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
WshShell.Environment("Process").Item("JWT_SECRET") = "roa_services_super_secret_change_me_8f3a2c91"
WshShell.Environment("Process").Item("JWT_REFRESH_SECRET") = "roa_services_refresh_secret_b7e1d4a6"
WshShell.Environment("Process").Item("PORT") = "4100"
WshShell.Run "node D:\roaservcies\roaserv\dist\api-test.cjs", 0, False
WshShell.Run "node D:\roaservcies\roaserv\node_modules\@angular\cli\bin\ng.js serve --port=5173 --host=0.0.0.0 --allowed-hosts=true", 0, False
