# Encargo 43 — revisión del modo detrás de otro proxy

Revisión realizada el 7–8 de noviembre de 2026. Revisión limitada a `/tmp/feruga-codex-qa14/`; sondas y resultados en `qa/`. No se ejecutaron los ensayos reservados ni se modificó el repositorio original. Los experimentos Docker propios usaron el prefijo `codex43-`.

## Hallazgos

Siete hallazgos, todos de gravedad media. No se identificó un ataque remoto alto en la configuración estándar sin modificar.

## Registro de revisión

- Leídos los Caddyfiles, la configuración compartida del sitio, Dockerfile del proxy, Compose de operación y detrás, `comprobar.ts`, `pasos.sh`, `levantar.sh`, `volver.sh` y la credencial del comprobador.
- La copia fija Next.js 16.4.5; se contrastó su implementación instalada, no una versión supuesta.

### R43-01 — Media — Una segunda clave no externa puede unir otro servicio a la red de entrada

- **Lugar:** `operacion/comprobar.ts:84-95` (`find` toma solo la primera declaración por nombre; el recorrido de servicios solo mira `external:true`).
- **Reproducción:** `sh qa/node.sh qa/r43-red.ts` (salida `qa/r43-red.txt`). Con `entrada:{external:true,name:"codex43-entrada"}` y `fondo:{name:"codex43-entrada"}`, proxy en `entrada` y db en `fondo`, devuelve `[]`, incluso con `local:true`. Invirtiendo el orden de las declaraciones lo rechaza. Las dos claves externas sí se rechazan correctamente.
- **Efecto:** la validación depende del orden de las claves y no de la identidad real de la red. Permite acreditar como aislado un servicio conectado al mismo nombre Docker que el proxy ajeno. La reproducción con Docker real y sus condiciones está documentada debajo.
- **Cambio propuesto:** resolver *todas* las claves a su nombre Docker y agrupar por identidad; rechazar cualquier declaración no externa de la entrada y cualquier servicio distinto de proxy conectado a ese nombre, independientemente de `external`. Prueba de regresión con ambas ordenaciones.

Actualización de R43-01: `sh qa/r43-colision.sh` (`qa/r43-colision.txt`) lo reproduce con Docker real y Compose resuelto: `Compose resuelto real [] local: []`, ambos servicios arrancaron y el contenedor `codex43-otro` recibió `HTTP/1.1 404 Not Found` de `db:5432` (servidor HTTP de sonda, sin PostgreSQL). La red se creó aparte, interna, con etiqueta `com.docker.compose.network=fondo` y proyecto `codex43-colision`, para que Compose la reutilizara. Una red creada sin esa etiqueta puede ser rechazada por Compose: el problema no ocurre en todas las colisiones, pero sí existe una configuración ejecutable que pasa. Recursos eliminados al terminar.

### R43-02 — Media — Los nombres de red con espacios se inspeccionan como varias redes distintas

- **Lugar:** `operacion/pasos.sh:215` (`for pasos_red in $pasos_redes`) y falta de validación de `entrada` en `operacion/comprobar.ts:82`.
- **Reproducción:** `sh qa/r43-espacios.sh`; salida `qa/r43-espacios-resultado.txt`. Docker permite crear una red llamada literalmente `codex43-a codex43-b`. La sonda crea esa red **no interna**, y las redes `codex43-a` y `codex43-b` internas. La función real `exigir_redes_de_fuera` devuelve 0 mientras la inspección de la red real dice `Internal=false`. Solo se simula la impresión de la lista por el contenedor de comprobación; las tres redes y las inspecciones son reales. Se eliminan al salir.
- **Efecto:** si RED_DE_ENTRADA contiene espacios, se valida otra identidad; también puede rechazarse una red interna legítima con espacios porque se busca por fragmentos. Un valor solo de espacios puede producir cero iteraciones. El `.env` estándar no lo genera, pero los valores editados no se rechazan explícitamente.
- **Cambio propuesto:** validar un nombre único sin blancos para RED_DE_ENTRADA/`--entrada` y/o transportar la lista como JSON, nunca dividirla por espacios. Si se admiten espacios, iterar por líneas sin expansión de comodines; rechazar saltos de línea. Comprobar precedencia y valores vacíos explícitamente en pruebas.

