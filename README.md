# Sistema de la recicladora

El mostrador de una recicladora: precios del día, cuentas de compra y de venta por kilo, pesos,
comprobantes, cierre de jornada, y el inventario del patio con sus conteos y correcciones. Dos piezas:

- **El núcleo**, en la base de datos: las reglas que no se pueden romper, escritas en SQL y
  probadas una por una.
- **La aplicación**, una página web para el equipo del mostrador: acredita a quien atiende y llama
  al núcleo. No repite ninguna regla.

## Requisitos

**Solo Docker.** No hace falta instalar Postgres ni Node, y nada depende de la computadora donde se
desarrolló: base, aplicación, consola y pruebas corren en contenedores con versión fijada.

## Ponerlo a andar en una máquina nueva

```bash
cp .env.desarrollo .env                    # los valores de desarrollo; sin .env nada arranca
docker compose up -d --wait                # base, migraciones y aplicación
docker compose run --rm consola arranque   # el primer responsable y un código para el primer equipo
```

El arranque escribe en la terminal, **una sola vez**, la clave del responsable y el código del equipo.
Abre <http://localhost:3210>, teclea el código, elige tu nombre y entra con la clave.

Correr el arranque otra vez no hace daño: lo que ya está no lo toca.

La aplicación se publica **solo en la propia máquina**. Abrirla a la red del patio pide un
certificado, y eso llega con el plan de despliegue.

## La consola de administración

Lo que toca a un **responsable** o a **quien administra** —darlos de alta o de baja, cambiarles la
clave, conceder la facultad de autorizar— no se hace desde la pantalla: se hace aquí, con otras
credenciales. La aplicación no puede hacerlo ni aunque quiera, y así quien se meta a ella no se
fabrica un jefe.

Desde el 12 de octubre de 2026, por decisión del dueño, lo de todos los días sí se puede desde la
pantalla (Panel → Ajustes): dar de alta, dar de baja y cambiarle la clave a personas de mostrador,
de patio y de consulta, y dar de alta y de baja equipos. Lo pide un responsable facultado para
autorizar, con su clave en ese momento (migración 0031). Desde el 13 de octubre, cualquier
responsable da de alta, da de baja y reactiva ahí mismo a los clientes con precio especial
(migraciones 0033 y 0034), y les cambia el nombre (0036). La consola sigue sirviendo para todo.

```bash
docker compose run --rm consola persona alta "Luis" mostrador          # genera la clave y la muestra
docker compose run --rm consola persona alta "Ana" responsable --autoriza
docker compose run --rm consola persona clave "Luis"                   # clave nueva; también desbloquea
docker compose run --rm consola persona baja "Luis"
docker compose run --rm consola persona lista
docker compose run --rm consola equipo codigo "Tableta del patio"      # código de 15 minutos, un uso
docker compose run --rm consola equipo lista
docker compose run --rm consola equipo baja <id>
```

Los roles: `responsable` (precios, arranque, autoriza, ve el panel), `mostrador` (atiende, cobra,
cierra), `patio` (arma cuentas y pesa, no cobra), `consulta` (solo ve, también el panel),
`administracion` (solo ve; su trabajo es esta consola). La clave es de 4 a 8 dígitos; de 6 o más
para responsables y administración.

### Una demostración con historia

Una base recién puesta no tiene qué enseñar: el panel, los días y la bitácora salen vacíos. Para
verlos con algo, la consola le da a una base **de desarrollo** ocho semanas de historia inventada
—días abiertos y cerrados, precios que se mueven, compras y ventas, el cajón contado cada mañana y
su corte cada noche, ventas fiadas y sus abonos, y gastos—, hecha con las funciones de verdad del
sistema, y deja hoy abierto y con precios:

```bash
docker compose run --rm consola demo sembrar >> demo-local.log    # las claves de las personas nuevas quedan en ese archivo
docker compose run --rm consola demo sembrar --dias=20 --semilla=7
```

Son datos para demostrar, no del negocio: los precios que pone no son los del patio. Se niega a
correr fuera de desarrollo (`MODO=desarrollo`) y sobre una base que ya tiene cuentas terminadas. No
borra nada: usa a las personas que haya y agrega las que falten. Si se interrumpe a la mitad, no se
retoma: la base queda con lo que alcanzó a sembrar y hay que empezar con otra. Para volver a una
demostración vacía se borra la base (`docker compose down --volumes`) y se pone a andar otra vez.

## Correr las pruebas

```bash
docker compose run --rm pruebas                           # tipos y las 1067 pruebas del núcleo, del servidor y de la operación
docker compose --profile recorrido build                  # después de cambiar código o migraciones
docker compose --profile recorrido run --rm recorrido     # 226 recorridos en un navegador real (Chromium)
docker compose --profile webkit run --rm recorrido_webkit # los mismos, otra vez, en WebKit (el motor de iOS): 219
```

Los de WebKit corren contra la misma aplicación de los recorridos, pero detrás de un proxy con
HTTPS de verdad y su propia autoridad, en la que el navegador confía: los candados entre pestañas
piden un origen seguro, y WebKit no admite la bandera con que a Chromium se le dice que trate como
seguro uno sin cifrar. Corren todos menos el del papel, que cuenta las hojas de un PDF y eso solo
lo produce Chromium, y uno de la barra que simula un equipo que pide menos transparencia, cosa
que solo Chromium deja simular. Un navegador de pruebas se parece a Safari, pero no es el teléfono: lo que
solo se ve en el equipo se prueba en el equipo.

El comprobante impreso tiene su propia guardia, `recorrido/papel.spec.ts`: compara cada renglón
—su lugar, su letra, su tinta, qué tan tenue llega y si de verdad sale—, la línea de corte y lo
demás de la página que también saldría (nada) contra un retrato guardado (`recorrido/papel/`),
tomado del sistema de antes del rediseño. Si el papel cambió a
propósito, el retrato se vuelve a tomar con `-e PAPEL=guardar`; si no, algo lo movió.

