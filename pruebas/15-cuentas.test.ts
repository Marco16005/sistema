// Las cuentas del mostrador vistas desde el servidor: abrir, agregar materiales, pesar vehículos,
// confirmar con la revisión que se tenía a la vista, y el comprobante con sus impresiones.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import { GRANDE, abrirJornada, comoApp, conBase, contar, escenario, esperarQueEspere, existencia, pidDe, una, urlApp } from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import type { Bd } from "../src/servidor/bd.ts";
import { buscarPorFolio, comprobante, registrarImpresion } from "../src/servidor/dominio/comprobante.ts";
import {
  abrirCuenta, agregarMaterial, confirmar, cuentasAbiertas, descartar, etiquetar, ponerDescuento, quitarMaterial, segundaPesada,
  terminarVehiculo, verCuenta,
} from "../src/servidor/dominio/cuentas.ts";
import type { Cuenta } from "../src/servidor/dominio/cuentas.ts";
import { ErrorDeNegocio } from "../src/servidor/errores.ts";

const conCuentas = (prueba: (bd: Bd, db: pg.Client, e: Escenario, base: string) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 3 });
    try {
      await prueba(bd, db, await escenario(db), base);
    } finally {
      await bd.cerrar();
    }
  });

const rechazaCon = (promesa: Promise<unknown>, codigo: string) =>
  assert.rejects(promesa, (e: unknown) => {
    assert.ok(e instanceof ErrorDeNegocio, `se esperaba ${codigo} y llegó ${e}`);
    assert.equal(e.codigo, codigo, e.message);
    return true;
  });

/** Un envío con identificadores nuevos, como los genera la pantalla. */
const envio = (material: number, kg: string, bascula = 2) => ({ linea: randomUUID(), captura: randomUUID(), material, bascula, kg });

const nueva = (bd: Bd, e: Escenario, tipo: "compra" | "venta", etiqueta: string | null = null): Promise<Cuenta> =>
  abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo, etiqueta });

// ── una cuenta de principio a fin ──────────────────────────────────────────

test("una compra de tres materiales, de abrirla al comprobante", () =>
  conCuentas(async (bd, db, e) => {
    let c = await nueva(bd, e, "compra", "Camioneta roja");
    assert.deepEqual(
      { tipo: c.tipo, etiqueta: c.etiqueta, estado: c.estado, revision: c.revision, materiales: c.materiales, deOtraJornada: c.deOtraJornada },
      { tipo: "compra", etiqueta: "Camioneta roja", estado: "borrador", revision: 0, materiales: [], deOtraJornada: false },
    );
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"], "30.2"));
    c = await agregarMaterial(bd, e.patio, c.id, envio(e.mat["Aluminio bote"], "4.11"));
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cobre de primera"], "2.5", 3));
    assert.deepEqual(c.materiales.map((m) => [m.material.nombre, m.kg, m.precio, m.importe]), [
      ["Cartón", "30.200", "2.1000", "63.42"],
      ["Aluminio bote", "4.110", "28.0000", "115.08"],
      ["Cobre de primera", "2.500", "150.0000", "375.00"],
    ]);
    assert.deepEqual(c.resumen, { materiales: 3, porPesar: 0, suma: "553.50", ajuste: "0.50", total: "554" });

    const hecha = await confirmar(bd, e.mostrador, c.id, c.revision);
    assert.equal(hecha.estado, "confirmada");
    assert.ok(hecha.folio);
    assert.deepEqual(hecha.resumen, { materiales: 3, porPesar: 0, suma: "553.50", ajuste: "0.50", total: "554" });
    assert.equal(await existencia(db, e.mat["Cartón"]), 30.2);

    const t = await comprobante(bd, c.id);
    assert.ok(t);
    assert.deepEqual(
      { folio: t.folio, tipo: t.tipo, etiqueta: t.etiqueta, atendio: t.atendio, suma: t.suma, ajuste: t.ajuste, total: t.total, impresiones: t.impresiones },
      { folio: hecha.folio, tipo: "compra", etiqueta: "Camioneta roja", atendio: "Luis", suma: "553.50", ajuste: "0.50", total: "554", impresiones: 0 },
    );
    assert.deepEqual(t.materiales[2], {
      nombre: "Cobre de primera", bascula: "Báscula 3", bruto: "2.500", tara: "0.000", recipiente: "0.000", descuento: "0.000", kg: "2.500",
      precio: "150.0000", importe: "375.00",
    });
  }));

