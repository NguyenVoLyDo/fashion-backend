$env:OLLAMA_ORIGINS="*"
$env:OLLAMA_HOST="0.0.0.0"
Write-Host "Starting Ollama..."
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" serve
