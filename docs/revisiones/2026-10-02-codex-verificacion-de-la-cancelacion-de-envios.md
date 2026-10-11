# Verificación de Codex a la cancelación de envíos (2 de octubre de 2026, noche)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución. Se le pidió no modificar archivos del proyecto.
Tercera pasada del día sobre el bloque de inventario: verifica lo que se cambió en respuesta a su
verificación anterior (`2026-10-02-respuesta-a-la-verificacion-de-inventario.md`). Informe completo.

La respuesta está en `2026-10-02-respuesta-a-la-verificacion-de-la-cancelacion.md`.

---

**La cancelación en la base funciona y la reproducción original quedó corregida. Sin embargo, comprobé otra duplicación de merma entre dos pestañas: todavía se puede soltar un identificador sin cancelarlo.**

## 1. Qué ejecuté

- Batería con el comando indicado y `PG_PLANTILLA=feruga_plantilla_codex`: **535 aprobadas, 0 fallidas**.
- Recorridos con el comando indicado: **78 aprobados, 1 omitido** (capturas).
- **11 comprobaciones propias de navegador**, ejecutadas después, sin corridas simultáneas: reproducción original, duplicación entre pestañas, seis casos de autorización, dos de `RC011` con cancelación fallida y una respuesta inválida de cancelación.
- **Tres cruces propios de base**: cancelación mientras conteo y corrección esperan la credencial, y mientras agregar material espera la cuenta.

No modifiqué, creé ni borré archivos dentro de `/Users/maantora/Desktop/feruga`. No instalé dependencias ni reconstruí imágenes. Eliminé los guiones temporales, las bases propias y `feruga_plantilla_codex`; dejé limpia la base de recorridos usando su plantilla existente.

## 2. Los cinco puntos

| Punto | Estado | Reproducción y resultado |
|---|---|---|
| **1. Cancelación en base** | **Corregido en la serialización** | Pasan envío antes de cancelación, cancelación antes de envío y rollback del envío. Mis cruces anteriores a reservar terminaron en `RC005`, sin resultados asentados ni interbloqueos. Hay una amplitud de permisos que detallo abajo. |
| **2. Reproducción exacta de las dos mermas** | **Corregido** | Guion propio: 500 kg, retener merma de 10, recargar, sacar 495, reintentar → `RC002`; cancelar; contar 105; entregar original → **409/RC005**; registrar nuevamente → **una merma «Mojado» y 95 kg**. |
| **3. Pantalla** | **A medias** | Los reintentos se resuelven correctamente y una cancelación fallida conserva el pendiente. Pero comprobé **dos mermas y 85 kg** cuando otra pestaña ya había enviado el identificador que la primera todavía consideraba "primer intento". También acepta `{}` como confirmación de cancelación. |
| **4. Baja y cambio de autorizador** | **Corregido** | Repetí baja, botón con envío asentado y botón con envío nunca recibido, tanto en conteo como en corrección. Los seis casos terminaron con **un resultado y 480 kg**. Cuando corresponde cambiar autorizador, se cancela el identificador anterior y se usa uno nuevo. |
| **5. Pruebas nuevas** | **A medias** | Cubren eficazmente la reproducción original y la cancelación persistente. Toda la batería pasa conservando la duplicación entre pestañas. Faltan cruces de fallo de cancelación y algunas afirmaciones admiten implementaciones incorrectas. |

Sobre **la base y sus candados**:

- La fila única de `envio` decide entre reserva y cancelación. En los órdenes ejecutados no encontré un identificador simultáneamente asentado y cancelado.
- Conteo y corrección pueden comprobar la clave después de haber buscado un resultado inexistente. Cancelé mientras esperaban esa credencial: al continuar, ambos encontraron la cancelación en `reservar_envio` y recibieron `RC005`.
- `agregar_material` toma primero la cuenta; también comprobé que la cancelación puede adelantarse mientras espera ese candado.
- Por lectura, la cancelación no toma cuenta, credencial ni candado de patio. No introduce el orden inverso necesario para cerrar un ciclo con esos candados.
- Las cuatro entradas de inventario y `agregar_material` pasan por `reservar_envio` antes de asentar. Las funciones internas antiguas pueden escribir sin identificador desde administración, pero sus permisos no permiten usarlas como atajo desde la aplicación.

Sobre **la pantalla**:

- El doble toque está protegido mediante una referencia síncrona; pasan los recorridos correspondientes.
- Una recarga recupera el pendiente. Eso no impide que **dos pestañas tengan simultáneamente el mismo envío**.
- Ejecuté `RC011` seguido de fallo de cancelación en ambos formularios: `suelto` permanece falso, no permite abandonar el pendiente mediante la recuperación de `RC011`, y posteriormente el botón permite resolverlo.
- Con respuestas válidas del servidor no observé un falso «ya había quedado registrada» ni reproduje un pendiente sin salida después de recuperar el servicio.

## 3. Hallazgos nuevos, por gravedad

### Alta: el "primer intento" puede tener otro envío simultáneo en otra pestaña. Comprobado ejecutando.

Archivos: `src/componentes/inventario/piezas.tsx:72`. La misma excepción aparece en `src/componentes/mostrador/Mostrador.tsx:233`, aunque allí no reproduje la duplicación.

Reproducción exacta:

