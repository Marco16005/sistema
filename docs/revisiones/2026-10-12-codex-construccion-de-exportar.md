# Codex construye: el servidor para bajar reportes como archivo para Excel

> **12 de octubre de 2026.** Corrida de construcción (no de revisión) de Codex (`gpt-6-astra`, esfuerzo alto),
> en su copia `/tmp/feruga-codex-qa12/`. **Terminó completa.** Encargo: `encargo-18` (al final).
> Se integró después de leerlo; lo que se le cambió aquí está en «Cómo quedó».

## El informe de Codex, tal cual

## Pasos
1. Informe y pasos: hecho.
2. Pruebas de comoCsv, fallo e implementación: hecho (módulo ausente; después 3/3).
3. Pruebas de cuentas, fallo e implementación: hecho (exportación ausente; después pasan cuentas y periodo). No alcanzado: prueba de vehículo entre jornadas.
4. Hojas: dias hecho (fallo observado; pasa y coincide con cierres); renglones hecho (fallo observado; pasa con dos materiales, descuento y precio especial); precios hecho (fallo observado; pasa con dos listas publicadas y una sin publicar).
5. Pruebas de ruta, fallo e implementación: hecho (3 fallaron por módulo ausente; después pasan).
6. Verificación final e informe: hecho. 12 pruebas pasan y ambas comprobaciones de tipos terminan con código 0.

## Archivos
- /tmp/feruga-codex-informe-18.md
- pruebas/43-exportar.test.ts
- src/servidor/dominio/exportar.ts
- src/app/api/exportar/route.ts

## Pruebas
Última salida de `sh qa/prueba.sh pruebas/43-exportar.test.ts`, código 0:

```text
✔ comoCsv lleva marca UTF-8, termina cada renglón con CRLF y deja null vacío (0.790917ms)
✔ comoCsv encierra comas, comillas y saltos y duplica las comillas (0.117959ms)
✔ comoCsv protege fórmulas solo en columnas de texto y conserva números negativos (0.074584ms)
✔ cuentas ordena por fecha y folio, suma renglones y omite abiertas y días fuera del periodo (135.926542ms)
✔ cuentas conserva cliente y etiqueta y usa kilos recibidos aunque haya descuento (505.783333ms)
✔ el periodo rechaza fechas inválidas, orden invertido y más de 366 días incluidos (388.050458ms)
✔ dias coincide con cada cierre, incluye jornadas vacías y excluye las ajenas al periodo (112.965042ms)
✔ renglones conserva el orden de captura, descuento, precio especial y decimales de dos materiales (455.542542ms)
✔ precios exporta listas publicadas en orden por fecha, familia y material; omite la sin publicar (103.382ms)
✔ ruta permite responsable y consulta y entrega cada CSV con marca y encabezados de descarga (445.534333ms)
✔ ruta rechaza mostrador, patio y administracion con ROL y sin persona con 401 (510.671125ms)
✔ ruta devuelve JSON FORMA si falta un parámetro, la hoja no existe o el periodo es inválido (380.456875ms)
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

Tipos: `docker compose --profile pruebas run --rm --no-deps -T pruebas sh -c 'npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit --incremental false -p tsconfig.json'`, código 0. Salida literal:

```text
 Container feruga-pruebas-run-a8c1cd11e4bb Creating 
 Container feruga-pruebas-run-a8c1cd11e4bb Created 
npm notice
npm notice New major version of npm available! 11.19.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

## Decisiones mías
- El límite de 366 días cuenta ambos extremos; probado con el año bisiesto 2024.
- Empates de captura: creada_en y luego id, como el detalle existente de precios especiales.
- La prueba de descarga inspecciona bytes: Response.text() elimina la marca UTF-8 al decodificar.
- Desactivé incremental al comprobar tipos para no crear archivos de caché.
- Dejé pendiente armar el vehículo entre jornadas para mantener acotados los preparativos; tampoco quedó probado su peso nulo. Las consultas usan confirmada_en_jornada y conservan NULL.

