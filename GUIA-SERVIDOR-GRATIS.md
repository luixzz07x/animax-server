# 🛡️ AniMax 8.0.2 — Guía completa: tu servidor GRATIS (sin Render)

> Render te funciona pero **se duerme** a los 15 minutos sin tráfico y tarda
> ~50 s en despertar (por eso a veces la app "no encontraba nada"). Aquí
> tienes 4 alternativas gratis de verdad, ordenadas de mejor a más simple.

El servidor de AniMax es **Node puro, cero dependencias npm** (lo acabamos de
probar: arranca en 2 segundos). Eso lo hace compatible con TODAS estas
plataformas sin instalar nada.

---

## 🥇 Opción 1 · Oracle Cloud Always Free — LA MEJOR (gratis PARA SIEMPRE)

**Qué da:** una VM real gratis para siempre — hasta 4 cores ARM y 24 GB de RAM
(no es broma: es la capa gratuita más generosa del mercado). No se duerme jamás.
**Requiere:** tarjeta de crédito/débito SOLO para verificar que eres humano
**NO te cobra nada** — es la capa "Always Free", no una prueba.

### Paso a paso (≈20 minutos)

1. Entra a **cloud.oracle.com** → "Start for free" → crea la cuenta con tu
   correo y tu tarjeta (verificación de 1-2 USD que se devuelve).
2. En la consola, menú ☰ → **Compute → Instances → Create instance**.
3. Configura así:
   - **Name:** `animax`
   - **Image:** Canonical **Ubuntu 22.04** (o 24.04)
   - **Shape:** cambia "VM.Standard.E2.1.Micro" por **VM.Standard.A1.Flex**
     con **2 OCPUs y 6 GB** (sigue siendo gratis; el límite son 4 OCPU/24 GB).
   - **SSH key:** marca "Generate key pair" y DESCARGA la clave `.key`
     privada y la `.pub` (sin la privada no podrás entrar).
4. Botón **Create**. Espera 2 min a que quede "RUNNING" y copia la **Public IP**.
5. Abre los puertos. Menú ☰ → **Networking → Virtual Cloud Networks** →
   entra a tu VCN → **Security Lists** → "Default Security List" →
   **Add Ingress Rules** (dos veces):
   - `Source: 0.0.0.0/0 · IP Protocol: TCP · Destination Port: 3001`
   - `Source: 0.0.0.0/0 · IP Protocol: TCP · Destination Port: 22`
6. Desde tu PC (o Termux en el móvil) conéctate:
   ```bash
   ssh -i ruta/a/tu-clave.key ubuntu@LA_IP_PUBLICA
   ```
7. Dentro de la VM, instala Node y sube el server:
   ```bash
   sudo apt update && sudo apt install -y nodejs npm
   # sube la carpeta animax-server (scp, SFTP, o git clone de tu repo)
   scp -i tu-clave.key -r animax-server ubuntu@LA_IP_PUBLICA:~/
   ```
8. Arranca el server **para siempre** (se reinicia solo si la VM reinicia):
   ```bash
   sudo npm install -g pm2
   cd ~/animax-server
   pm2 start index.js --name animax
   pm2 save && pm2 startup   # ejecuta el comando que te imprima
   ```
9. Pruébalo desde el navegador del móvil: `http://LA_IP_PUBLICA:3001/api/ping`
   → debe responder `{"ok":true,...}`.

**En la app:** Perfil → *Servidor de búsqueda* → pega
`http://LA_IP_PUBLICA:3001` → "Probar conexión" → ✓ Conectado.

> ⚠️ Las VMs Always Free de Oracle pueden reclamarse si quedan **90 días sin
> CPU bajo 20%** (las "idle"). Como AniMax hace búsquedas constantes, no te
> va a pasar. Si quieres estar seguro, el watchdog ya sondea cada 6 h.

---

## 🥈 Opción 2 · Fly.io — la más rápida de montar (5 minutos)

**Qué da:** hasta 3 mini-VMs gratis (256 MB RAM cada una) — suficiente para
animax-server (Node puro, come ~60 MB). No se duerme como Render.
**Requiere:** tarjeta para verificar (no cobra en el plan de pago por uso si
te quedas en los 3 contenedores "legacy" gratis).

