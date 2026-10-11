# Revisión de Codex al bloque de inventario (2 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución. Se le pidió no modificar archivos del proyecto.
Dos partes: (1) comprobar que quedaron corregidos sus hallazgos de servidor y de pantallas de este
mismo día; (2) revisar el bloque de inventario ya implementado (migración 0017, dominio, rutas,
pantallas y pruebas). El informe está completo: no se le acabó la cuota.

La respuesta está en `2026-10-02-respuesta-a-la-revision-del-bloque-de-inventario.md`.

---

Encontré **dos defectos comprobados que alteran el inventario**. Las pruebas existentes pasan, pero todavía no daría este bloque por terminado.

## 1. Qué ejecuté y resultado

- Batería con `PG_PLANTILLA=feruga_plantilla_codex`: **520 aprobadas, 0 fallidas**.
- Recorridos: **34 aprobados**; un recorrido adicional de capturas quedó omitido porque requiere `CAPTURAS`.
- Reproducciones propias: elusión del conteo con igualdad de fechas; corrección, conteo y cierre concurrentes con barreras; permisos de funciones internas; y duplicación de merma en navegador.
- Bases propias y plantilla eliminadas; guiones y registros temporales eliminados. No reconstruí imágenes ni edité código o documentación.

**Incidencia de ejecución:** el comando literal de recorridos arrancó el `npm ci` definido en Compose, contrariamente a tu restricción. Lo detuve y ejecuté Playwright directamente, usando las dependencias existentes y montando el proyecto en solo lectura. No puedo afirmar que ese arranque inicial no tocara el volumen de dependencias.

## 2. Parte 1: correcciones de hoy

Las reproducciones siguientes se ejecutaron mediante las pruebas y recorridos existentes, cuyo contenido también revisé.

Servidor:

| # | Estado | Reproducción y resultado |
|---|---|---|
| 1 | **Corregido** | Vehículo de jornada cerrada, revisión válida y confirmación ordinaria: tanto mostrador como responsable reciben `403 RC008`. Por `terminar_vehiculo`, clave incorrecta devuelve `401 CLAVE` y suma un fallo; la válida confirma a nombre del responsable. |
| 2 | **Corregido** | Alta con `SESION_CLAVE` ausente y corta: `500`, sin crear equipo; salud devuelve `503`. Restaurada la clave, el mismo código permite el alta. |
| 3 | **Corregido** | Quitar material usando una cuenta inexistente devuelve `RC005`, en lugar del fallo interno anterior. |
| 4 | **Corregido** | Enviar una etiqueta con `\u0000` se rechaza por forma antes de llegar a PostgreSQL. La validación común también excluye los demás controles indicados en su expresión regular. |
| 5 | **Corregido** | Repetir una reimpresión con su mismo identificador y distinto motivo devuelve `RC005`; repetir el motivo con espacios exteriores conserva el resultado. |
| 6 | **Corregido** | La prueba instrumentada cuenta **una sola lectura** para materiales y básculas; la implementación los obtiene en una consulta. |
| 7 | **A medias** | Los dos arranques ahora demuestran espera y dejan un solo saldo. También existe la petición válida que prueba la puerta del vehículo. Sin embargo, la matriz general sigue enviando `{}` y acepta errores de forma como resultado suficiente para los roles permitidos: no acredita que sus acciones funcionen. |

Pantallas:

| # | Estado | Reproducción y resultado |
|---|---|---|
| 1 | **Corregido** | Compra 1 con 12.5 kg pendientes, Compra 2 abierta y detalle de Compra 1 demorado: no sale ningún envío durante la transición. Después, los 12.5 se envían exclusivamente a Compra 1. |
| 2 | **Corregido** | El servidor guarda el peso y se corta la respuesta: queda pendiente, no permite cambiar el peso y el reintento no duplica. También pasan recarga y pérdida antes de que el servidor lo reciba. |
| 3 | **Corregido** | Cambiar de cuenta durante la segunda pesada conserva lo tecleado por cuenta y no rompe la pantalla. |
| 4 | **Corregido** | Doble toque en la reimpresión con respuesta demorada: una petición y una impresión. |
| 5 | **Corregido** | El arranque interpreta `12,5` como **12.5 kg**, no 125. |
| 6 | **Corregido** | En ancho reducido, al desplazarse hasta el botón inferior las cuentas permanecen visibles. |
| 7 | **Corregido para mostrador** | Los nuevos recorridos interponen demoras y pérdidas y comprueban destino, contenido y número de envíos. Esa cobertura todavía no se aplica por completo al inventario. |

## 3. Hallazgos nuevos, por gravedad

### 1 — Bloqueante: recargar durante una merma pendiente permite descontarla dos veces. Comprobado en navegador y base.

Archivos: `src/componentes/inventario/Merma.tsx:50`, `src/componentes/inventario/Merma.tsx:60` e `src/componentes/inventario/Inventario.tsx:57`.

Reproducción exacta:

