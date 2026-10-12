# Codex construye: el servidor de los clientes del panel

> **12 de octubre de 2026.** Corrida de construcción (no de revisión) de Codex (`gpt-6-astra`, esfuerzo alto),
> en su copia `/tmp/feruga-codex-qa12/`. **Terminó completa.** Encargo: `encargo-17` (al final).
> Se integró después de leerlo; lo que se le agregó aquí está en «Cómo quedó».

## El informe de Codex, tal cual

## Pasos
1. Crear informe: hecho; guardado después de cada paso.
2. Pruebas de clientesDelPanel: hecho. Falla inicial observada:
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/servidor/dominio/clientes.ts' imported from /app/pruebas/42-clientes.test.ts
3. Implementar clientesDelPanel: hecho; cuatro pruebas pasaron.
4. Pruebas y fichaDeCliente: hecho; primero falló:
   SyntaxError: The requested module '../src/servidor/dominio/clientes.ts' does not provide an export named 'fichaDeCliente'
   Después pasaron seis pruebas.
5. Pruebas y rutas: hecho; primero pasaron seis y fallaron dos:
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/app/api/clientes/resumen/route.ts' imported from /app/pruebas/mundo.ts
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/app/api/clientes/[cliente]/route.ts' imported from /app/pruebas/mundo.ts
   Después pasaron ocho; se agregaron dos casos para varios renglones, kilos recibidos frente a liquidables, redondeo y límites.
6. Tipos y cierre: hecho; diez pruebas pasan y ambos proyectos TypeScript terminan con código 0.
   No alcanzado: cobertura con cuentas especiales asentadas en fechas distintas, otra sucursal y varios materiales distintos; no se fabricaron datos mediante UPDATE.

## Archivos
- pruebas/42-clientes.test.ts
- src/servidor/dominio/clientes.ts
- src/app/api/clientes/resumen/route.ts
- src/app/api/clientes/[cliente]/route.ts

## Pruebas
Última salida de `sh qa/prueba.sh pruebas/42-clientes.test.ts`, tal cual:

```text
✔ clientesDelPanel cuenta la compra especial cobrada y coincide con la diferencia del cierre (514.671625ms)
✔ clientesDelPanel separa compras y ventas y conserva negativa la rebaja de venta (507.353334ms)
✔ clientesDelPanel excluye abiertas, descartadas, precios quitados y cuentas sin cliente; ordena por actividad y nombre sin mayúsculas (720.302376ms)
✔ clientesDelPanel conserva cuentas por id al renombrar y dar de baja al cliente (457.806458ms)
✔ fichaDeCliente comparte el resumen y detalla materiales, autorizaciones y cuentas del cliente aunque cambie de nombre (676.24225ms)
✔ fichaDeCliente devuelve listas vacías sin cuentas, null si no existe y ErrorDeForma para ids inválidos (445.371041ms)
✔ las rutas de clientes permiten responsable y consulta; rechazan otros roles y equipos sin persona (836.10525ms)
✔ la ruta de ficha devuelve 404 NO_EXISTE para un cliente ausente y 400 FORMA para abc (377.517958ms)
✔ la ficha suma todos los renglones sin duplicar cuentas y distingue kilos recibidos de liquidables (445.76125ms)
✔ la ficha limita a 200 precios y cuentas recientes sin recortar los totales ni los materiales (11339.765047ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

Tipos: `docker compose --profile pruebas run --rm --no-deps -T pruebas sh -c 'node_modules/.bin/tsc --noEmit -p tsconfig.node.json && node_modules/.bin/tsc --noEmit -p tsconfig.json --incremental false'`

Salida, tal cual:
```text
 Container feruga-pruebas-run-617669514e50 Creating 
 Container feruga-pruebas-run-617669514e50 Created 
