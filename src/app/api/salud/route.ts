// Dice dos cosas, por separado:
//   · que la aplicación está lista: su entorno sirve para operar, alcanza su base, la base está en
//     la versión que esta aplicación espera, no es una base restaurada sin registrar, y tiene con
//     qué sellar las cookies. Es lo que mira el contenedor para darse por sano: 200 o 503;
//   · si la operación está abierta, o en mantenimiento. Lista y cerrada es un estado normal:
//     así se comprueba una versión antes de abrirla.
// No pide equipo ni persona, y por lo mismo no cuenta nada más: ni la versión ni la causa cuando
// falla. El detalle —qué versión contesta, qué esquema espera y sobre qué base— se le da solo al
// comprobador de esta instalación (src/servidor/comprobador.ts).
//
// Si la pregunta trae un reto (?reto=, 32 de 0-9 y a-f), la respuesta lo repite: así quien pregunta
// —el latido, las comprobaciones de cada publicación— sabe que la respuesta es de ahora, y no una
// guardada por algo de en medio, como otro proxy (Codex, R43-04). Solo se repite con esa forma exacta.
import { bd } from "../../../servidor/bd.ts";
import { esElComprobador } from "../../../servidor/comprobador.ts";
import { faltasDelEntorno } from "../../../servidor/entorno.ts";
import { ESQUEMA_ESPERADO, baseApta, operacionAbierta } from "../../../servidor/esquema.ts";
import { selloUtilizable } from "../../../servidor/sesion.ts";

export const dynamic = "force-dynamic";

export async function GET(peticion?: Request): Promise<Response> {
  try {
    if (faltasDelEntorno(process.env, ["conexion", "aplicacion"]).length > 0) throw new Error("el entorno no sirve para operar");
    if (!selloUtilizable()) throw new Error("configuración de sesión inutilizable");
    const base = bd();
    if (!(await baseApta(base))) throw new Error("la base no es la que esta aplicación espera");
    const abierta = await operacionAbierta(base);
    const retos = peticion ? new URL(peticion.url).searchParams.getAll("reto") : [];
    const reto = retos.length === 1 && /^[0-9a-f]{32}$/.test(retos[0]!) ? { reto: retos[0]! } : {};
    if (!peticion || !esElComprobador(peticion)) return Response.json({ bien: true, abierta, ...reto });
    const [vida] = await base.leer("SELECT id FROM vida");
    return Response.json({ bien: true, abierta, version: process.env.VERSION ?? null, esquema: ESQUEMA_ESPERADO, base: vida?.id ?? null, ...reto });
  } catch {
    return Response.json({ bien: false }, { status: 503 });
  }
}
