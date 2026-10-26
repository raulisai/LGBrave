#!/bin/bash
# Run after updating the checkout. Preserves local library, TV session and login-start preference.
set -euo pipefail
if [ "$(uname -s)" != "Darwin" ]; then echo "Este actualizador es para macOS."; exit 1; fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$TASK_ROOT"
command -v node >/dev/null || { echo "Hace falta Node.js 22.13 o posterior."; exit 1; }
[ -f desktop/shared/peer-sync.mjs ] || { echo "Primero actualiza el repositorio con la integración de sincronización."; exit 1; }
echo "Comprobando el código y generando las interfaces..."
npm test
npm run build:all
npm run browser:companion
# Only pairs credentials here; a running service keeps sole ownership of its in-memory data.
node scripts/profile-sync.mjs setup
npm run desktop:restart
sleep 3
node scripts/profile-sync.mjs status
echo "Listo. La biblioteca se combinará automáticamente cuando Windows esté conectado."
echo "Para guardar el minuto en Chrome/Brave/Edge, carga artifacts/holy-companion una vez."
echo "Consulta docs/TAREAS-MAC-SINCRONIZACION.md. No se cambió tu inicio automático."
