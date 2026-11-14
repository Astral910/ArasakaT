# Arranca el servicio de voz a texto (faster-whisper en GPU) oculto, en 127.0.0.1:8211.
# Uso: powershell -File tools\stt\arrancar.ps1 [-Modelo small|medium|large-v3-turbo] [-Log ruta]
param(
    [string]$Modelo = "small",
    [string]$Log = "$env:TEMP\fieldshift-stt.log"
)
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmd = "`$env:STT_MODELO='$Modelo'; (Get-Process -Id `$PID).PriorityClass='BelowNormal'; python -u '$aqui\servidor.py' *> '$Log'"
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $cmd
Write-Output "STT arrancando (modelo $Modelo). Log: $Log - salud: http://127.0.0.1:8211/salud"
