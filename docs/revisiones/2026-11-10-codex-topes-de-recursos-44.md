# Encargo 44 — revisión de recursos en operación

**Dictamen:** mantendría los topes actuales para la carga medida. Hay cuatro hallazgos de gravedad media (R44-01 a R44-04): garantía de CPU global incorrecta, swap implícita, auxiliares/build fuera de los topes y temporales que sobreviven a un OOM. No se encontró insuficiencia reproducible de los límites actuales.

Trabajo exclusivo en `/tmp/feruga-codex-qa14/qa/`; no se ejecutan los ensayos ni se accede a los contenedores o bases prohibidos. Mediciones en recursos propios `codex44-`, una carga pesada a la vez. No se instala npm ni se cambian fuentes del producto.

## Entorno y método

Docker Engine 29.7.2, Compose v5.4.0, cgroup v2. La VM de pruebas tiene 12 CPU y 8,319,238,144 bytes (~7.75 GiB): no es el servidor objetivo de 2 CPU. Se aplican las cuotas de operación en cada prueba; no se infiere rendimiento real del servidor compartido a partir de esta VM. Se distinguirá memoria de cgroup (incluye caché de archivos) de memoria anónima y de RSS.

## Hallazgos

### R44-01 — media — las cuotas individuales no reservan CPU para la otra aplicación

Archivo: `pruebas/20-entorno.test.ts:549`, `docker-compose.operacion.yml:28` y límites de los demás servicios. La prueba afirma que por ser cada cuota menor que dos CPU siempre queda CPU para la otra aplicación. Los cuatro servicios permanentes suman 5 CPU (db 1.5 + web 1.5 + respaldo 1 + proxy 1), sobre un servidor de 2 CPU. Las cuotas son techos individuales, no reservas ni exclusión mutua entre servicios. La suma de memoria de los siete servicios es 4608 MiB, pero los `run` adicionales tienen presupuestos independientes.

Comprobación: lectura numerada de la prueba (`nl -ba pruebas/20-entorno.test.ts | sed -n '526,556p'`); sonda cgroup/Compose concluida, con resultados en `qa/codex44-limites-resultados.json`. Cambio propuesto: corregir esa garantía en prueba/comentarios y presupuestar el conjunto. Si se necesita garantizar al menos 0.5 CPU fuera de feruga, usar un cgroup padre con cuota **1.5 CPU** para el conjunto (incluidos los `run`), evaluando primero la cuota que necesita la aplicación vecina. Mantener inicialmente las cuotas individuales: limitan un servicio, pero no implementan esa garantía global.

### R44-02 — media — política de swap implícita

Archivo: `docker-compose.operacion.yml:25` (y otros bloques `deploy.resources.limits`). No hay `memswap_limit`. Docker, cuando se fija memoria pero se omite swap, permite por omisión otro tanto de swap, si el host dispone de ella. No significa RAM ilimitada ni que se reserve esa swap: introduce presión de disco y latencias no reflejadas en la suma de la prueba.

Comprobación terminada en contenedores propios; RAM+swap efectivas y valores cgroup documentados abajo. Cambio propuesto: política explícita; para un presupuesto estricto sin swap por servicio, `memswap_limit` igual a su límite de RAM: respaldo/comprobacion/web **768m**, db **1g**, migracion/consola **512m**, proxy **256m**. Volver a medir así, pues elimina un colchón frente a OOM. Referencia: [Docker: resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).

## Observaciones ya verificadas por código

- El respaldo actual **no** ejecuta `pg_dump | age`: hace `pg_dump --format=custom --file`, luego `age` a archivo, luego `rclone copyto`, baja y calcula SHA-256 por stream. `operacion/respaldar.ts:308-355`; `operacion/destino.ts:265-273`. Se midió también la tubería solicitada, distinguiéndola de la implementación real.
- Restauración: `pg_restore --single-transaction --exit-on-error` en una base temporal, validación y renombrado al final (`operacion/restaurar.ts:114-195`). El cliente tiene tope de comprobacion; la memoria del servidor de restauración se cobra a db.
- Migración: una transacción por archivo, con registro y huella dentro del mismo COMMIT (`db/migrar.ts:278-299`). Un OOM no revierte migraciones anteriores; el diseño lo reconoce y deja cerrada la aplicación.
- App: pool máximo 10 conexiones, timeout SQL 20 s (`src/servidor/bd.ts:29-35`). PIDs cuenta tareas/hilos, no goroutines de Go ni conexiones HTTP como procesos.

