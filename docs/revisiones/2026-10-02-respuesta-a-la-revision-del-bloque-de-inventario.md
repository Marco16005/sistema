# Respuesta a la revisión de Codex del bloque de inventario (2 de octubre de 2026)

Informe: `2026-10-02-codex-revision-del-bloque-de-inventario.md`. Tres hallazgos nuevos y uno «a
medias» de la revisión de servidor. Los cuatro se aceptan. Cada uno se corrigió con la prueba
primero: se vio fallar, se corrigió, y se vio pasar.

Estado al cerrar esta respuesta: 524 pruebas y 56 recorridos en verde (más el recorrido de
capturas, que solo corre con `CAPTURAS=1`). Antes: 520 y 34.

**Después de esta respuesta** se pidió a Codex verificar las correcciones. Se quedó sin cuota y no
entregó informe, pero sus guiones demostraron tres cosas más, que se corrigieron: la regla de
cuándo soltar un envío cambió (en un reintento, `RC008` y `CLAVE` ya no lo sueltan) y la lectura de
qué se puede corregir también. Está en `2026-10-02-codex-verificacion-de-las-correcciones-de-inventario.md`,
que corrige lo que aquí se dice de esa regla. Por la noche la verificación se repitió completa y
la regla volvió a cambiar: un envío del que no se supo ya no se suelta con ninguna regla, se
cancela en el servidor. Ver `2026-10-02-respuesta-a-la-verificacion-de-inventario.md`. Estado
final: **535 pruebas y 78 recorridos**.

## Hallazgo 1 (bloqueante) — recargar con una merma en el aire permitía descontarla dos veces

**Aceptado.** La pantalla guardaba el identificador al mandar, pero solo se bloqueaba cuando
llegaba el error de red. Había tres caminos al mismo defecto, no uno:

1. Recargar con el envío en el aire (la reproducción de Codex).
2. Cambiar el motivo mientras la respuesta tardaba: los botones de motivo seguían activos.
3. Que el servidor —o lo que haya en medio— contestara con una falla (un 502) después de asentar:
   la pantalla lo trataba como rechazo, soltaba el identificador y dejaba capturar de nuevo.

**Corrección** (`src/componentes/inventario/piezas.tsx`, función `enviar`; `Merma.tsx`,
`Separar.tsx`, `Contar.tsx`, `Corregir.tsx`; `Inventario.tsx`):

- Lo que va a salir queda guardado **antes de salir**, con su identificador y **lo que lleva, tal
  cual** (`pendiente: { id, cuerpo }`). El guardado en `sessionStorage` ahora es en el momento, no al
  redibujar la pantalla.
- Mientras haya un `pendiente`, la pantalla no ofrece nada que editar —tampoco mientras la
  respuesta tarda—: solo mandar **ese mismo** otra vez, con el cuerpo guardado y no con lo que esté
  en los campos.
- El `pendiente` se suelta **solo** cuando el servidor contesta con una regla (`RCnnn`, `CLAVE`,
  `FORMA`): es cuando se sabe que no entró. (Corregido después: en un reintento, `RC008` y `CLAVE`
  no lo sueltan. Ver la verificación.) Sin respuesta, con una falla del servidor, con la sesión
  perdida o tras una recarga, no se sabe, y se queda. La regla vive en un solo lugar
  (`seSabeQueNoEntro`, en `src/componentes/cliente.ts`).
- En conteo y corrección, el `pendiente` guarda también **quién autorizó** (nunca la clave): al
  reintentar se le pide la clave a esa misma persona, sin elegir. Así el reintento lleva
  exactamente el mismo contenido, y «el mismo identificador con otros datos» no puede salir de
  esta pantalla.

Sobre la frase «un rechazo por contenido distinto no debe descartar el identificador»: con el
contenido congelado ese rechazo ya no se puede producir desde la pantalla. No se agregó una
consulta de «¿este envío ya entró?» porque la aplicación, a propósito, no lee `envio_resultado`;
el reintento idéntico ya es esa consulta.

**Por qué soltar con una regla es seguro también en un reintento.** En las cuatro funciones
(`dar_merma`, `separar_material`, `contar_material`, `corregir_movimiento`) lo que se revisa antes
de buscar el envío es el rol y la forma del contenido, que no cambian entre un intento y otro; la
jornada, la existencia, la clave y lo revisado se miran después. Un envío ya asentado, repetido
igual, devuelve lo que hizo aunque la jornada se haya cerrado. Así que una regla en respuesta a un
reintento idéntico quiere decir que el primero no había entrado. Ese orden ya tenía prueba para la
merma; se agregó una en `18-inventario` para las cuatro acciones, que fija aquello de lo que la
pantalla depende. Esa prueba pasó a la primera y no se comprobó por mutación.

**Límite conocido.** Si la respuesta de un conteo o una corrección se pierde, el reintento lo
autoriza la misma persona. Si esa persona ya no está, la captura se queda esperándola en ese
equipo. Se prefirió eso a dejar que otra persona reintente con otro contenido.

**Pruebas** (`recorrido/inventario.spec.ts`, sección «a medio camino»): las cuatro acciones contra
los mismos cinco cruces, 20 recorridos:

