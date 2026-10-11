// Lo que comparten las pruebas de restaurar y de respaldar: un patio con un poco de todo, el retrato
// que debe quedar idéntico después de volver de un respaldo, el servidor vacío donde se restaura y
// una mirada a los procesos vivos, para ver que ningún secreto viaja a la vista.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { compraDe, conApp, equipoDeAlta, personaConClave, una, urlDe } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";

export const correr = promisify(execFile);
export const LIMPIO = process.env.PG_RESTAURA_URL ?? "postgres://feruga:desarrollo@localhost:54330/postgres";

/** Un par de llaves de age, como el que el dueño genera fuera del servidor. */
export async function llaves(): Promise<{ publica: string; privada: string }> {
  const { stdout } = await correr("age-keygen");
  return { publica: /public key: (age1[0-9a-z]+)/.exec(stdout)![1]!, privada: stdout };
}

/** Vuelca la base y la cifra con la llave pública, como hace el respaldo. Devuelve el archivo cifrado. */
export async function respaldoCifrado(base: string, carpeta: string, publica: string, nombre = "respaldo"): Promise<string> {
  const claro = join(carpeta, `${nombre}.dump`);
  const cifrado = `${claro}.age`;
  await correr("pg_dump", ["--format=custom", "--file", claro, urlDe(base)]);
  await correr("age", ["-r", publica, "-o", cifrado, claro]);
  await rm(claro);
  return cifrado;
}

/** Lo que debe ser idéntico antes de respaldar y después de restaurar. */
export async function retrato(db: pg.Client) {
  const filas = async (sql: string) => (await db.query(sql)).rows;
  return {
    existencia: await filas("SELECT nombre, kg FROM existencia ORDER BY nombre"),
    movimientos: await filas("SELECT id, material_id, tipo, cantidad_kg, jornada_id, linea_id, referencia_id, motivo, autorizado_por FROM movimiento_inventario ORDER BY id"),
    operaciones: await filas("SELECT id, tipo, estado, folio, suma, ajuste_redondeo, total, cliente_id, cliente_nombre FROM operacion ORDER BY creada_en, id"),
    renglones: await filas("SELECT id, operacion_id, material_id, peso_bruto, tara, descuento_kg, precio_unitario, precio_lista, precio_autorizado_por, precio_evento FROM operacion_linea ORDER BY operacion_id, creada_en, id"),
    clientes: await filas("SELECT id, nombre, activo, creado_por FROM cliente ORDER BY id"),
    preciosEspeciales: await filas("SELECT id, clase, operacion_id, linea_id, material_id, cliente_id, cliente_nombre, precio_lista, precio_anterior, precio_nuevo, capturado_por, autorizado_por, anterior_id, creado_en, transaccion::text AS transaccion FROM precio_especial ORDER BY id"),
    personas: await filas("SELECT id, nombre, rol, puede_autorizar, activo FROM usuario ORDER BY id"),
    credenciales: await filas("SELECT usuario_id, md5(huella) AS huella FROM credencial ORDER BY usuario_id"),
    equipos: await filas("SELECT id, nombre, md5(huella) AS huella, baja_en FROM equipo ORDER BY id"),
    impresiones: await filas("SELECT id, operacion_id, numero, motivo, impresa_por FROM impresion ORDER BY operacion_id, numero"),
    envios: await filas("SELECT id, clase, contenido, recibido_de FROM envio ORDER BY id"),
    resultados: await filas("SELECT envio_id, conteo_id, movimiento_id, transformacion_id, ajustes, jornada_id, cierre, reapertura_id, precio_especial_id FROM envio_resultado ORDER BY envio_id"),
    jornadas: await filas("SELECT id, fecha, abierta_por, cerrada_en, cerrada_por, cierres FROM jornada ORDER BY id"),
    reaperturas: await filas("SELECT id, jornada_id, cierre, cerrada_en, cerrada_por, reabierta_en, pedida_por, autorizada_por FROM reapertura ORDER BY id"),
    bitacora: await filas("SELECT id, accion, entidad, entidad_id, detalle FROM bitacora WHERE accion <> 'registrar_restauracion' ORDER BY id"),
    mantenimiento: await una(db, "SELECT abierta, motivo, publicacion, decidida_en, abrio_en, cambio_en FROM mantenimiento"),
    disparadores: await una(db, "SELECT count(*)::int AS total, count(*) FILTER (WHERE tgenabled = 'O')::int AS activos FROM pg_trigger WHERE NOT tgisinternal"),
  };
}

export interface Patio {
  app: pg.Client;
  db: pg.Client;
  e: Escenario;
  base: string;
  huella: string;
  rosa: string;
  /** Un envío de merma que sí entró, y uno que se canceló. */
  merma: { envio: string; movimiento: string };
  cancelado: string;
}

