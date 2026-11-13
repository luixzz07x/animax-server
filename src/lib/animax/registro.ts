// ─────────────────────────────────────────────────────────────
// ANIMAX · Registro de fuentes (el corazón de la VELOCIDAD).
//  - Todas las consultas a fuentes van en PARALELO (Promise.all)
//  - Timeout por fuente (3s búsqueda / 7s detalle): la fuente lenta
//    se ignora y se muestran las demás (failover silencioso)
//  - Caché TTL en cada nivel (ver cache.ts)
//  - Búsqueda unificada + deduplicación + indexado oportunista
//  - PRIORIDAD LATINO: el idioma de una entrada es el MEJOR idioma
//    disponible entre todas sus fuentes (latino > dual > sub)
//  - DISPONIBILIDAD: nunca se devuelven entradas muertas (0 episodios
//    y sin fuente viva); el detalle y los servidores re-buscan en
//    vivo por título si hace falta (fallback universal)
// ─────────────────────────────────────────────────────────────

import tuningJson from "./fuentes.json";
import { conCache, invalidar, obtener, guardar } from "./cache";
import { normalizarTitulo } from "./http";
import { expansionesBusqueda } from "../../datos/aliasDb";
import { fuenteDisponible, registrarExito, registrarFallo } from "../../core/salud";
import { encolar } from "../../core/cola";
import { fuenteHabilitada } from "../../core/fuentes";
import {
  deduplicar,
  deduplicarFeed,
  ordenarPorRelevancia,
  slugDeduplicado,
  mejorIdioma,
  grupoDeFuente,
} from "./dedupe";
import {
  catalogoIndice,
  entradaATarjeta,
  enriquecerConIndice,
  indexarAnime,
  indexarTarjetas,
  leerIndice,
  registrarEpisodios,
} from "./indice";
import type {
  AnimeCard,
  AnimeDetalle,
  AnimeFuenteRef,
  EpisodioFeed,
  EpisodioItem,
  Idioma,
  RespuestaAPI,
  Scraper,
  ServidorVideo,
} from "./types";

import {
  animeflv,
  tioanime,
  animefenix,
  monoschinos,
  jkanime,
  animeblix,
  shuu,
  animegratis,
  animelatinohd,
  animemovil,
  animeonline,
  animedlatino,
  animeid,
  animeyt,
  animeleyend,
  otakstv,
  animetwilight,
  animeplus,
  animenova,
  animebuka,
} from "../../scrapers";

interface FuenteCfg {
  id: string;
  nombre: string;
  baseUrl: string;
  idioma: string;
  grupo: string;
  activo: boolean;
  verificado?: boolean;
}

const CFG = tuningJson as unknown as {
  fuentes: FuenteCfg[];
  tuning: Record<string, number>;
};
const TUN = CFG.tuning;

/** Módulos disponibles por id (la fuente solo se usa si está activa en fuentes.json). */
const MODULOS: Record<string, Scraper> = {
  animeflv,
  tioanime,
  animefenix,
  monoschinos,
  jkanime,
  animeblix,
  shuu,
  animegratis,
  animelatinohd,
  animemovil,
  animeonline,
  animedlatino,
  animeid,
  animeyt,
  animeleyend,
  otakstv,
  animetwilight,
  animeplus,
  animenova,
  animebuka,
};

/** Scrapers activos según config central (fuentes.json) + suspensión
 *  runtime (v5.1: panel de administración / API admin). */
export function scrapersActivos(): Scraper[] {
  return CFG.fuentes.filter((f) => fuenteHabilitada(f.id) && MODULOS[f.id]).map((f) => MODULOS[f.id]);
}

/** Nombres legibles por id. */
const NOMBRES: Record<string, string> = Object.fromEntries(CFG.fuentes.map((f) => [f.id, f.nombre]));

export function nombreFuente(id: string): string {
  return NOMBRES[id] || id;
}

