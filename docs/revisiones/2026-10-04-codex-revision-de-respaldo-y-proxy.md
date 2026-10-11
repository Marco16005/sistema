# Revisión de Codex a las tareas 3 y 4 del despliegue: respaldar, proxy y ensayo (4 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución. Se le pidió no modificar archivos del proyecto:
trabajó sobre una copia en `/tmp/feruga-codex-qa/`. La computadora entró en reposo a media revisión
y Codex estuvo horas reintentando la conexión; terminó y dejó este informe completo a las 10:09.
Es el informe tal como lo entregó (los enlaces a `/tmp/feruga-codex-qa/` apuntan a sus registros,
que no forman parte del proyecto).

**Veredicto: no se puede empezar la tarea 5. Un bloqueante, siete importantes y dos menores.**

La respuesta está en `2026-10-04-respuesta-a-la-revision-de-respaldo-y-proxy.md`.

---


Fecha: 4 de octubre de 2026. Proyecto: `/Users/maantora/Desktop/feruga/sistema`.

**Veredicto: hay que corregir antes de dar por cerradas estas tareas y empezar la tarea 5.** Encontré **1 bloqueante, 7 importantes y 2 menores**. Pasaron los tipos, las 585 pruebas y dos ejecuciones del ensayo, pero los cruces adicionales reprodujeron defectos que esa cobertura no detecta.

El bloqueo principal es operativo: con salud 503 por esquema incompatible o marca de restauración inválida, el proxy y las rutas de negocio siguen permitiendo confirmar compras. Los problemas de selección y validación de respaldos también deben corregirse antes de usarlos para volver atrás durante una publicación.

No modifiqué, creé ni borré archivos dentro de `/Users/maantora/Desktop/feruga`. Trabajé sobre una copia en `/tmp/feruga-codex-qa/sistema`. Los avances escritos durante la revisión se conservan en [informe-avances.md](/tmp/feruga-codex-qa/informe-avances.md). Este documento los consolida y sustituye.

## 1. Ejecuciones y alcance

Se leyeron el plan v2, la revisión anterior, su respuesta, los archivos de operación, Compose, Dockerfiles y pruebas señalados en el encargo. Para los cruces se revisaron también el migrador, las rutas y la salud de la aplicación. No fue una nueva auditoría completa de las tareas 1 y 2; se comprobaron sus garantías cuando intervienen en las tareas 3 y 4.

### Batería

Se ejecutó la orden pedida con una sola adaptación: montar la copia en `/app`. Es necesaria porque `npm run tipos` tiene compilación incremental y puede escribir `tsconfig.tsbuildinfo`.

```sh
cd /Users/maantora/Desktop/feruga/sistema
docker compose --profile pruebas run --rm \
  -v /tmp/feruga-codex-qa/sistema:/app \
  -e PG_PLANTILLA=feruga_plantilla_codex \
  pruebas sh -c 'npm run tipos && npm test'
```

Resultado: **tipos correctos; 585 pruebas, 585 aprobadas, 0 fallidas**, duración de las pruebas 86,9 s. Sin reinstalar dependencias. [Registro](/tmp/feruga-codex-qa/bateria.log).

### Ensayo de operación

Se ejecutó desde la copia:

```sh
cd /tmp/feruga-codex-qa/sistema
BUILDX_CONFIG=/tmp/feruga-codex-qa/buildx CONSERVAR=1 sh operacion/ensayo.sh
```

Adaptaciones de la copia: se quitó `npm ci` del comando de `recorrido_operacion`; se usó como volumen externo `feruga_modulos_recorrido`, ya instalado. Las imágenes se construyeron con las capas disponibles; no se ejecutó instalación sobre los volúmenes compartidos. Se redirigió el estado de Buildx a `/tmp`, después de que el primer intento fallara por el sandbox al escribir `~/.docker/buildx/activity`.

Resultado: **el ensayo pasó, incluidos los 4 recorridos HTTPS**. Se conservó para probar los cruces y después se desmontó. [Registro](/tmp/feruga-codex-qa/ensayo.log).

Se repitió el ensayo con proyecto `feruga_codex_primera`, sin imágenes propias de ese nombre ni base/volúmenes anteriores. También pasó, incluidos sus 4 recorridos. Había imágenes base y caché de construcción: **esto no equivale a un motor Docker totalmente vacío con descarga desde internet**. [Estado previo de imágenes](/tmp/feruga-codex-qa/primera-antes.log), [registro](/tmp/feruga-codex-qa/primera.log).

### Cruces adicionales

Los guiones `.ts` siguientes se ejecutaron con esta forma, cambiando únicamente el nombre del guion:

```sh
cd /Users/maantora/Desktop/feruga/sistema
docker compose --profile pruebas run --rm --no-deps \
  -v /tmp/feruga-codex-qa/sistema:/app \
  -e PG_PLANTILLA=feruga_plantilla_codex \
  pruebas node pruebas/codex-cruces.ts
```

