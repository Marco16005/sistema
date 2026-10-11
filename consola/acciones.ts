// Lo que hace la consola de administración. Cada acción llama a las funciones de la base que la
// aplicación no puede ejecutar; por eso la consola corre con otras credenciales.
import { randomInt } from "node:crypto";
import type pg from "pg";

export type Rol = "responsable" | "mostrador" | "patio" | "consulta" | "administracion";

export interface PersonaConClave {
  id: string;
  nombre: string;
  rol: Rol;
  /** Se muestra una sola vez: la base guarda solo su huella. */
  clave: string;
}

const largoDeClave = (rol: Rol): number => (rol === "responsable" || rol === "administracion" ? 6 : 4);
const claveAlAzar = (digitos: number): string => String(randomInt(0, 10 ** digitos)).padStart(digitos, "0");
const esRechazoDeLaBase = (e: unknown): boolean => (e as { code?: string }).code === "RC005";

/** Intenta con claves al azar hasta que la base admita una: rechaza las que se adivinan solas. */
async function conClaveNueva<T>(digitos: number, intentar: (clave: string) => Promise<T>): Promise<T> {
  for (let k = 0; ; k++) {
    try {
      return await intentar(claveAlAzar(digitos));
    } catch (e) {
      if (!esRechazoDeLaBase(e) || !/se adivina sola/.test((e as Error).message) || k >= 20) throw e;
    }
  }
}

export async function altaDePersona(
  db: pg.Client, datos: { nombre: string; rol: Rol; autoriza?: boolean; clave?: string },
): Promise<PersonaConClave> {
  const alta = async (clave: string): Promise<PersonaConClave> => {
    const { rows } = await db.query("SELECT * FROM alta_persona($1, $2, $3, $4)", [
      datos.nombre, datos.rol, datos.autoriza ?? false, clave,
    ]);
    return { id: rows[0].id, nombre: rows[0].nombre, rol: rows[0].rol, clave };
  };
  return datos.clave ? alta(datos.clave) : conClaveNueva(largoDeClave(datos.rol), alta);
}

/** Encuentra a una persona por su número, o por su nombre entre las activas. */
async function buscarPersona(db: pg.Client, quien: string): Promise<{ id: string; nombre: string; rol: Rol }> {
  const { rows } = /^[0-9]+$/.test(quien)
    ? await db.query("SELECT id, nombre, rol FROM usuario WHERE id = $1", [quien])
    : await db.query("SELECT id, nombre, rol FROM usuario WHERE activo AND lower(btrim(nombre)) = lower(btrim($1))", [quien]);
  if (rows.length !== 1) throw new Error(`No hay ninguna persona activa que sea «${quien}»`);
  return rows[0];
}

export async function cambiarClave(db: pg.Client, quien: string, clave?: string): Promise<PersonaConClave> {
  const p = await buscarPersona(db, quien);
  const fijar = async (nueva: string): Promise<PersonaConClave> => {
    await db.query("SELECT fijar_clave($1, $2)", [p.id, nueva]);
    return { ...p, clave: nueva };
  };
  return clave ? fijar(clave) : conClaveNueva(largoDeClave(p.rol), fijar);
}

export async function bajaDePersona(db: pg.Client, quien: string): Promise<{ id: string; nombre: string }> {
  const p = await buscarPersona(db, quien);
  await db.query("SELECT baja_persona($1)", [p.id]);
  return p;
}

export interface PersonaEnLista {
  id: string;
  nombre: string;
  rol: Rol;
  autoriza: boolean;
  activa: boolean;
  bloqueada: boolean;
}

