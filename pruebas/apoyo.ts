// Apoyo para las pruebas: cada prueba corre en su propia base, copiada de la plantilla recién migrada.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const ADMIN = process.env.PG_ADMIN_URL ?? "postgres://feruga:desarrollo@localhost:54329/postgres";
const PLANTILLA = process.env.PG_PLANTILLA ?? "feruga_plantilla";

export function urlDe(base: string): string {
  const u = new URL(ADMIN);
  u.pathname = "/" + base;
  return u.toString();
}

export async function conectar(base: string): Promise<pg.Client> {
  const cliente = new pg.Client({ connectionString: urlDe(base), connectionTimeoutMillis: 10_000 });
  await cliente.connect();
  // Ninguna consulta de prueba debe tardar: si una se queda detenida, que falle en vez de colgar la corrida.
  await cliente.query("SET statement_timeout = '20s'");
  return cliente;
}

/** Crea una base nueva desde la plantilla, corre la prueba y la borra pase lo que pase. */
export async function conBase(prueba: (db: pg.Client, base: string) => Promise<void>): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  const base = "p_" + randomUUID().replaceAll("-", "").slice(0, 20);
  await admin.query(`CREATE DATABASE ${base} TEMPLATE ${PLANTILLA}`);
  const db = await conectar(base);
  try {
    await prueba(db, base);
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  }
}

/** Una base recién creada y sin migrar, para probar el migrador. */
export async function conBaseVacia(prueba: (base: string) => Promise<void>): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  const base = "v_" + randomUUID().replaceAll("-", "").slice(0, 20);
  await admin.query(`CREATE DATABASE ${base}`);
  try {
    await prueba(base);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  }
}

/** La promesa debe fallar con ese código de error de Postgres. */
export async function rechaza(promesa: Promise<unknown>, codigo: string): Promise<void> {
  await assert.rejects(promesa, (e: unknown) => {
    const err = e as { code?: string; message?: string };
    assert.equal(err.code, codigo, `se esperaba ${codigo} y llegó ${err.code}: ${err.message}`);
    return true;
  });
}

export const num = (v: unknown): number => Number(v);

export async function una(db: pg.Client, sql: string, valores: unknown[] = []): Promise<Record<string, any>> {
  const r = await db.query(sql, valores);
  assert.equal(r.rows.length, 1, `se esperaba una fila y llegaron ${r.rows.length}: ${sql}`);
  return r.rows[0];
}

export async function usuario(db: pg.Client, nombre: string, rol: string, autoriza = false): Promise<string> {
  const f = await una(
    db,
    "INSERT INTO usuario (sucursal_id, nombre, rol, puede_autorizar) VALUES (1, $1, $2, $3) RETURNING id",
    [nombre, rol, autoriza],
  );
  return f.id;
}

export async function material(db: pg.Client, nombre: string): Promise<number> {
  return (await una(db, "SELECT id FROM material WHERE nombre = $1", [nombre])).id;
}

/** Abre una jornada y devuelve su identificador y el de su lista de precios. */
export async function abrirJornada(db: pg.Client, quien: string, fecha = "2026-10-01"): Promise<{ id: string; lista: string }> {
  const j = await una(db, "SELECT * FROM abrir_jornada(1::smallint, $1::date, $2)", [fecha, quien]);
  const l = await una(db, "SELECT id FROM lista_precios WHERE jornada_id = $1", [j.id]);
  return { id: j.id, lista: l.id };
}

/** Precios de ejemplo: [compra, venta] por kilo. */
export const PRECIOS: Record<string, [number, number]> = {
  "Cobre de primera": [150, 177],
  "Aluminio bote": [28, 33],
  "Fierro lámina": [6.2, 7.3],
  "Fierro pesado": [6.8, 8],
  "Cartón": [2.1, 2.5],
  "Magnesio": [22, 26],
  "PET": [7.5, 8.9],
};

export interface Escenario {
  responsable: string;
  mostrador: string;
  patio: string;
  consulta: string;
  jornada: string;
  lista: string;
  mat: Record<string, number>;
}

/** Un día cualquiera ya en marcha: personas dadas de alta, jornada abierta y lista de precios publicada. */
export async function escenario(db: pg.Client, precios: Record<string, [number, number]> = PRECIOS): Promise<Escenario> {
  const responsable = await usuario(db, "Servando", "responsable", true);
  const mostrador = await usuario(db, "Luis", "mostrador");
  const patio = await usuario(db, "Beto", "patio");
  const consulta = await usuario(db, "Ana", "consulta");
  const j = await abrirJornada(db, responsable);
  const mat: Record<string, number> = {};
  for (const [nombre, [compra, venta]] of Object.entries(precios)) {
    mat[nombre] = await material(db, nombre);
    await db.query("INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, $3, $4)", [
      j.lista, mat[nombre], compra, venta,
    ]);
  }
  await db.query("SELECT publicar_lista($1, $2)", [j.lista, responsable]);
  return { responsable, mostrador, patio, consulta, jornada: j.id, lista: j.lista, mat };
}

