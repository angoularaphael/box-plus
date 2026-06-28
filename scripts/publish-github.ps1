$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BoxPlus = $Root
$BotOut = Join-Path (Split-Path -Parent $Root) "boxi-deci-bot"

Write-Host "=== Publish box-plus ===" 
Set-Location $BoxPlus
if (-not (Test-Path ".git")) { git init -b main }
git add -A
git status

Write-Host "=== Build boxi-deci-bot folder ==="
if (Test-Path $BotOut) { Remove-Item $BotOut -Recurse -Force }
New-Item -ItemType Directory -Path $BotOut | Out-Null

$copyDirs = @("bot", "lib", "config")
foreach ($d in $copyDirs) {
  Copy-Item (Join-Path $BoxPlus $d) (Join-Path $BotOut $d) -Recurse
}

New-Item -ItemType Directory -Path (Join-Path $BotOut "storefront\lib") -Force | Out-Null
Copy-Item (Join-Path $BoxPlus "storefront\lib\deciplus-sync.js") (Join-Path $BotOut "storefront\lib\")
Copy-Item (Join-Path $BoxPlus "storefront\lib\storefront-copy.js") (Join-Path $BotOut "storefront\lib\")
Copy-Item (Join-Path $BoxPlus "storefront\products.json") (Join-Path $BotOut "storefront\")
Copy-Item (Join-Path $BoxPlus "storefront\products-overrides.json") (Join-Path $BotOut "storefront\")

Copy-Item (Join-Path $BoxPlus "start.js") $BotOut
Copy-Item (Join-Path $BoxPlus "bot\.env.example") (Join-Path $BotOut ".env.example")

@'
{
  "name": "boxi-deci-bot",
  "version": "1.0.0",
  "private": true,
  "description": "Bot RPA Deciplus — Boxing Center",
  "main": "start.js",
  "scripts": {
    "start": "node start.js",
    "bot:run": "node bot/index.js",
    "postinstall": "npx playwright install chromium"
  },
  "dependencies": {
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "playwright": "^1.51.1"
  }
}
'@ | Set-Content (Join-Path $BotOut "package.json") -Encoding UTF8

@'
node_modules/
.env
data/session/
data/queue/
logs/
playwright-report/
'@ | Set-Content (Join-Path $BotOut ".gitignore") -Encoding UTF8

Copy-Item (Join-Path $BoxPlus "README-BOT.md") (Join-Path $BotOut "README.md")

New-Item -ItemType Directory -Path (Join-Path $BotOut "data\session") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $BotOut "data\queue") -Force | Out-Null

Write-Host "Bot repo ready at $BotOut"
