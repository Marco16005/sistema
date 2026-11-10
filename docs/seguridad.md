# Seguridad: lo que se revisó, lo que se arregló y lo que se aceptó

Revisión del 4 y 5 de noviembre de 2026, con el sistema terminado y antes del servidor de verdad. Todo
corre en contenedores, contra copias propias (nunca contra la demostración ni contra nada de fuera).
Para repetir la parte automática: `sh seguridad/escanear.sh` (solo pide Docker; las salidas quedan
en `seguridad/informes/`, fuera de Git). Se corre antes de publicar una versión. SonarQube va aparte,
porque es pesado: `sh seguridad/sonar.sh` (un servidor desechable; pide unos 3.5 GB de memoria libre).

## Lo que se revisó

| Qué | Con qué | Resultado |
|---|---|---|
| Secretos en todo el historial de Git, y en toda la carpeta `feruga` (también lo que no está en Git) | gitleaks 8.30.1 | **Ninguno.** Los cinco avisos eran valores de mentira de las pruebas; `.gitleaks.toml` los exceptúa por valor, no por archivo |
| Librerías con avisos publicados | OSV-Scanner 2.7.0, npm audit | **Next.js 16.3.8 tenía tres** (dos de ejecución remota sin sesión, uno de negación de servicio): se subió a 16.4.5. Después, ninguno |
| El código | semgrep 1.182.1 (reglas de TypeScript, Node, React, Next.js, secretos, Docker, inyección SQL) | **Nada real en el código del sistema.** Los avisos estaban en pruebas y recorridos (expresiones regulares de valores que la misma prueba pone) y uno era la etiqueta pública del sello, que no es un secreto |
| Los Dockerfile y el Compose de operación | hadolint 2.15.1, Checkov 3.4.3 | **Los contenedores conservaban los privilegios de Docker por omisión**: se endurecieron (abajo). Lo demás, aceptado (abajo) |
| Las imágenes de operación | Trivy 0.76.1, Grype 0.121.1 | **Bases desactualizadas y npm adentro**: se arreglaron (abajo). Quedan los de Caddy, gosu y rclone (abajo) |
| La calidad y la seguridad del código, regla por regla | SonarQube Community 26.10 (escáner 12.3.1), sobre todo el código y sus pruebas | **Pasa su umbral de calidad; ningún punto de seguridad por revisar.** Un descuido real en una pantalla (una condición que daba lo mismo), corregido. Los demás avisos se revisaron uno por uno: aceptados (abajo) |
| El sitio en marcha, como lo ve alguien de fuera y como lo ve cada rol | nmap 7.95, testssl 3.2.5, OWASP ZAP 2.16.1 (escaneo activo con la sesión de cada uno de los cuatro roles: 24 497 peticiones de ataque), un navegador de verdad y revisión a mano (Codex, encargo 40) | **Una cosa real, de gravedad media: el proxy alcanzaba la base.** Arreglada del todo (abajo). **Tres mejoras de gravedad baja**, hechas (abajo). Ningún hallazgo alto ni crítico |

## Lo que se arregló

- **Next.js 16.3.8 → 16.4.5** (`774d40d`). El sistema no usaba ninguna de las tres partes con avisos
  (imágenes optimizadas con SVG, «use cache», Server Actions), pero el punto de optimización de
  imágenes existe aunque no se use.
- **Cada contenedor de operación corre con lo mínimo** (`a3f2776`): todos con `no-new-privileges`;
  los de Node sin ninguna capacidad del núcleo; el proxy solo con la de abrir los puertos 80 y 443;
  la base conserva las suyas porque su imagen oficial cambia de usuario al arrancar. Una prueba lo
  vigila (`pruebas/20-entorno`).
- **Las imágenes base, al día y sin lo que no se usa** (`508157c`): huellas de hoy de
  `node:24-alpine`, `caddy:2-alpine` y `postgres:17-alpine` (misma serie mayor); fuera npm, yarn y
  corepack de las imágenes finales (todos los avisos de Node estaban ahí); rclone a la versión
  arreglada; al proxy, `apk upgrade` (brotli tenía uno crítico) y sin curl, que no usa. Resultado:
  **la aplicación, la de administración y la del respaldo, sin avisos** (ni medios, con Trivy y Grype).
