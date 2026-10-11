// La lista de precios: la ve cualquiera que haya entrado; la cambia el responsable mientras no se publique.
import { guardarPrecios, listaDelDia } from "../../../servidor/dominio/precios.ts";
import type { CambioDePrecio } from "../../../servidor/dominio/precios.ts";
import { lista, material, objeto } from "../../../servidor/forma.ts";
import { precio } from "../../../servidor/numeros.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({}, async ({ bd }) => ({ ...(await listaDelDia(bd)) }));

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, persona }) => {
  const cambios: CambioDePrecio[] = lista(cuerpo.cambios, "los cambios", 500).map((c) => {
    const o = objeto(c, "un cambio");
    const cual = material(o.material);
    return o.quitar === true ? { material: cual, quitar: true } : { material: cual, compra: precio(o.compra), venta: precio(o.venta) };
  });
  await guardarPrecios(bd, persona.id, cambios);
  return { ...(await listaDelDia(bd)) };
});
