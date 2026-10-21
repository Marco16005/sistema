// Las correcciones de una cuenta ya cobrada: verla con lo que vale ahora cada material, y corregir
// uno —los kilos que de verdad eran, o el material que de verdad era—. Se liquida solo la
// diferencia, y lo autoriza con su clave una persona facultada.
import { claveQueNoPaso, claveTecleada } from "../../../../../servidor/clave.ts";
import { LIQUIDACIONES, corregirCuenta, cuentaParaCorregir } from "../../../../../servidor/dominio/correcciones.ts";
import { entero, fila, material, textoConAlgo, unoDe, uuid } from "../../../../../servidor/forma.ts";
import { kilos } from "../../../../../servidor/numeros.ts";
import { Rechazo, ruta } from "../../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "mostrador", "consulta"] }, async ({ bd, parametros }) => {
  const cuenta = await cuentaParaCorregir(bd, uuid(parametros.operacion, "la cuenta"));
  if (!cuenta) throw new Rechazo(404, "NO_EXISTE", "Esa cuenta no existe o todavía no se cobra");
  return { cuenta };
});

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = await corregirCuenta(bd, persona.id, equipo.huella, uuid(parametros.operacion, "la cuenta"), {
    id: uuid(cuerpo.id, "la corrección"),
    linea: uuid(cuerpo.linea, "el material de la cuenta"),
    kg: kilos(cuerpo.kg),
    material: material(cuerpo.material),
    vistas: entero(cuerpo.vistas, "las correcciones que llevaba"),
    liquidacion: unoDe(cuerpo.liquidacion, "cómo se liquida", LIQUIDACIONES),
    motivo: textoConAlgo(cuerpo.motivo, "por qué se corrige", 200),
    autoriza: fila(cuerpo.autoriza, "quien autoriza"),
    clave: claveTecleada(cuerpo.clave),
  });
  if (!cuenta) throw claveQueNoPaso();
  return { cuenta };
});
