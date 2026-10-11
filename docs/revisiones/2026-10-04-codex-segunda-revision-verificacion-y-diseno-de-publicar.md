# Segunda revisión de Codex: verificación de las correcciones a las tareas 3 y 4, y revisión del diseño de la tarea 5 (4 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución. Se le pidió no modificar archivos del proyecto:
trabajó sobre una copia en `/tmp/feruga-codex-qa2/`. Es el informe tal como lo entregó (los enlaces
a `/tmp/feruga-codex-qa2/` apuntan a sus registros, que no forman parte del proyecto).

**Veredictos.** Parte 1: el bloqueante quedó corregido, pero **las tareas 3 y 4 todavía no se
cierran**: cinco importantes y dos menores. Parte 2: **el diseño de la tarea 5 no se puede
codificar como estaba**: tres bloqueantes y cuatro importantes.

La respuesta está en `2026-10-04-respuesta-a-la-segunda-revision.md`.

---


Fecha: 4 de octubre de 2026. Proyecto: `/Users/maantora/Desktop/feruga/sistema`.

**Parte 1: las tareas 3 y 4 todavía no quedan cerradas.** El bloqueante B1 está corregido. De los diez hallazgos anteriores, nueve quedan corregidos dentro de su alcance; I2 queda corregido a medias. Esta revisión deja **cinco importantes y dos menores**: cuatro importantes adicionales y la parte pendiente de I2. No encontré un nuevo bloqueante en esas dos tareas.

**Parte 2: el diseño de tarea 5 no debe codificarse tal como está.** Tiene **tres bloqueantes y cuatro importantes** que deben resolverse en el diseño: apertura prematura al negocio, criterio insuficiente de vuelta automática, recuperación de una publicación interrumpida, identidad de versiones, actualización conjunta de servicios, finalización de peticiones y cobertura del ensayo.

No modifiqué, creé ni borré archivos dentro de `/Users/maantora/Desktop/feruga`. La copia, guiones y registros están en `/tmp/feruga-codex-qa2/`. Los avances escritos durante la revisión se conservan en [informe-avances.md](/tmp/feruga-codex-qa2/informe-avances.md); este documento los consolida. Los problemas de diseño se distinguen de los defectos reproducidos: todavía no existe `publicar.sh`.

## Parte 1 — Verificación de las tareas 3 y 4

### 1. Ejecuciones y resultados

Se leyeron la revisión anterior, su respuesta y el plan, así como los cambios señalados y sus dependencias: migrador, apertura de permisos, conexión de la aplicación, marca de restauración, Compose, ensayo y recorridos.

La batería usó la plantilla solicitada y montó la copia, porque `npm run tipos` puede escribir el archivo incremental:

```sh
cd /Users/maantora/Desktop/feruga/sistema
docker compose --profile pruebas run --rm \
  -v /tmp/feruga-codex-qa2/sistema:/app \
  -e PG_PLANTILLA=feruga_plantilla_codex \
  pruebas sh -c 'npm run tipos && npm test'
```

**Tipos correctos; 594 pruebas aprobadas, cero fallidas**, 94,16 segundos de pruebas. [Registro](/tmp/feruga-codex-qa2/bateria.log).

El ensayo se ejecutó **una vez y sin otro ensayo simultáneo**, desde la copia, con `CONSERVAR=1` para las comprobaciones posteriores. Se quitó únicamente el `npm ci` del comando de `recorrido_operacion` y se declaró externo el volumen existente `feruga_modulos_recorrido`. Se dirigió Buildx a `/tmp`. No se pidió `npm ci` ni `npm install` en las ejecuciones de batería o recorridos; las construcciones usaron las imágenes y caché disponibles.

**Ensayo completo aprobado, con seis recorridos HTTPS.** Acreditó barrera del migrador, rechazo del entorno incorrecto, red local, certificado validado, compra, candados entre dos pestañas, aviso asociado a la corrida, configuración fijada ante cambio del `.env` y persistencia del certificado. [Registro](/tmp/feruga-codex-qa2/ensayo.log).

Los guiones anteriores se copiaron y repitieron contra el código actual. Se adaptó `codex-cruces.ts` para comprobar el orden nuevo y continuar después del rechazo del esquema futuro; `codex-plazos.ts` usa ahora `ultimoUtilizable`, como la consola actual. Los demás mantienen sus secuencias. Un código 0 del guion significa que terminó la reproducción, no que todo lo observado sea correcto.

