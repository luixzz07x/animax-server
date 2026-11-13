#!/usr/bin/env bash
# ANIMAX v5.2-FIX · Copia los archivos del parche sobre tu repo local.
# Uso: descomprime ANIMAX-SERVER-FIX-RENDER.zip, entra a la carpeta y corre:
#   bash copiar-fix.sh /ruta/de/tu/repo-animax-server
# (sin argumento usa el directorio actual)
set -euo pipefail
DEST="${1:-.}"
if [ ! -f "$DEST/index.ts" ] || [ ! -d "$DEST/src/core" ]; then
  echo "ERROR: '$DEST' no parece el repo de animax-server (falta index.ts / src/core)."
  echo "Uso: bash copiar-fix.sh /ruta/de/tu/repo"
  exit 1
fi
for f in index.ts package.json src/config/ajustes.json src/config/fuentes.json \
         src/lib/animax/fuentes.json src/core/salud.ts src/core/eventos.ts \
         src/vigilante/vigilante.ts src/rutas/rutasSalud.ts src/rutas/rutasUltimos.ts; do
  mkdir -p "$DEST/$(dirname "$f")"
  cp "$f" "$DEST/$f"
  echo "  ✓ $f"
done
echo "Listo. Ahora: git add -A && git commit -m 'v5.2: fix Render free' && git push"
