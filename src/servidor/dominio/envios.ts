// Los envíos: lo que la pantalla manda con su identificador para poder repetirlo sin duplicar.
import type { Bd, Persona } from "../bd.ts";

/**
 * Cancela un envío del que no se supo. Devuelve si ya había entrado: entonces se queda como está.
 * Si no había entrado, queda cancelado y ya no entra, llegue cuando llegue.
 */
export async function cancelarEnvio(bd: Bd, persona: Persona, envio: string): Promise<boolean> {
  return bd.enTransaccion(persona, async (c) => {
    const { rows } = await c.query("SELECT cancelar_envio($1, $2) AS cancelado", [envio, persona]);
    return !rows[0].cancelado;
  });
}
