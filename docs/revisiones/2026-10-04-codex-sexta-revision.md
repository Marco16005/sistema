# Sexta revisión de Codex: lo que faltó de la quinta, los planes ajustados y dos planes nuevos (4 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto. **Completa**: partes A, F, E, D y G por lectura; C con una
batería y reproducciones dirigidas; B por lectura y con un recorrido. Sobre una copia en
`/tmp/feruga-codex-qa6/`. Es el informe tal como lo entregó.

**Veredictos.** Se pueden codificar: **reabrir el día** (primero), **precio especial** en su
versión 4, **el comprobante por duplicado** y las **tareas 0 y 1 del rediseño**. La cuenta activa
a la vista (diez cuentas): conforme. **La tarea 3 sigue sin cerrarse**: dos huecos más en la marca
de restauración (A6-C-I1 y A6-C-I2). Publicar: precisar el relevo a una versión corregida
(A6-D-I1). El respaldo diario: precisar qué pasa con los días pendientes y cómo se reconoce que
un día ya tiene el suyo (A6-G-I1 y A6-G-I2). Ningún bloqueante nuevo.

**Sobre los «cambios concurrentes» que anota al final:** son míos. Mientras Codex revisaba, ajusté
el plan de precio especial con su hallazgo A6-PE-I1 (que él mismo leyó y dio por resuelto) y
programé el comprobante por duplicado, que ya había aprobado como plan. Su veredicto de la parte F
es sobre el plan: **la implementación del duplicado no la ha revisado**, y va en la siguiente pasada.

La respuesta está en `2026-10-06-respuesta-a-la-sexta-revision.md`.

---

# Sexta revisión de calidad — 2026-10-04

- [x] Parte A — Reabrir y precio especial v3
- [x] Parte F — Comprobante por duplicado
- [x] Parte E — Rediseño v2
- [x] Parte C — Marca de restauración
- [x] Parte B — Cuenta activa
- [x] Parte D — Publicar v4
- [x] Parte G — Respaldo diario
- [x] Comprobación final y limpieza

Trabajo exclusivo en `/tmp/feruga-codex-qa6/sistema`, copia sin `node_modules` ni `.next`. Huellas SHA-256 iniciales de todos los archivos bajo el proyecto original guardadas en `huellas-inicio.json`. Horas de arranque originales registradas en `contenedores-inicio.txt`.

## Parte A — Completa, solo lectura

**Reabrir: sí se puede codificar como está**, primero, en 0024. A5-RE-I1 queda resuelto por decisiones 1–2 y 6: jornada + número de cierres observado + envío; el mismo envío devuelve el resultado histórico y una orden nueva obsoleta falla. Contador monotónico bajo candado, relleno de jornadas existentes, permisos, reporte, rutas, retrato y adaptación de pruebas/recorridos están incluidos. Mantener el cierre exclusivo sobre jornada, sin bloquear cuentas, conserva el orden de `linea_nace`, confirmación e inserción de movimiento (0005, 0007, 0006); la cuenta de cierres no exige cambiar sus importes ni sus movimientos.

**Precio especial: no codificar literalmente hasta corregir A6-PE-I1.** A5-PE-I2 (cuenta → renglón → jornada FOR SHARE y reloj real después de esperar) y A5-PE-I3 (contenido completo, acción/evento observado y clave solo al dar) sí están resueltos. A5-A-M1 también: precio va después de 0024 y `RC012` es correcto desde 0019; la observación anterior sobre `RC005` quedó desactualizada. A5-PE-I1 cubre la transición exacta y el evento aislado en el caso dar → dar, pero introduce el siguiente problema al quitar.

**A6-PE-I1 · Importante — Vaciar `precio_evento` al quitar rompe la cadena y vuelve indistinguibles dos estados de lista.** Evidencia: plan de precio, líneas 125–138, 144–160. P1 nombra como anterior NULL; quitar crea Q1 que deshace P1, pero el renglón vuelve a NULL porque está a precio de lista. Q1 no es vigente ni anterior de otro evento al terminar esa transacción: el guardián diferido propuesto rechazaría una operación válida. Si se exceptúa quitar para permitirla, la siguiente alta vuelve a partir de NULL; una petición retenida que observó NULL antes de P1 vuelve a ser aceptable después de Q1. Incluso la reutilización P1 → Q1 → P1 dentro de una transacción vuelve a coincidir con el anterior NULL y precio de lista, contra la promesa de un uso.

