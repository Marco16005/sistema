# Plan de implementación: despliegue

> **Para quien lo ejecute:** se avanza tarea por tarea, con prueba primero. Codex (`gpt-6-astra`,
> esfuerzo alto) revisa este plan antes de escribir código y el bloque completo al cerrarlo; sus
> revisiones y las respuestas quedan en `docs/revisiones/`.
>
> **Versión 2**, reescrita tras la revisión de Codex a la versión 1 (5 bloqueantes, 8 importantes,
> 2 menores; todos atendidos: `docs/revisiones/2026-10-03-respuesta-a-la-revision-del-plan-de-despliegue.md`).

> **21 de octubre de 2026: `--corregida` no se hace.** En el único caso en que serviría —la migración
> empezó y no se decidió abrir— el negocio estuvo cerrado desde antes de tomar el respaldo previo:
> volver a él no pierde nada, y la versión corregida se publica después como cualquier otra. Una
> segunda salida era otra pieza que puede fallar, sin ganar nada que importe (solo el rato de
> restaurar). Se quitó el cierre «sustituida» del manifiesto y se dice una sola salida en el guion,
> la guía y el README.
>
> **Estado al 10 de octubre de 2026.** Hechas las tareas 1 a 5 (falta `--corregida`, de la 5).
> Codex las revisó en su décima pasada, del 7 al 9 de octubre (publicar: la lógica y los guiones;
> el respaldo diario), y lo que encontró está corregido: el detalle, hallazgo por hallazgo, en
> `docs/revisiones/2026-10-07-respuesta-a-la-decima-revision.md`, que manda sobre las notas
> «falta que Codex lo revise» que siguen más abajo. Lo que cambió respecto de lo escrito aquí:
> el candado de la instalación es del sistema operativo (`flock`); **ya no se guardan imágenes
> fuera del servidor**: instalar desde un respaldo las construye del commit de esa publicación;
> la elección del respaldo diario se decide en la base (migración 0029). **El 13 de octubre se
> cerró lo de autenticar el respaldo** (el sello del manifiesto: ver la tarea 7 y
> `docs/revisiones/2026-10-07-respuesta-a-la-decima-revision.md`) y se escribió la guía
> (`docs/operacion.md`). **Queda abierto, y es condición para operar con datos reales:** una
> pasada de Codex sobre lo que no alcanzó a ver —y ahora también sobre el sello—, el guion del
> servidor, y todo lo que solo se puede probar en el servidor de verdad.

**Objetivo:** que el sistema viva en un servidor propio y se use desde los equipos del patio por
HTTPS; que su historia no se pueda perder —respaldos fuera de la máquina, que se restauran de
verdad—; y que si se cae, alguien se entere. Todo reproducible: el servidor se puede rehacer desde
cero con este repositorio, el paquete de recuperación que guarda el dueño y el último respaldo.

**Arquitectura:** la que fija la especificación (12.4): un servidor virtual con la aplicación, la
base y un proxy en contenedores. Antes de poner nada encima, el sistema que ya existe se endurece
en cuatro puntos que la revisión mostró flojos: el entorno, la migración con la aplicación viva,
la numeración después de restaurar y la versión del esquema. Después vienen restaurar, respaldar,
el proxy, publicar una versión y la guía del servidor.

**Herramientas nuevas:** Caddy (proxy; emite y renueva el certificado), `age` (cifrado del
respaldo con llave pública), `rclone` (subir y bajar del almacenamiento), MinIO (solo en pruebas,
del paquete de Alpine: un almacenamiento compatible con S3 para probar permisos y retención de verdad). Imágenes base
fijadas por su huella (`@sha256:…`), no solo por su etiqueta. Ninguna dependencia nueva en la
aplicación.

**Especificación:** `../ESPECIFICACION-TECNICA.md`, apartados 12.1 a 12.4, 10.5 y 14 (A9).

## Restricciones globales

Las de los planes anteriores siguen valiendo. Se agregan:

- **El servidor necesita Docker y Git, y nada más.** Git trae el código; todo lo demás corre en
  contenedores.
- **Nada arranca con valores de desarrollo si no se dijo expresamente que es desarrollo.** Lo
  comprueba cada proceso al iniciar, no solo un paso previo que se pueda saltar.
- **Un respaldo que no se ha restaurado no cuenta.** El programa que restaura es uno solo, y lo
  usan el ensayo y la emergencia.
- **El servidor no puede leer sus propios respaldos** (cifrado a llave pública; la privada nunca
  toca el servidor) **ni destruir los anteriores** (versiones protegidas en el almacenamiento, no
  una credencial «que solo escribe»).
- **Después de restaurar no se reutiliza ningún folio**, tampoco los que se emitieron después del
  respaldo y se perdieron con el servidor.
- **No se migra con la aplicación atendiendo.** Lo impide la base, no la disciplina de quien publica.
- **Solo el proxy se publica a la red.**
- **«No hubo respuesta» no es una prueba:** los avisos de caída y de respaldo vencido los da un
  vigilante externo que espera una señal a cada hora convenida.
- **Ningún secreto sale por la salida de un contenedor**, ni viaja en argumentos.
- **Toda prueba que pase a la primera se comprueba por mutación**, o se dice que no se comprobó.

## Decisiones de diseño

### El entorno

1. **El archivo de Compose base ya no trae valores por omisión.** Sin `.env`, no arranca y dice
   qué falta. Los valores de desarrollo pasan a `.env.desarrollo`, que además declara
   `MODO=desarrollo`; desarrollar sigue siendo copiar un archivo y levantar.
2. **Cada proceso crítico valida su entorno al iniciar** con la misma función (`exigirEntorno`):
   el migrador, la aplicación (al arrancar y en `/api/salud`), el respaldo. Fuera de
   `MODO=desarrollo` rechaza claves de desarrollo, cortas o repetidas, cookie sin `Secure`, origen
   que no sea `https://`, y falta de dominio, llave pública o destino de respaldo. El servicio
   `comprobacion` usa la misma función para avisar pronto, pero la garantía no depende de él.
3. **El entorno de operación lo genera un guion de consola, sin Docker ni base**
   (`operacion/entorno.sh`): claves de `/dev/urandom`, archivo con permisos `0600`, y se niega a
   sobrescribir uno que ya exista. Nada sale por pantalla.
4. **Lo que queda visible para quien administra el servidor se acepta y se dice:** las variables
   de un contenedor se ven con `docker inspect`, y quien puede usar Docker es administrador de la
   máquina. No se usan archivos de secretos por servicio: no protegen contra ese mismo
   administrador.

### Migrar y publicar

5. **Ventana de mantenimiento impuesta por el migrador.** Si hay migraciones pendientes: se niega
   mientras el usuario de la aplicación tenga conexiones abiertas; le cierra la entrada (le quita
   el permiso de conectarse a **esa** base) antes de aplicar la primera; y solo se la devuelve
   `rol.ts`, que corre después de que todas entraron. Si una falla a la mitad, la aplicación se queda sin poder conectarse hasta
   que se resuelva: el cierre se mantiene durante la recuperación. Sin pendientes, no toca nada.
6. **Publicar una versión** es: construir (identificada por su commit) y comprobar, sin tocar lo
   que corre → cerrar la operación y detener la aplicación → esperar a que no quede ninguna
   sesión suya en la base → respaldo comprobado, guardando su nombre → migrar → levantar la versión
   nueva **con la operación todavía cerrada** → comprobarla por HTTPS → **decidir abrir**, que es
   el punto sin retorno → abrir. Hay dos puertas distintas: la de la base (el permiso de
   conectarse, que el migrador cierra y devuelve) y la del negocio (el mantenimiento, que solo se
   levanta al final). Devolverle la conexión a la aplicación para probarla **no** abre el negocio.
   El respaldo previo permite volver sin perder nada **solo mientras no se haya decidido abrir**:
   una vez abierta, lo que se cobre ya no está en ese respaldo. El detalle, en la tarea 5.
7. **La aplicación sabe qué versión del esquema espera.** Si la última migración aplicada no es
   la que trae su imagen, no atiende: lo pregunta **cada ruta en cada petición** (503, sin decir
   por qué), no solo `/api/salud`. El proxy no consulta la salud antes de pasar una petición.
8. **Cada publicación deja escrito qué se publicó:** el commit y la huella de cada imagen. La
   imagen anterior se conserva hasta la siguiente publicación.

### Restaurar

9. **Una sola secuencia, compartida por el ensayo y la emergencia** (`operacion/restaurar.ts`):
   crear los roles mínimos (`feruga_app`; el volcado no trae roles y sus permisos lo nombran) →
   restaurar en una base **aparte** (`feruga_restaurando`), en una sola transacción → auditar →
   migrar lo que falte y comprobar que quedó en la versión que el programa conoce → registrar la
   restauración → dejar el usuario de conexión → entrar como la aplicación y comprobar que la
   puede usar → **solo entonces** darle el nombre definitivo, que debe estar libre. Si algo falla
   antes de renombrar, la base a medias se elimina; nunca queda una base `feruga` incompleta.
10. **Registrar la restauración abre un bloque nuevo de folios** (migración nueva):
    `registrar_restauracion` deja constancia de qué respaldo se restauró y cuándo, **salta la
    numeración al siguiente bloque de cien mil**, cierra todas las sesiones abiertas y lo anota
    en la bitácora. Los folios emitidos entre el respaldo y la pérdida quedan en el bloque
    anterior y no se pueden repetir, se hayan perdido los que se hayan perdido. Cien mil es
    mucho más de lo que el patio puede emitir entre un respaldo y otro.
    **La aplicación no atiende sobre una base restaurada sin registrar.** La base guarda en una
    tabla la identidad del servidor, el identificador que ese servidor le dio a ella, y el que le
    dio a **cada tabla y secuencia que tenía al emparejarse**. Es la de siempre mientras sus
    tablas y secuencias sean exactamente esas, ni una menos ni una más: restaurada en otro servidor, en otra base del mismo, o **encima de sí
    misma** (una restauración vuelve a crear las tablas, y el servidor les da otro identificador),
    deja de coincidir, y ninguna ruta atiende (503). Solo `registrar_restauracion` la vuelve a
    emparejar. **Lo comprueban la aplicación y el migrador con su propio código**, no una función
    de la base, que un volcado viejo puede reponer. **Migrar nunca empareja**: agrega a la marca
    lo que crea, y solo si la base estaba emparejada antes y después; una migración que quita o
    recrea una tabla cubierta lo dice antes (`vida_retirar`), o la base queda sin emparejar.
    (Llegar aquí tomó siete vueltas con Codex: una propiedad de la base, que viajaba con
    `pg_restore --create`; servidor y base, que no veía una restauración encima; la tabla de la
    marca, que se podía dejar fuera del volcado; todas las tablas por su nombre, que un cambio de
    nombre escondía; la comprobación dentro de la base, que un volcado viejo reponía; y «que no
    falte ninguna», que se burlaba guardando la vieja con otro nombre: ahora tampoco puede sobrar.)
    **Límites, dichos:** no distingue una copia física del servidor entero; ni una recarga solo
    de datos sobre las mismas tablas; ni lo que no es tabla o secuencia (funciones, vistas,
    disparadores repuestos de un volcado); ni a quien administra la base y la empareja a mano.
    Protege de una restauración olvidada, no de una maniobra deliberada. La forma admitida de
    restaurar es el programa, que restaura en una base nueva y registra.
    (En desarrollo y en pruebas no se exige: ahí las bases se clonan de una plantilla.)
11. **Lo que se perdió entre el respaldo y la pérdida no vuelve solo.** La guía dice cómo
    conciliarlo: compras y ventas, de los comprobantes que conserve el negocio; el inventario, con
    un conteo físico de lo que se movió, que es el remedio que el sistema ya tiene. Conteos,
    mermas, separaciones y correcciones de esa ventana no dejan papel. Por eso importa que la
    ventana sea corta (pregunta 4).
12. **Lo que se audita después de restaurar** no son solo saldos: identidad (personas,
    credenciales, equipos), impresiones, envíos y cancelaciones, bitácora. Y se usa: entrar con la
    clave de una persona, hacer una operación por la aplicación con su usuario de conexión, repetir
    un envío anterior al respaldo (devuelve lo mismo) y uno cancelado (sigue rechazado).

### Respaldar

13. **Cada respaldo es una corrida con identificador propio y pasos explícitos:** tomar el candado
    de respaldo (uno a la vez: el programado y el manual se esperan) → señal de inicio al
    vigilante → `pg_dump --format=custom` → `age` con la llave pública → huella SHA-256 de lo
    cifrado → subir con nombre único (`feruga/AAAA/MM/DD/<momento>-<corrida>.dump.age`) → **bajar
    lo subido y comparar su huella** → subir el manifiesto (momento de la instantánea, objeto,
    tamaño, huella, versión de `pg_dump`, llave usada) → señal de «terminó bien». Cada proceso con
    su plazo, y el fallo de cualquiera detiene la corrida.