1. Con 500 kg, A envía merma de 10, «Mojado». Retengo la petición antes del servidor.
2. Desde A abro B mediante `window.open`: B hereda el `sessionStorage` con ese pendiente.
3. B pulsa «Volver a intentar». Retengo también esa petición y compruebo que lleva el mismo identificador.
4. Registro una salida de 495 kg.
5. Entrego la petición de A: el servidor devuelve `RC002`. A borra su pendiente **sin cancelar**, porque su llamada comenzó con `pendiente === null`.
6. Compruebo que el identificador sigue sin registro en `envio`.
7. Un conteo deja 105 kg.
8. Entrego B: responde **200**, dejando 95 kg.
9. A registra nuevamente con otro identificador: responde **200**, dejando **85 kg y dos mermas «Mojado»**.

**Corrección concreta:** ante un rechazo con regla, resolver el identificador en servidor también cuando la llamada local comenzó como primer intento. Solo soltar después de confirmar cancelación; si ya entró, recuperar ese desenlace. Aplicarlo también a `Mostrador.agregar`.

### Importante, condicionado a una respuesta inválida: el cliente interpreta ausencia de confirmación como cancelación. Comprobado mediante inyección de respuesta.

Archivo: `src/componentes/cliente.ts:73`.

Reproducción:

1. Retener la merma original, recargar, sacar 495 y recibir `RC002` al reintentar.
2. Interceptar la petición de cancelación y devolver **HTTP 200 con `{}`**, sin ejecutar la ruta.
3. La pantalla suelta el pendiente; compruebo que no existe cancelación en la base.
4. Contar 105, entregar el original y registrar nuevamente: **dos mermas y 85 kg**.

`r.entro ? "entro" : "cancelado"` interpreta un campo ausente como confirmación negativa. Por lectura, también interpretaría una cadena no vacía como confirmación de entrada.

**Corrección concreta:** exigir un objeto con `entro` estrictamente booleano. Cualquier respuesta distinta debe conservar el pendiente como resultado desconocido.

**Límite del hallazgo:** la ruta actual devuelve correctamente `{ entro: boolean }`; no observé que produzca `{}` por sí misma.

### Permisos: cancelar permite impedir un envío ajeno conocido; no deshacerlo. Comprobado en base.

Archivo: `db/migraciones/0018_cancelar_envio.sql:47`.

Mostrador, responsable y patio pueden cancelar cualquier UUID todavía no reservado. Consulta y administración quedan fuera de la ruta. No se comprueba propietario, equipo ni clase de operación.

En mis cruces, **patio canceló identificadores de conteo y corrección de mostrador** mientras esperaban la credencial. Ambos envíos quedaron impedidos.

No comprobar propietario **no rompe la exclusión entre asentar y cancelar**, pero sí permite esa interferencia si se conoce el UUID. No permite borrar movimientos ya asentados, y no demostré una manera de obtener identificadores pendientes de otro equipo.

Si se necesita impedirla, propongo vincular la resolución a una credencial del envío o al equipo que lo originó, manteniendo una recuperación autorizada. Exigir simplemente la misma persona rompería la recuperación cuando cambia quien atiende.

### Cobertura de las pruebas: qué puede pasar con código incorrecto. Visto por lectura, salvo la duplicación ejecutada.

- **`18-inventario`, cancelaciones:** comprueba persistencia, mensaje de cancelación, resultados, saldos y espera mediante barrera. Tiene afirmaciones útiles. La concurrencia de cancelación se ejercita con merma; faltaban las ventanas anteriores a reservar que ejecuté por separado.
- **Las dos pruebas de clave incorrecta:** no llaman a cancelar. Pasarían aunque la cancelación estuviera rota: demuestran precisamente que el reintento puede fallar mientras el original termina asentado.
- **`19-dominio`, cancelación por ruta:** comprueba ambos desenlaces y rechazo posterior; sí verifica efecto real.
- **`19-dominio`, destino contado:** comprueba rechazo y posterior destino permitido. La afirmación del rechazo acepta cualquier `RC005`; conviene exigir también el mensaje relativo al conteo.
- **`17-rutas`:** la entrada nueva espera código de error `null`. Una respuesta vacía sin error podría satisfacer esa afirmación aunque no cancelara nada. Conviene exigir estado 200, cuerpo booleano y registro persistente.
- **Recorridos de inventario:** los cruces generales inyectan `RC008`/`RC002`; prueban la reacción de pantalla, no que el servidor produzca esos rechazos en esas condiciones. La reproducción exacta de merma sí obtiene el rechazo real.
- **Recorrido de mostrador:** cubre original tardío impedido. Falta el desenlace equivalente donde el original ya había entrado y el reintento recibe una regla.

El cruce prioritario ausente es **primer intento vivo en A + pendiente heredado y enviado desde B + rechazo de A**. También deben incorporarse `RC011` con cancelación fallida y respuesta de cancelación inválida. Mis comprobaciones adicionales demostraron que el primer caso y el último conservan defectos; el de `RC011` funciona.

## 4. Lo que no comprobé

No hice una revisión nueva del bloque, construcción ni comprobación de tipos. No ejecuté mutaciones del código. No agoté todos los órdenes concurrentes ni fallos de almacenamiento o del GET de recuperación del mostrador.

La nueva duplicación entre pestañas quedó demostrada **en merma**; no la presento como reproducción ejecutada de conteo, corrección, separación o mostrador.
