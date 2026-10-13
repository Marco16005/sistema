// Respaldar. Un respaldo es una corrida con pasos explícitos: volcar, cifrar con la llave pública,
// subir con nombre único, bajar lo subido y comparar su huella, y solo entonces dejar el manifiesto
// que lo da por existente y avisar al vigilante. Aquí se corre contra un almacenamiento de verdad
// (versiones, retención con candado, credenciales restringidas) y se restaura lo respaldado.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { conCubo } from "./almacen.ts";
import type { Credencial, Cubo } from "./almacen.ts";
import { comoApp, compraDe, contar as cuantos, una, urlDe } from "./apoyo.ts";
import { LIMPIO, administradorConClave, basesCon, conDestino, conPatio, correr as programa, llaves, procesos, retrato, urlEn } from "./patio.ts";
import type { Patio, Proceso } from "./patio.ts";
import { claveDeSello, destinoRclone, leerManifiesto, nombreDeManifiesto, nombreDeObjeto, respaldos, selloDe, traer, ultimoUtilizable } from "../operacion/destino.ts";
import type { Destino, Manifiesto } from "../operacion/destino.ts";
import { ESQUEMA_ESPERADO } from "../src/servidor/esquema.ts";
import { leerHorario, siguiente, toca, ultimoDebido } from "../operacion/horario.ts";
import { diaDelPatio, sinComprobar } from "../operacion/diario.ts";
import { diarioAlArrancar, eleccionesEnLaBase, respaldar, servicio, vigiaHttp } from "../operacion/respaldar.ts";
import type { Diario } from "../operacion/respaldar.ts";
import { CANDADO_DE_RESTAURACION, restaurar, restaurarDelDestino } from "../operacion/restaurar.ts";

// ── el horario ─────────────────────────────────────────────────────────────

const PATIO = "America/Mexico_City";      // sin cambio de horario desde 2022: seis horas detrás de UTC
const CON_CAMBIO = "America/New_York";    // con cambio de horario: 8 de marzo y 1 de noviembre de 2026

/** Los momentos de respaldo que siguen a ese instante, uno tras otro. */
function losSiguientes(horario: string, zona: string, desde: string, cuantos: number): string[] {
  const horas = leerHorario(horario);
  const salen: string[] = [];
  let t = new Date(desde);
  for (let k = 0; k < cuantos; k += 1) {
    t = siguiente(horas, zona, t);
    salen.push(t.toISOString());
  }
  return salen;
}

test("cada respaldo cae a su hora del lugar, también al cruzar la medianoche", () => {
  assert.deepEqual(losSiguientes("22:00,23:00,00:00,01:00", PATIO, "2026-10-04T21:30:00-06:00", 6), [
    "2026-10-05T04:00:00.000Z",   // 22:00 del 4
    "2026-10-05T05:00:00.000Z",   // 23:00
    "2026-10-05T06:00:00.000Z",   // 00:00 del 5
    "2026-10-05T07:00:00.000Z",   // 01:00
    "2026-10-06T04:00:00.000Z",   // 22:00 del 5
    "2026-10-06T05:00:00.000Z",
  ]);
  // El que sigue a la hora exacta es el siguiente, no ella misma.
  assert.deepEqual(losSiguientes("09:00,10:00", PATIO, "2026-10-04T09:00:00-06:00", 1), ["2026-10-04T16:00:00.000Z"]);
  // El orden en que se escriban no importa, ni que se repitan.
  assert.deepEqual(leerHorario("10:00, 09:00,10:00"), leerHorario("09:00,10:00"));
});

test("con cambio de horario cada hora del día dispara una sola vez: ni se pierde la que no existe ni se repite la que ocurre dos veces", () => {
  // 8 de marzo: a las 02:00 el reloj salta a las 03:00. Las 02:30 no existen: ese respaldo se
  // recorre lo que dura el salto y cae a las 03:30, que es el mismo instante del de las 03:30. Uno, no dos.
  assert.deepEqual(losSiguientes("01:30,02:30,03:30", CON_CAMBIO, "2026-03-08T00:00:00-05:00", 3), [
    "2026-03-08T06:30:00.000Z",   // 01:30, todavía en horario de invierno
    "2026-03-08T07:30:00.000Z",   // 02:30 (no existe) y 03:30, ya en horario de verano
    "2026-03-09T05:30:00.000Z",   // 01:30 del día siguiente
  ]);
  // Sola, la hora que no existe tampoco se pierde ni se adelanta: cae después del salto, no antes.
  assert.deepEqual(losSiguientes("02:30", CON_CAMBIO, "2026-03-08T00:00:00-05:00", 2), [
    "2026-03-08T07:30:00.000Z",   // las 03:30 de ese día
    "2026-03-09T06:30:00.000Z",   // las 02:30 del siguiente, que sí existen
  ]);
  // 1 de noviembre: a las 02:00 el reloj vuelve a la 01:00. La 01:30 ocurre dos veces: dispara la primera.
  assert.deepEqual(losSiguientes("01:30,02:30,03:30", CON_CAMBIO, "2026-11-01T00:00:00-04:00", 4), [
    "2026-11-01T05:30:00.000Z",   // la primera 01:30
    "2026-11-01T07:30:00.000Z",   // 02:30, ya en horario de invierno
    "2026-11-01T08:30:00.000Z",
    "2026-11-02T06:30:00.000Z",
  ]);
});

test("el horario se lee como horas del día y no admite otra cosa", () => {
  assert.deepEqual(leerHorario("07:00,19:30"), [{ h: 7, m: 0 }, { h: 19, m: 30 }]);
  for (const malo of ["", " ", "25:00", "08:60", "8", "8:00", "08:00;09:00", "cada hora", "08:00,,09:00"]) {
    assert.throws(() => leerHorario(malo), /horario/i, `debió rechazar «${malo}»`);
  }
});

test("toca respaldar cuando el último respaldo es anterior a la última hora debida", () => {
  const horas = leerHorario("09:00,10:00,11:00");
  const a = (hora: string): Date => new Date(`2026-10-05T${hora}-06:00`);
  assert.equal(ultimoDebido(horas, PATIO, a("10:20:00")).toISOString(), a("10:00:00").toISOString());
  assert.equal(ultimoDebido(horas, PATIO, a("10:00:00")).toISOString(), a("10:00:00").toISOString());
  // Antes de la primera hora del día, lo último debido es la última de ayer.
  assert.equal(ultimoDebido(horas, PATIO, a("08:00:00")).toISOString(), "2026-10-04T17:00:00.000Z");

  assert.equal(toca(horas, PATIO, a("10:20:00"), null), true, "nunca se ha respaldado");
  assert.equal(toca(horas, PATIO, a("10:20:00"), a("09:00:03")), true, "falta el de las 10");
  assert.equal(toca(horas, PATIO, a("10:20:00"), a("10:00:03")), false);
  assert.equal(toca(horas, PATIO, a("10:20:00"), a("10:15:00")), false, "uno manual después de la hora también cuenta");
  assert.equal(toca(horas, PATIO, a("08:00:00"), new Date("2026-10-04T17:00:02Z")), false, "de noche no hay nada pendiente");
});

// ── el servicio que los toma a su hora ─────────────────────────────────────

/** El servicio con un reloj que solo avanza cuando el servicio duerme, o lo que tarde la corrida. */
async function simular(o: {
  horario: string;
  empieza: string;
  ultimo: string | null | Error;
  corridas: number;
  falla?: (numero: number) => boolean;
  tarda?: number;
  reintento?: number;
}): Promise<{ corridas: string[]; siestas: number[] }> {
  let ahora = new Date(o.empieza).getTime();
  const corridas: string[] = [];
  const siestas: number[] = [];
  let intentos = 0;
  await servicio({
    horario: leerHorario(o.horario), zona: PATIO, reintento: o.reintento ?? 5 * 60_000,
    reloj: () => new Date(ahora),
    dormir: async (ms) => {
      assert.ok(ms > 0, "el servicio no debe girar en vacío");
      siestas.push(ms);
      ahora += ms;
    },
    ultimo: async () => {
      if (o.ultimo instanceof Error) throw o.ultimo;
      return o.ultimo === null ? null : new Date(o.ultimo);
    },
    corrida: async () => {
      intentos += 1;
      const instantanea = new Date(ahora);
      ahora += o.tarda ?? 40_000;
      if (o.falla?.(intentos)) throw new Error("no hubo red");
      corridas.push(instantanea.toISOString());
      return instantanea;
    },
    seguir: () => corridas.length < o.corridas && siestas.length < 50,
  });
  return { corridas, siestas };
}

test("el servicio toma cada respaldo a su hora", async () => {
  const { corridas } = await simular({
    horario: "22:00,23:00,00:00", empieza: "2026-10-04T21:40:00-06:00", ultimo: "2026-10-04T21:00:05-06:00", corridas: 4,
  });
  assert.deepEqual(corridas, [
    "2026-10-05T04:00:00.000Z", "2026-10-05T05:00:00.000Z", "2026-10-05T06:00:00.000Z", "2026-10-06T04:00:00.000Z",
  ]);
});

test("si el servicio estuvo caído a la hora de un respaldo, lo toma al volver: uno, no uno por cada hora perdida", async () => {
  const { corridas } = await simular({
    horario: "08:00,09:00,10:00,11:00", empieza: "2026-10-05T10:20:00-06:00", ultimo: "2026-10-05T08:00:04-06:00", corridas: 2,
  });
  assert.deepEqual(corridas, ["2026-10-05T16:20:00.000Z", "2026-10-05T17:00:00.000Z"]);

  // Si no se puede saber cuál fue el último (no hay red para preguntar), se toma uno: de más no estorba.
  const sinSaber = await simular({ horario: "08:00,09:00", empieza: "2026-10-05T08:10:00-06:00", ultimo: new Error("sin red"), corridas: 1 });
  assert.deepEqual(sinSaber.corridas, ["2026-10-05T14:10:00.000Z"]);

  // Y si volvió sin haberse perdido ninguno, espera al siguiente.
  const alDia = await simular({ horario: "08:00,09:00", empieza: "2026-10-05T08:10:00-06:00", ultimo: "2026-10-05T08:00:04-06:00", corridas: 1 });
  assert.deepEqual(alDia.corridas, ["2026-10-05T15:00:00.000Z"]);
});

test("un respaldo que falla se reintenta pronto, sin esperar a la hora siguiente", async () => {
  const { corridas, siestas } = await simular({
    horario: "09:00,10:00", empieza: "2026-10-05T08:59:00-06:00", ultimo: "2026-10-04T10:00:03-06:00", corridas: 2,
    falla: (numero) => numero <= 2, tarda: 30_000, reintento: 5 * 60_000,
  });
  // El de las 9 falla dos veces (cada intento tarda medio minuto) y entra al tercero, 09:11; el siguiente, a las 10.
  assert.deepEqual(corridas, ["2026-10-05T15:11:00.000Z", "2026-10-05T16:00:00.000Z"]);
  assert.deepEqual(siestas.slice(0, 3), [60_000, 5 * 60_000, 5 * 60_000]);

  // El reintento nunca se pasa de la hora siguiente: si falta menos para ella, se intenta a esa hora.
  const largo = await simular({
    horario: "09:00,10:00", empieza: "2026-10-05T08:59:00-06:00", ultimo: "2026-10-04T10:00:03-06:00", corridas: 1,
    falla: (numero) => numero === 1, tarda: 30_000, reintento: 2 * 3_600_000,
  });
  assert.deepEqual(largo.corridas, ["2026-10-05T16:00:00.000Z"]);
});

test("si el reloj de la base va atrás del de la máquina, el respaldo de una hora no se repite", async () => {
  // La corrida devuelve el momento que dio la base: cinco segundos antes de la hora que se debía.
  let ahora = new Date("2026-10-05T08:59:00-06:00").getTime();
  const corridas: string[] = [];
  await servicio({
    horario: leerHorario("09:00,10:00"), zona: PATIO, reintento: 5 * 60_000,
    reloj: () => new Date(ahora),
    dormir: async (ms) => {
      ahora += ms;
    },
    ultimo: async () => new Date("2026-10-04T10:00:03-06:00"),
    corrida: async () => {
      corridas.push(new Date(ahora).toISOString());
      return new Date(ahora - 5_000);
    },
    seguir: () => corridas.length < 2,
  });
  assert.deepEqual(corridas, ["2026-10-05T15:00:00.000Z", "2026-10-05T16:00:00.000Z"]);
});

test("si el reloj retrocede, el servicio no se queda horas sin respaldar por tener un último respaldo «del futuro»", async () => {
  // Respaldo a las 9; después alguien corrige el reloj de la máquina a las 7. Las 7, las 8 y las 9
  // vuelven a llegar: se respalda en cada una, en vez de esperar a que el reloj rebase las 9 de antes.
  let ahora = new Date("2026-10-05T08:59:00-06:00").getTime();
  const corridas: string[] = [];
  await servicio({
    horario: leerHorario("07:00,08:00,09:00,10:00"), zona: PATIO, reintento: 5 * 60_000,
    reloj: () => new Date(ahora),
    dormir: async (ms) => {
      assert.ok(ms > 0);
      ahora += ms;
    },
    ultimo: async () => new Date("2026-10-05T08:00:02-06:00"),
    corrida: async () => {
      corridas.push(new Date(ahora).toISOString());
      const instantanea = new Date(ahora);
      if (corridas.length === 1) ahora = new Date("2026-10-05T06:59:00-06:00").getTime();   // el reloj retrocede justo después
      return instantanea;
    },
    seguir: () => corridas.length < 5,
  });
  assert.deepEqual(corridas, [
    "2026-10-05T15:00:00.000Z",   // las 9
    "2026-10-05T12:59:00.000Z",   // el reloj volvió a las 6:59 y el último quedó en el futuro: se toma uno ya
    "2026-10-05T13:00:00.000Z",   // las 7
    "2026-10-05T14:00:00.000Z",   // las 8
    "2026-10-05T15:00:00.000Z",   // las 9, otra vez
  ]);
  assert.equal(toca(leerHorario("09:00"), PATIO, new Date("2026-10-05T07:00:00-06:00"), new Date("2026-10-05T09:00:00-06:00")), true);
});

test("si el reloj de la base va adelante del de la máquina, el servicio no se pone a respaldar sin parar", async () => {
  let ahora = new Date("2026-10-05T08:59:00-06:00").getTime();
  const corridas: string[] = [];
  let siestas = 0;
  await servicio({
    horario: leerHorario("09:00,10:00"), zona: PATIO, reintento: 5 * 60_000,
    reloj: () => new Date(ahora),
    dormir: async (ms) => {
      siestas += 1;
      ahora += ms;
    },
    ultimo: async () => new Date("2026-10-04T10:00:03-06:00"),
    corrida: async () => {
      corridas.push(new Date(ahora).toISOString());
      return new Date(ahora + 5_000);          // el momento que dio la base: cinco segundos adelante
    },
    seguir: () => corridas.length < 2 && siestas < 10,
  });
  assert.deepEqual(corridas, ["2026-10-05T15:00:00.000Z", "2026-10-05T16:00:00.000Z"]);
});

test("un respaldo que tarda más que el intervalo no deja sin tomar el que venció mientras corría", async () => {
  const { corridas } = await simular({
    horario: "09:00,10:00,11:00", empieza: "2026-10-05T08:59:00-06:00", ultimo: "2026-10-05T08:00:00-06:00", corridas: 3,
    tarda: 65 * 60_000,
  });
  // El de las 9 termina 10:05: el de las 10 ya venció y se toma enseguida; ese termina 11:10 y pasa lo mismo.
  assert.deepEqual(corridas, ["2026-10-05T15:00:00.000Z", "2026-10-05T16:05:00.000Z", "2026-10-05T17:10:00.000Z"]);
});

// ── la corrida, contra un almacenamiento de verdad ─────────────────────────

