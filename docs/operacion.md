# Guía de operación

Cómo se instala, se cuida y se recupera el sistema en su servidor. Es para quien da el soporte
técnico y para el dueño; la gente del patio no necesita nada de esto.

> **Estado (13 de octubre de 2026).** Todavía no hay servidor, dominio ni almacenamiento
> contratados. Esta guía está escrita con lo que hay en el repositorio: cada orden que aparece
> aquí existe y está probada en las pruebas automáticas y en los dos simulacros
> (`operacion/ensayo.sh` y `operacion/ensayo-publicacion.sh`), que arman una instalación completa
> en una máquina de desarrollo. **Lo que solo se puede comprobar en el servidor de verdad está
> marcado como «por probar en el servidor»**, y está junto al final. Cuando se haga, esta guía se
> corrige con lo que no haya salido como está escrito.

## 1. Las piezas, y quién tiene qué

| Pieza | Qué es | Quién la tiene |
|---|---|---|
| El servidor | Una máquina con Docker y Git. Corre la base, la aplicación, el proxy (HTTPS) y el servicio que respalda. | Soporte |
| La carpeta del sistema | Este repositorio, en el commit publicado. | En el servidor, y en el repositorio |
| El `.env` | Las claves del sistema y a dónde van los respaldos. Solo lo lee quien lo creó. | En el servidor; **copia en el paquete de recuperación** |
| La carpeta `publicaciones/` | Qué versión corre y con qué imágenes. Lleva claves: no va al repositorio. | Solo en el servidor |
| El almacenamiento | Dos depósitos fuera del servidor: los respaldos de cada hora (30 días) y uno por día (un año). | El proveedor |
| La llave privada | Abre los respaldos, y de ella sale el sello que los acredita. **Nunca está en el servidor.** | El dueño y soporte |
| Los vigilantes | Un servicio de fuera que espera un aviso a su hora y alerta si no llega. | Soporte recibe los avisos |

### El paquete de recuperación

Es lo que hace falta para volver a levantar el negocio si el servidor desaparece. Lo guardan **el
dueño y quien da el soporte**, cada uno su copia, fuera del servidor:

1. **La llave privada de los respaldos** (el archivo que dio `age-keygen`). Sin ella ningún
   respaldo se puede abrir: no hay otra copia ni manera de reponerla.
2. **Una copia del `.env`** del servidor.
3. **La credencial de recuperación del almacenamiento**: la que solo lee. No es la del servidor.
4. **Dónde está el repositorio** y cómo entrar a él, y esta guía.

Se actualiza **cada vez que cambie algo de eso**: una clave del `.env`, la llave, el proveedor del
almacenamiento. Un paquete viejo es peor que ninguno: da confianza y no sirve.

## 2. Instalar por primera vez

### 2.1 El servidor — *por probar en el servidor*

Lo que debe tener, según lo decidido en el plan de despliegue: Ubuntu LTS; Docker y Git; entrada de
administración solo con llave (probada en una segunda conexión antes de quitar las contraseñas, y
con la consola del proveedor como salida); cortafuegos con solo los puertos 22, 80 y 443;
actualizaciones de seguridad automáticas. Quien puede usar Docker en esa máquina es administrador
de ella.

**No hay todavía un guion que lo prepare** (`operacion/servidor.sh` es la parte que falta de la
tarea 6 del plan). Hasta que exista y se pruebe, esto se hace a mano y se anota aquí lo que se hizo.

### 2.2 Fuera del servidor: la llave y el sello

En la computadora del dueño o de soporte, **no en el servidor**:

```bash
age-keygen -o llave-privada.txt              # la llave; el archivo se guarda, no se le cambia nada
node operacion/sello.ts < llave-privada.txt  # dice los dos renglones que van al .env del servidor
```

`sello.ts` contesta dos renglones, `RESPALDO_LLAVE_PUBLICA=age1…` y `RESPALDO_SELLO=…` (64
letras). **Van juntos y de la misma llave:** con el sello de una llave y la pública de otra, el
servidor tomaría respaldos que después nadie podría acreditar, y avisaría «bien». El programa lee la
llave como la lee `age` —una sola, sin contar los comentarios, y bien escrita— y se niega si no.

