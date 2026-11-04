# Guía de operación

Cómo se instala, se cuida y se recupera el sistema en su servidor. Es para quien da el soporte
técnico y para el dueño; la gente del patio no necesita nada de esto.

> **Estado (4 de noviembre de 2026).** Todavía no hay servidor, dominio ni almacenamiento
> contratados. Esta guía está escrita con lo que hay en el repositorio: cada orden que aparece
> aquí existe y está probada en las pruebas automáticas y en los simulacros
> (`operacion/ensayo.sh`, `operacion/ensayo-publicacion.sh` y `operacion/ensayo-servidor.sh`), que
> arman una instalación completa en una máquina de desarrollo. Codex la revisó contra los guiones
> el 4 de noviembre (`docs/revisiones/2026-11-04-codex-revision-de-la-guia.md`). **Lo que solo se
> puede comprobar en el servidor de verdad está marcado como «por probar en el servidor»**, y está
> junto en la sección 10. Cuando se haga, esta guía se corrige con lo que no haya salido como está
> escrito.

**Cómo leer las órdenes.** Cada bloque dice en qué máquina va. Lo que está en MAYÚSCULAS
(`NOMBRE_DEL_RESPALDO`, `TU_DOMINIO`) se cambia por el valor de verdad. El signo `<` delante de un
archivo es parte de la orden: le pasa ese archivo al programa (así entra la llave).

**Palabras que aparecen.** *Git* guarda las versiones del código, y un *commit* es una versión
exacta. *Docker* corre cada parte del sistema aislada, en un *contenedor*, hecho de una *imagen*;
*Compose* las coordina. El *proxy* es la puerta del sitio: atiende por *HTTPS*, que cifra la
conexión y la acredita con un *certificado*. *SSH* es como se entra al servidor desde otra
computadora. Un *manifiesto* es la anotación que acompaña a un respaldo o a una publicación. Los
permisos `700` (carpeta) y `600` (archivo) quieren decir «solo su dueño». En una fecha como
`2026-12-01T06:00:00Z`, la `Z` quiere decir hora UTC, no la del patio.

## 1. Las piezas, y quién tiene qué

| Pieza | Qué es | Quién la tiene |
|---|---|---|
| El servidor | Una máquina con Docker y Git. Corre la base, la aplicación, el proxy (HTTPS) y el servicio que respalda. | Soporte |
| La carpeta del sistema | Este repositorio, en el commit publicado. | En el servidor, y en el repositorio |
| El `.env` | Las claves del sistema y a dónde van los respaldos. Solo lo lee quien lo creó. | En el servidor; **copia en el paquete de recuperación** |
| La carpeta `publicaciones/` | Qué versión corre y con qué imágenes. Lleva claves: no va al repositorio. | Solo en el servidor |
| El almacenamiento | Dos depósitos fuera del servidor: los respaldos de cada hora (30 días) y uno por día (un año). | El proveedor |
| La llave privada | Abre los respaldos, y de ella sale el sello que los acredita. **No se guarda en el servidor**: cuando hace falta allá (volver a un respaldo, instalar desde uno), se le pasa por SSH a la orden, sin escribirla en su disco (abajo). | El dueño y soporte |
| Los vigilantes | Un servicio de fuera que espera un aviso a su hora y alerta si no llega. | Soporte recibe los avisos |

### El paquete de recuperación

Es lo que hace falta para volver a levantar el negocio si el servidor desaparece. Lo guardan **el
dueño y quien da el soporte**, cada uno su copia, **fuera del servidor y fuera de la carpeta del
sistema**: en una carpeta privada (`chmod 700`), por ejemplo `~/recuperacion-feruga/`. En esta guía,
`/carpeta/privada/` es esa carpeta.

1. **La llave privada de los respaldos** (`llave-privada.txt`, la que crea `fuera.sh llave`, 2.2).
   Sin ella ningún respaldo se puede abrir: no hay otra copia ni manera de reponerla.
2. **Una copia del `.env`** del servidor.
3. **La credencial de recuperación del almacenamiento**, la que solo lee (no es la del servidor),
   en el archivo `recuperacion.env` (su forma, en la sección 6).
4. **Dónde está el repositorio** y cómo entrar a él, y esta guía.

Se actualiza **cada vez que cambie algo de eso**: una clave del `.env`, la llave, el proveedor del
almacenamiento. Un paquete viejo es peor que ninguno: da confianza y no sirve.

**Pasar la llave al servidor sin guardarla ahí.** Las dos órdenes del servidor que la piden
(`volver.sh` y `publicar.sh --desde-respaldo`) la leen de su entrada. Desde la computadora que la
guarda, con la conexión SSH que ya se probó (2.1), se le pasa así:

```bash
# En la computadora que guarda la llave:
ssh USUARIO@SERVIDOR 'cd feruga/sistema && sh operacion/volver.sh' < /carpeta/privada/llave-privada.txt
```

## 2. Instalar por primera vez

El orden: preparar el servidor (2.1); fuera de él, la llave y el sello (2.2); contratar y preparar
el almacenamiento y los vigilantes (2.3) y los avisos (2.3 bis); y de vuelta en el servidor, el
entorno y la primera publicación (2.4).

### 2.1 El servidor — *ensayado en un Ubuntu desechable; por probar en el servidor*

Un **Ubuntu 24.04 LTS recién contratado**, con entrada por SSH y la consola del proveedor a la mano
(es la salida si algo deja fuera la conexión). El guion está dentro del repositorio, así que Git se
instala a mano para clonarlo:

```bash
# En el servidor:
sudo apt-get update && sudo apt-get install -y git
git clone DIRECCION_DEL_REPOSITORIO feruga && cd feruga/sistema
sudo sh operacion/servidor.sh                 # como root, sin sudo
```

Lo que deja:

- **Docker** con su plugin de Compose, del repositorio oficial de Docker. Antes de confiar en su
  llave comprueba la huella completa (`9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88`).
- **Los registros de Docker no llenan el disco**: cada contenedor guarda a lo más tres archivos de
  10 MB. Si `/etc/docker/daemon.json` ya existe con otra cosa, se detiene y no lo pisa.
- **El cortafuegos** (ufw): no entra nada salvo 22/TCP (SSH), 80/TCP y 443/TCP (el sitio), y
  443/UDP, por IPv4 e IPv6; salir sí se puede. (443/UDP queda permitido para cuando el sitio use
  HTTP/3; hoy el proxy publica solo por TCP, así que ahí no contesta nada.) Si ya había otras
  reglas, se detiene para que se revisen; no las borra. **Docker abre puertos por fuera del
  cortafuegos**: por eso solo el proxy publica, y eso lo comprueba cada publicación
  (`operacion/comprobar.ts`).
