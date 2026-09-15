// Recibe una respuesta de la encuesta de satisfacción.
//
// verify_jwt en false: la encuesta es una página estática en GitHub Pages y
// quien la responde es un cliente, no un usuario de Supabase. No hay sesión que
// verificar. La tabla `encuesta_satisfaccion` tiene RLS sin políticas y sin
// permisos para anon, así que esta función es la única puerta de entrada.
//
// Por qué no dejar que la página inserte directo con la clave publicable, como
// hace `solicitudes`: esa clave viaja en el HTML y cualquiera puede abrir la
// consola y llenar la tabla. Aquí los valores se validan contra las listas
// cerradas del formulario y se limita cuántas respuestas acepta una misma IP.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
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

// Las mismas listas que pinta el formulario. Si aquí no está, no entra: así un
// valor inventado no llega nunca a la tabla ni al panel.
const SATISFACCION = ["muy_satisfecho", "satisfecho", "neutral", "insatisfecho", "muy_insatisfecho"];
const FACILIDAD = ["muy_facil", "facil", "dificil", "muy_dificil", "no_aplica"];
const OPORTUNIDAD = ["siempre", "casi_siempre", "a_veces", "rara_vez", "nunca"];
const RESOLUCION = ["completa", "parcial", "no", "no_aplica"];

/** Texto libre: se recorta, y en blanco cuenta como sin respuesta. */
function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

/** Una de las opciones de la lista, o nada. */
function opcion(v: unknown, lista: string[]): string | null {
  return typeof v === "string" && lista.includes(v) ? v : null;
}

/** Entero dentro del rango, o nada. */
function entero(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= min && r <= max ? r : null;
}

// Cuánto acepta una misma IP. La encuesta se responde una vez, pero un equipo
// entero puede salir con la misma IP pública desde la oficina del cliente, así
// que el tope no puede ser 1. Sí corta el envío en bucle desde un script.
const TOPE_HORA = 8;
const TOPE_DIA = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responde({ error: "Solo POST" }, 405);

  let c: Record<string, unknown>;
  try {
    c = await req.json();
  } catch {
    return responde({ error: "Cuerpo ilegible" }, 400);
  }

  // Campo trampa: es invisible en la página, así que sólo lo llena un robot que
  // rellena todos los input del formulario. Se responde ok para no enseñarle
  // que lo pillamos; simplemente no se guarda nada.
  if (texto(c.website, 100)) return responde({ ok: true, id: null });

  // Desde el 15-sep-2026 la encuesta es obligatoria de principio a fin: se quitó
  // el anonimato y se quitó la posibilidad de saltarse preguntas. La única
  // pantalla que sigue admitiendo el blanco es "Una última idea" (`adicional` y
  // `comentarios`).
  //
  // Se comprueba aquí y no sólo en la página, porque la página se puede
  // saltar: basta abrir la consola del navegador y llamar a esta función a mano.
  // Esta es la única puerta, así que es el único sitio donde la regla es real.
  const nombre = texto(c.nombre, 200);
  const satisfaccion = opcion(c.satisfaccion, SATISFACCION);
  const nps = entero(c.nps, 0, 10);
  const facilidad = opcion(c.facilidad, FACILIDAD);
  const oportunidad = opcion(c.oportunidad, OPORTUNIDAD);
  const resolucion = opcion(c.resolucion, RESOLUCION);
  const masValora = texto(c.mas_valora, 2000);
  const mejorar = texto(c.mejorar, 2000);

  const CALIDAD = [
    ["cal_servicio", "la calidad del servicio recibido"],
    ["cal_tiempos", "el cumplimiento de tiempos y plazos"],
    ["cal_trato", "la amabilidad y trato del personal"],
    ["cal_claridad", "la claridad de la información entregada"],
    ["cal_precio", "la relación entre precio y valor"],
  ] as const;

  if (!nombre) return responde({ error: "Falta el nombre o la empresa" }, 400);
  if (!satisfaccion) return responde({ error: "Falta la satisfacción general" }, 400);
  if (nps === null) return responde({ error: "Falta la recomendación (0 a 10)" }, 400);

  const calidad: Record<string, number> = {};
  for (const [campo, comoSeLlama] of CALIDAD) {
    const v = entero(c[campo], 1, 5);
    if (v === null) return responde({ error: `Falta calificar ${comoSeLlama}` }, 400);
    calidad[campo] = v;
  }

  if (!facilidad) return responde({ error: "Falta la facilidad para contactarnos" }, 400);
  if (!oportunidad) return responde({ error: "Falta si la respuesta fue oportuna" }, 400);
  if (!resolucion) return responde({ error: "Falta si la solicitud se resolvió" }, 400);
  if (!masValora) return responde({ error: "Falta qué es lo que más valora" }, 400);
  if (!mejorar) return responde({ error: "Falta qué deberíamos mejorar" }, 400);

  // Aquí sí importa distinguir "no quiero" de "no contestó". Por eso se exige un
  // booleano de verdad y no se acepta que venga ausente: antes la página mandaba
  // `=== true`, que convertía el silencio en un "no" silencioso.
  if (typeof c.desea_contacto !== "boolean") {
    return responde({ error: "Falta decir si podemos contactarlo" }, 400);
  }
  const desea = c.desea_contacto;
  const contacto = desea ? texto(c.contacto, 200) : null;
  if (desea && !contacto) {
    return responde({ error: "Falta el correo o el teléfono de contacto" }, 400);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: cfg } = await db.from("encuesta_panel").select("sal_ip").maybeSingle();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ipHash = ip && cfg?.sal_ip ? await sha256(cfg.sal_ip + ":" + ip) : null;

  if (ipHash) {
    const desdeHora = new Date(Date.now() - 3600_000).toISOString();
    const desdeDia = new Date(Date.now() - 86400_000).toISOString();
    const [hora, dia] = await Promise.all([
      db.from("encuesta_satisfaccion").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("creada_en", desdeHora),
      db.from("encuesta_satisfaccion").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("creada_en", desdeDia),
    ]);
    if ((hora.count ?? 0) >= TOPE_HORA || (dia.count ?? 0) >= TOPE_DIA) {
      return responde(
        { error: "Ya recibimos varias respuestas desde esta conexión. Inténtelo más tarde." },
        429,
      );
    }
  }

  const fila = {
    nombre,
    satisfaccion,
    nps,
    ...calidad,
    facilidad,
    oportunidad,
    resolucion,
    mas_valora: masValora,
    mejorar,
    // Las dos únicas que siguen admitiendo el blanco: "Una última idea".
    adicional: texto(c.adicional, 2000),
    comentarios: texto(c.comentarios, 2000),
    desea_contacto: desea,
    // Si dijo que no quiere que lo llamen, no nos quedamos su correo aunque
    // venga en el cuerpo.
    contacto,
    origen: texto(c.origen, 300),
    ip_hash: ipHash,
    duracion_ms: entero(c.duracion_ms, 0, 86400000),
    es_prueba: c.es_prueba === true,
  };

  const { data, error } = await db
    .from("encuesta_satisfaccion").insert(fila).select("id").single();
  if (error) {
    console.error("no se pudo guardar la encuesta:", error.message);
    return responde({ error: "No se pudo guardar la respuesta" }, 500);
  }

  return responde({ ok: true, id: data.id });
});
