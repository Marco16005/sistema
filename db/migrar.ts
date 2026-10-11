// Aplica, en orden, las migraciones de db/migraciones que todavía no estén en la base.
// Cada archivo corre en su propia transacción: o entra completo o no entra.
//
// No se migra con la aplicación atendiendo. Si hay migraciones pendientes, el migrador se niega
// mientras la aplicación tenga conexiones abiertas, y antes de aplicar la primera le cierra la
// puerta de la base. La puerta la vuelve a abrir db/rol.ts, que corre cuando todas entraron: si
// una falla a la mitad, la aplicación se queda fuera hasta que se resuelva.
//
// De cada migración que aplica guarda la huella: la de sus bytes. Con eso se niega a migrar una
// base con una carpeta que no es la continuación de lo que la base ya tiene —una aplicada que
// cambió, una que la carpeta no trae, una nueva que quiere entrar antes de la última—, y lo
// comprueba con su candado tomado, justo antes de aplicar.
//
//   node db/migrar.ts             aplica las pendientes
//   node db/migrar.ts --revisar   dice si se puede y qué aplicaría, sin aplicar ni escribir nada
//   node db/migrar.ts --sellar    a una base de antes de las huellas, le anota las de lo ya aplicado
//
// En operación no se corre a secas. Migrar y sellar cambian la instalación, y eso lo hace una sola
// operación a la vez: la que tiene su candado (operacion/candado.sh) y lo dice pasando su turno.
// A mano: sh operacion/migrar.sh
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { exigirEntorno } from "../src/servidor/entorno.ts";
import { SQL_DE_TABLAS, SQL_DE_VIDA, SQL_NADA_FALTA } from "../src/servidor/esquema.ts";

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), "migraciones");

// Un número cualquiera, propio del migrador: quien lo tiene es el único que migra esa base.
const CANDADO = 7150;

/** Lo que una carpeta de migraciones le haría a una base. */
export interface Revision {
  /** Lo que falta por aplicar, en orden. */
  pendientes: string[];
  /** Aplicadas sin huella guardada: vienen de antes de que el migrador las guardara. */
  sinHuella: string[];
  /** Por qué con esta carpeta no se puede migrar esta base. Vacío: se puede. */
  impedimentos: string[];
}

export interface AlMigrar {
  /**
   * Sellar las aplicadas que no tengan huella, con los archivos de esta misma carpeta, antes de
   * seguir. Solo en desarrollo: en operación se sella aparte, a propósito y con la versión que corre.
   */
  sellarLoQueFalte?: boolean;
  /** A dónde va lo que el migrador tiene que avisar. */
  decir?: (linea: string) => void;
}

interface Migracion {
  sql: string;
  huella: string;
}

/** Lo que la base dice de una migración aplicada. */
interface Aplicada {
  /** Nula: se aplicó antes de que el migrador guardara huellas, y nadie la ha sellado. */
  huella: string | null;
  /** La huella no se guardó al aplicarla: se anotó después. */
  sellada: boolean;
}

/** Con el candado del migrador tomado. Si dos arrancan a la vez, el segundo espera aquí. */
async function conCandado<T>(cliente: pg.Client, tarea: () => Promise<T>): Promise<T> {
  await cliente.query("SELECT pg_advisory_lock($1)", [CANDADO]);
  try {
    return await tarea();
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CANDADO]);
  }
}

export async function migrar(cliente: pg.Client, carpeta = CARPETA, opciones: AlMigrar = {}): Promise<string[]> {
  // Lo que la base tiene se mira adentro, con el candado tomado: lo que valía antes de esperar el
  // turno ya no vale si otro migrador aplicó algo mientras.
  return conCandado(cliente, () => aplicarPendientes(cliente, carpeta, opciones));
}

/** Qué haría el migrador con esta carpeta en esta base. No aplica ni escribe nada: solo mira. */
export async function revisar(cliente: pg.Client, carpeta = CARPETA): Promise<Revision> {
  return comparar(await leerCarpeta(carpeta), await aplicadasEn(cliente));
}

/**
 * A una base de antes de las huellas, le anota las de lo ya aplicado. Se hace una vez, a propósito,
 * y con la versión que está corriendo —no con la candidata que se quiere publicar—: por eso se niega
 * si la carpeta no trae exactamente lo que la base tiene. Es confianza, no verificación: lo que
 * de verdad se aplicó ya no se puede comparar, y por eso queda dicho cuáles son un sello. Las que
 * ya tienen huella no se tocan. Devuelve las que selló.
 */