## Registro de revisión

Las siguientes secciones se escribieron conforme avanzaron las mediciones. El cierre indica lo cubierto y lo que quedó fuera.

## Avance: comprobaciones de Compose y muestra inicial

La prueba focalizada pasó: **1/1**, `qa/codex44-prueba.log`. Se ejecutó el archivo original con `node --test --test-name-pattern='tope de memoria' pruebas/20-entorno.test.ts`, en `docker run --name codex44-prueba --network none --memory 512m --cpus 1 --pids-limit 64`, montando fuentes de la copia. Se evitó el helper que usa el proyecto compartido `feruga`.

`docker inspect codex44-db codex44-herramienta --format '{{.Name}} Memory={{.HostConfig.Memory}} NanoCpus={{.HostConfig.NanoCpus}} PidsLimit={{.HostConfig.PidsLimit}} MemorySwap={{.HostConfig.MemorySwap}}'`:

- db: `1073741824 / 1500000000 / 256 / 2147483648`.
- herramienta (`compose run`): `805306368 / 1000000000 / 128 / 1610612736`.
- Dentro de herramienta: `memory.max=805306368`, `memory.swap.max=805306368`, `pids.max=128`, `cpu.max=100000 100000`.

Esto confirma R44-02, y descarta que este Compose ignore `deploy.resources.limits` fuera de Swarm o al usar `run`. Se ejecutó además `python3 qa/codex44-compose-verificar.py`: resuelve los archivos originales con valores ficticios y perfil consola; extrae los límites a siete servicios Alpine propios (sin montajes ni red), mide `up` y otro `run`, guarda `qa/codex44-limites-resultados.json` y elimina sus contenedores. No arranca el Compose de feruga.

Muestra de 14 días: `qa/codex44-sembrar.ts` migra una base propia y llama al sembrador real con semilla 44: **378 operaciones, 746 renglones, 537 asientos**, base **13,031,091 bytes**; 9 s, pico cgroup **80,338,944 bytes**, **18 tareas** incluyendo el medidor Node. Extrapolación de tráfico inicial: aproximadamente **9,855 operaciones y 19,450 renglones/año** (365/14); no se multiplica todo el tamaño de la base, pues tiene un costo fijo.

Se lanzó un año real del sembrador, no una tabla de relleno: copia de `consola/demo.ts` en `qa/codex44-demo365.ts` con **únicamente** la validación de máximo 120 días ampliada a 365. Conserva las reglas, tablas, índices, disparadores y distribución de actividad. Base `codex44-365`, cliente bajo **512m / 1 CPU / 64 tareas**, db **1g / 1.5 CPU / 256 tareas**. No se cambia el sembrador original. Las credenciales impresas por la consola no se incluyen en el informe; son únicamente datos ficticios locales.

### R44-03 — media — auxiliares de publicación y construcción fuera de los límites de Compose

Archivo: `operacion/pasos.sh:151` y `operacion/pasos.sh:107-109`.

Comprobación exacta: `rg -n 'docker (run|build)' operacion/pasos.sh`. El manifiesto se ejecuta con `docker run --rm -i --network none ... --entrypoint node "$HERRAMIENTAS" operacion/publicacion.ts` sin `--memory`, `--cpus` ni `--pids-limit`. Los `docker build` también quedan fuera del límite del contenedor web; el build de Next no es su servidor standalone. La prueba de los siete servicios y `ensayo.sh:123-126` no cubren estos procesos. No ejecuté builds (implican npm ci, prohibido para este encargo).

