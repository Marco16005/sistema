# Verificación de correcciones de seguridad 41

Fecha: 5 de noviembre de 2026. Alcance: R40-01 a R40-04, exclusivamente la instalación desechable `feruga_qa40`, levantada desde `/tmp/feruga-codex-qa14/qa/ensayo-40.sh`. Evidencia nueva en `qa/seguridad-41/`. No se ejecutan escaneos activos de ZAP ni se modifica el producto.

## Parte 1 — Preparación

Se reutilizan las dependencias y herramientas locales de la revisión 40, sin npm ci/install. El envoltorio `qa/bin-40/docker` sustituye la instalación de dependencias durante la construcción por COPY de la imagen local `codex-seguridad-dependencias:40`. Se conservará temporalmente el ensayo para las sondas y se eliminará al terminar. Se guarda el inventario SHA-256 del producto para verificar que permanece intacto.

La copia carece de `.git`; la atribución a los commits indicados por el dueño se toma como contexto, y la verificación se hace sobre el contenido y el comportamiento construido de esta copia.

## Parte 2 — R40-01: red y rechazo de publicación

- frente → 172.31.0.2: 5432/tcp filtered postgresql
- proxy-red → 172.31.0.2: 5432/tcp filtered postgresql
- proxy-espacio → 172.31.0.2: 5432/tcp filtered postgresql
- fondo → 172.31.0.2: 5432/tcp open  postgresql

`docker port` no devuelve puertos de db/web; PortBindings y Ports se guardan en `topologia.json`. Solo el proxy publica. Los controles pasan la configuración por stdin a `comprobacion red --local`, igual que publicar.sh: no se levanta el puerto prohibido.

- valida: salida 0; Comprobación de red: bien. Container codex-seguridad-comprobacion-41 Creating 
 Container codex-seguridad-comprobacion-41 Created
- db-local: salida 1;  Container codex-seguridad-comprobacion-41 Creating 
 Container codex-seguridad-comprobacion-41 Created 
No pasa la comprobación de red:
  · db publica en esta máquina el puerto 54441 (hacia su 5432): solo publica el proxy; publicado, aunque sea solo aquí, otro contenedor lo alcanza por su dirección
- web-local: salida 1;  Container codex-seguridad-comprobacion-41 Creating 
 Container codex-seguridad-comprobacion-41 Created 
No pasa la comprobación de red:
  · web publica en esta máquina el puerto 3241 (hacia su 3000): solo publica el proxy; publicado, aunque sea solo aquí, otro contenedor lo alcanza por su dirección

Evidencia: `red.json`, `topologia.json`, `control-publicacion.json`; sonda repetible: `python3 qa/seguridad-41/red.py`.

## Parte 3 — Cabeceras HTTPS: primera evidencia

Las páginas normales, con y sin sesión, reciben la CSP completa indicada y todos sus scripts llevan el nonce de la cabecera. Los 56 nonces observados en la primera serie son distintos, incluyendo 30 respuestas consecutivas y una petición condicional; las páginas declaran private/no-store y no se observó un nonce recuperado de caché. Las respuestas API de rutas válidas llevan la política fija, nosniff y private, no-store. Las 404 de /api conservan no-store con directivas adicionales, lo cual no es una regresión.

**R40-02 todavía parcial:** `/apicualquiera`, `/favicon.ico` y `/favicon.ico/no-existe` producen HTML 404 sin CSP ni nonce. Además, pedir `/mostrador` con `next-router-prefetch: 1` o `Purpose: prefetch` produce HTML 200 sin CSP ni nonce (12 scripts sin nonce), incluso con sesión. La exclusión del matcher acepta esos prefijos/cabeceras sin comprobar si se está devolviendo un documento HTML. Se comprobará el efecto en navegador; esto por sí solo no demuestra una inyección explotable de datos del usuario.

**R40-03 tiene una excepción:** `/mostrador/` devuelve 308, texto plano, sin nosniff. Las páginas y API normales sí lo llevan. La ausencia en una redirección sin HTML tiene impacto bajo y no prueba ejecución de contenido.

