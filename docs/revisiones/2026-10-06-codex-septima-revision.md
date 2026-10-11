# Séptima revisión de Codex: lo que se programó, la marca de restauración y dos diseños (6 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto. **Completa**: A (reabrir el día) con una batería, una
restauración dirigida y nueve recorridos; B (el comprobante por duplicado) con recorridos sobre
una construcción de producción y PDF; C (la marca de restauración) con reproducciones dirigidas;
D y E por lectura. Sobre una copia en `/tmp/feruga-codex-qa7/`. Es el informe tal como lo entregó.

**Veredictos.** **Reabrir el día: cerrado**, con dos menores (A7-A-M1 y A7-A-M2). **El
comprobante por duplicado: cerrado**, sin hallazgos. **La tarea 3 sigue sin cerrarse**: un
importante nuevo en la marca de restauración (A7-C-I1). **Publicar una versión (diseño 5) y el
respaldo diario (diseño 2): se pueden codificar.** Ningún bloqueante.

La respuesta está en `2026-10-06-respuesta-a-la-septima-revision.md`.

---

# Séptima revisión de calidad — 6 de octubre de 2026

- [x] Parte A — Reabrir el día, con ejecución.
- [x] Parte B — Comprobante por duplicado, con recorrido.
- [x] Parte C — Marca de restauración, con ejecución.
- [x] Parte D — Publicar una versión, diseño v5, solo lectura.
- [x] Parte E — Respaldo diario, diseño v2, solo lectura.
- [x] Limpieza y verificación de los contenedores del usuario.

Copia de trabajo: `/tmp/feruga-codex-qa7/`. No se modifica el proyecto original. Clasificación de incidencias: bloqueante / importante / menor.

## Parte A — Completa, con ejecución

**Veredicto: sí se puede dar por cerrada la funcionalidad de reabrir, con dos observaciones menores que conviene corregir. Sin hallazgos bloqueantes ni importantes.** No encontré duplicación de cierres/reaperturas ni un envío válido que quedara sin salida en los escenarios revisados.

**Ejecución:** una sola batería completa, `docker compose --profile pruebas run --rm pruebas`, mediante `compose.sh` y `COMPOSE_FILE` con el original intacto más `compose.qa7.yml`. Proyecto `feruga_codex_qa7`, `PG_PLANTILLA=feruga_plantilla_codex`, sin puertos publicados ni conexión a la base del usuario. Dependencias reutilizadas de QA6, sin instalar. Tipos aprobados y **633/633 pruebas, cero fallos, cero omitidas, 99.56 s**. Evidencia: `bateria.log`. Después, secuencialmente, restauración dirigida (`a-restaurar.log`) y Chromium: los 7 escenarios originales de reabrir más 2 reproducciones dirigidas, **9/9 en 31.9 s** (`a-recorrido.log`). El servidor del recorrido usa Next dev con `allowedDevOrigins` únicamente en la copia; no se certifica aquí una construcción nueva de producción.

### Reglas y ataques

La batería ejecutó los 19 casos de `25-reabrir-el-dia`, además de 16-cierre y 17-rutas: día distinto de hoy, orden nueva atrasada al cerrar/reabrir, repetición histórica del mismo UUID, contenido distinto y envío cancelado, intento fallido y bloqueo real de clave, permisos, reapertura sin registro, registro suelto, número/hora incorrectos, cambio de otros campos junto con la reapertura, contador que retrocede/salta, eliminación de jornada antes cerrada y reutilización del registro dentro de una transacción. Se rechazaron como corresponde. Las carreras con barrera cubren dos reaperturas, reapertura/cierre y apertura/reapertura; la medianoche se simula cambiando la zona del patio mientras la petición espera el candado, y se rechaza después de obtenerlo. No se cambió el reloj del usuario.