- **Las actualizaciones de seguridad**, automáticas.
- Si se corrió con `sudo`, esa persona entra al grupo `docker`: **eso la hace administradora del
  servidor**. Hay que salir y volver a entrar para que cuente.

Se puede correr las veces que sea: si ya está todo, dice «No hay nada que cambiar.». Si algo no está
como espera, se detiene y dice qué; **lo que ya hizo antes de detenerse se queda hecho** (paquetes
instalados, archivos escritos): se corrige lo que dijo y se vuelve a correr, y sigue desde ahí. Lo
único que deshace solo es el cambio de SSH de abajo, si no pasa su comprobación.

**La primera corrida no toca SSH.** Para que el servidor ya no acepte contraseñas:

1. La cuenta con que se entra (root o la de `sudo`) tiene su llave en `~/.ssh/authorized_keys`
   (la carpeta `.ssh` en `700` y el archivo en `600`).
2. Sin cerrar la sesión abierta, desde otra terminal se prueba **una segunda conexión solo con la
   llave**:

   ```bash
   # En la computadora de soporte:
   ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no USUARIO@SERVIDOR
   ```

3. Solo si esa entra:

   ```bash
   # En el servidor:
   sudo sh operacion/servidor.sh --quitar-contrasenas
   ```

Se niega si la cuenta no tiene una llave válida, o si otra parte de la configuración de SSH no deja
apagar las contraseñas (en ese caso se revisa con quien sepa; no se fuerza). Antes de recargar SSH
lo comprueba, y si no pasa, quita su cambio. Después se prueba otra vez una conexión con llave
antes de cerrar las sesiones abiertas.

El guion se ensaya en esta máquina, sin servidor, con `sh operacion/ensayo-servidor.sh` (solo pide
Docker): lo corre dos veces en un Ubuntu desechable, comprueba que la segunda no cambie nada y que
se niegue en los casos en que debe negarse. Ahí no puede encender servicios, activar el
cortafuegos ni recargar SSH; eso, y entrar desde otra máquina, **está por probar en el servidor**.

Sigue 2.2, en la computadora del dueño o de soporte; la sesión SSH puede quedar abierta.

### 2.2 Fuera del servidor: la llave y el sello

En la computadora del dueño o de soporte, **no en el servidor**. Solo pide Docker y este
repositorio (`git clone`); no se instala nada más. Lo de fuera del servidor lo hace un solo guion,
`operacion/fuera.sh`, que corre en un contenedor con las mismas herramientas con que el servidor
respalda (la primera vez tarda unos minutos en prepararlas). Desde la carpeta `feruga/sistema` de
esa computadora:

```bash
# En la computadora que va a guardar la llave:
mkdir -m 700 -p /carpeta/privada
sh operacion/fuera.sh llave /carpeta/privada/llave-privada.txt   # crea la llave y dice lo que va al .env
sh operacion/fuera.sh sello < /carpeta/privada/llave-privada.txt # esos dos renglones otra vez, cuando haga falta
```

`fuera.sh llave` crea el archivo solo para su dueño y **se niega si ya existe**: una llave no se
escribe encima de otra. La llave no sale en pantalla.

Los dos renglones que dice son `RESPALDO_LLAVE_PUBLICA=age1…` y `RESPALDO_SELLO=…` (64 letras).
**Van juntos y de la misma llave:** con el sello de una llave y la pública de otra, el servidor
tomaría respaldos que después nadie podría acreditar, y avisaría «bien». El programa lee la llave
como la lee `age` —una sola, sin contar los comentarios, y bien escrita— y se niega si no.

Si en esa computadora no está este sistema, salen igual con herramientas comunes (la pública la
dice `age-keygen -y llave-privada.txt`; el sello, esto):

```bash
grep -v '^#' llave-privada.txt | grep -o 'AGE-SECRET-KEY-1[0-9A-Z]*' | head -1 | tr -d '\n' | openssl dgst -sha256 -hmac 'feruga: sello de los respaldos, v1' -r | cut -d' ' -f1
```

(Una prueba comprueba que las dos maneras dan el mismo sello; la de `openssl` no revisa que la
llave esté bien escrita.) Esos dos renglones van al `.env` del servidor (2.4); **la llave privada,
al paquete de recuperación y a ningún otro lado**. De ninguno de los dos se vuelve a la llave.

### 2.3 El almacenamiento y los vigilantes — *por probar en el servidor*

- **Dos depósitos**, los dos con versiones y retención con candado: el de cada hora, 30 días; el
  diario, 365. Está decidido que sea Backblaze B2; las pruebas se hicieron contra MinIO, y hay que
  repetirlas contra el depósito contratado.
- **Para cada depósito, una credencial del servidor** que sube y lee lo cifrado de su carpeta —también
  las versiones anteriores de un objeto, que hacen falta para `--como-estaba` (sección 7)— y no
  puede borrar ni cambiar la retención. **Y una credencial de recuperación**, que solo lee: esa va
  al paquete (`recuperacion.env`, sección 6), no al servidor. Con ella se prepara ya
  `recuperacion.env` en la carpeta privada: se usa al terminar 2.4.
- **Un candado de un año es un año:** un respaldo diario no se puede borrar antes, ni queriendo.
- **Que se borre lo vencido lo hace el proveedor, no el sistema:** se configura en cada depósito
  una regla que borre lo que pasó de 30 (o 365) días —sin borrar nada antes de que venza su
  candado—, y se comprueba que se cumple.
