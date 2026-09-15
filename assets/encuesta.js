/* Encuesta de satisfacción GABOTRIX.
 *
 * Una pregunta por pantalla, con avance automático en las de opción única: es
 * lo que hace que una encuesta de diecisiete preguntas se sienta corta. Las
 * respuestas se guardan en el navegador en cada toque, así que cerrar la
 * pestaña por error no obliga a empezar de cero.
 *
 * No hay clave de Supabase en esta página. El envío va a una edge function que
 * valida los valores contra las mismas listas de aquí abajo y escribe con
 * service_role; la tabla no es alcanzable de ninguna otra forma.
 *
 * JavaScript plano a propósito: GitHub Pages sirve el archivo tal cual y no hay
 * paso de compilación que se pueda quedar desactualizado. */

(function () {
  "use strict";

  var FUNCION = "https://tzuipgrkizsffgoxdrkg.supabase.co/functions/v1/encuesta-enviar";
  var ALMACEN = "gbx-encuesta-satisfaccion-v1";

  var escena = document.getElementById("escena");
  var barraFill = document.getElementById("barra-fill");
  var barra = document.getElementById("barra");
  var contadorPasos = document.getElementById("contador-pasos");

  var params = new URLSearchParams(location.search);
  // ?prueba=1 marca la respuesta como de prueba: entra a la tabla pero el panel
  // la deja fuera de las cifras. Sirve para enseñar la encuesta sin ensuciar.
  var ES_PRUEBA = params.get("prueba") === "1";

  var respuestas = cargar();
  var indice = 0;
  var direccion = 1;
  var enviando = false;
  var arranque = Date.now();

  /* ------------------------------------------------------------- utilidades */

  function h(etiqueta, atributos, hijos) {
    var e = document.createElement(etiqueta);
    for (var k in atributos || {}) {
      var v = atributos[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "html") e.innerHTML = v;
      else if (k === "texto") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    (hijos || []).forEach(function (c) {
      if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  function svg(d, opciones) {
    var o = opciones || {};
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", o.caja || "0 0 24 24");
    s.setAttribute("fill", o.relleno || "none");
    s.setAttribute("stroke", o.relleno ? "none" : "currentColor");
    s.setAttribute("stroke-width", o.grosor || "2.4");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    s.appendChild(p);
    return s;
  }

  var CHECK = "M20 6 9 17l-5-5";
  var ESTRELLA = "M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45l-5.81 3.05 " +
                 "1.11-6.47-4.7-4.58 6.5-.95z";

  function guardar() {
    try { localStorage.setItem(ALMACEN, JSON.stringify(respuestas)); } catch (e) { /* modo privado */ }
  }

  function cargar() {
    try {
      var s = localStorage.getItem(ALMACEN);
      var o = s ? JSON.parse(s) : null;
      return o && typeof o === "object" ? o : {};
    } catch (e) { return {}; }
  }

  function olvidar() {
    try { localStorage.removeItem(ALMACEN); } catch (e) { /* nada */ }
  }

  /** Vibración corta al elegir. Sólo la tienen los móviles; el resto lo ignora. */
  function toque() {
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* nada */ } }
  }

  /* ---------------------------------------------------------------- guion */

  // Los valores (izquierda) son los que acepta la base de datos. Cambiar uno
  // aquí sin cambiarlo en la edge function hace que la respuesta se descarte
  // en silencio: las dos listas tienen que ir a la par.
  var PASOS = [
    { tipo: "portada" },

    {
      tipo: "texto", id: "nombre", requerido: true,
      titulo: "¿Con quién tenemos el gusto?",
      ayuda: "Necesitamos saber quién responde para poder darle seguimiento.",
      etiqueta: "Nombre o empresa",
      marcador: "P. ej. Constructora del Río S.A.S.",
      max: 200
    },

    {
      tipo: "eleccion", id: "satisfaccion", requerido: true,
      titulo: "En general, ¿qué tan satisfecho está con nuestros servicios?",
      opciones: [
        { v: "muy_satisfecho",   t: "Muy satisfecho",   e: "🤩" },
        { v: "satisfecho",       t: "Satisfecho",       e: "🙂" },
        { v: "neutral",          t: "Neutral",          e: "😐" },
        { v: "insatisfecho",     t: "Insatisfecho",     e: "🙁" },
        { v: "muy_insatisfecho", t: "Muy insatisfecho", e: "😞" }
      ]
    },

    {
      tipo: "nps", id: "nps", requerido: true,
      titulo: "¿Qué tan probable es que nos recomiende a un colega o conocido?",
      ayuda: "0 es nada probable y 10 es muy probable."
    },

    {
      tipo: "escalas", id: "calidad", requerido: true,
      titulo: "Califique la calidad del servicio",
      ayuda: "De 1 (muy malo) a 5 (excelente). Los cinco criterios.",
      criterios: [
        { id: "cal_servicio", t: "Calidad del servicio recibido" },
        { id: "cal_tiempos",  t: "Cumplimiento de tiempos y plazos" },
        { id: "cal_trato",    t: "Amabilidad y trato del personal" },
        { id: "cal_claridad", t: "Claridad de la información entregada" },
        { id: "cal_precio",   t: "Relación entre precio y valor recibido" }
      ]
    },

    {
      tipo: "eleccion", id: "facilidad", requerido: true,
      titulo: "¿Qué tan fácil fue contactarnos cuando lo necesitó?",
      opciones: [
        { v: "muy_facil",   t: "Muy fácil",                  e: "⚡" },
        { v: "facil",       t: "Fácil",                      e: "👌" },
        { v: "dificil",     t: "Difícil",                    e: "😕" },
        { v: "muy_dificil", t: "Muy difícil",                e: "🧱" },
        { v: "no_aplica",   t: "No he necesitado contactarlos", e: "—" }
      ]
    },

    {
      tipo: "eleccion", id: "oportunidad", requerido: true,
      titulo: "¿Recibió respuesta oportuna a sus solicitudes o inquietudes?",
      opciones: [
        { v: "siempre",      t: "Siempre",      e: "🏅" },
        { v: "casi_siempre", t: "Casi siempre", e: "👍" },
        { v: "a_veces",      t: "A veces",      e: "🤔" },
        { v: "rara_vez",     t: "Rara vez",     e: "⏳" },
        { v: "nunca",        t: "Nunca",        e: "🚫" }
      ]
    },

    {
      tipo: "eleccion", id: "resolucion", requerido: true,
      titulo: "¿Su solicitud o problema fue resuelto satisfactoriamente?",
      opciones: [
        { v: "completa",  t: "Sí, completamente", e: "✅" },
        { v: "parcial",   t: "Parcialmente",      e: "◐" },
        { v: "no",        t: "No",                e: "❌" },
        { v: "no_aplica", t: "No aplica",         e: "—" }
      ]
    },

    {
      tipo: "abiertas", id: "abiertas1", requerido: true,
      titulo: "Cuéntenos con sus palabras",
      ayuda: "Lo que escriba aquí es lo que más nos sirve para cambiar cosas.",
      campos: [
        { id: "mas_valora", t: "¿Qué es lo que más valora de nuestro servicio?",
          marcador: "Lo que no quisiera que cambiáramos…", max: 2000 },
        { id: "mejorar", t: "¿Qué deberíamos mejorar?",
          marcador: "Sea tan directo como quiera.", max: 2000 }
      ]
    },

    {
      tipo: "abiertas", id: "abiertas2", opcional: true,
      titulo: "Una última idea",
      ayuda: "Las dos se pueden dejar en blanco. Es el único sitio de la encuesta donde no le pedimos nada.",
      campos: [
        { id: "adicional", t: "¿Hay algún servicio adicional que le gustaría que ofreciéramos?",
          marcador: "Algo que hoy resuelve con otro proveedor, o con nadie…", max: 2000 },
        { id: "comentarios", t: "Comentarios o sugerencias adicionales",
          marcador: "Lo que quiera añadir.", max: 2000 }
      ]
    },

    { tipo: "seguimiento", id: "seguimiento", requerido: true },

    { tipo: "gracias" }
  ];

  // La portada y el "gracias" no cuentan: el contador tiene que decir 1 de 10 en
  // la primera pregunta de verdad, no 2 de 12.
  var PRIMERO = 1;
  var ULTIMO = PASOS.length - 2;
  var TOTAL = ULTIMO - PRIMERO + 1;

  /* ------------------------------------------------------------- dibujado */

  function pintar() {
    var paso = PASOS[indice];
    escena.innerHTML = "";
    escena.className = "paso " + (direccion < 0 ? "entra-atras" : "entra");

    var cuerpo = ({
      portada: pintarPortada,
      texto: pintarTexto,
      eleccion: pintarEleccion,
      nps: pintarNps,
      escalas: pintarEscalas,
      abiertas: pintarAbiertas,
      seguimiento: pintarSeguimiento,
      gracias: pintarGracias
    })[paso.tipo](paso);

    escena.appendChild(cuerpo);
    actualizarAvance();
    window.scrollTo({ top: 0, behavior: direccion === 0 ? "auto" : "smooth" });
  }

  function actualizarAvance() {
    var paso = PASOS[indice];
    var enCuestionario = indice >= PRIMERO && indice <= ULTIMO;
    var n = enCuestionario ? indice - PRIMERO + 1 : (paso.tipo === "gracias" ? TOTAL : 0);
    var pct = Math.round((n / TOTAL) * 100);

    barraFill.style.width = pct + "%";
    barra.setAttribute("aria-valuenow", String(pct));
    contadorPasos.textContent = enCuestionario ? n + " de " + TOTAL : "";
  }

  /** Encabezado común: título, ayuda y la etiqueta de opcional. */
  function encabezado(paso) {
    var titulo = h("h2", {}, [paso.titulo]);
    if (paso.opcional) titulo.appendChild(h("span", { class: "opcional", texto: "opcional" }));
    var trozos = [titulo];
    if (paso.ayuda) trozos.push(h("p", { class: "ayuda", texto: paso.ayuda }));
    return trozos;
  }

  /** Fila de botones de abajo. `siguiente` a null esconde el botón de avanzar. */
  function acciones(opciones) {
    var o = opciones || {};
    var hijos = [];

    if (indice > PRIMERO) {
      hijos.push(h("button", {
        type: "button", class: "pill pill-suave", texto: "Atrás", onclick: atras
      }));
    }

    if (o.siguiente !== null) {
      var b = h("button", {
        type: "button", class: "pill pill-marca", id: "btn-siguiente",
        onclick: o.alSiguiente || adelante
      }, [document.createTextNode(o.siguiente || "Continuar"), svg("M5 12h14M13 6l6 6-6 6")]);
      if (o.bloqueado) b.disabled = true;
      hijos.push(b);
    }

    if (o.pista !== false && window.matchMedia("(min-width: 721px)").matches) {
      hijos.push(h("span", { class: "pista", html: o.pista ||
        "Pulse <kbd>Enter</kbd> para continuar" }));
    }

    var fila = h("div", { class: "acciones" }, hijos);
    return fila;
  }

  /* ------------------------------------------------------------- portada */

  function pintarPortada() {
    var reanuda = Object.keys(respuestas).length > 0;

    return h("div", { class: "portada-marco" }, [
      h("span", { class: "epigrafe" }, [h("span", { class: "punto" }), "Encuesta de satisfacción"]),
      h("h1", {}, ["Su opinión nos ayuda a mejorar."]),
      h("p", { class: "ayuda" }, [
        "Son diecisiete preguntas cortas. Las contesta en menos de tres minutos, " +
        "y la última pantalla la puede dejar en blanco."
      ]),
      h("div", { class: "datos-portada" }, [
        h("span", { class: "dato" }, [svg("M12 6v6l4 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z"),
          "Menos de 3 minutos"]),
        h("span", { class: "dato" }, [svg("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"),
          "Respuestas confidenciales"]),
        h("span", { class: "dato" }, [svg("M20 6 9 17l-5-5"),
          "Una pregunta por pantalla"])
      ]),
      h("div", { class: "acciones" }, [
        h("button", {
          type: "button", class: "pill pill-marca",
          onclick: function () { arranque = Date.now(); adelante(); }
        }, [document.createTextNode(reanuda ? "Retomar donde iba" : "Comenzar"),
            svg("M5 12h14M13 6l6 6-6 6")]),
        reanuda ? h("button", {
          type: "button", class: "pill pill-suave", texto: "Empezar de nuevo",
          onclick: function () { respuestas = {}; olvidar(); pintar(); }
        }) : null
      ])
    ]);
  }

  /* ------------------------------------------------------ campo de texto */

  function pintarTexto(paso) {
    var entrada = h("input", {
      type: "text", id: "campo-" + paso.id, maxlength: paso.max,
      placeholder: paso.marcador, autocomplete: "organization",
      value: respuestas[paso.id] || "",
      oninput: function () { respuestas[paso.id] = entrada.value; guardar(); }
    });

    var bloque = h("div", {}, encabezado(paso).concat([
      h("div", { class: "campo" }, [
        h("label", { for: "campo-" + paso.id, texto: paso.etiqueta }),
        entrada
      ]),
      acciones({
        siguiente: "Continuar",
        bloqueado: paso.requerido && !(respuestas[paso.id] || "").trim()
      })
    ]));

    // El botón se suelta en cuanto hay algo escrito. Se comprueba en cada tecla
    // y no al pulsar: un botón que no responde sin decir por qué desespera.
    entrada.addEventListener("input", function () {
      var b = document.getElementById("btn-siguiente");
      if (b && paso.requerido) b.disabled = !entrada.value.trim();
    });

    setTimeout(function () { entrada.focus(); }, 380);
    return bloque;
  }

  /* -------------------------------------------------------- opción única */

  function pintarEleccion(paso) {
    var lista = h("div", { class: "opciones", role: "radiogroup",
                           "aria-label": paso.titulo });

    paso.opciones.forEach(function (op, i) {
      var elegida = respuestas[paso.id] === op.v;
      var boton = h("button", {
        type: "button", class: "opcion", role: "radio",
        "aria-checked": elegida ? "true" : "false",
        tabindex: elegida || (!respuestas[paso.id] && i === 0) ? "0" : "-1",
        style: "--retraso:" + (i * 45) + "ms",
        onclick: function () { elegir(op.v); }
      }, [
        h("span", { class: "tecla", texto: String(i + 1) }),
        h("span", { class: "opcion-emoji", texto: op.e, "aria-hidden": "true" }),
        h("span", { class: "opcion-texto", texto: op.t }),
        (function () { var s = svg(CHECK); s.classList.add("marca-check"); return s; })()
      ]);
      lista.appendChild(boton);
    });

    function elegir(v) {
      respuestas[paso.id] = v;
      guardar();
      toque();
      Array.prototype.forEach.call(lista.children, function (b, i) {
        var on = paso.opciones[i].v === v;
        b.setAttribute("aria-checked", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
      });
      // Se avanza solo, pero no de golpe: 420 ms dejan ver la marca de
      // seleccionado. Sin esa pausa la pantalla cambia antes de que el ojo
      // registre qué se eligió y da sensación de error.
      setTimeout(function () { if (PASOS[indice] === paso) adelante(); }, 420);
    }

    lista.addEventListener("keydown", function (ev) {
      var botones = Array.prototype.slice.call(lista.children);
      var actual = botones.indexOf(document.activeElement);
      var salto = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ev.key];
      if (!salto) return;
      ev.preventDefault();
      var destino = botones[(Math.max(actual, 0) + salto + botones.length) % botones.length];
      destino.tabIndex = 0;
      destino.focus();
    });

    var bloque = h("div", {}, encabezado(paso).concat([
      lista,
      acciones({
        siguiente: paso.requerido ? "Continuar" : "Saltar esta pregunta",
        bloqueado: paso.requerido && !respuestas[paso.id],
        pista: "Pulse <kbd>1</kbd>–<kbd>" + paso.opciones.length + "</kbd> para elegir"
      })
    ]));

    setTimeout(function () {
      var f = lista.querySelector('[tabindex="0"]');
      if (f) f.focus({ preventScroll: true });
    }, 380);

    return bloque;
  }

  /* ------------------------------------------------------------------ NPS */

  var LECTURA_NPS = [
    { hasta: 6,  cara: "😞", titulo: "Detractor",
      texto: "Algo salió mal y queremos saber qué. La siguiente pregunta importa." },
    { hasta: 8,  cara: "😐", titulo: "Pasivo",
      texto: "Cumplimos, pero no lo suficiente como para que nos recomiende." },
    { hasta: 10, cara: "🤩", titulo: "Promotor",
      texto: "Gracias. Eso es exactamente lo que buscamos." }
  ];

  /** Rojo a verde según la nota, para que la escala se lea de un vistazo. */
  function tonoNps(n) {
    var tonos = ["#f87171", "#f87171", "#fb7185", "#fb923c", "#fbbf24", "#fbbf24",
                 "#facc15", "#a3e635", "#4ade80", "#34d399", "#2dd4bf"];
    return tonos[n];
  }

  function pintarNps(paso) {
    var escala = h("div", { class: "nps-escala", role: "radiogroup",
                            "aria-label": paso.titulo });
    var lectura = h("div", { class: "nps-lectura", "data-visible": "false" });

    function refrescarLectura() {
      var n = respuestas.nps;
      if (n === undefined || n === null) { lectura.setAttribute("data-visible", "false"); return; }
      var l = LECTURA_NPS.filter(function (x) { return n <= x.hasta; })[0];
      lectura.innerHTML = "";
      lectura.appendChild(h("span", { class: "cara", texto: l.cara, "aria-hidden": "true" }));
      lectura.appendChild(h("div", {}, [
        h("strong", { texto: l.titulo + " · " + n + " de 10" }),
        h("span", { texto: l.texto })
      ]));
      lectura.setAttribute("data-visible", "true");
    }

    for (var n = 0; n <= 10; n++) {
      (function (valor) {
        var elegida = respuestas.nps === valor;
        escala.appendChild(h("button", {
          type: "button", class: "nps-chip", role: "radio", texto: String(valor),
          "aria-checked": elegida ? "true" : "false",
          "aria-label": valor + " de 10",
          tabindex: elegida || (respuestas.nps === undefined && valor === 0) ? "0" : "-1",
          style: "--tono:" + tonoNps(valor),
          onclick: function () { elegir(valor); }
        }));
      })(n);
    }

    function elegir(v) {
      respuestas.nps = v;
      guardar();
      toque();
      Array.prototype.forEach.call(escala.children, function (b, i) {
        b.setAttribute("aria-checked", i === v ? "true" : "false");
        b.tabIndex = i === v ? 0 : -1;
      });
      refrescarLectura();
      var btn = document.getElementById("btn-siguiente");
      if (btn) btn.disabled = false;
      // Aquí la pausa es mayor que en las de opción: la lectura ("Promotor",
      // "Detractor") aparece debajo y hay que darle tiempo a leerse.
      setTimeout(function () { if (PASOS[indice] === paso) adelante(); }, 900);
    }

    escala.addEventListener("keydown", function (ev) {
      var salto = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (salto) {
        var botones = Array.prototype.slice.call(escala.children);
        var actual = Math.max(botones.indexOf(document.activeElement), 0);
        var destino = botones[Math.min(10, Math.max(0, actual + salto))];
        destino.tabIndex = 0;
        destino.focus();
        ev.preventDefault();
      }
    });

    refrescarLectura();

    var bloque = h("div", {}, encabezado(paso).concat([
      escala,
      h("div", { class: "nps-pies" }, [
        h("span", { texto: "0 · Nada probable" }),
        h("span", { texto: "Muy probable · 10" })
      ]),
      lectura,
      acciones({
        bloqueado: respuestas.nps === undefined || respuestas.nps === null,
        pista: "Pulse <kbd>0</kbd>–<kbd>9</kbd>, o <kbd>→</kbd> para el 10"
      })
    ]));

    setTimeout(function () {
      var f = escala.querySelector('[tabindex="0"]');
      if (f) f.focus({ preventScroll: true });
    }, 380);

    return bloque;
  }

  /* ------------------------------------------------------ escalas de 1 a 5 */

  var PALABRAS = ["Muy malo", "Malo", "Aceptable", "Bueno", "Excelente"];

  function pintarEscalas(paso) {
    var lista = h("div", {});

    /** ¿Están calificados los cinco criterios? */
    function completo() {
      return paso.criterios.every(function (c) { return respuestas[c.id]; });
    }

    // Suelta o vuelve a bloquear el botón según falten criterios. Se llama en
    // cada estrella, no al pulsar Continuar: el contador de arriba y el botón
    // tienen que decir lo mismo en todo momento.
    function revisar() {
      var b = document.getElementById("btn-siguiente");
      if (b && paso.requerido) b.disabled = !completo();
      if (falta) {
        var n = paso.criterios.filter(function (c) { return !respuestas[c.id]; }).length;
        falta.textContent = n
          ? (n === 1 ? "Falta un criterio" : "Faltan " + n + " criterios")
          : "Los cinco calificados";
        falta.setAttribute("data-listo", n ? "false" : "true");
      }
    }

    var falta = paso.requerido
      ? h("div", { class: "falta", "aria-live": "polite" })
      : null;

    paso.criterios.forEach(function (c, i) {
      var actual = respuestas[c.id];
      var valor = h("span", {
        class: "criterio-valor",
        texto: actual ? actual + " · " + PALABRAS[actual - 1] : "Sin calificar"
      });
      var fila = h("div", { class: "estrellas", role: "radiogroup", "aria-label": c.t });
      var caja = h("div", {
        class: "criterio", "data-respondido": actual ? "true" : "false",
        style: "--retraso:" + (i * 60) + "ms"
      }, [
        h("div", { class: "criterio-cabeza" }, [
          h("span", { class: "criterio-titulo", texto: c.t }), valor
        ]),
        fila
      ]);

      function repintar() {
        var v = respuestas[c.id] || 0;
        Array.prototype.forEach.call(fila.children, function (b, k) {
          b.setAttribute("data-on", k < v ? "true" : "false");
          b.setAttribute("aria-checked", k + 1 === v ? "true" : "false");
          b.tabIndex = (k + 1 === v) || (!v && k === 0) ? 0 : -1;
        });
        valor.textContent = v ? v + " · " + PALABRAS[v - 1] : "Sin calificar";
        caja.setAttribute("data-respondido", v ? "true" : "false");
      }

      for (var n = 1; n <= 5; n++) {
        (function (v) {
          var b = h("button", {
            type: "button", class: "estrella", role: "radio",
            "aria-label": v + " de 5 · " + PALABRAS[v - 1],
            onclick: function () {
              // Volver a tocar la misma estrella quita la nota. Con el paso
              // obligatorio eso vuelve a bloquear el botón, que es lo correcto:
              // se puede corregir una nota puesta por error sin quedarse
              // atrapado, pero no se puede seguir sin las cinco.
              respuestas[c.id] = respuestas[c.id] === v ? undefined : v;
              if (respuestas[c.id] === undefined) delete respuestas[c.id];
              guardar(); toque(); repintar(); revisar();
            }
          }, [svg(ESTRELLA, { relleno: "currentColor" })]);
          fila.appendChild(b);
        })(n);
      }

      fila.addEventListener("keydown", function (ev) {
        var salto = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[ev.key];
        if (!salto) return;
        ev.preventDefault();
        var v = Math.min(5, Math.max(1, (respuestas[c.id] || 0) + salto));
        respuestas[c.id] = v;
        guardar(); repintar(); revisar();
        fila.children[v - 1].focus();
      });

      repintar();
      lista.appendChild(caja);
    });

    var bloque = h("div", {}, encabezado(paso).concat([
      lista,
      falta,
      acciones({
        siguiente: "Continuar",
        bloqueado: paso.requerido && !completo(),
        pista: false
      })
    ]));
    revisar();
    return bloque;
  }

  /* -------------------------------------------------------- preguntas abiertas */

  function pintarAbiertas(paso) {
    /** ¿Están escritos todos los campos de esta pantalla? */
    function completo() {
      return paso.campos.every(function (c) {
        return (respuestas[c.id] || "").trim().length > 0;
      });
    }

    function revisar() {
      var b = document.getElementById("btn-siguiente");
      if (b && paso.requerido) b.disabled = !completo();
    }

    var campos = paso.campos.map(function (c) {
      var area = h("textarea", {
        id: "campo-" + c.id, maxlength: c.max, placeholder: c.marcador, rows: "3"
      });
      area.value = respuestas[c.id] || "";

      var contador = h("span", { class: "contador" });
      function refrescar() {
        contador.textContent = area.value.length + " / " + c.max;
        contador.style.visibility = area.value.length > c.max * 0.6 ? "visible" : "hidden";
      }
      area.addEventListener("input", function () {
        respuestas[c.id] = area.value; guardar(); refrescar(); revisar();
      });
      refrescar();

      return h("div", { class: "campo" }, [
        h("label", { for: "campo-" + c.id, texto: c.t }), area, contador
      ]);
    });

    var bloque = h("div", {}, encabezado(paso).concat(campos).concat([
      acciones({
        siguiente: "Continuar",
        bloqueado: paso.requerido && !completo(),
        pista: paso.requerido ? "Las dos hay que contestarlas" : "Puede dejarlas en blanco"
      })
    ]));
    revisar();

    setTimeout(function () {
      var a = bloque.querySelector("textarea");
      if (a && window.matchMedia("(min-width: 721px)").matches) a.focus({ preventScroll: true });
    }, 380);

    return bloque;
  }

  /* ------------------------------------------------------------ seguimiento */

  function pintarSeguimiento(paso) {
    var desplegable = h("div", { class: "desplegable" });
    var entrada = h("input", {
      type: "text", id: "campo-contacto", maxlength: "200",
      placeholder: "correo@empresa.com o 300 000 0000",
      autocomplete: "email", value: respuestas.contacto || "",
      oninput: function () { respuestas.contacto = entrada.value; guardar(); }
    });
    desplegable.appendChild(h("div", {}, [
      h("div", { class: "campo" }, [
        h("label", { for: "campo-contacto", texto: "Correo o teléfono" }), entrada
      ])
    ]));

    var opciones = [
      { v: true,  t: "Sí, me pueden contactar", e: "📞" },
      { v: false, t: "No, gracias",             e: "🤝" }
    ];
    var lista = h("div", { class: "opciones", role: "radiogroup",
                           "aria-label": "¿Desea que lo contactemos?" });

    opciones.forEach(function (op, i) {
      var elegida = respuestas.desea_contacto === op.v;
      lista.appendChild(h("button", {
        type: "button", class: "opcion", role: "radio",
        "aria-checked": elegida ? "true" : "false",
        tabindex: elegida ? "0" : "-1",
        style: "--retraso:" + (i * 45) + "ms",
        onclick: function () { elegir(op.v); }
      }, [
        h("span", { class: "tecla", texto: String(i + 1) }),
        h("span", { class: "opcion-emoji", texto: op.e, "aria-hidden": "true" }),
        h("span", { class: "opcion-texto", texto: op.t }),
        (function () { var s = svg(CHECK); s.classList.add("marca-check"); return s; })()
      ]));
    });

    function elegir(v) {
      respuestas.desea_contacto = v;
      guardar(); toque();
      Array.prototype.forEach.call(lista.children, function (b, i) {
        b.setAttribute("aria-checked", opciones[i].v === v ? "true" : "false");
      });
      desplegable.setAttribute("data-abierto", v ? "true" : "false");
      if (v) setTimeout(function () { entrada.focus(); }, 320);
      revisar();
    }

    // Hay que elegir sí o no, y si es sí hace falta el dato: un "sí, contácteme"
    // sin correo ni teléfono no sirve para nada y el panel lo escondió igual.
    function completo() {
      if (typeof respuestas.desea_contacto !== "boolean") return false;
      return respuestas.desea_contacto === false ||
             (respuestas.contacto || "").trim().length > 0;
    }

    function revisar() {
      var b = document.getElementById("btn-enviar");
      if (b) b.disabled = !completo();
    }

    entrada.addEventListener("input", revisar);

    if (respuestas.desea_contacto === true) desplegable.setAttribute("data-abierto", "true");

    var error = h("div", { class: "error", hidden: true, role: "alert" });

    var bloque = h("div", {}, encabezado({
      titulo: "¿Desea que lo contactemos para ampliar sus comentarios?",
      ayuda: "Elija una de las dos. El dato de contacto no se guarda si responde que no."
    }).concat([
      lista, desplegable,
      h("div", { class: "acciones" }, [
        h("button", { type: "button", class: "pill pill-suave", texto: "Atrás", onclick: atras }),
        (function () {
          var b = h("button", {
            type: "button", class: "pill pill-marca", id: "btn-enviar", onclick: enviar
          }, [document.createTextNode("Enviar respuestas"), svg("M5 12h14M13 6l6 6-6 6")]);
          b.disabled = !completo();
          return b;
        })(),
        // El campo trampa vive aquí, en el paso que envía: un robot que rellene
        // el formulario lo marcará y la función descartará el envío.
        h("input", { type: "text", class: "trampa", id: "website", name: "website",
                     tabindex: "-1", autocomplete: "off", "aria-hidden": "true" })
      ]),
      error
    ]));

    return bloque;
  }

  /* ---------------------------------------------------------------- envío */

  function enviar() {
    if (enviando) return;
    var btn = document.getElementById("btn-enviar");
    var error = escena.querySelector(".error");
    error.hidden = true;

    // El botón ya nace bloqueado, pero esto cubre el Enter y cualquier camino
    // que no pase por él. Es la última red de la página; la de verdad está en
    // la edge function.
    var falta = PASOS.filter(function (x) { return x.requerido && !respondido(x); });
    if (falta.length) {
      error.hidden = false;
      error.textContent = "Falta contestar: " +
        falta.map(function (x) { return x.titulo || "el seguimiento"; }).join(" · ");
      return;
    }

    enviando = true;
    btn.disabled = true;
    btn.innerHTML = "";
    btn.appendChild(h("span", { class: "rueda" }));
    btn.appendChild(document.createTextNode("Enviando…"));

    var trampa = document.getElementById("website");
    var cuerpo = {
      nombre: respuestas.nombre,
      satisfaccion: respuestas.satisfaccion,
      nps: respuestas.nps,
      cal_servicio: respuestas.cal_servicio,
      cal_tiempos: respuestas.cal_tiempos,
      cal_trato: respuestas.cal_trato,
      cal_claridad: respuestas.cal_claridad,
      cal_precio: respuestas.cal_precio,
      facilidad: respuestas.facilidad,
      oportunidad: respuestas.oportunidad,
      resolucion: respuestas.resolucion,
      mas_valora: respuestas.mas_valora,
      mejorar: respuestas.mejorar,
      adicional: respuestas.adicional,
      comentarios: respuestas.comentarios,
      desea_contacto: respuestas.desea_contacto,
      contacto: respuestas.contacto,
      website: trampa ? trampa.value : "",
      origen: location.href.slice(0, 300),
      duracion_ms: Date.now() - arranque,
      es_prueba: ES_PRUEBA
    };

    fetch(FUNCION, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      if (!res.ok) throw new Error(res.d && res.d.error ? res.d.error : "No se pudo enviar");
      // Sólo se olvida lo escrito cuando la respuesta ya está guardada al otro
      // lado. Si se borrara antes, un fallo de red se llevaría los tres minutos
      // que acaba de dedicar el cliente.
      olvidar();
      indice = PASOS.length - 1;
      direccion = 1;
      pintar();
    }).catch(function (e) {
      enviando = false;
      btn.disabled = false;
      btn.innerHTML = "";
      btn.appendChild(document.createTextNode("Reintentar envío"));
      btn.appendChild(svg("M5 12h14M13 6l6 6-6 6"));
      error.hidden = false;
      error.textContent = e.message === "Failed to fetch"
        ? "No hay conexión. Sus respuestas siguen guardadas aquí: vuelva a intentarlo cuando tenga señal."
        : e.message;
    });
  }

  /* --------------------------------------------------------------- gracias */

  function pintarGracias() {
    setTimeout(chispas, 220);

    return h("div", { class: "gracias" }, [
      (function () {
        var s = svg(CHECK, { grosor: "3" });
        return h("div", { class: "sello" }, [s]);
      })(),
      h("h1", {}, ["Gracias por su tiempo."]),
      h("p", { class: "ayuda" }, [
        "Ya tenemos sus respuestas. Las lee una persona, no un informe automático, " +
        "y lo que señaló como mejorable entra en la revisión del mes."
      ]),
      respuestas.desea_contacto === true
        ? h("p", { class: "ayuda", texto: "Nos pondremos en contacto con usted pronto." })
        : null,
      h("div", { class: "acciones", style: "justify-content:center" }, [
        h("a", { class: "pill pill-suave", href: "https://gabotrix.com", rel: "noopener",
                 texto: "Conocer GABOTRIX" })
      ])
    ]);
  }

  /** El estallido de puntitos detrás del sello. Puro adorno, y se lo salta
   *  quien haya pedido menos movimiento. */
  function chispas() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var sello = escena.querySelector(".sello");
    if (!sello) return;
    var caja = sello.getBoundingClientRect();
    var cx = caja.left + caja.width / 2;
    var cy = caja.top + caja.height / 2;
    var tonos = ["#1a73e8", "#5ab4ff", "#34d399", "#fbbf24", "#ffffff"];

    for (var i = 0; i < 26; i++) {
      var a = (Math.PI * 2 * i) / 26 + Math.random() * 0.4;
      var d = 90 + Math.random() * 130;
      var p = h("span", { class: "chispa" });
      p.style.left = cx + "px";
      p.style.top = cy + "px";
      p.style.background = tonos[i % tonos.length];
      p.style.setProperty("--dx", Math.cos(a) * d + "px");
      p.style.setProperty("--dy", Math.sin(a) * d + "px");
      p.style.setProperty("--giro", Math.round(Math.random() * 540) + "deg");
      document.body.appendChild(p);
      setTimeout((function (el) { return function () { el.remove(); }; })(p), 1200);
    }
  }

  /* ------------------------------------------------------------ navegación */

  /** ¿Está contestado este paso? Un texto en blanco o con sólo espacios no
   *  cuenta, y el 0 del NPS sí: por eso no vale preguntar por el valor a secas.
   *
   *  Ojo con los pasos que agrupan varias respuestas: `calidad` y las dos
   *  pantallas de preguntas abiertas NO guardan nada bajo su propio id, sino un
   *  campo por criterio. Preguntar por `respuestas[paso.id]` en esos daba
   *  siempre falso y dejaba el botón muerto para siempre. */
  function respondido(paso) {
    if (paso.tipo === "escalas") {
      return paso.criterios.every(function (c) { return respuestas[c.id]; });
    }
    if (paso.tipo === "abiertas") {
      return paso.campos.every(function (c) {
        return (respuestas[c.id] || "").trim().length > 0;
      });
    }
    if (paso.tipo === "seguimiento") {
      if (typeof respuestas.desea_contacto !== "boolean") return false;
      return respuestas.desea_contacto === false ||
             (respuestas.contacto || "").trim().length > 0;
    }
    var v = respuestas[paso.id];
    if (v === undefined || v === null) return false;
    return typeof v === "string" ? v.trim().length > 0 : true;
  }


  function adelante() {
    var paso = PASOS[indice];
    if (paso.requerido && !respondido(paso)) return;
    if (indice >= PASOS.length - 1) return;
    indice++;
    direccion = 1;
    pintar();
  }

  function atras() {
    if (indice <= 0) return;
    indice--;
    direccion = -1;
    pintar();
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var paso = PASOS[indice];
    var enTexto = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);

    if (ev.key === "Enter" && !(enTexto && document.activeElement.tagName === "TEXTAREA")) {
      // En los pasos de opción, Enter sobre un botón ya lo pulsa el navegador:
      // adelantar aquí también saltaría dos pantallas de una vez.
      if (document.activeElement.tagName === "BUTTON" || document.activeElement.tagName === "A") return;
      ev.preventDefault();
      if (paso.tipo === "seguimiento") { if (respondido(paso)) enviar(); }
      else if (paso.tipo === "portada") { arranque = Date.now(); adelante(); }
      else adelante();
      return;
    }

    if (enTexto) return;

    // El paso de seguimiento también pinta `.opcion`, así que las teclas 1 y 2
    // tienen que valer allí igual que en las preguntas de opción única.
    if ((paso.tipo === "eleccion" || paso.tipo === "seguimiento") && /^[1-9]$/.test(ev.key)) {
      var n = Number(ev.key) - 1;
      var b = escena.querySelectorAll(".opcion")[n];
      if (b) { ev.preventDefault(); b.click(); }
    }

    if (paso.tipo === "nps" && /^[0-9]$/.test(ev.key)) {
      var c = escena.querySelectorAll(".nps-chip")[Number(ev.key)];
      if (c) { ev.preventDefault(); c.click(); }
    }
  });

  // Empezar directo en una pregunta concreta: útil para revisar la pantalla que
  // toque sin responder todo lo anterior (?paso=4).
  var pedido = Number(params.get("paso"));
  if (pedido >= PRIMERO && pedido <= ULTIMO) { indice = pedido; direccion = 0; }

  pintar();
})();
