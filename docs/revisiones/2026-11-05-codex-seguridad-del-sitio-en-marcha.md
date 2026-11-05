# Revisión de seguridad 40 — en ejecución

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