| Ejecución | Resultado | Evidencia |
|---|---|---|
| Cruces anteriores | Dos respaldos reales a `.887` y `.966` del mismo segundo: restauró el segundo y su marca `n=1`. Migración entre metadato y volcado: ambos quedan en 0020. Esquema futuro rechazado. Host mode y montaje `/var/run` rechazados. Reloj retrocedido vuelve a respaldar. Recuperación histórica tras borrado correcta. | [cruces.log](/tmp/feruga-codex-qa2/cruces.log) |
| Plazos anteriores | Cifrado y cuatro transferencias vencen a 800 ms, avisan la fase y limpian. Si falla la lectura posterior a subir el manifiesto, este puede existir. El manifiesto con JSON roto provoca una nueva corrida al reiniciar. | [plazos.log](/tmp/feruga-codex-qa2/plazos.log) |
| Migración activa y turno | Migración retenida antes del commit: respaldo coherente de la versión previa, sin tabla nueva. Turno retenido: vence a 100 ms. | [migracion-activa.log](/tmp/feruga-codex-qa2/migracion-activa.log) |
| Versiones y destino intermitente | 0019 restaura y migra a 0020; modificaciones del objeto/manifiesto después de listar se rechazan; fallo inicial de listado no impide respaldar. | [versiones.log](/tmp/feruga-codex-qa2/versiones.log) |
| Consola real de ensayo con esquema futuro | Código 1, cero avisos de éxito al vigilante. | [ensayo-futuro.log](/tmp/feruga-codex-qa2/ensayo-futuro.log) |
| Errores y secretos | Error real de pg_dump por falta de permiso en `sucursal`, con principio y final conservados. No apareció la contraseña comprobada en los errores de pg_dump/rclone. | [secretos.log](/tmp/feruga-codex-qa2/secretos.log) |
| Servicio y respaldo manual en contenedores distintos | Barrera real: uno espera el turno mientras el otro espera un candado de tabla. Ambos terminan; dos respaldos. | [concurrencia.log](/tmp/feruga-codex-qa2/concurrencia.log) |
| B1 repetido por HTTPS | Esquema incompatible y marca de vida inválida: salud 503, compra 503, cuentas antes/después `3/3`. Tras retirar la anomalía, salud 200. | [b1-https.log](/tmp/feruga-codex-qa2/b1-https.log) |
| Dos `levantar.sh` reales | Primero detenido por barrera antes de comprobar; segundo rechaza con código 1. El primero termina 0. Archivo 0600, carpeta 0700; limpieza completa; contenedores con los mismos identificadores. | [levantar-real.log](/tmp/feruga-codex-qa2/levantar-real.log) |
| Fallos/interrupciones de guiones | Con doble de Docker: error normal y SIGTERM limpian en el shell probado; SIGKILL deja carpeta privada y candado; fallo de mktemp deja candado; fallo temprano del ensayo limpia. | [interrupciones.log](/tmp/feruga-codex-qa2/interrupciones.log) |
| Plazos antes no provocados | pg_dump `--version` retenido vence en 10,008 s. Descifrado y pg_restore retenidos vencen sin dejar base ni carpeta de restauración. Para estos dos se aceleró el temporizador de una hora a 400 ms; no se esperó una hora real. | [plazos-nuevos.log](/tmp/feruga-codex-qa2/plazos-nuevos.log) |
| Disco lleno | tmpfs de 1 MiB: pg_dump falla por falta de espacio, cero respaldos, cero carpetas. Con espacio vuelve a producir un respaldo de 6.857.250 bytes. | [disco.log](/tmp/feruga-codex-qa2/disco.log) |
| Cruces nuevos | Marca de vida antigua en el pozo, base caída, nombres antiguos, exploración de 100 manifiestos fallidos y plazo con instantánea abierta. | [nuevos.log](/tmp/feruga-codex-qa2/nuevos.log) |
| Manifiestos nuevos | Tamaños inválidos todavía acreditados; respaldo de nombre antiguo restaurable como archivo, invisible para restaurar por nombre. | [manifiestos.log](/tmp/feruga-codex-qa2/manifiestos.log) |
| Muerte del exportador | El plazo falla, pero deja backend del volcado esperando un candado. Se limpió expresamente desde otra conexión. | [turno-muerto.log](/tmp/feruga-codex-qa2/turno-muerto.log) |

No repetí los 106 recorridos generales: sí los seis de operación y el recorrido adicional de B1. No repetí las 23 mutaciones antiguas, ni todas las mutaciones nuevas declaradas por la respuesta. No atribuyo como ejecución propia esas comprobaciones históricas.

### 2. Estado de cada hallazgo anterior

| Hallazgo | Estado | Evidencia y límite |
|---|---|---|
| **B1: salud fallida pero negocio operativo** | **Corregido** | Las rutas consultan `baseApta`; batería y reproducción HTTPS niegan escrituras tanto por esquema como por marca inválida. Los problemas de recuperación del pozo y código HTTP se separan abajo; no reproducen la escritura indebida. |
| **I1: orden dentro del segundo** | **Corregido** | Dos volcados reales del mismo segundo; se restauró el último. `ahora` entrega el nombre exacto. La compatibilidad con nombres anteriores es una regresión separada, P1-I1. |
| **I2: manifiesto dañado contado como reciente** | **Corregido a medias** | JSON roto sí se descarta y fuerza respaldo; no hay restauración silenciosa de uno anterior. Pero se aceptan tamaños imposibles/incoherentes (P1-I4) y la búsqueda puede quedar recorriendo fallos de transporte durante demasiado tiempo (P1-I3). |
| **I3: esquema del manifiesto distinto del volcado** | **Corregido** | Se exporta e importa una sola instantánea. Repetición con migrador real y con migración pendiente de commit: versión y contenido concuerdan. El caso de limpieza con turno muerto es adicional, P1-I5. |
| **I4: esquema futuro restaurado y ensayo exitoso** | **Corregido** | Rechazo temprano por manifiesto y rechazo del contenido real aunque se omita ese filtro, cubiertos por batería; consola real devuelve 1 y no avisa éxito. El ensayo periódico todavía no levanta la aplicación: sigue pendiente la decisión 18. |
| **I5: comprobar un entorno y levantar otro** | **Corregido** | El ensayo cambia el `.env` justo antes de `up`: permanece la configuración comprobada y no cambian los contenedores. Repetición concurrente real confirma exclusión. Construir código actual continúa siendo un límite declarado que debe eliminar tarea 5. |
| **I6: exposición ajena a `ports`** | **Corregido dentro del alcance indicado** | Los cruces y batería rechazan host mode, privilegios y socket por carpeta contenedora, también en modo local. No convierte la función en auditoría universal de Compose ni de capacidades/dispositivos. |
| **I7: reloj retrocedido** | **Corregido** | Secuencia 09:00→07:00: respalda en 07:00, 08:00, 09:00 y 10:00. La batería incluye reloj de base adelantado. |
| **M1: secretos de ensayo expuestos** | **Corregido con alcance explícito** | La generación ejecutada usa `--log-driver none`. Las credenciales desechables de MinIO siguen en argumentos de sus herramientas; la respuesta ya no promete que esto no suceda. Las herramientas de operación conservan secretos fuera de argumentos. No repetí el antiguo observador de logs de Docker. |
| **M2: limpieza instalada tarde** | **Corregido** | La trampa del ensayo se instala al crear su carpeta. Fallo de construcción inyectado antes de configurar el proyecto: salida 7 y carpeta eliminada. SIGKILL no puede resolverse con una trampa. |