14. **Un respaldo existe cuando tiene manifiesto.** Un objeto sin manifiesto es una corrida que no
    terminó: `lista` y `restaurar` lo ignoran, y lo limpia la regla de caducidad del
    almacenamiento, no el servidor.
15. **El almacenamiento protege la historia, no la credencial.** Cubo con versiones y retención
    con candado (Object Lock): aunque el servidor sobrescriba o borre, la versión anterior
    sobrevive hasta que venza su retención. Dos credenciales: la del servidor sube, lista y lee
    **lo cifrado** de su prefijo, y no puede cambiar la retención; la de recuperación solo lee, y
    la guarda el dueño con la llave privada. El proveedor que se elija debe ofrecer versiones y
    retención con candado.
16. **La frecuencia es configuración; la recomendación es cada hora en horario de operación**, al
    cerrar la jornada y antes de cada publicación. Si el servicio estuvo caído a la hora de un
    respaldo, lo toma al volver.
17. **El vigilante externo espera cada respaldo a su hora**, con un margen, y avisa si uno no
    empieza, no termina o se retrasa. Una señal tardía no cuenta como reciente.
18. **El ensayo con respaldos de verdad es periódico y lo hace una persona**, porque la llave
    privada no vive en ningún servidor: desde otra máquina, con la credencial de recuperación,
    baja el último respaldo, lo restaura con el mismo programa y levanta la aplicación. Es un solo
    comando, y avisa a un segundo vigilante que alerta si pasan más de 35 días sin ensayo.

### Proxy y red

19. **Caddy**, con volumen propio para certificados y sin puerto de administración publicado. El
    servicio se da por disponible cuando una petición **HTTPS con validación de certificado**
    contesta, no cuando el contenedor corre. Si el certificado no se emite, no se abre operación;
    la contingencia nunca es quitar `Secure` ni servir por HTTP. El vigilante externo avisa del
    vencimiento con anticipación.
20. **El ensayo local confía en la autoridad de Caddy**, instalada en el navegador de prueba. No
    se usa la bandera de origen seguro ni se ignoran errores de certificado como evidencia.
21. **Publicado a la red, solo el proxy** (80 y 443). Base y aplicación, en `127.0.0.1`. Se
    comprueba en la configuración efectiva de Compose y, en el servidor, desde otra máquina, por
    IPv4 e IPv6. Los puertos que publica Docker no pasan por el cortafuegos del sistema: por eso
    la regla es no publicar, no «bloquear después».

### El servidor

22. **Guion y guía para Ubuntu LTS**, con los privilegios dichos como son: quien puede usar Docker
    es administrador. Acceso por llave, verificado en una segunda conexión antes de quitar las
    contraseñas, y con la consola del proveedor como salida. El guion se prueba dos veces en un
    contenedor para ver que es repetible; SSH, cortafuegos, reinicio y arranque solo se pueden
    verificar en una máquina de verdad, y eso es la tarea 7.

## Estructura de archivos

```
docker-compose.yml                 sin valores por omisión
.env.desarrollo                    los valores de desarrollo, y MODO=desarrollo
docker-compose.operacion.yml       proxy, respaldo, comprobación
docker-compose.ensayo.yml          la capa del ensayo local: autoridad propia, almacenamiento y vigilante de mentira
operacion/levantar.sh              comprobar antes de tocar, levantar, y pedir el sitio por HTTPS
operacion/ensayo.sh                el ensayo de la operación en esta máquina
docker/respaldo.Dockerfile         Node + cliente de Postgres 17 + age + rclone
db/migraciones/0020_restauracion.sql   registro de restauraciones y bloque nuevo de folios
db/migrar.ts                       la ventana de mantenimiento
src/servidor/entorno.ts            exigirEntorno: lo que cada proceso pide para arrancar
src/servidor/esquema.ts            la versión del esquema que la aplicación espera
operacion/entorno.sh               genera el .env de operación (sin Docker)
operacion/restaurar.ts             la secuencia de restauración
operacion/respaldar.ts             la corrida de respaldo, el servicio y la consola (ahora, lista, servicio)
operacion/destino.ts               el almacenamiento (rclone), los manifiestos, bajar y comprobar
operacion/horario.ts               a qué horas toca; medianoche y cambio de horario
operacion/programas.ts             correr pg_dump, pg_restore, age y rclone sin secretos a la vista y con plazo
docker/almacen.Dockerfile          MinIO, solo para la batería
operacion/comprobar.ts             entorno, red, HTTPS con validación, certificado
operacion/Caddyfile
operacion/publicar.sh              el procedimiento de publicación, paso por paso
operacion/servidor.sh              preparar el servidor
docs/operacion.md                  la guía
pruebas/20-entorno.test.ts  21-migrar-en-operacion.test.ts  22-restauracion.test.ts  23-respaldo.test.ts
recorrido/operacion.spec.ts        por HTTPS, detrás del proxy
```

## Tareas

### Tarea 1 · Endurecer lo que ya existe — hecha
Archivos: `docker-compose.yml`, `.env.desarrollo`, `src/servidor/entorno.ts`, `src/servidor/esquema.ts`,
`operacion/entorno.sh`, `db/migrar.ts`, `db/rol.ts`, `consola/principal.ts`, `src/servidor/ruta.ts`,
`src/app/api/salud/route.ts`, pruebas `20-entorno`, `21-migrar-en-operacion` y `12-servidor`.

- [x] **Entorno.** `exigirEntorno` rechaza, diciendo qué falta y sin repetir valores, cada caso de
      la decisión 2, y acepta uno completo; con `MODO=desarrollo` acepta los de desarrollo. El
      migrador, el paso del usuario de conexión, la consola y la aplicación (salud y todas las
      rutas: 503) se niegan con un entorno inválido. `docker compose config` sin `.env` falla
      nombrando la variable. Comprobado por mutación: quitando la llamada en las rutas, en salud y
      en el paso del usuario de conexión, las pruebas fallan.
- [x] **Generar el entorno.** `operacion/entorno.sh` produce un archivo `0600` que `exigirEntorno`
      acepta salvo por la llave pública y el destino del respaldo; dos corridas no repiten clave;
      no pisa uno existente; no muestra ninguna clave.
- [x] **Migrar con la aplicación viva.** Con barrera: con pendientes y la aplicación conectada, el
      migrador se niega y no aplica nada; mientras migra la aplicación no puede entrar, y sigue
      sin poder hasta que su usuario queda listo; con tres pendientes y la tercera rota quedan dos
      aplicadas, la aplicación fuera, y al corregirla sigue desde la tercera; sin pendientes no
      toca nada. La puerta es el permiso de conectarse a **esa** base, no al servidor entero: los
      usuarios son de todo el servidor y cerrarles la entrada dejaría fuera a las demás bases.
- [x] **Dos migradores:** la prueba demuestra que los dos esperan el candado; quitándolo, falla.
- [x] **Versión del esquema.** Con una migración de más o de menos, salud contesta 503. Una
      prueba impide agregar una migración sin decirle a la aplicación que la espera.

Quedó en 551 pruebas y 106 recorridos.

### Tarea 2 · Restaurar — hecha
Archivos: `db/migraciones/0020_restauracion.sql`, `operacion/restaurar.ts`, `docker/pruebas.Dockerfile`
(se le agregó `age`), `src/app/api/salud/route.ts`, `pruebas/22-restauracion.test.ts`.

- [x] **Folios.** Registrar una restauración salta la numeración al siguiente bloque de cien mil;
      dos restauraciones abren dos bloques; una base sin folios también salta. En la prueba del
      camino entero, después del respaldo se emiten tres folios más que se pierden: la operación
      nueva sobre la base restaurada lleva el primero del bloque siguiente, ninguno de esos.
      Queda registro (que no se edita) y bitácora, y las sesiones abiertas quedan cerradas.
- [x] **La aplicación no atiende sobre una base restaurada sin registrar** (salud 503). Una
      instalación nueva nace emparejada; una copia de otra base no, hasta que se registra. En
      `MODO=desarrollo` no se exige, porque ahí las bases se clonan de una plantilla.
- [x] **La secuencia.** Crea el rol que falta; restaura en una base aparte, en una sola
      transacción; audita; migra; registra; deja el usuario de conexión; y al final renombra. Con
      otra llave, con el archivo dañado y con un volcado cortado no queda ninguna base, y después
      el bueno entra. Sobre una base que ya existe se niega sin tocarla.
- [x] **Lo restaurado sirve.** El retrato incluye identidad, impresiones, envíos, resultados y
      bitácora, y queda idéntico. Con el usuario de la aplicación se entra con clave y se hace una
      compra; un envío anterior devuelve lo mismo; uno cancelado sigue rechazado.
- [x] **La llave privada.** El descifrador se retiene con una tubería y se le mira mientras está
      vivo: la llave no está en sus argumentos ni en su entorno, ni en los de `pg_restore`, ni en
      lo que el programa dice. No queda el volcado descifrado en el disco.

Comprobado por mutación: pasando la llave por el entorno, sin registrar la restauración, y
restaurando directo en la base definitiva, falla la prueba que corresponde.

No se hizo todavía: las mutaciones de «restaurar otro archivo» y «omitir del volcado identidad o
envíos»; y el momento del respaldo sale por ahora de lo último que el respaldo trae (el
manifiesto que lo dará exacto es de la tarea 3). Quedó en 560 pruebas.

### Tarea 3 · Respaldar — hecha y cerrada por Codex el 6 de octubre (ver abajo lo que cambió en sus revisiones)
Archivos: `operacion/respaldar.ts` (la corrida, el servicio y la consola), `operacion/destino.ts`
(el almacenamiento y lo que hay en él), `operacion/horario.ts`, `operacion/programas.ts`,
`operacion/restaurar.ts` (restaurar desde el almacenamiento), `docker/respaldo.Dockerfile`,
`docker/almacen.Dockerfile` y el servicio `almacen` del perfil de pruebas, `src/servidor/entorno.ts`,
`operacion/entorno.sh`, pruebas `23-respaldo`, `20-entorno`, `22-restauracion` y el apoyo
`pruebas/almacen.ts` y `pruebas/patio.ts`.

- [x] **El camino entero contra un almacenamiento de verdad** (MinIO con versiones, retención con
      candado y credenciales restringidas): respaldar; no queda copia en la máquina; con la
      credencial de recuperación se lista, se baja, se comprueba contra el manifiesto y se
      restaura con el programa de la tarea 2. El retrato queda idéntico, el registro lleva el
      momento exacto del manifiesto y el folio siguiente cae en el bloque nuevo.
- [x] **Permisos reales:** con la credencial del servidor, sobrescribir deja viva la versión
      anterior; borrar, borrar una versión y cambiar la retención (del objeto o del cubo) se
      niegan; fuera de su prefijo no escribe; la de recuperación no escribe. Ni quien administra
      el almacenamiento puede borrar la versión protegida. Lo pisado no se restaura (no coincide
      con su manifiesto), y el almacenamiento **se puede ver como estaba antes del daño**
      (`--como-estaba`), donde el respaldo sigue entero.
- [x] **Verificación:** un objeto alterado conservando su tamaño, entre la subida y la
      comprobación, se detecta; sin permiso de lectura no hay cómo comprobar. En los dos casos no
      hay manifiesto ni señal de éxito, y el siguiente respaldo bueno sí queda.
- [x] **Fallos provocados, de verdad, en cada paso** (la base no contesta; quien se conecta no
      puede leer las tablas; una llave que no es llave; una credencial que no escribe; una que
      sube el respaldo pero no su manifiesto): la corrida termina con error diciendo el paso, no
      hay manifiesto, no hay señal de éxito, hay señal de fallo y no quedan restos en la máquina.
      Un objeto sin manifiesto está en el almacenamiento pero no cuenta como respaldo.
- [x] **Uno a la vez**, con barrera: el segundo espera el turno sin empezar a volcar ni avisar, y
      después corre. **Escrituras durante el volcado**, con barrera: lo que el patio asienta
      mientras se vuelca no entra a medias, y el momento del respaldo es anterior a todo eso.
- [x] **Horario y vigilancia:** cada respaldo a su hora (medianoche y cambio de horario: la hora
      que no existe se recorre, la que se repite dispara una vez); uno perdido por caída se toma
      al volver, uno y no uno por hora; el que falla se reintenta pronto sin pasarse de la hora
      siguiente; el que tarda más que el intervalo no deja sin tomar el que venció. El vigilante
      recibe inicio antes de que exista el respaldo y fin cuando ya existe; una corrida detenida
      vence su plazo, avisa el fallo y no deja su sesión viva en la base.
- [x] **Secretos:** ni la clave de la base ni la del almacenamiento viajan en argumentos (se mira
      a `pg_dump` detenido en la barrera, y a `rclone` y `age` mientras corren), ni en lo que la
      corrida dice, ni en el manifiesto. De paso se corrigió `pg_restore`, que llevaba la clave de
      la base en sus argumentos desde la tarea 2.
