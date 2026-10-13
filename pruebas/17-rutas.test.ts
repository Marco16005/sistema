// Todas las rutas juntas. Primero la matriz: cada ruta contra cada rol, contra un equipo sin
// persona y contra un equipo desconocido. Una ruta nueva que no esté en la tabla hace fallar la
// prueba: nadie agrega una puerta sin decidir quién pasa. Después, un día entero por las rutas.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { conBase, existencia, material, una, urlApp } from "./apoyo.ts";
import { Navegador } from "./navegador.ts";
import type { Extra, Manejador } from "./navegador.ts";
import { crearBd, usarBd } from "../src/servidor/bd.ts";

type Rol = "responsable" | "mostrador" | "patio" | "consulta" | "administracion";
const TODOS: Rol[] = ["responsable", "mostrador", "patio", "consulta", "administracion"];
const ARMAN: Rol[] = ["responsable", "mostrador", "patio"];
const COBRAN: Rol[] = ["responsable", "mostrador"];
/** Quien ve el dinero de todos los días: el panel y el historial. */
const DIRIGEN: Rol[] = ["responsable", "consulta"];

/** Quién pasa por cada ruta: una lista de roles, o «equipo» (basta el equipo), o «publico». */
const MATRIZ: Record<string, Rol[] | "equipo" | "publico"> = {
  "GET salud": "publico",
  "POST equipo/alta": "publico",
  "POST equipo/contraste": "publico",
  "GET personas": "equipo",
  "GET sesion": "equipo",
  "POST sesion/entrar": "equipo",
  "POST sesion/salir": "equipo",
  "GET dia": TODOS,
  "GET arranque": ["responsable"],
  "POST arranque/terminar": ["responsable"],
  "POST jornada/abrir": COBRAN,
  "POST jornada/cerrar": COBRAN,
  "POST jornada/reabrir": COBRAN,
  "GET precios": TODOS,
  "POST precios": ["responsable"],
  "POST precios/publicar": ["responsable"],
  "GET catalogo": ARMAN,
  "GET cuentas": ARMAN,
  "POST cuentas": ARMAN,
  "GET cuentas/[cuenta]": ARMAN,
  "POST cuentas/[cuenta]/materiales": ARMAN,
  "POST cuentas/[cuenta]/segunda-pesada": ARMAN,
  "POST cuentas/[cuenta]/quitar": ARMAN,
  "POST cuentas/[cuenta]/etiqueta": ARMAN,
  "POST cuentas/[cuenta]/descartar": ARMAN,
  "POST cuentas/[cuenta]/descuento": COBRAN,
  "POST cuentas/[cuenta]/precio-especial": COBRAN,
  "POST cuentas/[cuenta]/precio-especial/quitar": COBRAN,
  "GET clientes": COBRAN,
  "POST cuentas/[cuenta]/confirmar": COBRAN,
  "POST cuentas/[cuenta]/terminar-vehiculo": COBRAN,
  "GET comprobantes": ["responsable", "mostrador", "consulta"],
  "GET comprobantes/[operacion]": ["responsable", "mostrador", "consulta"],
  "POST comprobantes/[operacion]/imprimir": COBRAN,
  "GET cierre": TODOS,
  "GET panel": DIRIGEN,
  "GET historial": DIRIGEN,
  "GET historial/[jornada]": DIRIGEN,
  "GET bitacora": DIRIGEN,
  "GET precios/historia": DIRIGEN,
  "GET clientes/resumen": DIRIGEN,
  "GET clientes/[cliente]": DIRIGEN,
  "POST clientes": ["responsable"],
  "POST clientes/[cliente]": ["responsable"],
  "GET exportar": DIRIGEN,
  "GET materiales": ["responsable"],
  "POST materiales": ["responsable"],
  "POST materiales/[material]": ["responsable"],
  "GET administracion": ["responsable"],
  "POST administracion/personas": ["responsable"],
  "POST administracion/personas/[persona]/clave": ["responsable"],
  "POST administracion/personas/[persona]/baja": ["responsable"],
  "POST administracion/equipos": ["responsable"],
  "POST administracion/equipos/[equipo]/baja": ["responsable"],
  "POST envios/[envio]/cancelar": ARMAN,
  "GET inventario": TODOS,
  "GET inventario/materiales/[material]": TODOS,
  "GET inventario/autorizan": COBRAN,
  "POST inventario/conteo/previa": COBRAN,
  "POST inventario/conteo": COBRAN,
  "POST inventario/merma": COBRAN,
  "POST inventario/separacion/previa": COBRAN,
  "POST inventario/separacion": COBRAN,
  "POST inventario/correccion": COBRAN,
};

const API = fileURLToPath(new URL("../src/app/api", import.meta.url));

async function rutasEnDisco(): Promise<Array<{ clave: string; camino: string; metodo: "GET" | "POST"; manejador: Manejador }>> {
  const archivos = (await readdir(API, { recursive: true })).filter((a) => a.endsWith("route.ts")).sort();
  const rutas = [];
  for (const archivo of archivos) {
    const camino = relative(API, join(API, archivo)).replace(/\/?route\.ts$/, "");
    const modulo = await import(join(API, archivo));
    for (const metodo of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
      if (typeof modulo[metodo] !== "function") continue;
      assert.ok(metodo === "GET" || metodo === "POST", `${camino} usa ${metodo}: las rutas leen con GET y escriben con POST`);
      rutas.push({ clave: `${metodo} ${camino}`, camino, metodo, manejador: modulo[metodo] as Manejador });
    }
  }
  return rutas;
}

// La persona y el equipo no existen: basta para llegar a la base, que es quien lo dice.
const PARAMETROS = { cuenta: randomUUID(), operacion: randomUUID(), material: "1", envio: randomUUID(), jornada: "1", cliente: "1", persona: "999999", equipo: randomUUID() };
const CLAVES: Record<Rol, string> = { responsable: "481516", mostrador: "4815", patio: "2718", consulta: "3141", administracion: "271828" };

interface Mundo {
  db: pg.Client;
  personas: Record<Rol, string>;
  equipo(): Promise<Navegador>;
  adentro(rol: Rol): Promise<Navegador>;
}

const conMundo = (prueba: (m: Mundo) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 4 });
    usarBd(bd);
    try {
      const personas = {} as Record<Rol, string>;
      for (const rol of TODOS) {
        personas[rol] = (await una(db, "SELECT * FROM alta_persona($1, $2, $3, $4)", [`De ${rol}`, rol, rol === "responsable", CLAVES[rol]])).id;
      }
      const { POST: alta } = await import("../src/app/api/equipo/alta/route.ts");
      const { POST: entrar } = await import("../src/app/api/sesion/entrar/route.ts");
      const m: Mundo = {
        db, personas,
        async equipo() {
          const n = new Navegador();
          await n.bien(alta, "POST", "/api/equipo/alta", { codigo: (await una(db, "SELECT crear_codigo_alta('Mostrador') AS c")).c });
          return n;
        },
        async adentro(rol) {
          const n = await m.equipo();
          await n.bien(entrar, "POST", "/api/sesion/entrar", { persona: personas[rol], clave: CLAVES[rol] });
          n.persona = personas[rol];
          return n;
        },
      };
      await prueba(m);
    } finally {
      usarBd(null);
      await bd.cerrar();
    }
  });

const codigoDe = async (r: Response): Promise<string | null> => (r.status === 200 ? null : ((await r.json()).error?.codigo ?? "?"));

// ── la matriz ──────────────────────────────────────────────────────────────

test("toda ruta que existe está en la matriz, y toda la matriz existe", async () => {
  const enDisco = (await rutasEnDisco()).map((r) => r.clave).sort();
  assert.deepEqual(enDisco, Object.keys(MATRIZ).sort());
});