La primera levanta la base, un segundo servidor vacío para probar la restauración y un
almacenamiento compatible con S3 (MinIO, en memoria) para probar los respaldos. La última
levanta la aplicación completa con su propia base y la recorre como la usará el mostrador: un día
entero, hasta diez cuentas a la vez, el vehículo que vuelve otro día, dos pestañas, la sesión que vence, el
inventario; y lo que pasa a medio camino, con respuestas que se demoran o se pierden a propósito,
servidores que fallan después de guardar y páginas que se recargan con un envío en el aire.

Los recorridos tratan su origen como seguro, igual que estará en operación por HTTPS: sin eso el
navegador no da candados entre pestañas y se probaría el camino de respaldo. Por eso usan el
Chromium completo (`playwright.config.ts`).

Los recorridos comparten una base: **se corre una batería a la vez**. Y usan sus propias imágenes:
si cambió el código o una migración y no se reconstruyen, se prueba la versión anterior.

Para ver las pantallas sin levantar nada:

```bash
docker compose --profile recorrido run --rm -e CAPTURAS=1 recorrido npx playwright test capturas
# deja las imágenes en recorrido/capturas/; las del rediseño, pantalla por pantalla en claro, oscuro y
# más contraste, ancha y angosta, en recorrido/capturas/rediseno/
```

### Cómo se ve: los valores, las piezas y el contraste

Los estilos viven en `src/estilo/`: `valores.css` (colores, medidas y tiempos, con nombres del
negocio; es la única hoja que nombra los del paquete `@ios27_design_system/tokens`), `base.css`
(lo que vale para toda pantalla), `piezas.css` (botón, interruptor, hoja; sus componentes están en
`src/componentes/base/`), `sesion.css` (la entrada y la barra), `pantallas.css` (lo que comparten
las pantallas de adentro: mostrador, inventario, precios, cierre y arranque) y, aparte de todo,
`comprobante.css`.

Que un texto se lea no se deja a ojo: `pruebas/27-estilo.test.ts` calcula el contraste de cada
par de colores en claro, en oscuro y con «más contraste». Y las medidas de patio —60 px lo que se
toca, 8 px de separación (también en diagonal), texto de 17 para arriba y rótulos de 15, sin
desplazamiento de lado— las mide `loQueNoMide` (`recorrido/apoyo.ts`) en el navegador: en la
entrada, la barra y cada paso del mostrador (`recorrido/mostrador-medidas.spec.ts`).

**«Más contraste», para el sol,** se recuerda por equipo en una galleta propia (`contraste`), que
pone `POST /api/equipo/contraste` sin pedir sesión y sin tocar la base: sirve en la pantalla de
entrada, con la base caída y en mantenimiento. Dura lo que el navegador deje —alrededor de un
año—: si en ese tiempo nadie toca el interruptor en ese equipo, caduca y vuelve a seguir lo que
el equipo pida. Borrar los datos del navegador también la pierde.

| Comando | Qué hace |
|---|---|
| `docker compose up -d --wait` | Levanta base y aplicación |
| `docker compose down` | Las detiene, conservando los datos |
| `docker compose down --volumes` | Las detiene y **borra los datos** |
| `docker compose up -d --build` | Reconstruye la aplicación después de cambiar el código |

La configuración entra por variables de entorno. `.env.desarrollo` trae las de desarrollo y lo
dice (`MODO=desarrollo`); fuera de desarrollo, el migrador, la consola y la aplicación se niegan a
arrancar con esas claves, con la cookie sin `Secure` o con un origen que no sea HTTPS
(`src/servidor/entorno.ts`). El entorno de operación lo genera `sh operacion/entorno.sh <dominio>`.

**Para aplicar una migración nueva hay que detener antes la aplicación** (`docker compose stop web`
y luego `docker compose up -d --build --wait`): el migrador no migra con la aplicación conectada.

## El mostrador

Cada cuenta abierta está siempre a la vista, con su nombre: «Compra 3» al abrirla, y el que se le
ponga —«Don Chuy», «camioneta roja»— con «Cambiar nombre». El nombre es del mostrador: el ticket no
lo lleva. Dentro de una cuenta van tres pasos, una decisión por pantalla: el material, la báscula y
lo que marca —y en la báscula chica, si viene en costal o carretilla, lo que pesa vacío—, y la
cuenta, donde se paga o se cobra y se imprime el ticket. Al pagar o cobrar se dice si fue en
efectivo o por transferencia; una venta a un cliente conocido también se puede **fiar**, con la
clave de un responsable y la fecha en que debe pagar.

## El cajón

Antes de atender, quien abre **cuenta el cajón**; la pantalla propone lo que se dejó en el último
corte, y si no coincide le llega un aviso al responsable. Durante el día se **saca o se mete
dinero** con la clave de un responsable, y en el cierre se ve cuánto debería haber: lo de la mañana,
más lo cobrado y menos lo pagado en efectivo, lo sacado y metido, los abonos de lo fiado en efectivo
y las correcciones liquidadas en efectivo. **Cerrar el día es hacer el corte**: se cuenta, se dice
cuánto se queda para mañana y lo firma con su clave un responsable, o alguien de mostrador a quien
el responsable le dio permiso de corte. Si no cuadró, el aviso sale dentro del sistema (con el
servidor, también por Telegram y correo). En el cierre también se **registran los abonos** de lo
fiado y se **corrige una cuenta ya cobrada**: los kilos o el material que de verdad eran, con la
clave de un responsable; el comprobante original no se toca, y se liquida solo la diferencia. El
plan y sus decisiones: `docs/planes/2026-10-15-caja-y-ganancia.md`.

