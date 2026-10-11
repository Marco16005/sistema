# Verificación de Codex a las correcciones del bloque de inventario — repetición (2 de octubre de 2026, noche)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución. Se le pidió no modificar archivos del proyecto.
Repite la verificación que por la mañana quedó incompleta
(`2026-10-02-codex-verificacion-de-las-correcciones-de-inventario.md`). Esta vez el informe está
completo.

La respuesta está en `2026-10-02-respuesta-a-la-verificacion-de-inventario.md`.

---

**La corrección original funciona, pero todavía hay una secuencia que duplica la merma.** La batería completa pasa; el defecto aparece al rechazar un reintento mientras el primer envío todavía puede llegar.

## 1. Qué ejecuté

- Batería con el comando indicado y `PG_PLANTILLA=feruga_plantilla_codex`: **527 aprobadas, 0 fallidas**.
- Recorridos con el comando indicado: **66 aprobados, 1 omitido** (capturas).
- Seis comprobaciones propias de conteos y correcciones: confirmaron los resultados descritos abajo.
- Tres reproducciones propias en navegador: confirmaron una duplicación y dos pendientes sin salida.

No modifiqué archivos dentro de `/Users/maantora/Desktop/feruga`, no instalé dependencias ni reconstruí imágenes. Eliminé mis guiones temporales, las bases propias de las comprobaciones y mi plantilla.

## 2. Los cinco puntos

| Punto | Estado | Reproducción y resultado |
|---|---|---|
| **1. Merma y regla de reintentos** | **A medias** | Repetí la reproducción original mediante el recorrido: 500 kg, merma de 10, servidor asienta, respuesta retenida y recarga. No permite cambiar el motivo; repite identificador y contenido; queda **un asiento y 490 kg**. Sin embargo, un primer envío demorado puede asentarse después de que un reintento recibió `RC002` y soltó el pendiente: comprobé **dos mermas con identificadores distintos**. |
| **2. «El conteo manda»** | **Corregido para el defecto señalado** | Compra de 100, conteo de 90 con el timestamp exacto de la compra, corrección a 80: **`RC005`, saldo 90**, lectura no corregible. También comprobé cambio de material, anulación y dos correcciones. La lectura y la base no expresan exactamente lo mismo en todos los casos; detalle abajo. |
| **3. Transiciones de inventario** | **A medias** | Pasan demora, pérdida, 502, envío no recibido, recarga, cambio de sesión y los rechazos añadidos. Falta **rechazo del reintento mientras el original sigue pendiente de entrega**, con cambio posterior de las condiciones. Toda la batería pasa conservando el defecto comprobado. |
| **4. Matriz de rutas** | **Corregido para el hallazgo 7** | La matriz envía cuerpos bien formados a las 21 rutas contempladas y exige la respuesta concreta prevista para cada rol. Ya no acepta cualquier error de forma como prueba suficiente. No demuestra éxito de todas las acciones para todos los roles permitidos. |
| **5. Mostrador** | **Corregido en el alcance revisado** | Pasan los cuatro casos de 502: primera y segunda pesada, antes y después de guardar. Si entró, aparece la cuenta actualizada; si no entró, queda el mismo envío para reintentar. Pasan también las regresiones anteriores de cambio de cuenta, pérdida de respuesta y recarga. No encontré una regresión atribuible a este cambio. |

Sobre los rechazos anteriores a recuperar el envío, revisó las cuatro funciones y sus rutas:

- **Merma:** `RC008` por usuario/rol; `RC004` por kilos; `RC005` por identificador o motivo.
- **Separación:** `RC008`; `RC005` por identificador, nota u origen inexistente; `RC007` por productos, cantidades o materiales inválidos.
- **Conteo:** `RC008`; `RC004` por cantidad; `RC005` por nota, identificador o datos de la previa ausentes. Si todavía no ve el resultado, la autorización puede devolver `RC008` o terminar como `CLAVE`.
- **Corrección:** `RC008`; `RC004`; `RC005` por identificador, motivo, movimiento inexistente/no corregible o material incompatible. La autorización tiene el mismo caso anterior.
- **Rutas:** las validaciones de forma pueden devolver `FORMA`; la puerta común también devuelve `ORIGEN`, `EQUIPO`, `SESION`, `ROL` o `PERSONA`, que conservan el pendiente.

Con contenido congelado y los cambios ordinarios disponibles en la aplicación, **no encontró otro rechazo previo a la recuperación que suelte un envío ya asentado**: las excepciones dinámicas identificadas, `RC008` y `CLAVE`, ahora se conservan. Pero eso **no prueba que un rechazo posterior a reservar el identificador descarte otro intento todavía en camino**. Ahí está la duplicación ejecutada.

Sobre lectura y conteo:

