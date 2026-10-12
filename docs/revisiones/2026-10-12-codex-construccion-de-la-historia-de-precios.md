# Codex construye: el servidor de la historia de precios

> **12 de octubre de 2026.** Corrida de construcción (no de revisión) de Codex (`gpt-6-astra`, esfuerzo alto),
> en su copia `/tmp/feruga-codex-qa12/`. **Terminó completa.** Encargo: `encargo-16` (al final).
> Se integró después de leerlo; lo que se le agregó aquí está en «Cómo quedó».

## El informe de Codex, tal cual

## Pasos
1. Crear y guardar informe: hecho.
2. Pruebas de dominio primero y corrida en rojo: hecho (10 pruebas); cobertura a medias únicamente para material dado de baja, explicado abajo.
   Falla observada: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/servidor/dominio/historia-de-precios.ts' imported from /app/pruebas/41-historia-de-precios.test.ts`.
3. Implementar dominio hasta verde: hecho; 10 pruebas, 10 pasan, 0 fallan.
4. Agregar pruebas de ruta, ver rojo e implementar: hecho; primero 10 pasan y 2 fallan; después 12 pasan, 0 fallan.
   Falla observada: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/app/api/precios/historia/route.ts' imported from /app/pruebas/mundo.ts`.
5. Cerrar informe y comprobar tipos: hecho; tipos sin errores. No alcanzado: prueba de baja de material mediante una función existente (no encontré esa función). No se ejecutó la batería completa.

## Archivos
- pruebas/41-historia-de-precios.test.ts
- src/servidor/dominio/historia-de-precios.ts
- src/app/api/precios/historia/route.ts
- Informe: /tmp/feruga-codex-informe-16.md
No se modificaron archivos preexistentes del proyecto.

## Pruebas
Última salida de `sh qa/prueba.sh pruebas/41-historia-de-precios.test.ts`, salida 0:

```text
✔ tres listas cuentan tres, pero Cartón solo cambia al aparecer y al subir la compra (96.05425ms)
✔ alEmpezar toma la última lista anterior y el primer día del periodo sí cuenta (75.351917ms)
✔ quitar un precio produce null; seguir sin precio no cambia y reponerlo sí (80.101708ms)
✔ la lista abierta sin publicar no cambia el precio ni el número de listas (74.669167ms)
✔ un día cerrado sin publicar y un día sin jornada no cortan la comparación (80.742167ms)
✔ sin listas dentro del periodo sigue vigente lo anterior, sin inventar cambios (58.935666ms)
✔ solo aparecen materiales con historia, en orden de familia y de identificador (59.117167ms)
✔ sin publicaciones hasta el corte devuelve listas cero y materiales vacíos (59.311625ms)
✔ una base sin listas usa hoy del patio y admite los tres periodos fijos (51.696417ms)
✔ hasta exige una fecha real AAAA-MM-DD y permite el día bisiesto (50.055375ms)
✔ la ruta deja leer a responsable y consulta, rechaza los otros roles y exige persona (551.055709ms)
✔ la ruta acepta 30, 91 y 365; rechaza otros periodos con FORMA e ignora hasta (340.529042ms)
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

Tipos: `docker compose --profile pruebas run --rm --no-deps -T pruebas npm run tipos -- --incremental false`, salida 0:

```text
> tipos
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.json --incremental false
```

## Decisiones mías
- Validar hasta con formato estricto y calendario UTC; rechazar el año 0000.
- Comparar valores numeric con IS DISTINCT FROM; convertir a texto solo al construir la salida.
- Una consulta con CTE; para comparar bastan la última lista anterior y las del periodo.
- Ignorar hasta en la ruta, incluso si aparece en la URL; prueba incluida.
- Desactivar la caché incremental de TypeScript para no crear archivos adicionales.
- No forzar con UPDATE el caso de material dado de baja; queda documentado sin prueba. La consulta no filtra activo.
- Además de los mínimos verificables, probar cambios solo de venta, publicaciones posteriores al corte, reposición, periodos sin publicaciones y año bisiesto.

## Dudas o cosas raras que viste en el código existente
- No encontré una función para dar de baja materiales en las migraciones ni una operación equivalente en el dominio; falta únicamente esa cobertura del caso 6.
- Todos los días de prueba se prepararon cronológicamente con abrirJornada, cerrarJornada, fijar_precio, quitar_precio y publicar_lista, sin UPDATE.
- La copia no tiene repositorio Git; git status no está disponible.


## Cómo quedó

Se leyó completo y se integró sin cambios en lo que hace: una sola consulta, compara cada lista
publicada con la inmediata anterior, y un día sin lista no corta la comparación. La ruta se registró
en `pruebas/17-rutas.test.ts` («GET precios/historia»).

Lo que se le agregó aquí, con su prueba primero (se vio fallar por los campos que faltaban):

- **`base`, `variacion` y `veces` por material**, para que la pantalla no haga cuentas: contra qué
  se compara (lo que valía al empezar o, si no tenía precio, el primero del periodo), cuánto varió
  en por ciento hasta hoy, y cuántas veces cambió sin contar el haber aparecido. Una base de cero
  pesos no da variación; quien se quedó sin precio, tampoco.
- **La prueba del material dado de baja**, que Codex dejó sin hacer porque no hay todavía cómo
  darlo de baja desde el sistema: se le quita lo activo como dueño de la base, y su historia sigue.

Quedó en 16 pruebas (12 de Codex y 4 de aquí), en verde, con los tipos.

## El encargo

```text
CONSTRUCCIÓN (no es una revisión), chica y con las pruebas primero: el lado del SERVIDOR de la
HISTORIA DE PRECIOS. Lo escribes tú; yo lo integro al proyecto y le pongo la pantalla encima.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL, Docker Compose).
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa12/   (al día con el proyecto, 12 de octubre de 2026)
EL INFORME: /tmp/feruga-codex-informe-16.md

