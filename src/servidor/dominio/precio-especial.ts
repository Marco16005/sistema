// Clientes con precio especial. A un material de una cuenta abierta se le da un precio distinto
// del de lista —una diferencia por kilo—, para un cliente y con la clave de quien autoriza; o se le
// quita, y vuelve al de lista. Las reglas viven en la base: aquí solo se le pregunta, y se devuelve
// la cuenta como quedó.
import type { Bd, Persona } from "../bd.ts";
import { comoQuedo } from "./cuentas.ts";
import type { Cuenta } from "./cuentas.ts";

export interface ClienteEnLista {
  id: string;
  nombre: string;
}

/** Los clientes a los que se les puede dar precio especial, por nombre. Los dados de baja no salen. */
export const clientes = (bd: Bd): Promise<ClienteEnLista[]> =>
  bd.leer<ClienteEnLista>("SELECT id::text AS id, nombre FROM cliente WHERE activo ORDER BY lower(nombre), id");

export interface OrdenDePrecio {
  /** El identificador del envío: repetirlo devuelve lo que hizo, sin pedir otra vez la clave. */
  id: string;
  cuenta: string;
  linea: string;
  /** El último cambio de precio que la pantalla le vio a ese material; nada si nunca tuvo. */
  visto: string | null;
  /** Un cliente de la lista, o uno nuevo por su nombre: uno de los dos. */
  cliente: string | null;
  clienteNuevo: string | null;
  /** Pesos por kilo, hacia arriba o hacia abajo, respecto del precio de lista. */
  diferencia: string;
  autoriza: string;
  clave: string;
}

/** Da el precio especial. Devuelve la cuenta como quedó; nada si la clave de quien autoriza no pasó. */
export async function darPrecioEspecial(bd: Bd, persona: Persona, huella: string, orden: OrdenDePrecio): Promise<Cuenta | null> {
  const dado = await bd.enTransaccion(persona, async (c) => {
    const { rows } = await c.query("SELECT id FROM dar_precio_especial($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", [
      orden.id, orden.cuenta, orden.linea, orden.visto, orden.cliente, orden.clienteNuevo, orden.diferencia, orden.autoriza, orden.clave, huella, persona,
    ]);
    return rows[0].id !== null;
  });
  return dado ? comoQuedo(bd, orden.cuenta) : null;
}

/** Quita el precio especial: el material vuelve a su precio de lista. No pide clave. */
export async function quitarPrecioEspecial(
  bd: Bd, persona: Persona, orden: { id: string; cuenta: string; linea: string; visto: string | null },
): Promise<Cuenta> {
  await bd.enTransaccion(persona, (c) =>
    c.query("SELECT id FROM quitar_precio_especial($1, $2, $3, $4, $5)", [orden.id, orden.cuenta, orden.linea, orden.visto, persona]));
  return comoQuedo(bd, orden.cuenta);
}