test("repetir cada paso no duplica nada", () =>
  conCuentas(async (bd, db, e) => {
    const id = randomUUID();
    await abrirCuenta(bd, e.mostrador, { id, tipo: "compra", etiqueta: null });
    await abrirCuenta(bd, e.mostrador, { id, tipo: "compra", etiqueta: null });
    const uno = envio(e.mat["Cartón"], "30.2");
    await agregarMaterial(bd, e.mostrador, id, uno);
    const c = await agregarMaterial(bd, e.mostrador, id, uno);
    assert.equal(c.materiales.length, 1);
    const primera = await confirmar(bd, e.mostrador, id, c.revision);
    const segunda = await confirmar(bd, e.mostrador, id, c.revision);
    assert.equal(segunda.folio, primera.folio);
    assert.equal(await contar(db, "operacion"), 1);
    assert.equal(await contar(db, "movimiento_inventario"), 1);
    assert.equal(await existencia(db, e.mat["Cartón"]), 30.2);
  }));

test("una cuenta que no existe no se ve, y no se le agrega nada", () =>
  conCuentas(async (bd, _db, e) => {
    assert.equal(await verCuenta(bd, randomUUID()), null);
    await rechazaCon(agregarMaterial(bd, e.mostrador, randomUUID(), envio(e.mat["Cartón"], "1")), "RC005");
    // Quitarle un material a una cuenta que ya no está es una regla, no una falla.
    await rechazaCon(quitarMaterial(bd, e.mostrador, randomUUID(), randomUUID()), "RC005");
    await rechazaCon(etiquetar(bd, e.mostrador, randomUUID(), "x"), "RC005");
  }));

// ── lo que se ve de una cuenta ─────────────────────────────────────────────

test("la cuenta muestra cada material con su báscula, sus pesadas y lo que falta", () =>
  conCuentas(async (bd, _db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"], "30.2"));
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Fierro pesado"], "5200", GRANDE));
    const [carton, fierro] = c.materiales;
    assert.deepEqual(
      { bascula: carton!.bascula, pesadas: carton!.pesadas, porPesar: carton!.porPesar, kg: carton!.kg },
      { bascula: { id: 2, nombre: "Báscula 2", doblePesaje: false }, pesadas: ["30.200"], porPesar: false, kg: "30.200" },
    );
    assert.deepEqual(
      { bascula: fierro!.bascula, pesadas: fierro!.pesadas, porPesar: fierro!.porPesar, kg: fierro!.kg, importe: fierro!.importe },
      { bascula: { id: 1, nombre: "Báscula 1", doblePesaje: true }, pesadas: ["5200.000"], porPesar: true, kg: null, importe: null },
    );
    assert.deepEqual(c.resumen, { materiales: 2, porPesar: 1, suma: "63.42", ajuste: "-0.42", total: "63" });

    c = await segundaPesada(bd, e.patio, c.id, fierro!.id, { captura: randomUUID(), kg: "3400" });
    const listo = c.materiales[1]!;
    assert.deepEqual(
      { pesadas: listo.pesadas, porPesar: listo.porPesar, bruto: listo.bruto, tara: listo.tara, kg: listo.kg, importe: listo.importe },
      { pesadas: ["5200.000", "3400.000"], porPesar: false, bruto: "5200.000", tara: "3400.000", kg: "1800.000", importe: "12240.00" },
    );
    assert.deepEqual(c.resumen, { materiales: 2, porPesar: 0, suma: "12303.42", ajuste: "-0.42", total: "12303" });
  }));

test("mientras falte una pesada la cuenta no se confirma", () =>
  conCuentas(async (bd, _db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Fierro pesado"], "5200", GRANDE));
    await rechazaCon(confirmar(bd, e.mostrador, c.id, c.revision), "RC005");
    const vacia = await nueva(bd, e, "compra");
    await rechazaCon(confirmar(bd, e.mostrador, vacia.id, vacia.revision), "RC005");
  }));

