# Revisión de seguridad 40 — completada; historial conservado

Alcance: copia `/tmp/feruga-codex-qa14`, instalación propia `feruga_qa40`, dominio interno `patio.test`, puertos locales 48540/48543. Sin acceso a instalaciones de terceros ni modificaciones al producto.

Preparación: `CONSERVAR=1 sh qa/ensayo-40.sh`. Variante reducida del ensayo: conserva preparación y publicación oficiales, omite recorridos npm y pruebas de recuperación ajenas al alcance. Contenedores con prefijo `codex-seguridad-`. El envoltorio `qa/bin-40/docker` asigna nombres también a tareas efímeras y sustituye únicamente la instalación de dependencias de las construcciones por copia desde una imagen local fija. `package-lock.json` coincide exactamente (SHA-256 b4655754b3939d3d3a02b129297aa1abdb59b45fef425e654515aa06c96f563a). No se ejecuta npm ci/install. Las dependencias de desarrollo también quedan en admin/respaldo: diferencia de empaquetado del ensayo, no del código HTTP.

Evidencias: `/tmp/feruga-codex-qa14/qa/seguridad-40/`. Pendientes: red, TLS, ZAP, pruebas manuales, limpieza.

## Preparación, avance

El primer intento de build encontró una escritura de Buildx fuera de la copia; se corrigió dirigiendo `BUILDX_CONFIG` a `qa/buildx-40`. La reutilización de dependencias usa una etiqueta local cuyo identificador fijo figura en `qa/dependencias-40.txt`. Se corrigió la adaptación del contexto tar sin editar archivos del producto. La publicación se retomó con `sh qa/continuar-40.sh`; su log completo queda en `qa/trabajo-40.tDha4M/publicar.salida` (se conservará copia antes de limpiar).

Herramientas obtenidas y fijadas para ejecución: ZAP 2.16.1 (`zaproxy/zap-stable@sha256:7840969c7c9fead565bf9734b12f49f6886db90b1d35b1f74d79710bbd081dab`); Nmap 7.95 (`instrumentisto/nmap@sha256:3cca6ece8de5a571c956022ec6c2cf343da8c4416fa36e1891e8c33623cfc845`); testssl rama 3.2 (`drwetter/testssl.sh@sha256:64bab3c1fd8eee440f68d5e020dd633c1f2d375fe0ae593bdfec2725110a7e29`; versión ejecutable pendiente). No se infiere ningún hallazgo de seguridad de los fallos del arnés.

Inventario preparado: 84 operaciones HTTP en `rutas.json`, 17 páginas en `paginas.json`. Las comprobaciones todavía no se dan por ejecutadas.

La primera publicación chocó con el puerto local 8543 ocupado. Se cambiaron únicamente los puertos del entorno/configuración de esta instalación a 48540/48543 y se retomó la publicación oficial con `--recuperar`. No se identificó ni se tocó el servicio que ocupaba aquel puerto.

## Parte 1 completada: red

Orden reproducible: `python3 qa/seguridad-40/red-40.py` (la orden exacta y las IP de esta corrida están en `nmap-orden.json`). Nmap 7.95, TCP connect, identificación ligera, los 65.535 puertos TCP, siete IP explícitas; sin barrido de subred. Finalizó en 43,66 segundos, sin agotar el plazo.

| Servicio | IP de esta corrida | TCP abiertos |
|---|---|---|
| proxy | 172.31.0.8 | 80, 443 |
| web | 172.31.0.7 | 3000 |
| PostgreSQL | 172.31.0.5 | 5432 |
| respaldo | 172.31.0.9 | ninguno |
| autoridad ficticia | 172.31.0.4 | ninguno |
| vigía ficticio | 172.31.0.3 | 8080 |
| almacenamiento ficticio | 172.31.0.2 | 9000, 38813 |

**R40-01 — Media, real: falta de aislamiento de PostgreSQL respecto de servicios que no lo necesitan.** Un contenedor arbitrario en `feruga_qa40_default` puede establecer conexión con 5432. No equivale a acceso sin contraseña ni a exposición pública. La red plana permite alcanzar la base desde el segmento del proxy. Se recomienda separar proxy/web de web/base/respaldo, conservando únicamente los accesos necesarios. Evidencias completas: `nmap.nmap`, `nmap.xml`, `nmap.gnmap`, `nmap-consola.txt`, `red.json`. Las denominaciones tentativas `ppp?` para Node y `http-proxy?` para el vigía son identificaciones heurísticas, no vulnerabilidades.

Bien: Caddy no expone el puerto administrativo 2019; respaldo y autoridad no abren TCP. La instalación de ensayo publica también web y base, pero solo en loopback (3240/54440); no se probó acceso desde otra máquina. Los puertos del almacenamiento y el vigía corresponden exclusivamente al arnés ficticio, no a servicios públicos del producto.

## Parte 4, primeras pruebas manuales completadas

`docker exec codex-seguridad-zap-40 python /zap/wrk/manual.py` ejecutó 137 peticiones HTTPS con validación de la CA del ensayo: 59 respuestas 200, 31 respuestas 403, 18 respuestas 409, 14 respuestas 400, 12 respuestas 401 y tres respuestas 404. Evidencia completa de petición y respuesta: `manual.json`; salida legible: `manual-consola.txt`.

Bien: cuatro sesiones de rol verificadas; intentos de escalada rechazados; consulta no puede crear cuentas; Origin ausente, nulo, ajeno y con sufijos engañosos se rechaza; alterar X-Forwarded-Host no permite saltar Origin; cookie alterada inválida; cinco PIN erróneos bloquean incluso el correcto; inexistente y clave equivocada producen el mismo mensaje; código usado/caducado rechazado; carrera de canje: exactamente un 200 y un 409; salida invalida la cookie anterior; entradas malformadas y rutas inexistentes no revelaron SQL, trazas ni secretos.