### R43-03 — Media — Reanudar omite la comprobación previa de la red externa

- **Lugar:** `operacion/publicar.sh:413` (`recuperar`), `:506-539` (instalación pendiente); `operacion/volver.sh:143-166` (restauración/levantado retomados). Las comprobaciones solo están en publicar nuevo `:330`, instalar nuevo `:572`, levantar `operacion/levantar.sh:64`, y la primera rama de volver `operacion/volver.sh:128`.
- **Reproducción:** `python3 qa/r43-reanudar.py` → `qa/r43-reanudar.txt`. Extrae las funciones actuales y sustituye únicamente sus dependencias por dobles, sin Docker ni BD. `exigir_redes_de_fuera` fallaría si fuera llamada. Las cuatro rutas (`recuperar-anterior`, `recuperar-candidato`, `instalar-retomada`, `volver-retomada`) llegan a `ARRANCAR … proxy` sin ningún `CHECK`. La primera además cierra y detiene web/respaldo antes de ese punto.
- **Efecto:** una red eliminada/recreada durante la interrupción no se vuelve a acreditar. Recuperar hacia la anterior puede cortar una aplicación todavía atendiendo y descubrir tarde que el proxy no puede levantar; una red recreada sin `--internal` pasa sin objeción en estas rutas. La comprobación de la invocación anterior no acredita el estado actual de Docker.
- **Cambio propuesto:** comprobar las redes de la configuración efectivamente elegida en cada reanudación antes de cerrar/detener/restaurar/migrar. En volver, sacar la comprobación de la rama inicial para que cubra todas las ramas. Probar rutas de reentrada, no solo la posición textual de una llamada (`pruebas/36-guiones.test.ts:860-872`).

### R43-04 — Media — La salud pública admite una respuesta antigua; el latido tampoco acredita la instalación

- **Lugar:** `operacion/comprobar.ts:218-242`, `operacion/respaldar.ts:591`, `docker-compose.operacion.yml:30-84`; `src/app/api/salud/route.ts:28-30`.
- **Reproducción:** generar el certificado de sonda con `openssl req -x509 -newkey rsa:2048 -nodes -keyout qa/r43-tls.key -out qa/r43-tls.crt -days 3 -config qa/r43-tls.cnf`, después `sh qa/node.sh qa/r43-salud.ts` (`qa/r43-salud.txt`). Un origen HTTP responde una vez y se apaga. Un intermediario HTTPS con certificado validado para `patio.test` devuelve la copia con `Age: 86400`. `estadoPorHttps` la acepta; la CLI con `--abierta --version=pub43 --base=marca43` termina 0: `Comprobación de https: bien.`. Consultas al origen: **1**. Otra respuesta mínima `{bien:true,abierta:true}` también produce `LATIDO BIEN`, sin versión ni base.
- **Matiz importante al contexto del encargo:** el latido **no envía** `x-comprobador`: su llamada omite `clave`, y respaldo no recibe SESION_CLAVE. La comprobación de publicación sí se acredita. Confirmado también en Compose resuelto por `python3 qa/r43-compose.py` (`qa/r43-compose.txt`). La credencial estática autentica al solicitante; no demuestra frescura de la respuesta.
- **Efecto:** un proxy/CDN mal configurado que conserve la salud o apunte a otra instancia puede producir falsos positivos. DNS que falle, 502, HTML 200, JSON de otra forma y certificado de otro dominio **sí fallan**, ver misma sonda. Las verificaciones de publicación con versión/base sí detectan otra instalación ordinaria; no detectan una copia anterior con esos mismos valores. No se encontró caché en el Caddy estándar ni se afirma que el bloque recomendado la active: el caso exige una capa ajena que la añada o ignore `no-store`.
- **Cambio propuesto:** declarar en la guía que `/api/salud` no debe almacenarse ni sustituirse; añadir desafío aleatorio por petición que la salud devuelva y el comprobador valide (además de las cabeceras anticaché). Si se quiere acreditar también el latido, pasarle una credencial derivada, exigir identidad esperada y no solo la forma pública. No hace falta darle la clave de sesión completa.

### R43-05 — Media — El ensayo de publicación puede matar una publicación real del mismo servidor