### 3. Hallazgos pendientes de esta revisión

Los identificadores P1 son propios de este informe.

#### P1-I1 — Importante: los respaldos anteriores desaparecen del lector

Código: [destino.ts](/Users/maantora/Desktop/feruga/sistema/operacion/destino.ts:104), [selección](/Users/maantora/Desktop/feruga/sistema/operacion/destino.ts:200).

La expresión regular exige ahora tres dígitos de milisegundos. Los objetos de formato anterior —segundos seguidos de `Z`— se descartan antes de leer su manifiesto. Afecta `lista`, `ultimoUtilizable` y restauración **incluso por nombre explícito**.

Reproducción con un volcado real cifrado y manifiesto coherente bajo nombre antiguo: lista vacía; restauración por nombre dice que no existe. Descargado directamente, el mismo archivo restaura y devuelve `comprobado=true`.

**Cambio necesario:** aceptar ambos formatos sin renombrar objetos protegidos. Resolver orden por tiempo, no mezclando lexicográficamente los dos formatos; si hay ambigüedad dentro del segundo de un nombre antiguo, usar el momento del manifiesto. Conservar prueba de restauración de un respaldo emitido por la versión anterior. No es pérdida física del respaldo, pero sí pérdida de acceso mediante el procedimiento normal.

#### P1-I2 — Importante: el pozo puede permanecer con una marca de restauración anterior

Código: [baseApta](/Users/maantora/Desktop/feruga/sistema/src/servidor/esquema.ts:18), [pozo](/Users/maantora/Desktop/feruga/sistema/src/servidor/bd.ts:23), [marca de vida](/Users/maantora/Desktop/feruga/sistema/db/migraciones/0020_restauracion.sql:43).

`vida_vigente()` compara la tabla con una propiedad recibida al abrir la conexión. `registrar_restauracion` cambia la propiedad de la base y su propia sesión, pero no las conexiones ya abiertas por la aplicación.

Reproducción con pozo de una conexión: antes `true`; después de registrar `false`; conexión nueva `true`; la antigua sigue dando `false` con sondeos. El vencimiento es por **inactividad** (30 s), y la salud consulta cada 5 s: una conexión reutilizada puede no renovarse. La repetición con sondeos durante 35 s también terminó con la conexión antigua en false y una nueva en true, superando los 30 s del vencimiento por inactividad: [registro](/tmp/feruga-codex-qa2/pool-35s.log).

No abre la aplicación sobre una base inválida: la deja cerrada. La restauración oficial trabaja en una base aparte y prueba con una conexión nueva, por lo que su recorrido normal no presenta esta secuencia.

**Cambio necesario:** definir y probar la recuperación cuando ya había conexiones. Puede reciclarse el pozo al detectar este cambio o exigirse, mediante el procedimiento, detener y recrear la aplicación después de registrar y antes de verificar. No basta confiar en que el sondeo la recuperará solo. No sustituir la comprobación por una que dé por válida una base restaurada sin registrar.

#### P1-I3 — Importante: la búsqueda de un respaldo utilizable carece de presupuesto total

Código: [ultimoUtilizable](/Users/maantora/Desktop/feruga/sistema/operacion/destino.ts:178).

El bucle captura indistintamente un manifiesto inválido, una credencial denegada y una descarga que agotó su plazo; después descarga el anterior. Solo al terminar la búsqueda puede el servicio decidir tomar un respaldo.

Con 100 candidatos y fallo de transporte por candidato, se hicieron **100 intentos** antes de devolver `null`. La reproducción acortó cada demora a 5 ms; no simuló 50 horas. El código permite hasta 30 minutos **por descarga**, sin presupuesto total: cien agotamientos consumirían hasta 50 horas, además del listado. Un destino intermitente también puede devolver un candidato anterior como si los más nuevos estuvieran dañados, sin distinguir la imposibilidad de verificarlos.

**Cambio necesario:** distinguir fallo de transporte de manifiesto inválido; ante indisponibilidad abortar esa exploración, avisar y dejar que el servicio intente respaldar/reintente pronto. Acotar tiempo total y candidatos. Para muchos respaldos válidos la primera lectura puede bastar; el problema reproducido son muchos candidatos que fallan. No se midió un cubo real con años de historia.

#### P1-I4 — Importante: I2 todavía admite manifiestos que sabe que no pueden restaurarse

Código: [leerManifiesto](/Users/maantora/Desktop/feruga/sistema/operacion/destino.ts:148).

`Number.isSafeInteger(bytes)` acepta `-1`; tampoco se compara el tamaño declarado con el que ya entregó el listado. Con un respaldo real de 246.735 bytes, manifiestos declarando `-1` y `246745` fueron aceptados por `ultimoUtilizable`. Ambos se rechazaron al traer el objeto. Por tanto pueden seguir saldando el respaldo pendiente del servicio aunque ya exista evidencia de que no sirven.