- **Caddy, compilado aquí con el Go de hoy** (`26d7abf`): el binario de la imagen oficial (2.11.7, la
  última) estaba hecho con un Go y una librería de red con avisos altos y uno crítico, y es la pieza
  que da a internet. Ahora la imagen del proxy compila esa misma versión con Go 1.27.3 y las
  librerías de red y de cifrado al día (lo que baja lo comprueba Go contra sum.golang.org). Tarda
  unos 18 minutos la primera vez; después lo reusa la caché. Trivy: sin avisos altos ni críticos.
- **Fuera `age-inspect`** de la imagen del respaldo: no se usa, y su código de SSH traía dos avisos
  altos (Grype).
- **El latido ya no avisa por un tropiezo suelto** (`10f1f49`): lo mostró un ensayo con la máquina
  cargada; ahora pregunta otra vez a los 15 segundos antes de dar falla.

- **El proxy no alcanza la base** (R40-01, lo encontró Codex con nmap). Antes, con una sola red, quien
  tomara el proxy —lo que da a internet— tenía la base a la mano (con su clave, pero a la mano). Se
  arregló en dos pasos:
  - la red de operación va en dos (`2cefb71`): el frente (proxy y aplicación) y el fondo (aplicación,
    base, migración, consola). Desde el proxy, el nombre de la base ya no existe;
  - y la base ya no se publica en la máquina (`2f69945`). Codex, al verificar, encontró que el proxy
    seguía llegando a su puerto **por dirección** mientras el Compose base la publicara en 127.0.0.1
    (eso es para desarrollo); lo aisló quitando solo esa publicación, y volviéndola a poner. En
    operación ahora solo publica el proxy; la aplicación tampoco se publica.
  Y para que no vuelva (`1ff5650`): la comprobación que corre cada publicación aceptaba cualquier
  puerto publicado solo en la máquina; ahora rechaza que publique, ni en 127.0.0.1, otro servicio que
  no sea el proxy, y dice cuál. El ensayo lo comprueba con Docker de verdad: nadie más que el proxy
  publica; el proxy no resuelve la base ni llega a su puerto; la aplicación, sí.
- **Las cabeceras con que el sitio le dice al navegador qué no permitir** (R40-02, R40-03 y R40-04,
  de gravedad baja; `7447d9a`):
  - **política de contenido completa en cada página** (antes solo negaba los marcos): solo corren los
    scripts que llevan el nonce de esa respuesta —uno nuevo cada vez, que pone `src/proxy.ts`—, nada
    de otro sitio, sin objetos incrustados, sin `<base>`, formularios solo al mismo sitio. Si alguien
    lograra colar HTML con un script en un nombre, el navegador no lo correría. Los estilos en línea
    sí se permiten: las pantallas usan el atributo style, y un estilo no ejecuta nada;
  - **`nosniff` en todo**: el navegador no adivina el tipo de una respuesta;
  - **lo de la API no se guarda en ningún caché** (`Cache-Control: private, no-store`), y su política
    de contenido no permite nada: son datos, nunca una página.
  Lo vigilan `pruebas/60-cabeceras` y `recorrido/cabeceras.spec.ts`, en Chromium y en WebKit: cada
  pantalla llega con su nonce, se arma completa y el navegador no le niega nada; y un HTML colado con
  `onerror` no corre.
- **Las cabeceras, también en los rincones** (lo que encontró Codex al verificar lo anterior, encargo
  41; `3e96766`):
  - **ninguna página sale sin su política** (R41-01, Codex la calificó media; no hubo XSS real, los
    nombres seguían como texto): la regla de qué es una página dejaba fuera todo lo que *empezara*
    con «api», «favicon.ico» o «_next/image» (`/apicualquiera` salía como página 404 sin política), y
    lo pedido por adelantado (con `Purpose: prefetch`, Next arma la página entera, y salía sin
    política). Ahora solo quedan fuera exactamente `/api/` y lo construido (`/_next/static/`); y una
    política que diga quien pide se reemplaza siempre por la nueva;
  - **lo que Next contesta antes de poner sus cabeceras** (R41-02, baja): la redirección que le quita
    la barra final a una ruta salía sin `nosniff`, y en la API sin la regla de caché. Ahora las pone
    también el proxy de operación (Caddy) en todo; las que la aplicación ya pone, el proxy las
    reemplaza por las mismas (sin `defer` salían dobles: se probó con Caddy de verdad), y la
    política de cada página y el caché de cada respuesta los sigue decidiendo la aplicación;
  - la política de la API dice además `base-uri` y `form-action` (ZAP avisaba que no caen en
    `default-src`).
  Lo vigilan `recorrido/cabeceras.spec.ts` (páginas que no existen, rutas que solo empiezan como la
  API, lo pedido por adelantado y una política elegida por quien pide) y, por el proxy de verdad,
  `recorrido/operacion.spec.ts` en el ensayo.
