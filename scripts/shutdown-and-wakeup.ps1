# ROA Services - Arret PC + Demarrage automatique 6h
# Ce script:
# 1. Planifie le demarrage du serveur ROA au logon Windows
# 2. Configure le PC pour se rallumer a 6h00 (wake timer)
# 3. Arrete le PC maintenant

Write-Host "=== ROA Services - Configuration arret/demarrage ===" -ForegroundColor Cyan

# 1. Creer la tache planifiee pour demarrer le serveur au logon
$action = New-ScheduledTaskAction -Execute "node" -Argument "D:\roaservcies\roaserv\scripts\roa-server.cjs" -WorkingDirectory "D:\roaservcies\roaserv"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "ROA-Services-Server" -Action $action -Trigger $trigger -Settings $settings -Description "ROA Services - Serveur unifie" -Force
Write-Host "[OK] Tache planifiee 'ROA-Services-Server' creee (demarre au logon)" -ForegroundColor Green

# 2. Activer le wake timer pour le reveil a 6h
powercfg /waketimers
Write-Host "[OK] Wake timers actives" -ForegroundColor Green

# 3. Creer une tache planifiee pour reveiller le PC a 6h00
$trigger6h = New-ScheduledTaskTrigger -Daily -At "06:00"
$action6h = New-ScheduledTaskAction -Execute "cmd" -Argument "/c echo ROA Services wake-up"
Register-ScheduledTask -TaskName "ROA-Services-Wakeup" -Action $action6h -Trigger $trigger6h -Settings $settings -Description "Reveil ROA Services 6h" -Force
Write-Host "[OK] Reveil planifie a 06:00" -ForegroundColor Green

# 4. Arreter le PC dans 30 secondes
Write-Host ""
Write-Host "Le PC va s'arreter dans 30 secondes..." -ForegroundColor Yellow
Write-Host "Il se rallumera a 6h00 et le serveur demarrera automatiquement." -ForegroundColor Yellow
shutdown /s /t 30 /c "ROA Services - Arret planifie. Reveil a 6h00."
