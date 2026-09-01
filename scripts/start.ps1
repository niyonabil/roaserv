$env:DATABASE_URL='postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
$env:JWT_SECRET='roa_services_super_secret_change_me_8f3a2c91'
$env:JWT_REFRESH_SECRET='roa_services_refresh_secret_b7e1d4a6'
$env:PORT='4100'
$env:NODE_OPTIONS='--max_old_space_size=4096'
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process node -ArgumentList 'D:/roaservcies/roaserv/scripts/roa-server.cjs' -WindowStyle Hidden -WorkingDirectory 'D:/roaservcies/roaserv'
Start-Sleep 3
Get-Process node | Select-Object Id, StartTime | Format-Table