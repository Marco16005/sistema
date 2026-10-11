# Diseño: clientes con precio especial

> **Estado:** diseño aprobado por el usuario el 4 de octubre de 2026 (con sus tres respuestas).
> Codex revisó la primera versión del plan y pidió cambios antes de codificar
> (`docs/revisiones/2026-10-04-codex-cuarta-revision.md`, parte A.1: un bloqueante, cinco
> importantes, uno menor). La versión 2 los incorporó; su quinta revisión
> (`docs/revisiones/2026-10-04-codex-quinta-revision.md`, parte A) dio por resuelto el bloqueante
> y pidió precisar tres contratos (versión 3). Su sexta revisión
> (`docs/revisiones/2026-10-04-codex-sexta-revision.md`, parte A) dio por resueltos dos y halló
> un hueco en el tercero: al quitar, la cadena de eventos se rompía. **Esta es la versión 4, que
> lo cierra**, y Codex la dio por codificable al cierre de esa misma sexta revisión («precio
> especial v4 sobrevenida… codificable»). **Hechas la tarea 1 (la base) y la 2 (el servidor), y
> revisadas por Codex en su décima pasada (parte A), que las dio por cerradas el 9 de octubre**
> después de dos correcciones (migración 0027; `docs/revisiones/2026-10-07-respuesta-a-la-decima-revision.md`).
> **La tarea 3 (la pantalla) se hizo el 10 de octubre; falta que Codex la revise.**
>
> **Para quien lo ejecute:** tarea por tarea, con la prueba primero. Codex (`gpt-6-astra`, esfuerzo
> alto) revisa este plan antes de codificar y cada tarea al cerrarla.

## Lo que pidió el negocio

Poder darle a ciertos clientes un precio distinto del de la lista del día, y que quede registro de
a quiénes se les da. Lo que contestó a las preguntas:

- Es **al comprar y al vender**.
- Es **una diferencia respecto del precio del día**, no un precio fijo.
- **Se decide en el momento**: depende del volumen, del cliente y de otros factores, así que no se
  deja apuntado de antemano.
- Lo deciden **los dueños y gente de alto rango**.
- Son pocos clientes: del orden de quince, sin certeza.

## Lo que hay hoy

- No hay registro de clientes. Una cuenta es anónima, con una etiqueta libre opcional.
- El precio de cada renglón es el de la lista publicada del día, tomado al agregar el material
  (`operacion_linea.precio_unitario`). El importe se calcula de ahí.
- La especificación dejó el «precio pactado» para después, junto con el crédito (apartado 10 y
  tabla de lo que queda fuera). Esto lo adelanta, sin el crédito.
- Ya existe autorizar algo con la clave de otra persona en el momento (conteo y corrección de
  inventario): quien autoriza es un responsable con permiso de autorizar, teclea su clave en el
  equipo del mostrador, y la clave no se guarda en ningún lado.

## Qué se propone

**1. Un registro de clientes, chico.** Nombre y nada más por ahora. Un cliente nuevo se da de alta
en el mismo acto en que se le da su primer precio especial, es decir, **con la autorización de un
responsable**: así la lista no se llena de nombres repetidos o inventados.

**2. El precio especial se da por renglón, dentro de una cuenta abierta.** En el paso «Cuenta», cada
material tiene «Precio especial». Ahí se elige al cliente (de la lista, o uno nuevo), se teclea la
**diferencia por kilo** —más o menos— y la pantalla enseña cómo queda: «Lista $2.10 → queda $2.60
por kilo». Es por renglón y no por cuenta porque el precio por kilo es de cada material.

**3. Lo autoriza un responsable con su clave, en ese momento**, igual que una corrección de
inventario. Sin autorización no hay precio especial.

**4. La cuenta queda a nombre de ese cliente.** Un cliente por cuenta.

**5. Queda registro, y no se borra:** a quién, qué material, el precio de lista, la diferencia, el
precio que quedó, quién lo capturó y quién lo autorizó. Si se cambia de nuevo, el registro anterior
se conserva.

**6. Quitarlo es volver al precio de lista**, y no pide autorización: es el precio normal. También
queda anotado.

**7. El comprobante** muestra el precio que se aplicó y el nombre del cliente. No dice «precio
especial» ni compara con la lista: eso es del negocio, no del cliente.

**8. En el cierre del día** aparece la lista de precios especiales dados: cliente, material, kilos,
diferencia, cuánto dinero significó y quién autorizó, con su total. Para que los dueños vean, al
final del día, qué se dio y a quién.

## Reglas

- Solo sobre una cuenta abierta. Una vez pagada, el precio ya no cambia (corregir dinero sigue
  fuera del sistema, como hoy).