test("las cuentas abiertas vienen en el orden en que se abrieron, con lo que llevan", () =>
  conCuentas(async (bd, _db, e) => {
    const a = await nueva(bd, e, "compra", "Don Chuy");
    const b = await nueva(bd, e, "venta");
    await agregarMaterial(bd, e.mostrador, a.id, envio(e.mat["Cartón"], "30.2"));
    const hecha = await nueva(bd, e, "compra");
    const conMaterial = await agregarMaterial(bd, e.mostrador, hecha.id, envio(e.mat["PET"], "1"));
    await confirmar(bd, e.mostrador, hecha.id, conMaterial.revision);

    assert.deepEqual(await cuentasAbiertas(bd), [
      { id: a.id, tipo: "compra", etiqueta: "Don Chuy", materiales: 1, porPesar: 0, total: "63", deOtraJornada: false },
      { id: b.id, tipo: "venta", etiqueta: null, materiales: 0, porPesar: 0, total: "0", deOtraJornada: false },
    ]);
  }));

// ── cambiar una cuenta abierta ─────────────────────────────────────────────

test("quitar, descontar, etiquetar y descartar devuelven la cuenta como quedó", () =>
  conCuentas(async (bd, db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"], "30.2"));
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["PET"], "2"));

    c = await ponerDescuento(bd, e.mostrador, c.id, c.materiales[0]!.id, "0.2");
    assert.deepEqual(
      { kg: c.materiales[0]!.kg, descuento: c.materiales[0]!.descuento, importe: c.materiales[0]!.importe },
      { kg: "30.000", descuento: "0.200", importe: "63.00" },
    );
    c = await quitarMaterial(bd, e.mostrador, c.id, c.materiales[1]!.id);
    assert.equal(c.materiales.length, 1);
    c = await etiquetar(bd, e.mostrador, c.id, "Señora del triciclo");
    assert.equal(c.etiqueta, "Señora del triciclo");

    await descartar(bd, e.mostrador, c.id);
    assert.equal(await verCuenta(bd, c.id), null);
    assert.equal(await contar(db, "operacion"), 0);
    await descartar(bd, e.mostrador, c.id); // repetirlo no falla
  }));

test("desde una cuenta no se toca el material de otra", () =>
  conCuentas(async (bd, db, e) => {
    let suya = await nueva(bd, e, "compra");
    suya = await agregarMaterial(bd, e.mostrador, suya.id, envio(e.mat["Cartón"], "30"));
    suya = await agregarMaterial(bd, e.mostrador, suya.id, envio(e.mat["Fierro pesado"], "5200", GRANDE));
    const otra = await nueva(bd, e, "compra");
    const [carton, fierro] = suya.materiales;

    await rechazaCon(quitarMaterial(bd, e.mostrador, otra.id, carton!.id), "RC005");
    await rechazaCon(ponerDescuento(bd, e.mostrador, otra.id, carton!.id, "1"), "RC005");
    await rechazaCon(segundaPesada(bd, e.mostrador, otra.id, fierro!.id, { captura: randomUUID(), kg: "3400" }), "RC005");
    const igual = (await verCuenta(bd, suya.id))!;
    assert.equal(igual.revision, suya.revision);
    assert.equal(igual.materiales.length, 2);
    assert.equal(await contar(db, "captura_peso"), 2);
    // Quitar uno que ya no está —un reintento— no falla ni cambia nada.
    assert.equal((await quitarMaterial(bd, e.mostrador, otra.id, randomUUID())).materiales.length, 0);
  }));

test("confirmar con la revisión de antes no confirma lo que ya cambió", () =>
  conCuentas(async (bd, db, e) => {
    const cambios: Array<[string, (c: Cuenta) => Promise<unknown>]> = [
      ["otra etiqueta", (c) => etiquetar(bd, e.mostrador, c.id, "Otra")],
      ["un descuento", (c) => ponerDescuento(bd, e.mostrador, c.id, c.materiales[0]!.id, "1")],
      ["otro material", (c) => agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["PET"], "3"))],
      ["un material menos", (c) => quitarMaterial(bd, e.mostrador, c.id, c.materiales[1]!.id)],
    ];
    for (const [que, cambiar] of cambios) {
      let c = await nueva(bd, e, "compra");
      c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"], "30"));
      c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Aluminio bote"], "4"));
      // Otra pestaña cambia la cuenta mientras esta la tiene a la vista.
      await cambiar(c);
      await rechazaCon(confirmar(bd, e.mostrador, c.id, c.revision), "RC011");
      assert.equal((await verCuenta(bd, c.id))!.estado, "borrador", `con ${que}`);
      // Vista de nuevo, sí confirma.
      const fresca = (await verCuenta(bd, c.id))!;
      assert.equal((await confirmar(bd, e.mostrador, c.id, fresca.revision)).estado, "confirmada");
    }
    assert.equal(await contar(db, "operacion", "estado = 'confirmada'"), cambios.length);
  }));