- **Los vigilantes** (está previsto Healthchecks, con aviso por correo y por Telegram). Son cuatro
  señales, y **sus reglas se configuran en Healthchecks**: poner su dirección en el `.env` solo hace
  que el sistema les avise.
  - **Respaldos** (`RESPALDO_VIGIA_URL`): un aviso en cada hora de `RESPALDO_HORARIO`, en la hora
    del patio (`America/Mexico_City`). El horario que genera `entorno.sh` es de 07:00 a 20:00: la
    regla debe esperar justo esas horas (en Healthchecks, horario «cron» `0 7-20 * * *` en esa
    zona) y no la noche, con una gracia que cubra lo que tarda un respaldo (empezar con 30 minutos
    y ajustar con lo que se mida).
  - **Diario** (`RESPALDO_VIGIA_DIARIO_URL`): un aviso al día (cron `0 7 * * *` en la zona del
    patio, con unas horas de gracia: el diario sale con el primer respaldo bueno del día).
  - **Ensayo de restauración** (`ENSAYO_VIGIA_URL`, en `recuperacion.env`): alerta si pasan más de
    35 días sin un ensayo que terminó bien (periodo de 30 días y gracia de 5).
  - **El latido del sitio** (`LATIDO_VIGIA_URL`): el servicio de respaldos le pregunta al sitio por
    HTTPS, por el proxy y con el certificado de verdad, cada 5 minutos, y si contesta se lo dice a
    su señal. En Healthchecks: periodo de 5 minutos y gracia de 15 (una publicación detiene el
    servicio unos minutos; eso no debe sonar). **Y avisa antes de que el sitio se caiga:** si queda
    menos del 10 % del disco (o menos de 5 GB), o si al certificado le queda menos de un sexto de
    su vida (unos 15 días en uno de 90) sin que el proxy lo haya renovado, el latido sale como
    falla, con lo que encontró dicho en llano; la señal alerta enseguida y enseña ese texto.

### 2.3 bis Los avisos del cajón, por Telegram y por correo

Un corte que no cuadró, o un cajón que se abrió con otra cantidad que la que se dejó, sale en la
barra del responsable; con esto sale además afuera, a quien se diga. Aquí se juntan los datos; se
prueban al terminar 2.4.

- **Telegram.** En Telegram, con **@BotFather**: `/newbot`, un nombre, y da la clave del bot →
  `AVISOS_TELEGRAM_TOKEN` (es un secreto: solo va al `.env`). Se crea un grupo con quienes deben
  recibirlos (el dueño, el responsable) y se agrega el bot. Para saber el número del grupo: en el
  grupo se manda un comando dirigido al bot, `/start@NOMBRE_DEL_BOT` (un mensaje común puede no
  llegarle), y se abre `https://api.telegram.org/botLA_CLAVE_DEL_BOT/getUpdates`; el número es el
  de `"chat":{"id":…}` de ese grupo, **copiado tal cual, con su signo de menos** →
  `AVISOS_TELEGRAM_CHAT`.
- **Correo.** Una cuenta que manda —por ejemplo `avisos@` el dominio— y su servidor de correo
  (lo da el proveedor del dominio): `AVISOS_CORREO_SMTP=smtps://avisos%40TU_DOMINIO:LA_CLAVE@SERVIDOR_DE_CORREO:465`
  (la `@` de la cuenta se escribe `%40`; con el puerto 587, `smtp://…` y se cifra con STARTTLS: sin
  cifrar no se manda nada). `AVISOS_CORREO_DE` es esa cuenta y `AVISOS_CORREO_PARA`, a quiénes,
  separados por comas.

Un aviso que alguien ya vio en la pantalla no se manda. Uno se da por enviado cuando salió por
todos los canales; si uno falla, al minuto se vuelve a intentar **por todos**, así que puede llegar
dos veces por el que sí funcionó: es el mismo aviso, no otra diferencia.

### 2.4 En el servidor

Antes: **el dominio** ya apunta a la dirección de este servidor (en el proveedor del dominio, un
registro A para IPv4 y, si tiene, AAAA para IPv6), y desde fuera llegan los puertos 80 y 443/TCP.
Sin eso el certificado no se emite y la primera publicación no abre. Si se preparó Docker con
`sudo`, salir y volver a entrar antes de seguir.

En la carpeta `feruga/sistema` que se clonó en 2.1:

```bash
# En el servidor:
sh operacion/entorno.sh TU_DOMINIO            # genera .env con claves nuevas; no muestra ninguna
```

`entorno.sh` ya llena lo que puede inventar —las claves de la base (`BD_CLAVE`, `WEB_BD_CLAVE`), la
de las sesiones (`SESION_CLAVE`), el dominio y el horario de los respaldos— y no escribe encima de
un `.env` que ya exista. En el `.env` falta poner lo que no puede inventar:

- `RESPALDO_LLAVE_PUBLICA` y `RESPALDO_SELLO`: los dos renglones de 2.2.
- El depósito de cada hora: `RESPALDO_DESTINO` (`respaldo:NOMBRE_DEL_DEPOSITO/feruga`),
  `RCLONE_CONFIG_RESPALDO_PROVIDER`, `RCLONE_CONFIG_RESPALDO_ENDPOINT`,
  `RCLONE_CONFIG_RESPALDO_REGION`, `RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID` y
  `RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY` (la credencial **del servidor**). `…_TYPE=s3` ya viene.
- El diario, lo mismo con `RESPALDO_DESTINO_DIARIO` (`diario:NOMBRE_DEL_DEPOSITO/feruga`) y
  `RCLONE_CONFIG_DIARIO_…`.
- Las señales `RESPALDO_VIGIA_URL` y `RESPALDO_VIGIA_DIARIO_URL` (2.3).

Sin eso nada arranca, y dice qué falta. Lo que conviene poner aunque no lo exija: el latido
(`LATIDO_VIGIA_URL`) y los avisos del cajón (2.3 bis); sin ellos el sistema funciona, pero nadie se
entera desde fuera. `NEGOCIO_NOMBRE` es el nombre con que salen los avisos. **Guarda una copia del
`.env` en el paquete de recuperación.**

```bash
# En el servidor:
sh operacion/publicar.sh                               # construye, comprueba, migra, levanta y abre
sh operacion/compose.sh run --rm consola arranque      # el primer responsable y el código del primer equipo
```

El arranque escribe en la terminal **una sola vez** la clave del primer responsable: se anota y se
le entrega en ese momento, porque no se vuelve a enseñar (si se pierde, se le pone otra:
`sh operacion/compose.sh run --rm consola persona clave "NOMBRE_DEL_RESPONSABLE"`). Y escribe el
código para dar de alta el primer equipo, que **sirve una vez y vence en 15 minutos**: si vence
antes de usarlo, se pide otro justo antes,
`sh operacion/compose.sh run --rm consola equipo codigo "Tableta del patio"`. Correr el arranque
otra vez no hace daño.

**Antes de dar la instalación por buena, comprobar el sello desde fuera** — *por probar en el
servidor.* La primera publicación no toma respaldo (no había nada que respaldar): se toma uno ahora,
con lo que dejó el arranque, y se comprueba ese mismo desde fuera:

```bash
# En el servidor (dice, en su renglón «respaldo: …», el nombre del respaldo):
sh operacion/compose.sh run --rm --no-deps respaldo ahora

# En la computadora que guarda la llave, con ese nombre:
FUERA_ENTORNO=/carpeta/privada/recuperacion.env sh operacion/fuera.sh version NOMBRE_DEL_RESPALDO < /carpeta/privada/llave-privada.txt
```

