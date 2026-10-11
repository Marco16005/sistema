// La hoja del saldo inicial: todos los materiales, y lo que se cargó si el arranque ya se terminó.
import { saldoInicial } from "../../../servidor/dominio/dia.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable"] }, async ({ bd }) => ({ arranque: await saldoInicial(bd) }));
