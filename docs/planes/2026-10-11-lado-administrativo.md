# El lado administrativo: panel, días y bitácora

> **Estado (13 de octubre de 2026):** hechas ocho partes del panel —el resumen con sus
> gráficas, los días que ha habido, los materiales (qué se está quedando en el patio y la ficha de
> cada uno, desde el 13 de octubre), la historia de precios, los clientes, la bitácora, sacar
> reportes (archivos para Excel e imprimir) y los ajustes (personas, equipos, materiales y, desde
> el 13 de octubre, clientes desde la pantalla)— y el sembrador de la demostración. El resumen
> creció ese mismo día: la cuenta promedio, el día de la semana, lo que hizo cada persona, los
> kilos descontados y un periodo que se elige de tal día a tal día.
> Se construye repartido con Codex (`gpt-6-astra`, esfuerzo alto): él escribe el servidor de cada
> parte en su copia, con las pruebas primero, y aquí se lee, se integra y se le pone la pantalla y
> su recorrido. Suyos son el historial, la bitácora, la historia de precios, los clientes, exportar
> y el catálogo de materiales (migración 0030); personas y equipos (migración 0031), por ser lo
> delicado, se escribió aquí y él lo revisó. Sus informes están en `docs/revisiones/`.
> Lo único que queda de la lista es **caja y ganancia**, que espera las respuestas del negocio:
> las preguntas están en `2026-10-12-caja-y-ganancia-preguntas.md`.

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
técnica no: es el dinero de todos los días. Una sola entrada en la barra, «Panel», con sus partes.

- **Resumen** — por 7 días, 30 días o 3 meses (trece semanas), terminando hoy, o —desde el 13
  de octubre— por «otro periodo», de tal día a tal día, hasta un año:
  - cuatro indicadores: compras, ventas, ventas menos compras y cuentas terminadas, cada uno con
    cuánto cambió respecto del periodo anterior del mismo largo; y en compras y en ventas, lo que
    promedia una cuenta, en pesos y en kilos;
  - compras y ventas por día (por semana cuando el periodo pasa de un mes, y de cuatro en cuatro
    semanas cuando pasa de siete meses), en dinero o en kilos, con sus números en una tabla para
    quien los quiere exactos;
  - lo que más se movió, material por material; lo que hay en el patio ahora y lo que valdría
    volver a comprarlo con la última lista publicada; a qué hora se atiende y qué día de la
    semana es el fuerte;
  - quién atendió: de cada persona, sus cuentas, lo que pagó y cobró, los kilos que pesó, y lo
    que conviene vigilar —lo que descontó, las cuentas que descartó, lo que corrigió y lo que
    reimprimió—;
  - «para vigilar»: lo dado de baja, lo que ajustaron conteos y correcciones, los precios
    especiales, los kilos descontados en el mostrador (en compras, en ventas y de qué materiales)
    y las veces que se reabrió un día.
- **Días** — cada día que ha habido, con sus cuentas y lo que sumaron; al tocar uno, el mismo
  reporte de su cierre y sus cuentas una por una, cada una con su comprobante (sin reimprimir).
- **Materiales** (13 de octubre) — lo que el resto del panel no decía: cómo va cada material.
  - La lista: de cada material que alguna vez se ha movido, cuánto hay, cuánto lleva sin salir y
    para cuántos días alcanza al ritmo de las últimas cuatro semanas. Lo que lleva treinta días o
    más sin salir va aparte, arriba: «se está quedando». Cuatro indicadores: lo que vale lo que
    hay, cuántos materiales tienen existencia, cuántos se están quedando (y lo que valen) y el
    que más lleva.
  - La ficha de un material, por 30 días o por 3 meses: lo que se pagó y lo que se cobró por
    kilo en promedio, y su diferencia; lo que entró y lo que salió, por día o por semana, con sus
    números; su precio de lista encima de sus kilos, de compra o de venta, para ver si entra más
    cuando se paga más; lo que ha habido en el patio al terminar cada día; y lo que se le perdió,
    se le ajustó, se le descontó o se separó.
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