## Cómo está armado

```
db/migraciones/   el esquema y las reglas, en SQL plano, un archivo por tema
db/               migrador, plantilla de pruebas y el usuario con que la aplicación se conecta
consola/          la administración: arranque, personas, equipos
src/servidor/     conexión, sesión, la puerta de cada ruta y una función por acción (dominio/)
src/app/api/      las rutas: acreditan, comprueban la forma y llaman al dominio
src/app/          las pantallas: mostrador, inventario, precios, cierre, arranque
src/componentes/  lo que las pantallas comparten
operacion/        lo del servidor: publicar, levantar, respaldar, restaurar, comprobar, y sus ensayos
pruebas/          una batería por tema; cada prueba corre en su propia base
recorrido/        la aplicación entera, en un navegador
docs/planes/      los planes de implementación y sus decisiones
docs/revisiones/  las revisiones de Codex y la respuesta a cada hallazgo
```

### El panel de quien dirige

Lo ven el responsable y quien consulta, en `/panel`. Tiene diez partes, y una más para el responsable:

- el **resumen**: compras, ventas y cuentas de los últimos 7 días, 30 días o 3 meses —o de tal día
  a tal día, hasta un año—, con sus gráficas, la cuenta promedio, lo que más se movió, lo que hay
  en el patio, a qué hora y qué día de la semana se atiende más, lo que hizo cada persona y lo que
  conviene vigilar (bajas, ajustes, precios especiales, kilos descontados, recipientes, días reabiertos);
- los **días**: cada día que ha habido, con el reporte de su cierre y sus cuentas, cada una con su
  comprobante;
- los **materiales**: cuánto hay de cada uno, cuánto lleva sin salir y para cuántos días alcanza
  —lo que lleva treinta días o más sin salir va aparte: se está quedando—; y la ficha de cada
  material: a cuánto se pagó y se cobró el kilo, lo que entró y salió, su precio junto a sus
  kilos, lo que ha habido en el patio y lo que se le perdió;
- la **ganancia**: lo vendido, lo que costó a costo promedio, el margen, lo perdido en bajas y
  conteos, los gastos y lo que queda; por día, semana o mes, por material, y el patio valuado a lo
  que costó junto a lo que valdría a precio de lista;
- lo **fiado**: quién debe cuánto, lo vencido, y cuándo fue la última venta y el último abono;
- los **gastos**: los del periodo y por tipo. El responsable los registra —de otro lado, con su
  fecha, o del cajón de hoy, que cuenta en el corte—, clasifica lo que se sacó del cajón, anula uno
  (queda quién y por qué) y escoge qué tipos se restan en la ganancia;
- los **precios**: cómo se ha movido el precio de compra y de venta de cada material en 30 días,
  3 meses o 1 año, con su gráfica y sus cambios uno por uno;
- los **clientes**: a quién se le da precio especial, cuánto se le ha comprado y vendido en esas
  cuentas, y cuánto movieron sus precios respecto de la lista;
- la **bitácora**: quién hizo qué y cuándo, en palabras llanas;
- los **reportes**: bajar los días, las cuentas, los materiales de cada cuenta o los precios de un
  periodo como archivo para Excel (CSV). Además, el resumen, cada día, los precios y la ficha de un
  cliente se imprimen desde su pantalla, en una hoja normal.
- los **ajustes** (solo responsables): dar de alta y de baja **personas** de mostrador, de patio y
  de consulta y cambiarles la clave, y dar de alta y de baja **equipos** —esto, el responsable
  facultado para autorizar y con su clave cada vez—; dar de alta, dar de baja, reactivar y marcar
  como frecuentes los **materiales**; y dar de alta, dar de baja y reactivar a los **clientes** a
  los que se les da precio especial (también siguen naciendo en el mostrador, al darles el
  primero), y cambiarles el nombre; y darle o quitarle a alguien de mostrador el **permiso de
  corte**. Los responsables, quien administra y la facultad de autorizar siguen siendo de la
  consola, y a un material no se le cambia el nombre.

El panel no lleva cuentas propias: todo sale de los comprobantes y del libro de inventario, con la
regla del cierre —una cuenta es del día en que se asentó—, así que cada día del panel dice lo mismo
que su cierre (`pruebas/37-panel.test.ts` lo exige). No hay tabla de resumen: son consultas sobre
lo que ya se guarda. «Ventas menos compras» no es la ganancia, y el resumen lo dice: la ganancia
está en su parte, y sale de lo que costó cada movimiento, que la base pone al asentarlo (costo
promedio por material, migración 0039). Las gráficas se dibujan
a mano (cajas con CSS y un SVG para los precios), sin biblioteca. Un «cliente» es alguien con precio
especial: las demás cuentas no quedan a nombre de nadie. El detalle está en
`docs/planes/2026-10-11-lado-administrativo.md`.

## Las reglas que sostiene la base

- **La existencia no se guarda: se calcula.** Es la suma del libro de inventario (vista `existencia`).
  No hay columna que alguien pueda sobrescribir.
- **Lo confirmado no se edita ni se borra.** Se corrige con otro movimiento que referencia al original.
- **El peso de un renglón sale de una pesada** y el **precio sale de la lista publicada** del día. Quien
  captura no escribe ninguno de los dos.
- **Peso recibido** (bruto menos tara) entra al inventario; **peso liquidable** (recibido menos
  descuento) es lo que se paga. La tara es el vehículo vacío en la báscula grande, que se pesa, y
  en la chica lo que pesa vacío el recipiente —costal, carretilla—, que se teclea al pesar o desde la
  cuenta mientras no se cobre (`docs/planes/2026-10-14-recipiente-y-nombre-de-cuenta.md`).
