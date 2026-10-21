// Termina el vehículo que quedó de otra jornada: lo confirma un responsable, con su clave, en el momento.
import { FORMAS_DE_PAGO, terminarVehiculo } from "../../../../../servidor/dominio/cuentas.ts";
import { entero, fila, texto, unoDe, uuid } from "../../../../../servidor/forma.ts";
import { Rechazo } from "../../../../../servidor/ruta.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  // Aquí el responsable sí viene en el cuerpo: es quien dice autorizar, y su clave es la que lo demuestra.
  // Quedará él como quien confirmó, no quien tiene la sesión.
  const hecha = await terminarVehiculo(
    bd, equipo.huella,
    { responsable: fila(cuerpo.responsable, "el responsable"), clave: texto(cuerpo.clave, "la clave", 16) },
    cuenta, entero(cuerpo.revision, "la revisión"),
    cuerpo.forma === undefined ? "efectivo" : unoDe(cuerpo.forma, "cómo se pagó", FORMAS_DE_PAGO),
  );
  if (!hecha) throw new Rechazo(401, "CLAVE", "La clave no pasó. Después de varios intentos se bloquea unos minutos.");
  return { cuenta: hecha };
});
