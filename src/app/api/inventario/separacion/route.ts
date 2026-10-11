// Separa material mezclado: consume uno y produce otros. Lo que falta es lo que se pierde.
import { separar } from "../../../../servidor/dominio/inventario.ts";
import type { Producto } from "../../../../servidor/dominio/inventario.ts";
import { lista, material, objeto, textoOpcional, uuid } from "../../../../servidor/forma.ts";
import { kilos } from "../../../../servidor/numeros.ts";
import { ruta } from "../../../../servidor/ruta.ts";

const productos = (valor: unknown): Producto[] =>
  lista(valor, "los productos", 30).map((x) => {
    const o = objeto(x, "un producto");
    return { material: material(o.material), kg: kilos(o.kg) };
  });

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona }) => ({
  separacion: await separar(bd, persona.id, {
    id: uuid(cuerpo.id, "la separación"),
    origen: material(cuerpo.origen),
    kg: kilos(cuerpo.kg),
    productos: productos(cuerpo.productos),
    nota: textoOpcional(cuerpo.nota, "la nota", 300),
  }),
}));
