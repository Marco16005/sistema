# Codex construye: el catálogo de materiales desde la pantalla — corrida incompleta

> **12 de octubre de 2026.** Corrida de construcción de Codex (`gpt-6-astra`, esfuerzo alto), la quinta del
> día. **Se cortó por cuota** a los dos minutos: «You have hit your usage limit… try again at 5:21 PM».
> Alcanzó a leer y a escribir sus pruebas (`pruebas/44-materiales.test.ts`, en su copia); no escribió
> la migración, el dominio ni las rutas, y su informe quedó sin actualizar. Encargo: `encargo-20` (al final).
> Lo que pasó después está en «Cómo siguió».

## El informe de Codex, tal cual

## Pasos
1. Informe y lista de pasos: hecho.
2. Pruebas de base y fallo inicial: no alcanzado.
3. Migración, esquema y plantilla; pruebas de base en verde: no alcanzado.
4. Pruebas y dominio: no alcanzado.
5. Pruebas y rutas: no alcanzado.
6. Bitácora, permisos y pruebas completas indicadas: no alcanzado.
7. Tipos y cierre del informe: no alcanzado.

## Archivos
- `/tmp/feruga-codex-informe-20.md`: nuevo, seguimiento del trabajo.

## Pruebas
Pendientes.

## Decisiones mías
Ninguna todavía.

## Dudas o cosas raras que viste en el código existente
Ninguna todavía.


Lo último que dijo antes del corte: «RC007 se usa para separaciones que no cuadran, así que usaré RC005 para
impedir una baja por existencia o cuenta abierta. Las pruebas cubrirán también altas simultáneas y que los
cambios sin efecto no escriban en la bitácora.»

## Cómo siguió

Esa noche, ya con cuota, se le volvió a pasar el mismo encargo con una nota de continuación (lo que
había quedado: su archivo de pruebas, y nada más). La segunda corrida terminó completa: está en
`2026-10-12-codex-construccion-del-catalogo.md`. Lo que alcanzó a escribir en esta —las pruebas de
la base— fue su punto de partida, y lo conservó.

## El encargo

```text
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
