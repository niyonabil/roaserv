# ROA Services - Planification demarrage automatique
# Ce script cree une tache planifiee qui lance le serveur au demarrage de Windows

$action = New-ScheduledTaskAction -Execute "node" -Argument "D:\roaservcies\roaserv\scripts\roa-server.cjs" -WorkingDirectory "D:\roaservcies\roaserv"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Variables d'environnement
$env:DATABASE_URL = "postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
$env:JWT_SECRET = "roa_services_super_secret_change_me_8f3a2c91"
$env:JWT_REFRESH_SECRET = "roa_services_refresh_secret_b7e1d4a6"
$env:PORT = "4100"

Register-ScheduledTask -TaskName "ROA-Services-Server" -Action $action -Trigger $trigger -Settings $settings -Description "ROA Services - Serveur unifie backend+frontend" -Force

Write-Host "Tache planifiee creee: ROA-Services-Server"
Write-Host "Le serveur demarrera automatiquement a chaque connexion Windows."
Write-Host ""
Write-Host "Pour demarrer maintenant: Start-ScheduledTask -TaskName 'ROA-Services-Server'"
Write-Host "Pour verifier: Get-ScheduledTask -TaskName 'ROA-Services-Server'"