Si contesta (el respaldo, su publicación y su commit), el respaldo lleva el sello de esa llave y
está cifrado para ella: la pública y el sello del servidor son los suyos. Si dice que no lleva el
sello de este negocio, o que se cifró para otra llave, el `.env` tiene un renglón de otra llave: se
ponen los dos que da `fuera.sh sello` (2.2), `sh operacion/levantar.sh`, y se toma otro respaldo. Y
lo que de verdad lo acredita es abrirlo: **el primer ensayo de restauración (sección 6) se hace ese
mismo día**, desde fuera y con la llave del dueño. Hasta no ver las dos cosas, los respaldos no
cuentan.

Y los avisos del cajón, si se pusieron: `sh operacion/compose.sh run --rm respaldo probar-avisos`
manda uno de prueba por cada canal; se comprueba que llegue.

Si el certificado no se emite, el sitio no se da por disponible y la operación no se abre. La
salida nunca es quitar la cookie segura ni servir por HTTP: se revisa que el dominio apunte al
servidor y que los puertos 80 y 443 lleguen. El certificado que se está presentando, y cuándo
vence: `sh operacion/compose.sh run --rm --no-deps comprobacion certificado`.

### 2.5 El primer día, en la pantalla

1. En el equipo del patio, abrir `https://TU_DOMINIO` y teclear el código del equipo.
2. Entrar como el responsable, con la clave que dio el arranque.
3. Capturar lo que hay en el patio (el saldo inicial de cada material) y terminar el arranque.
4. Abrir el día, poner los precios y publicarlos. Desde ahí el mostrador ya atiende.
5. Las demás personas y equipos se dan de alta en **Panel → Ajustes** (lo hace un responsable
   facultado para autorizar, con su clave). Los responsables y la facultad de autorizar, por la
   consola: `sh operacion/compose.sh run --rm consola persona alta "Ana" responsable --autoriza`.

## 3. Lo de todos los días

No hay nada que hacer en el servidor: los respaldos salen solos a su hora, y si uno falla, llega un
aviso. Para mirar:

```bash
# En el servidor:
sh operacion/compose.sh ps                               # qué corre
sh operacion/compose.sh logs --tail 50 web               # lo último que dijo la aplicación
sh operacion/compose.sh run --rm --no-deps respaldo lista            # los respaldos de cada hora
sh operacion/compose.sh run --rm --no-deps respaldo lista --diario   # los que se guardan un año
sh operacion/compose.sh run --rm --no-deps respaldo ahora            # uno ahora mismo
```

**En operación no se usa `docker compose` a secas:** no arranca, porque las imágenes las pone cada
publicación. Para consultar y para la consola, `sh operacion/compose.sh`; lo que cambia qué corre
se hace con `levantar.sh`, `publicar.sh` o `volver.sh`. Todos piden el mismo candado: dos
operaciones a la vez no entran, y si un guion muere el candado queda libre solo.

**Cambiar algo del `.env`** (un horario, una señal, una credencial): se edita y se corre
`sh operacion/levantar.sh`, que comprueba primero —sin tocar lo que atiende— y solo entonces
levanta. Y se actualiza la copia del paquete.

## 4. Los respaldos, y qué garantizan

- Sale uno a cada hora del horario (`RESPALDO_HORARIO`, en la hora del patio), cifrado con la
  llave pública. **El servidor no puede leer sus propios respaldos, ni borrar los anteriores.** El
  horario que genera `entorno.sh` es de 07:00 a 20:00: **lo que se capture fuera de esas horas no
  queda respaldado hasta las 07:00**. Si se trabaja más temprano o más tarde, se amplía el horario.
- De cada día, el primero que salió bien se guarda además un año, en el otro depósito.
- Un respaldo existe cuando tiene su manifiesto, y **el manifiesto va sellado**: el sello dice que
  lo tomó este negocio y que nadie lo cambió después. Quien restaura lo comprueba con la llave
  privada antes de bajar nada. Un respaldo sin sello, o con el de otra llave, no se restaura.
- Lo que el sello no cubre: **quien se haga del servidor entero tiene la clave con que se sella**,
  y con la credencial del servidor puede subir un respaldo nuevo, sellado, con el nombre de uno de
  antes. Los depósitos guardan las versiones anteriores de cada objeto, pero pedir un respaldo por
  su nombre trae la última. Si alguien pudo tener el servidor: con soporte, se elige un respaldo
  de antes de la intrusión y se lee el almacenamiento **como estaba en un momento anterior**
  (`fuera.sh ensayo --como-estaba=MOMENTO`, sección 6), comparando con lo que se sepa de fuera.
- **Auténtico no es lo mismo que reciente.** El sello no dice que el depósito enseñe todos los
  respaldos. Al restaurar se dice de hace cuánto es el que se va a usar, y si es «el último» y
  tiene más de un día, se advierte. Con qué compararlo: el último «terminó bien» del vigilante.
- `respaldo lista` dice además cuál es el último con su manifiesto en orden, si en el entorno está
  el sello; sin él, enseña lo que hay y dice que no lo comprobó.

## 5. Publicar una versión

Con la carpeta en el commit que se va a publicar, sin cambios sueltos, y fuera del horario de
atención (cierra el negocio unos minutos):

```bash
# En el servidor:
git pull                      # o el commit que se haya decidido
sh operacion/publicar.sh
```

Hace, en orden y anotando cada paso antes de darlo: preparar sin tocar nada (construir, comprobar
el entorno y la red, y que el migrador nuevo diga que puede con la base que hay); cerrar la
operación; **tomar un respaldo y anotar su nombre**; migrar; levantar la versión nueva cerrada y
comprobarla por HTTPS; abrir. Antes de cerrar no altera lo que atiende; entre cerrar y abrir, el
negocio está cerrado pase lo que pase; y una vez que decide abrir, no retrocede.

**Si se interrumpe** (se cayó la conexión, se apagó la máquina), nada más se publica ni se levanta
hasta recuperarla, **con la carpeta en el mismo commit** que se estaba publicando (no se hace
`git pull` hasta terminar):

```bash
# En el servidor:
sh operacion/publicar.sh --recuperar
```

Recuperar lee lo que quedó anotado y hace lo único que toca:

- **Una versión nueva sobre otra que ya corría:** si ya se había decidido abrir, termina; si no se
  había migrado, restablece la versión anterior y abre; y si la migración empezó y no se llegó a
  abrir, **se queda cerrado** y dice la salida: volver al respaldo que se tomó antes de migrar (abajo).
