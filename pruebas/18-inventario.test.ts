// Las entradas de inventario: contar, dar merma, separar y corregir. Cada una recibe a la persona,
// valida, se puede repetir sin duplicar, y —cuando pide autorización— comprueba ella misma la
// clave de quien autoriza. Todas las pruebas llaman con las credenciales de la aplicación.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import {
  CERRAR_CON_CORTE, abrirCuenta, abrirJornada, agregarMaterial, comoApp, compraDe, conApp, confirmar, contar as cuantos, cuenta, desenlace, equipoDeAlta,
  esperarQueEspere, existencia, personaConClave, pidDe, rechaza, renglon, una,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";

const SIN_PERMISO = "42501";
const CLAVE = "481516";

interface Patio {
  app: pg.Client;
  db: pg.Client;
  e: Escenario;
  base: string;
  /** La huella del equipo desde el que se autoriza. */
  huella: string;
}

/** Un día en marcha, con un equipo dado de alta y el responsable (facultado) con su clave. */
const conPatio = (prueba: (p: Patio) => Promise<void>) =>
  conApp(async (app, db, e, base) => {
    await db.query("SELECT fijar_clave($1, $2)", [e.responsable, CLAVE]);
    // El cajón contado al abrir: sin eso no hay corte, y sin corte la aplicación no cierra (0038).
    await db.query("SELECT abrir_el_cajon(gen_random_uuid(), $1, 100000, $2)", [e.jornada, e.mostrador]);
    await prueba({ app, db, e, base, huella: await equipoDeAlta(db) });
  });

const apertura = (p: Patio, material: number, kg: number) =>
  p.db.query("SELECT registrar_apertura($1, $2, 'contado', $3)", [material, kg, p.e.responsable]);

/** El movimiento que dejó una compra o una venta de un solo material. */
const movimientoDe = (db: pg.Client, op: string) =>
  una(db, "SELECT mv.* FROM movimiento_inventario mv JOIN operacion_linea l ON l.id = mv.linea_id WHERE l.operacion_id = $1", [op]);
const compra = async (p: Patio, material: number, kg: number) => movimientoDe(p.db, await compraDe(p.db, p.e, material, kg));
async function venta(p: Patio, material: number, kg: number) {
  const op = await cuenta(p.db, p.e, "venta");
  await renglon(p.db, p.e, op, material, kg);
  await confirmar(p.db, op, p.e.mostrador);
  return movimientoDe(p.db, op);
}

interface Autoriza {
  envio?: string;
  autoriza?: string;
  clave?: string;
  huella?: string;
  quien?: string;
  con?: pg.Client;
}

/** Lo que la vista previa de un conteo le enseña a quien va a autorizar. */
interface Visto {
  contado_en: string;
  registrado_kg: string;
  diferencia_kg?: string;
}

const previa = (p: Patio, material: number, contado: string, cuando: string | null = null): Promise<Visto> =>
  una(p.app, "SELECT contado_en::text AS contado_en, registrado_kg, diferencia_kg FROM previa_de_conteo($1, $2, $3)", [material, contado, cuando]) as Promise<Visto>;

/** Cuenta un material como lo hace la pantalla: pide la vista previa y manda lo que vio. */
async function contarMaterial(
  p: Patio, material: number, contado: string,
  o: Autoriza & { cuando?: string | null; visto?: Visto; nota?: string | null } = {},
) {
  const visto = o.visto ?? (await previa(p, material, contado, o.cuando ?? null));
  return una(o.con ?? p.app, "SELECT * FROM contar_material($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
    o.envio ?? randomUUID(), material, contado, visto.contado_en, visto.registrado_kg, o.nota ?? null,
    o.autoriza ?? p.e.responsable, o.clave ?? CLAVE, o.huella ?? p.huella, o.quien ?? p.e.mostrador,
  ]);
}

const correccionesDe = (db: pg.Client, movimiento: string) => cuantos(db, "movimiento_inventario", "referencia_id = $1", [movimiento]);

/** Corrige un movimiento como lo hace la pantalla: manda cuántas correcciones le vio. */
async function corregir(p: Patio, movimiento: string, material: number, kg: string, o: Autoriza & { vistas?: number; motivo?: string | null } = {}) {
  return una(o.con ?? p.app, "SELECT * FROM corregir_movimiento($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
    o.envio ?? randomUUID(), movimiento, material, kg, o.vistas ?? (await correccionesDe(p.db, movimiento)),
    o.motivo === undefined ? "Se capturó mal" : o.motivo, o.autoriza ?? p.e.responsable, o.clave ?? CLAVE, o.huella ?? p.huella,
    o.quien ?? p.e.mostrador,
  ]);
}

const merma = (p: Patio, material: number, kg: string, motivo: string | null = "Mojado", envio = randomUUID(), quien = p.e.mostrador) =>
  una(p.app, "SELECT * FROM dar_merma($1, $2, $3, $4, $5)", [envio, material, kg, motivo, quien]);

const separar = (p: Patio, origen: number, kg: string, productos: unknown, envio = randomUUID(), quien = p.e.mostrador) =>
  una(p.app, "SELECT * FROM separar_material($1, $2, $3, $4::jsonb, NULL, $5)", [envio, origen, kg, JSON.stringify(productos), quien]);

const estadoDe = async (p: Patio, movimiento: string) =>
  (await p.app.query("SELECT material_id, kg FROM estado_de_movimiento($1) ORDER BY material_id", [movimiento])).rows;

const fallosDe = async (p: Patio, persona = p.e.responsable): Promise<number> =>
  (await una(p.db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [persona])).fallos;

// ── contar ─────────────────────────────────────────────────────────────────

test("contar un material deja la existencia en lo contado, y el conteo con lo que se vio", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const visto = await previa(p, carton, "90");
    assert.deepEqual({ registrado: visto.registrado_kg, diferencia: visto.diferencia_kg }, { registrado: "100.000", diferencia: "-10.000" });
    const c = await contarMaterial(p, carton, "90", { visto, nota: " Se pesó en la báscula 1 " });
    assert.deepEqual(
      { contado: c.contado_kg, registrado: c.registrado_kg, diferencia: c.diferencia_kg, autoriza: c.autorizado_por, quien: c.creado_por, nota: c.nota },
      { contado: "90.000", registrado: "100.000", diferencia: "-10.000", autoriza: p.e.responsable, quien: p.e.mostrador, nota: "Se pesó en la báscula 1" },
    );
    assert.equal(await existencia(p.db, carton), 90);
  }));