| Guion o secuencia | Resultado y registro |
|---|---|
| `codex-cruces.ts`: mismo segundo, esquema futuro, migración entre metadato y volcado, red, retroceso del reloj, marca de borrado | Reprodujo I1, I3, I4, I6 e I7; recuperación histórica correcta. [cruces.log](/tmp/feruga-codex-qa/cruces.log) |
| `codex-plazos.ts`: cifrado y las cuatro transferencias retenidas a 800 ms; manifiesto pisado antes de comprobar | Los procesos vencieron, avisaron el paso y limpiaron; se reprodujo I2. [plazos.log](/tmp/feruga-codex-qa/plazos.log) |
| `codex-migracion-activa.ts`: migración retenida antes de commit y plazo del turno a 100 ms | Instantánea anterior coherente; vencimiento del turno correcto. [migracion-activa.log](/tmp/feruga-codex-qa/migracion-activa.log) |
| `codex-versiones.ts`: esquema 0019, objeto/manifiesto alterados después de listar, fallo de listado al arrancar | Migra a 0020; rechaza las alteraciones; sigue respaldando tras fallo inicial de listado. [versiones.log](/tmp/feruga-codex-qa/versiones.log) |
| `codex-ensayo-futuro.ts`: consola real `--remoto --ensayo` con esquema futuro | Código 0 y un aviso al vigilante: falso éxito funcional. [ensayo-futuro.log](/tmp/feruga-codex-qa/ensayo-futuro.log) |
| `python3 /tmp/feruga-codex-qa/concurrencia.py`: servicio y manual en contenedores diferentes, con barrera real | Uno espera al otro; ambos terminan; quedan dos respaldos. [concurrencia.log](/tmp/feruga-codex-qa/concurrencia.log) |
| `sh /tmp/feruga-codex-qa/toctou.sh`: entorno cambiado después de comprobar y antes de `up` | Reemplazó web y dejó HTTPS sin servicio. Se recuperó con el entorno bueno. [toctou.log](/tmp/feruga-codex-qa/toctou.log) |
| Playwright `codex-operacion.spec.ts` sobre el ensayo conservado | Salud 503 y compra confirmada, dos veces: B1. [salud-rutas.log](/tmp/feruga-codex-qa/salud-rutas.log) |
| Configuración normalizada por Compose con `red-host.yml`, pasada a `comprobar red` | Devuelve «bien» con servicio adicional en host mode. No se arrancó ese servicio. [red-host.log](/tmp/feruga-codex-qa/red-host.log) |
| `codex-secretos.ts` y `python3 /tmp/feruga-codex-qa/secretos-docker.py` | Fallos de permisos/credencial sin contraseña en el mensaje; llave de prueba visible en Docker logs. [secretos.log](/tmp/feruga-codex-qa/secretos.log), [secretos-docker.log](/tmp/feruga-codex-qa/secretos-docker.log) |

Para el disco lleno se agregó únicamente un tmpfs de 1 MiB al contenedor de pruebas:

```sh
cd /Users/maantora/Desktop/feruga/sistema
docker compose -f docker-compose.yml -f /tmp/feruga-codex-qa/lleno.yml \
  --profile pruebas run --rm --no-deps \
  -v /tmp/feruga-codex-qa/sistema:/app \
  -e PG_PLANTILLA=feruga_plantilla_codex -e TMPDIR=/tiny \
  pruebas node pruebas/codex-disco.ts
```

Con 300.000 filas: `pg_dump: error: could not write to output file: No space left on device`; señal «El respaldo falló al volcar la base»; cero respaldos y cero carpetas de trabajo. Restableciendo espacio, respaldo comprobado de **6.857.253 bytes**. No es una prueba de capacidad para varios GB o multipartes. [Registro](/tmp/feruga-codex-qa/disco.log).

## 2. Hallazgos por gravedad

Los identificadores siguientes pertenecen a esta revisión; no sustituyen los identificadores del informe anterior.

### B1 — Bloqueante: salud fallida no impide operar sobre una base que no es apta

Código: [ruta.ts](/Users/maantora/Desktop/feruga/sistema/src/servidor/ruta.ts:98), [salud](/Users/maantora/Desktop/feruga/sistema/src/app/api/salud/route.ts:17), [Caddyfile](/Users/maantora/Desktop/feruga/sistema/operacion/Caddyfile:13).

**Secuencia ejecutada:** sobre el Compose de operación atendiendo por HTTPS, dar de alta equipo, entrar como persona válida, insertar `9999_codex_incompatible.sql` en `migracion`, consultar salud y efectuar una compra desde la pantalla. Después se repite desparejando `vida.id` de la marca de la base, que es la condición de restauración sin registrar. Se deshicieron ambas alteraciones al terminar.

```text
{"caso":"esquema","salud":503,"folio":"2","compra":"confirmada"}
{"caso":"vida","salud":503,"folio":"3","compra":"confirmada"}
```

