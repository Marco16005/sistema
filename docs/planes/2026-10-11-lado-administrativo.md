# El lado administrativo: panel, días y bitácora

> **Estado (11 de octubre de 2026):** hechas las tres primeras pantallas —el resumen con sus
> gráficas, los días que ha habido y la bitácora a la vista— y el sembrador de la demostración.
> Se construyó repartido: el servidor del historial y el de la bitácora los escribió Codex
> (`gpt-6-astra`, esfuerzo alto) en su copia, con las pruebas primero, y se integraron después de
> leerlos; el sembrador lo empezó Codex y se le acabó la cuota a medias: lo terminó Claude. El
> servidor del panel, las tres pantallas, sus recorridos y la integración, Claude. Los informes de
> Codex están en `docs/revisiones/2026-10-11-codex-construccion-*.md`.
> **Falta la pasada de revisión de Codex** sobre el panel y el sembrador: el encargo está escrito
> y no se pudo lanzar porque su cuota se agotó. Lo que sigue está al final, en orden.

## Lo que pidió el usuario

El 11 de octubre, después de ver la demostración: que falta «todo el lado de dashboards, métricas,
gráficas, resúmenes, más paneles… por el lado administrativo», y que la aplicación se siente
sencilla para el tiempo que lleva.

Tenía razón en las dos cosas, y por dos causas distintas:

1. **No había ninguna pantalla que mirara más de un día.** El alcance que se había construido era
   el del núcleo de control (catálogo, entradas, salidas, existencia, correcciones, precios y el
   reporte de cierre); todo lo que es ver el negocio por semanas quedaba para después. Los datos sí
   estaban: cada cuenta, cada kilo, cada precio y quién hizo qué se guardan desde el primer día.
2. **La demostración estaba vacía:** dos personas, una jornada abierta sin precios y ninguna cuenta.
   Sobre eso, ni el panel mejor hecho enseña nada.

## Lo que se hizo

### El panel (`/panel`)

Lo ven quien dirige (responsable) y quien consulta. El mostrador, el patio y la administración
técnica no: es el dinero de todos los días. Una sola entrada en la barra, «Panel», con tres partes.

- **Resumen** — por 7 días, 30 días o 3 meses (trece semanas), siempre terminando hoy:
  - cuatro indicadores: compras, ventas, ventas menos compras y cuentas terminadas, cada uno con
    cuánto cambió respecto del periodo anterior del mismo largo;
  - compras y ventas por día (o por semana, a tres meses), en dinero o en kilos, con sus números
    en una tabla para quien los quiere exactos;
  - lo que más se movió, material por material; lo que hay en el patio ahora y lo que valdría
    volver a comprarlo con la última lista publicada; a qué hora se atiende; quién atendió;
  - «para vigilar»: lo dado de baja, lo que ajustaron conteos y correcciones, los precios
    especiales y las veces que se reabrió un día.
- **Días** — cada día que ha habido, con sus cuentas y lo que sumaron; al tocar uno, el mismo
  reporte de su cierre y sus cuentas una por una, cada una con su comprobante (sin reimprimir).
- **Bitácora** — quién hizo qué y cuándo, en palabras llanas («Luis cerró el día», «Servando
  aplicó un precio especial de $2.60 por kilo de Cartón a Don Chuy»), con búsqueda por persona y
  por día.

### Decisiones

1. **El panel no lleva cuentas propias.** Todo sale de los comprobantes y del libro de inventario,
   con la regla del cierre: una cuenta es del día en que se asentó (`confirmada_en_jornada`). Por
   eso cada día del panel dice lo mismo que su cierre, y hay una prueba que lo exige.
2. **Sin migración y sin tabla de resumen.** Son consultas sobre lo que ya hay; la especificación
   pide no precalcular nada hasta medir que hace falta. Si con un año de datos el panel tarda, lo
   primero es un índice en `operacion (confirmada_en_jornada)`.
3. **«Ventas menos compras» no es la ganancia, y la pantalla lo dice.** La ganancia pide saber
   cuánto costó lo que se vendió (costo promedio), que es de la etapa «resultado y caja». Lo mismo
   el valor del inventario: es lo que costaría volver a comprarlo hoy, no lo que costó.
4. **Las gráficas son cajas dibujadas con CSS, sin ninguna biblioteca.** Toman los colores de la
   interfaz (se leen en claro, oscuro y con más contraste), no agregan dependencias y cumplen las
   medidas de patio. Un dibujo no se le lee a quien no ve: van ocultas para el lector de pantalla,
   con sus números al lado.
5. **La bitácora nunca enseña el detalle crudo.** Cada clase de asiento tiene su frase, hecha con
   los campos que se eligieron a propósito; una clase desconocida cae en una frase genérica sin
   detalle. Una prueba lee las migraciones y falla si alguien anota una acción nueva sin frase.
6. **Lo que hizo «nadie» lo hizo quien administra.** Un asiento sin persona viene de la consola o
   de publicar una versión; la pantalla dice «Quien administra».

### El sembrador de la demostración (`consola/demo.ts`)

Le da a una base de desarrollo ocho semanas de historia verosímil —días abiertos y cerrados,
precios que se mueven, compras, ventas— por las funciones de verdad del sistema, y deja hoy
abierto y con precios. Como la base sella todo con la hora real y no admite cambios, hace cada
cosa «ahora» y enseguida recorre sus marcas de tiempo al día y la hora que le tocan, como dueño
de la base y con los disparadores apagados solo dentro de esa transacción.