- **Centavos por renglón, pesos cerrados al pagar**, y el ajuste por redondeo queda guardado.
- **No se vende lo que no hay**, ni siquiera con dos ventas confirmándose al mismo tiempo.
- **Una pesada se usa una sola vez**, para siempre.
- **Se confirma la cuenta que se vio.** Cada cuenta lleva una revisión que sube con cualquier cambio.
- **Un conteo corrige una sola vez**, aunque se capture dos veces o después de otra corrección.
- **Una jornada cerrada ya no cambia.**
- **No se migra con la aplicación atendiendo.** Con migraciones pendientes, el migrador se niega si
  la aplicación está conectada y le cierra la puerta de la base antes de aplicar la primera; se la
  vuelve a abrir el paso que deja listo su usuario. Si una migración falla a la mitad, la
  aplicación se queda fuera hasta que se resuelva.
- **La aplicación sabe qué versión del esquema espera** (`src/servidor/esquema.ts`). Contra una
  base con una migración de más o de menos, no atiende.
- **Corregir es decir cómo debió quedar.** Un movimiento confirmado no se edita: se asienta la
  diferencia entre lo que el libro dice de él y lo que debe decir, con motivo y con quién lo autorizó.
  Corrige el inventario; el dinero de una cuenta ya cobrada se corrige aparte, en el cierre.
- **El conteo manda.** Lo que un conteo ya cubrió no se corrige encima: se vuelve a contar.
- **Quien autoriza teclea su clave en ese momento**, y la comprueba la base dentro de la misma
  función que escribe. Sin clave correcta de una persona facultada no hay conteo, corrección ni
  vehículo de otro día.
- **Repetir un envío no lo duplica**, ni en el mostrador ni en el inventario: queda registro de lo que
  llegó y de lo que produjo.
- **Lo que debería haber en el cajón lo calcula la base**, de lo que se asentó (`esperado_en_cajon`).
  El corte guarda lo contado, la diferencia, lo que se queda y quién lo firmó, y ya no cambia.
- **Lo que costó cada movimiento lo pone la base al asentarlo**, a costo promedio del material en
  ese momento. Separar reparte el costo entre las partes según su precio de compra; la basura no
  lleva costo.
- **Lo fiado, los abonos, las correcciones de dinero y los gastos no se editan ni se borran.** Un
  gasto se anula, y queda quién, cuándo y por qué.

Y una que sostiene la pantalla, apoyada en la anterior:

- **Que no haya respuesta no demuestra que no entró.** Lo que va a salir queda guardado en el equipo
  antes de salir, con su identificador y su contenido. Mientras no se sepa qué pasó, no se edita:
  se manda ese mismo otra vez. Una falla del servidor, una respuesta perdida, la sesión vencida o
  una recarga a medio envío no lo sueltan.
- **Un rechazo tampoco lo demuestra.** Dice que esa petición no entró, no que no haya otra igual en
  camino: un intento anterior, u otra pestaña con lo mismo guardado. Por eso la pantalla no suelta
  ninguna captura por su cuenta: le pide al servidor que cancele el envío (`cancelar_envio`). O
  queda cancelado y ya no se asienta aunque llegue después; o ya había entrado, y entonces la
  acción se manda otra vez para que sea ella la que diga qué hizo. Si no se puede resolver, la
  captura sigue guardada (`enviar`, en `src/componentes/inventario/piezas.tsx`).
- **Que algo quedó registrado solo lo dice la acción misma.** La pantalla no deduce éxitos.
- **Lo que está a medias vive en la pestaña donde se empezó.** Una pestaña duplicada, o abierta
  desde otra, nace con una copia de lo guardado: la captura de inventario, el peso tecleado en el
  mostrador. Al cargar averigua que es copia y lo suelta (`src/componentes/pestana.ts`). Quién es
  la original lo decide un candado del navegador, no un plazo. Los candados piden origen seguro
  (HTTPS, o la propia máquina); sin ellos las pestañas se avisan entre sí, que sirve en el caso
  común; y sin eso, la copia hereda, y lo que protege es lo anterior: ningún envío se asienta dos
  veces. Si no se puede saber si la pestaña es copia, queda en duda: no suelta nada y no deja
  capturar hasta comprobarlo.
- **La aplicación no corre dentro de un marco.** Lo prohíbe la respuesta (`next.config.ts`), y si
  aun así cargara, no toca nada guardado.

## Frontera de confianza

Tres credenciales, cada una con lo suyo:

- **Administración** (migraciones y consola): dueña de las tablas. Nada la detiene, por eso no la
  tiene la aplicación.
- **La aplicación** (`feruga_web`, miembro de `feruga_app`): lee, y ejecuta las funciones de entrada.
  No escribe directo en ninguna tabla, no lee claves, equipos ni sesiones, y no puede dar de alta a nadie.
- **Quien atiende**: un equipo dado de alta con un código de un solo uso, y una clave por persona con
  bloqueo por intentos. La sesión vive en la base: vence, se cierra y se puede revocar.

Cada función de entrada recibe a la persona y comprueba su rol. Lo que la base **no** puede saber es
si quien llama es de verdad la persona que atiende: eso lo acredita el servidor de la aplicación, que
la saca de la sesión y nunca del cuerpo de la petición.

Cuando hace falta una **segunda** persona —quien autoriza un conteo, una corrección o el vehículo de
otro día—, la base no confía en el servidor: recibe la clave de esa persona y la comprueba ella misma.

Además, toda petición que escribe debe venir de la propia aplicación (se comprueba el origen) y
decir como quién cree estar actuando: si en otra pestaña entró alguien más, se rechaza.

**El identificador de un envío es lo que da derecho a resolverlo.** Lo genera la pantalla al azar,
vive en esa pestaña y no viaja a otro lado antes de enviarse. Quien lo conozca y tenga rol para
armar cuentas o llevar inventario puede cancelarlo antes de que llegue; no puede deshacer nada ya
asentado. No se ata a la persona, porque cancelar sirve justo para que quien atienda después pueda
resolver lo que quedó a medias. Cada cancelación queda en la bitácora, con quién la hizo.