test("un conteo en ceros vale: el material se acabó", () =>
  conPatio(async (p) => {
    await apertura(p, p.e.mat["Cartón"], 100);
    const c = await contarMaterial(p, p.e.mat["Cartón"], "0");
    assert.equal(c.diferencia_kg, "-100.000");
    assert.equal(await existencia(p.db, p.e.mat["Cartón"]), 0);
  }));

test("con la clave equivocada no se cuenta nada, la función contesta que no y el intento queda contado", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const envio = randomUUID();
    const r = await contarMaterial(p, carton, "90", { envio, clave: "000000" });
    assert.equal(r.id, null);
    assert.equal(await fallosDe(p), 1);
    assert.equal(await existencia(p.db, carton), 100);
    assert.equal(await cuantos(p.db, "conteo"), 0);
    // El envío no quedó gastado: con la clave buena, el mismo envío entra.
    assert.ok((await contarMaterial(p, carton, "90", { envio })).id);
    assert.equal(await existencia(p.db, carton), 90);
  }));

test("desde un equipo que no está dado de alta no se autoriza nada", () =>
  conPatio(async (p) => {
    await apertura(p, p.e.mat["Cartón"], 100);
    assert.equal((await contarMaterial(p, p.e.mat["Cartón"], "90", { huella: "f".repeat(64) })).id, null);
    assert.equal(await cuantos(p.db, "conteo"), 0);
  }));

test("autoriza una persona facultada y activa: la clave buena de quien no lo está se rechaza sin gastar intento", () =>
  conPatio(async (p) => {
    await apertura(p, p.e.mat["Cartón"], 100);
    const luisa = await personaConClave(p.db, "Luisa", "mostrador", "4815");
    const otro = await personaConClave(p.db, "Marco", "responsable", "271828", false);   // responsable, pero no facultado
    const baja = await personaConClave(p.db, "Ya no está", "responsable", "314159", true);
    await p.db.query("SELECT baja_persona($1)", [baja]);
    for (const [autoriza, clave] of [[luisa, "4815"], [otro, "271828"], [baja, "314159"], ["999999", "000000"]] as const) {
      await rechaza(contarMaterial(p, p.e.mat["Cartón"], "90", { autoriza, clave }), "RC008");
    }
    assert.equal(await fallosDe(p, luisa), 0);
    assert.equal(await cuantos(p.db, "conteo"), 0);
  }));

test("quien atiende puede autorizar si está facultado, tecleando su clave otra vez", () =>
  conPatio(async (p) => {
    await apertura(p, p.e.mat["Cartón"], 100);
    const c = await contarMaterial(p, p.e.mat["Cartón"], "90", { quien: p.e.responsable });
    assert.deepEqual({ autoriza: c.autorizado_por, quien: c.creado_por }, { autoriza: p.e.responsable, quien: p.e.responsable });
    assert.equal((await contarMaterial(p, p.e.mat["PET"], "5", { quien: p.e.responsable, clave: "000000" })).id, null);
  }));

test("repetir el envío de un conteo devuelve el mismo, también cuando no hubo diferencia", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const [uno, dos] = [randomUUID(), randomUUID()];
    const vistoUno = await previa(p, carton, "100");
    const a = await contarMaterial(p, carton, "100", { envio: uno, visto: vistoUno });
    const vistoDos = await previa(p, carton, "100");
    const b = await contarMaterial(p, carton, "100", { envio: dos, visto: vistoDos });
    assert.notEqual(a.id, b.id);
    assert.equal((await contarMaterial(p, carton, "100", { envio: uno, visto: vistoUno })).id, a.id);
    assert.equal((await contarMaterial(p, carton, "100.000", { envio: dos, visto: vistoDos })).id, b.id);
    // El reintento no vuelve a pedir la clave ni a contar fallos: no hace nada.
    assert.equal((await contarMaterial(p, carton, "100", { envio: uno, visto: vistoUno, clave: "000000" })).id, a.id);
    assert.equal(await fallosDe(p), 0);
    assert.equal(await cuantos(p.db, "conteo"), 2);
  }));

test("el mismo envío de conteo con otro contenido se rechaza", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const envio = randomUUID();
    const visto = await previa(p, carton, "90");
    await contarMaterial(p, carton, "90", { envio, visto });
    await rechaza(contarMaterial(p, carton, "80", { envio, visto }), "RC012");
    await rechaza(contarMaterial(p, p.e.mat["PET"], "90", { envio, visto }), "RC012");
    await rechaza(contarMaterial(p, carton, "90", { envio, visto, nota: "otra nota" }), "RC012");
    assert.equal(await existencia(p.db, carton), 90);
  }));

test("dos envíos a la vez del mismo conteo dejan uno solo", () =>
  conPatio(async (p) => {
    const otra = await comoApp(p.base);
    try {
      const carton = p.e.mat["Cartón"];
      await apertura(p, carton, 100);
      const envio = randomUUID();
      const visto = await previa(p, carton, "90");
      const pid = await pidDe(otra);
      await p.app.query("BEGIN");
      const primero = await contarMaterial(p, carton, "90", { envio, visto });
      const segundo = contarMaterial(p, carton, "90", { envio, visto, con: otra });
      await esperarQueEspere(p.db, pid);
      await p.app.query("COMMIT");
      assert.equal((await segundo).id, primero.id);
      assert.equal(await cuantos(p.db, "conteo"), 1);
      assert.equal(await existencia(p.db, carton), 90);
    } finally {
      await otra.end();
    }
  }));

