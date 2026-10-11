# Respuesta a la cuarta pasada de Codex (2 de octubre de 2026, noche)

Informe: `2026-10-02-codex-cuarta-pasada-cancelacion.md`. Dio por corregidas las dos pestañas con
el mismo envío y la respuesta de cancelación inválida. Trajo un hallazgo condicionado, una
observación de cobertura, y recomendó corregir uno de los dos límites que yo había declarado.

Se acepta todo menos una parte, que se explica. Cada cambio se hizo con la prueba primero.

Estado al cerrar: **535 pruebas y 87 recorridos en verde** (antes 535 y 84).

**Después de esta respuesta** Codex dio una quinta pasada y venció el mecanismo de pestañas que
aquí se describe (una espera de 250 ms). Se reemplazó por un candado del navegador. Ver
`2026-10-02-respuesta-a-la-quinta-pasada.md`.

## Media, condicionada — «entró ese identificador» se leía como «entró esta captura»

**Aceptado.** Codex lo ejecutó forzando al generador a devolver un identificador ya ocupado por
otra merma: la pantalla dijo «ya había quedado registrada» de una captura que no existía. Con
identificadores al azar eso no pasa, y él mismo lo dice. Pero el defecto de fondo no es la
colisión: es que la pantalla **deducía** un éxito en vez de recibirlo. Eso sí conviene quitarlo.

**Corrección**, en dos partes:

1. **Un identificador que ya no sirve tiene su propio código**
   (`db/migraciones/0019_envio_ocupado.sql`). `reservar_envio` contesta `RC012` —y ya no `RC005`—
   cuando el identificador se canceló o lo ocupa otro envío con otros datos. No es una regla sobre
   lo que se quiso hacer: dice que ese identificador está resuelto en el servidor y que nada más
   va a entrar con él. Con `RC012` la pantalla suelta la captura sin más: no hay nada que cancelar.
2. **Que algo quedó registrado solo lo dice la acción misma** (`enviar`, en
   `src/componentes/inventario/piezas.tsx`). Cuando la cancelación contesta que el identificador
   ya había entrado, la pantalla manda la acción otra vez: si era esta captura, la acción devuelve
   lo que hizo, y el aviso es el de siempre, con los datos del servidor. Si contesta `RC012`, lo
   ocupa otra cosa, y la captura se suelta con su explicación. Si no se puede confirmar, sigue
   guardada. El aviso «ya había quedado registrada» desapareció de las cuatro acciones.

**Lo que no se cambió, y por qué.** El botón «Autoriza otra persona» sigue terminando la captura
cuando el servidor dice que el identificador ya entró, sin confirmarlo con la acción. Confirmarlo
exigiría mandar el conteo o la corrección otra vez, y eso lleva la clave de quien autorizó, que
es justo la persona que ya no está. Mandar una clave de relleno contaría un intento fallido en su
contra si el identificador lo ocupara otra cosa. Ahí se confía en que un identificador hecho al
azar por esa misma pantalla no lo ocupa otro envío. Queda escrito en el código.

**Pruebas:**

- `recorrido/inventario.spec.ts`, «si el identificador de una captura ya lo ocupa otro envío…»:
  la reproducción de Codex. La pantalla muestra el rechazo, no dice que quedó registrada, no pide
  cancelar nada, y al registrar de nuevo sale con otro identificador: una merma «Mojado» y 470 kg.
  Fallaba antes.
- «Si al reintentar llega un rechazo y el primero sí había entrado…», en las cuatro acciones:
  ahora afirma que se pidió cancelar ese identificador, que la acción se mandó otra vez idéntica,
  y que el aviso es el del servidor. Fallaban antes.
- Los envíos con otro contenido y los cancelados esperan `RC012` en `10-entradas`, `18-inventario`
  y `19-dominio-inventario`.

## Límite (b) — la misma captura en dos pestañas

**Aceptada la recomendación.** Yo lo había dejado como límite con el argumento de que el sistema
no puede saber que dos capturas en dos pantallas son la misma. Codex tiene razón en que sí puede
saber algo más simple: que una pestaña es copia de otra.

**Corrección** (`src/componentes/pestana.ts`): cada pestaña lleva un identificador propio,
guardado junto con lo demás. Una copia —duplicada, o abierta desde otra— nace con el identificador
de su original. Al cargar pregunta si alguien más lo tiene; el original contesta, y la copia suelta
la captura heredada, estrena identificador y avisa: «Había una captura a medias: sigue en la otra
pestaña, donde se empezó». Recargar no es copiar: nadie contesta y la pestaña se queda con lo
suyo. Toda pestaña se da a conocer al cargar, esté en la pantalla que esté.

No hay «transferencia de control» como proponía Codex: la captura se queda donde se empezó. Me
pareció suficiente y más fácil de entender en un mostrador.

**Lo que esto no cubre:** un navegador que no deje avisarse entre pestañas (`BroadcastChannel`).
Ahí la copia sí hereda la captura, y lo que protege es lo de antes: ningún envío se asienta dos
veces. Ese caso tiene su recorrido, que es el de las dos pestañas de la pasada anterior.

**Pruebas** (`recorrido/inventario.spec.ts`): «una pestaña duplicada no hereda la captura a
medias», con y sin un envío del que no se supo. La copia llega a existencias con el aviso, sin
nada que registrar ni reintentar; la primera sigue y asienta una sola vez; recargar la copia no le
devuelve la captura. Fallaban antes.

## Límite (a) — cancelar un envío ajeno que se conozca

Codex lo considera aceptable para una o dos computadoras. Se queda como está.

## Cobertura, importancia baja

- **Mostrador, el original ya había entrado:** el recorrido afirma ahora que se pidió cancelar ese
  identificador y que el servidor contestó `{ entro: true }`.
- **Cancelación inválida, y `RC011` con la cancelación fallida:** afirman que se pidió cancelar
  ese identificador, y solo ese.
- **Cancelación por ruta, rama «ya había entrado»:** comprueba el estado 200, y además que ese
  identificador con otros datos se rechaza con `RC012`.

## Precisión sobre la segunda pesada

Codex matiza lo que escribí: que un material tenga una sola segunda pesada impide duplicados, pero
no garantiza que gane el peso corregido; si el original llega antes, prevalece ese. Es exacto. La
pantalla lo muestra al volver a pedir la cuenta, y lo que se haya tecleado después se rechaza.

## Lo que sigue sin comprobar

Todos los órdenes concurrentes, fallos de `sessionStorage`, que falle la lectura con que el
mostrador se recupera, la carrera de la segunda pesada, y las dos pestañas en las acciones que no
son merma. El aviso entre pestañas es código nuevo y Codex todavía no lo ha visto.