- El precio que queda tiene que ser mayor que cero, y con las mismas reglas que cualquier precio
  (hasta cuatro decimales, tope de 99 999.9999).
- La diferencia puede ser hacia arriba o hacia abajo, en compra y en venta.
- Autoriza quien tenga permiso de autorizar y esté activo; si falla la clave varias veces, se
  bloquea como en las demás autorizaciones.
- Cambiar el precio de un renglón cambia la cuenta: quien esté por cobrarla con el total viejo
  recibe el aviso de que cambió, como con cualquier otro cambio.
- Es una acción que escribe, así que sigue la regla del envío pendiente: se guarda antes de
  mandarse, no se edita mientras no se sepa qué pasó, y un envío del que no se supo se resuelve en
  el servidor.

## Lo que queda fuera, a propósito

- **Un precio especial fijo por cliente** que se aplique solo. El negocio dijo que se decide en el
  momento. Si después quieren que el sistema recuerde «a este cliente, cartón +0.50», se agrega.
- **Elegir un cliente en una cuenta sin darle precio especial.**
- **Dar de alta, renombrar o dar de baja clientes desde la pantalla.** Se hará por la consola, como
  hoy las personas. El alta sí ocurre en la pantalla, al dar el primer precio especial.
- Crédito, anticipos, precio por volumen automático, historial por cliente.

## Tamaño

Parecido a la corrección de inventario: una migración (clientes, registro de precios especiales, la
función que los da y la que los quita), dos rutas, una pieza de pantalla dentro de la cuenta, el
comprobante, el cierre, la consola, y sus pruebas —reglas, permisos, los cruces con cobrar la cuenta
al mismo tiempo, y los recorridos de las transiciones (respuesta que tarda, que se pierde, recarga,
dos pestañas, clave equivocada).

## Lo que decidió el usuario (4 de octubre)

1. **El comprobante no dice «precio especial».** Muestra el precio que se aplicó. El nombre del
   cliente aparece **solo en las cuentas donde hubo precio especial**; las demás siguen siendo
   anónimas, como hoy.
2. **Autoriza cualquiera con permiso de autorizar**, que hoy son los dueños.
3. **Sin tope a la diferencia.** Queda al criterio de quien autoriza, y queda el registro.

---

# Plan de implementación

**Objetivo:** que en una cuenta abierta se le pueda dar a un cliente registrado un precio distinto
del de lista en un material, con la clave de un dueño, y que al final del día se vea qué se dio y
a quién.

**Cómo encaja:** como todo lo demás: la regla vive en la base (una función por acción, con el
usuario de la aplicación sin permiso de tocar las tablas), la ruta solo traduce, y la pantalla
sigue la regla del envío pendiente. Se parece a dos cosas que ya existen y se copia de ellas: el
descuento en kilos de un renglón (`poner_descuento`) y la corrección de inventario con clave
(`corregir_movimiento`, `autorizo_con_clave`, `reservar_envio`).

## Decisiones

1. **El renglón guarda los dos precios, y los dos están protegidos.** `operacion_linea` gana
   `precio_lista` (el del día, fijado al nacer el renglón y **que ya no cambia**; a los renglones
   que ya existen se les rellena con su precio actual) y `precio_autorizado_por` (quién autorizó
   el precio especial que está vigente; vacío si no hay ninguno). `precio_unitario` sigue siendo
   el que se cobra.
   **El renglón guarda además `precio_evento`: el último evento de precio que tuvo, sea de dar o
   de quitar.** Está vacío solo si nunca tuvo ninguno. Que haya precio especial vigente se sabe
   por la clase de ese último evento: lo hay si fue «dar». (La versión 3 lo vaciaba al quitar, y
   eso rompía todo: el evento de quitar quedaba suelto, y un renglón al que se le dio y se le
   quitó no se distinguía de uno que nunca tuvo —una petición vieja que vio «ninguno» volvía a
   valer—.)
   Hoy el guardián de los renglones (`linea_cambia`) prohíbe cambiar el precio: **sigue
   prohibido, salvo por una transición exacta y de un solo uso**, que comprueba el propio
   guardián. Precio, autorizante vigente y evento cambian juntos o no cambian, y solo si el
   evento nuevo: se escribió en esta transacción; es de este renglón y de esta cuenta; **nombra
   como anterior al evento que el renglón tenía** (o a ninguno, si nunca tuvo); y su precio
   anterior es el que el renglón tenía y su precio nuevo el que queda. Además:
   - si el evento es **dar**, el autorizante y el cliente que quedan vigentes son los del evento;
   - si es **quitar**, el anterior tiene que ser un «dar», el precio que queda es el de lista y
     el autorizante vigente queda vacío. El evento de quitar conserva, como historia, quién
     había autorizado y a qué cliente: eso no es «lo que queda», es lo que se deshizo.
   Como cada evento nombra a su anterior y el renglón siempre apunta al último, la cadena es
   una sola y no se repite: un evento viejo no se puede volver a instalar (dar P1 → dar P2 →
   poner P1 a mano; o dar P1 → quitar → poner P1 a mano: en los dos casos el evento de P1 no
   nombra al que el renglón tiene). Tampoco se puede cambiar solo quién autorizó, ni solo el
   evento, sin tocar el precio.
   **Y al revés:** un evento no puede quedar suelto. Al terminar la transacción, todo evento
   escrito en ella tiene que **alcanzarse desde el último evento de su renglón**, siguiendo los
   anteriores —no basta con que algún otro evento lo cite—, o su renglón ya no existir. No hay
   bandera que alguien pueda poner por fuera. El importe no cambia de fórmula, y la revisión de
   la cuenta sube en cada transición, como con cualquier cambio.