Evidencia: `cabeceras.json`, `cabeceras-resumen.json` y los HTML `respuesta-*.html`. Una sonda de doble barra inicialmente fue interpretada por Playwright como otro hostname; la resolución falló contra el DNS local deshabilitado y no produjo respuesta. Se corrigió la sonda para fijar explícitamente el origen y se excluye ese intento del recuento útil.

## Parte 4 — Las diez vistas en Chromium

**Pasan las diez**: tres mostradores y sus tres comprobantes, panel de clientes/materiales y ajustes de clientes/materiales. Los tres nombres (`<img src=x onerror=alert(40)>`, `<script>alert(40)</script>`, `<b>QA40 HTML</b>`, con sufijo V40) son texto visible. No aparecen elementos ejecutables derivados de ellos, no hay diálogos y hay **cero securitypolicyviolation en las diez vistas**, con escucha instalada mediante addInitScript antes de cargar.

El control de insertar HTML con manejador onerror fue **bloqueado**: `window.colado41` no se activó y se registró [{"directiva": "script-src-attr", "bloqueado": "inline", "disposicion": "enforce"}]. Se hace la inserción desde la sonda para simular un fallo de escape; no se afirma haber encontrado tal fallo en el producto.

Evidencia: `navegador.json`, `visual-*.png`, `navegador.cjs`. Versión Chromium: 153.0.8010.12. La API se probó validando la CA del ensayo. El navegador usa ignoreHTTPSErrors para la CA local no instalada en Chromium; esto no desactiva CSP. La preparación inicial necesitó publicar la lista de precios antes de atender; después se completó el recorrido.

## Parte 5 — Intentos de eludir la política y límites

**R41-01, gravedad media, real: cobertura incompleta de CSP (continuación de R40-02).** En navegador, el manejador de la sonda se bloquea en `/mostrador` anónimo/autenticado y en una 404 normal; se ejecuta en `/apicualquiera` y al cargar `/mostrador` con `next-router-prefetch: 1` o `Purpose: prefetch`. Esas respuestas son documentos HTML sin CSP. El prefijo `api` y `favicon.ico` del matcher excluye más que rutas API/recursos reales; la condición `missing` excluye precargas aunque la respuesta sea HTML. Por HTTP se confirmó también el HTML 404 de `/favicon.ico` y `/favicon.ico/no-existe`; Chromium abortó la navegación directa al primero, por lo que no se atribuye ejecución a esa URL.

El control es una **inyección artificial realizada por la sonda**, no un XSS persistente encontrado en el sistema: las diez vistas escaparon los nombres. Para la variante de precarga, la sonda añade la cabecera de navegación; no se demostró que un atacante externo pueda imponerla en la navegación normal de una víctima. La ausencia de defensa es real; una cadena de explotación de usuario no está demostrada. Sugerencia concreta: aplicar CSP/nonce a todo documento HTML, incluidas las 404, y no excluir documentos solo por esas cabeceras o prefijos.

También, con Purpose: prefetch y una CSP de petición `script-src 'nonce-elegido41'`, los scripts del HTML recibieron ese nonce elegido, sin CSP de respuesta. Es otra consecuencia de saltarse el proxy: no prueba predicción del generador. Sin esa exclusión, una CSP de petición suministrada por el cliente se sobrescribe correctamente con un nonce nuevo. `x-middleware-subrequest` tampoco suprimió la política en la prueba.

Las precargas RSC reales, siguiendo su redirección interna, devuelven `text/x-component`, sin CSP pero con nosniff y private/no-store. **No son un documento ejecutable: no se cuentan como bypass por sí solas.** Un estado RSC malformado (`next-router-state-tree: %`) produjo 500 real, de tipo text/plain: conserva nosniff; con petición normal conserva CSP y con precarga carece de ella. No contiene HTML ni datos privados. Las rutas `/404` y `/500` no existentes son 404, y no se confundieron con un error 500 real.