- **Lugar:** `operacion/ensayo-publicacion.sh:442` (`pkill -9 -f "sh operacion/publicar.sh"`); recomendación de ejecutarlo «en el servidor» en `docs/operacion.md:227-232`.
- **Reproducción segura:** `sh qa/node.sh qa/r43-pkill.ts` (`qa/r43-pkill.txt`). Crea un proceso inofensivo `sh operacion/publicar.sh` en **otra carpeta** dentro de `qa/`; `pgrep -f` con el mismo selector devuelve `incluye al proceso de otra instalación: true`. No se ejecutó el `pkill` global: solo se terminó el grupo del proceso propio. La tentativa en macOS no pudo listar procesos por el sandbox; la reproducción efectiva fue dentro del contenedor de pruebas.
- **Efecto:** los nombres exclusivos de redes, proyectos y volúmenes no aíslan esta señal del sistema anfitrión. Si se ejecuta el ensayo en el servidor al mismo tiempo que una publicación real accesible al mismo usuario, el ensayo puede matarla y dejarla pendiente, incluso con el negocio cerrado. También puede interferir con el otro ensayo. Es código previo, pero contradice la nueva garantía de que el ensayo se puede correr en el servidor sin tocar lo real.
- **Cambio propuesto:** conservar el PID/grupo exacto del proceso de publicación de este ensayo y terminar solo ese proceso/grupo; verificar su identidad/carpeta antes de la señal. Hasta corregirlo, no recomendar ese ensayo concurrente con operación en el servidor. No hace falta interrumpir el proxy de la otra aplicación para preparar el modo detrás.

### R43-06 — Media — La guía de recuperación conserva el modo detrás al trasladarse a un servidor propio

- **Lugar:** `docs/operacion.md:238-240` remite a 2.1 y 7 para pasar a servidor propio; `docs/operacion.md:596-600` manda preparar solo 2.1 y copiar intacto el `.env` del paquete.
- **Reproducción:** `python3 qa/r43-restaurar-env.py` → `qa/r43-restaurar-env.txt`. Genera un entorno de prueba con `entorno.sh --detras-de-otro-proxy` y resuelve Compose como lo haría al copiar ese archivo: `proxy ports []`, command a `Caddyfile.detras`, red externa `feruga-entrada`. No inicia ni inspecciona ningún recurso real de feruga.
- **Efecto:** un servidor nuevo independiente preparado con 2.1 no tiene el otro proxy ni la red, pero el `.env` recuperado los sigue exigiendo. Instalar se detiene al comprobar la red; crear únicamente la red tampoco resuelve que nadie termine TLS ni publique 443. La salida que recomienda 2.1 bis queda incompleta.
- **Cambio propuesto:** bifurcar la recuperación según destino. En servidor propio, preservar todas las claves del paquete y cambiar solo `COMPOSE_FILE=docker-compose.yml:docker-compose.operacion.yml`, quitar RED_DE_ENTRADA y revisar dominio/ORIGEN. Si se recupera detrás de otro, repetir los pasos de red, dominio y proxy de 2.1 bis, sin correr servidor.sh sobre una máquina compartida. No regenerar todo el `.env` ni perder sus claves.

### R43-07 — Media — `network_mode: bridge` deja salir del aislamiento del proyecto