// Las tres básculas del patio.
export const GRANDE = 1;
export const CHICA_2 = 2;
export const CHICA_3 = 3;

/** Abre una cuenta. El identificador lo genera quien la abre, como lo hará la estación. */
export async function cuenta(db: pg.Client, e: Escenario, tipo: "compra" | "venta", quien = e.mostrador): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO operacion (id, sucursal_id, jornada_id, tipo, creada_por) VALUES ($1, 1, $2, $3, $4)", [
    id, e.jornada, tipo, quien,
  ]);
  return id;
}

/** Registra lo que marca una báscula. En el núcleo el peso se teclea. */
export async function pesada(db: pg.Client, e: Escenario, instrumento: number, kg: number): Promise<string> {
  const f = await una(
    db,
    "INSERT INTO captura_peso (instrumento_id, valor_kg, origen, tomada_por) VALUES ($1, $2, 'tecleada', $3) RETURNING id",
    [instrumento, kg, e.mostrador],
  );
  return f.id;
}

export async function renglonSinPeso(db: pg.Client, op: string, materialId: number, instrumento: number): Promise<string> {
  const f = await una(
    db,
    "INSERT INTO operacion_linea (operacion_id, material_id, instrumento_id) VALUES ($1, $2, $3) RETURNING id",
    [op, materialId, instrumento],
  );
  return f.id;
}

export async function asentar(db: pg.Client, linea: string, captura: string, orden = 1): Promise<void> {
  await db.query("INSERT INTO linea_pesada (linea_id, orden, captura_id) VALUES ($1, $2, $3)", [linea, orden, captura]);
}

/** Un renglón completo en báscula chica: material, pesada y peso asentado. */
export async function renglon(
  db: pg.Client, e: Escenario, op: string, materialId: number, kg: number, instrumento = CHICA_2,
): Promise<string> {
  const linea = await renglonSinPeso(db, op, materialId, instrumento);
  await asentar(db, linea, await pesada(db, e, instrumento, kg));
  return linea;
}

export const verRenglon = (db: pg.Client, linea: string) => una(db, "SELECT * FROM operacion_linea WHERE id = $1", [linea]);