- **La primera publicación**, que nunca abrió: no hay versión ni respaldo de antes, y no hace
  falta: vuelve a migrar y sigue.
- **Una instalación desde un respaldo** (sección 7) que se interrumpió: lo dice, y se vuelve a
  correr `publicar.sh --desde-respaldo` con la llave.

Cuando la salida es volver al respaldo: el negocio estuvo cerrado desde antes de tomarlo, así que
**no se pierde ninguna operación del negocio** hecha por los caminos de la aplicación. (Sí cambia
otra cosa: la base restaurada tiene otra marca, las sesiones se cierran y los folios siguen en un
bloque nuevo.) El orden, en la misma ventana, **todavía con la carpeta en el commit que falló**:
`volver.sh` con la llave, `volver.sh --abrir`, y solo después se cambia al commit corregido y se
publica. Entre abrir y publicar la corregida, que nadie capture: eso lo cuida quien está en el
patio, no un candado.

**Si el respaldo previo no se puede restaurar** —venció, no se encuentra, la llave no es la suya, o no
hay espacio para la base apartada, la restaurada y los temporales— no hay salida automática: la base
que falló sigue apartada y sin tocar, y se arregla a mano con soporte. Para que no llegue a pasar: el
cierre no dura más que la retención de los respaldos, el disco tiene espacio para dos bases más, y
la llave es la que se comprobó desde fuera (2.4).

**Volver al respaldo previo** lo hace quien tiene la llave, pasándola por SSH (sección 1):

```bash
# En la computadora que guarda la llave:
ssh USUARIO@SERVIDOR 'cd feruga/sistema && sh operacion/volver.sh' < /carpeta/privada/llave-privada.txt
# restaura ese respaldo; la versión anterior queda levantada y CERRADA

# En el servidor, cuando ya se vio que todo está bien:
sh operacion/volver.sh --abrir
```

La base que falló no se borra: queda apartada con otro nombre, y se borra a mano cuando ya no haga
falta. La base restaurada abre un bloque nuevo de folios.

## 6. El ensayo de restauración — *por probar en el servidor*

Un respaldo que nunca se restauró no es un respaldo. **Cada mes**, una persona —porque la llave no
vive en ningún servidor— baja el último respaldo en otra máquina y lo restaura. Hay un vigilante
propio que alerta si pasan más de 35 días sin un ensayo.

En cualquier computadora con Docker y este repositorio, desde su carpeta `feruga/sistema`, con la
llave y `recuperacion.env` en la carpeta privada:

```bash
# En la computadora que guarda la llave:
FUERA_ENTORNO=/carpeta/privada/recuperacion.env sh operacion/fuera.sh ensayo < /carpeta/privada/llave-privada.txt
# el último de los que se guardan un año:
FUERA_ENTORNO=/carpeta/privada/recuperacion.env sh operacion/fuera.sh ensayo --diario < /carpeta/privada/llave-privada.txt
# uno en particular (--diario=NOMBRE para uno del diario), o el almacenamiento como estaba en un momento:
FUERA_ENTORNO=/carpeta/privada/recuperacion.env sh operacion/fuera.sh ensayo --remoto=NOMBRE_DEL_RESPALDO < /carpeta/privada/llave-privada.txt
FUERA_ENTORNO=/carpeta/privada/recuperacion.env sh operacion/fuera.sh ensayo --como-estaba=2026-12-01T06:00:00-06:00 < /carpeta/privada/llave-privada.txt
```

Levanta una base de PostgreSQL desechable —de la misma imagen que la del servidor, sin abrir ningún
puerto—, comprueba el sello, baja el respaldo, lo descifra, lo restaura, lo audita y, solo si
terminó bien, avisa al vigilante de los ensayos. No toca el servidor. Después borra la base
desechable y comprueba que ya no esté; **solo entonces** dice cómo salió:

- «**El ensayo pasó**… La base desechable ya se borró»: listo.
- «Se restauró bien, pero el vigilante de los ensayos no recibió el aviso»: el respaldo sirve; se
  revisa `ENSAYO_VIGIA_URL` y la conexión, porque el vigilante va a alertar como si no se hubiera hecho.
- «**No se pudo borrar la base desechable**» (con su nombre y la orden para borrarla): tiene una
  copia de los datos del negocio; se borra antes de dar el ensayo por terminado.
- «**El ensayo NO pasó**»: lo de arriba dice por qué. Si fue la restauración, ese respaldo no se pudo
  abrir: es urgente, aunque el negocio siga operando.

`recuperacion.env` lleva lo mismo que el `.env` del servidor para el almacenamiento, pero con la
credencial que solo lee, y a quién avisar del ensayo. **Cada dato en su renglón, `NOMBRE=valor`, sin
comillas y sin nada después del valor**; los comentarios, en renglones aparte que empiezan con `#`.
`fuera.sh` se niega con cualquier otra cosa, y dice en qué renglón. Se cambian las MAYÚSCULAS por
los valores de verdad:

```
RESPALDO_DESTINO=respaldo:DEPOSITO_DE_CADA_HORA/feruga
RCLONE_CONFIG_RESPALDO_TYPE=s3
RCLONE_CONFIG_RESPALDO_PROVIDER=PROVEEDOR
RCLONE_CONFIG_RESPALDO_ENDPOINT=DIRECCION_DEL_PROVEEDOR
RCLONE_CONFIG_RESPALDO_REGION=REGION
# Credencial de recuperación (solo lee) del depósito de cada hora
RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID=IDENTIFICADOR
RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY=SECRETO
RESPALDO_DESTINO_DIARIO=diario:DEPOSITO_DIARIO/feruga
RCLONE_CONFIG_DIARIO_TYPE=s3
RCLONE_CONFIG_DIARIO_PROVIDER=PROVEEDOR
RCLONE_CONFIG_DIARIO_ENDPOINT=DIRECCION_DEL_PROVEEDOR
RCLONE_CONFIG_DIARIO_REGION=REGION
# Credencial de recuperación (solo lee) del depósito diario
RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID=IDENTIFICADOR
RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY=SECRETO
# La señal de los ensayos (no es la de los respaldos ni la del latido)
ENSAYO_VIGIA_URL=https://hc-ping.com/LA_DE_LOS_ENSAYOS
```