## Códigos de error

Las funciones y los disparadores fallan con un código propio, para que la aplicación decida qué
decirle a la persona sin interpretar textos. Los errores nativos de Postgres (llave foránea,
unicidad, permisos, interbloqueo) llegan con su propio código y no se traducen.

| Código | Significa |
|---|---|
| `RC001` | El registro es inmutable: lo confirmado, lo publicado, lo cerrado y los libros no se modifican |
| `RC002` | No alcanza la existencia |
| `RC003` | El corte de arranque ya está cerrado: no se carga más saldo inicial |
| `RC004` | Pesada inválida: de otra báscula, vencida, fuera de capacidad, o en el orden equivocado |
| `RC005` | La cuenta o el dato no admite ese cambio, o no existe |
| `RC006` | Jornada: no hay una abierta, ya está cerrada, o tiene cuentas sin terminar |
| `RC007` | La separación de material no cuadra |
| `RC008` | La persona no tiene el rol o la facultad para esto |
| `RC009` | La lista de precios no está publicada o el material no tiene precio hoy |
| `RC010` | Aislamiento de transacción no admitido: el libro se escribe en `READ COMMITTED` |
| `RC011` | La cuenta cambió desde que se revisó: hay que volver a verla antes de confirmar |
| `RC012` | Ese identificador de envío ya no sirve: se canceló, o lo ocupa otro envío con otros datos |

Las rutas de la aplicación agregan los suyos, que no son reglas del negocio sino de la puerta:
`EQUIPO` (equipo sin dar de alta), `SESION` (hace falta entrar), `ROL`, `PERSONA` (ahora atiende
otra persona), `ORIGEN`, `FORMA` (dato mal formado), `CLAVE`, `CODIGO`, `NO_ESTA` e `INTERNO`.

## Respaldo y restauración

Un respaldo que nunca se restauró no es un respaldo. La prueba `09-respaldo` vuelca una base con
operaciones, la restaura en un servidor vacío y comprueba saldos, vínculos, disparadores y
permisos. La `22-restauracion` hace lo mismo con el programa de verdad y un respaldo cifrado. La
`23-respaldo` recorre el camino entero contra un almacenamiento con versiones y retención con
candado: respaldar, perder la máquina, bajar con otra credencial y restaurar.

**Cada respaldo es una corrida con pasos explícitos** (`operacion/respaldar.ts`): tomar el turno
(uno a la vez) → avisar al vigilante que empezó → volcar (`pg_dump`, una instantánea coherente con
el patio trabajando) → cifrar con la llave **pública** (`age`) → subir con un nombre que no se
repite (`rclone`) → bajar lo subido y comparar su huella → subir el manifiesto, **sellado** →
avisar que terminó bien. El fallo de cualquier paso detiene la corrida y avisa del fallo.

```bash
sh operacion/compose.sh run --rm --no-deps respaldo ahora      # uno ahora (lo usa también la publicación de una versión)
sh operacion/compose.sh run --rm --no-deps respaldo lista      # los que existen en el destino
sh operacion/compose.sh run --rm --no-deps respaldo lista --diario   # los que se guardan un año: uno por día
```

- **Un respaldo existe cuando tiene un manifiesto que se puede leer.** El manifiesto se sube al
  final y dice de cuándo es, cuánto pesa, cuál es su huella y en qué versión del esquema estaba la
  base (leída de la misma instantánea que se volcó). Un objeto sin manifiesto, o con el manifiesto
  dañado, no cuenta: el servicio toma otro.
- **Cada manifiesto lleva un sello que dice quién tomó el respaldo.** Que la huella coincida no
  lo dice: la huella viaja junto al archivo, y quien pudiera escribir en el almacenamiento rehace
  las dos cosas (cifrar solo pide la llave pública). El sello es un HMAC de todo lo que el
  manifiesto dice —el archivo, su tamaño y su huella, de cuándo es, y qué publicación corría—,
  con una clave que no está en el almacenamiento. Esa clave **se saca de la llave privada**, fuera
  del servidor: `node operacion/sello.ts < llave-privada.txt` dice los dos renglones que van al
  `.env`, juntos y de la misma llave —`RESPALDO_LLAVE_PUBLICA` y `RESPALDO_SELLO`— (el sello solo
  sale también con `openssl`: la receta está en ese archivo). La llave se lee como la lee `age`:
  una sola identidad, sin contar comentarios, y bien escrita. Con el sello el servidor sella, y de
  ahí no se vuelve a la llave. Quien restaura no guarda nada más: la saca otra vez de la llave con que
  va a descifrar, y **comprueba el sello antes de bajar, descifrar o restaurar nada**. Un
  manifiesto sin sello, con el de otra llave, o al que le cambiaron algo después, no acredita
  ningún respaldo: ni para restaurar, ni para saber de qué versión instalar, ni para que el
  servidor dé por tomado el respaldo de la hora. Las dos anotaciones que el diario deja en su
  depósito —qué respaldo se eligió para cada día, y de qué día sin diario ya se avisó— van
  selladas igual, cada una con su nombre.
- **El nombre de cada respaldo lleva su momento al milisegundo**, y ese es su orden. `respaldar
  ahora` dice el nombre de lo que tomó (`respaldo: …`): para volver a uno en particular se pide
  por su nombre, no «el último».
- **El servidor no puede leer sus propios respaldos:** la llave privada se genera fuera y nunca
  lo toca. **Ni destruir los anteriores:** eso lo impide el almacenamiento (versiones y retención
  con candado), no la credencial. La credencial del servidor sube, lista y lee lo cifrado; la de
  recuperación solo lee, y la guarda el dueño junto con la llave privada.
