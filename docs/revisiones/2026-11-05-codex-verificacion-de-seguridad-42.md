# Verificación corta 42

Fecha: 5 de noviembre de 2026. Alcance: R41-01 y R41-02, más búsqueda acotada de respuestas sin CSP/nosniff. R40-01 no se reabre ni se vuelve a auditar.

## Parte 1 — Preparación

Solo se usa `/tmp/feruga-codex-qa14`, con sondas derivadas de `qa/seguridad-41` guardadas en `qa/seguridad-42`. Se levanta exclusivamente `feruga_qa40` mediante `qa/ensayo-40.sh`, con dependencias e imágenes locales, sin npm ci/install. Se excluye la nueva evidencia del empaquetado del arnés. No se modifica código del producto; se registra su SHA-256 para cotejar al terminar. Las pruebas irán secuencialmente por HTTPS a `patio.test` dentro del ensayo, con DNS exterior deshabilitado en las sondas. No se ejecuta ZAP ni pruebas de red ya cerradas.

Confirmación estática: matcher `/((?!api(?:/|$)|_next/static/).*)`, sin exclusión por precarga; Caddy usa `defer`, CSP de reserva condicional y caché condicional para `/api/*`; la CSP de API incluye `base-uri` y `form-action`. Los veredictos dependen del comportamiento que se registre a continuación.

## Parte 2 — R41-01 y R41-02: reproducción directa

Las 89 peticiones de `cabeceras.cjs` y la sonda `limites.cjs`, reutilizadas de la 41, confirman CSP con nonce en `/apicualquiera`, `/favicon.ico`, `/favicon.ico/no-existe` y HTML con precarga. La sonda de límites se amplió únicamente con `Sec-Purpose: prefetch`: el manejador artificial queda bloqueado en las tres precargas, en `/apicualquiera`, en la 404 normal y en los controles normales con/sin sesión. Se registra `script-src-attr: inline`; nunca se activa `window.colado41`. No es un XSS descubierto: la inserción se hace desde la sonda. Chromium aborta la navegación a `/favicon.ico`; su evidencia es HTTP, no una ejecución de navegador.

Las 308 de `/mostrador/`, `/api/clientes/` y `/api/salud/` ahora tienen CSP restrictiva de reserva, `nosniff`, `DENY` y HSTS; las dos API tienen `private, no-store`. Se confirma también con HEAD y OPTIONS en la ampliación. Las páginas normales conservan la CSP de aplicación con nonce: Caddy no las sustituye por `default-src 'none'`.

Evidencia: `qa/seguridad-42/cabeceras.json`, `limites.json`, `adicionales.json` y los HTML guardados. Resultado provisional: corregidos los casos concretos de ambas incidencias; falta cerrar el recorrido de diez vistas y clasificar la respuesta nueva de URL inválida.

## Parte 3 — Aplicación y cobertura ampliada

- **230 respuestas HTTP válidamente capturadas**, más una respuesta HEAD que Playwright no pudo interpretar, resuelta luego con TLS crudo. Son 89 intentos originales y 142 adicionales; no se suman las demás sondas a este denominador.
- **134 HTML con nonce, 1.412 etiquetas script, cero discordancias**. Los 169 nonces observados en esas series (incluyen respuestas sin cuerpo HTML) son distintos. `/apicualquiera`, favicon y sus descendientes, `/_next/imagex`, rutas con puntos y las precargas conservan política de página. En 15 combinaciones de precarga y CSP impuesta por el cliente, más cinco controles sin precarga, no aparece el nonce elegido `elegido42`; también pasa el control `elegido41` reutilizado.
- **Cero cabeceras duplicadas** entre CSP, nosniff, HSTS, X-Frame-Options y Cache-Control. No hay `nosniff, nosniff`.
- **Diez vistas pasan, cero violaciones, cero diálogos y cero elementos ejecutables procedentes de los nombres**: tres mostradores, tres comprobantes, panel de clientes/materiales y ajustes de clientes/materiales. Se reutiliza `navegador.cjs` sin cambiar su recorrido. Evidencia: `navegador.json` y `visual-*.png`.
- API conserva su CSP fija completa con `base-uri 'none'` y `form-action 'none'`, además de `private, no-store` (en errores Next añade otras directivas sin retirar no-store). El motivo concreto del aviso ZAP 10055 sin fallback quedó corregido por inspección de respuestas; no se vuelve a ejecutar ZAP.
- HEAD/OPTIONS, rutas con puntos/codificación válida y RSC llevan CSP/nosniff. Los **500 reales** por `next-router-state-tree: %`, también con precarga, conservan ambas cabeceras: dos en `limites.json` y seis en `adicionales.json`. Son texto plano, no se confunden con la ruta `/500`, que devuelve 404. El RSC real seguido por la sonda devuelve `text/x-component` con las cabeceras.

