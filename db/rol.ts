// El usuario con que la aplicación se conecta a la base: puede iniciar sesión y es miembro de
// feruga_app, de donde le viene todo lo que puede hacer. No es dueño de nada.
// Correrlo otra vez no falla: deja la clave que se le dé, así se puede cambiar desde el entorno.
// Es también quien le abre a la aplicación la puerta de la base, que el migrador deja cerrada.
import { pathToFileURL } from "node:url";
import pg from "pg";
import { puerta } from "./migrar.ts";
import { exigirEntorno } from "../src/servidor/entorno.ts";

const NOMBRE = /^[a-z][a-z0-9_]{2,40}$/;
// Ni el dueño de las tablas ni el rol que agrupa los permisos son usuarios de conexión.
const RESERVADOS = new Set(["feruga", "feruga_app", "postgres"]);

/** Lo que un rol tiene de más para ser el usuario de conexión de la aplicación. Vacío si está limpio. */
async function loQueLeSobra(cliente: pg.Client, nombre: string): Promise<string[]> {
  const sobra: string[] = [];
  const { rows: [rol] } = await cliente.query(
    "SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1",
    [nombre],
  );
  for (const [atributo, que] of [
    ["rolsuper", "es superusuario"], ["rolcreatedb", "puede crear bases"], ["rolcreaterole", "puede crear usuarios"],
    ["rolreplication", "puede replicar"], ["rolbypassrls", "se salta las políticas de filas"],
  ] as const) {
    if (rol[atributo]) sobra.push(que);
  }
  const otros = await cliente.query(
    `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
     WHERE m.member = $1 AND r.rolname <> 'feruga_app' ORDER BY 1`,
    [rol.oid],
  );
  if (otros.rows.length) sobra.push(`es miembro de ${otros.rows.map((f) => f.rolname).join(", ")}`);
  // En todas las bases del servidor: objetos de los que es dueño y permisos concedidos a su nombre.
  const propios = await cliente.query(
    `SELECT count(*) FILTER (WHERE deptype = 'o')::int AS objetos, count(*) FILTER (WHERE deptype = 'a')::int AS permisos
     FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = $1`,
    [rol.oid],
  );
  if (propios.rows[0].objetos) sobra.push(`es dueño de ${propios.rows[0].objetos} objetos`);
  if (propios.rows[0].permisos) sobra.push(`tiene ${propios.rows[0].permisos} permisos concedidos a su nombre`);
  return sobra;
}

export async function asegurarRol(cliente: pg.Client, nombre: string, clave: string): Promise<void> {
  if (!NOMBRE.test(nombre) || RESERVADOS.has(nombre)) {
    throw new Error(`El nombre del usuario de conexión no es válido: ${nombre}`);
  }
  if (!clave) throw new Error("Falta la clave del usuario de conexión");
  const existe = (await cliente.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [nombre])).rows.length > 0;
  if (existe) {
    // Quitarle atributos no le quita membresías, permisos ni objetos: uno que trae de más no se
    // arregla aquí, se rechaza, y quien administra decide qué hacer con él.
    const sobra = await loQueLeSobra(cliente, nombre);
    if (sobra.length) {
      throw new Error(`El usuario de conexión ${nombre} ya existe y tiene más de lo que debe: ${sobra.join("; ")}. Bórralo o usa otro nombre.`);
    }
  }
  // Un rol no se puede pasar como parámetro: la base arma la instrucción con sus propias comillas.
  const { rows } = await cliente.query(
    existe
      ? "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql"
      : "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L IN ROLE feruga_app', $1::text, $2::text) AS sql",
    [nombre, clave],
  );
  await cliente.query(rows[0].sql);
  if (existe) await cliente.query((await cliente.query("SELECT format('GRANT feruga_app TO %I', $1::text) AS sql", [nombre])).rows[0].sql);
  // La puerta de esta base: entra quien es de la aplicación, y nadie más por omisión. El migrador
  // la deja cerrada; aquí se abre, cuando las migraciones ya entraron todas.
  await puerta(cliente, "REVOKE", "PUBLIC");
  await puerta(cliente, "GRANT", "feruga_app");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  exigirEntorno(process.env, ["administracion", "conexion"]);
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const nombre = process.env.WEB_BD_USUARIO ?? "feruga_web";
    await asegurarRol(cliente, nombre, process.env.WEB_BD_CLAVE ?? "");
    console.log(`usuario de conexión listo: ${nombre}`);
  } finally {
    await cliente.end();
  }
}
