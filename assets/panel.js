/* Panel de resultados de la encuesta de satisfacción.
 *
 * No hay clave de Supabase aquí. Se pide la clave del panel, se manda en una
 * cabecera a la edge function `encuesta-resultados` y es ella la que lee la
 * tabla con service_role. La clave queda en sessionStorage: al cerrar la
 * pestaña hay que volver a ponerla.
 *
 * Todo lo que escribe el cliente se pinta con textContent. Nada de innerHTML
 * con datos de la tabla: un comentario con `<img onerror=...>` dentro se
 * ejecutaría en la pantalla de quien lee los resultados. */

(function () {
  "use strict";

  var FUNCION = "https://tzuipgrkizsffgoxdrkg.supabase.co/functions/v1/encuesta-resultados";
  var ALMACEN = "gbx-clave-panel";

  var escena = document.getElementById("escena");
  var clave = "";
  var incluirPruebas = false;
  var datos = null;

  try { clave = sessionStorage.getItem(ALMACEN) || ""; } catch (e) { /* modo privado */ }

  /* ------------------------------------------------------------- utilidades */

  function h(etiqueta, atributos, hijos) {
    var e = document.createElement(etiqueta);
    for (var k in atributos || {}) {
      var v = atributos[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "texto") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    (hijos || []).forEach(function (c) {
      if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  var ETIQUETAS = {
    muy_satisfecho: "Muy satisfecho", satisfecho: "Satisfecho", neutral: "Neutral",
    insatisfecho: "Insatisfecho", muy_insatisfecho: "Muy insatisfecho",
    muy_facil: "Muy fácil", facil: "Fácil", dificil: "Difícil",
    muy_dificil: "Muy difícil", no_aplica: "No aplica",
    siempre: "Siempre", casi_siempre: "Casi siempre", a_veces: "A veces",
    rara_vez: "Rara vez", nunca: "Nunca",
    completa: "Sí, completamente", parcial: "Parcialmente", no: "No"
  };

  var CRITERIOS = {
    cal_servicio: "Calidad del servicio recibido",
    cal_tiempos: "Cumplimiento de tiempos y plazos",
    cal_trato: "Amabilidad y trato del personal",
    cal_claridad: "Claridad de la información entregada",
    cal_precio: "Relación entre precio y valor recibido"
  };

  var ABIERTAS = {
    mas_valora: "Qué es lo que más valora",
    mejorar: "Qué deberíamos mejorar",
    adicional: "Servicio adicional que le gustaría",
    comentarios: "Comentarios adicionales"
  };

  function fecha(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) +
           " · " + d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  }

  function minutos(ms) {
    if (!ms) return "—";
    var s = Math.round(ms / 1000);
    return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
  }

  /** Tramo del NPS al que pertenece una nota. */
  function tramo(n) { return n >= 9 ? "promotor" : n >= 7 ? "pasivo" : "detractor"; }

  var COLOR = { promotor: "var(--promotor)", pasivo: "var(--pasivo)", detractor: "var(--detractor)" };

  /* ------------------------------------------------------------------ datos */

  function pedir() {
    return fetch(FUNCION, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-clave-panel": clave },
      body: JSON.stringify({ incluir_pruebas: incluirPruebas })
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d && d.error ? d.error : "No se pudo consultar");
        return d;
      });
    });
  }

  /* ----------------------------------------------------------------- entrada */

  function pintarEntrada(mensaje) {
    escena.innerHTML = "";
    var entrada = h("input", {
      type: "password", id: "clave", autocomplete: "current-password",
      placeholder: "XXXXX-XXXXX-XXXXX-XXXXX"
    });
    var error = h("div", { class: "error", hidden: !mensaje, role: "alert", texto: mensaje || "" });
    var boton = h("button", { type: "button", class: "pill pill-marca", texto: "Entrar",
                              onclick: intentar });

    function intentar() {
      var v = entrada.value.trim().toUpperCase();
      if (v.length < 8) {
        error.hidden = false;
        error.textContent = "Escriba la clave del panel.";
        return;
      }
      clave = v;
      boton.disabled = true;
      boton.textContent = "Comprobando…";
      pedir().then(function (d) {
        try { sessionStorage.setItem(ALMACEN, clave); } catch (e) { /* nada */ }
        datos = d;
        pintarPanel();
      }).catch(function (e) {
        clave = "";
        boton.disabled = false;
        boton.textContent = "Entrar";
        error.hidden = false;
        error.textContent = e.message === "Failed to fetch"
          ? "No hay conexión con el servidor." : e.message;
        entrada.select();
      });
    }

    entrada.addEventListener("keydown", function (ev) { if (ev.key === "Enter") intentar(); });

    escena.appendChild(h("div", { class: "panel" }, [
      h("div", { class: "entrada" }, [
        h("img", { class: "logo", src: "assets/gabotrix-logo.png", alt: "GABOTRIX" }),
        h("h2", { texto: "Resultados de la encuesta" }),
        h("p", { class: "ayuda", texto: "Pegue la clave del panel para ver las respuestas." }),
        h("div", { class: "campo" }, [h("label", { for: "clave", texto: "Clave" }), entrada]),
        h("div", { class: "acciones", style: "justify-content:center" }, [boton]),
        error
      ])
    ]));

    setTimeout(function () { entrada.focus(); }, 120);
  }

  /* ------------------------------------------------------------ componentes */

  /** Barras horizontales de una serie única, con la cifra y el % al lado. */
  function barras(pares, total) {
    var tope = Math.max.apply(null, pares.map(function (p) { return p[1]; }).concat([1]));
    return h("div", { class: "barras" }, pares.map(function (p) {
      var pct = total ? Math.round((p[1] / total) * 100) : 0;
      return h("div", { class: "barra-fila" }, [
        h("div", { class: "barra-nombre", texto: p[0] }),
        h("div", { class: "barra-pista" }, [
          h("div", { class: "barra-valor-fill", style: "width:" + (p[1] / tope * 100) + "%" })
        ]),
        h("div", { class: "barra-cifra", texto: p[1] + " · " + pct + "%" })
      ]);
    }));
  }

  function bloqueCuenta(titulo, nota, conteos, orden, total) {
    return h("section", { class: "bloque" }, [
      h("div", { class: "bloque-titulo", texto: titulo }),
      nota ? h("div", { class: "bloque-nota", texto: nota }) : null,
      barras(orden.map(function (k) { return [ETIQUETAS[k] || k, conteos[k] || 0]; }), total)
    ]);
  }

  /* ------------------------------------------------------------------ panel */

  function pintarPanel() {
    var d = datos;
    escena.innerHTML = "";

    var panel = h("div", { class: "panel" });

    /* ---- cabecera */
    var casilla = h("input", { type: "checkbox", id: "pruebas" });
    casilla.checked = incluirPruebas;
    casilla.addEventListener("change", function () {
      incluirPruebas = casilla.checked;
      recargar();
    });

    panel.appendChild(h("header", { class: "panel-cabecera" }, [
      h("img", { class: "logo", src: "assets/gabotrix-logo.png", alt: "GABOTRIX" }),
      h("div", {}, [
        h("div", { class: "panel-titulo", texto: "Resultados de la encuesta" }),
        h("div", { class: "panel-rango",
                   texto: d.total ? fecha(d.desde) + "  →  " + fecha(d.hasta)
                                  : "Todavía no hay respuestas" })
      ]),
      h("div", { class: "panel-herramientas" }, [
        h("label", { class: "palanca", for: "pruebas" }, [casilla, "Incluir pruebas"]),
        h("button", { type: "button", class: "pill pill-suave pill-chico",
                      texto: "Descargar CSV", onclick: descargarCsv }),
        h("button", { type: "button", class: "pill pill-suave pill-chico",
                      texto: "Salir", onclick: salir })
      ])
    ]));

    if (!d.total) {
      panel.appendChild(h("div", { class: "bloque" }, [
        h("div", { class: "vacio", texto:
          "Sin respuestas todavía. En cuanto alguien conteste la encuesta, aparecerá aquí." })
      ]));
      escena.appendChild(panel);
      return;
    }

    /* ---- cifras de arriba */
    var satisfechos = (d.satisfaccion.muy_satisfecho || 0) + (d.satisfaccion.satisfecho || 0);
    var promedios = Object.keys(CRITERIOS)
      .map(function (k) { return d.criterios[k].promedio; })
      .filter(function (v) { return typeof v === "number"; });
    var general = promedios.length
      ? (promedios.reduce(function (a, b) { return a + b; }, 0) / promedios.length).toFixed(2)
      : "—";

    panel.appendChild(h("div", { class: "kpis" }, [
      kpi("Respuestas", String(d.total), null),
      kpi("NPS", d.nps.score === null ? "—" : String(d.nps.score),
          "Promotores menos detractores", d.nps.score === null ? null : tramo(
            // El NPS va de -100 a 100; se colorea por tramo con los mismos
            // cortes que se usan en la industria: 50+ excelente, 0+ aceptable.
            d.nps.score >= 50 ? 10 : d.nps.score >= 0 ? 7 : 0)),
      kpi("Satisfechos", Math.round((satisfechos / d.total) * 100) + "%",
          satisfechos + " de " + d.total + " respuestas"),
      kpi("Promedio general", String(general), "Sobre 5, de los cinco criterios"),
      kpi("Tiempo mediano", minutos(d.duracion_mediana_ms), "En responderla"),
      kpi("Piden contacto", String(d.seguimiento), "Dejaron correo o teléfono")
    ]));

    /* ---- NPS */
    var conNps = d.nps.promotores + d.nps.pasivos + d.nps.detractores;
    var tramos = h("div", { class: "tramos", role: "img",
      "aria-label": "Detractores " + d.nps.detractores + ", pasivos " + d.nps.pasivos +
                    ", promotores " + d.nps.promotores });
    [["detractor", d.nps.detractores], ["pasivo", d.nps.pasivos],
     ["promotor", d.nps.promotores]].forEach(function (t) {
      if (!t[1]) return;
      tramos.appendChild(h("div", {
        class: "tramo", style: "flex:" + t[1] + " 1 0; background:" + COLOR[t[0]],
        texto: Math.round((t[1] / conNps) * 100) + "%"
      }));
    });

    var topeNps = Math.max.apply(null, d.nps.dist.concat([1]));
    var columnas = h("div", { class: "columnas" });
    var pies = h("div", { class: "columnas-pies" });
    d.nps.dist.forEach(function (n, i) {
      columnas.appendChild(h("div", {
        class: "columna", title: n + (n === 1 ? " respuesta" : " respuestas") + " con " + i + " de 10"
      }, [
        h("div", { class: "columna-cifra", texto: n ? String(n) : "" }),
        h("div", { class: "columna-fill",
                   style: "height:" + (n / topeNps * 100) + "%; background:" + COLOR[tramo(i)] })
      ]));
      pies.appendChild(h("div", { texto: String(i) }));
    });

    panel.appendChild(h("section", { class: "bloque" }, [
      h("div", { class: "bloque-titulo", texto: "Recomendación (NPS)" }),
      h("div", { class: "bloque-nota", texto:
        "Los pasivos (7 y 8) no suman ni restan al indicador." }),
      tramos,
      h("div", { class: "leyenda" }, [
        leyenda("detractor", "Detractores · 0 a 6", d.nps.detractores),
        leyenda("pasivo", "Pasivos · 7 y 8", d.nps.pasivos),
        leyenda("promotor", "Promotores · 9 y 10", d.nps.promotores)
      ]),
      h("div", { style: "margin-top:24px" }, [columnas, pies])
    ]));

    /* ---- satisfacción y criterios */
    panel.appendChild(h("div", { class: "rejilla-2" }, [
      bloqueCuenta("Satisfacción general", null, d.satisfaccion,
        ["muy_satisfecho", "satisfecho", "neutral", "insatisfecho", "muy_insatisfecho"], d.total),
      h("section", { class: "bloque" }, [
        h("div", { class: "bloque-titulo", texto: "Calidad del servicio" }),
        h("div", { class: "bloque-nota", texto: "Promedio de 1 a 5 en cada criterio." }),
        h("div", { class: "barras" }, Object.keys(CRITERIOS).map(function (k) {
          var c = d.criterios[k];
          return h("div", { class: "barra-fila",
                            title: c.respuestas + " de " + d.total + " calificaron este criterio" }, [
            h("div", { class: "barra-nombre", texto: CRITERIOS[k] }),
            h("div", { class: "barra-pista" }, [
              h("div", { class: "barra-valor-fill",
                         style: "width:" + ((c.promedio || 0) / 5 * 100) + "%" })
            ]),
            h("div", { class: "barra-cifra",
                       texto: (c.promedio === null ? "—" : c.promedio.toFixed(2)) + " / 5" })
          ]);
        }))
      ])
    ]));

    /* ---- atención */
    panel.appendChild(bloqueCuenta("Facilidad para contactarnos", null, d.facilidad,
      ["muy_facil", "facil", "dificil", "muy_dificil", "no_aplica"], d.total));
    panel.appendChild(bloqueCuenta("Respuesta oportuna", null, d.oportunidad,
      ["siempre", "casi_siempre", "a_veces", "rara_vez", "nunca"], d.total));
    panel.appendChild(bloqueCuenta("Resolución de la solicitud", null, d.resolucion,
      ["completa", "parcial", "no", "no_aplica"], d.total));

    /* ---- respuestas abiertas */
    var conTexto = d.respuestas.filter(function (r) {
      return Object.keys(ABIERTAS).some(function (k) { return r[k]; });
    });

    panel.appendChild(h("section", { class: "bloque" }, [
      h("div", { class: "bloque-titulo", texto: "Lo que escribieron" }),
      h("div", { class: "bloque-nota", texto: conTexto.length
        ? conTexto.length + " de " + d.total + " respuestas traen texto."
        : "Ninguna respuesta trae texto todavía." }),
      conTexto.length
        ? h("div", { class: "comentarios" }, conTexto.map(comentario))
        : h("div", { class: "vacio", texto: "Sin comentarios." })
    ]));

    /* ---- seguimiento */
    var pidieron = d.respuestas.filter(function (r) { return r.desea_contacto && r.contacto; });
    panel.appendChild(h("section", { class: "bloque" }, [
      h("div", { class: "bloque-titulo", texto: "Piden que los contactemos" }),
      h("div", { class: "bloque-nota", texto:
        "Sólo aparece aquí quien marcó la casilla y dejó un dato." }),
      pidieron.length
        ? h("div", { class: "contactos" }, pidieron.map(function (r) {
            var esCorreo = r.contacto.indexOf("@") > 0;
            return h("div", { class: "contacto-fila" }, [
              h("strong", { texto: r.nombre || "Sin nombre" }),
              h("a", { href: (esCorreo ? "mailto:" : "tel:") + r.contacto, texto: r.contacto }),
              h("span", { class: "insignia", style: "background:" + COLOR[tramo(r.nps)],
                          texto: "NPS " + r.nps }),
              h("span", { class: "cuando", texto: fecha(r.creada_en) })
            ]);
          }))
        : h("div", { class: "vacio", texto: "Nadie ha pedido seguimiento." })
    ]));

    escena.appendChild(panel);
  }

  function kpi(etiqueta, valor, pie, tono) {
    return h("div", { class: "kpi" }, [
      h("div", { class: "kpi-etiqueta", texto: etiqueta }),
      h("div", { class: "kpi-valor", "data-tono": tono || null, texto: valor }),
      pie ? h("div", { class: "kpi-pie", texto: pie }) : null
    ]);
  }

  function leyenda(tono, texto, n) {
    return h("span", {}, [
      h("span", { class: "leyenda-punto", style: "background:" + COLOR[tono] }),
      texto + " · " + n
    ]);
  }

  function comentario(r) {
    var campos = [];
    Object.keys(ABIERTAS).forEach(function (k) {
      if (!r[k]) return;
      campos.push(h("dt", { texto: ABIERTAS[k] }));
      campos.push(h("dd", { texto: r[k] }));
    });

    return h("article", { class: "comentario" }, [
      h("div", { class: "comentario-cabeza" }, [
        h("span", { class: "comentario-quien", texto: r.nombre || "Anónimo" }),
        h("span", { class: "insignia", style: "background:" + COLOR[tramo(r.nps)],
                    texto: "NPS " + r.nps }),
        h("span", { texto: ETIQUETAS[r.satisfaccion] || r.satisfaccion }),
        h("span", { texto: "· " + fecha(r.creada_en) }),
        r.es_prueba ? h("span", { class: "insignia", style: "background:var(--pasivo)",
                                  texto: "PRUEBA" }) : null
      ]),
      h("dl", { style: "margin:0" }, campos)
    ]);
  }

  /* ------------------------------------------------------------- acciones */

  function recargar() {
    pedir().then(function (d) { datos = d; pintarPanel(); })
      .catch(function (e) { pintarEntrada(e.message); });
  }

  function descargarCsv() {
    fetch(FUNCION, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-clave-panel": clave },
      body: JSON.stringify({ formato: "csv", incluir_pruebas: incluirPruebas })
    }).then(function (r) { return r.blob(); })
      .then(function (b) {
        var url = URL.createObjectURL(b);
        var a = h("a", { href: url, download: "encuesta-satisfaccion.csv" });
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Sin esto el blob se queda en memoria hasta que se cierra la pestaña.
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      });
  }

  function salir() {
    try { sessionStorage.removeItem(ALMACEN); } catch (e) { /* nada */ }
    clave = "";
    datos = null;
    pintarEntrada();
  }

  /* ------------------------------------------------------------- arranque */

  if (clave) {
    escena.appendChild(h("div", { class: "vacio", texto: "Cargando resultados…" }));
    pedir().then(function (d) { datos = d; pintarPanel(); })
      .catch(function () { pintarEntrada(); });
  } else {
    pintarEntrada();
  }
})();