1. Instala Fly desde tu PC: https://fly.io/docs/flyctl/install/
2. Cuenta gratis en fly.io (plan "Pay as you go", sin cargo).
3. En la carpeta `animax-server/` (ya tiene el Dockerfile 8.0.2):
   ```bash
   fly launch --name animax-tuusuario --region bog --no-deploy
   fly deploy
   ```
4. Te queda: `https://animax-tuusuario.fly.dev` — pruébalo:
   ```bash
   curl https://animax-tuusuario.fly.dev/api/ping
   ```
5. En la app pega `https://animax-tuusuario.fly.dev`.

> `--region bog` = nodo de Bogotá: latencia mínima desde Colombia. 🇨🇴

---

## 🥉 Opción 3 · Koyeb — sin Docker ni tarjeta

**Qué da:** 1 servicio web gratis (512 MB, "sleep" solo tras días inactivo).
**Web:** koyeb.com → "Create Service" → **GitHub** (sube la carpeta
animax-server a un repo) → Builder: **Buildpack** → Run command:
`node index.js` → Deploy. Te da `https://tuapp.koyeb.app`.

---

## 🎁 Opción 4 · Tu propia PC como servidor (100% gratis, cero límites)

Si dejas el PC encendido, **Cloudflare Tunnel** te da una URL pública
HTTPS gratis sin abrir puertos del router:

```bash
# 1) Instala cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
# 2) Entra sin cuenta (túnel rápido anónimo):
cd animax-server && node index.js &     # arranca el server en :3001
cloudflared tunnel --url http://localhost:3001
```

Te imprime algo como `https://random-words.trycloudflare.com` → esa URL
funciona desde tu app en cualquier parte del mundo mientras el PC esté
encendido. (Para URL fija: cuenta gratis de Cloudflare + `cloudflared tunnel login`.)

---

## 📲 Conectar la app con el servidor (común a todas)

1. AniMax → pestaña **Perfil** → baja hasta **"Servidor de búsqueda"**.
2. Pega la URL (ej. `https://animax-tuusuario.fly.dev`).
3. Toca **"Probar conexión"** → debe decir `✓ Conectado (XXX ms)`.

Con el servidor conectado, la app 8.0.2 hace algo NUEVO al arrancar:
descarga en silencio **la capa nube** (`/api/cloud/*`) y se mejora sola:

| Endpoint | Qué actualiza en tu app sin tocar el APK |
|---|---|
| `/api/cloud/sources` | Fuentes de búsqueda vigentes (con dominios frescos rotados por el watchdog) |
| `/api/cloud/servers` | La "ServerFarm": los 26 servidores de video con su prioridad |
| `/api/cloud/streamblock` | Blocklist de anuncios DE VIDEO (los cosidos en los m3u8) → refuerza el filtro HLS |

**Para añadir una fuente nueva más tarde:** en el server, arráncalo con la
variable `ANIMAX_SITES` y la app la verá al día siguiente — sin publicar APK:
```bash
ANIMAX_SITES="animeejemplo.com|https://animeejemplo.com/?s={q}|latino|anime" pm2 start index.js --name animax
```

---

## 🔐 ¿Y la API key? (opcional, uso privado)

Si tu URL es pública y no quieres que otro la use, define `ANIMAX_API_KEY`
en el server (`fly secrets set ANIMAX_API_KEY=miclave` o en pm2) y escribe
la misma clave en Perfil → Servidor de búsqueda → campo "API key".

## ⚖️ Comparativa rápida

| | ¿Se duerme? | RAM | Tarjeta | Dificultad | Ideal para |
|---|---|---|---|---|---|
| **Oracle Cloud** | ❌ nunca | 24 GB | Sí (verifica) | 20 min | Uso serio diario |
| **Fly.io** | ❌ | 256 MB | Sí (verifica) | 5 min | Lo mejor rápido |
| **Koyeb** | días inactivo | 512 MB | No | 10 min | Probar sin tarjeta |
| **Cloudflare Tunnel** | cuando apagues el PC | la de tu PC | No | 3 min | PC siempre encendido |
| ~~Render~~ | 💤 15 min | 512 MB | No | 5 min | (por eso lo dejas) |

---
*Guía incluida en ANIMAX-8.0.2 · server v8.0.2 (Node puro, 0 dependencias)*