- **Ninguna clave viaja en argumentos:** a `pg_dump`, `pg_restore` y `rclone` les llega por su
  entorno; a `age`, la llave privada por la entrada estándar.
- **El vigilante está fuera de la máquina** y espera un aviso a cada hora convenida; si no llega,
  alerta. El aviso de «terminó bien» va al final y solo al final. Si el vigilante no contesta, el
  respaldo se toma igual.
- **De cada día se guarda uno por un año, en otro depósito** (`RESPALDO_DESTINO_DIARIO`,
  `operacion/diario.ts`). Los de cada hora duran 30 días; el candado de retención lo da el
  depósito a lo que recibe, así que cada plazo tiene el suyo, con su credencial. El diario de un
  día es **el primer respaldo de cada hora que salió bien ese día**, contado en la hora del
  patio: el mismo archivo cifrado y su mismo manifiesto. Se elige una vez —la elección queda
  escrita en el propio depósito— y un reintento sube ese, no el más nuevo. Se pone al día solo:
  después de cada respaldo y al arrancar el servicio, a todo día que no tenga el suyo se le
  sube. Si el diario falla, el respaldo de la hora vale igual, y el diario avisa por **su
  propia señal** (`RESPALDO_VIGIA_DIARIO_URL`). Un día que se quedó sin ningún respaldo que
  sirva no se puede reconstruir: se avisa, una vez. Se restaura con `restaurar.ts --diario`.
  Borrar lo vencido no lo hace el servidor —su credencial no puede—: lo hace el proveedor.
- **El horario son horas del día** (`RESPALDO_HORARIO=07:00,08:00,…`), en la hora del patio. Si el
  servicio estuvo caído a la hora de uno, lo toma al volver.

**Se restaura con un solo programa, el mismo para ensayar y para una emergencia**
(`operacion/restaurar.ts`). Descifra con la llave privada —que entra por la entrada estándar,
nunca como argumento—, crea los roles que el volcado no trae, restaura en una base aparte y en
una sola transacción, la audita, la pone al día, registra la restauración, deja listo el usuario
de la aplicación, y solo entonces le da a la base su nombre definitivo. Si algo falla antes, no
queda nada a medias. Sobre una base que ya existe no restaura.

```bash
node operacion/restaurar.ts respaldo.dump.age < llave-privada.txt      # un archivo que ya se tiene
node operacion/restaurar.ts --remoto < llave-privada.txt               # el último del almacenamiento
node operacion/restaurar.ts --remoto=<objeto> < llave-privada.txt      # uno en particular
node operacion/restaurar.ts --remoto --como-estaba=2026-10-04T09:00:00-06:00 < llave-privada.txt
node operacion/restaurar.ts --remoto --ensayo < llave-privada.txt      # y avisa al vigilante de los ensayos
node operacion/restaurar.ts --diario < llave-privada.txt               # el último de los que se guardan un año
node operacion/restaurar.ts --diario=<objeto> < llave-privada.txt      # el de un día en particular (se ven con «lista --diario»)
```

Del almacenamiento solo se restaura un respaldo con el sello de esa misma llave, y lo que se baja
se comprueba contra su manifiesto; si no coincide, no se restaura. (Con un archivo que ya se tiene
no hay manifiesto ni sello: lo que se confía es el archivo que eligió quien restaura.) Si el más
nuevo no sirve, lo dice y dice cuál es el último que sí: no baja a uno más viejo en silencio. Un
respaldo de una versión del sistema que el programa no conoce tampoco se restaura. Y antes de dar
la base por buena, entra como entra la aplicación y comprueba que la puede usar. Con
`--como-estaba` se ve el almacenamiento como estaba en ese momento: sirve si alguien pisó un
respaldo después, y pide una credencial que pueda leer versiones.

**Registrar la restauración abre un bloque nuevo de folios** (salta al siguiente múltiplo de cien
mil): los folios que se emitieron después del respaldo se perdieron con el servidor, pero están
impresos, y no se pueden repetir. También cierra las sesiones que venían abiertas en el respaldo.
El momento del respaldo que queda registrado es el del manifiesto: todo lo asentado antes está en
el respaldo; lo posterior es lo que hay que conciliar.

**Restaurar a mano con `pg_restore` no basta** (ni con `--create` en otro servidor, ni con
`--clean` encima de la misma base): fuera de desarrollo, la aplicación no atiende sobre una base
restaurada que no tenga su restauración registrada. La base guarda la identidad del servidor, la
de la base y la de **cada tabla y secuencia que tenía al emparejarse**, y es la de siempre
mientras sus tablas y secuencias sean **exactamente esas: ni falta una ni hay otra**. Una
restauración las vuelve a crear, y una tabla creada de nuevo es otra para el servidor aunque se
llame igual; da igual el formato del volcado, que deje fuera algunas tablas, que después una
migración les cambie el nombre, o que la vieja se conserve con otro nombre: la restaurada es una
que la marca no conoce. Tampoco atiende sobre una
que esté en otra versión del esquema. Y «no atiende» es de verdad: lo pregunta cada ruta en cada
petición, no solo la salud; con sesión válida y todo, contesta 503 y no escribe.

**Lo comprueban la aplicación y el migrador con su propio código** (`src/servidor/esquema.ts`), no
una función de la base: un volcado viejo restaurado encima repone las funciones de antes, y lo que
decide si se atiende no puede venir en el respaldo.

**Migrar nunca empareja.** Lo que una migración crea entra a la marca al aplicarla, y solo si la
base estaba emparejada antes —así, lo que hay de más lo creó esa migración— y después no falta
nada de lo conocido. Una migración que tenga que quitar o volver a crear una tabla ya cubierta lo
dice antes, una llamada por cada cosa que se va (`SELECT vida_retirar('la_tabla')`; las
secuencias de sus columnas se van con ella); si no, la base queda sin emparejar.