Cambio propuesto: al auxiliar de manifiestos, **256m / 0.5 CPU / 64 tareas**, con `--memory-swap=256m`; verificar su uso al resolver configuraciones grandes. Para builds, preferir construir fuera del servidor compartido o un builder dedicado bajo presupuesto propio; **no** prometer que el tope de web protege al host mientras se publica. No propongo trasladar 768m al build sin medirlo, pues puede ser insuficiente.

## Avance: año real y respaldo/restauración

El año concluyó en 296.6 s: **313 días históricos atendidos**, 10,072 operaciones, 19,730 renglones, 13,087 asientos de bitácora. Base vacía migrada: 10,852,019 bytes; anual: **44,597,775 bytes (42.53 MiB)**. Crecimiento neto observado: **32.18 MiB/año**, para aproximadamente 32 operaciones por día atendido. Es una hipótesis de volumen basada en la demo (23–40 compras en días hábiles, menos el sábado, más ventas), no una predicción de clientes reales ni de archivos adjuntos futuros. Volcado cifrado: **7,907,105 bytes (7.54 MiB)**. Una base restaurada ocupó 42,956,467 bytes, con los tres recuentos idénticos.

Órdenes reproducibles y evidencia: `python3 qa/codex44-cargas.py` espera al sembrador y ejecuta secuencialmente respaldo con destino S3 propio + diario, tubería + descifrado, y pg_restore; se guardan `qa/codex44-{anual,respaldo,pipeline,restaurar}.json`, sus `.log` y los `*-db.log`. El S3 de laboratorio es MinIO interno, sin puertos publicados; no reproduce latencia de internet ni Object Lock de un proveedor real.

| Fase | Límite cliente | Pico memoria cgroup | Pico tareas | Tiempo | Resultado |
|---|---|---:|---:|---:|---|
| Migrar 44 archivos + sembrar 365 días | 512 MiB / 1 CPU / 64 | 52.93 MiB | 18 | 296.56 s | 0, sin OOM |
| Respaldar + age + rclone + comprobar + diario, funciones reales | 768 MiB / 1 CPU / 128 | 203.36 MiB | 26 | 1.60 s | 0; ambos vigilantes locales recibieron bien |
| `pg_dump -Fc \| age`, luego descifrar | 768 MiB / 1 CPU / 128, sin swap | 38.02 MiB | 14 | 0.60 s | 0 |
| `pg_restore --single-transaction --exit-on-error --no-owner` | 768 MiB / 1 CPU / 128, sin swap | 17.82 MiB | 9 | 0.74 s | 0; recuentos iguales |

El muestreo cliente es cada 25 ms; `memory.peak` y `pids.peak` son contadores del cgroup desde que nació cada contenedor, e incluyen el medidor Node (~7–11 tareas adicionales según fase). Se mide memoria total de cgroup, **incluida caché de archivos**, y se guarda además anon/file/shmem; no se suman shmem y file porque shmem forma parte de file. Las fases usan imágenes/páginas compartidas y cachés calientes: esto tampoco es un máximo universal.

En db, muestreo cada 200 ms: pico observado al sembrar **247.63 MiB**, al restaurar **197.65 MiB**; máximo histórico cgroup **248.58 MiB**, 12 tareas observadas incluyendo la sonda. `memory.events` sin OOM. El sembrador llegó a usar **21.07 MiB de swap**, y db **31.19 MiB** durante la siembra, pese a estar por debajo de sus topes de RAM; la presión del host compartido también importa. No se debe vender el ensayo como una prueba sin swap en todos los servicios. Las pruebas de pipeline y cliente de restauración sí fijaron memoria+swap igual a RAM.

### R44-04 — media — OOM del coordinador de respaldo deja archivos temporales tras reiniciar

Archivo: `operacion/respaldar.ts:288-290,364-366`, `operacion/diario.ts:299,612`, `docker-compose.operacion.yml:197`.

