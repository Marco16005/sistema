# Encargo 45 — revisión del plan y código de cambio del servidor de la base

Revisión terminada, 10 de noviembre de 2026. R45-01 atendido para el estado detenido/ausente; quedan cinco hallazgos nuevos (R45-02 a R45-06), dos de gravedad alta. Solo se escriben archivos en `/tmp/feruga-codex-qa14/qa/`. No se ejecutan los ensayos reservados ni se intervienen servicios de otras instalaciones.

## R45-01 — alta — Volver no puede reparar una recreación interrumpida antes de consultar la base

**Dónde:** plan, «Recuperar, y volver al respaldo», propuesta de recrear después de esperar y mirar las bases; `operacion/volver.sh:115–118`; `operacion/pasos.sh:397–401`.

**Cómo se comprueba:** `esperar_al_migrador` termina llamando a `estado_de_la_base` y falla si no contesta. Después `mirar_las_bases` también exige SQL. Si `volver.sh` muere durante la nueva recreación de db y deja el contenedor detenido o ausente, repetirlo se detiene en esa consulta, sin alcanzar la reparación propuesta. No basta probar una publicación interrumpida: hay que interrumpir la propia vuelta.

**Qué cambiaría en el plan:** especificar una fase de disponibilidad antes de cualquier consulta SQL, separada de la decisión de cambiar de configuración y de la espera de procesos huérfanos. No mover simplemente la recreación por delante de todo: deben protegerse las operaciones que todavía usan la base y validarse las condiciones para volver. Añadir cortes dentro de esa fase y en cada paso de vuelta.

**Revisión del plan y código nuevos:** el defecto original queda **resuelto para un contenedor detenido o ausente**. El plan introduce tres tiempos; `volver.sh:127–140` y `publicar.sh:478–495` arrancan antes de la primera consulta SQL cuando `la_base_corre` da falso. Después esperan el migrador y los demás procesos. En volver, `servidor_de_antes` se ejecuta tras apartar la base y antes de restaurar, y de nuevo antes de levantar; repetirlo es idempotente. El ensayo nuevo corta la vuelta en `vuelta-base:despues`, detiene db y vuelve a ejecutar: esa regresión sí debe fallar si se elimina el arranque inicial. No cierro con esto todos los estados intermedios de Docker: se revisan aparte a continuación.

## R45-02 — alta — «Running» no asegura que la base conteste; una configuración nueva puede dejar recuperar y volver sin salida automática

**Dónde:** `operacion/pasos.sh:330–335,415–419`; `operacion/publicar.sh:483–495`; `operacion/volver.sh:131–140`; primer tiempo de «Recuperar, y volver al respaldo» en el plan.

**Cómo se comprueba:** una candidata puede conservar PostgreSQL 17 y cambiar `command` a `postgres -c listen_addresses=localhost`. El contenedor queda Running y el healthcheck local (`pg_isready` sin host en `docker-compose.yml`) puede quedar sano, pero las herramientas en otros contenedores ya no llegan a `db:5432`. El paso 4 bis falla al leer la marca, antes de anotar migración. Recuperar ve Running, omite el primer arranque, y `esperar_al_migrador` falla en SQL incluso cuando no existe ningún migrador ni otro proceso pendiente. Nunca llega a recrear con la configuración anterior. Repetirlo no lo repara. El mismo obstáculo existe en volver si el servidor queda inaccesible durante una vuelta. Un arranque lento tras un corte también produce temporalmente esta rama, aunque en ese caso puede bastar esperar y reintentar.

**Evidencia ejecutada:** `qa/sondas-45.test.ts`, con el arnés de Docker/Git simulado de las pruebas existentes, mantiene Running, hace fallar SQL y deja vacías las listas de procesos pendientes. Dos intentos de recuperar y dos de volver terminan en código 1, sin ningún `up … db`. Salida en `qa/sondas-45.log`. Es reproducción del flujo con dobles; no se ejecutó el ejemplo de `listen_addresses` en Docker real.

