$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "Launching AI services in new windows..." -ForegroundColor Green

# Start Ollama
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$baseDir\start-ollama.ps1'" -WindowStyle Normal

# Start ngrok
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$baseDir\start-ngrok.ps1'" -WindowStyle Normal

Write-Host "Done! Please keep both windows open to use AI features." -ForegroundColor Cyan