export async function sellar(cliente: pg.Client, carpeta = CARPETA): Promise<string[]> {
  return conCandado(cliente, async () => {
    const archivos = await leerCarpeta(carpeta);
    const revision = comparar(archivos, await aplicadasEn(cliente));
    if (revision.impedimentos.length > 0) throw new Error(`${queja(revision.impedimentos)}\nNo se selló nada.`);
    if (revision.sinHuella.length === 0) return [];
    if (revision.pendientes.length > 0) {
      throw new Error(
        `Estas migraciones traen ${cuantas(revision.pendientes.length)} que la base no tiene (${revision.pendientes.join(", ")}): ` +
          "no es la versión que está corriendo. Se sella con la versión vigente, no con la que se quiere publicar. No se selló nada.",
      );
    }
    await ponerSello(cliente, archivos, revision.sinHuella);
    return revision.sinHuella;
  });
}

const cuantas = (n: number): string => (n === 1 ? "1 migración" : `${n} migraciones`);
const queja = (impedimentos: string[]): string => `Con estas migraciones no se puede migrar esta base:\n  · ${impedimentos.join("\n  · ")}`;

/** Lo que hay que decir de una base con migraciones aplicadas sin huella. */
function avisoDeSinHuella(sinHuella: string[]): string {
  return (
    `${cuantas(sinHuella.length)} ya ${sinHuella.length === 1 ? "aplicada no tiene" : "aplicadas no tienen"} huella guardada ` +
    `(${sinHuella[0]}${sinHuella.length > 1 ? ` … ${sinHuella.at(-1)}` : ""}): no se puede comprobar que no cambiaron. ` +
    "Séllalas una vez, con la versión que está corriendo: node db/migrar.ts --sellar"
  );
}

/** Cada migración de la carpeta, leída una sola vez: lo que se compara es lo mismo que se aplica. */
async function leerCarpeta(carpeta: string): Promise<Map<string, Migracion>> {
  const archivos = new Map<string, Migracion>();
  for (const archivo of (await readdir(carpeta)).filter((a) => a.endsWith(".sql")).sort()) {
    const bytes = await readFile(join(carpeta, archivo));
    archivos.set(archivo, { sql: bytes.toString("utf8"), huella: createHash("sha256").update(bytes).digest("hex") });
  }
  return archivos;
}

/** Lo aplicado en la base, con su huella si la tiene. Solo lee: sirve en una base vacía y en una de antes de las huellas. */
async function aplicadasEn(cliente: pg.Client): Promise<Map<string, Aplicada>> {
  const { rows: [hay] } = await cliente.query(
    `SELECT to_regclass('public.migracion') IS NOT NULL AS registro,
            EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'migracion' AND column_name = 'huella') AS huellas`,
  );
  if (!hay.registro) return new Map();
  const { rows } = await cliente.query(
    `SELECT archivo, ${hay.huellas ? "huella, sellada_en IS NOT NULL AS sellada" : "NULL AS huella, false AS sellada"} FROM migracion`,
  );
  return new Map(rows.map((f) => [f.archivo as string, { huella: f.huella as string | null, sellada: f.sellada as boolean }]));
}

function comparar(archivos: Map<string, Migracion>, aplicadas: Map<string, Aplicada>): Revision {
  const impedimentos: string[] = [];
  const hechas = [...aplicadas.keys()].sort();
  for (const archivo of hechas) {
    const enLaCarpeta = archivos.get(archivo);
    const { huella } = aplicadas.get(archivo)!;
    if (!enLaCarpeta) impedimentos.push(`${archivo} está aplicada en la base y esta versión no la trae: la base es de otra versión`);
    else if (huella !== null && huella !== enLaCarpeta.huella) {
      impedimentos.push(`${archivo} cambió después de aplicarse: una migración aplicada no se corrige, se agrega otra`);
    }
  }
  const ultima = hechas.at(-1);
  const pendientes = [...archivos.keys()].filter((a) => !aplicadas.has(a)).sort();
  for (const archivo of pendientes) {
    if (ultima !== undefined && archivo < ultima) {
      impedimentos.push(`${archivo} va antes de la última aplicada (${ultima}): una migración nueva lleva un número mayor`);
    }
  }
  return { pendientes, sinHuella: hechas.filter((a) => aplicadas.get(a)!.huella === null), impedimentos };
}