```
Código de salida: 0; ambos compiladores sin diagnósticos.

## Decisiones mías
- Una sola consulta para toda la ficha, compartiendo el CTE del resumen; lectura coherente del mismo instante.
- Los renglones especiales que empatan en fecha y folio se ordenan por creada_en e id, ascendentes.
- El límite de 200 solo afecta a precios y cuentas; resumen y materiales incluyen todo el historial.
- Se usa fila() tal como se pidió, incluido su límite existente de 18 dígitos.
- Tipos sin caché incremental para no crear archivos adicionales.
- Cada caso se prepara con rutas reales y funciones existentes; las consultas directas solo leen o llaman renombrar_cliente y baja_de_cliente.

## Dudas o cosas raras que viste en el código existente
- Los precios especiales requieren hoy abierto; las pruebas no fuerzan jornadas pasadas ni alteran tablas con UPDATE.
- La copia no tiene repositorio Git reconocible; git status respondió «not a git repository».
- Las dos rutas quedan pendientes de registro por el integrador en pruebas/17-rutas.test.ts, conforme al encargo.


## Cómo quedó

Se leyó completo y se integró sin cambios en lo que hace: un solo resumen compartido por la lista y
la ficha, las cuentas se buscan por `cliente_id` (no por el nombre), y la diferencia de cada precio
especial se calcula como en el cierre. Las dos rutas se registraron en `pruebas/17-rutas.test.ts`.

Lo que se le agregó aquí, con su prueba primero (se vio fallar porque la función no existía):

- **`resumenDeClientes`**: la lista y, en la misma consulta, lo que suman todos —cuántos clientes
  hay, cuántos siguen activos, sus cuentas y lo que movieron sus precios en compras y en ventas—,
  para los indicadores de la pantalla. `clientesDelPanel` quedó como «solo la lista» de eso mismo,
  y la ruta `GET /api/clientes/resumen` manda las dos cosas. Una prueba de Codex esperaba la
  respuesta sin totales: se actualizó, porque el cambio es a propósito.

Quedó en 12 pruebas (10 de Codex y 2 de aquí), en verde. Una de las de Codex tarda 11 segundos: da
de alta 201 cuentas por las rutas de verdad para probar el tope de 200 de la ficha.

## El encargo

```text
CONSTRUCCIÓN (no es una revisión), chica y con las pruebas primero: el lado del SERVIDOR de los
CLIENTES para el panel de quien dirige. Lo escribes tú; yo lo integro y le pongo la pantalla encima.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL, Docker Compose).
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa12/   (al día con el proyecto, 12 de octubre de 2026)
EL INFORME: /tmp/feruga-codex-informe-17.md

CÓMO VA
Tu cuota puede cortarse a los pocos minutos de trabajo. Por eso el orden es fijo y cada paso deja
algo que sirve aunque no llegues al siguiente. No leas de más: lo que necesitas está nombrado abajo.
NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
  1. Crea el informe con la lista de los pasos.
  2. Escribe pruebas/42-clientes.test.ts (las de `clientesDelPanel`). Córrelas: deben FALLAR porque
     el módulo no existe. Anota en el informe el renglón de la falla.
  3. Escribe `clientesDelPanel` en src/servidor/dominio/clientes.ts hasta que pasen. Anota.
  4. Pruebas de `fichaDeCliente`; míralas fallar; escríbela. Anota.
  5. Pruebas de las dos rutas; míralas fallar; escribe las rutas. Anota.
  6. Cierra el informe: archivos creados, la última salida de `sh qa/prueba.sh pruebas/42-clientes.test.ts`,
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
  ni npm install. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 ni la base «feruga»: son del usuario.
- Crea SOLO estos cuatro archivos; no cambies ninguno de los que ya existen (ni apoyo.ts, ni mundo.ts,
  ni pruebas/17-rutas.test.ts: las rutas las registro yo ahí; ni src/app/api/clientes/route.ts):
    pruebas/42-clientes.test.ts
    src/servidor/dominio/clientes.ts
    src/app/api/clientes/resumen/route.ts
    src/app/api/clientes/[cliente]/route.ts
- Escribe como el código de alrededor: nombres y comentarios en español, la misma densidad de
  comentarios, importaciones con la extensión .ts. Los números salen de la base como TEXTO decimal
  (::text); en TypeScript no se suma ni se redondea nada.
- Tus pruebas deben pasar también la comprobación de tipos.

DE QUÉ SE TRATA
En este sistema un «cliente» (tabla cliente, migración 0025) es alguien a quien se le da PRECIO
ESPECIAL. Una cuenta queda a nombre de un cliente (operacion.cliente_id, y cliente_nombre al
cobrar) solo mientras alguno de sus renglones tiene precio especial vigente. Las demás cuentas no
llevan cliente. Quien dirige quiere ver: a quién se le da precio especial, cuánto se le ha comprado
y vendido en esas cuentas, y cuánto movieron esos precios respecto de la lista.