El guardián de 0024:88–114 conserva la prohibición de modificar una jornada cerrada salvo quitar ambos campos del cierre con todos los demás campos iguales y prueba del cierre exacto. La inmutabilidad y unicidad de `reapertura`, su comprobación diferida y el contador monotónico impiden conservar una prueba suelta o reutilizarla. La condición de transacción es defensa adicional, como declara la respuesta. No se relajaron los bloqueos ni las reglas sobre cuentas pendientes del cierre; las segundas pesadas/descarte permitidos mientras está cerrado siguen sin deshacerse al reabrir.

### Pantalla y resultado histórico

Los recorridos originales aprobaron ciclo completo con compra y segundo cierre, clave mala, consulta sin permiso, respuesta perdida al cerrar/reabrir y recarga, dos pestañas atrasadas y pestaña duplicada. El UUID se conserva, la clave no se guarda y la pestaña duplicada suelta el envío heredado. Los dos escenarios añadidos resolvieron además una reapertura asentada cuya respuesta se perdió, después de que otra sesión cerrara otra vez: tanto reintentar como «Autoriza otra persona» liberaron el pendiente sin alterar el cierre 2.

**A7-A-M1 · Menor — Al resolver una reapertura histórica, el aviso puede afirmar que el día está abierto aunque ya se cerró otra vez.** Reproducido por ambas salidas, con los mensajes y el estado persistido registrados en `a-recorrido.log`. La base quedó `{abierta:false,cierres:2,reaperturas:1}`; se mostraron correctamente el cierre actual y «Reabrir el día», pero el aviso verde dijo «El día quedó abierto otra vez» / «el día está abierto otra vez». Referencias: `src/app/cierre/page.tsx:151,174`. El servidor devuelve correctamente el resultado histórico: la pantalla debe distinguirlo del estado actual, igual que ya hace al repetir un cierre. Para «soltar», decir únicamente que esa reapertura quedó registrada, o decidir el texto después de leer el estado actual. Añadir estos dos cruces al recorrido con una expectativa del mensaje correcto.

### Pruebas antiguas

Los cierres manuales de 02, 03, 04 y 07 solo agregan `cierres + 1`: mantienen las mismas acciones y afirmaciones posteriores. Los cruces de 10 siguen esperando el bloqueo real, y la matriz de 08 sigue verificando explícitamente las funciones permitidas y retiradas. En 17, la matriz ahora llega al rechazo por jornada inexistente en vez de por cuenta pendiente; conserva su finalidad de permisos, y la regla de pendientes tiene pruebas específicas.

**A7-A-M2 · Menor — Una afirmación antigua ya comprueba el auxiliar de prueba, no el servidor.** `pruebas/16-cierre.test.ts:29–32,124`: el segundo cierre invoca un auxiliar que lanza por sí mismo `RC006` cuando no encuentra jornada abierta. Antes alcanzaba el dominio. El resumen y los importes siguen realmente probados; esa última expectativa perdió su alcance. Sustituirla por una llamada directa a `cerrarEsa` con la jornada y un UUID nuevo, y esperar `RC011`. El caso equivalente está cubierto por las nuevas pruebas SQL/rutas, por lo que esto no demuestra un defecto de cierre ni deja la regla sin cobertura global. En 08, el resultado «cierre 1» también sustituyó la antigua lectura de `cerrada_en`; 25 comprueba expresamente ambos campos persistidos.

### Respaldo cerrado de hoy

**Probado ahora, sin problema encontrado.** `qa7-a-restaurar.ts` creó una jornada de hoy, publicó precios, abrió sesión y cerró; tomó un volcado cifrado real y llamó al programa `restaurar` sobre el servidor vacío de QA. Comprobó marca vigente con `SQL_DE_VIDA`, cierre de la sesión antigua, entrada nueva, reapertura por el usuario de aplicación, reintento del cierre histórico sin volver a cerrar, compra con folio **100001** y segundo cierre. El ensayo cubre precisamente lo pendiente en el plan. El rechazo HTTP de una cookie antigua depende del mecanismo general de sesiones ya probado; aquí se comprobó la invalidación en la base, sin repetir aquella revisión.

## Parte B — Completa, con recorrido y PDF

**Veredicto: sí se da por cerrada. A6-F-M1 resuelto. Sin hallazgos nuevos bloqueantes, importantes ni menores en el duplicado.** El corte físico sigue reservado a la impresora real, como declara el plan.

