// Lo fiado: quién debe cuánto, lo vencido y lo que ya se pagó.
import { saldos } from "../../../servidor/dominio/fiado.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "mostrador", "consulta"] }, async ({ bd }) => ({ clientes: await saldos(bd) }));