Comprobación: `qa/codex44-oom-respaldo.ts`, con `qa/codex44-oom.yml` (**128m sin swap**, reducido deliberadamente para inyectar el fallo, no para dimensionar operación). Usa `respaldar()` real, limita la subida a 64 KiB/s en el S3 propio y, un segundo después de iniciarla, reserva memoria hasta provocar OOM. `docker inspect codex44-oom-respaldo --format '{{json .State}}'` dio **OOMKilled=true, ExitCode=137** (`qa/codex44-oom-state.json`). Se arrancó **el mismo** contenedor con `docker start -a codex44-oom-respaldo`: sobrevivió `/tmp/feruga-respaldo-haHpCi/respaldo.dump.age`, de ~7.9 MB. Evidencia: `qa/codex44-oom-respaldo.log`, `qa/codex44-oom-reinicio.log`. Hubo inicio, **ningún bien** ni fallo explícito del vigilante, y el listado remoto devolvió `[]`.

OOM/SIGKILL no ejecuta `finally` ni respeta `stop_grace_period`. `restart: unless-stopped` reinicia el contenedor con su capa escribible; no la limpia. Repetidos OOM pueden acumular volcados/cifrados y acabar llenando disco; al cifrar, también puede quedar el volcado claro. La alerta externa por ausencia de bien sigue siendo correcta; no se declaró válido un respaldo parcial.

Cambio propuesto: usar un directorio de temporales exclusivo del servicio y retirar huérfanos al arrancar, antes de crear trabajos nuevos; respetar exclusión mutua y no borrar directorios ajenos o de otro proceso. Mantener **768m / 1 CPU / 128**: el fallo inyectado no demuestra que 768m sea corto. Añadir una prueba de muerte abrupta y reinicio, además de errores capturables. Para S3 real, revisar regla de expiración de multipartes incompletas; la sonda pequeña no entró en multipartes.

## Avance: web, Caddy y multipartes

`python3 qa/codex44-web.py` levantó Next standalone **16.4.5 / Node 24**, con la imagen local disponible, base anual, usuario de aplicación sin privilegios de dueño y sesión real. Se sirvieron por Caddy cinco páginas HTML y cinco API (panel anual, ganancia anual, historial, bitácora, inventario): 10 verificaciones iniciales + **200 solicitudes con concurrencia 10**, todas HTTP 200. p50 **52 ms**, p95 **487 ms**, máximo **672 ms**, en la VM; no es un SLA del servidor de 2 CPU. Código actual de `sitio.caddy` montado; entrada HTTP interna, sin emisión TLS ni puertos del host. La primera configuración de laboratorio falló porque la imagen antigua de proxy no traía el archivo importado; se corrigió montando el archivo de esta copia. No fue un fallo de recursos.

- Web: **145.62 MiB** de pico cgroup, **18 tareas incluyendo medidor**, cero swap/OOM, con **768m / 1.5 CPU / 128** y sin swap permitida. Salida 143 al detener deliberadamente el servidor al finalizar; no es un fallo de carga.
- Caddy: **69.22 MiB** de pico, **9 tareas observadas incluyendo muestreador**, cero swap/OOM, bajo **256m / 1 CPU / 128**, sin swap permitida. El binario registró `GOMAXPROCS=1` y `GOMEMLIMIT=241591910` (~90% de 256 MiB).
- db durante esta carga: máximo muestreado **348.39 MiB**, `memory.peak` **356.24 MiB**, **18 tareas** incluyendo muestreador. No OOM. La base conservó páginas intercambiadas de fases previas.

Evidencia: `qa/codex44-web.json`, `qa/codex44-web-carga.log`, `qa/codex44-web-carga-db.log`, `qa/codex44-proxy-metricas.log`. La aplicación pinta gran parte de estas pantallas en el navegador; la prueba cubre la entrega HTML y los API que las alimentan, no el renderizado visual ni todas las rutas.