**R41-02, gravedad baja, real como incumplimiento de cobertura:** las redirecciones tempranas 308 de `/mostrador/`, `/api/clientes/` y `/api/salud/` no llevan nosniff; las dos de API tampoco Cache-Control. Las genera la normalización de Next antes de las cabeceras configuradas. Son texto plano con Location, no datos privados; **no se demostró sniffing, fuga ni caché de una respuesta autenticada**. Esto deja parciales las afirmaciones literales «nosniff en todo» y «no-store en todo /api», aunque las respuestas finales de API sí cumplen. Se puede cubrir en el proxy exterior o aplicar las cabeceras también a estas respuestas tempranas.

Las 404 HTML bajo `/api` sí tienen la política `default-src 'none'; frame-ancestors 'none'`: bloquean sus propios scripts/estilos (11 violaciones iniciales en el control navegador) y el manejador artificial. Es una página de error incompatible con la política de API, **no un bypass ni un XSS**. Tampoco es un fallo de caché que Next amplíe `private, no-store` a `private, no-cache, no-store, max-age=0, must-revalidate`.

Se revisaron 54 documentos HTML protegidos y 588 etiquetas script: ninguna carecía del nonce de su respuesta. No se hallaron en src usos de dangerouslySetInnerHTML, innerHTML/outerHTML, insertAdjacentHTML, document.write, eval, new Function ni etiquetas script propias (`contextos-script.txt`). Esto, junto con el recorrido de datos guardados, no mostró un contexto de script controlado por los nombres del usuario; no pretende demostrar ausencia universal de XSS.

Evidencia adicional: `limites.json`, `limites.cjs`, `cabeceras-validacion.json`.

## Parte 6 — ZAP pasivo con responsable

ZAP **2.16.1**, imagen local por digest, 51 peticiones por HTTPS al proxy (incluyen recursos estáticos), cola pasiva terminada en 0. `/api/sesion` confirma persona QA41 visual, rol responsable. `zap-escaneos-activos.json` contiene `scans: []`: no hubo escaneo activo ni spider. DNS exterior deshabilitado y actualizaciones desactivadas.

- 10055 CSP: style-src unsafe-inline: 12 instancias.
- 10109 Modern Web Application: 14 instancias.
- 10038 Content Security Policy (CSP) Header Not Set: 1 instancias.
- 10055 CSP: Failure to Define Directive with No Fallback: 1 instancias.
- 10019 Content-Type Header Missing: 2 instancias.
- 10015 Re-examine Cache-control Directives: 14 instancias.
- 10027 Information Disclosure - Suspicious Comments: 5 instancias.

Interpretación de los avisos relevantes:

- **CSP ausente:** real en `/apicualquiera`; coincide con R41-01. ZAP no cubre automáticamente el bypass por cabeceras de precarga que sí verifica nuestra sonda.
- **style-src unsafe-inline:** la observación es cierta y corresponde exactamente a la excepción pedida para los atributos style. No implica unsafe-inline en script-src ni reapertura por ejecución de scripts. Riesgo residual deliberado, no un hallazgo nuevo de XSS; no se eleva automáticamente la severidad media del escáner a una vulnerabilidad demostrada.
- **Directiva sin fallback ausente:** observado en la 404 HTML `/api/no-existe-41`, que recibe la CSP fija de API sin base-uri/form-action. La política bloquea scripts y estilos; es el desajuste de tipo de respuesta ya descrito, sin explotación demostrada. Impacto bajo como endurecimiento del error HTML; no afecta el cumplimiento de la política API solicitada.
- **Caché, 14 avisos informativos:** evidencia `private, no-store`, también comprobada en las respuestas reales. **Falso positivo si se interpreta como posibilidad de guardar datos privados**: no-store prohíbe almacenarlos; no hace falta añadir no-cache/max-age para que lo haga. No son las redirecciones 308 de R41-02.
- **Nosniff:** ningún aviso de ausencia en esta pasada. Esto no invalida las omisiones de las redirecciones, verificadas directamente.
- Los avisos de aplicación moderna, Content-Type en dos 308 y comentarios de bundles son informativos; no aportan una vulnerabilidad explotable nueva. Las pruebas HTTP directas identificaron los 308 como texto plano. No se repite la auditoría de dependencias ni de comentarios.