**Cambio necesario:** validar todos los campos obligatorios del formato y su dominio, tamaño positivo y coherencia con el objeto listado. Un SHA-256 de forma válida no acredita por sí solo el contenido: describir la función como «último con manifiesto validado» y mantener la verificación del objeto al restaurar. No se exige descargar todos los volcados para decidir el horario.

Si el último manifiesto no puede analizarse, `traer` se niega y señala un candidato anterior. Si el objeto cifrado está alterado, se niega y ofrece recuperación histórica, pero **no busca otro candidato anterior**. Esto preserva la decisión del operador; la promesa «dice cuál sí sirve» debe limitarse a lo efectivamente comprobado. Si la primera descarga falla transitoriamente y la segunda funciona, incluso puede recomendar el mismo objeto: conviene informar «no se pudo verificar» en vez de declarar corrupción.

#### P1-I5 — Importante: la limpieza del backend depende de que siga viva la conexión del turno

Código: [respaldar.ts](/Users/maantora/Desktop/feruga/sistema/operacion/respaldar.ts:148).

El caso normal está bien: con la conexión exportadora viva, pg_dump retenido vence y `pg_terminate_backend` funciona dentro de la transacción de solo lectura. Plazo 500 ms, terminación observada en 633 ms, cero backends restantes.

Pero al **terminar primero la conexión exportadora**, con pg_dump ya esperando un candado de tabla, el plazo de 1500 ms devuelve error y deja su backend `active`, esperando `relation`. La limpieza consulta por la misma conexión muerta y silencia el fallo. Se observó el backend y se terminó desde una tercera conexión para limpiar el caso.

**Cambio necesario:** disponer de una vía independiente para terminar y verificar la sesión del volcado, y/o imponer plazo del lado de PostgreSQL. Si no se puede confirmar la limpieza, registrarlo expresamente. Una sesión retenida puede conservar candados y estorbar una migración. Es un hallazgo adicional; no atribuyo su origen exclusivamente al cambio de instantánea, pues la dependencia de esa conexión para limpiar ya existía.

#### P1-M1 — Menor: indisponibilidad de base devuelve 500 en negocio y 503 en salud

Código: [ruta.ts](/Users/maantora/Desktop/feruga/sistema/src/servidor/ruta.ts:100).

`ECONNREFUSED` en `baseApta` llega al catch genérico. Reproducción: ruta 500, salud 503, manejador de negocio **no ejecutado**. Unificar los errores de indisponibilidad en 503, conservando el detalle solo en el registro.

Con una base que no responde existen límites de conexión (10 s) y consulta (20 s); no es una respuesta instantánea. No ejecuté una partición de red con paquetes descartados ni una prueba de saturación del pozo: solo rechazo real de conexión y esperas por candados. La consulta de aptitud ocurre también antes de autenticar: añade carga y espera, no sustituye los controles de acceso.

#### P1-M2 — Menor: fallo al crear la carpeta privada deja un candado huérfano

Código: [levantar.sh](/Users/maantora/Desktop/feruga/sistema/operacion/levantar.sh:24).

Se toma el candado, se llama a `mktemp` y después se instala la trampa. Con `mktemp` fallando, el guion termina con código 1 y deja `.operacion.candado`. Instalar la limpieza inmediatamente después de adquirirlo, tolerando que todavía no exista carpeta privada.

### 4. Respuestas a los cruces operativos pedidos

**Base a media migración.** La consulta en cada petición evita atender cuando la versión **confirmada** difiere; no es por sí sola una exclusión mutua con el DDL ni certifica una historia completa de migraciones. La barrera del migrador sigue siendo necesaria: rechaza conexiones no administrativas abiertas, revoca CONNECT y vuelve a revisar. Con la puerta cerrada no entra el usuario web. Si una migración falla después de confirmar otras, la versión y la puerta mantienen cerrada la aplicación. No usar credenciales administrativas para web ni considerar B1 sustituto de detenerla. La reproducción de un archivo de migración insertado por debajo de la última versión, en la parte 2, también muestra el límite de comprobar solo `max(archivo)`.

**Transacción exportada durante el respaldo.** Mantiene una instantánea y candados de lectura hasta que termina pg_dump; puede hacer esperar DDL incompatible y retrasar limpieza de versiones de filas. Se confirma antes del cifrado y transferencias, lo cual evita mantenerla abierta durante toda la subida. El usuario de respaldo es administrativo: no se cuenta como conexión de aplicación al cerrar la puerta. La reproducción con el migrador real avanzando antes del arranque de pg_dump pasó; la migración pendiente de commit dio un respaldo previo coherente. No encontré una interferencia nueva con REVOKE CONNECT en esas secuencias. Sí queda P1-I5 cuando muere el turno. No ensayé todas las combinaciones de ALTER/DROP concurrentes; el publicador debe coordinar respaldo y migración, no depender de que cualquier DDL paralelo resulte compatible.

**Candado y muerte del guion.** `mkdir` proporciona exclusión efectiva entre dos procesos en la misma carpeta; se verificó con dos guiones reales. Con SIGKILL no se ejecuta una trampa: quedan candado y archivo privado. El guion ya se niega y menciona la recuperación manual; no debe borrar automáticamente un candado solo porque parezca viejo. Antes de retirarlo hay que comprobar también procesos hijos y contenedores de una operación incompleta. Dos copias de la instalación con el mismo proyecto Docker tendrían candados distintos: el contrato debe fijar una carpeta de operación o bloquear por identidad real de instalación. Esto importa para tarea 5; no es un fallo de exclusión dentro de la carpeta probada.