test("cada rol pasa solo por las rutas que le tocan", () =>
  conMundo(async (m) => {
    const rutas = await rutasEnDisco();
    for (const rol of TODOS) {
      const n = await m.adentro(rol);
      for (const r of rutas) {
        const quien = MATRIZ[r.clave]!;
        if (r.clave === "POST sesion/entrar" || r.clave === "POST sesion/salir" || r.clave === "POST equipo/alta") continue;
        const respuesta = await n.pedir(r.manejador, r.metodo, `/api/${r.camino}`, {}, { parametros: PARAMETROS });
        const codigo = await codigoDe(respuesta);
        if (Array.isArray(quien) && !quien.includes(rol)) {
          assert.equal(respuesta.status, 403, `${rol} en ${r.clave}`);
          assert.equal(codigo, "ROL", `${rol} en ${r.clave}`);
        } else {
          // Puede fallar por la forma o por una regla, pero no por quién es.
          assert.ok(!["ROL", "RC008", "SESION", "EQUIPO", "PERSONA", "ORIGEN", "INTERNO"].includes(codigo ?? ""), `${rol} en ${r.clave}: ${respuesta.status} ${codigo}`);
        }
      }
    }
  }));

/**
 * Un cuerpo con buena forma para cada ruta que escribe, y lo que la base contesta con él en un día
 * ya en marcha: nada (lo hizo) o la regla que aplica. Lo que nombran —la cuenta, el material de la
 * cuenta, el movimiento— no existe: basta para llegar a la función de la base, que es donde se
 * vuelve a preguntar quién es. Con `{}` una ruta se queda en la forma y eso no se ve.
 */
const BIEN_FORMADAS: Record<string, { cuerpo: (m: Mundo, carton: number, pet: number) => unknown; contesta: string | null }> = {
  "POST arranque/terminar": { cuerpo: () => ({ saldos: [] }), contesta: "RC003" },
  "POST jornada/abrir": { cuerpo: () => ({}), contesta: "RC006" },           // ya está abierta
  "POST jornada/cerrar": { cuerpo: () => ({ id: randomUUID(), jornada: "999999", cierres: 0 }), contesta: "RC006" },
  "POST jornada/reabrir": {
    cuerpo: (m) => ({ id: randomUUID(), jornada: "999999", cierre: 1, autoriza: m.personas.responsable, clave: CLAVES.responsable }),
    contesta: "RC006",
  },
  "POST precios": { cuerpo: (_m, carton) => ({ cambios: [{ material: carton, compra: "2.1", venta: "2.5" }] }), contesta: "RC001" },   // la lista ya está publicada
  "POST precios/publicar": { cuerpo: () => ({}), contesta: "RC001" },
  "POST cuentas": { cuerpo: () => ({ id: randomUUID(), tipo: "compra", etiqueta: null }), contesta: null },
  "POST cuentas/[cuenta]/materiales": { cuerpo: (_m, carton) => ({ linea: randomUUID(), captura: randomUUID(), material: carton, bascula: 2, kg: "1" }), contesta: "RC005" },
  "POST cuentas/[cuenta]/segunda-pesada": { cuerpo: () => ({ linea: randomUUID(), captura: randomUUID(), kg: "1" }), contesta: "RC005" },
  "POST cuentas/[cuenta]/quitar": { cuerpo: () => ({ linea: randomUUID() }), contesta: "RC005" },
  "POST cuentas/[cuenta]/etiqueta": { cuerpo: () => ({ etiqueta: "Don Chuy" }), contesta: "RC005" },
  "POST cuentas/[cuenta]/descartar": { cuerpo: () => ({}), contesta: null },
  "POST cuentas/[cuenta]/descuento": { cuerpo: () => ({ linea: randomUUID(), kg: "1" }), contesta: "RC005" },
  "POST cuentas/[cuenta]/precio-especial": {
    cuerpo: (m) => ({ id: randomUUID(), linea: randomUUID(), visto: null, cliente: null, clienteNuevo: "Don Chuy", diferencia: "1", autoriza: m.personas.responsable, clave: CLAVES.responsable }),
    contesta: "RC005",
  },
  "POST cuentas/[cuenta]/precio-especial/quitar": { cuerpo: () => ({ id: randomUUID(), linea: randomUUID(), visto: null }), contesta: "RC005" },
  "POST cuentas/[cuenta]/confirmar": { cuerpo: () => ({ revision: 1 }), contesta: "RC005" },
  "POST cuentas/[cuenta]/terminar-vehiculo": { cuerpo: (m) => ({ responsable: m.personas.responsable, clave: CLAVES.responsable, revision: 1 }), contesta: "RC005" },
  "POST comprobantes/[operacion]/imprimir": { cuerpo: () => ({ id: randomUUID() }), contesta: "RC005" },
  "POST envios/[envio]/cancelar": { cuerpo: () => ({}), contesta: null },
  "POST inventario/conteo/previa": { cuerpo: (_m, carton) => ({ material: carton, contado: "1" }), contesta: null },
  "POST inventario/conteo": {
    cuerpo: (m, carton) => ({ id: randomUUID(), material: carton, contado: "1", contadoEn: "2020-01-01 00:00:00+00", registrado: "0.000", autoriza: m.personas.responsable, clave: CLAVES.responsable }),
    contesta: "RC005",
  },
  "POST inventario/merma": { cuerpo: (_m, carton) => ({ id: randomUUID(), material: carton, kg: "1", motivo: "Mojado" }), contesta: "RC002" },
  "POST inventario/separacion/previa": { cuerpo: (_m, carton, pet) => ({ origen: carton, kg: "2", productos: [{ material: pet, kg: "1" }] }), contesta: null },
  "POST inventario/separacion": { cuerpo: (_m, carton, pet) => ({ id: randomUUID(), origen: carton, kg: "2", productos: [{ material: pet, kg: "1" }] }), contesta: "RC002" },
  // El catálogo: el Cartón ya existe, y pedir que el material 1 quede como está no cambia nada.
  "POST materiales": { cuerpo: () => ({ familia: 5, nombre: "cartón", nombreCorto: "Cartón", frecuente: false }), contesta: "RC005" },
  "POST materiales/[material]": { cuerpo: () => ({}), contesta: null },
  // Los clientes: sin nombre no se da de alta a nadie, y el cliente 1 no existe.
  "POST clientes": { cuerpo: () => ({ nombre: "   " }), contesta: "RC005" },
  "POST clientes/[cliente]": { cuerpo: () => ({ activo: false }), contesta: "RC005" },
  // Personas y equipos: con la clave de quien lo pide. El nombre ya existe, y la persona y el equipo no.
  "POST administracion/personas": { cuerpo: () => ({ nombre: "De mostrador", rol: "mostrador", clave: CLAVES.responsable }), contesta: "RC005" },
  "POST administracion/personas/[persona]/clave": { cuerpo: () => ({ clave: CLAVES.responsable }), contesta: "RC005" },
  "POST administracion/personas/[persona]/baja": { cuerpo: () => ({ clave: CLAVES.responsable }), contesta: "RC005" },
  "POST administracion/equipos": { cuerpo: () => ({ nombre: "Oficina", clave: CLAVES.responsable }), contesta: null },
  "POST administracion/equipos/[equipo]/baja": { cuerpo: () => ({ clave: CLAVES.responsable }), contesta: "RC005" },
  "POST inventario/correccion": {
    cuerpo: (m, carton) => ({ id: randomUUID(), movimiento: "999999", material: carton, kg: "1", vistas: 0, motivo: "Se capturó mal", autoriza: m.personas.responsable, clave: CLAVES.responsable }),
    contesta: "RC005",
  },
};

