# El lado administrativo: panel, días y bitácora

> **Estado (12 de octubre de 2026):** hechas seis partes del panel —el resumen con sus gráficas, los
> días que ha habido, la historia de precios, los clientes, la bitácora y sacar reportes (archivos
> para Excel e imprimir)— y el sembrador de la demostración.
> Se construye repartido con Codex (`gpt-6-astra`, esfuerzo alto): él escribe el servidor de cada
> parte en su copia, con las pruebas primero, y aquí se lee, se integra y se le pone la pantalla y
> su recorrido. Suyos son el historial, la bitácora, la historia de precios, los clientes y exportar;
> el sembrador lo empezó y se le acabó la cuota a medias. Sus informes están en
> `docs/revisiones/*-codex-construccion-*.md`.
> El usuario aprobó el 12 de octubre el orden de «Lo que sigue» y que se guarde en Git al cerrar
> cada cosa. La revisión de Codex sobre lo que no escribió él está en
> `docs/revisiones/2026-10-12-codex-revision-del-lado-administrativo.md`.

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
- **Precios** (12 de octubre) — la historia de precios, por 30 días, 3 meses o 1 año: cuántas listas
  se publicaron, qué materiales cambiaron, la compra que más subió y la que más bajó; cada material
  con una rayita de su precio de compra, lo que vale hoy y cuánto varió; y al tocarlo, su gráfica
  de escalones (compra y venta) y sus cambios uno por uno, con su flecha.
- **Clientes** (12 de octubre) — a quién se le da precio especial: cuántos hay, sus cuentas, y lo que
  sus precios movieron respecto de la lista, en compras y en ventas; cada cliente con lo que se le
  ha comprado y vendido; y al tocarlo, su ficha: sus precios especiales uno por uno (a cuánto, a
  cuánto estaba la lista, quién lo autorizó), los materiales y sus cuentas, cada una con su comprobante.
- **Bitácora** — quién hizo qué y cuándo, en palabras llanas («Luis cerró el día», «Servando
  aplicó un precio especial de $2.60 por kilo de Cartón a Don Chuy»), con búsqueda por persona y
  por día.

- **Reportes** (12 de octubre) — se elige de qué día a qué día (con cuatro atajos) y se baja como
  archivo para Excel: los días, las cuentas, los materiales de cada cuenta o los precios. Y el
  resumen, cada día, los precios y la ficha de un cliente llevan un botón «Imprimir», que saca en
  una hoja normal lo que se está viendo.

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
7. **La historia de precios sale de las listas publicadas y nada más.** Una lista abierta y sin
   publicar no existe para la historia; un día sin lista sigue valiendo lo último publicado, así
   que no es un cambio. La fecha de un precio es la de su jornada, no la hora en que se publicó.
8. **El precio se dibuja en escalones, y la escala no empieza en cero.** Un precio vale lo mismo
   hasta el día en que cambia: una línea inclinada entre dos días diría que fue subiendo, y no.
   Y un precio se mueve por centavos: desde cero no se vería. Por eso la gráfica escribe los dos
   extremos de su escala y lo dice abajo. Es un SVG a mano, sin biblioteca.
9. **Contra qué se compara un precio lo decide el servidor** (`base`, `variacion`, `veces`): lo
   que valía al empezar el periodo o, si entonces no tenía, el primero que tuvo. La pantalla no
   hace cuentas.

10. **Un cliente es alguien con precio especial, y la pantalla lo dice.** Una cuenta queda a nombre
    de un cliente solo mientras lleva precio especial (así lo guarda la base desde la migración
    0025); las demás traen, cuando mucho, un nombre escrito a mano. Por eso «Clientes» no es «todo
    lo que se le ha comprado a cada persona»: es lo que se le ha comprado y vendido con precio
    especial. Llevar a todos los clientes pide que el mostrador elija cliente en cada cuenta: es un
    cambio de flujo y de modelo, y es decisión del negocio.
11. **Los archivos son CSV, sin ninguna biblioteca.** Excel y Números los abren; llevan la marca
    que Excel pide para leer los acentos, y en las columnas con texto escrito por una persona (un
    nombre, una etiqueta) lo que empieza como fórmula sale con un apóstrofo por delante, para que
    no se ejecute. Hasta 366 días por archivo.