`Ticket.tsx:29–33,37–73,76–79,117–126` decide por `impresion.numero === 1`, dibuja ambos cuerpos con la misma función y hace una llamada a `window.print` por impresión en producción. La copia del negocio usa clase propia, oculta en pantalla y `aria-hidden`. El motivo nuevo está disponible; una reimpresión lleva un cuerpo y su motivo. `globals.css:267–276` coloca el contenedor de papel, mantiene los cuerpos en flujo y fuerza el salto antes de la copia del negocio.

**Ejecución:** los 4 escenarios de `duplicado.spec.ts` y una instrumentación adicional de PDF: **5/5 aprobados en 13.2 s sobre construcción de producción de la copia**, sin alterar las expectativas originales. `construccion.log` acredita `next build` y tipos; `b-recorrido-produccion.log`, el recorrido. La primera corrida con Next dev tuvo 3 fallos de contador (2 llamadas iniciales en vez de 1, y 3 acumuladas en vez de 2); corresponde al efecto de montaje duplicado en desarrollo, que ya existía en Ticket antes de este cambio. Se conservan ese log y sus trazas en `b-recorrido.log` y `b-artefactos-dev/`. Se detuvo solo el servidor QA, se construyó la copia sin instalar y se repitió secuencialmente con `next start`; en producción los contadores originales pasan. No se desactivó Strict Mode para esconderlos.

**A6-F-M1 sí prueba el cruce pedido:** el primer intento no llega; la primera manual se registra y pierde su respuesta; otra solicitud consigue número 2; se reintenta el UUID incierto y vuelve número 1, con dos cuerpos, una llamada al papel y sin leyenda de reimpresión. Al final siguen existiendo exactamente dos registros de impresión, no tres.

**Papel comprobado, no inferido solo del CSS:** PDFs de compra, venta de cuatro materiales y primera histórica: dos páginas, negocio en la segunda. Para verificar fragmentación añadí en el navegador 45 bloques identificables a cada cuerpo: seis páginas en total, la segunda copia comienza en la cuarta, ambos «Material QA7 45» y ambos pies están presentes. Es un estrés del papel con DOM sintético, además de la venta real, no 45 operaciones de negocio. No hubo superposición ni pérdida del final. Los materiales pueden partirse entre páginas de un papel finito; el cambio no promete mantener cada renglón entero.

**Cliente contra la disposición anterior:** se reprodujo en el navegador la estructura previa sin contenedor ni segunda copia y su regla de posición absoluta de 72 mm. Todas las palabras y sus coordenadas de la primera página son idénticas a las actuales. La diferencia gráfica es la línea de separación añadida después del comprobante. Se inspeccionó también la copia del negocio rasterizada. Evidencias: `b-pdf-verificacion.json`, `recorrido-artefactos/qa7-cliente-{anterior,actual}.pdf`, `qa7-duplicado-{1,2,3}.pdf`, `qa7-largo.pdf` y `negocio.png`.

## Parte C — Completa, con ejecución

**Veredicto: no cerrar todavía la tarea 3. A6-C-I1 y A6-C-I2 quedan corregidos en sus reproducciones; queda un importante nuevo, A7-C-I1.** Sin bloqueante nuevo. Evidencias independientes de la batería: `qa7-c-repro.ts`, `c-reproducciones.log`, `qa7-c-secuencia.ts` y `c-secuencia-app.log`; ejecutadas secuencialmente, en bases desechables QA.

### Reproducciones solicitadas

| Caso | Resultado ejecutado |
|---|---|
| Tabla recreada; después migración que la renombra | `false → false`; no se adopta. |
| Quitar en una migración y crear en la siguiente, sin retirar | `true → false`; no se olvida el identificador anterior. |
| Volcado 0022 sin `vida` ni `migracion`, restaurado encima de 0023 | La función antigua repuesta dice `true`, pero `SQL_DE_VIDA=false` y `vida_retirar=false`. Después de aplicar 0024, `baseApta` en operación sigue siendo `false`, aunque la secuencia restaurada vuelva al 2. |
| Migración legítima que renombra, altera y añade tabla y secuencia | Sigue `true`. |
| Retirar antes de quitar, y recrear en la siguiente migración | Sigue `true`, con los objetos nuevos cubiertos. |
| `vida_retirar` sobre una base inválida por tabla recreada | Devuelve `false`; no convalida esa base. |

