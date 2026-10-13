# Codex construye: el catálogo de materiales desde la pantalla

> **12 de octubre de 2026.** Segunda corrida de construcción de Codex (`gpt-6-astra`, esfuerzo alto) sobre este
> encargo; la primera se cortó por cuota (`…-del-catalogo-incompleta.md`). **Esta terminó completa.** El
> encargo es el mismo `encargo-20`, con una nota de continuación delante.
> Se integró después de leerlo; lo que se hizo aquí está en «Cómo quedó».

## El informe de Codex, tal cual

## Pasos
1. Hecho: informe reiniciado; leídas y conservadas las 144 líneas recuperadas.
2. Hecho: las ocho pruebas de base fallaron por funciones ausentes (42883).
3. Hecho: migración 0030 y ESQUEMA_ESPERADO; plantilla reconstruida con 30 migraciones; ocho pruebas verdes.
4. Hecho: tres pruebas de dominio fallaron por módulo ausente; implementado; once pruebas verdes.
5. Hecho: tres pruebas de rutas fallaron por rutas ausentes; implementadas; catorce pruebas verdes.
6. Hecho: prueba de bitácora falló con la frase genérica; cuatro frases implementadas, permisos actualizados y regresiones completas verdes.
7. Hecho: dieciséis pruebas propias, regresiones y ambos proyectos de tipos pasan. Nada del encargo quedó pendiente. Registro de rutas y pantalla quedan para tu integración, como pediste.

## Archivos
Nuevos (rutas relativas a /tmp/feruga-codex-qa12/):
- db/migraciones/0030_catalogo_en_pantalla.sql: dos funciones e índice único; sin permisos nuevos sobre tablas.
- pruebas/44-materiales.test.ts: conservadas las líneas 1–144; dominio desde 146, rutas desde 214, bitácora desde 305 e historia del libro desde 326.
- src/servidor/dominio/materiales.ts: listado y escrituras con SQL de lectura compartido, dentro de la transacción al escribir.
- src/app/api/materiales/route.ts: GET y POST, solo responsable.
- src/app/api/materiales/[material]/route.ts: POST, solo responsable.

Existentes; renglones para integrar a mano:
- src/servidor/esquema.ts:7: sustituir únicamente la constante por `export const ESQUEMA_ESPERADO = "0030_catalogo_en_pantalla.sql";`.
- pruebas/08-permisos.test.ts:151: insertar `"alta_material", "cambiar_material",` después de `"agregar_material",` en ENTRADAS.
- src/servidor/dominio/bitacora.ts: insertar después del renglón original 35 los campos `activoAntes`, `activoDespues`, `frecuenteAntes`, `frecuenteDespues`, todos `string | null` (renglones actuales 36–39).
- src/servidor/dominio/bitacora.ts: sustituir el renglón original 82, frase `"update material"`, por la función de los renglones actuales 86–92.
- src/servidor/dominio/bitacora.ts: insertar antes del renglón original 126 las dos proyecciones SQL de `antes/despues` para activo y frecuente (renglones actuales 136–137).
No se modificaron otros archivos del proyecto. 39-bitacora, apoyo, mundo, 17-rutas, catalogo y docker-compose permanecen intactos.

## Pruebas
Una corrida a la vez, mediante los guiones preparados. No se corrieron batería completa, navegador ni simulacros.
Primera salida roja conservada en /tmp/feruga-44-base-rojo.log; las de dominio, rutas y bitácora en /tmp/feruga-44-dominio-rojo.log, /tmp/feruga-44-rutas-rojo.log y /tmp/feruga-44-bitacora-rojo.log.

Plantilla (`sh qa/plantilla.sh`):
```text
plantilla lista: 30 migraciones
```

