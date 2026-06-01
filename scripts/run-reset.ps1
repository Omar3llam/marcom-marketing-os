# Auto-confirm and run database reset
$env:DATABASE_URL = "postgresql://postgres:%40oMAR%40102@localhost:5432/marcom"
echo "RESET MARCOM DATA" | node scripts/reset-database-only.js