El recorrido completo desde otra máquina, siguiendo solo esta guía y midiendo cuánto tarda, es una
de las condiciones para operar con datos de verdad, y **todavía no se ha hecho contra el
almacenamiento contratado**: `fuera.sh` está probado en el ensayo de la operación, contra un
almacenamiento y un vigilante de pruebas.

## 7. Si se pierde el servidor

Con el paquete de recuperación, en una máquina nueva:

1. Se prepara **solo como en 2.1**: Git, clonar una vez, `servidor.sh`, y comprobar la entrada con
   llave. **No** se corre `entorno.sh`, ni `publicar.sh` a secas, ni el arranque: instalar desde un
   respaldo pide una instalación sin nada publicado y una base vacía.
2. El `.env` del paquete se copia a `feruga/sistema/.env`, solo para su dueño (`chmod 600 .env`).
3. El dominio se apunta al servidor nuevo (2.4).
4. Desde fuera se pregunta de qué versión es el respaldo:
   `FUERA_ENTORNO=/carpeta/privada/recuperacion.env sh operacion/fuera.sh version < /carpeta/privada/llave-privada.txt`
   (con un nombre al final, de uno en particular). Dice el commit.
5. En el servidor, la carpeta se pone en ese commit: `git checkout COMMIT`.
6. Se instala desde el respaldo, pasando la llave por SSH:

```bash
# En la computadora que guarda la llave (el último respaldo de cada hora):
ssh USUARIO@SERVIDOR 'cd feruga/sistema && sh operacion/publicar.sh --desde-respaldo' < /carpeta/privada/llave-privada.txt
# o uno en particular, por su nombre:
ssh USUARIO@SERVIDOR 'cd feruga/sistema && sh operacion/publicar.sh --desde-respaldo=NOMBRE_DEL_RESPALDO' < /carpeta/privada/llave-privada.txt
```

El respaldo dice qué versión del sistema lo tomó, y de qué commit era; se le cree porque lleva el
sello de la llave. **La carpeta tiene que estar en ese commit**: si no lo está, el guion lo dice y
no toca nada. Las imágenes se construyen ahí mismo, de ese commit: del almacenamiento no se baja
nada que se vaya a ejecutar. Después sigue como cualquier publicación: levanta cerrado, comprueba y
abre.

Así busca en el depósito **de cada hora** (`RESPALDO_DESTINO`), y `--desde-respaldo=NOMBRE` elige
dentro de él. Dos opciones más, que se pueden juntar:

- `--diario`: del depósito que guarda uno por día un año (`RESPALDO_DESTINO_DIARIO`), cuando lo de
  cada hora ya venció o no sirve.
- `--como-estaba=MOMENTO`: lee el almacenamiento **como estaba en ese momento** (fecha, hora y zona,
  por ejemplo `2026-12-01T06:00:00-06:00`). Es para cuando alguien pudo tener el servidor y subir
  algo con el nombre de un respaldo de antes (sección 4): se elige un momento anterior a la intrusión.

```bash
# En la computadora que guarda la llave: primero, de qué versión es (y el commit, para el paso 5):
FUERA_ENTORNO=/carpeta/privada/recuperacion.env sh operacion/fuera.sh version NOMBRE_DEL_RESPALDO --diario --como-estaba=MOMENTO < /carpeta/privada/llave-privada.txt
# y después, instalar ese mismo:
ssh USUARIO@SERVIDOR 'cd feruga/sistema && sh operacion/publicar.sh --desde-respaldo=NOMBRE_DEL_RESPALDO --diario --como-estaba=MOMENTO' < /carpeta/privada/llave-privada.txt
```

Si se interrumpe, se retoma con la misma orden (o sin las opciones: las recuerda); con otro respaldo,
otro depósito u otro momento, se niega. No se cambian los destinos del `.env` para simular nada de
esto. *Instalar desde el diario «como estaba» está probado en las pruebas de los guiones; su paso en
el simulacro de publicación está por terminarse (encargo 39 de Codex).*

**Lo que se asentó después de ese respaldo no está, y no vuelve solo.** Se concilia a mano:

- **Las compras y las ventas**, de las copias de los comprobantes que conserva el negocio (salen
  por duplicado para esto). Se vuelven a capturar; llevan folios nuevos, del bloque que la
  restauración abrió, y los folios de los comprobantes perdidos no se repiten.
- **El inventario**, con un conteo físico de lo que se movió.
- **Conteos, bajas, separaciones y correcciones** de esas horas no dejan papel: se pregunta a quien
  los hizo y se vuelven a hacer.

Cuánto se pierde: lo asentado después del último respaldo que se pudo restaurar. Con los respaldos
saliendo bien cada hora, durante todo el horario de trabajo, es cerca de una hora. **No es una
garantía**: es más si un respaldo falló, si el servicio estaba detenido, o si se trabajó fuera del
horario de respaldos (sección 4). Antes de recuperar se mira de cuándo es el respaldo.

## 8. Cambiar una clave

| Clave | Qué pasa al cambiarla | Cómo |
|---|---|---|
| `SESION_CLAVE` | Deja fuera a todos los equipos: hay que darlos de alta otra vez, con código nuevo. | `.env`, y `sh operacion/levantar.sh` |
| `WEB_BD_CLAVE` (el usuario con que la aplicación entra a la base) | Nada que se note. | `.env`, y `sh operacion/levantar.sh`: la clave se le pone al usuario cada vez |
| `BD_CLAVE` (administración de la base) | La base se reinicia unos segundos: hacerlo fuera de horario. Nada más se nota. | **Cambiar solo el archivo no cambia la clave de una base que ya existe.** `sh operacion/cambiar-clave-de-la-base.sh`: inventa una nueva, la pone en la base, comprueba que con ella se entra y con la de antes ya no, la escribe en el `.env` y levanta lo publicado. No la enseña, ni la base la puede anotar en su registro (le llega ya cifrada). Si se interrumpe, deja junto al `.env` un `.env.nueva`: mientras esté, levantar, publicar y volver no entran; correr el guion otra vez lo termina. Si alguien ya cambió el `.env` a mano, se niega y lo dice: entonces `sh operacion/cambiar-clave-de-la-base.sh --la-del-env` pone en la base la que dice el `.env` |
| La credencial del almacenamiento (la del servidor) | Si queda mal puesta, los respaldos fallan y llega el aviso. | Se crea la nueva con el proveedor, va al `.env`, y `sh operacion/levantar.sh`. Tomar un respaldo enseguida para ver que sube |
| La credencial de recuperación | — | Con el proveedor. Va a `recuperacion.env`, en el paquete; no al servidor |
| La llave de los respaldos | Los respaldos nuevos se cifran y se sellan con la nueva. **Los anteriores se abren con la anterior**, y el servidor los sigue comprobando con el sello de la anterior —solo los de antes del cambio—: sin él, los diarios de antes se avisarían como perdidos. | Abajo |
| La clave de una persona | Se cierran sus sesiones. | En Panel → Ajustes, o `sh operacion/compose.sh run --rm consola persona clave "Luis"` |