## Dudas o cosas raras que viste en el código existente
- La copia no tiene metadatos Git; git status no está disponible.


## Cómo quedó

Se leyó completo y se integró: cuatro hojas (días, cuentas, materiales de cada cuenta y precios), el
CSV con la marca que Excel pide para los acentos, y la protección contra fórmulas en las columnas
que traen texto escrito por una persona. La ruta se registró en `pruebas/17-rutas.test.ts`
(«GET exportar»).

Lo único que se cambió aquí: los dos mensajes del periodo, que hablaban de «desde» y «hasta» (los
nombres de los parámetros) y ahora lo dicen en llano; la prueba que los buscaba se actualizó.

Quedó en 12 pruebas, en verde. No quedó probado, y Codex lo dijo: el vehículo que llega un día y se
termina al siguiente (la consulta usa `confirmada_en_jornada`, como todo lo demás) y sus pesos
vacíos.

## El encargo

```text
CONSTRUCCIÓN (no es una revisión), chica y con las pruebas primero: el lado del SERVIDOR para
BAJAR REPORTES COMO ARCHIVO PARA EXCEL (CSV). Lo escribes tú; yo lo integro y le pongo la pantalla.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL, Docker Compose).
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa12/   (al día con el proyecto, 12 de octubre de 2026)
EL INFORME: /tmp/feruga-codex-informe-18.md

CÓMO VA
Tu cuota puede cortarse a los pocos minutos de trabajo. Por eso el orden es fijo y cada paso deja
algo que sirve aunque no llegues al siguiente. No leas de más: lo que necesitas está nombrado abajo.
NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
  1. Crea el informe con la lista de los pasos.
  2. Pruebas de `comoCsv` (es pura, sin base). Míralas fallar. Escríbela. Anota.
  3. Pruebas de `tablaPara` con la hoja «cuentas»; míralas fallar; escríbela. Anota.
  4. Lo mismo con «dias», luego «renglones», luego «precios»: una hoja a la vez, prueba primero.
  5. Pruebas de la ruta; míralas fallar; escribe la ruta. Anota.
  6. Cierra el informe: archivos creados, la última salida de `sh qa/prueba.sh pruebas/43-exportar.test.ts`,
     el resultado de los tipos, lo que decidiste por tu cuenta, y lo que no alcanzaste.
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
  ni npm install. Una sola corrida a la vez. No agregues ninguna dependencia: el CSV se escribe a mano.
- No toques los contenedores feruga-web-1 y feruga-db-1 ni la base «feruga»: son del usuario.
- Crea SOLO estos tres archivos; no cambies ninguno de los que ya existen (ni apoyo.ts, ni mundo.ts,
  ni pruebas/17-rutas.test.ts: la ruta la registro yo ahí):
    pruebas/43-exportar.test.ts
    src/servidor/dominio/exportar.ts
    src/app/api/exportar/route.ts
- Escribe como el código de alrededor: nombres y comentarios en español, la misma densidad de
  comentarios, importaciones con la extensión .ts. Los números salen de la base como TEXTO decimal
  (::text); en TypeScript no se suma ni se redondea nada.
- Tus pruebas deben pasar también la comprobación de tipos.
- Pruebas que tarden poco: nada de cientos de cuentas para probar un límite.

QUÉ LEER (y nada más, salvo que algo no cuadre)
- src/servidor/dominio/panel.ts             la regla de siempre: una cuenta cobrada (estado 'confirmada') es del día de
                                            `confirmada_en_jornada` (jornada.fecha), sucursal 1; kilos = suma de peso_recibido.
- src/servidor/dominio/historial.ts         `diasDelHistorial` y `cuentasDelDia`: casi las mismas columnas que se piden aquí,
                                            y cómo se valida una fecha AAAA-MM-DD.
- src/servidor/dominio/historia-de-precios.ts   las listas PUBLICADAS y su fecha.
- db/migraciones/0005_operaciones.sql y 0025_precio_especial.sql   las columnas de operacion y operacion_linea
                                            (peso_bruto, tara, descuento_kg, peso_recibido, peso_liquidable, precio_lista,
                                            precio_unitario, importe, precio_autorizado_por, cliente_nombre, etiqueta).
- src/servidor/ruta.ts                      una ruta puede devolver un `Response` tal cual (no solo un objeto).
- src/app/api/panel/route.ts                validar la consulta con `unoDe`.
- pruebas/37-panel.test.ts                  `conDosDias` / `conPatio`: cómo se arman dos días con cuentas, y las pruebas de ruta.
- pruebas/42-clientes.test.ts               cómo se hace una cuenta con precio especial por las rutas (para la columna «Cliente»).

QUÉ SE CONSTRUYE

A) src/servidor/dominio/exportar.ts

    export const HOJAS = ["dias", "cuentas", "renglones", "precios"] as const;
    export type Hoja = (typeof HOJAS)[number];

    export interface Tabla {
      encabezados: string[];
      /** Cada celda ya es texto. `null` es una celda vacía. */
      filas: Array<Array<string | null>>;
      /** Qué columnas (por índice) traen texto escrito por una persona: nombres, etiquetas. */
      deTexto: number[];
    }

    /** La tabla de esa hoja, del `desde` al `hasta`, los dos incluidos. */
    export async function tablaPara(bd: Bd, o: { hoja: Hoja; desde: string; hasta: string }): Promise<Tabla>

    /** La tabla como texto CSV, lista para que Excel la abra con sus acentos. */
    export function comoCsv(tabla: Tabla): string

  EL PERIODO
  - `desde` y `hasta` son AAAA-MM-DD válidas (la misma validación estricta de historial.ts); `desde` no
    puede ser posterior a `hasta`; y de `desde` a `hasta` no puede haber más de 366 días. Lo que no
    cumple es ErrorDeForma, con un mensaje que diga cuál de las tres cosas falló.
  - Qué cae en el periodo: para dias, cuentas y renglones, la fecha de la JORNADA en que se asentó la
    cuenta (jornada.fecha de confirmada_en_jornada); para precios, la fecha de la jornada de la lista.
    Solo la sucursal 1.

  LAS HOJAS (encabezados EXACTOS, en este orden; fechas AAAA-MM-DD; números con punto decimal, sin
  separador de miles y sin signo de pesos)
  - "dias" — un renglón por jornada del periodo, del más viejo al más reciente:
      Fecha | Estado | Cuentas | Compras | Ventas | Pagado | Cobrado | Kilos comprados | Kilos vendidos
      Estado: "abierto" o "cerrado". Compras y Ventas: cuántas cuentas de cada tipo. Pagado y Cobrado:
      suma de operacion.total, en pesos cerrados ("0" si nada). Kilos: suma de peso_recibido, numeric(14,3).
      Un día sin cuentas sale con ceros. Pagado y Cobrado de cada día deben coincidir con
      `resumenDelCierre` de esa jornada (aPagar, aCobrar).
  - "cuentas" — un renglón por cuenta cobrada, por fecha y luego folio:
      Fecha | Hora | Folio | Tipo | Cliente | Nombre | Materiales | Kilos | Total | Atendió
      Hora: HH:MM de confirmada_en en la zona del patio (sucursal.zona). Tipo: "compra" o "venta".
      Cliente: operacion.cliente_nombre (vacío si no tiene). Nombre: operacion.etiqueta (vacío si no
      tiene). Materiales: cuántos renglones. Kilos: suma de peso_recibido, numeric(14,3). Total: pesos
      cerrados. Atendió: nombre de confirmada_por.   deTexto: Cliente, Nombre, Atendió.
  - "renglones" — un renglón por material de cada cuenta cobrada, por fecha, folio y orden de captura:
      Fecha | Folio | Tipo | Cliente | Material | Peso bruto | Tara | Descuento | Kilos | Precio de lista | Precio | Importe | Precio especial
      Kilos: peso_liquidable. Pesos en numeric(14,3). Precios ::text tal cual. Importe numeric(14,2).
      Precio especial: "sí" si precio_autorizado_por no es NULL; si no, "no".   deTexto: Cliente, Material.
      (Lee en 0005 cómo se llaman las columnas de peso y cuáles pueden ser NULL en un renglón de
      vehículo; una celda sin dato va vacía.)
  - "precios" — un renglón por material de cada lista PUBLICADA del periodo, por fecha, y dentro por
    familia.orden y material.id:
      Fecha | Familia | Material | Compra | Venta
      deTexto: Familia, Material.

  EL CSV (`comoCsv`)
  - Empieza con la marca U+FEFF (para que Excel lea UTF-8). Renglones separados por \r\n, y el último
    también termina en \r\n. Separador: coma.
  - Una celda va entre comillas dobles si trae coma, comilla doble, \r o \n; la comilla doble se
    duplica. null es celda vacía.
  - En las columnas `deTexto`, una celda que empieza con = + - @ o con tabulador o retorno se
    antepone con un apóstrofo ('), para que Excel no la ejecute como fórmula. En las demás columnas
    no se toca nada (un número negativo empieza con «-» y debe seguir siendo número).

B) La ruta (solo GET; roles: responsable y consulta — los demás reciben 403 «ROL»)

    GET /api/exportar?hoja=dias|cuentas|renglones|precios&desde=AAAA-MM-DD&hasta=AAAA-MM-DD

  - Faltan o no valen `hoja`, `desde` o `hasta` → 400 «FORMA» (JSON, como todas).
  - Si todo vale, devuelve un `Response` con el CSV y estos encabezados:
      content-type: text/csv; charset=utf-8
      content-disposition: attachment; filename="<hoja>-<desde>-a-<hasta>.csv"
      cache-control: no-store
  - `export const dynamic = "force-dynamic";` como las demás.

C) Las pruebas (pruebas/43-exportar.test.ts), con nombres que digan el comportamiento. Como mínimo:
  1. comoCsv: la marca al principio y \r\n al final de cada renglón; comas, comillas y saltos de
     línea entre comillas; null vacío; «=SUMA(A1)» y «-Juan» en columna de texto llevan apóstrofo;
     «-57» en columna que no es de texto queda igual.
  2. dias: dos días (uno cerrado, uno abierto) con cuentas; cada renglón coincide con resumenDelCierre;
     un día sin cuentas sale en ceros; un día fuera del periodo no sale.
  3. cuentas: orden por fecha y folio; cliente y nombre; una cuenta abierta no sale; un vehículo que
     llegó un día y se terminó al siguiente sale en el día en que se terminó (si armarlo cuesta
     mucho, dilo en el informe y sigue).
  4. renglones: una cuenta con dos materiales da dos renglones, con descuento y con precio especial.
  5. precios: solo listas publicadas; una abierta sin publicar no sale.
  6. El periodo: hasta antes que desde, más de 366 días y fechas mal escritas son ErrorDeForma.
  7. Ruta: responsable y consulta bajan el archivo (estado 200, los tres encabezados, y el cuerpo
     empieza con la marca y los encabezados de la hoja); mostrador, patio y administracion reciben
     403 «ROL»; sin persona, 401; hoja=todo, sin desde, o desde=ayer dan 400 «FORMA».
  Antes de escribir cada prueba, piensa qué cambio en el código la haría fallar; si ninguno, no sirve.

EL INFORME (corto, en español, sin introducciones)
    ## Pasos            (cada uno: hecho / a medias / no alcanzado)
    ## Archivos         (los que creaste)
    ## Pruebas          (la última salida de qa/prueba.sh, tal cual; y la de los tipos)
    ## Decisiones mías  (lo que el encargo no decía y resolviste, una línea cada una)
    ## Dudas o cosas raras que viste en el código existente (si las hay; una línea cada una)
```
