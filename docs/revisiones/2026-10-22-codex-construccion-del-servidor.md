# Informe 34: preparación y ensayo de servidor

Estado: terminado; ensayo completo aprobado (código 0). Trabajo autorizado únicamente en `/tmp/feruga-codex-qa14/`; informe en `/tmp/feruga-codex-informe-34.md`. No se modificarán los archivos del proyecto original ni sus contenedores. No se instalarán dependencias npm.


## Resultado final

Se entregan exclusivamente estos dos archivos, ejecutables y en sh POSIX, dentro de la copia de trabajo:

- `/tmp/feruga-codex-qa14/operacion/servidor.sh`
- `/tmp/feruga-codex-qa14/operacion/ensayo-servidor.sh`

No se editó la guía ni ningún Compose; tampoco se instalaron dependencias npm. No hubo escrituras dentro de `/Users/maantora/Desktop/feruga`, ni operaciones sobre los contenedores o la base del usuario. Se trabajó en una sola construcción, con corridas secuenciales para corregir los dos defectos encontrados durante su ejecución: expresiones señaladas por ShellCheck y formato de las reglas de ufw. Las salidas completas, incluidas las corridas fallidas, están más abajo.

La ejecución final terminó con código **0**. ShellCheck **0.10.0** no encontró avisos en los dos archivos nuevos. Ubuntu **24.04 arm64** instaló Docker Engine **29.9.2**, Compose **5.6.1** y todos los paquetes pedidos. Se verificaron rotación, cuatro reglas para cada familia IP, seguridad automática, usuario agregado mediante `sudo` real y SSH. La segunda corrida informó **«No hay nada que cambiar.»**. La huella de contenido y metadatos de `/etc` fue idéntica antes y después:

```text
a727ee0ae60225f48ba68da4cea512dffb260261245378f1402ac32ada2abd73
```

También pasó la repetición con `--quitar-contrasenas`. El rechazo sin llave y el rechazo por `daemon.json` incompatible conservaron `/etc` intacto. Se comprobaron llave SSH malformada, configuración SSH inválida, precedencia que impide desactivar contraseñas y retirada del archivo nuevo, llave Docker ilegible, regla adicional de ufw y exclusión por candado. Son casos negativos con alteraciones deliberadas; **no se hizo una campaña de mutación de cada comprobación positiva** (por ejemplo, retirar paquetes uno a uno, sustituir una llave GPG por otra válida con huella diferente, o falsear cada ajuste de APT).

Al terminar se comprobó `docker ps -a --filter name=codex-servidor-`: **ningún contenedor restante**. La limpieza de Ubuntu usa `docker rm -f`; ShellCheck usa `--rm` y tiene además limpieza de respaldo con `docker rm -f`. Las imágenes descargadas quedan en la caché de Docker; no se borran imágenes compartidas.

## Cómo correrlo

En esta máquina, solo se requiere Docker disponible y acceso a los registros/repositorios de paquetes:

```sh
cd /tmp/feruga-codex-qa14
sh operacion/ensayo-servidor.sh
```

En Ubuntu 24.04 real, desde la carpeta del repositorio que contiene `operacion/`:

```sh
sudo sh operacion/servidor.sh
# Solo después de probar otra conexión con llave:
sudo sh operacion/servidor.sh --quitar-contrasenas
```

Como root se omite `sudo`. **No poner `ENSAYO_SERVIDOR=1` en el servidor real.** Esa variable se admite solo dentro de un contenedor Docker sin systemd. El ensayo prepara sudo/OpenSSH y una cuenta con llave dentro de su contenedor; el guion del servidor presupone el acceso SSH existente del Ubuntu contratado y no instala ni reconfigura OpenSSH sin la opción.

## Decisiones y alcance

- Se valida el sistema operativo antes de cambiarlo y se usa `flock` en `/run/lock/feruga-servidor.lock`. `flock` viene en el Ubuntu base; si una imagen excepcional no lo incluye, se explica que hay que instalar `util-linux` antes. Ese paquete también se comprueba en el conjunto obligatorio. El nombre fijo del contenedor evita dos ensayos simultáneos y no se borra un contenedor preexistente de otra corrida.
- APT solo instala los paquetes que faltan: no se ejecuta una actualización general en cada repetición. Se usa el repositorio oficial Docker, suite `noble`, arquitectura detectada y `Signed-By`. La llave se descarga por HTTPS, se examina en un directorio GPG temporal y su única huella primaria debe ser `9DC858229FC7DD38854AE2D88D81803C0EBFCD88` antes de escribirla como llave confiable. Una llave ya existente también se verifica.
- Además de lo pedido, se instala el plugin Buildx, parte de la instalación oficial y útil para las construcciones de `publicar.sh`. No se instala Node, PostgreSQL ni herramientas de la aplicación en el anfitrión.
- Los archivos administrados se comparan byte por byte. Un `daemon.json` equivalente con otro formato se considera distinto y se rechaza, como decisión conservadora. Tampoco se pisan fuentes de APT, archivo de SSH ni archivos de actualizaciones con contenido incompatible. Los paquetes Docker incompatibles no se desinstalan automáticamente.
- La rotación es `json-file`, `10m`, `3`. El archivo se escribe antes de instalar Docker; si Docker ya estaba activo y se crea su configuración por primera vez, se reinicia para aplicarla. Está destinado a un servidor recién contratado: no es una migración de un anfitrión con contenedores existentes. La rotación predeterminada no modifica contenedores creados anteriormente.
- ufw conserva sus reglas estándar de sistema (por ejemplo, tráfico establecido e ICMP); las únicas aperturas de servicios creadas son `22/tcp`, `80/tcp`, `443/tcp`, `443/udp`, para IPv4 e IPv6. Las políticas son entrada y reenvío denegados, salida permitida. Ante reglas de usuario adicionales se detiene sin borrarlas; requiere `IPV6=yes` y, si SSH está instalado, comprueba que su puerto sea 22. No pretende auditar modificaciones manuales arbitrarias de todas las cadenas del núcleo o archivos internos de ufw.
- `20auto-upgrades` activa la actualización de índices y las actualizaciones desatendidas; `52feruga-seguridad` delimita los orígenes a seguridad de Ubuntu y ESM cuando corresponda. Fuera del ensayo se habilitan/inician Docker, unattended-upgrades, los dos temporizadores APT y ufw. Dentro del ensayo se omiten los servicios y la activación del cortafuegos, y se anuncia. `policy-rc.d` impide también arranques indirectos durante APT.
- SSH requiere una llave pública válida en el `authorized_keys` de la cuenta y permisos/dueños compatibles con StrictModes. El archivo temprano `00-feruga.conf` desactiva tanto contraseña como autenticación interactiva y conserva llave pública. Se ejecuta `sshd -t` y se consulta `sshd -T -C` para la cuenta y conexión; se rechazan métodos que requieran otro factor, una ruta distinta para llaves o root prohibido. Si el archivo nuevo no supera la validación, se retira; si falla recargar en real, se intenta volver a cargar la configuración anterior. Sin la opción no se escribe ningún archivo SSH.
- La validación estática no demuestra que la persona tenga la llave privada correcta ni sustituye una conexión remota: opciones de la llave, restricciones de cuenta, PAM, `Match` para otros orígenes y la red pueden afectar el acceso. Por eso la segunda conexión real con llave y conservar consola/sesión son pasos obligatorios de la guía antes de usar la opción.
- Los mensajes propios están en español. Las salidas de APT, Docker, ufw, sshd y ShellCheck se conservan tal como las emiten las herramientas. El ensayo no publica puertos, no monta el socket Docker dentro de Ubuntu, no usa `--privileged` ni red del anfitrión. La carpeta de guiones se monta de solo lectura únicamente para ShellCheck.

## Pendiente de probar en el servidor real

No se ejecutaron las ramas con systemd ni hubo una conexión SSH real. Falta comprobar habilitación y arranque de los servicios, recarga y acceso por llave/denegación de contraseña desde una segunda máquina, políticas efectivas de ufw desde fuera por IPv4 e IPv6, puertos del proxy (incluido UDP 443), reinicio y persistencia después de apagar/encender. También falta observar una actualización de seguridad realmente ejecutada por el temporizador y que Docker rote registros de un contenedor nuevo.

Siguen vigentes las restantes condiciones de la tarea 7: dominio/certificado, B2, alertas, publicación, respaldos/restauración, etc. Este ensayo no las sustituye y no tocó ninguna base. El aviso de ufw `initcaps / Permission denied` dentro del contenedor es esperado sin capacidades del núcleo; las reglas persistidas sí se comprobaron.

## Texto propuesto para reemplazar únicamente la sección 2.1

### 2.1 El servidor — preparación ensayada; acceso y arranque por probar en el servidor

Se usa **Ubuntu 24.04 LTS recién contratado**, con acceso de administración por SSH y la consola del proveedor disponible. El guion prepara la máquina; la aplicación y PostgreSQL 17 se instalarán después con Docker Compose.

**Git se instala a mano antes de clonar**, porque el guion está dentro del repositorio:

```sh
sudo apt-get update
sudo apt-get install -y git
git clone <el repositorio> feruga
cd feruga/sistema
sudo sh operacion/servidor.sh
```

La carpeta desde la que se ejecuta es la que contiene `operacion/` y los archivos de Compose; si el repositorio se clonó en otra ruta, se entra ahí. Si ya estaba clonado, se omiten la instalación inicial de Git y el clon. Como root, se omite `sudo`.

El guion instala certificados, curl, GnuPG, Git, ufw, actualizaciones de seguridad automáticas, util-linux y Docker Engine con los plugins Compose y Buildx desde el repositorio oficial de Docker. Antes de confiar en su llave, verifica su huella completa: `9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88`, y la guarda en `/etc/apt/keyrings/docker.asc`.

Deja Docker con registros `json-file` de hasta `10m` por archivo y tres archivos por contenedor nuevo. Si `/etc/docker/daemon.json` ya existe con otro contenido, se detiene y no lo pisa. Deja ufw con entrada denegada, salida permitida y estas aperturas: **22/tcp, 80/tcp, 443/tcp y 443/udp**, tanto para IPv4 como para IPv6. Ante reglas adicionales se detiene para revisarlas; no las borra. Activa Docker, el cortafuegos y las actualizaciones automáticas de seguridad.

**Docker publica puertos por fuera de ufw.** En este sistema solo el proxy debe publicar; eso ya lo verifica `operacion/comprobar.ts` al publicar la aplicación. El cortafuegos no sustituye esa comprobación.

Si se ejecutó con `sudo`, agrega a esa persona al grupo `docker`: **eso la hace administradora del servidor**. Hay que volver a entrar para que la nueva pertenencia al grupo se aplique.

**La primera corrida no cambia SSH.** Antes de quitar las contraseñas:

1. Deja una llave pública válida en `~/.ssh/authorized_keys` de la cuenta con que entras (`root` o la persona que usa `sudo`), con dueño correcto y sin permisos de escritura para otros; normalmente `.ssh` lleva `700` y `authorized_keys`, `600`.
2. Conserva la sesión actual y comprueba que tienes acceso a la consola del proveedor. Desde otra terminal, prueba una **segunda conexión usando solo la llave**:

   ```sh
   ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no usuario@servidor
   ```

3. Solo cuando esa conexión funcione, desde la misma cuenta de administración ejecuta:

   ```sh
   sudo sh operacion/servidor.sh --quitar-contrasenas
   ```

Se niega si esa cuenta no tiene una llave válida. Escribe `/etc/ssh/sshd_config.d/00-feruga.conf`, desactiva contraseña y autenticación interactiva, conserva llave pública y comprueba con `sshd -t` y la configuración efectiva antes de recargar. Si la configuración rechaza el cambio nuevo, retira el archivo. Después vuelve a comprobar otra conexión con llave antes de cerrar las sesiones que ya están abiertas. La presencia de un archivo de llaves por sí sola no acredita que puedas entrar.

Se puede volver a ejecutar: si lo que pide ya está instalado y configurado, dice **«No hay nada que cambiar.»**. El ensayo automático, que solo necesita Docker, se corre en una computadora de desarrollo con `sh operacion/ensayo-servidor.sh`; usa Ubuntu desechable, ejecuta el guion dos veces y compara `/etc`. Allí `ENSAYO_SERVIDOR=1` omite encender servicios, activar ufw y recargar SSH. **Esa variable no se usa en el servidor de verdad.**

**Por probar en el servidor:** acceso por llave y rechazo de contraseñas desde otra máquina, puertos desde fuera por IPv4 e IPv6, ejecución de las actualizaciones, rotación real de registros y que todo vuelva a arrancar después de reiniciar. Hasta comprobarlo, la tarea 7 sigue pendiente.

El repositorio **ya está clonado**. Continúa con `sh operacion/entorno.sh <dominio>` y la sección **2.4**, omitiendo allí la orden de clonar otra vez. Guarda el `.env` terminado en el paquete de recuperación según la sección 1. Este guion todavía no publica la aplicación.

---

Nota editorial (fuera del texto propuesto): por la restricción de crear solo dos guiones, no se corrigieron las referencias ahora obsoletas a «sin escribir» en la sección 10 ni la casilla pendiente de la tarea 6. La sección 2.4 conserva su clon; el texto propuesto indica expresamente omitirlo. La documentación existente permanece intacta.

## Pasos y resultados

1. Informe creado antes de comenzar. Pendiente: leer documentación y guiones, construir los dos archivos autorizados, ejecutar un solo ensayo a la vez y registrar resultados.

2. Leídas las secciones 1, 2.1, 2.4 y 10 de la guía, restricciones y tareas 6 y 7 del plan, y los guiones entorno/publicar/ensayo. No hay AGENTS.md aplicable en la copia. La copia no tiene `.git`; no se inventará uno. Docker Desktop está disponible (Linux arm64).

Decisiones iniciales: usar `flock` del Ubuntu base; comprobar Ubuntu 24.04 y root; no actualizar paquetes ya instalados en la repetición; rechazar configuraciones administradas incompatibles y reglas adicionales de ufw, sin borrarlas. SSH se validará con `sshd -t` y configuración efectiva, con retirada del archivo nuevo si falla. El ensayo no arranca Docker dentro de Docker ni publica puertos. Se conserva la separación entre preparar el servidor y publicar la aplicación.