Orden ejecutada, con las variables del ensayo conservado:

```sh
docker compose --profile ensayo run --rm --no-deps recorrido_operacion \
  sh -c 'sh operacion/ensayo/confiar.sh && npx playwright test -c playwright.codex.config.ts'
```

[Guion completo](/tmp/feruga-codex-qa/sistema/recorrido/codex-operacion.spec.ts), [salida](/tmp/feruga-codex-qa/salud-rutas.log).

**Causa e impacto:** las rutas comprueban el entorno, pero no esquema ni `vida_vigente`. Caddy reenvía las peticiones sin consultar esa salud. `depends_on: service_healthy` sirve para el arranque dirigido por Compose; no corta las peticiones de un proxy que ya está corriendo. No se sostiene la garantía de que la aplicación no atiende una restauración sin registrar, ni una versión de esquema incompatible. Esto afecta directamente al cierre y reapertura de la tarea 5.

**Corrección requerida:** impedir las operaciones de negocio cuando la base no sea apta, también con contenedores existentes y reinicios independientes. Probarlo con sesión y cuerpo válidos, exigiendo rechazo y ausencia de efectos. Un 503 exclusivo de salud no alcanza.

### I1 — Importante: “último respaldo” puede restaurar el anterior dentro del mismo segundo

Código: [destino.ts](/Users/maantora/Desktop/feruga/sistema/operacion/destino.ts:126).

Dos respaldos **reales**, con una marca diferente en su contenido:

```text
07:36:55.246Z  UUID 8e8c9c59-…  marca 0
07:36:55.326Z  UUID 543b7615-…  marca 1
restaurarDelDestino sin nombre eligió 8e8c9c59-…; restauró marca 0.
```

`respaldos()` ordena por nombre: fecha hasta el segundo y UUID aleatorio. `traer()` elige el último de ese orden, que no necesariamente es la instantánea más nueva. No hubo colisión de nombres; el defecto es de selección. La prueba original espera 1100 ms entre respaldos y evita el caso.

Reproducción: `codex-cruces.ts`, caso `mismo_segundo`. [Evidencia](/tmp/feruga-codex-qa/cruces.log).

**Corregir:** ordenar con información cronológica suficiente y definir los empates. Añadir un caso del mismo segundo que compruebe el contenido restaurado. No basar la vuelta atrás de una publicación en “el último”; conservar también el identificador explícito del respaldo previo verificado.

### I2 — Importante: un manifiesto rechazado sigue contando como respaldo reciente

Código: [destino.ts](/Users/maantora/Desktop/feruga/sistema/operacion/destino.ts:114), [respaldar.ts](/Users/maantora/Desktop/feruga/sistema/operacion/respaldar.ts:175).

**Secuencia real contra MinIO:** subir objeto y manifiesto; pisar el manifiesto con JSON inválido antes de que la corrida lo vuelva a leer; comprobar; reiniciar el servicio.

```text
corrida: el manifiesto que quedó en el destino no es el que se subió
respaldosListados: 1
traer: el manifiesto ... no se puede leer
corridasAlReiniciar: 0
```

El servicio, con horario 00:00, durmió hasta su siguiente vencimiento (58.780.565 ms en la reproducción). Con horario por horas también esperaría el siguiente vencimiento en lugar de recuperar el respaldo fallido. El listado solo exige que existan ambos nombres; no lee el manifiesto.

Por separado, al vencer la bajada de comprobación del manifiesto, la corrida falla y limpia temporales, pero el manifiesto ya está remoto y el listado lo cuenta. Por tanto, “cualquier fallo deja cero manifiestos” no es una propiedad realizable con esta secuencia y credencial sin borrado.

Reproducción: `codex-plazos.ts`. [Evidencia](/tmp/feruga-codex-qa/plazos.log).

**Corregir:** validar los manifiestos al determinar los respaldos utilizables y su frescura; precisar los estados de publicación/comprobación incierta. Un nombre de manifiesto existente no acredita un respaldo utilizable. No se pide que el servidor borre versiones protegidas.

### I3 — Importante: el esquema del manifiesto puede no ser el del volcado

Código: [respaldar.ts](/Users/maantora/Desktop/feruga/sistema/operacion/respaldar.ts:129), [migrar.ts](/Users/maantora/Desktop/feruga/sistema/db/migrar.ts:19).

**Secuencia:** retener el lanzamiento del `pg_dump` real mediante un ejecutable intermedio; el respaldo ya leyó el último esquema; aplicar y confirmar una migración real; liberar `pg_dump`; restaurar y consultar el registro.

```text
manifiesto: 0020_restauracion.sql
contenido restaurado: 0021_codex.sql
```

Reproducción: `codex-cruces.ts`, caso `migracion_entre_metadato_y_volcado`. [Evidencia](/tmp/feruga-codex-qa/cruces.log).