/** Ejecuta una función sobre TODOS los scrapers en paralelo con timeout
 *  por fuente, cola de concurrencia por fuente y CIRCUIT BREAKER:
 *  las fuentes con el circuito ABIERTO se omiten al instante (cero
 *  latencia) y los éxitos/fallos realimentan el health-check. */
async function enParalelo<T>(
  fn: (s: Scraper) => Promise<T>,
  timeoutMs: number
): Promise<{ ok: { scraper: Scraper; valor: T }[]; fallidas: string[] }> {
  const scrapers = scrapersActivos();
  const conTimeout = scrapers.map(async (s) => {
    // Circuito abierto (fuente caída): failover instantáneo
    if (!fuenteDisponible(s.id)) return null;
    const inicio = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const valor = (await Promise.race([
        encolar(s.id, () => fn(s)),
        new Promise<never>((_, rej) =>
          ctrl.signal.addEventListener("abort", () => rej(new Error("timeout")))
        ),
      ])) as T;
      registrarExito(s.id, Date.now() - inicio);
      return { scraper: s, valor };
    } catch {
      registrarFallo(s.id, `timeout ${timeoutMs}ms`);
      return null; // failover silencioso
    } finally {
      clearTimeout(t);
    }
  });
  const res = (await Promise.all(conTimeout)) as ({ scraper: Scraper; valor: T } | null)[];
  const ok = res.filter((r): r is { scraper: Scraper; valor: T } => r !== null);
  const fallidas = scrapers.filter((s) => !ok.some((o) => o.scraper.id === s.id)).map((s) => s.id);
  return { ok, fallidas };
}

// ── BÚSQUEDA UNIFICADA (cache 1 h) ───────────────────────────

export async function buscarUnificado(
  q: string
): Promise<RespuestaAPI<{ resultados: AnimeCard[] }> & { fuentesOk: string[]; fuentesFallidas: string[] }> {
  const inicio = Date.now();
  if (!q || q.trim().length < 2) {
    return { ok: true, data: { resultados: [] }, fuentesOk: [], fuentesFallidas: [], ms: 0 };
  }
  const clave = normalizarTitulo(q);
  // ALIAS: la consulta se expande a sus títulos equivalentes (p. ej.
  // "Rent a Girlfriend" → "Kanojo Okarishimasu") y TODAS las variantes
  // se buscan en paralelo en todas las fuentes. Así una búsqueda en
  // inglés SIEMPRE encuentra el romaji con el que las fuentes lo catalogan.
  const terminos = expansionesBusqueda(q);
  const resultado = await conCache("buscar", clave, async () => {
    const porTermino = await Promise.all(
      terminos.map((t) => enParalelo((s) => s.buscar(t), TUN.timeoutFuenteMs ?? 3000))
    );
    const tarjetas = porTermino.flatMap((r) => r.ok.flatMap((o) => o.valor)).filter((t) => t && t.titulo);
    const claves = terminos.map(normalizarTitulo).filter(Boolean);
    // Filtro de seguridad: algunas fuentes (p.ej. TioAnime) devuelven su
    // listado completo cuando la búsqueda no coincide — se descartan aquí.
    // Ahora la coincidencia se acepta contra CUALQUIERA de los términos.
    const relevantes = tarjetas.filter((t) => {
      const tn = normalizarTitulo(t.titulo);
      return claves.some(
        (c) => tn.includes(c) || (c.length >= 4 && tn.length >= 4 && tn.startsWith(c.slice(0, 4)))
      );
    });
    const dedup = deduplicar(relevantes);
    indexarTarjetas(dedup); // indexado oportunista (no bloquea)
    return {
      // ordenarPorRelevancia aplica PRIORIDAD LATINO (latino/dual primero)
      // y puntúa la coincidencia con cualquier término (q o alias).
      resultados: ordenarPorRelevancia(q, dedup, claves.slice(1)).slice(0, 40),
      fuentesOk: porTermino[0].ok.map((o) => o.scraper.id),
      fuentesFallidas: porTermino[0].fallidas,
    };
  });
  // Si no hubo resultados NO se guarda en caché (conCache sí lo guarda):
  // las fuentes lentas (p. ej. AnimeGratis calentando su directorio)
  // deben poder aportar en la siguiente búsqueda.
  if (resultado.resultados.length === 0 && resultado.fuentesFallidas.length > 0) {
    invalidar("buscar", clave);
  }
  return {
    ok: true,
    data: { resultados: resultado.resultados },
    fuentesOk: resultado.fuentesOk,
    fuentesFallidas: resultado.fuentesFallidas,
    ms: Date.now() - inicio,
    cacheado: true,
  };
}