- **Ajustes** (12 de octubre; solo responsables) — lo que antes era de la consola o de una
  migración:
  - **Personas:** el responsable facultado para autorizar, con su clave otra vez, da de alta a
    alguien de mostrador, de patio o de consulta —el sistema le sortea la clave y la enseña una
    sola vez—, le cambia la clave y lo da de baja. Los responsables y quien administra se ven, pero
    no se tocan desde aquí.
  - **Equipos:** pide el código para dar de alta un equipo nuevo (se ve una vez, sirve una vez,
    vence en quince minutos) y da de baja el que ya no se usa; no el equipo desde el que se pide.
  - **Materiales:** cualquier responsable da de alta un material, lo da de baja (si no hay nada de
    él en el patio ni está en una cuenta abierta), lo reactiva y lo marca o no como frecuente. El
    nombre no se cambia.
  - **Clientes** (13 de octubre): cualquier responsable da de alta a un cliente sin esperar a darle
    su primer precio especial en el mostrador, lo da de baja y lo reactiva. Dado de baja ya no se
    ofrece en el mostrador; lo que se le compró y vendió se conserva. El nombre se cambia solo por
    la consola.

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

13. **Personas y equipos desde la pantalla: un punto medio, decidido por el dueño el 12 de octubre.**
    La especificación (10.4 y su tabla de decisiones) dejaba esto solo a la consola, con otras
    credenciales: «la aplicación no puede hacerlo». La razón era que quien se meta a la aplicación
    no pueda fabricarse un jefe. Lo que cambió: la aplicación puede dar de alta, dar de baja y
    cambiarle la clave a personas de mostrador, de patio y de consulta, y dar de alta y de baja
    equipos, **solo** a pedido de un responsable facultado para autorizar que teclea su clave en
    ese momento. Lo que no cambió: ninguna función que la aplicación pueda llamar crea a un
    responsable ni a quien administra, les cambia la clave, los da de baja, ni concede la facultad
    de autorizar. Con una sesión y una clave robadas se puede contratar o despedir a un cajero; no
    nombrar a quien autoriza. **La especificación todavía dice lo de antes** (línea de «Administración»
    en su tabla de decisiones): es un documento del usuario y no se tocó.
14. **La clave de una persona la sortea el sistema, y se ve una sola vez.** Cuatro dígitos, de los
    que la base no rechaza por adivinables. Quien da de alta no la elige: así no hay claves repetidas
    ni «la de siempre». Si la respuesta se pierde en el camino, la persona queda dada de alta y nadie
    vio su clave: se resuelve cambiándosela.
15. **A un material no se le cambia el nombre, decidido por el dueño el 12 de octubre.** El
    comprobante se rearma del libro y toma el nombre de hoy: renombrar cambiaría lo que dicen los
    comprobantes viejos. Para otro nombre se da de baja uno y se da de alta otro. Ni la función ni
    la aplicación pueden: no hay forma de pedirlo.
16. **Las reglas del catálogo viven en la base**, como todo lo que escribe: quién, que el nombre no
    se repita ni con otras mayúsculas, y que no se dé de baja lo que todavía hay en el patio o está
    en una cuenta abierta. La aplicación sigue sin poder escribir directo en la tabla.
17. **Los clientes, desde la pantalla y sin clave otra vez; lo pidió el dueño el 13 de octubre.**
    Hasta entonces un cliente solo nacía en el mostrador, al darle su primer precio especial, y
    darlo de baja o reactivarlo era de la consola. Ahora lo hace cualquier responsable en los
    ajustes (migración 0033), y queda en la bitácora a su nombre. No pide teclear la clave, igual
    que los materiales: tener a un cliente en la lista no le da nada, porque cada precio especial
    sigue pidiendo la clave de quien autoriza. La baja no toca lo ya dado: una cuenta abierta que
    ya lleva precio especial para ese cliente —autorizado cuando estaba activo— se cobra como
    está; lo que la baja impide es darle otro. Y no se borra a nadie: «borrar» es dar de baja,
    porque los comprobantes y el registro de precios lo nombran. Cambiarle el nombre se quedó en
    la consola: nadie lo pidió para la pantalla (se pidió después: decisión 25).
18. **Un nombre de cliente, una sola manera de escribirlo** (migraciones 0033 y 0034). Con dos
    puertas para dar de alta a un cliente hacía falta una sola regla, en la base, para los ajustes,
    el mostrador y la consola: se quita lo que no se ve, todo blanco es un espacio, y la misma
    letra escrita de dos maneras queda de una. Así lo que se ve igual es el mismo cliente, y lo
    que no se ve no es un nombre. «Jose» y «José» siguen siendo dos. No se juntan las letras de
    otro alfabeto que se dibujan igual ni las formas de compatibilidad: está dicho, con su porqué,
    al principio de la 0034.
19. **Qué es «salir» y qué es «quedarse»** (13 de octubre). Un material sale cuando se vende o
    cuando se separa en otros materiales; lo que se da de baja no cuenta, porque no es movimiento
    del negocio. Lo que nunca ha salido cuenta desde el día en que llegó: así algo que entró ayer
    no aparece como quedado. «Se está quedando» es llevar treinta días o más sin salir teniendo
    existencia, y «alcanza para» es lo que hay entre lo que salió en las últimas cuatro semanas.
    Los dos números —30 y 28— están al principio de `materiales-del-panel.ts`.