const BLOQUE = 100_000;
/** La clave del sello de las pruebas que arman sus manifiestos a mano, sin una llave de por medio. */
const SELLO_DE_PRUEBA = "5e".repeat(32);
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const restos = async (): Promise<string[]> => (await readdir(tmpdir())).filter((x) => x.startsWith("feruga-respaldo-") || x.startsWith("feruga-restaurar-"));

interface Senal {
  que: "inicio" | "bien" | "fallo";
  /** A qué dirección del vigilante llegó. */
  camino: string;
  corrida: string;
  cuerpo: string;
  /** Cuántos respaldos existían en el destino cuando llegó la señal. */
  habia: number;
}

interface Todo {
  p: Patio;
  cubo: Cubo;
  llave: { publica: string; privada: string };
  /** El destino, visto con esa credencial. */
  con: (c: Credencial) => Destino;
  /** El vigilante de prueba: la dirección a la que se le avisa y lo que ha recibido, en orden. */
  vigia: { url: string; senales: Senal[] };
  /** Una corrida con la credencial del servidor y el vigilante de prueba, salvo lo que se cambie. */
  correr: (cambios?: Partial<Parameters<typeof respaldar>[0]>) => ReturnType<typeof respaldar>;
  dicho: string[];
}

/** Un patio con historia, un cubo con candado y sus credenciales, un par de llaves y un vigilante que anota lo que recibe. */
const conTodo = (prueba: (t: Todo) => Promise<void>) =>
  conPatio((p) =>
    conCubo(async (cubo) => {
      const llave = await llaves();
      // El sello sale de la llave privada, como en la vida real: el servidor guarda la derivada, y quien restaura la vuelve a sacar.
      const con = (c: Credencial): Destino => destinoRclone(cubo.destino, cubo.entorno(c), { sello: claveDeSello(llave.privada) });
      const senales: Senal[] = [];
      const tropiezos: unknown[] = [];
      const servidor = createServer((peticion, respuesta) => {
        const trozos: Buffer[] = [];
        peticion.on("data", (trozo: Buffer) => trozos.push(trozo));
        peticion.on("end", () => {
          void (async () => {
            try {
              const u = new URL(peticion.url ?? "/", "http://vigia");
              const que = u.pathname.endsWith("/start") ? "inicio" : u.pathname.endsWith("/fail") ? "fallo" : "bien";
              const habia = (await respaldos(con(cubo.recuperacion))).length;
              senales.push({ que, camino: u.pathname, corrida: u.searchParams.get("rid") ?? "", cuerpo: Buffer.concat(trozos).toString(), habia });
              respuesta.writeHead(200).end("OK");
            } catch (e) {
              tropiezos.push(e);
              respuesta.writeHead(500).end();
            }
          })();
        });
      });
      await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
      const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/ping/respaldo-de-prueba`;
      const dicho: string[] = [];
      try {
        await prueba({
          p, cubo, llave, con, vigia: { url, senales }, dicho,
          correr: (cambios = {}) =>
            respaldar({
              base: urlDe(p.base), llavePublica: llave.publica, destino: con(cubo.servidor), vigia: vigiaHttp(url),
              decir: (linea) => dicho.push(linea), ...cambios,
            }),
        });
        assert.deepEqual(tropiezos, [], "el vigilante de prueba tropezó");
      } finally {
        await new Promise((listo) => servidor.close(listo));
      }
    }));

test("respaldar, perder la máquina y volver: lo respaldado se baja con la credencial de recuperación y se restaura", () =>
  conTodo(async ({ p, cubo, llave, con, vigia, correr }) => {
    const carton = p.e.mat["Cartón"];
    const antes = await retrato(p.db);
    const justoAntes = Date.now();
    const { manifiesto, avisado } = await correr();
    assert.equal(avisado, true);

    // El manifiesto dice qué se respaldó, y de cuándo es.
    assert.match(manifiesto.objeto, /^\d{4}\/\d{2}\/\d{2}\/\d{8}T\d{9}Z-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.dump\.age$/);
    assert.ok(manifiesto.objeto.includes(manifiesto.corrida));
    assert.equal(manifiesto.llavePublica, llave.publica);
    assert.equal(manifiesto.esquema, (await una(p.db, "SELECT archivo FROM migracion ORDER BY archivo DESC LIMIT 1")).archivo);
    assert.match(manifiesto.pgDump, /^pg_dump \(PostgreSQL\) 17\./);
    const instantanea = new Date(manifiesto.instantanea).getTime();
    assert.ok(instantanea >= justoAntes - 1000 && instantanea <= Date.now());

    // No queda copia en la máquina: ni el volcado sin cifrar ni el cifrado.
    assert.deepEqual(await restos(), []);
    // Lo que quedó en el almacenamiento es lo que dice el manifiesto, y está cifrado.
    const guardado = await cubo.leer(manifiesto.objeto);
    assert.deepEqual({ bytes: guardado.length, sha256: sha256(guardado) }, { bytes: manifiesto.bytes, sha256: manifiesto.sha256 });
    assert.ok(guardado.subarray(0, 40).toString().startsWith("age-encryption.org/v1"));
    assert.ok(!guardado.includes(Buffer.from("PGDMP")), "el volcado está sin cifrar");

    // El vigilante supo del inicio antes de que existiera el respaldo, y del final cuando ya existía.
    assert.deepEqual(vigia.senales.map((s) => [s.que, s.corrida, s.habia]), [["inicio", manifiesto.corrida, 0], ["bien", manifiesto.corrida, 1]]);

    // Después del respaldo el patio siguió trabajando: esos folios se imprimieron y se pierden con la máquina.
    const perdidos: number[] = [];
    for (const kg of [5, 6, 7]) perdidos.push(Number((await una(p.db, "SELECT folio FROM operacion WHERE id = $1", [await compraDe(p.db, p.e, carton, kg)])).folio));

    // En otra máquina, con la credencial de recuperación y la llave del dueño.
    const recuperacion = con(cubo.recuperacion);
    const lista = await respaldos(recuperacion);
    assert.deepEqual(lista.map((r) => [r.objeto, r.bytes, r.momento.toISOString()]), [
      [manifiesto.objeto, manifiesto.bytes, manifiesto.instantanea],
    ]);
    await conDestino(async (destino) => {
      const r = await restaurarDelDestino({
        destino: recuperacion, servidor: LIMPIO, base: destino, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba",
      });
      assert.equal(r.objeto, manifiesto.objeto);
      assert.deepEqual(await restos(), []);
      const restaurada = new pg.Client({ connectionString: urlEn(LIMPIO, destino) });
      await restaurada.connect();
      const app = await comoApp(destino, LIMPIO);
      try {
        assert.deepEqual(await retrato(restaurada), antes);
        // Queda registrado de qué respaldo se volvió y de cuándo era, exacto: lo dice el manifiesto.
        const registro = await una(restaurada, "SELECT * FROM restauracion");
        assert.equal(new Date(registro.respaldo_de).toISOString(), manifiesto.instantanea);
        assert.ok(String(registro.nota).includes(manifiesto.objeto));
        // Y ningún folio se repite: el siguiente cae en el bloque nuevo.
        const nueva = await compraDe(restaurada, p.e, carton, 10);
        const folio = Number((await una(restaurada, "SELECT folio FROM operacion WHERE id = $1", [nueva])).folio);
        assert.equal(folio, BLOQUE + 1);
        assert.ok(!perdidos.includes(folio));
        assert.equal((await una(app, "SELECT vida_vigente() AS v")).v, true);
      } finally {
        await app.end();
        await restaurada.end();
      }
    });
  }));

test("la credencial del servidor no puede destruir la historia: sobrescribir deja viva la versión anterior, y borrar o cambiar la retención se niega", () =>
  conTodo(async ({ cubo, llave, con, correr }) => {
    const { manifiesto } = await correr();
    const objeto = `c/${cubo.nombre}/feruga/${manifiesto.objeto}`;
    const original = (await cubo.versiones(manifiesto.objeto))[0]!;
    const antesDelDano = new Date();
    await new Promise((sigue) => setTimeout(sigue, 1500));

    const carpeta = await mkdtemp(join(tmpdir(), "permisos-"));
    try {
      // 1. Sobrescribir: con la misma credencial con que respalda, el servidor pisa su respaldo con otra cosa del mismo tamaño.
      const basura = join(carpeta, "basura");
      await writeFile(basura, Buffer.alloc(manifiesto.bytes, 7));
      await con(cubo.servidor).subir(basura, manifiesto.objeto);
      const versiones = await cubo.versiones(manifiesto.objeto);
      assert.equal(versiones.length, 2, "sobrescribir debe dejar la versión anterior");
      assert.equal(versiones[1]!.id, original.id);
      assert.equal(sha256(await cubo.leer(manifiesto.objeto, original.id)), manifiesto.sha256, "la versión anterior sigue intacta");

      // 2. Borrar, o borrar una versión: se niega.
      await assert.rejects(cubo.mc(cubo.servidor, "rm", objeto));
      await assert.rejects(cubo.mc(cubo.servidor, "rm", "--version-id", original.id, objeto));
      // 3. Cambiar la retención, del objeto o del cubo: se niega.
      await assert.rejects(cubo.mc(cubo.servidor, "retention", "set", "--version-id", original.id, "GOVERNANCE", "1d", objeto));
      await assert.rejects(cubo.mc(cubo.servidor, "retention", "set", "--default", "GOVERNANCE", "1d", `c/${cubo.nombre}`));
      await assert.rejects(cubo.mc(cubo.servidor, "retention", "clear", "--default", `c/${cubo.nombre}`));
      // 4. Ni quien administra el almacenamiento puede borrar la versión protegida ni acortarle la retención.
      await assert.rejects(cubo.mc(cubo.raiz, "rm", "--version-id", original.id, objeto));
      await assert.rejects(cubo.mc(cubo.raiz, "retention", "set", "--version-id", original.id, "COMPLIANCE", "1d", objeto));
      // 5. Fuera de su prefijo el servidor no escribe; y la credencial de recuperación no escribe en ninguna parte.
      await assert.rejects(destinoRclone(`prueba:${cubo.nombre}/otro`, cubo.entorno(cubo.servidor), { sello: null }).subir(basura, "x.dump.age"));
      await assert.rejects(con(cubo.recuperacion).subir(basura, "2026/01/01/x.dump.age"));

      // Después de todo eso, nada cambió: las dos versiones, y la retención con candado.
      assert.deepEqual((await cubo.versiones(manifiesto.objeto)).map((v) => v.id), versiones.map((v) => v.id));
      assert.match(await cubo.mc(cubo.raiz, "retention", "info", "--version-id", original.id, objeto), /COMPLIANCE/);
      assert.match(await cubo.mc(cubo.raiz, "retention", "info", "--default", `c/${cubo.nombre}`), /COMPLIANCE/);

      // Lo que hay ahora bajo ese nombre no es el respaldo: no se restaura…
      await assert.rejects(traer(con(cubo.recuperacion), carpeta), /no coincide con su manifiesto/i);
      // …pero el almacenamiento se puede ver como estaba antes del daño, y ahí el respaldo sigue entero.
      const lectora = await cubo.credencial({ "*": ["s3:GetObject", "s3:GetObjectVersion"] }, ["s3:ListBucket", "s3:ListBucketVersions"]);
      const comoEstaba = destinoRclone(cubo.destino, cubo.entorno(lectora), { sello: claveDeSello(llave.privada), comoEstaba: antesDelDano });
      const traido = await traer(comoEstaba, carpeta);
      assert.equal(traido.manifiesto.sha256, manifiesto.sha256);
      assert.ok(llave.privada);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));

test("un respaldo que no se pudo volver a leer igual no existe: ni manifiesto ni señal de éxito", () =>
  conTodo(async ({ cubo, con, vigia, correr }) => {
    // 1. Se altera entre la subida y la comprobación, conservando su tamaño.
    const real = con(cubo.servidor);
    const alterado: Destino = {
      ...real,
      subir: async (archivo, nombre) => {
        await real.subir(archivo, nombre);
        if (!nombre.endsWith(".dump.age")) return;
        const bytes = await cubo.leer(nombre);
        bytes[bytes.length >> 1] = bytes[bytes.length >> 1]! ^ 0xff;
        await cubo.poner(nombre, bytes);
      },
    };
    await assert.rejects(correr({ destino: alterado }), /comprobar.*no coincide/is);
    assert.deepEqual(await respaldos(con(cubo.recuperacion)), []);
    assert.deepEqual(vigia.senales.map((s) => s.que), ["inicio", "fallo"]);
    assert.match(vigia.senales[1]!.cuerpo, /comprobar/i);
    assert.deepEqual(await restos(), []);

    // 2. La credencial puede subir pero no leer: no hay cómo comprobar, así que no hay respaldo.
    vigia.senales.length = 0;
    const ciega = await cubo.credencial({ "*": ["s3:PutObject"] }, []);
    await assert.rejects(correr({ destino: con(ciega) }), /comprobar/i);
    assert.deepEqual(await respaldos(con(cubo.recuperacion)), []);
    assert.deepEqual(vigia.senales.map((s) => s.que), ["inicio", "fallo"]);
    assert.deepEqual(await restos(), []);

    // Y después de los dos fracasos, uno bueno sí queda.
    vigia.senales.length = 0;
    const { manifiesto } = await correr();
    assert.deepEqual((await respaldos(con(cubo.recuperacion))).map((r) => r.objeto), [manifiesto.objeto]);
    assert.deepEqual(vigia.senales.map((s) => s.que), ["inicio", "bien"]);
  }));

test("el fallo de cualquier paso detiene la corrida: sin manifiesto, sin señal de éxito y sin restos en la máquina", () =>
  conTodo(async ({ p, cubo, con, vigia, correr }) => {
    // Puede conectarse y ver qué versión del esquema hay, pero no leer las tablas: el que falla es pg_dump.
    const sinPermiso = await administradorConClave(urlDe(p.base), { administra: false });
    await p.db.query(`GRANT USAGE ON SCHEMA public TO ${new URL(sinPermiso.url).username}`);
    await p.db.query(`GRANT SELECT ON migracion TO ${new URL(sinPermiso.url).username}`);
    const soloElVolcado = await cubo.credencial({ "*.dump.age": ["s3:PutObject", "s3:GetObject"], "*": ["s3:GetObject"] });
    const casos: { paso: RegExp; cambios: Parameters<typeof correr>[0]; avisaInicio: boolean; quedaObjeto?: boolean }[] = [
      // La base no contesta: ni siquiera se pudo empezar, pero el vigilante se entera.
      { paso: /conectar/i, cambios: { base: urlDe("no_existe_esta_base") }, avisaInicio: false },
      // El volcado: quien se conecta no puede leer las tablas. El error es el de pg_dump, no uno anterior.
      { paso: /volcar la base: [^]*pg_dump: error/i, cambios: { base: sinPermiso.url }, avisaInicio: true },
      // El cifrado: una llave con la forma correcta que no es una llave.
      { paso: /cifrar/i, cambios: { llavePublica: "age1" + "q".repeat(58) }, avisaInicio: true },
      // La subida: una credencial que no puede escribir.
      { paso: /subir/i, cambios: { destino: con(cubo.recuperacion) }, avisaInicio: true },
      // El manifiesto: el respaldo sube y se comprueba, pero su manifiesto no entra.
      { paso: /manifiesto/i, cambios: { destino: con(soloElVolcado) }, avisaInicio: true, quedaObjeto: true },
    ];
    try {
      for (const caso of casos) {
        vigia.senales.length = 0;
        await assert.rejects(correr(caso.cambios), caso.paso, `debió fallar al ${caso.paso}`);
        assert.deepEqual(vigia.senales.map((s) => s.que), caso.avisaInicio ? ["inicio", "fallo"] : ["fallo"], String(caso.paso));
        // Al vigilante, que es un servicio ajeno, le llega el paso y nada de lo que dijo cada programa.
        assert.match(vigia.senales.at(-1)!.cuerpo, /^El respaldo falló al (conectar|volcar|cifrar|subir)[a-záéíóú ]*$/);
        assert.deepEqual(await respaldos(con(cubo.recuperacion)), [], `quedó un respaldo tras fallar al ${caso.paso}`);
        assert.deepEqual(await restos(), []);
        // Un objeto sin manifiesto es una corrida que no terminó: está en el almacenamiento, pero no cuenta como respaldo.
        const objetos = (await con(cubo.recuperacion).listar()).map((e) => e.nombre);
        assert.equal(objetos.some((n) => n.endsWith(".dump.age")), caso.quedaObjeto === true, String(caso.paso));
        assert.ok(!objetos.some((n) => n.endsWith(".manifiesto.json")));
      }
    } finally {
      await sinPermiso.quitar();
    }
  }));

/** Retiene cualquier volcado de esa base: toma en exclusiva una tabla que el trabajo del patio no toca. */
async function retenerVolcados(base: string): Promise<{ volcadoDetenido: () => Promise<void>; soltar: () => Promise<void>; vigia: pg.Client }> {
  const barrera = new pg.Client({ connectionString: urlDe(base) });
  const vigia = new pg.Client({ connectionString: urlDe(base) });
  await barrera.connect();
  await vigia.connect();
  await barrera.query("BEGIN");
  await barrera.query("LOCK TABLE restauracion IN ACCESS EXCLUSIVE MODE");
  let suelto = false;
  return {
    vigia,
    volcadoDetenido: async () => {
      for (let k = 0; k < 200; k += 1) {
        const r = await vigia.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND application_name LIKE 'pg_dump%' AND wait_event_type = 'Lock'", [base],
        );
        if (r.rows.length > 0) return;
        await new Promise((sigue) => setTimeout(sigue, 25));
      }
      throw new Error("el volcado nunca quedó detenido en la barrera");
    },
    soltar: async () => {
      if (suelto) return;
      suelto = true;
      await barrera.query("COMMIT");
      await barrera.end();
      await vigia.end();
    },
  };
}

test("un respaldo a la vez: el manual y el programado se esperan, y los dos quedan", () =>
  conTodo(async ({ p, cubo, con, vigia, correr }) => {
    const barrera = await retenerVolcados(p.base);
    try {
      const primero = correr();
      await barrera.volcadoDetenido();
      // El segundo arranca mientras el primero sigue a medias: debe quedarse esperando su turno, sin empezar a volcar.
      const segundo = correr();
      let esperando = 0;
      for (let k = 0; k < 200 && esperando === 0; k += 1) {
        esperando = (await barrera.vigia.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory'", [p.base],
        )).rows.length;
        if (esperando === 0) await new Promise((sigue) => setTimeout(sigue, 25));
      }
      assert.equal(esperando, 1, "el segundo respaldo no quedó esperando al primero");
      assert.equal(await cuantos(barrera.vigia, "pg_stat_activity", "datname = $1 AND application_name LIKE 'pg_dump%'", [p.base]), 1);
      assert.deepEqual(vigia.senales.map((s) => s.que), ["inicio"], "el segundo no debe avisar de su inicio antes de tener el turno");

      await barrera.soltar();
      const [a, b] = await Promise.all([primero, segundo]);
      // Uno después del otro, completos los dos.
      assert.deepEqual(vigia.senales.map((s) => [s.que, s.corrida]), [
        ["inicio", a.manifiesto.corrida], ["bien", a.manifiesto.corrida], ["inicio", b.manifiesto.corrida], ["bien", b.manifiesto.corrida],
      ]);
      assert.ok(new Date(b.manifiesto.instantanea) > new Date(a.manifiesto.instantanea));
      assert.deepEqual((await respaldos(con(cubo.recuperacion))).map((r) => r.objeto).sort(), [a.manifiesto.objeto, b.manifiesto.objeto].sort());
    } finally {
      await barrera.soltar();
    }
  }));

test("el respaldo es una instantánea: lo que el patio escribe mientras se vuelca no entra a medias, y su momento es anterior a todo eso", () =>
  conTodo(async ({ p, cubo, llave, con, correr }) => {
    const carton = p.e.mat["Cartón"];
    const antes = await retrato(p.db);
    const barrera = await retenerVolcados(p.base);
    try {
      const corriendo = correr();
      await barrera.volcadoDetenido();
      // El volcado ya tomó su instantánea y está detenido. El patio sigue trabajando.
      const primeraEscritura = (await una(p.db, "SELECT clock_timestamp() AS t")).t as Date;
      const durante = [await compraDe(p.db, p.e, carton, 11), await compraDe(p.db, p.e, carton, 12)];
      await barrera.soltar();
      const { manifiesto } = await corriendo;
      assert.ok(new Date(manifiesto.instantanea) <= primeraEscritura, "el momento del respaldo debe ser anterior a lo que no trae");

      await conDestino(async (destino) => {
        await restaurarDelDestino({
          destino: con(cubo.recuperacion), servidor: LIMPIO, base: destino, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba",
        });
        const restaurada = new pg.Client({ connectionString: urlEn(LIMPIO, destino) });
        await restaurada.connect();
        try {
          // Ni rastro de lo que se escribió durante el volcado: ni la operación ni sus movimientos sueltos.
          assert.deepEqual(await retrato(restaurada), antes);
          assert.equal(await cuantos(restaurada, "operacion", "id = ANY($1)", [durante]), 0);
        } finally {
          await restaurada.end();
        }
      });
    } finally {
      await barrera.soltar();
    }
  }));

test("una corrida que se queda detenida vence su plazo y el vigilante recibe el fallo; si el vigilante no contesta, el respaldo se toma igual", () =>
  conTodo(async ({ p, cubo, con, vigia, correr, dicho }) => {
    const barrera = await retenerVolcados(p.base);
    try {
      const detenida = correr({ plazos: { volcado: 400 } });
      await barrera.volcadoDetenido();
      await assert.rejects(detenida, /volcar.*no terminó/is);
      assert.deepEqual(vigia.senales.map((s) => s.que), ["inicio", "fallo"]);
      assert.deepEqual(await respaldos(con(cubo.recuperacion)), []);
      assert.deepEqual(await restos(), []);
      // Y no deja al volcado corriendo por su cuenta.
      assert.equal(await cuantos(barrera.vigia, "pg_stat_activity", "datname = $1 AND application_name LIKE 'pg_dump%'", [p.base]), 0);
    } finally {
      await barrera.soltar();
    }

    // Un vigilante que no contesta no impide respaldar: se toma, y se dice que no se pudo avisar.
    const { manifiesto, avisado } = await correr({ vigia: vigiaHttp("http://127.0.0.1:9/ping/nadie", 500) });
    assert.equal(avisado, false);
    assert.deepEqual((await respaldos(con(cubo.recuperacion))).map((r) => r.objeto), [manifiesto.objeto]);
    assert.match(dicho.join("\n"), /no se pudo avisar/i);
  }));

test("ninguna clave viaja en los argumentos de los programas ni en lo que la corrida dice, ni queda en el manifiesto", () =>
  conTodo(async ({ p, cubo, correr, dicho }) => {
    const administrador = await administradorConClave(urlDe(p.base));
    const barrera = await retenerVolcados(p.base);
    const vistos: Proceso[] = [];
    let mirando = true;
    const mirar = (async () => {
      while (mirando) {
        vistos.push(...(await procesos("rclone")), ...(await procesos("age")));
        await new Promise((sigue) => setImmediate(sigue));
      }
    })();
    try {
      const corriendo = correr({ base: administrador.url });
      await barrera.volcadoDetenido();
      const delVolcado = await procesos("pg_dump");
      await barrera.soltar();
      const { manifiesto } = await corriendo;
      mirando = false;
      await mirar;

      assert.equal(delVolcado.length, 1, "el volcado debe haberse visto vivo, detenido en la barrera");
      assert.ok(!delVolcado[0]!.argumentos.includes(administrador.clave), "la clave de la base está en los argumentos de pg_dump");
      assert.ok(vistos.some((v) => v.argumentos.startsWith("rclone\0")), "no se alcanzó a ver a rclone corriendo");
      for (const secreto of [administrador.clave, cubo.servidor.clave]) {
        assert.ok(!vistos.some((v) => v.argumentos.includes(secreto)), "una clave viaja en los argumentos de un programa");
        assert.ok(!dicho.join("\n").includes(secreto), "la corrida dijo una clave");
        assert.ok(!JSON.stringify(manifiesto).includes(secreto));
        assert.ok(!(await cubo.leer(manifiesto.objeto.replace(/\.dump\.age$/, ".manifiesto.json"))).toString().includes(secreto));
      }
    } finally {
      mirando = false;
      await mirar;
      await barrera.soltar();
      await administrador.quitar();
    }
  }));

test("se restaura el último respaldo, o el que se pida por su nombre", () =>
  conTodo(async ({ p, cubo, llave, con, correr }) => {
    const carton = p.e.mat["Cartón"];
    const primero = await correr();
    const retratoDelPrimero = await retrato(p.db);
    // Sin esperar entre uno y otro: pueden caer en el mismo segundo, y «el último» sigue siendo el segundo.
    await compraDe(p.db, p.e, carton, 33);
    const segundo = await correr();
    const retratoDelSegundo = await retrato(p.db);
    const recuperacion = con(cubo.recuperacion);
    assert.deepEqual((await respaldos(recuperacion)).map((r) => r.objeto), [primero.manifiesto.objeto, segundo.manifiesto.objeto]);

    const restaurado = async (cual?: string) =>
      conDestino(async (destino) => {
        const r = await restaurarDelDestino({
          destino: recuperacion, servidor: LIMPIO, base: destino, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba",
          ...(cual ? { cual } : {}),
        });
        const restaurada = new pg.Client({ connectionString: urlEn(LIMPIO, destino) });
        await restaurada.connect();
        try {
          return { objeto: r.objeto, retrato: await retrato(restaurada) };
        } finally {
          await restaurada.end();
        }
      });
    assert.deepEqual(await restaurado(), { objeto: segundo.manifiesto.objeto, retrato: retratoDelSegundo });
    assert.deepEqual(await restaurado(primero.manifiesto.objeto), { objeto: primero.manifiesto.objeto, retrato: retratoDelPrimero });
    await assert.rejects(restaurado("2020/01/01/20200101T000000000Z-00000000-0000-0000-0000-000000000000.dump.age"), /no hay.*respaldo/i);
  }));

// ── el sello: quién tomó el respaldo ───────────────────────────────────────
// Lo encontró Codex en su décima revisión (docs/revisiones/2026-10-09-codex-decima-verificacion-c.md):
// cifrar para la llave pública no dice quién cifró, y una huella que viaja junto al archivo la
// rehace cualquiera. Quien pudiera escribir en el almacenamiento sustituía un respaldo y su
// manifiesto, y al restaurar se ejecutaba lo que trajera.

test("quien puede escribir en el almacenamiento sustituye un respaldo y su manifiesto, con el tamaño y la huella rehechos: no se restaura, y ni siquiera se descifra", () =>
  conTodo(async ({ cubo, llave, con, correr }) => {
    const bueno = await correr();
    const carpeta = await mkdtemp(join(tmpdir(), "sustituido-"));
    try {
      // Lo suyo, cifrado con la llave pública —que el manifiesto dice—, en el lugar del respaldo…
      const [claro, suyo] = [join(carpeta, "suyo.sql"), join(carpeta, "suyo.dump.age")];
      await writeFile(claro, "CREATE FUNCTION lo_que_quiera() RETURNS void LANGUAGE sql AS 'SELECT 1';\n".repeat(50));
      await programa("age", ["-r", bueno.manifiesto.llavePublica, "-o", suyo, claro]);
      const cifrado = await readFile(suyo);
      await cubo.poner(bueno.manifiesto.objeto, cifrado);
      // …y el manifiesto rehecho para que todo coincida: lo demás, como estaba.
      const rehecho = { ...bueno.manifiesto, bytes: cifrado.length, sha256: sha256(cifrado) };
      await cubo.poner(nombreDeManifiesto(bueno.manifiesto.objeto), Buffer.from(JSON.stringify(rehecho, null, 2) + "\n"));

      const recuperacion = con(cubo.recuperacion);
      for (const cual of [undefined, bueno.manifiesto.objeto]) {
        const dicho: string[] = [];
        await conDestino(async (destino, admin) => {
          await assert.rejects(
            restaurarDelDestino({
              destino: recuperacion, servidor: LIMPIO, base: destino, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba",
              decir: (linea) => dicho.push(linea), ...(cual ? { cual } : {}),
            }),
            /sello/i,
          );
          assert.deepEqual(await basesCon(admin, destino), [], "quedó una base");
        });
        assert.ok(!dicho.some((linea) => /descifr|restaurando/i.test(linea)), `se llegó a tocar lo sustituido: ${dicho.join(" | ")}`);
      }
      // Tampoco cuenta como respaldo reciente para el servidor.
      assert.equal(await ultimoUtilizable(con(cubo.servidor)), null);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));

test("la clave del sello sale de la llave privada: siempre la misma, otra con otra llave, igual con el archivo entero o con su renglón solo; y lo que no es una llave no da nada", async () => {
  const [a, b] = [await llaves(), await llaves()];
  const clave = claveDeSello(a.privada);
  assert.match(clave, /^[0-9a-f]{64}$/);
  assert.equal(claveDeSello(a.privada), clave);
  assert.notEqual(claveDeSello(b.privada), clave);
  const renglon = /AGE-SECRET-KEY-1[0-9A-Z]+/.exec(a.privada)![0];
  assert.equal(claveDeSello(renglon), clave);
  assert.equal(claveDeSello(`  ${renglon}\r\n`), clave);
  for (const mala of ["", a.publica, "AGE-SECRET-KEY-1", "no es una llave", renglon.toLowerCase()]) assert.throws(() => claveDeSello(mala), /llave privada de age/, mala.slice(0, 20));
  // La receta para sacarla sin este programa —la que dicen la guía y el .env— da lo mismo.
  const receta = "grep -o 'AGE-SECRET-KEY-1[0-9A-Z]*' | head -1 | tr -d '\\n' | openssl dgst -sha256 -hmac 'feruga: sello de los respaldos, v1' -r | cut -d' ' -f1";
  const conOpenssl = spawnSync("sh", ["-c", receta], { input: a.privada, encoding: "utf8" });
  assert.equal(conOpenssl.status, 0, conOpenssl.stderr);
  assert.equal(conOpenssl.stdout.trim(), clave);
  // Y el programa: la llave entra por la entrada estándar, y sale la clave y nada más.
  const hecho = await consola("operacion/sello.ts", [], {}, a.privada);
  assert.deepEqual({ codigo: hecho.codigo, salida: hecho.salida.trim() }, { codigo: 0, salida: clave });
  const sinLlave = await consola("operacion/sello.ts", [], {}, "esto no es una llave\n");
  assert.equal(sinLlave.codigo, 1);
  assert.match(sinLlave.queja, /llave privada de age/);
  assert.equal((await consola("operacion/sello.ts", ["de más"], {}, a.privada)).codigo, 2);
});

test("el sello cubre todo lo que el manifiesto dice: cambiarle cualquier cosa después de sellado, quitarle el sello o ponerle el de otra clave, y ya no acredita el respaldo", () => {
  const objeto = nombreDeObjeto(new Date("2026-10-04T12:00:00.000Z"), "11111111-1111-4111-8111-111111111111");
  const de = { objeto, bytes: 1000, momento: new Date("2026-10-04T12:00:00.000Z"), preciso: true };
  const bueno = JSON.parse(manifiestoDePrueba(objeto, { publicacion: "20261006T211000Z-fedcba987654-000002" })) as Manifiesto;
  assert.deepEqual(leerManifiesto(JSON.stringify(bueno), de, SELLO_DE_PRUEBA), bueno);
  const sinSello = /no lleva el sello de este negocio/;
  // Cada dato, cambiado por otro que por sí solo sería válido.
  const cambios: Array<Partial<Manifiesto>> = [
    { sha256: "b".repeat(64) }, { pgDump: "pg_dump (PostgreSQL) 16.1" }, { llavePublica: "age1" + "p".repeat(58) }, { esquema: "0021_vida_sin_reconectar.sql" },
    { publicacion: "20261006T211000Z-aaaaaaaaaaaa-000009" },
  ];
  for (const cambio of cambios) assert.throws(() => leerManifiesto(JSON.stringify({ ...bueno, ...cambio }), de, SELLO_DE_PRUEBA), sinSello, JSON.stringify(cambio));
  const { publicacion: _publicacion, ...sinPublicacion } = bueno;
  assert.throws(() => leerManifiesto(JSON.stringify(sinPublicacion), de, SELLO_DE_PRUEBA), sinSello, "sin la publicación");
  // El tamaño tiene que ser el del objeto que hay: si alguien cambia los dos, lo delata el sello.
  assert.throws(() => leerManifiesto(JSON.stringify({ ...bueno, bytes: 2000 }), { ...de, bytes: 2000 }, SELLO_DE_PRUEBA), sinSello);
  // Sin sello, con uno que no tiene su forma, con el de otra clave; y leído con otra clave.
  for (const sello of [undefined, "", 7, "x".repeat(64), "5E".repeat(32), selloDe(bueno, "ab".repeat(32))]) {
    assert.throws(() => leerManifiesto(JSON.stringify({ ...bueno, sello }), de, SELLO_DE_PRUEBA), sinSello, String(sello));
  }
  assert.throws(() => leerManifiesto(JSON.stringify(bueno), de, "ab".repeat(32)), sinSello);
  // Lo que alguien le agregue no pasa de leerlo: sale lo que se conoce, y nada más.
  assert.deepEqual(leerManifiesto(JSON.stringify({ ...bueno, deMas: "rm -rf /" }), de, SELLO_DE_PRUEBA), bueno);
  // Y el sello es de ese manifiesto: el de otro respaldo no le sirve.
  const otro = nombreDeObjeto(new Date("2026-10-04T13:00:00.000Z"), "22222222-2222-4222-8222-222222222222");
  const delOtro = JSON.parse(manifiestoDePrueba(otro)) as Manifiesto;
  assert.notEqual(delOtro.sello, bueno.sello);
  assert.throws(() => leerManifiesto(JSON.stringify({ ...bueno, sello: delOtro.sello }), de, SELLO_DE_PRUEBA), sinSello);
});

test("un destino sin sello sirve para ver qué hay, pero no acredita nada: ni cuál es el último, ni traer uno, ni tomar un respaldo", () =>
  conTodo(async ({ cubo, correr }) => {
    await correr();
    const soloVer = destinoRclone(cubo.destino, cubo.entorno(cubo.recuperacion), { sello: null });
    assert.equal((await respaldos(soloVer)).length, 1);
    const carpeta = await mkdtemp(join(tmpdir(), "sin-sello-"));
    try {
      await assert.rejects(ultimoUtilizable(soloVer), /Sin el sello de los respaldos/);
      await assert.rejects(traer(soloVer, carpeta), /Sin el sello de los respaldos/);
      await assert.rejects(correr({ destino: destinoRclone(cubo.destino, cubo.entorno(cubo.servidor), { sello: null }) }), /Sin el sello de los respaldos/);
      assert.equal((await respaldos(soloVer)).length, 1, "se tomó un respaldo sin sello");
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
    assert.throws(() => destinoRclone(cubo.destino, {}, { sello: "no-es-un-sello" }), /sello de los respaldos no tiene su forma/);
  }));

test("restaurar comprueba el sello con la clave que sale de la llave con que descifra, y con ninguna otra; con la llave de otro, estos respaldos no son suyos", () =>
  conTodo(async ({ cubo, llave, correr }) => {
    await correr();
    const pedir = (destino: Destino, privada: string) =>
      conDestino(async (base, admin) => {
        const dicho: string[] = [];
        const r = await restaurarDelDestino({ destino, servidor: LIMPIO, base, llave: privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba", decir: (linea) => dicho.push(linea) })
          .then(() => "restauró", (e: Error) => e.message);
        assert.deepEqual(await basesCon(admin, base), [], "quedó una base");
        return { r, dicho };
      });
    // Un destino armado con otra clave que la de la llave: no se baja nada.
    const conOtroSello = await pedir(destinoRclone(cubo.destino, cubo.entorno(cubo.recuperacion), { sello: SELLO_DE_PRUEBA }), llave.privada);
    assert.match(conOtroSello.r, /no es el de esta llave privada/);
    assert.deepEqual(conOtroSello.dicho, []);
    // La llave de otro, con su propio sello: para ella, aquí no hay ningún respaldo que valga.
    const otra = await llaves();
    const delOtro = await pedir(destinoRclone(cubo.destino, cubo.entorno(cubo.recuperacion), { sello: claveDeSello(otra.privada) }), otra.privada);
    assert.match(delOtro.r, /sin el sello de este negocio/);
    assert.ok(!delOtro.dicho.some((linea) => /descifr/i.test(linea)), delOtro.dicho.join(" | "));
  }));

// ── por la consola, como se usa ────────────────────────────────────────────

/** Corre uno de los programas de operación como proceso aparte, con ese entorno. */
function consola(guion: string, args: string[], entorno: Record<string, string>, entrada = ""): Promise<{ codigo: number | null; salida: string; queja: string }> {
  return new Promise((listo, mal) => {
    const hijo = spawn(process.execPath, [guion, ...args], { env: { ...process.env, ...entorno }, stdio: ["pipe", "pipe", "pipe"] });
    let salida = "";
    let queja = "";
    hijo.stdout.on("data", (trozo: Buffer) => (salida += trozo.toString()));
    hijo.stderr.on("data", (trozo: Buffer) => (queja += trozo.toString()));
    hijo.on("error", mal);
    hijo.on("close", (codigo) => listo({ codigo, salida, queja }));
    hijo.stdin.end(entrada);
  });
}

test("el respaldo dice qué publicación corría cuando se tomó: con eso se sabe, el día que haga falta, con qué imágenes se restaura", () =>
  conTodo(async ({ correr, con, cubo }) => {
    const publicacion = "20261006T211000Z-fedcba987654-000002";
    const { manifiesto } = await correr({ publicacion });
    assert.equal(manifiesto.publicacion, publicacion);
    // Y así queda en el almacenamiento: lo lee quien restaura.
    assert.equal((await ultimoUtilizable(con(cubo.recuperacion)))?.manifiesto.publicacion, publicacion);
    // Sin publicación —en desarrollo— el manifiesto no la nombra, y sigue valiendo.
    const sinElla = await correr();
    assert.equal("publicacion" in sinElla.manifiesto, false);
    assert.equal((await ultimoUtilizable(con(cubo.recuperacion)))?.manifiesto.objeto, sinElla.manifiesto.objeto);
  }));

test("por la consola: la publicación que corre le llega al respaldo por su entorno; lo que no es una publicación no se anota, y el respaldo vale igual", () =>
  conTodo(async ({ p, cubo, llave, con }) => {
    const delServidor = {
      ...cubo.entorno(cubo.servidor), RESPALDO_DESTINO: cubo.destino, DATABASE_URL: urlDe(p.base), RESPALDO_LLAVE_PUBLICA: llave.publica, RESPALDO_SELLO: claveDeSello(llave.privada), RESPALDO_VIGIA_URL: "",
    };
    const publicacion = "20261006T211000Z-fedcba987654-000002";
    const dice = async (version: string): Promise<string | undefined> => {
      const hecho = await consola("operacion/respaldar.ts", ["ahora"], { ...delServidor, VERSION: version });
      assert.equal(hecho.codigo, 0, hecho.queja);
      const util = await ultimoUtilizable(con(cubo.recuperacion));
      assert.ok(util && hecho.salida.includes(util.manifiesto.objeto), "el último respaldo utilizable no es el que se acaba de tomar");
      return util.manifiesto.publicacion;
    };
    assert.equal(await dice(publicacion), publicacion);
    assert.equal(await dice("desarrollo"), undefined);
    assert.equal(await dice(""), undefined);
  }));

test("un manifiesto que nombra su publicación con algo que no es una publicación no acredita el respaldo", () => {
  const objeto = nombreDeObjeto(new Date("2026-10-04T12:00:00.000Z"), "11111111-1111-4111-8111-111111111111");
  const de = { objeto, bytes: 1000, momento: new Date("2026-10-04T12:00:00.000Z"), preciso: true };
  const con = (publicacion: unknown): string => manifiestoDePrueba(objeto, { publicacion: publicacion as string });
  assert.equal(leerManifiesto(con("20261006T211000Z-fedcba987654-000002"), de, SELLO_DE_PRUEBA).publicacion, "20261006T211000Z-fedcba987654-000002");
  for (const rara of ["", "la de ayer", 7, null, "../../otra"]) {
    assert.throws(() => leerManifiesto(con(rara), de, SELLO_DE_PRUEBA), /no es de ese respaldo/, JSON.stringify(rara));
  }
});

test("al servicio de respaldo se le pide que se detenga: si tiene un respaldo a medias lo termina, y entonces sale; si no tiene ninguno, sale enseguida", () =>
  conTodo(async ({ p, cubo, llave, vigia, con }) => {
    const entorno = {
      ...process.env, ...cubo.entorno(cubo.servidor), RESPALDO_DESTINO: cubo.destino, DATABASE_URL: urlDe(p.base),
      RESPALDO_LLAVE_PUBLICA: llave.publica, RESPALDO_SELLO: claveDeSello(llave.privada), RESPALDO_VIGIA_URL: vigia.url, RESPALDO_HORARIO: "03:00",
    };
    const arrancar = () => {
      const hijo = spawn(process.execPath, ["operacion/respaldar.ts", "servicio"], { env: entorno, stdio: ["ignore", "pipe", "pipe"] });
      const estado: { codigo?: number | null; dicho: string } = { dicho: "" };
      hijo.stdout.on("data", (trozo: Buffer) => (estado.dicho += trozo.toString()));
      hijo.stderr.on("data", (trozo: Buffer) => (estado.dicho += trozo.toString()));
      const fin = new Promise<number | null>((listo) => hijo.on("close", (codigo) => { estado.codigo = codigo; listo(codigo); }));
      return { hijo, estado, fin };
    };
    const enUnRato = (ms: number) => new Promise((sigue) => setTimeout(sigue, ms));

    // Sin ningún respaldo en el destino, toma uno al arrancar. Aquí se queda a medias: el volcado, detenido.
    const barrera = await retenerVolcados(p.base);
    const conUno = arrancar();
    try {
      await barrera.volcadoDetenido();
      conUno.hijo.kill("SIGTERM");
      await enUnRato(1500);
      assert.equal(conUno.estado.codigo, undefined, `se detuvo con un respaldo a medias: ${conUno.estado.dicho}`);
      assert.deepEqual(await respaldos(con(cubo.recuperacion)), []);
      await barrera.soltar();
      assert.equal(await conUno.fin, 0, conUno.estado.dicho);
      // Lo terminó: está en el destino, y el vigilante supo del final.
      assert.equal((await respaldos(con(cubo.recuperacion))).length, 1);
      assert.deepEqual(vigia.senales.map((s) => s.que), ["inicio", "bien"]);
    } finally {
      conUno.hijo.kill("SIGKILL");
      await barrera.soltar();
    }

    // Ya con el respaldo de hoy, el servicio duerme hasta su hora. Al pedirle que se detenga, sale enseguida y no toma otro.
    const dormido = arrancar();
    try {
      await enUnRato(2500);
      assert.equal(dormido.estado.codigo, undefined, `el servicio no se quedó esperando su hora: ${dormido.estado.dicho}`);
      const pedido = Date.now();
      dormido.hijo.kill("SIGTERM");
      assert.equal(await dormido.fin, 0, dormido.estado.dicho);
      assert.ok(Date.now() - pedido < 2000, "tardó en salir sin tener nada a medias");
      assert.equal((await respaldos(con(cubo.recuperacion))).length, 1);
    } finally {
      dormido.hijo.kill("SIGKILL");
    }
  }));

test("por la consola: respaldar ahora dice, en un renglón aparte, si el vigilante se enteró; que no se entere no quita que el respaldo vale", () =>
  conTodo(async ({ p, cubo, llave, vigia }) => {
    const delServidor = {
      ...cubo.entorno(cubo.servidor), RESPALDO_DESTINO: cubo.destino, DATABASE_URL: urlDe(p.base), RESPALDO_LLAVE_PUBLICA: llave.publica, RESPALDO_SELLO: claveDeSello(llave.privada),
    };
    const dicho = async (entorno: Record<string, string>): Promise<{ respaldo: string | undefined; vigia: string | undefined }> => {
      const hecho = await consola("operacion/respaldar.ts", ["ahora"], { ...delServidor, ...entorno });
      assert.equal(hecho.codigo, 0, hecho.queja);
      return { respaldo: /^respaldo: (\S+\.dump\.age)$/m.exec(hecho.salida)?.[1], vigia: /^vigia: (.+)$/m.exec(hecho.salida)?.[1] };
    };
    const avisado = await dicho({ RESPALDO_VIGIA_URL: vigia.url });
    assert.ok(avisado.respaldo);
    assert.equal(avisado.vigia, "avisado");
    // El vigilante no contesta: el respaldo queda hecho y con su nombre, y se dice que no se enteró.
    const sinAvisar = await dicho({ RESPALDO_VIGIA_URL: "http://127.0.0.1:1/nadie" });
    assert.ok(sinAvisar.respaldo && sinAvisar.respaldo !== avisado.respaldo);
    assert.equal(sinAvisar.vigia, "sin avisar");
    // Sin vigilante (solo en desarrollo se puede), tampoco hay a quién avisar.
    assert.equal((await dicho({ RESPALDO_VIGIA_URL: "" })).vigia, "no hay");
    assert.equal((await respaldos(destinoRclone(cubo.destino, cubo.entorno(cubo.servidor), { sello: null }))).length, 3);
  }));

test("por la consola: respaldar ahora, ver la lista, y un ensayo de restauración desde el almacenamiento que avisa a su vigilante", () =>
  conTodo(async ({ p, cubo, llave, vigia }) => {
    const delServidor = {
      ...cubo.entorno(cubo.servidor), RESPALDO_DESTINO: cubo.destino, DATABASE_URL: urlDe(p.base),
      RESPALDO_LLAVE_PUBLICA: llave.publica, RESPALDO_SELLO: claveDeSello(llave.privada), RESPALDO_VIGIA_URL: vigia.url,
    };
    const hecho = await consola("operacion/respaldar.ts", ["ahora"], delServidor);
    assert.equal(hecho.codigo, 0, hecho.queja);
    assert.deepEqual(vigia.senales.map((s) => s.que), ["inicio", "bien"]);

    // En otra máquina no hay base ni llave pública: para ver la lista basta el destino y la credencial de recuperación.
    const delDueno = { ...cubo.entorno(cubo.recuperacion), RESPALDO_DESTINO: cubo.destino };
    const lista = await consola("operacion/respaldar.ts", ["lista"], { ...delDueno, DATABASE_URL: "", RESPALDO_LLAVE_PUBLICA: "" });
    assert.equal(lista.codigo, 0, lista.queja);
    const objeto = /\S+\.dump\.age/.exec(lista.salida)?.[0];
    assert.ok(objeto, lista.salida);
    assert.match(lista.salida, /\b1 respaldo\b/);
    // Ver qué hay no pide el sello; decir cuál sirve, sí: sin él se dice que no se comprobó, y con él, cuál es.
    assert.match(lista.salida, /Cuál sirve no se comprobó: hace falta el sello/);
    const conSello = await consola("operacion/respaldar.ts", ["lista"], { ...delDueno, RESPALDO_SELLO: claveDeSello(llave.privada) });
    assert.match(conSello.salida, new RegExp(`El último con su manifiesto en orden: ${objeto.replaceAll(".", "\\.")}`));
    const conOtroSello = await consola("operacion/respaldar.ts", ["lista"], { ...delDueno, RESPALDO_SELLO: claveDeSello((await llaves()).privada) });
    assert.match(conOtroSello.salida, /Ninguno de los más nuevos tiene su manifiesto en orden/);
    assert.equal((await consola("operacion/respaldar.ts", ["lista"], { ...delDueno, RESPALDO_SELLO: "no-es-un-sello" })).codigo, 1);
    // Y sin el sello el servidor no toma un respaldo que después nadie podría acreditar.
    const sinSello = await consola("operacion/respaldar.ts", ["ahora"], { ...delServidor, RESPALDO_SELLO: "" });
    assert.equal(sinSello.codigo, 1);
    assert.match(sinSello.queja, /Falta RESPALDO_SELLO/);
    assert.match((await consola("operacion/respaldar.ts", ["lista"], delDueno)).salida, /\b1 respaldo\b/);

    await conDestino(async (destino, admin) => {
      const ensayo = vigia.url.replace("respaldo-de-prueba", "ensayo-de-prueba");
      const paraRestaurar = {
        ...delDueno, DATABASE_URL: urlEn(LIMPIO, destino), WEB_BD_USUARIO: "feruga_prueba", WEB_BD_CLAVE: "prueba", ENSAYO_VIGIA_URL: ensayo,
      };
      const delEnsayo = (): Senal[] => vigia.senales.filter((s) => s.camino.includes("ensayo-de-prueba"));

      // Con una llave que no es la suya: termina con error, no deja nada y no avisa de un ensayo que no hubo.
      const otra = await llaves();
      const mal = await consola("operacion/restaurar.ts", ["--remoto", "--ensayo"], paraRestaurar, otra.privada);
      assert.equal(mal.codigo, 1, mal.salida + mal.queja);
      assert.match(mal.queja, /no se restauró/i);
      assert.deepEqual(await basesCon(admin, destino), []);
      assert.deepEqual(delEnsayo(), []);

      // Pedir que avise sin decir a quién se rechaza antes de tocar nada.
      const sinVigia = await consola("operacion/restaurar.ts", ["--remoto", "--ensayo"], { ...paraRestaurar, ENSAYO_VIGIA_URL: "" }, llave.privada);
      assert.equal(sinVigia.codigo, 2, sinVigia.salida + sinVigia.queja);
      assert.deepEqual(await basesCon(admin, destino), []);

      // Con la del dueño: queda restaurado, y el vigilante del ensayo recibe su aviso.
      const bien = await consola("operacion/restaurar.ts", ["--remoto", "--ensayo"], paraRestaurar, llave.privada);
      assert.equal(bien.codigo, 0, bien.salida + bien.queja);
      assert.deepEqual(await basesCon(admin, destino), [destino]);
      assert.deepEqual(delEnsayo().map((s) => s.que), ["bien"]);
      assert.ok(bien.salida.includes(objeto));

      // Nada de lo que se dijo por la consola lleva una clave.
      const dicho = [hecho, lista, mal, bien].map((r) => r.salida + r.queja).join("\n");
      for (const secreto of [/AGE-SECRET-KEY-1[0-9A-Z]+/.exec(llave.privada)![0], cubo.servidor.clave, cubo.recuperacion.clave]) {
        assert.ok(!dicho.includes(secreto), "la consola dijo una clave");
      }
    });

    // Pedido por su nombre, y sobre una base que ya existe: se niega sin tocarla.
    await conDestino(async (destino, admin) => {
      const paraRestaurar = { ...delDueno, DATABASE_URL: urlEn(LIMPIO, destino), WEB_BD_USUARIO: "feruga_prueba", WEB_BD_CLAVE: "prueba" };
      const primero = await consola("operacion/restaurar.ts", [`--remoto=${objeto}`], paraRestaurar, llave.privada);
      assert.equal(primero.codigo, 0, primero.salida + primero.queja);
      const repetido = await consola("operacion/restaurar.ts", [`--remoto=${objeto}`], paraRestaurar, llave.privada);
      assert.equal(repetido.codigo, 1);
      assert.match(repetido.queja, /ya existe/i);
      assert.deepEqual(await basesCon(admin, destino), [destino]);
    });
  }));

// ── lo que encontró la revisión del 4 de octubre: cruces ───────────────────

test("el orden de los respaldos es el de su momento, al milisegundo; no el del identificador de la corrida", async () => {
  // Dos en el mismo segundo. El identificador del segundo ordena antes que el del primero.
  const a = nombreDeObjeto(new Date("2026-10-04T07:36:55.246Z"), "8e8c9c59-0000-4000-8000-000000000000");
  const b = nombreDeObjeto(new Date("2026-10-04T07:36:55.326Z"), "543b7615-0000-4000-8000-000000000000");
  const sinManifiesto = nombreDeObjeto(new Date("2026-10-04T07:36:55.900Z"), "00000000-0000-4000-8000-000000000000");
  const destino: Destino = {
    sello: null,
    subir: async () => {},
    bajar: async () => {},
    listar: async () => [b, nombreDeManifiesto(b), a, nombreDeManifiesto(a), sinManifiesto].map((nombre) => ({ nombre, bytes: 10 })),
  };
  const hay = await respaldos(destino);
  assert.deepEqual(hay.map((r) => r.objeto), [a, b]);
  assert.deepEqual(hay.map((r) => r.momento.toISOString()), ["2026-10-04T07:36:55.246Z", "2026-10-04T07:36:55.326Z"]);
});

test("un respaldo cuyo manifiesto quedó dañado no cuenta como reciente: el servicio toma otro, y restaurar dice cuál sí sirve", () =>
  conTodo(async ({ cubo, con, correr }) => {
    const bueno = await correr();
    // En la corrida siguiente el manifiesto se daña entre que sube y que se vuelve a leer.
    const real = con(cubo.servidor);
    const danado: Destino = {
      ...real,
      subir: async (archivo, nombre) => {
        await real.subir(archivo, nombre);
        if (nombre.endsWith(".manifiesto.json")) await cubo.poner(nombre, Buffer.from("{ esto no es un manifiesto"));
      },
    };
    await assert.rejects(correr({ destino: danado }), /manifiesto/i);

    const recuperacion = con(cubo.recuperacion);
    // Por su nombre aparecen los dos; utilizable, solo el primero.
    assert.equal((await respaldos(recuperacion)).length, 2);
    const util = await ultimoUtilizable(recuperacion);
    assert.equal(util?.manifiesto.objeto, bueno.manifiesto.objeto);
    assert.equal(util?.manifiesto.instantanea, bueno.manifiesto.instantanea);

    // El servicio, al arrancar una hora después, no da por tomado el respaldo fallido.
    const corridas: string[] = [];
    let ahora = new Date(bueno.manifiesto.instantanea).getTime() + 3_600_000;
    const hora = new Date(ahora - 60_000).toLocaleTimeString("en-GB", { timeZone: PATIO, hour: "2-digit", minute: "2-digit" });
    await servicio({
      horario: leerHorario(hora), zona: PATIO, reintento: 60_000,
      reloj: () => new Date(ahora),
      dormir: async (ms) => {
        ahora += ms;
      },
      ultimo: async () => {
        const u = await ultimoUtilizable(recuperacion);
        return u ? new Date(u.manifiesto.instantanea) : null;
      },
      corrida: async () => {
        corridas.push("corrió");
        return new Date(ahora);
      },
      seguir: () => corridas.length < 1 && ahora < new Date(bueno.manifiesto.instantanea).getTime() + 2 * 3_600_000,
    });
    assert.deepEqual(corridas, ["corrió"], "el servicio dio por bueno un respaldo con el manifiesto dañado");

    // Restaurar «el último» no baja en silencio a uno más viejo: dice que el último no sirve y cuál sí.
    const carpeta = await mkdtemp(join(tmpdir(), "danado-"));
    try {
      await assert.rejects(traer(recuperacion, carpeta), (e: Error) => /manifiesto/i.test(e.message) && e.message.includes(bueno.manifiesto.objeto));
      assert.equal((await traer(recuperacion, carpeta, bueno.manifiesto.objeto)).manifiesto.sha256, bueno.manifiesto.sha256);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));

/** Retiene a pg_dump justo antes de arrancar: un intermediario con su nombre, primero en el camino de búsqueda. */
async function retenerElArranqueDelVolcado(): Promise<{ detenido: () => Promise<void>; soltar: () => Promise<void>; quitar: () => Promise<void> }> {
  const carpeta = await mkdtemp(join(tmpdir(), "barrera-"));
  const verdadero = (await new Promise<string>((listo, mal) => {
    const hijo = spawn("sh", ["-c", "command -v pg_dump"], { stdio: ["ignore", "pipe", "ignore"] });
    let salida = "";
    hijo.stdout.on("data", (trozo: Buffer) => (salida += trozo.toString()));
    hijo.on("error", mal);
    hijo.on("close", () => listo(salida.trim()));
  }));
  const intermediario = join(carpeta, "pg_dump");
  await writeFile(intermediario, `#!/bin/sh
case "$*" in *--version*) exec ${verdadero} "$@";; esac
: > ${carpeta}/esperando
while [ ! -e ${carpeta}/sigue ]; do sleep 0.02; done
exec ${verdadero} "$@"
`);
  await chmod(intermediario, 0o755);
  const antes = process.env.PATH;
  process.env.PATH = `${carpeta}:${antes}`;
  return {
    detenido: async () => {
      for (let k = 0; k < 400; k += 1) {
        if (await stat(join(carpeta, "esperando")).catch(() => null)) return;
        await new Promise((sigue) => setTimeout(sigue, 25));
      }
      throw new Error("pg_dump nunca llegó a la barrera");
    },
    soltar: () => writeFile(join(carpeta, "sigue"), ""),
    quitar: async () => {
      process.env.PATH = antes;
      await rm(carpeta, { recursive: true, force: true });
    },
  };
}

test("el esquema que dice el manifiesto es el del volcado, aunque entre una migración justo antes de volcar", () =>
  conTodo(async ({ p, cubo, llave, con, correr }) => {
    const barrera = await retenerElArranqueDelVolcado();
    try {
      const corriendo = correr();
      await barrera.detenido();
      // El respaldo ya leyó qué versión del esquema hay, y pg_dump todavía no arranca. Entra una migración.
      await p.db.query("CREATE TABLE cosa_de_otra_version (id int)");
      await p.db.query("INSERT INTO migracion (archivo) VALUES ('0099_de_otra_version.sql')");
      await barrera.soltar();
      const { manifiesto } = await corriendo;

      // Lo que diga el manifiesto tiene que ser lo que trae el volcado. Se mira el volcado mismo.
      const carpeta = await mkdtemp(join(tmpdir(), "esquema-"));
      try {
        const { archivo } = await traer(con(cubo.recuperacion), carpeta);
        const claro = join(carpeta, "claro.dump");
        await new Promise<void>((listo, mal) => {
          const hijo = spawn("age", ["--decrypt", "--identity", "-", "--output", claro, archivo], { stdio: ["pipe", "ignore", "ignore"] });
          hijo.on("error", mal);
          hijo.on("close", (codigo) => (codigo === 0 ? listo() : mal(new Error("no descifró"))));
          hijo.stdin.end(llave.privada);
        });
        const contenido = await new Promise<string>((listo, mal) => {
          const hijo = spawn("pg_restore", ["--file", "-", claro], { stdio: ["ignore", "pipe", "ignore"] });
          let salida = "";
          hijo.stdout.on("data", (trozo: Buffer) => (salida += trozo.toString()));
          hijo.on("error", mal);
          hijo.on("close", () => listo(salida));
        });
        const traeLaNueva = contenido.includes("0099_de_otra_version.sql");
        assert.equal(manifiesto.esquema, traeLaNueva ? "0099_de_otra_version.sql" : ESQUEMA_ESPERADO, "el manifiesto dice un esquema y el volcado trae otro");
        assert.equal(contenido.includes("cosa_de_otra_version"), traeLaNueva, "el volcado trae la migración a medias");
      } finally {
        await rm(carpeta, { recursive: true, force: true });
      }
    } finally {
      await barrera.soltar();
      await barrera.quitar();
    }
  }));

test("un respaldo de una versión del esquema que este programa no conoce no se restaura, ni cuenta como ensayo", () =>
  conTodo(async ({ p, cubo, llave, con, vigia, correr }) => {
    // Un respaldo tomado por una versión más nueva del sistema: trae una migración que aquí no existe.
    await p.db.query("INSERT INTO migracion (archivo) VALUES ('9999_del_futuro.sql')");
    const { manifiesto } = await correr();
    assert.equal(manifiesto.esquema, "9999_del_futuro.sql");
    const recuperacion = con(cubo.recuperacion);

    await conDestino(async (destino, admin) => {
      await assert.rejects(
        restaurarDelDestino({ destino: recuperacion, servidor: LIMPIO, base: destino, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba" }),
        /versión/i,
      );
      assert.deepEqual(await basesCon(admin, destino), []);
      assert.deepEqual(await restos(), []);

      // Y aunque el manifiesto mintiera sobre su versión, lo que decide es lo que trae la base restaurada.
      const carpeta = await mkdtemp(join(tmpdir(), "futuro-"));
      try {
        const { archivo } = await traer(recuperacion, carpeta);
        await assert.rejects(
          restaurar({ servidor: LIMPIO, base: destino, archivo, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba" }),
          /versión/i,
        );
        assert.deepEqual(await basesCon(admin, destino), []);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
      }

      // Por la consola, como ensayo: termina con error y el vigilante de los ensayos no recibe nada.
      const ensayo = vigia.url.replace("respaldo-de-prueba", "ensayo-de-prueba");
      const r = await consola("operacion/restaurar.ts", ["--remoto", "--ensayo"], {
        ...cubo.entorno(cubo.recuperacion), RESPALDO_DESTINO: cubo.destino, DATABASE_URL: urlEn(LIMPIO, destino),
        WEB_BD_USUARIO: "feruga_prueba", WEB_BD_CLAVE: "prueba", ENSAYO_VIGIA_URL: ensayo,
      }, llave.privada);
      assert.equal(r.codigo, 1, r.salida + r.queja);
      assert.deepEqual(vigia.senales.filter((s) => s.camino.includes("ensayo-de-prueba")), []);
      assert.deepEqual(await basesCon(admin, destino), []);
    });
  }));

test("restaurar termina comprobando, con el usuario de la aplicación, que la base se puede usar", () =>
  conTodo(async ({ cubo, llave, con, correr }) => {
    await correr();
    await conDestino(async (destino) => {
      const r = await restaurarDelDestino({
        destino: con(cubo.recuperacion), servidor: LIMPIO, base: destino, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba",
      });
      assert.equal(r.comprobado, true, "la restauración debe decir que comprobó el uso con el usuario de la aplicación");
    });
  }));

// Lo señaló Codex en su décima revisión: si a quien restauraba se le mataba y se volvía a intentar, la
// restauración que seguía corriendo y la nueva trabajaban sobre la misma base aparte —y la nueva
// empieza por borrarla—.
test("dos restauraciones de la misma base a la vez no caben: la segunda se niega, y no toca la base en que trabaja la primera", () =>
  conTodo(async ({ cubo, llave, con, correr }) => {
    await correr();
    await conDestino(async (destino, admin) => {
      const restaura = () =>
        restaurarDelDestino({ destino: con(cubo.recuperacion), servidor: LIMPIO, base: destino, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba" });
      const laPrimera = new pg.Client({ connectionString: LIMPIO, connectionTimeoutMillis: 10_000 });
      await laPrimera.connect();
      try {
        // Otra restauración de esa base va a la mitad: tiene su turno en el servidor, y su base de trabajo.
        await laPrimera.query("SELECT pg_advisory_lock($1, hashtext($2))", [CANDADO_DE_RESTAURACION, destino]);
        await laPrimera.query(`CREATE DATABASE ${destino}_restaurando`);
        await assert.rejects(restaura(), /Ya hay otra restauración de la base .* en curso/);
        assert.deepEqual(await basesCon(admin, destino), [`${destino}_restaurando`], "la segunda borró la base en que trabajaba la primera, o dejó la suya");
        // La de otra base no estorba: cada base tiene su turno.
        await conDestino(async (otro) => {
          const r = await restaurarDelDestino({ destino: con(cubo.recuperacion), servidor: LIMPIO, base: otro, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba" });
          assert.equal(r.comprobado, true);
        });
      } finally {
        await laPrimera.end();
      }
      // Cuando la primera ya no está —terminó, o murió: el turno se suelta con su sesión—, la que sigue entra.
      assert.equal((await restaura()).comprobado, true);
    });
  }));

// ── lo que encontró la segunda revisión del 4 de octubre ───────────────────

/** Un destino de mentira: lo que lista, y lo que entrega (o con qué falla) al bajar cada nombre. */
function destinoDeMentira(objetos: { nombre: string; bytes: number }[], contenido: (nombre: string) => string | Error): Destino & { bajadas: string[] } {
  const bajadas: string[] = [];
  return {
    bajadas,
    sello: SELLO_DE_PRUEBA,
    subir: async () => {},
    listar: async () => objetos,
    bajar: async (nombre, archivo) => {
      bajadas.push(nombre);
      const c = contenido(nombre);
      if (c instanceof Error) throw c;
      await writeFile(archivo, c);
    },
  };
}

/** El momento que lleva el nombre de un objeto, como lo escribe el manifiesto. */
function momentoDelNombre(objeto: string): string {
  const [, a, me, d, h, mi, s, ms] = /\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z-/.exec(objeto)!;
  return `${a}-${me}-${d}T${h}:${mi}:${s}.${ms ?? "000"}Z`;
}

/** Un manifiesto con lo que debe decir de ese respaldo, salvo lo que se cambie, y sellado con la clave de prueba ya con esos cambios. */
function manifiestoDePrueba(objeto: string, cambios: Partial<Manifiesto> = {}): string {
  const dicho = {
    formato: 1 as const, corrida: /-([0-9a-f-]{36})\.dump\.age$/.exec(objeto)![1]!, instantanea: momentoDelNombre(objeto), objeto, bytes: 1000,
    sha256: "a".repeat(64), pgDump: "pg_dump (PostgreSQL) 17.6", llavePublica: "age1" + "q".repeat(58), esquema: "0020_restauracion.sql", ...cambios,
  };
  return JSON.stringify({ ...dicho, sello: cambios.sello ?? selloDe(dicho, SELLO_DE_PRUEBA) });
}

test("los respaldos con el nombre de antes (al segundo) se siguen viendo, y si empatan en el segundo decide el manifiesto", async () => {
  const viejo = "2026/10/03/20261003T150000Z-11111111-1111-4111-8111-111111111111.dump.age";
  const nuevo = nombreDeObjeto(new Date("2026-10-03T15:00:00.500Z"), "22222222-2222-4222-8222-222222222222");
  const anterior = nombreDeObjeto(new Date("2026-10-03T14:00:00.250Z"), "33333333-3333-4333-8333-333333333333");
  const todos = [nuevo, viejo, anterior].flatMap((o) => [{ nombre: o, bytes: 1000 }, { nombre: nombreDeManifiesto(o), bytes: 300 }]);
  // El de nombre viejo es, en realidad, el más reciente de los tres: su manifiesto lo dice.
  const momentos: Record<string, string> = { [viejo]: "2026-10-03T15:00:00.900Z", [nuevo]: "2026-10-03T15:00:00.500Z", [anterior]: "2026-10-03T14:00:00.250Z" };
  const destino = destinoDeMentira(todos, (nombre) => {
    const objeto = nombre.replace(/\.manifiesto\.json$/, ".dump.age");
    return manifiestoDePrueba(objeto, { instantanea: momentos[objeto]! });
  });
  assert.deepEqual((await respaldos(destino)).map((r) => r.objeto), [anterior, viejo, nuevo]);
  assert.equal((await ultimoUtilizable(destino))?.manifiesto.objeto, viejo);
});

test("un respaldo guardado con el nombre de antes se restaura por su nombre", () =>
  conTodo(async ({ cubo, llave, con, correr }) => {
    const { manifiesto } = await correr();
    // El mismo respaldo, como lo habría nombrado la versión anterior: sin milisegundos.
    const deAntes = manifiesto.objeto.replace(/(T\d{6})\d{3}Z-/, "$1Z-");
    assert.notEqual(deAntes, manifiesto.objeto);
    await cubo.poner(deAntes, await cubo.leer(manifiesto.objeto));
    // Con su sello: el nombre es parte de lo sellado, así que el de aquel nombre lleva el suyo.
    const { sello: _sello, ...dicho } = { ...manifiesto, objeto: deAntes };
    await cubo.poner(nombreDeManifiesto(deAntes), Buffer.from(JSON.stringify({ ...dicho, sello: selloDe(dicho, claveDeSello(llave.privada)) })));
    const recuperacion = con(cubo.recuperacion);
    assert.ok((await respaldos(recuperacion)).some((r) => r.objeto === deAntes), "no aparece en la lista");
    const carpeta = await mkdtemp(join(tmpdir(), "deantes-"));
    try {
      assert.equal((await traer(recuperacion, carpeta, deAntes)).manifiesto.sha256, manifiesto.sha256);
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));

test("buscar el último respaldo utilizable no se queda recorriendo fallos: si el destino no contesta, lo dice enseguida", async () => {
  const objetos = Array.from({ length: 100 }, (_, k) => nombreDeObjeto(new Date(Date.UTC(2026, 9, 1, 0, k)), `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`));
  const todos = objetos.flatMap((o) => [{ nombre: o, bytes: 1000 }, { nombre: nombreDeManifiesto(o), bytes: 300 }]);

  // El destino no contesta (o niega la lectura): no es que el manifiesto esté dañado, es que no se sabe.
  const caido = destinoDeMentira(todos, () => new Error("operation error S3: GetObject, exceeded maximum number of attempts"));
  await assert.rejects(ultimoUtilizable(caido), /no se pudo comprobar/i);
  assert.equal(caido.bajadas.length, 1, "siguió probando con los anteriores aunque el destino no contestaba");
  const carpeta = await mkdtemp(join(tmpdir(), "caido-"));
  try {
    // Restaurar «el último» tampoco declara dañado lo que no pudo leer, ni recomienda otro.
    await assert.rejects(traer(caido, carpeta), (e: Error) => /no se pudo comprobar/i.test(e.message) && !/dañ|sí sirve/i.test(e.message));
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }

  // Muchos manifiestos dañados de verdad: se deja de buscar tras unos cuantos, y se toma por «no hay».
  const danados = destinoDeMentira(todos, () => "{ no es un manifiesto");
  assert.equal(await ultimoUtilizable(danados), null);
  assert.ok(danados.bajadas.length <= 10, `leyó ${danados.bajadas.length} manifiestos dañados antes de rendirse`);

  // Y con el servicio: si no se pudo saber, se respalda; no se queda esperando.
  const corridas: string[] = [];
  let ahora = new Date("2026-10-05T08:10:00-06:00").getTime();
  await servicio({
    horario: leerHorario("08:00,09:00"), zona: PATIO, reintento: 60_000,
    reloj: () => new Date(ahora),
    dormir: async (ms) => {
      ahora += ms;
    },
    ultimo: async () => new Date((await ultimoUtilizable(caido))!.manifiesto.instantanea),
    corrida: async () => {
      corridas.push(new Date(ahora).toISOString());
    },
    seguir: () => corridas.length < 1,
  });
  assert.deepEqual(corridas, ["2026-10-05T14:10:00.000Z"]);
});

test("un manifiesto que dice algo imposible de su respaldo no lo acredita", async () => {
  const bueno = nombreDeObjeto(new Date("2026-10-03T14:00:00.000Z"), "33333333-3333-4333-8333-333333333333");
  const ultimo = nombreDeObjeto(new Date("2026-10-03T15:00:00.000Z"), "44444444-4444-4444-8444-444444444444");
  const todos = [bueno, ultimo].flatMap((o) => [{ nombre: o, bytes: 1000 }, { nombre: nombreDeManifiesto(o), bytes: 300 }]);
  const imposibles: Partial<Manifiesto>[] = [
    { bytes: -1 }, { bytes: 0 }, { bytes: 1010 },            // un tamaño que no puede ser, o que no es el del objeto que hay
    { sha256: "abc" }, { corrida: "no-es-un-identificador" }, { instantanea: "ayer" }, { formato: 2 as 1 },
    { llavePublica: "AGE-SECRET-KEY-1QQQ" }, { esquema: "" }, { pgDump: "" },
  ];
  for (const cambio of imposibles) {
    const destino = destinoDeMentira(todos, (nombre) => {
      const objeto = nombre.replace(/\.manifiesto\.json$/, ".dump.age");
      return manifiestoDePrueba(objeto, objeto === ultimo ? cambio : {});
    });
    assert.equal((await ultimoUtilizable(destino))?.manifiesto.objeto, bueno, `dio por bueno un manifiesto con ${JSON.stringify(cambio)}`);
  }
  // Y uno en orden, sí.
  const enOrden = destinoDeMentira(todos, (nombre) => manifiestoDePrueba(nombre.replace(/\.manifiesto\.json$/, ".dump.age")));
  assert.equal((await ultimoUtilizable(enOrden))?.manifiesto.objeto, ultimo);
});

test("si la conexión del turno muere a media corrida, la sesión del volcado no se queda viva en la base", () =>
  conTodo(async ({ p, correr, dicho }) => {
    const barrera = await retenerVolcados(p.base);
    try {
      const detenida = correr({ plazos: { volcado: 1500 } });
      await barrera.volcadoDetenido();
      // Muere la conexión que tiene el turno (y con ella, el único camino por el que antes se limpiaba).
      const turnos = await barrera.vigia.query(
        `SELECT pg_terminate_backend(l.pid) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE l.locktype = 'advisory' AND l.objid = 7152 AND l.granted AND a.datname = $1`, [p.base],
      );
      assert.equal(turnos.rows.length, 1, "no se encontró la conexión del turno");
      await assert.rejects(detenida, /volcar/i);
      // El volcado sigue esperando su candado de tabla: nadie lo soltó. Aun así, su sesión ya no está.
      assert.equal(await cuantos(barrera.vigia, "pg_stat_activity", "datname = $1 AND application_name LIKE 'pg_dump%'", [p.base]), 0);
      assert.ok(!/no se pudo confirmar/i.test(dicho.join("\n")), dicho.join("\n"));
    } finally {
      await barrera.soltar();
    }
  }));

// ── lo que dejaron los registros de la tercera pasada, que se cortó por cuota ──

test("un nombre con una fecha imposible no es un respaldo, y buscar el último no se queda dando vueltas", async () => {
  const imposible = "2026/99/04/20269904T120000000Z-11111111-1111-4111-8111-111111111111.dump.age";
  const otraCarpeta = "2026/10/05/20261004T120000000Z-22222222-2222-4222-8222-222222222222.dump.age";   // la carpeta dice otro día que el nombre
  const bueno = nombreDeObjeto(new Date("2026-10-04T11:00:00.000Z"), "33333333-3333-4333-8333-333333333333");
  const todos = [imposible, otraCarpeta, bueno].flatMap((o) => [{ nombre: o, bytes: 1000 }, { nombre: nombreDeManifiesto(o), bytes: 300 }]);
  const destino = destinoDeMentira(todos, (nombre) => (nombre.includes("99") ? "{" : manifiestoDePrueba(nombre.replace(/\.manifiesto\.json$/, ".dump.age"))));
  assert.deepEqual((await respaldos(destino)).map((r) => r.objeto), [bueno]);

  // En un proceso aparte y con plazo: si se quedara en un bucle, aquí no habría quién lo detuviera.
  const guion = `
    import { ultimoUtilizable, nombreDeManifiesto } from "./operacion/destino.ts";
    import { writeFile } from "node:fs/promises";
    const nombres = ${JSON.stringify([imposible])};
    const destino = { subir: async () => {}, listar: async () => nombres.flatMap((n) => [{ nombre: n, bytes: 1 }, { nombre: nombreDeManifiesto(n), bytes: 1 }]), bajar: async (n, a) => writeFile(a, "{") };
    console.log(JSON.stringify(await ultimoUtilizable(destino)));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", guion], { timeout: 10_000, encoding: "utf8" });
  assert.equal(r.status, 0, `no terminó: ${r.signal ?? ""} ${r.stderr}`);
  assert.equal(r.stdout.trim(), "null");
});