Última salida de `sh qa/prueba.sh pruebas/44-materiales.test.ts`:
```text
✔ base: el alta limpia nombres, nace activa sin precio y anota a quien la hizo (55.901167ms)
✔ base: rechaza largos, controles, familia inexistente y nombres repetidos activos o de baja (48.815417ms)
✔ base: solo responsable puede dar de alta o cambiar, antes de validar los datos (39.961ms)
✔ base: la aplicación llama ambas entradas pero no inserta ni renombra por UPDATE (57.362959ms)
✔ base: la baja rechaza existencia con kilos y cuentas abiertas incluso vehículos sin volver (57.60125ms)
✔ base: baja y reactivación cambian el mostrador y conservan la historia; frecuente y no cambios (82.605833ms)
✔ base: dos altas simultáneas dejan una sola y la segunda recibe RC005 con el mismo mensaje (99.871875ms)
✔ base: dos cambios esperan al material y conservan ambos campos (102.717292ms)
✔ dominio: trae las seis familias y todo el catálogo ordenado, también bajas, sin jornada (54.470958ms)
✔ dominio: existencia exacta, cuentas distintas con vehículo pendiente y precio solo de jornada abierta (88.135916ms)
✔ dominio: alta y cambios devuelven la misma forma que la lista y conservan nombre y familia (67.21325ms)
✔ rutas: responsable lee, da de alta, cambia y reactiva; omitir campos los conserva y no renombra (393.564375ms)
✔ rutas: los otros cuatro roles reciben 403 ROL en las tres puertas; sin persona reciben 401 (498.632667ms)
✔ rutas: cuerpos, identificadores y booleanos mal formados son 400 FORMA; reglas de base son 409 con mensaje (380.270083ms)
✔ bitácora: cuenta baja, reactivación y ambos cambios de frecuente sin exponer el detalle (77.707375ms)
✔ base: la baja con saldo cero conserva compras, ventas y movimientos anteriores (82.7595ms)
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

Última salida de `sh qa/prueba.sh pruebas/39-bitacora.test.ts`:
```text
✔ GUARDIA: toda pareja anotada en las migraciones tiene frase propia (15.004417ms)
✔ compra, merma y cierre salen recientes primero, con persona y hora del patio (106.355625ms)
✔ pagina sin repetir ni saltar; entrega 50 por omisión y limita a 200 (75.537667ms)
✔ filtra persona y día local, incluso juntos, y no expone detalle desconocido (58.714875ms)
✔ rechaza cursores, personas, cantidades y fechas mal formados (53.549875ms)
✔ las treinta parejas tienen frases completas y resuelven nombres sin revelar datos internos (60.603167ms)
✔ ruta: responsable y consulta leen, los otros roles reciben ROL y sin persona da 401 (597.785917ms)
✔ ruta: antes, persona o día inválidos devuelven 400 FORMA (352.572208ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

Última salida de `sh qa/prueba.sh pruebas/08-permisos.test.ts`:
```text
✔ la aplicación no escribe directo en el libro de inventario (85.104125ms)
✔ la aplicación no escribe, cambia ni borra la bitácora (54.118375ms)
✔ la aplicación no confirma una cuenta por su lado ni le pone folio (56.759458ms)
✔ la aplicación no escribe el peso ni el precio de un renglón (59.152917ms)
✔ la aplicación cambia y quita renglones solo por las funciones que dicen quién lo hace (69.856709ms)
✔ la aplicación no altera ni quita una pesada (56.213916ms)
✔ la aplicación no se da de alta personas ni se sube el rol (50.769709ms)
✔ la aplicación no abre, cierra ni publica saltándose las funciones (49.816958ms)
✔ la aplicación no puede apagar los disparadores (48.537084ms)
✔ la aplicación no crea objetos en el esquema (53.757ms)
✔ una tabla temporal con el nombre de una real no engaña a las funciones (59.263792ms)
✔ una tabla temporal de básculas no engaña a la validación de la pesada (61.494292ms)
✔ todas las funciones del esquema fijan dónde buscan sus tablas (35.22ms)
✔ la aplicación ejecuta las funciones de entrada y ninguna otra (52.294625ms)
✔ ninguna función del esquema queda abierta a cualquiera (53.7565ms)
✔ una función creada después nace cerrada para la aplicación (49.734125ms)
✔ la aplicación no escribe directo en ninguna tabla, y no lee las de identidad (45.419125ms)
✔ la aplicación no puede fijar la revisión de una cuenta (52.654166ms)
✔ con las credenciales de la aplicación se hace un día completo (153.615959ms)
✔ abrir_jornada rechaza a quien solo consulta (42.533791ms)
✔ abrir_jornada rechaza a una persona dada de baja (41.427666ms)
✔ publicar_lista rechaza a quien solo consulta (44.967ms)
✔ publicar_lista rechaza a una persona dada de baja (41.925042ms)
✔ confirmar_operacion rechaza a quien solo consulta (46.383666ms)
✔ confirmar_operacion rechaza a una persona dada de baja (47.273959ms)
✔ registrar_apertura rechaza a quien solo consulta (41.615666ms)
✔ registrar_apertura rechaza a una persona dada de baja (41.825ms)
✔ cerrar_corte rechaza a quien solo consulta (39.388708ms)
✔ cerrar_corte rechaza a una persona dada de baja (53.394875ms)
✔ registrar_conteo rechaza a quien solo consulta (44.891125ms)
✔ registrar_conteo rechaza a una persona dada de baja (42.745667ms)
✔ registrar_merma rechaza a quien solo consulta (42.902667ms)
✔ registrar_merma rechaza a una persona dada de baja (39.844958ms)
✔ registrar_transformacion rechaza a quien solo consulta (40.686958ms)
✔ registrar_transformacion rechaza a una persona dada de baja (41.472333ms)
✔ cerrar_jornada rechaza a quien solo consulta (41.211792ms)
✔ cerrar_jornada rechaza a una persona dada de baja (45.259292ms)
ℹ tests 37
ℹ pass 37
ℹ fail 0
```

Última salida de `sh qa/prueba.sh pruebas/12-servidor.test.ts`:
```text
✔ un error de negocio de la base sale con su código y su mensaje (67.884167ms)
✔ una lectura que falla por regla de negocio también se traduce (49.687292ms)
✔ un error que no es de negocio se queda como está (0.181083ms)
✔ si la acción falla no queda nada escrito (54.615875ms)
✔ lo que devuelve la acción queda escrito y llega a quien la pidió (54.323333ms)
✔ la persona que actúa queda en la bitácora (45.513417ms)
✔ la persona no se queda en la conexión para la acción que sigue (43.2265ms)
✔ la persona tampoco se queda cuando la acción falló (44.64825ms)
✔ la conexión se devuelve aunque la acción falle, una y otra vez (44.690125ms)
✔ perder la conexión a media acción (esperando) no tumba el servidor: la acción se rechaza y la siguiente se atiende (658.05825ms)
✔ perder la conexión a media acción (consultando) no tumba el servidor: la acción se rechaza y la siguiente se atiende (346.960291ms)
✔ toda acción corre en READ COMMITTED aunque la base esté configurada de otro modo (44.002959ms)
✔ un peso bien escrito pasa tal cual, como texto (0.238084ms)
✔ un peso mal escrito se rechaza por su forma (0.276167ms)
✔ un precio admite hasta cuatro decimales y nada más (0.145667ms)
✔ la ruta de salud responde bien cuando hay base (65.234583ms)
✔ la ruta de salud avisa cuando la base no está en la versión que la aplicación espera (43.678208ms)
✔ la versión del esquema que espera la aplicación es la última migración del repositorio (0.760083ms)
✔ la ruta de salud avisa cuando no hay base, sin contar por qué (1.001666ms)
✔ dos migradores a la vez no se pisan: el segundo espera al primero, y cada migración entra una sola vez (235.082376ms)
✔ el usuario de conexión se crea, entra, y tiene lo de la aplicación y nada más (42.883166ms)
✔ asegurar de nuevo al usuario de conexión no falla y deja la clave que se le dio (46.851166ms)
✔ el usuario de conexión no admite un nombre raro ni una clave vacía (32.715625ms)
✔ un usuario de conexión que ya existía con más de lo debido no se reutiliza (70.799875ms)
ℹ tests 24
ℹ pass 24
ℹ fail 0
```

Tipos: salida 0, sin errores en ambos proyectos. Se desactivó incremental para no crear archivos adicionales.
Comando: `docker compose --profile pruebas run --rm --no-deps -T pruebas npm run tipos -- --incremental false`.
```text
 Container feruga-pruebas-run-de935a3f2815 Creating 
 Container feruga-pruebas-run-de935a3f2815 Created 

> tipos
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.json --incremental false

npm notice
npm notice New major version of npm available! 11.19.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

## Decisiones mías
- Se mantiene RC005 para existencia o cuenta abierta; RC007 corresponde a separaciones que no cuadran.
- Índice único por sucursal y lower(nombre), e INSERT ON CONFLICT con lectura posterior: dos altas iguales dejan una sola y la otra recibe RC005 con el nombre existente.
- La limpieza junta espacios ordinarios; los caracteres de control se rechazan, también en llamadas directas a la base.
- Familia en HTTP exige número entero positivo que quepa en smallint; frecuente del alta es obligatorio, y null explícito no es un booleano válido en HTTP.
- texto() admite hasta 1000 caracteres en HTTP para que la base decida los largos de negocio después de limpiar espacios.
- Campos ajenos se ignoran, como en las rutas existentes; enviar nombre/familia a un cambio no modifica esos datos.
- Si vigencia y frecuente cambian juntos, la frase prioriza baja/reactivación; el disparador conserva ambos cambios.
- Las nuevas pruebas de frases se agregaron a 44-materiales para mantener intacto 39-bitacora.

## Dudas o cosas raras que viste en el código existente
- Ninguna que impida la integración. Esta copia no contiene .git; los renglones anteriores se registraron al editar y se verificaron con numeración de archivos.


## Cómo quedó

Se leyó completo —la migración, renglón por renglón— y se integró sin cambios en lo que hace:

- **Migración 0030**: `alta_material` y `cambiar_material`, las dos para el responsable; un índice
  único por nombre sin distinguir mayúsculas (cuenta también los dados de baja); la baja se niega
  con existencia o con el material en una cuenta abierta; pedir lo que ya tiene no escribe nada. La
  aplicación sigue sin poder escribir directo en `material`, y ninguna función cambia el nombre.
- **Dominio y rutas**: `GET` y `POST /api/materiales`, `POST /api/materiales/[material]`.
- **Bitácora**: «dio de baja», «reactivó», «marcó como frecuente» y «quitó de frecuentes» el material.

Lo que hubo que juntar a mano, porque a la vez se escribía aquí la migración 0031 (personas y
equipos): la lista de funciones de `pruebas/08-permisos` (las dos suyas más las siete de aquí), las
frases de `bitacora.ts` (las suyas más «pidió un código…»), y `ESQUEMA_ESPERADO`, que se queda en
la 0031 por ser la última. Las tres rutas se registraron en `pruebas/17-rutas.test.ts`, con su
cuerpo bien formado.

**Un tropiezo del orden**: la base de los recorridos ya tenía aplicada la 0031 cuando llegó la 0030,
y el migrador se negó («va antes de la última aplicada: una migración nueva lleva un número mayor»).
Es su guardia, y funcionó. Esa base es desechable y se rehízo; ninguna base con datos tenía la 0031
(la demostración del usuario seguía en la 0029).

Quedó en 16 pruebas, en verde. Encima se puso la pantalla (Panel → Ajustes → Materiales) y sus
recorridos (`recorrido/ajustes.spec.ts`).

## El encargo

```text
CONTINUACIÓN. Este mismo encargo lo empezaste hace unas horas y la corrida SE CORTÓ por cuota a los
dos minutos. Lo que quedó de entonces, en tu copia /tmp/feruga-codex-qa12/:
  - pruebas/44-materiales.test.ts   — lo escribiste tú (144 renglones). Léelo primero: es tu punto
                                       de partida. Complétalo o corrígelo si hace falta; no lo tires.
  - Nada más: ni la migración, ni el dominio, ni las rutas, ni los cambios a esquema.ts, 08-permisos
    o bitacora.ts. La plantilla feruga_plantilla_codex sigue con 29 migraciones.
  - Tu última decisión, que se mantiene: «RC007 se usa para separaciones que no cuadran, así que usaré
    RC005 para impedir una baja por existencia o cuenta abierta».
Sigue desde el paso 2 (ver fallar tus pruebas de la base). El informe ahora es
/tmp/feruga-codex-informe-21.md (empiézalo de nuevo; el anterior quedó sin actualizar).
Por si se vuelve a cortar: después de CADA paso guarda el informe, y en «Archivos» anota de inmediato
cada archivo que crees o cambies, con el renglón exacto si ya existía.

Lo que sigue es el encargo original, íntegro. Donde diga «informe-20», léase «informe-21».
══════════════════════════════════════════════════════════════════════════════════════════════

CONSTRUCCIÓN (no es una revisión), con las pruebas primero: EL CATÁLOGO DE MATERIALES DESDE LA
PANTALLA, del lado de la base y del servidor. Lo escribes tú; yo lo integro y le pongo la pantalla.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL, Docker Compose).
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa12/   (al día con el proyecto, 12 de octubre de 2026)
EL INFORME: /tmp/feruga-codex-informe-20.md