test("con un cuerpo bien formado, la ruta y la base están de acuerdo en quién pasa: cada rol permitido llega a la regla", async () => {
  const escriben = (await rutasEnDisco()).filter((r) => r.metodo === "POST" && Array.isArray(MATRIZ[r.clave]));
  assert.deepEqual(escriben.map((r) => r.clave).sort(), Object.keys(BIEN_FORMADAS).sort(), "toda ruta que escribe tiene su cuerpo bien formado");
  const desacuerdos: string[] = [];
  for (const rol of TODOS) {
    // Un día en marcha para cada rol: lo que haga uno (cerrar la jornada, por ejemplo) no le cambia las respuestas al siguiente.
    await conMundo(async (m) => {
      const [carton, pet] = [await material(m.db, "Cartón"), await material(m.db, "PET")];
      await m.db.query("SELECT terminar_arranque('[]'::jsonb, $1)", [m.personas.responsable]);
      await m.db.query("SELECT abrir_jornada_de_hoy($1)", [m.personas.mostrador]);
      await m.db.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [carton, m.personas.responsable]);
      await m.db.query("SELECT publicar_lista_de_hoy($1)", [m.personas.responsable]);
      const n = await m.adentro(rol);
      // Cerrar la jornada va al final: lo demás se pregunta con el día abierto.
      const enOrden = [...escriben.filter((r) => r.clave !== "POST jornada/cerrar"), ...escriben.filter((r) => r.clave === "POST jornada/cerrar")];
      for (const r of enOrden) {
        const { cuerpo, contesta } = BIEN_FORMADAS[r.clave]!;
        const respuesta = await n.pedir(r.manejador, "POST", `/api/${r.camino}`, cuerpo(m, carton, pet), { parametros: PARAMETROS });
        const codigo = await codigoDe(respuesta);
        const espera = (MATRIZ[r.clave] as Rol[]).includes(rol) ? contesta : "ROL";
        if (codigo !== espera) desacuerdos.push(`${rol} en ${r.clave}: contestó ${respuesta.status} ${codigo} y se esperaba ${espera}`);
      }
    });
  }
  assert.deepEqual(desacuerdos, []);
});

test("un equipo sin persona adentro no pasa de las rutas de entrada", () =>
  conMundo(async (m) => {
    const n = await m.equipo();
    for (const r of await rutasEnDisco()) {
      if (r.clave === "POST equipo/alta") continue;
      const respuesta = await n.pedir(r.manejador, r.metodo, `/api/${r.camino}`, {}, { parametros: PARAMETROS });
      const codigo = await codigoDe(respuesta);
      if (Array.isArray(MATRIZ[r.clave])) {
        assert.equal(respuesta.status, 401, r.clave);
        assert.equal(codigo, "SESION", r.clave);
      } else {
        assert.ok(!["SESION", "EQUIPO", "ROL"].includes(codigo ?? ""), `${r.clave}: ${codigo}`);
      }
    }
  }));

test("un equipo que no está dado de alta no pasa de salud y del alta", () =>
  conMundo(async () => {
    for (const r of await rutasEnDisco()) {
      const respuesta = await new Navegador().pedir(r.manejador, r.metodo, `/api/${r.camino}`, {}, { parametros: PARAMETROS });
      const codigo = await codigoDe(respuesta);
      if (MATRIZ[r.clave] === "publico") {
        assert.notEqual(codigo, "EQUIPO", r.clave);
      } else {
        assert.equal(respuesta.status, 401, r.clave);
        assert.equal(codigo, "EQUIPO", r.clave);
      }
    }
  }));

test("ninguna ruta que escribe acepta una petición de otro origen", () =>
  conMundo(async (m) => {
    const n = await m.adentro("responsable");
    for (const r of (await rutasEnDisco()).filter((x) => x.metodo === "POST")) {
      const respuesta = await n.pedir(r.manejador, "POST", `/api/${r.camino}`, {}, { parametros: PARAMETROS, origen: "http://otro.sitio" });
      assert.equal(respuesta.status, 403, r.clave);
      assert.equal(await codigoDe(respuesta), "ORIGEN", r.clave);
    }
  }));

// ── un día entero por las rutas ────────────────────────────────────────────

const ruta = async (camino: string, metodo: "GET" | "POST"): Promise<Manejador> => (await import(join(API, camino, "route.ts")))[metodo];

