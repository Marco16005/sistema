// Corregir una cuenta cobrada desde el servidor (0040): lo que la pantalla ve de la cuenta, y la
// corrección con la clave de quien autoriza. Las reglas de la base las prueba 51-corregir-cuenta.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { conBase, equipoDeAlta, escenario, personaConClave, urlApp } from "./apoyo.ts";
import { crearBd } from "../src/servidor/bd.ts";
import { abrirCuenta, agregarMaterial, confirmar } from "../src/servidor/dominio/cuentas.ts";
import { corregirCuenta, cuentaParaCorregir } from "../src/servidor/dominio/correcciones.ts";
import { ErrorDeNegocio } from "../src/servidor/errores.ts";

test("se ve la cuenta cobrada con lo que vale cada material, se corrige con la clave de quien autoriza, y queda la corrección", () =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 2 });
    try {
      const e = await escenario(db);
      const marco = await personaConClave(db, "Marco", "responsable", "481516", true);
      const huella = await equipoDeAlta(db);
      let c = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: null });
      c = await agregarMaterial(bd, e.mostrador, c.id, { linea: randomUUID(), captura: randomUUID(), material: e.mat["Cartón"]!, bascula: 2, kg: "30" });
      assert.equal(await cuentaParaCorregir(bd, c.id), null, "abierta todavía no se corrige");
      const hecha = await confirmar(bd, e.mostrador, c.id, c.revision);

      const antes = (await cuentaParaCorregir(bd, c.id))!;
      assert.deepEqual(
        { folio: antes.folio, tipo: antes.tipo, renglon: antes.renglones[0], correcciones: antes.correcciones },
        { folio: hecha.folio, tipo: "compra", renglon: { linea: c.materiales[0]!.id, material: { id: e.mat["Cartón"], nombre: "Cartón" }, kg: "30.000", precio: "2.1000", importe: "63.00", correcciones: 0 }, correcciones: [] },
      );
      const orden = { id: randomUUID(), linea: antes.renglones[0]!.linea, kg: "25", material: e.mat["Cartón"]!, vistas: 0, liquidacion: "efectivo" as const, motivo: "Se pesó con el costal", autoriza: marco, clave: "000000" };
      assert.equal(await corregirCuenta(bd, e.mostrador, huella, c.id, orden), null, "con la clave mala no se corrige");
      const despues = (await corregirCuenta(bd, e.mostrador, huella, c.id, { ...orden, clave: "481516" }))!;
      assert.deepEqual(
        { kg: despues.renglones[0]!.kg, importe: despues.renglones[0]!.importe, correcciones: despues.renglones[0]!.correcciones },
        { kg: "25.000", importe: "52.50", correcciones: 1 },
      );
      assert.deepEqual(
        (({ numero, materialAntes, materialDespues, kgAntes, kgDespues, diferencia, liquidacion, motivo, autorizo, registro }) =>
          ({ numero, materialAntes, materialDespues, kgAntes, kgDespues, diferencia, liquidacion, motivo, autorizo, registro }))(despues.correcciones[0]!),
        { numero: 1, materialAntes: "Cartón", materialDespues: "Cartón", kgAntes: "30.000", kgDespues: "25.000", diferencia: "-10.50", liquidacion: "efectivo", motivo: "Se pesó con el costal", autorizo: "Marco", registro: "Luis" },
      );

      // Desde una cuenta no se corrige el material de otra.
      let otra = await abrirCuenta(bd, e.mostrador, { id: randomUUID(), tipo: "compra", etiqueta: null });
      otra = await agregarMaterial(bd, e.mostrador, otra.id, { linea: randomUUID(), captura: randomUUID(), material: e.mat["PET"]!, bascula: 2, kg: "4" });
      await confirmar(bd, e.mostrador, otra.id, otra.revision);
      await assert.rejects(corregirCuenta(bd, e.mostrador, huella, otra.id, { ...orden, id: randomUUID(), vistas: 1, clave: "481516" }),
        (x: unknown) => x instanceof ErrorDeNegocio && x.codigo === "RC005");
    } finally {
      await bd.cerrar();
    }
  }));