CÓMO VA
Tu cuota puede cortarse a los pocos minutos de trabajo. Por eso el orden es fijo y cada paso deja
algo que sirve aunque no llegues al siguiente. No leas de más: lo que necesitas está nombrado abajo.
NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
  1. Crea el informe con la lista de los pasos.
  2. Pruebas de la base (las dos funciones nuevas), en pruebas/44-materiales.test.ts. Míralas fallar.
  3. Escribe la migración db/migraciones/0030_catalogo_en_pantalla.sql; cambia ESQUEMA_ESPERADO;
     rehaz tu plantilla con `sh qa/plantilla.sh`; hasta que pasen. Anota.
  4. Pruebas del dominio; míralas fallar; escribe src/servidor/dominio/materiales.ts. Anota.
  5. Pruebas de las rutas; míralas fallar; escribe las rutas. Anota.
  6. La bitácora (frases) y la lista de permisos (pruebas/08-permisos.test.ts). Corre esas dos
     pruebas completas (39-bitacora y 08-permisos) y pruebas/12-servidor.test.ts. Anota.
  7. Cierra el informe: archivos creados y cambiados, la última salida de cada prueba que corriste,
     el resultado de los tipos, lo que decidiste por tu cuenta, y lo que no alcanzaste.
GUARDA el informe después de cada paso.

