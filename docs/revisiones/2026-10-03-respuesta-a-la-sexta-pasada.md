# Respuesta a la sexta pasada de Codex (3 de octubre de 2026)

Informe: `2026-10-03-codex-sexta-pasada.md`. Dio por corregidos los avisos demorados y la copia
del mostrador, y comprobó por su cuenta que recargar no pierde la captura (también con la página
lenta, con `beforeunload` ocupado, con bfcache y al restaurar el navegador). No dio el cierre:
dejó dos hallazgos de importancia media en `pestana.ts` y uno de baja en una prueba. Los tres se
aceptan, y cada uno se corrigió con la prueba primero.

Estado al cerrar: **535 pruebas y 104 recorridos en verde** (antes 535 y 100).

## Media — un error al pedir el candado se tomaba por «es mía»

**Aceptado.** Había escrito: si pedir el candado falla por algo que no sea el plazo, «no se sabe:
no se suelta nada». Eso cuidaba un lado —no perder la captura— y descuidaba el otro: la pestaña
seguía adelante como dueña. Con el candado fallando en la copia, las dos pestañas registraban.
Es la misma lección de todo este bloque, otra vez: no saber no es un sí.

**Corrección** (`src/componentes/pestana.ts`, `src/componentes/SoloEnSuPestana.tsx`): pedir el
candado tiene ahora tres respuestas. *Lo tengo*: la pestaña es dueña. *Lo tiene otra*: es copia,
y suelta lo heredado; solo el plazo propio lo dice, no cualquier aborto. *No se sabe*: se
reintenta un par de veces y, si sigue sin saberse, la pestaña queda **en duda**: no suelta nada y
no deja capturar. Inventario y mostrador muestran el aviso y un botón «Volver a comprobar». Cuando
ya se puede saber, o recupera lo suyo o resulta copia y lo suelta.

**Pruebas** (`recorrido/inventario.spec.ts`):

- «Si no se puede saber si la pestaña es copia…»: la reproducción de Codex. La copia no deja
  registrar ni borra nada; volver a comprobar con el candado aún fallando la deja igual; al
  arreglarse, resulta copia y suelta lo heredado. La original registra una sola vez.
- «Si al recargar no se puede comprobar el candado…»: la original queda en duda en inventario y en
  el mostrador, sin perder nada; al poder comprobar, recupera su captura con el mismo identificador.

Las dos fallaban antes.

## Media, condicionada — un marco del mismo origen le borraba lo suyo a la página

**Aceptado.** Un `iframe` comparte lo guardado con su página pero es otro documento: se tomaba
por copia y limpiaba el almacenamiento compartido. La aplicación no tiene por qué correr dentro de
un marco, así que se prohíbe, en dos capas:

- **La respuesta lo prohíbe** (`next.config.ts`): toda página sale con
  `Content-Security-Policy: frame-ancestors 'none'` y `X-Frame-Options: DENY`. El navegador no la
  carga dentro de un marco, ni de su mismo origen. Va en la aplicación y no solo en el proxy, para
  que valga en cualquier forma de servirla.
- **Y si aun así cargara** (`pestana.ts`): dentro de un marco no se lee ni se toca nada guardado,
  no se pide candado, y la pantalla dice que no se usa dentro de otra página.

**Pruebas:** «un marco con la aplicación no le borra a la página lo que tenía a medias», en dos
variantes: con las cabeceras, y quitándoselas a la respuesta del marco para ejercitar la segunda
capa. En las dos, lo guardado y el identificador de la pestaña quedan intactos, y al recargar el
envío pendiente se reintenta idéntico. Fallaban antes.

## Baja — la prueba de «dos copias a la vez» veía la misma copia dos veces

**Aceptado.** Las dos esperas recibían el mismo evento. Ahora la prueba abre las dos de una vez,
recoge las páginas conforme aparecen, y afirma que son dos distintas, que hay tres en total y que
cada una quedó con su propio identificador de pestaña.

## Límites que quedan anotados

- **La copia del mostrador no recibe nada de la original.** Si la original se cierra con un peso
  tecleado, una segunda pesada a medias o un envío sin resolver, eso se va con ella: lo que ya
  llegó al servidor está en la cuenta; lo que no, hay que capturarlo de nuevo. No hay transferencia
  de control entre pestañas.
- **La espera de un segundo al recargar no tiene una cota garantizada por la especificación.**
  Codex no logró superarla ni con la página deliberadamente lenta; si pasara, la pestaña se tomaría
  por copia y soltaría lo suyo.
- **Sin origen seguro no hay candados.** Queda el mecanismo de avisos, que Codex ya venció una vez.
  La operación va por HTTPS.
- No se probó: «Duplicar pestaña» desde el menú, Ctrl+Shift+T, otros navegadores, ni que falle
  `sessionStorage`.