test("un día entero, de dar de alta el equipo a cerrar, solo por las rutas", () =>
  conMundo(async (m) => {
    const carton = await material(m.db, "Cartón");
    const jefe = await m.adentro("responsable");

    // El arranque: lo que ya hay en el patio.
    assert.equal((await jefe.bien(await ruta("dia", "GET"), "GET", "/api/dia")).dia.arranqueTerminado, false);
    await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/arranque/terminar", { saldos: [{ material: carton, kg: "500", origen: "estimado" }] });

    // Abrir, poner precios, publicar.
    await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/jornada/abrir");
    const lista = await jefe.bien(await ruta("precios", "POST"), "POST", "/api/precios", { cambios: [{ material: carton, compra: "2.1", venta: "2.5" }] });
    assert.equal(lista.familias.flatMap((f: any) => f.materiales).find((x: any) => x.id === carton).compra, "2.1000");
    assert.equal((await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/precios/publicar")).dia.listo, true);

    // El mostrador atiende una compra.
    const caja = await m.adentro("mostrador");
    const catalogo = await caja.bien(await ruta("catalogo", "GET"), "GET", "/api/catalogo?tipo=compra");
    assert.equal(catalogo.frecuentes.find((x: any) => x.id === carton).precio, "2.1000");
    const cuenta = randomUUID();
    const p = { parametros: { cuenta } };
    await caja.bien(await ruta("cuentas", "POST"), "POST", "/api/cuentas", { id: cuenta, tipo: "compra", etiqueta: "Don Chuy" });
    const conMaterial = await caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", `/api/cuentas/${cuenta}/materiales`,
      { linea: randomUUID(), captura: randomUUID(), material: carton, bascula: 2, kg: "30.2" }, p);
    assert.deepEqual(conMaterial.cuenta.resumen, { materiales: 1, porPesar: 0, suma: "63.42", ajuste: "-0.42", total: "63" });
    assert.equal((await caja.bien(await ruta("cuentas", "GET"), "GET", "/api/cuentas")).cuentas.length, 1);

    // Con la revisión vieja no confirma; con la que tiene a la vista, sí.
    const vieja = await caja.pedir(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", `/api/cuentas/${cuenta}/confirmar`, { revision: 0 }, p);
    assert.equal(vieja.status, 409);
    assert.equal((await vieja.json()).error.codigo, "RC011");
    const hecha = await caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", `/api/cuentas/${cuenta}/confirmar`,
      { revision: conMaterial.cuenta.revision }, p);
    assert.equal(hecha.cuenta.estado, "confirmada");
    assert.equal(await existencia(m.db, carton), 530.2);
    assert.equal((await una(m.db, "SELECT confirmada_por FROM operacion WHERE id = $1", [cuenta])).confirmada_por, m.personas.mostrador);

    // Comprobante, impresión y reimpresión.
    const o = { parametros: { operacion: cuenta } };
    const ticket = await caja.bien(await ruta("comprobantes/[operacion]", "GET"), "GET", `/api/comprobantes/${cuenta}`, undefined, o);
    assert.equal(ticket.comprobante.total, "63");
    const imprimir = await ruta("comprobantes/[operacion]/imprimir", "POST");
    assert.equal((await caja.bien(imprimir, "POST", `/api/comprobantes/${cuenta}/imprimir`, { id: randomUUID() }, o)).impresion.numero, 1);
    const sinMotivo = await caja.pedir(imprimir, "POST", `/api/comprobantes/${cuenta}/imprimir`, { id: randomUUID() }, o);
    assert.equal(sinMotivo.status, 409);
    assert.equal((await caja.bien(imprimir, "POST", `/api/comprobantes/${cuenta}/imprimir`, { id: randomUUID(), motivo: "No salió" }, o)).impresion.numero, 2);
    const porFolio = await caja.bien(await ruta("comprobantes", "GET"), "GET", `/api/comprobantes?folio=${hecha.cuenta.folio}`);
    assert.equal(porFolio.comprobante.id, cuenta);

    // Cerrar: se dice cuál jornada y cuántos cierres llevaba cuando se vio.
    const cerrar = await ruta("jornada/cerrar", "POST");
    const visto = (await caja.bien(await ruta("dia", "GET"), "GET", "/api/dia")).dia;
    assert.deepEqual({ cierres: visto.jornada.cierres, cerradaHoy: visto.cerradaHoy }, { cierres: 0, cerradaHoy: null });
    const orden = { id: randomUUID(), jornada: visto.jornada.id, cierres: 0 };
    const cierre = await caja.bien(cerrar, "POST", "/api/jornada/cerrar", orden);
    assert.deepEqual(
      { aPagar: cierre.cierre.aPagar, abierta: cierre.cierre.jornada.abierta, cierre: cierre.cierre.cierre, jornada: cierre.dia.jornada, cerradaHoy: cierre.dia.cerradaHoy },
      { aPagar: "63", abierta: false, cierre: 1, jornada: null, cerradaHoy: { id: visto.jornada.id, cierre: 1 } },
    );

    // Se cerró por error: se reabre con la clave de quien autoriza, y vuelve a ser la misma jornada.
    const reabrir = await ruta("jornada/reabrir", "POST");
    const pedido = { id: randomUUID(), jornada: visto.jornada.id, cierre: 1, autoriza: m.personas.responsable };
    const mal = await caja.pedir(reabrir, "POST", "/api/jornada/reabrir", { ...pedido, clave: "000000" });
    assert.deepEqual([mal.status, await codigoDe(mal)], [401, "CLAVE"]);
    const abierta = await caja.bien(reabrir, "POST", "/api/jornada/reabrir", { ...pedido, clave: CLAVES.responsable });
    assert.deepEqual(
      { cierre: abierta.reapertura.cierre, jornada: abierta.dia.jornada.id, cierres: abierta.dia.jornada.cierres, cerradaHoy: abierta.dia.cerradaHoy, listo: abierta.dia.listo },
      { cierre: 1, jornada: visto.jornada.id, cierres: 1, cerradaHoy: null, listo: true },
    );

    // La orden de cerrar de antes, repetida: contesta lo que hizo entonces y no vuelve a cerrar.
    const repetida = await caja.bien(cerrar, "POST", "/api/jornada/cerrar", orden);
    assert.deepEqual({ cierre: repetida.cierre.cierre, abierta: repetida.cierre.jornada.abierta }, { cierre: 1, abierta: true });
    // Una orden nueva que cree que el día lleva cero cierres, no.
    const atrasada = await caja.pedir(cerrar, "POST", "/api/jornada/cerrar", { id: randomUUID(), jornada: visto.jornada.id, cierres: 0 });
    assert.equal(await codigoDe(atrasada), "RC011");
    // Y la que lo ve como está, sí: es el segundo cierre, y el reporte dice que antes se reabrió.
    const otra = await caja.bien(cerrar, "POST", "/api/jornada/cerrar", { id: randomUUID(), jornada: visto.jornada.id, cierres: 1 });
    assert.deepEqual(
      { cierre: otra.cierre.cierre, cierres: otra.cierre.jornada.cierres, reaperturas: otra.cierre.reaperturas.map((x: any) => [x.cierre, x.autorizo]) },
      { cierre: 2, cierres: 2, reaperturas: [[1, "De responsable"]] },
    );
  }));

test("lo que llega mal formado se rechaza antes de tocar la base", () =>
  conMundo(async (m) => {
    const n = await m.adentro("responsable");
    const cuenta = randomUUID();
    const p = { parametros: { cuenta } };
    const malas: Array<[string, unknown, Record<string, string>?]> = [
      ["cuentas", { id: "no-es-uuid", tipo: "compra" }],
      ["cuentas", { id: cuenta, tipo: "regalo" }],
      ["cuentas", { id: cuenta, tipo: "compra", etiqueta: 12 }],
      ["cuentas", { id: cuenta, tipo: "compra", etiqueta: "A\u0000B" }],
      ["cuentas/[cuenta]/etiqueta", { etiqueta: "con\u0000nulo" }],
      ["sesion/entrar", { persona: "1", clave: "48\u000015" }],
      ["cuentas/[cuenta]/materiales", { linea: randomUUID(), captura: randomUUID(), material: 1, bascula: 2, kg: 30.2 }],
      ["cuentas/[cuenta]/materiales", { linea: randomUUID(), captura: randomUUID(), material: 1, bascula: 2, kg: "30,2" }],
      ["cuentas/[cuenta]/materiales", { linea: randomUUID(), captura: randomUUID(), material: "cartón", bascula: 2, kg: "30.2" }],
      ["cuentas/[cuenta]/materiales", { captura: randomUUID(), material: 1, bascula: 2, kg: "30.2" }],
      ["cuentas/[cuenta]/segunda-pesada", { linea: randomUUID(), captura: randomUUID(), kg: "" }],
      ["cuentas/[cuenta]/descuento", { linea: randomUUID(), kg: "-1" }],
      ["cuentas/[cuenta]/confirmar", { revision: "3" }],
      ["cuentas/[cuenta]/confirmar", { revision: -1 }],
      ["cuentas/[cuenta]/confirmar", {}],
      ["cuentas/[cuenta]/terminar-vehiculo", { responsable: n.persona, clave: 481516, revision: 1 }],
      // Con forma de número, pero más grandes de lo que cabe en su columna: se rechazan aquí, no revientan en la base.
      ["cuentas/[cuenta]/materiales", { linea: randomUUID(), captura: randomUUID(), material: 2147483648, bascula: 2, kg: "30.2" }],
      ["cuentas/[cuenta]/materiales", { linea: randomUUID(), captura: randomUUID(), material: 1, bascula: 32768, kg: "30.2" }],
      ["cuentas/[cuenta]/materiales", { linea: randomUUID(), captura: randomUUID(), material: "99999999999999", bascula: 2, kg: "30.2" }],
      ["cuentas/[cuenta]/confirmar", { revision: 2147483648 }],
      ["cuentas/[cuenta]/terminar-vehiculo", { responsable: "9999999999999999999", clave: "481516", revision: 1 }],
      ["precios", { cambios: [{ material: 2147483648, compra: "2.1", venta: "2.5" }] }],
      ["precios", { cambios: [{ material: 1, compra: "100000", venta: "2.5" }] }],
      ["arranque/terminar", { saldos: [{ material: 2147483648, kg: "10", origen: "contado" }] }],
      ["precios", { cambios: "todos" }],
      ["precios", { cambios: [{ material: 1, compra: "2,1", venta: "2.5" }] }],
      ["precios", { cambios: [{ material: 1, compra: "2.1" }] }],
      ["arranque/terminar", { saldos: [{ material: 1, kg: "10", origen: "adivinado" }] }],
      ["arranque/terminar", {}],
      ["comprobantes/[operacion]/imprimir", { id: "x" }, { operacion: cuenta }],
      // El precio especial: la diferencia viaja como texto, con punto y hasta cuatro decimales; no como número de máquina.
      ...[
        { diferencia: 1 }, { diferencia: "1e3" }, { diferencia: "1,5" }, { diferencia: "+1" }, { diferencia: "0.12345" }, { diferencia: "" }, { diferencia: "123456" },
        { visto: "abc" }, { visto: -1 }, { cliente: "x" }, { clienteNuevo: 12 }, { clienteNuevo: "A\u0000B" }, { clienteNuevo: "x".repeat(81) },
        { clave: 481516 }, { autoriza: "nadie" }, { linea: "x" }, { id: "x" },
      ].map((mal): [string, unknown] => ["cuentas/[cuenta]/precio-especial", {
        id: randomUUID(), linea: randomUUID(), visto: null, cliente: null, clienteNuevo: "Don Chuy", diferencia: "1", autoriza: n.persona, clave: "481516", ...mal,
      }]),
      ["cuentas/[cuenta]/precio-especial/quitar", { id: randomUUID(), linea: "x", visto: null }],
      ["cuentas/[cuenta]/precio-especial/quitar", { id: "x", linea: randomUUID(), visto: null }],
      ["cuentas/[cuenta]/precio-especial/quitar", { id: randomUUID(), linea: randomUUID(), visto: "abc" }],
      ["cuentas/[cuenta]/precio-especial/quitar", { id: randomUUID(), linea: randomUUID() }],
    ];
    for (const [camino, cuerpo, parametros] of malas) {
      const r = await n.pedir(await ruta(camino, "POST"), "POST", `/api/${camino}`, cuerpo, parametros ? { parametros } : p);
      assert.equal(r.status, 400, `${camino} con ${JSON.stringify(cuerpo)}`);
      assert.equal((await r.json()).error.codigo, "FORMA");
    }
    for (const [camino, parametros] of [["cuentas/[cuenta]", { cuenta: "no-es-uuid" }], ["comprobantes/[operacion]", { operacion: "x" }]] as const) {
      assert.equal((await n.pedir(await ruta(camino, "GET"), "GET", `/api/${camino}`, undefined, { parametros })).status, 400);
    }
    assert.equal((await n.pedir(await ruta("catalogo", "GET"), "GET", "/api/catalogo?tipo=regalo")).status, 400);
    assert.equal((await n.pedir(await ruta("comprobantes", "GET"), "GET", "/api/comprobantes?folio=abc")).status, 400);
    assert.equal((await n.pedir(await ruta("comprobantes", "GET"), "GET", "/api/comprobantes?folio=99999999999999999999")).status, 400);
    assert.equal((await una(m.db, "SELECT count(*)::int AS n FROM envio")).n, 0);
  }));

test("una cuenta o un comprobante que no existen responden que no están", () =>
  conMundo(async (m) => {
    const n = await m.adentro("mostrador");
    const id = randomUUID();
    // Quitarle algo a una cuenta que un compañero ya descartó es una regla, no una falla interna.
    const quitar = await n.pedir(await ruta("cuentas/[cuenta]/quitar", "POST"), "POST", "/api/x", { linea: randomUUID() }, { parametros: { cuenta: id } });
    assert.equal(quitar.status, 409);
    assert.equal((await quitar.json()).error.codigo, "RC005");
    const cuenta = await n.pedir(await ruta("cuentas/[cuenta]", "GET"), "GET", `/api/cuentas/${id}`, undefined, { parametros: { cuenta: id } });
    assert.equal(cuenta.status, 404);
    const ticket = await n.pedir(await ruta("comprobantes/[operacion]", "GET"), "GET", `/api/comprobantes/${id}`, undefined, { parametros: { operacion: id } });
    assert.equal(ticket.status, 404);
    assert.equal((await n.pedir(await ruta("comprobantes", "GET"), "GET", "/api/comprobantes?folio=999")).status, 404);
  }));

test("el vehículo de otra jornada: al mostrador se le niega, y con la clave de un responsable se termina a su nombre", () =>
  conMundo(async (m) => {
    const fierro = await material(m.db, "Fierro pesado");
    const jefe = await m.adentro("responsable");
    await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/jornada/abrir");
    await jefe.bien(await ruta("precios", "POST"), "POST", "/api/precios", { cambios: [{ material: fierro, compra: "6.8", venta: "8" }] });
    await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/precios/publicar");

    const caja = await m.adentro("mostrador");
    const cuenta = randomUUID();
    const p = { parametros: { cuenta } };
    const linea = randomUUID();
    await caja.bien(await ruta("cuentas", "POST"), "POST", "/api/cuentas", { id: cuenta, tipo: "compra", etiqueta: "Torton azul" });
    await caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", "/api/x", { linea, captura: randomUUID(), material: fierro, bascula: 1, kg: "5200" }, p);
    const abierta = (await caja.bien(await ruta("dia", "GET"), "GET", "/api/dia")).dia.jornada;
    await caja.bien(await ruta("jornada/cerrar", "POST"), "POST", "/api/jornada/cerrar", { id: randomUUID(), jornada: abierta.id, cierres: abierta.cierres });

    // Al otro día (para la base sigue siendo hoy: se recorre la fecha de la jornada cerrada).
    await m.db.query("ALTER TABLE jornada DISABLE TRIGGER USER");
    await m.db.query("UPDATE jornada SET fecha = fecha - 1");
    await m.db.query("ALTER TABLE jornada ENABLE TRIGGER USER");
    await caja.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/jornada/abrir");
    await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/precios/publicar");

    assert.equal((await caja.bien(await ruta("cuentas", "GET"), "GET", "/api/cuentas")).cuentas[0].deOtraJornada, true);
    const pesado = await caja.bien(await ruta("cuentas/[cuenta]/segunda-pesada", "POST"), "POST", "/api/x", { linea, captura: randomUUID(), kg: "3400" }, p);
    const revision = pesado.cuenta.revision;

    // Por la ruta ordinaria no pasa: ni el mostrador, ni el responsable con su sesión abierta.
    for (const quien of [caja, jefe]) {
      const solo = await quien.pedir(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", "/api/x", { revision }, p);
      assert.equal(solo.status, 403);
      assert.equal((await solo.json()).error.codigo, "RC008");
    }

    const terminar = await ruta("cuentas/[cuenta]/terminar-vehiculo", "POST");
    const malaClave = await caja.pedir(terminar, "POST", "/api/x", { responsable: m.personas.responsable, clave: "000000", revision }, p);
    assert.equal(malaClave.status, 401);
    assert.equal((await malaClave.json()).error.codigo, "CLAVE");
    assert.equal((await una(m.db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [m.personas.responsable])).fallos, 1);

    const hecha = await caja.bien(terminar, "POST", "/api/x", { responsable: m.personas.responsable, clave: CLAVES.responsable, revision }, p);
    assert.equal(hecha.cuenta.estado, "confirmada");
    assert.equal(hecha.cuenta.resumen.total, "12240");
    assert.equal((await una(m.db, "SELECT confirmada_por FROM operacion WHERE id = $1", [cuenta])).confirmada_por, m.personas.responsable);
    // La sesión sigue siendo la del mostrador: la clave del responsable no lo dejó adentro.
    assert.equal((await caja.bien(await ruta("sesion", "GET"), "GET", "/api/sesion")).persona.id, m.personas.mostrador);
  }));

// ── una base que no es la que esta aplicación espera ───────────────────────
//
// Que la salud conteste 503 no basta: el proxy no la consulta en cada petición. Si la base no es
// apta —está en otra versión del esquema, o volvió de un respaldo sin registrar—, ninguna ruta
// atiende, tampoco con sesión y cuerpo válidos, y nada queda escrito.

/** Lo que no debe moverse si la aplicación de verdad no atendió. */
// ── el precio especial ─────────────────────────────────────────────────────

test("el precio especial, por las rutas: se da con la clave de quien autoriza, la cuenta lo muestra, el comprobante lleva el nombre del cliente y no dice que fue especial, y el cierre lo lista", () =>
  conMundo(async (m) => {
    const [carton, pet] = [await material(m.db, "Cartón"), await material(m.db, "PET")];
    const jefe = await m.adentro("responsable");
    await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/arranque/terminar", { saldos: [{ material: carton, kg: "500", origen: "contado" }] });
    await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/jornada/abrir");
    await jefe.bien(await ruta("precios", "POST"), "POST", "/api/precios", { cambios: [{ material: carton, compra: "2.1", venta: "2.5" }, { material: pet, compra: "7.5", venta: "8.9" }] });
    await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/precios/publicar");

    const caja = await m.adentro("mostrador");
    const [dar, quitar, verClientes] = [await ruta("cuentas/[cuenta]/precio-especial", "POST"), await ruta("cuentas/[cuenta]/precio-especial/quitar", "POST"), await ruta("clientes", "GET")];
    const cuenta = randomUUID();
    const p = { parametros: { cuenta } };
    const [lineaCarton, lineaPet] = [randomUUID(), randomUUID()];
    await caja.bien(await ruta("cuentas", "POST"), "POST", "/api/cuentas", { id: cuenta, tipo: "compra", etiqueta: null });
    const agregar = await ruta("cuentas/[cuenta]/materiales", "POST");
    await caja.bien(agregar, "POST", `/api/cuentas/${cuenta}/materiales`, { linea: lineaCarton, captura: randomUUID(), material: carton, bascula: 2, kg: "100" }, p);
    const antes = (await caja.bien(agregar, "POST", `/api/cuentas/${cuenta}/materiales`, { linea: lineaPet, captura: randomUUID(), material: pet, bascula: 2, kg: "8" }, p)).cuenta;
    // Sin precio especial: el precio es el de lista, no hay evento que mandar como «visto», y la cuenta es anónima.
    assert.deepEqual(
      antes.materiales.map((x: any) => [x.precio, x.precioDeLista, x.eventoDePrecio, x.precioEspecial]),
      [["2.1000", "2.1000", null, null], ["7.5000", "7.5000", null, null]],
    );
    assert.equal(antes.cliente, null);
    assert.deepEqual((await caja.bien(verClientes, "GET", "/api/clientes")).clientes, []);

    // Con la clave mal: 401, y nada cambia. La clave no viaja de regreso.
    const pedido = { id: randomUUID(), linea: lineaCarton, visto: null, cliente: null, clienteNuevo: "  Don   Chuy ", diferencia: "0.5", autoriza: m.personas.responsable, clave: "000001" };
    const mal = await caja.pedir(dar, "POST", `/api/cuentas/${cuenta}/precio-especial`, pedido, p);
    assert.equal(mal.status, 401);
    const cuerpoMal = await mal.text();
    assert.equal(JSON.parse(cuerpoMal).error.codigo, "CLAVE");
    assert.ok(!cuerpoMal.includes("000001"));
    assert.equal((await una(m.db, "SELECT count(*)::int AS n FROM precio_especial")).n, 0);

    // Con la clave buena, el mismo envío: entra. La respuesta es la cuenta como quedó.
    const dada = (await caja.bien(dar, "POST", `/api/cuentas/${cuenta}/precio-especial`, { ...pedido, clave: CLAVES.responsable }, p)).cuenta;
    const deCarton = dada.materiales[0];
    assert.deepEqual([deCarton.precio, deCarton.precioDeLista, deCarton.importe, deCarton.precioEspecial], ["2.6000", "2.1000", "260.00", { autorizo: "De responsable" }]);
    assert.ok(/^[0-9]+$/.test(deCarton.eventoDePrecio));
    assert.equal(dada.cliente.nombre, "Don Chuy");
    assert.ok(dada.revision > antes.revision);
    assert.deepEqual(dada.resumen, { materiales: 2, porPesar: 0, suma: "320.00", ajuste: "0.00", total: "320" });
    // Repetido —se perdió la respuesta—: lo mismo, sin otro registro. Y ya está en la lista de clientes.
    assert.equal((await caja.bien(dar, "POST", `/api/cuentas/${cuenta}/precio-especial`, { ...pedido, clave: CLAVES.responsable }, p)).cuenta.revision, dada.revision);
    assert.equal((await una(m.db, "SELECT count(*)::int AS n FROM precio_especial")).n, 1);
    const clientes = (await caja.bien(verClientes, "GET", "/api/clientes")).clientes;
    assert.deepEqual(clientes, [{ id: dada.cliente.id, nombre: "Don Chuy" }]);
    // Un envío cancelado lo dice sin mirar la clave: no es «la clave no pasó», y no deja un intento contado.
    const cancelado = randomUUID();
    await m.db.query("SELECT cancelar_envio($1, $2)", [cancelado, m.personas.mostrador]);
    const yaNoSirve = await caja.pedir(dar, "POST", `/api/cuentas/${cuenta}/precio-especial`, { ...pedido, id: cancelado, linea: lineaPet }, p);
    assert.deepEqual([yaNoSirve.status, (await yaNoSirve.json()).error.codigo], [409, "RC012"]);
    assert.equal((await una(m.db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [m.personas.responsable])).fallos, 0);

    // Al segundo material, al mismo cliente por su número, hacia abajo; y luego se le quita, diciendo qué se vio.
    const conDos = (await caja.bien(dar, "POST", `/api/cuentas/${cuenta}/precio-especial`,
      { id: randomUUID(), linea: lineaPet, visto: null, cliente: clientes[0].id, clienteNuevo: null, diferencia: "-0.25", autoriza: m.personas.responsable, clave: CLAVES.responsable }, p)).cuenta;
    assert.equal(conDos.materiales[1].precio, "7.2500");
    const atrasada = await caja.pedir(quitar, "POST", `/api/cuentas/${cuenta}/precio-especial/quitar`, { id: randomUUID(), linea: lineaPet, visto: null }, p);
    assert.deepEqual([atrasada.status, (await atrasada.json()).error.codigo], [409, "RC011"]);
    const sinEl = (await caja.bien(quitar, "POST", `/api/cuentas/${cuenta}/precio-especial/quitar`, { id: randomUUID(), linea: lineaPet, visto: conDos.materiales[1].eventoDePrecio }, p)).cuenta;
    assert.deepEqual([sinEl.materiales[1].precio, sinEl.materiales[1].precioEspecial], ["7.5000", null]);
    assert.ok(sinEl.materiales[1].eventoDePrecio !== conDos.materiales[1].eventoDePrecio, "quitar deja su propio evento: es lo que hay que haber visto para volver a dar");
    assert.equal(sinEl.cliente.nombre, "Don Chuy");
    // La misma cuenta, vista por su ruta, dice lo mismo.
    assert.deepEqual((await caja.bien(await ruta("cuentas/[cuenta]", "GET"), "GET", `/api/cuentas/${cuenta}`, undefined, p)).cuenta, sinEl);

    // Se cobra. El comprobante lleva el precio que se aplicó y el nombre del cliente; no dice «especial» ni trae el de lista.
    await caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", `/api/cuentas/${cuenta}/confirmar`, { revision: sinEl.revision }, p);
    const papel = await caja.bien(await ruta("comprobantes/[operacion]", "GET"), "GET", `/api/comprobantes/${cuenta}`, undefined, { parametros: { operacion: cuenta } });
    assert.equal(papel.comprobante.cliente, "Don Chuy");
    assert.deepEqual(papel.comprobante.materiales.map((x: any) => x.precio), ["2.6000", "7.5000"]);
    const crudo = JSON.stringify(papel).toLowerCase();
    assert.ok(!crudo.includes("especial") && !crudo.includes("lista") && !crudo.includes("2.1000"), "el comprobante delata el precio especial");
    // Una cuenta sin precio especial sigue saliendo anónima.
    const otra = randomUUID();
    await caja.bien(await ruta("cuentas", "POST"), "POST", "/api/cuentas", { id: otra, tipo: "compra", etiqueta: null });
    const o = (await caja.bien(agregar, "POST", `/api/cuentas/${otra}/materiales`, { linea: randomUUID(), captura: randomUUID(), material: pet, bascula: 2, kg: "2" }, { parametros: { cuenta: otra } })).cuenta;
    await caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", `/api/cuentas/${otra}/confirmar`, { revision: o.revision }, { parametros: { cuenta: otra } });
    assert.equal((await caja.bien(await ruta("comprobantes/[operacion]", "GET"), "GET", `/api/comprobantes/${otra}`, undefined, { parametros: { operacion: otra } })).comprobante.cliente, null);

    // Y una venta, con el precio hacia abajo, a otro cliente.
    const venta = randomUUID();
    const pv = { parametros: { cuenta: venta } };
    const lineaVenta = randomUUID();
    await caja.bien(await ruta("cuentas", "POST"), "POST", "/api/cuentas", { id: venta, tipo: "venta", etiqueta: null });
    await caja.bien(agregar, "POST", `/api/cuentas/${venta}/materiales`, { linea: lineaVenta, captura: randomUUID(), material: carton, bascula: 2, kg: "40" }, pv);
    const vendida = (await caja.bien(dar, "POST", `/api/cuentas/${venta}/precio-especial`,
      { id: randomUUID(), linea: lineaVenta, visto: null, cliente: null, clienteNuevo: "Doña Mari", diferencia: "-0.3", autoriza: m.personas.responsable, clave: CLAVES.responsable }, pv)).cuenta;
    const cobrada = await caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", `/api/cuentas/${venta}/confirmar`, { revision: vendida.revision }, pv);

    // El cierre: lo que se dio, a quién, cuánto dinero significó y quién autorizó; compras y ventas, aparte.
    const cierre = (await caja.bien(await ruta("cierre", "GET"), "GET", "/api/cierre")).cierre;
    assert.deepEqual(cierre.preciosEspeciales, {
      compras: [{ folio: papel.comprobante.folio, cliente: "Don Chuy", material: "Cartón", kg: "100.000", precioDeLista: "2.1000", precio: "2.6000", diferencia: "50.00", autorizo: "De responsable" }],
      ventas: [{ folio: cobrada.cuenta.folio, cliente: "Doña Mari", material: "Cartón", kg: "40.000", precioDeLista: "2.5000", precio: "2.2000", diferencia: "-12.00", autorizo: "De responsable" }],
      diferenciaEnCompras: "50.00",
      diferenciaEnVentas: "-12.00",
    });
    // Quien no cobra no ve la lista de clientes ni da precios.
    const patio = await m.adentro("patio");
    assert.equal((await patio.pedir(verClientes, "GET", "/api/clientes")).status, 403);
    // Dado de baja por la consola, el cliente ya no se ofrece; los demás, sí, por nombre.
    await m.db.query("SELECT baja_de_cliente($1)", [clientes[0].id]);
    assert.deepEqual((await caja.bien(verClientes, "GET", "/api/clientes")).clientes.map((c: any) => c.nombre), ["Doña Mari"]);
  }));

const huella = async (db: pg.Client) =>
  (await una(db, `SELECT (SELECT count(*) FROM operacion)::int AS operaciones, (SELECT count(*) FROM movimiento_inventario)::int AS movimientos,
                         (SELECT count(*) FROM envio)::int AS envios, (SELECT count(*) FROM sesion)::int AS sesiones,
                         (SELECT count(*) FROM bitacora)::int AS bitacora, (SELECT count(*) FROM equipo)::int AS equipos`));

test("con la base en otra versión del esquema ninguna ruta atiende, aunque la sesión y el cuerpo sean válidos, y nada queda escrito", () =>
  conMundo(async (m) => {
    const [carton, pet] = [await material(m.db, "Cartón"), await material(m.db, "PET")];
    await m.db.query("SELECT terminar_arranque('[]'::jsonb, $1)", [m.personas.responsable]);
    await m.db.query("SELECT abrir_jornada_de_hoy($1)", [m.personas.mostrador]);
    await m.db.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [carton, m.personas.responsable]);
    await m.db.query("SELECT publicar_lista_de_hoy($1)", [m.personas.responsable]);
    const responsable = await m.adentro("responsable");
    const sinEntrar = await m.equipo();
    const codigo = (await una(m.db, "SELECT crear_codigo_alta('Otro') AS c")).c;
    const abrir = await ruta("cuentas", "POST");
    // Con la base como debe, se atiende.
    assert.equal((await responsable.pedir(abrir, "POST", "/api/cuentas", { id: randomUUID(), tipo: "compra", etiqueta: null })).status, 200);

    // Alguien aplicó a la base una migración que esta aplicación no conoce.
    await m.db.query("INSERT INTO migracion (archivo) VALUES ('9999_de_otra_version.sql')");
    const antes = await huella(m.db);
    const atendieron: string[] = [];
    for (const r of await rutasEnDisco()) {
      // La preferencia de contraste es de la pantalla y no toca la base: atiende igual, a propósito (su prueba, abajo).
      if (r.clave === "POST equipo/contraste") continue;
      const cuerpo = BIEN_FORMADAS[r.clave]?.cuerpo(m, carton, pet)
        ?? (r.clave === "POST equipo/alta" ? { codigo } : r.clave === "POST sesion/entrar" ? { persona: m.personas.mostrador, clave: CLAVES.mostrador } : {});
      for (const quien of [responsable, sinEntrar, new Navegador()]) {
        const respuesta = await quien.pedir(r.manejador, r.metodo, `/api/${r.camino}`, cuerpo, { parametros: PARAMETROS });
        if (respuesta.status !== 503) atendieron.push(`${r.clave} contestó ${respuesta.status}`);
        else if (r.clave !== "GET salud") assert.equal((await respuesta.json()).error.codigo, "INTERNO");
      }
    }
    assert.deepEqual(atendieron, []);
    assert.deepEqual(await huella(m.db), antes, "algo quedó escrito aunque la base no era apta");

    // Y al quitarla vuelve a atender, sin reiniciar nada.
    await m.db.query("DELETE FROM migracion WHERE archivo = '9999_de_otra_version.sql'");
    assert.equal((await responsable.pedir(abrir, "POST", "/api/cuentas", { id: randomUUID(), tipo: "compra", etiqueta: null })).status, 200);
  }));

// ── en mantenimiento ───────────────────────────────────────────────────────
//
// La operación se cierra y se abre en la base (0026). Cerrada, ninguna ruta de negocio atiende: lo
// consulta cada ruta en cada petición, así que no depende de reiniciar nada ni de qué contenedor
// conteste. La salud dice dos cosas por separado: que la aplicación está lista, y si está abierta.

test("en mantenimiento ninguna ruta de negocio atiende, aunque la sesión y el cuerpo sean válidos, y nada queda escrito; la salud dice lista y cerrada; y al abrir, todo vuelve", () =>
  conMundo(async (m) => {
    const [carton, pet] = [await material(m.db, "Cartón"), await material(m.db, "PET")];
    await m.db.query("SELECT terminar_arranque('[]'::jsonb, $1)", [m.personas.responsable]);
    await m.db.query("SELECT abrir_jornada_de_hoy($1)", [m.personas.mostrador]);
    await m.db.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [carton, m.personas.responsable]);
    await m.db.query("SELECT publicar_lista_de_hoy($1)", [m.personas.responsable]);
    const responsable = await m.adentro("responsable");
    const sinEntrar = await m.equipo();
    const [abrir, salud] = [await ruta("cuentas", "POST"), await ruta("salud", "GET")];
    const verSalud = async () => {
      const r = await new Navegador().pedir(salud, "GET", "/api/salud");
      return [r.status, await r.json()];
    };
    assert.equal((await responsable.pedir(abrir, "POST", "/api/cuentas", { id: randomUUID(), tipo: "compra", etiqueta: null })).status, 200);
    assert.deepEqual(await verSalud(), [200, { bien: true, abierta: true }]);

    await m.db.query("SELECT cerrar_operacion('Publicar una versión', 'pub-1')");
    const antes = await huella(m.db);
    const atendieron: string[] = [];
    for (const r of await rutasEnDisco()) {
      // La salud es la que informa, y la preferencia de contraste es de la pantalla y no toca la base: siguen.
      if (r.clave === "GET salud" || r.clave === "POST equipo/contraste") continue;
      const cuerpo = BIEN_FORMADAS[r.clave]?.cuerpo(m, carton, pet)
        ?? (r.clave === "POST equipo/alta" ? { codigo: "AAAAA-AAAAA" } : r.clave === "POST sesion/entrar" ? { persona: m.personas.mostrador, clave: CLAVES.mostrador } : {});
      for (const quien of [responsable, sinEntrar, new Navegador()]) {
        const respuesta = await quien.pedir(r.manejador, r.metodo, `/api/${r.camino}`, cuerpo, { parametros: PARAMETROS });
        const dijo = respuesta.status === 503 ? (await respuesta.json()).error.codigo : `contestó ${respuesta.status}`;
        if (dijo !== "MANTENIMIENTO") atendieron.push(`${r.clave}: ${dijo}`);
      }
    }
    assert.deepEqual(atendieron, []);
    assert.deepEqual(await huella(m.db), antes, "algo quedó escrito con la operación cerrada");
    // La aplicación está lista —el contenedor está sano—, y la operación, cerrada.
    assert.deepEqual(await verSalud(), [200, { bien: true, abierta: false }]);
    assert.equal((await new Navegador().pedir(await ruta("equipo/contraste", "POST"), "POST", "/api/equipo/contraste", { contraste: "alto" })).status, 200);

    // Decidir abrir todavía no abre.
    await m.db.query("SELECT decidir_abrir('pub-1')");
    assert.equal((await responsable.pedir(abrir, "POST", "/api/cuentas", { id: randomUUID(), tipo: "compra", etiqueta: null })).status, 503);
    // Abrir, sí: sin reiniciar nada, la misma sesión sigue valiendo.
    await m.db.query("SELECT abrir_operacion('pub-1', (SELECT id FROM vida))");
    assert.equal((await responsable.pedir(abrir, "POST", "/api/cuentas", { id: randomUUID(), tipo: "compra", etiqueta: null })).status, 200);
    assert.deepEqual(await verSalud(), [200, { bien: true, abierta: true }]);

    // Si no se puede preguntar si está abierta, no se supone que lo está: se trata como cerrada.
    await m.db.query("REVOKE SELECT ON mantenimiento FROM feruga_app");
    try {
      const sinSaber = await responsable.pedir(abrir, "POST", "/api/cuentas", { id: randomUUID(), tipo: "compra", etiqueta: null });
      assert.deepEqual([sinSaber.status, (await sinSaber.json()).error.codigo], [503, "MANTENIMIENTO"]);
    } finally {
      await m.db.query("GRANT SELECT ON mantenimiento TO feruga_app");
    }
  }));