CÓMO VA
Tu cuota puede cortarse a los pocos minutos de trabajo. Por eso el orden es fijo y cada paso deja
algo que sirve aunque no llegues al siguiente. No leas de más: lo que necesitas está nombrado abajo.
NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
  1. Crea el informe con la lista de los pasos.
  2. Escribe pruebas/41-historia-de-precios.test.ts (las del dominio). Córrelas: deben FALLAR porque
     el módulo no existe. Anota en el informe el renglón de la falla.
  3. Escribe src/servidor/dominio/historia-de-precios.ts hasta que pasen. Anota el resultado.
  4. Agrega al mismo archivo de pruebas las de la ruta; míralas fallar; escribe la ruta. Anota.
  5. Cierra el informe: archivos creados, la última salida de
     `sh qa/prueba.sh pruebas/41-historia-de-precios.test.ts`, lo que decidiste por tu cuenta, y lo
     que no alcanzaste.
GUARDA el informe después de cada paso.

YA ESTÁ PREPARADO — no lo rehagas
- La copia, sin node_modules (las dependencias vienen de un volumen). No copies nada.
- La plantilla de pruebas feruga_plantilla_codex, con las 29 migraciones. NO hace falta ninguna
  migración nueva: el rol de la aplicación ya puede leer todas las tablas y vistas (0011_permisos.sql).
- Comandos de un renglón (ver /tmp/feruga-codex-qa12/qa/LEEME.md):
    sh qa/prueba.sh <archivo de pruebas> ['parte del nombre']
    sh qa/sql.sh "<SQL>"
- NO corras la batería completa, ni los recorridos del navegador, ni los simulacros.

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja SOLO en /tmp/feruga-codex-qa12/. No sustituyas su docker-compose.yml. No ejecutes npm ci
  ni npm install. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 ni la base «feruga»: son del usuario.
- Crea SOLO estos tres archivos; no cambies ninguno de los que ya existen (ni apoyo.ts, ni mundo.ts,
  ni pruebas/17-rutas.test.ts: la ruta la registro yo ahí):
    pruebas/41-historia-de-precios.test.ts
    src/servidor/dominio/historia-de-precios.ts
    src/app/api/precios/historia/route.ts
- Escribe como el código de alrededor: nombres y comentarios en español, la misma densidad de
  comentarios, importaciones con la extensión .ts. Los precios salen de la base como TEXTO decimal
  (::text, tal como están guardados: numeric(14,4)); en TypeScript no se suma ni se redondea nada.