test("un conteo con hora anterior no pierde lo que se vendió después de contar", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const alContar = (await una(p.db, "SELECT clock_timestamp()::text AS t")).t;   // se cuentan 95
    await venta(p, carton, 30);
    const visto = await previa(p, carton, "95", alContar);
    assert.deepEqual({ registrado: visto.registrado_kg, diferencia: visto.diferencia_kg }, { registrado: "100.000", diferencia: "-5.000" });
    await contarMaterial(p, carton, "95", { visto });
    assert.equal(await existencia(p.db, carton), 65);
  }));

test("un conteo a futuro, de antes de la jornada, o más viejo que el último, se rechaza desde la vista previa", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const antes = (await una(p.db, "SELECT clock_timestamp()::text AS t")).t;
    await contarMaterial(p, carton, "90");
    for (const cuando of ["2099-01-01 00:00:00+00", "1900-01-01 00:00:00+00", antes]) {
      await rechaza(previa(p, carton, "80", cuando), "RC005");
      await rechaza(contarMaterial(p, carton, "80", { visto: { contado_en: cuando, registrado_kg: "100.000" } }), "RC005");
    }
    assert.equal(await cuantos(p.db, "conteo"), 1);
  }));

test("si lo que el libro decía cambió desde la vista previa, el conteo no se asienta: hay que volver a verlo", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const original = await compra(p, carton, 180);                       // eran 18
    const visto = await previa(p, carton, "18");                         // el libro dice 180: diferencia −162
    assert.equal(visto.diferencia_kg, "-162.000");
    await corregir(p, original.id, carton, "18");                        // mientras tanto alguien corrige la compra
    await rechaza(contarMaterial(p, carton, "18", { visto }), "RC011");
    assert.equal(await existencia(p.db, carton), 18);
    assert.equal(await cuantos(p.db, "conteo"), 0);
    assert.equal(await cuantos(p.db, "envio", "clase = 'conteo'"), 0);
    // Vista de nuevo, ya no hay diferencia.
    assert.equal((await contarMaterial(p, carton, "18")).diferencia_kg, "0.000");
  }));

test("un conteo sin diferencia llega cuando la jornada se está cerrando: espera y se rechaza", () =>
  conPatio(async (p) => {
    const otra = await comoApp(p.base);
    try {
      const carton = p.e.mat["Cartón"];
      await apertura(p, carton, 100);
      const visto = await previa(p, carton, "100");
      const pid = await pidDe(otra);
      await p.app.query("BEGIN");
      await p.app.query(CERRAR_CON_CORTE, [p.e.mostrador, p.e.responsable, p.huella, CLAVE]);
      const conteo = desenlace(contarMaterial(p, carton, "100", { visto, con: otra }));
      await esperarQueEspere(p.db, pid);
      await p.app.query("COMMIT");
      assert.equal(await conteo, "RC006");
      assert.equal(await cuantos(p.db, "conteo"), 0);
    } finally {
      await otra.end();
    }
  }));

test("la jornada se cierra mientras se asienta un conteo sin diferencia: el cierre espera y el conteo queda", () =>
  conPatio(async (p) => {
    const otra = await comoApp(p.base);
    try {
      const carton = p.e.mat["Cartón"];
      await apertura(p, carton, 100);
      const pid = await pidDe(otra);
      await p.app.query("BEGIN");
      const c = await contarMaterial(p, carton, "100");
      const cierre = desenlace(otra.query(CERRAR_CON_CORTE, [p.e.mostrador, p.e.responsable, p.huella, CLAVE]));
      await esperarQueEspere(p.db, pid);
      await p.app.query("COMMIT");
      assert.equal(await cierre, "pasó");
      assert.equal((await una(p.db, "SELECT jornada_id FROM conteo WHERE id = $1", [c.id])).jornada_id, p.e.jornada);
    } finally {
      await otra.end();
    }
  }));

// ── merma ──────────────────────────────────────────────────────────────────

test("la merma baja la existencia con su motivo, y repetir el envío no asienta otra", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const envio = randomUUID();
    const m = await merma(p, carton, "12.5", "  Mojado ", envio);
    assert.deepEqual({ tipo: m.tipo, kg: m.cantidad_kg, motivo: m.motivo, quien: m.creado_por }, { tipo: "merma", kg: "-12.500", motivo: "Mojado", quien: p.e.mostrador });
    assert.equal((await merma(p, carton, "12.500", "Mojado", envio)).id, m.id);
    assert.equal(await existencia(p.db, carton), 87.5);
    await rechaza(merma(p, carton, "13", "Mojado", envio), "RC012");
    await rechaza(merma(p, carton, "12.5", "Basura", envio), "RC012");
    assert.equal(await cuantos(p.db, "movimiento_inventario", "tipo = 'merma'"), 1);
  }));

test("una merma que no alcanza se rechaza y no gasta su envío", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 10);
    const envio = randomUUID();
    await rechaza(merma(p, carton, "11", "Mojado", envio), "RC002");
    assert.equal(await cuantos(p.db, "envio", "id = $1", [envio]), 0);
    assert.ok((await merma(p, carton, "10", "Mojado", envio)).id);
    assert.equal(await existencia(p.db, carton), 0);
  }));

test("repetir una merma después de cerrar la jornada devuelve la que ya estaba", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const envio = randomUUID();
    const m = await merma(p, carton, "10", "Mojado", envio);
    await p.app.query(CERRAR_CON_CORTE, [p.e.mostrador, p.e.responsable, p.huella, CLAVE]);
    assert.equal((await merma(p, carton, "10", "Mojado", envio)).id, m.id);
    // Una nueva, en cambio, ya no entra: no hay jornada abierta.
    await rechaza(merma(p, carton, "1", "Mojado"), "RC006");
  }));

// ── separar ────────────────────────────────────────────────────────────────