12. **Lo que va al papel es lo que se está viendo.** Imprimir no arma un reporte aparte: la misma
    pantalla sale sin la barra ni lo que se toca, en claro aunque esté en oscuro, y con sus barras
    pintadas. El comprobante tiene su propio papel y nunca está a la vista junto con el panel.

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
| La historia de precios | `src/servidor/dominio/historia-de-precios.ts`, `src/app/api/precios/historia/`, `src/app/panel/precios/page.tsx`; la gráfica, `Escalones` en `src/componentes/panel/Graficas.tsx` |
| El estilo | `src/estilo/panel.css` |
| Los clientes | `src/servidor/dominio/clientes.ts`, `src/app/api/clientes/resumen/` y `[cliente]/`, `src/app/panel/clientes/page.tsx` |
| Sacar reportes | `src/servidor/dominio/exportar.ts`, `src/app/api/exportar/`, `src/app/panel/reportes/page.tsx` |
| Imprimir | `src/componentes/panel/Imprimir.tsx`; `.imprimible`, al final de `src/estilo/panel.css` |
| Las pruebas | `pruebas/37-panel`, `38-historial`, `39-bitacora`, `40-demo`, `41-historia-de-precios`, `42-clientes`, `43-exportar`; `recorrido/panel.spec.ts` |

## Verificado

**El 12 de octubre de 2026**, con la historia de precios, los clientes, los reportes e imprimir ya
integrados:

- tipos y **944 pruebas** (eran 901; las 43 nuevas son 16 de la historia de precios, 12 de los
  clientes y 15 de exportar), sin fallas;
- **204 recorridos en Chromium** y **197 en WebKit** (eran 195 y 188; los 9 nuevos son los de
  precios, clientes, reportes, imprimir y los tres de la revisión de Codex; las medidas de patio,
  en tres tamaños, ahora recorren las seis partes del panel), sin fallas.

Se corrió dos veces completo: antes de la revisión de Codex (941, 201 y 194) y después de corregir
lo que encontró (los números de arriba).

El recorrido de la respuesta atrasada en precios se comprobó quitando la guardia: sin ella falla
(«Del 14 de julio…» bajo el botón de 30 días) y con ella pasa. **No se repitieron los dos
simulacros** (operación y publicación): nada de esto toca los guiones de operación, pero el de
operación sí recorre pantallas y no se ha comprobado con el panel.

Lo que encontró la revisión de Codex y lo que se hizo con ello está en
`docs/revisiones/2026-10-12-codex-revision-del-lado-administrativo.md`.

### El 11 de octubre

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

El usuario aprobó este orden el 12 de octubre. Lo primero —historia de precios, clientes y sacar
reportes— quedó hecho ese día. **Las dos que siguen se detuvieron antes de empezar, porque cada una
toca una decisión del diseño original que le toca al usuario**, y la tercera pide decisiones del
negocio:

1. **Personas y equipos desde la pantalla.** Hoy se dan de alta y de baja por la consola, y no por
   descuido: la especificación lo decidió así (10.4 y la tabla de decisiones: «Personas y equipos
   se dan de alta y de baja desde una consola con otras credenciales. La aplicación no puede
   hacerlo»). La razón es de seguridad: si alguien se mete a la aplicación, no puede fabricarse un
   responsable. Ponerlo en pantalla es cambiar esa decisión. Lo que se propone: desde la pantalla,
   solo el responsable que autoriza y con su clave otra vez, dar de alta y de baja a personas de
   mostrador, patio y consulta, cambiarles la clave, y dar de alta y de baja equipos; los
   responsables y la facultad de autorizar siguen siendo de la consola. Pide una migración.
2. **Catálogo desde la pantalla:** agregar un material, darlo de baja, reactivarlo, marcarlo como
   frecuente. El rol de la aplicación ya puede escribir en `material` y cada cambio queda en la
   bitácora (0011), pero sin ninguna regla en la base: habría que ponerlas ahí (quién, y que no se
   dé de baja lo que tiene existencia), como todo lo demás que escribe. **Cambiarle el nombre a un
   material es aparte**: el comprobante se rearma del libro y toma el nombre de hoy, así que
   renombrar «Fierro» a «Cobre» cambiaría lo que dicen los comprobantes viejos. Lo que se propone:
   que desde la pantalla no se renombre (se da de baja y se crea otro), o guardar el nombre en cada
   renglón al cobrar, como ya se hace con el cliente.
3. **Resultado y caja** (etapa posterior de la especificación): conteo del cajón y corte, gastos,
   costo promedio y, con eso, la ganancia de verdad. Es lo único de esta lista que cambia el modelo
   de datos, y pide decisiones del negocio.

## Lo que no se hizo

- Elegir un periodo cualquiera en el resumen (de tal día a tal día): hay tres, y todos terminan
  hoy. En los reportes sí se elige.
- Comparar contra el mismo periodo del año pasado.
- Llevar a todos los clientes, no solo a los de precio especial (decisión 10).
- Anotar en la bitácora quién bajó qué archivo.
- En papel sale lo que está a la vista: una lista que en pantalla enseña seis renglones y deja
  pedir los demás, se imprime con los que tenga abiertos.
- La prueba de las mermas, los conteos y los precios especiales del sembrador (C.8) no se vio
  fallar antes de tener el código: Codex dejó las dos cosas a medias y se repararon juntas.
