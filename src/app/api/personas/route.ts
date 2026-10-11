// Las personas que pueden entrar, para elegirse en la pantalla. Solo se le muestran a un equipo dado de alta.
import { personasParaEntrar } from "../../../servidor/dominio/identidad.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ acceso: "equipo" }, async ({ bd }) => ({ personas: await personasParaEntrar(bd) }));