QUÉ LEER (y nada más, salvo que algo no cuadre)
- db/migraciones/0025_precio_especial.sql   tabla cliente; operacion.cliente_id / cliente_nombre; operacion_linea.precio_lista,
                                            precio_autorizado_por; la función precios_especiales_del_dia (LA REGLA de la diferencia).
- src/servidor/dominio/panel.ts             el modelo a seguir: el CTE `op` (cuenta cobrada = estado 'confirmada', del día de
                                            confirmada_en_jornada; kilos = suma de peso_recibido), `materiales` y `especial`.
- src/servidor/dominio/historial.ts         `cuentasDelDia`: cómo se arma la lista de cuentas; `fila()` para validar un id.
- src/app/api/historial/[jornada]/route.ts  una ruta con parámetro y su 404.
- pruebas/37-panel.test.ts                  `conPatio` y la prueba «el control cuenta…» (hacia la línea 248): cómo se hace,
                                            por las rutas de verdad, una cuenta con precio especial para «Don Chuy» y se cobra.
                                            Úsala de molde. El precio especial solo se puede dar HOY (jornada de hoy abierta):
                                            no intentes fabricar días pasados con precio especial.
- pruebas/mundo.ts y pruebas/17-rutas.test.ts   conMundo, adentro(rol), ruta().
- db/migraciones/0025…: renombrar_cliente, y la que da de baja a un cliente (búscala ahí mismo), para las pruebas.

QUÉ SE CONSTRUYE

A) src/servidor/dominio/clientes.ts

    export interface ClienteDelPanel {
      id: string;
      nombre: string;                 // como se llama HOY (cliente.nombre)
      activo: boolean;
      cuentas: number;                // cuentas cobradas a su nombre (operacion.cliente_id = él, estado 'confirmada')
      compras: number;
      ventas: number;
      pagado: string;                 // suma de operacion.total de sus compras, pesos cerrados, texto ("0" si nada)
      cobrado: string;                // lo mismo de sus ventas
      kgComprado: string;             // suma de peso_recibido de los renglones de sus compras, numeric(14,3)::text
      kgVendido: string;
      /** Lo que sus precios especiales movieron respecto de la lista, con la regla de precios_especiales_del_dia:
          importe − round(peso_liquidable × precio_lista, 2), solo en renglones con precio_autorizado_por.
          En compras, positivo = se le pagó de más. En ventas, positivo = se le cobró de más. numeric(14,2)::text */
      diferenciaEnCompras: string;
      diferenciaEnVentas: string;
      /** La fecha (AAAA-MM-DD, la de la jornada en que se asentó) de su última cuenta; null si no tiene. */
      ultimaVez: string | null;
    }
    /** Todos los clientes, tengan o no cuentas y estén o no activos. */
    export async function clientesDelPanel(bd: Bd): Promise<ClienteDelPanel[]>

  - Orden: primero los de cuenta más reciente (ultimaVez descendente, los que no tienen al final), y a
    igualdad, por nombre sin distinguir mayúsculas, y luego por id.
  - Solo cuentas de la sucursal 1. Una cuenta abierta (borrador) o descartada no cuenta.
  - Una cuenta a la que se le dio precio especial y se le quitó antes de cobrar NO es del cliente
    (la base ya deja cliente_id en NULL): no debe contarle.

    export interface FichaDeCliente {
      cliente: ClienteDelPanel;       // exactamente el mismo objeto que da clientesDelPanel para él
      /** Por material, en sus cuentas: como `materiales` del panel. Orden: más kilos primero, luego nombre. */
      materiales: Array<{ nombre: string; kgComprado: string; importeComprado: string; kgVendido: string; importeVendido: string }>;
      /** Cada renglón con precio especial de sus cuentas cobradas, del más reciente al más viejo (fecha, luego folio, descendentes). Máximo 200. */
      precios: Array<{
        fecha: string;                // AAAA-MM-DD de la jornada en que se asentó
        folio: string;
        tipo: "compra" | "venta";
        material: string;
        kg: string;                   // peso_liquidable, numeric(14,3)::text
        precioLista: string;          // ::text tal cual (4 decimales)
        precio: string;               // precio_unitario, el que se cobró
        diferencia: string;           // importe − round(peso_liquidable × precio_lista, 2), numeric(14,2)::text
        autorizo: string;             // nombre de precio_autorizado_por
      }>;
      /** Sus cuentas cobradas, de la más reciente a la más vieja (fecha, luego folio, descendentes). Máximo 200. */
      cuentas: Array<{ id: string; folio: string; fecha: string; tipo: "compra" | "venta"; total: string; materiales: number; atendio: string }>;
    }
    /** La ficha de un cliente. null si ese cliente no existe. */
    export async function fichaDeCliente(bd: Bd, cliente: string): Promise<FichaDeCliente | null>

  - `cliente` es un bigint que llega como texto: si no es un entero positivo, ErrorDeForma (usa `fila()` de forma.ts).
  - Las cuentas se buscan por operacion.cliente_id, no por el nombre: si al cliente se le cambió el
    nombre después, sus cuentas viejas siguen siendo suyas.
  - No dupliques la consulta de `cliente`: que `fichaDeCliente` y `clientesDelPanel` compartan el mismo
    SQL del resumen (una constante o una función que lo arme), para que no puedan decir cosas distintas.