- Tus pruebas deben pasar también la comprobación de tipos (aquí se corre `npm run tipos`): si
  llamas a `abrirCuenta`, lleva `etiqueta` (aunque sea null).

QUÉ LEER (y nada más, salvo que algo no cuadre)
- db/migraciones/0003_jornada_precios.sql   jornada, lista_precios (una por jornada; `publicada_en`), precio (lista, material, compra, venta).
- db/migraciones/0014_dia.sql               hoy_en(sucursal): el «hoy» del patio, según sucursal.zona.
- src/servidor/dominio/panel.ts             el modelo a seguir: una consulta con CTE, `hasta` opcional para las pruebas, periodos fijos.
- src/servidor/dominio/precios.ts           listaDelDia: cómo se leen materiales, familias y precios.
- src/app/api/panel/route.ts y src/servidor/ruta.ts   cómo es una ruta y cómo se valida `?dias=` con `unoDe`.
- pruebas/37-panel.test.ts                  cómo se prueba: conBase + crearBd(urlApp), escenario(), abrirJornada(db, quien, fecha),
                                            las pruebas de ruta con conMundo / ruta() de pruebas/mundo.ts.
- pruebas/apoyo.ts                          escenario() (abre el 2026-10-01 y publica PRECIOS), abrirJornada, PRECIOS.
  Para una lista con otros precios en un día nuevo: cierra la jornada (cerrarJornada de dominio/cierre.ts,
  como en 37-panel), abre la siguiente con abrirJornada(db, e.responsable, "2026-10-02") —que copia los
  precios de la última publicada—, cambia los que quieras con `SELECT fijar_precio(material, compra, venta, usuario)`
  o `SELECT quitar_precio(material, usuario)` (ve su firma en las migraciones) y publica con
  `SELECT publicar_lista(lista, usuario)`.

QUÉ SE CONSTRUYE

A) src/servidor/dominio/historia-de-precios.ts

    export const PERIODOS_DE_PRECIOS = [30, 91, 365] as const;
    export type PeriodoDePrecios = (typeof PERIODOS_DE_PRECIOS)[number];

    /** Un día en que el precio de un material quedó distinto del que traía. */
    export interface CambioDePrecio {
      fecha: string;                 // AAAA-MM-DD, la fecha de la jornada de esa lista
      compra: string | null;         // pesos por kilo, texto; null (los dos) si ese día dejó de tener precio
      venta: string | null;
    }

    export interface HistoriaDeMaterial {
      id: number;
      nombre: string;
      familia: string;
      /** Lo que valía al empezar: su precio en la última lista publicada ANTES de `desde`. null si no tenía. */
      alEmpezar: { compra: string; venta: string } | null;
      /** Lo que vale al final: su precio en la última lista publicada con fecha <= `hasta`. null si no tiene. */
      ahora: { compra: string; venta: string } | null;
      /** Los cambios dentro del periodo, del más viejo al más reciente. */
      cambios: CambioDePrecio[];
    }

    export interface HistoriaDePrecios {
      desde: string;                 // AAAA-MM-DD = hasta − (dias − 1)
      hasta: string;                 // por omisión, hoy_en(sucursal 1)
      dias: PeriodoDePrecios;
      /** Cuántas listas publicadas hay con fecha dentro del periodo. */
      listas: number;
      materiales: HistoriaDeMaterial[];
    }

    export async function historiaDePrecios(
      bd: Bd, o: { dias: PeriodoDePrecios; hasta?: string | null },
    ): Promise<HistoriaDePrecios>

  REGLAS DE NEGOCIO
  - Solo la sucursal 1. Solo cuentan las listas PUBLICADAS (publicada_en IS NOT NULL); una lista
    abierta y sin publicar no existe para esta historia, aunque sea la de hoy. La fecha de una lista
    es la de su jornada (jornada.fecha), no la hora en que se publicó.
  - Las listas publicadas, ordenadas por fecha, forman una fila. Para cada material, en cada lista del
    periodo [desde, hasta], se compara su precio con el de la lista publicada inmediatamente anterior
    (sea del periodo o de antes):
      · si no estaba y ahora está, o si cambió compra o venta → es un cambio, con los dos precios;
      · si estaba y ahora no está → es un cambio con compra y venta null;
      · si está igual (o sigue sin estar) → no es un cambio.
    La primera lista publicada de toda la historia, si cae dentro del periodo, da un cambio por cada
    material que trae (antes no había nada).
  - «Igual» es igual como número: 2.1000 y 2.10 son el mismo precio.
  - Un día sin lista publicada (un domingo, o un día que se abrió y no se publicó) no es un cambio:
    sigue valiendo lo último publicado.
  - `materiales`: los que tienen `alEmpezar`, o algún cambio en el periodo. Un material que nunca
    tuvo precio hasta `hasta` no sale. Orden: familia.orden y luego material.id (como listaDelDia).
    Sale aunque el material ya esté dado de baja (activo = false): su historia sigue siendo historia.
  - Sin ninguna lista publicada hasta `hasta`: `listas: 0, materiales: []` (y desde/hasta/dias).
  - `hasta` solo lo usan las pruebas; si llega, debe ser AAAA-MM-DD válida o es ErrorDeForma.

