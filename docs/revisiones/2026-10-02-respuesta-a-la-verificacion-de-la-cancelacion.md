# Respuesta a la verificación de Codex de la cancelación de envíos (2 de octubre de 2026, noche)

Informe: `2026-10-02-codex-verificacion-de-la-cancelacion-de-envios.md`. Dio por corregidas la
cancelación en la base, su reproducción de las dos mermas y la baja de quien autorizó. Dejó «a
medias» la pantalla y las pruebas, con dos defectos y una observación de permisos. Los dos
defectos se aceptan y se corrigieron con la prueba primero. La observación de permisos se acepta
como límite declarado, con su razón.

Estado al cerrar: **535 pruebas y 84 recorridos en verde** (antes 535 y 78).

**Después de esta respuesta** Codex dio una cuarta pasada. El límite de las dos pestañas que aquí
se declara se cerró (una pestaña duplicada ya no hereda la captura), y el aviso «ya había quedado
registrada» se quitó. Ver `2026-10-02-respuesta-a-la-cuarta-pasada.md`.

## Alta — el «primer intento» podía no ser el único envío con ese identificador

**Aceptado.** Yo había dejado una excepción: en el primer intento, una regla bastaba para soltar
la captura, «porque ese identificador no había salido nunca». Eso era cierto para la pestaña, no
para el identificador: otra pestaña que heredó lo guardado puede haber mandado el mismo envío.
Codex lo ejecutó con dos pestañas y salieron dos mermas.

**Corrección:** se quitó la excepción. Ya no hay distinción entre primer intento y reintento:
**ninguna captura se suelta sin que el servidor deje resuelto su envío**. Ante cualquier regla, la
pantalla pide cancelar; si el servidor dice que ya había entrado, la captura termina; si queda
cancelado, se suelta; si no se puede cancelar, sigue guardada. Igual en el mostrador
(`enviar` en `src/componentes/inventario/piezas.tsx`; `agregar` en `Mostrador.tsx`).

La regla quedó más simple que las tres versiones anteriores, y es la que debí escribir desde el
principio: un identificador solo se abandona cuando el servidor garantiza que ya no entra.

**Pruebas:**

- `recorrido/inventario.spec.ts`, «una merma mandada desde dos pestañas…»: la secuencia de Codex
  con el servidor de verdad contestando. A manda, B hereda y reintenta, salen 495, A recibe
  `RC002`, un conteo deja 105, llega el envío de B y recibe 409, A registra de nuevo: una sola merma
  «Mojado» y 95 kg. Fallaba antes del cambio (el envío de B recibía 200).
- El recorrido de la merma rechazada por una regla afirma ahora que el envío quedó cancelado en el
  servidor antes de soltarse. Fallaba antes.
- `recorrido/transiciones.spec.ts`, «un peso rechazado por una regla deja cancelado ese envío…»:
  lo mismo en el mostrador. Fallaba antes.

## Importante — una respuesta sin confirmación se leía como «cancelado»

**Aceptado.** `r.entro ? "entro" : "cancelado"` tomaba un campo ausente por un «no entró».

**Corrección** (`cancelarEnvio`, en `src/componentes/cliente.ts`): solo vale una respuesta con
`entro` estrictamente booleano. Cualquier otra cosa cuenta como no saber, y la captura sigue
guardada.

**Prueba:** «si el servidor no confirma la cancelación tal como se espera, el envío no se suelta»:
la cancelación contesta 200 con `{}`; el envío sigue siendo el mismo, no hay cancelación en la
base, y al reintentar se asienta una sola vez. Fallaba antes.

## Permisos — cancelar un envío ajeno que se conozca

**Aceptado como límite, sin cambio.** Codex lo describe con precisión: quien tiene rol para armar
cuentas o llevar inventario puede cancelar un identificador que todavía no llegó, si lo conoce. No
puede deshacer nada ya asentado, y él mismo no encontró cómo obtener el identificador pendiente
de otro equipo.

Por qué no se cambia:

- El identificador lo genera la pantalla al azar, vive en esa pestaña y no viaja a ningún otro
  lado antes de enviarse. Conocerlo equivale a estar en esa pantalla.
- Un envío que todavía no llega no tiene dueño que el servidor pueda comprobar: no existe ahí.
  Atarlo a la persona rompería la recuperación cuando cambia quien atiende, que es para lo que
  sirve; Codex lo señala.
- El efecto de una cancelación indebida es que esa captura se rechaza con su aviso y hay que
  hacerla de nuevo. Y queda en la bitácora quién la canceló.

Queda escrito en la frontera de confianza del README.

## Cobertura que señaló

- **`19-dominio`, destino contado:** ahora exige el mensaje del conteo, no cualquier `RC005`.
- **`17-rutas` / cancelación por ruta:** la prueba de `19-dominio` exige estado 200, cuerpo
  `{ entro: false }` y la fila `cancelado` en el registro, con quién la canceló.
- **`RC011` con la cancelación fallida:** recorrido para conteo y corrección. Pasó a la primera,
  como Codex dijo que pasaría: describe lo que hay.
- **Mostrador, el original ya había entrado y el reintento recibe una regla:** recorrido nuevo.
  También pasó a la primera.
- **Las dos pruebas de clave incorrecta no llaman a cancelar:** cierto. Describen lo que hace la
  base, que es la razón de la regla; no prueban la cancelación. Esa la prueban las de su sección.
- **Los cruces generales inyectan el rechazo:** cierto. Prueban la reacción de la pantalla. Los
  que obtienen el rechazo del servidor de verdad son las dos secuencias de merma.

## Límite que queda, declarado

**Dos pestañas con la misma captura, las dos soltadas.** Si la captura se copió a otra pestaña y
el envío termina cancelado, las dos pestañas quedan con el formulario lleno. Si la persona toca
«Registrar» en las dos, son dos mermas. El sistema garantiza que ningún envío se asienta dos veces
y que ninguno se abandona sin que el servidor lo resuelva; no puede saber que dos capturas
tecleadas en dos pantallas son «la misma». La segunda pestaña ve el aviso de que ese envío se
canceló.

## Lo que sigue sin comprobar

Lo que Codex dijo no haber comprobado: todos los órdenes concurrentes, fallos de `sessionStorage`,
y que falle la lectura con que el mostrador se recupera. La duplicación entre pestañas se ejecutó
en merma; la corrección es la misma función para las cuatro acciones, pero el recorrido de dos
pestañas solo existe para merma. Y esta ronda todavía no la ha verificado Codex.
