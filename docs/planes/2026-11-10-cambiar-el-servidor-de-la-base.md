# Publicar una versión que cambia el servidor de la base (misma versión mayor)

**Estado:** hecho, 10 de noviembre de 2026 (ver el final).

## Por qué

`publicar.sh` se niega si una versión cambia la imagen o la configuración del servicio `db`:
«tiene su propio procedimiento». Ese procedimiento nunca se escribió. En el servidor, la versión
`86f4247` (topes de memoria) cambió la configuración de `db` y publicar se negó. Como la base no
tenía datos reales, se reinstaló desde cero. Con datos reales eso no se puede, y cada parche de
seguridad de PostgreSQL (una huella nueva de `postgres:17`) va a chocar con lo mismo.

Además, Compose del servidor avisa en cada orden «deploy.placement is only honored by the Swarm
scheduler»: al guardar la configuración resuelta, Compose le agrega `placement: {}` a cada
`deploy`. Los topes se pasan a las claves de servicio (`mem_limit`, `memswap_limit`, `cpus`,
`pids_limit`), sin `deploy`. Eso vuelve a cambiar la configuración de `db`: es el primer caso real
del camino nuevo, y se probará en el servidor mientras los datos todavía son de prueba.

## Lo que se puede y lo que no

- **Misma versión mayor** (17.x → 17.y, o solo configuración: topes, variables, cómo se detiene):
  PostgreSQL garantiza que las versiones menores de una misma mayor leen y escriben el mismo
  formato en disco, hacia adelante y hacia atrás. El volumen de datos se queda; solo cambia el
  contenedor. Volver atrás es recrearlo con la configuración anterior.
- **Otra versión mayor** (17 → 18): el formato en disco cambia. Publicar se sigue negando, y dice
  que eso necesita otro procedimiento (respaldo y restauración en un servidor nuevo), que queda por
  escribir.
- **Otro sistema de la imagen** (Alpine → Debian), aunque sea la misma mayor: trae otras
  bibliotecas, y con ellas otro orden de las letras, que puede dejar mal los índices (Codex,
  R45-03). Publicar se niega igual.
- La versión mayor se lee de la imagen (la variable `PG_MAJOR` de la imagen oficial) y el sistema,
  de su `/etc/os-release`. Si en cualquiera de las dos no se puede leer, se niega igual que si
  fuera otra.
- La misma mayor no garantiza que no haya nada que hacer a mano: a veces las notas de una versión
  menor piden reconstruir un índice. Se leen antes de poner la huella nueva (lo dicen la guía y
  `docker/db.Dockerfile`).

## El camino, al publicar

1. **Preparar** (sin tocar nada): si `db` tiene otra huella que en lo publicado, se lee `PG_MAJOR`
   de la imagen de la base de las dos (la candidata, que publicar ya identificó; la vigente, de las
   variables de su manifiesto). Iguales: se sigue, y se dice que esta versión cambia el servidor de
   la base. Distintas o ilegibles: se niega, como hoy.
2. Manifiesto, cerrar y drenar, respaldar (pasos 2 a 4): igual que siempre. El respaldo previo se
   toma con el servidor de antes.
3. **Nuevo paso «4 bis. Cambiar el servidor de la base»**, solo si cambia:
   `punto base:antes` → `arrancar "$conf" db` (Compose recrea el contenedor: detiene el viejo, que
   se apaga limpio, y arranca el nuevo sobre el mismo volumen; espera a que esté sano) → se
   comprueba que la base es la misma (su marca, contra la del manifiesto) → `punto base:despues`.
4. Migrar, levantar cerrada, comprobar, abrir, terminar: igual. `corre` ya compara `db` contra la
   configuración del conjunto, así que comprueba también el servidor nuevo.

`db` se detiene con más plazo (`stop_grace_period: 2m`): PostgreSQL, al recibir la señal de
detenerse de la imagen oficial (SIGINT, apagado rápido), deshace lo abierto y guarda a disco antes
de salir; con 10 segundos, una base grande podía quedar cortada. Dos minutos le dan más tiempo
para apagarse limpio, no lo garantizan; si no alcanza, PostgreSQL se recupera solo al arrancar.

## Recuperar, y volver al respaldo

La configuración de `db` está en las dos configuraciones guardadas (la candidata y la anterior):
que cambia se sabe comparándolas, sin anotar nada nuevo en el manifiesto. Cuando cambia, recuperar
y volver van en tres tiempos (Codex, R45-01: la espera de lo que quedó le pregunta a la base, así
que la base tiene que estar arriba antes; y recrearla antes de esa espera podría cortar algo que
todavía la usa):

