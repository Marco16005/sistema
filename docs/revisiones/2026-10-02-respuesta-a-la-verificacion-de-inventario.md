# Respuesta a la verificación de Codex de las correcciones de inventario (2 de octubre de 2026, noche)

Informe: `2026-10-02-codex-verificacion-de-las-correcciones-de-inventario-repeticion.md`. Dio por
corregidos los puntos 2, 4 y 5, dejó «a medias» el 1 y el 3, y trajo tres hallazgos nuevos. Los
tres se aceptan. Cada uno se corrigió con la prueba primero.

Estado al cerrar: **535 pruebas y 78 recorridos en verde** (antes 527 y 66).

**Después de esta respuesta** Codex verificó la cancelación y encontró que la excepción del
«primer intento» que aquí se describe era un hueco (dos pestañas con el mismo envío). Se quitó:
ver `2026-10-02-respuesta-a-la-verificacion-de-la-cancelacion.md`.

## Alta — un rechazo del reintento no impide que el primer envío llegue después

**Aceptado.** Yo había descartado este caso por improbable: que el primer envío se quede en el
camino el tiempo suficiente para que el reintento se rechace, cambien las condiciones y entonces
llegue. Codex lo ejecutó y salieron dos mermas. Que sea improbable no lo vuelve correcto: la regla
que escribí —«una regla del servidor dice que no entró»— vale para la petición que recibió la
respuesta, no para otra anterior con el mismo identificador.

Su observación de fondo también es correcta: preguntar «¿ya entró?» no resuelve nada, porque un
«todavía no» no impide que entre al rato. Hace falta dejar dicho en el servidor que ese
identificador ya no vale.

**Corrección.**

*En la base* (`db/migraciones/0018_cancelar_envio.sql`):

- `cancelar_envio(envío, persona)`: intenta ocupar ese identificador en el registro de envíos con
  la clase `cancelado`. Si lo ocupa, el envío queda cancelado. Si ya estaba ocupado, contesta si
  era una cancelación o un envío que sí entró. Pasa por la misma fila única que reserva cualquier
  envío, así que los dos órdenes quedan cubiertos: si el envío va en camino dentro de otra
  transacción, la cancelación espera a saber si entró; si la cancelación va primero, el envío que
  llega después espera y se rechaza.
- `reservar_envio` rechaza con `RC005` un identificador cancelado, con su propio mensaje. Como las
  cuatro acciones de inventario y el material de una cuenta reservan por ahí, ninguna se asienta
  con un identificador cancelado.
- Cada cancelación queda en la bitácora.

*En el servidor:* `POST /api/envios/[envio]/cancelar` contesta `{ entro }`. Pasa quien arma cuentas
o lleva inventario.

*En la pantalla* (`src/componentes/cliente.ts`: `rechazoConRegla`, `cancelarEnvio`;
`src/componentes/inventario/piezas.tsx`: `enviar`):

- **Primer intento** rechazado con una regla: se suelta. Ese identificador no había salido nunca
  y su única petición ya tiene respuesta.
- **Reintento** rechazado con una regla: la pantalla pide cancelar el envío. Si el servidor dice
  que ya había entrado, la captura termina («ya había quedado registrada»). Si queda cancelado, se
  suelta y se muestra el rechazo. Si la cancelación no se puede hacer, sigue pendiente.

Con esto desaparece la distinción que había puesto por la mañana entre `RC008`/`CLAVE` y las demás
reglas: en un reintento ninguna suelta por sí sola; todas pasan por la cancelación.

Lo mismo en el mostrador (`Mostrador.tsx`, `agregar`): un peso reintentado y rechazado se cancela
en el servidor antes de soltarse. En la segunda pesada no hace falta: un material tiene una sola
segunda pesada, y de la anterior y la que se teclee después, la que llegue segunda se rechaza.

**Pruebas.**

- `pruebas/18-inventario.test.ts`, cinco: un envío cancelado ya no se asienta (las cuatro acciones
  y el material de una cuenta); cancelar uno que ya había entrado dice que entró y no cambia nada;
  cancelar mientras el envío va en camino espera, en los dos desenlaces; un envío que llega
  mientras se cancela espera y se rechaza; quién puede cancelar. Las dos de concurrencia demuestran
  la espera con barrera.
- `pruebas/19-dominio-inventario.test.ts` y la matriz de `17-rutas`: la ruta.
- `recorrido/inventario.spec.ts`: **la secuencia exacta de Codex**, con el servidor de verdad
  contestando (500 kg, merma de 10 retenida antes de llegar, recarga, salen 495, el reintento
  recibe `RC002`, un conteo deja 105, el primero llega y recibe 409, se registra de nuevo: una sola
  merma «Mojado» y 95 kg). Y para las cuatro acciones: el primero seguía en camino y ya no entra;
  y el primero sí había entrado y la pantalla lo averigua.
- `recorrido/transiciones.spec.ts`: el mismo cruce en el mostrador.

Los recorridos nuevos fallaban antes del cambio (18 de 18).

## Importante — la baja de quien autorizó dejaba conteo y corrección sin salida

**Aceptado.** Era el límite que yo había declarado como aceptable; Codex mostró que no lo era.

**Corrección.** Sale del mismo mecanismo, de dos maneras:

- **Sola:** el reintento recibe `RC008` porque esa persona ya no está facultada; la pantalla
  cancela el envío y lo suelta. Ya se puede elegir a otra persona, y la lista de quienes autorizan
  se vuelve a pedir.
- **A mano:** junto a la clave hay un botón «Autoriza otra persona». Con un envío del que no se
  supo, primero lo resuelve: si ya había entrado, termina; si no, lo cancela y deja elegir. Sirve
  también cuando quien autorizó simplemente ya no está ahí.

Se respeta lo que Codex pidió: no se cambia el autorizador dentro del mismo envío. El envío viejo
queda cancelado y la autorización nueva es un envío nuevo.

**Pruebas** (`recorrido/inventario.spec.ts`, para conteo y corrección): la baja de quien autorizó;
el botón cuando el envío sí había entrado; el botón cuando no había llegado; y la clave mal en un
reintento, que ahora cancela y deja autorizar de nuevo sin asentar dos.

## Menor — la prueba del cambio de rol no repetía idéntico el conteo

**Aceptado.** Ahora toma una sola vista previa y la usa en los dos intentos.

## Lo demás que señaló

- **La prueba de la clave mal con el primer intento en camino cubría solo el conteo:** ahora corre
  para conteo y corrección.
- **La prueba del material donde cuenta hoy no cubría la anulación ni el destino contado:** se
  agregó una. Fija lo que Codex observó: que un movimiento se ofrezca para corregir no garantiza
  cualquier destino. Un movimiento dejado sin efecto se sigue ofreciendo, y si el destino ya se
  contó la base lo rechaza con su mensaje. No lo considero defecto: la pantalla no puede saber el
  destino antes de que se elija. Esas dos pruebas pasaron a la primera: describen lo que hay.
- **Los recorridos de clave incorrecta no ejecutaban la carrera:** el cruce «el primero seguía en
  camino» ahora retiene el primer envío de verdad y lo entrega tarde, en las cuatro acciones.

## Lo que sigue sin comprobar

Lo que Codex dijo no haber comprobado, y sigue igual: dos pestañas a la vez en las cuatro acciones
(solo en merma), todos los órdenes concurrentes, que falle `sessionStorage`, y que falle la lectura
con que el mostrador se recupera. Tampoco se ha verificado por Codex esta misma ronda.