20. **El precio por kilo de la ficha es lo pagado entre los kilos pesados**, no entre los kilos
    pagados: un descuento baja lo que costó cada kilo que entró al patio. La diferencia entre lo
    cobrado y lo pagado por kilo **no es la ganancia**, y la pantalla lo dice: lo que se vendió
    pudo comprarse antes, a otro precio. La ganancia de verdad es de caja y ganancia.
21. **Lo que hay en el patio, día por día, sale del libro de inventario**, con el día de la
    jornada de cada movimiento (sin jornada, el día en que se asentó): la misma regla con que el
    resumen coloca las bajas y los ajustes.
22. **De cada persona, dos fuentes.** Lo que cobró —cuentas, dinero, kilos y kilos descontados—
    sale de las cuentas que terminó, con la regla del cierre; el descuento es de quien cobra,
    porque es quien lo decide. Lo que descartó, corrigió o reimprimió sale de la bitácora, en el
    día en que pasó cada cosa, porque no es de ninguna jornada. Por eso una persona que no cobró
    ninguna cuenta puede salir en la lista.
23. **El periodo que se elige** va de tal día a tal día, hasta un año y un día. Se compara con
    los mismos días de antes. Para que las columnas se lean en un teléfono nunca son más de
    treinta y una: día por día hasta un mes, por semana hasta unos siete meses y de cuatro en
    cuatro semanas más allá; el último tramo termina el último día aunque quede corto.
24. **La demostración trae descuentos y cuentas descartadas**, inventados como todo lo demás, y
    sorteados aparte para que no cambie qué se compra y se vende con cada semilla. Una
    demostración sembrada antes del 13 de octubre no los tiene: no se le agregan después.
25. **Cambiarle el nombre a un cliente, desde la pantalla** (13 de octubre, migración 0036). Era
    lo único de los clientes que seguía siendo solo de la consola; el dueño lo pidió. Lo hace
    cualquier responsable en los ajustes, y queda en la bitácora con cómo se llamaba y cómo se
    llama. No toca lo ya entregado: cada cuenta cobrada guarda el nombre que el cliente tenía ese
    día; una cuenta abierta que ya lleva su precio se cobra con el nombre de ahora. No puede
    quedar con el nombre de otro cliente, esté activo o dado de baja. A un material se le sigue
    sin poder cambiar el nombre: sus comprobantes sí toman el nombre de hoy.

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
| Los materiales del panel | `src/servidor/dominio/materiales-del-panel.ts`, `src/app/api/panel/materiales/` y `[material]/`, `src/app/panel/materiales/page.tsx` |
| Los días | `src/servidor/dominio/historial.ts`, `src/app/api/historial/`, `src/app/panel/dias/page.tsx` |
| El reporte de un día, compartido con el cierre | `src/componentes/cierre/Reporte.tsx` |
| La bitácora | `src/servidor/dominio/bitacora.ts`, `src/app/api/bitacora/`, `src/app/panel/bitacora/page.tsx` |
| La historia de precios | `src/servidor/dominio/historia-de-precios.ts`, `src/app/api/precios/historia/`, `src/app/panel/precios/page.tsx`; la gráfica, `Escalones` en `src/componentes/panel/Graficas.tsx` |
| El estilo | `src/estilo/panel.css` |
| Los clientes | `src/servidor/dominio/clientes.ts`, `src/app/api/clientes/resumen/` y `[cliente]/`, `src/app/panel/clientes/page.tsx` |
| Sacar reportes | `src/servidor/dominio/exportar.ts`, `src/app/api/exportar/`, `src/app/panel/reportes/page.tsx` |
| Imprimir | `src/componentes/panel/Imprimir.tsx`; `.imprimible`, al final de `src/estilo/panel.css` |
| Las dos carreras que cerró la revisión | `db/migraciones/0032_los_ajustes_sin_carreras.sql` |
| Personas y equipos | `db/migraciones/0031_personas_y_equipos_en_pantalla.sql`, `src/servidor/dominio/administracion.ts`, `src/servidor/clave.ts`, `src/app/api/administracion/` |
| Materiales | `db/migraciones/0030_catalogo_en_pantalla.sql`, `src/servidor/dominio/materiales.ts`, `src/app/api/materiales/` |
| Clientes desde los ajustes | `db/migraciones/0033_clientes_en_pantalla.sql`, `0034_nombres_de_cliente_sin_resquicios.sql` (la regla de los nombres) y `0036_el_nombre_de_un_cliente_en_pantalla.sql` (cambiarle el nombre); `altaDeCliente`, `cambiarCliente` y `cambiarNombreDeCliente` en `src/servidor/dominio/clientes.ts`; `POST` en `src/app/api/clientes/`, en `[cliente]/` y en `[cliente]/nombre/`; `src/componentes/ajustes/Clientes.tsx` |
| Los intentos de clave que no se deshacen | `db/migraciones/0035_intentos_que_no_se_deshacen.sql`; sus pruebas, en `pruebas/11-identidad` |
| La pantalla de ajustes | `src/app/panel/ajustes/page.tsx`, `src/componentes/ajustes/`, `src/estilo/ajustes.css` |
| Las pruebas | `pruebas/37-panel`, `38-historial`, `39-bitacora`, `40-demo`, `41-historia-de-precios`, `42-clientes`, `43-exportar`, `44-materiales`, `45-administracion`, `46-clientes-en-pantalla`, `47-materiales-del-panel`; `recorrido/panel.spec.ts`, `recorrido/ajustes.spec.ts` |

