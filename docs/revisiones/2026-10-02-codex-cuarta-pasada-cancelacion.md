# Cuarta pasada de Codex sobre el bloque de inventario: la cancelación sin excepciones (2 de octubre de 2026, noche)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución. Se le pidió no modificar archivos del proyecto.
Verifica lo que se cambió en respuesta a su tercera pasada
(`2026-10-02-respuesta-a-la-verificacion-de-la-cancelacion.md`). Informe completo.

La respuesta está en `2026-10-02-respuesta-a-la-cuarta-pasada.md`.

---

**Las dos correcciones principales funcionan:** la reproducción original termina con **una merma y 95 kg**, y ninguna de las cinco respuestas inválidas libera el pendiente. Quedan una debilidad de confirmación bajo UUID reutilizado y el riesgo operativo declarado de registrar nuevamente desde ambas pestañas.

## 1. Ejecución y resultados

- Batería con el comando indicado y `PG_PLANTILLA=feruga_plantilla_codex`: **535 aprobadas, ninguna fallida**.
- Recorridos con el comando exacto indicado: **84 aprobados, uno omitido** (capturas).
- **Ocho comprobaciones propias de navegador:** secuencia de dos pestañas y continuación del límite declarado; cinco respuestas inválidas; UUID reutilizado; recuperación de memoria sin `pendiente` y con pendiente.
- Un guion propio agotó el tiempo por un selector de diagnóstico incorrecto. Corregí solo ese guion temporal y repetí el caso: pasó.

No modifiqué archivos del proyecto, no instalé dependencias ni reconstruí imágenes. Eliminé los guiones, mi plantilla y las bases de prueba propias; restablecí la base de recorridos desde su plantilla existente.

## 2. Los cinco puntos

| Punto | Estado | Reproducción y resultado |
|---|---|---|
| **1. Dos pestañas, mismo envío** | **Corregido** | Reproducción propia con `window.open`: A manda; B hereda y manda exactamente el mismo cuerpo; salen 495; A recibe `RC002` y deja el UUID **cancelado**; conteo a 105; B recibe **409/RC005**; A registra con otro UUID. Resultado: **una merma «Mojado», 95 kg**. |
| **2. Cancelación inválida** | **Corregido** | Inyecté HTTP 200 con `{}`, `{"entro":"no"}`, `{"entro":null}`, texto no JSON y cuerpo vacío. En los cinco casos permaneció el mismo UUID, sin cancelación en base, sin edición ni mensaje de éxito. El siguiente reintento válido dejó **una merma y 490 kg**. |
| **3. Caminos para soltar y confirmaciones falsas** | **A medias, con salvedad condicionada** | La cancelación del primer intento, `soltar`, `suelto` y la recuperación por UUID funcionan. No reproduje abandono peligroso en los flujos normales examinados. Sí comprobé un falso «ya había quedado registrada» **forzando un UUID ya usado con otro contenido**; detalle abajo. |
| **4. Pruebas nuevas** | **A medias** | Todas pasan y las afirmaciones de cancelación persistente detectan la excepción antigua. Algunas pruebas aisladas también pasarían omitiendo la consulta de cancelación; detalle abajo. |
| **5. Límites declarados** | **Sin corregir, deliberadamente** | **(a)** La amplitud de permisos permanece; la considero aceptable en el escenario indicado. **(b)** Ejecuté la continuación: después de cancelar el UUID compartido, registrar en ambas pestañas deja **dos mermas y 85 kg**. Recomiendo corregir esa interacción. |

Precisiones del punto 3:

- **`enviar` y `agregar`:** ante una regla, ambos resuelven el identificador también en el primer intento. Una cancelación fallida conserva el pendiente.
- **Conteo, corrección y autorizador:** `soltar` solo libera tras una respuesta válida. `RC011` cambia de pantalla únicamente si `suelto` es verdadero. «Autoriza otra persona» mantiene la persona del pendiente cuando no logra resolverlo. Los recorridos correspondientes pasaron.
- **`refrescar`:** libera cuando encuentra **el UUID de la línea**, no simplemente otro renglón del mismo material. Eso es evidencia de entrada. También elimina memorias de cuentas que dejaron de estar abiertas: literalmente no cancela esos UUID, pero la cuenta terminada impide agregarles renglones tardíos. Esta última justificación la comprobé solo por lectura.
- **Segunda pesada:** la razón se sostiene **para impedir duplicados**. La función bloquea la cuenta, comprueba la segunda pesada existente y la base exige unicidad de `(linea_id, orden)`. No garantiza que gane el peso corregido: si llega antes el original, prevalece ese. No equivale a cancelar la pesada anterior.
- **Memoria anterior:** comprobé que una merma guardada sin el campo `pendiente` conserva el formulario; cuando sí contiene pendiente, la recarga conserva su UUID. El mostrador completa campos ausentes con valores iniciales y conserva los existentes. **Una versión que nunca guardó el identificador no permite reconstruirlo:** no presento esa compatibilidad como recuperación garantizada de cualquier versión histórica.