Vencimiento comprobado en ejecución: se envejecieron únicamente los timestamps de dos sesiones de prueba en la base (31 minutos de inactividad y 13 horas de duración), y después se hicieron peticiones HTTPS. Ambas devolvieron 401 SESION. Dar de baja el equipo devolvió 401 EQUIPO con su cookie anterior. No se esperaron 30 minutos/12 horas reales. Órdenes SQL y resultados: `expiracion-preparacion.txt`; comprobación HTTP: `expiracion.py`, `expiracion.json`. El primer bloqueo registrado dura cinco minutos; los siguientes escalones de 15/60 minutos todavía no se prueban en esta pasada.

Los nombres con comillas y expresiones de SQL/plantillas se conservaron como texto, sin error interno ni demora de SQL. Aceptar etiquetas HTML en un nombre no demuestra XSS: falta comprobar su representación en navegador. El escaneo pasivo de ZAP terminó; los activos se reanudan con JVM de 512 MiB después de un fallo de memoria del proceso de sondeo. Este fallo pertenece al arnés, no al sitio.

## Parte 2 completada: TLS/HTTPS

Ejecución: `sh qa/seguridad-40/tls-40.sh`. testssl.sh **3.2.5**, imagen fijada por digest, dirección explícita 172.31.0.8, SNI patio.test, `--nodns none`, sin `--phone-out`, CA privada del ensayo añadida con `--add-ca`. Salidas completas: `testssl-consola.txt`, `testssl.log`, `testssl.json`, `testssl.html`. Finalizó en 178 segundos. Su calificación orientativa fue A+ (96); no certifica la seguridad de la aplicación.

Bien: SSLv2/SSLv3/TLS1.0/TLS1.1 deshabilitados; TLS1.2 y TLS1.3 disponibles; cifrados modernos con secreto hacia adelante; HSTS `max-age=31536000`; certificado validado con la CA del ensayo; no se encontró Heartbleed/CCS ni los demás ataques clásicos que la salida marca OK.

Avisos a distinguir:

- **Informativa, propia del ensayo:** ausencia de CRL/OCSP y certificado intermedio que vence el 12 de noviembre (menos de 20 días). testssl los rotula HIGH. Son características reales de la CA local efímera de Caddy; no prueban fallos del certificado público de producción, que no fue examinado. No se reportan como dos vulnerabilidades altas del producto.
- **Informativa, potencial no confirmada:** BREACH, rotulado MEDIUM por detectar compresión en `/`. El programa solo demuestra compresión; no demuestra extracción de un secreto. Se revisarán Origin/cookies y la presencia de secretos reflejados antes del cierre del informe.
- **Limitación de la herramienta:** `engine_problem` indica ausencia de soporte GOST en su OpenSSL, no un defecto del servidor.

Continuación manual: tras cinco minutos reales el PIN correcto vuelve a funcionar (200). Con precios publicados, mostrador y patio crean cuentas (200); consulta recibe 403 sobre la misma acción. Reenviar el mismo UUID devuelve la misma cuenta, no crea otra; faltar el UUID devuelve 400. `X-Envio` no es el mecanismo general del producto: las operaciones que lo requieren transportan su identificador en el JSON `id` o en la ruta. Evidencias: `negocio.py`, `negocio.json`, `negocio-consola.txt`; preparación y cabeceras: `suplemento.json`.

## Continuación del 5 de noviembre: reconstrucción

Se conserva la pasada anterior en `qa/seguridad-40/anterior-40.tar.gz`. Se retiran exclusivamente contenedores, redes y volúmenes etiquetados `feruga_qa40` y el ZAP propio. Se vuelve a ejecutar el ensayo desde la copia actual, sin cambiar el código del producto.

## Revalidación R40-01: separación de redes

La base pertenece únicamente a `feruga_qa40_fondo`; el proxy a `feruga_qa40_frente` y a `feruga_qa40_default` (servicios externos ficticios). Evidencias y órdenes completas: `red-continuacion.json`, `red-continuacion-topologia.json`.

- frente → `db`: Failed to resolve "db"..
- frente → `codex-seguridad-db-40`: Failed to resolve "codex-seguridad-db-40"..
- frente → `192.168.80.2`: 5432/tcp open  postgresql.
- proxy-red → `db`: Failed to resolve "db"..
- proxy-red → `codex-seguridad-db-40`: Failed to resolve "codex-seguridad-db-40"..
- proxy-red → `192.168.80.2`: 5432/tcp open  postgresql.
- proxy-espacio → `db`: Failed to resolve "db"..
- proxy-espacio → `codex-seguridad-db-40`: Failed to resolve "codex-seguridad-db-40"..
- proxy-espacio → `192.168.80.2`: 5432/tcp open  postgresql.
- fondo → `db`: 5432/tcp open  postgresql.
- fondo → `codex-seguridad-db-40`: 5432/tcp open  postgresql.
- fondo → `192.168.80.2`: 5432/tcp open  postgresql.

**R40-01 — Media, real, corrección parcial: permanece abierto en esta instalación.** Los nombres `db` y `codex-seguridad-db-40` ya no resuelven desde frente/default/proxy, pero la IP obtenida exclusivamente del contenedor propio (`192.168.80.2` en esta corrida) acepta TCP/5432 desde los tres orígenes. Desde fondo resuelve y contesta correctamente. No confundir el aislamiento DNS con el bloqueo de transporte. La configuración sigue heredando `127.0.0.1:54440:5432` de `docker-compose.yml`; se investigará con un control limitado al arnés. No se ha demostrado lectura sin contraseña ni exposición desde otra máquina.

### ZAP activo repetido: mostrador