## Verificado

**El 13 de octubre de 2026, por la noche**, con las migraciones 0035 (los intentos de clave que no
se deshacen) y 0036 (el nombre de un cliente desde la pantalla) y el sello de los respaldos:

- tipos y **1052 pruebas** (eran 1022: 12 de los intentos en `11-identidad`, 8 del nombre del
  cliente en `46-clientes-en-pantalla`, 7 del sello y la llave en `23-respaldo`, 2 de las
  anotaciones del diario en `28-respaldo-diario` y 1 del tope de «alcanza para» en
  `47-materiales-del-panel`), sin fallas;
- **221 recorridos en Chromium** y **214 en WebKit** (eran 220 y 213; el nuevo es el del cambio de
  nombre, y las medidas de patio de los ajustes lo incluyen), sin fallas.

Las dos correcciones de seguridad se vieron fallar antes de corregirlas: cinco claves malas
deshechas, y la buena entraba; y un respaldo sustituido en el almacenamiento, con su manifiesto
rehecho, llegaba a `pg_restore`. **Codex las revisó en dos pasadas** (la primera se le cortó a la
mitad; la segunda terminó): encontró que los intentos todavía se podían probar sin contar con dos
conexiones en SERIALIZABLE —corregido: el intento se aparta antes de comparar— y, del sello, cinco
puntos que se atendieron (la llave leída como la lee `age`, las anotaciones del diario selladas,
decir de cuándo es el respaldo, y la llave pública y el sello saliendo juntos) y uno que era de su
copia. El detalle, hallazgo por hallazgo:
`docs/revisiones/2026-10-13-codex-revision-de-los-intentos-y-el-sello.md`. Lo corregido después de
su revisión no lo ha vuelto a ver. Se corrió completo dos veces: antes de su revisión (1045, 221 y
214) y después (1052, 221 y 214). **Los dos simulacros** (operación y publicación) pasaron dos
veces: sobre el guardado `c371cee`, antes de la revisión, y sobre `1bf5d1e`, con todo lo corregido.

**El 13 de octubre de 2026, por la tarde**, con los materiales en el panel y el resumen ampliado
(la cuenta promedio, el día de la semana, lo de cada persona, los kilos descontados y el periodo
que se elige), sin migración nueva:

- tipos y **1022 pruebas** (eran 999; las 23 nuevas son 16 de `47-materiales-del-panel` y 7 del
  resumen, en `37-panel`), sin fallas;
- **220 recorridos en Chromium** y **213 en WebKit** (eran 216 y 209; los 4 nuevos son la lista y
  la ficha de los materiales, lo que se está quedando, la ficha que llega tarde y el resumen de
  otro periodo), sin fallas. Las medidas de patio del panel ahora incluyen los materiales —con un
  material de cuarenta letras sin un espacio—, el resumen a treinta días y el resumen eligiendo
  de qué día a qué día.

Al medir salieron dos cosas que ya estaban y nadie había medido, y se corrigieron: el rótulo de
una columna ensanchaba la página en un teléfono cuando las columnas son treinta (pasaba en el
resumen a 30 días), y un nombre de material sin espacios ensanchaba la pantalla, hasta en
escritorio. La primera no se vio fallar en el resumen antes de corregirla: se vio en la ficha del
material, que usa la misma gráfica; la segunda sí se vio fallar. **Los simulacros no se
repitieron**: no cambiaron la base ni los guiones de operación.

