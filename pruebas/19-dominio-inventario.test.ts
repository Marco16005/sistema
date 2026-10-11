// El inventario por las rutas: lo que hay, los movimientos de un material, contar, dar merma,
// separar y corregir, con la autorización de una persona facultada en el momento.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { existencia, material, una } from "./apoyo.ts";
import { CLAVES, conMundo, ruta } from "./mundo.ts";
import type { Mundo } from "./mundo.ts";
import type { Navegador } from "./navegador.ts";

const codigoDe = async (r: Response): Promise<string> => (await r.json()).error?.codigo;

interface Patio {
  m: Mundo;
  jefe: Navegador;
  caja: Navegador;
  carton: number;
  pet: number;
  cobre: number;
}

/** Un día listo, con 500 kg de Cartón de saldo inicial y precios de Cartón, PET y Cobre de primera. */
const conPatio = (prueba: (p: Patio) => Promise<void>) =>
  conMundo(async (m) => {
    const [carton, pet, cobre] = [await material(m.db, "Cartón"), await material(m.db, "PET"), await material(m.db, "Cobre de primera")];
    const jefe = await m.adentro("responsable");
    await jefe.bien(await ruta("arranque/terminar", "POST"), "POST", "/api/x", { saldos: [{ material: carton, kg: "500", origen: "estimado" }] });
    await jefe.bien(await ruta("jornada/abrir", "POST"), "POST", "/api/x");
    await jefe.bien(await ruta("precios", "POST"), "POST", "/api/x", { cambios: [
      { material: carton, compra: "2.1", venta: "2.5" }, { material: pet, compra: "7.5", venta: "8.9" }, { material: cobre, compra: "150", venta: "177" },
    ] });
    await jefe.bien(await ruta("precios/publicar", "POST"), "POST", "/api/x");
    // La jornada lleva un rato abierta: así se puede decir que algo se contó hace unos minutos.
    await m.db.query("UPDATE jornada SET abierta_en = abierta_en - interval '3 hours'");
    await prueba({ m, jefe, caja: await m.adentro("mostrador"), carton, pet, cobre });
  });

/** Una cuenta de un material, confirmada por las rutas. Devuelve el identificador de la cuenta. */
async function cuentaHecha(p: Patio, tipo: "compra" | "venta", mat: number, kg: string): Promise<string> {
  const cuenta = randomUUID();
  const par = { parametros: { cuenta } };
  await p.caja.bien(await ruta("cuentas", "POST"), "POST", "/api/x", { id: cuenta, tipo, etiqueta: null });
  const c = await p.caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", "/api/x",
    { linea: randomUUID(), captura: randomUUID(), material: mat, bascula: 2, kg }, par);
  await p.caja.bien(await ruta("cuentas/[cuenta]/confirmar", "POST"), "POST", "/api/x", { revision: c.cuenta.revision }, par);
  return cuenta;
}

const existencias = async (n: Navegador) => (await n.bien(await ruta("inventario", "GET"), "GET", "/api/inventario")).familias as Array<{ nombre: string; materiales: any[] }>;
const deMaterial = async (n: Navegador, mat: number) =>
  n.bien(await ruta("inventario/materiales/[material]", "GET"), "GET", "/api/x", undefined, { parametros: { material: String(mat) } });
const enExistencias = (familias: Array<{ materiales: any[] }>, nombre: string) => familias.flatMap((f) => f.materiales).find((x) => x.nombre === nombre);

const autoriza = (p: Patio, clave = CLAVES.responsable) => ({ autoriza: p.m.personas.responsable, clave });

// ── lo que hay ─────────────────────────────────────────────────────────────