Corrección concreta: `precio_evento` debe conservar el último evento de **ambas** clases, incluido quitar; NULL solo si nunca hubo evento. El especial vigente se deriva de la clase dar del último evento, y quitar restaura precio/lista, cliente e indicador de autorización activa sin borrar la cabeza de la cadena. Separar expresamente autorizante/cliente históricos del evento quitar de los campos activos que se vacían (hoy también se exige que sean «los que quedan»). Comprobar al commit que todos los eventos nuevos son alcanzables desde la cabeza del renglón, no solo que algún evento los cite. Añadir dar → quitar → dar; dar → quitar → reuso de P1 como dueño en la misma transacción; y una alta nueva atrasada que observó NULL antes de dar/quitar. No requiere cambiar confirmar ni la fórmula de inventario; sí que revisión y cliente sigan cada transición.

## Parte F — Completa, solo lectura

**Sí se puede codificar como está. Sin hallazgos importantes ni bloqueantes.** Un solo `window.print()` y una fila `impresion` por solicitud siguen siendo coherentes; dos cuerpos de papel no son dos envíos. Elegir el duplicado por **`impresion.numero === 1` devuelto por el servidor**, no por `comprobante.impresiones`, por «acabo de cobrar» ni por el motivo: 0016 devuelve el registro original al repetir el UUID, incluso si después hay más impresiones. La primera manual también devuelve número 1. Una respuesta perdida no debe crear otra impresión: al resolver/reintentar la misma, imprime las dos copias de esa primera; una reimpresión real (número > 1) imprime una con su motivo. El navegador no certifica papel salido y cancelar su diálogo no revierte el registro: es el límite existente, no una regresión del duplicado. Si se pierden ambas copias, habrá que pedir dos reimpresiones de una copia cada una, coherente con la decisión del usuario.

**Decisión 2, inventario de localizadores:** no encontré un recorrido actual que pase a resolver dos coincidencias por los textos interiores si la segunda copia no usa `.ticket`. Los de `dia-completo` (57–66, 76–82, 99), `dos-jornadas` (67–71, 101–105), `cruces` (31, 37, 148), `transiciones` (401, 410), `operacion` (71–73) y `capturas` (62) ya acotan sus afirmaciones a `.ticket`. Los `getByText` globales restantes consultan mensajes de flujo, no contenido duplicado del comprobante. Ocultar con CSS/aria no elimina nodos de una búsqueda por texto: conservar esta revisión para cada selector nuevo. `contarImpresiones` (apoyo:57–64) solo sustituye `window.print` por un contador; los valores 1 y 2 siguen siendo correctos y no acreditan las copias ni la paginación.

**A6-F-M1 · Menor — Precisar la prueba de la impresión incierta.** Añadir expresamente respuesta perdida al registrar la primera → mismo UUID → número 1/dos cuerpos/un envío al papel; y resolver una primera antigua cuando el total de impresiones ya es mayor. Las tareas nombran primera manual y reimpresión, pero no este cruce. Es una precisión de aceptación, no una necesidad de cambiar servidor.

En CSS, sustituir la posición absoluta individual actual (`globals.css:266`) por un contenedor de impresión con ambas copias en flujo: copiar `top:0` a los dos cuerpos los superpondría e impediría el salto. Verificar el papel largo, la leyenda y el salto con medio print/PDF además del contador. El plan ya exige esta verificación y reserva el cortador físico para el equipo real. Este cambio va antes de la tarea 0 del rediseño.

## Parte E — Completa, solo lectura