**Cambiar la llave de los respaldos**, fuera del servidor:

1. Una llave nueva, con otro nombre: `sh operacion/fuera.sh llave /carpeta/privada/llave-NUEVA.txt`.
   Dice la pública y el sello nuevos.
2. El sello de la anterior, hasta el momento del cambio (con su zona horaria):
   `sh operacion/fuera.sh sello --hasta=2026-12-01T06:00:00-06:00 < /carpeta/privada/llave-privada.txt`.
   Dice un renglón `RESPALDO_SELLOS_ANTERIORES=SELLO@MOMENTO`.
3. Al `.env`: la pública y el sello nuevos, y ese renglón. **Si ya había un renglón
   `RESPALDO_SELLOS_ANTERIORES`**, se queda uno solo: se le agrega una coma y lo que va después del
   `=` del nuevo (`RESPALDO_SELLOS_ANTERIORES=SELLO_1@MOMENTO_1,SELLO_2@MOMENTO_2`), sin repetir el nombre.
4. `sh operacion/levantar.sh`; se toma un respaldo y se comprueba desde fuera, con la llave nueva (2.4).
5. La llave anterior se conserva en el paquete, y su sello en el `.env`, mientras existan
   respaldos suyos: 30 días los de cada hora, un año los diarios.

**Si la llave se cambia porque alguien más pudo tenerla, su sello no se pone** (y si ya estaba en
`RESPALDO_SELLOS_ANTERIORES`, se quita): con él se podría hacer pasar algo por un respaldo de antes.
Los diarios de antes se avisarán como perdidos, y se comprueban a mano con la llave anterior.

Después de cambiar cualquiera del `.env`: **actualizar la copia del paquete de recuperación.**

## 9. Si algo falla

**Llegó un aviso de que un respaldo no se tomó.** `sh operacion/compose.sh ps` y
`sh operacion/compose.sh logs --tail 100 respaldo`. Lo más común es la red o la credencial del
almacenamiento. Corregido, se toma uno con
`sh operacion/compose.sh run --rm --no-deps respaldo ahora`; el servicio también reintenta solo.

**Llegó el aviso del diario.** El respaldo de la hora vale igual; lo que falló fue guardar la copia
de un año. Se pone al día solo en la corrida siguiente y al arrancar el servicio. Si avisa que un
día se quedó sin ningún respaldo que sirva, ese día ya no se puede reconstruir.

**Llegó el aviso del ensayo.** Pasaron 35 días sin un ensayo que terminara bien: hacer la sección 6.
(Que alerte no prueba que nadie restauró: también puede ser que el aviso no llegó.)

**Llegó la alerta del latido.** En Healthchecks, el último mensaje de esa señal dice qué fue: que
el sitio no contestó (lo que sigue), que queda poco disco («Se llenó el disco», abajo), que el
certificado no se ha renovado, o que no se pudo medir el disco o leer el certificado. Lo del
certificado casi siempre es que el dominio dejó de apuntar al servidor o que el puerto 80 ya no
llega: `sh operacion/compose.sh run --rm --no-deps comprobacion certificado` dice cuál presenta y
cuándo vence, y `sh operacion/compose.sh logs --tail 200 proxy` dice por qué no lo renovó. **Si la
señal solo dejó de oírse, sin mensaje,** puede ser el servidor, el servicio de respaldos, su salida
a internet, o la dirección de la señal: se revisan en ese orden. El latido pregunta por el proxy
desde dentro de Docker; que el sitio se abra desde el patio se comprueba aparte, desde fuera.

**El sitio no contesta, o dice que el sistema no está disponible.**

```bash
# En el servidor:
sh operacion/compose.sh ps
sh operacion/compose.sh logs --tail 100 web
sh operacion/compose.sh run --rm --no-deps comprobacion https          # que conteste por HTTPS, con certificado válido
sh operacion/compose.sh run --rm --no-deps comprobacion certificado    # el certificado que presenta, y cuándo vence
```

La aplicación deja de atender a propósito en tres casos: la operación está cerrada por una
publicación sin terminar (sección 5: `--recuperar`); la base está en otra versión que la
aplicación; o la base volvió de un respaldo sin pasar por el programa que restaura. En ninguno se
arregla reiniciando.

**Una publicación quedó a medias.** `sh operacion/publicar.sh --recuperar` (sección 5).

**«Un cambio de la clave de la base quedó a medias».** Se interrumpió `cambiar-clave-de-la-base.sh`
(sección 8). Se corre otra vez: mira qué clave tiene la base y lo termina, o lo descarta si no
llegó. No se borra el `.env.nueva` a mano: puede ser lo único que tiene la clave que ya está en la base.

**Alguien quedó bloqueado por teclear mal su clave.** Se desbloquea solo: cinco minutos la primera
vez, quince la segunda, una hora de ahí en adelante. Si urge, cambiarle la clave lo desbloquea.

**Se perdió la llave privada.** Los respaldos que ya existen no se pueden abrir: no hay manera. El
negocio sigue operando, pero mientras tanto **la única copia de los datos es el servidor**. Ese
mismo día se cambia la llave como en la sección 8, con una diferencia: el sello de la perdida no se
puede sacar con `fuera.sh sello` (no hay llave), pero está en el `.env`. Si nada indica que alguien
más la tenga, el valor de `RESPALDO_SELLO` de antes se pasa a `RESPALDO_SELLOS_ANTERIORES` como
`ESE_SELLO@MOMENTO_DEL_CAMBIO` (con su zona horaria): así el servidor sigue reconociendo los
diarios de antes y no los avisa como perdidos, aunque ya nadie los pueda abrir. Se toma un
respaldo y se guarda la llave nueva en los dos paquetes.

**Alguien más pudo haber visto la llave privada.** Puede leer los respaldos que alcance, y sellar
uno falso si además puede escribir en el almacenamiento. Se cambia la llave (sección 8) **sin**
conservar su sello; los respaldos anteriores no se pueden borrar antes de que venza su candado.

