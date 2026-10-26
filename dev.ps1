# Windows equivalent of the Makefile: ./dev.ps1 <up|down|migrate|seed|reset|test|logs|web-dev|build>
param([Parameter(Position = 0)][string]$Command = "help")

# Docker writes progress to stderr, so rely on exit codes rather than $ErrorActionPreference.
Set-Location $PSScriptRoot

switch ($Command) {
  "up"      { docker compose up -d --build }
  "down"    { docker compose down }
  "migrate" { docker compose exec api alembic upgrade head }
  "seed"    { docker compose exec api python -m app.seed seed }
  "reset"   { docker compose exec api python -m app.seed reset }
  "test"    { docker compose exec api python -m pytest }
  "logs"    { docker compose logs -f api web }
  "web-dev" { Push-Location frontend; npm install; npm run dev; Pop-Location }
  "build"   { Push-Location frontend; npm run build; Pop-Location }
  default   { Write-Host "Usage: ./dev.ps1 <up|down|migrate|seed|reset|test|logs|web-dev|build>" }
}
exit $LASTEXITCODE