Sobre los límites del punto 5:

**(a)** Para una o dos computadoras y personal autorizado, aceptaría el riesgo descrito: conocer un UUID permite impedir una operación todavía no asentada, pero no deshacerla; queda atribución de la cancelación. No encontré en esta pasada una vía para descubrir pendientes de otro equipo. No propondría atarlo simplemente a la persona, porque perjudicaría la recuperación al cambiar quien atiende.

**(b)** Merece una corrección de interacción incluso con una computadora: basta duplicar una pestaña. La segunda muestra exactamente:

> Ese envío se canceló porque no se supo si había llegado: ya no se asienta

Debajo conserva **Cartón, 10.000 kg, motivo Mojado**, y ofrece **«Registrar la merma»** y **«Corregir los kilos»**. No sabe ni avisa que A puede estar registrando de nuevo esa captura. Propongo bloquear el registro simultáneo de una captura heredada mediante coordinación entre pestañas, permitiendo una transferencia explícita de control. El aviso actual, por sí solo, no evita el error humano.

## 3. Hallazgos nuevos, por gravedad

### Importancia media, condicionada: «entró ese UUID» se interpreta como «entró esta captura». Comprobado ejecutando.

Archivos: `src/componentes/inventario/piezas.tsx:77`, `src/componentes/inventario/Merma.tsx:39`, `db/migraciones/0018_cancelar_envio.sql:57`.

Reproducción:

1. Con 500 kg, asenté una merma de **20 kg, «Otra captura»**, con UUID conocido.
2. Preparé en pantalla **10 kg, «Mojado»**.
3. Forcé que el generador devolviera aquel UUID en este primer intento.
4. El servidor rechazó el contenido distinto con `RC005`; la cancelación respondió que el identificador ya había entrado.
5. La pantalla afirmó **«Esa merma ya había quedado registrada: 10.000 kg de Cartón»**. En base había **480 kg y ninguna merma «Mojado»**.

La prueba exige reutilización artificial del UUID; **no demostré que el flujo normal genere esa condición**. Corrección concreta: distinguir conflicto de contenido de otros rechazos y verificar clase/contenido antes de afirmar que esa captura quedó registrada. Un conflicto debe conservar su explicación, sin convertirse en éxito.

### Importancia baja: ciertas afirmaciones no identifican qué mecanismo produjo la recuperación. Visto por lectura; no ejecuté mutaciones.

Archivos: `recorrido/transiciones.spec.ts:242`, `recorrido/inventario.spec.ts:700`, `recorrido/inventario.spec.ts:740`.

- **Original del mostrador ya asentado:** podría pasar aunque se omitiera cancelar, porque `refrescar` encuentra el UUID y recupera la cuenta. Agregar una afirmación de petición de cancelación y su respuesta comprobaría específicamente esa rama.
- **Cancelación inválida y `RC011` con cancelación fallida:** consideradas aisladamente, pasarían con una implementación que nunca llamara a cancelar y siempre conservara el pendiente. Conviene afirmar que se intentó resolver **ese UUID**.
- **Dos pestañas, merma rechazada y peso rechazado:** sus resultados y consultas de cancelación persistente sí detectan la antigua excepción del primer intento.
- **Dominio, destino contado:** exigir código y mensaje específico corrige la debilidad anterior.
- **Dominio, cancelación por ruta:** estado 200, cuerpo booleano, fila persistente y autor identificado verifican efecto real. Queda una omisión menor: la rama `entro:true` comprueba el cuerpo, pero no explícitamente el estado HTTP.

La continuación de ambas pestañas hasta dos mermas confirma el límite ya declarado; **no la presento como defecto nuevo del protocolo de cancelación**.

## 4. Lo que no comprobé

No agoté órdenes concurrentes, fallos de almacenamiento, fallos adicionales del GET de recuperación ni formatos históricos completos de `sessionStorage`. No repetí la duplicación entre pestañas para las otras acciones, ni ejecuté una carrera propia de segunda pesada. No hice construcción, comprobación de tipos ni revisión nueva del bloque.