test("la segunda pesada también cuenta como cambio de la cuenta", () =>
  conCuentas(async (bd, _db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Fierro pesado"], "5200", GRANDE));
    const antes = c.revision;
    c = await segundaPesada(bd, e.mostrador, c.id, c.materiales[0]!.id, { captura: randomUUID(), kg: "3400" });
    assert.ok(c.revision > antes);
    await rechazaCon(confirmar(bd, e.mostrador, c.id, antes), "RC011");
  }));

test("patio arma la cuenta pero no la confirma ni le pone descuento", () =>
  conCuentas(async (bd, _db, e) => {
    let c = await abrirCuenta(bd, e.patio, { id: randomUUID(), tipo: "compra", etiqueta: null });
    c = await agregarMaterial(bd, e.patio, c.id, envio(e.mat["Cartón"], "30"));
    await rechazaCon(ponerDescuento(bd, e.patio, c.id, c.materiales[0]!.id, "1"), "RC008");
    await rechazaCon(confirmar(bd, e.patio, c.id, c.revision), "RC008");
    await rechazaCon(abrirCuenta(bd, e.consulta, { id: randomUUID(), tipo: "compra", etiqueta: null }), "RC008");
  }));

// ── ventas y lo disponible ─────────────────────────────────────────────────

test("una venta avisa cuando lo apartado ya no alcanza, y el libro rechaza la que sobra", () =>
  conCuentas(async (bd, db, e) => {
    await db.query("SELECT registrar_apertura($1, 100, 'contado', $2)", [e.mat["Cartón"], e.responsable]);
    let primera = await nueva(bd, e, "venta");
    primera = await agregarMaterial(bd, e.mostrador, primera.id, envio(e.mat["Cartón"], "70"));
    assert.deepEqual(primera.avisos, []);

    let segunda = await nueva(bd, e, "venta");
    segunda = await agregarMaterial(bd, e.mostrador, segunda.id, envio(e.mat["Cartón"], "50"));
    assert.deepEqual(segunda.avisos, [{ material: "Cartón", faltan: "20.000" }]);
    // El aviso es de las dos: entre ambas se pasaron.
    assert.deepEqual((await verCuenta(bd, primera.id))!.avisos, [{ material: "Cartón", faltan: "20.000" }]);

    await confirmar(bd, e.mostrador, primera.id, primera.revision);
    await rechazaCon(confirmar(bd, e.mostrador, segunda.id, segunda.revision), "RC002");
    assert.equal(await existencia(db, e.mat["Cartón"]), 30);
    assert.deepEqual((await verCuenta(bd, segunda.id))!.avisos, [{ material: "Cartón", faltan: "20.000" }]);
  }));

test("una compra no lleva avisos de disponibilidad", () =>
  conCuentas(async (bd, _db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"], "70"));
    assert.deepEqual(c.avisos, []);
  }));

// ── el vehículo que vuelve otro día ────────────────────────────────────────

const huellaDe = (secreto: string) => createHash("sha256").update(secreto).digest("hex");

/** Un vehículo que se pesó cargado ayer y no volvió; hoy hay jornada nueva con otros precios. */
async function vehiculoDeAyer(bd: Bd, db: pg.Client, e: Escenario) {
  let c = await nueva(bd, e, "compra", "Torton azul");
  c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Fierro pesado"], "5200", GRANDE));
  await db.query("SELECT cerrar_jornada($1, $2)", [e.jornada, e.mostrador]);
  const hoy = await abrirJornada(db, e.responsable, "2026-10-02");
  await db.query("UPDATE precio SET compra = 99 WHERE lista_id = $1", [hoy.lista]);
  await db.query("SELECT publicar_lista($1, $2)", [hoy.lista, e.responsable]);
  // Un equipo dado de alta y un responsable con clave, para autorizar en el momento.
  const huella = huellaDe(randomUUID());
  const codigo = (await una(db, "SELECT crear_codigo_alta('Mostrador') AS c")).c;
  await db.query("SELECT canjear_codigo($1, $2)", [codigo, huella]);
  const marco = (await una(db, "SELECT * FROM alta_persona('Marco', 'responsable', true, '481516')")).id as string;
  return { cuenta: c, hoy, huella, marco };
}

