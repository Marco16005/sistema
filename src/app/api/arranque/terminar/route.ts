// Carga lo que ya hay en el patio y cierra el arranque. Se hace una vez.
import { estadoDelDia, terminarArranque } from "../../../../servidor/dominio/dia.ts";
import type { Saldo } from "../../../../servidor/dominio/dia.ts";
import { lista, material, objeto, unoDe } from "../../../../servidor/forma.ts";
import { kilos } from "../../../../servidor/numeros.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, persona }) => {
  const saldos: Saldo[] = lista(cuerpo.saldos, "el saldo inicial", 500).map((s) => {
    const o = objeto(s, "un saldo");
    return { material: material(o.material), kg: kilos(o.kg), origen: unoDe(o.origen, "el origen", ["contado", "estimado"]) };
  });
  await terminarArranque(bd, persona.id, saldos);
  return { dia: await estadoDelDia(bd) };
});
