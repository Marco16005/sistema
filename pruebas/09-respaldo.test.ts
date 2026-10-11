// Un respaldo que nunca se restauró no es un respaldo. Aquí se vuelca una base con un día de
// operación, se restaura en OTRO servidor, vacío, y se comprueba que el patio quedó igual y que
// las reglas siguen vivas. Restaurar no vuelve a ejecutar las validaciones, así que después se
// audita: saldos, correspondencia entre renglones y movimientos, disparadores y permisos.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import pg from "pg";
import {
  GRANDE, asentar, comoApp, compraDe, conBase, confirmar, cuenta, escenario, pesada, rechaza, renglon, renglonSinPeso, una, urlDe,
} from "./apoyo.ts";

const correr = promisify(execFile);
const LIMPIO = process.env.PG_RESTAURA_URL ?? "postgres://feruga:desarrollo@localhost:54330/postgres";

async function versionDelCliente(): Promise<number | null> {
  try {
    const { stdout } = await correr("pg_dump", ["--version"]);
    return Number(/(\d+)\./.exec(stdout)?.[1]);
  } catch {
    return null;
  }
}

/** Lo que debe ser idéntico antes y después. */
async function retrato(db: pg.Client) {
  const filas = async (sql: string) => (await db.query(sql)).rows;
  return {
    existencia: await filas("SELECT nombre, kg FROM existencia ORDER BY nombre"),
    movimientos: await filas("SELECT id, material_id, tipo, cantidad_kg, jornada_id, linea_id, referencia_id FROM movimiento_inventario ORDER BY id"),
    operaciones: await filas("SELECT id, tipo, estado, folio, suma, ajuste_redondeo, total FROM operacion ORDER BY creada_en, id"),
    pesadas: await filas("SELECT linea_id, orden, captura_id FROM linea_pesada ORDER BY linea_id, orden"),
    bitacora: (await una(db, "SELECT count(*)::int AS n FROM bitacora")).n,
    precios: await filas("SELECT lista_id, material_id, compra, venta FROM precio ORDER BY 1, 2"),
    disparadores: await una(db, "SELECT count(*)::int AS total, count(*) FILTER (WHERE tgenabled = 'O')::int AS activos FROM pg_trigger WHERE NOT tgisinternal"),
  };
}

test("un respaldo restaurado en un servidor vacío deja el patio como estaba y con sus reglas vivas", async (t) => {
  const cliente = await versionDelCliente();
  await conBase(async (db, base) => {
    const servidor = Math.floor(Number((await una(db, "SHOW server_version_num")).server_version_num) / 10000);
    if (cliente !== servidor) {
      t.skip(`hace falta pg_dump ${servidor} y aquí hay ${cliente ?? "ninguno"}: corre «docker compose run --rm pruebas»`);
      return;
    }

    // Un día de operación con un poco de todo.
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    await compraDe(db, e, e.mat["Aluminio bote"], 12.35);
    await compraDe(db, e, e.mat["Fierro lámina"], 100);
    const venta = await cuenta(db, e, "venta");
    await renglon(db, e, venta, e.mat["Cartón"], 30);
    await confirmar(db, venta, e.mostrador);
    await db.query("SELECT registrar_conteo($1, 75, $2, $3)", [e.mat["Cartón"], e.responsable, e.mostrador]);
    await db.query("SELECT registrar_merma($1, 1, 'Mojado', $2)", [e.mat["Cartón"], e.mostrador]);
    await db.query("SELECT registrar_transformacion($1, 100, $2::jsonb, NULL, $3)", [
      e.mat["Fierro lámina"], JSON.stringify([{ material: e.mat["Fierro pesado"], kg: 95 }]), e.mostrador,
    ]);
    const camioneta = await renglonSinPeso(db, await cuenta(db, e, "compra"), e.mat["Fierro pesado"], GRANDE);
    await asentar(db, camioneta, await pesada(db, e, GRANDE, 2860), 1);         // una cuenta que queda abierta
    const antes = await retrato(db);
    const ultimoFolio = BigInt((await una(db, "SELECT max(folio) AS f FROM operacion")).f);

    const carpeta = await mkdtemp(join(tmpdir(), "feruga-respaldo-"));
    const archivo = join(carpeta, "respaldo.dump");
    const destino = "r_" + randomUUID().replaceAll("-", "").slice(0, 20);
    const admin = new pg.Client({ connectionString: LIMPIO, connectionTimeoutMillis: 10_000 });
    await admin.connect();
    try {
      await correr("pg_dump", ["--format=custom", "--file", archivo, urlDe(base)]);

      // El procedimiento en un servidor vacío: primero los roles (el volcado no los trae), luego la base.
      await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feruga_app') THEN CREATE ROLE feruga_app NOLOGIN; END IF;
      END $$`);
      await admin.query(`CREATE DATABASE ${destino}`);
      const urlDestino = new URL(LIMPIO);
      urlDestino.pathname = "/" + destino;
      await correr("pg_restore", ["--exit-on-error", "--no-owner", "--dbname", urlDestino.toString(), archivo]);

      const restaurada = new pg.Client({ connectionString: urlDestino.toString(), connectionTimeoutMillis: 10_000 });
      await restaurada.connect();
      try {
        // 1. Todo lo que había, está, y es igual.
        const despues = await retrato(restaurada);
        assert.deepEqual(despues, antes);
        assert.equal(despues.disparadores.activos, despues.disparadores.total, "ningún disparador quedó apagado");

        // 2. Auditoría: cada renglón confirmado tiene su movimiento, por la cantidad que le toca.
        const sueltos = await una(
          restaurada,
          `SELECT count(*)::int AS n
           FROM operacion_linea l JOIN operacion o ON o.id = l.operacion_id
           LEFT JOIN movimiento_inventario mv ON mv.linea_id = l.id
           WHERE o.estado = 'confirmada'
             AND (mv.id IS NULL OR mv.cantidad_kg <> CASE o.tipo WHEN 'compra' THEN l.peso_recibido ELSE -l.peso_recibido END)`,
        );
        assert.equal(sueltos.n, 0);

        // 3. Se puede seguir trabajando, y el folio siguiente no repite ninguno.
        const nueva = await confirmar(restaurada, await (async () => {
          const op = await cuenta(restaurada, e, "compra");
          await renglon(restaurada, e, op, e.mat["Cartón"], 10);
          return op;
        })(), e.mostrador);
        assert.ok(BigInt(nueva.folio) > ultimoFolio, `el folio ${nueva.folio} debe ser mayor que ${ultimoFolio}`);

        // 4. Las reglas siguen vivas: lo asentado no se toca, y la aplicación sigue sin poder escribir el libro.
        await rechaza(restaurada.query("UPDATE movimiento_inventario SET cantidad_kg = 1"), "RC001");
        const app = await comoApp(destino, LIMPIO);
        try {
          await rechaza(app.query("DELETE FROM movimiento_inventario"), "42501");
          assert.equal((await una(app, "SELECT kg FROM existencia WHERE material_id = $1", [e.mat["Cartón"]])).kg, "84.000");
        } finally {
          await app.end();
        }
      } finally {
        await restaurada.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${destino} WITH (FORCE)`);
      await admin.end();
      await rm(carpeta, { recursive: true, force: true });
    }
  });
});