- [x] **Por la consola, como se usa:** `respaldar ahora`, `lista` (en otra máquina, solo con el
      destino y la credencial de recuperación) y `restaurar --remoto --ensayo`, que avisa al
      vigilante de los ensayos solo si restauró.
- [x] **Entorno:** fuera de desarrollo el respaldo pide llave pública, destino con forma
      `remoto:cubo/carpeta` y su remoto configurado con credencial, horario y vigilante por
      `https://`. `operacion/entorno.sh` deja el horario puesto y lo demás por llenar.

Comprobado por mutación (23 mutaciones; todas hacen fallar alguna prueba): adelantar la señal de
éxito; subir el manifiesto antes de comprobar; comprobar solo el tamaño; quitar el turno; tomar el
momento después de volcar; la conexión de `pg_dump` en sus argumentos; traer sin comparar la
huella; contar un objeto sin manifiesto; dejar la carpeta de trabajo; no avisar del fallo;
restaurar sin el momento del manifiesto; traer el más viejo; volcar sin envíos o sin credenciales;
avisar de un ensayo que no restauró; y las del horario y el servicio. Una sobrevivía (la hora que
no existe por cambio de horario caía donde fuera): se reforzó esa prueba. Quedaron hechas también
las dos que faltaban de la tarea 2.

**Lo que cambió respecto de lo planeado, y por qué:**

- **MinIO sale del paquete de Alpine**, no de su imagen: ya no se publica en Docker Hub.
- **`rclone --immutable` no se usa:** se probó y no impide sobrescribir con `copyto`. La historia
  la protegen las versiones y el candado, como dice la decisión 15, y el nombre único de cada corrida.
- **Que `rclone` termine bien no prueba nada:** leer un objeto que no existe termina «bien», con
  nada. Todo lo que se baja se compara contra su huella, y un respaldo sin manifiesto no existe.
- **Si el vigilante no contesta, el respaldo se toma igual** (la decisión 13 decía que el fallo de
  cualquier paso detiene la corrida). Dejar de respaldar porque no hay a quién avisar es peor, y
  el silencio ya es la alerta. La corrida lo dice, y `ahora` lo advierte.
- **Al vigilante le llega solo el paso que falló**, no lo que dijo cada programa: es un servicio
  ajeno, y el detalle (nombres de máquinas y de cubos) se queda en el registro del servidor.
- **Detener a `pg_dump` no detiene su sesión en la base:** si esperaba un candado, ahí se quedaba,
  con los suyos tomados. Lo encontró la prueba del plazo; ahora la corrida termina esa sesión.
- **El momento del respaldo se toma antes de volcar.** Dice: todo lo asentado antes está en el
  respaldo; lo posterior es lo que hay que conciliar.

**Lo que no se hizo, o no se puede probar aquí:**

- El servicio `respaldo` en el Compose de operación es de la tarea 4. La imagen
  (`docker/respaldo.Dockerfile`) se construyó y se corrió a mano contra la base de desarrollo y el
  almacenamiento de pruebas (respaldó, listó, y fuera de desarrollo se negó); la batería no la construye.
- Los permisos se probaron con las políticas de MinIO. El proveedor que se contrate los expresa a
  su manera: los mismos casos se repiten contra él en la tarea 7.
- «Una señal tardía no cuenta como reciente» es configuración del vigilante (su margen), no del
  programa: tarea 7.
- **Un servidor comprometido puede subir un respaldo falso más nuevo, con su manifiesto** (cifrar
  con la llave pública lo puede hacer cualquiera). El manifiesto prueba que lo bajado es lo que se
  subió, no quién lo subió. El remedio es el tiempo: restaurar por nombre, o ver el almacenamiento
  como estaba antes (`--como-estaba`), que pide una credencial que lea versiones.
- Los cubos de las pruebas no se pueden borrar (para eso es el candado): se pierden al detener el
  contenedor del almacenamiento, que guarda en memoria.

Quedó en 580 pruebas.

**Supuestos que dependen de tus respuestas** (están como configuración, no como código):
respaldo cada hora de 07:00 a 20:00 (pregunta 1); el vigilante habla el protocolo de Healthchecks
(pregunta 8); el almacenamiento es compatible con S3 (pregunta 3).

### Tarea 4 · Proxy y Compose de operación — hecha (ver abajo lo que cambió tras la revisión de Codex)
Archivos: `docker-compose.operacion.yml`, `operacion/Caddyfile`, `operacion/comprobar.ts`,
`operacion/levantar.sh`, `pruebas/24-comprobar.test.ts`; y el ensayo: `operacion/ensayo.sh`,
`docker-compose.ensayo.yml`, `operacion/ensayo/`, `recorrido/operacion.spec.ts`,
`playwright.operacion.config.ts`, `docker/recorrido.Dockerfile`.

El ensayo es un guion (`sh operacion/ensayo.sh`, solo pide Docker): genera un entorno de operación
con `operacion/entorno.sh` para un dominio que no existe (`patio.test`), levanta **el mismo Compose
de operación** bajo otro nombre de proyecto, con una capa que pone solo lo que aquí no puede ser de
verdad (quién emite el certificado, a dónde van los respaldos, a quién se le avisa), comprueba, y
no deja nada.

- [x] **Ensayo por HTTPS**, con la autoridad del proxy confiada en el navegador (sin bandera de
      origen seguro y sin ignorar errores de certificado): HTTP redirige; salud por HTTPS;
      cabeceras (también `Strict-Transport-Security`); contexto seguro y candados entre pestañas;
      alta de equipo con cookie `Secure`, entrada y una compra que queda asentada.
- [x] **Origen:** con sesión y cuerpo válidos, la petición recibe 403 `ORIGEN` desde otro sitio,
      sin efecto en la base, y pasa desde el propio.
- [x] **Orden y reinicios:** con el entorno mal puesto no se levanta nada, y lo dice antes de
      tocar; aun a secas, la comprobación corre primero y ni la base ni la aplicación llegan a
      arrancar. Con el entorno bien, arrancan en orden (comprobación, base, migración,
      aplicación, proxy). Con servicios corriendo, un entorno mal puesto no toca nada. Y
      saltándose la comprobación, la aplicación arranca pero contesta 503: cada proceso valida lo suyo.
- [x] **Red:** la configuración efectiva de operación, tal como irá al servidor, publica a la red
      solo el proxy en 80 y 443; base y aplicación, solo en `127.0.0.1`; ningún contenedor recibe
      el socket de Docker (`comprobar red`, probado en la batería con cada caso malo). En el
      ensayo, nada queda publicado a la red.
- [x] **Certificado:** con una autoridad en la que no se confía, `comprobar https` falla; el
      certificado es el mismo después de recrear el proxy.
- [x] **Respaldo dentro de la operación:** el servicio toma el primero al arrancar; uno a mano
      queda en la lista y el vigilante (por HTTPS) recibe inicio y fin.

Comprobado por mutación en el ensayo: sin la dependencia de la base hacia la comprobación, la base
arranca con el entorno mal puesto y el ensayo falla; sin instalarle al navegador la autoridad del
proxy, el recorrido falla con `ERR_CERT_AUTHORITY_INVALID` (o sea: de verdad valida el
certificado). Y el caso de `docker compose up` a secas se vio fallar antes de existir el guion.

**Lo que el ensayo encontró, y cambió el diseño:**

- **`docker compose up` a secas, con el `.env` mal puesto, quita la aplicación que estaba
  atendiendo.** Compose reemplaza los contenedores cuya configuración cambió antes de arrancar
  nada; la comprobación falla después y el sitio se queda caído. No corre nada mal configurado
  —eso sí se cumplía—, pero la promesa de «no los reemplaza» era falsa. Por eso existe
  `operacion/levantar.sh`: comprueba primero, sin tocar lo que corre (el entorno, y qué se publica
  a la red), y solo entonces levanta y pide el sitio por HTTPS. El ensayo conserva el caso a
  secas, para que se sepa si Compose cambia de conducta. **En operación no se usa `docker compose
  up` a mano.**
- **La comprobación del entorno no acepta `MODO=desarrollo`:** el Compose de operación publica el
  sitio a la red, y eso no se hace con claves de desarrollo aunque alguien lo declare.
- **El servicio de respaldo toma uno al arrancar si no hay ninguno.** Es lo que ya decía la regla
  («nunca se ha respaldado»), y en una instalación nueva deja el primero de inmediato.

**Lo que no se hizo, o no se puede probar aquí:**

- **«Con la comprobación retenida»:** no se usó barrera. El orden se ve en las horas de arranque
  y fin de cada contenedor, y el rechazo, en que nada posterior llega a arrancar.
- **Que el certificado sobreviva gracias al volumen no está comprobado por mutación:** quitar el
  volumen rompe antes otra pieza del ensayo. Se comprobó que la huella es la misma tras recrear.
- **El certificado de verdad** (el que emite una autoridad pública para el dominio real) no se
  puede ensayar en una máquina sin ese dominio: tarea 7. Lo mismo que el sitio conteste **desde
  otra máquina**: `comprobar https` entra por la red de contenedores y no prueba que el puerto
  esté abierto hacia fuera.
- En el ensayo, el servicio de respaldo arranca antes de que exista la autoridad del proxy, así
  que su primer aviso al vigilante falla (el respaldo se toma igual). Es del ensayo: en operación
  el vigilante tiene un certificado público.

Quedó en 585 pruebas, 106 recorridos y el ensayo (4 recorridos por HTTPS).

### Revisión de Codex a las tareas 3 y 4 (4 de octubre) — dos pasadas atendidas y una tercera incompleta, en verificación

De aquí en adelante Codex revisa **cada tarea al cerrarla**, no el bloque al final. Su revisión de
las tareas 3 y 4 (`docs/revisiones/2026-10-04-codex-revision-de-respaldo-y-proxy.md`) no las dio
por cerradas: un bloqueante, siete importantes, dos menores. La respuesta, hallazgo por hallazgo,
está en `docs/revisiones/2026-10-04-respuesta-a-la-revision-de-respaldo-y-proxy.md`. Lo que cambió:

- **La aplicación no atiende sobre una base que no es apta** (otra versión del esquema, o
  restaurada sin registrar): lo pregunta **cada ruta en cada petición**, no solo la salud. Antes
  la salud contestaba 503 y las compras seguían entrando.
- **Respaldos:** el nombre lleva el momento al milisegundo y ese es el orden; un manifiesto dañado
  no cuenta como respaldo reciente; el esquema que dice el manifiesto se lee de la misma
  instantánea que se vuelca; un último respaldo «del futuro» (el reloj retrocedió) cuenta como pendiente.
- **Restaurar:** rechaza un respaldo de una versión que el programa no conoce, y termina entrando
  como la aplicación para comprobar que puede usar la base. Si el último no sirve lo dice, y dice
  cuál sí; no baja a uno más viejo en silencio.
- **Levantar:** la configuración se resuelve una vez, y esa misma se comprueba y se levanta; una
  operación a la vez.
- **Comprobar la red:** rechaza la red de la máquina, los privilegios y el socket de Docker
  también por la carpeta que lo contiene.
- **El ensayo:** el orden de arranque con barrera (la migración retenida), cada puerto publicado
  mirado contenedor por contenedor, los candados entre dos pestañas de verdad, los avisos atados
  a su corrida, la base no apta a través del proxy, y la limpieza desde el primer momento.

**Segunda pasada de Codex** (`docs/revisiones/2026-10-04-codex-segunda-revision-verificacion-y-diseno-de-publicar.md`):
confirmó corregido el bloqueante y nueve de los diez hallazgos; dejó cinco importantes y dos
menores, ya atendidos (`docs/revisiones/2026-10-04-respuesta-a-la-segunda-revision.md`): los
respaldos con el nombre de antes se siguen leyendo; la marca de restauración la ven también las
conexiones que ya estaban abiertas (migración `0021`); la búsqueda del último respaldo utilizable
tiene tope y distingue «no se pudo leer» de «está dañado»; el manifiesto se valida completo y
contra el tamaño del objeto; la sesión del volcado se termina por una conexión propia; y la base
caída contesta 503 también en las rutas.

**Tercera pasada: incompleta por cuota** (`docs/revisiones/2026-10-04-codex-tercera-pasada-incompleta.md`).
No hay veredicto y **hay que repetirla**. Sus registros dejaron cinco hallazgos, ya atendidos
(`docs/revisiones/2026-10-04-respuesta-a-la-tercera-pasada-incompleta.md`): la marca de la base
viajaba con `pg_restore --create` (migración `0022`: ahora es la identidad del servidor y de la
base); un nombre con fecha imposible dejaba la búsqueda en un bucle sin fin; el tope no valía
entre nombres de antes del mismo segundo; un manifiesto con otra instantánea que la de su nombre
se daba por bueno; y un mensaje que decía «no hay» cuando sí había más atrás.
**Las tareas 3 y 4 siguen en verificación.**

**No se da por cumplida la decisión 18:** el ensayo periódico todavía no levanta la aplicación
sobre lo restaurado; acredita la restauración y que el usuario de la aplicación puede usar la
base. El guion completo va con la guía (tarea 6).

