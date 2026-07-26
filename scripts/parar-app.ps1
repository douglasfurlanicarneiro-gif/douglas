$ports = 8000, 8081

foreach ($port in $ports) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        Stop-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    }
}

Write-Host "Backend e aplicativo encerrados." -ForegroundColor Green