// ── ÚLTIMOS EPISODIOS (cache 10 min, renovado por cron) ──────

export async function ultimosUnificados(): Promise<
  RespuestaAPI<{ episodios: EpisodioFeed[]; populares: AnimeCard[] }>
> {
  const datos = await conCache("ultimos", "global", async () => {
    const { ok } = await enParalelo((s) => s.obtenerUltimos(), TUN.timeoutFuenteMs ?? 3000);
    // deduplicarFeed ordena LATINO primero (prioridad de idioma)
    const feed = deduplicarFeed(ok.flatMap((o) => o.valor).filter(Boolean));
    // Populares = animes que más aparecen en el feed (aprox. tendencias).
    // Se fusionan TODAS las fuentes de cada título y el idioma es el mejor
    // disponible (latino si alguna fuente del grupo latino lo lleva).
    const conteo = new Map<string, AnimeCard>();
    for (const e of feed) {
      const clave = normalizarTitulo(e.titulo);
      const prev = conteo.get(clave);
      const ref = {
        fuente: e.fuente,
        nombre: e.nombreFuente,
        slugLocal: e.slug.split("~")[1] || "",
        idioma: e.idioma as Idioma,
      };
      if (prev) {
        if (!prev.fuentes.some((f) => f.fuente === ref.fuente && f.slugLocal === ref.slugLocal)) {
          prev.fuentes = [...prev.fuentes, ref];
        }
        prev.episodioReciente = Math.max(prev.episodioReciente ?? 0, e.numero);
      } else {
        conteo.set(clave, {
          titulo: e.titulo,
          slug: slugDeduplicado(e.titulo),
          portada: e.portada,
          generos: [],
          idioma: e.idioma,
          fuentes: [ref],
          episodioReciente: e.numero,
        });
      }
    }
    const pref = (i: Idioma) => (i === "latino" ? 0 : i === "dual" ? 1 : 2);
    const populares = [...conteo.values()].map((t) => ({
      ...t,
      idioma: mejorIdioma(t.fuentes),
    }));
    populares.sort((a, b) => {
      const d = pref(a.idioma) - pref(b.idioma); // LATINO primero
      if (d !== 0) return d;
      return (b.episodioReciente ?? 0) - (a.episodioReciente ?? 0);
    });
    // Indexado + registro de episodios (fire and forget)
    indexarTarjetas(populares);
    void registrarEpisodios(feed);
    return { episodios: feed.slice(0, 60), populares: populares.slice(0, 30) };
  });
  return { ok: true, data: datos, cacheado: true };
}

// ── DETALLE DEL ANIME ───────────────────────────────────────
/** slug global: "ded:{tituloNormalizado}" o "{fuente}~{slugLocal}" */