**Configuración resuelta y claves.** Carpeta 0700 y archivo 0600 comprobados. Se eliminan al terminar bien, al fallar normalmente y con SIGTERM en el shell probado. Tras SIGKILL permanecen privados y deben incluirse en la recuperación/limpieza, sin imprimir su contenido. Trasladar el JSON a otra carpeta no recreó los servicios en los casos probados: se conservaron los identificadores. Compose resolvió rutas y nombre de proyecto. Congelar el JSON no congela el contenido de imágenes con etiqueta mutable ni de archivos montados desde la carpeta: tarea 5 debe fijarlos por versión.

**Restaurar cuando el último no sirve.** JSON roto: rechazo, propuesta del anterior con manifiesto legible, selección explícita por nombre; probado por batería. Volcado alterado: rechazo por huella; recuperación histórica verificada contra MinIO. Esquema futuro: rechazo sin éxito de ensayo. No hay descenso silencioso. Persisten P1-I1/I3/I4 y la distinción entre manifiesto validado y restauración acreditada.

### 5. Las once observaciones anteriores sobre las pruebas

| N.º | Estado de la observación |
|---|---|
| 1. pg_dump sin permiso | **Corregida.** Ahora se permite leer `migracion`, se alcanza pg_dump y se exige su error; batería y reproducción independiente lo acreditan. |
| 2. Espera que evitaba empate | **Corregida.** Eliminada; dos respaldos reales del mismo segundo se ordenan bien. |
| 3. Inferir bloqueo de negocio desde salud | **Corregida.** Matriz de rutas y escrituras HTTPS efectivas; sin filas nuevas. |
| 4. Fallo implica cero manifiestos | **Corregida a medias.** Se reconoce el fallo posterior a subir y se prueba JSON roto; falta excluir los manifiestos inválidos de P1-I4. |
| 5. Orden sin barreras | **Corregida a medias, reconocida.** Barrera real del migrador; web/proxy no arrancan. Sigue sin acreditarse mediante barrera cada espera de salud de db ni toda la dependencia de comprobación. |
| 6. Búsqueda insuficiente de exposición | **Corregida para el ensayo.** Se inspecciona cada contenedor, puerto/dirección y host mode; ejecución completa aprobada. |
| 7. Validación TLS | **Sigue acreditada.** HTTPS real y rechazo sin CA; no repetí la mutación del navegador. |
| 8. Persistencia del certificado | **Evidencia funcional conservada; mutación pendiente.** Huella igual tras recrear. No demuestra renovación ni restauración de un volumen perdido. |
| 9. Candados entre pestañas | **Corregida.** Dos páginas compiten, la segunda no obtiene el candado y lo obtiene al cerrar la primera. |
| 10. Avisos asociados a la corrida | **Corregida.** Se extrae el UUID del respaldo manual y se exigen sus dos señales. |
| 11. Ensayo funcional de recuperación | **Corregida a medias.** Rechaza esquema futuro y prueba acceso SQL como aplicación; todavía no levanta web ni ejecuta negocio sobre lo restaurado. Decisión 18 pendiente. |

### 6. Pendientes declarados y veredicto de parte 1

- **Decisión 18:** puede completarse en tarea 6 sin bloquear el desarrollo de tarea 5. Debe seguir abierta, y el aviso de ensayo actual no debe presentarse como prueba de arranque y uso de la aplicación. Es condición de cierre del bloque y de operación real.
- **Candado solo entre guiones:** aceptable como interfaz operativa si se fija una instalación y se documenta que Compose manual la elude. El migrador conserva su propia barrera. Para publicar, todos los guiones autorizados deben respetar también el estado durable de mantenimiento/publicación, incluso después de una interrupción.
- **`levantar.sh` todavía construye:** no impide escribir precisamente el reemplazo previsto en tarea 5; sí impide tratar hoy ese guion como una vía segura para cambiar de versión. La tarea 5 debe quitarle la construcción antes de declarar completo el publicador.
- **Mutaciones no repetidas:** no es por sí solo un defecto bloqueante. No certifico sus resultados actuales. Las nuevas garantías críticas deben tener sus reproducciones/mutaciones específicas al cerrar tarea 5.
- **Plazos sin prueba:** se ejecutaron los tres casos declarados pendientes, con la salvedad del reloj acelerado para una hora. Queda el defecto concreto de limpieza P1-I5; no una objeción genérica por falta de pruebas.

**No doy por cerradas las tareas 3 y 4.** Para su aceptación quedan P1-I1 a P1-I5: acceso a respaldos anteriores, recuperación de conexiones tras registro, búsqueda acotada, validación de manifiestos y limpieza del backend con turno muerto. Los dos menores pueden resolverse junto a esas correcciones. La decisión 18 y las pruebas externas permanecen en sus tareas previstas. Se puede ajustar ahora el diseño de tarea 5; no conviene construir su recuperación sobre los defectos de respaldo pendientes ni aprobar el diseño actual.

## Parte 2 — Revisión del diseño de tarea 5 antes de codificar

Referencia: [diseño propuesto](/Users/maantora/Desktop/feruga/sistema/docs/planes/2026-10-03-despliegue.md:449).

El orden básico mejora el plan anterior: construir y comprobar antes de detener, respaldo con web detenida y retorno por nombre exacto. Cumple la intención de decisión 6 y B3 anterior **en el recorrido sin interrupciones**, siempre que detener web implique que ya no quedan operaciones capaces de confirmar. No demuestra todavía recuperación sin pérdida ni mantenimiento persistente. Decisión 8 tampoco queda garantizada si las imágenes cambian pero el registro final no alcanza a escribirse.