1. Iniciar con **500 kg de Cartón**.
2. Capturar merma de **10 kg**, motivo **Mojado**.
3. Interceptar `POST /api/inventario/merma`: ejecutar `route.fetch()` para que el servidor la asiente, pero retener la respuesta.
4. Recargar antes de entregarla.
5. La pantalla recupera el identificador, pero `incierto` sigue en `false`: permite editar. Cambiar el motivo a **Se tiró**.
6. Registrar: sale el **mismo identificador con otro contenido**. La base lo rechaza correctamente: «Ese envío ya se había recibido con otros datos».
7. Registrar nuevamente: el manejador del rechazo ya borró `envio`, por lo que genera otro identificador y registra una segunda merma.

Observado: dos movimientos de **−10 kg**, uno por cada motivo; existencia final **480 kg**, cuando la operación original debía dejar **490 kg**.

La protección comienza cuando llega el error de red. Una recarga anterior a ese error recupera un envío todavía editable.

**Corrección concreta:** persistir, antes de enviar, un registro pendiente con identificador y contenido completo e inmutable. Recuperarlo siempre bloqueado hasta resolver su resultado. Un rechazo por contenido distinto no debe descartar el identificador de una operación cuyo resultado anterior sigue desconocido. Aplicar el mismo contrato a las cuatro escrituras; la reproducción ejecutada fue la de merma.

### 2 — Importante: «el conteo manda» se puede eludir usando la misma hora efectiva del movimiento. Comprobado con permisos `feruga_app`.

Archivo: `db/migraciones/0017_inventario.sql:497`. La misma comparación aparece en la lectura: `src/servidor/dominio/inventario.ts:120`.

Reproducción exacta:

1. Confirmar una compra de **100 kg de Cartón**.
2. Obtener su `efectivo_en` como texto, conservando los microsegundos; llamarlo `t`.
3. Ejecutar `contar_material` con envío nuevo, contado **90**, `p_contado_en=t`, `p_registrado=100` y autorización válida.
4. Ejecutar `corregir_movimiento` sobre la compra original, objetivo **80 kg**, cero correcciones vistas y autorización válida.

Observado: ambas funciones aceptan. El conteo deja un ajuste de **−10** y la corrección agrega **−20**; la existencia termina en **70 kg**. Una nueva previa para `t` reconstruye también **70 kg**.

La reconstrucción del conteo incluye movimientos con `efectivo_en <= contado_en`, pero la protección de correcciones solo considera conteos con `contado_en > efectivo_en`. La igualdad queda cubierta por el conteo y desprotegida frente a la corrección.

**Corrección concreta:** usar el mismo límite inclusivo: un conteo con `contado_en >= efectivo_en` debe impedir las diferencias que afectarían a ese material. Ajustar también `yaContado` y agregar la regresión con timestamps idénticos.

### 3 — Menor: falta la cobertura de transiciones comprometida para inventario. Comprobado por lectura; los defectos anteriores sobreviven a toda la batería ejecutada.

Archivo: `recorrido/inventario.spec.ts:192`.

Los recorridos comprueban pérdida de respuesta de merma y conteo, y doble toque de merma. Faltan las respuestas demoradas y perdidas de separación y corrección, además de recargar **mientras** una escritura está pendiente.

La prueba de merma recarga después de que apareció el aviso de incertidumbre. Por eso pasa aunque exista el hallazgo 1.

**Corrección concreta:** añadir barreras antes y después del asiento y recargar antes de resolver la respuesta. Afirmar identificador, contenido enviado, número de movimientos y saldo final. Extender esos cruces a las cuatro acciones. No ejecuté pruebas de mutación.

## 4. Lo correcto y los límites de esta revisión

Comprobado ejecutando:

- Las pruebas de composición de correcciones cubren cambio de peso y material, anulación, ventas y mermas, rechazo completo por falta de existencia y repetición después de otra corrección.
- Dos correcciones concurrentes del mismo movimiento demuestran espera; la segunda rechaza la revisión desactualizada con `RC011`.
- Las correcciones de jornadas anteriores conservan el cierre anterior y asignan el ajuste a la jornada abierta, con la fecha efectiva del original.
- La aplicación no tiene permiso para ejecutar `asentar_conteo`, `registrar_conteo`, `autorizo_con_clave` ni `comprobar_clave` directamente.
- Las pruebas de clave incorrecta comprueban ausencia de asiento y persistencia del intento fallido.
- Pasan la validación de productos, conservación de separación, repetición y rechazo sin reservar el envío en los casos cubiertos.
- El recorrido de conteo confirma que la clave no aparece en `sessionStorage` ni `localStorage`.

En mi cruce adicional, detuve una corrección mediante una barrera dentro de la base desechable, lancé un conteo con otro autorizador y luego el cierre. Verifiqué las esperas y liberé la barrera: **no hubo interbloqueo**; terminó la corrección, el conteo recibió `RC011` y terminó el cierre. Quedaron **un envío y un resultado**, sin reserva del conteo rechazado. Esto acredita ese orden concreto, no todos los órdenes posibles.

Por lectura, `existencias` y `movimientosDe` usan una consulta cada una; los ajustes incluyen la referencia al original.

**No comprobé exhaustivamente** la baja o cambio de clave durante una autorización, todos los cruces contra confirmación de venta, medianoche y cambios de zona, materiales inactivos en todas las secuencias, posibles bloqueos excesivos del conteo ni todas las recuperaciones de las cuatro pantallas. Tampoco ejecuté construcción ni verificación de tipos. Cierro aquí el informe para entregar los hallazgos comprobados sin prolongar la investigación.
