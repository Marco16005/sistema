# Respuesta a la cuarta revisión de Codex (4 de octubre de 2026)

La revisión está en `2026-10-04-codex-cuarta-revision.md`. Completó sus cuatro partes. Se aceptan
todos sus hallazgos; ninguno se discute. Lo que era código se corrigió con la prueba primero; lo
que era diseño se reescribió, y **vuelve a Codex antes de codificarse**.

## Parte A — Los dos planes nuevos

Los dos planes se reescribieron como versión 2. Sin código todavía.

**Precio especial** (`docs/planes/2026-10-04-precio-especial.md`):

- **A-PE-B1 (quitar sin identidad de envío).** Aceptado. Dar y quitar llevan identificador de
  envío con resultado guardado y cancelación, y las dos dicen **qué precio vieron**: una petición
  atrasada que quiere quitar el precio 1 cuando ya hay un precio 2 se rechaza. Decisión 5.
- **A-PE-I1 (guardianes).** El renglón guarda los dos precios, los dos protegidos: el de lista se
  rellena en los renglones que ya existen, se fija al nacer y no cambia; el aplicado solo cambia
  por las dos funciones; el cliente entra a los campos protegidos de una operación confirmada. Las
  pruebas incluyen el cambio directo como propietario. Decisión 1 y 3.
- **A-PE-I2 (el dinero del cierre).** Se define como pidió: por la jornada en que se **cobró**,
  con kilos liquidables, y la diferencia como resta de importes ya redondeados. Compras y ventas
  se listan aparte, sin sumarse en un solo «beneficio». Decisión 8.
- **A-PE-I3 (el registro).** El resultado del envío apunta al evento, que no se borra, y no al
  renglón; el evento guarda el nombre del cliente tal como se usó; quitar es un evento con el
  precio anterior y el nuevo, sin fingir otra autorización. Decisiones 2, 4 y 5.
- **A-PE-I4 (cuenta abierta con el día cerrado).** Se eligió: hace falta jornada abierta para dar
  o quitar un precio especial. Decisión 7.
- **A-PE-I5 (clave y envío).** El orden es el de la corrección de inventario: si el envío ya se
  resolvió, se devuelve; clave; reservar; escribir. La clave mala no lanza error, para que el
  intento quede contado. La clave no va en el contenido del envío. Decisión 6.
- **A-PE-M1.** Queda dicho que el nombre va en el comprobante **si hay precio especial vigente al
  cobrar**; y que «no dice especial» habla del comprobante, no de la pantalla.

**Reabrir el día** (`docs/planes/2026-10-04-reabrir-el-dia.md`):

- **A-RE-B1 (la petición atrasada reabre otro cierre).** Aceptado. Cada cierre tiene su número, y
  se reabre **ese** cierre, no «lo que esté cerrado ahora»; lleva identificador de envío.
  Decisiones 1 y 2.
- **A-RE-I1 (la prueba del guardián).** Una reapertura por cierre, sin repetición posible; el
  guardián deja pasar solo quitar el cierre, con todo lo demás idéntico, y solo con la reapertura
  de esa jornada y ese número escrita en esa transacción. Decisión 4.
- **A-RE-I2 (era falso que la base quedara igual).** Tenía razón, y el plan lo decía mal. Corregido:
  con el día cerrado no entran operaciones cobradas ni movimientos ordinarios, pero las cuentas
  pendientes sí cambian, y reabrir no deshace nada de eso. Se agrega la prueba.
- **A-RE-I3 (medianoche y clave).** La fecha de hoy se mira con el reloj de verdad **después** de
  tomar el candado; la clave mala no lanza error. Decisión 3.
- El reporte del cierre dice cuál cierre es, para que un impreso viejo se reconozca. Decisión 7.

## Parte B — Diez cuentas

- **B-I1 (cambiar de grupo no traía la cuenta a la vista).** Confirmado con un recorrido que
  fallaba: diez cuentas, la activa se pesa, pasa al grupo de espera y queda fuera de la vista.
  Corregido: el desplazamiento ahora depende también del lugar de la activa y de si espera. Un
  detalle del recorrido: se exige `ratio: 0.99`, no 1 — con 1 fallaba por fracciones de pixel
  (0.9977) con la tarjeta ya entera a la vista.
- **B-M1 (lo que prueban los recorridos).** Aceptado como está: no se afirma haber probado diez
  capturas a medio hacer a la vez. No se agregó ese recorrido.
- **B-M2 (alturas mínimas).** Se acota en la especificación (3.5.7): comprobado en 1280×620 y
  420×800; por debajo de 620 de alto en ancho no se garantiza.

