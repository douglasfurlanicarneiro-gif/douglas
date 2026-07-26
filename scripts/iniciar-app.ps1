$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectRoot "backend"
$frontendDir = Join-Path $projectRoot "frontend"
$backendEnv = Join-Path $backendDir ".env"
$frontendEnv = Join-Path $frontendDir ".env"

function Write-Step([string]$message) {
    Write-Host "`n==> $message" -ForegroundColor Yellow
}

function Find-Python {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) { return $python.Source }

    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) { return $launcher.Source }

    throw "Python 3 não encontrado. Instale pelo site python.org e marque 'Add Python to PATH'."
}

function Restore-OriginalEnvironment {
    if (Test-Path -LiteralPath $backendEnv) { return }

    $originalZip = Join-Path $env:USERPROFILE "Downloads\douglas.zip"
    if (-not (Test-Path -LiteralPath $originalZip)) {
        throw "Não encontrei $originalZip. Coloque o douglas.zip original na pasta Downloads."
    }

    Write-Step "Recuperando a conexão do banco do projeto original"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($originalZip)
    try {
        $entry = $archive.Entries |
            Where-Object { $_.FullName -eq "douglas/backend/.env" } |
            Select-Object -First 1
        if (-not $entry) {
            throw "O arquivo backend/.env não foi encontrado no ZIP original."
        }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $backendEnv, $true)
    }
    finally {
        $archive.Dispose()
    }
}

function Wait-ForUrl([string]$url, [int]$attempts = 30) {
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "O serviço não respondeu em $url."
}

Restore-OriginalEnvironment

if (-not (Test-Path -LiteralPath $frontendEnv)) {
    "EXPO_PUBLIC_BACKEND_URL=http://localhost:8000" |
        Set-Content -LiteralPath $frontendEnv -Encoding ascii
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    throw "Node.js não encontrado. Instale a versão LTS pelo site nodejs.org."
}

$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Step "Criando o ambiente Python"
    $systemPython = Find-Python
    if ([IO.Path]::GetFileName($systemPython) -eq "py.exe") {
        & $systemPython -3 -m venv (Join-Path $backendDir ".venv")
    }
    else {
        & $systemPython -m venv (Join-Path $backendDir ".venv")
    }
}

Write-Step "Instalando dependências do backend"
& $venvPython -m pip install --disable-pip-version-check -q -r (Join-Path $backendDir "requirements.txt")

if (-not (Test-Path -LiteralPath (Join-Path $frontendDir "node_modules"))) {
    Write-Step "Instalando dependências do aplicativo"
    Push-Location $frontendDir
    try {
        & $npm.Source install --ignore-scripts
    }
    finally {
        Pop-Location
    }
}

$backendRunning = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (-not $backendRunning) {
    Write-Step "Iniciando o backend"
    Start-Process -FilePath $venvPython `
        -ArgumentList "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000" `
        -WorkingDirectory $backendDir `
        -WindowStyle Hidden
}

Wait-ForUrl "http://localhost:8000/"

$frontendRunning = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
if (-not $frontendRunning) {
    Write-Step "Iniciando o aplicativo"
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npm.cmd run web -- --port 8081" `
        -WorkingDirectory $frontendDir `
        -WindowStyle Hidden
}

Wait-ForUrl "http://localhost:8081/"
Write-Host "`nAplicativo pronto em http://localhost:8081" -ForegroundColor Green
Start-Process "http://localhost:8081"