test("separar consume un material, produce otros y mide lo que se pierde", () =>
  conPatio(async (p) => {
    const [fierro, lamina, pet] = [p.e.mat["Fierro pesado"], p.e.mat["Fierro lámina"], p.e.mat["PET"]];
    await apertura(p, fierro, 100);
    const productos = [{ material: lamina, kg: "60" }, { material: pet, kg: "30.5" }];
    assert.equal((await una(p.app, "SELECT previa_de_separacion($1, $2, $3::jsonb) AS merma", [fierro, "100", JSON.stringify(productos)])).merma, "9.500");
    const envio = randomUUID();
    const t = await separar(p, fierro, "100", productos, envio);
    assert.equal(t.merma_kg, "9.500");
    assert.deepEqual([await existencia(p.db, fierro), await existencia(p.db, lamina), await existencia(p.db, pet)], [0, 60, 30.5]);
    // El mismo envío, con los productos en otro orden y los kilos escritos de otra forma, es el mismo.
    assert.equal((await separar(p, fierro, "100.0", [{ material: pet, kg: "30.500" }, { material: lamina, kg: "60" }], envio)).id, t.id);
    await rechaza(separar(p, fierro, "100", [{ material: lamina, kg: "61" }, { material: pet, kg: "30.5" }], envio), "RC012");
    assert.equal(await cuantos(p.db, "transformacion"), 1);
  }));

test("una separación mal dada se rechaza como regla, sin tocar nada", () =>
  conPatio(async (p) => {
    const [fierro, lamina, pet] = [p.e.mat["Fierro pesado"], p.e.mat["Fierro lámina"], p.e.mat["PET"]];
    await apertura(p, fierro, 100);
    const malas: unknown[] = [
      [], "todos", { material: lamina, kg: "10" }, [lamina], ["texto"], [null],
      [{ kg: "10" }], [{ material: lamina }], [{ material: "lámina", kg: "10" }], [{ material: lamina, kg: "diez" }],
      [{ material: lamina, kg: "0" }], [{ material: lamina, kg: "-5" }], [{ material: lamina, kg: "1.0005" }],
      [{ material: lamina, kg: "Infinity" }], [{ material: lamina, kg: "1000000" }],
      [{ material: lamina, kg: "10" }, { material: lamina, kg: "5" }],          // el mismo producto dos veces
      [{ material: fierro, kg: "10" }],                                          // el origen entre los productos
      [{ material: lamina, kg: "60" }, { material: pet, kg: "41" }],            // pesan más que el origen
      [{ material: 999999, kg: "10" }],
    ];
    for (const productos of malas) {
      const envio = randomUUID();
      await rechaza(separar(p, fierro, "100", productos, envio), "RC007");
      await rechaza(p.app.query("SELECT previa_de_separacion($1, $2, $3::jsonb)", [fierro, "100", JSON.stringify(productos)]), "RC007");
      assert.equal(await cuantos(p.db, "envio", "id = $1", [envio]), 0);
    }
    for (const kg of ["0", "-1", "1.0005", "Infinity", "1000000"]) {
      await rechaza(separar(p, fierro, kg, [{ material: lamina, kg: "1" }]), "RC007");
    }
    await rechaza(separar(p, 999999, "10", [{ material: lamina, kg: "1" }]), "RC005");
    await rechaza(separar(p, fierro, "101", [{ material: lamina, kg: "1" }]), "RC002");
    assert.equal(await existencia(p.db, fierro), 100);
    assert.equal(await cuantos(p.db, "transformacion"), 0);
  }));

// ── corregir ───────────────────────────────────────────────────────────────

test("era otro material: lo que se asentó en uno pasa al otro, y el original queda intacto", () =>
  conPatio(async (p) => {
    const [cobre, aluminio] = [p.e.mat["Cobre de primera"], p.e.mat["Aluminio bote"]];
    const original = await compra(p, cobre, 18);
    const r = await corregir(p, original.id, aluminio, "18", { motivo: "Era aluminio" });
    assert.equal(r.original, original.id);
    assert.equal(r.ajustes.length, 2);
    assert.deepEqual([await existencia(p.db, cobre), await existencia(p.db, aluminio)], [0, 18]);
    const ajustes = (await p.db.query("SELECT tipo, cantidad_kg, referencia_id, motivo, autorizado_por, creado_por, revierte FROM movimiento_inventario WHERE referencia_id = $1 ORDER BY cantidad_kg", [original.id])).rows;
    assert.deepEqual(ajustes, [
      { tipo: "ajuste", cantidad_kg: "-18.000", referencia_id: original.id, motivo: "Era aluminio", autorizado_por: p.e.responsable, creado_por: p.e.mostrador, revierte: false },
      { tipo: "ajuste", cantidad_kg: "18.000", referencia_id: original.id, motivo: "Era aluminio", autorizado_por: p.e.responsable, creado_por: p.e.mostrador, revierte: false },
    ]);
    assert.equal((await una(p.db, "SELECT cantidad_kg, material_id FROM movimiento_inventario WHERE id = $1", [original.id])).cantidad_kg, "18.000");
    assert.deepEqual(await estadoDe(p, original.id), [{ material_id: aluminio, kg: "18.000" }]);
  }));

test("el peso estaba mal: se asienta solo la diferencia", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const original = await compra(p, carton, 180);                       // eran 18
    const r = await corregir(p, original.id, carton, "18");
    assert.equal(r.ajustes.length, 1);
    assert.equal((await una(p.db, "SELECT cantidad_kg FROM movimiento_inventario WHERE id = $1", [r.ajustes[0]])).cantidad_kg, "-162.000");
    assert.equal(await existencia(p.db, carton), 18);
  }));

test("material y peso a la vez, en una sola corrección", () =>
  conPatio(async (p) => {
    const [cobre, aluminio] = [p.e.mat["Cobre de primera"], p.e.mat["Aluminio bote"]];
    const original = await compra(p, cobre, 180);
    await corregir(p, original.id, aluminio, "18");
    assert.deepEqual([await existencia(p.db, cobre), await existencia(p.db, aluminio)], [0, 18]);
  }));

test("no debió registrarse: corregir a cero la deja sin efecto en el inventario", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const original = await compra(p, carton, 50);
    await corregir(p, original.id, carton, "0", { motivo: "Se registró dos veces" });
    assert.equal(await existencia(p.db, carton), 0);
    assert.deepEqual(await estadoDe(p, original.id), []);
    // Y se puede recuperar: no era un error después de todo.
    await corregir(p, original.id, carton, "50", { motivo: "Sí era" });
    assert.equal(await existencia(p.db, carton), 50);
  }));