1. **Que corra y conteste, antes de cualquier pregunta a la base** (`asegurar_que_la_base_corra`).
   Si el contenedor de `db` no está corriendo —el guion murió a media recreación, o alguien lo
   detuvo—, se arranca con la configuración a la que se va: detenido, nada lo usa. Si corre pero
   no contesta (una configuración que no sirve, o todavía arrancando), se le da tiempo; si sigue
   sin contestar y no queda nada de una operación interrumpida que pudiera usarlo, se le pone la
   configuración que toca (Codex, R45-02). Si no se pudo preguntar si corre, se detiene: eso no es
   «no corre» (R45-06).
2. **Esperar lo que quedó**: el migrador, una restauración, un respaldo (como hoy).
3. **Que sea el que toca**: si corre con la otra configuración, se recrea con la que toca.

La configuración a la que se va:
- **`publicar.sh --recuperar`**: la candidata si ya empezó la migración (la migración solo empieza
  con el servidor nuevo arriba), la anterior si no. Después, lo de siempre:
  - no se migró ni se decidió (caso 3): se vuelve a la anterior, ya con su servidor;
  - se decidió abrir (caso 1): se sigue hacia adelante con la candidata, ya con el suyo;
  - se decidió volver a abrir la anterior («1 anterior»): no se migró, así que ya es la anterior;
  - se migró y no se decidió (caso 2): se queda cerrado, y la salida es `volver.sh`.
- **`volver.sh`**: en el primer tiempo, la anterior (es a donde va, y los datos sirven igual). El
  tercer tiempo no va al principio sino donde ya se sabe que volver es lo que toca: al empezar a
  restaurar (con la base que falló ya apartada) y al empezar a levantar la versión anterior. La
  restauración corre así con el servidor de antes, el mismo con el que se tomó el respaldo. Si
  `volver.sh` se retoma, lo ya hecho no se repite: `arrancar` no hace nada si ya corre como toca.

Puntos de corte nuevos, para el ensayo: `base:antes` y `base:despues` al publicar,
`recuperar-base:antes` y `recuperar-base:despues` al recuperar, y `vuelta-base:antes` y
`vuelta-base:despues` al volver. El ensayo corta en `base:antes`, `base:despues` (también con la
base detenida a mano), `recuperar-base:antes`, `decidir:base` (al publicar, y al volver a abrir la
anterior) y `vuelta-base:despues` con la base detenida.

**Estado (10 de noviembre):** hecho. Codex revisó el plan y el código (encargo 45, R45-01 a
R45-06): todo se atendió, con su prueba.

## Las pruebas

- `pruebas/20-entorno`: los topes con las claves de servicio, sin `deploy`; `db` con
  `stop_grace_period`.
- `pruebas/36-guiones` (Docker de mentira): leer la versión mayor y decidir. Misma mayor: sigue.
  Otra, o ilegible en cualquiera de las dos: se niega sin tocar nada. Recuperar y volver aseguran
  la base con la configuración correcta según la marca de la migración.
- `operacion/ensayo-publicacion.sh` (Docker de verdad):
  - una versión que cambia la configuración de `db`: se publica, el contenedor de la base es otro
    con la configuración nueva, la marca de la base es la misma y lo asentado no cambió;
  - muere en `base:antes` y en `base:despues`: recuperar vuelve a la anterior, con la base otra vez
    con su configuración de antes, y lo asentado igual;
  - muere en `base:despues` con la base detenida a mano (como si muriera a media recreación):
    recuperar la arranca antes de preguntarle nada, y vuelve a la anterior;
  - recuperar muere en `recuperar-base:antes`: retomarlo termina;
  - con el servidor nuevo, una migración falla: se queda cerrado; `volver.sh` restaura con la
    base otra vez como antes, y abrir la deja atendiendo; y `volver.sh` muere en
    `vuelta-base:antes` con la base detenida a mano: retomarlo la arranca y termina;
  - otra versión mayor (la imagen del proxy como base, sin `PG_MAJOR`): se niega sin tocar nada,
    como hoy.
- `operacion/ensayo.sh`: sin el aviso de Swarm; los topes, como ya los comprueba.

## Lo que no cambia

El primer arranque y la instalación desde un respaldo no tienen versión anterior: no hay cambio
que comparar. `levantar.sh` sigue como está.
