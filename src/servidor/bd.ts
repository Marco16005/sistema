// La puerta del servidor a la base. Cada acción corre en su propia transacción, en READ COMMITTED,
// con una conexión reservada de principio a fin, y deja dicho quién la hizo para la bitácora.
import pg from "pg";
import { traducir } from "./errores.ts";

/** El identificador de una persona tal como lo entrega la base (bigint, como texto). */
export type Persona = string;

export interface Bd {
  /** Una consulta suelta de lectura. */
  leer<F extends Record<string, any> = Record<string, any>>(sql: string, valores?: unknown[]): Promise<F[]>;
  /** Una acción completa: o queda escrita entera o no queda nada. */
  enTransaccion<T>(persona: Persona | null, accion: (c: pg.PoolClient) => Promise<T>): Promise<T>;
  /**
   * Varias lecturas que ven la misma foto de la base: una transacción de solo lectura en
   * REPEATABLE READ, en una sola conexión. Lo que se escriba mientras tanto no se ve a medias.
   */
  instantanea<T>(accion: (bd: Bd) => Promise<T>): Promise<T>;
  cerrar(): Promise<void>;
}

export interface OpcionesBd {
  conexiones?: number;
  /** Cuánto esperar una conexión antes de darse por vencido. */
  esperaMs?: number;
}

export function crearBd(url: string, opciones: OpcionesBd = {}): Bd {
  const pool = new pg.Pool({
    connectionString: url,
    max: opciones.conexiones ?? 10,
    connectionTimeoutMillis: opciones.esperaMs ?? 10_000,
    idleTimeoutMillis: 30_000,
    // Ninguna consulta debe tardar: si una se queda detenida, que falle en vez de colgar al mostrador.
    statement_timeout: 20_000,
    application_name: "feruga-web",
  });
  // Una conexión ociosa que se cae no debe tumbar el proceso: el pool la repone.
  pool.on("error", () => {});

  return {
    async leer(sql, valores = []) {
      try {
        return (await pool.query(sql, valores)).rows;
      } catch (e) {
        throw traducir(e);
      }
    },

    async enTransaccion(persona, accion) {
      const c = await pool.connect();
      // Mientras la conexión está reservada, el pool ya no la cuida. Si se cae a media acción, el
      // cliente avisa con un evento; sin nadie que lo escuche, ese aviso tumba el proceso entero.
      let caida = false;
      const alCaerse = (): void => {
        caida = true;
      };
      c.on("error", alCaerse);
      let inservible = false;
      try {
        await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        // Vale solo dentro de esta transacción: al terminar, la conexión vuelve al pool sin persona.
        await c.query("SELECT set_config('feruga.usuario', $1, true)", [persona ?? ""]);
        const resultado = await accion(c);
        await c.query("COMMIT");
        return resultado;
      } catch (e) {
        if (!caida) {
          try {
            await c.query("ROLLBACK");
          } catch {
            inservible = true;
          }
        }
        throw traducir(e);
      } finally {
        c.removeListener("error", alCaerse);
        // Una conexión caída o que no pudo deshacer no vuelve al pool: se destruye y el pool abre otra.
        c.release(caida || inservible);
      }
    },

    async instantanea(accion) {
      const c = await pool.connect();
      let caida = false;
      const alCaerse = (): void => {
        caida = true;
      };
      c.on("error", alCaerse);
      let inservible = false;
      try {
        await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const misma: Bd = {
          async leer(sql, valores = []) {
            return (await c.query(sql, valores)).rows;
          },
          enTransaccion: () => Promise.reject(new Error("Dentro de una instantánea solo se lee")),
          instantanea: (otra) => otra(misma),
          cerrar: async () => {},
        };
        const resultado = await accion(misma);
        await c.query("COMMIT");
        return resultado;
      } catch (e) {
        if (!caida) {
          try {
            await c.query("ROLLBACK");
          } catch {
            inservible = true;
          }
        }
        throw traducir(e);
      } finally {
        c.removeListener("error", alCaerse);
        c.release(caida || inservible);
      }
    },

    cerrar: () => pool.end(),
  };
}

let actual: Bd | null = null;
let propia = false;

/** La base del servidor. Se conecta al primer uso, nunca al cargar el módulo: construir la aplicación no la necesita. */
export function bd(): Bd {
  if (!actual) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    actual = crearBd(url);
    propia = true;
  }
  return actual;
}

/** Para las pruebas: hace que las rutas usen esta base. Con null vuelve a la del entorno. */
export function usarBd(otra: Bd | null): void {
  if (propia && actual) void actual.cerrar();
  actual = otra;
  propia = false;
}
