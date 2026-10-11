// Dar de alta un equipo, entrar, salir y comprobar una clave en el momento.
// La base decide; aquí solo se le pregunta, cada vez en su propia transacción, para que un intento
// fallido quede contado aunque lo que venga después se rechace.
import type { Bd } from "../bd.ts";
import { huellaDe } from "../sesion.ts";
import type { PersonaActiva, Rol } from "../sesion.ts";

/**
 * Canjea el código de alta por un equipo con ese secreto. Dice si el código sirvió.
 * El secreto lo trae quien llama, ya con su cookie preparada: si la cookie no se puede sellar, se
 * sabe antes de gastar el código.
 */
export async function darDeAltaEquipo(bd: Bd, codigo: string, secreto: string): Promise<boolean> {
  const equipo = await bd.enTransaccion(null, async (c) =>
    (await c.query("SELECT canjear_codigo($1, $2) AS equipo", [codigo, huellaDe(secreto)])).rows[0].equipo);
  return Boolean(equipo);
}

export interface PersonaParaEntrar {
  id: string;
  nombre: string;
  rol: Rol;
}

export const personasParaEntrar = (bd: Bd): Promise<PersonaParaEntrar[]> =>
  bd.leer<PersonaParaEntrar>("SELECT id, nombre, rol FROM usuario WHERE activo ORDER BY nombre, id");

/** La persona entra en ese equipo. Devuelve su sesión y quién es, o nada si no entró. */
export async function entrar(
  bd: Bd, huella: string, persona: string, clave: string,
): Promise<{ sesion: string; persona: PersonaActiva } | null> {
  return bd.enTransaccion(null, async (c) => {
    const sesion = (await c.query("SELECT entrar($1, $2, $3) AS sesion", [huella, persona, clave])).rows[0].sesion;
    if (!sesion) return null;
    const p = (await c.query("SELECT id, nombre, rol, puede_autorizar FROM usuario WHERE id = $1", [persona])).rows[0];
    return { sesion, persona: { id: p.id, nombre: p.nombre, rol: p.rol, puedeAutorizar: p.puede_autorizar } };
  });
}

export async function salir(bd: Bd, huella: string, sesion: string): Promise<void> {
  await bd.enTransaccion(null, (c) => c.query("SELECT salir($1, $2)", [huella, sesion]));
}
