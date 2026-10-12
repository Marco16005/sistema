// Los clientes y sus cuentas cobradas, para quien dirige: la lista y lo que suman entre todos.
import { resumenDeClientes } from "../../../../servidor/dominio/clientes.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd }) => resumenDeClientes(bd));
