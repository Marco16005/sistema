# Revisión de Codex al plan de despliegue, versión 1 (3 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto. Revisión por lectura, antes de escribir código, del plan
`docs/planes/2026-10-03-despliegue.md` en su versión 1. Es la segunda parte de una corrida con dos
encargos; la primera, el cierre del inventario, está en
`2026-10-03-codex-septima-pasada-cierre-de-inventario.md`. Informe completo, tal como lo entregó.

**Veredicto: no aprueba la versión 1. Cinco bloqueantes, ocho importantes, dos menores.**

La respuesta está en `2026-10-03-respuesta-a-la-revision-del-plan-de-despliegue.md`.

---

**PARTE 2 — Revisión del plan de despliegue**

**5. Hallazgos al plan, por gravedad**

**No aprobaría la versión 1 sin corregir los siguientes puntos.** Esta parte es por lectura del plan, la especificación, el código existente y documentación oficial. Los escenarios de prueba propuestos aquí **no fueron ejecutados**.

**Bloqueantes**

**B1. Restaurar una secuencia no impide reutilizar folios emitidos después del respaldo.**  
Apartados: decisiones 7 y 10, tarea 3, A9 y pregunta 4; [plan:158].

Ejemplo: respaldo terminado con folio 100; después se imprimen 101–110; se pierde el servidor y se restaura aquel respaldo. El siguiente folio puede volver a ser 101.

La prueba actual únicamente exige superar el máximo **incluido en el respaldo**, en [09-respaldo.test.ts:113]. No acredita «sin reutilizar folios ya emitidos» después de una pérdida real.

**Corrección:** definir antes de reabrir una restauración cómo se preserva un límite de folios emitidos fuera del servidor perdido, o cómo se cambia a un espacio de numeración inequívocamente nuevo. Ajustar la secuencia al máximo restaurado no basta. Añadir el cruce respaldo → operaciones posteriores impresas → pérdida → restauración → nueva operación. También debe resolverse la conciliación de esas operaciones posteriores.

**B2. La restauración omite la preparación de roles y el tratamiento de una restauración incompleta.**  
Apartado: decisión 7; [plan:86].