Si en esa computadora no está este sistema, salen igual con herramientas comunes (la pública la
dice `age-keygen -y llave-privada.txt`; el sello, esto):

```bash
grep -v '^#' llave-privada.txt | grep -o 'AGE-SECRET-KEY-1[0-9A-Z]*' | head -1 | tr -d '\n' | openssl dgst -sha256 -hmac 'feruga: sello de los respaldos, v1' -r | cut -d' ' -f1
```

(Una prueba comprueba que las dos maneras dan el mismo sello; la de `openssl` no revisa que la
llave esté bien escrita.) Esos dos renglones van al `.env` del servidor; **la llave privada, al
paquete de recuperación y a ningún otro lado**. De ninguno de los dos se vuelve a la llave.

### 2.3 El almacenamiento y los vigilantes — *por probar en el servidor*

- **Dos depósitos**, los dos con versiones y retención con candado: el de cada hora, 30 días; el
  diario, 365. Está decidido que sea Backblaze B2; las pruebas se hicieron contra MinIO, y hay que
  repetirlas contra el depósito contratado.
- **Para cada depósito, una credencial del servidor** que sube y lee lo cifrado de su carpeta y no
  puede borrar ni cambiar la retención. **Y una credencial de recuperación**, que solo lee: esa va
  al paquete, no al servidor.
- **Un candado de un año es un año:** un respaldo diario no se puede borrar antes, ni queriendo.
- **Los vigilantes** (está previsto Healthchecks, con aviso por correo y por Telegram): una señal
  para cada respaldo, otra para el diario, otra para el ensayo de restauración. El latido que
  avisa si el sitio deja de contestar está por diseñarse.

### 2.4 En el servidor

```bash
git clone <el repositorio> feruga && cd feruga/sistema
sh operacion/entorno.sh patio.ejemplo.mx     # genera .env con claves nuevas; no muestra ninguna
```

En el `.env` falta poner lo que el guion no puede inventar: `RESPALDO_LLAVE_PUBLICA`,
`RESPALDO_SELLO`, los dos destinos (`RESPALDO_DESTINO`, `RESPALDO_DESTINO_DIARIO`) con su servicio
y su credencial del servidor, y las señales de los vigilantes (`RESPALDO_VIGIA_URL`,
`RESPALDO_VIGIA_DIARIO_URL`). Sin eso, nada arranca, y dice qué falta. **Guarda una copia del
`.env` en el paquete de recuperación.**

```bash
sh operacion/publicar.sh                               # construye, comprueba, migra, levanta y abre
sh operacion/compose.sh run --rm consola arranque      # el primer responsable y el código del primer equipo
```

El arranque escribe en la terminal, **una sola vez**, la clave del primer responsable y el código
para dar de alta el primer equipo. Correrlo otra vez no hace daño.

**Antes de dar la instalación por buena, comprobar el sello desde fuera** — *por probar en el
servidor.* Publicar ya tomó un respaldo. En la computadora donde está la llave, con la credencial
de recuperación:

```bash
node operacion/version-del-respaldo.ts < llave-privada.txt   # dice el respaldo, su publicación y su commit
```

Si contesta, el respaldo lleva el sello de esa llave: la pública y el sello del servidor son los
suyos. Si dice que no lleva el sello de este negocio, el `.env` tiene el sello de otra llave: se
corrige (2.2), `sh operacion/levantar.sh`, y se toma otro respaldo. Hasta no ver esto, los
respaldos no cuentan.

Si el certificado no se emite, el sitio no se da por disponible y la operación no se abre. La
salida nunca es quitar la cookie segura ni servir por HTTP: se revisa que el dominio apunte al
servidor y que los puertos 80 y 443 lleguen. El certificado que se está presentando, y cuándo
vence, se ve con la comprobación `certificado` (sección 9).

### 2.5 El primer día, en la pantalla

1. En el equipo del patio, abrir `https://<dominio>` y teclear el código del equipo.
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
  llave pública. **El servidor no puede leer sus propios respaldos, ni borrar los anteriores.**