2. **`cliente`**: identificador, nombre, activo, quién lo dio de alta y cuándo. El nombre se guarda
   como se tecleó, sin espacios de más, y es único sin distinguir mayúsculas. Los acentos sí
   distinguen («Jose» y «José» son dos): se arregla renombrando. Si el nombre tecleado es el de un
   cliente dado de baja, se rechaza diciéndolo (se reactiva por la consola): no se crea otro igual.
3. **`operacion.cliente_id`**, vacío salvo cuando algún renglón de la cuenta tiene precio especial
   vigente. Lo mantiene la base, **en la misma transacción** que el cambio que lo causa: se pone al
   dar el primero y se quita cuando ya no queda ninguno, también si lo que se quita es el material.
   Un cliente por cuenta. En una operación ya pagada es un campo protegido, como los demás.
   **«Hubo precio especial» quiere decir «lo hay al cobrar»:** dar, quitar y cobrar deja un
   comprobante anónimo. Al cobrar se guarda también el **nombre del cliente como estaba**, para
   que renombrarlo después no cambie los comprobantes ya entregados.
4. **`precio_especial`** es el registro de eventos, y no se edita ni se borra (tampoco se vacía).
   Cada evento: cuenta, renglón, material, cliente y su nombre en ese momento, precio de lista,
   precio anterior, precio nuevo, quién capturó, quién autorizó, cuándo, y qué clase de evento es
   (dar o quitar). Cuenta y renglón se guardan como datos, no como vínculos, porque una cuenta
   descartada se borra y su historia debe quedar; material, cliente y personas sí son vínculos.
   **Quitar no finge una autorización nueva:** apunta al evento que deshace.
5. **Las dos acciones llevan identificador de envío y dicen qué precio vieron.** `dar_precio_especial`
   y `quitar_precio_especial` reciben el envío y **el último evento de precio que la pantalla
   tenía a la vista para ese renglón** —de dar o de quitar—, o ninguno si nunca tuvo. Si el
   renglón ya tiene otro, la petición llegó tarde y se rechaza: así una petición atrasada —de
   otra pestaña, o un reintento— no quita ni pisa un precio que no vio. «Ninguno» solo vale
   para un renglón que nunca tuvo evento: después de dar y quitar, ya no.
   Repetir un envío devuelve **su evento original**, exista o no todavía el renglón: el resultado
   del envío apunta al evento, no se reconstruye del renglón. **Quitar no pide clave**: no hay
   autorización nueva que dar, y lo puede hacer quien atiende la cuenta.
6. **El orden, que es el de la corrección de inventario** (`0017`): si el envío ya existe, **se
   valida primero todo su contenido** y, si coincide, devuelve lo que dejó, sin pedir otra vez la
   clave ni exigir que quien autorizó siga activo ni que el renglón exista; **solo al dar**,
   comprueba la clave —una clave mala **no lanza error**: devuelve «rechazada», para que el
   intento fallido quede contado, y la ruta lo traduce—; reserva el envío (si otro lo reservó a
   la vez, relee su resultado); toma los candados; valida; escribe.
   **El contenido del envío** lleva: qué acción es (dar o quitar), cuenta, renglón, **el evento
   que se vio** (o que no se vio ninguno), y —al dar— cliente, diferencia y quién autoriza, todo
   ya normalizado; nunca la clave. El mismo identificador con otro evento visto es otro
   contenido, y se rechaza (`RC012`, que es lo que contesta `reservar_envio` desde la `0019`).
   Cambiar de autorizante pide resolver antes el envío anterior.
   **Los candados, en el orden que ya usan las demás** (`linea_nace`, `confirmar`, el movimiento
   de inventario): primero la cuenta, después el renglón, y **al final la jornada de hoy, en
   modo compartido**. Cerrar el día toma la jornada en exclusiva y no toma cuentas, así que no
   hay forma de cruzarse: o el cierre espera a que termine el precio, o el precio encuentra el
   día ya cerrado. (La versión 2 decía «primero la jornada»: al revés que las demás, y se podían
   trabar entre sí.)