test("el tope de manifiestos dañados vale también entre respaldos con el nombre de antes, del mismo segundo", async () => {
  const viejos = Array.from({ length: 100 }, (_, k) => `2026/10/04/20261004T120000Z-00000000-0000-4000-8000-${String(k).padStart(12, "0")}.dump.age`);
  const todos = viejos.flatMap((o) => [{ nombre: o, bytes: 1000 }, { nombre: nombreDeManifiesto(o), bytes: 300 }]);
  // Con el nombre de antes no se sabe cuál de los cien es el último sin leerlos todos, y no se leen
  // todos: se dice que no se pudo determinar. Ni «no hay», ni uno cualquiera.
  const destino = destinoDeMentira(todos, () => "{ dañado");
  await assert.rejects(ultimoUtilizable(destino), /no se pudo determinar/i);
  assert.ok(destino.bajadas.length <= 10, `leyó ${destino.bajadas.length} manifiestos dañados`);

  // Lo mismo si están en orden: el tope es de lecturas, no de manifiestos dañados.
  const buenos = destinoDeMentira(todos, (nombre) => manifiestoDePrueba(nombre.replace(/\.manifiesto\.json$/, ".dump.age")));
  await assert.rejects(ultimoUtilizable(buenos), /no se pudo determinar/i);
  assert.ok(buenos.bajadas.length <= 10, `leyó ${buenos.bajadas.length} manifiestos`);
  const carpeta = await mkdtemp(join(tmpdir(), "muchos-"));
  try {
    // Restaurar «el último» tampoco adivina: lo dice, y pide que se elija por nombre. Sin leer más que el tope.
    const antes = buenos.bajadas.length;
    await assert.rejects(traer(buenos, carpeta), (e: Error) => /no se pudo determinar/i.test(e.message) && /por su nombre/i.test(e.message));
    assert.ok(buenos.bajadas.length - antes <= 10);
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
});

test("un manifiesto cuya instantánea no es la del nombre de su respaldo no lo acredita", async () => {
  const anterior = nombreDeObjeto(new Date("2026-10-04T11:00:00.000Z"), "33333333-3333-4333-8333-333333333333");
  const ultimo = nombreDeObjeto(new Date("2026-10-04T12:01:00.000Z"), "44444444-4444-4444-8444-444444444444");
  const deAntes = "2026/10/04/20261004T130000Z-55555555-5555-4555-8555-555555555555.dump.age";
  const lista = (objetos: string[]) => objetos.flatMap((o) => [{ nombre: o, bytes: 1000 }, { nombre: nombreDeManifiesto(o), bytes: 300 }]);
  const con = (objetos: string[], instantaneas: Record<string, string>) =>
    destinoDeMentira(lista(objetos), (nombre) => {
      const objeto = nombre.replace(/\.manifiesto\.json$/, ".dump.age");
      return manifiestoDePrueba(objeto, instantaneas[objeto] ? { instantanea: instantaneas[objeto] } : {});
    });
  // Dice ser de dos horas después que su nombre: con eso se daría por tomado el respaldo de las 14.
  assert.equal((await ultimoUtilizable(con([anterior, ultimo], { [ultimo]: "2026-10-04T14:01:00.000Z" })))?.manifiesto.objeto, anterior);
  assert.equal((await ultimoUtilizable(con([anterior, ultimo], { [ultimo]: "2026-10-04T12:01:00.001Z" })))?.manifiesto.objeto, anterior);
  // Un nombre de antes solo dice el segundo: dentro de ese segundo, cualquier instante vale; fuera, no.
  assert.equal((await ultimoUtilizable(con([anterior, deAntes], { [deAntes]: "2026-10-04T13:00:00.640Z" })))?.manifiesto.objeto, deAntes);
  assert.equal((await ultimoUtilizable(con([anterior, deAntes], { [deAntes]: "2026-10-04T13:00:01.000Z" })))?.manifiesto.objeto, anterior);
});

test("si los más nuevos están dañados y hay uno bueno más atrás, restaurar «el último» no dice que no hay ninguno", async () => {
  const bueno = nombreDeObjeto(new Date("2026-10-04T11:00:00.000Z"), "99999999-9999-4999-8999-999999999999");
  const danados = Array.from({ length: 12 }, (_, k) => nombreDeObjeto(new Date(Date.UTC(2026, 9, 4, 12, 0, k)), `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`));
  const todos = [bueno, ...danados].flatMap((o) => [{ nombre: o, bytes: 1000 }, { nombre: nombreDeManifiesto(o), bytes: 300 }]);
  const destino = destinoDeMentira(todos, (nombre) => (nombre === nombreDeManifiesto(bueno) ? manifiestoDePrueba(bueno) : "{ dañado"));
  const carpeta = await mkdtemp(join(tmpdir(), "atras-"));
  try {
    await assert.rejects(traer(destino, carpeta), (e: Error) => /más nuevos/i.test(e.message) && /por su nombre/i.test(e.message) && !/no hay ningún respaldo/i.test(e.message));
    // Y si de verdad no hay nada, eso es lo que dice.
    await assert.rejects(traer(destinoDeMentira([], () => "{"), carpeta), /no hay ningún respaldo/i);
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
});

test("un volcado cuyo programa murió no deja su sesión esperando para siempre: desiste al vencer su plazo de espera en la base", () =>
  conTodo(async ({ p }) => {
    const barrera = await retenerVolcados(p.base);
    const sesion = "pg_dump sin programa";      // sin acentos: la base los cambia en el nombre de la sesión
    const u = new URL(urlDe(p.base));
    const hijo = spawn("pg_dump", ["--format=custom", "--lock-wait-timeout=1500", "--file", "/dev/null"], {
      env: {
        ...process.env, PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
        PGDATABASE: u.pathname.slice(1), PGAPPNAME: sesion,
      },
      stdio: "ignore",
    });
    const terminado = new Promise((listo) => hijo.on("close", listo));
    try {
      const esperando = async (): Promise<number> =>
        cuantos(barrera.vigia, "pg_stat_activity", "datname = $1 AND application_name = $2", [p.base, sesion]);
      for (let k = 0; k < 200 && (await cuantos(barrera.vigia, "pg_stat_activity", "application_name = $1 AND wait_event_type = 'Lock'", [sesion])) === 0; k += 1) {
        await new Promise((sigue) => setTimeout(sigue, 25));
      }
      assert.equal(await esperando(), 1, "el volcado no llegó a esperar el candado");
      // Muere el programa, sin que nadie limpie. El candado de la tabla sigue tomado.
      hijo.kill("SIGKILL");
      await terminado;
      let quedan = 1;
      for (let k = 0; k < 60 && quedan > 0; k += 1) {
        await new Promise((sigue) => setTimeout(sigue, 100));
        quedan = await esperando();
      }
      assert.equal(quedan, 0, "la sesión del volcado siguió viva después de su plazo de espera");
    } finally {
      hijo.kill("SIGKILL");
      await barrera.soltar();
    }
  }));

// ── el respaldo diario, que se guarda un año ───────────────────────────────
//
// La decisión —cuál es el diario de cada día, qué pasa cuando algo falla a medias— se prueba con
// depósitos de mentira en pruebas/28-respaldo-diario.test.ts. Aquí, que llegue de verdad a un
// segundo depósito con su candado de un año, con credenciales restringidas, y que se restaure.

interface ConDiario extends Todo {
  /** El depósito de un año. */
  anual: Cubo;
  /** El depósito diario, visto con esa credencial. */
  delDiario: (c: Credencial) => Destino;
  /** Lo del diario para una corrida: su depósito con la credencial del servidor, y su propio vigilante. */
  diario: (cambios?: Partial<Diario>) => Diario;
  /** Las señales que recibió el vigilante del diario. */
  senalesDelDiario: () => Senal[];
}

const conDiario = (prueba: (t: ConDiario) => Promise<void>) =>
  conTodo((t) =>
    conCubo(async (anual) => {
      const delDiario = (c: Credencial): Destino => destinoRclone(anual.destino, anual.entorno(c), { sello: claveDeSello(t.llave.privada) });
      const comprobados = sinComprobar();
      const url = t.vigia.url.replace("respaldo-de-prueba", "diario-de-prueba");
      await prueba({
        ...t, anual, delDiario,
        diario: (cambios = {}) => ({ destino: delDiario(anual.servidor), zona: PATIO, vigia: vigiaHttp(url), comprobados, ...cambios }),
        senalesDelDiario: () => t.vigia.senales.filter((s) => s.camino.includes("diario-de-prueba")),
      });
    }, { retencion: "365d", remoto: "diario" }));

/** Hasta cuándo retiene el depósito ese objeto, en días desde hoy. */
async function diasRetenido(cubo: Cubo, objeto: string): Promise<number> {
  const info = JSON.parse(await cubo.mc(cubo.raiz, "retention", "info", "--json", `c/${cubo.nombre}/feruga/${objeto}`)) as { mode: string; until: string };
  assert.equal(info.mode, "COMPLIANCE");
  return Math.round((Date.parse(info.until) - Date.now()) / (24 * 3_600_000));
}

test("con depósito diario: el primer respaldo del día queda en los dos, cada uno con su candado —30 días y 365—; el segundo, solo en el de cada hora; y el diario avisa por su propia señal", () =>
  conDiario(async ({ cubo, anual, con, delDiario, diario, correr, senalesDelDiario, vigia }) => {
    const primero = await correr({ diario: diario() });
    const hoy = diaDelPatio(new Date(primero.manifiesto.instantanea), PATIO);
    assert.deepEqual(primero.diario, { subidos: [{ dia: hoy, objeto: primero.manifiesto.objeto }], huecos: [], fallas: [], pendientes: 0, fallo: null });
    // En los dos depósitos, el mismo: mismo nombre, misma huella, mismo manifiesto.
    const [deCadaHora, anuales] = [await respaldos(con(cubo.recuperacion)), await respaldos(delDiario(anual.recuperacion))];
    assert.deepEqual(anuales.map((r) => r.objeto), deCadaHora.map((r) => r.objeto));
    assert.equal(sha256(await anual.leer(primero.manifiesto.objeto)), primero.manifiesto.sha256);
    assert.deepEqual(await anual.leer(nombreDeManifiesto(primero.manifiesto.objeto)), await cubo.leer(nombreDeManifiesto(primero.manifiesto.objeto)));
    // Cada depósito le puso su candado: 30 días al de cada hora, 365 al diario. También al manifiesto.
    assert.equal(await diasRetenido(cubo, primero.manifiesto.objeto), 30);
    assert.equal(await diasRetenido(anual, primero.manifiesto.objeto), 365);
    assert.equal(await diasRetenido(anual, nombreDeManifiesto(primero.manifiesto.objeto)), 365);

    // El segundo del día: al de cada hora, sí; al diario, no.
    const segundo = await correr({ diario: diario() });
    assert.deepEqual(segundo.diario, { subidos: [], huecos: [], fallas: [], pendientes: 0, fallo: null });
    assert.equal((await respaldos(con(cubo.recuperacion))).length, 2);
    assert.deepEqual((await respaldos(delDiario(anual.recuperacion))).map((r) => r.objeto), [primero.manifiesto.objeto]);
    assert.equal((await anual.versiones(primero.manifiesto.objeto)).length, 1, "volvió a subir el diario");

    // Cada cosa avisa por su señal: la del respaldo de cada hora, y la del diario, aparte.
    assert.deepEqual(vigia.senales.filter((s) => s.camino.includes("respaldo-de-prueba")).map((s) => s.que), ["inicio", "bien", "inicio", "bien"]);
    assert.deepEqual(senalesDelDiario().map((s) => s.que), ["bien", "bien"]);
  }));

test("si el diario falla, el respaldo de la hora vale y avisa su éxito; el diario avisa su fallo por su señal, sin detalles; y a la siguiente se sube el que tocaba, no el más nuevo", () =>
  conDiario(async ({ cubo, anual, con, delDiario, diario, correr, senalesDelDiario, vigia, dicho }) => {
    // El depósito diario no deja escribir a esa credencial.
    const sinPermiso = await anual.credencial({ "*": ["s3:GetObject"] });
    const primero = await correr({ diario: diario({ destino: delDiario(sinPermiso) }) });
    assert.ok(primero.avisado, "el respaldo de la hora no avisó su éxito");
    assert.equal((await respaldos(con(cubo.recuperacion))).length, 1);
    assert.ok(primero.diario?.fallo, "no dijo que el diario falló");
    assert.deepEqual(await respaldos(delDiario(anual.recuperacion)), []);
    assert.deepEqual(vigia.senales.filter((s) => s.camino.includes("respaldo-de-prueba")).map((s) => s.que), ["inicio", "bien"]);
    const fallo = senalesDelDiario();
    assert.deepEqual(fallo.map((s) => s.que), ["fallo"]);
    // Al vigilante, que es un servicio ajeno, no le llega ni el nombre del cubo ni lo que dijo el programa.
    assert.ok(!fallo[0]!.cuerpo.includes(anual.nombre) && fallo[0]!.cuerpo.length < 200, fallo[0]!.cuerpo);
    assert.ok(dicho.some((linea) => /diario/i.test(linea)), "no quedó dicho en el registro de la máquina");

    // A la hora siguiente el depósito ya deja: se sube el primero del día, el que tocaba.
    await new Promise((sigue) => setTimeout(sigue, 20));
    const segundo = await correr({ diario: diario() });
    assert.deepEqual(segundo.diario?.subidos.map((s) => s.objeto), [primero.manifiesto.objeto]);
    assert.deepEqual((await respaldos(delDiario(anual.recuperacion))).map((r) => r.objeto), [primero.manifiesto.objeto]);
    assert.deepEqual(senalesDelDiario().map((s) => s.que), ["fallo", "bien"]);
  }));

// Lo encontró Codex en su décima revisión: el hueco se anotaba como avisado antes de avisar, y si el aviso no llegaba
// nadie se enteraba nunca.
test("el aviso de un día sin diario se repite hasta que el vigilante lo recibe; cuando lo recibió queda anotado, y ya no se repite", () =>
  conDiario(async ({ p, cubo, anual, llave, con, diario, correr }) => {
    // Ayer hubo un solo respaldo, y su manifiesto no se lee: ese día no tiene con qué. Hoy sí hay uno bueno.
    const ayer = new Date(Date.now() - 24 * 3_600_000);
    const deAyer = nombreDeObjeto(ayer, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    await cubo.poner(deAyer, Buffer.from("lo cifrado de ayer"));
    await cubo.poner(nombreDeManifiesto(deAyer), Buffer.from("{ no es json"));
    await correr();
    const dia = diaDelPatio(ayer, PATIO);
    const avisos: string[] = [];
    let llega = false;
    const vigia = {
      inicio: async () => {},
      bien: async () => { avisos.push("bien"); },
      fallo: async (_corrida: string, que: string) => {
        if (!llega) throw new Error("no se pudo llegar al vigilante");
        avisos.push(que);
      },
    };
    const alDia = () => diarioAlArrancar({ base: urlDe(p.base), llavePublica: llave.publica, destino: con(cubo.servidor), diario: diario({ vigia }) });
    const anotado = async (): Promise<boolean> => (await anual.leer(`elecciones/${dia}.hueco.json`).then(() => true, () => false));

    // El vigilante no contesta: el hueco se dice, y no queda anotado como avisado.
    assert.deepEqual((await alDia())?.huecos.map((h) => h.dia), [dia]);
    assert.equal(await anotado(), false, "anotó como avisado un hueco del que nadie se enteró");
    assert.deepEqual((await alDia())?.huecos.map((h) => h.dia), [dia]);
    assert.deepEqual(avisos, []);
    // Ahora sí llega: se anota, y la corrida siguiente ya no lo repite —avisa que todo bien—.
    llega = true;
    assert.deepEqual((await alDia())?.huecos.map((h) => h.dia), [dia]);
    assert.equal(await anotado(), true);
    assert.deepEqual((await alDia())?.huecos, []);
    assert.deepEqual(avisos, [`Sin respaldo diario del ${dia}`, "bien"]);
  }));

// Lo encontró Codex en su décima revisión: perdida la sesión que tiene el turno, la corrida seguía escribiendo con su
// lista vieja, mientras otra —que ya podía tomar el turno— decidía lo mismo.
test("si se corta la sesión que tiene el turno de los respaldos, el diario no escribe nada más: ni la elección, ni el archivo", () =>
  conDiario(async ({ p, cubo, anual, llave, con, delDiario, diario, correr }) => {
    await correr();                                     // hay un respaldo de hoy, y todavía ningún diario
    const real = delDiario(anual.servidor);
    // El depósito diario contesta su lista, y en ese momento alguien termina la sesión que tiene el turno.
    const seCortaElTurno: Destino = {
      ...real,
      listar: async () => {
        await p.db.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND objid = 7152 AND granted AND pid <> pg_backend_pid()");
        return real.listar();
      },
    };
    const alDia = await diarioAlArrancar({ base: urlDe(p.base), llavePublica: llave.publica, destino: con(cubo.servidor), diario: diario({ destino: seCortaElTurno }) });
    assert.match(alDia?.fallo ?? "", /se perdió el turno de los respaldos/);
    assert.deepEqual(alDia?.subidos, []);
    assert.deepEqual(await respaldos(delDiario(anual.recuperacion)), [], "subió un diario sin tener el turno");
    assert.equal((await delDiario(anual.recuperacion).listar()).length, 0, "escribió en el depósito diario sin tener el turno");
    // Con el turno en la mano, la corrida siguiente lo sube.
    assert.equal((await diarioAlArrancar({ base: urlDe(p.base), llavePublica: llave.publica, destino: con(cubo.servidor), diario: diario() }))?.subidos.length, 1);
  }));

// Lo encontró Codex en la segunda vuelta de su décima revisión: preguntar por el turno antes de escribir no detiene una
// escritura que ya salió. A elige; su sesión muere con la elección en camino; B toma el turno —y ve un respaldo anterior,
// que A no vio—, elige ese y termina; llega la escritura de A, y pisa la elección de B. Quedaban dos diarios posibles
// para el mismo día. Ahora la elección se decide en la base, una sola vez: B lee la de A.
test("la elección del diario se decide en la base: si la sesión del turno muere con la elección en camino y otra corrida entra, las dos llevan al mismo diario", () =>
  conDiario(async ({ p, cubo, anual, llave, con, delDiario, diario, correr }) => {
    const anterior = (await correr()).manifiesto.objeto;
    const elDeA = (await correr()).manifiesto.objeto;
    const deCadaHora = con(cubo.servidor);
    // A no alcanza a ver el anterior: para ella, el primero del día es el suyo.
    const sinElAnterior: Destino = { ...deCadaHora, listar: async (plazo) => (await deCadaHora.listar(plazo)).filter((e) => e.nombre !== anterior && e.nombre !== nombreDeManifiesto(anterior)) };
    const real = delDiario(anual.servidor);
    let enCamino = false;
    let deB = null as Awaited<ReturnType<typeof diarioAlArrancar>>;
    const conLaEleccionEnCamino: Destino = {
      ...real,
      subir: async (archivo, nombre, plazo) => {
        if (!enCamino && nombre.startsWith("elecciones/")) {
          enCamino = true;
          await p.db.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND objid = 7152 AND granted AND pid <> pg_backend_pid()");
          deB = await diarioAlArrancar({ base: urlDe(p.base), llavePublica: llave.publica, destino: deCadaHora, diario: diario({ comprobados: sinComprobar() }) });
        }
        return real.subir(archivo, nombre, plazo);
      },
    };
    const deA = await diarioAlArrancar({ base: urlDe(p.base), llavePublica: llave.publica, destino: sinElAnterior, diario: diario({ destino: conLaEleccionEnCamino, comprobados: sinComprobar() }) });
    assert.ok(enCamino, "el caso no se dio");
    assert.match(deA?.fallo ?? "", /se perdió el turno de los respaldos/);
    assert.equal(deB!.fallo, null);
    assert.deepEqual(deB!.subidos.map((x) => x.objeto), [elDeA], "la segunda corrida eligió otro respaldo para el mismo día");
    assert.deepEqual((await respaldos(delDiario(anual.recuperacion))).map((r) => r.objeto), [elDeA]);
    // La elección está en la base, y es esa. No se cambia ni se borra: ni siquiera quien administra la base.
    const hoy = diaDelPatio(new Date(), PATIO);
    assert.deepEqual((await p.db.query("SELECT to_char(dia, 'YYYY-MM-DD') AS dia, objeto FROM respaldo_diario")).rows, [{ dia: hoy, objeto: elDeA }]);
    // Quien llega después con otra no la cambia: recibe la que ya estaba, tal cual.
    const registro = eleccionesEnLaBase(p.db);
    const fijada = await registro.de(hoy);
    assert.deepEqual([fijada?.objeto, typeof fijada?.bytes, fijada?.formato], [elDeA, "number", 1]);
    assert.deepEqual(await registro.fijar({ formato: 1, dia: hoy, objeto: anterior, bytes: 1, sha256: "0".repeat(64) }), fijada);
    assert.equal(await registro.de("2001-01-01"), null);
    await assert.rejects(p.db.query("UPDATE respaldo_diario SET objeto = $1", [anterior]));
    await assert.rejects(p.db.query("DELETE FROM respaldo_diario"));
    await assert.rejects(p.db.query("TRUNCATE respaldo_diario"));
    // Lo que quedó escrito en el depósito dice lo mismo que la base.
    assert.equal((JSON.parse((await anual.leer(`elecciones/${hoy}.json`)).toString("utf8")) as { objeto: string }).objeto, elDeA);
    // La aplicación no tiene nada que hacer ahí.
    const app = await comoApp(p.base);
    try {
      await assert.rejects(app.query("SELECT 1 FROM respaldo_diario"), (e: { code?: string }) => e.code === "42501");
    } finally {
      await app.end();
    }
  }));

test("la dirección del vigilante no lleva usuario ni contraseña; y de un aviso que no llega se dice que no llegó, no a qué dirección", async () => {
  // Lo encontró Codex en su décima revisión: una dirección con contraseña se aceptaba, y acababa impresa al fallar un aviso.
  assert.throws(() => vigiaHttp("https://usuario:Secreto123@vigia.ejemplo.mx/ping/0b2c1f"), (e: Error) => /no lleva usuario ni contraseña/.test(e.message) && !e.message.includes("Secreto123"));
  assert.throws(() => vigiaHttp("esto no es una dirección"), /no es una dirección completa/);
  await assert.rejects(vigiaHttp("http://127.0.0.1:9/ping/la-senal-de-este-negocio", 500).bien("corrida"), (e: Error) => /no se pudo llegar al vigilante/.test(e.message) && !e.message.includes("la-senal-de-este-negocio"));
});

test("dos corridas a la vez no suben dos diarios: la segunda espera su turno y encuentra el día ya cubierto", () =>
  conDiario(async ({ anual, delDiario, diario, correr }) => {
    // Cada una con su memoria vacía, como dos procesos: la manual y la programada.
    const [a, b] = await Promise.all([correr({ diario: diario({ comprobados: sinComprobar() }) }), correr({ diario: diario({ comprobados: sinComprobar() }) })]);
    assert.equal([...a.diario!.subidos, ...b.diario!.subidos].length, 1, "las dos subieron un diario");
    const anuales = await respaldos(delDiario(anual.recuperacion));
    assert.equal(anuales.length, 1);
    assert.equal((await anual.versiones(anuales[0]!.objeto)).length, 1);
    assert.equal((await anual.versiones(nombreDeManifiesto(anuales[0]!.objeto))).length, 1);
  }));

test("el diario se baja con la credencial de recuperación y se restaura; y la credencial del servidor no puede borrar ni acortar el candado en el depósito de un año", () =>
  conDiario(async ({ p, anual, llave, delDiario, diario, correr }) => {
    const antes = await retrato(p.db);
    const { manifiesto } = await correr({ diario: diario() });
    await conDestino(async (destino) => {
      const r = await restaurarDelDestino({
        servidor: LIMPIO, base: destino, destino: delDiario(anual.recuperacion), llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba",
      });
      assert.equal(r.objeto, manifiesto.objeto);
      const restaurada = new pg.Client({ connectionString: urlEn(LIMPIO, destino) });
      await restaurada.connect();
      try {
        assert.deepEqual(await retrato(restaurada), antes);
      } finally {
        await restaurada.end();
      }
    });
    const objeto = `c/${anual.nombre}/feruga/${manifiesto.objeto}`;
    const version = (await anual.versiones(manifiesto.objeto))[0]!;
    await assert.rejects(anual.mc(anual.servidor, "rm", objeto));
    await assert.rejects(anual.mc(anual.servidor, "rm", "--version-id", version.id, objeto));
    await assert.rejects(anual.mc(anual.servidor, "retention", "set", "--version-id", version.id, "GOVERNANCE", "1d", objeto));
    await assert.rejects(anual.mc(anual.servidor, "retention", "set", "--default", "COMPLIANCE", "30d", `c/${anual.nombre}`));
    await assert.rejects(anual.mc(anual.servidor, "retention", "clear", "--default", `c/${anual.nombre}`));
    // Ni quien administra el almacenamiento le acorta el año a lo ya guardado.
    await assert.rejects(anual.mc(anual.raiz, "retention", "set", "--version-id", version.id, "COMPLIANCE", "30d", objeto));
    assert.equal(await diasRetenido(anual, manifiesto.objeto), 365);
    assert.equal((JSON.parse(await anual.mc(anual.raiz, "retention", "info", "--default", "--json", `c/${anual.nombre}`)) as { validity: string }).validity, "365DAYS");
  }));

test("al arrancar, el servicio pone al día el diario aunque no toque respaldo: lo que no se pudo subir se sube al volver, sin tomar otro respaldo", () =>
  conDiario(async ({ p, cubo, anual, llave, con, delDiario, diario, correr, senalesDelDiario }) => {
    // El diario de hoy no se pudo subir: el depósito no dejaba.
    const sinPermiso = await anual.credencial({ "*": ["s3:GetObject"] });
    const { manifiesto } = await correr({ diario: diario({ destino: delDiario(sinPermiso) }) });
    assert.deepEqual(await respaldos(delDiario(anual.recuperacion)), []);
    // El servicio vuelve a arrancar, ya con el depósito en orden. No toca respaldo todavía.
    const alDia = await diarioAlArrancar({
      base: urlDe(p.base), llavePublica: llave.publica, destino: con(cubo.servidor), diario: diario({ comprobados: sinComprobar() }),
    });
    assert.deepEqual(alDia?.subidos.map((s) => s.objeto), [manifiesto.objeto]);
    assert.equal(alDia?.fallo, null);
    assert.equal((await respaldos(con(cubo.recuperacion))).length, 1, "tomó otro respaldo para ponerse al día");
    assert.deepEqual((await respaldos(delDiario(anual.recuperacion))).map((r) => r.objeto), [manifiesto.objeto]);
    assert.deepEqual(senalesDelDiario().map((s) => s.que), ["fallo", "bien"]);
    // Sin depósito diario configurado, no hay nada que poner al día.
    assert.equal(await diarioAlArrancar({ base: urlDe(p.base), llavePublica: llave.publica, destino: con(cubo.servidor) }), null);
  }));

test("poner al día el diario al arrancar toma el turno de los respaldos: mientras otro respaldo corre, espera, y si no le toca a tiempo no sube nada", () =>
  conDiario(async ({ p, cubo, anual, llave, con, delDiario, diario, correr }) => {
    // Queda un diario pendiente: no se pudo subir.
    const sinPermiso = await anual.credencial({ "*": ["s3:GetObject"] });
    await correr({ diario: diario({ destino: delDiario(sinPermiso) }) });
    const pendiente = { base: urlDe(p.base), llavePublica: llave.publica, destino: con(cubo.servidor), diario: diario({ comprobados: sinComprobar() }) };
    // Otro respaldo tiene el turno.
    const otro = new pg.Client({ connectionString: urlDe(p.base) });
    await otro.connect();
    try {
      await otro.query("SELECT pg_advisory_lock(7152)");
      await assert.rejects(diarioAlArrancar({ ...pendiente, plazos: { turno: 1000 } }), /otro respaldo sigue corriendo/);
      assert.deepEqual(await respaldos(delDiario(anual.recuperacion)), [], "subió un diario sin tener el turno");
    } finally {
      await otro.end();
    }
    // Con el turno libre, sí.
    assert.equal((await diarioAlArrancar(pendiente))?.subidos.length, 1);
  }));

test("el servicio, al arrancar, llama a poner al día el diario una vez, antes del primer respaldo; y si eso falla lo dice y sigue respaldando", async () => {
  let ahora = new Date("2026-10-04T21:40:00-06:00").getTime();
  const orden: string[] = [];
  const dicho: string[] = [];
  let corridas = 0;
  await servicio({
    horario: leerHorario("22:00,23:00"), zona: PATIO, reintento: 5 * 60_000,
    reloj: () => new Date(ahora),
    dormir: async (ms) => { ahora += ms; },
    ultimo: async () => new Date("2026-10-04T21:00:05-06:00"),
    alArrancar: async () => { orden.push("diario"); throw new Error("el depósito diario no contesta"); },
    corrida: async () => { corridas += 1; orden.push("respaldo"); },
    decir: (linea) => dicho.push(linea),
    seguir: () => corridas < 2,
  });
  assert.deepEqual(orden, ["diario", "respaldo", "respaldo"]);
  assert.ok(dicho.some((linea) => /diario/i.test(linea) && linea.includes("no contesta")), dicho.join(" | "));
});

test("por la consola, con depósito diario: respaldar ahora deja también el diario; «lista --diario» lo muestra; y «restaurar --diario» lo trae, sin combinarse con --remoto ni con un archivo", () =>
  conDiario(async ({ p, cubo, anual, llave, vigia, senalesDelDiario }) => {
    const delServidor = {
      ...cubo.entorno(cubo.servidor), ...anual.entorno(anual.servidor), DATABASE_URL: urlDe(p.base), RESPALDO_LLAVE_PUBLICA: llave.publica, RESPALDO_SELLO: claveDeSello(llave.privada),
      RESPALDO_DESTINO: cubo.destino, RESPALDO_VIGIA_URL: vigia.url,
      RESPALDO_DESTINO_DIARIO: anual.destino, RESPALDO_VIGIA_DIARIO_URL: vigia.url.replace("respaldo-de-prueba", "diario-de-prueba"),
    };
    const primero = await consola("operacion/respaldar.ts", ["ahora"], delServidor);
    assert.equal(primero.codigo, 0, primero.queja);
    const objeto = /^respaldo: (\S+\.dump\.age)$/m.exec(primero.salida)?.[1];
    assert.ok(objeto, primero.salida);
    assert.match(primero.salida, /Respaldo diario del \d{4}-\d{2}-\d{2}: \S+, subido y comprobado/);
    assert.deepEqual(senalesDelDiario().map((s) => s.que), ["bien"]);
    // El segundo del día: al de cada hora, sí; al diario, no.
    const segundo = await consola("operacion/respaldar.ts", ["ahora"], delServidor);
    assert.equal(segundo.codigo, 0, segundo.queja);
    assert.ok(!/Respaldo diario del/.test(segundo.salida), segundo.salida);

    // En otra máquina, con las credenciales de recuperación: cada lista es la de su depósito.
    const delDueno = { ...cubo.entorno(cubo.recuperacion), ...anual.entorno(anual.recuperacion), RESPALDO_DESTINO: cubo.destino, RESPALDO_DESTINO_DIARIO: anual.destino };
    const deCadaHora = await consola("operacion/respaldar.ts", ["lista"], delDueno);
    const diarios = await consola("operacion/respaldar.ts", ["lista", "--diario"], delDueno);
    assert.match(deCadaHora.salida, /\b2 respaldos\b/);
    assert.match(diarios.salida, /\b1 respaldo\b/);
    assert.ok(diarios.salida.includes(objeto));
    const sinDecirCual = await consola("operacion/respaldar.ts", ["lista", "--diario"], { ...delDueno, RESPALDO_DESTINO_DIARIO: "" });
    assert.equal(sinDecirCual.codigo, 1);
    assert.match(sinDecirCual.queja, /RESPALDO_DESTINO_DIARIO/);

    await conDestino(async (destino, admin) => {
      const paraRestaurar = { ...delDueno, DATABASE_URL: urlEn(LIMPIO, destino), WEB_BD_USUARIO: "feruga_prueba", WEB_BD_CLAVE: "prueba" };
      // Uno u otro: no se combinan, ni con un archivo. Se rechaza antes de tocar nada.
      for (const args of [["--diario", "--remoto"], ["--diario", "un-archivo.dump.age"], [`--diario=${objeto}`, "--remoto"]]) {
        const mal = await consola("operacion/restaurar.ts", args, paraRestaurar, llave.privada);
        assert.equal(mal.codigo, 2, args.join(" ") + ": " + mal.salida + mal.queja);
      }
      const sinDeposito = await consola("operacion/restaurar.ts", ["--diario"], { ...paraRestaurar, RESPALDO_DESTINO_DIARIO: "" }, llave.privada);
      assert.equal(sinDeposito.codigo, 2);
      assert.match(sinDeposito.queja, /RESPALDO_DESTINO_DIARIO/);
      assert.deepEqual(await basesCon(admin, destino), []);
      // Del depósito diario, el último; lo que se restaura es ese respaldo, no el más nuevo de cada hora.
      const bien = await consola("operacion/restaurar.ts", ["--diario"], paraRestaurar, llave.privada);
      assert.equal(bien.codigo, 0, bien.salida + bien.queja);
      assert.ok(bien.salida.includes(objeto), bien.salida);
      assert.deepEqual(await basesCon(admin, destino), [destino]);
    });
    // Y por su nombre.
    await conDestino(async (destino, admin) => {
      const paraRestaurar = { ...delDueno, DATABASE_URL: urlEn(LIMPIO, destino), WEB_BD_USUARIO: "feruga_prueba", WEB_BD_CLAVE: "prueba" };
      const porNombre = await consola("operacion/restaurar.ts", [`--diario=${objeto}`], paraRestaurar, llave.privada);
      assert.equal(porNombre.codigo, 0, porNombre.salida + porNombre.queja);
      assert.deepEqual(await basesCon(admin, destino), [destino]);
      const queNoEsta = await consola("operacion/restaurar.ts", ["--diario=2020/01/01/20200101T000000000Z-00000000-0000-4000-8000-000000000000.dump.age"], { ...paraRestaurar, DATABASE_URL: urlEn(LIMPIO, destino + "x") }, llave.privada);
      assert.equal(queNoEsta.codigo, 1);
      assert.match(queNoEsta.queja, /No hay un respaldo con ese nombre/);
    });
  }));
