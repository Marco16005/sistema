// Los avisos que ningún responsable ha visto: un corte que no cuadró, un cajón que abrió con otra
// cantidad de la que se dejó. Mientras no haya servidor, solo se ven aquí; después, también llegan
// por Telegram y por correo.
import { avisosSinVer } from "../../../servidor/dominio/caja.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd }) => ({ avisos: await avisosSinVer(bd) }));