YA ESTÁ PREPARADO — no lo rehagas
- La copia, sin node_modules (las dependencias vienen de un volumen). No copies nada.
- La plantilla de pruebas feruga_plantilla_codex, con las 29 migraciones: al agregar la tuya hay
  que rehacerla (`sh qa/plantilla.sh`), y solo entonces tus pruebas ven la migración nueva.
- Comandos de un renglón (ver /tmp/feruga-codex-qa12/qa/LEEME.md):
    sh qa/prueba.sh <archivo de pruebas> ['parte del nombre']
    sh qa/sql.sh "<SQL>"
    sh qa/plantilla.sh
- NO corras la batería completa, ni los recorridos del navegador, ni los simulacros.

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja SOLO en /tmp/feruga-codex-qa12/. No sustituyas su docker-compose.yml. No ejecutes npm ci
  ni npm install. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 ni la base «feruga»: son del usuario.
- Archivos NUEVOS (solo estos):
    db/migraciones/0030_catalogo_en_pantalla.sql
    pruebas/44-materiales.test.ts
    src/servidor/dominio/materiales.ts
    src/app/api/materiales/route.ts
    src/app/api/materiales/[material]/route.ts
- Archivos que YA EXISTEN y puedes tocar, SOLO para lo que se dice (y dilo en el informe, con el
  renglón exacto que cambiaste, porque yo tengo que juntarlo a mano con otros cambios):
    src/servidor/esquema.ts              la constante ESQUEMA_ESPERADO → tu migración
    pruebas/08-permisos.test.ts          agregar tus funciones a la lista ENTRADAS (en orden alfabético)
    src/servidor/dominio/bitacora.ts     frases nuevas o mejores para lo que hace el catálogo
  Ningún otro (ni apoyo.ts, ni mundo.ts, ni 17-rutas.test.ts: las rutas las registro yo; ni
  catalogo.ts, que es del mostrador).
