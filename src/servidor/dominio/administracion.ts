// Personas y equipos desde la pantalla (migración 0031). Lo pide un responsable facultado para
// autorizar, y lo demuestra con su clave en ese momento; la base decide —quién puede, a quién se
// le puede, y si la clave pasó— y aquí solo se le pregunta. Cada pedido va en su propia
// transacción, para que una clave que no pasó quede contada aunque no se haga nada más.
//
// La clave de una persona nueva (o la nueva de una que ya estaba) se sortea aquí y se devuelve una
// sola vez: la base guarda solo su huella, y nadie la vuelve a ver.
import { randomInt } from "node:crypto";
import type { Bd, Persona } from "../bd.ts";
import { ErrorDeNegocio } from "../errores.ts";
import type { Rol } from "../sesion.ts";

export const ROLES: readonly Rol[] = ["responsable", "mostrador", "patio", "consulta", "administracion"];

export interface PersonaAdministrada {
  id: string;
  nombre: string;
  rol: Rol;
  puedeAutorizar: boolean;
  activa: boolean;
  /** Bloqueada por intentos fallidos: se le quita cambiándole la clave. */
  bloqueada: boolean;
  /** El equipo en el que está adentro ahora, si lo está. */
  adentroDe: string | null;
  /** Si se le puede cambiar la clave o dar de baja desde la pantalla: mostrador, patio y consulta. */
  seAdministra: boolean;
  /** Si puede hacer el corte del cajón: los responsables siempre; de mostrador, a quien se le dio. */
  haceCorte: boolean;
}

export interface EquipoAdministrado {
  id: string;
  nombre: string;
  /** El día en que se dio de alta, AAAA-MM-DD. */
  altaEl: string;
  activo: boolean;
  /** Quién atiende en él ahora, si alguien. */
  atiende: string | null;
  /** Es el equipo desde el que se pregunta: ese no se da de baja desde sí mismo. */
  esEste: boolean;
}

/** Las personas y los equipos, para quien los administra. */
export async function loQueSeAdministra(
  bd: Bd, persona: Persona, huella: string,
): Promise<{ personas: PersonaAdministrada[]; equipos: EquipoAdministrado[] }> {
  return bd.enTransaccion(persona, async (c) => ({
    personas: (await c.query(
      `SELECT id::text AS id, nombre, rol, puede_autorizar AS "puedeAutorizar", activo AS activa, bloqueada,
              adentro_de AS "adentroDe", se_administra AS "seAdministra", hace_corte AS "haceCorte"
       FROM personas_para_administrar($1)`, [persona])).rows,
    equipos: (await c.query(
      `SELECT id, nombre, to_char(alta_el, 'YYYY-MM-DD') AS "altaEl", activo, atiende, es_este AS "esEste"
       FROM equipos_para_administrar($1, $2)`, [huella, persona])).rows,
  }));
}

// Las claves que se sortean aquí son de mostrador, de patio y de consulta: cuatro dígitos.
const DIGITOS = 4;
const claveAlAzar = (): string => String(randomInt(0, 10 ** DIGITOS)).padStart(DIGITOS, "0");

/**
 * Intenta con claves al azar hasta que la base admita una: rechaza las que se adivinan solas, y lo
 * hace antes de mirar la clave de quien lo pide, así que repetir no le gasta intentos.
 */
async function conClaveNueva<T>(intentar: (clave: string) => Promise<T>): Promise<T> {
  for (let k = 0; ; k++) {
    try {
      return await intentar(claveAlAzar());
    } catch (e) {
      if (!(e instanceof ErrorDeNegocio) || e.codigo !== "RC005" || !/se adivina sola/.test(e.message) || k >= 20) throw e;
    }
  }
}

export interface PersonaConClave {
  persona: { id: string; nombre: string; rol: Rol };
  /** Se muestra una sola vez. */
  clave: string;
}

/** Da de alta a una persona. Nada si la clave de quien lo pide no pasó. */
export function altaDePersona(
  bd: Bd, persona: Persona, huella: string, o: { nombre: string; rol: Rol; clave: string },
): Promise<PersonaConClave | null> {
  return conClaveNueva((nueva) => bd.enTransaccion(persona, async (c) => {
    const { id } = (await c.query("SELECT alta_de_persona($1, $2, $3, $4, $5, $6)::text AS id", [huella, persona, o.clave, o.nombre, o.rol, nueva])).rows[0];
    if (id === null) return null;
    const p = (await c.query("SELECT id::text AS id, nombre, rol FROM usuario WHERE id = $1", [id])).rows[0];
    return { persona: p, clave: nueva };
  }));
}

/** Le pone una clave nueva a una persona, y la devuelve. Nada si la clave de quien lo pide no pasó. */
export function cambiarClaveDePersona(bd: Bd, persona: Persona, huella: string, o: { quien: string; clave: string }): Promise<{ clave: string } | null> {
  return conClaveNueva((nueva) => bd.enTransaccion(persona, async (c) => {
    const { hecho } = (await c.query("SELECT cambiar_clave_de_persona($1, $2, $3, $4, $5) AS hecho", [huella, persona, o.clave, o.quien, nueva])).rows[0];
    return hecho ? { clave: nueva } : null;
  }));
}

/** Da de baja a una persona. Dice si se hizo: falso es que la clave de quien lo pide no pasó. */
export const bajaDePersona = (bd: Bd, persona: Persona, huella: string, o: { quien: string; clave: string }): Promise<boolean> =>
  bd.enTransaccion(persona, async (c) =>
    (await c.query("SELECT baja_de_persona($1, $2, $3, $4) AS hecho", [huella, persona, o.clave, o.quien])).rows[0].hecho);

/** Un código para dar de alta un equipo nuevo: se ve una sola vez. Nada si la clave de quien lo pide no pasó. */
export const codigoParaEquipo = (bd: Bd, persona: Persona, huella: string, o: { nombre: string; clave: string }): Promise<string | null> =>
  bd.enTransaccion(persona, async (c) =>
    (await c.query("SELECT codigo_para_equipo($1, $2, $3, $4) AS codigo", [huella, persona, o.clave, o.nombre])).rows[0].codigo);

/** Da de baja un equipo. Dice si se hizo: falso es que la clave de quien lo pide no pasó. */
export const bajaDeEquipo = (bd: Bd, persona: Persona, huella: string, o: { equipo: string; clave: string }): Promise<boolean> =>
  bd.enTransaccion(persona, async (c) =>
    (await c.query("SELECT baja_de_equipo($1, $2, $3, $4) AS hecho", [huella, persona, o.clave, o.equipo])).rows[0].hecho);

/**
 * Da o quita el permiso de hacer el corte del cajón a una persona de mostrador. Devuelve falso si
 * la clave de quien lo pide no pasó.
 */
export const permisoDeCorte = (bd: Bd, persona: Persona, huella: string, o: { quien: string; puede: boolean; clave: string }): Promise<boolean> =>
  bd.enTransaccion(persona, async (c) =>
    (await c.query("SELECT permiso_de_corte($1, $2, $3, $4, $5) AS hecho", [huella, persona, o.clave, o.quien, o.puede])).rows[0].hecho);