Los candados 7152 y 7150 son independientes, y el metadato se obtiene en otra instantánea. No observé corrupción del volcado: observé una descripción incorrecta, peligrosa para elegir programa/versión durante recuperación.

El cruce inverso, con una migración retenida antes de commit y el respaldo terminando mientras tanto, **sí fue coherente**: restauró 0020 y no incluyó su tabla no confirmada. [Evidencia](/tmp/feruga-codex-qa/migracion-activa.log).

**Corregir:** coordinar migración y respaldo, o extraer metadatos de la misma instantánea que se vuelca. PostgreSQL ofrece instantáneas exportadas para lecturas sincronizadas; no basta con dos consultas cronológicamente cercanas. [Documentación de PostgreSQL](https://www.postgresql.org/docs/17/functions-admin.html).

### I4 — Importante: restaurar un esquema futuro y `--ensayo` terminan con éxito

Código: [restaurar.ts](/Users/maantora/Desktop/feruga/sistema/operacion/restaurar.ts:121), [restaurarDelDestino](/Users/maantora/Desktop/feruga/sistema/operacion/restaurar.ts:161).

Se respaldó una base desechable con migración adicional `9999_codex_futura.sql` y se restauró usando este programa. Resultado: nombre definitivo creado, `vida_vigente=true`, esquema futuro conservado. El programa esperaba 0020.

Se repitió por la consola **real**:

```text
node operacion/restaurar.ts --remoto --ensayo
codigo: 0
avisos al vigilante: 1
"Listo: la base … quedó restaurada."
"Se avisó al vigilante de los ensayos."
```

[Guion](/tmp/feruga-codex-qa/sistema/pruebas/codex-ensayo-futuro.ts), [evidencia](/tmp/feruga-codex-qa/ensayo-futuro.log). El ensayo usa credenciales efímeras y modo de pruebas; la ausencia de verificación de esquema en restaurar es la misma en operación.

No se contrasta `manifiesto.esquema`, ni se rechazan migraciones desconocidas en la base restaurada. Además, `--ensayo` solo restaura y avisa: no levanta ni usa la aplicación, como pide la decisión 18. El esquema anterior inmediato **0019 sí se restauró y migró a 0020** correctamente.

**Corregir:** rechazar incompatibilidad de versión antes de declarar éxito y validar el esquema real después de restaurar/migrar. Para el ensayo periódico, separar “restauración SQL terminada” de “recuperación funcional comprobada”; el aviso prometido requiere completar esta última.

### I5 — Importante: `levantar.sh` comprueba un entorno y puede aplicar otro

Código: [levantar.sh](/Users/maantora/Desktop/feruga/sistema/operacion/levantar.sh:17).

**Secuencia ejecutada:** el sitio ya atiende; pasan `comprobacion entorno` y `comprobacion red`; una barrera inmediatamente antes de `docker compose up` cambia solo el archivo temporal a `SESION_CLAVE=corta`.

```text
Comprobación de entorno: bien.
Comprobación de red: bien.
BARRERA: … se cambió SESION_CLAVE antes del up.
levantar exit=1
web: antes running (3ce1…), después created (ab2b…)
https exit=1
```

[Guion](/tmp/feruga-codex-qa/toctou.sh), [intermediario de Docker](/tmp/feruga-codex-qa/shim/docker), [registro](/tmp/feruga-codex-qa/toctou.log). Después se repuso el entorno bueno y HTTPS volvió.

El remedio es correcto para un entorno estable y mejora sustancialmente `up` directo, pero no satisface “comprobar antes de tocar” si cambia lo que se aplicará. La misma ventana permite cambiar publicaciones después de comprobarlas.

**Corregir antes de tarea 5:** resolver una configuración efectiva inmutable para comprobarla y aplicarla, proteger sus secretos, y coordinar las operaciones concurrentes. El respaldo previo y el protocolo de publicación deben referirse a esa misma versión/configuración.

### I6 — Importante: `comprobar red` acepta exposición que no usa `ports`

Código: [comprobar.ts](/Users/maantora/Desktop/feruga/sistema/operacion/comprobar.ts:41).

Se normalizó con Compose la configuración de operación y este servicio adicional:

```yaml
services:
  codex_expuesto:
    image: node:24-alpine
    network_mode: host
    command: ["node", "-e", "require('http').createServer((q,r)=>r.end('QA')).listen(9001,'0.0.0.0')"]
```

Orden ejecutada desde la copia:

```sh
COMPOSE_PROJECT_NAME=feruga_codex_config PROXY_HTTP=80 PROXY_HTTPS=443 \
  docker compose --env-file /tmp/feruga-codex-qa/ensayo-env/.env \
  -f docker-compose.yml -f docker-compose.operacion.yml \
  -f /tmp/feruga-codex-qa/red-host.yml config --format json |
  docker run --rm -i --entrypoint node feruga-ensayo-herramientas operacion/comprobar.ts red
```

Salida: **`Comprobación de red: bien.`** No se lanzó el servidor adicional. En Linux, host mode comparte la red del host y no requiere publicaciones `ports`. [Docker](https://docs.docker.com/engine/network/drivers/host/).

También se obtuvo `[]` de faltas al montar `/var/run` en `/hostrun`: el socket sería accesible a través del directorio aunque la cadena del montaje no contenga `docker.sock`. Fue una comprobación de la función; no se montó el socket.

La configuración original revisada **no contiene estas exposiciones**. El defecto está en la garantía del comprobador.

**Corregir:** admitir explícitamente los modos de red esperados y rechazar modos/rutas de acceso al host incompatibles con esa garantía. Para el socket, contemplar montajes de directorios que lo contienen. Mantener además la prueba exterior de la tarea 7.

### I7 — Importante: un reloj que retrocede puede dejar sin respaldar durante horas reales

Código: [respaldar.ts](/Users/maantora/Desktop/feruga/sistema/operacion/respaldar.ts:227).

Simulación determinista con la interfaz de reloj existente, sin modificar el reloj de la máquina: respaldo a 09:00; después el reloj vuelve a 07:00; se recorren 07:00, 08:00, 09:00 y 10:00.

```text
corridas: [09:00, 10:00]
siestas desde: [09:00, 07:00, 08:00, 09:00, 10:00]
```

El servicio retiene 09:00 como “último” y omite los vencimientos hasta superarlo. La prueba original de desfase de cinco segundos entre base y máquina no cubre un retroceso del reloj durante el servicio. Tampoco es el retroceso estacional, que el calendario sí maneja.

Reproducción: `codex-cruces.ts`, caso `reloj_retrocede`. [Evidencia](/tmp/feruga-codex-qa/cruces.log).

**Corregir o acotar explícitamente:** detectar retrocesos/referencias futuras y recuperar un respaldo, sin dejar que una fecha futura suprima corridas indefinidamente. La vigilancia externa debe seguir midiendo el silencio; no sustituye esa recuperación.

### M1 — Menor: el ensayo expone sus secretos de prueba por caminos que la afirmación general excluye

Código: [ensayo.sh](/Users/maantora/Desktop/feruga/sistema/operacion/ensayo.sh:47), [almacen.sh](/Users/maantora/Desktop/feruga/sistema/operacion/ensayo/almacen.sh:15).

`docker run --rm --entrypoint age-keygen … > llave.txt` redirige stdout del cliente, pero el motor también lo registra. Se ejecutó la misma generación reteniendo el contenedor para inspeccionarlo:

```text
rm=true; contenedor_vivo=true; driver=json-file;
llavePrivadaEnDockerLogs=true
```

[Reproducción sin imprimir la llave](/tmp/feruga-codex-qa/secretos-docker.py), [resultado](/tmp/feruga-codex-qa/secretos-docker.log).

Además, `mcli admin user add c "$SERVIDOR_USUARIO" "$SERVIDOR_CLAVE"` pone la clave del almacenamiento de ensayo en argumentos; lo mismo hace el apoyo de pruebas al crear credenciales. Este segundo punto es por lectura, no por captura de `/proc` de mcli.

Son credenciales de prueba, no observé una llave de producción expuesta. Por eso lo clasifico menor. No copiar ese patrón a la guía de custodia real; desactivar registro al generar la llave de prueba y precisar el alcance de “ninguna clave viaja en argumentos”. El entorno generado y `llave.txt` sí tenían permisos **0600**.

### M2 — Menor: el ensayo deja su entorno si falla antes de instalar la limpieza

Código: [ensayo.sh](/Users/maantora/Desktop/feruga/sistema/operacion/ensayo.sh:24).

El primer intento falló en la construcción por restricción del sandbox sobre el estado de Buildx. Ya había generado `.env`, pero todavía no se había instalado `trap limpiar EXIT`. Quedó el archivo 0600 en `…/T/tmp.PFiPPKjXP0/.env`, creado durante esta revisión a las 07:34:19 UTC. Fue identificado y retirado al terminar.

También hay comprobaciones de Compose entre la creación de secretos y el trap. No se cumple “al terminar no deja nada” para fallos tempranos. Instalar la limpieza al crear el directorio temporal y hacerla válida aunque aún no exista el proyecto de Compose.

## 3. Cumplimiento del plan y de la revisión anterior

| Decisiones / hallazgo anterior | Evaluación |
|---|---|
| 13, 14; I4, I8 | La secuencia normal, UUID, cifrado, comparación SHA-256, candado entre contenedores, plazos y limpieza funcionan. No están cerrados la selección temporal, el manifiesto inválido contado y la coherencia de metadatos: I1–I3. |
| 15; B4 | El diseño versiones + retención + lectura del cifrado es correcto. La batería repitió los permisos contra MinIO. La recuperación anterior a una marca de borrado también funcionó. Falta el proveedor real, como ya estaba declarado. |
| 16, 17; I4 | Horario normal, cambio estacional, reintentos y recuperación al arrancar tienen evidencia. Falta retroceso del reloj (I7). Margen y rechazo de señales tardías siguen siendo configuración externa pendiente. |
| 18; I2 | La decisión de ensayo humano con segundo vigilante es coherente. `--ensayo` aún no acredita la aplicación restaurada y da éxito con esquema futuro (I4). |
| 19, 20; I5 | HTTPS validado, HSTS, CA confiada y persistencia al recrear pasaron. No se ensayó renovación pública ni su vigilancia. |
| 21; I6 | El Compose original publica según el diseño, pero `comprobar red` no verifica todas las formas de exposición (I6). La prueba exterior IPv4/IPv6 sigue pendiente. |
| B5 | Configuración ausente/inválida se rechaza y la cadena de arranque funciona en el ensayo. No se sostiene el cierre de operación después del arranque (B1); la comprobación previa no congela lo aplicado (I5). |
| I1 | `entorno.sh` y la conexión de pg_dump/pg_restore cumplen los caminos comprobados; la frontera administrativa de variables de entorno está declarada. La excepción del ensayo es M1. |
| I8 | La batería ofrece evidencia útil, pero no basta su verde: faltan los cruces reproducidos y hay afirmaciones de prueba más amplias que sus aserciones. |

### Cambios respecto del plan

- **Respaldar aunque el vigilante no conteste: correcto.** La batería confirmó que se conserva el respaldo y se informa del aviso fallido. Eso requiere que el vigilante alerte por ausencia de señales y que sus tiempos se configuren de verdad. Un fallo del canal de aviso no debe destruir la oportunidad de respaldar.
- **Enviar solo el paso fallido al vigilante: correcto.** Conserva diagnóstico suficiente para alertar sin enviar SQL, endpoints o nombres de infraestructura a un tercero. Los errores detallados quedan locales. En el caso de disco lleno se verificó exactamente esa separación.
- **Tomar el momento antes de volcar: correcto como límite conservador.** Es mejor para conciliación que fechar al terminar. No es la hora exacta de la instantánea MVCC de pg_dump: algunos cambios posteriores a la marca pueden estar incluidos. La guía debe comprobar qué ya existe, no recapturar ciegamente todo lo posterior. Esta conclusión presupone un reloj razonable; I7 trata su retroceso. El metadato de esquema requiere la corrección I3.
- **No depender de `rclone --immutable`: aceptable.** La protección probada proviene de versiones y retención. No repetí el experimento específico de esa bandera.
- **Bajar y comparar SHA-256 en lugar de fiarse de rclone/ETag: correcto.** La corrupción conservando tamaño se detecta. El comportamiento de `copyto` ante objeto ausente no se usa como prueba de integridad.
- **MinIO empaquetado en Alpine: válido para este ensayo.** No equivale a validar permisos o comportamiento del futuro proveedor contratado.
- **`levantar.sh`: remedio útil, pero incompleto.** El caso estático pasa; I5 demuestra su ventana. Tampoco sustituye el protocolo de mantenimiento de la tarea 5.

## 4. Secretos y archivos

**Comprobado:** la batería inspeccionó pg_dump, age, rclone y pg_restore mientras estaban vivos; las conexiones de PostgreSQL de operación llevan la contraseña en el entorno, y la llave privada de restauración entra por stdin. Los manifiestos contienen llave pública y metadatos, no las claves de base/destino. Los temporales están dentro de directorios privados creados por `mkdtemp` y se limpian en los fallos ensayados. `entorno.sh` escribe 0600 con `noclobber`, no imprime las claves y rechaza sobrescribir un archivo existente.

**Fallos adicionales observados:** con permiso suficiente para llegar a pg_dump pero no leer `sucursal`, el mensaje de pg_dump contenía el error y su `LOCK TABLE`, sin la contraseña marcada. Rclone con contraseña incorrecta devolvió `403 SignatureDoesNotMatch`, sin imprimirla. Al vigilante llegaron los nombres de paso, no esos detalles. [Registro](/tmp/feruga-codex-qa/secretos.log).

**Límites:** `correr()` conserva los últimos 600 caracteres de stderr; eso **no es un mecanismo de redacción de secretos**. No acredité que cualquier mensaje posible de cualquier proveedor sea inocuo. Tampoco hice una captura de argumentos de mcli; su exposición se ve directamente en la llamada. M1 registra el caso de Docker logs que sí se ejecutó.

La visibilidad de credenciales mediante `docker inspect` y el entorno de procesos está aceptada en la decisión 4; no la vuelvo a presentar como un defecto. No se observaron secretos de producción en la salida de esta revisión.

## 5. Pruebas que no acreditan toda su afirmación

1. **El caso “pg_dump sin permiso” de `23-respaldo` pasa por otra razón.** El usuario no puede consultar `migracion`: falla antes de lanzar pg_dump con `relation "migracion" does not exist`. El patrón `/volcar/` acepta ese error porque la fase ya se llama así. Lo reproduje; después concedí únicamente USAGE en `public` y SELECT en `migracion`, y entonces sí falló pg_dump por `sucursal`. La prueba debe acreditar que el programa llegó a ejecutarse.
2. **“Restaurar el último” evita el empate.** La espera de 1100 ms elimina el caso que falló en I1.
3. **“Nada atiende con base no apta” no se deduce de salud.** Las pruebas de esquema y registro de restauración consultan el endpoint, pero B1 demuestra escrituras exitosas. Es la omisión más relevante antes de publicación.
4. **“Fallo = no hay manifiesto” solo se prueba antes de su publicación o cuando no puede subirse.** Falta el fallo posterior a subirlo y la sobrescritura de I2.
5. **Orden de arranque: evidencia parcial, no prueba vacía.** El rechazo de entorno inválido es real y los tiempos comparados son útiles. Pero se comparan `StartedAt`, no el instante en que db/web se vuelven saludables. Quitar una espera por salud no necesariamente rompe esa comparación. Falta retener las fases y demostrar que el dependiente no empezó mientras no estaban listas. No repetí en esta revisión las mutaciones de dependencias declaradas en el plan.
6. **“Nada del ensayo sale a la red”: cobertura incompleta.** Buscar `0.0.0.0`, `[::]` y `:::` en `docker ps` no detecta una IP concreta de la LAN ni host mode. Las publicaciones observadas del ensayo original sí fueron 127.0.0.1:54339, 3220, 8480 y 8443. La búsqueda negativa por sí sola no prueba la afirmación general.
7. **Validación TLS: evidencia sustantiva.** El navegador carga por HTTPS sin `ignoreHTTPSErrors`; comprueba emisor y protocolo; el comprobador falla sin CA confiada. No es una prueba vacía. No repetí la mutación de retirar la CA del navegador que se declara en el plan.
8. **Persistencia del certificado: evidencia sustantiva pero limitada.** La huella coincide tras recrear el proxy, con almacenamiento persistente. Acredita esa recreación; no acredita renovación, recuperación tras pérdida del volumen o atribución causal por mutación. No repetí la mutación de quitar el volumen.
9. **“Candados entre pestañas” es una afirmación excesiva.** El recorrido solo hace una llamada a `navigator.locks.request` en una página. Comprueba disponibilidad del API en contexto seguro, no dos pestañas compitiendo por el mismo candado.
10. **Avisos del respaldo manual en el ensayo:** se buscan inicio y fin en todo el registro del vigilante, sin asociarlos al UUID del respaldo manual recién creado. Aislada, esa aserción puede satisfacerse con una corrida anterior. La batería sí asocia señales y UUID en sus casos de corrida.
11. **`--ensayo` no es una prueba funcional de recuperación.** Restaurar SQL y mandar un aviso pasa aunque el programa no pueda dar salud con ese esquema: I4.

No considero vacía la batería completa ni los cuatro recorridos. Estas son brechas concretas de aserción y secuencia. Las 23 mutaciones declaradas de tarea 3 **no se volvieron a ejecutar todas**; no certifico su resultado histórico por leerlo en el plan.

## 6. Compose de operación y Caddy

- La configuración revisada establece la cadena comprobación → db saludable → migración terminada → web saludable → proxy. `respaldo` espera la migración; puede arrancar en paralelo con web. Eso explica el aviso inicial fallido del vigilante local antes de disponer de la CA; el respaldo sí se toma.
- db, web, respaldo y proxy usan `unless-stopped`; comprobación y migración son trabajos sin reinicio automático. **El reinicio del motor no repite el protocolo completo de Compose**. No se debe usar el orden declarado como barrera permanente; B1 lo demuestra para tráfico posterior.
- db tiene `pg_isready` y web consulta salud. Proxy y respaldo no tienen una comprobación de salud propia en el Compose de operación. Para proxy, `levantar.sh` agrega una comprobación HTTPS real; para respaldo, el control previsto es el vigilante externo. Estar “running” no acredita ninguno de esos resultados.
- En la configuración original, base y web publican solo en loopback; el proxy publica 80/443. No se monta el socket de Docker. Los servicios de pruebas y recorridos quedan por perfiles. I6 trata lo que el comprobador podría aceptar si esa configuración cambiara.
- Los datos, `/data` de Caddy y `/config` usan volúmenes nombrados. El ensayo usa los certificados persistentes del proxy; recrear mantuvo la huella. `down --volumes` es deliberado para limpiar el ensayo, no un procedimiento para producción.
- Caddy tiene `admin off`, redirección automática a HTTPS y HSTS `max-age=31536000`. El recorrido verificó HSTS sobre HTTPS. Los imports corresponden a directorios que solo monta la capa de ensayo; el Compose de operación original no incorpora esos archivos. No encontré una exposición adicional causada por esos imports en la configuración revisada. Quien agregue archivos allí cambia configuración confiable del proxy: el comprobador de puertos no inspecciona su contenido.
- La petición HTTPS usa el dominio para SNI/certificado y `Host`, aunque conecte al nombre interno `proxy`: es válida para TLS, pero no acredita DNS público, puertos externos o IPv6. Es correcto dejar esas verificaciones para la tarea 7.

## 7. Qué debe resolverse antes de tarea 5 y qué puede esperar

**Antes de cerrar 3/4 y construir publicación sobre estas garantías:** B1 e I1–I6, con sus regresiones; resolver también la política de retroceso/frescura de I7. Son problemas del programa o de sus contratos, no condiciones que dependan de contratar un servidor. El protocolo de publicación debe conservar el nombre del respaldo previo, impedir modificaciones concurrentes y aplicar la misma configuración que comprobó.

El alcance funcional de `--ensayo` debe quedar definido ahora: no declarar cumplida la decisión 18 hasta que haya una comprobación de aplicación utilizable. La automatización de esa comprobación puede compartir trabajo con publicación, pero no se debe tomar el aviso actual como evidencia equivalente.

**Puede permanecer para las tareas previstas:** proveedor real y sus permisos/retención; DNS/ACME públicos; conectividad exterior IPv4/IPv6; renovación y alertas de certificado; margen del vigilante; custodia, suplencias y ensayo periódico real; guion de servidor y guía de rotaciones. Siguen siendo condiciones de operación con datos reales, no garantías demostradas aquí.

Fijar imágenes por huella y conservar la versión anterior corresponde a la tarea 5. No considero su ausencia actual un defecto nuevo de tarea 4. Las respuestas del negocio sobre pérdida aceptable, recuperación, comprobantes y custodios siguen pendientes de ratificación; no se convierten en decisiones aprobadas por haber quedado como valores de configuración.

Las barreras de arranque y la prueba de persistencia por mutación pueden fortalecerse sin esperar infraestructura externa. M1 y M2 son correcciones menores del ensayo; conviene hacerlas junto con sus regresiones.

## 8. Lo que no quedó confirmado

- Motor Docker completamente vacío y sin capas base ni paquetes disponibles; se comprobó proyecto nuevo con caché, no descarga desde cero.
- Renovación ACME pública, vencimiento y entrega efectiva de alertas a personas; proveedor definitivo; acceso exterior IPv4/IPv6; reinicio completo de VM/host.
- Volcados de varios GB, consumo máximo de disco, multipartes y cortes en todas sus posiciones. Se probó un volcado de 6,86 MB y ENOSPC durante pg_dump; no ENOSPC separado en cada fase.
- Toda posible salida de error de rclone/pg_dump ni todas las filtraciones por recolectores externos. Los casos de secretos ejecutados están especificados arriba.
- Plazo de **cada instrucción auxiliar**: sí se probaron turno, volcado (batería), cifrado y las cuatro transferencias. Por lectura, `pg_dump --version` se invoca sin plazo, y la restauración no asigna plazos a age/pg_restore. No se provocó un bloqueo en esas llamadas; no se declara cubierta una cota total de recuperación.
- Cambio de reloj real del host: se usó el reloj inyectable, no se alteró el sistema del usuario. El fallo de listado se inyectó en la interfaz del servicio; los errores y permisos de almacenamiento de las demás pruebas sí fueron contra MinIO.
- Todas las 23 mutaciones anteriores, una nueva mutación de volumen del certificado o la barrera completa de arranque. No se ejecutaron los 106 recorridos ordinarios: sí los 4 de operación dos veces y el recorrido adicional de B1.

Por estas limitaciones y, sobre todo, por los defectos reproducidos, **esta entrega no es una aprobación ni un cierre completo de las tareas 3 y 4**. Después de corregir hay que repetir los cruces y completar las verificaciones pendientes que no dependan de la tarea 7.

## 9. Integridad y limpieza

La comparación por contenido entre original y copia mostró únicamente las adaptaciones del ensayo y los guiones añadidos por esta revisión; los cambios están en `/tmp`. Se conservaron registros sin imprimir las llaves generadas. El directorio de trabajo tiene permisos 0700.

Los proyectos `feruga_ensayo` y `feruga_codex_primera` quedaron sin contenedores ni sus volúmenes de datos/certificados. Se preservaron los cuatro volúmenes que ya existían al comienzo (`feruga_datos`, `feruga_modulos`, `feruga_modulos_recorrido`, `feruga_ensayo_modulos_recorrido`). Los servicios de desarrollo y MinIO de pruebas que ya estaban activos no se detuvieron. Los cubos protegidos de las pruebas quedan en la memoria de ese MinIO, conforme a las reglas del encargo.