export async function detalleUnificado(slug: string): Promise<RespuestaAPI<AnimeDetalle>> {
  if (!slug) return { ok: false, error: "slug requerido" };

  // 1) slug de una sola fuente: "tioanime~slug"
  if (slug.includes("~")) {
    const [fuente, slugLocal] = slug.split("~");
    const s = MODULOS[fuente];
    if (!s) return { ok: false, error: "fuente desconocida" };
    const detalle = await conCache("detalle", slug, async () => {
      const d = await s.obtenerAnime(slugLocal);
      if (!d) return null;
      return await enriquecerConIndice(d);
    });
    if (detalle) return { ok: true, data: detalle };
    // fallback: índice
    const entrada = await leerIndice(slugDeduplicado(slugLocal.replace(/-/g, " ")));
    if (entrada) return { ok: true, data: entradaATarjeta(entrada) as AnimeDetalle };
    return { ok: false, error: "anime no encontrado" };
  }

  // 2) slug deduplicado: "ded:{tituloNormalizado}"
  const entrada = await leerIndice(slug);
  const tituloOriginal = slug.replace(/^ded:/, "").replace(/ /g, "-");
  if (!entrada || entrada.fuentes.length === 0) {
    // Sin índice: intentamos con las fuentes verificadas por título
    const res = await buscarUnificado(tituloOriginal.replace(/-/g, " "));
    const primera = res.data?.resultados?.find((t) => t.slug === slug);
    if (primera && primera.fuentes[0]) {
      return detalleUnificado(primera.fuentes[0].slugLocal
        ? `${primera.fuentes[0].fuente}~${primera.fuentes[0].slugLocal}`
        : `${primera.slug}`);
    }
    return { ok: false, error: "anime no encontrado" };
  }

  // Detalle en paralelo de TODAS las fuentes indexadas → fusión
  const detalle = await conCache("detalle", slug, async () => {
    const { ok } = await enParalelo(
      (s) => {
        const ref = entrada.fuentes.find((f) => f.fuente === s.id);
        if (!ref) return Promise.resolve(null);
        return s.obtenerAnime(ref.slugLocal);
      },
      TUN.timeoutFuenteDetalleMs ?? 7000
    );
    const detalles = ok.map((o) => o.valor).filter((d): d is AnimeDetalle => d !== null);
    let base: AnimeDetalle | null = detalles.length > 0 ? detalles[0] : null;
    const fuentesUnion: AnimeFuenteRef[] = [];
    const vistos = new Set<string>();
    for (const d of detalles) {
      for (const f of d.fuentes) {
        const k = `${f.fuente}:${f.slugLocal}`;
        if (!vistos.has(k)) {
          vistos.add(k);
          fuentesUnion.push(f);
        }
      }
    }

    // Fusión: episodios = unión; géneros/sinopsis del primer detalle con datos
    const numeros = new Set<number>();
    for (const d of detalles) for (const e of d.episodios) numeros.add(e.numero);
    let episodios: EpisodioItem[] = [...numeros].sort((a, b) => a - b).map((numero) => ({ numero }));

    // FALLBACK DE DISPONIBILIDAD: si tras fusionar todas las fuentes
    // indexadas el anime queda con 0 episodios (fuentes muertas), se
    // re-busca EN VIVO por título en todas las fuentes activas y se
    // usa el detalle de la primera coincidencia exacta.
    if (episodios.length === 0) {
      const vivo = await detalleVivoPorTitulo(entrada.titulo);
      if (vivo) {
        base = vivo;
        episodios = vivo.episodios;
        for (const f of vivo.fuentes) {
          const k = `${f.fuente}:${f.slugLocal}`;
          if (!vistos.has(k)) {
            vistos.add(k);
            fuentesUnion.push(f);
          }
        }
      }
    }

    if (!base) {
      return {
        titulo: entrada.titulo,
        slug: entrada.slug,
        portada: entrada.portada || "",
        sinopsis: entrada.sinopsis || undefined,
        generos: entrada.generos,
        estado: entrada.estado || undefined,
        totalEpisodios: entrada.totalEpisodios,
        idioma: mejorIdioma(entrada.fuentes),
        tipo: entrada.tipo,
        fuentes: ordenarFuentesPorIdioma(entrada.fuentes),
        episodios,
      } satisfies AnimeDetalle;
    }

    const fuentesFinales = fuentesUnion.length ? fuentesUnion : entrada.fuentes;
    return {
      titulo: entrada.titulo || base.titulo,
      slug: entrada.slug,
      portada: base.portada || entrada.portada || "",
      sinopsis: base.sinopsis || entrada.sinopsis || undefined,
      generos: base.generos.length ? base.generos : entrada.generos,
      estado: base.estado || entrada.estado || undefined,
      totalEpisodios: episodios.length || entrada.totalEpisodios,
      // Idioma = MEJOR idioma entre todas las fuentes (latino primero)
      idioma: mejorIdioma(fuentesFinales),
      tipo: base.tipo || entrada.tipo,
      fuentes: ordenarFuentesPorIdioma(fuentesFinales),
      episodios,
    } satisfies AnimeDetalle;
  });
  // Un detalle con 0 episodios no se cachea: la próxima petición
  // reintenta la re-búsqueda viva (una fuente dormida puede despertar).
  if (detalle && detalle.episodios.length === 0) {
    invalidar("detalle", slug);
  }
  return { ok: true, data: detalle };
}