Plazo total 20 minutos y por regla 5 minutos (antes 6 y 1). Duración observada: 105 s. Resultado: `{"scans": [{"reqCount": "6123", "alertCount": "0", "progress": "100", "newAlertCount": "0", "id": "0", "state": "FINISHED"}]}`.

Sesión antes/después: [{"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"2\",\"nombre\":\"QA40 mostrador\",\"rol\":\"mostrador\",\"puedeAutorizar\":false}}", "seconds": 0.01112}, {"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"2\",\"nombre\":\"QA40 mostrador\",\"rol\":\"mostrador\",\"puedeAutorizar\":false}}", "seconds": 0.017856}, {"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"2\",\"nombre\":\"QA40 mostrador\",\"rol\":\"mostrador\",\"puedeAutorizar\":false}}", "seconds": 0.033505}]

| Regla | Estado | Peticiones | Alertas activas |
|---|---|---|---|
| Path Traversal (6) | Complete | 740 | 0 |
| Remote File Inclusion (7) | Complete | 370 | 0 |
| Server Side Include (40009) | Complete | 296 | 0 |
| Cross Site Scripting (Reflected) (40012) | Complete | 370 | 0 |
| Cross Site Scripting (Persistent) - Prime (40016) | Complete | 74 | 0 |
| Cross Site Scripting (Persistent) - Spider (40017) | Complete | 147 | 0 |
| Cross Site Scripting (Persistent) (40014) | Complete | 0 | 0 |
| SQL Injection (40018) | Complete | 606 | 0 |
| SQL Injection - MySQL (Time Based) (40019) | Complete | 444 | 0 |
| SQL Injection - Hypersonic SQL (Time Based) (40020) | Complete | 444 | 0 |
| SQL Injection - Oracle (Time Based) (40021) | Complete | 222 | 0 |
| SQL Injection - PostgreSQL (Time Based) (40022) | Complete | 222 | 0 |
| Server Side Code Injection (90019) | Complete | 592 | 0 |
| Remote OS Command Injection (90020) | Complete | 666 | 0 |
| XPath Injection (90021) | Complete | 222 | 0 |
| XML External Entity Attack (90023) | Complete | 0 | 0 |
| Generic Padding Oracle (90024) | Complete | 2 | 0 |
| CRLF Injection (40003) | Complete | 518 | 0 |
| Parameter Tampering (40008) | Complete | 98 | 0 |
| .htaccess Information Leak (40032) | Complete | 35 | 0 |

Alertas totales por tipo (incluyen pasivas): {"Medium: CSP: Failure to Define Directive with No Fallback": 29, "Medium: CSP: Wildcard Directive": 29, "Medium: CSP: script-src unsafe-inline": 29, "Medium: CSP: style-src unsafe-inline": 29, "Informational: Modern Web Application": 29, "Low: X-Content-Type-Options Header Missing": 60, "Informational: Re-examine Cache-control Directives": 13, "Informational: Information Disclosure - Suspicious Comments": 5}. Evidencia: `zap-mostrador-*`.

### ZAP activo repetido: patio

Plazo total 20 minutos y por regla 5 minutos (antes 6 y 1). Duración observada: 95 s. Resultado: `{"scans": [{"reqCount": "6129", "alertCount": "0", "progress": "100", "newAlertCount": "0", "id": "0", "state": "FINISHED"}]}`.

Sesión antes/después: [{"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"3\",\"nombre\":\"QA40 patio\",\"rol\":\"patio\",\"puedeAutorizar\":false}}", "seconds": 0.011495}, {"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"3\",\"nombre\":\"QA40 patio\",\"rol\":\"patio\",\"puedeAutorizar\":false}}", "seconds": 0.011374}, {"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"3\",\"nombre\":\"QA40 patio\",\"rol\":\"patio\",\"puedeAutorizar\":false}}", "seconds": 0.030706}]

| Regla | Estado | Peticiones | Alertas activas |
|---|---|---|---|
| Path Traversal (6) | Complete | 740 | 0 |
| Remote File Inclusion (7) | Complete | 370 | 0 |
| Server Side Include (40009) | Complete | 296 | 0 |
| Cross Site Scripting (Reflected) (40012) | Complete | 370 | 0 |
| Cross Site Scripting (Persistent) - Prime (40016) | Complete | 74 | 0 |
| Cross Site Scripting (Persistent) - Spider (40017) | Complete | 147 | 0 |
| Cross Site Scripting (Persistent) (40014) | Complete | 0 | 0 |
| SQL Injection (40018) | Complete | 614 | 0 |
| SQL Injection - MySQL (Time Based) (40019) | Complete | 444 | 0 |
| SQL Injection - Hypersonic SQL (Time Based) (40020) | Complete | 444 | 0 |
| SQL Injection - Oracle (Time Based) (40021) | Complete | 222 | 0 |
| SQL Injection - PostgreSQL (Time Based) (40022) | Complete | 222 | 0 |
| Server Side Code Injection (90019) | Complete | 592 | 0 |
| Remote OS Command Injection (90020) | Complete | 666 | 0 |
| XPath Injection (90021) | Complete | 222 | 0 |
| XML External Entity Attack (90023) | Complete | 0 | 0 |
| Generic Padding Oracle (90024) | Complete | 0 | 0 |
| CRLF Injection (40003) | Complete | 518 | 0 |
| Parameter Tampering (40008) | Complete | 98 | 0 |
| .htaccess Information Leak (40032) | Complete | 35 | 0 |

Alertas totales por tipo (incluyen pasivas): {"Medium: CSP: Failure to Define Directive with No Fallback": 29, "Medium: CSP: Wildcard Directive": 29, "Medium: CSP: script-src unsafe-inline": 29, "Medium: CSP: style-src unsafe-inline": 29, "Informational: Modern Web Application": 29, "Low: X-Content-Type-Options Header Missing": 56, "Informational: Re-examine Cache-control Directives": 9, "Informational: Information Disclosure - Suspicious Comments": 5}. Evidencia: `zap-patio-*`.