B) Las rutas (solo GET; roles: responsable y consulta — los demás reciben 403 «ROL»)

    GET /api/clientes/resumen       → { clientes: ClienteDelPanel[] }
    GET /api/clientes/[cliente]     → { ficha: FichaDeCliente }
                                      si no existe: throw new Rechazo(404, "NO_EXISTE", "Ese cliente no existe")
                                      si el id no es un número: 400 «FORMA»

  - `export const dynamic = "force-dynamic";` como las demás.
  - OJO: ya existe GET /api/clientes (src/app/api/clientes/route.ts), que es del mostrador para elegir
    cliente: no lo toques ni cambies quién lo ve.

C) Las pruebas (pruebas/42-clientes.test.ts), con nombres que digan el comportamiento. Como mínimo:
  1. Un cliente con una compra con precio especial cobrada: sale con 1 cuenta, lo pagado, los kilos,
     la diferencia en compras (con el ejemplo de 37-panel: 100 kg de Cartón a +0.50 → "50.00") y
     ultimaVez = hoy. Y esa diferencia coincide con la que da precios_especiales_del_dia de esa jornada.
  2. Una venta con precio especial hacia abajo: diferenciaEnVentas negativa; compras y ventas se
     cuentan por separado.
  3. Una cuenta con precio especial todavía abierta no le cuenta; una a la que se le quitó el precio
     antes de cobrar, tampoco; una cuenta sin precio especial no es de nadie.
  4. Dos clientes: el orden es por última vez y nombre; un cliente sin cuentas sale al final, en ceros
     y con ultimaVez null. (Un cliente sin cuentas se logra dándole precio especial y quitándoselo,
     o descartando la cuenta: el cliente queda dado de alta.)
  5. Renombrar al cliente después de cobrar: sale con el nombre nuevo y conserva sus cuentas.
     Darlo de baja: sigue saliendo, con activo: false.
  6. fichaDeCliente: `cliente` idéntico al de la lista; `materiales`, `precios` (con precio de lista,
     precio cobrado, diferencia y quién autorizó) y `cuentas`; un id que no existe da null; uno que
     no es número, ErrorDeForma.
  7. Rutas: responsable y consulta leen las dos; mostrador, patio y administracion reciben 403 «ROL»;
     sin persona, 401; /api/clientes/999999 da 404 «NO_EXISTE»; /api/clientes/abc da 400 «FORMA».
  Antes de escribir cada prueba, piensa qué cambio en el código la haría fallar; si ninguno, no sirve.
  Si algún caso no se puede preparar por las funciones de verdad, dilo en el informe en vez de
  forzarlo con UPDATE.

EL INFORME (corto, en español, sin introducciones)
    ## Pasos            (cada uno: hecho / a medias / no alcanzado)
    ## Archivos         (los que creaste)
    ## Pruebas          (la última salida de qa/prueba.sh, tal cual; y la de los tipos)
    ## Decisiones mías  (lo que el encargo no decía y resolviste, una línea cada una)
    ## Dudas o cosas raras que viste en el código existente (si las hay; una línea cada una)
```