- **La comprobación por HTTPS con dos plazos** (`2cefb71`): uno de silencio (10 s) y uno total, más
  holgado; con uno solo, un sitio lento pero que contesta se daba por caído a media publicación.
- **El modo detrás de otro proxy, revisado por Codex** (encargo 43, 8 de noviembre;
  `docs/revisiones/2026-11-08-codex-detras-de-otro-proxy-43.md`). Lo que encontró, arreglado con su prueba:
  - *la red compartida se reconocía por su clave y no por su nombre en Docker* (R43-01, alta): con
    otra clave del mismo nombre sin «external», la base podía quedar junto al otro proxy y la
    comprobación pasaba según el orden de las declaraciones. Ahora cuenta el nombre, en cualquier orden;
  - *un nombre de red con blancos se revisaba como varios* (R43-02): ahora se exige uno solo, de
    letras, números, «_», «.» y «-»;
  - *al retomar una publicación, o al volver a un respaldo ya empezado, no se revisaba otra vez la
    red* (R43-03): ahora se revisa en cada camino que levanta el proxy, antes de tocar nada;
  - *una salud guardada por algo de en medio pasaba por nueva* (R43-04): cada pregunta del latido y
    de las comprobaciones lleva un reto al azar que la salud repite;
  - *el ensayo de publicación mataba cualquier `publicar.sh` de la máquina* (R43-05): ahora solo el
    que lanzó él, así que se puede correr en el servidor sin tocar una publicación de verdad;
  - *la guía no decía cómo pasar de un servidor compartido a uno propio* (R43-06): sección 7;
  - *`network_mode: bridge` se aceptaba* (R43-07): es la red general de Docker, donde cualquier otro
    contenedor del servidor llega por dirección; ahora se rechaza.
- **Topes de memoria, CPU y procesos en cada servicio** (Docker Bench en el servidor, 10 de
  noviembre): ahí vive otra aplicación, y sin topes, algo de feruga que se desbocara podía dejarla
  sin memoria. Lo exige `pruebas/20-entorno.test.ts` y lo comprueba el ensayo en los contenedores
  que corren, también en lo que se corre suelto. Codex los midió con un año de datos de prueba
  (encargo 44, `docs/revisiones/2026-11-10-codex-topes-de-recursos-44.md`): ninguno se queda corto.
  Lo que encontró, arreglado:
  - *se prometía que siempre le queda CPU a la otra aplicación* (R44-01): un tope no es una reserva;
    se corrigió lo que dicen la prueba, el Compose y la guía;
  - *memoria de intercambio aparte por omisión* (R44-02): ahora es la misma que el tope;
  - *los contenedores de ayuda de los guiones corrían sin tope* (R44-03): ahora con 256 MB y medio
    procesador. La construcción de las imágenes queda fuera: la guía pide publicar en horas tranquilas;
  - *una corrida del respaldo que muere sin terminar dejaba sus temporales* (R44-04), entre ellos el
    volcado sin cifrar, y con cada caída se acumulaban: el servicio los quita al arrancar.
- **Publicar una versión que cambia el servidor de la base** (10 de noviembre;
  `docs/planes/2026-11-10-cambiar-el-servidor-de-la-base.md`): antes publicar se negaba siempre, y
  sin otro camino un parche de seguridad de PostgreSQL no se podía aplicar sin reinstalar. Ahora se
  acepta con la misma versión mayor y el mismo sistema de la imagen, con el negocio cerrado y
  después del respaldo; recuperar y volver al respaldo regresan al servidor de antes. Codex revisó
  el plan y el código (encargo 45, `docs/revisiones/2026-11-10-codex-cambiar-el-servidor-de-la-base-45.md`),
  y lo que encontró se arregló con su prueba: que la base corra antes de preguntarle nada (R45-01)
  y que conteste (R45-02); el mismo sistema de la imagen, no solo la misma mayor (R45-03); el orden
  de recrear después de esperar todo lo que quedó, vigilado por una prueba (R45-04); los
  comentarios (R45-05); y que no poder preguntar a Docker no se tome por «no corre» (R45-06).

### Lo que Codex encontró bien en el sitio en marcha (encargo 40)