### ZAP activo repetido: consulta

Plazo total 20 minutos y por regla 5 minutos (antes 6 y 1). Duración observada: 90 s. Resultado: `{"scans": [{"reqCount": "6109", "alertCount": "0", "progress": "100", "newAlertCount": "0", "id": "0", "state": "FINISHED"}]}`.

Sesión antes/después: [{"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"4\",\"nombre\":\"QA40 consulta\",\"rol\":\"consulta\",\"puedeAutorizar\":false}}", "seconds": 0.008421}, {"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"4\",\"nombre\":\"QA40 consulta\",\"rol\":\"consulta\",\"puedeAutorizar\":false}}", "seconds": 0.011682}, {"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"4\",\"nombre\":\"QA40 consulta\",\"rol\":\"consulta\",\"puedeAutorizar\":false}}", "seconds": 0.049879}]

| Regla | Estado | Peticiones | Alertas activas |
|---|---|---|---|
| Path Traversal (6) | Complete | 740 | 0 |
| Remote File Inclusion (7) | Complete | 370 | 0 |
| Server Side Include (40009) | Complete | 296 | 0 |
| Cross Site Scripting (Reflected) (40012) | Complete | 370 | 0 |
| Cross Site Scripting (Persistent) - Prime (40016) | Complete | 74 | 0 |
| Cross Site Scripting (Persistent) - Spider (40017) | Complete | 147 | 0 |
| Cross Site Scripting (Persistent) (40014) | Complete | 0 | 0 |
| SQL Injection (40018) | Complete | 612 | 0 |
| SQL Injection - MySQL (Time Based) (40019) | Complete | 444 | 0 |
| SQL Injection - Hypersonic SQL (Time Based) (40020) | Complete | 444 | 0 |
| SQL Injection - Oracle (Time Based) (40021) | Complete | 222 | 0 |
| SQL Injection - PostgreSQL (Time Based) (40022) | Complete | 222 | 0 |
| Server Side Code Injection (90019) | Complete | 592 | 0 |
| Remote OS Command Injection (90020) | Complete | 666 | 0 |
| XPath Injection (90021) | Complete | 222 | 0 |
| XML External Entity Attack (90023) | Complete | 0 | 0 |
| Generic Padding Oracle (90024) | Complete | 0 | 0 |
| CRLF Injection (40003) | Complete | 518 | 0 |
| Parameter Tampering (40008) | Complete | 80 | 0 |
| .htaccess Information Leak (40032) | Complete | 35 | 0 |

Alertas totales por tipo (incluyen pasivas): {"Medium: CSP: Failure to Define Directive with No Fallback": 29, "Medium: CSP: Wildcard Directive": 29, "Medium: CSP: script-src unsafe-inline": 29, "Medium: CSP: style-src unsafe-inline": 29, "Informational: Modern Web Application": 29, "Low: X-Content-Type-Options Header Missing": 64, "Informational: Re-examine Cache-control Directives": 20, "Informational: Information Disclosure - Suspicious Comments": 5}. Evidencia: `zap-consulta-*`.

## BREACH: comprobación del cuerpo y la reflexión

Sonda: `docker exec codex-seguridad-zap-40 python /zap/wrk/breach-continuacion.py`. Se pide `Accept-Encoding: gzip`, se guardan los bytes recibidos antes de descomprimir, cabeceras y cuerpo descomprimido en `breach-continuacion.json`. Se comparan sesión válida, petición anónima, parámetro de búsqueda controlado, nombre persistido y respuestas que emiten credenciales. No se cuenta la cookie de petición como secreto en el cuerpo.

Resultado inicial confirmado: `/`, `/mostrador` y `/panel/ajustes` reflejan el parámetro controlado dentro del HTML comprimido. El cuerpo de `/` fue idéntico autenticado y anónimo para el mismo parámetro; no contiene la cookie, un PIN, código de equipo ni token CSRF. Las respuestas JSON de negocio pueden comprimirse y contienen información privada de operación. Las que emiten credenciales se verificaron por separado con un responsable facultado y su PIN correcto: código de equipo, 23 bytes sin comprimir; alta de persona, 98 bytes sin comprimir (sí reúne nombre controlado y nueva clave en el mismo cuerpo); cambio de clave, 16 bytes sin comprimir. `Cache-Control: no-store` protege el almacenamiento, no sería por sí solo una defensa contra BREACH.

La petición anónima a clientes recibe 401. Una lectura manual con cookie válida y Origin ajeno puede contestar 200; no se interpreta como vulnerabilidad CORS: falta comprobar permiso de lectura desde navegador, y la cookie real tiene `SameSite=Strict`. La escritura con Origin ajeno devuelve 403. No se ha demostrado un oráculo de compresión que permita recuperar un secreto; el aviso automático de testssl sigue pendiente de clasificación final tras terminar las comprobaciones.

### ZAP activo repetido: responsable

Plazo total 20 minutos y por regla 5 minutos (antes 6 y 1). Duración observada: 167 s. Resultado: `{"scans": [{"reqCount": "6136", "alertCount": "5", "progress": "100", "newAlertCount": "4", "id": "0", "state": "FINISHED"}]}`.

Sesión antes/después: [{"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"1\",\"nombre\":\"QA40 responsable\",\"rol\":\"responsable\",\"puedeAutorizar\":false}}", "seconds": 0.022208}, {"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"1\",\"nombre\":\"QA40 responsable\",\"rol\":\"responsable\",\"puedeAutorizar\":false}}", "seconds": 0.012677}, {"method": "GET", "path": "/api/sesion", "status": 200, "body": "{\"persona\":{\"id\":\"1\",\"nombre\":\"QA40 responsable\",\"rol\":\"responsable\",\"puedeAutorizar\":false}}", "seconds": 0.061515}]