| Cruce | Qué afirma |
|---|---|
| La respuesta tarda | Antes de que nadie conteste ya está guardado con el mismo identificador y contenido que salió; la clave no está guardada; nada se puede editar; un segundo toque no manda otro. |
| La respuesta se pierde después de asentar | Queda bloqueado; el reintento sale con cuerpo idéntico; uno solo asentado; existencia final. |
| El servidor falla (502) después de asentar | Lo mismo: no se suelta. |
| El envío no llega | Cero asentados; el reintento idéntico asienta uno. |
| Se recarga con el envío en el aire | Vuelve bloqueado; el reintento sale idéntico; uno solo asentado. |

Más uno aparte: una merma rechazada por una regla (no alcanza la existencia) **sí** se suelta, se
corrige y sale con otro identificador.

Catorce de los dieciséis primeros fallaban con el código anterior. Los cinco que pasaron a la
primera (los cuatro del 502 y el de la regla) se comprobaron por mutación: haciendo que una falla
del servidor suelte el envío fallan los cuatro; haciendo que una regla no lo suelte, falla el otro.

## Hallazgo 2 (importante) — «el conteo manda» se eludía con la misma hora efectiva

**Aceptado.** El conteo arma lo que dice el libro con `efectivo_en <= contado_en`, y la protección
de la corrección miraba `contado_en > efectivo_en`: la igualdad quedaba contada y sin proteger.

**Corrección:** el mismo límite inclusivo, `contado_en >= efectivo_en`, en `corregir_movimiento`
(`db/migraciones/0017_inventario.sql`, editada en su lugar: no está aplicada en ninguna base que
no sea desechable) y en la lectura que marca `yaContado` y `corregible`
(`src/servidor/dominio/inventario.ts`).

**Pruebas:** `18-inventario` — conteo fechado en el instante exacto de la compra; la corrección se
rechaza y la existencia queda en lo contado. `19-dominio-inventario` — ese movimiento sale marcado
como ya contado y no corregible. Las dos fallaban antes del cambio.

## Hallazgo 3 (menor) — faltaba la cobertura de transiciones en inventario

**Aceptado.** Es la tabla de arriba. La prueba vieja recargaba después de que apareciera el aviso;
la nueva recarga con el envío en el aire, que es donde estaba el defecto.

## Servidor, hallazgo 7 «a medias» — la matriz mandaba `{}` y aceptaba un error de forma

**Aceptado.** Con `{}` una ruta se queda en la validación de forma y nunca llega a la función de
la base, que es donde se vuelve a preguntar el rol. Si la ruta dejaba pasar a alguien que la base
rechaza, la matriz no lo veía.

**Corrección** (`pruebas/17-rutas.test.ts`): una segunda matriz con un **cuerpo bien formado** por
cada ruta que escribe (21), en un día en marcha, y la respuesta exacta que debe dar: nada, o la
regla que aplica. Una ruta nueva sin su cuerpo hace fallar la prueba. Comprobada por mutación:
dejando pasar a patio a dar merma en la ruta y en la matriz, la prueba vieja sigue pasando y la
nueva falla con `RC008`.

Lo que **no** acredita: que cada acción termine bien para cada rol. Acredita que la ruta y la base
están de acuerdo en quién pasa. Que las acciones funcionan lo prueban las pruebas de cada dominio
y los recorridos.

## Lo que encontré de más al aplicar la misma regla al mostrador

Codex dio por corregido el hallazgo 2 de pantallas (mostrador). Al llevar el mismo criterio al
mostrador encontré el tercer camino de arriba también ahí: si el servidor fallaba (502) después de
guardar un peso, la pantalla soltaba el envío, se quedaba en la báscula con el peso tecleado y el
aviso «Intenta de nuevo»; tocar otra vez agregaba el material dos veces a la cuenta. Era menos
grave que en inventario —la cuenta sigue abierta y el renglón repetido se ve—, pero es el mismo
defecto.

**Corrección** (`src/componentes/mostrador/Mostrador.tsx`): el envío solo se suelta con una regla.
Si el servidor falla, la pantalla vuelve a pedir la cuenta: si el peso ya está en ella, la muestra
y no hay nada que reintentar; si no, queda pendiente y se reintenta el mismo. Igual en la segunda
pesada.

**Pruebas** (`recorrido/transiciones.spec.ts`): cuatro recorridos —primera y segunda pesada, con
la falla después de guardar y sin que llegara—, comprobados por mutación (con la regla anterior
fallan los cuatro).

**Queda sin cambiar en el mostrador:** su guardado en `sessionStorage` sigue siendo al redibujar.
La ventana es de milisegundos y, al recargar, la pantalla vuelve a pedir la cuenta y muestra lo que
sí entró. No encontré forma de probarlo de manera determinista, así que no lo toqué.

## Incidencia de ejecución que reportó Codex

Tenía razón: le pedí no correr `npm ci` y el comando de recorridos que le di lo corre por
definición. La instrucción era contradictoria. Para la siguiente revisión el comando es
`docker compose --profile recorrido run --rm recorrido npx playwright test`, que usa las
dependencias ya instaladas. El volumen quedó bien: los 56 recorridos corrieron después con el
comando normal, que reinstala.

## Lo que Codex dijo no haber comprobado

Baja o cambio de clave a media autorización, todos los cruces contra la confirmación de una venta,
medianoche y cambios de zona, materiales dados de baja en todas las secuencias, y bloqueos
excesivos del conteo. Siguen sin comprobarse; no se dan por buenos.