Solo contestan 80 y 443 (el puerto de administración de Caddy, cerrado); HTTPS con TLS 1.2 y 1.3,
cifrados modernos y HSTS (testssl: A+); ningún rol hace lo de otro, y consulta no escribe; lo que
escribe exige su Origin y rechaza los ausentes, nulos, ajenos o disfrazados; cinco claves mal tecleadas
bloquean incluso la buena, y se desbloquea a los cinco minutos; el código de alta no se usa dos veces,
ni a la vez; las sesiones vencen (30 minutos sin uso, 12 horas en total) y salir las cierra; dar de
baja un equipo deja fuera su cookie; lo tecleado con comillas o SQL se guarda como texto, sin errores
ni trazas; reenviar una cuenta con el mismo identificador no la duplica. En un navegador de verdad,
nombres de cliente y de material con `<script>`, con `<img onerror>` y con etiquetas se ven como
texto en diez vistas (mostrador, comprobante, panel, ajustes, bitácora) y no ejecutan nada. Los
avisos altos automáticos de ZAP (un «recorrido de archivos» y tres «XSS persistente en JSON») se
comprobaron a mano: falsos positivos. Informe completo, con las órdenes para repetirlo:
`docs/revisiones/2026-11-05-codex-seguridad-del-sitio-en-marcha.md`; sus sondas, en
`docs/revisiones/sondas-40/` (dependen de la instalación de prueba que ellas mismas levantan).

