# Seguridad: lo que se revisó, lo que se arregló y lo que se aceptó

Revisión del 4 y 5 de noviembre de 2026, con el sistema terminado y antes del servidor de verdad. Todo
corre en contenedores, contra copias propias (nunca contra la demostración ni contra nada de fuera).
Para repetir la parte automática: `sh seguridad/escanear.sh` (solo pide Docker; las salidas quedan
en `seguridad/informes/`, fuera de Git). Se corre antes de publicar una versión.

## Lo que se revisó

| Qué | Con qué | Resultado |
|---|---|---|
| Secretos en todo el historial de Git, y en toda la carpeta `feruga` (también lo que no está en Git) | gitleaks 8.30.1 | **Ninguno.** Los cinco avisos eran valores de mentira de las pruebas; `.gitleaks.toml` los exceptúa por valor, no por archivo |
| Librerías con avisos publicados | OSV-Scanner 2.7.0, npm audit | **Next.js 16.3.8 tenía tres** (dos de ejecución remota sin sesión, uno de negación de servicio): se subió a 16.4.5. Después, ninguno |
| El código | semgrep 1.182.1 (reglas de TypeScript, Node, React, Next.js, secretos, Docker, inyección SQL) | **Nada real en el código del sistema.** Los avisos estaban en pruebas y recorridos (expresiones regulares de valores que la misma prueba pone) y uno era la etiqueta pública del sello, que no es un secreto |
| Los Dockerfile y el Compose de operación | hadolint 2.15.1, Checkov 3.4.3 | **Los contenedores conservaban los privilegios de Docker por omisión**: se endurecieron (abajo). Lo demás, aceptado (abajo) |
| Las imágenes de operación | Trivy 0.76.1, Grype 0.121.1 | **Bases desactualizadas y npm adentro**: se arreglaron (abajo). Quedan los de Caddy, gosu y rclone (abajo) |
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
- **La comprobación por HTTPS con dos plazos** (`2cefb71`): uno de silencio (10 s) y uno total, más
  holgado; con uno solo, un sitio lento pero que contesta se daba por caído a media publicación.

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
- **HEALTHCHECK en los Dockerfile** (Checkov CKV_DOCKER_2): las comprobaciones de salud están en el
  Compose, donde la operación las usa.
- **Usuario propio** (Checkov CKV_DOCKER_3): la aplicación, la de administración y la del respaldo ya
  corren como `node`; la base cambia de usuario sola; el proxy corre como root pero sin capacidades
  salvo abrir puertos (arriba). Las demás imágenes (pruebas, recorridos, el almacenamiento de
  mentira) no van al servidor.

## Lo pendiente

- **En el servidor de verdad**: nmap desde fuera contra su dirección (solo deben contestar 22, 80 y
  443/TCP), testssl contra el dominio con su certificado real, y una revisión del servidor mismo
  (Lynis, Docker Bench). Va en la lista de la guía (`docs/operacion.md`, sección 10).