Evidencia: `zap-alertas.json`, `zap-mensajes.json`, `zap-peticiones.json`, `zap-cola.json`, `zap-version.json`, `zap-escaneos-activos.json`.

## Parte 7 — Veredictos finales y repetición

| Corrección | Veredicto | Evidencia y límite |
|---|---|---|
| R40-01 | **Cerrada** | Nmap 5432 filtrado desde frente, red del proxy y espacio del proxy; abierto desde fondo. Db/web sin publicación. Configuración válida aceptada, db/web en 127.0.0.1 rechazados con servicio y puerto; `red.json`, `topologia.json`, `control-publicacion.json`. |
| R40-02 | **Parcial** | Política/nonce correctos en páginas normales; 10 vistas sin violaciones, manejador bloqueado. HTML 404 excluido y HTML con cabeceras de precarga siguen sin CSP y permiten el manejador artificial. No se halló XSS de los nombres; `navegador.json`, `cabeceras.json`, `limites.json`. |
| R40-03 | **Parcial** | Nosniff en páginas/API/errores probados, incluidos 500 RSC. Falta en 308 tempranos; incumplimiento literal de «en todo», de bajo impacto; `limites.json`. |
| R40-04 | **Parcial** | API con/sin sesión, errores y métodos probados no se almacenan. Excepción: 308 de /api/clientes/ y /api/salud/ sin Cache-Control; no contienen datos privados. No se demostró fuga por caché; `cabeceras-validacion.json`, `limites.json`. |

Los parciales R40-03/R40-04 se refieren a cobertura global, no a un fallo de protección de datos en las respuestas API finales. No hay nuevos hallazgos altos o críticos confirmados. Lo nuevo de seguridad efectivo es la cobertura incompleta de CSP; el resto son excepciones de endurecimiento o avisos contextualizados arriba.

Repetición completa, secuencial, sin instalar dependencias:

```sh
cd /tmp/feruga-codex-qa14
sh qa/seguridad-41/repetir.sh
```

El guion crea el ensayo con `qa/ensayo-40.sh`, ejecuta las sondas en orden y lo retira al salir. Reutiliza las imágenes locales de la 40; no sirve para apuntar a una instalación ajena. Sobrescribe evidencia en qa/seguridad-41 y las sondas red/limpieza añaden sus resultados al informe; guardar una copia si se necesita conservar esta corrida.

Órdenes por parte mientras el ensayo esté vivo:

```sh
python3 qa/seguridad-41/red.py
# comprobacion red --local y las cuatro órdenes nmap exactas quedan en los JSON de evidencia.
# Todas las sondas HTTP/navegador usan este contenedor; cambiar cabeceras por limites o navegador:
docker run --rm --pull=never --name codex-seguridad-cabeceras-41 --network feruga_qa40_default --dns 127.0.0.1 -e NODE_EXTRA_CA_CERTS=/salida/raiz.crt -v /tmp/feruga-codex-qa14/qa/seguridad-41:/salida codex-seguridad-browser:40 node /salida/cabeceras.cjs
docker exec codex-seguridad-zap-41 python /zap/wrk/zap-pasivo.py
python3 qa/seguridad-41/limpiar.py
```

Para reproducir la omisión CSP basta consultar `https://patio.test/apicualquiera`, o `https://patio.test/mostrador` con `Purpose: prefetch`; la sonda límites muestra además la ejecución artificial y su control bloqueado. No se publica de verdad ningún puerto de db/web en el control negativo: solo se entrega la configuración al mismo comprobador que llama publicar.sh.

## Parte 8 — Retirada e integridad

{"productoSinCambios": true, "archivos": 569, "instalacionEliminada": true, "contenedores": [], "redes": [], "volumenes": []}. Se retiraron los contenedores de las sondas, la instalación, sus redes, volúmenes y etiquetas de imágenes propias. Se conservan las herramientas que ya existían y la evidencia en qa/seguridad-41. Detalle: `limpieza.json`, `limpieza-verificacion.json`, `manifiesto-publicado.json`.