**Cuarta revisión** (`docs/revisiones/2026-10-04-codex-cuarta-revision.md`, completa). **La tarea 4
quedó verificada** en lo que se puede probar en esta máquina. **La tarea 3 no se cerró**, por tres
importantes, ya corregidos (`docs/revisiones/2026-10-04-respuesta-a-la-cuarta-revision.md`):
restaurar con `pg_restore --clean` encima de la misma base pasaba por buena (migración `0023`: la
marca guarda también la identidad de la tabla que la contiene); la `0022` daba por buena, al migrar, una marca
que ya se sabía transportable (ahora solo se empareja sola una instalación sin operaciones ni
folios usados; una que ya operaba se empareja a mano, una vez); y el tope de la búsqueda del
último respaldo no contaba las lecturas buenas (ahora son diez lecturas en total, y si no alcanza
para saber cuál es el último, lo dice).

**Quinta revisión** (`docs/revisiones/2026-10-04-codex-quinta-revision.md`; se le acabó la cuota
antes de la parte de las diez cuentas, que se repite). Confirmó corregidas las tres de arriba, y
**tampoco cerró la tarea 3**, por dos huecos nuevos en la misma marca, ya corregidos
(`docs/revisiones/2026-10-04-respuesta-a-la-quinta-revision.md`): un volcado que deja fuera la
tabla de la marca recreaba todas las demás sin que se notara (ahora la marca guarda la identidad
de **todas** las tablas y secuencias); y la `0023`, al migrar, adoptaba un respaldo de la `0022`
restaurado encima de la misma base (ahora, como la `0022`, solo se empareja sola una instalación
sin operaciones ni folios usados, y el migrador solo agrega tablas a una marca que ya valía).

**Sexta revisión** (`docs/revisiones/2026-10-04-codex-sexta-revision.md`, completa). Confirmó
esas dos y **tampoco cerró la tarea 3**, por dos huecos más en la misma marca, ya corregidos
(`docs/revisiones/2026-10-06-respuesta-a-la-sexta-revision.md`): una tabla recreada por una
restauración volvía a pasar por buena si después una migración le cambiaba el nombre, o si se
quitaba en una migración y se creaba en la siguiente (ahora la marca mira el identificador de
cada tabla, no su nombre, y exige que todas sigan ahí; quitar una se dice con `vida_retirar`); y
un volcado viejo y parcial reponía la función que comprobaba (ahora lo comprueban la aplicación y
el migrador con su propio código).

**Séptima revisión** (`docs/revisiones/2026-10-06-codex-septima-revision.md`, completa). Confirmó
esas dos, y **tampoco cerró la tarea 3**: guardando con otro nombre una secuencia que la marca
conocía y restaurando otra con el nombre de siempre, todo lo conocido seguía ahí y la aplicación
atendía con los folios de antes. Corregido (`docs/revisiones/2026-10-06-respuesta-a-la-septima-revision.md`):
las tablas y secuencias tienen que ser **exactamente** las conocidas, ni una menos ni una más; y
el migrador solo agrega lo que crea una migración sobre una base que antes de aplicarla estaba
exacta. Aprobó para codificar la tarea 5 (diseño 5) y la 3b (diseño 2).

**Octava revisión** (`docs/revisiones/2026-10-06-codex-octava-pasada-incompleta.md`): se quedó sin
cuota a los tres minutos y no cuenta. Dejó una pista en su registro, que era cierta: una migración
que quitaba una tabla con secuencia propia, o dos tablas a la vez, dejaba la base sin emparejar.
Corregido: `vida_retirar` se lleva las secuencias de la tabla y admite varias retiradas en la
misma transacción.

**Novena revisión** (`docs/revisiones/2026-10-06-codex-novena-revision.md`; de ella, la parte de
la marca está completa). **Codex cerró la tarea 3**, sin hallazgos nuevos: la secuencia de folios
renombrada se rechaza antes de migrar, después de migrar y al intentar retirar la vieja; las
tablas `serial` e `identity` y las secuencias sueltas se retiran y se recrean sin perder el
emparejamiento; y la cuenta de lo retirado dentro de una transacción no sirve de llave —la
aplicación y el migrador no la leen, y el usuario de la aplicación no puede retirar nada—. Lo que
queda fuera sigue siendo lo declarado en el README (copia física, recarga solo de datos, lo que
no es tabla ni secuencia, y el administrador que empareja a mano).

Quedó en 635 pruebas, 126 recorridos y el ensayo con 6 recorridos por HTTPS (migraciones hasta la `0024`).

### Tarea 3b · Un respaldo diario que se guarda un año — hecha el 6 de octubre; falta que Codex la revise
Lo pidió el usuario el 4 de octubre: los respaldos de cada hora, 30 días; y uno por día, un año.
Codex revisó el diseño (`docs/revisiones/2026-10-04-codex-sexta-revision.md`, parte G): dos
depósitos es lo más simple, y pidió precisar dos cosas antes de codificar. La versión 2, que las
precisa, la aprobó para codificar en su séptima revisión, con dos notas: que «se elige una vez»
sobreviva a un reinicio, y que si el elegido ya no está se avise del hueco en vez de elegir otro
en silencio. **Lo que se construyó, y en qué se aparta del diseño, está al final de esta tarea.**

- **Dos depósitos, uno por plazo.** El candado de retención lo da el depósito a cada objeto que
  recibe (así está probado), de modo que cada plazo tiene el suyo: el de cada hora
  (`RESPALDO_DESTINO`, 30 días) y el diario (`RESPALDO_DESTINO_DIARIO`, 365), con sus permisos
  por separado. Dentro, los nombres y los manifiestos son los mismos: el programa que lista, baja
  y comprueba sirve para los dos.
- **Cuál es «el diario» de un día: el primer respaldo de cada hora que salió bien ese día**, y el
  día se cuenta **en la hora del patio**, a partir de la instantánea que dice su manifiesto (las
  carpetas de los nombres van en hora universal: no sirven para esto). Es la primera fotografía
  buena de ese día —no «el cierre de ayer»: si la primera buena sale a las 10:00, ya trae lo de
  esa mañana—. **Se elige una vez y no cambia:** un reintento sube ese mismo, no el más nuevo.
- **Se pone al día solo.** En cada corrida, y al arrancar el servicio, se mira qué días —de los
  que todavía tienen respaldos de cada hora, que duran 30 días— no tienen su diario, y se les
  sube. Un diario que falló el lunes se recupera el martes, o cuando vuelva el depósito diario.
  **Un día sin ningún respaldo bueno no se puede reconstruir:** se avisa del hueco, y no se le
  pone al de mañana la etiqueta de ayer.
- **«Ese día ya tiene su diario» quiere decir un par comprobado**, no un nombre en la lista: el
  manifiesto es válido **y** el archivo, bajado, coincide con su huella. Si el manifiesto se subió
  y se perdió la respuesta, el reintento lo comprueba y lo reconoce. Si está dañado o no coincide,
  ese día no está cubierto y se sube de nuevo. Lo que quede huérfano de un intento fallido no
  cuenta como otro diario.
- **Se decide con el turno tomado.** El candado del respaldo se conserva desde que se pregunta si
  el día tiene diario hasta que su manifiesto queda subido y comprobado: una corrida a mano y la
  programada no ven las dos el día vacío.
- **Cómo:** se sube al depósito diario el mismo archivo cifrado con su manifiesto completo
  —nunca un apuntador al de cada hora, que vence a los 30 días—, y se comprueba igual. No se
  vuelve a volcar la base. El archivo cifrado se conserva hasta terminar con los dos depósitos
  (hoy se borra antes), o se vuelve a bajar y comprobar el de origen.
- **Si el diario falla**, el respaldo de la hora sigue valiendo y avisa su éxito; el fallo del
  diario avisa por su propia señal al vigilante.
- **Borrar lo vencido no lo hace el servidor** —su credencial no puede borrar, y así se queda—:
  lo hace el proveedor. En B2 la regla que limpia nombres que no se repiten es **ocultar a los
  30 (o 365) días y borrar lo oculto después**, para el archivo y para su manifiesto; «conservar
  versiones anteriores» no borra la última versión de cada nombre. La limpieza es diaria y
  respeta el candado: no promete borrar al segundo exacto.
- **Restaurar:** `--remoto` sigue leyendo los de cada hora; `--diario` y `--diario=<objeto>` leen
  el otro depósito con el mismo programa, admiten `--como-estaba`, y no se combinan con `--remoto`
  ni con un archivo local.
- **Las llaves viejas se guardan un año también:** un diario de hace once meses se abre con la
  llave de entonces.
- Los depósitos todavía no existen: nacen ya con 30 y 365 días. (Cambiar el plazo de un depósito
  que ya tiene objetos solo vale para lo que se suba después.)

Pruebas, con el almacenamiento de pruebas (un depósito a 30 días y otro a 365): el primero bueno
del día va a los dos lados y el segundo solo a uno; el día se cuenta en la hora del patio, también
con el cambio de horario; **el diario que falla a las 07:00 y se reintenta a las 08:00 sube el de
las 07:00**; el que falla todo el día se recupera al día siguiente; una falla después del último
respaldo del día; la subida que cruza la medianoche; el servicio que vuelve al otro día; la
respuesta perdida al subir el manifiesto; un diario dañado no cuenta y se repone; dos corridas a
la vez no suben dos; un día sin respaldos avisa del hueco; el diario se baja con la credencial de
recuperación y se restaura; la credencial del servidor no puede borrar ni acortar el candado en
ninguno de los dos. Contra B2 de verdad se repite en el servidor (tarea 7), con sus reglas de
vida: el almacenamiento de pruebas no acredita la configuración del proveedor.

**Lo que se construyó (6 de octubre de 2026, noche).**

- `operacion/diario.ts`: la decisión —cuál es el diario de cada día, cuándo un día ya lo tiene y
  qué se hace cuando algo falla a medias—. `operacion/respaldar.ts`: después de cada respaldo, y
  **con el turno todavía tomado**, se pone al día el depósito diario; al arrancar el servicio
  también, sin tomar otro respaldo (`diarioAlArrancar`). Si el diario falla, el respaldo de la
  hora vale y ya avisó su éxito: el diario avisa por su propia señal, sin detalles.
- `respaldar.ts lista --diario`; `restaurar.ts --diario` y `--diario=<objeto>`, que no se combinan
  con `--remoto` ni con un archivo.
- El entorno de operación exige `RESPALDO_DESTINO_DIARIO` —**otro depósito** que el de cada
  hora—, con su remoto y su credencial (`RCLONE_CONFIG_DIARIO_*`), y `RESPALDO_VIGIA_DIARIO_URL`,
  que no puede ser la misma señal que la del respaldo de cada hora. `operacion/entorno.sh` deja
  esos renglones por llenar; `docker-compose.operacion.yml` los pasa al servicio.
- El ensayo de operación crea el segundo depósito, con candado de 365 días y su credencial, y
  comprueba que el primer respaldo del día llega a él, que el segundo no, y que avisó por su señal.

**Cómo se cumplen las dos notas de Codex.** La elección se **escribe en el propio depósito
diario** antes de subir nada (`elecciones/<día>.json`: qué respaldo, su tamaño y su huella): no
vive en la memoria del servicio ni en el disco de la máquina, así que sobrevive a un reinicio y a
perder el servidor. Y si el elegido ya no está en el depósito de cada hora, o ya no coincide con
su huella, **ese día se da por perdido y se avisa**; no se sube otro en su lugar.

**En qué se aparta del diseño, o lo precisa — para que Codex lo valore:**

1. **«Un par comprobado» se comprueba una vez por arranque del servicio, no en cada corrida.**
   Comprobar es bajar el archivo y comparar su huella; hacerlo cada hora con treinta diarios
   sería bajar todo el depósito catorce veces al día. La primera vez que un proceso ve un día, lo
   baja y lo compara; después le basta con que la lista lo siga mostrando **del mismo tamaño, el
   archivo y su manifiesto**. Consecuencia: un diario pisado con otra cosa del mismo tamaño, con
   el servicio corriendo, no se nota hasta el siguiente arranque (o hasta restaurar, que siempre
   compara la huella). `respaldar.ts ahora` es un proceso nuevo cada vez: comprueba todos los
   días de la ventana, y por eso tarda más que antes —lo que haya que bajar—.
2. **Un hueco se avisa una vez.** Se deja anotado en el depósito diario
   (`elecciones/<día>.hueco.json`) y las corridas siguientes ya no alertan por él: una alerta
   que suena cada hora durante treinta días deja de leerse. Lo que se anota no se puede borrar
   —es el mismo candado—: un hueco anotado por error se queda anotado.
3. **Los días se recorren de corrido**, del primero que tiene respaldos hasta hoy: un día sin
   ningún respaldo entre dos que sí tienen también es un hueco. Hoy, que no ha terminado, no lo es.