También se subió y bajó un archivo de **256 MiB**, por encima del umbral de multipartes, usando `destinoRclone()` real y comparando SHA-256: `qa/codex44-multipart.ts`; **554.49 MiB** de pico cgroup, **28 tareas**, **3.78 s**, cero swap/OOM, bajo **768m / 1 CPU / 128 sin swap**. De lo medido, hasta ~492 MiB eran caché de archivos; el máximo de memoria anónima fue ~65 MiB. Es una sonda de transferencia, no se presenta como tamaño del respaldo anual. El almacenamiento es local y rápido. [Rclone S3](https://rclone.org/s3/#multipart-uploads) describe el coste de sus buffers; se debe volver a medir si se aumenta la concurrencia o tamaño de bloque.

## Procesos/hilos y presupuesto de PostgreSQL

`qa/codex44-conexiones.ts` abrió **100 conexiones simultáneas** en la base propia y ejecutó `SELECT 1` en todas. Resultado: 100 en `pg_stat_activity`, **108 tareas** en db (incluye sonda), sin OOM ni rechazo por PID. Evidencia: `qa/codex44-conexiones.log` y `qa/codex44-conexiones-db.log`. Es una prueba de conexiones casi ociosas, **no** demuestra que 100 consultas pesadas quepan en 1 GiB.

El conteo de Linux incluye hilos del núcleo: [cgroup v2, controlador PIDs](https://docs.kernel.org/admin-guide/cgroup-v2.html#pid). Las goroutines de Go no equivalen una a una a tareas del núcleo. Para este conjunto:

- **128 respaldo/comprobacion**: holgados frente a los 26–28 medidos con dos Node (instrumentación + programa) y subprocesos pg/age/rclone. El código lanza estos programas en secuencia; el diario también serializa transferencias. El servicio añade avisos/latido asíncronos; no crea un hilo por aviso. Restaurar y `operacion.ts` sí usan el mismo presupuesto de comprobacion, y se incluyen en esta recomendación.
- **128 web**: 18 tareas incluyendo el medidor bajo carga; Node/libuv/V8 ya están contados. No se ejecuta `next build` aquí.
- **128 Caddy**: 9 observadas con el muestreador; margen amplio. Subir a miles de conexiones TLS requeriría otra prueba, no deducir un hilo por cliente.
- **256 db**: 108 con las 100 conexiones configuradas. Hay espacio para procesos de fondo, autovacuum, trabajadores paralelos y healthcheck. Un respaldo serial usa 2 conexiones (turno/snapshot + pg_dump), ocasionalmente otra para cancelar; avisos pueden añadir 1. La web abre como máximo 10; consola/migrador normalmente 1 (demo, 2); restauración mantiene admin y un cliente de trabajo, no 100.
- **64 migracion/consola**: medidos 18 incluyendo instrumentación en la siembra y migraciones. El comando Compose migra y prepara rol secuencialmente, con un shell adicional. No los aumentaría.

Configuración real consultada en PostgreSQL 17: `shared_buffers=128MB`, `work_mem=4MB`, `hash_mem_multiplier=2`, `maintenance_work_mem=64MB`, `autovacuum_max_workers=3`, `max_connections=100`, `max_worker_processes=8`, `max_parallel_workers=8`, `max_parallel_workers_per_gather=2`, `max_parallel_maintenance_workers=2`.

No se puede presupuestar db como `128MB + 100*4MB`: work_mem es por operación sort/hash y por trabajador; varios nodos de una consulta pueden consumirlo. Las tablas hash usan el multiplicador 2; autovacuum puede sumar hasta tres presupuestos de mantenimiento. [PostgreSQL 17: recursos](https://www.postgresql.org/docs/17/runtime-config-resource.html). Las conexiones también tienen coste propio y max_connections dimensiona recursos compartidos. [PostgreSQL 17: conexiones](https://www.postgresql.org/docs/17/runtime-config-connection.html).

Para el pool actual de 10 y el volumen anual probado, **mantendría db en 1g / 1.5 CPU / 256 tareas**. Como ajuste preventivo de configuración, propondría **max_connections=40**, conservar **shared_buffers=128MB, work_mem=4MB, maintenance_work_mem=64MB**, y fijar **autovacuum_work_mem=32MB** (hasta 96 MiB para tres trabajadores). Esto reduce el espacio de sobrecarga accidental; no es un arreglo de insuficiencia reproducida ni garantiza que cualquier SQL quepa. Revalidar si se añaden réplicas web, trabajos paralelos o consultas nuevas. No aumentar RAM a 2g solo por sumar los máximos teóricos.

## Qué pasa ante OOM y cómo se recupera

La muerte puede afectar al proceso principal o a un hijo. Si cae un hijo y Node vive, `operacion/programas.ts:47-52` rechaza al no obtener salida 0 y ejecuta los catch/finally. Si cae PID 1 no hay catch, finally ni señal de fallo propia; Docker informa salida 137/OOM y el vigilante externo detecta la falta de éxito.

| Tarea / punto | Estado posible | Recuperación y garantía comprobada |
|---|---|---|
| Respaldo, antes de manifiesto | Temporal local; objeto remoto huérfano o multipart incompleto | No aparece como respaldo válido sin manifiesto; volver a respaldar crea otro UUID. OOM real durante subida dejó cero objetos listables y ningún bien. Limpieza local pendiente de corregir: R44-04. |
| Respaldo, después del manifiesto | Respaldo completo aunque no se avisara | El manifiesto solo se publica tras bajar y verificar el objeto. Puede haber alerta conservadora por faltar la señal, no un bien de datos parciales. |
| Diario | Elección fijada, archivo sin manifiesto o trabajo pendiente | `operacion/diario.ts:466-512` baja/compara lo ya subido y completa el manifiesto en el siguiente intento. Mantiene su señal separada del respaldo horario. No depende de conservar memoria del proceso para decidir cuál era el elegido. |
| Migrador | Migraciones anteriores confirmadas; la actual se revierte; puerta cerrada | **OOM real** probado: 137/OOMKilled, 44 migraciones y sin tabla de la 45; reintento aplicó solo `0045_qa_oom.sql`, tabla con fila 44, registro total 45. |
| Restaurar antes de renombrar | Base `*_restaurando` residual si muere el coordinador; la definitiva no existe | `restaurar.ts:114-122` elimina la temporal anterior al reintentar y restaura en transacción. El tamaño/índices de PostgreSQL se cobran a db, no al cliente. No presupone que finally siempre borre. |
| Restaurar tras renombrar, antes de anotar éxito | La base definitiva ya está completa | `volver.sh:154-160` vuelve a mirar marca/base; `publicar.sh:596-616` consulta estado y no restaura encima de la existente. Puede requerir reejecutar con la llave; no vuelve a dar por vacía una base restaurada. |
| db durante publicación | Conexiones caídas, transacciones sin confirmar revertidas; puede reiniciar el servidor | El cierre/marca confirmados sobreviven por WAL; publicar deja el manifiesto sin cerrar y no abre automáticamente sobre un esquema incierto. Revisado en código, no se inyectó OOM al servidor db ni se ejecutó el publicador completo. |
| Web/proxy | Peticiones interrumpidas, proceso reiniciado | `unless-stopped` permite reiniciar, pero no garantiza disponibilidad durante un bucle OOM. Las escrituras web usan transacciones; una respuesta perdida tras COMMIT puede requerir la idempotencia de la operación. No se auditaron nuevamente todos esos caminos. |

Migración interrumpida: sonda `qa/codex44-oom-migracion.ts` llama a `migrar()` real con una carpeta QA que contiene los 44 SQL originales y una 45 de prueba (`CREATE TABLE`, `INSERT`, `pg_sleep`). Inyecta reserva de memoria durante esa instrucción bajo **128m sin swap**. Evidencias `qa/codex44-oom-migracion-state.json`, `qa/codex44-oom-migracion-antes.log`, `qa/codex44-oom-migracion-despues.log`, `qa/codex44-reintento-migracion.json`. El reintento corre bajo **512m / 1 CPU / 64**, sin inyección.

El publicador no confunde un migrador muerto con éxito: `operacion/pasos.sh:329-338` usa `docker wait`, valida el código y lo devuelve; `operacion/publicar.sh:209-215` conserva el negocio cerrado al fallar. `pasos.sh:370` y siguientes espera/elimina trabajos de una publicación interrumpida antes de retomar. `volver.sh:146-167` conserva la base fallida apartada y vuelve a comprobar la restaurada antes de cerrar la vuelta. No encontré una salida «bien» nueva causada por estos topes en los caminos revisados.

## Recomendación de topes

| Servicio | RAM | CPU | Tareas | Decisión |
|---|---:|---:|---:|---|
| respaldo | 768m | 1.0 | 128 | Mantener; incluye diario, transferencia multipart de 256 MiB comprobada. |
| comprobacion | 768m | 1.0 | 128 | Mantener; incluye cliente de restauración, migrar/auditar en ese flujo y `operacion.ts`. |
| db | 1g | 1.5 | 256 | Mantener para la carga probada; ajustar configuración/conexiones como se explica arriba. |
| web | 768m | 1.5 | 128 | Mantener; margen observado bajo concurrencia 10. |
| migracion | 512m | 1.0 | 64 | Mantener; el trabajo grande de SQL se ejecuta en db. |
| consola | 512m | 1.0 | 64 | Mantener; incluso sembrar el año cupo ampliamente. |
| proxy | 256m | 1.0 | 128 | Mantener para esta instalación; HTTP interno probado, TLS masivo no. |

No encontré un tope corto para **el uso actual y el año de demo medido**. No recomiendo subirlos solo por el tamaño total de la base. RAM, tareas, CPU y tiempo son presupuestos distintos: una cuota de CPU retrasa trabajo, un límite de tareas puede causar EAGAIN al crear hilos/procesos, y memoria puede acabar en OOM. Los plazos de pg_dump (30 min), age (10 min), rclone (30 min por paso) y pg_restore (60 min) tienen margen enorme frente a esta corrida local, pero una transferencia por internet lenta se mide aparte.

`operacion/operacion.ts:38-64,174-183` usa un cliente y consultas pequeñas; cerrar, decidir y abrir son llamadas SQL individuales. No carga el conjunto de datos anual en Node. En el diario se descargan archivos a disco y las huellas se calculan por stream. `rclone lsjson` sí se acumula en memoria (`programas.ts:23-24,51`, `destino.ts:128-132`); con retención horaria de 30 días y diarios de un año no equivale a leer los backups enteros. No ensayé un depósito con millones de objetos/versiones listables.

La suma 4.5 GiB incluye todos los siete servicios una vez; no incluye procesos del host, caché/build fuera de esos contenedores, la otra aplicación ni una cantidad arbitraria de `run`. Si se quiere un presupuesto de RAM global de **4.5 GiB**, debe configurarse y comprobarse en el padre común, además de sumar topes; tampoco basta para demostrar que el vecino cabe. La propuesta de padre común de R44-01 requiere configuración del host y `cgroup_parent` en todos los servicios, incluidos auxiliares. [Compose: cgroup_parent](https://docs.docker.com/reference/compose-file/services/#cgroup_parent).

El ensayo debe verificar **valores esperados**, no solo que sean distintos de cero: RAM, CPU, PIDs y swap, tanto de servicios permanentes como de un `run` de comprobacion/migracion/consola. La prueba textual actual pasó, pero su frase sobre reservar CPU debe corregirse. `deploy` es opcional en la especificación; la evidencia concreta aquí es Compose **5.4.0** sobre Engine **29.7.2**, con límites efectivos, no una garantía para cualquier implementación/versión. [Compose deploy](https://docs.docker.com/reference/compose-file/deploy/).

## Órdenes principales y trazabilidad

Todas desde `/tmp/feruga-codex-qa14`. Las contraseñas de las sondas son ficticias, solo para estos recursos locales. Las sondas deliberadas de OOM no se deben apuntar a otra instalación.

```sh
# Resolver y comprobar límites exactos de los archivos originales, con recursos propios:
python3 qa/codex44-compose-verificar.py

# Infraestructura propia y cliente para preparar permisos del volumen vacío:
docker compose -f qa/codex44-compose.yml up -d db
docker compose -f qa/codex44-compose.yml run -d --no-deps --name codex44-herramienta herramienta
docker exec -u root codex44-herramienta chown node:node /trabajo
docker cp qa/codex44-db-monitor.sh codex44-db:/tmp/codex44-db-monitor.sh

# Año real del sembrador (la ampliación de 120 a 365 existe únicamente en qa/):
docker exec codex44-db createdb -U codex44 codex44-365
docker compose -f qa/codex44-compose.yml -f qa/codex44-admin.yml run -d --no-deps --name codex44-anual -e DATABASE_URL=postgres://codex44:codex44-solo-prueba@db:5432/codex44-365 herramienta qa/codex44-medidor.mjs codex44-anual node qa/codex44-anual.ts
python3 qa/codex44-seguir.py codex44-anual

# Respaldo real/diario, tubería/descifrado y restauración, una fase a la vez:
python3 qa/codex44-cargas.py
# Web + Caddy + API con sesión y concurrencia 10:
python3 qa/codex44-web.py

# Muerte del coordinador durante subida; esperar y arrancar el MISMO contenedor:
docker compose -f qa/codex44-compose.yml -f qa/codex44-s3.yml -f qa/codex44-oom.yml run -d --no-deps --name codex44-oom-respaldo -e DATABASE_URL=postgres://codex44:codex44-solo-prueba@db:5432/codex44-365 herramienta qa/codex44-oom-respaldo.ts
docker wait codex44-oom-respaldo
docker inspect codex44-oom-respaldo --format '{{json .State}}'
docker start -a codex44-oom-respaldo
```

Las otras cargas siguen el mismo patrón de Compose propio + `qa/codex44-medidor.mjs <nombre> node <sonda>` + `python3 qa/codex44-seguir.py <nombre>`; los JSON guardan comando, tiempo, máximos y delta de `memory.events`/`cpu.stat`. `qa/codex44-rclone-ayuda.txt` confirma para el binario utilizado: cutoff **200Mi**, bloques **5Mi**, concurrencia de subida **4**.

## Lo comprobado bien y lo no cubierto

**Bien:** aplicación de los siete topes efectivos y de `run`; prueba focalizada 1/1; año completo con tablas/reglas reales; pg_dump/age, S3 y diario por funciones reales; tubería solicitada; pg_restore transaccional con recuentos; multipartes 256 MiB con SHA-256; web y Caddy con sesión real y 200 peticiones concurrentes; 100 conexiones PostgreSQL con 108 tareas; OOM real del coordinador de respaldo y del migrador; reintento de migración sin aplicación parcial. No hubo OOM espontáneo en esas cargas normales.

**No cubierto:** servidor real de 2 CPU ni carga de la aplicación vecina; SLA de latencia, concurrencia prolongada, meses de fugas de memoria; 100 consultas SQL pesadas simultáneas; restaurar un respaldo de varios GiB y todas las migraciones futuras; tráfico TLS masivo/ACME; proveedor S3 externo, retención y corte durante multipart; OOM deliberado del proceso PostgreSQL; cierre y recuperación de la publicación completos, cuyos ensayos estaban prohibidos. No se ejecutó `restaurar()` completa: su validación exige nombres sin guiones (`restaurar.ts:31`), incompatible con el prefijo de bases `codex44-` exigido aquí; se midieron pg_restore y descifrado con sus opciones reales y se revisaron en código auditoría, renombrado y reintento. No se cambió esa validación para acomodar la sonda.

La propuesta de quitar swap queda comprobada en clientes de restauración/pipeline, multipart, web y proxy; **db y la siembra anual usaron la política por omisión**, con swap observada. Antes de imponer cero swap a db en el host compartido, medir ese escenario. No corrí `npm ci`, `npm install`, los ensayos compartidos ni pruebas de tipos (no hubo cambios en código del producto). No se modificó, creó ni borró ningún archivo del árbol original `/Users/maantora/Desktop/feruga`.

**Limpieza terminada:** `python3 qa/codex44-limpiar.py` eliminó los 16 contenedores, los tres volúmenes nombrados y la red de laboratorio. Verificación posterior: **0 contenedores, 0 volúmenes, 0 redes `codex44-`**. Los contenedores de la sonda de límites y el test focalizado ya se habían eliminado al terminar sus respectivas pruebas. Evidencias: `qa/codex44-limpieza.json` y `qa/codex44-limpieza.log`. Las bases propias desaparecieron junto con su volumen. Se conservan únicamente sondas, informe y registros en `qa/`; no se borró ninguna imagen compartida.