test("corregir a lo que ya está no asienta nada, pero sí pide la clave", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const original = await compra(p, carton, 50);
    assert.equal((await corregir(p, original.id, carton, "50", { clave: "000000" })).original, null);
    const r = await corregir(p, original.id, carton, "50.000");
    assert.deepEqual(r.ajustes, []);
    assert.equal(await correccionesDe(p.db, original.id), 0);
  }));

test("primero el peso y después el material: la segunda corrección mueve lo que hay, no lo que hubo", () =>
  conPatio(async (p) => {
    const [cobre, aluminio] = [p.e.mat["Cobre de primera"], p.e.mat["Aluminio bote"]];
    const original = await compra(p, cobre, 180);
    await corregir(p, original.id, cobre, "18");
    await corregir(p, original.id, aluminio, "18");
    assert.deepEqual([await existencia(p.db, cobre), await existencia(p.db, aluminio)], [0, 18]);
    // De vuelta al material original, y otra vez el peso.
    await corregir(p, original.id, cobre, "20");
    assert.deepEqual([await existencia(p.db, cobre), await existencia(p.db, aluminio)], [20, 0]);
    assert.deepEqual(await estadoDe(p, original.id), [{ material_id: cobre, kg: "20.000" }]);
  }));

test("corregir una venta y una merma respeta que son salidas", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const vendido = await venta(p, carton, 50);                          // quedan 50
    await corregir(p, vendido.id, carton, "40");                         // en realidad salieron 40
    assert.equal(await existencia(p.db, carton), 60);
    const tirado = await merma(p, carton, "10");                         // quedan 50
    await corregir(p, tirado.id, carton, "1");                           // en realidad se tiró 1
    assert.equal(await existencia(p.db, carton), 59);
    assert.deepEqual(await estadoDe(p, vendido.id), [{ material_id: carton, kg: "-40.000" }]);
  }));

test("una venta que era de otro material necesita que de ese otro haya", () =>
  conPatio(async (p) => {
    const [carton, pet] = [p.e.mat["Cartón"], p.e.mat["PET"]];
    await apertura(p, carton, 100);
    const vendido = await venta(p, carton, 50);
    const envio = randomUUID();
    await rechaza(corregir(p, vendido.id, pet, "50", { envio }), "RC002");
    // No quedó ni el asiento que sí cabía, ni el envío, ni su resultado.
    assert.equal(await correccionesDe(p.db, vendido.id), 0);
    assert.equal(await cuantos(p.db, "envio", "id = $1", [envio]), 0);
    assert.equal(await cuantos(p.db, "envio_resultado"), 0);
    assert.equal(await existencia(p.db, carton), 50);
    await apertura(p, pet, 60);
    await corregir(p, vendido.id, pet, "50", { envio });
    assert.deepEqual([await existencia(p.db, carton), await existencia(p.db, pet)], [100, 10]);
  }));

test("si lo comprado de más ya se vendió, bajar la compra se rechaza entera", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const original = await compra(p, carton, 100);
    await venta(p, carton, 90);
    await rechaza(corregir(p, original.id, carton, "5"), "RC002");
    assert.equal(await existencia(p.db, carton), 10);
    assert.equal(await correccionesDe(p.db, original.id), 0);
  }));

test("solo se corrigen saldo inicial, compras, ventas y mermas; una corrección no se corrige: se corrige su original", () =>
  conPatio(async (p) => {
    const [carton, pet, fierro] = [p.e.mat["Cartón"], p.e.mat["PET"], p.e.mat["Fierro pesado"]];
    await apertura(p, fierro, 100);
    const inicial = await una(p.db, "SELECT id FROM movimiento_inventario WHERE tipo = 'apertura'");
    await corregir(p, inicial.id, fierro, "90");                         // el saldo inicial sí
    const original = await compra(p, carton, 18);
    const r = await corregir(p, original.id, pet, "18");
    await assert.rejects(corregir(p, r.ajustes[0], carton, "1"), (e: any) => e.code === "RC005" && e.message.includes(original.id));
    await separar(p, fierro, "10", [{ material: carton, kg: "9" }]);
    const separado = await una(p.db, "SELECT id FROM movimiento_inventario WHERE tipo = 'transformacion' LIMIT 1");
    await rechaza(corregir(p, separado.id, carton, "1"), "RC005");
    await contarMaterial(p, fierro, "70");
    const deConteo = await una(p.db, "SELECT movimiento_id AS id FROM conteo");
    await rechaza(corregir(p, deConteo.id, fierro, "1"), "RC005");
    await rechaza(corregir(p, "999999", carton, "1"), "RC005");
    await rechaza(corregir(p, original.id, 999999, "1"), "RC005");
  }));

test("lo que ya cubrió un conteo no se corrige: se vuelve a contar", () =>
  conPatio(async (p) => {
    const [carton, pet] = [p.e.mat["Cartón"], p.e.mat["PET"]];
    const original = await compra(p, carton, 100);                       // eran 90
    await contarMaterial(p, carton, "90");                               // el conteo ya lo dejó en 90
    await assert.rejects(corregir(p, original.id, carton, "90"), (e: any) => e.code === "RC005" && /ya se contó/.test(e.message));
    assert.equal(await existencia(p.db, carton), 90);
    // Tampoco pasarlo a un material que se contó después, aunque el suyo no.
    const otro = await compra(p, p.e.mat["Aluminio bote"], 5);
    await compra(p, pet, 1);
    await contarMaterial(p, pet, "1");
    await rechaza(corregir(p, otro.id, pet, "5"), "RC005");
    // Lo que se registra después del conteo sí se corrige.
    const despues = await compra(p, carton, 180);
    await corregir(p, despues.id, carton, "18");
    assert.equal(await existencia(p.db, carton), 108);
  }));

