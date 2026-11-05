# Seguridad: lo que se revisó, lo que se arregló y lo que se aceptó

Revisión del 4 de noviembre de 2026, con el sistema terminado y antes del servidor de verdad. Todo
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
| El sitio en marcha, como lo ve alguien de fuera | OWASP ZAP, nmap, testssl, y revisión a mano de la entrada con clave, sesiones y roles | **Pendiente**: lo hace Codex (encargo 40) en cuanto tenga cuota |

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
- **HEALTHCHECK en los Dockerfile** (Checkov CKV_DOCKER_2): las comprobaciones de salud están en el
  Compose, donde la operación las usa.
- **Usuario propio** (Checkov CKV_DOCKER_3): la aplicación, la de administración y la del respaldo ya
  corren como `node`; la base cambia de usuario sola; el proxy corre como root pero sin capacidades
  salvo abrir puertos (arriba). Las demás imágenes (pruebas, recorridos, el almacenamiento de
  mentira) no van al servidor.

## Lo pendiente

- **El sitio en marcha** (ZAP, nmap, testssl y la revisión a mano): Codex, encargo 40.
- **En el servidor de verdad**: nmap desde fuera contra su dirección (solo deben contestar 22, 80 y
  443/TCP), testssl contra el dominio con su certificado real, y una revisión del servidor mismo
  (Lynis, Docker Bench). Va en la lista de la guía (`docs/operacion.md`, sección 10).