/** Re-búsqueda viva por título: devuelve el detalle de la primera
 *  coincidencia EXACTA (mismo título normalizado) con episodios. */
async function detalleVivoPorTitulo(titulo: string): Promise<AnimeDetalle | null> {
  if (!titulo) return null;
  const res = await buscarUnificado(titulo);
  const clave = normalizarTitulo(titulo);
  const candidatos = (res.data?.resultados ?? []).filter((c) => normalizarTitulo(c.titulo) === clave);
  for (const c of candidatos.slice(0, 4)) {
    const ref = c.fuentes[0];
    if (!ref || !ref.slugLocal) continue;
    const r = await detalleUnificado(`${ref.fuente}~${ref.slugLocal}`);
    if (r.ok && r.data && r.data.episodios.length > 0) {
      return r.data;
    }
  }
  return null;
}

/** Prioridad de fuentes para el "Reproducir" por defecto:
 *  LATINO primero, luego DUAL (sub+latino), luego SUB. */
export function ordenarFuentesPorIdioma(fuentes: AnimeFuenteRef[]): AnimeFuenteRef[] {
  const pref = (i: Idioma) => (i === "latino" ? 0 : i === "dual" ? 1 : 2);
  return [...fuentes].sort((a, b) => pref(a.idioma) - pref(b.idioma));
}

// ── SERVIDORES DE UN EPISODIO ───────────────────────────────

import { resolverServidores } from "./extractores";

/** Marca el idioma de cada servidor crudo según el grupo de su fuente:
 *  los servidores de fuentes del grupo latino llevan idioma "latino". */
function marcarIdiomaServidores(crudos: ServidorVideo[]): ServidorVideo[] {
  return crudos.map((s) => ({
    ...s,
    idioma: s.idioma ?? (grupoDeFuente(s.fuente) === "latino" ? "latino" : "sub"),
  }));
}

/** FALLBACK UNIVERSAL del reproductor: si las fuentes propias del anime
 *  no dejan NINGÚN servidor reproducible para el episodio, se busca el
 *  TÍTULO en todas las fuentes activas y se piden los servidores del
 *  episodio a cada candidata EXACTA (mismo título normalizado), para
 *  garantizar que One Piece episodio 1 y el 1000+ siempre resuelvan.
 *  Si no hay candidata exacta (p. ej. las fuentes conocen el título por
 *  otro nombre), se prueban las primeras coincidencias difusas. */