test("un conteo fechado en el mismo instante que un movimiento ya lo cubrió: tampoco se corrige", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const original = await compra(p, carton, 100);                       // eran 80
    const instante = (await una(p.db, "SELECT efectivo_en::text AS t FROM movimiento_inventario WHERE id = $1", [original.id])).t;
    const visto = await previa(p, carton, "90", instante);
    assert.equal(visto.registrado_kg, "100.000");                        // el conteo sí vio esa compra
    await contarMaterial(p, carton, "90", { visto });
    await assert.rejects(corregir(p, original.id, carton, "80"), (e: any) => e.code === "RC005" && /ya se contó/.test(e.message));
    assert.equal(await existencia(p.db, carton), 90);
    assert.equal(await correccionesDe(p.db, original.id), 0);
  }));

test("dos correcciones a la vez del mismo movimiento: la segunda espera y ve que ya cambió", () =>
  conPatio(async (p) => {
    const otra = await comoApp(p.base);
    try {
      const carton = p.e.mat["Cartón"];
      const original = await compra(p, carton, 100);
      const pid = await pidDe(otra);
      await p.app.query("BEGIN");
      await corregir(p, original.id, carton, "80", { vistas: 0 });
      const segunda = desenlace(corregir(p, original.id, carton, "80", { vistas: 0, con: otra }));
      await esperarQueEspere(p.db, pid);
      await p.app.query("COMMIT");
      assert.equal(await segunda, "RC011");
      assert.equal(await existencia(p.db, carton), 80);                  // no 60
      assert.equal(await correccionesDe(p.db, original.id), 1);
    } finally {
      await otra.end();
    }
  }));

test("repetir una corrección devuelve lo que ya hizo, aunque después haya habido otra", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const original = await compra(p, carton, 100);
    const envio = randomUUID();
    const primera = await corregir(p, original.id, carton, "80", { envio, vistas: 0 });
    await corregir(p, original.id, carton, "70");
    // El reintento de la primera no vuelve a imponer 80.
    const otraVez = await corregir(p, original.id, carton, "80", { envio, vistas: 0 });
    assert.deepEqual(otraVez, primera);
    assert.equal(await existencia(p.db, carton), 70);
    await rechaza(corregir(p, original.id, carton, "81", { envio, vistas: 0 }), "RC012");
  }));

test("corregir algo de una jornada cerrada cae en la de hoy, y el cierre de aquella no cambia", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const original = await compra(p, carton, 180);
    await p.app.query(CERRAR_CON_CORTE, [p.e.mostrador, p.e.responsable, p.huella, CLAVE]);
    const ayer = await una(p.db, "SELECT entro_kg, salio_kg FROM cierre_material WHERE jornada_id = $1", [p.e.jornada]);
    // Sin jornada abierta no se corrige.
    await rechaza(corregir(p, original.id, carton, "18"), "RC006");
    const hoy = await abrirJornada(p.db, p.e.responsable, "2026-10-02");
    await p.db.query("SELECT publicar_lista($1, $2)", [hoy.lista, p.e.responsable]);
    const r = await corregir(p, original.id, carton, "18");
    const ajuste = await una(p.db, "SELECT jornada_id, efectivo_en FROM movimiento_inventario WHERE id = $1", [r.ajustes[0]]);
    assert.equal(ajuste.jornada_id, hoy.id);
    assert.equal(ajuste.efectivo_en.getTime(), original.efectivo_en.getTime());
    assert.deepEqual(await una(p.db, "SELECT entro_kg, salio_kg FROM cierre_material WHERE jornada_id = $1", [p.e.jornada]), ayer);
  }));

test("una corrección lleva motivo, y los kilos correctos son un número de cero en adelante", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    const original = await compra(p, carton, 100);
    for (const motivo of [null, "", "   "]) {
      await rechaza(corregir(p, original.id, carton, "90", { motivo }), "RC005");
    }
    for (const kg of ["-1", "NaN", "Infinity", "1000000", "1.0005"]) {
      await rechaza(corregir(p, original.id, carton, kg), "RC004");
    }
    assert.equal(await correccionesDe(p.db, original.id), 0);
    assert.equal(await fallosDe(p), 0);
  }));

// ── kilos que no valen ─────────────────────────────────────────────────────

test("lo contado y la merma con kilos que no valen salen como regla", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const visto = await previa(p, carton, "90");
    for (const kg of ["-1", "NaN", "Infinity", "1000000", "1.0005"]) {
      await rechaza(previa(p, carton, kg), "RC004");
      await rechaza(contarMaterial(p, carton, kg, { visto }), "RC004");
    }
    for (const kg of ["0", "-1", "NaN", "Infinity", "1000000", "1.0005"]) {
      await rechaza(merma(p, carton, kg), "RC004");
    }
    for (const motivo of [null, "", "   "]) {
      await rechaza(merma(p, carton, "1", motivo), "RC005");
    }
    await rechaza(merma(p, 999999, "1"), "RC005");
    await rechaza(previa(p, 999999, "1"), "RC005");
    assert.equal(await existencia(p.db, carton), 100);
    // (El conteo del cajón al abrir el día es el único envío que hay: lo hace el escenario.)
    assert.equal(await cuantos(p.db, "envio", "clase NOT IN ('cuenta', 'caja_apertura')"), 0);
  }));