La reproducción antigua se restaura sobre 0023 y luego se lleva a 0024: evita que las dependencias nuevas impidan el `pg_restore`, sin sustituir la comprobación por un rechazo accidental del esquema. Así se acredita también `baseApta` con la versión actual, no solamente una consulta aislada.

### A7-C-I1 · Importante — Conservar el objeto antiguo renombrado permite restaurar otro bajo el nombre que usa la aplicación sin invalidar la marca

`src/servidor/esquema.ts:25–30` comprueba que todos los OID guardados siguen existiendo en `public`; no comprueba que los objetos utilizados ahora estén cubiertos. `vida_coincide` tiene el mismo criterio. Al conservar el antiguo bajo otro nombre, su OID sigue satisfaciendo la marca, aunque `folio_operacion` sea una secuencia nueva con el estado de un respaldo.

Reproducción íntegra y exitosa, sobre una base actual ya emparejada:

1. Consumir folio 1 y `pg_dump -Fc -t public.folio_operacion`.
2. Consumir folio 2.
3. `ALTER SEQUENCE folio_operacion RENAME TO folio_operacion_antes_de_restaurar` (conservar el objeto anterior, sin editar la marca).
4. Restaurar ese volcado con `pg_restore --exit-on-error` en la misma base. El nombre original está libre, por lo que el programa crea otra secuencia.
5. Con una conexión nueva, `SQL_DE_VIDA=true` y **`baseApta` en modo operación=true**; la siguiente llamada a `nextval('folio_operacion')` vuelve a entregar **2**. Hay **cero restauraciones** registradas. OID anterior 16607, nuevo 36870 en la corrida registrada.

La segunda reproducción confirmó `baseApta=true` **con el rol de aplicación `feruga_prueba`**, no solo como administrador. No se llamó a `estrenar_vida`, `registrar_restauracion` ni se modificaron funciones, disparadores o `vida` después de restaurar. Se conserva el objeto viejo como precaución antes de reemplazarlo: no es una recarga solo de datos ni una copia física. La secuencia nueva realmente viene de `pg_restore`.

**Alcance del daño demostrado:** se permite atender con una secuencia restaurada y regresada, y no se saltan folios ni se invalidan sesiones. No afirmo haber confirmado dos operaciones con igual folio: la unicidad de la tabla puede rechazar una colisión si la operación anterior permanece. El defecto demostrado es que la barrera de restauración permite esa base y que la secuencia vuelve a asignar un número ya consumido.

**El migrador y `vida_retirar` tampoco lo corrigen.** Una migración posterior inocua (`CREATE TABLE qa7_nueva…`) ve `true` antes y después y adopta el nuevo OID en `db/migrar.ts:105–107`. Por separado, `vida_retirar('folio_operacion_antes_de_restaurar')` devuelve `true`; se puede eliminar entonces la secuencia antigua y la base sigue apta, sin registrar. Este último paso sí es una intervención explícita sobre la marca; no hace falta para el bypass inicial. Explica por qué el auxiliar no convalida una base que detecta inválida, pero sí puede borrar el vestigio de esta que clasifica mal.

**Corrección a concretar:** la comprobación debe asegurar que las tablas/secuencias activas que puede usar la aplicación también pertenecen a la historia cubierta, no solo que sobreviven los OID viejos. Una opción es una comprobación estricta del conjunto de objetos fuera de migraciones y un contrato controlado de incorporación/retiro dentro de ellas; otra, controlar explícitamente el reemplazo de un nombre con un OID distinto. No basta añadir a ciegas los objetos que se descubran al migrar. Conservar pruebas de renombre legítimo, alta legítima, retiro/recreación y añadir esta secuencia «conservar con otro nombre → restaurar nombre original», antes y después de migrar y de retirar el antiguo.