async function servidoresPorTitulo(
  titulo: string,
  episodio: number,
  yaProbadas: Set<string>
): Promise<{ servidores: ServidorVideo[]; refsUsadas: AnimeFuenteRef[] }> {
  if (!titulo) return { servidores: [], refsUsadas: [] };
  const res = await buscarUnificado(titulo);
  const clave = normalizarTitulo(titulo);
  const resultados = res.data?.resultados ?? [];
  let candidatos = resultados.filter(
    (c) => normalizarTitulo(c.titulo) === clave && c.fuentes.length > 0
  );
  if (candidatos.length === 0) {
    // Coincidencia difusa: mismo título como prefijo/sufijo (temporadas,
    // "Rent a Girlfriend" = "Kanojo, Okarishimasu" en otras fuentes…)
    candidatos = resultados.filter(
      (c) =>
        c.fuentes.length > 0 &&
        (normalizarTitulo(c.titulo).includes(clave) || clave.includes(normalizarTitulo(c.titulo)))
    );
  }
  const refs: AnimeFuenteRef[] = [];
  const vistos = new Set<string>();
  for (const c of candidatos.slice(0, 6)) {
    for (const f of c.fuentes) {
      const k = `${f.fuente}:${f.slugLocal}`;
      if (!vistos.has(k) && !yaProbadas.has(k)) {
        vistos.add(k);
        refs.push(f);
      }
    }
  }
  return await resolverFallback(refs, episodio);
}

/** SONDA DE SLUG entre fuentes LATINO/DUAL (último recurso del fallback
 *  universal): los slugs locales suelen coincidir entre fuentes (todas
 *  slugifican el mismo título romaji, p. ej. "kanojo-okarishimasu"). Si la
 *  búsqueda por título no encuentra nada (el buscador de la fuente latina
 *  no cubre su catálogo entero), se SONDEA directamente el slug en cada
 *  fuente del grupo latino/dual no probada aún. Una sonda fallida devuelve
 *  simplemente 0 servidores (inofensiva). */
async function servidoresPorSlug(
  refsConocidas: AnimeFuenteRef[],
  titulo: string,
  episodio: number,
  yaProbadas: Set<string>
): Promise<{ servidores: ServidorVideo[]; refsUsadas: AnimeFuenteRef[] }> {
  const slugs = new Set<string>();
  for (const r of refsConocidas) if (r.slugLocal) slugs.add(r.slugLocal);
  if (titulo) slugs.add(normalizarTitulo(titulo).replace(/\s+/g, "-"));
  if (slugs.size === 0) return { servidores: [], refsUsadas: [] };
  const refs: AnimeFuenteRef[] = [];
  const vistos = new Set<string>();
  for (const s of scrapersActivos()) {
    // Solo fuentes que llevan latino (grupo "latino" o "dual"); las
    // puramente sub ya se cubren con la búsqueda por título.
    const grupo = grupoDeFuente(s.id);
    if (grupo !== "latino" && grupo !== "dual") continue;
    for (const sl of slugs) {
      const k = `${s.id}:${sl}`;
      if (vistos.has(k) || yaProbadas.has(k)) continue;
      vistos.add(k);
      refs.push({
        fuente: s.id,
        nombre: nombreFuente(s.id),
        slugLocal: sl,
        idioma: s.idioma,
      });
      break; // una sonda por fuente (el primer slug candidato)
    }
  }
  return await resolverFallback(refs, episodio);
}

/** Pide los servidores del episodio a cada ref (en paralelo), resuelve y
 *  verifica, y devuelve también las refs que APORTARON servidores. */
async function resolverFallback(
  refs: AnimeFuenteRef[],
  episodio: number
): Promise<{ servidores: ServidorVideo[]; refsUsadas: AnimeFuenteRef[] }> {
  if (refs.length === 0) return { servidores: [], refsUsadas: [] };
  const { ok } = await enParalelo(
    (s) => {
      const ref = refs.find((f) => f.fuente === s.id);
      if (!ref) return Promise.resolve([]);
      return s.obtenerServidores(ref.slugLocal, episodio);
    },
    TUN.timeoutFuenteDetalleMs ?? 7000
  );
  const crudos = ok.flatMap((o) => o.valor).filter(Boolean);
  // Etiqueta cada servidor con el nombre legible de su fuente
  const etiquetados = marcarIdiomaServidores(crudos).map((s) => ({
    ...s,
    nombreFuente: nombreFuente(s.fuente),
  }));
  const servidores = await resolverServidores(etiquetados);
  // Refs ganadoras: las fuentes que aportaron al menos un servidor vivo
  const fuentesGanadoras = new Set(servidores.map((s) => s.fuente));
  const refsUsadas = refs.filter((f) => fuentesGanadoras.has(f.fuente));
  return { servidores, refsUsadas };
}