// De esto depende la pantalla: cuando reintenta un envío del que no supo y recibe una regla, da
// por hecho que el primero no había entrado. Vale porque un envío ya asentado, repetido igual,
// devuelve lo que hizo antes de mirar nada que haya podido cambiar.
test("un envío ya asentado, repetido igual con la jornada ya cerrada, devuelve lo que hizo: en las cuatro acciones", () =>
  conPatio(async (p) => {
    const [carton, pet] = [p.e.mat["Cartón"], p.e.mat["PET"]];
    await apertura(p, carton, 500);
    const original = await compra(p, carton, 100);
    const envio = { correccion: randomUUID(), merma: randomUUID(), separacion: randomUUID(), conteo: randomUUID() };
    const productos = [{ material: pet, kg: "60" }];

    const k = await corregir(p, original.id, carton, "90", { envio: envio.correccion, vistas: 0 });
    const m = await merma(p, carton, "10", "Mojado", envio.merma);
    const s = await separar(p, carton, "100", productos, envio.separacion);
    const visto = await previa(p, carton, "400");
    const c = await contarMaterial(p, carton, "400", { envio: envio.conteo, visto });
    await p.app.query(CERRAR_CON_CORTE, [p.e.mostrador, p.e.responsable, p.huella, CLAVE]);

    assert.deepEqual(await corregir(p, original.id, carton, "90", { envio: envio.correccion, vistas: 0 }), k);
    assert.equal((await merma(p, carton, "10", "Mojado", envio.merma)).id, m.id);
    assert.equal((await separar(p, carton, "100", productos, envio.separacion)).id, s.id);
    assert.equal((await contarMaterial(p, carton, "400", { envio: envio.conteo, visto })).id, c.id);
    assert.deepEqual([await existencia(p.db, carton), await existencia(p.db, pet)], [400, 60]);
    // Uno nuevo, en cambio, recibe la regla y no deja reservado su envío.
    const nuevo = randomUUID();
    await rechaza(separar(p, carton, "100", productos, nuevo), "RC006");
    assert.equal(await cuantos(p.db, "envio", "id = $1", [nuevo]), 0);
  }));

// Y las dos respuestas que, en un reintento, NO dicen que el primero no entró. Por ellas la
// pantalla no suelta un envío del que no supo cuando al reintentarlo recibe RC008 o que la clave
// no pasó. (Las encontró Codex al verificar las correcciones del bloque.)
test("un envío ya asentado, repetido por alguien a quien ya no le toca, recibe RC008 aunque sí había entrado", () =>
  conPatio(async (p) => {
    const [carton, pet] = [p.e.mat["Cartón"], p.e.mat["PET"]];
    await apertura(p, carton, 500);
    const original = await una(p.db, "SELECT id FROM movimiento_inventario WHERE tipo = 'apertura'");
    const envio = { correccion: randomUUID(), merma: randomUUID(), separacion: randomUUID(), conteo: randomUUID() };
    const acciones = [
      () => corregir(p, original.id, carton, "490", { envio: envio.correccion, vistas: 0 }),
      () => merma(p, carton, "10", "Mojado", envio.merma),
      () => separar(p, carton, "100", [{ material: pet, kg: "60" }], envio.separacion),
    ];
    for (const accion of acciones) await accion();
    // Una sola vista previa para los dos intentos: el reintento lleva exactamente lo mismo.
    const visto = await previa(p, carton, "380");
    const contar = () => contarMaterial(p, carton, "380", { envio: envio.conteo, visto });
    await contar();
    assert.equal(await cuantos(p.db, "envio_resultado"), 4);
    await p.db.query("UPDATE usuario SET rol = 'patio' WHERE id = $1", [p.e.mostrador]);
    for (const accion of [...acciones, contar]) await rechaza(accion(), "RC008");
  }));

for (const accion of ["conteo", "corrección"] as const) {
  test(`${accion}: un reintento con la clave mal, mientras el primer intento sigue en camino, contesta que no; y el primero queda asentado`, () =>
    conPatio(async (p) => {
      const otra = await comoApp(p.base);
      try {
        const carton = p.e.mat["Cartón"];
        await apertura(p, carton, 100);
        const original = await una(p.db, "SELECT id FROM movimiento_inventario WHERE tipo = 'apertura'");
        const envio = randomUUID();
        const visto = await previa(p, carton, "90");
        const mandar = (clave: string, con: pg.Client) =>
          accion === "conteo"
            ? contarMaterial(p, carton, "90", { envio, visto, clave, con })
            : corregir(p, original.id, carton, "90", { envio, vistas: 0, clave, con });
        const pid = await pidDe(otra);
        await p.app.query("BEGIN");
        await mandar(CLAVE, p.app);
        const reintento = mandar("000000", otra);
        await esperarQueEspere(p.db, pid);
        await p.app.query("COMMIT");
        const r = await reintento;
        assert.equal(accion === "conteo" ? r.id : r.original, null);
        assert.equal(await cuantos(p.db, "envio_resultado", "envio_id = $1", [envio]), 1);
        assert.equal(await existencia(p.db, carton), 90);
      } finally {
        await otra.end();
      }
    }));
}

// ── cancelar un envío del que no se supo ───────────────────────────────────
//
// Cuando un reintento recibe una regla, eso no dice nada del primer intento, que puede seguir en
// camino. La pantalla lo resuelve de una vez: pide cancelar el envío. Si ya había entrado, se le
// dice; si no, queda cancelado y ya no se asienta aunque llegue después.

const cancelar = async (p: Patio, envio: string, quien = p.e.mostrador, con: pg.Client = p.app): Promise<boolean> =>
  (await una(con, "SELECT cancelar_envio($1, $2) AS cancelado", [envio, quien])).cancelado;

test("un envío cancelado ya no se asienta aunque llegue después: las cuatro acciones y el material de una cuenta", () =>
  conPatio(async (p) => {
    const [carton, pet] = [p.e.mat["Cartón"], p.e.mat["PET"]];
    await apertura(p, carton, 500);
    const original = await compra(p, carton, 100);
    const visto = await previa(p, carton, "590");
    const abierta = (await abrirCuenta(p.app, "compra", p.e.mostrador)).id;
    const tardios: Array<[string, (envio: ReturnType<typeof randomUUID>) => Promise<unknown>]> = [
      ["merma", (envio) => merma(p, carton, "10", "Mojado", envio)],
      ["separación", (envio) => separar(p, carton, "100", [{ material: pet, kg: "60" }], envio)],
      ["conteo", (envio) => contarMaterial(p, carton, "590", { envio, visto })],
      ["corrección", (envio) => corregir(p, original.id, carton, "90", { envio, vistas: 0 })],
      ["material", (envio) => agregarMaterial(p.app, abierta, carton, "30", p.e.mostrador, { linea: envio })],
    ];
    for (const [nombre, llegar] of tardios) {
      const envio = randomUUID();
      assert.equal(await cancelar(p, envio), true, nombre);
      assert.equal(await cancelar(p, envio), true, `${nombre}, cancelado dos veces`);
      await assert.rejects(llegar(envio), (e: any) => e.code === "RC012" && /se canceló/.test(e.message), nombre);
    }
    assert.equal(await existencia(p.db, carton), 600);
    assert.equal(await cuantos(p.db, "envio_resultado"), 0);
    assert.equal(await cuantos(p.db, "operacion_linea", "operacion_id = $1", [abierta]), 0);
    assert.equal(await cuantos(p.db, "envio", "clase = 'cancelado'"), 5);
    assert.equal(await cuantos(p.db, "bitacora", "accion = 'cancelar_envio'"), 5);
    assert.equal(await fallosDe(p), 0);
  }));