/** Dónde se anota lo aplicado. Se crea, o se le agrega dónde guardar las huellas, solo si falta. */
async function asegurarRegistro(cliente: pg.Client): Promise<void> {
  await cliente.query(
    `CREATE TABLE IF NOT EXISTS migracion (
       archivo text PRIMARY KEY,
       aplicada_en timestamptz NOT NULL DEFAULT now(),
       huella text,
       sellada_en timestamptz
     )`,
  );
  const { rows } = await cliente.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'migracion' AND column_name IN ('huella', 'sellada_en')",
  );
  if (rows.length < 2) await cliente.query("ALTER TABLE migracion ADD COLUMN IF NOT EXISTS huella text, ADD COLUMN IF NOT EXISTS sellada_en timestamptz");
}

/** Anota la huella de esas, que no la tenían, y que se anotó después de aplicarlas. Todas o ninguna. */
async function ponerSello(cliente: pg.Client, archivos: Map<string, Migracion>, cuales: string[]): Promise<void> {
  await cliente.query("BEGIN");
  try {
    await asegurarRegistro(cliente);
    for (const archivo of cuales) {
      await cliente.query("UPDATE migracion SET huella = $2, sellada_en = now() WHERE archivo = $1", [archivo, archivos.get(archivo)!.huella]);
    }
    await cliente.query("COMMIT");
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  }
}

/** Las conexiones a esta base que no son de administración: las de la aplicación. */
async function conexionesDeLaAplicacion(cliente: pg.Client): Promise<number> {
  const { rows } = await cliente.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity a JOIN pg_roles r ON r.rolname = a.usename
     WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND NOT r.rolsuper`,
  );
  return rows[0].n;
}

/** Quita o da el permiso de entrar a esta base. A quién: a cualquiera («PUBLIC») o al grupo de la aplicación. */
export async function puerta(cliente: pg.Client, que: "GRANT" | "REVOKE", aQuien: "PUBLIC" | "feruga_app"): Promise<void> {
  // El nombre de una base no se puede pasar como parámetro: la base arma la instrucción con sus propias comillas.
  const { rows } = await cliente.query(
    `SELECT format('${que} CONNECT ON DATABASE %I ${que === "GRANT" ? "TO" : "FROM"} ${aQuien}', current_database()) AS sql`,
  );
  await cliente.query(rows[0].sql);
}

/** Le cierra la puerta de la base a la aplicación. Se niega si la aplicación está adentro. */
async function cerrarLaPuerta(cliente: pg.Client): Promise<void> {
  const adentro = async (): Promise<void> => {
    const n = await conexionesDeLaAplicacion(cliente);
    if (n > 0) {
      throw new Error(
        `La aplicación sigue conectada a la base (${n} ${n === 1 ? "conexión" : "conexiones"}): deténla antes de migrar. No se aplicó nada.`,
      );
    }
  };
  await adentro();
  const { rows: [antes] } = await cliente.query(
    `SELECT has_database_privilege('public', current_database(), 'CONNECT') AS cualquiera,
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feruga_app') AS hay_grupo`,
  );
  await puerta(cliente, "REVOKE", "PUBLIC");
  if (antes.hay_grupo) await puerta(cliente, "REVOKE", "feruga_app");
  try {
    // Entre la primera mirada y el cierre pudo entrar alguien: se mira otra vez, ya con la puerta cerrada.
    await adentro();
  } catch (e) {
    await puerta(cliente, "GRANT", antes.cualquiera || !antes.hay_grupo ? "PUBLIC" : "feruga_app");
    throw e;
  }
}

/**
 * ¿La base está emparejada con este servidor? Lo decide el mismo texto que usa la aplicación, no
 * una función de la base. Falso también mientras la base no tiene con qué saberlo (antes de la 0023).
 */