- AVISO: aparte, y a la vez, yo estoy escribiendo OTRA migración (la 0031, de personas y equipos).
  No la tienes y no debes depender de ella. Tu migración es la 0030 y es la última en tu copia.
- Escribe como el código de alrededor: nombres y comentarios en español, la misma densidad de
  comentarios (las migraciones explican el porqué arriba), importaciones con la extensión .ts.
- Tus pruebas deben pasar también la comprobación de tipos. Pruebas que tarden poco.

DE QUÉ SE TRATA
Hoy el catálogo de materiales (tabla material, migración 0002) solo se cambia por migración: la
aplicación no puede escribir en esa tabla (pruebas/10-entradas.test.ts lo comprueba hacia la línea
861, y debe SEGUIR sin poder escribir directo). El dueño quiere, desde la pantalla, dar de alta un
material, darlo de baja, reactivarlo y marcarlo o desmarcarlo como frecuente. Y decidió —el 12 de
octubre de 2026— que desde la pantalla NO se le cambia el nombre a un material: el comprobante se
rearma del libro y toma el nombre de hoy (src/servidor/dominio/comprobante.ts), así que renombrar
cambiaría lo que dicen los comprobantes viejos. Para «renombrar» se da de baja uno y se crea otro.
Como todo lo que escribe en este sistema, las reglas viven en la base: funciones SECURITY DEFINER
que dicen quién, y la aplicación solo las llama.

