// Las personas y los equipos, para quien los administra desde la pantalla: un responsable
// facultado para autorizar. Si es responsable pero no tiene la facultad, lo dice la base.
import { loQueSeAdministra } from "../../../servidor/dominio/administracion.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable"] }, async ({ bd, persona, equipo }) => loQueSeAdministra(bd, persona.id, equipo.huella));