test("el vehículo de ayer aparece entre las cuentas abiertas, marcado", () =>
  conCuentas(async (bd, db, e) => {
    const { cuenta } = await vehiculoDeAyer(bd, db, e);
    assert.deepEqual(await cuentasAbiertas(bd), [
      { id: cuenta.id, tipo: "compra", etiqueta: "Torton azul", materiales: 1, porPesar: 1, total: "0", deOtraJornada: true },
    ]);
    assert.equal((await verCuenta(bd, cuenta.id))!.deOtraJornada, true);
  }));

test("el vehículo de ayer lo termina un responsable con su clave, al precio de ayer y asentado hoy", () =>
  conCuentas(async (bd, db, e) => {
    const { cuenta, hoy, huella, marco } = await vehiculoDeAyer(bd, db, e);
    const c = await segundaPesada(bd, e.mostrador, cuenta.id, cuenta.materiales[0]!.id, { captura: randomUUID(), kg: "3400" });
    assert.equal(c.materiales[0]!.precio, "6.8000");

    // Por la vía ordinaria no la termina nadie: ni el mostrador ni un responsable con su sesión.
    await rechazaCon(confirmar(bd, e.mostrador, c.id, c.revision), "RC008");
    await rechazaCon(confirmar(bd, marco, c.id, c.revision), "RC008");
    const hecha = await terminarVehiculo(bd, huella, { responsable: marco, clave: "481516" }, c.id, c.revision);
    assert.ok(hecha);
    assert.equal(hecha.estado, "confirmada");
    assert.equal(hecha.resumen.total, "12240");
    const op = await una(db, "SELECT confirmada_por, confirmada_en_jornada, jornada_id FROM operacion WHERE id = $1", [c.id]);
    assert.deepEqual(op, { confirmada_por: marco, confirmada_en_jornada: hoy.id, jornada_id: e.jornada });
    assert.equal(await existencia(db, e.mat["Fierro pesado"]), 1800);
  }));

test("con la clave equivocada el vehículo no se termina y el intento queda contado", () =>
  conCuentas(async (bd, db, e) => {
    const { cuenta, huella, marco } = await vehiculoDeAyer(bd, db, e);
    const c = await segundaPesada(bd, e.mostrador, cuenta.id, cuenta.materiales[0]!.id, { captura: randomUUID(), kg: "3400" });
    assert.equal(await terminarVehiculo(bd, huella, { responsable: marco, clave: "000000" }, c.id, c.revision), null);
    assert.equal((await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [marco])).fallos, 1);
    assert.equal((await verCuenta(bd, c.id))!.estado, "borrador");
    // Desde un equipo que no está dado de alta tampoco, aunque la clave sea buena.
    assert.equal(await terminarVehiculo(bd, huellaDe("otro"), { responsable: marco, clave: "481516" }, c.id, c.revision), null);
  }));

test("la clave de quien no es responsable no termina el vehículo, y la clave buena con revisión vieja tampoco", () =>
  conCuentas(async (bd, db, e) => {
    const { cuenta, huella, marco } = await vehiculoDeAyer(bd, db, e);
    const luisa = (await una(db, "SELECT * FROM alta_persona('Luisa', 'mostrador', false, '4815')")).id as string;
    const c = await segundaPesada(bd, e.mostrador, cuenta.id, cuenta.materiales[0]!.id, { captura: randomUUID(), kg: "3400" });
    await rechazaCon(terminarVehiculo(bd, huella, { responsable: luisa, clave: "4815" }, c.id, c.revision), "RC008");
    await rechazaCon(terminarVehiculo(bd, huella, { responsable: marco, clave: "481516" }, c.id, cuenta.revision), "RC011");
    assert.equal((await verCuenta(bd, c.id))!.estado, "borrador");
  }));