B) La ruta (solo GET; roles: responsable y consulta — los demás reciben 403 «ROL»)

    GET /api/precios/historia   [?dias=30|91|365]   → { historia: HistoriaDePrecios }

  - Sin `dias`: 30. Con un valor que no es uno de los tres → 400 «FORMA» (usa `unoDe`, como /api/panel).
  - `export const dynamic = "force-dynamic";` como las demás. La ruta NO recibe `hasta`.

C) Las pruebas (pruebas/41-historia-de-precios.test.ts), con nombres que digan el comportamiento. Como mínimo:
  1. Tres días con lista publicada: el segundo sube la compra del Cartón, el tercero deja todo igual.
     Con un periodo que cubre los tres: el Cartón trae el cambio del primer día (primera lista de la
     historia) y el del segundo, y nada del tercero; `ahora` es lo del segundo; `listas` es 3.
  2. `alEmpezar`: con `hasta` y `dias` tales que el primer día queda ANTES de `desde`, el Cartón trae
     `alEmpezar` con el precio del primer día y solo los cambios de dentro del periodo. (Para lograrlo
     con dias = 30, pon las jornadas con más de 30 días de distancia: abrirJornada acepta la fecha.)
  3. Un material al que se le quita el precio un día (quitar_precio antes de publicar) da un cambio con
     null y `ahora: null`; si después vuelve a tener precio, da otro cambio con sus precios.
  4. La lista de hoy abierta y sin publicar no cuenta: ni cambios, ni `ahora`, ni `listas`.
  5. Un día cerrado sin lista publicada en medio no produce cambios ni corta la comparación.
  6. Un material sin precio nunca no sale; uno dado de baja con historia, sí.
  7. Sin ninguna lista publicada: `listas: 0, materiales: []`.
  8. `hasta` mal escrita da ErrorDeForma.
  9. Ruta: responsable y consulta leen (y `dias` por omisión es 30); mostrador, patio y administracion
     reciben 403 «ROL»; sin persona, 401; `dias=7` da 400 «FORMA».
  Antes de escribir cada prueba, piensa qué cambio en el código la haría fallar; si ninguno, no sirve.
  OJO con cómo se preparan los días: una jornada cerrada no admite otra con fecha anterior ni dos
  abiertas a la vez; lee abrir_jornada en 0003 y en las migraciones posteriores que la reemplacen
  antes de armar el escenario, y si algo del escenario no se puede lograr por las funciones de
  verdad, dilo en el informe en vez de forzarlo con UPDATE.

EL INFORME (corto, en español, sin introducciones)
    ## Pasos            (cada uno: hecho / a medias / no alcanzado)
    ## Archivos         (los que creaste)
    ## Pruebas          (la última salida de qa/prueba.sh, tal cual)
    ## Decisiones mías  (lo que el encargo no decía y resolviste, una línea cada una)
    ## Dudas o cosas raras que viste en el código existente (si las hay; una línea cada una)
```