async function emparejada(cliente: pg.Client, pregunta: string = SQL_DE_VIDA): Promise<boolean> {
  const { rows: [marca] } = await cliente.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'vida' AND column_name = 'tablas') AS hay`,
  );
  if (!marca.hay) return false;
  return (await cliente.query(pregunta)).rows[0].vigente === true;
}

async function aplicarPendientes(cliente: pg.Client, carpeta: string, opciones: AlMigrar): Promise<string[]> {
  const decir = opciones.decir ?? (() => {});
  const archivos = await leerCarpeta(carpeta);
  const { pendientes, sinHuella, impedimentos } = comparar(archivos, await aplicadasEn(cliente));
  if (impedimentos.length > 0) throw new Error(`${queja(impedimentos)}\nNo se aplicó nada.`);
  let faltanHuellas = sinHuella.length > 0;
  if (faltanHuellas && opciones.sellarLoQueFalte) {
    await ponerSello(cliente, archivos, sinHuella);
    decir(`Se selló ${cuantas(sinHuella.length)} que ya ${sinHuella.length === 1 ? "estaba aplicada" : "estaban aplicadas"}, con los archivos de esta carpeta.`);
    faltanHuellas = false;
  }
  if (pendientes.length === 0) {
    // Sin nada que aplicar no se toca nada; pero que no se pueda comprobar lo aplicado, se dice.
    if (faltanHuellas) decir(avisoDeSinHuella(sinHuella));
    return [];
  }
  if (faltanHuellas) throw new Error(`${avisoDeSinHuella(sinHuella)}\nNo se aplicó nada.`);

  await cerrarLaPuerta(cliente);
  await asegurarRegistro(cliente);
  const aplicadas: string[] = [];
  for (const archivo of pendientes) {
    const { sql, huella } = archivos.get(archivo)!;
    await cliente.query("BEGIN");
    try {
      // Migrar nunca empareja. Lo que la migración crea entra a la marca de la base solo si:
      //  · ANTES de aplicarla la base estaba emparejada —sus tablas eran exactamente las conocidas—:
      //    así, lo que haya de más después lo creó esta migración y no una restauración; y
      //  · DESPUÉS no falta nada de lo conocido: una tabla que la migración quitó o recreó sin
      //    decirlo (vida_retirar) deja la base sin emparejar, que es lo que debe pasar.
      const antes = await emparejada(cliente);
      await cliente.query(sql);
      if (antes && (await emparejada(cliente, SQL_NADA_FALTA))) await cliente.query(`UPDATE vida SET tablas = (${SQL_DE_TABLAS})`);
      await cliente.query("INSERT INTO migracion (archivo, huella) VALUES ($1, $2)", [archivo, huella]);
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw new Error(
        `Falló la migración ${archivo}: ${(e as Error).message}. ` +
          `Las anteriores quedaron aplicadas (${aplicadas.length}) y la base sigue cerrada para la aplicación hasta que esta entre.`,
      );
    }
    aplicadas.push(archivo);
  }
  return aplicadas;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const orden = args.length === 0 ? "migrar" : args.length === 1 && (args[0] === "--revisar" || args[0] === "--sellar") ? args[0] : null;
  // Una orden mal escrita no es «migrar»: se detiene antes de tocar la base.
  if (!orden) throw new Error(`No conozco «${args.join(" ")}». Uso: node db/migrar.ts [--revisar | --sellar]`);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  exigirEntorno(process.env, ["administracion", "conexion"]);
  if (orden !== "--revisar" && process.env.MODO !== "desarrollo" && !process.env.OPERACION_TURNO) {
    throw new Error(
      "En operación el migrador no corre a secas: lo corre quien tiene el candado de la instalación. " +
        "A mano: sh operacion/migrar.sh (para solo mirar, --revisar no lo pide).",
    );
  }
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    if (orden === "--revisar") {
      const aplicadas = await aplicadasEn(cliente);
      const { pendientes, sinHuella, impedimentos } = comparar(await leerCarpeta(CARPETA), aplicadas);
      // Para publicar, una base sin huellas tampoco pasa: primero se sella.
      const quejas = [...impedimentos, ...(sinHuella.length > 0 ? [avisoDeSinHuella(sinHuella)] : [])];
      if (quejas.length > 0) {
        console.error(queja(quejas));
        process.exitCode = 1;
      } else {
        const selladas = [...aplicadas.values()].filter((a) => a.sellada).length;
        const deEllas = selladas > 0 ? ` (${selladas} con la huella sellada después de aplicarse: eso es confianza, no verificación)` : "";
        console.log(
          pendientes.length > 0
            ? `Se puede migrar: ${aplicadas.size} migraciones ya aplicadas${deEllas}, iguales a las de esta versión. Pendientes (${pendientes.length}): ${pendientes.join(", ")}`
            : `La base está al día con esta versión: ${aplicadas.size} migraciones aplicadas, ninguna pendiente${deEllas}.`,
        );
      }
    } else if (orden === "--sellar") {
      const selladas = await sellar(cliente);
      console.log(
        selladas.length > 0
          ? `Se selló ${cuantas(selladas.length)} que ya ${selladas.length === 1 ? "estaba aplicada" : "estaban aplicadas"}, con los archivos de esta versión. ` +
              "Es confianza, no verificación: lo que de verdad se aplicó ya no se puede comparar."
          : "No había nada que sellar: todo lo aplicado ya tiene su huella.",
      );
    } else {
      const aplicadas = await migrar(cliente, CARPETA, { sellarLoQueFalte: process.env.MODO === "desarrollo", decir: (linea) => console.error(linea) });
      console.log(aplicadas.length ? `aplicadas: ${aplicadas.join(", ")}` : "la base ya estaba al día");
    }
  } finally {
    await cliente.end();
  }
}