| Regla | Estado | Peticiones | Alertas activas |
|---|---|---|---|
| Path Traversal (6) | Complete | 729 | 1 |
| Remote File Inclusion (7) | Complete | 370 | 0 |
| Server Side Include (40009) | Complete | 296 | 0 |
| Cross Site Scripting (Reflected) (40012) | Complete | 358 | 0 |
| Cross Site Scripting (Persistent) - Prime (40016) | Complete | 71 | 0 |
| Cross Site Scripting (Persistent) - Spider (40017) | Complete | 147 | 0 |
| Cross Site Scripting (Persistent) (40014) | Complete | 34 | 4 |
| SQL Injection (40018) | Complete | 594 | 0 |
| SQL Injection - MySQL (Time Based) (40019) | Complete | 444 | 0 |
| SQL Injection - Hypersonic SQL (Time Based) (40020) | Complete | 444 | 0 |
| SQL Injection - Oracle (Time Based) (40021) | Complete | 222 | 0 |
| SQL Injection - PostgreSQL (Time Based) (40022) | Complete | 222 | 0 |
| Server Side Code Injection (90019) | Complete | 592 | 0 |
| Remote OS Command Injection (90020) | Complete | 666 | 0 |
| XPath Injection (90021) | Complete | 222 | 0 |
| XML External Entity Attack (90023) | Complete | 0 | 0 |
| Generic Padding Oracle (90024) | Complete | 1 | 0 |
| CRLF Injection (40003) | Complete | 518 | 0 |
| Parameter Tampering (40008) | Complete | 116 | 0 |
| .htaccess Information Leak (40032) | Complete | 35 | 0 |

Alertas totales por tipo (incluyen pasivas): {"Medium: CSP: Failure to Define Directive with No Fallback": 29, "Medium: CSP: Wildcard Directive": 29, "Medium: CSP: script-src unsafe-inline": 29, "Medium: CSP: style-src unsafe-inline": 29, "Informational: Modern Web Application": 29, "Low: X-Content-Type-Options Header Missing": 78, "Informational: Re-examine Cache-control Directives": 26, "High: Path Traversal": 1, "Informational: Information Disclosure - Suspicious Comments": 5, "Low: Cross Site Scripting Weakness (Persistent in JSON Response)": 3}. Evidencia: `zap-responsable-*`.

## Navegador: XSS almacenado comprobado

**Prueba completada, sin ejecución:** Chromium 153.0.8010.12 mediante Playwright, sitio real de prueba por HTTPS, datos persistidos y sesión válida. Tres nombres de cliente y tres de material: `<img src=x onerror=alert(40)> V40`, `<script>alert(40)</script> V40` y `<b>QA40 HTML</b> V40`. Se verificó el texto literal en diez vistas: tres cuentas de mostrador, sus tres comprobantes ya confirmados, panel de clientes, panel de materiales y ambas pestañas de ajustes. Todos los textos esperados aparecen; cero diálogos, cero elementos `[onerror]`/`img[src=x]`, cero scripts cuyo contenido sea el payload. Evidencia: `browser-continuacion.json`, `browser-continuacion-consola.txt` y diez capturas `visual-*.png`. No se deduce seguridad de una pantalla vacía: los tres comprobantes contienen ambos nombres y las filas de los paneles tienen movimientos reales de prueba.

Preparación: clientes y materiales por API; precios sintéticos añadidos directamente a la base de prueba porque la lista del día ya se había publicado durante las pruebas previas (`visual-precios-fixture.sql`, transacción con `session_replication_role=replica` solo para esas tres filas). Esta excepción de fixture no es una posibilidad atribuida al usuario HTTP. Cuentas, pesadas, precio especial autorizado y confirmación por API normal. Se contó el cajón desde el navegador, se eligió báscula chica y pago por transferencia. No se modificó código del producto. En el navegador se bloqueó toda petición a un hostname distinto de `patio.test` y se anuló únicamente la salida a impresora.

## Control R40-01: misma base y redes, sin publicar 5432 en el host

La base pertenece únicamente a `feruga_qa40_fondo`; el proxy a `feruga_qa40_frente` y a `feruga_qa40_default` (servicios externos ficticios). Evidencias y órdenes completas: `red-control-sin-puerto.json`, `red-control-sin-puerto-topologia.json`.

- frente → `db`: Failed to resolve "db"..
- frente → `codex-seguridad-db-40`: Failed to resolve "codex-seguridad-db-40"..
- frente → `192.168.80.2`: 5432/tcp filtered postgresql.
- proxy-red → `db`: Failed to resolve "db"..
- proxy-red → `codex-seguridad-db-40`: Failed to resolve "codex-seguridad-db-40"..
- proxy-red → `192.168.80.2`: 5432/tcp filtered postgresql.
- proxy-espacio → `db`: Failed to resolve "db"..
- proxy-espacio → `codex-seguridad-db-40`: Failed to resolve "codex-seguridad-db-40"..
- proxy-espacio → `192.168.80.2`: 5432/tcp filtered postgresql.
- fondo → `db`: 5432/tcp open  postgresql.
- fondo → `codex-seguridad-db-40`: 5432/tcp open  postgresql.
- fondo → `192.168.80.2`: 5432/tcp open  postgresql.

## Contraprueba R40-01: se restaura la publicación original de 5432

La base pertenece únicamente a `feruga_qa40_fondo`; el proxy a `feruga_qa40_frente` y a `feruga_qa40_default` (servicios externos ficticios). Evidencias y órdenes completas: `red-confirmacion-publicada.json`, `red-confirmacion-publicada-topologia.json`.