- Sin correcciones, la igualdad queda protegida.
- Tras cambiar de material, contar el original no bloquea modificar el actual; comprobado.
- Tras dos correcciones, sigue usando el material actual; comprobado.
- Anulado y posteriormente contado su material original: aparece `corregible=true`, pero restaurarlo allí recibe `RC005`.
- Un destino ya contado también puede recibir `RC005` aunque el movimiento aparezca corregible.
- Una corrección **sin diferencias** se acepta en la base aunque la lectura marque el movimiento no corregible.

Estos últimos casos muestran que `corregible` permite iniciar la operación, pero no garantiza cualquier objetivo. **No encontré que el límite inclusivo bloquee una modificación legítima del saldo:** el conteo ya incluye esa hora. La base tampoco bloquea operaciones sin diferencias.

## 3. Hallazgos nuevos, por gravedad

### Alta — Un rechazo del reintento no impide que el original llegue después. Comprobado en navegador y base.

Archivos: `src/componentes/cliente.ts:69`, `src/componentes/inventario/piezas.tsx:63`.

Reproducción exacta:

1. Partir de 500 kg de Cartón y capturar merma de 10, motivo «Mojado».
2. Interceptar el primer POST y retenerlo **antes de reenviarlo al servidor**.
3. Recargar; el pendiente se recupera correctamente.
4. Registrar otra salida de 495 kg: quedan 5.
5. Reintentar la captura original: recibe `RC002`. La pantalla borra el pendiente y vuelve a ofrecer registrar.
6. Registrar un conteo que deja 105 kg.
7. Liberar la entrega del primer POST retenido: responde **200** y deja 95 kg.
8. Pulsar registrar desde la pantalla: genera otro identificador y deja **85 kg**.

Observé **dos mermas «Mojado» de 10 kg**. La demora se simuló mediante una barrera de Playwright y entrega posterior con `route.fetch()`.

**Corrección propuesta:** conservar los rechazos de resultado incierto hasta resolver el identificador de manera definitiva. Incorporar una resolución/cancelación en servidor, serializada por identificador, que devuelva el resultado existente o deje una cancelación persistente que impida asentarlo posteriormente. Consultar «todavía no existe» sin impedir una llegada tardía tampoco basta.

### Importante — Baja del autorizador deja conteo y corrección sin recuperación operativa. Comprobado en ambos formularios.

Archivos: `src/componentes/inventario/Contar.tsx:128`, `src/componentes/inventario/Corregir.tsx:100`, `src/componentes/Autorizar.tsx:31`.

Reproducción:

1. Enviar con Servando como autorizador y cortar la petición antes de llegar.
2. Dar de baja a Servando.
3. Reintentar: llega `RC008`, se conserva el pendiente y no existe asiento.
4. Regresar, ir al mostrador y volver a inventario: sigue el mismo pendiente, sin poder elegir otro autorizador ni abandonar la captura.

**Sí importa en operación:** bloquea el flujo de inventario de esa pestaña, aunque el mostrador siga accesible.

**Corrección propuesta:** permitir que otro responsable resuelva el envío mediante el mecanismo anterior. Si ya entró, recuperar su resultado; si se cancela definitivamente, permitir una captura nueva con autorización nueva. No cambiar el autorizador dentro del mismo envío.

### Menor — La prueba de cambio de rol no repite idénticamente el conteo. Visto por lectura.

Archivo: `pruebas/18-inventario.test.ts:681`.

La función `contar` llama de nuevo a `contarMaterial` sin conservar `visto`; este auxiliar obtiene otra previa. Cambian la hora y potencialmente lo registrado. El `RC008` llega antes y la prueba pasa igualmente.

**Corrección propuesta:** obtener una sola previa y reutilizarla en ambos intentos; afirmar también que sus argumentos son idénticos.

Las demás pruebas nuevas afirman lo siguiente:

- **Jornada cerrada:** sí repite los cuatro envíos y comprueba recuperación del resultado y saldos.
- **Cambio de rol:** sí demuestra `RC008` pese a existir resultados; tiene la salvedad del conteo anterior.
- **Clave incorrecta con primer intento pendiente:** sí demuestra espera, rechazo y posterior asiento del primero, **solo para conteo**.
- **Material donde cuenta hoy:** sí demuestra ambos sentidos y una segunda corrección. No cubre por sí sola anulación ni destino contado.

Los recorridos nuevos tienen afirmaciones útiles sobre cuerpos, identificadores, asientos y saldos. Sin embargo, los de clave incorrecta abortan el primer envío: **no ejecutan la carrera concurrente**. Tampoco ejecuté aquí las mutaciones mencionadas en la respuesta anterior.

## 4. Lo que no comprobé

No hice una revisión nueva del bloque, construcción ni verificación de tipos. No comprobé dos pestañas simultáneas en las cuatro acciones, todos los órdenes concurrentes, fallos de `sessionStorage` ni un fallo adicional del GET de recuperación del mostrador. La duplicación tardía quedó ejecutada en merma; no la extrapolo como reproducción demostrada de las otras tres acciones.