Al verificar lo arreglado (encargo 41), Codex confirmó cerrado R40-01 (nmap: el 5432 de la base,
filtrado desde el frente, desde la red del proxy y desde el proxy mismo; abierto solo desde el fondo;
y la publicación se niega con la base o la aplicación en 127.0.0.1, diciendo cuál); en 54 páginas y
588 scripts, ninguno sin el nonce de su respuesta; diez vistas sin ninguna violación de la política;
el HTML colado, negado; ningún uso en el código de `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni
parecidos. Lo que dejó parcial son los rincones de arriba. ZAP pasivo con la sesión de responsable:
lo de `style-src 'unsafe-inline'` es lo aceptado (los atributos style); los avisos de caché son
informativos (`no-store` ya prohíbe guardar). Informe:
`docs/revisiones/2026-11-05-codex-verificacion-de-seguridad-41.md`; sondas en `docs/revisiones/sondas-41/`.

Y al verificar esos rincones (encargo 42), Codex los dio por cerrados: en 134 páginas y 1 412
scripts, ninguno sin el nonce de su respuesta; las precargas, `/apicualquiera` y `favicon.ico`, con
su política; ninguna cabecera doble; las redirecciones con las suyas, también por HEAD y OPTIONS; los
errores 500 de verdad, con política y `nosniff`; diez vistas sin ninguna violación. Lo único nuevo es
la respuesta a una dirección mal escrita (abajo, en lo aceptado). Informe:
`docs/revisiones/2026-11-05-codex-verificacion-de-seguridad-42.md`; sondas en `docs/revisiones/sondas-42/`.

## Lo que se aceptó, y por qué

- **rclone** (el de Alpine, 1.75.2): Grype marca avisos en su lector de HTML y en su servidor web
  (`rclone serve`); aquí solo se usa para mandar al almacenamiento S3, que no pasa por ninguno de los
  dos.
- **gosu, en la imagen oficial de PostgreSQL** (Trivy marca avisos de Go en él): gosu solo cambia de
  usuario al arrancar la base; no lee nada de la red ni de quien usa el sistema, así que esos avisos
  no se alcanzan por él. Se revisa en cada actualización de la imagen.
- **Paquetes de Alpine sin versión fija** (hadolint DL3018): las imágenes base van por su huella; los
  paquetes que se instalan encima (cliente de PostgreSQL, age, rclone) se dejan libres a propósito,
  para que tomen arreglos de seguridad al construir. Fijarlos rompe la construcción cuando Alpine
  retira la versión.
- **La compresión (BREACH, de testssl)**: el proxy comprime, y hay respuestas que reflejan algo que
  se escribe (un nombre) junto a datos privados. Pero en ninguna respuesta comprimida va un secreto
  que sirva para entrar: la cookie va en la petición, y las respuestas que dan un PIN o un código
  nuevos son cortas y van sin comprimir (Codex las midió: 98, 16 y 23 bytes). Además, la cookie es
  `SameSite=Strict`: otro sitio no puede hacer peticiones con ella, que es lo que el ataque necesita
  (Codex lo comprobó en el navegador). Si algún día una respuesta llevara un secreto junto a algo
  que se escribe, hay que revisarlo.
- **Lo que testssl dice del certificado del ensayo** (sin CRL ni OCSP, cerca de vencer): es el de la
  autoridad desechable del ensayo. El de verdad se revisa en el servidor (abajo).
- **Estilos en línea en la política de las páginas** (`style-src 'unsafe-inline'`, ZAP lo marca): las
  pantallas usan el atributo style, que no puede llevar nonce. Un estilo no ejecuta nada; los
  scripts sí van con nonce. Quitarlo pide pasar esos estilos a clases, pantalla por pantalla.
- **La respuesta a una dirección mal escrita** (R42-01, de Codex, baja): pedir `/%` o `/%ZZ` da
  `400 Bad Request` en texto plano, sin las cabeceras de seguridad. Es la respuesta fija del servidor
  HTTP de Go —con el que está hecho Caddy— cuando no puede ni leer la petición (coincide letra por
  letra), y sale antes de que corra ninguna regla de Caddy: no hay dónde ponérselas. No es HTML,
  no repite nada de lo pedido, no lleva datos y cierra la conexión.
- **HEALTHCHECK en los Dockerfile** (Checkov CKV_DOCKER_2): las comprobaciones de salud están en el
  Compose, donde la operación las usa.
- **Usuario propio** (Checkov CKV_DOCKER_3): la aplicación, la de administración y la del respaldo ya
  corren como `node`; la base cambia de usuario sola; el proxy corre como root pero sin capacidades
  salvo abrir puertos (arriba). Las demás imágenes (pruebas, recorridos, el almacenamiento de
  mentira) no van al servidor. SonarQube marca lo mismo (docker:S6471).
- **Lo demás que marca SonarQube**, revisado aviso por aviso:
  - *una «clave» en `db/plantilla.ts`* (S6698): es la dirección por omisión de la base de
    desarrollo, en esta máquina; en operación la comprobación del entorno rechaza las de desarrollo.
    Y *una «contraseña comprometida» en `operacion/destino.ts`* (S6437): es la etiqueta pública con
    que se deriva la clave del sello, no un secreto (lo mismo que semgrep, arriba);
  - *ordenar sin función de comparación* (S2871): son nombres de migración (`0044_…`) y fechas
    (`AAAA-MM-DD`), donde el orden de los caracteres es justo el correcto; comparar «según el idioma»
    lo haría depender de la configuración de la máquina. En `publicacion.ts` se ordenan las dos listas
    igual solo para compararlas;
  - *expresiones regulares que podrían tardar* (S8786: quitar las barras o los ceros del final, la
    forma de un correo): todos sus textos vienen del `.env` de la instalación o de un precio de la
    base; nadie de fuera puede dárselos;
  - *un `try` junto a `.catch()`* en `pestana.ts` (S4822): el `try` atrapa lo que falla antes de que
    haya promesa (un navegador sin candados); *`autoFocus`* (S9379) en el nombre de una cuenta, que
    aparece justo cuando se pidió cambiarlo; *un objeto como valor por omisión* (S7737), que se crea
    en cada llamada.

- **Detrás de otro proxy** (7 de noviembre; `docs/operacion.md`, 2.1 bis): en el servidor contratado
  vive otra aplicación, y su proxy tiene 80 y 443. El de feruga va detrás de él, por una red interna
  de Docker que solo comparten los dos proxies. Lo que se acepta: **ese otro proxy tiene el
  certificado y ve el tráfico de feruga descifrado**, también la credencial del comprobador (que
  solo da la versión, el esquema y la marca de la base); y si se cae, feruga queda fuera. Lo que no
  cambia: feruga no publica ningún puerto; el otro solo alcanza al proxy de feruga, no a la
  aplicación ni a la base (lo comprueba el ensayo, por nombre y por dirección); el proxy de feruga
  pone las mismas cabeceras, HSTS incluida, y no redirige; y cada publicación revisa que así esté
  (`operacion/comprobar.ts`). La aplicación no usa la dirección del cliente (los bloqueos por claves
  equivocadas son por cuenta), así que pasar por otro proxy no le quita nada.

## Lo pendiente

- **En el servidor de verdad**: nmap desde fuera contra su dirección (solo deben contestar 22, 80 y
  443/TCP), testssl contra el dominio con su certificado real, y una revisión del servidor mismo
  (Lynis, Docker Bench). Va en la lista de la guía (`docs/operacion.md`, sección 10). Con el proxy
  detrás de otro, testssl revisa el certificado y el cifrado que pone ese otro.