**Límite a la frase «cada HTML con nonce»:** ocho respuestas 404 HTML de `/api` y rutas API inexistentes llevan la política fija restrictiva, sin nonce; esta bloquea sus propios scripts y el manejador artificial. Es el comportamiento ya descrito en la 41, no una nueva evasión. Por tanto, la afirmación literal para todo HTML es falsa, aunque se haya cerrado R41-01. Dos apariciones de `<script>` dentro del JSON de clientes son los nombres de prueba: no son etiquetas ejecutables ni documentos HTML; se excluyeron del contador de scripts sin nonce. Interpretarlas como XSS sería un **falso positivo**.

Evidencia resumida: `resumen.json`; comprobaciones reproducibles en `validar.py`. Las cifras de nonces no afirman aleatoriedad universal, solo ausencia de repetición en esta muestra.

## Parte 4 — Nuevo R42-01: rechazo temprano de URL inválida

**Gravedad baja; real como omisión de endurecimiento, sin vulnerabilidad explotable demostrada.** HTTPS con GET, HEAD u OPTIONS y ruta `/%`, `/%ZZ` o `/api/%` devuelve exactamente:

```http
HTTP/1.1 400 Bad Request
Content-Type: text/plain; charset=utf-8
Connection: close

400 Bad Request
```

Faltan CSP, nosniff, HSTS y X-Frame-Options; `/api/%` tampoco lleva caché. Nueve confirmaciones directas por TLS validando la CA, sin cookies; tres controles `/mostrador` sí tienen las cabeceras. Evidencia íntegra: `tls-crudo.json`. Playwright falla al leer HEAD `/%` porque recibe cuerpo tras `Connection: close`; no se cuenta ese fallo de cliente como ausencia probada: la captura TLS confirma la respuesta.

La forma de respuesta es consistente con rechazo del analizador HTTP antes de ejecutar las reglas de Caddy; esta atribución es una inferencia, no instrumentación interna. El cuerpo fijo de 15 bytes no refleja la ruta, no contiene HTML ni datos privados. No se demostró ejecución, sniffing ni filtración. Refuta «cabeceras en absolutamente toda respuesta», pero no reproduce las 308 defectuosas de R41-02. Conviene delimitar la garantía a peticiones HTTP aceptadas por el proxy, o tratar los rechazos del analizador en la capa que los genera si se exige cobertura absoluta.

## Parte 5 — Veredictos y repetición

| Incidencia | Veredicto | Evidencia decisiva |
|---|---|---|
| R41-01 | **Cerrada** | Las rutas antes excluidas y las tres precargas llevan nonce nuevo; scripts coinciden; CSP del cliente reemplazada; manejador artificial bloqueado. `cabeceras.json`, `limites.json`, `adicionales.json`. Se mantiene la excepción conocida de HTML de API, que bloquea scripts. |
| R41-02 | **Cerrada** | Las tres 308 tienen nosniff/CSP/HSTS/DENY sin duplicación; las de API tienen private, no-store, también en HEAD/OPTIONS. `limites.json`, `adicionales.json`. La garantía absoluta tiene la excepción nueva R42-01. |
| R42-01 | **Nuevo, bajo, real** | Nueve 400 de URL malformada sin cabeceras de seguridad; cuerpo fijo sin datos ni ejecución. `tls-crudo.json`. |

No se encontró otro fallo de seguridad nuevo en la muestra. R40-01 no se reaudita.

Repetición completa, secuencial, sin instalar dependencias (sobrescribe la evidencia de 42 y añade la retirada al informe):

```sh
cd /tmp/feruga-codex-qa14
sh qa/seguridad-42/repetir.sh
```

El guion usa `CONSERVAR=1 sh qa/ensayo-40.sh`, prepara únicamente el ensayo, ejecuta las sondas y lo limpia mediante trap. Con el ensayo ya preparado, órdenes por parte:

```sh
sh qa/seguridad-42/sonda.sh cabeceras
sh qa/seguridad-42/sonda.sh limites
sh qa/seguridad-42/sonda.sh adicionales
sh qa/seguridad-42/sonda.sh tls-crudo
# El recorrido necesita los datos preparados por repetir.sh; ejecutarlo una vez por ensayo nuevo.
python3 qa/seguridad-42/precios.py
sh qa/seguridad-42/sonda.sh navegador
python3 qa/seguridad-42/resumir.py
python3 qa/seguridad-42/validar.py
python3 qa/seguridad-42/limpiar.py
```

`sonda.sh` fija imagen local `codex-seguridad-browser:40`, red `feruga_qa40_default`, DNS exterior deshabilitado, origen HTTPS `patio.test` y CA del ensayo. Chromium usa `ignoreHTTPSErrors` por la CA no instalada en su almacén; las sondas HTTP y TLS validan la CA y CSP permanece activa en Chromium.

## Parte 6 — Retirada e integridad

{"productoSinCambios": true, "archivos": 581, "instalacionEliminada": true, "contenedores": [], "redes": [], "volumenes": []}. Se retiraron los contenedores de las sondas, la instalación, sus redes, volúmenes y etiquetas de imágenes propias. Se conservan las herramientas que ya existían y la evidencia en qa/seguridad-42. Detalle: `limpieza.json`, `limpieza-verificacion.json`, `manifiesto-publicado.json`.