7. **Hace falta jornada abierta hoy, y «hoy» se mira al final.** Dar o quitar un precio especial
   pide que haya jornada abierta hoy, sea de cuándo sea la cuenta. `jornada_abierta` no alcanza:
   devuelve la que esté abierta, sin mirar su fecha ni tomar candado. Por eso, **ya con los
   candados en la mano**, se relee la jornada y se compara su fecha con la de hoy según el reloj
   de verdad en la zona de la sucursal: si no está abierta o no es de hoy, se rechaza. Una
   petición que esperó hasta pasada la medianoche se rechaza. Un vehículo de ayer conserva su
   precio de lista de ayer —el del renglón—, y su precio especial se da hoy, con el día abierto.
8. **El cierre, con el dinero bien definido.** Lista los precios especiales vigentes en las
   operaciones **cobradas en la jornada** (la jornada en que se confirmó, no en la que nació la
   cuenta). De cada uno: cliente, material, kilos liquidables (ya con tara y descuento), precio de
   lista, precio aplicado, y la diferencia en dinero, que es **importe cobrado menos el importe que
   habría dado la lista, cada uno redondeado a centavos** (no «kilos por diferencia», que no
   siempre da lo mismo). Compras y ventas se suman por separado y con su sentido dicho: «se pagó
   de más / de menos» y «se cobró de menos / de más». El redondeo a pesos de la cuenta no se le
   atribuye a nadie. Los precios quitados y los de cuentas descartadas quedan en el registro, no
   en estos totales.
9. **La consola** lista, renombra, da de baja y reactiva clientes.

## Cómo queda en la base (lo que la tarea 1 construye)

Migración `0025_precio_especial.sql`. Los nombres exactos, para que las pruebas, el servidor y la
pantalla hablen de lo mismo:

- **`cliente`** (`id`, `nombre`, `activo`, `creado_por`, `creado_en`); único por `lower(nombre)`.
- **`precio_especial`**, inmutable: `id`, `clase` (`dar` | `quitar`), `operacion_id` y `linea_id`
  (datos, no vínculos), `material_id`, `cliente_id`, `cliente_nombre`, `precio_lista`,
  `precio_anterior`, `precio_nuevo`, `capturado_por`, `autorizado_por`, `anterior_id` (el evento
  anterior de ese renglón, o ninguno), `creado_en`, `transaccion`.
- **`operacion_linea`** gana `precio_lista`, `precio_autorizado_por` y `precio_evento`.
  **`operacion`** gana `cliente_id` y `cliente_nombre` (este, solo al cobrar).
- **`envio`** admite la clase `precio`; **`envio_resultado`** gana `precio_especial_id`.
- **`dar_precio_especial(p_envio, p_cuenta, p_linea, p_visto, p_cliente, p_cliente_nuevo,
  p_diferencia, p_autoriza, p_clave, p_huella, p_usuario)`** devuelve el evento; vacío si la
  clave no pasó. **`quitar_precio_especial(p_envio, p_cuenta, p_linea, p_visto, p_usuario)`**
  devuelve el evento. `p_visto` es el último evento de precio que la pantalla tenía de ese
  renglón, o nada.
- El contenido del envío: `accion`, `cuenta`, `linea`, `visto` y, al dar, `cliente`,
  `cliente_nuevo` (ya limpio), `diferencia` y `autoriza`. Nunca la clave.
- Códigos: `RC001` cuenta ya cobrada; `RC004` la diferencia o el precio que queda no valen;
  `RC005` lo demás que no procede (renglón de otra cuenta, cliente dado de baja, otro cliente en
  la cuenta, y lo que rechazan los guardianes); `RC006` no hay jornada abierta hoy; `RC008` quien
  autoriza no está facultado, o quien captura no es de mostrador ni responsable; `RC011` el
  renglón ya tiene otro evento que el que se vio; `RC012` el envío es de otro contenido o se canceló.