QUÉ LEER (y nada más, salvo que algo no cuadre)
- db/migraciones/0002_catalogo.sql          material, familia, y el disparador material_auditado (auditar()).
- db/migraciones/0001_base.sql              exigir_rol(usuario, VARIADIC roles), anotar(), auditar() (toma a la persona de
                                            current_setting('feruga.usuario')).
- db/migraciones/0012_mostrador.sql         el molde: cómo es una función de entrada (SECURITY DEFINER, SET search_path,
                                            exigir_rol al principio, errores RAISE EXCEPTION … USING ERRCODE = 'RC0xx' con un
                                            mensaje para la persona) y cómo se conceden al final (GRANT EXECUTE … TO feruga_app).
                                            Mira fijar_precio.
- db/migraciones/0006_inventario.sql        la vista existencia (kilos por material).
- db/migraciones/0025_precio_especial.sql   nombre_de_cliente(): cómo se limpia un nombre (espacios) y se valida su largo.
- src/servidor/errores.ts y src/servidor/ruta.ts   un error RC de la base llega a la pantalla como 409 (403 si es RC008)
                                            con su mensaje: escribe los mensajes para quien dirige el negocio.
- src/servidor/dominio/precios.ts           `bd.enTransaccion(persona, (c) => c.query("SELECT funcion(…, $n)", […, persona]))`.
- src/app/api/precios/route.ts              una ruta que lee y otra que escribe, con forma.ts (objeto, lista, material…).
- pruebas/02-catalogo-precios.test.ts y pruebas/14-dia-precios.test.ts   cómo se prueba una función de la base y como
                                            aplicación (conApp, rechaza(promesa, "RC0xx")).
- pruebas/37-panel.test.ts                  `conPatio` y las pruebas de ruta (conMundo, adentro(rol), ruta()).
- pruebas/39-bitacora.test.ts               la prueba que exige una frase por cada (acción, entidad) que anotan las migraciones.

QUÉ SE CONSTRUYE