Referencia consultada: [instalación oficial de Docker en Ubuntu](https://docs.docker.com/engine/install/ubuntu/), para repositorio, paquetes y la limitación de ufw. La huella esperada es la indicada explícitamente por el usuario; se contrastará con la llave descargada antes de instalarla.

3. Creados únicamente `operacion/servidor.sh` y `operacion/ensayo-servidor.sh` en la copia. Incluyen comprobaciones de paquetes, huella de llave, configuración Docker, reglas IPv4/IPv6, seguridad automática, grupo docker, SSH con reversión y candado. El ensayo comprueba también rechazos y usa una huella de `/etc` con contenido, permisos, dueños, tipos, enlaces y tiempos de modificación/cambio (no atime). Pendiente: ejecutar y corregir los defectos que aparezcan.

## Salida del ensayo: primera ejecución

```text
Unable to find image 'ubuntu:24.04' locally
24.04: Pulling from library/ubuntu
d5aec63251bb: Pulling fs layer
99fcc9c4b770: Download complete
d5aec63251bb: Download complete
d5aec63251bb: Pull complete
Digest: sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
Status: Downloaded newer image for ubuntu:24.04

== ShellCheck 0.10.0: los dos guiones nuevos deben pasar sin advertencias
Unable to find image 'koalaman/shellcheck:v0.10.0' locally
v0.10.0: Pulling from koalaman/shellcheck
1075cd14fc2f: Pulling fs layer
8eb87b5ce1a8: Pulling fs layer
fc1e995e2684: Download complete
8eb87b5ce1a8: Download complete
8eb87b5ce1a8: Pull complete
1075cd14fc2f: Download complete
1075cd14fc2f: Pull complete
Digest: sha256:2097951f02e735b613f4a34de20c40f937a6c8f18ecb170612c88c34517221fb
Status: Downloaded newer image for koalaman/shellcheck:v0.10.0

In operacion/servidor.sh line 21:
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || falla "hace falta Ubuntu 24.04 LTS."
                   ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.


In operacion/servidor.sh line 25:
  [ -f /.dockerenv ] && [ ! -d /run/systemd/system ] || falla "el ensayo requiere un contenedor sin systemd."
                     ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.


In operacion/servidor.sh line 60:
    [ -f "$2" ] && cmp -s "$1" "$2" || falla "$2 ya existe con otro contenido; no se pisa."
                ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.


In operacion/servidor.sh line 86:
  command -v ssh-keygen >/dev/null 2>&1 && command -v sshd >/dev/null 2>&1 \
                                        ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.


In operacion/servidor.sh line 88:
  [ -f "$casa/.ssh/authorized_keys" ] && ssh-keygen -l -f "$casa/.ssh/authorized_keys" > /dev/null 2>&1 \
                                      ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.

For more information:
  https://www.shellcheck.net/wiki/SC2015 -- Note that A && B || C is not if-t...
Falló el ensayo del servidor: ShellCheck encontró problemas en los guiones nuevos.

Código de salida: 1
```

4. La primera ejecución se detuvo en ShellCheck: cinco avisos SC2015 por expresiones `A && B || falla`. Se reescribieron con `if` explícito, sin silenciar avisos. Se añadió el reinicio de Docker solo cuando ya estaba activo y se crea su configuración por primera vez. Los contenedores de esa corrida se borraron por la trampa de salida.

## Salida del ensayo: segunda ejecución

```text

== ShellCheck 0.10.0: los dos guiones nuevos deben pasar sin advertencias

== ShellCheck del resto de operacion/*.sh (solo se informa)
operacion/candado.sh: <stdout>: commitBuffer: invalid argument (invalid character)
operacion/ensayo.sh: <stdout>: commitBuffer: invalid argument (invalid character)
operacion/pasos.sh: <stdout>: commitBuffer: invalid argument (invalid character)
operacion/publicar.sh: <stdout>: commitBuffer: invalid argument (invalid character)

In operacion/candado.sh line 1:
# El candado de la instalaci
In operacion/ensayo-publicacion.sh line 27:
BD_PUERTO=54349
^-------^ SC2034 (warning): BD_PUERTO appears unused. Verify use (or export if used externally).


In operacion/ensayo-publicacion.sh line 28:
WEB_PUERTO=3230
^--------^ SC2034 (warning): WEB_PUERTO appears unused. Verify use (or export if used externally).


In operacion/ensayo-publicacion.sh line 29:
PROXY_HTTP=8580
^--------^ SC2034 (warning): PROXY_HTTP appears unused. Verify use (or export if used externally).


In operacion/ensayo-publicacion.sh line 30:
PROXY_HTTPS=8543
^---------^ SC2034 (warning): PROXY_HTTPS appears unused. Verify use (or export if used externally).


In operacion/ensayo-publicacion.sh line 31:
. operacion/ensayo/comun.sh
  ^-----------------------^ SC1091 (info): Not following: operacion/ensayo/comun.sh was not specified as input (see shellcheck -x).


In operacion/ensayo-publicacion.sh line 39:
publicar() { env "$@" sh operacion/publicar.sh >"$trabajo/salida" 2>&1; }
                                                 ^------^ SC2154 (warning): trabajo is referenced but not assigned.


In operacion/ensayo-publicacion.sh line 497:
[ -n "$nueva" ] && [ "$nueva" != "$marca" ] || { cat "$trabajo/bases" >&2; falla "la base restaurada no tiene una marca nueva"; }
                ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.


In operacion/ensayo.sh line 24:
BD_PUERTO=54339
^-------^ SC2034 (warning): BD_PUERTO appears unused. Verify use (or export if used externally).


In operacion/ensayo.sh line 25:
WEB_PUERTO=3220
^--------^ SC2034 (warning): WEB_PUERTO appears unused. Verify use (or export if used externally).


In operacion/ensayo.sh line 26:
PROXY_HTTP=8480
^--------^ SC2034 (warning): PROXY_HTTP appears unused. Verify use (or export if used externally).


In operacion/ensayo.sh line 27:
PROXY_HTTPS=8443
^---------^ SC2034 (warning): PROXY_HTTPS appears unused. Verify use (or export if used externally).


In operacion/ensayo.sh line 28:
. operacion/ensayo/comun.sh
  ^-----------------------^ SC1091 (info): Not following: operacion/ensayo/comun.sh was not specified as input (see shellcheck -x).


In operacion/ensayo.sh line 34:
if COMPOSE_ENV_FILES="$trabajo/roto.env" sh operacion/publicar.sh >"$trabajo/salida" 2>&1; then falla "public
In operacion/pasos.sh line 1:
# Lo que comparten los guiones de la operaci
In operacion/publicar.sh line 513:
    [ -n "$respaldo" ] && [ -n "$de_pub" ] && [ -n "$de_commit" ] && [ "$de_pub" != "$de_commit" ] || falla "No se entendi
In operacion/volver.sh line 106:
  [ -n "$version" ] && [ -n "$marca_de_antes" ] && [ -n "$numero" ] || falla "$no_se_leyo"
                                                ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.


In operacion/volver.sh line 198:
    [ "$como" = restaurada ] && [ "$de_cual" = "$marca" ] && [ "$la_que_contesta" = "$marca" ] \
                                                          ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.

For more information:
  https://www.shellcheck.net/wiki/SC2148 -- Tips depend on target shell and y...
  https://www.shellcheck.net/wiki/SC2034 -- BD_PUERTO appears unused. Verify ...
  https://www.shellcheck.net/wiki/SC2154 -- trabajo is referenced but not ass...
Se informaron los problemas de los otros guiones; no hacen fallar este ensayo.

== Ubuntu 24.04 desechable, sin privilegios ni puertos publicados
Get:1 http://ports.ubuntu.com/ubuntu-ports noble InRelease [256 kB]
Get:2 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease [126 kB]
Get:3 http://ports.ubuntu.com/ubuntu-ports noble-backports InRelease [126 kB]
Get:4 http://ports.ubuntu.com/ubuntu-ports noble-security InRelease [126 kB]
Get:5 http://ports.ubuntu.com/ubuntu-ports noble/universe arm64 Packages [19.0 MB]
Get:6 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 Packages [1776 kB]
Get:7 http://ports.ubuntu.com/ubuntu-ports noble/multiverse arm64 Packages [274 kB]
Get:8 http://ports.ubuntu.com/ubuntu-ports noble/restricted arm64 Packages [113 kB]
Get:9 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 Packages [1790 kB]
Get:10 http://ports.ubuntu.com/ubuntu-ports noble-updates/multiverse arm64 Packages [104 kB]
Get:11 http://ports.ubuntu.com/ubuntu-ports noble-updates/universe arm64 Packages [2216 kB]
Get:12 http://ports.ubuntu.com/ubuntu-ports noble-updates/restricted arm64 Packages [3251 kB]
Get:13 http://ports.ubuntu.com/ubuntu-ports noble-backports/main arm64 Packages [49.0 kB]
Get:14 http://ports.ubuntu.com/ubuntu-ports noble-backports/multiverse arm64 Packages [669 B]
Get:15 http://ports.ubuntu.com/ubuntu-ports noble-backports/universe arm64 Packages [36.3 kB]
Get:16 http://ports.ubuntu.com/ubuntu-ports noble-security/universe arm64 Packages [1638 kB]
Get:17 http://ports.ubuntu.com/ubuntu-ports noble-security/multiverse arm64 Packages [99.1 kB]
Get:18 http://ports.ubuntu.com/ubuntu-ports noble-security/restricted arm64 Packages [3129 kB]
Get:19 http://ports.ubuntu.com/ubuntu-ports noble-security/main arm64 Packages [1476 kB]
Fetched 35.6 MB in 15s (2442 kB/s)
Reading package lists...
Reading package lists...
Building dependency tree...
Reading state information...
The following additional packages will be installed:
  adduser libapparmor1 libbsd0 libcbor0.10 libedit2 libfido2-1
  libgssapi-krb5-2 libk5crypto3 libkeyutils1 libkrb5-3 libkrb5support0
  libwrap0 openssh-client openssh-sftp-server ucf
Suggested packages:
  liblocale-gettext-perl perl cron quota ecryptfs-utils krb5-doc krb5-user
  keychain libpam-ssh monkeysphere ssh-askpass molly-guard ufw
Recommended packages:
  krb5-locales xauth default-logind | logind | libpam-systemd ncurses-term
  ssh-import-id
The following NEW packages will be installed:
  adduser libapparmor1 libbsd0 libcbor0.10 libedit2 libfido2-1
  libgssapi-krb5-2 libk5crypto3 libkeyutils1 libkrb5-3 libkrb5support0
  libwrap0 openssh-client openssh-server openssh-sftp-server sudo ucf
0 upgraded, 17 newly installed, 0 to remove and 4 not upgraded.
Need to get 3487 kB of archives.
After this operation, 13.9 MB of additional disk space will be used.
Get:1 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 adduser all 3.137ubuntu1 [101 kB]
Get:2 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libbsd0 arm64 0.12.1-1build1.1 [41.0 kB]
Get:3 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libedit2 arm64 3.1-20230828-1build1 [97.5 kB]
Get:4 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libcbor0.10 arm64 0.10.2-1.2ubuntu2 [26.0 kB]
Get:5 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libfido2-1 arm64 1.14.0-1build3 [82.5 kB]
Get:6 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libkrb5support0 arm64 1.20.1-6ubuntu2.10 [35.4 kB]
Get:7 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libk5crypto3 arm64 1.20.1-6ubuntu2.10 [85.8 kB]
Get:8 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libkeyutils1 arm64 1.6.3-3build1 [9654 B]
Get:9 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libkrb5-3 arm64 1.20.1-6ubuntu2.10 [350 kB]
Get:10 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libgssapi-krb5-2 arm64 1.20.1-6ubuntu2.10 [142 kB]
Get:11 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 openssh-client arm64 1:9.6p1-3ubuntu13.20 [891 kB]
Get:12 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 openssh-sftp-server arm64 1:9.6p1-3ubuntu13.20 [36.8 kB]
Get:13 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 ucf all 3.0043+nmu1 [56.5 kB]
Get:14 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libwrap0 arm64 7.6.q-33 [48.5 kB]
Get:15 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 openssh-server arm64 1:9.6p1-3ubuntu13.20 [502 kB]
Get:16 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libapparmor1 arm64 4.0.1really4.0.1-0ubuntu0.24.04.9 [51.9 kB]
Get:17 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 sudo arm64 1.9.15p5-3ubuntu5.24.04.4 [930 kB]
debconf: delaying package configuration, since apt-utils is not installed
Fetched 3487 kB in 2s (1657 kB/s)
Selecting previously unselected package adduser.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 4376 files and directories currently installed.)
Preparing to unpack .../adduser_3.137ubuntu1_all.deb ...
Unpacking adduser (3.137ubuntu1) ...
Setting up adduser (3.137ubuntu1) ...
Selecting previously unselected package libbsd0:arm64.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 4424 files and directories currently installed.)
Preparing to unpack .../00-libbsd0_0.12.1-1build1.1_arm64.deb ...
Unpacking libbsd0:arm64 (0.12.1-1build1.1) ...
Selecting previously unselected package libedit2:arm64.
Preparing to unpack .../01-libedit2_3.1-20230828-1build1_arm64.deb ...
Unpacking libedit2:arm64 (3.1-20230828-1build1) ...
Selecting previously unselected package libcbor0.10:arm64.
Preparing to unpack .../02-libcbor0.10_0.10.2-1.2ubuntu2_arm64.deb ...
Unpacking libcbor0.10:arm64 (0.10.2-1.2ubuntu2) ...
Selecting previously unselected package libfido2-1:arm64.
Preparing to unpack .../03-libfido2-1_1.14.0-1build3_arm64.deb ...
Unpacking libfido2-1:arm64 (1.14.0-1build3) ...
Selecting previously unselected package libkrb5support0:arm64.
Preparing to unpack .../04-libkrb5support0_1.20.1-6ubuntu2.10_arm64.deb ...
Unpacking libkrb5support0:arm64 (1.20.1-6ubuntu2.10) ...
Selecting previously unselected package libk5crypto3:arm64.
Preparing to unpack .../05-libk5crypto3_1.20.1-6ubuntu2.10_arm64.deb ...
Unpacking libk5crypto3:arm64 (1.20.1-6ubuntu2.10) ...
Selecting previously unselected package libkeyutils1:arm64.
Preparing to unpack .../06-libkeyutils1_1.6.3-3build1_arm64.deb ...
Unpacking libkeyutils1:arm64 (1.6.3-3build1) ...
Selecting previously unselected package libkrb5-3:arm64.
Preparing to unpack .../07-libkrb5-3_1.20.1-6ubuntu2.10_arm64.deb ...
Unpacking libkrb5-3:arm64 (1.20.1-6ubuntu2.10) ...
Selecting previously unselected package libgssapi-krb5-2:arm64.
Preparing to unpack .../08-libgssapi-krb5-2_1.20.1-6ubuntu2.10_arm64.deb ...
Unpacking libgssapi-krb5-2:arm64 (1.20.1-6ubuntu2.10) ...
Selecting previously unselected package openssh-client.
Preparing to unpack .../09-openssh-client_1%3a9.6p1-3ubuntu13.20_arm64.deb ...
Unpacking openssh-client (1:9.6p1-3ubuntu13.20) ...
Selecting previously unselected package openssh-sftp-server.
Preparing to unpack .../10-openssh-sftp-server_1%3a9.6p1-3ubuntu13.20_arm64.deb ...
Unpacking openssh-sftp-server (1:9.6p1-3ubuntu13.20) ...
Selecting previously unselected package ucf.
Preparing to unpack .../11-ucf_3.0043+nmu1_all.deb ...
Moving old data out of the way
Unpacking ucf (3.0043+nmu1) ...
Selecting previously unselected package libwrap0:arm64.
Preparing to unpack .../12-libwrap0_7.6.q-33_arm64.deb ...
Unpacking libwrap0:arm64 (7.6.q-33) ...
Selecting previously unselected package openssh-server.
Preparing to unpack .../13-openssh-server_1%3a9.6p1-3ubuntu13.20_arm64.deb ...
Unpacking openssh-server (1:9.6p1-3ubuntu13.20) ...
Selecting previously unselected package libapparmor1:arm64.
Preparing to unpack .../14-libapparmor1_4.0.1really4.0.1-0ubuntu0.24.04.9_arm64.deb ...
Unpacking libapparmor1:arm64 (4.0.1really4.0.1-0ubuntu0.24.04.9) ...
Selecting previously unselected package sudo.
Preparing to unpack .../15-sudo_1.9.15p5-3ubuntu5.24.04.4_arm64.deb ...
Unpacking sudo (1.9.15p5-3ubuntu5.24.04.4) ...
Setting up libkeyutils1:arm64 (1.6.3-3build1) ...
Setting up libapparmor1:arm64 (4.0.1really4.0.1-0ubuntu0.24.04.9) ...
Setting up libcbor0.10:arm64 (0.10.2-1.2ubuntu2) ...
Setting up libkrb5support0:arm64 (1.20.1-6ubuntu2.10) ...
Setting up libwrap0:arm64 (7.6.q-33) ...
Setting up sudo (1.9.15p5-3ubuntu5.24.04.4) ...
Setting up ucf (3.0043+nmu1) ...
Setting up libk5crypto3:arm64 (1.20.1-6ubuntu2.10) ...
Setting up libkrb5-3:arm64 (1.20.1-6ubuntu2.10) ...
Setting up libfido2-1:arm64 (1.14.0-1build3) ...
Setting up libbsd0:arm64 (0.12.1-1build1.1) ...
Setting up libedit2:arm64 (3.1-20230828-1build1) ...
Setting up libgssapi-krb5-2:arm64 (1.20.1-6ubuntu2.10) ...
Setting up openssh-client (1:9.6p1-3ubuntu13.20) ...
Setting up openssh-sftp-server (1:9.6p1-3ubuntu13.20) ...
Setting up openssh-server (1:9.6p1-3ubuntu13.20) ...

Creating config file /etc/ssh/sshd_config with new version
Creating SSH2 RSA key; this may take some time ...
3072 SHA256:CPjo6RDxx74Iv1mzzFxyI/H5xCDawxjZfbYKNnml73k root@440de2f24ece (RSA)
Creating SSH2 ECDSA key; this may take some time ...
256 SHA256:RwDzJYP3I6vGo4njwVYsxc177S1Lz67EudhW+cqaihk root@440de2f24ece (ECDSA)
Creating SSH2 ED25519 key; this may take some time ...
256 SHA256:/Z/xZV7nzAqr6IsWwcGkMNhkOh79iSqK19VLUO2dhFU root@440de2f24ece (ED25519)
invoke-rc.d: could not determine current runlevel
invoke-rc.d: policy-rc.d denied execution of start.
Processing triggers for libc-bin (2.39-0ubuntu8.9) ...

== Con --quitar-contrasenas y sin llave, se niega antes de cambiar /etc
No se pudo preparar el servidor: prueba no tiene una llave válida en /home/prueba/.ssh/authorized_keys; no se quitan las contraseñas.

== Primera corrida: instala y configura
Hit:1 http://ports.ubuntu.com/ubuntu-ports noble InRelease
Hit:2 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease
Hit:3 http://ports.ubuntu.com/ubuntu-ports noble-backports InRelease
Hit:4 http://ports.ubuntu.com/ubuntu-ports noble-security InRelease
Reading package lists...
Reading package lists...
Building dependency tree...
Reading state information...
The following additional packages will be installed:
  dirmngr distro-info-data git-man gnupg-utils gpg gpg-agent gpgconf gpgsm
  iptables keyboxd libbrotli1 libcurl3t64-gnutls libcurl4t64 libdbus-1-3
  liberror-perl libexpat1 libgdbm-compat4t64 libgdbm6t64 libglib2.0-0t64
  libip4tc2 libip6tc2 libksba8 libldap2 liblzma5 libmnl0
  libnetfilter-conntrack3 libnfnetlink0 libnftnl11 libnghttp2-14
  libperl5.38t64 libpsl5t64 libpython3-stdlib libpython3.12-minimal
  libpython3.12-stdlib libreadline8t64 librtmp1 libsasl2-2 libsasl2-modules-db
  libsqlite3-0 libssh-4 libxtables12 lsb-release media-types netbase openssl
  perl perl-modules-5.38 pinentry-curses python-apt-common python3 python3-apt
  python3-dbus python3-distro-info python3-minimal python3.12
  python3.12-minimal readline-common tzdata xz-utils
Suggested packages:
  dbus-user-session libpam-systemd pinentry-gnome3 tor gettext-base
  git-daemon-run | git-daemon-sysvinit git-doc git-email git-gui gitk gitweb
  git-cvs git-mediawiki git-svn parcimonie xloadimage gpg-wks-server scdaemon
  firewalld kmod gdbm-l10n low-memory-monitor perl-doc
  libterm-readline-gnu-perl | libterm-readline-perl-perl make
  libtap-harness-archive-perl pinentry-doc python3-doc python3-tk python3-venv
  python-apt-doc python-dbus-doc python3.12-venv python3.12-doc binutils
  binfmt-support readline-doc rsyslog bsd-mailx default-mta
  | mail-transport-agent needrestart powermgmt-base python3-gi
Recommended packages:
  patch less gnupg-l10n gpg-wks-client nftables dbus libglib2.0-data
  shared-mime-info xdg-user-dirs libldap-common publicsuffix libsasl2-modules
  iso-codes python3-gi systemd-sysv | cron | cron-daemon | anacron
The following NEW packages will be installed:
  ca-certificates curl dirmngr distro-info-data git git-man gnupg gnupg-utils
  gpg gpg-agent gpgconf gpgsm iptables keyboxd libbrotli1 libcurl3t64-gnutls
  libcurl4t64 libdbus-1-3 liberror-perl libexpat1 libgdbm-compat4t64
  libgdbm6t64 libglib2.0-0t64 libip4tc2 libip6tc2 libksba8 libldap2 libmnl0
  libnetfilter-conntrack3 libnfnetlink0 libnftnl11 libnghttp2-14
  libperl5.38t64 libpsl5t64 libpython3-stdlib libpython3.12-minimal
  libpython3.12-stdlib libreadline8t64 librtmp1 libsasl2-2 libsasl2-modules-db
  libsqlite3-0 libssh-4 libxtables12 lsb-release media-types netbase openssl
  perl perl-modules-5.38 pinentry-curses python-apt-common python3 python3-apt
  python3-dbus python3-distro-info python3-minimal python3.12
  python3.12-minimal readline-common tzdata ufw unattended-upgrades xz-utils
The following packages will be upgraded:
  liblzma5
1 upgraded, 64 newly installed, 0 to remove and 3 not upgraded.
Need to get 28.6 MB of archives.
After this operation, 138 MB of additional disk space will be used.
Get:1 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libpython3.12-minimal arm64 3.12.3-1ubuntu0.17 [835 kB]
Get:2 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libexpat1 arm64 2.6.1-2ubuntu0.6 [89.8 kB]
Get:3 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3.12-minimal arm64 3.12.3-1ubuntu0.17 [2253 kB]
Get:4 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3-minimal arm64 3.12.3-0ubuntu2.1 [27.4 kB]
Get:5 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 media-types all 10.1.0 [27.5 kB]
Get:6 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 netbase all 6.4 [13.1 kB]
Get:7 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 tzdata all 2026e-0ubuntu0.24.04.1 [282 kB]
Get:8 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 liblzma5 arm64 5.6.1+really5.4.5-1ubuntu0.4 [126 kB]
Get:9 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 readline-common all 8.2-4build1 [56.5 kB]
Get:10 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libreadline8t64 arm64 8.2-4build1 [153 kB]
Get:11 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libsqlite3-0 arm64 3.45.1-1ubuntu2.8 [691 kB]
Get:12 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libpython3.12-stdlib arm64 3.12.3-1ubuntu0.17 [2039 kB]
Get:13 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3.12 arm64 3.12.3-1ubuntu0.17 [651 kB]
Get:14 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libpython3-stdlib arm64 3.12.3-0ubuntu2.1 [10.1 kB]
Get:15 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3 arm64 3.12.3-0ubuntu2.1 [23.0 kB]
Get:16 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 perl-modules-5.38 all 5.38.2-3.2ubuntu0.6 [3110 kB]
Get:17 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libgdbm6t64 arm64 1.23-5.1build1 [34.4 kB]
Get:18 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libgdbm-compat4t64 arm64 1.23-5.1build1 [6578 B]
Get:19 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libperl5.38t64 arm64 5.38.2-3.2ubuntu0.6 [4785 kB]
Get:20 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 perl arm64 5.38.2-3.2ubuntu0.6 [231 kB]
Get:21 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 openssl arm64 3.0.13-0ubuntu3.16 [985 kB]
Get:22 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 ca-certificates all 20260816ubuntu0.24.04.1 [139 kB]
Get:23 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 distro-info-data all 2026.10.12-0ubuntu0.24.04.1 [7836 B]
Get:24 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libdbus-1-3 arm64 1.14.10-4ubuntu4.1 [210 kB]
Get:25 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libglib2.0-0t64 arm64 2.80.0-6ubuntu3.10 [1533 kB]
Get:26 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libmnl0 arm64 1.0.5-2build1 [12.4 kB]
Get:27 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libxtables12 arm64 1.8.10-3ubuntu2 [35.9 kB]
Get:28 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 lsb-release all 12.0-2 [6564 B]
Get:29 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python-apt-common all 2.7.7ubuntu5.3 [20.5 kB]
Get:30 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3-apt arm64 2.7.7ubuntu5.3 [168 kB]
Get:31 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 python3-dbus arm64 1.3.2-5build3 [99.5 kB]
Get:32 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libip4tc2 arm64 1.8.10-3ubuntu2 [23.4 kB]
Get:33 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libip6tc2 arm64 1.8.10-3ubuntu2 [23.7 kB]
Get:34 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libnfnetlink0 arm64 1.0.2-2build1 [14.7 kB]
Get:35 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libnetfilter-conntrack3 arm64 1.0.9-6build1 [45.6 kB]
Get:36 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libnftnl11 arm64 1.2.6-2build1 [66.2 kB]
Get:37 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 iptables arm64 1.8.10-3ubuntu2 [388 kB]
Get:38 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libnghttp2-14 arm64 1.59.0-1ubuntu0.4 [74.8 kB]
Get:39 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libpsl5t64 arm64 0.21.2-1.1build1 [57.4 kB]
Get:40 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 python3-distro-info all 1.7build1 [7076 B]
Get:41 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 ufw all 0.36.2-6 [169 kB]
Get:42 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 xz-utils arm64 5.6.1+really5.4.5-1ubuntu0.4 [268 kB]
Get:43 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libbrotli1 arm64 1.1.0-2build2 [339 kB]
Get:44 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libsasl2-modules-db arm64 2.1.28+dfsg1-5ubuntu3.1 [21.6 kB]
Get:45 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libsasl2-2 arm64 2.1.28+dfsg1-5ubuntu3.1 [54.7 kB]
Get:46 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libldap2 arm64 2.6.10+dfsg-0ubuntu0.24.04.1 [196 kB]
Get:47 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 librtmp1 arm64 2.4+20151223.gitfa8646d.1-2build7 [57.8 kB]
Get:48 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libssh-4 arm64 0.10.6-2ubuntu0.5 [192 kB]
Get:49 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libcurl4t64 arm64 8.5.0-2ubuntu10.16 [337 kB]
Get:50 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 curl arm64 8.5.0-2ubuntu10.16 [222 kB]
Get:51 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gpgconf arm64 2.4.4-2ubuntu17.6 [103 kB]
Get:52 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libksba8 arm64 1.6.6-1build1 [119 kB]
Get:53 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 dirmngr arm64 2.4.4-2ubuntu17.6 [316 kB]
Get:54 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libcurl3t64-gnutls arm64 8.5.0-2ubuntu10.16 [331 kB]
Get:55 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 liberror-perl all 0.17029-2 [25.6 kB]
Get:56 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 git-man all 1:2.43.0-1ubuntu7.4 [1101 kB]
Get:57 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 git arm64 1:2.43.0-1ubuntu7.4 [3774 kB]
Get:58 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gnupg-utils arm64 2.4.4-2ubuntu17.6 [107 kB]
Get:59 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gpg arm64 2.4.4-2ubuntu17.6 [549 kB]
Get:60 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 pinentry-curses arm64 1.2.1-3ubuntu5 [34.3 kB]
Get:61 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gpg-agent arm64 2.4.4-2ubuntu17.6 [221 kB]
Get:62 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gpgsm arm64 2.4.4-2ubuntu17.6 [225 kB]
Get:63 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 keyboxd arm64 2.4.4-2ubuntu17.6 [75.9 kB]
Get:64 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gnupg all 2.4.4-2ubuntu17.6 [359 kB]
Get:65 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 unattended-upgrades all 2.9.1+nmu4ubuntu1 [51.2 kB]
debconf: delaying package configuration, since apt-utils is not installed
Fetched 28.6 MB in 10s (2933 kB/s)
Selecting previously unselected package libpython3.12-minimal:arm64.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 4697 files and directories currently installed.)
Preparing to unpack .../libpython3.12-minimal_3.12.3-1ubuntu0.17_arm64.deb ...
Unpacking libpython3.12-minimal:arm64 (3.12.3-1ubuntu0.17) ...
Selecting previously unselected package libexpat1:arm64.
Preparing to unpack .../libexpat1_2.6.1-2ubuntu0.6_arm64.deb ...
Unpacking libexpat1:arm64 (2.6.1-2ubuntu0.6) ...
Selecting previously unselected package python3.12-minimal.
Preparing to unpack .../python3.12-minimal_3.12.3-1ubuntu0.17_arm64.deb ...
Unpacking python3.12-minimal (3.12.3-1ubuntu0.17) ...
Setting up libpython3.12-minimal:arm64 (3.12.3-1ubuntu0.17) ...
Setting up libexpat1:arm64 (2.6.1-2ubuntu0.6) ...
Setting up python3.12-minimal (3.12.3-1ubuntu0.17) ...
Selecting previously unselected package python3-minimal.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 5016 files and directories currently installed.)
Preparing to unpack .../python3-minimal_3.12.3-0ubuntu2.1_arm64.deb ...
Unpacking python3-minimal (3.12.3-0ubuntu2.1) ...
Selecting previously unselected package media-types.
Preparing to unpack .../media-types_10.1.0_all.deb ...
Unpacking media-types (10.1.0) ...
Selecting previously unselected package netbase.
Preparing to unpack .../archives/netbase_6.4_all.deb ...
Unpacking netbase (6.4) ...
Selecting previously unselected package tzdata.
Preparing to unpack .../tzdata_2026e-0ubuntu0.24.04.1_all.deb ...
Unpacking tzdata (2026e-0ubuntu0.24.04.1) ...
Preparing to unpack .../liblzma5_5.6.1+really5.4.5-1ubuntu0.4_arm64.deb ...
Unpacking liblzma5:arm64 (5.6.1+really5.4.5-1ubuntu0.4) over (5.6.1+really5.4.5-1ubuntu0.3) ...
Setting up liblzma5:arm64 (5.6.1+really5.4.5-1ubuntu0.4) ...
Selecting previously unselected package readline-common.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 5579 files and directories currently installed.)
Preparing to unpack .../0-readline-common_8.2-4build1_all.deb ...
Unpacking readline-common (8.2-4build1) ...
Selecting previously unselected package libreadline8t64:arm64.
Preparing to unpack .../1-libreadline8t64_8.2-4build1_arm64.deb ...
Adding 'diversion of /lib/aarch64-linux-gnu/libhistory.so.8 to /lib/aarch64-linux-gnu/libhistory.so.8.usr-is-merged by libreadline8t64'
Adding 'diversion of /lib/aarch64-linux-gnu/libhistory.so.8.2 to /lib/aarch64-linux-gnu/libhistory.so.8.2.usr-is-merged by libreadline8t64'
Adding 'diversion of /lib/aarch64-linux-gnu/libreadline.so.8 to /lib/aarch64-linux-gnu/libreadline.so.8.usr-is-merged by libreadline8t64'
Adding 'diversion of /lib/aarch64-linux-gnu/libreadline.so.8.2 to /lib/aarch64-linux-gnu/libreadline.so.8.2.usr-is-merged by libreadline8t64'
Unpacking libreadline8t64:arm64 (8.2-4build1) ...
Selecting previously unselected package libsqlite3-0:arm64.
Preparing to unpack .../2-libsqlite3-0_3.45.1-1ubuntu2.8_arm64.deb ...
Unpacking libsqlite3-0:arm64 (3.45.1-1ubuntu2.8) ...
Selecting previously unselected package libpython3.12-stdlib:arm64.
Preparing to unpack .../3-libpython3.12-stdlib_3.12.3-1ubuntu0.17_arm64.deb ...
Unpacking libpython3.12-stdlib:arm64 (3.12.3-1ubuntu0.17) ...
Selecting previously unselected package python3.12.
Preparing to unpack .../4-python3.12_3.12.3-1ubuntu0.17_arm64.deb ...
Unpacking python3.12 (3.12.3-1ubuntu0.17) ...
Selecting previously unselected package libpython3-stdlib:arm64.
Preparing to unpack .../5-libpython3-stdlib_3.12.3-0ubuntu2.1_arm64.deb ...
Unpacking libpython3-stdlib:arm64 (3.12.3-0ubuntu2.1) ...
Setting up python3-minimal (3.12.3-0ubuntu2.1) ...
Selecting previously unselected package python3.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 6022 files and directories currently installed.)
Preparing to unpack .../00-python3_3.12.3-0ubuntu2.1_arm64.deb ...
Unpacking python3 (3.12.3-0ubuntu2.1) ...
Selecting previously unselected package perl-modules-5.38.
Preparing to unpack .../01-perl-modules-5.38_5.38.2-3.2ubuntu0.6_all.deb ...
Unpacking perl-modules-5.38 (5.38.2-3.2ubuntu0.6) ...
Selecting previously unselected package libgdbm6t64:arm64.
Preparing to unpack .../02-libgdbm6t64_1.23-5.1build1_arm64.deb ...
Unpacking libgdbm6t64:arm64 (1.23-5.1build1) ...
Selecting previously unselected package libgdbm-compat4t64:arm64.
Preparing to unpack .../03-libgdbm-compat4t64_1.23-5.1build1_arm64.deb ...
Unpacking libgdbm-compat4t64:arm64 (1.23-5.1build1) ...
Selecting previously unselected package libperl5.38t64:arm64.
Preparing to unpack .../04-libperl5.38t64_5.38.2-3.2ubuntu0.6_arm64.deb ...
Unpacking libperl5.38t64:arm64 (5.38.2-3.2ubuntu0.6) ...
Selecting previously unselected package perl.
Preparing to unpack .../05-perl_5.38.2-3.2ubuntu0.6_arm64.deb ...
Unpacking perl (5.38.2-3.2ubuntu0.6) ...
Selecting previously unselected package openssl.
Preparing to unpack .../06-openssl_3.0.13-0ubuntu3.16_arm64.deb ...
Unpacking openssl (3.0.13-0ubuntu3.16) ...
Selecting previously unselected package ca-certificates.
Preparing to unpack .../07-ca-certificates_20260816ubuntu0.24.04.1_all.deb ...
Unpacking ca-certificates (20260816ubuntu0.24.04.1) ...
Selecting previously unselected package distro-info-data.
Preparing to unpack .../08-distro-info-data_2026.10.12-0ubuntu0.24.04.1_all.deb ...
Unpacking distro-info-data (2026.10.12-0ubuntu0.24.04.1) ...
Selecting previously unselected package libdbus-1-3:arm64.
Preparing to unpack .../09-libdbus-1-3_1.14.10-4ubuntu4.1_arm64.deb ...
Unpacking libdbus-1-3:arm64 (1.14.10-4ubuntu4.1) ...
Selecting previously unselected package libglib2.0-0t64:arm64.
Preparing to unpack .../10-libglib2.0-0t64_2.80.0-6ubuntu3.10_arm64.deb ...
Unpacking libglib2.0-0t64:arm64 (2.80.0-6ubuntu3.10) ...
Selecting previously unselected package libmnl0:arm64.
Preparing to unpack .../11-libmnl0_1.0.5-2build1_arm64.deb ...
Unpacking libmnl0:arm64 (1.0.5-2build1) ...
Selecting previously unselected package libxtables12:arm64.
Preparing to unpack .../12-libxtables12_1.8.10-3ubuntu2_arm64.deb ...
Unpacking libxtables12:arm64 (1.8.10-3ubuntu2) ...
Selecting previously unselected package lsb-release.
Preparing to unpack .../13-lsb-release_12.0-2_all.deb ...
Unpacking lsb-release (12.0-2) ...
Selecting previously unselected package python-apt-common.
Preparing to unpack .../14-python-apt-common_2.7.7ubuntu5.3_all.deb ...
Unpacking python-apt-common (2.7.7ubuntu5.3) ...
Selecting previously unselected package python3-apt.
Preparing to unpack .../15-python3-apt_2.7.7ubuntu5.3_arm64.deb ...
Unpacking python3-apt (2.7.7ubuntu5.3) ...
Selecting previously unselected package python3-dbus.
Preparing to unpack .../16-python3-dbus_1.3.2-5build3_arm64.deb ...
Unpacking python3-dbus (1.3.2-5build3) ...
Selecting previously unselected package libip4tc2:arm64.
Preparing to unpack .../17-libip4tc2_1.8.10-3ubuntu2_arm64.deb ...
Unpacking libip4tc2:arm64 (1.8.10-3ubuntu2) ...
Selecting previously unselected package libip6tc2:arm64.
Preparing to unpack .../18-libip6tc2_1.8.10-3ubuntu2_arm64.deb ...
Unpacking libip6tc2:arm64 (1.8.10-3ubuntu2) ...
Selecting previously unselected package libnfnetlink0:arm64.
Preparing to unpack .../19-libnfnetlink0_1.0.2-2build1_arm64.deb ...
Unpacking libnfnetlink0:arm64 (1.0.2-2build1) ...
Selecting previously unselected package libnetfilter-conntrack3:arm64.
Preparing to unpack .../20-libnetfilter-conntrack3_1.0.9-6build1_arm64.deb ...
Unpacking libnetfilter-conntrack3:arm64 (1.0.9-6build1) ...
Selecting previously unselected package libnftnl11:arm64.
Preparing to unpack .../21-libnftnl11_1.2.6-2build1_arm64.deb ...
Unpacking libnftnl11:arm64 (1.2.6-2build1) ...
Selecting previously unselected package iptables.
Preparing to unpack .../22-iptables_1.8.10-3ubuntu2_arm64.deb ...
Unpacking iptables (1.8.10-3ubuntu2) ...
Selecting previously unselected package libnghttp2-14:arm64.
Preparing to unpack .../23-libnghttp2-14_1.59.0-1ubuntu0.4_arm64.deb ...
Unpacking libnghttp2-14:arm64 (1.59.0-1ubuntu0.4) ...
Selecting previously unselected package libpsl5t64:arm64.
Preparing to unpack .../24-libpsl5t64_0.21.2-1.1build1_arm64.deb ...
Unpacking libpsl5t64:arm64 (0.21.2-1.1build1) ...
Selecting previously unselected package python3-distro-info.
Preparing to unpack .../25-python3-distro-info_1.7build1_all.deb ...
Unpacking python3-distro-info (1.7build1) ...
Selecting previously unselected package ufw.
Preparing to unpack .../26-ufw_0.36.2-6_all.deb ...
Unpacking ufw (0.36.2-6) ...
Selecting previously unselected package xz-utils.
Preparing to unpack .../27-xz-utils_5.6.1+really5.4.5-1ubuntu0.4_arm64.deb ...
Unpacking xz-utils (5.6.1+really5.4.5-1ubuntu0.4) ...
Selecting previously unselected package libbrotli1:arm64.
Preparing to unpack .../28-libbrotli1_1.1.0-2build2_arm64.deb ...
Unpacking libbrotli1:arm64 (1.1.0-2build2) ...
Selecting previously unselected package libsasl2-modules-db:arm64.
Preparing to unpack .../29-libsasl2-modules-db_2.1.28+dfsg1-5ubuntu3.1_arm64.deb ...
Unpacking libsasl2-modules-db:arm64 (2.1.28+dfsg1-5ubuntu3.1) ...
Selecting previously unselected package libsasl2-2:arm64.
Preparing to unpack .../30-libsasl2-2_2.1.28+dfsg1-5ubuntu3.1_arm64.deb ...
Unpacking libsasl2-2:arm64 (2.1.28+dfsg1-5ubuntu3.1) ...
Selecting previously unselected package libldap2:arm64.
Preparing to unpack .../31-libldap2_2.6.10+dfsg-0ubuntu0.24.04.1_arm64.deb ...
Unpacking libldap2:arm64 (2.6.10+dfsg-0ubuntu0.24.04.1) ...
Selecting previously unselected package librtmp1:arm64.
Preparing to unpack .../32-librtmp1_2.4+20151223.gitfa8646d.1-2build7_arm64.deb ...
Unpacking librtmp1:arm64 (2.4+20151223.gitfa8646d.1-2build7) ...
Selecting previously unselected package libssh-4:arm64.
Preparing to unpack .../33-libssh-4_0.10.6-2ubuntu0.5_arm64.deb ...
Unpacking libssh-4:arm64 (0.10.6-2ubuntu0.5) ...
Selecting previously unselected package libcurl4t64:arm64.
Preparing to unpack .../34-libcurl4t64_8.5.0-2ubuntu10.16_arm64.deb ...
Unpacking libcurl4t64:arm64 (8.5.0-2ubuntu10.16) ...
Selecting previously unselected package curl.
Preparing to unpack .../35-curl_8.5.0-2ubuntu10.16_arm64.deb ...
Unpacking curl (8.5.0-2ubuntu10.16) ...
Selecting previously unselected package gpgconf.
Preparing to unpack .../36-gpgconf_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gpgconf (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package libksba8:arm64.
Preparing to unpack .../37-libksba8_1.6.6-1build1_arm64.deb ...
Unpacking libksba8:arm64 (1.6.6-1build1) ...
Selecting previously unselected package dirmngr.
Preparing to unpack .../38-dirmngr_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking dirmngr (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package libcurl3t64-gnutls:arm64.
Preparing to unpack .../39-libcurl3t64-gnutls_8.5.0-2ubuntu10.16_arm64.deb ...
Unpacking libcurl3t64-gnutls:arm64 (8.5.0-2ubuntu10.16) ...
Selecting previously unselected package liberror-perl.
Preparing to unpack .../40-liberror-perl_0.17029-2_all.deb ...
Unpacking liberror-perl (0.17029-2) ...
Selecting previously unselected package git-man.
Preparing to unpack .../41-git-man_1%3a2.43.0-1ubuntu7.4_all.deb ...
Unpacking git-man (1:2.43.0-1ubuntu7.4) ...
Selecting previously unselected package git.
Preparing to unpack .../42-git_1%3a2.43.0-1ubuntu7.4_arm64.deb ...
Unpacking git (1:2.43.0-1ubuntu7.4) ...
Selecting previously unselected package gnupg-utils.
Preparing to unpack .../43-gnupg-utils_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gnupg-utils (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package gpg.
Preparing to unpack .../44-gpg_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gpg (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package pinentry-curses.
Preparing to unpack .../45-pinentry-curses_1.2.1-3ubuntu5_arm64.deb ...
Unpacking pinentry-curses (1.2.1-3ubuntu5) ...
Selecting previously unselected package gpg-agent.
Preparing to unpack .../46-gpg-agent_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gpg-agent (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package gpgsm.
Preparing to unpack .../47-gpgsm_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gpgsm (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package keyboxd.
Preparing to unpack .../48-keyboxd_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking keyboxd (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package gnupg.
Preparing to unpack .../49-gnupg_2.4.4-2ubuntu17.6_all.deb ...
Unpacking gnupg (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package unattended-upgrades.
Preparing to unpack .../50-unattended-upgrades_2.9.1+nmu4ubuntu1_all.deb ...
Unpacking unattended-upgrades (2.9.1+nmu4ubuntu1) ...
Setting up libip4tc2:arm64 (1.8.10-3ubuntu2) ...
Setting up libksba8:arm64 (1.6.6-1build1) ...
Setting up pinentry-curses (1.2.1-3ubuntu5) ...
Setting up media-types (10.1.0) ...
Setting up libgdbm6t64:arm64 (1.23-5.1build1) ...
Setting up libgdbm-compat4t64:arm64 (1.23-5.1build1) ...
Setting up libip6tc2:arm64 (1.8.10-3ubuntu2) ...
Setting up distro-info-data (2026.10.12-0ubuntu0.24.04.1) ...
Setting up libbrotli1:arm64 (1.1.0-2build2) ...
Setting up libsqlite3-0:arm64 (3.45.1-1ubuntu2.8) ...
Setting up libpsl5t64:arm64 (0.21.2-1.1build1) ...
Setting up libnghttp2-14:arm64 (1.59.0-1ubuntu0.4) ...
Setting up libsasl2-modules-db:arm64 (2.1.28+dfsg1-5ubuntu3.1) ...
Setting up tzdata (2026e-0ubuntu0.24.04.1) ...

Current default time zone: 'Etc/UTC'
Local time is now:      Thu Oct 22 23:35:16 UTC 2026.
Universal Time is now:  Thu Oct 22 23:35:16 UTC 2026.
Run 'dpkg-reconfigure tzdata' if you wish to change it.

Setting up libglib2.0-0t64:arm64 (2.80.0-6ubuntu3.10) ...
No schema files found: doing nothing.
Setting up librtmp1:arm64 (2.4+20151223.gitfa8646d.1-2build7) ...
Setting up libdbus-1-3:arm64 (1.14.10-4ubuntu4.1) ...
Setting up xz-utils (5.6.1+really5.4.5-1ubuntu0.4) ...
update-alternatives: using /usr/bin/xz to provide /usr/bin/lzma (lzma) in auto mode
update-alternatives: warning: skip creation of /usr/share/man/man1/lzma.1.gz because associated file /usr/share/man/man1/xz.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/unlzma.1.gz because associated file /usr/share/man/man1/unxz.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzcat.1.gz because associated file /usr/share/man/man1/xzcat.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzmore.1.gz because associated file /usr/share/man/man1/xzmore.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzless.1.gz because associated file /usr/share/man/man1/xzless.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzdiff.1.gz because associated file /usr/share/man/man1/xzdiff.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzcmp.1.gz because associated file /usr/share/man/man1/xzcmp.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzgrep.1.gz because associated file /usr/share/man/man1/xzgrep.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzegrep.1.gz because associated file /usr/share/man/man1/xzegrep.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzfgrep.1.gz because associated file /usr/share/man/man1/xzfgrep.1.gz (of link group lzma) doesn't exist
Setting up perl-modules-5.38 (5.38.2-3.2ubuntu0.6) ...
Setting up libmnl0:arm64 (1.0.5-2build1) ...
Setting up libxtables12:arm64 (1.8.10-3ubuntu2) ...
Setting up libsasl2-2:arm64 (2.1.28+dfsg1-5ubuntu3.1) ...
Setting up libssh-4:arm64 (0.10.6-2ubuntu0.5) ...
Setting up python-apt-common (2.7.7ubuntu5.3) ...
Setting up libnfnetlink0:arm64 (1.0.2-2build1) ...
Setting up git-man (1:2.43.0-1ubuntu7.4) ...
Setting up netbase (6.4) ...
Setting up libperl5.38t64:arm64 (5.38.2-3.2ubuntu0.6) ...
Setting up lsb-release (12.0-2) ...
Setting up openssl (3.0.13-0ubuntu3.16) ...
Setting up readline-common (8.2-4build1) ...
Setting up libldap2:arm64 (2.6.10+dfsg-0ubuntu0.24.04.1) ...
Setting up gnupg-utils (2.4.4-2ubuntu17.6) ...
Setting up libcurl4t64:arm64 (8.5.0-2ubuntu10.16) ...
Setting up libcurl3t64-gnutls:arm64 (8.5.0-2ubuntu10.16) ...
Setting up libnftnl11:arm64 (1.2.6-2build1) ...
Setting up ca-certificates (20260816ubuntu0.24.04.1) ...
Updating certificates in /etc/ssl/certs...
120 added, 0 removed; done.
Setting up perl (5.38.2-3.2ubuntu0.6) ...
Setting up libreadline8t64:arm64 (8.2-4build1) ...
Setting up libnetfilter-conntrack3:arm64 (1.0.9-6build1) ...
Setting up gpgconf (2.4.4-2ubuntu17.6) ...
Setting up curl (8.5.0-2ubuntu10.16) ...
Setting up gpg (2.4.4-2ubuntu17.6) ...
Setting up gpg-agent (2.4.4-2ubuntu17.6) ...
Setting up libpython3.12-stdlib:arm64 (3.12.3-1ubuntu0.17) ...
Setting up iptables (1.8.10-3ubuntu2) ...
update-alternatives: using /usr/sbin/iptables-legacy to provide /usr/sbin/iptables (iptables) in auto mode
update-alternatives: using /usr/sbin/ip6tables-legacy to provide /usr/sbin/ip6tables (ip6tables) in auto mode
update-alternatives: using /usr/sbin/iptables-nft to provide /usr/sbin/iptables (iptables) in auto mode
update-alternatives: using /usr/sbin/ip6tables-nft to provide /usr/sbin/ip6tables (ip6tables) in auto mode
update-alternatives: using /usr/sbin/arptables-nft to provide /usr/sbin/arptables (arptables) in auto mode
update-alternatives: using /usr/sbin/ebtables-nft to provide /usr/sbin/ebtables (ebtables) in auto mode
Setting up python3.12 (3.12.3-1ubuntu0.17) ...
Setting up gpgsm (2.4.4-2ubuntu17.6) ...
Setting up liberror-perl (0.17029-2) ...
Setting up dirmngr (2.4.4-2ubuntu17.6) ...
Setting up keyboxd (2.4.4-2ubuntu17.6) ...
Setting up git (1:2.43.0-1ubuntu7.4) ...
Setting up gnupg (2.4.4-2ubuntu17.6) ...
Setting up libpython3-stdlib:arm64 (3.12.3-0ubuntu2.1) ...
Setting up python3 (3.12.3-0ubuntu2.1) ...
Setting up python3-distro-info (1.7build1) ...
Setting up python3-dbus (1.3.2-5build3) ...
Setting up python3-apt (2.7.7ubuntu5.3) ...
Setting up ufw (0.36.2-6) ...

Creating config file /etc/ufw/before.rules with new version

Creating config file /etc/ufw/before6.rules with new version

Creating config file /etc/ufw/after.rules with new version

Creating config file /etc/ufw/after6.rules with new version
Setting up unattended-upgrades (2.9.1+nmu4ubuntu1) ...

Creating config file /etc/apt/apt.conf.d/20auto-upgrades with new version

Creating config file /etc/apt/apt.conf.d/50unattended-upgrades with new version
Processing triggers for libc-bin (2.39-0ubuntu8.9) ...
Processing triggers for ca-certificates (20260816ubuntu0.24.04.1) ...
Updating certificates in /etc/ssl/certs...
0 added, 0 removed; done.
Running hooks in /etc/ca-certificates/update.d...
done.
Hecho: se instalaron: ca-certificates curl gnupg git ufw unattended-upgrades.
Hecho: se escribió /etc/apt/keyrings/docker.asc.
Hecho: se escribió /etc/apt/sources.list.d/docker.sources.
Hecho: se escribió /etc/docker/daemon.json.
Get:1 https://download.docker.com/linux/ubuntu noble InRelease [48.5 kB]
Get:2 https://download.docker.com/linux/ubuntu noble/stable arm64 Packages [83.5 kB]
Hit:3 http://ports.ubuntu.com/ubuntu-ports noble InRelease
Hit:4 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease
Hit:5 http://ports.ubuntu.com/ubuntu-ports noble-backports InRelease
Hit:6 http://ports.ubuntu.com/ubuntu-ports noble-security InRelease
Fetched 132 kB in 1s (120 kB/s)
Reading package lists...
Reading package lists...
Building dependency tree...
Reading state information...
The following additional packages will be installed:
  libjansson4 libnftables1 nftables
Suggested packages:
  cgroupfs-mount | cgroup-lite docker-model-plugin firewalld
Recommended packages:
  apparmor docker-ce-rootless-extras pigz
The following NEW packages will be installed:
  containerd.io docker-buildx-plugin docker-ce docker-ce-cli
  docker-compose-plugin libjansson4 libnftables1 nftables
0 upgraded, 8 newly installed, 0 to remove and 3 not upgraded.
Need to get 79.0 MB of archives.
After this operation, 341 MB of additional disk space will be used.
Get:1 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libjansson4 arm64 2.14-2build2 [34.4 kB]
Get:2 https://download.docker.com/linux/ubuntu noble/stable arm64 containerd.io arm64 2.4.2-3~ubuntu.24.04~noble [19.6 MB]
Get:3 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libnftables1 arm64 1.0.9-1ubuntu0.1 [352 kB]
Get:4 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 nftables arm64 1.0.9-1ubuntu0.1 [70.0 kB]
Get:5 https://download.docker.com/linux/ubuntu noble/stable arm64 docker-ce-cli arm64 5:29.9.2-1~ubuntu.24.04~noble [15.8 MB]
Get:6 https://download.docker.com/linux/ubuntu noble/stable arm64 docker-ce arm64 5:29.9.2-1~ubuntu.24.04~noble [21.0 MB]
Get:7 https://download.docker.com/linux/ubuntu noble/stable arm64 docker-buildx-plugin arm64 0.38.1-1~ubuntu.24.04~noble [15.3 MB]
Get:8 https://download.docker.com/linux/ubuntu noble/stable arm64 docker-compose-plugin arm64 5.6.1-1~ubuntu.24.04~noble [6888 kB]
debconf: delaying package configuration, since apt-utils is not installed
Fetched 79.0 MB in 25s (3141 kB/s)
Selecting previously unselected package containerd.io.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 10495 files and directories currently installed.)
Preparing to unpack .../0-containerd.io_2.4.2-3~ubuntu.24.04~noble_arm64.deb ...
Unpacking containerd.io (2.4.2-3~ubuntu.24.04~noble) ...
Selecting previously unselected package docker-ce-cli.
Preparing to unpack .../1-docker-ce-cli_5%3a29.9.2-1~ubuntu.24.04~noble_arm64.deb ...
Unpacking docker-ce-cli (5:29.9.2-1~ubuntu.24.04~noble) ...
Selecting previously unselected package libjansson4:arm64.
Preparing to unpack .../2-libjansson4_2.14-2build2_arm64.deb ...
Unpacking libjansson4:arm64 (2.14-2build2) ...
Selecting previously unselected package libnftables1:arm64.
Preparing to unpack .../3-libnftables1_1.0.9-1ubuntu0.1_arm64.deb ...
Unpacking libnftables1:arm64 (1.0.9-1ubuntu0.1) ...
Selecting previously unselected package nftables.
Preparing to unpack .../4-nftables_1.0.9-1ubuntu0.1_arm64.deb ...
Unpacking nftables (1.0.9-1ubuntu0.1) ...
Selecting previously unselected package docker-ce.
Preparing to unpack .../5-docker-ce_5%3a29.9.2-1~ubuntu.24.04~noble_arm64.deb ...
Unpacking docker-ce (5:29.9.2-1~ubuntu.24.04~noble) ...
Selecting previously unselected package docker-buildx-plugin.
Preparing to unpack .../6-docker-buildx-plugin_0.38.1-1~ubuntu.24.04~noble_arm64.deb ...
Unpacking docker-buildx-plugin (0.38.1-1~ubuntu.24.04~noble) ...
Selecting previously unselected package docker-compose-plugin.
Preparing to unpack .../7-docker-compose-plugin_5.6.1-1~ubuntu.24.04~noble_arm64.deb ...
Unpacking docker-compose-plugin (5.6.1-1~ubuntu.24.04~noble) ...
Setting up libjansson4:arm64 (2.14-2build2) ...
Setting up docker-buildx-plugin (0.38.1-1~ubuntu.24.04~noble) ...
Setting up containerd.io (2.4.2-3~ubuntu.24.04~noble) ...
Setting up docker-compose-plugin (5.6.1-1~ubuntu.24.04~noble) ...
Setting up docker-ce-cli (5:29.9.2-1~ubuntu.24.04~noble) ...
Setting up libnftables1:arm64 (1.0.9-1ubuntu0.1) ...
Setting up nftables (1.0.9-1ubuntu0.1) ...
Setting up docker-ce (5:29.9.2-1~ubuntu.24.04~noble) ...
invoke-rc.d: could not determine current runlevel
invoke-rc.d: policy-rc.d denied execution of start.
Processing triggers for libc-bin (2.39-0ubuntu8.9) ...
Hecho: se instalaron: docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin.
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
configuration OK
Hecho: prueba entró al grupo docker.
El grupo docker hace a prueba administrador del servidor. Vuelve a entrar para usarlo.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)
Hecho: se permitió 22/tcp en ufw.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)
Hecho: se permitió 80/tcp en ufw.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)
Hecho: se permitió 443/tcp en ufw.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)
Hecho: se permitió 443/udp en ufw.
Hecho: se escribió /etc/apt/apt.conf.d/52feruga-seguridad.
SSH no se modificó. Falta probar una segunda conexión con llave y correr --quitar-contrasenas; conserva la sesión actual y la consola del proveedor.
Ensayo: se omite encender servicios, activar ufw y recargar sshd; se comprobaron paquetes y archivos.
Servidor preparado: 11 cambios; arriba se detalla cada uno.
El repositorio ya está clonado. Sigue con sh operacion/entorno.sh <dominio> y la sección 2.4 de docs/operacion.md.
Docker publica puertos por fuera de ufw: solo debe publicar el proxy; operacion/comprobar.ts ya lo comprueba al publicar.
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
configuration OK
uid=1001(prueba) gid=1001(prueba) groups=1001(prueba),999(docker)
Falló la comprobación: falta tcp 22 en /etc/ufw/user.rules.
Falló el ensayo del servidor: una comprobación dentro de Ubuntu no pasó.

Código de salida: 1
```

5. La segunda ejecución pasó ShellCheck e instaló Docker Engine 29.9.2 y Compose 5.6.1 desde Docker oficial. Detectó un error en la lectura del formato interno de las reglas de ufw: se esperaba un campo `any` adicional. Se corrigió tanto la comprobación de repetibilidad del guion como el ensayo; se imprime ahora el inventario de reglas para que la evidencia sea visible. Los avisos `initcaps` son los esperados sin permisos de cortafuegos del núcleo; ufw sí guardó las reglas. Los contenedores se limpiaron incluso con el fallo.

## Salida del ensayo: tercera ejecución

```text

== ShellCheck 0.10.0: los dos guiones nuevos deben pasar sin advertencias

== ShellCheck del resto de operacion/*.sh (solo se informa)
operacion/candado.sh: <stdout>: commitBuffer: invalid argument (invalid character)
operacion/ensayo.sh: <stdout>: commitBuffer: invalid argument (invalid character)
operacion/pasos.sh: <stdout>: commitBuffer: invalid argument (invalid character)
operacion/publicar.sh: <stdout>: commitBuffer: invalid argument (invalid character)

In operacion/candado.sh line 1:
# El candado de la instalaci
In operacion/ensayo-publicacion.sh line 27:
BD_PUERTO=54349
^-------^ SC2034 (warning): BD_PUERTO appears unused. Verify use (or export if used externally).


In operacion/ensayo-publicacion.sh line 28:
WEB_PUERTO=3230
^--------^ SC2034 (warning): WEB_PUERTO appears unused. Verify use (or export if used externally).


In operacion/ensayo-publicacion.sh line 29:
PROXY_HTTP=8580
^--------^ SC2034 (warning): PROXY_HTTP appears unused. Verify use (or export if used externally).


In operacion/ensayo-publicacion.sh line 30:
PROXY_HTTPS=8543
^---------^ SC2034 (warning): PROXY_HTTPS appears unused. Verify use (or export if used externally).


In operacion/ensayo-publicacion.sh line 31:
. operacion/ensayo/comun.sh
  ^-----------------------^ SC1091 (info): Not following: operacion/ensayo/comun.sh was not specified as input (see shellcheck -x).


In operacion/ensayo-publicacion.sh line 39:
publicar() { env "$@" sh operacion/publicar.sh >"$trabajo/salida" 2>&1; }
                                                 ^------^ SC2154 (warning): trabajo is referenced but not assigned.


In operacion/ensayo-publicacion.sh line 497:
[ -n "$nueva" ] && [ "$nueva" != "$marca" ] || { cat "$trabajo/bases" >&2; falla "la base restaurada no tiene una marca nueva"; }
                ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.


In operacion/ensayo.sh line 24:
BD_PUERTO=54339
^-------^ SC2034 (warning): BD_PUERTO appears unused. Verify use (or export if used externally).


In operacion/ensayo.sh line 25:
WEB_PUERTO=3220
^--------^ SC2034 (warning): WEB_PUERTO appears unused. Verify use (or export if used externally).


In operacion/ensayo.sh line 26:
PROXY_HTTP=8480
^--------^ SC2034 (warning): PROXY_HTTP appears unused. Verify use (or export if used externally).


In operacion/ensayo.sh line 27:
PROXY_HTTPS=8443
^---------^ SC2034 (warning): PROXY_HTTPS appears unused. Verify use (or export if used externally).


In operacion/ensayo.sh line 28:
. operacion/ensayo/comun.sh
  ^-----------------------^ SC1091 (info): Not following: operacion/ensayo/comun.sh was not specified as input (see shellcheck -x).


In operacion/ensayo.sh line 34:
if COMPOSE_ENV_FILES="$trabajo/roto.env" sh operacion/publicar.sh >"$trabajo/salida" 2>&1; then falla "public
In operacion/pasos.sh line 1:
# Lo que comparten los guiones de la operaci
In operacion/publicar.sh line 513:
    [ -n "$respaldo" ] && [ -n "$de_pub" ] && [ -n "$de_commit" ] && [ "$de_pub" != "$de_commit" ] || falla "No se entendi
In operacion/volver.sh line 106:
  [ -n "$version" ] && [ -n "$marca_de_antes" ] && [ -n "$numero" ] || falla "$no_se_leyo"
                                                ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.


In operacion/volver.sh line 198:
    [ "$como" = restaurada ] && [ "$de_cual" = "$marca" ] && [ "$la_que_contesta" = "$marca" ] \
                                                          ^-- SC2015 (info): Note that A && B || C is not if-then-else. C may run when A is true.

For more information:
  https://www.shellcheck.net/wiki/SC2148 -- Tips depend on target shell and y...
  https://www.shellcheck.net/wiki/SC2034 -- BD_PUERTO appears unused. Verify ...
  https://www.shellcheck.net/wiki/SC2154 -- trabajo is referenced but not ass...
Se informaron los problemas de los otros guiones; no hacen fallar este ensayo.

== Ubuntu 24.04 desechable, sin privilegios ni puertos publicados
Get:1 http://ports.ubuntu.com/ubuntu-ports noble InRelease [256 kB]
Get:2 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease [126 kB]
Get:3 http://ports.ubuntu.com/ubuntu-ports noble-backports InRelease [126 kB]
Get:4 http://ports.ubuntu.com/ubuntu-ports noble-security InRelease [126 kB]
Get:5 http://ports.ubuntu.com/ubuntu-ports noble/universe arm64 Packages [19.0 MB]
Get:6 http://ports.ubuntu.com/ubuntu-ports noble/restricted arm64 Packages [113 kB]
Get:7 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 Packages [1776 kB]
Get:8 http://ports.ubuntu.com/ubuntu-ports noble/multiverse arm64 Packages [274 kB]
Get:9 http://ports.ubuntu.com/ubuntu-ports noble-updates/restricted arm64 Packages [3251 kB]
Get:10 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 Packages [1790 kB]
Get:11 http://ports.ubuntu.com/ubuntu-ports noble-updates/universe arm64 Packages [2216 kB]
Get:12 http://ports.ubuntu.com/ubuntu-ports noble-updates/multiverse arm64 Packages [104 kB]
Get:13 http://ports.ubuntu.com/ubuntu-ports noble-backports/multiverse arm64 Packages [669 B]
Get:14 http://ports.ubuntu.com/ubuntu-ports noble-backports/universe arm64 Packages [36.3 kB]
Get:15 http://ports.ubuntu.com/ubuntu-ports noble-backports/main arm64 Packages [49.0 kB]
Get:16 http://ports.ubuntu.com/ubuntu-ports noble-security/main arm64 Packages [1476 kB]
Get:17 http://ports.ubuntu.com/ubuntu-ports noble-security/multiverse arm64 Packages [99.1 kB]
Get:18 http://ports.ubuntu.com/ubuntu-ports noble-security/restricted arm64 Packages [3129 kB]
Get:19 http://ports.ubuntu.com/ubuntu-ports noble-security/universe arm64 Packages [1638 kB]
Fetched 35.6 MB in 9s (3955 kB/s)
Reading package lists...
Reading package lists...
Building dependency tree...
Reading state information...
The following additional packages will be installed:
  adduser libapparmor1 libbsd0 libcbor0.10 libedit2 libfido2-1
  libgssapi-krb5-2 libk5crypto3 libkeyutils1 libkrb5-3 libkrb5support0
  libwrap0 openssh-client openssh-sftp-server ucf
Suggested packages:
  liblocale-gettext-perl perl cron quota ecryptfs-utils krb5-doc krb5-user
  keychain libpam-ssh monkeysphere ssh-askpass molly-guard ufw
Recommended packages:
  krb5-locales xauth default-logind | logind | libpam-systemd ncurses-term
  ssh-import-id
The following NEW packages will be installed:
  adduser libapparmor1 libbsd0 libcbor0.10 libedit2 libfido2-1
  libgssapi-krb5-2 libk5crypto3 libkeyutils1 libkrb5-3 libkrb5support0
  libwrap0 openssh-client openssh-server openssh-sftp-server sudo ucf
0 upgraded, 17 newly installed, 0 to remove and 4 not upgraded.
Need to get 3487 kB of archives.
After this operation, 13.9 MB of additional disk space will be used.
Get:1 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 adduser all 3.137ubuntu1 [101 kB]
Get:2 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libbsd0 arm64 0.12.1-1build1.1 [41.0 kB]
Get:3 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libedit2 arm64 3.1-20230828-1build1 [97.5 kB]
Get:4 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libcbor0.10 arm64 0.10.2-1.2ubuntu2 [26.0 kB]
Get:5 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libfido2-1 arm64 1.14.0-1build3 [82.5 kB]
Get:6 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libkrb5support0 arm64 1.20.1-6ubuntu2.10 [35.4 kB]
Get:7 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libk5crypto3 arm64 1.20.1-6ubuntu2.10 [85.8 kB]
Get:8 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libkeyutils1 arm64 1.6.3-3build1 [9654 B]
Get:9 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libkrb5-3 arm64 1.20.1-6ubuntu2.10 [350 kB]
Get:10 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libgssapi-krb5-2 arm64 1.20.1-6ubuntu2.10 [142 kB]
Get:11 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 openssh-client arm64 1:9.6p1-3ubuntu13.20 [891 kB]
Get:12 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 openssh-sftp-server arm64 1:9.6p1-3ubuntu13.20 [36.8 kB]
Get:13 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 ucf all 3.0043+nmu1 [56.5 kB]
Get:14 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libwrap0 arm64 7.6.q-33 [48.5 kB]
Get:15 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 openssh-server arm64 1:9.6p1-3ubuntu13.20 [502 kB]
Get:16 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libapparmor1 arm64 4.0.1really4.0.1-0ubuntu0.24.04.9 [51.9 kB]
Get:17 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 sudo arm64 1.9.15p5-3ubuntu5.24.04.4 [930 kB]
debconf: delaying package configuration, since apt-utils is not installed
Fetched 3487 kB in 2s (2137 kB/s)
Selecting previously unselected package adduser.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 4376 files and directories currently installed.)
Preparing to unpack .../adduser_3.137ubuntu1_all.deb ...
Unpacking adduser (3.137ubuntu1) ...
Setting up adduser (3.137ubuntu1) ...
Selecting previously unselected package libbsd0:arm64.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 4424 files and directories currently installed.)
Preparing to unpack .../00-libbsd0_0.12.1-1build1.1_arm64.deb ...
Unpacking libbsd0:arm64 (0.12.1-1build1.1) ...
Selecting previously unselected package libedit2:arm64.
Preparing to unpack .../01-libedit2_3.1-20230828-1build1_arm64.deb ...
Unpacking libedit2:arm64 (3.1-20230828-1build1) ...
Selecting previously unselected package libcbor0.10:arm64.
Preparing to unpack .../02-libcbor0.10_0.10.2-1.2ubuntu2_arm64.deb ...
Unpacking libcbor0.10:arm64 (0.10.2-1.2ubuntu2) ...
Selecting previously unselected package libfido2-1:arm64.
Preparing to unpack .../03-libfido2-1_1.14.0-1build3_arm64.deb ...
Unpacking libfido2-1:arm64 (1.14.0-1build3) ...
Selecting previously unselected package libkrb5support0:arm64.
Preparing to unpack .../04-libkrb5support0_1.20.1-6ubuntu2.10_arm64.deb ...
Unpacking libkrb5support0:arm64 (1.20.1-6ubuntu2.10) ...
Selecting previously unselected package libk5crypto3:arm64.
Preparing to unpack .../05-libk5crypto3_1.20.1-6ubuntu2.10_arm64.deb ...
Unpacking libk5crypto3:arm64 (1.20.1-6ubuntu2.10) ...
Selecting previously unselected package libkeyutils1:arm64.
Preparing to unpack .../06-libkeyutils1_1.6.3-3build1_arm64.deb ...
Unpacking libkeyutils1:arm64 (1.6.3-3build1) ...
Selecting previously unselected package libkrb5-3:arm64.
Preparing to unpack .../07-libkrb5-3_1.20.1-6ubuntu2.10_arm64.deb ...
Unpacking libkrb5-3:arm64 (1.20.1-6ubuntu2.10) ...
Selecting previously unselected package libgssapi-krb5-2:arm64.
Preparing to unpack .../08-libgssapi-krb5-2_1.20.1-6ubuntu2.10_arm64.deb ...
Unpacking libgssapi-krb5-2:arm64 (1.20.1-6ubuntu2.10) ...
Selecting previously unselected package openssh-client.
Preparing to unpack .../09-openssh-client_1%3a9.6p1-3ubuntu13.20_arm64.deb ...
Unpacking openssh-client (1:9.6p1-3ubuntu13.20) ...
Selecting previously unselected package openssh-sftp-server.
Preparing to unpack .../10-openssh-sftp-server_1%3a9.6p1-3ubuntu13.20_arm64.deb ...
Unpacking openssh-sftp-server (1:9.6p1-3ubuntu13.20) ...
Selecting previously unselected package ucf.
Preparing to unpack .../11-ucf_3.0043+nmu1_all.deb ...
Moving old data out of the way
Unpacking ucf (3.0043+nmu1) ...
Selecting previously unselected package libwrap0:arm64.
Preparing to unpack .../12-libwrap0_7.6.q-33_arm64.deb ...
Unpacking libwrap0:arm64 (7.6.q-33) ...
Selecting previously unselected package openssh-server.
Preparing to unpack .../13-openssh-server_1%3a9.6p1-3ubuntu13.20_arm64.deb ...
Unpacking openssh-server (1:9.6p1-3ubuntu13.20) ...
Selecting previously unselected package libapparmor1:arm64.
Preparing to unpack .../14-libapparmor1_4.0.1really4.0.1-0ubuntu0.24.04.9_arm64.deb ...
Unpacking libapparmor1:arm64 (4.0.1really4.0.1-0ubuntu0.24.04.9) ...
Selecting previously unselected package sudo.
Preparing to unpack .../15-sudo_1.9.15p5-3ubuntu5.24.04.4_arm64.deb ...
Unpacking sudo (1.9.15p5-3ubuntu5.24.04.4) ...
Setting up libkeyutils1:arm64 (1.6.3-3build1) ...
Setting up libapparmor1:arm64 (4.0.1really4.0.1-0ubuntu0.24.04.9) ...
Setting up libcbor0.10:arm64 (0.10.2-1.2ubuntu2) ...
Setting up libkrb5support0:arm64 (1.20.1-6ubuntu2.10) ...
Setting up libwrap0:arm64 (7.6.q-33) ...
Setting up sudo (1.9.15p5-3ubuntu5.24.04.4) ...
Setting up ucf (3.0043+nmu1) ...
Setting up libk5crypto3:arm64 (1.20.1-6ubuntu2.10) ...
Setting up libkrb5-3:arm64 (1.20.1-6ubuntu2.10) ...
Setting up libfido2-1:arm64 (1.14.0-1build3) ...
Setting up libbsd0:arm64 (0.12.1-1build1.1) ...
Setting up libedit2:arm64 (3.1-20230828-1build1) ...
Setting up libgssapi-krb5-2:arm64 (1.20.1-6ubuntu2.10) ...
Setting up openssh-client (1:9.6p1-3ubuntu13.20) ...
Setting up openssh-sftp-server (1:9.6p1-3ubuntu13.20) ...
Setting up openssh-server (1:9.6p1-3ubuntu13.20) ...

Creating config file /etc/ssh/sshd_config with new version
Creating SSH2 RSA key; this may take some time ...
3072 SHA256:mWRNhmejWbPZ8tQK7KwMecfAX7S065YeA8zk5BEmO20 root@737b3d30f38c (RSA)
Creating SSH2 ECDSA key; this may take some time ...
256 SHA256:/+kidtOh1g1hT8r++5FujrvcftaTufVvLOuOFUWcH7U root@737b3d30f38c (ECDSA)
Creating SSH2 ED25519 key; this may take some time ...
256 SHA256:jeWP2FGHW1K0WA3LpmQfYZLukaai787qiKQ1CPnvLOU root@737b3d30f38c (ED25519)
invoke-rc.d: could not determine current runlevel
invoke-rc.d: policy-rc.d denied execution of start.
Processing triggers for libc-bin (2.39-0ubuntu8.9) ...

== Con --quitar-contrasenas y sin llave, se niega antes de cambiar /etc
No se pudo preparar el servidor: prueba no tiene una llave válida en /home/prueba/.ssh/authorized_keys; no se quitan las contraseñas.

== Primera corrida: instala y configura
Hit:1 http://ports.ubuntu.com/ubuntu-ports noble InRelease
Hit:2 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease
Hit:3 http://ports.ubuntu.com/ubuntu-ports noble-backports InRelease
Hit:4 http://ports.ubuntu.com/ubuntu-ports noble-security InRelease
Reading package lists...
Reading package lists...
Building dependency tree...
Reading state information...
The following additional packages will be installed:
  dirmngr distro-info-data git-man gnupg-utils gpg gpg-agent gpgconf gpgsm
  iptables keyboxd libbrotli1 libcurl3t64-gnutls libcurl4t64 libdbus-1-3
  liberror-perl libexpat1 libgdbm-compat4t64 libgdbm6t64 libglib2.0-0t64
  libip4tc2 libip6tc2 libksba8 libldap2 liblzma5 libmnl0
  libnetfilter-conntrack3 libnfnetlink0 libnftnl11 libnghttp2-14
  libperl5.38t64 libpsl5t64 libpython3-stdlib libpython3.12-minimal
  libpython3.12-stdlib libreadline8t64 librtmp1 libsasl2-2 libsasl2-modules-db
  libsqlite3-0 libssh-4 libxtables12 lsb-release media-types netbase openssl
  perl perl-modules-5.38 pinentry-curses python-apt-common python3 python3-apt
  python3-dbus python3-distro-info python3-minimal python3.12
  python3.12-minimal readline-common tzdata xz-utils
Suggested packages:
  dbus-user-session libpam-systemd pinentry-gnome3 tor gettext-base
  git-daemon-run | git-daemon-sysvinit git-doc git-email git-gui gitk gitweb
  git-cvs git-mediawiki git-svn parcimonie xloadimage gpg-wks-server scdaemon
  firewalld kmod gdbm-l10n low-memory-monitor perl-doc
  libterm-readline-gnu-perl | libterm-readline-perl-perl make
  libtap-harness-archive-perl pinentry-doc python3-doc python3-tk python3-venv
  python-apt-doc python-dbus-doc python3.12-venv python3.12-doc binutils
  binfmt-support readline-doc rsyslog bsd-mailx default-mta
  | mail-transport-agent needrestart powermgmt-base python3-gi
Recommended packages:
  patch less gnupg-l10n gpg-wks-client nftables dbus libglib2.0-data
  shared-mime-info xdg-user-dirs libldap-common publicsuffix libsasl2-modules
  iso-codes python3-gi systemd-sysv | cron | cron-daemon | anacron
The following NEW packages will be installed:
  ca-certificates curl dirmngr distro-info-data git git-man gnupg gnupg-utils
  gpg gpg-agent gpgconf gpgsm iptables keyboxd libbrotli1 libcurl3t64-gnutls
  libcurl4t64 libdbus-1-3 liberror-perl libexpat1 libgdbm-compat4t64
  libgdbm6t64 libglib2.0-0t64 libip4tc2 libip6tc2 libksba8 libldap2 libmnl0
  libnetfilter-conntrack3 libnfnetlink0 libnftnl11 libnghttp2-14
  libperl5.38t64 libpsl5t64 libpython3-stdlib libpython3.12-minimal
  libpython3.12-stdlib libreadline8t64 librtmp1 libsasl2-2 libsasl2-modules-db
  libsqlite3-0 libssh-4 libxtables12 lsb-release media-types netbase openssl
  perl perl-modules-5.38 pinentry-curses python-apt-common python3 python3-apt
  python3-dbus python3-distro-info python3-minimal python3.12
  python3.12-minimal readline-common tzdata ufw unattended-upgrades xz-utils
The following packages will be upgraded:
  liblzma5
1 upgraded, 64 newly installed, 0 to remove and 3 not upgraded.
Need to get 28.6 MB of archives.
After this operation, 138 MB of additional disk space will be used.
Get:1 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libpython3.12-minimal arm64 3.12.3-1ubuntu0.17 [835 kB]
Get:2 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libexpat1 arm64 2.6.1-2ubuntu0.6 [89.8 kB]
Get:3 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3.12-minimal arm64 3.12.3-1ubuntu0.17 [2253 kB]
Get:4 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3-minimal arm64 3.12.3-0ubuntu2.1 [27.4 kB]
Get:5 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 media-types all 10.1.0 [27.5 kB]
Get:6 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 netbase all 6.4 [13.1 kB]
Get:7 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 tzdata all 2026e-0ubuntu0.24.04.1 [282 kB]
Get:8 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 liblzma5 arm64 5.6.1+really5.4.5-1ubuntu0.4 [126 kB]
Get:9 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 readline-common all 8.2-4build1 [56.5 kB]
Get:10 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libreadline8t64 arm64 8.2-4build1 [153 kB]
Get:11 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libsqlite3-0 arm64 3.45.1-1ubuntu2.8 [691 kB]
Get:12 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libpython3.12-stdlib arm64 3.12.3-1ubuntu0.17 [2039 kB]
Get:13 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3.12 arm64 3.12.3-1ubuntu0.17 [651 kB]
Get:14 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libpython3-stdlib arm64 3.12.3-0ubuntu2.1 [10.1 kB]
Get:15 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3 arm64 3.12.3-0ubuntu2.1 [23.0 kB]
Get:16 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 perl-modules-5.38 all 5.38.2-3.2ubuntu0.6 [3110 kB]
Get:17 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libgdbm6t64 arm64 1.23-5.1build1 [34.4 kB]
Get:18 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libgdbm-compat4t64 arm64 1.23-5.1build1 [6578 B]
Get:19 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libperl5.38t64 arm64 5.38.2-3.2ubuntu0.6 [4785 kB]
Get:20 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 perl arm64 5.38.2-3.2ubuntu0.6 [231 kB]
Get:21 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 openssl arm64 3.0.13-0ubuntu3.16 [985 kB]
Get:22 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 ca-certificates all 20260816ubuntu0.24.04.1 [139 kB]
Get:23 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 distro-info-data all 2026.10.12-0ubuntu0.24.04.1 [7836 B]
Get:24 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libdbus-1-3 arm64 1.14.10-4ubuntu4.1 [210 kB]
Get:25 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libglib2.0-0t64 arm64 2.80.0-6ubuntu3.10 [1533 kB]
Get:26 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libmnl0 arm64 1.0.5-2build1 [12.4 kB]
Get:27 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libxtables12 arm64 1.8.10-3ubuntu2 [35.9 kB]
Get:28 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 lsb-release all 12.0-2 [6564 B]
Get:29 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python-apt-common all 2.7.7ubuntu5.3 [20.5 kB]
Get:30 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 python3-apt arm64 2.7.7ubuntu5.3 [168 kB]
Get:31 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 python3-dbus arm64 1.3.2-5build3 [99.5 kB]
Get:32 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libip4tc2 arm64 1.8.10-3ubuntu2 [23.4 kB]
Get:33 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libip6tc2 arm64 1.8.10-3ubuntu2 [23.7 kB]
Get:34 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libnfnetlink0 arm64 1.0.2-2build1 [14.7 kB]
Get:35 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libnetfilter-conntrack3 arm64 1.0.9-6build1 [45.6 kB]
Get:36 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libnftnl11 arm64 1.2.6-2build1 [66.2 kB]
Get:37 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 iptables arm64 1.8.10-3ubuntu2 [388 kB]
Get:38 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libnghttp2-14 arm64 1.59.0-1ubuntu0.4 [74.8 kB]
Get:39 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libpsl5t64 arm64 0.21.2-1.1build1 [57.4 kB]
Get:40 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 python3-distro-info all 1.7build1 [7076 B]
Get:41 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 ufw all 0.36.2-6 [169 kB]
Get:42 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 xz-utils arm64 5.6.1+really5.4.5-1ubuntu0.4 [268 kB]
Get:43 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libbrotli1 arm64 1.1.0-2build2 [339 kB]
Get:44 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libsasl2-modules-db arm64 2.1.28+dfsg1-5ubuntu3.1 [21.6 kB]
Get:45 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libsasl2-2 arm64 2.1.28+dfsg1-5ubuntu3.1 [54.7 kB]
Get:46 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libldap2 arm64 2.6.10+dfsg-0ubuntu0.24.04.1 [196 kB]
Get:47 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 librtmp1 arm64 2.4+20151223.gitfa8646d.1-2build7 [57.8 kB]
Get:48 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libssh-4 arm64 0.10.6-2ubuntu0.5 [192 kB]
Get:49 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libcurl4t64 arm64 8.5.0-2ubuntu10.16 [337 kB]
Get:50 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 curl arm64 8.5.0-2ubuntu10.16 [222 kB]
Get:51 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gpgconf arm64 2.4.4-2ubuntu17.6 [103 kB]
Get:52 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libksba8 arm64 1.6.6-1build1 [119 kB]
Get:53 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 dirmngr arm64 2.4.4-2ubuntu17.6 [316 kB]
Get:54 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libcurl3t64-gnutls arm64 8.5.0-2ubuntu10.16 [331 kB]
Get:55 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 liberror-perl all 0.17029-2 [25.6 kB]
Get:56 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 git-man all 1:2.43.0-1ubuntu7.4 [1101 kB]
Get:57 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 git arm64 1:2.43.0-1ubuntu7.4 [3774 kB]
Get:58 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gnupg-utils arm64 2.4.4-2ubuntu17.6 [107 kB]
Get:59 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gpg arm64 2.4.4-2ubuntu17.6 [549 kB]
Get:60 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 pinentry-curses arm64 1.2.1-3ubuntu5 [34.3 kB]
Get:61 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gpg-agent arm64 2.4.4-2ubuntu17.6 [221 kB]
Get:62 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gpgsm arm64 2.4.4-2ubuntu17.6 [225 kB]
Get:63 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 keyboxd arm64 2.4.4-2ubuntu17.6 [75.9 kB]
Get:64 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 gnupg all 2.4.4-2ubuntu17.6 [359 kB]
Get:65 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 unattended-upgrades all 2.9.1+nmu4ubuntu1 [51.2 kB]
debconf: delaying package configuration, since apt-utils is not installed
Fetched 28.6 MB in 9s (3021 kB/s)
Selecting previously unselected package libpython3.12-minimal:arm64.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 4697 files and directories currently installed.)
Preparing to unpack .../libpython3.12-minimal_3.12.3-1ubuntu0.17_arm64.deb ...
Unpacking libpython3.12-minimal:arm64 (3.12.3-1ubuntu0.17) ...
Selecting previously unselected package libexpat1:arm64.
Preparing to unpack .../libexpat1_2.6.1-2ubuntu0.6_arm64.deb ...
Unpacking libexpat1:arm64 (2.6.1-2ubuntu0.6) ...
Selecting previously unselected package python3.12-minimal.
Preparing to unpack .../python3.12-minimal_3.12.3-1ubuntu0.17_arm64.deb ...
Unpacking python3.12-minimal (3.12.3-1ubuntu0.17) ...
Setting up libpython3.12-minimal:arm64 (3.12.3-1ubuntu0.17) ...
Setting up libexpat1:arm64 (2.6.1-2ubuntu0.6) ...
Setting up python3.12-minimal (3.12.3-1ubuntu0.17) ...
Selecting previously unselected package python3-minimal.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 5016 files and directories currently installed.)
Preparing to unpack .../python3-minimal_3.12.3-0ubuntu2.1_arm64.deb ...
Unpacking python3-minimal (3.12.3-0ubuntu2.1) ...
Selecting previously unselected package media-types.
Preparing to unpack .../media-types_10.1.0_all.deb ...
Unpacking media-types (10.1.0) ...
Selecting previously unselected package netbase.
Preparing to unpack .../archives/netbase_6.4_all.deb ...
Unpacking netbase (6.4) ...
Selecting previously unselected package tzdata.
Preparing to unpack .../tzdata_2026e-0ubuntu0.24.04.1_all.deb ...
Unpacking tzdata (2026e-0ubuntu0.24.04.1) ...
Preparing to unpack .../liblzma5_5.6.1+really5.4.5-1ubuntu0.4_arm64.deb ...
Unpacking liblzma5:arm64 (5.6.1+really5.4.5-1ubuntu0.4) over (5.6.1+really5.4.5-1ubuntu0.3) ...
Setting up liblzma5:arm64 (5.6.1+really5.4.5-1ubuntu0.4) ...
Selecting previously unselected package readline-common.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 5579 files and directories currently installed.)
Preparing to unpack .../0-readline-common_8.2-4build1_all.deb ...
Unpacking readline-common (8.2-4build1) ...
Selecting previously unselected package libreadline8t64:arm64.
Preparing to unpack .../1-libreadline8t64_8.2-4build1_arm64.deb ...
Adding 'diversion of /lib/aarch64-linux-gnu/libhistory.so.8 to /lib/aarch64-linux-gnu/libhistory.so.8.usr-is-merged by libreadline8t64'
Adding 'diversion of /lib/aarch64-linux-gnu/libhistory.so.8.2 to /lib/aarch64-linux-gnu/libhistory.so.8.2.usr-is-merged by libreadline8t64'
Adding 'diversion of /lib/aarch64-linux-gnu/libreadline.so.8 to /lib/aarch64-linux-gnu/libreadline.so.8.usr-is-merged by libreadline8t64'
Adding 'diversion of /lib/aarch64-linux-gnu/libreadline.so.8.2 to /lib/aarch64-linux-gnu/libreadline.so.8.2.usr-is-merged by libreadline8t64'
Unpacking libreadline8t64:arm64 (8.2-4build1) ...
Selecting previously unselected package libsqlite3-0:arm64.
Preparing to unpack .../2-libsqlite3-0_3.45.1-1ubuntu2.8_arm64.deb ...
Unpacking libsqlite3-0:arm64 (3.45.1-1ubuntu2.8) ...
Selecting previously unselected package libpython3.12-stdlib:arm64.
Preparing to unpack .../3-libpython3.12-stdlib_3.12.3-1ubuntu0.17_arm64.deb ...
Unpacking libpython3.12-stdlib:arm64 (3.12.3-1ubuntu0.17) ...
Selecting previously unselected package python3.12.
Preparing to unpack .../4-python3.12_3.12.3-1ubuntu0.17_arm64.deb ...
Unpacking python3.12 (3.12.3-1ubuntu0.17) ...
Selecting previously unselected package libpython3-stdlib:arm64.
Preparing to unpack .../5-libpython3-stdlib_3.12.3-0ubuntu2.1_arm64.deb ...
Unpacking libpython3-stdlib:arm64 (3.12.3-0ubuntu2.1) ...
Setting up python3-minimal (3.12.3-0ubuntu2.1) ...
Selecting previously unselected package python3.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 6022 files and directories currently installed.)
Preparing to unpack .../00-python3_3.12.3-0ubuntu2.1_arm64.deb ...
Unpacking python3 (3.12.3-0ubuntu2.1) ...
Selecting previously unselected package perl-modules-5.38.
Preparing to unpack .../01-perl-modules-5.38_5.38.2-3.2ubuntu0.6_all.deb ...
Unpacking perl-modules-5.38 (5.38.2-3.2ubuntu0.6) ...
Selecting previously unselected package libgdbm6t64:arm64.
Preparing to unpack .../02-libgdbm6t64_1.23-5.1build1_arm64.deb ...
Unpacking libgdbm6t64:arm64 (1.23-5.1build1) ...
Selecting previously unselected package libgdbm-compat4t64:arm64.
Preparing to unpack .../03-libgdbm-compat4t64_1.23-5.1build1_arm64.deb ...
Unpacking libgdbm-compat4t64:arm64 (1.23-5.1build1) ...
Selecting previously unselected package libperl5.38t64:arm64.
Preparing to unpack .../04-libperl5.38t64_5.38.2-3.2ubuntu0.6_arm64.deb ...
Unpacking libperl5.38t64:arm64 (5.38.2-3.2ubuntu0.6) ...
Selecting previously unselected package perl.
Preparing to unpack .../05-perl_5.38.2-3.2ubuntu0.6_arm64.deb ...
Unpacking perl (5.38.2-3.2ubuntu0.6) ...
Selecting previously unselected package openssl.
Preparing to unpack .../06-openssl_3.0.13-0ubuntu3.16_arm64.deb ...
Unpacking openssl (3.0.13-0ubuntu3.16) ...
Selecting previously unselected package ca-certificates.
Preparing to unpack .../07-ca-certificates_20260816ubuntu0.24.04.1_all.deb ...
Unpacking ca-certificates (20260816ubuntu0.24.04.1) ...
Selecting previously unselected package distro-info-data.
Preparing to unpack .../08-distro-info-data_2026.10.12-0ubuntu0.24.04.1_all.deb ...
Unpacking distro-info-data (2026.10.12-0ubuntu0.24.04.1) ...
Selecting previously unselected package libdbus-1-3:arm64.
Preparing to unpack .../09-libdbus-1-3_1.14.10-4ubuntu4.1_arm64.deb ...
Unpacking libdbus-1-3:arm64 (1.14.10-4ubuntu4.1) ...
Selecting previously unselected package libglib2.0-0t64:arm64.
Preparing to unpack .../10-libglib2.0-0t64_2.80.0-6ubuntu3.10_arm64.deb ...
Unpacking libglib2.0-0t64:arm64 (2.80.0-6ubuntu3.10) ...
Selecting previously unselected package libmnl0:arm64.
Preparing to unpack .../11-libmnl0_1.0.5-2build1_arm64.deb ...
Unpacking libmnl0:arm64 (1.0.5-2build1) ...
Selecting previously unselected package libxtables12:arm64.
Preparing to unpack .../12-libxtables12_1.8.10-3ubuntu2_arm64.deb ...
Unpacking libxtables12:arm64 (1.8.10-3ubuntu2) ...
Selecting previously unselected package lsb-release.
Preparing to unpack .../13-lsb-release_12.0-2_all.deb ...
Unpacking lsb-release (12.0-2) ...
Selecting previously unselected package python-apt-common.
Preparing to unpack .../14-python-apt-common_2.7.7ubuntu5.3_all.deb ...
Unpacking python-apt-common (2.7.7ubuntu5.3) ...
Selecting previously unselected package python3-apt.
Preparing to unpack .../15-python3-apt_2.7.7ubuntu5.3_arm64.deb ...
Unpacking python3-apt (2.7.7ubuntu5.3) ...
Selecting previously unselected package python3-dbus.
Preparing to unpack .../16-python3-dbus_1.3.2-5build3_arm64.deb ...
Unpacking python3-dbus (1.3.2-5build3) ...
Selecting previously unselected package libip4tc2:arm64.
Preparing to unpack .../17-libip4tc2_1.8.10-3ubuntu2_arm64.deb ...
Unpacking libip4tc2:arm64 (1.8.10-3ubuntu2) ...
Selecting previously unselected package libip6tc2:arm64.
Preparing to unpack .../18-libip6tc2_1.8.10-3ubuntu2_arm64.deb ...
Unpacking libip6tc2:arm64 (1.8.10-3ubuntu2) ...
Selecting previously unselected package libnfnetlink0:arm64.
Preparing to unpack .../19-libnfnetlink0_1.0.2-2build1_arm64.deb ...
Unpacking libnfnetlink0:arm64 (1.0.2-2build1) ...
Selecting previously unselected package libnetfilter-conntrack3:arm64.
Preparing to unpack .../20-libnetfilter-conntrack3_1.0.9-6build1_arm64.deb ...
Unpacking libnetfilter-conntrack3:arm64 (1.0.9-6build1) ...
Selecting previously unselected package libnftnl11:arm64.
Preparing to unpack .../21-libnftnl11_1.2.6-2build1_arm64.deb ...
Unpacking libnftnl11:arm64 (1.2.6-2build1) ...
Selecting previously unselected package iptables.
Preparing to unpack .../22-iptables_1.8.10-3ubuntu2_arm64.deb ...
Unpacking iptables (1.8.10-3ubuntu2) ...
Selecting previously unselected package libnghttp2-14:arm64.
Preparing to unpack .../23-libnghttp2-14_1.59.0-1ubuntu0.4_arm64.deb ...
Unpacking libnghttp2-14:arm64 (1.59.0-1ubuntu0.4) ...
Selecting previously unselected package libpsl5t64:arm64.
Preparing to unpack .../24-libpsl5t64_0.21.2-1.1build1_arm64.deb ...
Unpacking libpsl5t64:arm64 (0.21.2-1.1build1) ...
Selecting previously unselected package python3-distro-info.
Preparing to unpack .../25-python3-distro-info_1.7build1_all.deb ...
Unpacking python3-distro-info (1.7build1) ...
Selecting previously unselected package ufw.
Preparing to unpack .../26-ufw_0.36.2-6_all.deb ...
Unpacking ufw (0.36.2-6) ...
Selecting previously unselected package xz-utils.
Preparing to unpack .../27-xz-utils_5.6.1+really5.4.5-1ubuntu0.4_arm64.deb ...
Unpacking xz-utils (5.6.1+really5.4.5-1ubuntu0.4) ...
Selecting previously unselected package libbrotli1:arm64.
Preparing to unpack .../28-libbrotli1_1.1.0-2build2_arm64.deb ...
Unpacking libbrotli1:arm64 (1.1.0-2build2) ...
Selecting previously unselected package libsasl2-modules-db:arm64.
Preparing to unpack .../29-libsasl2-modules-db_2.1.28+dfsg1-5ubuntu3.1_arm64.deb ...
Unpacking libsasl2-modules-db:arm64 (2.1.28+dfsg1-5ubuntu3.1) ...
Selecting previously unselected package libsasl2-2:arm64.
Preparing to unpack .../30-libsasl2-2_2.1.28+dfsg1-5ubuntu3.1_arm64.deb ...
Unpacking libsasl2-2:arm64 (2.1.28+dfsg1-5ubuntu3.1) ...
Selecting previously unselected package libldap2:arm64.
Preparing to unpack .../31-libldap2_2.6.10+dfsg-0ubuntu0.24.04.1_arm64.deb ...
Unpacking libldap2:arm64 (2.6.10+dfsg-0ubuntu0.24.04.1) ...
Selecting previously unselected package librtmp1:arm64.
Preparing to unpack .../32-librtmp1_2.4+20151223.gitfa8646d.1-2build7_arm64.deb ...
Unpacking librtmp1:arm64 (2.4+20151223.gitfa8646d.1-2build7) ...
Selecting previously unselected package libssh-4:arm64.
Preparing to unpack .../33-libssh-4_0.10.6-2ubuntu0.5_arm64.deb ...
Unpacking libssh-4:arm64 (0.10.6-2ubuntu0.5) ...
Selecting previously unselected package libcurl4t64:arm64.
Preparing to unpack .../34-libcurl4t64_8.5.0-2ubuntu10.16_arm64.deb ...
Unpacking libcurl4t64:arm64 (8.5.0-2ubuntu10.16) ...
Selecting previously unselected package curl.
Preparing to unpack .../35-curl_8.5.0-2ubuntu10.16_arm64.deb ...
Unpacking curl (8.5.0-2ubuntu10.16) ...
Selecting previously unselected package gpgconf.
Preparing to unpack .../36-gpgconf_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gpgconf (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package libksba8:arm64.
Preparing to unpack .../37-libksba8_1.6.6-1build1_arm64.deb ...
Unpacking libksba8:arm64 (1.6.6-1build1) ...
Selecting previously unselected package dirmngr.
Preparing to unpack .../38-dirmngr_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking dirmngr (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package libcurl3t64-gnutls:arm64.
Preparing to unpack .../39-libcurl3t64-gnutls_8.5.0-2ubuntu10.16_arm64.deb ...
Unpacking libcurl3t64-gnutls:arm64 (8.5.0-2ubuntu10.16) ...
Selecting previously unselected package liberror-perl.
Preparing to unpack .../40-liberror-perl_0.17029-2_all.deb ...
Unpacking liberror-perl (0.17029-2) ...
Selecting previously unselected package git-man.
Preparing to unpack .../41-git-man_1%3a2.43.0-1ubuntu7.4_all.deb ...
Unpacking git-man (1:2.43.0-1ubuntu7.4) ...
Selecting previously unselected package git.
Preparing to unpack .../42-git_1%3a2.43.0-1ubuntu7.4_arm64.deb ...
Unpacking git (1:2.43.0-1ubuntu7.4) ...
Selecting previously unselected package gnupg-utils.
Preparing to unpack .../43-gnupg-utils_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gnupg-utils (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package gpg.
Preparing to unpack .../44-gpg_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gpg (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package pinentry-curses.
Preparing to unpack .../45-pinentry-curses_1.2.1-3ubuntu5_arm64.deb ...
Unpacking pinentry-curses (1.2.1-3ubuntu5) ...
Selecting previously unselected package gpg-agent.
Preparing to unpack .../46-gpg-agent_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gpg-agent (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package gpgsm.
Preparing to unpack .../47-gpgsm_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking gpgsm (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package keyboxd.
Preparing to unpack .../48-keyboxd_2.4.4-2ubuntu17.6_arm64.deb ...
Unpacking keyboxd (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package gnupg.
Preparing to unpack .../49-gnupg_2.4.4-2ubuntu17.6_all.deb ...
Unpacking gnupg (2.4.4-2ubuntu17.6) ...
Selecting previously unselected package unattended-upgrades.
Preparing to unpack .../50-unattended-upgrades_2.9.1+nmu4ubuntu1_all.deb ...
Unpacking unattended-upgrades (2.9.1+nmu4ubuntu1) ...
Setting up libip4tc2:arm64 (1.8.10-3ubuntu2) ...
Setting up libksba8:arm64 (1.6.6-1build1) ...
Setting up pinentry-curses (1.2.1-3ubuntu5) ...
Setting up media-types (10.1.0) ...
Setting up libgdbm6t64:arm64 (1.23-5.1build1) ...
Setting up libgdbm-compat4t64:arm64 (1.23-5.1build1) ...
Setting up libip6tc2:arm64 (1.8.10-3ubuntu2) ...
Setting up distro-info-data (2026.10.12-0ubuntu0.24.04.1) ...
Setting up libbrotli1:arm64 (1.1.0-2build2) ...
Setting up libsqlite3-0:arm64 (3.45.1-1ubuntu2.8) ...
Setting up libpsl5t64:arm64 (0.21.2-1.1build1) ...
Setting up libnghttp2-14:arm64 (1.59.0-1ubuntu0.4) ...
Setting up libsasl2-modules-db:arm64 (2.1.28+dfsg1-5ubuntu3.1) ...
Setting up tzdata (2026e-0ubuntu0.24.04.1) ...

Current default time zone: 'Etc/UTC'
Local time is now:      Thu Oct 22 23:37:22 UTC 2026.
Universal Time is now:  Thu Oct 22 23:37:22 UTC 2026.
Run 'dpkg-reconfigure tzdata' if you wish to change it.

Setting up libglib2.0-0t64:arm64 (2.80.0-6ubuntu3.10) ...
No schema files found: doing nothing.
Setting up librtmp1:arm64 (2.4+20151223.gitfa8646d.1-2build7) ...
Setting up libdbus-1-3:arm64 (1.14.10-4ubuntu4.1) ...
Setting up xz-utils (5.6.1+really5.4.5-1ubuntu0.4) ...
update-alternatives: using /usr/bin/xz to provide /usr/bin/lzma (lzma) in auto mode
update-alternatives: warning: skip creation of /usr/share/man/man1/lzma.1.gz because associated file /usr/share/man/man1/xz.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/unlzma.1.gz because associated file /usr/share/man/man1/unxz.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzcat.1.gz because associated file /usr/share/man/man1/xzcat.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzmore.1.gz because associated file /usr/share/man/man1/xzmore.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzless.1.gz because associated file /usr/share/man/man1/xzless.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzdiff.1.gz because associated file /usr/share/man/man1/xzdiff.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzcmp.1.gz because associated file /usr/share/man/man1/xzcmp.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzgrep.1.gz because associated file /usr/share/man/man1/xzgrep.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzegrep.1.gz because associated file /usr/share/man/man1/xzegrep.1.gz (of link group lzma) doesn't exist
update-alternatives: warning: skip creation of /usr/share/man/man1/lzfgrep.1.gz because associated file /usr/share/man/man1/xzfgrep.1.gz (of link group lzma) doesn't exist
Setting up perl-modules-5.38 (5.38.2-3.2ubuntu0.6) ...
Setting up libmnl0:arm64 (1.0.5-2build1) ...
Setting up libxtables12:arm64 (1.8.10-3ubuntu2) ...
Setting up libsasl2-2:arm64 (2.1.28+dfsg1-5ubuntu3.1) ...
Setting up libssh-4:arm64 (0.10.6-2ubuntu0.5) ...
Setting up python-apt-common (2.7.7ubuntu5.3) ...
Setting up libnfnetlink0:arm64 (1.0.2-2build1) ...
Setting up git-man (1:2.43.0-1ubuntu7.4) ...
Setting up netbase (6.4) ...
Setting up libperl5.38t64:arm64 (5.38.2-3.2ubuntu0.6) ...
Setting up lsb-release (12.0-2) ...
Setting up openssl (3.0.13-0ubuntu3.16) ...
Setting up readline-common (8.2-4build1) ...
Setting up libldap2:arm64 (2.6.10+dfsg-0ubuntu0.24.04.1) ...
Setting up gnupg-utils (2.4.4-2ubuntu17.6) ...
Setting up libcurl4t64:arm64 (8.5.0-2ubuntu10.16) ...
Setting up libcurl3t64-gnutls:arm64 (8.5.0-2ubuntu10.16) ...
Setting up libnftnl11:arm64 (1.2.6-2build1) ...
Setting up ca-certificates (20260816ubuntu0.24.04.1) ...
Updating certificates in /etc/ssl/certs...
120 added, 0 removed; done.
Setting up perl (5.38.2-3.2ubuntu0.6) ...
Setting up libreadline8t64:arm64 (8.2-4build1) ...
Setting up libnetfilter-conntrack3:arm64 (1.0.9-6build1) ...
Setting up gpgconf (2.4.4-2ubuntu17.6) ...
Setting up curl (8.5.0-2ubuntu10.16) ...
Setting up gpg (2.4.4-2ubuntu17.6) ...
Setting up gpg-agent (2.4.4-2ubuntu17.6) ...
Setting up libpython3.12-stdlib:arm64 (3.12.3-1ubuntu0.17) ...
Setting up iptables (1.8.10-3ubuntu2) ...
update-alternatives: using /usr/sbin/iptables-legacy to provide /usr/sbin/iptables (iptables) in auto mode
update-alternatives: using /usr/sbin/ip6tables-legacy to provide /usr/sbin/ip6tables (ip6tables) in auto mode
update-alternatives: using /usr/sbin/iptables-nft to provide /usr/sbin/iptables (iptables) in auto mode
update-alternatives: using /usr/sbin/ip6tables-nft to provide /usr/sbin/ip6tables (ip6tables) in auto mode
update-alternatives: using /usr/sbin/arptables-nft to provide /usr/sbin/arptables (arptables) in auto mode
update-alternatives: using /usr/sbin/ebtables-nft to provide /usr/sbin/ebtables (ebtables) in auto mode
Setting up python3.12 (3.12.3-1ubuntu0.17) ...
Setting up gpgsm (2.4.4-2ubuntu17.6) ...
Setting up liberror-perl (0.17029-2) ...
Setting up dirmngr (2.4.4-2ubuntu17.6) ...
Setting up keyboxd (2.4.4-2ubuntu17.6) ...
Setting up git (1:2.43.0-1ubuntu7.4) ...
Setting up gnupg (2.4.4-2ubuntu17.6) ...
Setting up libpython3-stdlib:arm64 (3.12.3-0ubuntu2.1) ...
Setting up python3 (3.12.3-0ubuntu2.1) ...
Setting up python3-distro-info (1.7build1) ...
Setting up python3-dbus (1.3.2-5build3) ...
Setting up python3-apt (2.7.7ubuntu5.3) ...
Setting up ufw (0.36.2-6) ...

Creating config file /etc/ufw/before.rules with new version

Creating config file /etc/ufw/before6.rules with new version

Creating config file /etc/ufw/after.rules with new version

Creating config file /etc/ufw/after6.rules with new version
Setting up unattended-upgrades (2.9.1+nmu4ubuntu1) ...

Creating config file /etc/apt/apt.conf.d/20auto-upgrades with new version

Creating config file /etc/apt/apt.conf.d/50unattended-upgrades with new version
Processing triggers for libc-bin (2.39-0ubuntu8.9) ...
Processing triggers for ca-certificates (20260816ubuntu0.24.04.1) ...
Updating certificates in /etc/ssl/certs...
0 added, 0 removed; done.
Running hooks in /etc/ca-certificates/update.d...
done.
Hecho: se instalaron: ca-certificates curl gnupg git ufw unattended-upgrades.
Hecho: se escribió /etc/apt/keyrings/docker.asc.
Hecho: se escribió /etc/apt/sources.list.d/docker.sources.
Hecho: se escribió /etc/docker/daemon.json.
Get:1 https://download.docker.com/linux/ubuntu noble InRelease [48.5 kB]
Get:2 https://download.docker.com/linux/ubuntu noble/stable arm64 Packages [83.5 kB]
Hit:3 http://ports.ubuntu.com/ubuntu-ports noble InRelease
Hit:4 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease
Hit:5 http://ports.ubuntu.com/ubuntu-ports noble-backports InRelease
Hit:6 http://ports.ubuntu.com/ubuntu-ports noble-security InRelease
Fetched 132 kB in 1s (206 kB/s)
Reading package lists...
Reading package lists...
Building dependency tree...
Reading state information...
The following additional packages will be installed:
  libjansson4 libnftables1 nftables
Suggested packages:
  cgroupfs-mount | cgroup-lite docker-model-plugin firewalld
Recommended packages:
  apparmor docker-ce-rootless-extras pigz
The following NEW packages will be installed:
  containerd.io docker-buildx-plugin docker-ce docker-ce-cli
  docker-compose-plugin libjansson4 libnftables1 nftables
0 upgraded, 8 newly installed, 0 to remove and 3 not upgraded.
Need to get 79.0 MB of archives.
After this operation, 341 MB of additional disk space will be used.
Get:1 https://download.docker.com/linux/ubuntu noble/stable arm64 containerd.io arm64 2.4.2-3~ubuntu.24.04~noble [19.6 MB]
Get:2 http://ports.ubuntu.com/ubuntu-ports noble/main arm64 libjansson4 arm64 2.14-2build2 [34.4 kB]
Get:3 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 libnftables1 arm64 1.0.9-1ubuntu0.1 [352 kB]
Get:4 http://ports.ubuntu.com/ubuntu-ports noble-updates/main arm64 nftables arm64 1.0.9-1ubuntu0.1 [70.0 kB]
Get:5 https://download.docker.com/linux/ubuntu noble/stable arm64 docker-ce-cli arm64 5:29.9.2-1~ubuntu.24.04~noble [15.8 MB]
Get:6 https://download.docker.com/linux/ubuntu noble/stable arm64 docker-ce arm64 5:29.9.2-1~ubuntu.24.04~noble [21.0 MB]
Get:7 https://download.docker.com/linux/ubuntu noble/stable arm64 docker-buildx-plugin arm64 0.38.1-1~ubuntu.24.04~noble [15.3 MB]
Get:8 https://download.docker.com/linux/ubuntu noble/stable arm64 docker-compose-plugin arm64 5.6.1-1~ubuntu.24.04~noble [6888 kB]
debconf: delaying package configuration, since apt-utils is not installed
Fetched 79.0 MB in 14s (5690 kB/s)
Selecting previously unselected package containerd.io.
(Reading database ... 
(Reading database ... 5%
(Reading database ... 10%
(Reading database ... 15%
(Reading database ... 20%
(Reading database ... 25%
(Reading database ... 30%
(Reading database ... 35%
(Reading database ... 40%
(Reading database ... 45%
(Reading database ... 50%
(Reading database ... 55%
(Reading database ... 60%
(Reading database ... 65%
(Reading database ... 70%
(Reading database ... 75%
(Reading database ... 80%
(Reading database ... 85%
(Reading database ... 90%
(Reading database ... 95%
(Reading database ... 100%
(Reading database ... 10495 files and directories currently installed.)
Preparing to unpack .../0-containerd.io_2.4.2-3~ubuntu.24.04~noble_arm64.deb ...
Unpacking containerd.io (2.4.2-3~ubuntu.24.04~noble) ...
Selecting previously unselected package docker-ce-cli.
Preparing to unpack .../1-docker-ce-cli_5%3a29.9.2-1~ubuntu.24.04~noble_arm64.deb ...
Unpacking docker-ce-cli (5:29.9.2-1~ubuntu.24.04~noble) ...
Selecting previously unselected package libjansson4:arm64.
Preparing to unpack .../2-libjansson4_2.14-2build2_arm64.deb ...
Unpacking libjansson4:arm64 (2.14-2build2) ...
Selecting previously unselected package libnftables1:arm64.
Preparing to unpack .../3-libnftables1_1.0.9-1ubuntu0.1_arm64.deb ...
Unpacking libnftables1:arm64 (1.0.9-1ubuntu0.1) ...
Selecting previously unselected package nftables.
Preparing to unpack .../4-nftables_1.0.9-1ubuntu0.1_arm64.deb ...
Unpacking nftables (1.0.9-1ubuntu0.1) ...
Selecting previously unselected package docker-ce.
Preparing to unpack .../5-docker-ce_5%3a29.9.2-1~ubuntu.24.04~noble_arm64.deb ...
Unpacking docker-ce (5:29.9.2-1~ubuntu.24.04~noble) ...
Selecting previously unselected package docker-buildx-plugin.
Preparing to unpack .../6-docker-buildx-plugin_0.38.1-1~ubuntu.24.04~noble_arm64.deb ...
Unpacking docker-buildx-plugin (0.38.1-1~ubuntu.24.04~noble) ...
Selecting previously unselected package docker-compose-plugin.
Preparing to unpack .../7-docker-compose-plugin_5.6.1-1~ubuntu.24.04~noble_arm64.deb ...
Unpacking docker-compose-plugin (5.6.1-1~ubuntu.24.04~noble) ...
Setting up libjansson4:arm64 (2.14-2build2) ...
Setting up docker-buildx-plugin (0.38.1-1~ubuntu.24.04~noble) ...
Setting up containerd.io (2.4.2-3~ubuntu.24.04~noble) ...
Setting up docker-compose-plugin (5.6.1-1~ubuntu.24.04~noble) ...
Setting up docker-ce-cli (5:29.9.2-1~ubuntu.24.04~noble) ...
Setting up libnftables1:arm64 (1.0.9-1ubuntu0.1) ...
Setting up nftables (1.0.9-1ubuntu0.1) ...
Setting up docker-ce (5:29.9.2-1~ubuntu.24.04~noble) ...
invoke-rc.d: could not determine current runlevel
invoke-rc.d: policy-rc.d denied execution of start.
Processing triggers for libc-bin (2.39-0ubuntu8.9) ...
Hecho: se instalaron: docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin.
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
configuration OK
Hecho: prueba entró al grupo docker.
El grupo docker hace a prueba administrador del servidor. Vuelve a entrar para usarlo.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)
Hecho: se permitió 22/tcp en ufw.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)
Hecho: se permitió 80/tcp en ufw.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)
Hecho: se permitió 443/tcp en ufw.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)
Hecho: se permitió 443/udp en ufw.
Hecho: se escribió /etc/apt/apt.conf.d/52feruga-seguridad.
SSH no se modificó. Falta probar una segunda conexión con llave y correr --quitar-contrasenas; conserva la sesión actual y la consola del proveedor.
Ensayo: se omite encender servicios, activar ufw y recargar sshd; se comprobaron paquetes y archivos.
Servidor preparado: 11 cambios; arriba se detalla cada uno.
El repositorio ya está clonado. Sigue con sh operacion/entorno.sh <dominio> y la sección 2.4 de docs/operacion.md.
Docker publica puertos por fuera de ufw: solo debe publicar el proxy; operacion/comprobar.ts ya lo comprueba al publicar.
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
configuration OK
uid=1001(prueba) gid=1001(prueba) groups=1001(prueba),999(docker)
### tuple ### allow tcp 22 0.0.0.0/0 any 0.0.0.0/0 in
### tuple ### allow tcp 80 0.0.0.0/0 any 0.0.0.0/0 in
### tuple ### allow tcp 443 0.0.0.0/0 any 0.0.0.0/0 in
### tuple ### allow udp 443 0.0.0.0/0 any 0.0.0.0/0 in
### tuple ### allow tcp 22 ::/0 any ::/0 in
### tuple ### allow tcp 80 ::/0 any ::/0 in
### tuple ### allow tcp 443 ::/0 any ::/0 in
### tuple ### allow udp 443 ::/0 any ::/0 in

== Segunda corrida: ningún cambio en /etc
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
configuration OK
El grupo docker hace a prueba administrador del servidor. Vuelve a entrar para usarlo.
SSH no se modificó. Falta probar una segunda conexión con llave y correr --quitar-contrasenas; conserva la sesión actual y la consola del proveedor.
Ensayo: se omite encender servicios, activar ufw y recargar sshd; se comprobaron paquetes y archivos.
No hay nada que cambiar.
El repositorio ya está clonado. Sigue con sh operacion/entorno.sh <dominio> y la sección 2.4 de docs/operacion.md.
Docker publica puertos por fuera de ufw: solo debe publicar el proxy; operacion/comprobar.ts ya lo comprueba al publicar.
a727ee0ae60225f48ba68da4cea512dffb260261245378f1402ac32ada2abd73  /tmp/antes
a727ee0ae60225f48ba68da4cea512dffb260261245378f1402ac32ada2abd73  /tmp/despues

== Con una llave válida, quita contraseñas y conserva la entrada por llave
No se pudo preparar el servidor: prueba no tiene una llave válida en /home/prueba/.ssh/authorized_keys; no se quitan las contraseñas.
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
configuration OK
El grupo docker hace a prueba administrador del servidor. Vuelve a entrar para usarlo.
Hecho: se escribió /etc/ssh/sshd_config.d/00-feruga.conf.
Ensayo: se omite recargar sshd.
SSH: entrada por contraseña desactivada; se conserva la entrada con llave.
Ensayo: se omite encender servicios, activar ufw y recargar sshd; se comprobaron paquetes y archivos.
Servidor preparado: 1 cambios; arriba se detalla cada uno.
El repositorio ya está clonado. Sigue con sh operacion/entorno.sh <dominio> y la sección 2.4 de docs/operacion.md.
Docker publica puertos por fuera de ufw: solo debe publicar el proxy; operacion/comprobar.ts ya lo comprueba al publicar.

== Si SSH rechaza el archivo nuevo, se retira sin recargar
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
configuration OK
El grupo docker hace a prueba administrador del servidor. Vuelve a entrar para usarlo.
/etc/ssh/sshd_config.d/99-roto.conf: line 1: Bad configuration option: UnaDirectivaInexistente
/etc/ssh/sshd_config.d/99-roto.conf: terminating, 1 bad configuration options
No se pudo preparar el servidor: la configuración actual de SSH es inválida; no se activa ufw.
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
configuration OK
El grupo docker hace a prueba administrador del servidor. Vuelve a entrar para usarlo.
Hecho: se escribió /etc/ssh/sshd_config.d/00-feruga.conf.
No se pudo preparar el servidor: otra directiva de SSH impide aplicar: passwordauthentication no.
Se retiró el cambio de SSH; se conserva la configuración anterior.

== Un daemon.json distinto se conserva y detiene el guion sin otros cambios
No se pudo preparar el servidor: /etc/docker/daemon.json ya existe con otro contenido; no se pisa.

== Una llave de Docker falsa y una regla adicional de ufw se rechazan
No se pudo preparar el servidor: no se pudo leer la llave de Docker.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)
Docker version 29.9.2, build a82e528
Docker Compose version v5.6.1
configuration OK
El grupo docker hace a prueba administrador del servidor. Vuelve a entrar para usarlo.
No se pudo preparar el servidor: /etc/ufw/user.rules contiene reglas adicionales; revísalas antes de limitar la entrada a 22/tcp, 80/tcp, 443/tcp y 443/udp.
WARN: initcaps
[Errno 2] iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)

Rules updated
Rules updated (v6)

== El candado impide otra preparación simultánea
No se pudo preparar el servidor: ya hay otra preparación del servidor en curso.

== Ensayo completo: todas las comprobaciones pasaron

== Se borran los contenedores propios al salir

Código de salida: 0
```

6. Final: ensayo completo aprobado, contenedores propios ausentes y propuesta de sección 2.1 guardada en este informe. No quedan trabajos autorizados pendientes; las pruebas reales están identificadas arriba.