- **`precios_especiales_del_dia(p_jornada)`**: lo que lista el cierre.
- **`renombrar_cliente`, `baja_de_cliente`, `reactivar_cliente`**: para la consola.
- Guardianes: `linea_cambia` (la transición exacta y de un solo uso), `precio_especial_nace`
  (un evento solo nace bien formado para su renglón), `precio_especial_se_cumple` (al terminar
  la transacción, ningún evento queda suelto) y `cuenta_con_su_cliente` (al terminar, el cliente
  de la cuenta es el de sus precios especiales vigentes, uno solo, o ninguno).

## Archivos

```
db/migraciones/00NN_precio_especial.sql      tablas, columnas, las dos funciones, permisos (el número libre que siga; va después de la de reabrir el día)
src/servidor/esquema.ts                      la versión que la aplicación espera
src/servidor/dominio/precio-especial.ts      dar, quitar, lista de clientes
src/servidor/dominio/cuentas.ts              el renglón con sus dos precios; el cliente de la cuenta
src/servidor/dominio/comprobante.ts          el cliente, cuando lo hay
src/servidor/dominio/cierre.ts               los precios especiales del día
src/app/api/clientes/route.ts                GET
src/app/api/cuentas/[cuenta]/precio-especial/route.ts          POST
src/app/api/cuentas/[cuenta]/precio-especial/quitar/route.ts   POST
src/componentes/mostrador/PrecioEspecial.tsx el panel: cliente, diferencia, cómo queda, autorizar
src/componentes/mostrador/Mostrador.tsx      el botón en cada renglón, y cómo se ve un renglón con precio especial
src/componentes/mostrador/Ticket.tsx         el nombre del cliente
src/componentes/…/Cierre                     la lista del día
consola/acciones.ts, consola/principal.ts    cliente lista | renombrar | baja
pruebas/26-precio-especial.test.ts           las reglas, en la base
pruebas/08-permisos, 17-rutas, 22-restauracion (el retrato incluye clientes, los dos precios, el cliente de la cuenta, los eventos y los resultados de envío)
db: los guardianes de renglón y de operación (0005, 0007), el resultado y la cancelación de envíos (0017, 0018)
src/componentes/mostrador/tipos.ts            el renglón y la cuenta con lo nuevo
recorrido/precio-especial.spec.ts            la pantalla, y sus transiciones
```

## Tareas

### Tarea 1 · La base — hecha el 6 de octubre de 2026; revisada y cerrada por Codex el 9 de octubre

`db/migraciones/0025_precio_especial.sql` y `pruebas/26-precio-especial.test.ts` (36 pruebas).
Las pruebas se escribieron primero y fallaron las 34 de entonces por lo que debían —la función no
existía—; con la migración pasaron. Como pasaron a la primera, **se rompió la migración a
propósito, regla por regla: 23 mutaciones** (abajo).

- [x] **Las reglas:** solo en cuenta abierta y con jornada abierta hoy; el renglón es de esa
      cuenta; diferencia distinta de cero, con hasta cuatro decimales, hacia arriba y hacia abajo,
      en compra y en venta, **y siempre sobre el precio de lista** (no sobre el especial que
      hubiera); el precio que queda mayor que cero y dentro del tope; cliente existente o nuevo,
      no los dos ni ninguno; cliente dado de baja, no (ni por su nombre); un cliente por cuenta;
      quien autoriza tiene permiso y está activo; quien captura es de mostrador o responsable.
- [x] **Los guardianes**, como dueño de la base y sin apagar reglas: `precio_lista` no cambia
      nunca; `precio_unitario` no cambia por ningún otro camino; dar P1 → dar P2 → P1 a mano,
      rechazado; dar P1 → quitar → P1 a mano en la misma transacción, rechazado; cambiar solo
      quién autorizó, o solo el evento, rechazado; un evento suelto, rechazado al terminar la
      transacción —también junto a un precio de verdad en esa transacción—; uno que cita a otro
      suelto ni siquiera nace; dar → quitar → dar pasa y el renglón apunta al tercero; el cliente
      de una operación pagada no cambia, y su nombre guardado tampoco aunque se le renombre; el
      registro no se edita, no se borra ni se vacía.
- [x] **El dinero:** importe y total con su redondeo, con descuento en kilos, fracciones y dos
      renglones; al quitar, vuelven exactos a los de lista. En venta la existencia no cambia.
- [x] **El cliente de la cuenta** se pone con el primero y se quita con el último, también al
      quitar el material y al descartar la cuenta. Dar, quitar y cobrar deja una operación anónima.