4. **El archivo cifrado no se conserva** hasta terminar con los dos depósitos: se vuelve a bajar
   del de cada hora y se compara (el diseño admitía las dos formas). Así el diario de hoy y el de
   un día que falló siguen el mismo camino.
5. **Si un depósito no contesta, la corrida del diario falla sin marcar nada**: no poder leer no
   es estar dañado, ni «no tuvo respaldo».
6. **Queda para la guía y para el servidor de verdad** (tareas 6 y 7): las reglas de vida de B2
   en los dos depósitos, guardar un año las llaves viejas, y repetir contra B2 lo que aquí se
   probó contra el almacenamiento de pruebas. `--como-estaba` con `--diario` usa el mismo camino
   que con `--remoto`, pero **no tiene prueba propia**.

**Pruebas.** `pruebas/28-respaldo-diario.test.ts` (19, con depósitos de mentira que fallan donde
se les dice): el primero bueno del día y no el segundo; el día en la hora del patio, también con
cambio de horario; el que falla a las 07:00 y se reintenta a las 08:00; se elige una vez; el que
falla todo el día y una falla después del último respaldo; la subida que cruza la medianoche y
el servicio que vuelve al otro día; la respuesta perdida al subir el manifiesto y al subir el
archivo; el diario dañado que se repone; lo ya comprobado no se vuelve a bajar; el hueco que se
avisa una vez; ni huecos de antes ni de después; el depósito que no contesta. `pruebas/23-respaldo
.test.ts` (8, contra almacenamiento con candado): los dos depósitos con 30 y 365 días; el fallo
del diario que no tumba el respaldo; dos corridas a la vez; restaurar del diario con la
credencial de recuperación, y el servidor que no puede borrar ni acortar; la puesta al día al
arrancar, con su turno; y la consola. `pruebas/20-entorno.test.ts`: lo nuevo del entorno.

**Verificado** (6 de octubre, noche): tipos y **715 pruebas**, cero fallos; y **el ensayo de
operación**, que levanta el servicio de respaldo con los dos depósitos y comprueba el diario. Los
recorridos del navegador no se volvieron a correr: esta tarea no toca la aplicación.

**Comprobado por mutación: 24.** Las pruebas de la decisión pasaron a la primera, así que se
rompió el programa a propósito. Tres mutaciones sobrevivieron y de cada una salió una prueba:
que el elegido cambie **sin cambiar de tamaño** (solo su huella lo delata); que lo subido al
depósito diario **se baje y se compare** antes de darlo por hecho; y que la puesta al día al
arrancar **tome el turno**. Una línea resultó sobrar —saltarse los respaldos «del futuro», que el
recorrido de días ya deja fuera— y se quitó.

### Tarea 5 · Publicar una versión
Archivos: `operacion/publicar.sh`, `operacion/levantar.sh`, `db/migrar.ts`, una migración
(mantenimiento), `src/servidor/esquema.ts`, `docker-compose*.yml`, `docker/proxy.Dockerfile`, y el
ensayo de publicación.

**Diseño, versión 5 — pendiente de que Codex lo vuelva a revisar antes de escribir el código.**
La versión 1 tuvo tres bloqueantes y la 2, otros tres: prometían reanudar sola cualquier fase y
volver sola en muchos estados, y eso era lo que no se sostenía. La versión 3 adoptó lo que propuso
Codex —**una publicación lineal y una recuperación expresa de tres casos**— y su quinta revisión
(`docs/revisiones/2026-10-04-codex-quinta-revision.md`, parte D) la dio por buena en la dirección,
con un bloqueante en cómo se decide la recuperación y tres importantes. La versión 4 los cerró,
sin volver al diario de fases: una tabla de decisión que no se traslapa, un solo candado para
todo lo que toca la instalación, y un registro mínimo para activar una base restaurada. Su sexta
revisión (`docs/revisiones/2026-10-04-codex-sexta-revision.md`, parte D) la dio por buena salvo
el relevo a una versión corregida, que no tenía frontera. Esta versión se la da.

**Qué se promete, exactamente.** Antes de cerrar, no se altera lo que atiende. Desde que se cierra
hasta que se abre, el negocio está cerrado, pase lo que pase. Desde que se decide abrir, no se
retrocede; y una apertura confirmada sigue atendiendo aunque el guion muera después. (No hay un
vigilante que cierre el negocio cuando el guion muere: no hace falta, y sería otra pieza que falla.)

**A. La operación se cierra y se abre en la base.** Un estado durable —abierta o en mantenimiento,
con su motivo y **la publicación a la que pertenece**— que cada ruta consulta en cada petición: en
mantenimiento, ninguna ruta de negocio atiende. Lo cambia solo la administración, queda en la
bitácora, sobrevive a reiniciar el motor y a recrear contenedores, y viaja en el respaldo: uno
tomado con la operación cerrada, restaura cerrado, y abrir es un paso expreso.
La salud dice dos cosas por separado: que la aplicación está **lista** (entorno, base, esquema,
marca de restauración: eso mira el contenedor para darse por sano) y si la operación está
**abierta**. El comprobador valida las dos, qué versión contesta **y sobre qué base** (su marca);
un 200 a secas ya no basta.

**B. La secuencia, lineal y sin ramas:**
1. *Preparar* (no toca nada): el commit, sin cambios sueltos; construir sus imágenes; comprobar
   entorno y red; que el migrador de la candidata **revise sin aplicar** (toda migración ya
   aplicada existe en la candidata con el mismo contenido, y las pendientes van todas después de
   la última); y **que lo que corre sea lo que dice el último manifiesto cerrado**: contenedores,
   base y su marca, configuración. Si no coincide, no se publica: primero se averigua por qué.
2. *Escribir el manifiesto de la publicación*, antes de tocar nada (ver C).
3. *Cerrar*: mantenimiento, detener la aplicación y el servicio de respaldo (dejándolo terminar si
   estaba a media corrida), y esperar a que **no quede ninguna sesión de la aplicación en la base**
   (pasado el plazo, se terminan y se comprueba que no queda ninguna). Lo que entró antes de cerrar
   puede terminar: el respaldo se toma después de comprobar que ya no queda nada.
4. *Respaldar*, comprobado, y anotar su nombre exacto en el manifiesto. Si no se pudo anotar, no
   se migra. El aviso al vigilante se anota aparte: si no llegó, el respaldo sigue valiendo.
5. *Migrar.* Se anota **antes** de arrancar que la migración empezó.
6. *Levantar* el conjunto nuevo, con la operación cerrada, y *comprobar* por HTTPS a través del
   proxy: lista, cerrada, la versión esperada, la base esperada, cada contenedor con la imagen
   del manifiesto, y un intento real de escritura —con sesión y cuerpo válidos— que debe
   rechazarse sin dejar nada.
7. *Decidir abrir*, en este orden: se anota en el manifiesto; se anota en la base; y **solo
   entonces** se abre, con una instrucción que comprueba que la publicación, la base y su marca,
   y el conjunto que corre son los que se comprobaron, y que deja escrito que abrió. **De la
   primera de esas tres anotaciones en adelante no hay vuelta.**
8. *Terminar*: reponer el servicio de respaldo, comprobar otra vez qué corre de verdad, y cerrar
   el manifiesto como publicación buena. Si el respaldo no arranca, el negocio ya abrió y así se
   queda: el guion termina con error, lo dice fuerte, y el manifiesto queda cerrado «con el
   respaldo sin arrancar» (el vigilante de respaldos avisará también).

**C. Un solo manifiesto por publicación, y un solo candado para todo.**
- **El manifiesto** se escribe antes del paso que describe, y de modo que sobreviva a un apagón:
  a un archivo aparte, sincronizado a disco, renombrado, y sincronizada su carpeta. Dice: la
  publicación (con identificador propio, no solo fecha y commit), la instalación, **la base y su
  marca** (para no confundir historias), el conjunto anterior y el candidato por el identificador
  inmutable de cada imagen, el nombre del respaldo, y tres marcas que solo avanzan: **«empezó la
  migración»**, **«se decidió abrir»**, **«abierta»**. Si no se puede escribir, no se avanza.
- **La configuración de cada conjunto se guarda, no solo su huella**: la copia resuelta de
  Compose con que corre, en privado (lleva claves). Con la huella sola no se puede volver a
  levantar el conjunto anterior si la carpeta del proyecto ya cambió.
- **De la apertura manda la base**; de la migración, el manifiesto. Las dos marcas de abrir
  están en los dos lados, y basta que una lo diga (ver D).
- **Un candado único de la instalación**, que se toma de forma atómica (como el de `levantar.sh`,
  crear una carpeta), y que piden por igual: publicar, recuperar, levantar, y migrar a mano.
  Dos a la vez no entran, lleguen como lleguen. Mirar si hay un manifiesto sin cerrar no es un
  candado: sirve para negarse, no para excluirse.
- Mientras haya un manifiesto sin cerrar, `levantar.sh` y un `publicar.sh` ordinario se niegan.
  Si el manifiesto falta, no se lee, o habla de otra base o de otra marca que la que hay, **no
  significa «no hay nada pendiente»: la automatización se detiene.**

**D. Recuperar: `publicar.sh --recuperar`.** Toma el candado; comprueba que **el migrador y su
sesión en la base terminaron** (si siguen, espera, o los detiene y vuelve a comprobar: que el
proceso padre ya no exista no dice nada de la instrucción que dejó corriendo); mira el manifiesto,
la base y los contenedores; y decide con esta tabla, **que se lee en este orden y se queda en la
primera que se cumple**:

| # | Lo que encuentra | Lo único que hace |
|---|---|---|
| 1 | **Se decidió abrir o ya abrió**, lo diga el manifiesto **o** la base | Terminar hacia adelante: abrir si falta (con la misma instrucción que comprueba), reponer el respaldo, cerrar el manifiesto. **Nunca** ofrece el respaldo previo: ya pudo cobrarse algo que no trae. |
| 2 | No hay ninguna señal de apertura, y **empezó la migración** | Se queda cerrado. No repite la migración a ciegas ni vuelve solo. Ofrece las dos salidas deliberadas de abajo. |
| 3 | Ni lo uno ni lo otro | Restablecer el conjunto anterior —cerrando y drenando primero si el negocio seguía atendiendo—, comprobarlo igual que a una candidata, anotar la decisión, abrir, y cerrar el manifiesto como «no publicada». La base no se tocó. |

Una publicación normal que llegó a abrir tiene las dos cosas, «empezó la migración» y «se decidió
abrir»: por eso el orden importa, y por eso manda la apertura.
**Las señales son las de ESTA publicación.** «Se decidió abrir» y «abierta» cuentan si llevan su
identificador, en el manifiesto o en la base. Que el negocio esté atendiendo no es señal: entre
escribir el manifiesto y cerrar sigue abierto **por la publicación anterior**, y eso es el caso 3,
que por eso empieza cerrando y drenando. **Si la identidad no coincide o
falta evidencia, no se elige el caso más cómodo: se detiene.** Repetir `--recuperar` no revive una
publicación ya cerrada ni toca una base que ya tiene actividad nueva.

*(21 de octubre: de estas dos salidas queda solo la segunda, volver al respaldo previo; la
versión corregida se publica después, como cualquier otra. Lo de abajo sobre `--corregida` queda
como estaba diseñado, pero no se construye: ver el estado al principio.)*

Las dos salidas del caso 2, las dos deliberadas y con el candado tomado:
- **Publicar una versión corregida:** `publicar.sh --corregida`, que es la única entrada admitida
  con un manifiesto sin cerrar. El relevo tiene su frontera, en este orden, y **nunca hay un rato
  sin dueño**:
  1. Se prepara y se comprueba la candidata corregida **mientras el manifiesto pendiente sigue
     mandando**. Se comprueba contra lo que hay —una base a medio migrar—, no contra el conjunto
     anterior sano: las migraciones que sí quedaron aplicadas tienen que estar en la candidata
     con el mismo contenido (G), y las suyas van después. Una candidata que no pasa se rechaza y
     nada cambió.
  2. Se escribe, de forma durable, el manifiesto de la sucesora: **ligado a su predecesora**, con
     la misma base, la misma marca y el mismo respaldo previo, y **ya con «empezó la migración»**
     y sin apertura. Nace en el caso 2; nunca en el 3, que diría «la base no se tocó» de una base
     heredada a medias.
  3. Solo entonces la anterior se cierra como «sustituida por» la nueva.
  Si muere antes del paso 2, sigue mandando la pendiente, intacta. Si muere entre el 2 y el 3
  hay dos sin cerrar: manda la que nombra a la otra como predecesora, y lo primero que hace
  `--recuperar` es terminar de cerrar esa. Después sigue desde el paso 5 de B con la candidata
  nueva. El negocio sigue cerrado todo el rato.
- **Volver al respaldo previo** (E).