**El 13 de octubre de 2026, por la mañana**, con los clientes en los ajustes y las migraciones 0033 y 0034 (una
sola regla para los nombres de cliente), y después de corregir lo que encontraron la revisión de
Codex y la de seguridad del guardado
(`docs/revisiones/2026-10-13-codex-revision-de-los-clientes-en-pantalla.md`):

- tipos y **999 pruebas** (eran 981; las 18 nuevas son las de `46-clientes-en-pantalla`), sin fallas;
- **216 recorridos en Chromium** y **209 en WebKit** (eran 214 y 207; los 2 nuevos son los de los
  clientes en los ajustes; las medidas de patio de los ajustes ahora incluyen a los clientes, con
  un nombre de ochenta letras sin espacios), sin fallas.

Se corrió tres veces completo: antes de corregir los nombres (993, 216 y 209), después de la
revisión de Codex (996, 216 y 209) y con la 0034 (999, 216 y 209). En la última, cuatro recorridos
de inventario fallaron en Chromium por tiempo —la máquina se durmió a media corrida—; repetidos
completos con la máquina despierta, pasaron los 216. **Los dos simulacros** (operación y
publicación) pasaron dos veces: sobre el guardado `1f6f489`, con la 0033, y sobre `fc8f228`, con
la 0034.

**El 12 de octubre de 2026, por la noche**, con los ajustes (personas, equipos y materiales) y las
tres migraciones nuevas (0030, 0031 y 0032) ya integrados, y después de corregir lo que encontraron
las dos revisiones:

- tipos y **981 pruebas** (eran 944; las 37 nuevas son 18 de los materiales, 18 de personas y
  equipos y una de estilo), sin fallas;
- **214 recorridos en Chromium** y **207 en WebKit** (eran 204 y 197; los 10 nuevos son los de los
  ajustes, con las medidas de patio en tres tamaños), sin fallas.

Se corrió dos veces completo esa noche: antes de las correcciones (978, 213 y 206) y después.
**Los dos simulacros** (operación y publicación) se repitieron al final, sobre el guardado
`3e4b09b`, ya con las tres migraciones nuevas, y pasaron los dos. (El de publicación hubo que
correrlo dos veces: la primera se quedó a medias porque Docker se cerró en la máquina; no fue una
falla del sistema.)

### El 12 de octubre, por la tarde

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
(«Del 14 de julio…» bajo el botón de 30 días) y con ella pasa. **Los dos simulacros** (operación y
publicación), que no se corrían desde antes del panel, se repitieron al final sobre el guardado
`9cfe434`, y pasaron los dos.

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

## Lo que sigue

De la lista que el usuario aprobó el 12 de octubre ya solo queda lo último:

- **Resultado y caja**: conteo del cajón y corte, entradas y salidas, gastos, costo promedio y, con
  eso, la ganancia de verdad. Cambia el modelo de datos y depende de cómo trabaja el negocio: las
  preguntas, con lo que se propone para cada una, están en
  `docs/planes/2026-10-12-caja-y-ganancia-preguntas.md`. Con las respuestas se escribe su plan.

Y lo que hay que cerrar antes del servidor de verdad (`2026-10-03-despliegue.md`):

- autenticar el respaldo antes de restaurarlo;
- ~~que los intentos de clave se cuenten aunque quien pregunta deshaga su transacción~~ —
  **hecho el 13 de octubre** (migración 0035): la cuenta vive además en una secuencia por
  persona, que no es de la transacción. El porqué y lo que no cambia están al principio de la
  migración y en `docs/revisiones/2026-10-12-codex-revision-de-personas-y-equipos.md`, punto 2;
- la guía de operación, y probar las pantallas en los equipos del patio.

## Lo que no se hizo

- En la ficha de un material no se elige el periodo de tal día a tal día: hay dos, y terminan
  hoy. En el resumen y en los reportes sí se elige.
- Los mejores proveedores: el sistema solo guarda el nombre de quien tiene precio especial.
- La ganancia y el margen de verdad: son de caja y ganancia.
- Comparar contra el mismo periodo del año pasado.
- Llevar a todos los clientes, no solo a los de precio especial (decisión 10).
- Anotar en la bitácora quién bajó qué archivo.
- En papel sale lo que está a la vista: una lista que en pantalla enseña seis renglones y deja
  pedir los demás, se imprime con los que tenga abiertos.
- La prueba de las mermas, los conteos y los precios especiales del sembrador (C.8) no se vio
  fallar antes de tener el código: Codex dejó las dos cosas a medias y se repararon juntas.
