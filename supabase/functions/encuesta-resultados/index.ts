// Lo que lee el panel de resultados.
//
// verify_jwt en false: el panel es una página estática y no hay sesión de
// Supabase detrás. La autenticación es la clave del panel, cuyo SHA-256 con sal
// vive en `public.encuesta_panel`. La tabla de respuestas tiene RLS sin
// políticas y sin permisos para anon, así que esta función es la única forma de
// leerla desde fuera.
//
// La clave viaja en una cabecera, no en la URL: una URL queda en el historial
// del navegador, en los registros del proxy y en el Referer de cualquier enlace.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-clave-panel",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function responde(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparación en tiempo constante: dos hashes del mismo largo, byte a byte. */
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

type Fila = Record<string, string | number | boolean | null>;

function cuenta(filas: Fila[], campo: string, opciones: string[]) {
  const r: Record<string, number> = {};
  for (const o of opciones) r[o] = 0;
  for (const f of filas) {
    const v = f[campo];
    if (typeof v === "string" && v in r) r[v]++;
  }
  return r;
}

function criterio(filas: Fila[], campo: string) {
  const dist = [0, 0, 0, 0, 0];
  let suma = 0, n = 0;
  for (const f of filas) {
    const v = f[campo];
    if (typeof v === "number" && v >= 1 && v <= 5) {
      dist[v - 1]++;
      suma += v;
      n++;
    }
  }
  return { promedio: n ? Number((suma / n).toFixed(2)) : null, respuestas: n, dist };
}

const CAMPOS_CSV = [
  "creada_en", "nombre", "satisfaccion", "nps",
  "cal_servicio", "cal_tiempos", "cal_trato", "cal_claridad", "cal_precio",
  "facilidad", "oportunidad", "resolucion",
  "mas_valora", "mejorar", "adicional", "comentarios",
  "desea_contacto", "contacto", "duracion_ms",
];

function aCsv(filas: Fila[]): string {
  const celda = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // Separador de punto y coma y BOM: es lo que abre bien Excel en español sin
  // pasar por el asistente de importación.
  const lineas = [CAMPOS_CSV.join(";")];
  for (const f of filas) lineas.push(CAMPOS_CSV.map((c) => celda(f[c])).join(";"));
  return "﻿" + lineas.join("\r\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responde({ error: "Solo POST" }, 405);

  const clave = req.headers.get("x-clave-panel") ?? "";
  if (clave.length < 8) return responde({ error: "Falta la clave" }, 401);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: cfg } = await db
    .from("encuesta_panel").select("clave_hash, sal").maybeSingle();
  if (!cfg) return responde({ error: "El panel no está configurado" }, 500);

  if (!igual(await sha256(cfg.sal + ":" + clave), cfg.clave_hash)) {
    console.warn("clave de panel rechazada desde", req.headers.get("x-forwarded-for"));
    // Medio segundo de espera: no evita nada por sí solo, pero convierte un
    // ataque por fuerza bruta en algo demasiado lento para valer la pena.
    await new Promise((r) => setTimeout(r, 500));
    return responde({ error: "Clave incorrecta" }, 401);
  }

  let cuerpo: Record<string, unknown> = {};
  try { cuerpo = await req.json(); } catch { /* sin cuerpo: todo */ }
  const incluirPruebas = cuerpo.incluir_pruebas === true;

  let q = db.from("encuesta_satisfaccion")
    .select("id, creada_en, nombre, satisfaccion, nps," +
            " cal_servicio, cal_tiempos, cal_trato, cal_claridad, cal_precio," +
            " facilidad, oportunidad, resolucion," +
            " mas_valora, mejorar, adicional, comentarios," +
            " desea_contacto, contacto, duracion_ms, es_prueba")
    .order("creada_en", { ascending: false })
    .limit(5000);
  if (!incluirPruebas) q = q.eq("es_prueba", false);

  const { data, error } = await q;
  if (error) return responde({ error: error.message }, 500);
  const filas = (data ?? []) as Fila[];

  if (cuerpo.formato === "csv") {
    return new Response(aCsv(filas), {
      headers: {
        ...CORS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="encuesta-satisfaccion.csv"',
      },
    });
  }

  // NPS: promotores (9-10) menos detractores (0-6), sobre el total. Es un número
  // entre -100 y 100, no un porcentaje de nada; los pasivos no suman ni restan.
  const distNps = new Array(11).fill(0);
  let prom = 0, pas = 0, det = 0;
  for (const f of filas) {
    const n = f.nps;
    if (typeof n !== "number") continue;
    distNps[n]++;
    if (n >= 9) prom++;
    else if (n >= 7) pas++;
    else det++;
  }
  const conNps = prom + pas + det;

  const duraciones = filas
    .map((f) => f.duracion_ms)
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);

  return responde({
    total: filas.length,
    desde: filas.length ? filas[filas.length - 1].creada_en : null,
    hasta: filas.length ? filas[0].creada_en : null,
    nps: {
      score: conNps ? Math.round(((prom - det) / conNps) * 100) : null,
      promotores: prom, pasivos: pas, detractores: det, dist: distNps,
    },
    satisfaccion: cuenta(filas, "satisfaccion",
      ["muy_satisfecho", "satisfecho", "neutral", "insatisfecho", "muy_insatisfecho"]),
    criterios: {
      cal_servicio: criterio(filas, "cal_servicio"),
      cal_tiempos: criterio(filas, "cal_tiempos"),
      cal_trato: criterio(filas, "cal_trato"),
      cal_claridad: criterio(filas, "cal_claridad"),
      cal_precio: criterio(filas, "cal_precio"),
    },
    facilidad: cuenta(filas, "facilidad",
      ["muy_facil", "facil", "dificil", "muy_dificil", "no_aplica"]),
    oportunidad: cuenta(filas, "oportunidad",
      ["siempre", "casi_siempre", "a_veces", "rara_vez", "nunca"]),
    resolucion: cuenta(filas, "resolucion", ["completa", "parcial", "no", "no_aplica"]),
    // Mediana y no promedio: una pestaña abierta toda la tarde dispara la media
    // y deja de decir cuánto cuesta responderla de verdad.
    duracion_mediana_ms: duraciones.length ? duraciones[Math.floor(duraciones.length / 2)] : null,
    seguimiento: filas.filter((f) => f.desea_contacto === true).length,
    respuestas: filas,
  });
});