Son **datos inventados para demostrar**, y se niega a correr fuera de desarrollo o sobre una base
que ya tiene movimiento. Los precios que pone no son los del negocio. Para que no se confundan con
datos de verdad, cada cuenta sembrada lleva el nombre «Demostración», y los clientes con precio
especial, «(demostración)».

No borra nada: usa a las personas que haya y agrega las que falten (otra de mostrador, una de
patio, una de consulta y un responsable más, que es quien «autoriza» los conteos y los precios
especiales inventados, porque las claves que ya existen no se conocen ni se cambian). Las claves
de las personas nuevas salen una sola vez, por la salida de la consola.

El 11 de octubre se corrió en la demostración del usuario: 48 días cerrados y 1,617 cuentas, en 16
segundos. Antes se guardó una copia de su base (`demo-antes-de-sembrar.dump`, que no va al
repositorio); con ella se vuelve a como estaba.

## Dónde está

| Qué | Dónde |
|---|---|
| El resumen | `src/servidor/dominio/panel.ts`, `src/app/api/panel/`, `src/app/panel/page.tsx`, `src/componentes/panel/` |
| Los días | `src/servidor/dominio/historial.ts`, `src/app/api/historial/`, `src/app/panel/dias/page.tsx` |
| El reporte de un día, compartido con el cierre | `src/componentes/cierre/Reporte.tsx` |
| La bitácora | `src/servidor/dominio/bitacora.ts`, `src/app/api/bitacora/`, `src/app/panel/bitacora/page.tsx` |
| El estilo | `src/estilo/panel.css` |
| Las pruebas | `pruebas/37-panel`, `38-historial`, `39-bitacora`, `40-demo`; `recorrido/panel.spec.ts` |

## Verificado

El 11 de octubre de 2026, con todo lo de arriba ya integrado:

- tipos y **901 pruebas** (eran 865; las 36 nuevas son 14 del panel, 7 del historial, 8 de la
  bitácora y 7 del sembrador), sin fallas;
- **195 recorridos en Chromium** y **188 en WebKit** (eran 187 y 180; los 8 nuevos son los del
  panel, con las medidas de patio en tres tamaños), sin fallas.

Después de esas corridas completas se retocaron tres cosas —los precios y el saldo inicial que pone
el sembrador, y que el panel escriba los kilos sin gramos de cien para arriba—; se volvieron a
correr los tipos, las 7 pruebas del sembrador y los 8 recorridos del panel en los dos navegadores,
en verde. **No se repitieron los dos simulacros** (operación y publicación): nada de esto toca los
guiones de operación, pero el de operación sí recorre pantallas y no se comprobó con la barra de
seis enlaces.

Lo que las corridas atraparon antes de darlo por bueno:

- **La hoja de estilo del panel rompía el comprobante impreso.** Tenía clases de nombre corto y
  suelto (`.b`, `.compra`), y el comprobante usa `.b` para la negrita: sus renglones quedaban de
  26 px de ancho. Lo cazó la guardia del papel (siete recorridos en rojo). Ahora los nombres llevan
  su lugar por delante (`.barrita.compra`, `.tira .compra`).
- **Una respuesta atrasada se quedaba a la vista.** Al cambiar de periodo dos veces seguidas, si la
  primera respuesta llegaba después, se pintaba bajo el botón del otro periodo. Igual en la
  bitácora, al buscar, y en los días, al pasar de uno a otro. Cada pantalla descarta ahora lo que
  no es de su última petición; hay recorrido para el resumen y para la bitácora.
- Dos recorridos viejos esperaban la barra de antes (cinco enlaces; quien consulta sin «Panel»):
  se actualizaron, porque el cambio es a propósito.

## Lo que sigue, en orden

Primero lo que se ve —el usuario pidió paneles y gráficas—, después lo que hoy se hace por consola.
El orden es una propuesta: lo decide el usuario.

1. **Historia de precios:** cómo se ha movido el precio de compra y de venta de cada material, en
   una gráfica. Los datos ya están (una lista por día).
2. **Clientes:** la lista, lo que se le ha comprado y vendido a cada uno y sus precios especiales.
3. **Sacar los reportes:** imprimir el resumen y el día, y bajarlos como archivo para Excel.
4. **Personas y equipos desde la pantalla.** Hoy se dan de alta y de baja por la consola. Es lo
   que le toca al rol de administración, que todavía no tiene pantalla propia.
5. **Catálogo desde la pantalla:** agregar un material, cambiarle el nombre, darlo de baja.
6. **Resultado y caja** (etapa posterior de la especificación): conteo del cajón y corte, gastos,
   costo promedio y, con eso, la ganancia de verdad. Es lo único de esta lista que cambia el modelo
   de datos, y pide decisiones del negocio.

## Lo que no se hizo

- Elegir un periodo cualquiera (de tal día a tal día): hay tres, y todos terminan hoy.
- Comparar contra el mismo periodo del año pasado.
- **La revisión de Codex** sobre el servidor del panel, las tres pantallas y el sembrador. Va una
  sola pasada; el encargo ya está escrito.
- La prueba de las mermas, los conteos y los precios especiales del sembrador (C.8) no se vio
  fallar antes de tener el código: Codex dejó las dos cosas a medias y se repararon juntas.