- [x] **El envío, en las dos acciones:** repetido, su evento original —sin pedir la clave, con
      quien autorizó dada de baja, y después de quitar el material o descartar la cuenta—; con
      otro contenido, `RC012` —también si lo distinto es el evento visto, la acción o quien
      autoriza—; cancelado, `RC012`; la cancelación que le gana a una petición en camino. La
      clave mal no asienta nada, queda contada (a los cinco, bloqueo de verdad) y deja el envío
      sin gastar. Quitar no pide clave. El contenido guardado no trae la clave.
- [x] **La petición que llega tarde:** el reintento de quitar P1 no quita P2; una nueva pero
      atrasada, `RC011`; dar encima de un precio que no se vio, `RC011`; y la que vio «ninguno».
- [x] **Cruces, con barrera:** contra cobrar la misma cuenta, en los dos órdenes; dos al mismo
      renglón; dos altas del mismo cliente nuevo a la vez (con dos personas que autorizan, para
      que se crucen de verdad en el alta); quitar el material mientras se le da precio, y al
      revés; el cierre primero y el precio primero; dar, cobrar, agregar material y cerrar a la
      vez, seis vueltas, sin un abrazo mortal; la medianoche; y después de reabrir el día.
- [x] **El cierre** (`precios_especiales_del_dia`): la cuenta de ayer cobrada hoy; el centavo
      (1 kg, lista 1.0049, aplicado 1.0051); compras y ventas aparte; lo quitado, lo descartado y
      lo todavía abierto no suman.
- [x] **Permisos:** las tres funciones nuevas, en la lista de entradas (`pruebas/08-permisos`);
      patio, consulta y administración no pasan; la aplicación lee pero no escribe las tablas; renombrar, dar de
      baja y reactivar clientes no son de la aplicación.
- [x] **Respaldo:** el retrato (`pruebas/patio.ts`) incluye ya clientes, los dos precios de cada
      renglón, el cliente de la cuenta, los eventos y el resultado de cada envío; restaurado un
      respaldo tomado entre dar y quitar, queda idéntico, y lo posterior no vuelve.

**Lo que se hizo distinto del plan, o de más, y se dice:**

- **Las funciones de la consola** (`renombrar_cliente`, `baja_de_cliente`, `reactivar_cliente`)
  van en esta migración, con sus pruebas, para no abrir otra en la tarea 2. La consola misma
  —sus comandos— sigue siendo de la tarea 2.
- **Dar un precio especial a un material que aún no termina de pesarse sí se puede** (un camión
  que solo se pesó lleno): el precio es por kilo y no depende del peso. El plan no lo decía.
- **Darle otro precio a un renglón que ya tiene uno** pide haber visto el que tiene, y puede
  cambiar de cliente si es el único precio especial de la cuenta.
- **Un renglón con historia de precio especial no vuelve a nacer con el mismo identificador**
  (cambió el 7 de octubre, migración 0027: antes «nacía sin historia», y Codex mostró que así se
  podía reutilizar una autorización). El nacimiento de un renglón y el de un evento apartan ese
  identificador, para que dos sesiones a la vez tampoco lo logren.

**Para que Codex lo mire con lupa — un orden de candados que no es el de `terminar_vehiculo`.**
Como dice el plan (y como hace la corrección de inventario), dar un precio comprueba la clave
*antes* de tomar la cuenta: toma primero la credencial de quien autoriza y después la cuenta.
`terminar_vehiculo` lo hace al revés: toma la cuenta y después comprueba la clave. Si las dos
cosas le pasan **a la misma cuenta, con la clave de la misma persona y en el mismo instante**
—dar precio especial al camión de ayer mientras, desde otro equipo, se le cobra con esa clave—,
se esperan una a otra y la base tumba a una de las dos al segundo. No se pierde ni se duplica
nada: la tumbada no dejó nada escrito y se reintenta. No se cambió porque el orden está en el
plan aprobado; si conviene invertirlo —tomar la cuenta, validar, y solo entonces pedir la clave,
que además no gastaría un intento en lo que de todos modos no procede—, es una decisión para
revisarla con él.

**Verificado** (6 de octubre, noche): tipos y **686 pruebas**, cero fallos; los **152 recorridos**
de Chromium sobre la aplicación reconstruida con la migración (la pantalla todavía no usa nada de
esto: es que no se rompió lo que había); y **el ensayo de operación**, que instala desde cero con
las 25 migraciones y atiende fuera de desarrollo. WebKit no se volvió a correr: no cambió nada
de la pantalla.

**Comprobado por mutación: 23, todas detectadas al final.** Tres sobrevivieron la primera vez:
- quitarle al guardián «el evento es de esta transacción»: nada lo probaba. Importa cuando un
  renglón se quita y se vuelve a crear con el mismo identificador —su evento viejo «encaja» en
  todo, salvo en que no es de ahora—. **Se agregó la prueba.**