Lo que esa marca **no** distingue, dicho: una copia física del servidor entero (eso no es un
respaldo de este sistema); una recarga solo de datos sobre las mismas tablas, sin volver a
crearlas (vaciar y cargar, o `--data-only`); lo que no es tabla ni secuencia —funciones, vistas o
disparadores repuestos de un volcado—; y a quien administra la base y la empareja a mano. Protege
de una restauración olvidada, no de una maniobra deliberada: **la forma admitida de restaurar es
el programa**, que restaura en una base nueva y registra. Por lo mismo, **en el esquema de la
aplicación no se crean ni se borran tablas a mano**, fuera de una migración: una de más o una de
menos deja la base sin emparejar, y la aplicación deja de atender hasta que se quite la que sobra
o se registre lo que pasó. Una base que ya operaba antes de tener esta marca no se empareja sola al
actualizarse: se le dice una vez, con `SELECT estrenar_vida()`, y mientras tanto no atiende. Lo
mismo después de una actualización mayor de PostgreSQL.

**Límites que conviene saber.** El sello prueba que el respaldo lo tomó quien tiene su clave, y
esa clave vive en el servidor: quien solo pueda escribir en el almacenamiento ya no puede hacer
pasar un respaldo suyo, pero **un servidor comprometido entero sí puede sellar** uno falso más
nuevo, y el remedio sigue siendo restaurar uno anterior por su nombre o ver el almacenamiento como
estaba antes. **El sello dice que un respaldo es auténtico, no que sea el último que se tomó:** si
alguien escondiera los más nuevos, «el último» sería uno anterior y auténtico. Por eso al restaurar
se dice de hace cuánto es, y si tiene más de un día se advierte; lo que hay para comparar, fuera del
depósito, es el último «terminó bien» que recibió el vigilante. El servidor no puede comprobar que
su sello y su llave pública salieron de la misma privada: por eso salen juntos de `sello.ts`, y una
instalación se da por buena cuando, desde fuera y con la llave, se ve que su primer respaldo lleva
su sello. Cambiar la llave privada cambia el sello: los respaldos sellados con la anterior se
restauran con la anterior. Los respaldos tomados por una versión de antes del sello no lo llevan, y
esta versión no los restaura del almacenamiento; tampoco los comprobaría, al volver de una
migración fallida, el programa de una versión de antes del sello (no existe ninguna instalación
así: la primera de verdad ya lo trae). Los permisos y la
retención están probados contra MinIO; contra el almacenamiento que se contrate se repiten en el
servidor real. El cifrado protege los respaldos, no la base viva.

## Operación

En el servidor corre el mismo Compose, más `docker-compose.operacion.yml`: un proxy (Caddy) que es
lo único que se publica a la red y atiende por HTTPS con un certificado que él mismo pide y
renueva; el servicio que respalda a su hora; y una comprobación del entorno que corre antes que todo.

```bash
sh operacion/entorno.sh patio.ejemplo.mx     # una vez: genera .env con claves nuevas; falta llenar lo del respaldo
node operacion/sello.ts < llave-privada.txt  # FUERA del servidor: la llave pública y el sello de los respaldos, los dos renglones que van al .env
sh operacion/publicar.sh                     # publica el commit de esta carpeta (también la primera vez)
sh operacion/levantar.sh                     # levanta lo publicado, o lo pone al día después de cambiar el .env
sh operacion/compose.sh ps                   # «docker compose», sobre lo publicado: registros, consola, respaldar a mano
sh operacion/publicar.sh --recuperar         # retoma una publicación que se interrumpió
sh operacion/volver.sh < llave-privada.txt   # de una migración que falló: vuelve al respaldo que se tomó antes
sh operacion/publicar.sh --desde-respaldo < llave-privada.txt   # en otra máquina, sin nada: instala desde un respaldo
```

**En operación no se usa `docker compose` a secas, y no arranca aunque se intente:** le faltan las
imágenes, que las pone cada publicación. Nada se construye al levantar, y ninguna imagen va por
una etiqueta —que mañana puede apuntar a otra cosa—: cada servicio corre con la imagen que dejó la
publicación, por su identificador. Las imágenes de las que parten van por su huella; la base de
datos es la imagen oficial de PostgreSQL, sin cambios; el proxy lleva su configuración dentro.

**Qué corre lo dice la carpeta `publicaciones/`** (privada: lleva claves; no va al repositorio ni a
ninguna imagen). Cada publicación deja ahí su manifiesto y la configuración resuelta de su
conjunto. El conjunto vigente es el del último manifiesto cerrado como publicado.

**Publicar** es una secuencia lineal, y antes de cada paso queda escrito en el manifiesto que se
va a dar: preparar sin tocar nada (construir, comprobar el entorno y la red, que lo que corre sea
lo que dejó la última publicación, y que el migrador de la versión nueva —sin aplicar nada— diga
que puede con la base que hay); cerrar la operación, detener la aplicación y esperar a que no
quede ninguna sesión suya en la base; respaldar y anotar el nombre exacto del respaldo; migrar;
levantar la versión nueva con la operación cerrada y comprobarla por HTTPS; decidir abrir, y
abrir; reponer el servicio de respaldo y cerrar el manifiesto. Lo que promete:

- Antes de cerrar no se altera lo que atiende.
- Desde que se cierra hasta que se abre, el negocio está cerrado, pase lo que pase.
- Desde que se decide abrir no se retrocede; y una apertura confirmada sigue atendiendo aunque el
  guion muera después.