A) db/migraciones/0030_catalogo_en_pantalla.sql — dos funciones, concedidas a feruga_app

    alta_material(p_familia smallint, p_nombre text, p_nombre_corto text, p_frecuente boolean, p_usuario bigint) RETURNS material
    cambiar_material(p_material int, p_activo boolean, p_frecuente boolean, p_usuario bigint) RETURNS material

  Las dos: SECURITY DEFINER, SET search_path = public, pg_temp; lo primero, exigir_rol(p_usuario,
  'responsable'); y que la bitácora diga quién fue (el disparador auditar() lo anota solo si antes
  se hizo `PERFORM set_config('feruga.usuario', p_usuario::text, true)`).

  alta_material
  - El nombre y el nombre corto se limpian: sin espacios a los lados y con un solo espacio entre
    palabras. Nombre: de 2 a 40 caracteres. Nombre corto (como se lee dentro de su familia: «Bote»,
    no «Aluminio bote»): de 1 a 24. Fuera de eso, RC005 con un mensaje que diga el largo permitido.
    No se admiten saltos de línea ni tabuladores (después de limpiar no debe quedar ninguno).
  - La familia tiene que existir (RC005 «Esa familia no existe»).
  - No puede haber otro material de la sucursal 1 con ese nombre SIN distinguir mayúsculas, esté
    activo o dado de baja. Si existe y está activo, RC005 con el mensaje:
        Ya hay un material que se llama «X»
    Si existe y está de baja, RC005 con el mensaje:
        «X» está dado de baja: reactívalo en vez de crear otro
    Dos altas a la vez con el mismo nombre: queda una sola y la otra recibe el mismo RC005, no un
    error crudo de restricción.
  - Nace activo, en la sucursal 1, con `frecuente` como se pidió (NULL = false).
  - No le pone precio: eso se hace en la lista de precios del día.

  cambiar_material — p_activo y p_frecuente: NULL quiere decir «no lo cambies».
  - El material tiene que existir (RC005).
  - Dar de baja (activo true → false) se rechaza, con RC007 si ese código ya se usa para «no se
    puede por el estado en que está» (mira qué significan los RC en las migraciones y elige el que
    corresponda; si ninguno cuadra, RC005), cuando:
      · hay existencia distinta de cero: «Todavía hay 120.000 kg de X en el patio: primero hay que
        venderlo, darlo de baja del inventario o corregirlo»;
      · o está en una cuenta abierta (operacion en estado de borrador con un renglón de ese
        material; un vehículo que todavía no vuelve también es una cuenta abierta): «X está en una
        cuenta abierta: termínala o quítalo de ahí primero».
  - Reactivar y cambiar `frecuente` se puede siempre.
  - Si nada cambia (se pide lo que ya tiene, o los dos son NULL), no se escribe nada —ni un renglón
    en la bitácora— y se devuelve el material como está.
  - Esta función NO cambia nombre, nombre corto ni familia: no hay forma de pedírselo.
  - Bloquea el material mientras decide (FOR UPDATE), para que dos cambios a la vez no se pisen.

  La aplicación sigue SIN poder escribir directo en material: no agregues ningún GRANT sobre la tabla.

B) src/servidor/dominio/materiales.ts

    export interface MaterialDelCatalogo {
      id: number;
      nombre: string;
      nombreCorto: string;
      familia: string;                // su nombre
      familiaId: number;
      frecuente: boolean;
      activo: boolean;
      existencia: string;             // kilos, numeric(14,3)::text ("0.000" si nada)
      enCuentasAbiertas: number;      // en cuántas cuentas abiertas está
      conPrecioHoy: boolean;          // tiene precio en la lista de la jornada abierta (publicada o no)
    }
    /** Todo el catálogo —activos y dados de baja—, por familia.orden y luego por nombre sin distinguir mayúsculas. */
    export async function materialesDelCatalogo(bd: Bd): Promise<{ familias: Array<{ id: number; nombre: string }>; materiales: MaterialDelCatalogo[] }>
    export async function altaDeMaterial(bd: Bd, persona: Persona, o: { familia: number; nombre: string; nombreCorto: string; frecuente: boolean }): Promise<MaterialDelCatalogo>
    export async function cambiarMaterial(bd: Bd, persona: Persona, material: number, o: { activo: boolean | null; frecuente: boolean | null }): Promise<MaterialDelCatalogo>

  - Las dos que escriben devuelven el material como quedó, con la misma forma que la lista (comparte el SQL).
  - `familias`: las seis, por su orden, para el formulario.

