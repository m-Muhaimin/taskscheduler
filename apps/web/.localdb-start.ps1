$env:PATH = 'C:\Windows\System32;' + $env:PATH
Set-Location 'H:\tradescheduling\apps\web'
Start-Process -FilePath 'node' -ArgumentList 'H:\tradescheduling\node_modules\next\dist\bin\next','start','--port','3100' -WindowStyle Hidden `
  -RedirectStandardOutput 'H:\tradescheduling\apps\web\.web.out.log' `
  -RedirectStandardError  'H:\tradescheduling\apps\web\.web.err.log'
Write-Output 'web launched'