- frente → `db`: Failed to resolve "db"..
- frente → `codex-seguridad-db-40`: Failed to resolve "codex-seguridad-db-40"..
- frente → `192.168.80.2`: 5432/tcp open  postgresql.
- proxy-red → `db`: Failed to resolve "db"..
- proxy-red → `codex-seguridad-db-40`: Failed to resolve "codex-seguridad-db-40"..
- proxy-red → `192.168.80.2`: 5432/tcp open  postgresql.
- proxy-espacio → `db`: Failed to resolve "db"..
- proxy-espacio → `codex-seguridad-db-40`: Failed to resolve "codex-seguridad-db-40"..
- proxy-espacio → `192.168.80.2`: 5432/tcp open  postgresql.
- fondo → `db`: 5432/tcp open  postgresql.
- fondo → `codex-seguridad-db-40`: 5432/tcp open  postgresql.
- fondo → `192.168.80.2`: 5432/tcp open  postgresql.

## Cierre técnico — resultados definitivos de la continuación

Esta sección actualiza las conclusiones provisionales anteriores, que se conservan como historia de la revisión. La continuación se completó el 5 de noviembre de 2026 sobre el commit de ensayo `30ba63b34fa6fa054833fbb462da9dee1872d563`. Comparación de 400 archivos del producto entre la copia y lo publicado: cero diferencias (`integridad-producto.json`). Solo se editaron sondas y configuración de control dentro de `qa/`; no se corrigió el producto durante esta revisión.

### R40-01: causa aislada y contraprueba

**Media, real, pendiente.** La separación frente/fondo existe y el DNS está aislado; el tráfico a la IP de PostgreSQL no lo está mientras se publica su puerto. En el control se recreó exclusivamente la base del ensayo con la misma imagen, datos y redes, añadiendo `control-red-sin-puerto.yml`, cuyo único cambio es `db.ports: !reset []`. Resultado: TCP/5432 **filtered** desde frente, default y espacio de red del proxy; **open** desde fondo, donde también resuelven los nombres. Al restaurar el conjunto publicado original, **open** volvió a aparecer desde los cuatro orígenes. Queda aislada la relación con el puerto heredado; no es solo una conjetura sobre Docker.

Corrección recomendada, no aplicada al producto: eliminar la publicación de la base en la configuración efectiva de operación; conservar su acceso por fondo y usar `docker compose exec` para administración. Revisar también la necesidad de publicar web en loopback. Repetir la comprobación desde el proxy en la plataforma de despliegue: el comportamiento observado es el de este Docker local, no una prueba de que otra plataforma permita lo mismo. No se inspeccionaron reglas del anfitrión ni redes de otros proyectos. Evidencias: `control-red-orden.json`, `control-red-recrear.txt`, `red-control-sin-puerto.json`, `red-restaurar-puerto.txt`, `red-confirmacion-publicada.json`.

### ZAP activo: cuatro roles terminados

| Sesión | Duración activa observada | Peticiones activas según ZAP | Reglas terminadas | Estado de sesión antes y después |
|---|---:|---:|---:|---|
| Mostrador | 105 s | 6.123 | 20/20 | 200, rol mostrador |
| Patio | 95 s | 6.129 | 20/20 | 200, rol patio |
| Consulta | 90 s | 6.109 | 20/20 | 200, rol consulta |
| Responsable | 167 s | 6.136 | 20/20 | 200, rol responsable |

En los cuatro: `FINISHED`, progreso 100 %, todas las reglas `Complete`, ninguna `Skipped` por tiempo. Se concedieron 20 minutos por rol y cinco por regla; **responsable sí se repitió con más tiempo que los seis minutos de la pasada anterior**, aunque esta ejecución acabó antes. Son 24.497 peticiones activas, además de semillas y spider. Mostrador, patio y consulta no produjeron alertas activas. Responsable contabilizó cinco eventos de alerta y cuatro alertas activas distintas exportadas: un recorrido de archivos y tres reflejos persistentes en JSON, clasificados abajo. Las alertas pasivas se consolidan por causa, no como decenas de fallos independientes por URL.

Límites concretos: fuerza LOW; 20 reglas ejecutadas, no todos los complementos posibles de ZAP; sin callbacks externos, sin descarga de complementos y sin la regla de metadatos cloud. Semillas del inventario de 84 operaciones y 17 páginas, con cuerpos genéricos y algunos identificadores inexistentes; no equivale a probar todos los estados del negocio ni cada ruta con un objeto válido. Se excluyen alta de equipo, entrada/salida de sesión, cerrar/reabrir jornada y terminar arranque para conservar la sesión; esos controles se ejercitaron manualmente. El responsable de ZAP no tenía permiso adicional de autorizar; las operaciones que exigen PIN/facultad se comprobaron aparte con `QA40 visual`. El spider HTTP no reemplaza la navegación JavaScript: por eso se hicieron las pruebas Playwright. No se observaron alertas activas confirmadas de SQL, comandos, inclusión de archivos o XSS en los recorridos realizados.

### Clasificación final de hallazgos y avisos

