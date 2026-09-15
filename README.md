# Encuesta de satisfacción del cliente · GABOTRIX

Encuesta interactiva para clientes, publicada en GitHub Pages, con panel de
resultados propio. Sin framework ni compilación: los archivos se sirven tal cual.

- **Encuesta** → `https://satisfaccion.gabotrix.com/`
- **Panel** → `https://satisfaccion.gabotrix.com/panel.html`

El dominio propio está en el archivo `CNAME`, que lo escribe GitHub al
configurarlo. **Si se borra ese archivo, el dominio deja de funcionar.**
`gabotrix.github.io/encuesta-satisfaccion/` redirige aquí con un 301, así que los
enlaces repartidos antes del cambio siguen valiendo.

## Qué hay aquí

```
index.html            la encuesta
panel.html            los resultados, tras clave
assets/encuesta.css   estilo de las dos páginas (fondo, pills, campos)
assets/encuesta.js    el guion de la encuesta: preguntas, avance y envío
assets/panel.css      lo propio del tablero
assets/panel.js       consulta y pinta los resultados
supabase/functions/   las dos edge functions, copia de lo desplegado
```

Las preguntas viven en **una sola lista**, `PASOS` en `assets/encuesta.js`.
Añadir, quitar o reordenar una pregunta es tocar esa lista; el contador, la barra
de avance y el teclado se ajustan solos.

## Dónde caen las respuestas

Supabase **Pagina Web Gabotrix** (`tzuipgrkizsffgoxdrkg`, servidor MCP
`supabase-webgabotrix`), tabla `public.encuesta_satisfaccion`.

La tabla tiene **RLS activo y ninguna política**, y `anon` no tiene permisos
sobre ella. Está comprobado: con la clave publicable real, un `SELECT` y un
`INSERT` directos por PostgREST devuelven `42501 permission denied`. La única
puerta son dos edge functions, que entran con `service_role`:

| Función | Qué hace |
|---|---|
| `encuesta-enviar` | Recibe una respuesta. Valida cada valor contra las listas cerradas del formulario, descarta el campo trampa y limita a 8 envíos por hora y 30 por día desde una misma IP. |
| `encuesta-resultados` | Devuelve las cifras y las respuestas, o el CSV. Pide la clave del panel en la cabecera `x-clave-panel`. |

Las dos van con `verify_jwt` en **false** a propósito: quien responde la encuesta
es un cliente, no un usuario de Supabase, y no hay sesión que verificar. La clave
publicable de Supabase **no aparece en ninguna de las dos páginas**.

### Por qué no se inserta directo desde la página

La tabla `solicitudes` de este mismo proyecto sí deja insertar a `anon`. Aquí no:
esa clave viaja en el HTML y cualquiera puede abrir la consola del navegador y
llenar la tabla de basura. Pasando por la función, un valor que no esté en la
lista no entra.

## La clave del panel

Está en `CLAVE-PANEL.txt`, que **no se sube al repositorio**. Se guarda en
`sessionStorage`: al cerrar la pestaña hay que volver a ponerla.

Su SHA-256 con sal vive en `public.encuesta_panel`. Para cambiarla:

```sql
-- con la sal que ya está en la tabla, o una nueva
update public.encuesta_panel
   set clave_hash = encode(extensions.digest(sal || ':' || 'LA-CLAVE-NUEVA', 'sha256'), 'hex'),
       rotada_en  = now();
```

No hace falta volver a desplegar nada: la función lee la clave de la tabla en
cada consulta.

## Probar en local

```bash
python -m http.server 8794 --directory encuesta-satisfaccion
```

Atajos útiles en la URL:

| Parámetro | Para qué |
|---|---|
| `?prueba=1` | Marca la respuesta como de prueba. Entra a la tabla pero el panel la deja fuera de las cifras salvo que se active «Incluir pruebas». |
| `?paso=4` | Abre directo esa pregunta, sin responder las anteriores. |

Las respuestas a medias se guardan en `localStorage` en cada toque, y sólo se
borran **cuando el envío ya está confirmado**: si se cae la red, lo escrito sigue
ahí para reintentar.

## Decisiones que no se ven en el código

**Todo es obligatorio menos la última pantalla** (decisión del 15-sep-2026; antes
se podía responder anónimo y saltarse casi todo). La única que admite el blanco
es "Una última idea" — `adicional` y `comentarios`.

Cada regla vive en **tres sitios**, y hay que deshacer los tres para revertirla:

| Capa | Qué hace |
|---|---|
| La página | El botón nace bloqueado y no se suelta hasta que el paso está completo |
| `encuesta-enviar` | Devuelve un 400 con el nombre de lo que falta |
| La tabla | `NOT NULL` en las columnas, y un CHECK para el contacto condicional |

Sólo con la página no basta: se puede abrir la consola del navegador y llamar a
la función a mano. La función es la única puerta, así que es el único sitio
donde la regla es real.

**"Sí, contácteme" exige dejar un dato.** Antes se podía decir que sí y no dejar
nada, y el panel lo escondía igual porque filtra por `desea_contacto and contacto
is not null`: era un sí que no servía para nada.

Dos cosas que conviene tener presentes al leer los resultados:

- **Una encuesta firmada recibe notas más altas y críticas más suaves** que una
  anónima. Si las respuestas parecen sospechosamente buenas, éste es el primer
  sitio donde mirar.
- **Obligar las dos preguntas abiertas ensucia justo lo más valioso**: quien no
  tiene nada que decir escribe "nada", "." o "ok" para poder pasar. Al contar
  respuestas de texto, descartar las de menos de tres o cuatro caracteres.

**El dato de contacto no se guarda si la persona dice que no** quiere que la
contacten, aunque venga en el cuerpo de la petición. Lo filtra la función, no la
página.

**Las opciones únicas avanzan solas** tras 420 ms (900 ms en el NPS, que muestra
una lectura debajo). Sin esa pausa la pantalla cambia antes de que el ojo
registre lo que eligió y parece un error.

**Los colores de las gráficas del panel salen del validador** de la casa, no del
gusto. El rojo y el verde «de siempre» fallaban la separación para daltonismo
(ΔE 3.9 en deuteranopía, sobre un mínimo de 8). El par que quedó
—`#bc2c00` / `#00ad71` con gris `#7a8699` en medio— llega a 14 y pasa las seis
pruebas sobre fondo oscuro.

**En móvil la escala del NPS baja a dos filas de seis.** Once casillas cuadradas
no caben en 375 px: la del 10 quedaba fuera de la pantalla.

## Qué no tiene

- No avisa por correo cuando llega una respuesta.
- No borra ni corrige respuestas desde el panel; eso se hace por SQL.
- El panel trae hasta 5.000 respuestas de una vez. Pasado eso hay que paginar.