export async function servidoresUnificados(
  slug: string,
  episodio: number
): Promise<RespuestaAPI<{ episodio: number; servidores: ServidorVideo[] }>> {
  // Determinar las fuentes para este anime
  let refs: AnimeFuenteRef[] = [];
  let tituloAnime = "";
  if (slug.includes("~")) {
    const [fuente, slugLocal] = slug.split("~");
    const s = MODULOS[fuente];
    refs = [
      {
        fuente,
        nombre: nombreFuente(fuente),
        slugLocal,
        idioma: s ? s.idioma : "sub",
      },
    ];
    tituloAnime = slugLocal.replace(/-/g, " ");
  } else {
    const entrada = await leerIndice(slug);
    if (entrada) {
      refs = entrada.fuentes;
      tituloAnime = entrada.titulo;
    } else {
      const res = await detalleUnificado(slug);
      refs = res.data?.fuentes ?? [];
      tituloAnime = res.data?.titulo ?? slug.replace(/^ded:/, "").replace(/-/g, " ");
    }
  }

  // FALLBACK: sin fuentes conocidas → búsqueda viva por título
  if (refs.length === 0) {
    const tituloBus = slug.replace(/^ded:/, "").replace(/-/g, " ");
    const res = await buscarUnificado(tituloBus);
    const card =
      res.data?.resultados?.find((t) => t.slug === slug) ?? res.data?.resultados?.[0];
    if (card) {
      refs = card.fuentes;
      tituloAnime = card.titulo;
    }
  }
  if (refs.length === 0) return { ok: false, error: "anime no encontrado" };

  // REUTILIZACIÓN CRUZADA de caché: el mismo episodio puede pedirse bajo
  // el slug deduplicado (ded:titulo) o el de una fuente (fuente~slug) — el
  // reproductor navega por ambos. Si ya se resolvió bajo el otro slug, se
  // devuelve al instante (evita re-scrapear 30+ s el mismo episodio).
  const clavesEquivalentes: string[] = [];
  if (slug.includes("~")) {
    const tituloNorm = normalizarTitulo(tituloAnime || slug.split("~")[1].replace(/-/g, " "));
    if (tituloNorm) clavesEquivalentes.push(`ded:${tituloNorm}#${episodio}`);
  } else {
    for (const r of refs) clavesEquivalentes.push(`${r.fuente}~${r.slugLocal}#${episodio}`);
  }
  for (const ce of clavesEquivalentes) {
    const hit = obtener<ServidorVideo[]>("servidores", ce);
    if (hit && hit.length > 0) {
      return { ok: true, data: { episodio, servidores: hit } };
    }
  }

  const clave = `${slug}#${episodio}`;
  let ganadoras: AnimeFuenteRef[] = [];
  const datos = await conCache("servidores", clave, async () => {
    const yaProbadas = new Set(refs.map((f) => `${f.fuente}:${f.slugLocal}`));
    const { ok } = await enParalelo(
      (s) => {
        const ref = refs.find((f) => f.fuente === s.id);
        if (!ref) return Promise.resolve([]);
        return s.obtenerServidores(ref.slugLocal, episodio);
      },
      TUN.timeoutFuenteDetalleMs ?? 7000
    );
    const crudos = marcarIdiomaServidores(ok.flatMap((o) => o.valor).filter(Boolean));
    console.log(`[servidores] ${slug}#${episodio} refs=${refs.map((r) => r.fuente).join("+")} crudos=${crudos.length}`);
    // Resolución + VERIFICACIÓN de cada link directo: solo se devuelven
    // servidores realmente reproducibles (mp4/m3u8 comprobados).
    let resueltos = await resolverServidores(crudos);
    console.log(`[servidores] ${slug}#${episodio} resueltos=${resueltos.length}`);
    if (resueltos.length === 0 && tituloAnime) {
      // AUTO-FALLBACK 1: mismo título (exacto o difuso) en otras fuentes
      const r1 = await servidoresPorTitulo(tituloAnime, episodio, yaProbadas);
      resueltos = r1.servidores;
      ganadoras = r1.refsUsadas;
      console.log(`[servidores] ${slug}#${episodio} fallback-titulo=${resueltos.length} titulo="${tituloAnime}"`);
    }
    if (resueltos.length === 0) {
      // AUTO-FALLBACK 2: sonda de SLUG en las fuentes latinas/dual (los
      // slugs coinciden entre fuentes: "kanojo-okarishimasu"…). Cubre el
      // caso "Rent a Girlfriend": su fuente sub no resuelve, pero la
      // fuente latina la tiene bajo el slug romaji aunque su buscador no
      // la encuentre.
      const r2 = await servidoresPorSlug(refs, tituloAnime, episodio, yaProbadas);
      resueltos = r2.servidores;
      ganadoras = r2.refsUsadas;
      console.log(`[servidores] ${slug}#${episodio} fallback-slug=${resueltos.length}`);
    }
    if (resueltos.length > 0 && ganadoras.length > 0 && !slug.includes("~")) {
      // ÍNDICE AUTO-SANADO: registra en el índice las fuentes que han
      // resuelto el episodio (así el detalle y el catálogo muestran esas
      // fuentes — y su idioma latino — sin esperar una re-indexación).
      void indexarAnime({
        titulo: tituloAnime,
        slug,
        portada: "",
        generos: [],
        idioma: mejorIdioma(ganadoras),
        fuentes: ganadoras,
      });
    }
    return resueltos;
  });
  // Un episodio sin servidores reproducibles no se cachea 6 h:
  // la siguiente petición reintenta el fallback completo.
  if (datos.length === 0) {
    invalidar("servidores", clave);
  } else if (clavesEquivalentes.length > 0) {
    // Éxito: se priman también los slugs equivalentes (ded ↔ fuente~)
    for (const ce of clavesEquivalentes) guardar("servidores", ce, datos);
  }
  return { ok: true, data: { episodio, servidores: datos } };
}

// ── CATÁLOGOS (/latino /sub /genero /peliculas) ──────────────

export async function catalogo(op: {
  idioma?: "latino" | "sub";
  genero?: string;
  tipo?: string;
}): Promise<RespuestaAPI<{ resultados: AnimeCard[] }>> {
  const clave = `${op.idioma || ""}|${op.genero || ""}|${op.tipo || ""}`;
  // El catálogo de PELÍCULAS se cachea 1 h (namespace propio); el
  // resto usa el namespace "detalle" (6 h) como siempre.
  const namespace = op.tipo ? "cattipo" : "detalle";
  const datos = await conCache(namespace, `cat:${clave}`, async () => {
    const entradas = await catalogoIndice({
      idioma: op.idioma,
      genero: op.genero ? op.genero.toLowerCase() : undefined,
      tipo: op.tipo,
      limite: 60,
    });
    // PRIORIDAD LATINO en el listado (latino > dual > sub)
    const tarjetas = entradas.map(entradaATarjeta);
    const pref = (i: Idioma) => (i === "latino" ? 0 : i === "dual" ? 1 : 2);
    tarjetas.sort((a, b) => pref(a.idioma) - pref(b.idioma));
    return { resultados: tarjetas };
  });
  return { ok: true, data: datos };
}