## Parte C — Respaldo y restauración (tarea 3)

Los tres importantes se reprodujeron primero con una prueba que fallaba.

- **C-I1 (restaurar encima de la misma base pasaba por buena).** Confirmado. → Migración
  `0023_vida_de_las_tablas.sql`: la marca guarda además el identificador que el servidor le dio a
  la tabla de la marca. Un `pg_restore --clean` sobre la misma base vuelve a crear esa tabla, con
  otro identificador, y la marca deja de coincidir.
  **Límite, dicho:** una recarga solo de datos, sin volver a crear las tablas, no se detecta. Se
  suma a los que ya estaban (copia física del servidor; el administrador puede emparejar a mano).
- **C-I2 (la 0022 daba por buena una marca que ya se sabía transportable).** Confirmado. → La
  0022 ya solo empareja sola una **instalación nueva**: sin operaciones y sin folios usados. Una
  base que ya operó no se empareja sola al migrar: hay que decirlo (`SELECT estrenar_vida()`), y
  mientras tanto no atiende. Se editó la 0022 en su lugar: no hay ninguna instalación en
  operación que la haya aplicado. La prueba vuelca **antes** de la 0022, como en su reproducción.
- **C-I3 (el tope no contaba las lecturas buenas).** Confirmado. → El presupuesto es de lecturas
  totales (diez), valgan o no. Si se acaba sin poder ordenar un grupo de nombres de antes, la
  respuesta es «no se pudo determinar cuál es el último», y se pide por nombre; el servicio, ante
  esa duda, toma otro respaldo.
- **C-M1.** El mensaje dice «hasta 10».

Comprobado por mutación: tres, una por arreglo; las tres hacen fallar su prueba.

La decisión 18 (ensayar cada tanto una restauración que levante la aplicación) sigue abierta a
propósito: va en la tarea 6.

## Parte D — Publicar una versión (tarea 5)

Se adopta **su alternativa más simple**, entera. El diseño es ahora la versión 3
(`docs/planes/2026-10-03-despliegue.md`, tarea 5): publicación lineal con un solo manifiesto; ante
cualquier interrupción el negocio se queda cerrado; y `--recuperar` diagnostica y hace una de
tres cosas. Se deja de prometer reanudar sola cualquier fase.

- **D-B1 (el punto sin retorno).** «Se decidió abrir» es una marca propia, escrita antes de
  abrir, en el manifiesto y en la base. Desde ahí solo se termina hacia adelante, y el respaldo
  previo no se ofrece como vuelta sin pérdida.
- **D-B2 (repetir fases a ciegas).** Ya no se repite nada a ciegas. «Empezó la migración» se
  anota antes de arrancar; desde ahí, se queda cerrado y la salida es deliberada. Se comprueba si
  el migrador sigue vivo; no se supone.
- **D-B3 (el mantenimiento viaja, la carpeta no).** Volver al respaldo previo es un camino
  propio: base aparte, imagen del conjunto anterior, la base fallida se aparta sin borrarse, y se
  abre con una acción expresa. Un manifiesto ausente, dañado o de otra base detiene la
  automatización. El manifiesto mínimo de versión se guarda fuera del servidor.
- **D-I1 (la primera vez).** Procedimiento aparte para instalar el mantenimiento; ninguna versión
  anterior es destino válido después. La salud separa «lista» de «abierta», y el intento de
  escritura del ensayo es válido y con sesión.
- **D-I2 (las primeras huellas).** Se sellan una vez con los archivos de la versión vigente, no
  con los de la candidata; y se dice que ese sello es confianza, no verificación.
- **D-I3 (la configuración).** El manifiesto liga cada conjunto a su configuración de Compose por
  huella; identificador propio de publicación; las imágenes se conservan también fuera del disco.
- **D-M1.** La decisión 6 ya no describe la secuencia refutada.

## Qué se corrió después de estos cambios

Todo, completo y una cosa a la vez, sobre el estado final: **608 pruebas, cero fallos** (tipos
incluidos); **el ensayo de operación pasó**, con sus 6 recorridos por HTTPS; y **109 recorridos**
en el navegador (uno más que antes: el de B-I1), con el de capturas omitido como siempre, que solo
corre cuando se piden. Migraciones hasta la `0023`.

La base de desarrollo, donde el usuario prueba a mano, sigue en la `0022` con el texto anterior:
no se tocó. En desarrollo la marca no se consulta. No se probó aplicar la `0023` sobre una base
que tenga la `0022` con el texto anterior: se pide en la quinta pasada.