- quitarle «quien queda como autorizante es el del evento»: tampoco lo probaba nada. **Se agregó.**
  (Junto con esa cayó una condición que ninguna prueba podía ejercer —«el evento tiene que ser
  otro que el que había»—, porque ya la implica que el evento nombre al anterior: se quitó.)
- darle a la aplicación permiso de renombrar clientes: la detecta la lista de entradas
  (`08-permisos`), que no estaba entre las pruebas corridas en esa tanda; corrida, la detecta.
Las otras veinte: el evento sin su anterior; el evento suelto; el precio de lista que cambia; el
cliente puesto a mano; el nombre que no se guarda al cobrar; la pagada que cambia de cliente; no
mirar lo visto; no mirar qué día es; la jornada sin candado; la diferencia sobre el especial;
dos clientes en una cuenta; el dado de baja por su nombre; el envío repetido que pide clave; el
contenido sin lo visto; la clave mal que lanza error; «kilos por diferencia» en el cierre; el
cierre por la jornada en que nació la cuenta; el cliente que no se va al quitar el material; las
dos altas a la vez sin índice único; y quitar donde no hay qué quitar.

### Tarea 2 · El servidor — hecha el 6 de octubre de 2026; revisada y cerrada por Codex el 9 de octubre

Las pruebas se escribieron primero y fallaron por lo que debían (las rutas y las funciones de la
consola no existían).

- [x] **Las tres rutas**, en la matriz de quién pasa (`pruebas/17-rutas.test.ts`): `GET
      /api/clientes`, `POST /api/cuentas/[cuenta]/precio-especial` y `…/precio-especial/quitar`,
      las tres solo para mostrador y responsable. Con un cuerpo bien formado llegan a la regla
      de la base; lo mal formado se rechaza antes de tocarla: **la diferencia viaja como texto**
      —con punto, hasta cuatro decimales, con o sin signo de menos—, no como número de máquina;
      lo visto es un número o un nulo dicho; el nombre nuevo, hasta 80 letras y sin caracteres de
      control. Con la clave mal contesta 401 `CLAVE`, sin devolver la clave.
- [x] **La cuenta** (`src/servidor/dominio/cuentas.ts`) devuelve de cada material el precio que
      se cobra, **el de lista** (`precioDeLista`), **su último cambio de precio**
      (`eventoDePrecio`, que es lo que la pantalla manda como «visto») y, si lleva precio
      especial, quién lo autorizó; y de la cuenta, **su cliente**, cuando lo hay.
      **El comprobante** (`comprobante.ts`) trae el nombre del cliente solo cuando lo hubo al
      cobrar, **y no dice «especial» ni trae el precio de lista** (se comprueba sobre todo lo
      que la ruta devuelve). **El cierre** (`cierre.ts`) trae `preciosEspeciales`: compras y
      ventas aparte, cada una con su suma en dinero.
- [x] **La consola**: `cliente lista | renombrar | baja | reactivar`, por número o por nombre
      (`consola/acciones.ts`, `consola/principal.ts`, `pruebas/13-consola.test.ts`).

`src/servidor/dominio/precio-especial.ts` es nuevo: dar, quitar y la lista de clientes activos.

**Verificado** (6 de octubre, noche): tipos y **688 pruebas**, cero fallos; los **152 recorridos**
de Chromium sobre la aplicación reconstruida (la cuenta ya trae lo nuevo y la pantalla de antes lo
ignora: nada se rompió); y **el ensayo de operación**, desde cero.

**Comprobado por mutación: 11.** Nueve se detectaron a la primera; dos sobrevivieron, y de cada una salió un cambio:
- en el cierre, mezclar las ventas con las compras: el recorrido por las rutas no tenía ninguna
  venta con precio especial. **Se agregó**, y con ella se prueba también que cada suma es la suya.
- en la ruta de quitar, una comprobación de «falta decir lo que se vio» que sobraba —la que
  viene después ya rechaza lo que no es un número ni un nulo—: **se quitó** (no era un hueco
  de las pruebas, sino código de más).
Las otras: el comprobante con el precio de lista; el comprobante sin el cliente; la clave mal que
contesta 200; la diferencia como número; quitar hecho por el patio; ofrecer clientes dados de
baja; la cuenta sin su evento de precio; la consola que no encuentra a un cliente dado de baja.

### Tarea 3 · La pantalla — hecha el 10 de octubre de 2026; falta que Codex la revise