test("cancelar un envío que ya había entrado dice que entró, y no cambia nada", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 500);
    const envio = randomUUID();
    const m = await merma(p, carton, "10", "Mojado", envio);
    assert.equal(await cancelar(p, envio), false);
    assert.equal((await merma(p, carton, "10", "Mojado", envio)).id, m.id);     // se sigue pudiendo repetir
    assert.equal(await existencia(p.db, carton), 490);
    assert.equal(await cuantos(p.db, "envio", "clase = 'cancelado'"), 0);
  }));

test("cancelar mientras el envío sigue en camino espera a saber si entró", () =>
  conPatio(async (p) => {
    const otra = await comoApp(p.base);
    try {
      const carton = p.e.mat["Cartón"];
      await apertura(p, carton, 500);
      const pid = await pidDe(otra);

      // El que iba en camino termina asentado: la cancelación contesta que entró.
      const entra = randomUUID();
      await p.app.query("BEGIN");
      await merma(p, carton, "10", "Mojado", entra);
      const primera = cancelar(p, entra, p.e.mostrador, otra);
      await esperarQueEspere(p.db, pid);
      await p.app.query("COMMIT");
      assert.equal(await primera, false);
      assert.equal(await existencia(p.db, carton), 490);

      // El que iba en camino se deshace: la cancelación queda, y ese envío ya no entra.
      const noEntra = randomUUID();
      await p.app.query("BEGIN");
      await merma(p, carton, "10", "Mojado", noEntra);
      const segunda = cancelar(p, noEntra, p.e.mostrador, otra);
      await esperarQueEspere(p.db, pid);
      await p.app.query("ROLLBACK");
      assert.equal(await segunda, true);
      await rechaza(merma(p, carton, "10", "Mojado", noEntra), "RC012");
      assert.equal(await existencia(p.db, carton), 490);
    } finally {
      await otra.end();
    }
  }));

test("un envío que llega mientras se está cancelando espera, y ya no se asienta", () =>
  conPatio(async (p) => {
    const otra = await comoApp(p.base);
    try {
      const carton = p.e.mat["Cartón"];
      await apertura(p, carton, 500);
      const envio = randomUUID();
      const pid = await pidDe(otra);
      await p.app.query("BEGIN");
      assert.equal(await cancelar(p, envio), true);
      const tardio = una(otra, "SELECT * FROM dar_merma($1, $2, $3, $4, $5)", [envio, carton, "10", "Mojado", p.e.mostrador]);
      await esperarQueEspere(p.db, pid);
      await p.app.query("COMMIT");
      await rechaza(tardio, "RC012");
      assert.equal(await existencia(p.db, carton), 500);
    } finally {
      await otra.end();
    }
  }));

test("cancelar un envío es de quien arma cuentas o lleva el inventario; quien solo consulta, no", () =>
  conPatio(async (p) => {
    await rechaza(cancelar(p, randomUUID(), p.e.consulta), "RC008");
    await rechaza(p.app.query("SELECT cancelar_envio(NULL, $1)", [p.e.mostrador]), "RC005");
    for (const quien of [p.e.patio, p.e.mostrador, p.e.responsable]) assert.equal(await cancelar(p, randomUUID(), quien), true);
    assert.equal(await cuantos(p.db, "envio", "clase = 'cancelado'"), 3);
  }));

// ── quién puede ────────────────────────────────────────────────────────────

test("patio y quien solo consulta no cuentan, no dan merma, no separan ni corrigen", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const original = await compra(p, carton, 10);
    for (const quien of [p.e.patio, p.e.consulta]) {
      await rechaza(contarMaterial(p, carton, "90", { quien }), "RC008");
      await rechaza(merma(p, carton, "1", "Mojado", randomUUID(), quien), "RC008");
      await rechaza(separar(p, carton, "10", [{ material: p.e.mat["PET"], kg: "9" }], randomUUID(), quien), "RC008");
      await rechaza(corregir(p, original.id, carton, "9", { quien }), "RC008");
    }
    assert.equal(await existencia(p.db, carton), 110);
  }));

test("la aplicación ya no alcanza las funciones viejas de inventario, ni lee qué produjo cada envío", () =>
  conPatio(async (p) => {
    const carton = p.e.mat["Cartón"];
    await apertura(p, carton, 100);
    const viejas: Array<[string, unknown[]]> = [
      ["SELECT registrar_conteo($1, 90, $2, $3)", [carton, p.e.responsable, p.e.mostrador]],
      ["SELECT registrar_merma($1, 1, 'Mojado', $2)", [carton, p.e.mostrador]],
      ["SELECT registrar_transformacion($1, 10, '[]'::jsonb, NULL, $2)", [carton, p.e.mostrador]],
      ["SELECT asentar_conteo($1, 90, $2, $3, NULL, clock_timestamp())", [carton, p.e.responsable, p.e.mostrador]],
      ["SELECT * FROM envio_resultado", []],
    ];
    for (const [sql, valores] of viejas) {
      await rechaza(p.app.query(sql, valores), SIN_PERMISO);
    }
    // Las dos que no se componían con una corrección previa ya no existen.
    await rechaza(p.db.query("SELECT registrar_ajuste($1, 1, 'x', $2, $3)", [carton, p.e.responsable, p.e.mostrador]), "42883");
    await rechaza(p.db.query("SELECT corregir_material(1, $1, 'x', $2, $3)", [carton, p.e.responsable, p.e.mostrador]), "42883");
    assert.equal(await existencia(p.db, carton), 100);
  }));
