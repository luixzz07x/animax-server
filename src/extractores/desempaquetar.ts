// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Desempaquetador del PACKER "p,a,c,k,e,d" (formato
// eval(function(p,a,c,k,e,d){…}('payload',base,count,'k|k|k',…)).
// Mixdrop, FileLions y familia ofuscan el JS del player con este
// packer clásico de Dean Edwards. Aquí se decodifica SIN eval:
//   1. Se extraen payload p, base a, count c y el diccionario k.
//   2. Cada índice i < c se codifica "en base a" con el charset
//      0-9a-zA-Z (hasta base 62) → token e(i).
//   3. En el payload, cada token \b(e(i))\b se sustituye por k[i]
//      (si k[i] está vacío, el token se queda tal cual).
// Devuelve el JS ya desofuscado (o null si no hay packer).
// ─────────────────────────────────────────────────────────────

/** Charset del packer: 0-9 (base ≤10), +a-z (≤36), +A-Z (≤62). */
const CHARSET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Codifica n "en base a" (lo que hace e(c) dentro del packer). */
function enBase(n: number, a: number): string {
  if (n < a) return CHARSET[n];
  return enBase(Math.floor(n / a), a) + CHARSET[n % a];
}

const PATRON_PACK = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]{0,200}?\}\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/;

/** Desescapa un literal del packer (\' \\ \n …). */
function desescapar(s: string): string {
  return s
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n");
}

/** Desempaqueta el primer packer del HTML (null si no hay). */
export function desempaquetar(html: string): string | null {
  const m = html.match(PATRON_PACK);
  if (!m) return null;
  const payload = desescapar(m[1]);
  const base = parseInt(m[2], 10);
  const count = parseInt(m[3], 10);
  const llaves = desescapar(m[4]).split("|");
  if (!base || base < 2 || base > 62 || count < 1) return null;

  // Diccionario token → palabra del diccionario k
  const diccionario = new Map<string, string>();
  for (let i = 0; i < count && i < llaves.length; i++) {
    if (llaves[i] !== "") diccionario.set(enBase(i, base), llaves[i]);
  }

  // Sustituye \b(token)\b por su palabra (los tokens son alfanuméricos)
  let salida = payload;
  for (const [token, palabra] of diccionario) {
    salida = salida.replace(new RegExp(`\\b${token}\\b`, "g"), palabra.replace(/\$/g, "$$$$"));
  }
  return salida;
}

/** Desempaqueta y, si el resultado a su vez trae OTRO packer
 *  (cadenas dobles reales), sigue hasta 3 niveles. */
export function desempaquetarProfundo(html: string): string | null {
  let actual: string | null = html;
  for (let nivel = 0; nivel < 3; nivel++) {
    const siguiente = desempaquetar(actual);
    if (siguiente === null) return nivel === 0 ? null : actual;
    actual = siguiente;
  }
  return actual;
}

export default desempaquetar;
