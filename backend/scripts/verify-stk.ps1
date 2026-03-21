param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$Phone = '254708374149',
  [int]$Amount = 1
)

$ErrorActionPreference = 'Stop'

Write-Output '=== STK Test Verification ==='

$envPath = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envPath)) {
  Write-Output 'FAIL: backend/.env not found.'
  exit 1
}

$envContent = Get-Content $envPath

function Get-EnvValue([string]$key) {
  $line = $envContent | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line -replace "^$key=", '').Trim()
}

$key = Get-EnvValue 'DARAJA_CONSUMER_KEY'
$secret = Get-EnvValue 'DARAJA_CONSUMER_SECRET'
$short = Get-EnvValue 'DARAJA_SHORTCODE'
$pass = Get-EnvValue 'DARAJA_PASSKEY'
$callback = Get-EnvValue 'DARAJA_CALLBACK_URL'
$txnType = Get-EnvValue 'DARAJA_TRANSACTION_TYPE'
$baseUrlEnv = Get-EnvValue 'DARAJA_BASE_URL'
$isSandbox = $baseUrlEnv -match 'sandbox.safaricom.co.ke'

$placeholders = @(
  'your_consumer_key',
  'your_consumer_secret',
  'your_shortcode_or_till_number',
  'your_lipa_na_mpesa_online_passkey',
  'https://replace-with-your-public-url/api/stk_callback'
)

$missing = @()
if ([string]::IsNullOrWhiteSpace($key)) { $missing += 'DARAJA_CONSUMER_KEY' }
if ([string]::IsNullOrWhiteSpace($secret)) { $missing += 'DARAJA_CONSUMER_SECRET' }
if ([string]::IsNullOrWhiteSpace($short) -and -not $isSandbox) { $missing += 'DARAJA_SHORTCODE' }
if ([string]::IsNullOrWhiteSpace($pass) -and -not $isSandbox) { $missing += 'DARAJA_PASSKEY' }
if ([string]::IsNullOrWhiteSpace($callback)) { $missing += 'DARAJA_CALLBACK_URL' }

if ($missing.Count -gt 0) {
  Write-Output ("FAIL: Missing .env values -> " + ($missing -join ', '))
  exit 1
}

if ($placeholders -contains $key -or $placeholders -contains $secret -or $placeholders -contains $callback) {
  Write-Output 'FAIL: .env still has placeholder values.'
  exit 1
}

if (-not [string]::IsNullOrWhiteSpace($pass) -and $pass -match '\s') {
  Write-Output 'FAIL: DARAJA_PASSKEY has whitespace. Use one continuous string.'
  exit 1
}

if ($isSandbox -and [string]::IsNullOrWhiteSpace($short) -and [string]::IsNullOrWhiteSpace($pass)) {
  Write-Output 'INFO: Using Daraja sandbox shared STK defaults (shortcode/passkey).'
}

Write-Output ("INFO: TransactionType=" + $txnType)
Write-Output ("INFO: CallbackURL=" + $callback)

$health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health" -TimeoutSec 20
Write-Output ("HEALTH_OK=" + $health.ok)

$readiness = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/stk_readiness" -TimeoutSec 20
Write-Output ("READINESS_OK=" + $readiness.ok)
if (-not $readiness.ok) {
  Write-Output ("READINESS_DETAILS=" + ($readiness | ConvertTo-Json -Depth 5 -Compress))
  exit 1
}

$payload = @{ phone = $Phone; amount = $Amount } | ConvertTo-Json
try {
  $raw = Invoke-WebRequest -Method Post -Uri "$BaseUrl/api/stk_initiate.js" -ContentType 'application/json' -Body $payload -UseBasicParsing -TimeoutSec 90
  $init = $raw.Content | ConvertFrom-Json
  Write-Output 'STK_INITIATE_OK=true'
  Write-Output ("STK_RESPONSE=" + ($init | ConvertTo-Json -Depth 5 -Compress))
} catch {
  if ($_.Exception.Response) {
    $resp = $_.Exception.Response
    $status = [int]$resp.StatusCode
    $body = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $body = $_.ErrorDetails.Message
    }
    if ([string]::IsNullOrWhiteSpace($body)) {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $body = $reader.ReadToEnd()
    }
    Write-Output ("STK_INITIATE_OK=false STATUS=" + $status)
    Write-Output ("STK_ERROR=" + $body)
    exit 2
  }
  Write-Output ("STK_INITIATE_OK=false ERROR=" + $_.Exception.Message)
  exit 2
}