- **Lugar:** `operacion/comprobar.ts:116`, excepción explícita para `bridge`; prueba que la consagra en `pruebas/24-comprobar.test.ts:112`.
- **Reproducción de la aceptación:** `python3 qa/r43-compose.py` seguido de `sh qa/node.sh qa/r43-casos-finales.ts` (`qa/r43-casos-finales.txt`). Sobre el Compose real resuelto se quitan las redes de db y se pone `network_mode: bridge`: `DB bridge []`. `redesQueDebenExistir` tampoco inspecciona ese puente, porque no es una declaración `external`.
- **Efecto condicionado:** `bridge` es el puente global del daemon, no el puente privado de este proyecto. Si el otro proxy u otro contenedor ajeno también está en él, alcanza los puertos del servicio por IP, sin `ports` y sin estar en `entrada`. Es una conclusión del código y de la [semántica documentada de Docker](https://docs.docker.com/engine/network/drivers/bridge/), que permite comunicación por IP entre sus miembros por omisión. No se conectaron sondas al puente global, respetando la restricción de usar redes propias `codex43-*`; la conectividad de este caso específico no se ejecutó.
- **Cambio propuesto:** rechazar también `network_mode: bridge` en operación; exigir las redes propias de Compose y la única externa autorizada. Separar el caso inocuo `network_mode: none`, que hoy se rechaza conservadoramente aunque no exponga nada.

## Lo revisado y encontrado bien

Se leyeron completos **todos los archivos enumerados en el encargo**, incluidos ambos ensayos y sus archivos compartidos, los tres archivos de pruebas, `docs/operacion.md` y `docs/seguridad.md`. También se revisaron la salud, credencial del comprobador, validación de origen, configuración de Next, Dockerfile web y las funciones del latido.

### Compose y comprobación de red

- La combinación entregada, sin cambios, resuelve **sin puertos publicados**; proxy queda en `frente` y `entrada`, con `feruga-proxy` como alias; ningún otro servicio queda en entrada. `comprobacion` y `respaldo` reciben el dominio en SITIO_POR. Resultado: `python3 qa/r43-compose.py` y `sh qa/node.sh qa/r43-casos-finales.ts`.
- Dos claves **externas** con igual nombre Docker se reconocen como la misma red y se rechaza db/web en ella. La combinación externa/no externa es R43-01.
- `--local` no debilita las reglas de entrada: un puerto del proxy en 127.0.0.1 sigue rechazándose. Host, namespace de otro servicio/contenedor, privilegios y socket Docker se rechazan. No se encontró un `ports` normalizado por Compose que se aceptara en este modo.
- Perfiles: el resolver de operación incluye `consola`; ese conjunto pasa. Al activar todos los perfiles, `db_limpia` publicado se rechaza. Los servicios de perfiles inactivos no aparecen en la configuración guardada que se levanta; no se vio un camino por el cual aparecieran luego sin haber sido revisados. No conviene exigir indiscriminadamente todos los perfiles del Compose de desarrollo.
- `--entrada=valor` tiene prioridad sobre RED_DE_ENTRADA; incluso `--entrada=` anula el valor del entorno, pero no permite la red externa inadvertidamente: esta queda rechazada. RED_DE_ENTRADA vacía hace fallar la interpolación `${…:?}` de la capa detrás. Los espacios sí atraviesan Compose y `faltasDeRed`; son R43-02. Sin capa detrás, vacío equivale al modo habitual, como está probado.
- Los alias no cambian a qué red se conecta un contenedor. Un alias personalizado pasa, lo cual es legítimo si el otro proxy se configura igual. Quitar `feruga-proxy` sin cambiar el otro Caddy rompería el encaminamiento y se descubriría en HTTPS; la comprobación de red por sí sola no garantiza ese nombre ni el funcionamiento del sitio.
- Falsos rechazos: `network_mode: none` se rechaza aunque no exponga red; es una restricción conservadora. Una declaración **no usada** y no externa con el nombre de entrada también puede provocar rechazo si `find` la ve primero: debe revisarse junto con R43-01, distinguiendo configuración inválida de redes efectivamente usadas. Los nombres legítimos con espacios se manejan incorrectamente en la capa shell (R43-02).

### Caddy y Next.js 16.4.5

- `sh qa/r43-caddy.sh`: imagen oficial de la segunda FROM, por la huella pedida; Caddy **2.11.7**. Con los archivos reales montados, respondió HTTP 200 y HSTS, CSP, nosniff, DENY y no-store. Los puertos 443 y 2019 no escucharon. El registro dice que solo escucha HTTP y no aplica HTTPS automático; no se generaron certificados. JSON adaptado en `qa/r43-caddy-adapt.json`; respuestas y registro en `qa/r43-caddy.txt`.
- No importa `global.d` ni `sitios.d` en el modo detrás. Con un DOMINIO válido, el prefijo explícito `http://` evita certificados y redirección automática; no basta una cabecera X-Forwarded para cambiar esa configuración. Se contrastó con la [documentación de HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https).
- Adaptando también el Caddyfile normal, sus rutas/handlers son idénticos a los del modo detrás (`qa/r43-caddy-comparacion.txt`: `True`). Solo cambian escucha y confianza. Esto comprueba la extracción compartida actual, **no** la igualdad contra un commit anterior ausente en esta copia.
- `trusted_proxies static private_ranges` confía en RFC1918, loopback y ULA; no distingue quién es «el otro proxy». La sonda demostró que tanto desde entrada como desde frente se conservan X-Forwarded-Host `ajeno.test` y X-Forwarded-Proto `https`. Por tanto web, respaldo y comprobacion también tienen esa capacidad. Es coherente con la [documentación de cabeceras de Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers). Si el Docker de un servidor usa una subred fuera de esos rangos, esa confianza no se aplica: hay que revisar sus rangos reales.
- Next instalado **16.4.5**, comprobado con `sh qa/node.sh qa/r43-next.ts`: `base-server.js:599-604` conserva/completa esos encabezados; `next-server.js:1302-1309` usa X-Forwarded-Proto para `initProtocol` e `initURL`; el hostname del standalone viene de `HOSTNAME=0.0.0.0`, no de X-Forwarded-Host. El manejador de Server Actions consulta X-Forwarded-Host para comparar Origin (`action-handler.js:345-365,434-456`), pero la aplicación no define Server Actions.
- No se encontraron redirecciones, rewrites ni URLs absolutas de aplicación construidas con esas cabeceras. Los usos actuales de `peticion.url` leen consultas; el fallback de origen en `src/servidor/ruta.ts:58` no se usa cuando ORIGEN está definido, como exige operación. `sh qa/node.sh qa/r43-next-runtime.ts` ejecuta el método real de Next: cambia `initURL` de HTTP a HTTPS según la cabecera; con cabeceras falsificadas la ruta real rechaza Origin ajeno (403) y admite el configurado (200). No se demostró bypass de CSRF ni cambio de COOKIE_SEGURA. La confianza amplia merece quedar descrita con precisión, pero no es por sí sola un hallazgo de explotación en esta versión y código.

### Salud pública y guiones

- La comprobación HTTPS usa el dominio como Host y SNI, verifica TLS, no sigue redirecciones, rechaza códigos distintos de 200 y exige JSON con `bien:true` y `abierta` booleano. Los plazos y corte de respuesta siguen activos. DNS inexistente, certificado ajeno, 502, HTML y JSON ajeno se rechazaron en `qa/r43-salud.txt`.
- La publicación exige versión/base y, antes de abrir, mantenimiento más rechazo de escritura; un 502 del otro Caddy no se acepta como salud ni como rechazo por mantenimiento. El hueco de identidad/frescura del latido y la caché está delimitado en R43-04.
- Publicar nuevo, instalar nuevo y levantar llaman a exigir_redes_de_fuera antes de sustituir servicios/cerrar la operación; la primera rama de volver lo hace antes de detener. La función falla cuando la consulta Docker falla, falta la red o no es interna. Las reentradas faltantes son R43-03.
- Las comprobaciones públicas desde un contenedor dependen del DNS que ese contenedor ve y de que pueda volver por la IP pública. Un fallo de resolución/conexión produce fallo, no éxito. No comprueban **todas** las direcciones A/AAAA ni todas las rutas desde internet: una familia sana puede ocultar una familia averiada, y DNS dividido puede llevar a otro destino. La guía ya pide comprobar IPv4/IPv6 desde fuera y la llegada pública desde Docker; debe conservarse esa comprobación externa.

### Ensayo, limpieza y guía

- No se ejecutaron `operacion/ensayo.sh` ni `operacion/ensayo-publicacion.sh`. Para comprobar sus nuevas aserciones, `python3 qa/r43-aislamiento.py` extrae **solo el bloque nuevo** de aislamiento; `sh qa/r43-aislamiento.sh` lo ejecuta sobre cuatro contenedores propios y tres redes `codex43-*`, con web y db simulados (sin PostgreSQL).
- Resultado `qa/r43-aislamiento.txt`: topología aislada **pasa**; conectar el otro proxy al frente **falla**; conectar db a entrada **falla** por membresía adicional. Se verificó además que `nc` por IP detecta el acceso abierto a web. En macOS el primer rechazo terminó con una expansión `nombre…: unbound variable` en el texto de error con comillas angulares, por lo que ese diagnóstico no es limpio, pero no produjo un falso éxito. La imagen probada sí incluye `nc -z` y `nslookup`; la conexión positiva a feruga-proxy se exige antes de las negativas.
- `python3 qa/r43-limpieza.py` ejecuta la función de limpieza extraída con un **Docker completamente falso** (registro en `qa/r43-limpieza.txt`): quita primero el otro proxy, después el proyecto principal y autoridad, después su volumen y entrada. Los nombres son `feruga_ensayo-entrada`, `feruga_ensayo-otro-proxy`, `feruga_ensayo-otro-proxy-datos`; para el otro ensayo, el prefijo es `feruga_publicacion`. No aparece `feruga-entrada` ni un proxy real. El orden permite que autoridad suelte el volumen antes de borrarlo. El riesgo de procesos del anfitrión es independiente y está en R43-05.
- Los pasos 2.1 bis de unir la red en vivo, conservar la red previa/default, usar alias propio, recargar Caddy y conservar ambos cambios en el repositorio ajeno son razonables. Se advierte expresamente que no se ejecute servidor.sh en servidor compartido y que cambiar Docker reinicia ambas aplicaciones. Se distingue la administración necesaria para `caddy reload` y el problema de reemplazar un bind mount de archivo. No vi una orden de esos pasos que necesite detener la otra aplicación en condiciones normales.
- Pendientes de guía además de los hallazgos: actualizar el encabezado y la sección 10 que todavía dicen que no hay servidor contratado; en incidencias de certificados indicar que, detrás, se miran los logs del **otro** proxy; y separar visualmente las alternativas del resumen de órdenes (sección 11) para que no se ejecuten ambas. El paso de recuperación a servidor propio sí requiere la corrección concreta R43-06.

## Verificaciones ejecutadas

| Orden | Resultado | Evidencia |
|---|---|---|
| `sh qa/prueba.sh pruebas/24-comprobar.test.ts` | 11/11 | `qa/r43-pruebas24.txt` |
| `sh qa/prueba.sh pruebas/20-entorno.test.ts` | 16/16 | `qa/r43-pruebas20.txt` |
| `sh qa/prueba.sh pruebas/36-guiones.test.ts` | 27/27 | `qa/r43-pruebas36.txt` |
| `sh qa/tipos.sh` | exit 0 | `qa/r43-tipos.txt` |
| `sh -n` en cada uno de los ocho guiones revisados | exit 0 | Ejecutado individualmente mediante subprocess |
| Sondas propias de redes, Caddy, Next, salud, reanudación, limpieza y recuperación | Resultados detallados arriba | `qa/r43-*` |

Las corridas de pruebas y tipos se hicieron **una a la vez**, sin npm install/ci. No se cambió código de la aplicación: todos los archivos creados por esta revisión están en `qa/` de la copia. Las pruebas de base usaron exclusivamente el helper autorizado y su plantilla Codex.

## Límites y lo que no se ejecutó

- No se probó el servidor contratado, el DNS real, IPv6 real, su Caddy ajeno, sus reglas de caché, su renovación de certificados ni la continuidad real de la otra aplicación. No se accedió a esa infraestructura.
- No se ejecutaron los ensayos completos reservados, publicaciones reales, restauraciones reales, construcción de imágenes ni recorridos de navegador. Las reanudaciones se probaron con funciones reales y dependencias simuladas; las aserciones de aislamiento, con Docker real y servicios de sonda.
- La copia carece de `.git`: `git show HEAD:operacion/Caddyfile` no estuvo disponible. No afirmo haber demostrado igualdad de JSON con el **Caddyfile anterior**. Sí se verificó la igualdad de rutas entre los dos Caddyfiles actuales y el funcionamiento del modo detrás.
- Caddy se probó con la imagen oficial fijada en la segunda FROM (2.11.7), como pidió el encargo; no se recompiló la imagen endurecida. Next se verificó contra los módulos instalados de esta copia y métodos reales, sin levantar la web de producción.
- La variante de puente global de R43-07 se acreditó en el validador y se razonó con documentación primaria; no se usó la red global del anfitrión para probarla.
- Limpieza final: `docker ps -a --filter name=codex43-`, `docker network ls --filter name=codex43-` y `docker volume ls --filter name=codex43-` no devolvieron recursos. No se tocaron contenedores reservados ni se modificó, creó o borró ningún archivo bajo `/Users/maantora/Desktop/feruga`.
