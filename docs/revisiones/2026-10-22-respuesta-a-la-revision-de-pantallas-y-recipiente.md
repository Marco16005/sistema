# Respuesta a la revisión de Codex de las pantallas y el recipiente — 22 de octubre de 2026

La revisión (`2026-10-22-codex-revision-de-pantallas-y-recipiente.md`, encargo 33) terminó completa.
Dio por cerradas seis de las diez correcciones de la caja, el recipiente sin defectos, cinco de las
seis correcciones del rediseño, y no encontró un error de cálculo en Ganancia al cambiar de material
ni un saldo negativo de lo fiado en los cruces que probó. Dejó siete hallazgos; los siete se
corrigieron, cada uno con su prueba o su recorrido, que se vieron fallar antes.

| | Gravedad | Qué se hizo |
|---|---|---|
| **R33-3** Fiar dejaba soltar o cambiar un fiado que salió sin saberse | Alta | Mientras no se sepa, lo elegido queda fijo: no se cambia el cliente ni el plazo, «Regresar» y Escape no lo sueltan, y «No fiar» no está. Solo se manda lo mismo otra vez. Cambiar quién firma pregunta antes por la cuenta: si ya no está abierta, el fiado entró y se enseña su comprobante. Al cobrar normal, las formas de pago y «Descartar» se bloquean mientras un cobro no se sepa. Recorrido nuevo. |
| **R33-1** Contar un material o corregir un movimiento de inventario podían esperarse con mover dinero | Media | Migración **0044**: los dos toman la jornada antes que el patio y la clave, como todo lo demás. Pruebas nuevas de los dos cruces (antes daban 40P01). |
| **R33-2** Repetir «terminar un vehículo» con otra firma se daba por bueno | Media | 0044: si ya la terminó otra persona, se rechaza (RC011). Prueba nueva. |
| **R33-4** Si traer el comprobante de un cobro sin respuesta fallaba, se olvidaba | Media | Se queda pendiente hasta traerlo, o hasta que el servidor diga que no lo hay; se dice que falló y se intenta otra vez. Si hay varios, se enseñan uno por uno. Recorrido nuevo. |
| **R33-5** «De otro día» a 15 px sin ser un rótulo | Baja | A 17 px. Guardia nueva en `pruebas/27-estilo`. |
| **R33-6** El texto de la cuenta elegida se transparentaba (4.26 a 1) | Baja | Sin transparencia: queda como la letra de un botón lleno, que ya mide la guardia. La misma guardia nueva lo vigila. |
| **R33-7** Precios decía «ya se puede atender» aunque faltara contar el cajón | Baja | Dice «Antes de atender, falta contar el cajón» cuando falta, con la misma condición del mostrador. Dos recorridos lo esperan así. |

**Sus sospechas:** los precios ya no se pueden escribir mientras se guardan (se perdía lo escrito
en ese rato). La alta de un cliente nuevo al fiar sigue después de la clave: no puede ir antes,
porque con una clave equivocada la base no deshace nada y el cliente quedaría creado sin
autorización; el cruce que la haría esperar pide dos altas del mismo nombre nuevo a la vez con la
misma firma, y no se demostró. Lo del recipiente sin identificador al editarlo queda anotado: el
servidor lo protege con la revisión de la cuenta. **H6** (el recálculo histórico de 0039) sigue
como estaba dicho: no corre sobre ninguna base con historia.