**E. Volver al respaldo previo es un camino propio, no una rama de la publicación.** Lo hace el
dueño, con su llave. Como restaurar crea otra historia, **el manifiesto viejo se cierra como
«restaurado» y no se continúa nunca**. Los pasos van en un registro propio, mínimo y durable, con
su «antes» y su «después», para que una muerte a la mitad se pueda retomar hacia adelante:
1. Candado; detener y drenar.
2. **Apartar la base fallida con otro nombre, sin borrarla.**
3. Restaurar el respaldo —el del manifiesto, por su nombre— en una base de nombre provisional,
   con la imagen **del conjunto anterior** (no la candidata con la migración rota); auditarla y
   **registrar la restauración**: marca nueva, bloque nuevo de folios, sesiones cerradas.
4. Ponerle el nombre definitivo, que es el que usa el servicio.
5. Levantar el conjunto anterior y comprobar por HTTPS **que quien contesta es esa base** (su
   marca nueva), lista y cerrada. Una comprobación contra la conexión de antes no vale.
6. Abrir, con una acción expresa.
Qué bases existen, con qué nombre y con qué marca, es la evidencia para retomar. La base fallida
se borra a mano, después, cuando ya no haga falta.

**Cuando se perdió la máquina** no hay manifiesto local, y eso no se deduce: se dice. Es otra
entrada, «instalar desde un respaldo», que parte del respaldo y de un **manifiesto mínimo que se
guarda fuera del servidor** junto a él (qué versión corría, con qué imágenes) y arma el estado
local desde cero. Las versiones anteriores al mantenimiento no sirven para esto.

**F. Qué corre lo dice un archivo con identificadores inmutables.** Imágenes por instalación y por
publicación; el proxy con su configuración dentro de su imagen; las bases, por huella. `levantar.sh`
deja de construir. Las imágenes y el manifiesto del conjunto vigente, del anterior y de una
publicación sin cerrar se conservan **también fuera del disco del servidor, y se comprueba que de
verdad están ahí** (leyéndolos de vuelta, como los respaldos), no solo que figuran. Publicar otra
vez el conjunto vigente no hace nada y lo dice. El servidor de PostgreSQL no se vuelve a
configurar por publicar; una versión mayor tiene su propio procedimiento.

**G. Las huellas de las migraciones.** El migrador guarda la huella de cada una que aplica y se
niega si una aplicada cambió o si una pendiente va antes de la última; lo vuelve a comprobar con
su candado tomado, justo antes de aplicar. Las que ya estaban aplicadas se sellan **una vez, con
los archivos de la versión vigente** —no con los de la candidata que se quiere revisar—, y queda
dicho que ese sello inicial es confianza, no verificación. (La `0022` y la `0023` se corrigieron
en su lugar antes de que existiera instalación alguna: la primera instalación de verdad nace con
el texto final, y eso es lo que se sella.) Migrar a mano pide el mismo candado de la instalación.

**H. La primera vez.** La versión que hoy corre no conoce el mantenimiento. Instalarlo es un
procedimiento aparte, con la aplicación detenida y comprobado; de ahí en adelante, ninguna versión
anterior a esa es un destino válido para volver.

**I. El ensayo de publicación**, sobre una copia con su propio repositorio de Git, proyecto,
imágenes, puertos y volúmenes. Las interrupciones se provocan de verdad, **antes y después del
efecto de cada paso** (no solo al ver escrita la marca):
- preparación que falla (construcción, entorno, red, carpeta con cambios, migración intercalada o
  modificada, commit anterior incompatible, imágenes ausentes, **lo que corre no es lo que dice
  el último manifiesto**, la configuración cambió después de preparar): nada se detuvo ni cambió;
- muerte después de escribir el manifiesto y antes de cerrar: el negocio sigue atendiendo, y
  `--recuperar` no supone que ya estaba cerrado;
- cerrar con la respuesta perdida; la aplicación detenida a medias: no se migra;
- respaldo previo que falla antes y después de su manifiesto; hecho pero sin poder anotar su
  nombre (no se migra); bueno con el vigilante caído; su nombre sigue siendo el suyo aunque
  después haya otro más nuevo;
- muerte en cada frontera, y `--recuperar` desde cada una: los tres casos de D; **el migrador
  hijo todavía vivo**; la migración que confirmó y perdió la respuesta; la que falla con un efecto
  que no se revierte (no se repite sola); `--recuperar` dos veces, y dos a la vez;
- la candidata levanta pero no pasa la comprobación; **una compra intentada en ese rato se rechaza**;
- **las tres anotaciones de abrir, una por una:** muerte después de la del manifiesto; después de
  la de la base; después de abrir con la respuesta perdida. En las tres, `--recuperar` termina
  hacia adelante. **Se abrió, se cobró algo y se muere el guion: no ofrece el respaldo**, aunque
  el manifiesto diga también «empezó la migración»;
- manifiesto ausente, dañado, o de otra base: se detiene;
- `--corregida` desde el caso 2: el negocio no abre en ningún momento, y el respaldo previo
  sigue siendo el mismo; **muerte antes y después de cada paso del relevo** (antes de escribir la
  sucesora; con las dos sin cerrar; ya cerrada la anterior); una candidata corregida que no pasa
  se rechaza sin cambiar nada; la sucesora que muere antes de migrar se recupera como caso 2, no 3;
- muerte entre escribir el manifiesto y cerrar: el negocio sigue atendiendo por la publicación
  anterior, y eso no cuenta como «abierta»: es el caso 3;
- volver al respaldo previo, con muerte **en cada uno de sus seis pasos**; con la carpeta de
  publicaciones ausente y con una de otra publicación; la base fallida sigue ahí; comparar las
  operaciones aceptadas antes de cerrar, los folios y los envíos; no reabre por recrear un
  contenedor ni por volver a darle permisos a la aplicación;
- instalar desde un respaldo, sin nada local, con el manifiesto de fuera;
- repetir la misma publicación; publicar, levantar y migrar a mano a la vez: entra uno;
- el servicio de respaldo queda repuesto al terminar bien, al recuperar y al no publicar; y lo
  que pasa si no arranca;
- una captura a medio enviar: no llegó; llegó y no se confirmó; se confirmó y se perdió la
  respuesta; reenviada después de publicar, de volver y de restaurar: un solo efecto, o el rechazo
  documentado. Tras restaurar hay que volver a entrar: no se promete que se resuelva sola.
- **No se ensaya aquí** reiniciar el motor de Docker a media publicación (es compartido en esta
  máquina): queda para el servidor, tarea 7. Lo cubre mientras tanto que el cierre vive en la base.

- [x] **La migración de mantenimiento, lo que cada ruta pregunta y la salud con sus dos
      respuestas** (6 de octubre de 2026; falta que Codex la revise).
      - `db/migraciones/0026_mantenimiento.sql`: una sola fila, `mantenimiento`, que dice si la
        operación está abierta, por qué se cerró y **de cuál publicación**. Tres funciones, solo
        de la administración: `cerrar_operacion(motivo, publicación)`, `decidir_abrir(publicación)`
        y `abrir_operacion(publicación, marca)`, que comprueba que la publicación es la que cerró,
        que ya se decidió, y que la base es la que se comprobó. Cada paso queda en la bitácora.
        **Repetir un paso con la misma publicación no cambia nada** (la respuesta perdida); una
        publicación no pisa a otra, y una que ya abrió no se vuelve a usar. Viaja en el
        respaldo: uno tomado con la operación cerrada restaura cerrado, y ahí se abre con la
        marca de la base restaurada, que es otra (`pruebas/29-mantenimiento.test.ts`, 7).
      - **Cada ruta lo pregunta en cada petición** (`src/servidor/ruta.ts`, después de comprobar
        que la base es apta): cerrada, contesta 503 `MANTENIMIENTO` antes de mirar la sesión o el
        cuerpo, y no queda nada escrito. Si no se pudo preguntar, se trata como cerrada. Siguen
        atendiendo la salud y la preferencia de contraste, que no toca la base.
      - **La salud** (`GET /api/salud`) dice dos cosas: `bien` —la aplicación está lista: eso mira
        el contenedor para darse por sano, y no cambia por cerrar— y `abierta`.
        **El detalle —versión, esquema, marca de la base— no es público:** se le da solo a quien
        presenta una credencial derivada de la clave de sesión de la instalación
        (`src/servidor/comprobador.ts`). El comprobador la tiene porque corre con el entorno
        completo. *Esto precisa el diseño, que decía «el comprobador valida… qué versión
        contesta y sobre qué base» sin decir cómo: la salud llevaba escrito desde antes que no
        cuenta la versión a cualquiera, y se respetó.*
      - **El comprobador** (`operacion/comprobar.ts https … [--abierta|--cerrada] [--version=…]
        [--base=…]`) valida que el sitio esté listo y, si se pide, lo demás. La versión sale de la
        variable `VERSION`, que todavía nadie pone: la pondrá la publicación.
      - **La pantalla.** Al cargar, dice «En mantenimiento» —no «Sin conexión»—, con su botón
        para volver a intentar; al abrir, se sigue con la misma sesión. A media tarea **no se
        quita nada de la pantalla**: un aviso arriba dice que el sistema está en mantenimiento,
        la captura queda pendiente como con cualquier respuesta que no llegó, y al abrir entra
        una sola vez (`recorrido/mantenimiento.spec.ts`, 2).
      - **El ensayo de operación** cierra y abre la operación en la base y comprueba, por HTTPS
        y a través del proxy, que el sitio lo dice, que el contenedor sigue sano y que nadie se
        reinició; y que el sitio no le dice su base a quien no tiene la clave.
      - **Lo que no se hizo aquí y sigue en la lista:** el programa con que la publicación
        cierra y abre (hoy se hace con las funciones, desde la base), y que restaurar deje dicho
        si la operación quedó cerrada. Una restauración **no cierra por sí sola**: vuelve como
        estaba en el respaldo.
      - **Verificado rompiéndolo a propósito** (6 de octubre): 15 roturas en el servidor y la
        base, y 5 en la pantalla; las 20, detectadas. De ahí salió una prueba que faltaba: si no
        se puede preguntar si la operación está abierta, se trata como cerrada.
- [x] **El migrador con huellas, orden y revisión sin aplicar** (6 de octubre de 2026; falta que
      Codex lo revise). `db/migrar.ts`, `pruebas/30-migrar-huellas.test.ts` (15).
      - De cada migración que aplica guarda **la huella de sus bytes** (SHA-256), en la misma
        transacción. Cada archivo se lee una sola vez: lo que se compara es lo que se aplica.
      - **Se niega**, sin aplicar nada ni cerrarle la puerta a la aplicación, si una aplicada
        cambió —aunque sea un comentario—, si la base tiene aplicada una que la carpeta no trae
        (es de otra versión), o si una pendiente va antes de la última aplicada. Dice todo lo
        que impide, no solo lo primero. **Lo comprueba con su candado tomado:** una prueba con
        dos migradores demuestra que lo que valía antes de esperar el turno ya no vale.
      - **Revisar sin aplicar:** `node db/migrar.ts --revisar` dice si esta versión puede migrar
        la base y qué aplicaría. No escribe nada (corre en una sesión de solo lectura), no pide
        candado, y sirve con la aplicación atendiendo: es lo que la candidata le pregunta a la
        base antes de publicarse. Sale con error si no se puede.
      - **Una base de antes de las huellas** no se migra hasta sellarla: `--sellar` anota la
        huella de lo ya aplicado, una vez, y deja dicho que es un sello (`sellada_en`) y no una
        huella guardada al aplicar: es confianza, no verificación. **Se sella con la versión que
        corre**: si la carpeta trae migraciones que la base no tiene, es una candidata y se
        rechaza. Lo que ya tiene huella no se vuelve a sellar. Sin pendientes, una base sin
        huellas no se toca, y se avisa. En desarrollo —y solo ahí— el migrador sella él mismo.
      - Una orden mal escrita (`--revizar`) no es «migrar»: se detiene antes de tocar la base.
      - *Lo que se precisó respecto al diseño:* el diseño no decía qué pasa sin pendientes y sin
        huellas; se eligió no tocar y avisar, para que volver a levantar no falle por eso, y que
        `--revisar` —el paso previo a publicar— sí lo rechace.
      - Roturas a propósito: 22 en el migrador; las 22, detectadas.