### Actualizaciones legítimas y alcance escrito

No encontré una actualización legítima fallida entre las ejecutadas: renombre, ALTER, altas y retiro/recreación declarado pasan. El retiro es por objeto, no por dependencias: si una tabla tiene una secuencia propia que se elimina al quitarla, el contrato debe retirar también esa secuencia; `vida_retirar` no recorre dependencias. La actualización de una instalación ya operada anterior a la marca y una actualización mayor de PostgreSQL siguen exigiendo el emparejamiento expreso que README ya declara.

README:285–312, decisión 10 y cabecera de 0023 ya describen correctamente el algoritmo por identidad y las exclusiones de copia física, datos solos, funciones/vistas/disparadores y emparejamiento administrativo. **La promesa general de rechazar una restauración parcial olvidada todavía es más amplia que lo ejecutado:** no excluye conservar el objeto anterior renombrado mientras se restaura otro con su nombre. La frase «mientras todas sigan ahí, las mismas» es fiel al SQL, pero no implica que la aplicación esté utilizando esas mismas. Ajustar el mecanismo o declarar expresamente ese límite antes de dar por exacto el alcance.

## Parte D — Completa, solo lectura

**Veredicto: sí se puede codificar la tarea 5, diseño v5. A6-D-I1 y A6-D-M1 resueltos. Sin hallazgos nuevos importantes ni bloqueantes en el cambio de diseño.** Esta aprobación es del diseño; no acredita una publicación ejecutada.

**A6-D-I1:** el relevo de `--corregida` tiene frontera durable (`docs/planes/2026-10-03-despliegue.md:674–692`). La candidata se valida contra la base parcialmente migrada mientras la publicación pendiente conserva la autoridad. La sucesora se escribe primero, con enlace a su predecesora, misma base/marca/respaldo previo y «empezó la migración» ya presente; solo después se cierra la anterior. Si quedan dos pendientes, el enlace determina cuál manda. No queda un intervalo sin publicación responsable y la sucesora no puede caer por omisión en el caso 3. Se exigen pruebas de muerte a ambos lados del relevo y rechazo de candidata inválida.

**A6-D-M1:** las señales de apertura ya se limitan expresamente al identificador de la publicación recuperada (`664–671`). Que la base siga atendiendo por la publicación anterior entre B2 y B3 corresponde al caso 3 y exige cerrar/drenar; no autoriza terminar hacia adelante como si la nueva hubiera abierto. Identidad o evidencia inconsistentes detienen la automatización.

Al implementar, conservar la regla que el propio diseño establece: el flujo autorizado de `--corregida` continúa por B5, pero una recuperación no obtiene permiso general de repetir migraciones por el solo hecho de encontrar una sucesora; resuelve el relevo y aplica la tabla D. La prueba exigida «sucesora que muere antes de migrar → caso 2» fija precisamente esa interpretación. El hallazgo de marca de la parte C debe corregirse por separado antes de confiar operativamente en esa señal; no obliga a cambiar la frontera de publicación.

## Parte E — Completa, solo lectura

**Veredicto: sí se puede codificar la tarea 3b, diseño v2. A6-G-I1, A6-G-I2, A6-G-M1 y A6-G-M2 resueltos en el diseño. Sin hallazgos nuevos bloqueantes ni importantes.** No se ejecutó ni se da por implementada la promoción diaria.