test("la clave de un responsable no sirve para terminar a su nombre una cuenta de hoy", () =>
  conCuentas(async (bd, db, e) => {
    const { huella, marco } = await vehiculoDeAyer(bd, db, e);
    // Una cuenta abierta hoy, lista para terminarse: esa la termina quien atiende, a su nombre.
    const hoy = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: null });
    const lista = await agregarMaterial(bd, e.mostrador, hoy.id, envio(e.mat["Cartón"], "30"));
    await rechazaCon(terminarVehiculo(bd, huella, { responsable: marco, clave: "481516" }, lista.id, lista.revision), "RC005");
    assert.equal((await verCuenta(bd, lista.id))!.estado, "borrador");
    // Ni siquiera se llegó a probar la clave: una equivocada no cuenta como fallo.
    await rechazaCon(terminarVehiculo(bd, huella, { responsable: marco, clave: "000000" }, lista.id, lista.revision), "RC005");
    assert.equal((await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [marco])).fallos, 0);
    await rechazaCon(terminarVehiculo(bd, huella, { responsable: marco, clave: "481516" }, randomUUID(), 0), "RC005");
  }));

// ── el comprobante y sus impresiones ───────────────────────────────────────

async function compraHecha(bd: Bd, e: Escenario): Promise<Cuenta> {
  let c = await nueva(bd, e, "compra");
  c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Cartón"], "30.2"));
  return confirmar(bd, e.mostrador, c.id, c.revision);
}

test("el comprobante de un vehículo trae sus dos pesos", () =>
  conCuentas(async (bd, _db, e) => {
    let c = await nueva(bd, e, "compra");
    c = await agregarMaterial(bd, e.mostrador, c.id, envio(e.mat["Fierro pesado"], "5200", GRANDE));
    c = await segundaPesada(bd, e.mostrador, c.id, c.materiales[0]!.id, { captura: randomUUID(), kg: "3400" });
    c = await ponerDescuento(bd, e.mostrador, c.id, c.materiales[0]!.id, "50");
    await confirmar(bd, e.mostrador, c.id, c.revision);
    const t = (await comprobante(bd, c.id))!;
    assert.deepEqual(t.materiales, [{
      nombre: "Fierro pesado", bascula: "Báscula 1", bruto: "5200.000", tara: "3400.000", recipiente: "0.000", descuento: "50.000", kg: "1750.000",
      precio: "6.8000", importe: "11900.00",
    }]);
  }));

test("una cuenta que sigue abierta no tiene comprobante", () =>
  conCuentas(async (bd, _db, e) => {
    const c = await nueva(bd, e, "compra");
    assert.equal(await comprobante(bd, c.id), null);
    assert.equal(await comprobante(bd, randomUUID()), null);
  }));

test("un comprobante se encuentra por su folio", () =>
  conCuentas(async (bd, _db, e) => {
    const c = await compraHecha(bd, e);
    assert.equal((await buscarPorFolio(bd, c.folio!))?.id, c.id);
    assert.equal(await buscarPorFolio(bd, "999999"), null);
  }));

test("la primera impresión es el original; la segunda pide motivo y sale marcada", () =>
  conCuentas(async (bd, db, e) => {
    const c = await compraHecha(bd, e);
    assert.deepEqual(await registrarImpresion(bd, e.mostrador, { id: randomUUID(), operacion: c.id, motivo: null }), { numero: 1, motivo: null });
    await rechazaCon(registrarImpresion(bd, e.mostrador, { id: randomUUID(), operacion: c.id, motivo: null }), "RC005");
    await rechazaCon(registrarImpresion(bd, e.mostrador, { id: randomUUID(), operacion: c.id, motivo: "   " }), "RC005");
    assert.deepEqual(
      await registrarImpresion(bd, e.responsable, { id: randomUUID(), operacion: c.id, motivo: "No salió" }),
      { numero: 2, motivo: "No salió" },
    );
    assert.equal((await comprobante(bd, c.id))!.impresiones, 2);
    const rastro = await una(db, "SELECT usuario_id, detalle FROM bitacora WHERE accion = 'reimprimir'");
    assert.equal(rastro.usuario_id, e.responsable);
    assert.deepEqual(rastro.detalle, { numero: 2, motivo: "No salió", folio: Number(c.folio) });
  }));