- [x] **El candado único de la instalación** (6 de octubre de 2026; falta que Codex lo revise).
      `operacion/candado.sh`, `operacion/migrar.sh`, `operacion/levantar.sh`,
      `pruebas/31-candado.test.ts` (8), y un paso nuevo en el ensayo de operación.
      - Se toma creando una carpeta, y adentro queda dicho **quién lo tiene**: qué operación,
        desde cuándo, qué proceso y cuándo empezó ese proceso. A quien no entra se le dice cuál
        operación está en curso.
      - **Un guion que muere sin soltarlo no deja la instalación trabada**, y nadie tiene que
        borrar nada a mano: el siguiente comprueba que ese proceso ya no existe —ese, no otro al
        que hoy le tocó el mismo número: se compara cuándo empezó— y lo releva. **Lo releva uno
        solo** (el que crea, dentro del candado, la marca del relevo de ese turno), y lo dice.
        *Esto precisa el diseño, que decía «como el de `levantar.sh`»: aquel pedía borrar la
        carpeta a mano, y eso no sirve para `--recuperar`, cuyo caso de uso es justo un guion
        que murió.* Que el guion haya muerto no dice nada de lo que dejó corriendo: eso lo
        averigua quien releva.
      - Un candado que no dice de quién es, o lo dice mal, no se releva: se le deja a una persona.
        Solo quien lo tiene lo suelta —aunque le hayan borrado el suyo y otro lo haya tomado—.
      - **Migrar a mano** es `sh operacion/migrar.sh`, que pide el mismo candado. Y el migrador,
        en operación, **no corre a secas**: migrar y sellar piden el turno que les pasa el guion
        que tiene el candado (`OPERACION_TURNO`); revisar no. Es una regla que evita el descuido
        —un `docker compose run migracion` suelto—, no una barrera contra quien la quiera saltar.
      - `levantar.sh` usa el mismo candado y, además, limpia también si se le interrumpe (antes,
        una señal dejaba en `/tmp` la configuración resuelta, que lleva claves).
      - Roturas a propósito: 12 en el candado y 4 en la regla del migrador; las 16, detectadas.
        **El ensayo de operación encontró un defecto que las pruebas no vieron:** en el `sh` de
        macOS, una variable pegada a una comilla «» se llevaba un byte de la comilla como parte
        del nombre, y el aviso del relevo no salía. Corregido (va entre llaves), con una prueba
        que revisa eso en todos los guiones.
- [ ] `publicar.sh` con su manifiesto, `--recuperar` y `--corregida`; `levantar.sh` sin construir.
      **Hecho el 6 y 7 de octubre de 2026, salvo `--corregida`**, que el 21 de octubre se decidió no
      hacer (ver el estado al principio). Falta que Codex revise todo esto.
      - **El manifiesto** (`operacion/publicacion.ts`, `pruebas/32-publicacion.test.ts`): se
        escribe de modo que sobreviva a un apagón (archivo aparte, sincronizado, renombrado, y
        sincronizada su carpeta); la carpeta de una publicación aparece entera —con su manifiesto
        y su configuración resuelta— o no aparece; cuatro marcas que solo avanzan —empezó la
        migración, **no se publica**, se decidió abrir, abierta—; un cierre que se escribe una
        vez; y la tabla de recuperar, que se lee en orden y se detiene si la identidad no
        coincide o falta evidencia. Un manifiesto que no se lee, no se entiende, no es el de su
        carpeta o trae marcas que se contradicen detiene todo. Tiene su línea de órdenes, para
        los guiones, que no traen con qué leer JSON. Roturas a propósito: 91; las 91, detectadas.
      - **La operación vista desde la base** (`operacion/operacion.ts`,
        `pruebas/33-operacion.test.ts`): el estado en una línea (distingue «no hay base», «de
        antes del mantenimiento» y «no contesta», que falla); cerrar, decidir y abrir;
        **drenar** (esperar a que no quede ninguna sesión de la aplicación, terminarlas pasado
        el plazo, y comprobar que no quedó ninguna; solo con la operación cerrada); y **esperar
        al migrador** de una publicación interrumpida (lo mismo, con las sesiones que tienen o
        esperan su candado). Roturas a propósito: 29; las 29, detectadas.
      - **`publicar.sh`**: la secuencia de B, lineal. Antes de cada paso que cambia algo queda
        escrito en el manifiesto. **La primera publicación va por el mismo guion** (no hay
        «levantar» que construya): no cierra ni respalda —no hay qué—, crea la base al migrar,
        anota su marca, y la cierra enseguida para que levantar cerrada, comprobar y abrir sean
        lo mismo que en todas las demás.
      - **`publicar.sh --recuperar`**: espera al migrador (su contenedor y su sesión en la base),
        lee el manifiesto y la base, y sigue la tabla de D. Caso 1: termina hacia adelante, con
        el conjunto que toque. Caso 2: se queda cerrado, sale con un código propio, y dice las
        dos salidas con el nombre exacto del respaldo previo. Caso 3: anota «no se publica»,
        cierra y drena —el negocio pudo seguir atendiendo—, levanta la versión anterior, la
        comprueba, la abre, y cierra el manifiesto como «no publicada». Pide que la carpeta esté
        en el commit de la publicación pendiente: el guion y sus herramientas son de ese commit.
      - **`levantar.sh` ya no construye**: levanta el conjunto vigente, cada servicio con la
        imagen de su manifiesto, con el `.env` como está ahora. Resuelve la configuración una
        vez, la comprueba, **la guarda como la configuración de lo publicado**, y levanta eso.
        Pide que la carpeta esté en el commit publicado y sin cambios sueltos. No abre ni
        cierra la operación, y si está cerrada lo dice.
      - **`compose.sh`** es `docker compose` sobre lo publicado, para lo de todos los días
        (registros, consola, respaldar a mano). **`docker compose` a secas ya no arranca en
        operación** —le faltan las imágenes— y dice qué usar en su lugar: antes quitaba la
        aplicación que atendía si el `.env` estaba mal; ahora no puede.
      - **Qué corre** (`corre`): de cada servicio, un contenedor y solo uno, andando y sano, con
        la imagen del manifiesto y con la huella de configuración que Compose le puso al
        crearlo, igual a la de la configuración guardada. Se comprueba al preparar (contra lo
        vigente), después de levantar cerrada, justo antes de abrir, y al terminar.
      - **El servicio de respaldo, al detenerse, termina el respaldo que tenga a medias**
        (`operacion/respaldar.ts`; antes se le cortaba a los diez segundos). `respaldar ahora`
        dice, en un renglón aparte, si el vigilante se enteró; publicar lo anota aparte del nombre.
      - **Precisiones al diseño, para que Codex las revise:**
        1. *La marca «no se publica»* es nueva. Sin ella, una recuperación del caso 3 que muere
           después de anotar la decisión de abrir se leería como caso 1 «hacia adelante» sin
           saber hacia cuál conjunto.
        2. *Qué conjunto está vigente no se anota aparte: lo dice el último manifiesto cerrado.*
           Cerrar —una sola escritura— es lo que cambia la respuesta.
        3. *Publicar otra vez lo mismo se decide por el commit, no por las imágenes.* Reconstruir
           el mismo commit da imágenes con otro identificador (comprobado en esta máquina, con y
           sin atestaciones), así que comparar identificadores nunca diría «es lo mismo». Si el
           commit ya está publicado y el entorno cambió, publicar no hace nada y manda a levantar.
        4. *La base de datos no se construye:* es la imagen oficial, por su huella
           (`docker/db.Dockerfile` dice cuál, y una prueba exige que sea la misma en desarrollo y
           en las pruebas). Su identificador es estable, y **publicar se niega si una versión
           quiere cambiar el servidor de la base**.
        5. *El intento de escritura de la comprobación va sin sesión.* El diseño decía «con
           sesión y cuerpo válidos». La puerta del mantenimiento contesta antes de mirar quién
           pide (lo prueba la batería con una sesión de verdad, `17-rutas`), y el guion no tiene
           con qué acreditarse como una persona sin fabricar una sesión; no se le dio esa
           capacidad. Lo que comprueba es que el sitio conteste exactamente 503 `MANTENIMIENTO`
           a una escritura bien formada desde su origen.
        6. *Las herramientas de los guiones son una imagen por commit*
           (`feruga-herramientas:<commit>`): las que leen y anotan la carpeta de publicaciones
           corren sin red y sin el entorno; las que hablan con la base o el sitio corren como el
           servicio de comprobación del conjunto candidato.
        7. *Mientras se publica, entre cerrar y levantar la versión nueva, la aplicación está
           detenida:* quien esté en una pantalla ve «Sin conexión», no «En mantenimiento» (esa
           la ve solo en el tramo en que la versión nueva ya está arriba y cerrada). Es lo que
           dice el diseño —se detiene la aplicación para drenar y migrar—; queda anotado por si
           conviene que el proxy conteste «en mantenimiento» en ese tramo.
      - **Lo que el ensayo encontró y las pruebas no:** con los archivos del proyecto creados
        solo para su dueño (un servidor con `umask 077`, o la copia del ensayo), las imágenes
        salían con archivos que el usuario del contenedor no podía leer, y nada arrancaba. Las
        imágenes ahora ponen sus permisos al construirse.
- [x] **Volver al respaldo previo, con su registro de pasos; instalar desde un respaldo, con el
      manifiesto mínimo de fuera del servidor** (7 de octubre de 2026; falta que Codex lo revise).
      - **Volver al respaldo previo** (`operacion/volver.sh`): lo hace el dueño, con su llave.
        Detiene y drena; **aparta la base que falló con otro nombre, sin borrarla**
        (`operacion/volver.ts`); restaura el respaldo de esa publicación —ese, por su nombre— con
        el programa de la versión **anterior** (`restaurar.ts`, que audita, registra la
        restauración y solo entonces le da a la base su nombre); levanta la versión anterior y
        comprueba por HTTPS que quien contesta es la base restaurada —su marca nueva—, lista y
        **cerrada**; y cierra el manifiesto como «restaurada». **Abrir es `--abrir`, aparte y
        expreso**, y solo abre lo que dejó cerrado una vuelta al respaldo. Cada paso queda
        anotado, antes y después, en `publicaciones/<publicación>/vuelta.json`. Si muere a la
        mitad se vuelve a correr y sigue desde donde quedó: lo dice el servidor —qué bases hay,
        con qué nombre y con qué marca—. Roturas a propósito: 19; las 19, detectadas.
      - **Lo que corre se conserva también fuera del servidor** (`operacion/fuera.ts`,
        `pruebas/35-fuera.test.ts`): al preparar —antes de tocar nada—, publicar guarda las
        imágenes de la versión (`docker save`, unos 490 MB) y un manifiesto mínimo que dice cuáles
        son, en el almacenamiento de los respaldos, bajo `publicaciones/<publicación>/`. Las lee
        de vuelta y las compara; el manifiesto va al final; **si no quedaron ahí, no se publica**.
        No lleva claves: la configuración resuelta se queda en el servidor. Roturas a propósito:
        20; las 20, detectadas.
      - **Cada respaldo dice qué publicación corría cuando se tomó** (su manifiesto; la toma del
        entorno, `VERSION`). Con eso se sabe con qué imágenes se restaura. Roturas: 14, detectadas.
      - **Instalar desde un respaldo** (`sh operacion/publicar.sh --desde-respaldo[=<respaldo>] <
        llave`): para una máquina donde no hay nada. Averigua qué publicación tomó el respaldo,
        baja sus imágenes —comprobadas— y las carga; no construye nada. Quita la base vacía con
        que nace el servidor —solo si de verdad está vacía—, restaura, deja la operación cerrada
        por esta publicación, y de ahí sigue como cualquier otra: levantar cerrada, comprobar,
        abrir. Es otra instalación: lleva otro identificador de publicación, y sus imágenes
        —las mismas— quedan guardadas fuera también con ese nombre. Pide que la carpeta esté en
        el commit de aquella publicación. Si muere a la mitad se vuelve a correr.
      - **Restaurar dice en qué quedó la operación**: abierta, o CERRADA y por cuál publicación.
      - *Precisiones al diseño:* (1) después de volver al respaldo **no se abre solo**: el
        diseño ponía «abrir» como el paso 6; aquí es una orden aparte, para que quien vuelve vea
        antes qué quedó. (2) Qué versión corría no va en un manifiesto aparte junto al respaldo:
        **lo dice el manifiesto de cada respaldo**, y las imágenes están bajo ese nombre. (3) Al
        instalar desde un respaldo que se tomó con la operación cerrada por otra publicación, ese
        cierre se termina —con la aplicación sin levantar— y se cierra por la nueva: así el resto
        es una publicación como cualquiera. (4) El «después» de publicar no se guarda fuera: lo
        que se guarda es la imagen de cada versión, antes de tocar nada, y eso cubre «el conjunto
        vigente, el anterior y una publicación sin cerrar» mientras el almacenamiento los retenga.
- [x] ~~La primera instalación del mantenimiento.~~ **No se hace: lo decidió el usuario el 7 de
      octubre de 2026.** No existe ninguna instalación de antes del mantenimiento —la primera de
      verdad nacerá con `publicar.sh`—, y la de desarrollo es desechable. Publicar se niega ante
      una base con historia y sin publicaciones, y dice por qué. (Queda para que Codex lo sepa al
      revisar: la parte H del diseño no se construyó, a propósito.)
- [ ] Imágenes por instalación y publicación, proxy con su configuración dentro, bases por huella.
      **Hecho el 7 de octubre, salvo conservarlas fuera del servidor.** Cada publicación
      construye sus imágenes y las etiqueta `<proyecto>-<pieza>:<publicación>` (la etiqueta solo
      las conserva: lo que corre se nombra por el identificador). `docker-compose.operacion.yml`
      exige cada imagen por variable, sin construir y sin traer nada de fuera
      (`pull_policy: never`); el proxy lleva su configuración en su imagen
      (`docker/proxy.Dockerfile`); las imágenes de las que se parte van por su huella. Una
      prueba fija esas reglas (`pruebas/20-entorno.test.ts`; 10 roturas a propósito, detectadas).
