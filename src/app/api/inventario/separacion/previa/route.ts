// Lo que se pierde al separar, para verlo antes de registrar. No escribe nada.
import { previaDeSeparacion } from "../../../../../servidor/dominio/inventario.ts";
import type { Producto } from "../../../../../servidor/dominio/inventario.ts";
import { lista, material, objeto } from "../../../../../servidor/forma.ts";
import { kilos } from "../../../../../servidor/numeros.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

const productos = (valor: unknown): Producto[] =>
  lista(valor, "los productos", 30).map((x) => {
    const o = objeto(x, "un producto");
    return { material: material(o.material), kg: kilos(o.kg) };
  });

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo }) => ({
  merma: await previaDeSeparacion(bd, material(cuerpo.origen), kilos(cuerpo.kg), productos(cuerpo.productos)),
}));
