$ErrorActionPreference = 'Stop'
$workerDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $workerDir '.env.local'
$sessionPath = Join-Path $workerDir 'data\adminml-session.enc'

Write-Host 'Configuracao segura do coletor JMRoutes' -ForegroundColor Cyan
$email = Read-Host 'E-mail usado para entrar no JMRoutes'
$passwordSecure = Read-Host 'Senha do JMRoutes' -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }
$passwordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($password))

Write-Host 'Credenciais do AdminML (o Okta Verify continuara exigindo aprovacao no celular)' -ForegroundColor Cyan
$adminMlUsername = Read-Host 'Usuario do AdminML'
$adminMlPasswordSecure = Read-Host 'Senha do AdminML' -AsSecureString
$adminMlPasswordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminMlPasswordSecure)
try { $adminMlPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminMlPasswordPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminMlPasswordPtr) }
$adminMlPasswordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($adminMlPassword))

$rootEnv = Join-Path $workerDir '..\..\.env'
$publicKeyLine = Get-Content $rootEnv | Where-Object { $_ -match '^(VITE_)?SUPABASE_(ANON_KEY|PUBLISHABLE_KEY)=' } | Select-Object -First 1
if (-not $publicKeyLine) { throw 'Chave publica do Supabase nao encontrada no .env do projeto.' }
$publicKey = ($publicKeyLine -split '=', 2)[1].Trim('"')
$keyBytes = New-Object byte[] 32
$keyGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $keyGenerator.GetBytes($keyBytes) }
finally { $keyGenerator.Dispose() }
$sessionKey = [Convert]::ToBase64String($keyBytes)

New-Item -ItemType Directory -Force (Split-Path $sessionPath) | Out-Null
New-Item -ItemType Directory -Force (Join-Path $workerDir 'logs') | Out-Null
$lines = @(
  'JMR_BASE_URL=https://jmroutes.app'
  'SUPABASE_URL=https://zfmwojloamwggahjxlyt.supabase.co'
  "SUPABASE_ANON_KEY=$publicKey"
  "WORKER_EMAIL=$email"
  "WORKER_PASSWORD_BASE64=$passwordBase64"
  "ADMINML_USERNAME=$adminMlUsername"
  "ADMINML_PASSWORD_BASE64=$adminMlPasswordBase64"
  "WORKER_SESSION_KEY=$sessionKey"
  "SESSION_FILE_PATH=$sessionPath"
  'BASE_CODES=SSP3,SSP38,ESP15,SSP5,SSP20,ESP17,ESP16,SSP17,ESP18,SSP6,SSP45,SSP15,SSP37,SSP23,SSC2'
  'WRITE_BASE_CODES=SSP3,SSP38,ESP15,SSP5,SSP20,ESP17,ESP16,SSP17,ESP18,SSP6,SSP45,SSP15,SSP37,SSP23,SSC2'
  'SITE_ID=MLB'
  'SYNC_INTERVAL_SECONDS=60'
  'SYNC_PROTOCOL_LOTES=false'
  'DRY_RUN=false'
)
[IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding $false))
icacls $envPath /inheritance:r /grant:r "$env:USERNAME`:F" | Out-Null

Write-Host 'Abrindo o AdminML. Conclua o login e o MFA no navegador.' -ForegroundColor Yellow
Push-Location $workerDir
try {
  & 'C:\Program Files\nodejs\node.exe' --env-file=.env.local node_modules\tsx\dist\cli.mjs scripts\auth.ts
  if ($LASTEXITCODE -ne 0) { throw 'Autenticacao do AdminML nao foi concluida.' }
} finally { Pop-Location }

Write-Host 'Configuracao concluida em modo de producao: os workers poderao gravar leituras no JMRoutes.' -ForegroundColor Green
Read-Host 'Pressione ENTER para fechar'