test("la salud da el detalle —qué versión contesta, qué esquema espera y sobre qué base— solo a quien se acredita como el comprobador", () =>
  conMundo(async (m) => {
    const { GET: salud } = await import("../src/app/api/salud/route.ts");
    const { credencialDelComprobador } = await import("../src/servidor/comprobador.ts");
    const { ESQUEMA_ESPERADO } = await import("../src/servidor/esquema.ts");
    const pedir = async (encabezados: Record<string, string> = {}) => (await salud(new Request("http://prueba/api/salud", { headers: encabezados }))).json();
    const marca = (await una(m.db, "SELECT id FROM vida")).id;
    const anterior = process.env.VERSION;
    process.env.VERSION = "version-de-prueba";
    try {
      // Sin acreditarse, o con una credencial que no es: lo mínimo, como cualquiera en internet.
      assert.deepEqual(await pedir(), { bien: true, abierta: true });
      assert.deepEqual(await pedir({ "x-comprobador": "0".repeat(64) }), { bien: true, abierta: true });
      assert.deepEqual(await pedir({ "x-comprobador": credencialDelComprobador("otra-clave-que-no-es-la-de-esta-instalacion") }), { bien: true, abierta: true });
      // El comprobador de esta instalación, que tiene su mismo entorno, sí.
      const credencial = credencialDelComprobador(process.env.SESION_CLAVE!);
      assert.match(credencial, /^[0-9a-f]{64}$/);
      assert.ok(!credencial.includes(process.env.SESION_CLAVE!), "la credencial es la clave misma");
      assert.deepEqual(await pedir({ "x-comprobador": credencial }), { bien: true, abierta: true, version: "version-de-prueba", esquema: ESQUEMA_ESPERADO, base: marca });
      // Cerrada, el detalle sigue: es lo que se comprueba antes de abrir.
      await m.db.query("SELECT cerrar_operacion('Publicar', 'pub-1')");
      assert.deepEqual(await pedir({ "x-comprobador": credencial }), { bien: true, abierta: false, version: "version-de-prueba", esquema: ESQUEMA_ESPERADO, base: marca });
    } finally {
      if (anterior === undefined) delete process.env.VERSION;
      else process.env.VERSION = anterior;
    }
  }));