**Sí se pueden empezar las tareas 0 y 1**, tomando la línea base después del duplicado. E-I1 a E-I5 y E-M1 quedan atendidos en el diseño: dueño del estado y un árbol estable; se retira `/react`; Roboto Mono/CSS impreso aislados; cookie con tres estados y ruta independiente de la base; equivalencias de localizadores; respuesta visual al apoyar y acción al soltar. La tarea 1 incorpora las pruebas que faltaban y la 8 reconoce que los equipos reales siguen pendientes. No volví a auditar los paquetes ni las rutas ya revisadas en la quinta pasada.

La elección de `<dialog>` **es viable** en Safari iOS con soporte de diálogo (desde Safari 15.4), Chrome Android y Edge/Chrome Windows actuales. Debe abrirse con **`showModal()`**, no con `open`, `show()` o solo CSS; así entra en la capa superior sin mover su nodo del árbol. No atribuirle por ello bloqueo automático del scroll de la página ni conservación del teclado virtual. [WebKit, diálogo nativo](https://webkit.org/blog/12209/introducing-the-dialog-element/).

Precisiones para implementar y aceptar la decisión 9 (sin cambiar su arquitectura):

- La sincronización ha de atender también `close`, no únicamente un efecto dependiente de `abierta`: si el navegador cierra y la prop sigue en true, esa prop no ha cambiado y tal efecto no se ejecutaría. En `cancel` impedir el cierre cuando sea cancelable; en `close`, consultar el estado **actual** del dueño, reaparecer solo si sigue abierto y conectado. Evitar que el cierre diferido de una limpieza de StrictMode reabra algo que el dueño ya cerró. `close()` del DOM no cancela el envío ni desmonta hijos. [HTML, algoritmos de diálogo](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element).
- La reapertura nativa puede mover el foco: guardar por separado el disparador original y el último control interior; restituir este al reabrir, con su selección cuando proceda. Volver al disparador o destino alternativo solo al cierre aceptado. Dar nombre accesible y foco inicial explícitos; probar la hoja ocupada sin botones habilitados. No prometer que el teclado de móvil continúe abierto después de un cierre impuesto: comprobar que la captura y UUID sobreviven y que se puede seguir/resolver.
- Bloquear el desplazamiento del fondo y restaurar su posición, con scroll interior alcanzable; probar rueda, toque, límites y zoom. El teclado de iOS/Android puede reducir solo el viewport visual; `100dvh` no garantiza por sí solo botones encima del teclado. En Android se puede optar por `interactive-widget=resizes-content`; no extrapolarlo a Safari. [Chrome, teclado y viewports](https://developer.chrome.com/blog/viewport-resize-behavior/).
- Para imprimir, ocultar diálogo y `::backdrop` en CSS de impresión sin cerrarlo ni remontar Ticket: cerrar/reabrir para imprimir dispararía precisamente la sincronización anterior. Si el comprobante acaba dentro de un diálogo, su contenedor debe tener reglas de print que lo saquen del recorte y del alto máximo. Comparar ambas copias contra la línea base, con hoja abierta y contraste cambiado, como ya exige la tarea 1.

No certifico teléfonos físicos a partir de documentación o WebKit de escritorio. El plan ya reserva esa comprobación para la tarea 8; no es un impedimento para codificar 0 y 1. Sin hallazgos nuevos bloqueantes/importantes en esta parte.

## Parte C — Completa, con ejecución

**Batería única: 611/611, cero fallos, cero omitidas; tipos aprobados.** Duración de las pruebas: 95.83 s. Se ejecutó `docker compose --profile pruebas run --rm pruebas` mediante `compose.sh`, con proyecto `feruga_codex_qa6`, `PG_PLANTILLA=feruga_plantilla_codex`, bases/almacén propios sin puertos publicados. `COMPOSE_FILE` combina el original intacto y `compose.qa6.yml`; únicamente se sustituyeron imágenes/conexiones de montaje y el comando que instalaba dependencias. Se reutilizaron dependencias copiadas de una imagen existente de administración, sin `npm ci` ni `npm install`. Evidencia completa: `bateria.log`.

**Las dos reproducciones anteriores ya se rechazan:** excluir `public.vida` y restaurar con `--clean` da `vida_vigente=false`, `vida_abarcar=false`; restaurar el respaldo de 0022 encima y migrar aplica 0023 y queda `vida_vigente=false`. No se registró ni emparejó después de restaurar. La primera base se empareja antes del respaldo para representar una instalación válida.

Pruebas dirigidas adicionales, una a la vez (`sistema/qa6-repro.ts`, `reproducciones.log`):

| Caso | Resultado |
|---|---|
| Lista `-L`, solo definición y estado de `folio_operacion` | Rechazado: vigente=false aunque el siguiente folio retrocede a 2. |
| Restauración parcial de una tabla cubierta | Rechazada: vigente=false. |
| `-n public`, excluyendo vida, con `--clean --exit-on-error` | PostgreSQL rechaza DROP SCHEMA porque vida sigue dentro. No dejó una restauración completa que pudiera darse por válida. Este error interrumpió el primer guion; se conservó y se continuaron los casos pendientes, sin repetir la batería. |
| Volcado completo de 0021 sobre 0023, con funciones nuevas supervivientes, y migrar | Aplica 0022/0023 sin tropezar y queda vigente=false. |
| Migración legítima ALTER + tabla nueva + secuencia nueva | Sigue vigente=true. |
| DROP + CREATE de tabla cubierta en una migración | Queda vigente=false, como el límite declarado. |
| DROP en una migración y CREATE en la siguiente | Queda vigente=true sin emparejar explícitamente: la primera llamada olvidó la identidad anterior. |
| Base no emparejada por tabla recreada, luego migración que la renombra | **Pasa de false a true** sin registrar ni emparejar. |
| Respaldo 0022 excluyendo vida y migracion, restaurado encima de 0023 | **baseApta en modo operación=true; siguiente folio=2, ya emitido antes; cero restauraciones.** |

**A6-C-I1 · Importante — `vida_abarcar` comprueba después del cambio, no que la base estuviera emparejada antes de migrar.** `0023:53–62` ignora nombres ausentes; `vida_abarcar` (70–77) reemplaza el mapa completo; `migrar.ts:85–91` solo lo invoca después del SQL. Una tabla cubierta recreada deja vigente=false; una migración posterior que la renombra hace desaparecer el nombre discordante, por lo que la comprobación ya devuelve true y el mapa se sustituye. Resultado reproducido: antes=false, después=true. También quitar en una migración y recrear en la siguiente pierde la prueba del OID antiguo. Contradice «migrar nunca empareja» y el límite de recreación declarado.

Corrección: capturar elegibilidad antes de ejecutar cada migración y no adoptar objetos si ya era inválida; además decidir explícitamente si se conservan identidades de nombres retirados para detectar su reaparición. Una recreación/renombrado legítimos necesitan un contrato explícito, no inferir restauración válida de la ausencia del nombre. Probar migración renombrando una tabla restaurada y recreación en dos archivos. La comprobación posterior sigue siendo necesaria: comprobar solo antes permitiría adoptar un DROP/CREATE en el propio archivo.

**A6-C-I2 · Importante — El volcado parcial puede restaurar el verificador antiguo y conservar la versión actual.** Secuencia ejecutada: base 0022 válida con folio 1 → `pg_dump -Fc -T public.vida -T public.migracion` → actualizar a 0023 y emparejar legítimamente → emitir folio 2 → restaurar aquel volcado con `--clean --if-exists --exit-on-error`. Quedan vida y migracion actuales, pero se repone `vida_vigente` de 0022 (solo servidor/base). `migrar` no aplica nada, `baseApta` fuera de desarrollo devuelve true, el siguiente folio vuelve a ser 2 y no hay restauración registrada. La nueva `vida_abarcar` sobrevive y también devuelve true, confiando en la función vieja. La aprobación ya ocurría **antes** de invocar ese auxiliar.

No es carga solo de datos ni `estrenar_vida` posterior: se recrearon objetos a partir de un archivo de respaldo. Que aún no exista una instalación comercial anterior a 0023 limita la exposición inmediata, pero no prueba el alcance general que promete README. No hace falta prometer resistencia a un administrador que modifica reglas: delimitar que la comprobación depende de que sobrevivan las funciones verificadoras actuales, o comprobar su contrato desde un componente no reemplazado por ese volcado. Incluir esta reproducción si se mantiene la promesa de rechazar volcados parciales antiguos.

**Alcance declarado: todavía no es exacto.** README:285–303 y decisión 10 afirman que dejar tablas fuera no importa y que migrar nunca empareja; los dos casos anteriores los contradicen. Además, la cabecera de 0023 no enumera expresamente el administrador que empareja; la decisión 10 no explica la recreación por migración como sí README/cabecera. No inventar protección para funciones, vistas u objetos que el mapa no cubre (`relkind` solo r/p/S, nombres de public). La ausencia de un objeto se ignora por diseño: «cada tabla/secuencia que todavía existe bajo el nombre registrado y pertenece a esas clases» es más exacto que «basta con que una no coincida».

**Veredicto: no cerrar todavía la tarea 3.** C5-I1 y C5-I2 están corregidos en sus reproducciones exactas, y la batería pasa; quedan los dos huecos nuevos descritos, con resultados reproducibles. No se repitieron las verificaciones de credenciales, retención o restauración cifrada de la quinta pasada fuera de la batería pedida.

## Parte B — Completa, lectura y un recorrido dirigido

**El arreglo cubre el cambio de grupo de la cuenta activa en ambas pesadas.** `Mostrador.tsx:159–167` depende de `esperaLaActiva`, además de id, cantidad, ticket y posición en la lista. Primera pesada: false → true; segunda: true → false. El efecto corre después de actualizar el DOM y busca el único botón activo ya dentro de su grupo nuevo. También cubre el cambio de **esa cuenta** que llegue de otra sesión cuando `refrescar` incorpora el nuevo listado: no depende de haber ejecutado la pesada localmente. Límite existente, sin presentarlo como regresión: no hay sondeo/push para descubrir por sí solo las pesadas remotas; una pestaña inactiva no recibe automáticamente el cambio. La ruta de lectura ordena por creación/id, y el componente divide por `porPesar`.

**Recorrido aprobado:** «cuando la cuenta activa cambia de grupo…», sin cambiar sus expectativas. Se añadieron solo registros de IntersectionObserver en la copia para medir las dos tarjetas. Resultado: 1 aprobado en 7.8 s (13.9 s con arranque del runner), Chromium, 1280×620. `recorrido-2.log` contiene:

| Momento | Alto del botón | Alto visible | Franja inferior fuera | Ratio |
|---|---:|---:|---:|---:|
| Primera pesada / espera | 54.546875 px | 54.421875 px | 0.125 px | 0.99770838 |
| Segunda pesada / mostrador | 66 px | 65.609375 px | 0.390625 px | 0.99408144 |

**0.99 es una tolerancia razonable para este caso.** Sí existe una fracción geométrica fuera del rectángulo de recorte; no una pérdida de contenido ni una tarjeta parcialmente escondida. El ancho está completo (204 px); ambas franjas son inferiores a medio píxel CSS. No extrapolar ese 1 % a cualquier tarjeta enorme: mantenerlo en este recorrido. La medición confirma la explicación original y además el segundo cambio de grupo. No hace falta tocar el efecto para resolver ese redondeo.

Incidencia de infraestructura, no fallo del producto: el primer intento agotó 60 s antes del alta del equipo, sin llegar a las cuentas, con HMR bloqueado por el origen interno de Next en desarrollo. Se conservan `recorrido.log`, `web-recorrido.log` y la traza en `recorrido-artefactos-intento1`. Se agregó `allowedDevOrigins: ["web_recorrido"]` **solo a la copia**, y se repitió el mismo único escenario, ya sin ese bloqueo. Se sirvió el código copiado con Next dev para no instalar ni construir imágenes con npm ci. No hubo dos recorridos ni batería en paralelo. El caso remoto queda verificado por lectura, no por una segunda sesión de navegador. Sin hallazgos nuevos importantes/bloqueantes en B.

## Parte D — Completa, solo lectura

**D5-B1, D5-I2, D5-I3 y D5-M1 están resueltos en v4.** La tabla tiene prioridad explícita para cualquier intención/apertura; archivo durable antes de base antes de abrir; activación restaurada con nombre provisional, marca nueva y comprobación HTTPS de esa base; configuración recuperable, comprobación de lo que corre y reposición del respaldo; promesa temporal acotada. **D5-I1 queda resuelto en la exclusión y en la existencia de la entrada corregida**, pero esa nueva entrada necesita el ajuste siguiente. No volví a auditar el proxy ni el ensayo de operación ya revisados.

**A6-D-I1 · Importante — El relevo a `--corregida` no tiene una frontera durable definida.** Plan:626–628: «Cierra el anterior como sustituido […] y sigue desde el paso 5». Si muere tras cerrar el anterior y antes de dejar identificada la publicación sucesora, no queda una pendiente recuperable pese a que la base conserva una migración parcial. Si se crea una sucesora con las tres marcas inicialmente vacías y muere antes del paso 5, la tabla cae en el caso 3 («la base no se tocó»), afirmación falsa para esa base heredada. «Hereda su historia» necesita precisar que incluye el estado de migración empezada, desde el primer registro de la sucesora, no solo el nombre del respaldo.

Ajuste concreto y pequeño: preparar/validar la candidata corregida mientras sigue vigente el registro pendiente; crear durablemente la sucesora vinculada a su predecesora, base/marca y respaldo, **ya clasificada como migración empezada y sin apertura**, y solo después marcar la anterior sustituida. Definir qué registro manda durante la coexistencia (vínculo/activación atómica); no admitir una ventana sin dueño. Hacer las validaciones del paso 1 aplicables a una base parcialmente migrada, sin exigir falsamente que todo siga siendo el conjunto previo sano. La nueva candidata conserva intactas las migraciones ya confirmadas, según G. Probar muerte antes/después del relevo y rechazo de candidata corregida inválida. La tabla normal no necesita cambiar.

**A6-D-M1 · Menor — Explicitar el ámbito de las señales en la tabla.** La decisión de apertura de la base debe pertenecer a la publicación recuperada (o a su decisión registrada de volver al conjunto anterior), no ser el booleano comercial `abierta` ni una marca de la publicación pasada. Muerte entre B2 y B3: es normal que la base siga abierta por la publicación anterior; corresponde al caso 3, que ya contempla drenar. A y C tienen los identificadores necesarios, así que basta escribir este predicado y probar esa frontera. Una identidad de instalación/base/vida distinta sí debe seguir deteniendo la automatización.

Con señales del identificador correcto, los estados normales sí quedan bien: sin marca de migración → caso 3; marca aun sin hijo → caso 2; migración parcial/confirmada sin apertura → caso 2; intención en cualquiera de los dos soportes, respuesta perdida al abrir y compra posterior → caso 1. Evidencia dañada/ausente → detener, nunca restaurar por descarte. La recuperación restaurada usa su registro propio y la máquina perdida su entrada expresa: no deben pasar por la tabla de la publicación vieja.

**Veredicto: no codificar literalmente `--corregida` hasta cerrar A6-D-I1.** El flujo normal y la tabla v4 sí tienen resuelto el bloqueante anterior; no se pide volver al diseño de reanudación universal por fases.

## Parte G — Completa, solo lectura

**Dos depósitos es la opción más simple para este código**, con retención predeterminada COMPLIANCE de 30/365 días, también para los manifiestos. Matiz: B2 aplica el candado a versiones de objetos; el depósito proporciona el valor predeterminado. Podría hacerse con retención explícita por objeto en un solo depósito, pero añadiría lógica y permisos que aquí no hacen falta. Los permisos de subida/listado/lectura y recuperación se limitan por separado a ambos destinos. [B2, Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock).

**A6-G-I1 · Importante — Reintentar solo «hoy» pierde el diario pendiente al cambiar de fecha y no conserva necesariamente el primero bueno.** Tarea 3b:509–516. A las 07:00 hay respaldo horario bueno, pero falla la copia diaria; a las 08:00 el algoritmo propuesto copia el nuevo horario, no el primero. Si el destino diario falla durante todas las corridas del día, mañana solo se busca «uno de hoy»: el diario de ayer nunca se recupera aunque su archivo horario todavía existe por 30 días. Una falla después del último respaldo del día produce el mismo hueco. No basta la prueba «se reintenta en la siguiente» sin cruzar medianoche.

Ajuste: identificar el día por `manifiesto.instantanea` convertido a la zona de la sucursal (los directorios de `nombreDeObjeto` son **UTC**), escoger un origen horario comprobado estable por día y reanudar esa promoción, también al arrancar y para días pendientes aún disponibles en el depósito horario. Si se mantiene literalmente «primero bueno», elegir ese primer origen y conservar su nombre/corrida/llave/huella; no sustituirlo por el último solo porque se reintentó. Un día sin ningún respaldo bueno no puede reconstruirse: avisar del hueco, sin etiquetar el de mañana como el de ayer. Añadir respuesta perdida, caída después de las 20:00, promoción que cruza medianoche y servicio que vuelve al día siguiente.

**A6-G-I2 · Importante — «Hay uno de hoy» debe significar un par comprobado, y la decisión debe estar dentro del turno.** `respaldos()` solo empareja nombres; `ultimoUtilizable()` valida manifiesto y tamaño, no la huella del archivo. Si quedó el manifiesto subido con respuesta perdida, el reintento debe comprobar y reconocer ese mismo origen; si el manifiesto está dañado, o el archivo no coincide, no debe dar por cubierto el día por la mera existencia del nombre. Esto concreta la prueba de «diario dañado» en la **promoción**, además de la restauración. Mantener el candado de `respaldar` desde consultar el diario hasta publicar/verificar su manifiesto: hacerlo después de que `respaldar()` retorne ya liberó el turno y permite que manual/programado vean ambos el día vacío. Preservar el archivo cifrado hasta acabar ambos destinos (hoy se borra antes del manifiesto horario), o volver a traer/verificar el origen. El fallo diario se captura aparte para conservar el éxito horario y su aviso.

Con esa promoción idempotente y serializada habrá un origen diario válido; pueden quedar objetos huérfanos o versiones de reintentos, que no deben contarse como otros diarios. El archivo diario es autónomo: mismo volcado cifrado y manifiesto completo dentro de su depósito, nunca un puntero al horario que vence a 30 días. Restaurar `--diario` debe reutilizar `traer`/`restaurarDelDestino`, aceptar nombre explícito y `--como-estaba`, y rechazar combinaciones ambiguas con `--remoto`/archivo local. Conservar las llaves privadas históricas durante toda la retención; copiar los mismos bytes no cambia la llave que necesita.

**A6-G-M1 · Menor — Ajustar dos afirmaciones operativas.** El primer respaldo del día no garantiza «el estado con que cerró el día anterior»: si el primero bueno llega a las 10:00 puede incluir actividad de hoy. Es la primera instantánea buena de ese día, no un cierre. Además, cambiar retención predeterminada de 90 a 30 afecta nuevas subidas, no acorta los candados existentes. [B2, retención predeterminada](https://www.backblaze.com/docs/cloud-storage-object-lock).

**A6-G-M2 · Menor — Fijar la regla de vencimiento que realmente limpia nombres únicos.** En B2, «conservar versiones anteriores N días» no elimina la última versión de cada nombre; aquí cada corrida tiene nombre propio. Configurar ocultar tras 30/365 días y borrar versiones ocultas después, sin ocultar antes del plazo de disponibilidad; incluir `.age` y `.json`. La limpieza es diaria y respeta el candado, no promete borrado al segundo exacto del vencimiento. [B2, ciclo de vida](https://www.backblaze.com/docs/en/cloud-storage-lifecycle-rules). `pruebas/almacen.ts` ya usa 30 días; parametrizarlo para verificar también el depósito de 365. MinIO no acredita la configuración efectiva de B2: la tarea 7 debe comprobarla como ya prevé el plan.

**Veredicto: conservar los dos depósitos; precisar G-I1 y G-I2 antes de codificar la promoción diaria.** Son reglas pequeñas de selección, reintento y reconocimiento del resultado; no requieren otro volcado ni un servicio adicional.

## Cambios concurrentes detectados al cierre

La comparación **no** permite afirmar «ningún archivo cambió»: al inicio había 747 archivos; en la primera comparación final, 748. Aparecieron cuatro modificaciones y un archivo nuevo en el original mientras se trabajaba sobre la copia. Ningún comando de esta revisión escribió en `/Users/maantora/Desktop/feruga`; no atribuyo estos cambios a una persona o proceso concreto. Se copiaron para inspección a `cambios-original-al-cierre/`, sin reemplazar la instantánea ensayada.

- Modificados: `sistema/docs/planes/2026-10-04-precio-especial.md`, `sistema/src/app/globals.css`, `sistema/src/componentes/mostrador/Ticket.tsx`, `sistema/tsconfig.tsbuildinfo`.
- Nuevo: `sistema/recorrido/duplicado.spec.ts`.
- Ningún archivo eliminado en esa comparación.

**Actualización de A al cierre:** el cambio concurrente lleva precio especial a versión 4 y corrige exactamente A6-PE-I1: conserva el último evento al quitar, distingue estado activo de historia, exige alcanzabilidad desde la cabeza y añade las tres secuencias pedidas. Leído el diff de esa nueva copia: **el hallazgo queda resuelto en el diseño; sí se puede codificar precio especial v4 después de reabrir**. El apartado A conserva lo encontrado en la versión 3 recibida al empezar, para que se entienda el cambio de veredicto. No hay implementación de precio que acreditar.

**Alcance de F y de la batería:** Ticket/CSS y el recorrido de duplicado nuevos llegaron después de tomar la copia. No forman parte de las 611 pruebas ni del recorrido de B ejecutados aquí. El veredicto de F es sobre el plan pedido; no certifica esta implementación concurrente. No repetí la batería sobre un objetivo que cambió durante la revisión.

## Comprobación final y entrega — Completa

Última comparación SHA-256: 2026-10-05T01:24:47.049438+00:00. Inicio: 747 archivos; final: 748. Modificados: 4; nuevos: 1; eliminados: 0. Resultado íntegro en `comparacion-huellas.json`; no se afirma igualdad del original.

Contenedores del usuario, ambos `running`, con **las mismas horas de arranque que al inicio**:

- `feruga-web-1`: `2026-10-04T19:39:19.385935137Z`.
- `feruga-db-1`: `2026-10-03T21:20:18.977863461Z`.

No se reiniciaron ni se migraron, y las conexiones de pruebas se dirigieron a los servicios del proyecto QA. Se eliminaron todos los contenedores, volúmenes y redes creados por QA6; comprobado después de `down --volumes --remove-orphans`. También se borró el contenedor temporal usado para extraer dependencias. No se construyeron imágenes nuevas.

En `/tmp/feruga-codex-qa6/` quedan aproximadamente 495 MB: copia `sistema/` (con salida `.next` del ensayo, instrumentación del recorrido, configuración de origen para Next dev y `qa6-repro.ts`); `dependencias/` extraídas de una imagen existente; Compose adicional y su lanzador; logs de batería, reproducciones, los dos intentos del mismo recorrido y limpieza; traza del intento fallido de infraestructura; huellas inicial/final, comparación y horas de arranque; copias y diffs de los cambios concurrentes observados. No hay contenedores ni bases de QA pendientes de limpiar. El informe está fuera de esa carpeta, en `/tmp/feruga-codex-informe-6.md`.

**Veredictos finales:** reabrir, precio especial **v4 sobrevenida**, duplicado **como plan** y rediseño tareas 0/1: codificables. Cuenta activa: conforme en el alcance revisado, con recorrido aprobado. Restauración: no cerrar tarea 3 (dos importantes); publicar: precisar relevo a corregida (un importante); diario: precisar recuperación de días pendientes y reconocimiento bajo candado (dos importantes). No se detectó un bloqueante nuevo. A, F, E, C, B, D y G completas, con los límites de ejecución expresamente señalados.