test("las existencias vienen por familia: lo que hay, lo apartado en ventas abiertas y lo disponible", () =>
  conPatio(async (p) => {
    await cuentaHecha(p, "compra", p.carton, "30.2");
    // Una venta abierta, sin terminar, aparta sin sacar.
    const abierta = randomUUID();
    await p.caja.bien(await ruta("cuentas", "POST"), "POST", "/api/x", { id: abierta, tipo: "venta", etiqueta: null });
    await p.caja.bien(await ruta("cuentas/[cuenta]/materiales", "POST"), "POST", "/api/x",
      { linea: randomUUID(), captura: randomUUID(), material: p.carton, bascula: 2, kg: "100" }, { parametros: { cuenta: abierta } });

    const f = await existencias(p.caja);
    assert.deepEqual(f.map((x) => x.nombre), ["Aluminio", "Cobre y bronce", "Fierro", "Otros metales", "Papel", "Plástico"]);
    assert.equal(f.flatMap((x) => x.materiales).length, 27);
    assert.deepEqual(enExistencias(f, "Cartón"), {
      id: p.carton, nombre: "Cartón", nombreCorto: "Cartón", kg: "530.200", apartado: "100.000", disponible: "430.200", ultimoConteo: null,
    });
    assert.deepEqual(
      { kg: enExistencias(f, "PET").kg, apartado: enExistencias(f, "PET").apartado, disponible: enExistencias(f, "PET").disponible },
      { kg: "0.000", apartado: "0.000", disponible: "0.000" },
    );
    assert.equal(await existencia(p.m.db, p.carton), 530.2);
  }));