test("si la base no contesta, las rutas dicen que el sistema no está disponible, igual que la salud", async () => {
  // Un pozo que apunta a donde no hay base.
  const sinBase = crearBd("postgres://feruga_prueba:prueba@127.0.0.1:9/no_hay", { conexiones: 1 });
  usarBd(sinBase);
  try {
    const { GET: salud } = await import("../src/app/api/salud/route.ts");
    assert.equal((await salud()).status, 503);
    const r = await new Navegador().pedir(await ruta("cuentas", "POST"), "POST", "/api/cuentas", { id: randomUUID(), tipo: "compra", etiqueta: null });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.codigo, "INTERNO");
  } finally {
    usarBd(null);
    await sinBase.cerrar().catch(() => {});
  }
});

// «Más contraste, para el sol» se recuerda por equipo en una galleta propia, que pone el servidor.
// No pide sesión ni equipo dado de alta, y no toca la base: tiene que servir en la pantalla de
// entrada, con la base caída y con el sistema en mantenimiento.
test("la preferencia de contraste: una galleta propia y duradera, solo «alto» o «normal», solo desde la propia aplicación, y sin base", async () => {
  const contraste = await ruta("equipo/contraste", "POST");
  // Un pozo que apunta a donde no hay base: la ruta no se entera.
  const sinBase = crearBd("postgres://feruga_prueba:prueba@127.0.0.1:9/no_hay", { conexiones: 1 });
  usarBd(sinBase);
  try {
    for (const valor of ["alto", "normal"]) {
      const r = await new Navegador().pedir(contraste, "POST", "/api/equipo/contraste", { contraste: valor });
      assert.equal(r.status, 200, valor);
      assert.deepEqual(await r.json(), { contraste: valor });
      const galleta = r.headers.get("set-cookie")!;
      const [par, ...atributos] = galleta.split(";").map((x) => x.trim());
      assert.equal(par, `contraste=${valor}`);
      // Aparte de la de la sesión; para todo el sitio; no la lee el código de la página; y dura.
      assert.ok(atributos.includes("Path=/") && atributos.includes("HttpOnly") && atributos.includes("SameSite=Lax"), galleta);
      const dura = Number(atributos.find((a) => a.startsWith("Max-Age="))?.slice(8));
      assert.ok(dura >= 60 * 60 * 24 * 365, `dura ${dura} segundos`);
      assert.ok(!atributos.some((a) => a.startsWith("Domain=")), "debe ser solo de este sitio");
      assert.ok(!atributos.includes("Secure"), "sin HTTPS no se marca como segura (en operación sí: abajo)");
    }
    // Lo que no es una de las dos palabras no pone nada.
    const malas: Array<[unknown, Extra?]> = [
      [{ contraste: "altísimo" }], [{ contraste: "" }], [{ contraste: 1 }], [{ contraste: null }], [{}], [{ contraste: "alto; Path=/otra" }],
      [{ contraste: "alto" }, { crudo: "no es json" }], [{ contraste: "alto" }, { crudo: "[]" }], [{ contraste: "alto" }, { tipo: "text/plain" }],
    ];
    for (const [cuerpo, extra] of malas) {
      const r = await new Navegador().pedir(contraste, "POST", "/api/equipo/contraste", cuerpo, extra);
      assert.deepEqual([r.status, await codigoDe(r)], [400, "FORMA"], JSON.stringify([cuerpo, extra]));
      assert.equal(r.headers.get("set-cookie"), null);
    }
    // Ni desde otro sitio, ni sin decir de dónde viene.
    for (const origen of ["http://otro.sitio", null]) {
      const r = await new Navegador().pedir(contraste, "POST", "/api/equipo/contraste", { contraste: "alto" }, { origen });
      assert.deepEqual([r.status, await codigoDe(r)], [403, "ORIGEN"]);
      assert.equal(r.headers.get("set-cookie"), null);
    }
    // En operación la aplicación va por HTTPS, y entonces la galleta solo viaja cifrada.
    process.env.COOKIE_SEGURA = "1";
    try {
      const r = await new Navegador().pedir(contraste, "POST", "/api/equipo/contraste", { contraste: "alto" });
      assert.ok(r.headers.get("set-cookie")!.split(";").map((x) => x.trim()).includes("Secure"));
    } finally {
      delete process.env.COOKIE_SEGURA;
    }
  } finally {
    usarBd(null);
    await sinBase.cerrar().catch(() => {});
  }
});

test("lo que la galleta de contraste diga se lee con cuidado: «alto», «normal», o nada", async () => {
  const { contrasteElegido } = await import("../src/servidor/contraste.ts");
  assert.equal(contrasteElegido("alto"), "alto");
  assert.equal(contrasteElegido("normal"), "normal");
  for (const raro of [undefined, "", "ALTO", "alto ", "si", "1", "<script>", "normal\";x=\""]) assert.equal(contrasteElegido(raro), null, String(raro));
});