### 1. Bloqueantes

#### P2-B1 — Abrir negocio antes del punto de éxito puede hacer que la restauración pierda operaciones

Secuencia permitida por el diseño: detener A → respaldo R → migrar → levantar B → B acepta una compra C → falla la comprobación HTTPS o muere el publicador → se ofrece restaurar R. **C fue aceptada y no está en R.** No basta que R se haya tomado con A detenida.

**Antes de codificar:** definir una barrera persistente de mantenimiento que impida operaciones públicas desde antes de detener hasta después de verificar la candidata y registrar el éxito. Debe sobrevivir a reinicios del motor y reconocer publicación incompleta. Verificar la candidata por una vía controlada, pasando también por TLS/proxy cuando corresponda. Solo después permitir negocio. Un fallo posterior a esa reapertura es un incidente nuevo: no autoriza restaurar R con la promesa de cero pérdida.

No ejecuté un publicador inexistente; es un contraejemplo de la secuencia propuesta. El ensayo debe convertirlo en reproducción con compra entre arranque y fallo de comprobación.

#### P2-B2 — «La última migración es la misma» no permite concluir que sea seguro volver

Dos contraejemplos **ejecutados** con el migrador actual, en bases desechables:

1. Con última `0020_restauracion.sql`, se añade `0019_zz_qa2.sql`. El migrador la aplica y agrega una columna a `operacion`. La última sigue en 0020 y `baseApta` devuelve true.
2. Se fija `folio_operacion` en 100; una migración 0021 hace `setval(...,1,true)` y después falla por división entre cero. La transacción revierte y la migración no queda registrada, pero la secuencia queda en **1**. La última sigue en 0020. Reabrir automáticamente podría reutilizar numeración o producir conflictos.

