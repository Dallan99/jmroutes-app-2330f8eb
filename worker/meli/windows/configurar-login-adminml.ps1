$ErrorActionPreference = 'Stop'
$workerDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $workerDir '.env.local'

if (-not (Test-Path $envPath)) {
  throw 'Coletor ainda nao configurado. Execute primeiro CONFIGURAR-COLETOR.cmd.'
}

Write-Host 'Login assistido do AdminML' -ForegroundColor Cyan
Write-Host 'O worker preenchera usuario e senha. A aprovacao no Okta Verify continuara sendo feita no celular.'
$username = Read-Host 'Usuario do AdminML'
$passwordSecure = Read-Host 'Senha do AdminML' -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }
$passwordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($password))

$lines = Get-Content $envPath | Where-Object {
  $_ -notmatch '^ADMINML_USERNAME=' -and $_ -notmatch '^ADMINML_PASSWORD_BASE64='
}
$lines += "ADMINML_USERNAME=$username"
$lines += "ADMINML_PASSWORD_BASE64=$passwordBase64"
[IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding $false))
icacls $envPath /inheritance:r /grant:r "$env:USERNAME`:F" | Out-Null

Write-Host 'Abrindo o AdminML. Aprove a solicitacao no Okta Verify quando ela aparecer.' -ForegroundColor Yellow
Push-Location $workerDir
try {
  & 'C:\Program Files\nodejs\node.exe' --env-file=.env.local node_modules\tsx\dist\cli.mjs scripts\auth.ts
  if ($LASTEXITCODE -ne 0) { throw 'Autenticacao do AdminML nao foi concluida.' }
} finally { Pop-Location }

Write-Host 'Login concluido. A sessao foi cifrada e sera reutilizada automaticamente.' -ForegroundColor Green
Read-Host 'Pressione ENTER para fechar'