- **A6-G-I1:** líneas 526–535 fijan el primer respaldo bueno por la fecha local de su instantánea, una selección que no cambia al reintentar, recuperación al arrancar y en cada corrida de días anteriores con origen todavía disponible, y aviso de días irrecuperables. Las pruebas 563–569 cruzan las 07:00/08:00, medianoche, último respaldo del día y vuelta al día siguiente.
- **A6-G-I2:** líneas 536–547 exigen manifiesto válido más archivo descargado y verificado por huella; la respuesta perdida se reconoce sobre ese mismo par. Selección, publicación y comprobación permanecen bajo el turno. El cifrado se conserva hasta terminar ambos destinos o se recupera y verifica el origen. Los huérfanos no cuentan, y un fallo diario conserva el éxito horario con aviso separado. Esto concreta precisamente lo que hoy no garantizan el mero listado de nombres ni `ultimoUtilizable`.
- **A6-G-M1:** ya se llama primera fotografía buena del día y se explica que puede contener actividad de esa mañana. También se declara que el cambio de plazo aplica a subidas posteriores, y que los depósitos todavía se crearán con 30/365 días.
- **A6-G-M2:** líneas 550–554 fijan ocultar al plazo y borrar lo oculto después, para archivo y manifiesto, con limpieza diaria que respeta la retención. Las pruebas incluyen ambos plazos; la verificación real contra B2 queda en tarea 7. No se volvió a auditar aquí la configuración del proveedor ya examinada en la sexta pasada.

El diario queda autónomo, con los mismos bytes cifrados y manifiesto completo. Las opciones de restauración por diario, objeto explícito y fecha histórica tienen exclusiones claras. Al implementar «se elige una vez», conservar una identidad de origen recuperable tras reinicio (objeto/corrida/huella/llave); si aquel origen dejó de estar disponible, avisar del hueco en lugar de elegir silenciosamente otro. Las llaves históricas deben conservarse mientras quede cualquier diario que las necesite, incluido uno promovido con retraso; «un año» no debe convertirse en borrar la llave un año después de rotarla si aún hay objetos retenidos. Son consecuencias de los requisitos aprobados, no otra arquitectura ni condiciones pendientes para empezar.

## Cierre, limpieza y entrega — Completa

**A, B, C, D y E completas y guardadas al terminar cada parte.** Resultado: **1 importante nuevo (A7-C-I1), 2 menores (A7-A-M1/M2), ningún bloqueante**. Reabrir: cierre funcional aceptable con esos menores; duplicado: cerrado; marca: no cerrar tarea 3; publicar v5 y diario v2: se pueden codificar.

No se creó, modificó ni borró ningún archivo dentro de `/Users/maantora/Desktop/feruga`. La copia inicial excluyó `node_modules` y `.next`. El `docker-compose.yml` copiado no se sustituyó; los ajustes están en un archivo adicional y el lanzador usa `COMPOSE_FILE`. No se ejecutó `npm ci` ni `npm install`. Se ejecutó una sola batería completa; todas las pruebas dirigidas y recorridos fueron secuenciales. Ningún comando migró, reinició o escribió en los servicios o la base del usuario.

Después de `down --volumes --remove-orphans`, las consultas por la etiqueta del proyecto `feruga_codex_qa7` devuelven **cero contenedores, cero volúmenes y cero redes**. Los contenedores transitorios de pruebas y construcción también se eliminaron. No se construyeron imágenes Docker nuevas.

Los contenedores del usuario siguen `running`, con **los mismos identificadores y horas de arranque** que al inicio:

- `feruga-web-1`: `2026-10-06T16:15:51.9757995Z`.
- `feruga-db-1`: `2026-10-06T16:16:00.606274421Z`.

Evidencia: `contenedores-usuario-{antes,despues}.txt`, `limpieza.log` y los tres listados vacíos `limpieza-{contenedores,volumenes,redes}.txt`.

En `/tmp/feruga-codex-qa7/` quedan aproximadamente **662 MB**: copia del proyecto; dependencias reutilizadas (366 MB); construcción `.next` (287 MB); Compose adicional y lanzador; registros de batería, recorridos, construcción, reproducciones y limpieza; tres guiones dirigidos QA7; los dos recorridos instrumentados con sus versiones originales guardadas aparte; PDFs y comprobaciones del papel; trazas de los fallos de contador en desarrollo y datos inicial/final de los contenedores. `node_modules` es el punto de montaje creado para las dependencias del contenedor. No quedan bases ni servicios QA en ejecución. El informe se entrega fuera de la copia, en `/tmp/feruga-codex-informe-7.md`.
