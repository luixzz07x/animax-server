#!/usr/bin/env bash
# ANIMAX v5.3-FIX · Verifica la aplicación del fix sobre tu repo.
#
# El zip ANIMAX-RENDER-FIX-V5.3.zip lleva los archivos CON su ruta de
# repo (index.ts, src/…, public/…). Descomprímelo en la RAÍZ de tu
# clon de github.com/luixzz07x/animax-server (sobrescribe) y corre:
#
#     bash copiar-fix.sh
#
# Este script solo verifica que todo quedó en su sitio y te deja el
# commit listo para hacer push (Render re-despliega solo).
set -euo pipefail

if [ ! -f package.json ] || ! grep -q "animax-server" package.json; then
  echo "✗ Ejecuta este script DENTRO de la raíz del repo animax-server"
  echo "  (donde vive tu package.json original)."
  exit 1
fi

FILES=(
  "index.ts"
  "package.json"
  "src/config/ajustes.json"
  "src/core/salud.ts"
  "src/core/eventos.ts"
  "src/vigilante/vigilante.ts"
  "src/rutas/rutasSalud.ts"
  "src/rutas/rutasAdmin.ts"
  "src/lib/animax/http.ts"
  "src/panel/guion.ts"
  "src/panel/plantilla.ts"
  "src/middleware/registro.ts"
  "public/img/icono.png"
)

FALTAN=0
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "  ✓ $f"
  else
    echo "  ✗ falta: $f"
    FALTAN=$((FALTAN+1))
  fi
done

if [ "$FALTAN" -gt 0 ]; then
  echo ""
  echo "✗ Faltan $FALTAN archivo(s): descomprime el zip COMPLETO en esta"
  echo "  carpeta (unzip -o ANIMAX-RENDER-FIX-V5.3.zip) y vuelve a correr el script."
  exit 1
fi

echo ""
echo "✓ Fix v5.3 completo (13 archivos)."
echo ""
echo "Siguiente paso:"
echo "  git add -A"
echo "  git commit -m 'v5.3: sondeo adaptativo, panel honesto, keep-awake, proxy opcional'"
echo "  git push"
echo ""
echo "Render reconstruirá solo. Opcional en Render → Environment:"
echo "  PROXY_URL=http://usuario:clave@host:puerto   (revive las fuentes limitadas)"
echo "  MANTENER_DESPIERTO=0                         (apaga el keep-awake)"