- De cada día, el primero que salió bien se guarda además un año, en el otro depósito.
- Un respaldo existe cuando tiene su manifiesto, y **el manifiesto va sellado**: el sello dice que
  lo tomó este negocio y que nadie lo cambió después. Quien restaura lo comprueba con la llave
  privada antes de bajar nada. Un respaldo sin sello, o con el de otra llave, no se restaura.
- Lo que el sello no cubre: quien se haga del servidor entero tiene la clave con que se sella.
  Contra eso, el remedio es restaurar un respaldo anterior, pedido por su nombre.
- **Auténtico no es lo mismo que reciente.** El sello no dice que el depósito enseñe todos los
  respaldos. Al restaurar se dice de hace cuánto es el que se va a usar, y si es «el último» y
  tiene más de un día, se advierte. Con qué compararlo: el último «terminó bien» del vigilante.
- `respaldo lista` dice además cuál es el último con su manifiesto en orden, si en el entorno está
  el sello; sin él, enseña lo que hay y dice que no lo comprobó.

## 5. Publicar una versión

Con la carpeta en el commit que se va a publicar, sin cambios sueltos, y fuera del horario de
atención (cierra el negocio unos minutos):

```bash
git pull                      # o el commit que se haya decidido
sh operacion/publicar.sh
```

Hace, en orden y anotando cada paso antes de darlo: preparar sin tocar nada (construir, comprobar
el entorno y la red, y que el migrador nuevo diga que puede con la base que hay); cerrar la
operación; **tomar un respaldo y anotar su nombre**; migrar; levantar la versión nueva cerrada y
comprobarla por HTTPS; abrir. Antes de cerrar no altera lo que atiende; entre cerrar y abrir, el
negocio está cerrado pase lo que pase; y una vez que decide abrir, no retrocede.

**Si se interrumpe** (se cayó la conexión, se apagó la máquina), nada más se publica ni se levanta
hasta recuperarla:

```bash
sh operacion/publicar.sh --recuperar
```

Recuperar lee lo que quedó anotado y hace lo único que toca: si ya se había decidido abrir,
termina; si no se había migrado, restablece la versión anterior y abre; y si la migración empezó y
no se llegó a abrir, **se queda cerrado** y dice la salida: volver al respaldo que se tomó antes de
migrar —el negocio estuvo cerrado desde antes de tomarlo, así que no se pierde nada— y después
publicar la versión corregida como cualquier otra.

**Volver al respaldo previo** lo hace quien tiene la llave:

```bash
sh operacion/volver.sh < llave-privada.txt    # restaura ese respaldo; la versión anterior queda levantada y CERRADA
sh operacion/volver.sh --abrir                # cuando ya se vio que todo está bien
```

La base que falló no se borra: queda apartada con otro nombre, y se borra a mano cuando ya no haga
falta. La base restaurada abre un bloque nuevo de folios.

## 6. El ensayo de restauración — *por probar en el servidor*

Un respaldo que nunca se restauró no es un respaldo. **Cada mes**, una persona —porque la llave no
vive en ningún servidor— baja el último respaldo en otra máquina y lo restaura. Hay un vigilante
propio que alerta si pasan más de 35 días sin un ensayo.

En una máquina con Docker, este repositorio, un servidor de PostgreSQL vacío donde restaurar, la
credencial de **recuperación** y la llave:

```bash
node operacion/restaurar.ts --remoto --ensayo < llave-privada.txt
```

El programa pide en su entorno a dónde restaurar (`DATABASE_URL`), el destino de los respaldos con
la credencial de recuperación (`RESPALDO_DESTINO` y lo de `rclone`) y a quién avisar
(`ENSAYO_VIGIA_URL`). Comprueba el sello, baja el respaldo, lo descifra, lo restaura en una base
aparte, lo audita, y solo avisa del ensayo si terminó bien. No restaura encima de una base que
existe. Con `--diario` hace lo mismo con el último de los que se guardan un año.