**Qué cambiaría en el plan y código:** distinguir disponibilidad SQL, salud y estado del contenedor. Dar plazo al arranque en curso sin recrearlo mientras queden trabajos que lo usen. Separar la espera de contenedores huérfanos de la comprobación SQL del migrador, de modo que, cuando ya no quede ninguno, se pueda reparar el servidor inaccesible con la configuración elegida, y después comprobar las sesiones y la identidad. Conservar el candado y no dar «no contesta» por «no hay nada». Probar también Running/no disponible, no solo detenido. Para volver, mantener la validación de que corresponde restaurar antes de las acciones destructivas.


## R45-03 — media — La garantía de formato de PostgreSQL no garantiza cualquier cambio de imagen o configuración con PG_MAJOR igual

**Dónde:** plan, «Lo que se puede y lo que no»; `publicar.sh:364–379`; comentarios de `pasos.sh:319–322` y `volver.sh:85–87`.

**Cómo se comprueba:** PostgreSQL garantiza compatibilidad del formato interno entre menores anteriores y posteriores de la misma mayor: para sustituir esos ejecutables basta parar y arrancar conservando el directorio de datos. Esa parte del plan es correcta. [Documentación de actualización de PostgreSQL 17](https://www.postgresql.org/docs/17/upgrading.html).

La condición actual solo compara PG_MAJOR y acepta también cambiar de distribución/bibliotecas (por ejemplo Alpine a Debian, o una actualización de ICU) o cualquier configuración. PostgreSQL advierte que cambiar las reglas de colación puede invalidar índices; exige reconstruir los objetos afectados y después actualizar la versión de la colación, en ese orden. Que el servidor arranque y conserve la marca no lo detecta. El mismo problema se debe considerar al regresar de biblioteca. [ALTER COLLATION en PostgreSQL 17](https://www.postgresql.org/docs/17/sql-altercollation.html).

Además, las menores pueden exigir acciones correctivas particulares: 17.1 documenta reparación de catálogos/datos en un caso de particiones y REINDEX para una combinación específica de LC_CTYPE/LC_COLLATE. Esto no contradice la compatibilidad de formato ni significa que esos casos afecten esta instalación; sí demuestra que «mismo PG_MAJOR» no sustituye leer las notas de las versiones. [Notas de 17.1](https://www.postgresql.org/docs/17/release-17-1.html), [política de versiones](https://www.postgresql.org/support/versioning/).

**Alcance comprobado aquí:** la imagen fijada dice `PG_MAJOR=17`, `PG_VERSION=17.11` (inspección de imagen, sin arrancar contenedores). El código contiene `CREATE EXTENSION pgcrypto` y un índice único sobre `lower(btrim(nombre))` en `db/migraciones/0013_identidad.sql:17–21`; no fija una política de colaciones en Compose. No inspeccioné las colaciones ni extensiones de la base del usuario, y no afirmo que hoy estén corruptas. Tampoco encontré aquí una actualización explícita de extensión que por sí sola impida volver. `pgcrypto` depende de que el servidor esté construido con OpenSSL. [Documentación de pgcrypto](https://www.postgresql.org/docs/17/pgcrypto.html).

**Qué cambiaría en el plan y código:** limitar expresamente este camino a parches de una imagen oficial con distribución, bibliotecas relevantes, almacenamiento y extensiones compatibles, y a ajustes de recursos/parada conocidos. Exigir revisión de las notas de versiones e inventario de colaciones/extensiones al cambiar imagen. Para cambios de distribución, proveedor de colación, bibliotecas o rutas/volúmenes, rechazar o definir otro procedimiento con sus comprobaciones y vuelta. No añadir REINDEX indiscriminado ni una actualización de extensión automática. El cambio actual de topes no necesita ninguna de esas operaciones.


## R45-04 — media — Las pruebas no detectan recrear antes de que termine una restauración o un respaldo pendiente

**Dónde:** `pruebas/36-guiones.test.ts:939–983`; sección nueva de `operacion/ensayo-publicacion.sh:604–687`; apartado «Las pruebas» del plan.

**Cómo se comprueba:** ejecuté una mutación deliberadamente incorrecta, solo en `qa/mutante-45/`: moví la recreación del tercer tiempo de recuperar entre `esperar_al_migrador` y `esperar_lo_que_quedo`. Así podría cortar una restauración o respaldo huérfano. Las **31 pruebas de guiones siguen pasando**, incluidas las tres nuevas (`qa/mutante-45.log`; hay 32 resultados porque también se ejecutó la prueba extraída de topes). La prueba nueva solo compara el primer arranque con la primera búsqueda del migrador; no sitúa la recreación después de la espera de los otros servicios. Tampoco comprueba el resultado final de recuperar: el doble no implementa `decidir` y el guion acaba fallando por una decisión vacía, sin que la prueba lo afirme.

Por lectura, la sección nueva del ensayo tampoco obliga a distinguir ese orden: no deja ningún respaldo/restauración vivo cuando cambia db. Los casos anteriores con procesos huérfanos tienen la misma configuración de db, por lo que no ejercitan la nueva rama. **No he ejecutado el ensayo ni la mutación del ensayo**; lo observado en ejecución es que la batería de guiones acepta el cambio incorrecto.

**Lo que el ensayo nuevo sí detecta:** quitar el paso 4 bis, no recrear realmente el contenedor, dejar la memoria anterior al publicar, no volver a la memoria anterior, perder la marca o cambiar datos, omitir el arranque inicial con db detenida y retirar el servidor candidato tras una migración fallida. Las guardas de memoria antes/después impiden que esos casos pasen sin haberse preparado; `atiende_con` comprueba por HTTPS la marca conservada y la publicación. Cortar en `vuelta-base:despues` y luego detener db sí cubre el defecto original de R45-01.

**Qué cambiaría en el plan y pruebas:**

- Dejar un trabajo real retenido en SQL cuando cambia db; verificar que mantiene su conexión y que no cambia el ID del contenedor mientras se lo espera. Luego liberarlo y exigir que se recree. Un `sleep` ajeno a SQL por sí solo no detecta que le hayan cortado la base. Repetir para recuperar y volver, con aserciones del orden en los dobles.
- Probar la decisión al preparar con 17/17, 17/18, mayor ilegible en la anterior y en la candidata, y error de inspección; exigir que los rechazos ocurran antes de cerrar/escribir el manifiesto. La prueba de `mayor_de_la_base` solo cubre el lector; el proxy del ensayo solo cubre «sin PG_MAJOR», no dos mayores numéricas distintas.
- Con cambio de db, cubrir `1 candidato` y `1 anterior` tras otro corte de recuperar, además de la rama 2 con db detenida. Actualmente la rama 2 se verifica con db ya corriendo y la detenida solo sin migración.
- Cubrir contenedor ausente y Running/no disponible (R45-02), cortes antes/después de la recreación durante recuperar, y reanudaciones de volver tras restaurar y tras levantar con la configuración de db distinta. El resto del ensayo ya cubre varias de esas fases sin cambio de servidor; hace falta cruzar algunas con este cambio, no duplicar toda la batería.

No sobra ninguno de los casos nuevos. El plan dice `vuelta-base:antes`, pero el ensayo implementado corta en `vuelta-base:despues`; conviene reflejar ambos puntos y su propósito.


## R45-05 — baja — La instrucción junto a la imagen sigue diciendo que publicar rechaza cualquier cambio de servidor

**Dónde:** `docker/db.Dockerfile:4–6` y resumen de pasos al principio de `operacion/publicar.sh:13–28`.

**Cómo se comprueba:** el Dockerfile dice que cambiar esa línea no se hace publicando y que publicar se niega, cuando el código nuevo acepta la misma mayor. La lista de pasos del guion salta de respaldar a migrar y omite el nuevo 4 bis.

**Qué cambiaría en el plan/código:** actualizar esos comentarios con el alcance permitido y sus condiciones (R45-03), y añadir 4 bis al resumen. Así quien cambie la huella encuentra la instrucción vigente en el propio archivo.

## R45-06 — alta — Un error al consultar Docker autoriza recrear la base antes de esperar a quienes la usan

**Dónde:** `operacion/pasos.sh:330–334`; `publicar.sh:484–487`; `volver.sh:131–134`; prueba `pruebas/36-guiones.test.ts:927–937`.

**Cómo se comprueba:** `la_base_corre` devuelve 1 tanto si no hay contenedor Running como si falla `docker compose ps`. Sus dos consumidores interpretan ambos casos como «la base está detenida» y ejecutan `up … db` antes de esperar migrador/restauración/respaldo. Si solo falló la consulta (por ejemplo, un error transitorio del cliente/API), db puede seguir corriendo con la otra configuración y una restauración usándola: el `up` que sí funciona la recrea y corta ese trabajo. La premisa del plan «detenido, nada lo usa» no está demostrada cuando la inspección falla. El candado no protege del contenedor huérfano que precisamente se necesita esperar.

**Evidencia ejecutada:** las dos sondas adicionales en `qa/sondas-45.test.ts` hacen fallar únicamente la consulta Running y mantienen visible un contenedor de restauración. Tanto recuperar como volver llaman a `up` con la configuración anterior antes de consultar esa restauración viva; solo después se detienen porque no termina. `qa/sondas-45.log` registra la recreación en la llamada 12 y la búsqueda de restauraciones en la 20 (índices del arnés). Son órdenes verificadas con dobles, no una restauración real interrumpida. La prueba nueva original confirma explícitamente «no corre» ante error de Docker, por lo que fija el comportamiento problemático.

**Qué cambiaría en el plan y código:** hacer esta consulta de tres resultados: corre, no corre y no se pudo saber. Solo el segundo autoriza el arranque inicial; el tercero debe detenerse sin recrear (o reintentar la inspección con plazo). Cambiar sus dos consumidores y la prueba que hoy equipara error con ausencia. Es distinto de R45-02: allí se conoce Running pero falta disponibilidad SQL; aquí ni siquiera se conoce el estado del contenedor.

## Lo revisado y encontrado bien

### Selección de configuración, manifiesto y candado

No hace falta una marca nueva para saber qué configuración corresponde. `empezoLaMigracion` se escribe después de que el paso 4 bis termina y valida la identidad, y antes de lanzar el migrador. Las reglas de `publicacion.ts` excluyen migrar y desistir a la vez. Para los recorridos válidos:

| Punto de interrupción | Servidor elegido por recuperar | Resultado previsto |
| --- | --- | --- |
| Preparación, antes de crear manifiesto | No hay publicación pendiente | Lo vigente sigue atendiendo |
| Manifiesto/cierre/respaldo/`base:antes` | Anterior | Desistir, comprobar y abrir anterior |
| A media recreación o `base:despues`, sin marca de migración | Anterior | Recuperar disponibilidad, esperar, recrear y desistir |
| Marca de migración escrita, incluso antes de lanzar el proceso | Candidato | Esperar migrador; sin decisión de apertura, caso 2, cerrado |
| Decisión de abrir candidato, antes o después de abrir | Candidato | Terminar hacia adelante |
| `noSePublica` y decisión de reabrir (`1 anterior`) | Anterior | Terminar hacia adelante con la anterior |

Las reservas R45-02 y R45-06 aplican a disponibilidad y errores de inspección; la tabla no las da por resueltas. `corre` recibe la configuración y el conjunto correspondientes: candidato al preparar lo vigente y al terminar una publicación, anterior al desistir y al volver al respaldo. Verifica imagen, huella, salud y cardinalidad, no solo que haya un contenedor. Las consultas con `$conf` tras reponer db anterior siguen utilizando las herramientas candidatas sobre el mismo servicio; esto funciona para el cambio actual de recursos, bajo las condiciones de conectividad/almacenamiento acotadas en R45-03.

El candado se adquiere antes de preparar trabajo, reparar db o decidir. `arrancar` conserva el descriptor 9; mientras siga vivo el cliente Compose heredero del candado no entra otra operación. `migrar_con` crea el migrador con el candado y suelta la herencia solo para seguirlo, por eso recuperarlo exige la espera explícita. No encontré una nueva ventana entre dos operaciones autorizadas en los cambios revisados. La lectura de los ensayos anteriores y las pruebas de guiones incluyen exclusión mutua y procesos huérfanos; el cruce con recreación requiere R45-04.

### Volver y retomar la vuelta

Con db disponible, el orden nuevo es correcto: esperar migrador y otros procesos; mirar las bases; comprobar que corresponde volver; detener/drenar; apartar; poner servidor anterior; restaurar; poner servidor anterior idempotentemente y levantar. La segunda llamada a `servidor_de_antes` es necesaria si se retoma con la restauración ya concluida: esa rama salta la primera. Si se muere tras apartar, se restaura; tras restaurar, se levanta sin restaurar de nuevo; tras levantar pero antes de cerrar el manifiesto, se repiten arranques/comprobaciones. No se abre como efecto colateral de restaurar.

`--abrir` es otra fase sobre el manifiesto ya cerrado: no recrea db. Si la instalación se detuvo después, su vía existente es levantar lo publicado antes de abrir. No lo cuento como la recreación interrumpida de R45-01.

### PG_MAJOR frente a PG_VERSION

Leer `PG_MAJOR` mediante `docker image inspect` es razonable **para las imágenes oficiales fijadas por huella que usa este proyecto**: no ejecuta un servidor ni necesita base disponible, y la variable forma parte de la construcción oficial. La implementación rechaza vacío, texto y errores de inspección; la comparación exige igualdad. La imagen fijada localmente lo confirma (17; versión completa 17.11). Es metadato de esa imagen, no una certificación de cualquier imagen ajena. [Plantilla oficial de la imagen PostgreSQL](https://github.com/docker-library/postgres/blob/master/Dockerfile-alpine.template).

El archivo `PG_VERSION` del volumen es una fuente adecuada para la **mayor del clúster existente**, pero no dice qué ejecutable trae la candidata, por lo que no reemplaza las dos lecturas de imagen. Serviría como comprobación adicional del volumen/mayor, leyéndolo por la ruta real de PGDATA sin modificarlo. No debe confundirse con la variable de entorno `PG_VERSION` de la imagen, que contiene la versión completa. Ejecutar `postgres --version` en un contenedor sin montar datos también confirma el binario, con más trabajo que inspeccionar la imagen; no hace falta agregar una dependencia. [Formato del directorio de datos de PostgreSQL 17](https://www.postgresql.org/docs/17/storage-file-layout.html).

### Plazo de parada

`2m` mejora el margen frente a los diez segundos por omisión; **no garantiza** que cualquier base termine limpia en dos minutos. Es el máximo antes de SIGKILL, no una espera fija. La imagen oficial usa SIGINT, apagado rápido que aborta transacciones abiertas y espera a los procesos. El plazo adecuado depende del almacenamiento y carga, y se debe observar en el ensayo/servidor. La propia plantilla oficial advierte que incluso 90 segundos pueden no bastar. Cambiaría «se apaga limpio» por «se le da más tiempo para apagarse limpio». [Parada de PostgreSQL](https://www.postgresql.org/docs/17/server-shutdown.html), [imagen oficial](https://github.com/docker-library/postgres/blob/master/Dockerfile-alpine.template), [stop_grace_period en Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period).

`cerrar_y_drenar` solo detiene web y respaldo: los dos minutos no alargan esa fase. Sí pueden afectar recrear db, detenerla expresamente o levantar con cambios que requieran recreación. `arrancar --no-deps` conserva el orden explícito; no arranca de rebote web/respaldo al reparar db. Esto no cambia el plazo de 15 minutos del servicio de respaldo. No medí cuánto tarda apagar una base grande ni probé un corte forzado por timeout.

### Topes de Compose

Contrasté por lectura el Compose nuevo con el archivo de HEAD (solo `git show`, sin escribir en el repositorio). Se conservan los valores y no había reservas, políticas de ubicación ni otros ajustes de deploy que se pierdan:

| Servicio | Memoria / memoria+swap | CPU | Procesos |
| --- | --- | --- | --- |
| db | 1 GiB / 1 GiB | 1.5 | 256 |
| web | 768 MiB / 768 MiB | 1.5 | 128 |
| respaldo y comprobación | 768 MiB / 768 MiB | 1 | 128 |
| migración y consola | 512 MiB / 512 MiB | 1 | 64 |
| proxy | 256 MiB / 256 MiB | 1 | 128 |

`memory → mem_limit`, `cpus → cpus`, `pids → pids_limit` preservan el propósito de los límites en Compose local. `memswap_limit` ya existía y sigue igual a memoria: no se permite intercambio adicional. No hay que mantener simultáneamente deploy y los atributos nuevos. Esto no promete equivalencia para `docker stack deploy`/Swarm, que no es el procedimiento de la instalación. La prueba estática extraída pasa; el ensayo existente inspecciona Memory, MemorySwap, NanoCpus y PidsLimit reales, aunque para CPU/procesos solo exige que no sean cero. [Atributos de servicios en Compose](https://docs.docker.com/reference/compose-file/services/).

## Verificaciones, artefactos y límites

- `pruebas/36-guiones.test.ts`: **31/31 pasan**, con Docker y Git simulados. Salida en `qa/pruebas-45.log`.
- `pruebas/20-entorno.test.ts`: la ejecución completa **no llegó a cargar** por falta de `pg` en la copia. No instalé dependencias ni ejecuté sus pruebas que crean bases en el servidor. Extraje sin cambiar su cuerpo la última prueba estática de topes a `qa/topes-45.test.ts`: **1/1 pasa** (en `qa/mutante-45.log`).
- `qa/sondas-45.test.ts`: **4/4 sondas pasan**, lo que aquí confirma las conductas defectuosas descritas en R45-02 y R45-06; no son pruebas que aprueben el comportamiento deseado. Log en `qa/sondas-45.log`.
- Mutación en `qa/mutante-45/operacion/publicar.sh`: las **31/31** pruebas originales de guiones también pasan con la recreación adelantada incorrectamente. `qa/mutante-45.log`. La copia cambia además las rutas de dos imports de las pruebas para reutilizar los módulos TypeScript originales; la única mutación del guion es el orden descrito en R45-04.
- `sh -n` revisó publicar, volver, pasos y ensayo-publicacion: sin errores de sintaxis. Es comprobación de sintaxis, no ejecución del ensayo.
- Leídos el plan completo, los recorridos de publicar/recuperar/volver, las funciones compartidas indicadas, las marcas/decisión/comprobación de conjuntos, Compose, Dockerfile, el ensayo nuevo y los casos anteriores de cortes, vuelta y concurrencia que lo complementan. Consultada documentación oficial de PostgreSQL y Docker enlazada junto a cada conclusión.
- No ejecuté `ensayo.sh` ni `ensayo-publicacion.sh`, no consulté ni modifiqué la base del usuario y no creé contenedores, redes o volúmenes. La única llamada real a Docker fue inspeccionar los metadatos de la imagen fijada. No tengo el resultado del ensayo que corre el otro lado.
- Quedan sin comprobación real una actualización y bajada entre dos imágenes menores distintas, la recreación interrumpida en estados intermedios de Docker, colaciones/extensiones instaladas en producción, límites efectivos del servidor y tiempos de parada bajo carga. La recuperación del estado Running/no disponible y el orden incorrecto ante error de inspección se demostraron con dobles, no en una instalación real.
- Todos los archivos creados/modificados por esta revisión están bajo `/tmp/feruga-codex-qa14/qa/`; los temporales de Node también (`TMPDIR=…/qa/tmp`). No se modificó código del producto ni ningún archivo bajo `/Users/maantora/Desktop/feruga`.