| Referencia / aviso | Gravedad final | Real o falso positivo | Evidencia, alcance y acción |
|---|---|---|---|
| **R40-01: acceso de proxy a PostgreSQL por IP** | **Media** | **Real, corrección parcial** | DNS separado, TCP/5432 accesible; control y contraprueba demuestran efecto del puerto publicado. Retirar publicación de la base y repetir Nmap. No demuestra autenticación eludida. |
| **R40-02: CSP sin restricciones de recursos/scripts/formularios** | **Baja** | **Real, falta de defensa adicional** | La cabecera es exactamente `frame-ancestors 'none'`. Protege de marcos, pero no limita scripts, objetos, conexiones ni destino de formularios. Consolidación de los cuatro avisos CSP de ZAP: no existe literalmente `unsafe-inline` en la cabecera, ni se confirmó XSS. Proponer una política compatible con Next mediante nonces/hashes, `object-src 'none'`, `base-uri` y `form-action`, tras probarla. |
| **R40-03: falta X-Content-Type-Options** | **Baja** | **Real, endurecimiento** | Ausente en HTML/API examinados. Las respuestas JSON sí declaran `application/json`; no se demostró ejecución por confusión de tipos. Añadir `X-Content-Type-Options: nosniff` de forma uniforme. |
| **R40-04: respuestas privadas sin política explícita de caché** | **Baja** | **Real, endurecimiento; fuga no demostrada** | Por ejemplo, GET `/api/clientes` con sesión no envía `Cache-Control`; `Vary` menciona cabeceras de Next y `Accept-Encoding`, sin establecer una política de almacenamiento privado. No basta inferir una fuga a otro usuario ni un caché compartido. Usar `Cache-Control: private, no-store` en respuestas privadas. Las respuestas que emiten claves/códigos ya llevan `no-store`; los assets públicos pueden conservar caché. |
| ZAP 6-5, “Path Traversal”, alto automático | Sin vulnerabilidad confirmada | **Falso positivo de esta alerta** | Mensaje 623: POST `/api/clientes`, `{"nombre":"clientes"}`, respuesta `{"cliente":{"id":"18","nombre":"clientes","activo":true}}`; confianza Low y sin evidencia de archivo. Se reprodujeron `clientes`, `/etc/passwd`, `../../../../etc/passwd` y una ruta inexistente: se almacenan o se rechazan por duplicado como nombres. No devuelven contenido de archivos. El manejador usa la función de alta y parámetros SQL, no acceso al sistema de archivos. `confirmar-alertas.json`. |
| ZAP 40014, tres “Persistent in JSON Response”, baja automática | Sin vulnerabilidad confirmada | **Falsos positivos de XSS en las vistas probadas** | El nombre `<script>alert(1);</script>` persiste en JSON de clientes, resumen y bitácora. Content-Type JSON, sin ejecución; el payload exacto se mostró literal en panel/clientes, ajustes/clientes y panel/bitácora. Cero nodos de script del payload y cero diálogos. `browser-alertas.json`; además pasan los diez casos visuales anteriores. No se recomienda borrar signos `<` por esta alerta. |
| BREACH de testssl, media automática | Informativa | **Compresión real; falso positivo si se interpreta como BREACH explotable demostrado** | Hay reflexión de parámetros en HTML gzip y de nombres almacenados en JSON gzip. No se encontró credencial/token secreto dentro de esos mismos cuerpos comprimidos. Sí hay información privada comercial junto a nombres controlados en las API autenticadas: no se declara que todo contenido comprimido sea público. La respuesta que reúne nombre y PIN nuevo no está comprimida (98 bytes); código y cambio de clave tampoco. No se demostró recuperación mediante oráculo de tamaños. |
| testssl: CRL/OCSP ausentes, certificado cercano a vencer | Informativa del ensayo | **Observaciones reales de la CA efímera; falsos positivos como vulnerabilidades altas del producto** | Se refieren a Caddy local, no al certificado público, que queda fuera del alcance. No extrapolar a producción. |
| ZAP: “Suspicious Comments” | Informativa | **Falsos positivos de fuga de información en las cinco coincidencias** | Coincidencias `query`, `select`, `from` en JavaScript minificado de Next/Turbopack/core-js, URLs de documentación/licencia y construcción de URL. No mostraron SQL de servidor, claves o secretos. |
| ZAP: “Modern Web Application” | Informativa | **Descripción real, no vulnerabilidad** | Hay JavaScript y navegación dinámica; justifica complementar el spider con navegador. |
| testssl: `engine_problem` GOST | Sin gravedad del producto | **Limitación de la herramienta** | No indica fallo del TLS del sitio. |

**Balance:** un hallazgo medio abierto y tres mejoras de endurecimiento de gravedad baja; ningún hallazgo crítico o alto confirmado en este alcance. Los avisos altos automáticos no se copian como vulnerabilidades sin comprobación.

### BREACH: cierre y control de navegador

Última corrida: GET autenticado `/api/clientes` con el nombre de prueba persistido devolvió gzip, cuerpo descomprimido de 1.270 bytes, con el marcador elegido y otros nombres privados; no incluye PIN, cookie sellada ni código de equipo. La página raíz comprimida fue idéntica anónima y autenticada con el mismo parámetro. Alta de persona: nombre elegido + PIN recién generado, **sin** `Content-Encoding`, 98 bytes; cambiar PIN: 16 bytes sin compresión; generar código de equipo: 23 bytes sin compresión, sin reflejar el nombre. Son mediciones de la configuración actual, no garantía si mañana se amplían esos cuerpos o cambia el compresor.

La comprobación desde navegador abrió `about:blank` (origen opaco, sin servidor externo) y solicitó la API de prueba con `credentials: include`: Chromium no envió la cookie `SameSite=Strict` y JavaScript no obtuvo lectura CORS. `breach-navegador.json` conserva la petición sin cookie y el error de lectura; Playwright no recibió un objeto de respuesta en ese intento. La ausencia de permiso CORS se comprueba también en las cabeceras HTTP capturadas, no en el texto genérico del error de fetch. La prueba HTTP manual con cookie inyectada y Origin ajeno no reproduce ese comportamiento del navegador y no se usa como supuesto bypass. No se efectuó ataque de extracción estadística de secretos. Conclusión: **no se confirma BREACH explotable**; mantener fuera de compresión las respuestas que emiten secretos es una prevención razonable si crecen.

### Lo que quedó bien

