# Pousse les URLs pooler boutique vers Vercel (projet BOXPLUS).
# Prerequis : vercel login (une fois) puis depuis BOXPLUS : vercel link
param(
  [string]$DatabaseUrl = $env:DATABASE_URL
)

if (-not $DatabaseUrl) {
  Write-Error 'DATABASE_URL manquant. Charge BOXPLUS/.env ou passe -DatabaseUrl.'
  exit 1
}

$vars = @{
  DATABASE_URL = $DatabaseUrl
  SUPABASE_DB_URL = $DatabaseUrl
  SUPABASE_POOLER_SESSION = $DatabaseUrl
  SUPABASE_POOLER_TRANSACTION = $DatabaseUrl -replace ':5432/', ':6543/'
}

foreach ($envName in @('production', 'preview', 'development')) {
  foreach ($key in $vars.Keys) {
    Write-Host "vercel env add $key $envName"
    $vars[$key] | vercel env add $key $envName --force
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
}

Write-Host 'OK — redeploy la boutique si besoin (Settings > Redeploy).'