C) Las rutas (rol: SOLO responsable — los demás reciben 403 «ROL»)

    GET  /api/materiales                 → { familias, materiales }
    POST /api/materiales                 cuerpo { familia, nombre, nombreCorto, frecuente }   → { material }
    POST /api/materiales/[material]      cuerpo { activo?, frecuente? }                       → { material }

  - Valida la forma con src/servidor/forma.ts (lee lo que hay: objeto, material, texto, etc.). Lo que
    no tiene forma es 400 «FORMA»; lo que la base rechaza llega solo como 409 con su mensaje.
    `activo` y `frecuente`, si vienen, son booleanos de verdad (no "true"); si no vienen, null.
  - `export const dynamic = "force-dynamic";` como las demás.

D) La bitácora (src/servidor/dominio/bitacora.ts)
  El alta y los cambios quedan anotados por el disparador como «insert material» y «update
  material», que ya tienen frase. Mejora la de «update material» para que diga lo que pasó, con lo
  que trae el detalle (`antes` y `despues`): «dio de baja el material X», «reactivó el material X»,
  «marcó como frecuente el material X», «quitó de frecuentes el material X»; si no es ninguna de
  esas, la genérica de ahora. NUNCA enseñes el detalle crudo. Agrega su prueba a 39-bitacora SOLO
  si puedes hacerlo sin cambiar las que ya están; si no, ponla en 44-materiales.

E) Las pruebas (pruebas/44-materiales.test.ts), con nombres que digan el comportamiento. Como mínimo:
  1. Alta: nace activo con su familia, nombre limpio («  Cobre   quemado » → «Cobre quemado»), nombre
     corto y frecuente; queda en la bitácora a nombre de quien lo hizo.
  2. Alta rechazada: nombre de un carácter o de 41; nombre corto vacío o de 25; familia que no existe;
     nombre repetido con otras mayúsculas (activo → un mensaje; de baja → el otro).
  3. Solo el responsable: mostrador, patio, consulta y administracion reciben RC008 de la base.
  4. Como aplicación (conApp): llamar las dos funciones pasa; INSERT y UPDATE directos sobre material
     siguen rechazados por permisos.
  5. Baja: con existencia se rechaza y el mensaje dice los kilos; en una cuenta abierta se rechaza;
     sin nada, pasa, y el material deja de salir en el catálogo del mostrador (catalogo() de
     src/servidor/dominio/catalogo.ts) pero conserva su historia. Reactivar lo regresa.
  6. Frecuente: se marca y se desmarca; pedir lo que ya tiene no escribe nada en la bitácora.
  7. No hay forma de cambiar el nombre: la función no lo recibe, y la aplicación no puede con UPDATE.
  8. Dominio: materialesDelCatalogo trae activos y de baja en orden, con existencia,
     enCuentasAbiertas y conPrecioHoy; las dos que escriben devuelven el material como quedó.
  9. Rutas: el responsable lee y escribe; consulta, mostrador, patio y administracion reciben 403
     «ROL» en las tres; sin persona, 401; cuerpo sin forma, 400 «FORMA»; un rechazo de la base llega
     como 409 con su mensaje.
  10. Bitácora: las cuatro frases nuevas.
  Antes de escribir cada prueba, piensa qué cambio en el código la haría fallar; si ninguno, no sirve.

EL INFORME (corto, en español, sin introducciones)
    ## Pasos            (cada uno: hecho / a medias / no alcanzado)
    ## Archivos         (los nuevos; y de los que ya existían, el renglón exacto que cambió en cada uno)
    ## Pruebas          (la última salida de cada archivo de pruebas que corriste, tal cual; y la de los tipos)
    ## Decisiones mías  (lo que el encargo no decía y resolviste, una línea cada una)
    ## Dudas o cosas raras que viste en el código existente (si las hay; una línea cada una)
```