**Se llenó el disco.** — *por probar en el servidor.* El latido avisa antes, cuando queda menos
del 10 % o menos de 5 GB. Lo que más crece son las imágenes de cada versión publicada, y esas ya se
limpian solas: **al terminar bien una publicación** se retiran las de versiones que nadie va a
necesitar. Se conservan la que corre y la anterior, las dos últimas publicadas, y cualquier
publicación que haya quedado a medias con su anterior; nunca se quita la última etiqueta de una
imagen que algún contenedor usa, aunque esté detenido. Los manifiestos, los volúmenes (la base, los
certificados) y los respaldos no se tocan. Si esa limpieza falla, la publicación sigue bien y lo
dice; se repite a mano, y también se puede correr antes de publicar si falta espacio:

```bash
# En el servidor:
sh operacion/limpiar.sh        # retira lo que ya no se necesita y dice cuánto espacio queda
docker system df               # qué ocupa el espacio
```

Correr la limpieza otra vez no borra nada más. La caché de construcción la recorta Docker solo; si
hiciera falta recortarla a mano, **solo en el servidor** (en una máquina con otros proyectos
también es de ellos), y pide confirmación:

```bash
docker builder prune --filter 'until=168h'
```

Los respaldos no se acumulan en el servidor: se suben, y lo que quedó en la máquina se borra. Si lo
que crece es la base o sus registros, limpiar imágenes no lo resuelve: se revisa con soporte, y se
amplía el disco.

## 10. Lo que falta, dicho

Nada de esto se ha podido hacer todavía, porque no hay servidor, dominio ni almacenamiento:

- Preparar el servidor con su guion (`operacion/servidor.sh`, ya escrito y ensayado en un Ubuntu
  desechable) y comprobar ahí lo que el ensayo no puede: que los servicios arrancan y vuelven a
  arrancar después de reiniciar, que se entra con llave y ya no con contraseña desde otra máquina,
  y que desde fuera, por IPv4 e IPv6, solo contestan 22, 80 y 443/TCP (443/UDP no contesta: el
  proxy no publica HTTP/3).
- El certificado del dominio de verdad, y que se renueva solo (si no, el latido avisa: está
  probado con un certificado hecho a propósito, no con el de verdad).
- El almacenamiento contratado, en los dos depósitos: que la credencial del servidor no pueda
  borrar ni acortar la retención; que la de recuperación solo lea y alcance las versiones
  anteriores de un objeto; la retención de lo cifrado, los manifiestos y las anotaciones; las
  reglas del proveedor que borran lo vencido a los 30 y 365 días (sin borrar antes del candado); y
  cuánto tarda listar y bajar con un volumen como el real.
- Las cuatro señales de los vigilantes, con sus reglas en Healthchecks (2.3): apagar la aplicación
  y ver que el latido deja de llegar y su vigilante alerta; impedir un respaldo y ver que llega su
  aviso; mandar los avisos de prueba por Telegram y correo (`probar-avisos`) y ver que lleguen, y
  que los reciba de verdad quien da soporte.
- El ensayo de restauración desde otra máquina, siguiendo solo esta guía y midiendo cuánto tarda:
  ese es el tiempo real de recuperación. Y el primer respaldo **restaurado** desde fuera con la
  llave del dueño, no solo leído.
- Cambiar la clave de la base (sección 8) en el servidor, con la operación abierta.
- Un apagón o reinicio de verdad del servidor a media publicación, a media migración y a media
  vuelta al respaldo, y retomarlo con la guía.
- Ver en el servidor cuánto ocupa de verdad cada versión publicada, y que la limpieza al publicar
  y el aviso del latido por poco disco funcionan ahí.

Lo que se haga se anota aquí con su fecha y su resultado.

## 11. Las órdenes, juntas

Cada una en la máquina que dice, una por una.

```bash
# ── En la computadora que guarda la llave ─────────────────────────────────
sh operacion/fuera.sh llave /carpeta/privada/llave-privada.txt   # una llave nueva, y lo que va al .env
sh operacion/fuera.sh sello < /carpeta/privada/llave-privada.txt # sus dos renglones otra vez
FUERA_ENTORNO=/carpeta/privada/recuperacion.env sh operacion/fuera.sh version < /carpeta/privada/llave-privada.txt   # de qué versión es el último respaldo
FUERA_ENTORNO=/carpeta/privada/recuperacion.env sh operacion/fuera.sh ensayo < /carpeta/privada/llave-privada.txt    # el ensayo de cada mes
# (version y ensayo aceptan también un nombre, --diario y --como-estaba=MOMENTO; secciones 6 y 7)
ssh USUARIO@SERVIDOR 'cd feruga/sistema && sh operacion/volver.sh' < /carpeta/privada/llave-privada.txt                       # volver al respaldo de antes de migrar
ssh USUARIO@SERVIDOR 'cd feruga/sistema && sh operacion/publicar.sh --desde-respaldo' < /carpeta/privada/llave-privada.txt   # instalar desde el último respaldo

# ── En un servidor nuevo ──────────────────────────────────────────────────
sudo sh operacion/servidor.sh                              # prepararlo (2.1)
sudo sh operacion/servidor.sh --quitar-contrasenas         # después de probar la entrada con llave
sh operacion/entorno.sh TU_DOMINIO                         # el .env, con claves nuevas
sh operacion/publicar.sh                                   # la primera publicación
sh operacion/compose.sh run --rm consola arranque          # el primer responsable y el primer equipo

# ── En el servidor, para mirar ────────────────────────────────────────────
sh operacion/compose.sh ps
sh operacion/compose.sh logs --tail 50 web
sh operacion/compose.sh run --rm --no-deps respaldo lista
sh operacion/compose.sh run --rm --no-deps respaldo lista --diario
sh operacion/compose.sh run --rm --no-deps respaldo ahora

# ── En el servidor, para cambiar ──────────────────────────────────────────
sh operacion/levantar.sh                                   # después de editar el .env
sh operacion/cambiar-clave-de-la-base.sh                   # la clave de administración de la base (8)
sh operacion/publicar.sh                                   # una versión nueva
sh operacion/publicar.sh --recuperar                       # una publicación que se interrumpió
sh operacion/volver.sh --abrir                             # después de volver al respaldo
sh operacion/limpiar.sh                                    # retirar imágenes de versiones viejas; dice el espacio libre

# ── La consola, en el servidor ────────────────────────────────────────────
sh operacion/compose.sh run --rm consola persona lista
sh operacion/compose.sh run --rm consola persona alta "Luis" mostrador
sh operacion/compose.sh run --rm consola persona clave "Luis"
sh operacion/compose.sh run --rm consola equipo codigo "Tableta del patio"
```