/** Confirma la cuenta tal como está: lee su revisión y la manda, como hará la pantalla con lo que tiene a la vista. */
export const confirmar = (db: pg.Client, op: string, quien: string) =>
  una(db, "SELECT * FROM confirmar_operacion($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [op, quien]);

export async function revisionDe(db: pg.Client, op: string): Promise<number> {
  return (await una(db, "SELECT revision FROM operacion WHERE id = $1", [op])).revision;
}

export async function existencia(db: pg.Client, materialId: number): Promise<number> {
  return num((await una(db, "SELECT kg FROM existencia WHERE material_id = $1", [materialId])).kg);
}

/** Una compra de un solo material, ya confirmada. */
export async function compraDe(db: pg.Client, e: Escenario, materialId: number, kg: number): Promise<string> {
  const op = await cuenta(db, e, "compra");
  await renglon(db, e, op, materialId, kg);
  await confirmar(db, op, e.mostrador);
  return op;
}

/** Tablas que guardan la existencia en una columna. Debe venir siempre vacía. */
export async function columnasDeExistencia(db: pg.Client): Promise<string[]> {
  const r = await db.query(
    `SELECT c.table_name || '.' || c.column_name AS columna
     FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       AND c.column_name ~* '(existencia|saldo|stock)'
       AND c.data_type IN ('numeric', 'integer', 'bigint', 'smallint', 'real', 'double precision')`,
  );
  return r.rows.map((f) => f.columna);
}

// ── concurrencia: dos conexiones a la misma base, con una barrera que se puede verificar ──

export async function pidDe(c: pg.Client): Promise<number> {
  return (await una(c, "SELECT pg_backend_pid() AS pid")).pid;
}

/** Espera a que esa sesión esté detenida en un bloqueo. Si nunca se detiene, no hubo bloqueo y la prueba falla. */
export async function esperarQueEspere(vigia: pg.Client, pid: number): Promise<void> {
  for (let k = 0; k < 100; k++) {
    const r = await vigia.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'", [pid]);
    if (r.rows.length) return;
    await new Promise((listo) => setTimeout(listo, 50));
  }
  throw new Error("la segunda sesión nunca quedó esperando: no hubo bloqueo");
}

/** Espera a que todas esas sesiones estén detenidas en un bloqueo. */
export async function esperarQueEsperen(vigia: pg.Client, pids: number[]): Promise<void> {
  for (let k = 0; k < 100; k++) {
    const r = await vigia.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ANY($1) AND wait_event_type = 'Lock'", [pids]);
    if (r.rows[0].n === pids.length) return;
    await new Promise((listo) => setTimeout(listo, 50));
  }
  throw new Error(`no todas las sesiones quedaron esperando: se esperaban ${pids.length}`);
}

/** El código con que terminó la promesa, o "pasó". Sirve para una consulta que se deja corriendo. */
export const desenlace = (p: Promise<unknown>): Promise<string> => p.then(() => "pasó", (e) => (e as { code: string }).code);

/** La dirección de esa base con las credenciales que tendrá la aplicación: un rol con inicio de sesión, miembro de feruga_app. */
export async function urlApp(base: string, servidor = ADMIN): Promise<string> {
  const admin = new pg.Client({ connectionString: servidor, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  try {
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feruga_prueba') THEN
        CREATE ROLE feruga_prueba LOGIN PASSWORD 'prueba' IN ROLE feruga_app;
      END IF;
    END $$`);
  } finally {
    await admin.end();
  }
  const u = new URL(servidor);
  u.username = "feruga_prueba";
  u.password = "prueba";
  u.pathname = "/" + base;
  return u.toString();
}

/** Una conexión con las credenciales que tendrá la aplicación. */
export async function comoApp(base: string, servidor = ADMIN): Promise<pg.Client> {
  const app = new pg.Client({ connectionString: await urlApp(base, servidor), connectionTimeoutMillis: 10_000 });
  await app.connect();
  await app.query("SET statement_timeout = '20s'");
  return app;
}

/** Corre la prueba con dos conexiones a la misma base: la del dueño, que arma el escenario, y la de la aplicación. */
export const conApp = (prueba: (app: pg.Client, db: pg.Client, e: Escenario, base: string) => Promise<void>) =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    const app = await comoApp(base);
    try {
      await prueba(app, db, e, base);
    } finally {
      await app.end();
    }
  });

// ── las entradas del mostrador, como las llama la aplicación ──────────────

export const abrirCuenta = (
  c: pg.Client, tipo: string, quien: string, id: string = randomUUID(), etiqueta: string | null = null,
) => una(c, "SELECT * FROM abrir_cuenta($1, $2, $3, $4)", [id, tipo, etiqueta, quien]);

export interface Envio {
  linea?: string;
  captura?: string;
  bascula?: number;
}

/** Agrega un material con su peso. Los identificadores los pone quien envía; si no se dan, son nuevos. */
export const agregarMaterial = (
  c: pg.Client, cuentaId: string, materialId: number, kg: string, quien: string, envio: Envio = {},
) =>
  una(c, "SELECT * FROM agregar_material($1, $2, $3, $4::smallint, $5, $6, $7)", [
    cuentaId, envio.linea ?? randomUUID(), materialId, envio.bascula ?? CHICA_2, envio.captura ?? randomUUID(), kg, quien,
  ]);

export const segundaPesada = (c: pg.Client, linea: string, kg: string, quien: string, captura: string = randomUUID()) =>
  una(c, "SELECT * FROM segunda_pesada($1, $2, $3, $4)", [linea, captura, kg, quien]);

/**
 * Cierra la jornada que está abierta, diciendo lo que ve de ella, como hace la pantalla del cierre.
 * Para las pruebas que solo necesitan el día cerrado. `$1`: quién cierra. Sin jornada abierta, no devuelve nada.
 */
export const CERRAR_EL_DIA =
  "SELECT h.* FROM jornada j, LATERAL cerrar_el_dia(gen_random_uuid(), j.id, j.cierres, $1) h WHERE j.sucursal_id = 1 AND j.cerrada_en IS NULL";

export const contar = async (db: pg.Client, tabla: string, donde = "true", valores: unknown[] = []): Promise<number> =>
  (await una(db, `SELECT count(*)::int AS n FROM ${tabla} WHERE ${donde}`, valores)).n;

// ── quien autoriza con su clave ────────────────────────────────────────────

/** Da de alta un equipo y devuelve la huella con que se presenta. */
export async function equipoDeAlta(db: pg.Client): Promise<string> {
  const huella = createHash("sha256").update(randomUUID()).digest("hex");
  const codigo = (await una(db, "SELECT crear_codigo_alta('Mostrador') AS c")).c;
  assert.ok((await una(db, "SELECT canjear_codigo($1, $2) AS equipo", [codigo, huella])).equipo);
  return huella;
}

/** Da de alta a una persona con clave. */
export async function personaConClave(db: pg.Client, nombre: string, rol: string, clave: string, autoriza = false): Promise<string> {
  return (await una(db, "SELECT * FROM alta_persona($1, $2, $3, $4)", [nombre, rol, autoriza, clave])).id;
}