- [ ] El ensayo de publicación, con los casos de arriba.
      **Hecho en su mayor parte el 7 de octubre** (`sh operacion/ensayo-publicacion.sh`; pasa
      entero, 17 minutos; falta que Codex lo revise). Arma una instalación aparte —una copia del
      proyecto con su propio repositorio, proyecto de Compose, imágenes, puertos y volúmenes—, y
      **mata el guion de verdad**, sin que limpie. Lo que ensaya:
      - el camino entero de una versión con una migración, y cómo se ve a la mitad (cerrada, con
        la versión nueva arriba, el respaldo anotado por su nombre, y nada más puede entrar);
      - **preparar que falla**: cambios sin commit, entorno mal puesto, lo que corre no es lo que
        dejó la última publicación, una migración aplicada que cambió, una intercalada, y otra
        imagen de base de datos: en todos, nada se detuvo ni cambió;
      - **muerte antes de migrar** (después del manifiesto y antes de cerrar —el negocio sigue
        atendiendo por la publicación anterior—; después de cerrar; de drenar; del respaldo sin
        anotar; del respaldo anotado): recuperar restablece la versión anterior, y la base no cambia;
      - **recuperar que también muere** (al desistir; con la decisión ya anotada), dos veces, y
        dos recuperaciones a la vez;
      - **muerte ya decidido abrir**, en cada una de las tres anotaciones y después: recuperar
        termina hacia adelante y nunca ofrece el respaldo;
      - el manifiesto dañado, ausente, o de otra base: todo se detiene;
      - **el guion muere a media migración y el migrador sigue corriendo**: recuperar lo espera,
        lo detiene, termina su sesión en la base, y solo entonces decide;
      - **empezó la migración y no se decidió abrir**: se queda cerrado, dos veces, sin levantar
        nada; el respaldo previo sigue siendo el suyo aunque haya otro más nuevo;
      - **volver al respaldo previo**: sin llave, con otra llave (la base que falló queda
        apartada, no se pierde), con muerte recién restaurada la base; cerrado hasta `--abrir`;
        y sobre la base restaurada se publica otra vez;
      - **se perdió la máquina**: sin base, sin imágenes y sin carpeta de publicaciones, se
        instala desde un respaldo con las imágenes guardadas fuera, con muerte a la mitad; lo
        asentado está idéntico, y de ahí se sigue levantando y publicando.
      En cada caso se compara lo que el negocio llevaba asentado antes y después.
      **Lo que del diseño todavía no se ensaya** (queda dicho, no se da por hecho):
      - una compra intentada **con una sesión de verdad, desde un navegador**, mientras está
        cerrado (se ensaya el rechazo sin sesión; con sesión lo prueba la batería);
      - **una captura a medio enviar**, reenviada después de publicar, de volver y de restaurar;
      - el respaldo previo que falla antes y después de su manifiesto, y con el vigilante caído;
      - la migración que confirmó y perdió la respuesta, y la que falla con un efecto que no se
        revierte; la candidata que levanta y no pasa la comprobación;
      - el servicio de respaldo que no arranca al terminar;
      - muerte en **cada** paso de volver al respaldo (se ensaya una);
      - publicar, levantar y migrar a mano a la vez (en el ensayo de operación se ensayan
        levantar y migrar a mano; aquí, dos recuperaciones);
      - `--corregida`, entera.
      **Lo que encontraron los ensayos y no las pruebas** (todo corregido): los permisos de los
      archivos al construir las imágenes en un servidor con `umask 077`; el `sh` de macOS con
      una variable pegada a una comilla «»; `\|` en un patrón, que solo entienden las
      herramientas de GNU; que reconstruir un commit da imágenes con otro identificador; y que
      en una máquina nueva la base ya existe, vacía, y restaurar no restaura encima de una base.
- [ ] Revisión de Codex a la tarea, con ejecución.
      *Pendiente: Codex no tiene cuota hasta el 9 de octubre de 2026, 10:09 PM.* Lo que tiene que
      revisar de esta tarea, en este orden: las precisiones al diseño (listadas arriba, en
      `publicar.sh` y en «volver al respaldo previo»), la tabla de recuperar y sus marcas, el
      candado y su relevo, y lo que el ensayo de publicación todavía no cubre.

**Verificado el 7 de octubre de 2026, con todo lo de arriba:** 808 pruebas y 0 errores de tipos;
154 recorridos en Chromium y 149 en WebKit; el ensayo de operación (6 recorridos por HTTPS) y el
ensayo de publicación (17 minutos), los dos en verde. Roturas a propósito en lo construido para
esta tarea: 247, todas detectadas (mantenimiento 20, migrador 26, candado 12, manifiesto 91,
operación 29, registro de la vuelta y apartar 19, reglas del Compose 10, lo guardado fuera 20,
qué publicación corría y lo que dice restaurar 14, quitar la base vacía 6). Los guiones no tienen
roturas a propósito: los prueban los dos ensayos.

### Tarea 6 · Guía de operación y guion del servidor
Archivos: `docs/operacion.md`, `operacion/servidor.sh`.

- [x] La guía (`docs/operacion.md`, 13 de octubre): escrita con lo que hay en el repositorio y
      probado en los simulacros; lo que solo se puede comprobar en el servidor de verdad está
      marcado ahí como pendiente, y la preparación del servidor espera a su guion. Lo que pedía:
      preparar el servidor; el paquete de recuperación (qué lleva, quién lo guarda, cuándo
      se actualiza); primer día; publicar; restaurar en un servidor nuevo y conciliar lo perdido;
      el ensayo periódico; rotar cada clave (distinguiendo cambiar el archivo de cambiar la clave
      de una base que ya existe); qué hacer si no se emite el certificado, si se pierde la llave
      privada, si se llena el disco, si llega un aviso.
- [ ] El guion del servidor: `shellcheck`, y dos corridas en un contenedor de Ubuntu sin cambios
      en la segunda.

**Revisión de Codex al bloque completo**, con ejecución, antes de la tarea 7.

### Tarea 7 · En el servidor real (condición para operar con datos de verdad)

- [ ] Preparar el servidor y levantar con el dominio verdadero. Desde otra máquina, por IPv4 e
      IPv6: solo contestan 22, 80 y 443.
- [ ] Permisos reales del almacenamiento contratado: los mismos casos de la tarea 3.
- [ ] **A9:** desde otra máquina, con la credencial de recuperación y la llave del dueño: bajar el
      último respaldo, restaurarlo siguiendo solo la guía, y reconstruir un día sin reutilizar
      folios. Medir cuánto tardó: ese es el tiempo de recuperación real.
- [ ] Apagar la aplicación y ver que llega el aviso; impedir un respaldo y ver que llega el otro.
- [x] **Autenticar el respaldo antes de restaurarlo** — hecho el 13 de octubre, como estaba
      pensado; falta repetirlo contra el almacenamiento contratado y que Codex lo revise. Lo que
      había (lo dejó abierto Codex al verificar su
      décima revisión): un respaldo y su manifiesto se creían si coincidían entre sí; quien
      pudiera escribir en el depósito podría sustituir los dos. La corrección pensada: un sello
      (HMAC) del manifiesto con una clave derivada de la llave privada de age —el servidor guarda
      solo el sello; quien restaura lo deriva de la llave que ya tiene—, comprobado antes de
      descifrar. Toca respaldar, restaurar, el diario, la instalación y la guía.
- [ ] **Una pasada de Codex sobre lo pendiente**, una sola: del respaldo diario, restaurar del
      diario, las precisiones del diseño y el veredicto (nunca los revisó); y la verificación de
      lo corregido el 9 de octubre (guiones, diario y rediseño).
- [ ] Anotar en la guía lo que no salió como estaba escrito.

## Fuera, para después

Operación sin conexión, lectura de básculas, caja y crédito. Alta disponibilidad. Respaldo
continuo del registro de la base (recuperación al minuto): se considera solo si una hora de
pérdida resulta demasiado. La evidencia de cámaras y el diario del agente entrarán al respaldo
cuando existan: este despliegue no cubre esos dos elementos de 12.1.

## Riesgos que conviene tener presentes

- **Mientras no exista el modo sin conexión, sin internet en el patio no se opera.**
- **La aplicación queda en internet.** La protegen el alta de equipo, la clave por persona con
  bloqueo, y que nada se alcanza sin equipo dado de alta.
- **El cifrado protege los respaldos, no la base viva.** Quien entre al servidor puede leerla.
- **Perder la llave privada es perder los respaldos.** Dos custodios, y el ensayo periódico.
- **Tras una restauración, lo dado de baja después del respaldo reaparece.** Personas, equipos y
  cancelaciones posteriores al respaldo no están en él. La guía pide revisarlos antes de reabrir.

## Lo que contestó el usuario (4 de octubre de 2026)

Las diez preguntas de este plan, con su respuesta. Lo que estaba supuesto y quedó confirmado deja
de ser supuesto.

1. **Cuánto se puede perder y en cuánto volver.** Como se propuso: respaldo cada hora de 07:00 a
   20:00 (se pierde a lo más una hora) y cuatro horas para volver a operar. **Confirmado.**
2. **Copia de cada comprobante.** El negocio no la tenía. **Decidido: el comprobante sale por
   duplicado** y el negocio se queda con una copia (`docs/planes/2026-10-04-comprobante-por-duplicado.md`).
3. **Dónde van los respaldos: Backblaze B2. Decidido.** Es lo que se construyó y probó, sin
   cambios: versiones y candado por objeto. (Se descartó Cloudflare R2: no tiene versiones ni
   candado por objeto, solo reglas por carpeta; habría pedido adaptar y volver a probar.)
   **Cuánto se conservan. Decidido:** los de cada hora, **30 días**; y además **uno por día,
   un año** (tarea 3b). El usuario pidió menos de 90 días para los de cada hora y un año
   para el diario. Por qué 30 y no menos: el costo casi no cambia —con B2 a unos 7 dólares por
   mil GB al mes y los primeros 10 GB gratis, guardar 30 días de respaldos de cada hora más un
   año de diarios son 785 copias de la base; con una base de 100 MB, unos 50 centavos de dólar
   al mes (estimado: hoy un respaldo pesa 0.25 MB, con la base vacía)—, y un mes alcanza para
   que un problema que se descubre en un cierre o en un conteo todavía se pueda rastrear a la
   hora en que pasó. **Lo que hay que saber del candado de un año:** un diario no se puede borrar
   antes, ni queriendo; dejar ese proveedor pide esperar a que venzan o cerrar la cuenta.
4. **La llave de los respaldos.** La guardan **el dueño y el usuario**, que da el soporte técnico.
5. **El servidor.** Probablemente **Hostinger**, aún sin contratar.
6. **El dominio.** Hay que comprarlo.
7. **Abierto a internet**, lo más seguro que se pueda. Lo que ya hay: solo HTTPS, solo equipos
   dados de alta con código, clave con bloqueo por intentos, sesiones que vencen, y la base sin
   salida a internet. Lo que se agrega en el servidor (tareas 6 y 7): cortafuegos con solo los
   puertos 80 y 443, entrada de administración solo con llave, actualizaciones de seguridad
   automáticas, y —recomendado— Cloudflare delante, que esconde la dirección del servidor y frena
   abusos. Opcional: una segunda puerta (Cloudflare Access) para quien entra desde fuera del patio.
8. **A quién avisar.** Al usuario, **por correo y por Telegram** (los dos sin costo en el
   vigilante previsto, Healthchecks; WhatsApp cuesta 20 dólares al mes y se descartó), en cuanto
   falle algo, a cualquier hora. Se vigila: que cada respaldo se tome, que el diario se guarde,
   que el ensayo de restauración pase, y **que el sistema conteste** (un latido desde el servidor
   que comprueba la salud por HTTPS y avisa; si el servidor se muere, el latido deja de llegar).
   El latido se diseña en la tarea 6.
9. **Cuándo se puede detener.** Fuera del horario de atención: lo que pide a una persona, por la
   noche o justo antes de abrir; lo automático, de madrugada.
10. **El repositorio.** **Después de que terminen las revisiones pendientes de Codex**: primer
    commit, repositorio nuevo y privado en GitHub, y subir **la carpeta entera** (anteproyecto,
    campo, prototipos, documentos y sistema), **sin el audio, el video ni la imagen**. Hoy el
    repositorio de Git está dentro de `sistema/` y no tiene ningún commit: se mueve a la raíz.

**Otra respuesta del mismo día:** una mezcla de materiales **se separa y cada material se compra
por su cuenta**. No hace falta un material «mezcla»: una cuenta ya admite varios renglones.

**Sigue pendiente:** las placas de las básculas, y validar con el personal las pantallas de
inventario.