test("repetir una reimpresión con otro motivo se rechaza", () =>
  conCuentas(async (bd, db, e) => {
    const c = await compraHecha(bd, e);
    const original = randomUUID();
    await registrarImpresion(bd, e.mostrador, { id: original, operacion: c.id, motivo: null });
    const id = randomUUID();
    await registrarImpresion(bd, e.mostrador, { id, operacion: c.id, motivo: "No salió" });
    assert.deepEqual(await registrarImpresion(bd, e.mostrador, { id, operacion: c.id, motivo: "  No salió " }), { numero: 2, motivo: "No salió" });
    await rechazaCon(registrarImpresion(bd, e.mostrador, { id, operacion: c.id, motivo: "Copia cliente" }), "RC005");
    await rechazaCon(registrarImpresion(bd, e.mostrador, { id, operacion: c.id, motivo: null }), "RC005");
    // El original no lleva motivo: repetirlo con uno no cambia nada ni se rechaza.
    assert.deepEqual(await registrarImpresion(bd, e.mostrador, { id: original, operacion: c.id, motivo: "lo que sea" }), { numero: 1, motivo: null });
    assert.equal(await contar(db, "impresion"), 2);
  }));

test("repetir el registro de una impresión no suma otra", () =>
  conCuentas(async (bd, db, e) => {
    const c = await compraHecha(bd, e);
    const id = randomUUID();
    const primera = await registrarImpresion(bd, e.mostrador, { id, operacion: c.id, motivo: null });
    assert.deepEqual(await registrarImpresion(bd, e.mostrador, { id, operacion: c.id, motivo: null }), primera);
    assert.equal(await contar(db, "impresion"), 1);
    // El mismo identificador para otra cuenta no vale.
    const otra = await compraHecha(bd, e);
    await rechazaCon(registrarImpresion(bd, e.mostrador, { id, operacion: otra.id, motivo: null }), "RC005");
  }));

test("leer el comprobante no cuenta como impresión", () =>
  conCuentas(async (bd, db, e) => {
    const c = await compraHecha(bd, e);
    await comprobante(bd, c.id);
    await comprobante(bd, c.id);
    assert.equal(await contar(db, "impresion"), 0);
    assert.equal((await comprobante(bd, c.id))!.impresiones, 0);
  }));

test("dos impresiones a la vez toman números distintos", () =>
  conCuentas(async (bd, db, e, base) => {
    const c = await compraHecha(bd, e);
    await registrarImpresion(bd, e.mostrador, { id: randomUUID(), operacion: c.id, motivo: null });
    const [una_, otra] = [await comoApp(base), await comoApp(base)];
    try {
      const imprimir = (con: pg.Client, motivo: string) =>
        con.query("SELECT numero FROM registrar_impresion($1, $2, $3, $4)", [randomUUID(), c.id, motivo, e.mostrador]);
      const pid = await pidDe(otra);
      await una_.query("BEGIN");
      const primera = await imprimir(una_, "No salió");
      const segunda = imprimir(otra, "Copia para el cliente");
      await esperarQueEspere(db, pid);
      await una_.query("COMMIT");
      assert.deepEqual([primera.rows[0].numero, (await segunda).rows[0].numero], [2, 3]);
      assert.equal(await contar(db, "impresion"), 3);
    } finally {
      await Promise.all([una_.end(), otra.end()]);
    }
  }));

test("solo se imprime una cuenta terminada, y la imprime quien cobra", () =>
  conCuentas(async (bd, db, e) => {
    const abierta = await nueva(bd, e, "compra");
    await rechazaCon(registrarImpresion(bd, e.mostrador, { id: randomUUID(), operacion: abierta.id, motivo: null }), "RC005");
    await rechazaCon(registrarImpresion(bd, e.mostrador, { id: randomUUID(), operacion: randomUUID(), motivo: null }), "RC005");
    const c = await compraHecha(bd, e);
    for (const quien of [e.patio, e.consulta]) {
      await rechazaCon(registrarImpresion(bd, quien, { id: randomUUID(), operacion: c.id, motivo: null }), "RC008");
    }
    assert.equal(await contar(db, "impresion"), 0);
  }));

test("una impresión registrada no se cambia ni se borra", () =>
  conCuentas(async (bd, db, e) => {
    const c = await compraHecha(bd, e);
    await registrarImpresion(bd, e.mostrador, { id: randomUUID(), operacion: c.id, motivo: null });
    await assert.rejects(db.query("UPDATE impresion SET numero = 5"), (err: any) => err.code === "RC001");
    await assert.rejects(db.query("DELETE FROM impresion"), (err: any) => err.code === "RC001");
    await assert.rejects(db.query("TRUNCATE impresion"), (err: any) => err.code === "RC001");
  }));
