> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-10c.md`. **Completo:** los doce puntos, en catorce minutos.
> Es la parte C de la décima pasada (A precio especial; B publicar: la lógica; C publicar: los
> guiones; D respaldo diario; E rediseño). Revisó una copia (`/tmp/feruga-codex-qa10/`) ya
> preparada. **No corrió el ensayo de publicación** (se le pidió que no: son 17 minutos): lo que
> pide ejecutarlo para confirmarse viene marcado «Sin confirmar: para ensayar», con su caso exacto.
> Lo que se hizo con cada hallazgo está en `2026-10-07-respuesta-a-la-decima-revision.md`.

# Décima pasada de calidad, parte C — publicar una versión: los guiones — 2026-10-07

1. Sin hallazgos en la secuencia normal sobre una instalación vigente: recorrí las fronteras 154/157, 166/174, 190/192, 223/225, 225/231, 231/233 y 252/258 de publicar.sh; la intención de migrar/abrir precede al efecto y recuperar distingue desistimiento de candidata. Condicionado a exclusión real (punto 3) y a detener los procesos hijos (punto 11).
2. Recuperar.

### [importante] La primera publicación interrumpida después de marcar la migración queda sin salida por los guiones
Dónde: operacion/publicar.sh:190, 195-202, 433-444; operacion/volver.sh:95
Escenario: primera instalación; matar en `migrar:antes` (entre 190 y 192), o en `migrar:despues` (195, antes de anotar marca/cerrar). `--recuperar` se detiene por falta de base o cae en caso 2; publicar/levantar rechazan la pendiente y volver rechaza que no hay anterior. Incluso si todas las migraciones terminaron, no existe un camino para completar esa primera publicación. No se pide implementar --corregida.
Confirmado con: Sin confirmar: para ensayar. En instalación vacía, matar por separado en esos dos puntos; ejecutar recuperar, publicar, levantar y volver; comprobar que ninguno completa y que en el segundo la base ya está migrada.
Corrección sugerida: definir recuperación explícita de la primera instalación, con comprobación de base/esquema y cierre antes de continuar; ofrecer una salida concreta si la migración quedó incompleta.
3. Candado (sondas sin Docker, sobre carpetas temporales propias).

### [bloqueante] Un relevo atrasado sobrescribe el candado de un dueño nuevo que sigue vivo
Dónde: operacion/candado.sh:72-94
Escenario: A lee el dueño muerto y se pausa justo antes de 92; B releva y termina (borra la carpeta); C toma un candado nuevo y sigue vivo; A continúa y crea `relevo-<turno viejo>` dentro del candado de C, lo sobrescribe y entra también.
Confirmado con: `python3 qa/qa10c-candado.py` → `ABA: A_ENTRO C_SIGUE_VIVO=True DUEÑO=que=A`. Se usa candado.sh real; mkdir intercala las operaciones y una identidad de proceso estable sustituye ps solo en este caso, para aislarlo de la restricción del sandbox.
Corrección sugerida: usar un bloqueo del sistema que sobreviva al relevo sin reutilizar una ruta borrada; no basar la exclusión en verificar y luego modificar una carpeta que puede ser otra.

### [importante] Morir después de reservar el relevo deja el candado bloqueado indefinidamente
Dónde: operacion/candado.sh:92-93
Escenario: el relevista crea `relevo-<turno>` y muere antes de anotar al nuevo dueño. Sigue constando el dueño muerto, pero todos los siguientes pierden el mkdir de ese turno; nadie puede recuperar, publicar, levantar ni volver sin borrar a mano.
Confirmado con: `python3 qa/qa10c-candado.py` → `RELEVO_INTERRUMPIDO: rc=3 Hay otra operación en curso ... acaba de relevar el candado ...`. La sonda termina entre mkdir y candado_anotar.
Corrección sugerida: hacer recuperable también la reserva de relevo, o sustituir el protocolo por exclusión del sistema operativo.

### [importante] El candado concede entrada aunque falle escribir el dueño o inspeccionar un proceso vivo
Dónde: operacion/candado.sh:52, 56, 62-63, 84, 93-95
Escenario: tomar_candado se llama bajo `||`, por lo que un fallo de mv al anotar no detiene la función y se devuelve éxito. Además, si ps o /proc no permiten obtener el inicio, se interpreta como dueño muerto y se puede relevar a uno vivo.
Confirmado con: `python3 qa/qa10c-candado.py` → `ANOTAR_FALLA: rc=0 TOMADO_SIN_DUENO DUENO_AUSENTE`; `TZ_MAC: B_ENTRO A_SIGUE_VIVO=True rc=0`. En este entorno macOS ps está prohibido por el sandbox: la segunda salida acredita el fallo de inspección, NO un fallo causado por TZ.
Corrección sugerida: propagar cada fallo de escritura; distinguir inexistencia comprobada de inspección fallida y negar el relevo en el segundo caso. En macOS fijar TZ/locale al obtener el inicio; en Linux comprobar también el espacio de procesos.
3. Pendiente de ensayo fuera del sandbox: macOS, dueño bajo TZ=UTC y segundo bajo TZ=America/Mexico_City; comprobar si lstart cambia y lo releva vivo. Linux con /proc oculto u otro espacio PID debe negarse, no asumir muerte. Un SIGSTOP por sí solo conserva identidad; /proc incluye boot_id para distinguir reinicios.
4. Volver al respaldo.

### [importante] Reintentar --abrir después de abrir la base deja apagado el respaldo diario
Dónde: operacion/volver.sh:176-178, 190-191
Escenario: vuelta terminada y cerrada; ejecutar --abrir y matar entre 190 (apertura confirmada) y 191 (arrancar respaldo). Repetir --abrir dice «La operación ya está abierta» y devuelve éxito sin reponer respaldo ni comprobar HTTPS.
Confirmado con: `python3 qa/qa10c-guiones.py` → `ABRIR_REINTENTO: rc=0 La operación ya está abierta.`; la sonda ejecuta abrir() real con base ya abierta y nunca llama al arrancar instrumentado. Sin confirmar: para ensayar la muerte exacta entre 190/191 y verificar respaldo detenido tras reintentar.
Corrección sugerida: una apertura ya confirmada debe terminar hacia adelante: comprobar conjunto/sitio y reponer respaldo antes de dar éxito.

### [importante] Reintentar una restauración cuyo proceso hijo sobrevivió puede enfrentar dos restauradores sobre la misma base temporal
Dónde: operacion/volver.sh:134-136; operacion/publicar.sh:554-556; operacion/restaurar.ts:105-106, 181-186
Escenario: matar solo el guion padre durante pg_restore, antes de que el hijo termine. El candado se releva, pero no se espera al contenedor comprobacion/restaurar. El siguiente intento usa también feruga_restaurando y la borra WITH (FORCE); el finally del primero puede borrar la temporal del segundo.
Confirmado con: Sin confirmar: para ensayar. Retener pg_restore en una instalación del ensayo, matar el padre entre 134 y 137 de volver.sh (o 554 y 557 de publicar.sh), reintentar con la llave antes de liberar al hijo; comprobar contenedores restauradores, errores y existencia/marca de feruga, feruga_restaurando y feruga_fallida_<numero>.
Corrección sugerida: esperar o detener y verificar los restauradores huérfanos antes de retomar; usar exclusión en el servidor y nombres temporales por intento.
4. Revisión adicional sin hallazgos: apartar no borra la fallida; el nombre definitivo se asigna después de auditar, registrar la nueva marca y comprobar el acceso web. --abrir cerrado comprueba cierre «restaurada» y marca; la llave y su permanencia se tratan en 9.
5. Instalar desde respaldo.

### [importante] Las imágenes descargadas se ejecutan confiando en un manifiesto remoto sin autenticación del commit
Dónde: operacion/publicar.sh:498-505, 512, 529; operacion/fuera.ts:59-75, 165-175
Escenario: quien pueda sustituir imagenes.tar y conjunto.json conserva publicacion/commit, cambia los identificadores y recalcula bytes/hash. Se acepta el conjunto como de aquel commit; docker load y los identificadores solo comprueban coherencia con ese mismo manifiesto sustituido. La imagen respaldo se ejecuta con claves en 529 y recibe la llave privada al restaurar. El commit local no acredita el contenido de las imágenes.
Confirmado con: `sh qa/prueba.sh qa/qa10c-fuera.test.ts` → `✔ qa10c fuera: repetición acepta objeto remoto dañado del mismo tamaño y manifiesto reemplazado`. La sonda demuestra aceptación de contenido/identificador sustituidos conservando commit, no ejecución de una imagen maliciosa.
Corrección sugerida: autenticar el manifiesto y su vínculo commit→identificadores con una firma verificable desde una raíz local confiable; fijar una única copia verificada para commit, archivo e imágenes.
5. Revisión adicional: la restauración confirma contenido/esquema antes del renombrado y quita la base inicial solo tras comprobarla; un respaldo cerrado se abre/re-cierra antes de levantar web. La muerte con restaurador vivo se detalla en 4.
6. Lo que se guarda fuera.

### [menor] Guardar una publicación ya existente no vuelve a comprobar el contenido remoto
Dónde: operacion/fuera.ts:127-132
Escenario: guardar A; dañar imagenes.tar remoto manteniendo su tamaño y dejando el manifiesto; repetir guardar con A local. Se da por guardada sin descargar el objeto; traer después lo rechaza por hash. La ruta normal crea otro identificador, por lo que el impacto directo es la reutilización/reintento del mismo nombre, no toda publicación nueva.
Confirmado con: `sh qa/prueba.sh qa/qa10c-fuera.test.ts` → `✔ qa10c fuera: repetición acepta objeto remoto dañado del mismo tamaño y manifiesto reemplazado`; la prueba exige que guardar acepte y traer rechace el mismo objeto remoto.
Corrección sugerida: en la rama ya existente, descargar y verificar también el archivo remoto antes de devolver éxito; comparar commit y esquema además de imágenes/hash.
6. Sin otros hallazgos en el camino nuevo: guardar_fuera comprueba docker save y el proceso de subir; guardarFuera relee archivo y manifiesto antes de autorizar publicar. No sube conjunto.json local ni .env. La autenticidad se trata en 5; fuentes/archivos ignorados que podrían acabar en las imágenes, en 11.
7. Levantar, Compose y migrar a mano.

### [importante] Migrar a mano elige el conjunto antes de obtener el candado
Dónde: operacion/migrar.sh:26-28, 39-46
Escenario: A lee configuración vigente V1 en 26-28 y se pausa antes de 39. B publica V2 completamente, sin migraciones nuevas pero cambiando WEB_BD_CLAVE. A continúa, obtiene candado, ya no ve pendiente y ejecuta el migrador/rol de V1 con la clave vieja: puede dejar inaccesible la base para web V2. Si cambió el esquema, ejecuta igualmente el migrador equivocado, aunque este puede rechazarlo.
Confirmado con: Sin confirmar: para ensayar. Pausar migrar.sh entre 28/39, publicar el caso descrito y soltar A; comprobar imagen del migrador, clave de acceso de web y HTTPS después.
Corrección sugerida: para toda orden que modifica, tomar el candado antes de leer vigente/configuración y seleccionar el conjunto dentro de la sección protegida.

### [importante] compose.sh permite alterar servicios sin candado ni comprobar una publicación pendiente
Dónde: operacion/compose.sh:19-22
Escenario: publicación detenida en comprobar:despues con candidata cerrada; ejecutar por costumbre `sh operacion/compose.sh up -d --no-deps web`. El wrapper resuelve la vigente anterior y permite reemplazar la candidata por ella sin pasar por levantar ni tomar candado. También admite stop/down mientras una apertura ya confirmada atiende.
Confirmado con: Sin confirmar: para ensayar. Pausar publicar en comprobar:despues, ejecutar ese up y comprobar identificador/versión de web antes de soltar la publicación; la llamada exec pasa "$@" sin restricción.
Corrección sugerida: limitar el wrapper a consultas y ejecuciones administrativas previstas; redirigir órdenes que alteran servicios a guiones con candado y comprobaciones.
7. Sin hallazgos adicionales: levantar exige commit y carpeta limpia, resuelve una vez y levanta el conjunto guardado. `python3 qa/qa10c-compose.py` → `CONFIG_RESUELTA='literal$$QA10C_CAMBIA'`, `CONFIG_RELEIDA='literal$$QA10C_CAMBIA'`: Compose preserva el literal aunque cambie el entorno. Compose a secas en operación exige las cinco IMAGEN y VERSION; no es un bloqueo si alguien las exporta, ni sustituye al candado.
8. Shell.

### [importante] Fallos de lectura pueden convertirse en comprobaciones positivas
Dónde: operacion/pasos.sh:45, 150, 163; operacion/publicar.sh:270, 281, 310, 342, 505
Escenario: git status falla → se acepta carpeta limpia; fallan ambos compose config --hash → dos cadenas vacías pasan como configuraciones iguales; falla docker ps al esperar → se da por ausente el contenedor; falla de_fuera variables → tr devuelve éxito y se continúa con variables vacías (la resolución posterior puede fallar o heredar variables del entorno).
Confirmado con: `python3 qa/qa10c-guiones.py` → `GIT_STATUS_FALLA: rc=0 CARPETA_ACEPTADA_LIMPIA`, `HUELLAS_FALLAN: rc=0 CONFIGURACIONES_ACEPTADAS_IGUALES`, `ESPERAR_PS_FALLA: rc=0 SE_SIGUE_HASTA_LA_BASE | ESPERA_DECLARADA_EXITOSA`, `VARIABLES_FALLAN: rc=0 VARIABLES_ACEPTADAS=<>`.
Corrección sugerida: capturar cada productor en una asignación cuyo estado se compruebe antes de filtrar/comparar; exigir valor no vacío y distinguir error de ausencia. No depender de pipefail en sh.
8. Otros errores cuyo estado se pierde (lectura del código): pasos.sh:90 (compose config|sed|head; construir valida vacío, esperar_al_migrador no); 82-84 (mkdir/chmod bajo funciones llamadas en || pueden fallar y aun así ejecutar Docker); publicar.sh:279 (manifiesto variables dentro de argumentos de resolver), 360/405/479/565 (lecturas dentro de condiciones sin verificar código); volver.sh:176/184 y levantar.sh:73 (lecturas de estado en condiciones); candado.sh:33-37/43/48/52/62/69/93 (tuberías, sustituciones y candado_anotar bajo ||). El caso concreto del candado está confirmado en 3. publicar.sh:348 ignora docker kill y reintenta indefinidamente si siempre falla. No todos estos sitios permiten abrir mal: algunos acaban rechazados por validaciones posteriores.
8. `sh -n` pasó en los siete guiones (sh de macOS); no ejecuté dash ni shellcheck. Fallos tolerados deliberadamente: publicar.sh:178/180 (aviso del vigilante), pasos.sh:116 (estado no-contesta) y 133 (mostrar último diagnóstico), volver.sh:183 (cierre desconocido impide abrir). Las rutas de configuración/llave están entre comillas; las expansiones sin comillas son listas de identificadores o variables sin espacios.
9. Secretos.

### [importante] La llave privada queda en disco tras SIGKILL, durante un plazo sin límite del guion
Dónde: operacion/publicar.sh:68-78, 460, 555; operacion/volver.sh:46-56, 85, 135
Escenario: instalar o volver copia stdin a $privado/llave; matar con -9 tras esa copia. El trap no corre, la carpeta temporal anónima queda con la llave legible para el dueño hasta limpieza externa. En un camino normal tampoco se borra al acabar de descifrar: se conserva hasta terminar el guion.
Confirmado con: `python3 qa/qa10c-secretos.py` → `KILL9: carpeta=0o700 llave=0o600 PERSISTE=True`. Reproduce el patrón de mktemp/umask/trap con una llave ficticia y limpia después.
Corrección sugerida: conservar la entrada en un descriptor y entregarla directamente al restaurador cuando se necesite, sin archivo intermedio; si fuera imprescindible, usar almacenamiento volátil y limpieza verificable de restos de turnos muertos.
9. Sin otros hallazgos confirmados: carpetas 700 y archivos 600 en los guiones con umask 077; configuración guardada intencionalmente en publicaciones; llave enviada por stdin, no por argv ni logs. La configuración temporal también persiste tras SIGKILL. compose.sh permite `config` e `inspect` al administrador y por diseño pueden mostrar secretos; no los ejecuté con configuración real.
10. Ensayo (solo lectura; no ejecutado).

### [menor] La comparación de «lo asentado» solo cubre la tabla operacion
Dónde: operacion/ensayo-publicacion.sh:53, 134, 214, 439, 522
Escenario: una migración conserva operacion pero altera datos de una tabla de detalle, inventario o catálogos; asentado() da el mismo md5/count y ese criterio pasa aunque el contenido de negocio haya cambiado. No es un hash de toda la base.
Confirmado con: Sin confirmar: para ensayar. En version_nueva, introducir una modificación controlada de un dato relacionado que no toque operacion, guardar su valor antes y comprobar que asentado() permanece igual mientras cambia ese valor.
Corrección sugerida: comparar una instantánea determinista de todas las tablas de negocio relevantes, excluyendo solo los cambios esperados de restauración/mantenimiento.
10. Prioridad de casos faltantes: (1) relevo ABA y muerte entre candado.sh:92/93 (confirmados en 3); (2) muerte con restaurador vivo y repetición inmediata (4), y volver directo con migrador vivo (11); (3) primera publicación en migrar:antes/despues (2); (4) volver --abrir entre 190/191 (4); (5) caída del respaldo al terminar y respuesta perdida después del commit de migración. Para este último, interrumpir la respuesta del contenedor tras confirmar la migración, antes de publicar.sh:195; debe quedar caso 2, cerrado, y volver usar el respaldo exacto. Los puntos actuales mueren después de retornar los hijos, salvo el caso específico de migrador vivo; no acreditan todas las ventanas entre órdenes. No evalué --corregida ni la parte H, apartadas por decisión del usuario.
11. Puntos heredados de B.

### [importante] Volver no espera ni detiene al migrador que sobrevivió a publicar
Dónde: operacion/volver.sh:108-123; operacion/publicar.sh:339-353; operacion/pasos.sh:184
Escenario: publicar muere con marca de migración y su contenedor vivo, temporalmente sin sesión PostgreSQL; volver se llama directamente (la ayuda no exige recuperar antes). Solo detiene web/respaldo y drena sesiones de aplicación. Aparta/restaura y levanta la anterior; el migrador vivo puede conectarse después a la restaurada y modificarla, o ejecutar db/rol.ts con la clave candidata.
Confirmado con: Sin confirmar: para ensayar. Retener el contenedor migracion antes de conectar a PostgreSQL (o entre `node db/migrar.ts` y `node db/rol.ts`), matar el padre, ejecutar volver sin recuperar, y soltar el migrador después de vuelta:restaurada; verificar esquema/clave de la restaurada y acceso de la aplicación anterior. Con una sesión ya abierta, ALTER DATABASE se negaría: ese caso solo bloquea, no prueba el riesgo descrito.
Corrección sugerida: compartir espera/detención y verificación de migradores con recuperar, antes de drenar/apartar; impedir también que un lanzamiento huérfano todavía pendiente arranque después.

### [importante] Esperar al migrador busca el proyecto del .env actual, no el del conjunto pendiente
Dónde: operacion/publicar.sh:340-348; operacion/pasos.sh:90
Escenario: matar publicar con migracion vivo; cambiar COMPOSE_PROJECT_NAME en .env antes de recuperar. El manifiesto/configuración siguen apuntando al proyecto original, pero docker ps busca el nuevo y omite al hijo original. Mirar la base solo acredita un instante; no impide que ese contenedor conecte después. Un fallo de ps produce el mismo falso vacío.
Confirmado con: `python3 qa/qa10c-guiones.py` → `ESPERAR_PS_FALLA: rc=0 SE_SIGUE_HASTA_LA_BASE | ESPERA_DECLARADA_EXITOSA` confirma el error de ps ignorado. Sin confirmar: para ensayar el cambio de proyecto; retener el migrador antes de conectar, matar padre, cambiar nombre, recuperar y comprobar si el contenedor original sigue vivo.
Corrección sugerida: extraer el proyecto de la configuración fija, comprobar el estado de cada docker ps/kill y acreditar ausencia real del proceso antes de consultar sus sesiones.

### [importante] Git limpio no garantiza que las imágenes correspondan al commit
Dónde: operacion/publicar.sh:269-270, 121-123; operacion/pasos.sh:58-67; docker/respaldo.Dockerfile:15-17; docker/web.Dockerfile:17, 24
Escenario: un archivo ignorado mediante .git/info/exclude dentro de src/servidor no aparece en git status pero entra en COPY src/servidor. Puede ser código o un secreto local; la imagen se etiqueta y se guarda fuera como si solo contuviera el commit. También puede cambiar la carpeta entre la comprobación inicial y las construcciones sucesivas.
Confirmado con: `python3 qa/qa10c-commit.py` → `GIT_LIMPIO=True ARCHIVO_FUERA_DEL_COMMIT=True DENTRO_DE_COPY_SRC_SERVIDOR=True`. La sonda usa un repositorio temporal y contenido ficticio; no construye imágenes. La inclusión en la imagen se deduce del COPY y de que .dockerignore no excluye ese .ts.
Corrección sugerida: construir todas las imágenes, incluidas herramientas, desde una instantánea exportada del commit (git archive o checkout aislado sin ignorados), manteniendo el .env fuera.
11. Sin hallazgo independiente en las listas normales de corre: preparar pide db/web/proxy/respaldo; cerrada y antes de abrir piden db/web/proxy porque respaldo está detenido; terminar añade respaldo si arrancó y deja constancia si falló. Migración se ejecuta con la imagen fija y se espera su salida; el problema son los hijos supervivientes, no exigir un migrador permanente. detener usa stop sobre web/respaldo; con el candado roto o con comandos por compose.sh no basta para impedir nuevos arranques (3 y 7).
12. Veredicto: no publicaría todavía en un servidor real. Orden de corrección: (1) exclusión del candado y propagación de errores; (2) impedir procesos migradores/restauradores supervivientes y seleccionar el conjunto después del candado; (3) construir exclusivamente el commit y autenticar las imágenes remotas; (4) terminar los reintentos de apertura/primera instalación y proteger compose.sh; (5) quitar la llave privada temporal y completar la verificación remota al repetir guardar. Ejecutar después los casos exactos pendientes, además del ensayo existente; que este haya pasado no cubre las ventanas descritas.
12. Validación de esta parte: sh -n sobre los siete guiones, seis sondas propias breves (shell/Git/Compose/secretos/fuera), una prueba selectiva de fuera aprobada. No se ejecutaron batería, recorridos ni ensayos; no se cambió el proyecto original ni docker-compose.yml.

Archivos creados fuera del proyecto: /tmp/feruga-codex-informe-10c.md y, en /tmp/feruga-codex-qa10/qa/, qa10c-candado.py, qa10c-guiones.py, qa10c-compose.py, qa10c-fuera.test.ts, qa10c-secretos.py, qa10c-commit.py; carpetas experimentales borradas y ningún contenedor dejado corriendo (docker ps filtrado por oneoff=True y por servicio pruebas, ambos sin salida).