`pg_dump` no incluye los roles del servidor. La prueba existente crea `feruga_app` **antes** de restaurar, en [09-respaldo.test.ts:79]. Dejar el usuario para `migracion` después no resuelve eso: el volcado necesita el rol para sus permisos, y la tabla `migracion` restaurada hará que se omita `0011`, donde se creó originalmente. [Documentación de pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

**Corrección:** especificar y compartir entre ensayo y emergencia esta secuencia: preparar roles mínimos → crear base aislada → restaurar con propietario deliberado y permisos conservados → comprobar → crear/configurar `feruga_web` → habilitar aplicación. No remediarlo eliminando las ACL.

Exigir salida correcta de `pg_restore` y restauración atómica cuando sea viable, o eliminación de la base incompleta antes de reintentar. `--exit-on-error` detiene el proceso, pero por sí solo no revierte lo ya restaurado. [Documentación de pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

**B3. La publicación permite migrar mientras la versión anterior sigue atendiendo; la vuelta atrás puede borrar trabajo válido.**  
Apartado: decisión 10; [plan:98].

`depends_on` ordena el arranque de dependientes; no constituye un protocolo para retirar la aplicación anterior antes de modificar su base. El candado de [migrar.ts:15] serializa migradores, no las peticiones de la aplicación.

Además, cada archivo SQL tiene su propia transacción. Si una versión trae tres migraciones y falla la tercera, las dos anteriores permanecen. Restaurar el respaldo tomado mientras todavía se atendía perdería operaciones posteriores a ese respaldo.

**Corrección:** para este servidor único, definir una ventana de mantenimiento: preparar y conservar las imágenes nueva y anterior → impedir nuevas escrituras y terminar las activas → respaldo verificado → migrar → arrancar y comprobar funcionalmente → reabrir. Mantener el bloqueo durante una recuperación.

Si se desea coexistencia de versiones, hace falta otro contrato explícito de compatibilidad de esquema. Añadir pruebas de migración fallida intermedia, petición activa durante el cambio y recuperación sin pérdida de operaciones aceptadas.

**B4. «Solo escribe», listar, verificar y proteger contra sobrescrituras no forman todavía un diseño compatible.**  
Apartados: restricciones globales y decisión 5; [plan:38].

`respaldo lista` necesita permisos de listado. La verificación habitual de `rclone` consulta el objeto después de subirlo; en S3, `HeadObject` requiere `s3:GetObject`. Tampoco puede suponerse que cualquier `ETag` sea el hash del archivo, especialmente con cargas multipartes. [Permisos de HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html), [verificación de rclone](https://rclone.org/s3/#hashes).

Por separado, permitir escribir y prohibir borrar **no garantiza conservar la historia**: escribir sobre una clave existente puede reemplazar el respaldo accesible. Una política de caducidad no equivale a protección contra sobrescritura.

**Corrección:** elegir proveedor y política concreta antes de cerrar la tarea 3. Separar credenciales de subida y recuperación/verificación, o permitir lectura del **cifrado** manteniendo fuera la llave privada. Definir nombres únicos, versiones protegidas, retención y denegación de cambios de esas políticas. Probar los permisos reales, incluido sobrescribir un objeto existente. [Protección de versiones mediante Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).

**B5. La comprobación depende del mismo archivo opcional cuya ausencia debería detectar.**  
Apartados: decisiones 1 y 3, tareas 1 y 2; [plan:60].

Si no se carga `.env`, se selecciona solamente el Compose base o se omiten dependencias, desaparece la comprobación. El archivo actual conserva valores de desarrollo; su clave de sesión por omisión incluso supera el mínimo que revisa `/api/salud`. Un proxy anterior puede seguir en funcionamiento durante un cambio incorrecto.

**Corrección:** hacer que la configuración desplegada falle por ausencia de valores, dejando los valores de desarrollo en una configuración explícita de desarrollo. Validar también al iniciar los procesos críticos; no confiar exclusivamente en un servicio previo.

Declarar las condiciones completas: comprobación terminada correctamente → base saludable → migración terminada correctamente → aplicación saludable → proxy habilitado. Comprobar reinicios y servicios ya existentes, además del arranque vacío. Compose distingue expresamente entre servicio iniciado, saludable y terminado correctamente. [Orden de arranque](https://docs.docker.com/compose/how-tos/startup-order/).

**Importantes**

**I1. «Se muestra una vez» no garantiza que el secreto no quede registrado.**  
Apartados: decisiones 4, 6 y 7; [plan:74].

El entorno y la llave privada salen por la salida estándar de un contenedor. Docker normalmente registra `stdout` y `stderr`; `--rm` no evita su captura mientras corre ni su envío a un recolector externo. [Registros de Docker](https://docs.docker.com/engine/logging/).

La entrada estándar es una buena elección para restaurar, pero la guía podría anularla usando una llave literal en `echo`, argumentos, variables o una terminal con eco.

**Corrección:** generar la llave en una máquina de confianza fuera del servidor; usar un flujo sin registro de secretos, sin eco y sin argumentos sensibles. Crear el entorno con permisos restrictivos y sin sobrescribir uno existente accidentalmente. Inspeccionar registros y procesos **mientras** la operación está viva, también cuando falla.

Las claves pasadas como `environment` quedan en la configuración inspeccionable de los contenedores. Decidir explícitamente si se acepta esa frontera administrativa o se usan archivos de secretos por servicio. Estos tampoco protegen contra el administrador del host. Mantener secretos fuera de capas de imagen y ampliar las exclusiones si aparecen archivos distintos de `.env`. [Secretos en Compose](https://docs.docker.com/compose/how-tos/use-secrets/).

**I2. No está definido el ensayo automático de los respaldos reales con la llave fuera del servidor.**  
Apartados: restricción de restauración automática, decisiones 6–8 y tarea 3; [plan:34].

La prueba con destino local y una llave de prueba acredita el programa. No demuestra que el objeto remoto de producción pueda descargarse y restaurarse con la llave custodiada. El ensayo real de la tarea 5 es inicial; falta periodicidad y ejecutor.

**Corrección:** definir una máquina de recuperación independiente, credencial de lectura, custodia de llave y calendario de ensayos. Descargar el objeto remoto identificado y restaurarlo sin reutilizar la copia local del productor. Si se decide que el dueño lo hará manualmente, cambiar la promesa de automatización y asignar responsable y frecuencia.

La copia externa del entorno debe actualizarse tras cada rotación. Añadir al paquete de recuperación acceso al repositorio o imágenes, almacenamiento, DNS y cuentas necesarias. Conservar `SESION_CLAVE` permite descifrar las cookies anteriores, pero no recupera altas, bajas o sesiones posteriores al respaldo.

**I3. Faltan objetivos de recuperación y la recaptura desde tickets promete más de lo que conserva el sistema.**  
Apartados: pregunta 4 y afirmación de independencia de las tareas; [plan:213].

La especificación 12.2 exige dos números: pérdida aceptable y tiempo máximo para volver a operar. Falta el segundo. Dos horarios diarios tampoco garantizan por sí mismos doce horas máximas entre respaldos utilizables.

Los tickets no reconstruyen necesariamente mermas, conteos, separaciones, autorizaciones, cuentas abiertas ni cambios de credenciales. Tampoco se establece que el negocio conserve copia de los comprobantes entregados.

**Corrección:** acordar ambos objetivos y qué evidencia queda para conciliar cada clase de operación. Medir recuperación completa, incluyendo obtener llave, descargar, restaurar y reabrir. Estas respuestas pueden cambiar el diseño de respaldo; no todas pueden aplazarse hasta terminar las tareas 1–4.

**I4. Faltan estados del respaldo, exclusión entre ejecuciones y vigilancia de frescura.**  
Apartados: decisiones 5 y 9, tarea 3; [plan:77].

No se define qué sucede si coinciden el respaldo programado y `ahora`, se reinicia el servicio, se queda bloqueado un proceso o la subida terminó pero se perdió su respuesta. Una señal tardía de un respaldo antiguo tampoco prueba que haya uno suficientemente reciente.

La promesa de que nunca quedará un archivo parcial necesita precisión: si una verificación detecta corrupción después de subir, una credencial sin borrado no puede retirarlo.

**Corrección:** identificador único por ejecución, exclusión compartida, plazos, reintentos y propagación del fallo de **cada** proceso. Registrar inicio de la instantánea, objeto, tamaño, hash, versión y llave pública utilizada. Marcar como utilizable solo tras verificar; los objetos incompletos quedan excluidos y sujetos a limpieza externa.

El vigilante debe comprobar cada vencimiento esperado y la antigüedad del respaldo, con margen definido. Distinguir «objeto verificado» de «última restauración satisfactoria». Definir también qué ocurre con un horario perdido durante una caída.

**I5. El proxy puede estar arrancado sin certificado utilizable; falta persistencia y vigilancia de renovación.**  
Apartados: decisión 2, tareas 2 y 4; [plan:64].

Caddy obtiene certificados en segundo plano: que el contenedor corra no demuestra que HTTPS funcione. Necesita almacenamiento persistente para certificados y claves. [HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https).

**Corrección:** declarar el volumen persistente, comprobar DNS y acceso para ACME, y exigir una petición HTTPS con validación real antes de dar el servicio por disponible. Vigilar vencimiento con anticipación. Si falla la emisión inicial, no abrir operación; si falla la renovación, atender antes de que venza. La contingencia no debe consistir en desactivar `Secure` ni operar por HTTP.

En el ensayo local, confiar la CA de Caddy en el cliente. No usar la bandera de origen seguro ni omitir errores TLS como evidencia de esta tarea.

**I6. La verificación de red y el guion del servidor necesitan criterios positivos y privilegios explícitos.**  
Apartados: decisión 11 y tareas 2, 4 y 5; [plan:103].

Publicar base y aplicación en `127.0.0.1` es adecuado para impedir acceso directo exterior. No demuestra aislamiento entre contenedores. Además, los puertos publicados por Docker pueden eludir las reglas habituales de UFW. [Docker y cortafuegos](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

**Corrección:** inspeccionar la configuración combinada de Compose y sus publicaciones efectivas; comprobar IPv4 e IPv6 desde otra máquina, demostrando simultáneamente que el servicio probado está vivo por la vía interna. Mantener sin publicar la administración de Caddy y el socket de Docker. El proxy debe alcanzar la aplicación por la red de contenedores.

El puerto 22 debe quedar como excepción administrativa explícita, restringida cuando sea posible. Antes de quitar contraseñas, verificar otra conexión por llave y disponer de consola de recuperación.

Un usuario en el grupo `docker` tiene privilegios equivalentes a root; no debe describirse como carente de privilegios. [Modelo de permisos de Docker](https://docs.docker.com/engine/install/linux-postinstall/). Ejecutar el guion dos veces en un contenedor no prueba SSH, arranque, cortafuegos ni recuperación tras reiniciar: hace falta la verificación en una VM o servidor real que el propio plan anticipa.

**I7. El retrato de restauración y `/api/salud` no acreditan que la aplicación restaurada funcione.**  
Apartados: decisiones 7, 9 y 10, tarea 3; [plan:86].

El [retrato actual] compara saldos y algunas estructuras, pero no el contenido completo de bitácora, credenciales, equipos, sesiones, impresiones y registros de idempotencia. Las operaciones posteriores de esa prueba se ejecutan principalmente como administrador.

[Salud] comprueba longitud de clave y `SELECT 1`; podría responder correctamente con funciones o permisos de negocio inutilizables.

**Corrección:** ampliar el escenario con identidad real, impresión, envío confirmado y cancelado; comprobar esos datos y repetir envíos después de restaurar. Conectar como `feruga_web` y realizar entrada y una operación mediante la aplicación. Verificar versión esperada del esquema antes de habilitarla, sin exponer detalles sensibles en el endpoint público.

Después de una pérdida temporal, decidir cómo tratar sesiones y revocaciones restauradas a un estado anterior, y cómo resolver los pendientes que siguen en los navegadores antes de reabrir.

**I8. Faltan cruces y mutaciones que distingan una implementación correcta de una prueba favorable.**  
Apartados: tareas 1–4; [plan:126].

Añadiría estos criterios:

| Área | Prueba que falta o debe fortalecerse |
|---|---|
| Comprobación inicial | Retener y después rechazar la comprobación; demostrar que los dependientes no arrancaron ni migraron. Probar entorno ausente, arranque parcial y reinicio. |
| Origen | Petición válida con sesión y cuerpo correctos: éxito con origen permitido y **403 `ORIGEN`**, sin efecto, con origen ajeno. Un rechazo por falta de sesión sería un falso positivo. |
| Red | No aceptar un timeout aislado: acreditar servicio interno activo, conectividad exterior de control y publicaciones efectivas. |
| Objeto respaldado | Eliminar la copia local, descargar el objeto subido y restaurarlo. Corromperlo conservando su tamaño, usar llave incorrecta y retirar un permiso necesario. |
| Vigilancia | Observar la fase retenida, provocar el vencimiento y comprobar recepción del aviso; después restaurar el servicio y verificar recuperación. |
| Concurrencia | Respaldo manual contra programado; dos despliegues; escrituras durante volcado; migración contra aplicación activa. Demostrar espera con barreras. |
| Secretos | Inspeccionar durante una operación retenida y en fallos intermedios, no solamente después de desaparecer el contenedor. |
| Recuperación | Folios emitidos después del respaldo, restauración interrumpida, base ocupada y migración intermedia fallida. |

La prueba existente de dos migradores, [12-servidor.test.ts:224], usa `Promise.all`, pero no demuestra que uno haya esperado.

Las pruebas nuevas que pasen a la primera deben comprobarse por mutación: omitir la validación, adelantar la señal de éxito, quitar el candado, restaurar otro archivo o eliminar datos de identidad/idempotencia. No basta con que inicialmente fallen porque todavía no existe el proxy.

**Menores**

**M1. «Versión fijada» todavía no significa publicación reproducible.**  
Apartados: herramientas, situación actual y decisión 10; [plan:21].

`node:24-alpine` y `postgres:17-alpine` fijan una familia, no un contenido inmutable. `git pull` tampoco identifica por sí solo una versión recuperable.

**Corrección:** registrar commit y referencias inmutables de imágenes, conservar la versión anterior y definir cómo se incorporan actualizaciones de seguridad. Aclarar también que el procedimiento basado en Git requiere Git en el servidor o una alternativa equivalente.

**M2. Falta probar el arranque inicial sin base ni entorno y la rotación sobre un volumen existente.**  
Apartados: decisiones 4 y 6, tareas 1 y 4.

La consola actual conecta a PostgreSQL antes de despachar la orden, en [principal.ts:116]. El nuevo comando `entorno` debe poder ejecutarse antes de esa conexión. `--no-deps` no evita que Compose tenga que interpretar su configuración.

**Corrección:** un camino de generación independiente de base y secretos de operación; probarlo con máquina y configuración vacías, y empaquetar explícitamente los nuevos guiones en sus imágenes.

La guía de rotación debe distinguir cambiar `.env` de cambiar la contraseña de una base existente: `POSTGRES_PASSWORD` solo inicializa un directorio de datos vacío. [Imagen oficial de PostgreSQL](https://hub.docker.com/_/postgres).

**Preguntas adicionales al negocio y orden de trabajo**

Además de las seis existentes, faltan decisiones que sí pueden cambiar el diseño:

- **Tiempo máximo de interrupción**, y ventanas permitidas de mantenimiento.
- **Qué operaciones se acepta perder** y qué evidencia queda para reconstruirlas.
- **Custodio y suplente de la llave**, disponibilidad para restaurar y acceso a las cuentas externas.
- **Retención de respaldos** y plazo para detectar una corrupción o error antes de que caduquen las copias útiles.
- **Acceso público o restringido** al patio/VPN, y navegadores reales que deberán operar.
- **Responsable de atender avisos**, horario, suplencia y escalamiento.

Resolvería primero objetivos, numeración tras recuperación, custodia y capacidades del almacenamiento. Después implementaría generación/comprobación y restauración; luego el respaldo completo, proxy, publicación y pruebas integradas. La tarea 5 debe ser una condición previa a operar con datos reales.

**6. Lo que el plan tiene bien y no debe cambiarse**

- **`pg_dump --format=custom` es adecuado.** Produce un volcado consistente mientras la aplicación escribe; no hace falta detener las escrituras para cada respaldo programado. Esa instantánea no contiene las operaciones posteriores. Las secuencias sí forman parte del volcado. [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).
- **`pgcrypto` no tiene por qué perderse.** El volcado completo incluye la creación de la extensión; el destino debe disponer de sus archivos y conservar el esquema `extensiones`. No conviene restringir el volcado a `public`. [Extensiones y restauración](https://www.postgresql.org/docs/17/extend-extensions.html).
- **Cifrado con llave pública y custodia externa de la privada**, respaldo fuera del servidor y separación de credenciales.
- **Mismo programa para ensayo y emergencia**, con restauración en un servidor vacío.
- **Vigilancia externa**, tanto de disponibilidad como de ausencia de respaldos.
- **HTTPS, `Secure`, origen explícito y prohibición de marcos en la aplicación.** Son compatibles con la impresión comprobada.
- **Separación de aplicación y administración**, conforme a la autenticación ya concretada en la especificación 15.3.
- **Exclusiones por etapa declaradas.** Evidencia de cámaras y diario del agente deberán incorporarse al respaldo cuando existan; el despliegue actual no debe presentarse como cobertura completa de esos elementos de 12.1.

Precisaría una afirmación: no guardar la llave privada protege los archivos cifrados, pero quien comprometa el servidor puede leer la base viva. El cifrado no garantiza por sí solo la confidencialidad de toda la historia residente allí.

**7. Lo que no revisé**

En la PARTE 1 no probé impresora física, duplicación desde el menú, Ctrl+Shift+T, otros motores, fallos de `sessionStorage` ni todas las intercalaciones posibles. Tampoco reconstruí imágenes, ejecuté tipos ni repetí las mutaciones históricas.

En la PARTE 2 no ejecuté código de despliegue, migraciones experimentales, restauraciones nuevas, pruebas S3 ni cambios de infraestructura. No comprobé proveedor contratado, políticas reales, DNS, certificados públicos, renovación, SSH, cortafuegos, reinicio o entrega real de alertas.

**El inventario queda cerrado; el plan de despliegue necesita una segunda versión con los bloqueantes resueltos antes de aprobar su implementación completa y salida a operación.**