/** Un día con un poco de todo: identidad, operaciones impresas, envíos de inventario y una cancelación. */
export const conPatio = (prueba: (p: Patio) => Promise<void>) =>
  conApp(async (app, db, e, base) => {
    const carton = e.mat["Cartón"];
    await db.query("SELECT fijar_clave($1, $2)", [e.responsable, "481516"]);
    const huella = await equipoDeAlta(db);
    const rosa = await personaConClave(db, "Rosa", "mostrador", "4815");
    assert.ok((await una(app, "SELECT entrar($1, $2, $3) AS s", [huella, rosa, "4815"])).s);
    await db.query("SELECT registrar_apertura($1, 500, 'contado', $2)", [carton, e.responsable]);
    const compra = await compraDe(db, e, carton, 100);
    await app.query("SELECT registrar_impresion($1, $2, NULL, $3)", [randomUUID(), compra, e.mostrador]);
    const envio = randomUUID();
    const m = await una(app, "SELECT * FROM dar_merma($1, $2, 10, 'Mojado', $3)", [envio, carton, e.mostrador]);
    const cancelado = randomUUID();
    await app.query("SELECT cancelar_envio($1, $2)", [cancelado, e.mostrador]);
    await prueba({ app, db, e, base, huella, rosa, merma: { envio, movimiento: m.id }, cancelado });
  });

/** Corre algo con un nombre de base libre en el servidor vacío, y al final no deja nada ahí. */
export async function conDestino<T>(hacer: (destino: string, admin: pg.Client) => Promise<T>): Promise<T> {
  const destino = "r_" + randomUUID().replaceAll("-", "").slice(0, 20);
  const admin = new pg.Client({ connectionString: LIMPIO, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  try {
    return await hacer(destino, admin);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${destino} WITH (FORCE)`);
    await admin.query(`DROP DATABASE IF EXISTS ${destino}_restaurando WITH (FORCE)`);
    await admin.end();
  }
}

export const basesCon = async (admin: pg.Client, prefijo: string): Promise<string[]> =>
  (await admin.query("SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY 1", [prefijo + "%"])).rows.map((f) => f.datname);

export const urlEn = (servidor: string, base: string): string => {
  const u = new URL(servidor);
  u.pathname = "/" + base;
  return u.toString();
};

export interface Proceso {
  /** Sus argumentos, separados por un carácter nulo: lo que ve cualquiera en la máquina con «ps». */
  argumentos: string;
  /** Su entorno: lo ve el mismo usuario y el administrador. */
  entorno: string;
}

/** Los procesos vivos cuyo programa es ese, con sus argumentos y su entorno. */
export async function procesos(programa: string): Promise<Proceso[]> {
  const vistos: Proceso[] = [];
  for (const pid of (await readdir("/proc")).filter((x) => /^\d+$/.test(x))) {
    try {
      const argumentos = await readFile(`/proc/${pid}/cmdline`, "utf8");
      if (argumentos.split("\0")[0] !== programa) continue;
      vistos.push({ argumentos, entorno: await readFile(`/proc/${pid}/environ`, "utf8") });
    } catch {
      // El proceso ya terminó, o no es nuestro.
    }
  }
  return vistos;
}

/** Alguien que entra a ese servidor con una clave que no se parece a ninguna otra, para buscarla donde no debe estar. La dirección conserva la base de la que se dio. */
export async function administradorConClave(
  servidor: string, o: { administra: boolean } = { administra: true },
): Promise<{ url: string; clave: string; quitar: () => Promise<void> }> {
  const nombre = "adm_" + randomUUID().replaceAll("-", "").slice(0, 16);
  const clave = "Clave" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: servidor, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  try {
    // Sin administrar, es alguien que puede conectarse y nada más: no lee ninguna tabla.
    await admin.query(`CREATE ROLE ${nombre} LOGIN ${o.administra ? "SUPERUSER" : ""} PASSWORD '${clave}'`);
  } finally {
    await admin.end();
  }
  const u = new URL(servidor);
  u.username = nombre;
  u.password = clave;
  return {
    url: u.toString(), clave,
    quitar: async () => {
      const otra = new pg.Client({ connectionString: servidor, connectionTimeoutMillis: 10_000 });
      await otra.connect();
      try {
        // Primero lo que se le haya concedido en esta base: con permisos pendientes el rol no se puede quitar.
        await otra.query(`DROP OWNED BY ${nombre}`);
        await otra.query(`DROP ROLE IF EXISTS ${nombre}`);
      } finally {
        await otra.end();
      }
    },
  };
}
