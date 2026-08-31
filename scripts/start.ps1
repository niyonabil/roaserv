$env:DATABASE_URL='postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
$env:JWT_SECRET='roa_services_super_secret_change_me_8f3a2c91'
$env:JWT_REFRESH_SECRET='roa_services_refresh_secret_b7e1d4a6'
$env:PORT='4100'
Start-Process -FilePath 'node' -ArgumentList 'D:/roaservcies/roaserv/dist/api-test.cjs' -WindowStyle Hidden
Start-Process -FilePath 'node' -ArgumentList 'D:/roaservcies/roaserv/node_modules/@angular/cli/bin/ng.js','serve','--port=5173','--host=0.0.0.0','--allowed-hosts=true' -WindowStyle Hidden
Start-Sleep -Seconds 5
Get-Process node | Select-Object Id, StartTime | Format-Table