export async function listaDePersonas(db: pg.Client): Promise<PersonaEnLista[]> {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.rol, u.puede_autorizar AS autoriza, u.activo AS activa,
            coalesce(c.bloqueada_hasta > clock_timestamp(), false) AS bloqueada
     FROM usuario u LEFT JOIN credencial c ON c.usuario_id = u.id
     ORDER BY u.id`,
  );
  return rows;
}

// ── clientes con precio especial ───────────────────────────────────────────
//
// Un cliente se da de alta en la pantalla, al darle su primer precio especial. Aquí se le corrige
// el nombre, se le da de baja y se le reactiva.

export interface ClienteEnLista {
  id: string;
  nombre: string;
  activo: boolean;
  /** Cuántas veces se le ha dado precio especial. */
  preciosDados: number;
}

export async function listaDeClientes(db: pg.Client): Promise<ClienteEnLista[]> {
  const { rows } = await db.query(
    `SELECT c.id, c.nombre, c.activo,
            (SELECT count(*)::int FROM precio_especial pe WHERE pe.cliente_id = c.id AND pe.clase = 'dar') AS "preciosDados"
     FROM cliente c ORDER BY c.id`,
  );
  return rows;
}

/** Encuentra a un cliente por su número o por su nombre, esté activo o no. */
async function buscarCliente(db: pg.Client, quien: string): Promise<{ id: string; nombre: string }> {
  const { rows } = /^[0-9]+$/.test(quien)
    ? await db.query("SELECT id, nombre FROM cliente WHERE id = $1", [quien])
    : await db.query("SELECT id, nombre FROM cliente WHERE lower(nombre) = lower(nombre_de_cliente($1))", [quien]);
  if (rows.length !== 1) throw new Error(`No hay ningún cliente que sea «${quien}»`);
  return rows[0];
}

const hechoCon = async (db: pg.Client, sql: string, valores: unknown[]): Promise<{ id: string; nombre: string }> => {
  const { rows } = await db.query(sql, valores);
  return { id: rows[0].id, nombre: rows[0].nombre };
};

export async function renombrarCliente(db: pg.Client, quien: string, nombre: string): Promise<{ id: string; nombre: string }> {
  return hechoCon(db, "SELECT id, nombre FROM renombrar_cliente($1, $2)", [(await buscarCliente(db, quien)).id, nombre]);
}

export async function bajaDeCliente(db: pg.Client, quien: string): Promise<{ id: string; nombre: string }> {
  return hechoCon(db, "SELECT id, nombre FROM baja_de_cliente($1)", [(await buscarCliente(db, quien)).id]);
}

export async function reactivarCliente(db: pg.Client, quien: string): Promise<{ id: string; nombre: string }> {
  return hechoCon(db, "SELECT id, nombre FROM reactivar_cliente($1)", [(await buscarCliente(db, quien)).id]);
}

/** Genera un código para dar de alta un equipo. Sirve una vez y vence en quince minutos. */
export async function codigoDeEquipo(db: pg.Client, nombre: string): Promise<string> {
  return (await db.query("SELECT crear_codigo_alta($1) AS codigo", [nombre])).rows[0].codigo;
}

export async function bajaDeEquipo(db: pg.Client, id: string): Promise<void> {
  await db.query("SELECT baja_equipo($1)", [id]);
}

export interface EquipoEnLista {
  id: string;
  nombre: string;
  alta: Date;
  vigente: boolean;
  /** Quién atiende ahí en este momento, si hay alguien. */
  atiende: string | null;
}

export async function listaDeEquipos(db: pg.Client): Promise<EquipoEnLista[]> {
  const { rows } = await db.query(
    `SELECT e.id, e.nombre, e.alta_en AS alta, e.baja_en IS NULL AS vigente,
            (SELECT u.nombre FROM sesion s JOIN usuario u ON u.id = s.usuario_id
             WHERE s.equipo_id = e.id AND s.cerrada_en IS NULL) AS atiende
     FROM equipo e ORDER BY e.alta_en, e.id`,
  );
  return rows;
}

/**
 * El primer arranque: si no hay ningún responsable activo, da de alta uno; si no hay ningún equipo
 * vigente, reparte un código para el primero. Se puede correr las veces que sea: lo que ya está
 * no lo toca, y lo que no hizo viene vacío.
 */
export async function arranque(
  db: pg.Client, nombres: { responsable: string; equipo: string },
): Promise<{ persona: PersonaConClave | null; codigo: string | null }> {
  const hayResponsable = (await db.query("SELECT 1 FROM usuario WHERE activo AND rol = 'responsable' LIMIT 1")).rows.length > 0;
  const hayEquipo = (await db.query("SELECT 1 FROM equipo WHERE baja_en IS NULL LIMIT 1")).rows.length > 0;
  return {
    persona: hayResponsable ? null : await altaDePersona(db, { nombre: nombres.responsable, rol: "responsable", autoriza: true }),
    codigo: hayEquipo ? null : await codigoDeEquipo(db, nombres.equipo),
  };
}