El recorrido completo desde otra máquina, siguiendo solo esta guía y midiendo cuánto tarda, es una
de las condiciones para operar con datos de verdad, y **todavía no se ha hecho**: el programa está
probado contra un almacenamiento de pruebas, no el camino entero en una máquina ajena.

## 7. Si se pierde el servidor

Con el paquete de recuperación, en una máquina nueva preparada como en la sección 2:

```bash
git clone <el repositorio> feruga && cd feruga/sistema
# el .env del paquete, en esta carpeta
sh operacion/publicar.sh --desde-respaldo < llave-privada.txt             # del último respaldo
sh operacion/publicar.sh --desde-respaldo=<respaldo> < llave-privada.txt  # o de uno, por su nombre
```

El respaldo dice qué versión del sistema lo tomó, y de qué commit era; se le cree porque lleva el
sello de la llave. **La carpeta tiene que estar en ese commit**: si no lo está, el guion lo dice y
no toca nada (se cambia con `git checkout <commit>` y se vuelve a correr). Las imágenes se
construyen ahí mismo, de ese commit: del almacenamiento no se baja nada que se vaya a ejecutar.
Después sigue como cualquier publicación: levanta cerrado, comprueba y abre.

**Lo que se asentó después de ese respaldo no está, y no vuelve solo.** Se concilia a mano:

- **Las compras y las ventas**, de las copias de los comprobantes que conserva el negocio (salen
  por duplicado para esto). Se vuelven a capturar; llevan folios nuevos, del bloque que la
  restauración abrió, y los folios de los comprobantes perdidos no se repiten.
- **El inventario**, con un conteo físico de lo que se movió.
- **Conteos, bajas, separaciones y correcciones** de esas horas no dejan papel: se pregunta a quien
  los hizo y se vuelven a hacer.

Por eso los respaldos son cada hora: lo que se puede perder es, cuando mucho, una hora de trabajo.

## 8. Cambiar una clave

| Clave | Qué pasa al cambiarla | Cómo |
|---|---|---|
| `SESION_CLAVE` | Deja fuera a todos los equipos: hay que darlos de alta otra vez, con código nuevo. | `.env`, y `sh operacion/levantar.sh` |
| `WEB_BD_CLAVE` (el usuario con que la aplicación entra a la base) | Nada que se note. | `.env`, y `sh operacion/levantar.sh`: la clave se le pone al usuario cada vez |
| `BD_CLAVE` (administración de la base) | — | **Cambiar el archivo no cambia la clave de una base que ya existe.** Primero se cambia en la base, después en el `.env`. *No hay guion para esto ni se ha ensayado: por probar en el servidor.* |
| La credencial del almacenamiento (la del servidor) | Si queda mal puesta, los respaldos fallan y llega el aviso. | Se crea la nueva con el proveedor, va al `.env`, y `sh operacion/levantar.sh`. Tomar un respaldo enseguida para ver que sube |
| La credencial de recuperación | — | Con el proveedor. Va al paquete, no al servidor |
| La llave de los respaldos | Los respaldos nuevos se cifran y se sellan con la nueva. **Los anteriores se abren y se comprueban con la anterior.** | Se genera otra pareja fuera del servidor (2.2); la pública y el sello nuevos van al `.env`; `sh operacion/levantar.sh`; y se toma un respaldo. La llave anterior se conserva en el paquete mientras existan respaldos suyos: 30 días los de cada hora, un año los diarios |
| La clave de una persona | Se cierran sus sesiones. | En Panel → Ajustes, o `sh operacion/compose.sh run --rm consola persona clave "Luis"` |

Después de cambiar cualquiera del `.env`: **actualizar la copia del paquete de recuperación.**

## 9. Si algo falla

**Llegó un aviso de que un respaldo no se tomó.** `sh operacion/compose.sh ps` y
`sh operacion/compose.sh logs --tail 100 respaldo`. Lo más común es la red o la credencial del
almacenamiento. Corregido, `respaldo ahora` toma uno; el servicio también reintenta solo.