test("los movimientos de un material vienen del más reciente al más viejo, con su folio y quién los hizo", () =>
  conPatio(async (p) => {
    const cuenta = await cuentaHecha(p, "compra", p.carton, "30.2");
    await cuentaHecha(p, "venta", p.carton, "10");
    const folio = (await una(p.m.db, "SELECT folio FROM operacion WHERE id = $1", [cuenta])).folio;
    const d = await deMaterial(p.caja, p.carton);
    assert.deepEqual({ material: d.material, kg: d.kg }, { material: { id: p.carton, nombre: "Cartón" }, kg: "520.200" });
    assert.deepEqual(d.movimientos.map((x: any) => [x.tipo, x.kg, x.folio, x.quien, x.corregible, x.correcciones]), [
      ["venta", "-10.000", String(Number(folio) + 1), "De mostrador", true, 0],
      ["compra", "30.200", folio, "De mostrador", true, 0],
      ["apertura", "500.000", null, "De responsable", true, 0],
    ]);
    assert.match(d.movimientos[0].fecha, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(d.movimientos[0].hora, /^\d{2}:\d{2}$/);
    assert.equal(d.movimientos[0].original, null);
    assert.equal(d.movimientos[0].quedo, null);
  }));

// ── contar ─────────────────────────────────────────────────────────────────

test("contar: se ve lo que dice el libro, se autoriza con clave y la existencia queda en lo contado", () =>
  conPatio(async (p) => {
    const visto = (await p.caja.bien(await ruta("inventario/conteo/previa", "POST"), "POST", "/api/x", { material: p.carton, contado: "480.5" })).previa;
    assert.deepEqual({ registrado: visto.registrado, diferencia: visto.diferencia, contado: visto.contado }, { registrado: "500.000", diferencia: "-19.500", contado: "480.5" });
    assert.match(visto.hora, /^\d{2}:\d{2}$/);

    const conteo = await ruta("inventario/conteo", "POST");
    const envio = { id: randomUUID(), material: p.carton, contado: "480.5", contadoEn: visto.contadoEn, registrado: visto.registrado, nota: "Se pesó todo" };
    // Con la clave equivocada no se cuenta, y el intento queda contado.
    const mala = await p.caja.pedir(conteo, "POST", "/api/x", { ...envio, ...autoriza(p, "000000") });
    assert.equal(mala.status, 401);
    assert.equal(await codigoDe(mala), "CLAVE");
    assert.equal((await una(p.m.db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [p.m.personas.responsable])).fallos, 1);
    assert.equal(await existencia(p.m.db, p.carton), 500);

    const r = await p.caja.bien(conteo, "POST", "/api/x", { ...envio, ...autoriza(p) });
    assert.deepEqual(r.conteo, { contado: "480.500", registrado: "500.000", diferencia: "-19.500" });
    assert.equal(await existencia(p.m.db, p.carton), 480.5);
    // Repetir el envío no cuenta dos veces.
    assert.deepEqual((await p.caja.bien(conteo, "POST", "/api/x", { ...envio, ...autoriza(p) })).conteo, r.conteo);
    assert.equal((await una(p.m.db, "SELECT count(*)::int AS n FROM conteo")).n, 1);

    const c = enExistencias(await existencias(p.caja), "Cartón");
    assert.deepEqual({ kg: c.kg, diferencia: c.ultimoConteo.diferencia }, { kg: "480.500", diferencia: "-19.500" });
    assert.match(c.ultimoConteo.fecha, /^\d{4}-\d{2}-\d{2}$/);
    // Queda a nombre de quien atendía, autorizado por la responsable.
    assert.deepEqual(await una(p.m.db, "SELECT creado_por, autorizado_por FROM conteo"), { creado_por: p.m.personas.mostrador, autorizado_por: p.m.personas.responsable });
  }));

test("si lo que se vio ya no es lo que dice el libro, el conteo se rechaza y hay que verlo de nuevo", () =>
  conPatio(async (p) => {
    const visto = (await p.caja.bien(await ruta("inventario/conteo/previa", "POST"), "POST", "/api/x", { material: p.carton, contado: "480" })).previa;
    const r = await p.caja.pedir(await ruta("inventario/conteo", "POST"), "POST", "/api/x", {
      id: randomUUID(), material: p.carton, contado: "480", contadoEn: visto.contadoEn, registrado: "499.000", ...autoriza(p),
    });
    assert.equal(r.status, 409);
    assert.equal(await codigoDe(r), "RC011");
    assert.equal(await existencia(p.m.db, p.carton), 500);
  }));

test("se puede decir a qué hora se contó, si fue hoy y ya pasó", () =>
  conPatio(async (p) => {
    const hace = (await una(p.m.db, "SELECT to_char((clock_timestamp() - interval '10 minutes') AT TIME ZONE 'America/Mexico_City', 'HH24:MI') AS h, extract(hour FROM clock_timestamp() AT TIME ZONE 'America/Mexico_City')::int AS hora"));
    const previa = await ruta("inventario/conteo/previa", "POST");
    if (hace.hora >= 1) {       // de madrugada, «hace diez minutos» puede ser ayer
      const visto = (await p.caja.bien(previa, "POST", "/api/x", { material: p.carton, contado: "480", hora: hace.h })).previa;
      assert.equal(visto.hora, hace.h);
    }
    if (hace.hora < 23) {
      const futura = await p.caja.pedir(previa, "POST", "/api/x", { material: p.carton, contado: "480", hora: "23:59" });
      assert.equal(futura.status, 409);
      assert.equal(await codigoDe(futura), "RC005");
    }
    for (const hora of ["24:00", "9:5", "ahorita", 930]) {
      assert.equal((await p.caja.pedir(previa, "POST", "/api/x", { material: p.carton, contado: "480", hora })).status, 400);
    }
  }));

// ── merma y separación ─────────────────────────────────────────────────────

test("dar merma y separar material, por las rutas", () =>
  conPatio(async (p) => {
    const envio = { id: randomUUID(), material: p.carton, kg: "12.5", motivo: "Mojado" };
    const m1 = await p.caja.bien(await ruta("inventario/merma", "POST"), "POST", "/api/x", envio);
    assert.deepEqual(m1.merma, { kg: "12.500", motivo: "Mojado" });
    await p.caja.bien(await ruta("inventario/merma", "POST"), "POST", "/api/x", envio);       // repetida: no asienta otra
    assert.equal(await existencia(p.m.db, p.carton), 487.5);

    const productos = [{ material: p.pet, kg: "60" }, { material: p.cobre, kg: "25.5" }];
    const previa = await p.caja.bien(await ruta("inventario/separacion/previa", "POST"), "POST", "/api/x", { origen: p.carton, kg: "100", productos });
    assert.equal(previa.merma, "14.500");
    const s = await p.caja.bien(await ruta("inventario/separacion", "POST"), "POST", "/api/x", { id: randomUUID(), origen: p.carton, kg: "100", productos, nota: "Venía revuelto" });
    assert.equal(s.separacion.merma, "14.500");
    assert.deepEqual([await existencia(p.m.db, p.carton), await existencia(p.m.db, p.pet), await existencia(p.m.db, p.cobre)], [387.5, 60, 25.5]);

    const sinExistencia = await p.caja.pedir(await ruta("inventario/merma", "POST"), "POST", "/api/x", { id: randomUUID(), material: p.pet, kg: "61", motivo: "Mojado" });
    assert.equal(sinExistencia.status, 409);
    assert.equal(await codigoDe(sinExistencia), "RC002");
  }));

// ── corregir ───────────────────────────────────────────────────────────────

test("corregir desde los movimientos: era otro material, con la clave de quien autoriza", () =>
  conPatio(async (p) => {
    await cuentaHecha(p, "compra", p.cobre, "18");                     // era PET
    const antes = await deMaterial(p.caja, p.cobre);
    const original = antes.movimientos[0];
    assert.deepEqual({ tipo: original.tipo, corregible: original.corregible, correcciones: original.correcciones }, { tipo: "compra", corregible: true, correcciones: 0 });

    const correccion = await ruta("inventario/correccion", "POST");
    const envio = { id: randomUUID(), movimiento: original.id, material: p.pet, kg: "18", vistas: original.correcciones, motivo: "Era PET" };
    const mala = await p.caja.pedir(correccion, "POST", "/api/x", { ...envio, ...autoriza(p, "000000") });
    assert.equal(mala.status, 401);
    assert.equal(await existencia(p.m.db, p.cobre), 18);
    // Con la clave buena de quien no está facultado, tampoco.
    const sinFacultad = await p.caja.pedir(correccion, "POST", "/api/x", { ...envio, autoriza: p.m.personas.mostrador, clave: CLAVES.mostrador });
    assert.equal(sinFacultad.status, 403);
    assert.equal(await codigoDe(sinFacultad), "RC008");

    const r = await p.caja.bien(correccion, "POST", "/api/x", { ...envio, ...autoriza(p) });
    assert.deepEqual(r.correccion, { original: original.id, ajustes: 2 });
    assert.deepEqual([await existencia(p.m.db, p.cobre), await existencia(p.m.db, p.pet)], [0, 18]);

    // En el cobre, el original dice cómo quedó; en el PET aparece el ajuste, con el camino a su original.
    const cobre = await deMaterial(p.caja, p.cobre);
    const corregido = cobre.movimientos.find((x: any) => x.id === original.id);
    assert.deepEqual({ correcciones: corregido.correcciones, quedo: corregido.quedo }, { correcciones: 2, quedo: [{ material: "PET", kg: "18.000" }] });
    const pet = await deMaterial(p.caja, p.pet);
    assert.deepEqual(
      { tipo: pet.movimientos[0].tipo, kg: pet.movimientos[0].kg, motivo: pet.movimientos[0].motivo, autorizo: pet.movimientos[0].autorizo,
        corregible: pet.movimientos[0].corregible, original: pet.movimientos[0].original },
      { tipo: "ajuste", kg: "18.000", motivo: "Era PET", autorizo: "De responsable", corregible: false,
        original: { id: original.id, tipo: "compra", material: { id: p.cobre, nombre: "Cobre de primera" }, folio: original.folio } },
    );

    // Con lo que se vio antes de esa corrección ya no se corrige otra vez.
    const vieja = await p.caja.pedir(correccion, "POST", "/api/x", { ...envio, id: randomUUID(), kg: "20", ...autoriza(p) });
    assert.equal(vieja.status, 409);
    assert.equal(await codigoDe(vieja), "RC011");
  }));

test("un movimiento que ya cubrió un conteo se marca, y no se corrige", () =>
  conPatio(async (p) => {
    await cuentaHecha(p, "compra", p.carton, "100");
    const visto = (await p.caja.bien(await ruta("inventario/conteo/previa", "POST"), "POST", "/api/x", { material: p.carton, contado: "590" })).previa;
    await p.caja.bien(await ruta("inventario/conteo", "POST"), "POST", "/api/x",
      { id: randomUUID(), material: p.carton, contado: "590", contadoEn: visto.contadoEn, registrado: visto.registrado, ...autoriza(p) });
    const d = await deMaterial(p.caja, p.carton);
    const compra = d.movimientos.find((x: any) => x.tipo === "compra");
    assert.deepEqual({ corregible: compra.corregible, yaContado: compra.yaContado }, { corregible: false, yaContado: true });
    const r = await p.caja.pedir(await ruta("inventario/correccion", "POST"), "POST", "/api/x",
      { id: randomUUID(), movimiento: compra.id, material: p.carton, kg: "90", vistas: 0, motivo: "Eran 90", ...autoriza(p) });
    assert.equal(r.status, 409);
    assert.equal(await codigoDe(r), "RC005");
  }));

test("un conteo fechado en el mismo instante que el movimiento también lo marca como ya contado", () =>
  conPatio(async (p) => {
    await cuentaHecha(p, "compra", p.pet, "100");
    await p.m.db.query(
      "SELECT asentar_conteo($1, 90, $2, $3, NULL, (SELECT efectivo_en FROM movimiento_inventario WHERE material_id = $1 AND tipo = 'compra'))",
      [p.pet, p.m.personas.responsable, p.m.personas.mostrador],
    );
    const compra = (await deMaterial(p.caja, p.pet)).movimientos.find((x: any) => x.tipo === "compra");
    assert.deepEqual({ corregible: compra.corregible, yaContado: compra.yaContado }, { corregible: false, yaContado: true });
  }));

test("lo que se puede corregir se decide por el material donde el movimiento cuenta hoy, no por el que tenía al registrarse", () =>
  conPatio(async (p) => {
    await cuentaHecha(p, "compra", p.cobre, "18");                     // era PET
    const original = (await deMaterial(p.caja, p.cobre)).movimientos[0];
    const correccion = await ruta("inventario/correccion", "POST");
    const contar = async (mat: number, contado: string) => {
      const visto = (await p.caja.bien(await ruta("inventario/conteo/previa", "POST"), "POST", "/api/x", { material: mat, contado })).previa;
      await p.caja.bien(await ruta("inventario/conteo", "POST"), "POST", "/api/x",
        { id: randomUUID(), material: mat, contado, contadoEn: visto.contadoEn, registrado: visto.registrado, ...autoriza(p) });
    };
    const delOriginal = async () => {
      const m = (await deMaterial(p.caja, p.cobre)).movimientos.find((x: any) => x.id === original.id);
      return { corregible: m.corregible, yaContado: m.yaContado, correcciones: m.correcciones };
    };
    await p.caja.bien(correccion, "POST", "/api/x", { id: randomUUID(), movimiento: original.id, material: p.pet, kg: "18", vistas: 0, motivo: "Era PET", ...autoriza(p) });

    // Se cuenta el cobre, donde el movimiento ya no cuenta: todavía se puede corregir, y la base lo acepta.
    await contar(p.cobre, "0");
    assert.deepEqual(await delOriginal(), { corregible: true, yaContado: false, correcciones: 2 });
    await p.caja.bien(correccion, "POST", "/api/x", { id: randomUUID(), movimiento: original.id, material: p.pet, kg: "20", vistas: 2, motivo: "Eran 20", ...autoriza(p) });
    assert.equal(await existencia(p.m.db, p.pet), 20);

    // Se cuenta el PET, donde cuenta hoy: ya no se ofrece corregirlo, y la base tampoco lo acepta.
    await contar(p.pet, "20");
    assert.deepEqual(await delOriginal(), { corregible: false, yaContado: true, correcciones: 3 });
    const r = await p.caja.pedir(correccion, "POST", "/api/x", { id: randomUUID(), movimiento: original.id, material: p.pet, kg: "19", vistas: 3, motivo: "Eran 19", ...autoriza(p) });
    assert.equal(r.status, 409);
    assert.equal(await codigoDe(r), "RC005");
  }));

test("quienes pueden autorizar son las personas facultadas y activas", () =>
  conPatio(async (p) => {
    const otra = (await una(p.m.db, "SELECT * FROM alta_persona('Marco', 'responsable', true, '271828')")).id;
    await p.m.db.query("SELECT alta_persona('Sin facultad', 'responsable', false, '314159')");
    const lista = async () => (await p.caja.bien(await ruta("inventario/autorizan", "GET"), "GET", "/api/x")).personas;
    assert.deepEqual(await lista(), [{ id: p.m.personas.responsable, nombre: "De responsable" }, { id: otra, nombre: "Marco" }]);
    await p.m.db.query("SELECT baja_persona($1)", [otra]);
    assert.deepEqual(await lista(), [{ id: p.m.personas.responsable, nombre: "De responsable" }]);
  }));

test("que un movimiento se ofrezca para corregir no garantiza cualquier destino: si el destino ya se contó, la base lo rechaza", () =>
  conPatio(async (p) => {
    await cuentaHecha(p, "compra", p.cobre, "18");
    const original = (await deMaterial(p.caja, p.cobre)).movimientos[0];
    const correccion = await ruta("inventario/correccion", "POST");
    const corregir = async (mat: number, kg: string, vistas: number) =>
      p.caja.pedir(correccion, "POST", "/api/x", { id: randomUUID(), movimiento: original.id, material: mat, kg, vistas, motivo: "Se capturó mal", ...autoriza(p) });
    const delOriginal = async () => {
      const m = (await deMaterial(p.caja, p.cobre)).movimientos.find((x: any) => x.id === original.id);
      return { corregible: m.corregible, yaContado: m.yaContado, quedo: m.quedo };
    };

    // Se deja sin efecto, y después se cuenta su material: hoy no cuenta en ninguno, así que se sigue ofreciendo corregir…
    assert.equal((await corregir(p.cobre, "0", 0)).status, 200);
    const visto = (await p.caja.bien(await ruta("inventario/conteo/previa", "POST"), "POST", "/api/x", { material: p.cobre, contado: "0" })).previa;
    await p.caja.bien(await ruta("inventario/conteo", "POST"), "POST", "/api/x",
      { id: randomUUID(), material: p.cobre, contado: "0", contadoEn: visto.contadoEn, registrado: visto.registrado, ...autoriza(p) });
    assert.deepEqual(await delOriginal(), { corregible: true, yaContado: false, quedo: [] });

    // …pero devolverlo al material que ya se contó se rechaza, y a uno que no se ha contado, pasa.
    const alContado = await corregir(p.cobre, "18", 1);
    assert.equal(alContado.status, 409);
    const rechazo = (await alContado.json()).error;
    assert.equal(rechazo.codigo, "RC005");
    assert.match(rechazo.mensaje, /ya se contó Cobre de primera/);
    assert.equal((await corregir(p.pet, "18", 1)).status, 200);
    assert.deepEqual([await existencia(p.m.db, p.cobre), await existencia(p.m.db, p.pet)], [0, 18]);
  }));

// ── cancelar un envío del que no se supo ───────────────────────────────────

test("cancelar un envío por la ruta: dice si ya había entrado; y si no, ya no entra", () =>
  conPatio(async (p) => {
    const cancelar = async (envio: string) =>
      p.caja.pedir(await ruta("envios/[envio]/cancelar", "POST"), "POST", "/api/x", {}, { parametros: { envio } });
    const merma = await ruta("inventario/merma", "POST");

    const entro = { id: randomUUID(), material: p.carton, kg: "12.5", motivo: "Mojado" };
    await p.caja.bien(merma, "POST", "/api/x", entro);
    const yaEstaba = await cancelar(entro.id);
    assert.equal(yaEstaba.status, 200);
    assert.deepEqual(await yaEstaba.json(), { entro: true });
    // Ese identificador, con otros datos, ya no sirve: lo ocupa la merma que sí entró.
    const otra = await p.caja.pedir(merma, "POST", "/api/x", { ...entro, kg: "20" });
    assert.equal(otra.status, 409);
    assert.equal(await codigoDe(otra), "RC012");
    await p.caja.bien(merma, "POST", "/api/x", entro);                    // sigue siendo el mismo, y no asienta otra
    assert.equal(await existencia(p.m.db, p.carton), 487.5);

    const noEntro = { id: randomUUID(), material: p.carton, kg: "10", motivo: "Mojado" };
    const cancelado = await cancelar(noEntro.id);
    assert.equal(cancelado.status, 200);
    assert.deepEqual(await cancelado.json(), { entro: false });
    assert.deepEqual(
      await una(p.m.db, "SELECT clase, recibido_de FROM envio WHERE id = $1", [noEntro.id]),
      { clase: "cancelado", recibido_de: p.m.personas.mostrador },
    );
    const tardio = await p.caja.pedir(merma, "POST", "/api/x", noEntro);
    assert.equal(tardio.status, 409);
    assert.equal(await codigoDe(tardio), "RC012");
    assert.equal(await existencia(p.m.db, p.carton), 487.5);

    assert.equal((await cancelar("no-es-uuid")).status, 400);
  }));

// ── la forma ───────────────────────────────────────────────────────────────

test("lo que llega mal formado al inventario se rechaza antes de tocar la base", () =>
  conPatio(async (p) => {
    const id = randomUUID();
    const a = autoriza(p);
    const malas: Array<[string, unknown]> = [
      ["inventario/conteo/previa", { material: "cartón", contado: "10" }],
      ["inventario/conteo/previa", { material: p.carton, contado: "10,5" }],
      ["inventario/conteo/previa", { material: p.carton }],
      ["inventario/conteo", { id, material: p.carton, contado: "10", contadoEn: "ayer", registrado: "500.000", ...a }],
      ["inventario/conteo", { id, material: p.carton, contado: "10", contadoEn: "2026-10-02 10:00:00-06", registrado: "mucho", ...a }],
      ["inventario/conteo", { id, material: p.carton, contado: "10", contadoEn: "2026-10-02 10:00:00-06", registrado: "500.000", autoriza: a.autoriza }],
      ["inventario/conteo", { id, material: p.carton, contado: "10", contadoEn: "2026-10-02 10:00:00-06", registrado: "500.000", autoriza: "yo", clave: a.clave }],
      ["inventario/conteo", { id: "x", material: p.carton, contado: "10", contadoEn: "2026-10-02 10:00:00-06", registrado: "500.000", ...a }],
      ["inventario/merma", { id, material: p.carton, kg: 12.5, motivo: "Mojado" }],
      ["inventario/merma", { id, material: p.carton, kg: "12.5" }],
      ["inventario/merma", { id, material: p.carton, kg: "12.5", motivo: "con\u0000nulo" }],
      ["inventario/separacion", { id, origen: p.carton, kg: "100", productos: "todos" }],
      ["inventario/separacion", { id, origen: p.carton, kg: "100", productos: [{ material: p.pet }] }],
      ["inventario/separacion", { id, origen: p.carton, kg: "100", productos: [{ material: p.pet, kg: "1e2" }] }],
      ["inventario/separacion/previa", { origen: p.carton, kg: "100", productos: [p.pet] }],
      ["inventario/correccion", { id, movimiento: "el último", material: p.carton, kg: "10", vistas: 0, motivo: "x", ...a }],
      ["inventario/correccion", { id, movimiento: "1", material: p.carton, kg: "10", vistas: "0", motivo: "x", ...a }],
      ["inventario/correccion", { id, movimiento: "1", material: p.carton, kg: "10", vistas: 0, ...a }],
      ["inventario/correccion", { id, movimiento: "1", material: 2147483648, kg: "10", vistas: 0, motivo: "x", ...a }],
    ];
    for (const [camino, cuerpo] of malas) {
      const r = await p.caja.pedir(await ruta(camino, "POST"), "POST", "/api/x", cuerpo);
      assert.equal(r.status, 400, `${camino} con ${JSON.stringify(cuerpo)}`);
    }
    const noEs = await p.caja.pedir(await ruta("inventario/materiales/[material]", "GET"), "GET", "/api/x", undefined, { parametros: { material: "cartón" } });
    assert.equal(noEs.status, 400);
    const noEsta = await p.caja.pedir(await ruta("inventario/materiales/[material]", "GET"), "GET", "/api/x", undefined, { parametros: { material: "999999" } });
    assert.equal(noEsta.status, 404);
    assert.equal((await una(p.m.db, "SELECT count(*)::int AS n FROM envio WHERE clase <> 'cuenta'")).n, 0);
    assert.equal((await una(p.m.db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [p.m.personas.responsable])).fallos, 0);
  }));
