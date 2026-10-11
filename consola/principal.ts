// La consola de administración, desde la línea de comandos:
//   docker compose run --rm consola <orden>
import pg from "pg";
import { faltasDelEntorno } from "../src/servidor/entorno.ts";
import {
  altaDePersona, arranque, bajaDeCliente, bajaDeEquipo, bajaDePersona, cambiarClave, codigoDeEquipo, listaDeClientes, listaDeEquipos, listaDePersonas,
  reactivarCliente, renombrarCliente,
} from "./acciones.ts";
import type { PersonaConClave, Rol } from "./acciones.ts";

const USO = `Órdenes:
  arranque [--responsable=Nombre] [--equipo=Nombre]   primer arranque: un responsable y un código de equipo
  persona alta <nombre> <rol> [--autoriza] [--clave=N] rol: responsable, mostrador, patio, consulta, administracion
  persona clave <nombre|número> [--clave=N]            cambia la clave (y desbloquea)
  persona baja <nombre|número>
  persona lista
  equipo codigo <nombre>                               código para dar de alta un equipo (15 minutos, un uso)
  equipo baja <id>
  equipo lista
  cliente lista                                        los clientes con precio especial (se dan de alta en la pantalla, al darles el primero)
  cliente renombrar <nombre|número> <nombre nuevo>
  cliente baja <nombre|número>                         ya no se le puede dar precio especial; su historia se conserva
  cliente reactivar <nombre|número>

Si no se da --clave, se genera una y se muestra aquí una sola vez.`;

const ROLES: readonly Rol[] = ["responsable", "mostrador", "patio", "consulta", "administracion"];

const argumentos = process.argv.slice(2);
const opciones = new Map<string, string>();
const palabras: string[] = [];
for (const a of argumentos) {
  const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
  if (m) opciones.set(m[1]!, m[2] ?? "sí");
  else palabras.push(a);
}

function salirCon(mensaje: string): never {
  console.error(mensaje);
  process.exit(2);
}

const mostrarClave = (p: PersonaConClave): void => {
  console.log(`  ${p.nombre} (${p.rol}, número ${p.id})`);
  console.log(`  clave: ${p.clave}    ← anótala y entrégala en persona: no se vuelve a mostrar`);
};

const mostrarCodigo = (codigo: string): void => {
  console.log(`  código de equipo: ${codigo.slice(0, 5)}-${codigo.slice(5)}`);
  console.log("  se teclea en la pantalla del equipo nuevo; sirve una vez y vence en 15 minutos");
};

async function correr(db: pg.Client): Promise<void> {
  const [orden, accion, ...resto] = palabras;
  if (orden === "arranque") {
    const r = await arranque(db, {
      responsable: opciones.get("responsable") ?? "Responsable",
      equipo: opciones.get("equipo") ?? "Mostrador",
    });
    if (r.persona) {
      console.log("Se dio de alta al primer responsable:");
      mostrarClave(r.persona);
    } else {
      console.log("Ya hay un responsable: no se tocó a nadie.");
    }
    if (r.codigo) {
      console.log("Para dar de alta el primer equipo:");
      mostrarCodigo(r.codigo);
    } else {
      console.log("Ya hay un equipo dado de alta: no se generó código.");
    }
    return;
  }
  if (orden === "persona" && accion === "alta") {
    const [nombre, rol] = resto;
    if (!nombre || !rol || !ROLES.includes(rol as Rol)) salirCon(USO);
    const p = await altaDePersona(db, { nombre, rol: rol as Rol, autoriza: opciones.has("autoriza"), clave: opciones.get("clave") });
    console.log("Persona dada de alta:");
    mostrarClave(p);
    return;
  }
  if (orden === "persona" && accion === "clave") {
    if (!resto[0]) salirCon(USO);
    console.log("Clave cambiada. Las sesiones que tenía abiertas se cerraron.");
    mostrarClave(await cambiarClave(db, resto[0], opciones.get("clave")));
    return;
  }
  if (orden === "persona" && accion === "baja") {
    if (!resto[0]) salirCon(USO);
    const p = await bajaDePersona(db, resto[0]);
    console.log(`${p.nombre} (número ${p.id}) quedó dada de baja y sin sesión.`);
    return;
  }
  if (orden === "persona" && accion === "lista") {
    for (const p of await listaDePersonas(db)) {
      const notas = [p.activa ? "" : "de baja", p.autoriza ? "autoriza" : "", p.bloqueada ? "clave bloqueada" : ""].filter(Boolean);
      console.log(`  ${p.id.padStart(3)}  ${p.nombre.padEnd(24)} ${p.rol.padEnd(15)} ${notas.join(", ")}`);
    }
    return;
  }
  if (orden === "equipo" && accion === "codigo") {
    if (!resto[0]) salirCon(USO);
    mostrarCodigo(await codigoDeEquipo(db, resto[0]));
    return;
  }
  if (orden === "equipo" && accion === "baja") {
    if (!resto[0]) salirCon(USO);
    await bajaDeEquipo(db, resto[0]);
    console.log("Equipo dado de baja. Quien atendía ahí quedó fuera.");
    return;
  }
  if (orden === "equipo" && accion === "lista") {
    for (const e of await listaDeEquipos(db)) {
      const estado = e.vigente ? (e.atiende ? `atiende ${e.atiende}` : "sin nadie") : "de baja";
      console.log(`  ${e.id}  ${e.nombre.padEnd(24)} ${estado}`);
    }
    return;
  }
  if (orden === "cliente" && accion === "lista") {
    for (const c of await listaDeClientes(db)) {
      const notas = [c.activo ? "" : "de baja", c.preciosDados === 1 ? "1 precio especial" : `${c.preciosDados} precios especiales`].filter(Boolean);
      console.log(`  ${c.id.padStart(3)}  ${c.nombre.padEnd(32)} ${notas.join(", ")}`);
    }
    return;
  }
  if (orden === "cliente" && accion === "renombrar") {
    if (!resto[0] || !resto[1]) salirCon(USO);
    const c = await renombrarCliente(db, resto[0], resto.slice(1).join(" "));
    console.log(`El cliente número ${c.id} ahora se llama «${c.nombre}». Los comprobantes ya entregados conservan el nombre de antes.`);
    return;
  }
  if (orden === "cliente" && accion === "baja") {
    if (!resto[0]) salirCon(USO);
    const c = await bajaDeCliente(db, resto[0]);
    console.log(`«${c.nombre}» (número ${c.id}) quedó dado de baja: ya no se le puede dar precio especial. Su historia se conserva.`);
    return;
  }
  if (orden === "cliente" && accion === "reactivar") {
    if (!resto[0]) salirCon(USO);
    const c = await reactivarCliente(db, resto[0]);
    console.log(`«${c.nombre}» (número ${c.id}) vuelve a estar activo.`);
    return;
  }
  salirCon(USO);
}

const url = process.env.DATABASE_URL;
if (!url) salirCon("Falta DATABASE_URL");
const faltas = faltasDelEntorno(process.env, ["administracion"]);
if (faltas.length) salirCon(`El entorno no sirve para operar: ${faltas.join("; ")}. Si es desarrollo: MODO=desarrollo.`);
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await correr(db);
} catch (e) {
  // Los rechazos de la base ya vienen con un mensaje para la persona.
  salirCon(`No se pudo: ${(e as Error).message}`);
} finally {
  await db.end();
}