**Llegó el aviso del diario.** El respaldo de la hora vale igual; lo que falló fue guardar la copia
de un año. Se pone al día solo en la corrida siguiente y al arrancar el servicio. Si avisa que un
día se quedó sin ningún respaldo que sirva, ese día ya no se puede reconstruir.

**Llegó el aviso del ensayo.** Pasaron 35 días sin restaurar de verdad: hacer la sección 6.

**El sitio no contesta, o dice que el sistema no está disponible.**

```bash
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

**Alguien quedó bloqueado por teclear mal su clave.** Se desbloquea solo: cinco minutos la primera
vez, quince la segunda, una hora de ahí en adelante. Si urge, cambiarle la clave lo desbloquea.

**Se perdió la llave privada.** Los respaldos que ya existen no se pueden abrir: no hay manera. El
negocio sigue operando, pero mientras tanto **la única copia de los datos es el servidor**. Ese
mismo día: generar otra pareja (2.2), poner la pública y el sello nuevos en el `.env`,
`sh operacion/levantar.sh`, tomar un respaldo, y guardar la llave nueva en los dos paquetes.

**Alguien más pudo haber visto la llave privada.** Puede leer los respaldos que alcance, y sellar
uno falso si además puede escribir en el almacenamiento. Cambiar la llave como arriba; los
respaldos anteriores no se pueden borrar antes de que venza su candado.

**Se llenó el disco.** — *por probar en el servidor.* No hay nada automático que lo evite ni lo
avise, y ningún guion borra imágenes de publicaciones anteriores. Los respaldos no se acumulan
en el servidor: se suben, y lo que quedó en la máquina se borra. Queda por definir qué se limpia y
cuándo.

## 10. Lo que falta, dicho

Nada de esto se ha podido hacer todavía, porque no hay servidor, dominio ni almacenamiento:

- Preparar el servidor con su guion (`operacion/servidor.sh`, sin escribir) y comprobar desde otra
  máquina, por IPv4 e IPv6, que solo contestan los puertos 22, 80 y 443.
- El certificado del dominio de verdad, y el aviso antes de que venza.
- Los permisos reales del almacenamiento contratado: que la credencial del servidor no pueda
  borrar ni acortar la retención, y que la de recuperación solo lea.
- El ensayo de restauración desde otra máquina, siguiendo solo esta guía, midiendo cuánto tarda:
  ese es el tiempo real de recuperación.
- Apagar la aplicación y ver que llega el aviso; impedir un respaldo y ver que llega el otro. El
  latido que avisa si el sitio no contesta está por diseñarse.
- Cambiar la clave de administración de una base que ya existe.
- Qué hacer cuando se llena el disco.
- Una revisión de Codex de lo que nunca alcanzó a ver (restaurar del diario, entre otras) y de lo
  corregido el 13 de octubre: el sello de los respaldos y los intentos de clave.

## 11. Las órdenes, juntas

```bash
# Instalar
sh operacion/entorno.sh <dominio>
node operacion/sello.ts < llave-privada.txt                 # fuera del servidor
sh operacion/publicar.sh
sh operacion/compose.sh run --rm consola arranque

# Mirar
sh operacion/compose.sh ps
sh operacion/compose.sh logs --tail 50 web
sh operacion/compose.sh run --rm --no-deps respaldo lista [--diario]

# Cambiar
sh operacion/levantar.sh                                    # después de editar el .env
sh operacion/publicar.sh                                    # una versión nueva
sh operacion/publicar.sh --recuperar                        # una publicación que se interrumpió
sh operacion/volver.sh < llave-privada.txt                  # al respaldo de antes de migrar; queda cerrado
sh operacion/volver.sh --abrir

# Recuperar
node operacion/restaurar.ts --remoto --ensayo < llave-privada.txt        # el ensayo de cada mes
sh operacion/publicar.sh --desde-respaldo[=<respaldo>] < llave-privada.txt   # en una máquina nueva

# La consola
sh operacion/compose.sh run --rm consola persona lista
sh operacion/compose.sh run --rm consola persona alta "Luis" mostrador
sh operacion/compose.sh run --rm consola persona clave "Luis"
sh operacion/compose.sh run --rm consola equipo codigo "Tableta del patio"
```