- Segmentación de nombres ya correcta; base únicamente en fondo; al retirar el puerto publicado, aislamiento de transporte comprobado. Proxy sin puerto de administración 2019 en la pasada de Nmap completa.
- Los cuatro roles conservan su sesión y sus restricciones durante los escaneos; las pruebas manuales anteriores y repetidas rechazan escalada, Origin inválido, cookie alterada y uso de sesión cerrada. Caducidad/inactividad se ensayaron ajustando timestamps, no esperando doce horas.
- Identificadores de envío conservan idempotencia; la carrera del código de alta admite un uso; los errores comprobados no exponen SQL ni trazas internas.
- Los nombres HTML/script sobreviven como datos y se representan como texto en mostrador, comprobante, panel, ajustes y bitácora. Las comprobaciones incluyeron filas con datos reales de ensayo.
- TLS 1.2/1.3, HSTS y certificado validado contra la CA local quedaron bien en la pasada de testssl conservada; no se repitió testssl en esta continuación porque no cambió la configuración TLS evaluada. La cookie lleva Secure, HttpOnly y SameSite=Strict. CSP frame-ancestors/X-Frame-Options niegan marcos.
- El ensayo actualizado terminó su publicación y comprobación HTTPS. La implementación actual de `estadoPorHttps` distingue silencio y plazo total de tres veces ese valor; se leyó esa corrección, pero esta continuación no añadió una prueba independiente de servidor a goteo. No se atribuye a esta pasada una prueba de todos los escenarios temporales.

### Órdenes para repetir

Ejecutar **solo desde la copia**, con Docker y las imágenes locales fijadas ya presentes. No hacen falta `npm ci`, `npm install` ni descargas. El envoltorio ya documentado reutiliza las dependencias y dirige Buildx a `qa/buildx-40`. Las imágenes de herramienta son las registradas al principio del informe; el navegador usa `codex-seguridad-browser:40`, construido anteriormente con `browser.Dockerfile`. No ejecutar los comandos desde el proyecto del escritorio.

Las etapas principales tienen un envoltorio en `qa/seguridad-40/repetir-continuacion.sh`. Su sintaxis se comprobó; los pasos se ejecutaron individualmente en esta corrida, con las adaptaciones de preparación indicadas. Parte de los datos y tiempos cambiará entre ejecuciones. El envoltorio es para una instalación nueva, después de retirar la anterior, y sobrescribe las evidencias de trabajo: archivar esta carpeta/informe antes de repetir si se quieren conservar los resultados.

```sh
cd /tmp/feruga-codex-qa14
sh qa/seguridad-40/repetir-continuacion.sh
```

Etapas aisladas, con la instalación y ZAP ya preparados:

```sh
# Red original: tres orígenes exteriores a fondo, dos nombres y la IP exacta de la base propia.
python3 qa/seguridad-40/red-continuacion.py

# Los cuatro roles, renovación de sesión y límites de 20/5 minutos.
sh qa/seguridad-40/activos-continuacion.sh

# BREACH y reproducción de la alerta de recorrido de archivos.
docker exec codex-seguridad-zap-40 python /zap/wrk/breach-continuacion.py
docker exec codex-seguridad-zap-40 python /zap/wrk/confirmar-alertas.py

# Navegador: después de preparar datos-visual.py, visual-fixture.py y cuentas-visual.py.
docker run --rm --pull=never --name codex-seguridad-browser-40 --network feruga_qa40_default --dns 127.0.0.1 -v /tmp/feruga-codex-qa14/qa/seguridad-40:/salida codex-seguridad-browser:40 node /salida/browser-continuacion.cjs

# Payload exacto de ZAP en tres vistas; puede repetirse después de confirmar las cuentas.
docker run --rm --pull=never --name codex-seguridad-browser-alertas-40 --network feruga_qa40_default --dns 127.0.0.1 -v /tmp/feruga-codex-qa14/qa/seguridad-40:/salida codex-seguridad-browser:40 node /salida/browser-alertas.cjs

# Control de R40-01, sin alterar el producto; recrea solo la base propia sin puerto publicado.
python3 qa/seguridad-40/control-red.py

# Guardar resultados y retirar todos los recursos de la revisión, incluso si falló una sonda.
python3 qa/seguridad-40/limpiar-continuacion.py
```

El control de red deja intencionalmente el ensayo con el overlay sin puerto hasta su retirada. Para la contraprueba de esta corrida se recreó de nuevo la base con `docker compose -p feruga_qa40 -f <conjunto.json-de-esta-publicación> up -d --no-deps --wait db`, **sin** el overlay, y se repitió Nmap. El archivo concreto y las órdenes quedan en `red-restaurar-puerto.txt`, `control-red-orden.json` y los JSON de Nmap; las IP se obtienen siempre mediante inspect de `codex-seguridad-db-40`, no se barre ninguna subred.

Las evidencias incluyen cookies, PIN y códigos **de prueba**; no son datos de producción. Se conserva la pasada original en `anterior-40.tar.gz`. Las limitaciones y falsos positivos anteriores no se convierten en garantías sobre funcionalidades, certificados o plataformas que no se probaron.

## Limpieza completada

Comprobación final: cero contenedores `feruga_qa40`, cero contenedores `codex-seguridad-…`, cero redes, volúmenes o etiquetas de imágenes del proyecto y cero directorios `qa/trabajo-40.*`. Se retiraron también las dos instalaciones generadas y sus llaves. Los registros de publicación se conservaron dentro de las evidencias. Las imágenes locales de herramientas/dependencias se conservan para repetir sin instalar paquetes. Evidencia: `limpieza-continuacion.json` y `limpieza-verificacion.json`. La copia de trabajo y sus sondas siguen en `/tmp/feruga-codex-qa14/qa/`; el informe completo queda en `/tmp/feruga-codex-informe-40.md`.