[Registro de ambas](/tmp/feruga-codex-qa2/migraciones-nuevas.log). Los cambios de `setval` no se deshacen al revertir una transacción, según [PostgreSQL 17](https://www.postgresql.org/docs/17/functions-sequence.html). La migración artificial no se agregó al proyecto: prueba que la regla no es suficiente para cualquier migración que el migrador acepta.

Además, una migración aún en ejecución puede no haber confirmado su registro: leer la misma última versión en ese instante no prueba que haya terminado ni que no vaya a confirmar después. El publicador debe saber que ningún migrador sigue activo antes de decidir.

**Antes de codificar:** comparar la historia completa y huellas, exigir migraciones nuevas posteriores a las conocidas y prohibir modificar las aplicadas. Definir qué efectos permiten vuelta automática. La opción conservadora y sencilla es volver automáticamente solo si se acredita que no comenzó una migración pendiente y la anterior es compatible; si empezó una migración y falló, mantener mantenimiento hasta diagnóstico/restauración o acreditar expresamente ausencia de efectos no reversibles. No hace falta implementar un analizador universal de SQL: sí un contrato verificable que no confunda «no hay fila nueva» con «no cambió nada».

Que una migración sea compatible en teoría pero cambie `ESQUEMA_ESPERADO` no permite hoy reabrir A: la aplicación exige coincidencia exacta. La regla conservadora puede negar vueltas que serían posibles con un protocolo explícito de compatibilidad; eso sacrifica disponibilidad, no integridad. No ampliar esa compatibilidad por conjetura.

#### P2-B3 — Registro al final y cambios de etiquetas separados no permiten recuperar una publicación parcial

El diseño cambia `actual`/`anterior` de tres imágenes y escribe `publicaciones/` al final. Esas operaciones no forman una transacción. Morir entre web y admin puede dejar imágenes mezcladas; morir después del respaldo y antes del registro puede perder el nombre exacto que había que usar. Un `levantar` posterior puede tomar una mezcla o reabrir sin saber la fase.

**Antes de codificar:** dejar un registro durable **antes de detener**: identidad de publicación/instalación/base, conjunto anterior y candidato por identificadores inmutables, configuración pertinente y estado del esquema. Incorporar el nombre exacto del respaldo apenas quede confirmado, antes de migrar. Registrar las fases por escrituras atómicas y establecer recuperación idempotente para cada una. Si no puede guardarse el registro, no avanzar a una fase que lo necesita. Registrar éxito antes de abrir el negocio, y tratar con cuidado el pequeño intervalo entre esos pasos.

`levantar` debe consultar ese estado y negarse a reabrir una publicación incompleta. Un candado huérfano solo impide otro proceso: no describe si hay que mantener cerrado, terminar una migración, restaurar etiquetas o volver al conjunto anterior. No borrar la información de recuperación en un trap de error. Si se vuelve a la versión anterior después de que el migrador cerró CONNECT, el retorno debe restablecer los permisos con su administración/configuración compatible y comprobar la salud antes de retirar mantenimiento; cambiar una etiqueta por sí solo no vuelve a abrir esa puerta.

### 2. Importantes

#### P2-I1 — Definir identidad inmutable, repetición del mismo commit y publicación de commits anteriores

Un commit limpio identifica fuentes, pero no implica que reconstruir produzca la misma imagen. Tampoco tres etiquetas locales son exclusivas de una instalación: `feruga/web:actual` puede ser compartida por otra carpeta/proyecto en el mismo motor.

Antes de construir/detener hay que verificar la versión **que realmente corre**, sus huellas y la historia de la base. Si se publica de nuevo el mismo conjunto, la operación debe ser idempotente y conservar la versión anterior útil; no convertir `anterior` en otra referencia a la misma versión. Si se desea reconstruir el mismo commit con artefactos diferentes, darle identidad propia, no sobrescribir silenciosamente la identidad anterior.

Un commit anterior no debe disparar automáticamente una restauración de su época: perdería datos aceptados desde entonces. Con el esquema exacto actual, solo se permite el retorno si su imagen lo acepta y se ha definido compatibilidad de los datos. Si la base ya tiene migraciones desconocidas por ese commit, rechazar **antes de detener**. Comprobar historia, no solo orden de commits: ramas distintas pueden tener esquemas distintos.

**Recomendación:** un manifiesto de versión con IDs/digests exactos de web/admin/respaldo y referencias a los archivos de operación de esa versión. Un único puntero durable de versión activa, cambiado atómicamente; `actual`/`anterior` pueden existir como ayudas, pero no como única fuente de verdad. No es necesario editar el `.env` que contiene secretos para cambiar código. Usar nombres o referencias por instalación cuando varias puedan compartir motor. Conservar imágenes necesarias para recuperación y evitar que una limpieza las elimine mientras estén referenciadas.

Fijar las imágenes base por digest es acertado; debe incluir plataforma y un procedimiento deliberado de actualización. También hay que fijar archivos montados del proxy/configuración: `levantar` con imágenes antiguas y archivos del checkout nuevo puede cambiar comportamiento fuera de esas imágenes.

#### P2-I2 — Publicar y recuperar el conjunto completo de servicios, incluido respaldo

El diseño debe nombrar qué sucede con respaldo programado, comprobación, consola/admin, migrador, web y proxy. El servicio de respaldo puede seguir corriendo con código viejo; también puede estar volcando cuando se quiera migrar.

Antes del respaldo previo, coordinar con el servicio: permitir que termine o detenerlo con limpieza comprobada; tomar el respaldo exacto con la versión y configuración identificadas. Después, arrancar/recrear explícitamente el servicio con la versión prevista y verificar su identidad. Restaurar etiquetas no cambia un contenedor ya creado; la recuperación debe devolver servicios reales al conjunto anterior adecuado.

Si el respaldo quedó verificado pero el vigilante no recibió señal, conservar **por separado** `respaldo verificado` y `aviso pendiente`. El código actual permite respaldar aunque el vigilante falle; esa política puede mantenerse para publicar, mostrando el aviso y guardando el nombre. No convertir un fallo del aviso en «no hay respaldo», ni fingir que el vigilante está sano.

También debe definirse con qué imagen se restaura el respaldo previo: usar sin más la candidata que trae una migración rota volvería a intentar esa migración durante `restaurar`. Conservar la imagen administrativa/de restauración de la versión que tomó el respaldo, y explicar cómo se activa la base recuperada, pues el programa actual se niega a restaurar encima de una base existente.

#### P2-I3 — Detener el contenedor debe incluir la resolución de operaciones en vuelo

Un proceso web terminado no es por sí solo prueba de que todas sus sesiones PostgreSQL ya acabaron. Antes de tomar la instantánea deben dejar de entrar peticiones y concluir o revertir las existentes, con un plazo y tratamiento explícito de sesiones que sigan activas. Esperar estado observable en la base; no un `sleep` arbitrario. Esto también evita que el migrador se niegue porque siga conectada una sesión anterior.

La recuperación de una captura sin respuesta debe probar al menos: no alcanzó a llegar; llegó pero no confirmó; confirmó pero se perdió la respuesta; se reenvía después de publicación/retorno/restauración. Debe conservarse el identificador y obtenerse exactamente un efecto o el rechazo documentado. Tras una restauración las sesiones se cierran: no prometer que todo se resolverá sin interacción si puede requerirse volver a entrar.

#### P2-I4 — Los cuatro casos de ensayo propuestos no alcanzan las garantías del publicador

La copia con repositorio Git propio es adecuada: permite commits y ramas desechables sin tocar el repositorio real. Debe tener además nombres de imágenes, proyecto Docker, puertos y volúmenes aislados; un Git separado no aísla etiquetas Docker globales.

Antes de cerrar la tarea, agregar pruebas con barreras y observación de estado para:

| Grupo | Casos mínimos |
|---|---|
| Preparación | Fallo de build/configuración/red sin detener ni alterar la versión activa; checkout sucio; fallo al escribir el registro; imágenes esperadas ausentes. |
| Respaldo previo | Fallo antes y después de publicar manifiesto; manifiesto inválido; respaldo bueno con aviso fallido; nombre guardado aunque exista después un respaldo programado más nuevo. |
| Interrupciones | Muerte antes/después de detener, tras respaldo, entre cambios de referencias, durante migración, tras arranque y antes de éxito; reejecución desde cada fase. Probar muerte del padre con hijo/contenedor todavía activo. |
| Motor Docker | Reinicio durante mantenimiento y durante verificación, en un motor dedicado al ensayo; que no se abra negocio ni se dependa de repetir `depends_on`. |
| Migraciones | Primera falla sin ninguna aplicada; varias con una anterior confirmada y otra rota; migrador aún activo; archivo añadido por debajo de la última; archivo aplicado modificado; efecto no transaccional; esquema desconocido por candidata/anterior. |
| Repeticiones y versiones | Mismo commit/conjunto dos veces conserva anterior; intento de commit anterior compatible e incompatible; etiquetas incompletas o mezcla; dos publicaciones concurrentes; `levantar` durante publicación. |
| Candidata y servicios | Web arranca pero falla salud/TLS; intento real de compra durante la verificación rechazado; servicio de respaldo actualizado; regreso a imágenes exactas; ninguna reapertura prematura. |
| Peticiones y restauración | Confirmación con respuesta perdida, reenvío sin duplicación y captura aún no confirmada; restauración por nombre exacto con imagen compatible; comparar todas las operaciones aceptadas antes del cierre y el estado de folios/envíos. |

No es necesario convertir cada punto en un recorrido de navegador: los estados del guion, fallos de Docker y migraciones se prueban con integración y barreras. El caso de negocio sí debe atravesar el proxy/aplicación. Una migración rota en la primera posición y otra rota después de una buena son casos distintos; el ensayo propuesto no los distingue.

### 3. Secuencias específicas solicitadas

| Secuencia | Evaluación y regla que falta |
|---|---|
| Muere entre detener y respaldar | No hay todavía respaldo previo verificado. Debe quedar mantenimiento y estado «detenida, sin respaldo», desde el que pueda reanudarse o devolverse la versión anterior si se acredita que no hubo migración. No adivinar usando «último respaldo». |
| Muere entre etiquetas y levantar | Puede haber mezcla. Recuperar desde un conjunto inmutable registrado y no desde el contenido casual de las etiquetas. |
| Se reinicia el motor | Una web detenida explícitamente con `unless-stopped` no vuelve solo por reiniciar Docker. **No atribuyo ese defecto al intervalo inmediatamente posterior a `stop`.** El riesgo reaparece si la candidata ya había arrancado y el protocolo aún no terminó: debe seguir bloqueada por un estado persistente, no por la memoria del guion. |
| Respaldo tomado, vigilante falló | Mantener la evidencia del respaldo, su nombre y el aviso pendiente. Aplicar política explícita; no perder el respaldo ni declarar falso éxito del aviso. |
| Mismo commit dos veces | Idempotencia y conservación de la anterior útil; distinguir reconstrucción diferente del mismo código. |
| Commit anterior al vigente | Rechazo previo si no conoce/acepta el esquema actual; nada de migrar hacia atrás ni restaurar automáticamente un respaldo viejo. |
| `anterior` incompatible | Su etiqueta no autoriza usarla. Comparar identidad/esquema y mantener cerrado si no es apta; restaurar solo bajo el protocolo sin escrituras posteriores al respaldo. |
| Respaldo sigue con imagen vieja | Recreación y comprobación explícita de identidad, coordinando sus corridas con la migración. |
| Petición en vuelo al detener | Confirmar quiescencia en PostgreSQL antes de respaldar; respuesta perdida se resuelve por identidad de envío, sin duplicar. |
| Última migración igual | Insuficiente: archivo intercalado, efecto no transaccional o migrador aún activo. Contraejemplos ejecutados arriba. |

La semántica de `unless-stopped` se contrastó con la [documentación de Docker](https://docs.docker.com/engine/containers/start-containers-automatically/). No reinicié el motor compartido ni la máquina; esa parte es revisión de diseño y debe ejecutarse después en un motor dedicado.

### 4. Cambios menores de redacción/contrato

- Actualizar las decisiones resumidas del plan para que correspondan con el código actual: la puerta usa permisos CONNECT; la aptitud se comprueba en rutas además de salud; la restauración valida y renombra al final. Evita implementar el publicador siguiendo descripciones antiguas.
- Definir salida y códigos por fase, y un formato legible por máquina para el resultado del respaldo/publicación. La línea `respaldo: …` permite comenzar, pero el parser debe exigir exactamente un resultado válido y guardar también el estado del aviso.
- Distinguir «construir desde el commit» de «reconstruir exactamente la imagen». Digest del artefacto, fuentes y dependencias identifican cosas relacionadas, pero distintas.

Estos detalles no añaden bloqueantes a los tres anteriores.

### 5. Veredicto de parte 2

**No aprobaría el diseño para codificarlo tal como está.** Cambiar antes:

1. Barrera durable de mantenimiento y punto explícito de reapertura: ninguna operación pública antes del éxito registrado.
2. Regla de vuelta automática que acredite compatibilidad y ausencia de efectos inseguros, con el migrador terminado; no comparar solo la última fila.
3. Estado durable de fases y conjuntos de imágenes inmutables, recuperable tras muerte o reinicio; `levantar` debe respetarlo.
4. Políticas de repetición/retroceso, actualización del respaldo y drenaje de operaciones, con ensayo de las interrupciones y estados anteriores.

Con esos cambios, las decisiones 6 y 8 y el B3 anterior pueden convertirse en garantías verificables. El respaldo con aplicación detenida es necesario; por sí solo no garantiza que una restauración posterior no pierda operaciones.

## Alcance no verificado e integridad final

No se verificaron proveedor real, certificado público/renovación, acceso desde otra máquina, motor vacío, volcado de varios GB, apagado completo ni reinicio del motor. Tampoco se ejecutó una publicación real, pues su código no existe. La escala del recorrido de manifiestos fue simulada; los dos temporizadores de una hora se aceleraron expresamente. No se repitieron todas las mutaciones históricas ni los 106 recorridos generales.

Se desmontó `feruga_ensayo` con sus volúmenes y sin dejar contenedores de ese proyecto; se conservó el volumen externo de módulos. Las bases desechables y el backend retenido por la reproducción se limpiaron. Se conservaron los servicios compartidos de pruebas. [Limpieza](/tmp/feruga-codex-qa2/limpieza.log).

La comparación final de archivos existentes del original contra la copia solo señala la adaptación deliberada de `docker-compose.ensayo.yml`, excluidos módulos, Git, metadatos de escritorio y compilación incremental. Los guiones adicionales existen únicamente en la copia. El estado Git del original coincide con el inicial. [Comparación](/tmp/feruga-codex-qa2/comparacion-final.log).