- [x] **El panel** (`src/componentes/mostrador/PrecioEspecial.tsx`): en el paso «Cuenta», cada
      material ya pesado tiene «Precio especial». Se elige al cliente de la lista o se teclea uno
      nuevo —si la cuenta ya está a nombre de alguien, es para esa persona y no se elige—; la
      diferencia por kilo, «más que la lista» o «menos que la lista», en el teclado de siempre; y
      se ve cómo queda antes de autorizar: «Lista $2.10 → queda $2.60 por kilo, para Don Chuy».
      Autoriza un responsable con su clave, en la hoja de autorizar (`Autorizar.tsx`), que repite
      lo que se autoriza. No se deja autorizar sin cliente, sin diferencia, o si el precio
      quedaría en cero o menos.
- [x] **El renglón con precio especial** dice el de lista, el que queda y quién lo autorizó, y
      deja quitarlo (sin clave). La cuenta dice a nombre de quién está. Quien solo pesa (patio) no
      ve ni el botón ni «quitar».
- [x] **El comprobante** lleva «Cliente: …» cuando lo hubo, y el precio que se aplicó; no dice
      «especial» ni la lista. Hay un retrato nuevo del papel (`recorrido/papel/compra-con-cliente`);
      los otros cuatro quedaron idénticos. **El cierre** tiene «Precios especiales del día»:
      compras y ventas aparte, cada renglón con cliente, material, kilos, precio, lista, quién
      autorizó y lo que significó en dinero, y la suma de cada lado («se pagó de más», «se cobró
      de menos»). Un día sin precios especiales no enseña esa tarjeta.
- [x] **Las transiciones del envío.** Dar usa el mismo `enviar` que las acciones de inventario, y
      lo que salió queda guardado con el lugar de la cuenta (`Lugar.especial`, en la memoria de la
      pestaña): la respuesta que se pierde, habiendo llegado o no; la recarga con el envío en el
      aire; el 502 después de guardar; la clave equivocada; «autoriza otra persona»; y el precio
      que cambió por otro lado mientras se tenía abierto (no se pisa: se dice y se vuelve a ver).
      Quitar también (`Lugar.quitando`): mientras no se sabe si se quitó, la cuenta no deja pagar,
      agregar ni quitar. La clave no se guarda en el equipo: se comprueba con el envío guardado.
      **No se repitieron aquí**, porque son del mismo `enviar` y ya tienen su recorrido en
      inventario: la sesión que vence, el reintento rechazado con el primero en camino o ya
      asentado, el mismo envío desde dos pestañas, y la baja de quien autorizó.
- [x] **Un día entero** con un precio especial en compra y otro en venta, hasta el cierre.

`recorrido/precio-especial.spec.ts` (14 recorridos) y un caso más en `recorrido/papel.spec.ts`.
Los recorridos se escribieron junto con la pantalla, no antes; por eso se rompió la pantalla a
propósito —quitar que no bloquea la cuenta, el pendiente de quitar que no se suelta al recargar,
el botón a la vista del patio, el comprobante diciendo «precio especial», la diferencia sin su
signo— y cinco recorridos lo notaron. La comprobación de que la clave no se guarda se movió
después de eso al momento en que el envío está guardado; esa versión no se volvió a romper.

**Lo que no hace, y está dicho arriba como fuera:** elegir cliente sin dar precio; alta,
renombrar o baja de clientes desde la pantalla (es por la consola). **Estilo:** va con el del
mostrador de hoy; se rediseña con él (tarea 3 del rediseño). Capturas, para verla:
`recorrido/capturas/precio-especial/`.

### Revisión de Codex a cada tarea, con ejecución.

## Lo que hay que mirar con lupa

1. **Cobrar con un total viejo.** El cobro compara la revisión de la cuenta: cambiar un precio
   tiene que moverla, igual que cambiar un peso.
2. **El redondeo.** El precio lleva hasta cuatro decimales y el importe dos: una diferencia de
   medio centavo por kilo en muchos kilos no debe perderse ni duplicarse al sumar.
3. **Un cliente «nuevo» que ya existe** con otra escritura (mayúsculas, espacios, acentos). Los
   acentos sí distinguen: «Jose» y «José» serían dos. Se acepta y se dice; se arregla renombrando.
4. **La clave.** No viaja en el contenido del envío, ni en la bitácora, ni en lo guardado en el
   navegador para reintentar.
5. **El vehículo de otro día.** Su precio se fijó el día que entró: darle precio especial hoy es
   sobre aquel precio de lista, no sobre el de hoy.

## Lo que se da por sabido y conviene confirmar al implementar

Cómo se mueve la revisión de una cuenta al cambiar un renglón; que el cierre de hoy no suma dinero
de caja (no existe la caja todavía): la lista de precios especiales es informativa.