**Si una publicación se interrumpe** queda sin cerrar, y nada más se publica, se levanta ni se
migra hasta recuperarla: `sh operacion/publicar.sh --recuperar`. Recuperar lee el manifiesto y la
base y hace lo único que toca: si ya se había decidido abrir, termina hacia adelante; si no se
había migrado, restablece la versión anterior, la comprueba y la abre; y si la migración empezó y
no se decidió abrir, **se queda cerrado** y dice la salida: volver al respaldo que se tomó antes de
migrar —el negocio estuvo cerrado desde antes, así que trae todo— y después publicar la versión
corregida como cualquier otra. Si el manifiesto no se lee o habla de otra base, se
detiene: no significa «no hay nada pendiente».

**Volver al respaldo previo** (`sh operacion/volver.sh < llave-privada.txt`) lo hace el dueño, con
su llave. La base que falló no se borra: se aparta con otro nombre. Se restaura el respaldo de esa
publicación —ese, por su nombre— con el programa de la versión anterior, y esa versión queda
levantada **y cerrada** sobre la base restaurada, que tiene otra marca y un bloque nuevo de
folios. Abrir es un paso aparte y expreso (`sh operacion/volver.sh --abrir`), cuando ya se vio que
todo está bien. Si muere a la mitad, se vuelve a correr y sigue desde donde quedó.

**Si se pierde la máquina.** Cada respaldo dice, en su manifiesto, qué publicación corría cuando
se tomó, y con ella de qué commit era; se le cree porque su manifiesto lleva el sello de la llave
del dueño. En otra máquina —con el repositorio en ese commit y el
`.env` del paquete de recuperación— se instala desde un respaldo (`sh operacion/publicar.sh
--desde-respaldo < llave-privada.txt`): construye las imágenes de esa versión ahí mismo, de su
commit, restaura, y sigue como cualquier publicación. Del almacenamiento baja el respaldo —que va
cifrado para el dueño, y se audita al restaurarlo— y nada que se vaya a ejecutar: lo que se confía
es el repositorio. Lo que se asentó después de ese respaldo no está.

**Una operación a la vez.** Publicar, recuperar, levantar, volver al respaldo y migrar a mano
(`sh operacion/migrar.sh`) piden el mismo candado de la instalación; correr algo suelto con
`sh operacion/compose.sh run …`, también. Es un candado del sistema operativo: si un guion muere
sin soltarlo, queda libre en ese instante —no hay nada que destrabar a mano—, y mientras siga
trabajando algo que ese guion dejó lanzado, sigue tomado. `sh operacion/compose.sh` sirve para
consultar (`ps`, `logs`…) y para correr la consola o un respaldo a mano; lo que cambia qué corre
(`up`, `stop`, `down`…) no pasa por ahí. El migrador, en operación, no corre a secas: solo para
quien tiene el candado.

**`levantar.sh`** comprueba primero, sin tocar lo que corre —el entorno completo, y que a la red
solo salga el proxy en 80 y 443—, y solo entonces levanta. Lo que comprueba es exactamente lo que
levanta: resuelve la configuración una sola vez, la guarda, y levanta eso. La carpeta tiene que
estar en el commit publicado.

**Los ensayos** hacen todo eso en una máquina de desarrollo, en una instalación aparte —una copia
del proyecto con su propio repositorio, proyecto de Compose, imágenes, puertos y volúmenes—, con
un dominio que no existe y sin dejar nada al terminar:

```bash
sh operacion/ensayo.sh                       # la operación; solo pide Docker y Git; CONSERVAR=1 para dejarlo levantado
sh operacion/ensayo-publicacion.sh           # publicar, interrumpiendo el guion en cada paso; tarda
```

El de operación comprueba que con el entorno mal puesto nada se publica ni se toca, el orden de
arranque, que cada servicio corre con la imagen de su manifiesto, que a la red solo sale el proxy,
que el sitio atiende por HTTPS con un certificado que el navegador valida (confía en la autoridad
del proxy de ensayo; no se ignoran errores de certificado), el recorrido de una compra, que con la
base en otra versión no se atiende ni a través del proxy, el mantenimiento, el respaldo con su
vigilante, el candado, y que el certificado sobrevive a recrear el proxy.
El de publicación mata el guion —de verdad, sin que limpie— antes y después del efecto de cada
paso, y comprueba en cada caso en qué quedó el negocio y qué hace recuperar; vuelve al respaldo
previo de una migración que se quedó a medias; y simula que se perdió la máquina, para instalar
desde un respaldo con las imágenes guardadas fuera.
Lo que no pueden ensayar: el certificado público del dominio real y el acceso desde otra máquina.

## Pendiente de datos de campo

- **Capacidad y división de las tres básculas.** Los valores de `instrumento` son provisionales y
  holgados; los reales salen de la placa de cada una.
- **Con qué material del catálogo se compra una mezcla**, para poder separarla después.

## Lo que todavía no hace

En esta etapa **el peso se teclea**: quien atiende elige la báscula y escribe lo que marca.

Faltan, en este orden:

1. **Validar las pantallas de inventario con el personal.** Las del mostrador pasaron por un
   prototipo; estas no. Las capturas están en `recorrido/capturas/`.
2. **Despliegue**: el plan está en `docs/planes/2026-10-03-despliegue.md` (versión 2, revisada
   por Codex). Están hechos el entorno estricto, la migración con ventana, la restauración, el
   respaldo y el proxy con HTTPS (ensayado en local); faltan publicar una versión, la guía del
   servidor, la revisión de Codex del bloque y el servidor real.
3. **Las alertas fuera del sistema** (Telegram y correo) cuando un corte no cuadra: salen con el
   servidor. Mientras, el aviso sale dentro del sistema.
4. Lectura de básculas, tabletas y trabajo sin conexión.

No se fían compras ni hay adelantos, y nada de facturas: así lo pidió el negocio.

El modelo ya distingue una pesada tecleada de una automática, para que conectar las básculas no
cambie tablas.
