// El manifiesto de una publicación: lo que queda escrito, antes de cada paso, para que quien retome
// una publicación que murió a la mitad sepa en qué iba sin suponer nada.
//
// Tiene cuatro marcas que solo avanzan —empezó la migración, no se publica, se decidió abrir,
// abierta— y un cierre que se escribe una vez. Con eso y con lo que dice la base se decide cómo
// recuperar, con una tabla que se lee en orden y se queda en la primera que se cumple. Si la
// identidad no coincide o falta evidencia, no se elige el caso más cómodo: se detiene.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import disco, { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  anotarPaso, anotarRespaldo, anotarVigia, cerrar, crear, decidir, escribirDurable, faltasDeLoQueCorre, fijarBase, identificador, imagenesDe, instalacion, leer, marcar, pendiente, todas, vigente,
  vuelta,
  type DeLaBase, type Manifiesto, type Nueva,
} from "../operacion/publicacion.ts";
import { ESQUEMA_ESPERADO } from "../src/servidor/esquema.ts";

const MARCA = "11111111-1111-4111-8111-111111111111";
const OTRA_MARCA = "22222222-2222-4222-8222-222222222222";
const IMAGENES = (n: number) => ({ web: `sha256:${String(n).repeat(64)}`, migracion: `sha256:${String(n + 1).repeat(64)}` });
const T = (minuto: number) => new Date(Date.UTC(2026, 9, 6, 21, minuto, 0));

const conCarpeta = async (prueba: (carpeta: string) => Promise<void>): Promise<void> => {
  const raiz = await mkdtemp(join(tmpdir(), "publicaciones-"));
  try {
    await prueba(join(raiz, "publicaciones"));
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
};

/**
 * Mientras corre `f`, anota qué se asegura en disco (cada `sync`, por su ruta), y hace fallar el de
 * las rutas que diga `falla`: como un disco que renombró el archivo y no alcanzó a asegurarlo.
 */
async function espiando<T>(f: (asegurado: string[]) => Promise<T>, falla: (ruta: string) => boolean = () => false): Promise<T> {
  const abrir = disco.open;
  const asegurado: string[] = [];
  disco.open = (async (...args: Parameters<typeof abrir>) => {
    const abierto = await abrir(...args);
    const ruta = String(args[0]);
    const sync = abierto.sync.bind(abierto);
    abierto.sync = async () => {
      if (falla(ruta)) throw Object.assign(new Error(`no se pudo asegurar ${ruta}`), { code: "EIO" });
      await sync();
      asegurado.push(ruta);
    };
    return abierto;
  }) as typeof abrir;
  syncBuiltinESMExports();
  try {
    return await f(asegurado);
  } finally {
    disco.open = abrir;
    syncBuiltinESMExports();
  }
}

/** La primera publicación de una instalación: todavía no hay base ni nada que corra. */
const primera = (publicacion: string): Nueva => ({
  publicacion, commit: "abc123def4567890", base: { marca: null, publicacion: null },
  candidato: { imagenes: IMAGENES(1), configuracion: `${publicacion}/conjunto.json`, esquema: "0026_mantenimiento.sql" },
});
/** Una publicación sobre una instalación que ya atiende. */
const siguiente = (publicacion: string, laDeAntes: string | null, n = 3): Nueva => ({
  publicacion, commit: "fedcba9876543210", base: { marca: MARCA, publicacion: laDeAntes },
  candidato: { imagenes: IMAGENES(n), configuracion: `${publicacion}/conjunto.json`, esquema: "0027_otra.sql" },
});

/** Publica la primera, entera, y la deja cerrada como buena. */
async function instalar(carpeta: string): Promise<Manifiesto> {
  const id = identificador(T(0), "abc123def4567890", "000001");
  await crear(carpeta, primera(id), T(0));
  await marcar(carpeta, id, "empezoLaMigracion", T(1));
  await fijarBase(carpeta, id, MARCA);
  await marcar(carpeta, id, "seDecidioAbrir", T(2));
  await marcar(carpeta, id, "abierta", T(3));
  return cerrar(carpeta, id, "publicada", {}, T(4));
}
/** Una segunda publicación recién escrita, con el respaldo anotado si se pide. */
async function empezar(carpeta: string, o: { respaldo?: boolean } = {}): Promise<Manifiesto> {
  const uno = await instalar(carpeta);
  const id = identificador(T(10), "fedcba9876543210", "000002");
  await crear(carpeta, siguiente(id, uno.publicacion), T(10));
  return o.respaldo ? anotarRespaldo(carpeta, id, "2026/10/06/20261006T211100Z-0a0a0a0a-0b0b-4c0c-8d0d-0e0e0e0e0e0e.dump.age") : leer(carpeta, id);
}

// ── escribir ───────────────────────────────────────────────────────────────

test("el identificador de una publicación es suyo: lleva la hora, el commit y algo al azar, y sirve de nombre de carpeta y de etiqueta", () => {
  const id = identificador(T(5), "abc123def4567890aaaa", "9f3a1c");
  assert.equal(id, "20261006T210500Z-abc123def456-9f3a1c");
  assert.notEqual(identificador(T(5), "abc123def4567890"), identificador(T(5), "abc123def4567890"), "dos publicaciones del mismo commit a la misma hora se llamarían igual");
  assert.match(identificador(T(5), "abc123def4567890"), /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}-[0-9a-f]{6}$/);
  assert.throws(() => identificador(T(5), "no es un commit"), /commit/);
});

test("se escribe para sobrevivir a un apagón: a un archivo aparte, sincronizado, renombrado, y sincronizada su carpeta — en ese orden", async () => {
  const pasos: string[] = [];
  const archivo = (ruta: string) => ({
    writeFile: async (texto: string) => { pasos.push(`escribir ${ruta} (${texto.length})`); },
    sync: async () => { pasos.push(`sincronizar ${ruta}`); },
    close: async () => { pasos.push(`cerrar ${ruta}`); },
  });
  await escribirDurable("/p/x/manifiesto.json", "{}\n", {
    open: async (ruta, modo, permisos) => {
      pasos.push(`abrir ${ruta} ${modo}${permisos === undefined ? "" : ` ${permisos.toString(8)}`}`);
      return archivo(ruta);
    },
    rename: async (de, a) => { pasos.push(`renombrar ${de} → ${a}`); },
    rm: async () => { pasos.push("borrar"); },
  });
  const aparte = /^abrir (\/p\/x\/manifiesto\.json\.\S+\.nuevo) wx 600$/.exec(pasos[0]!)?.[1];
  assert.ok(aparte, `no escribió a un archivo aparte, nuevo y privado: ${pasos[0]}`);
  assert.deepEqual(pasos.slice(1), [
    `escribir ${aparte} (3)`, `sincronizar ${aparte}`, `cerrar ${aparte}`,
    `renombrar ${aparte} → /p/x/manifiesto.json`,
    "abrir /p/x r", "sincronizar /p/x", "cerrar /p/x",
  ]);
});

test("si no se pudo escribir, falla y no deja el archivo a medias ni toca el que había", () =>
  conCarpeta(async (carpeta) => {
    await mkdir(carpeta, { recursive: true });
    const ruta = join(carpeta, "algo.json");
    await escribirDurable(ruta, "uno\n");
    assert.equal(await readFile(ruta, "utf8"), "uno\n");
    assert.equal((await stat(ruta)).mode & 0o777, 0o600);
    const real = await import("node:fs/promises");
    await assert.rejects(
      escribirDurable(ruta, "dos\n", { open: real.open, rm: real.rm, rename: async () => { throw new Error("disco lleno"); } }),
      /disco lleno/,
    );
    assert.equal(await readFile(ruta, "utf8"), "uno\n");
    assert.deepEqual(await readdir(carpeta), ["algo.json"]);
  }));

// Lo encontró Codex en su décima revisión. Una escritura cuyo renombre se vio pero cuya carpeta no se alcanzó a
// asegurar falla, como debe; pero al repetirla se encontraba la anotación ya puesta y se daba por hecha, sin asegurar
// nada. Un apagón después podía llevarse, por ejemplo, la marca de una migración que ya había empezado.
test("una anotación que no se alcanzó a asegurar en disco no se da por hecha al repetirla, ni al leerla: se asegura otra vez, y si no se puede, falla", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const id = m.publicacion;
    const suCarpeta = join(carpeta, id);
    const suManifiesto = join(suCarpeta, "manifiesto.json");
    // El disco deja asegurar la carpeta de la publicación una vez más —al leer el manifiesto para anotarle algo— y
    // ya no: la escritura que sigue alcanza a renombrar el archivo, y no a asegurar ese renombre.
    const seRompe = () => {
      let veces = 0;
      return (ruta: string) => ruta === suCarpeta && ++veces > 1;
    };
    const asegurados = (asegurado: string[]) => asegurado.includes(suManifiesto) && asegurado.includes(suCarpeta);

    // La marca: falla al escribirla; repetirla, con el disco igual, sigue fallando; y quien la lee tampoco la cree.
    await espiando(async () => {
      await assert.rejects(marcar(carpeta, id, "empezoLaMigracion", T(11)), /no se pudo asegurar/);
      assert.equal(JSON.parse(await readFile(suManifiesto, "utf8")).marcas.empezoLaMigracion, T(11).toISOString(), "el renombre sí se vio: de eso se trata");
      await assert.rejects(marcar(carpeta, id, "empezoLaMigracion", T(12)), /no se pudo asegurar/);
      await assert.rejects(leer(carpeta, id), /no se pudo asegurar/);
      await assert.rejects(pendiente(carpeta), /no se pudo asegurar/);
    }, seRompe());
    // Vuelve el disco: repetir asegura lo que había —el archivo y su carpeta— y lo confirma, sin cambiarle la hora.
    assert.ok(asegurados(await espiando(async (asegurado) => {
      assert.equal((await marcar(carpeta, id, "empezoLaMigracion", T(13))).marcas.empezoLaMigracion, T(11).toISOString());
      return asegurado;
    })), "repetir la marca no volvió a asegurar el manifiesto y su carpeta");

    // Lo mismo con cada anotación que se puede repetir: el registro de la vuelta, y el cierre.
    await espiando(async () => {
      await assert.rejects(anotarPaso(carpeta, id, "detener", "antes", undefined, T(14)), /no se pudo asegurar/);
      assert.equal(JSON.parse(await readFile(join(suCarpeta, "vuelta.json"), "utf8")).pasos.detener.antes, T(14).toISOString());
      await assert.rejects(anotarPaso(carpeta, id, "detener", "antes", undefined, T(15)), /no se pudo asegurar/);
      await assert.rejects(vuelta(carpeta, id), /no se pudo asegurar/);
    }, seRompe());
    assert.ok((await espiando(async (asegurado) => {
      await anotarPaso(carpeta, id, "detener", "antes", undefined, T(16));
      return asegurado;
    })).includes(join(suCarpeta, "vuelta.json")));
    await espiando(async () => {
      await assert.rejects(cerrar(carpeta, id, "restaurada", { marca: OTRA_MARCA }, T(17)), /no se pudo asegurar/);
      assert.equal(JSON.parse(await readFile(suManifiesto, "utf8")).cierre.en, T(17).toISOString());
      await assert.rejects(cerrar(carpeta, id, "restaurada", { marca: OTRA_MARCA }, T(18)), /no se pudo asegurar/);
      await assert.rejects(vigente(carpeta), /no se pudo asegurar/);
    }, seRompe());
    assert.ok(asegurados(await espiando(async (asegurado) => {
      assert.equal((await cerrar(carpeta, id, "restaurada", { marca: OTRA_MARCA }, T(19))).cierre?.en, T(17).toISOString());
      return asegurado;
    })));
  }));

test("el respaldo anotado, la base fijada y el nombre de la instalación tampoco se dan por buenos sin asegurarlos", () =>
  conCarpeta(async (carpeta) => {
    const id = identificador(T(0), "abc123def4567890", "000001");
    // El nombre de la instalación se escribe al crear la primera: si no se aseguró, la siguiente vez no se usa sin más.
    await espiando(async () => {
      await assert.rejects(crear(carpeta, primera(id), T(0)), /no se pudo asegurar/);
      await assert.rejects(instalacion(carpeta), /no se pudo asegurar/);
    }, (ruta) => ruta === carpeta);
    const nombre = await espiando(async (asegurado) => {
      const n = await instalacion(carpeta);
      assert.ok(asegurado.includes(join(carpeta, "instalacion")) && asegurado.includes(carpeta), "leer el nombre de la instalación no lo aseguró");
      return n;
    });
    const m = await crear(carpeta, primera(id), T(1));
    assert.equal(m.instalacion, nombre);
    // La base fijada y el respaldo anotado: la escritura renombra y no alcanza a asegurar; repetirla no la da por hecha.
    const suCarpeta = join(carpeta, id);
    const seRompe = () => {
      let veces = 0;
      return (ruta: string) => ruta === suCarpeta && ++veces > 1;
    };
    await espiando(async () => {
      await assert.rejects(fijarBase(carpeta, id, MARCA), /no se pudo asegurar/);
      assert.equal(JSON.parse(await readFile(join(suCarpeta, "manifiesto.json"), "utf8")).base.marca, MARCA);
      await assert.rejects(fijarBase(carpeta, id, MARCA), /no se pudo asegurar/);
    }, seRompe());
    assert.equal((await fijarBase(carpeta, id, MARCA)).base.marca, MARCA);
    const respaldo = "2026/10/06/20261006T211100Z-0a0a0a0a-0b0b-4c0c-8d0d-0e0e0e0e0e0e.dump.age";
    await espiando(async () => {
      await assert.rejects(anotarRespaldo(carpeta, id, respaldo), /no se pudo asegurar/);
      assert.equal(JSON.parse(await readFile(join(suCarpeta, "manifiesto.json"), "utf8")).respaldo.nombre, respaldo);
      await assert.rejects(anotarRespaldo(carpeta, id, respaldo), /no se pudo asegurar/);
    }, seRompe());
    assert.equal((await anotarRespaldo(carpeta, id, respaldo)).respaldo?.nombre, respaldo);
  }));

// Lo señaló Codex en su décima revisión, como hipótesis: no se puede ensayar un apagón, pero el orden sí se ve.
test("si la carpeta de publicaciones no existía, al crearla queda asegurado también su nombre en la carpeta que la contiene", () =>
  conCarpeta(async (carpeta) => {
    // Con dos niveles por crear: cada uno queda asegurado en el de arriba.
    const honda = join(dirname(carpeta), "a", "publicaciones");
    const id = identificador(T(0), "abc123def4567890", "000001");
    const asegurado = await espiando(async (a) => {
      await crear(honda, primera(id), T(0));
      return a;
    });
    for (const padre of [dirname(carpeta), join(dirname(carpeta), "a")]) assert.ok(asegurado.includes(padre), `no se aseguró ${padre}`);
    // La segunda vez no hay nada que crear: se asegura la carpeta que la contiene —siempre—, y nada más arriba.
    await cerrar(honda, (await marcar(honda, id, "noSePublica", T(1))).publicacion, "no publicada", {}, T(2));
    const otra = identificador(T(10), "abc123def4567890", "000002");
    const despues = await espiando(async (a) => {
      await crear(honda, primera(otra), T(10));
      return a;
    });
    assert.ok(despues.includes(join(dirname(carpeta), "a")) && !despues.includes(dirname(carpeta)));
  }));

// Lo encontró Codex al verificar lo de arriba: que la carpeta ya exista no dice que su nombre haya llegado a disco.
test("si asegurar la carpeta de publicaciones falló al crearla, el reintento no la da por asegurada porque ya exista", () =>
  conCarpeta(async (carpeta) => {
    const id = identificador(T(0), "abc123def4567890", "000001");
    const dondeEsta = dirname(carpeta);
    await espiando(async () => {
      await assert.rejects(crear(carpeta, primera(id), T(0)), /no se pudo asegurar/);
      assert.ok(existsSync(carpeta), "la carpeta sí se creó: de eso se trata");
      // Otra vez, con el disco igual: la carpeta ya está, y su nombre sigue sin asegurarse.
      await assert.rejects(crear(carpeta, primera(id), T(1)), /no se pudo asegurar/);
      assert.deepEqual((await readdir(carpeta)).filter((n) => !n.startsWith(".")), [], "escribió una publicación en una carpeta que un apagón todavía se puede llevar");
    }, (ruta) => ruta === dondeEsta);
    const asegurado = await espiando(async (a) => {
      await crear(carpeta, primera(id), T(2));
      return a;
    });
    assert.ok(asegurado.includes(dondeEsta), "el reintento no aseguró la carpeta que contiene a la de publicaciones");
  }));

test("una publicación cuya carpeta no se alcanzó a asegurar con su nombre no se lee como pendiente, ni se le anota nada", () =>
  conCarpeta(async (carpeta) => {
    const id = identificador(T(0), "abc123def4567890", "000001");
    // El disco deja de asegurar la carpeta de publicaciones justo cuando la de esta publicación ya tiene su nombre:
    // el renombre se vio, y no quedó asegurado.
    const seRompio = (ruta: string): boolean => ruta === carpeta && existsSync(join(carpeta, id));
    await espiando(async () => {
      await assert.rejects(crear(carpeta, primera(id), T(0)), /no se pudo asegurar/);
      assert.ok(existsSync(join(carpeta, id, "manifiesto.json")), "la publicación sí quedó a la vista: de eso se trata");
      await assert.rejects(pendiente(carpeta), /no se pudo asegurar/);
      await assert.rejects(leer(carpeta, id), /no se pudo asegurar/);
      await assert.rejects(marcar(carpeta, id, "empezoLaMigracion", T(1)), /no se pudo asegurar/);
      assert.equal(JSON.parse(await readFile(join(carpeta, id, "manifiesto.json"), "utf8")).marcas.empezoLaMigracion, null, "anotó que empieza la migración de una publicación que un apagón se puede llevar");
    }, seRompio);
    // Vuelve el disco: leerla la asegura —también su nombre, en la carpeta de publicaciones—, y ya se puede seguir.
    const asegurado = await espiando(async (a) => {
      assert.equal((await pendiente(carpeta))?.publicacion, id);
      return a;
    });
    assert.ok(asegurado.includes(carpeta), "leer la publicación no aseguró su nombre en la carpeta de publicaciones");
    assert.ok((await marcar(carpeta, id, "empezoLaMigracion", T(2))).marcas.empezoLaMigracion);
  }));

test("la primera publicación crea la carpeta —privada— y le da nombre a la instalación, que ya no cambia", () =>
  conCarpeta(async (carpeta) => {
    const id = identificador(T(0), "abc123def4567890", "000001");
    const m = await crear(carpeta, primera(id), T(0));
    assert.equal((await stat(carpeta)).mode & 0o777, 0o700);
    assert.equal((await stat(join(carpeta, id, "manifiesto.json"))).mode & 0o777, 0o600);
    assert.deepEqual(
      { formato: m.formato, publicacion: m.publicacion, numero: m.numero, creada: m.creada, anterior: m.anterior, respaldo: m.respaldo, marcas: m.marcas, cierre: m.cierre, base: m.base },
      {
        formato: 1, publicacion: id, numero: 1, creada: "2026-10-06T21:00:00.000Z", anterior: null, respaldo: null,
        marcas: { empezoLaMigracion: null, noSePublica: null, seDecidioAbrir: null, abierta: null }, cierre: null, base: { marca: null, publicacion: null },
      },
    );
    assert.match(m.instalacion, /^[0-9a-f]{12}$/);
    assert.equal(await instalacion(carpeta), m.instalacion);
    assert.deepEqual(await leer(carpeta, id), m);
  }));

test("la que sigue lleva, como conjunto anterior, lo que la última publicada dejó corriendo; y no se escribe si habla de otra base", () =>
  conCarpeta(async (carpeta) => {
    const uno = await instalar(carpeta);
    assert.deepEqual(await vigente(carpeta), { publicacion: uno.publicacion, commit: uno.commit, conjunto: { imagenes: IMAGENES(1), configuracion: `${uno.publicacion}/conjunto.json` }, base: { marca: MARCA } });
    const id = identificador(T(10), "fedcba9876543210", "000002");
    await assert.rejects(crear(carpeta, { ...siguiente(id, uno.publicacion), base: { marca: OTRA_MARCA, publicacion: uno.publicacion } }, T(10)), /otra base/);
    await assert.rejects(crear(carpeta, { ...siguiente(id, uno.publicacion), base: { marca: null, publicacion: null } }, T(10)), /otra base/);
    assert.deepEqual((await todas(carpeta)).map((m) => m.publicacion), [uno.publicacion]);
    const dos = await crear(carpeta, siguiente(id, uno.publicacion), T(10));
    assert.deepEqual([dos.numero, dos.instalacion, dos.anterior], [2, uno.instalacion, { publicacion: uno.publicacion, imagenes: IMAGENES(1), configuracion: `${uno.publicacion}/conjunto.json` }]);
  }));

test("una sola publicación sin cerrar: mientras haya una, no se escribe otra; ni dos con el mismo identificador", () =>
  conCarpeta(async (carpeta) => {
    const pendienteAhora = await empezar(carpeta);
    assert.equal((await pendiente(carpeta))?.publicacion, pendienteAhora.publicacion);
    const otra = identificador(T(20), "fedcba9876543210", "000003");
    await assert.rejects(crear(carpeta, siguiente(otra, pendienteAhora.publicacion), T(20)), new RegExp(`sin cerrar.*${pendienteAhora.publicacion}`, "s"));
    assert.equal((await todas(carpeta)).length, 2);
    // Cerrada esa, la siguiente no puede reusar su identificador.
    await marcar(carpeta, pendienteAhora.publicacion, "noSePublica", T(11));
    await marcar(carpeta, pendienteAhora.publicacion, "seDecidioAbrir", T(12));
    await marcar(carpeta, pendienteAhora.publicacion, "abierta", T(13));
    await cerrar(carpeta, pendienteAhora.publicacion, "no publicada", {}, T(14));
    assert.equal(await pendiente(carpeta), null);
    await assert.rejects(crear(carpeta, siguiente(pendienteAhora.publicacion, pendienteAhora.publicacion), T(20)), /ya existe/);
  }));

test("un manifiesto que no se lee, que no se entiende o que no es el de su carpeta detiene todo: no significa «no hay nada pendiente»", () =>
  conCarpeta(async (carpeta) => {
    const uno = await instalar(carpeta);
    const ruta = join(carpeta, uno.publicacion, "manifiesto.json");
    const bueno = await readFile(ruta, "utf8");
    const id = identificador(T(10), "fedcba9876543210", "000002");
    const todoSeDetiene = async (porQue: RegExp): Promise<void> => {
      await assert.rejects(todas(carpeta), porQue);
      await assert.rejects(pendiente(carpeta), porQue);
      await assert.rejects(vigente(carpeta), porQue);
      await assert.rejects(crear(carpeta, siguiente(id, uno.publicacion), T(10)), porQue);
    };
    for (const [malo, porQue] of [
      ["{ esto no es JSON", /no se entiende/],
      [JSON.stringify({ ...JSON.parse(bueno), formato: 2 }), /formato/],
      [JSON.stringify({ ...JSON.parse(bueno), publicacion: id }), /no es el de su carpeta/],
      [JSON.stringify({ ...JSON.parse(bueno), marcas: { empezoLaMigracion: null } }), /no se entiende/],
      [JSON.stringify({ ...JSON.parse(bueno), cierre: { como: "medio publicada", en: "2026-10-06T21:04:00.000Z" } }), /no se entiende/],
      ["", /no se entiende/],
      // Marcas que no pudieron darse así: abierta sin haberse decidido; decidida sin migrar ni desistir; migrada y desistida.
      [JSON.stringify({ ...JSON.parse(bueno), marcas: { ...JSON.parse(bueno).marcas, seDecidioAbrir: null } }), /sus marcas se contradicen/],
      [JSON.stringify({ ...JSON.parse(bueno), marcas: { ...JSON.parse(bueno).marcas, empezoLaMigracion: null } }), /sus marcas se contradicen/],
      [JSON.stringify({ ...JSON.parse(bueno), marcas: { ...JSON.parse(bueno).marcas, noSePublica: "2026-10-06T21:01:00.000Z" } }), /sus marcas se contradicen/],
    ] as const) {
      await writeFile(ruta, malo);
      await todoSeDetiene(porQue);
    }
    // Una carpeta de publicación sin su manifiesto, igual.
    await rm(ruta);
    await todoSeDetiene(/no tiene manifiesto/);
    await writeFile(ruta, bueno);
    assert.equal((await todas(carpeta)).length, 1);
    // Y una carpeta que no se puede leer.
    if (process.getuid?.() !== 0) {
      await chmod(join(carpeta, uno.publicacion), 0o000);
      try {
        await todoSeDetiene(/./);
      } finally {
        await chmod(join(carpeta, uno.publicacion), 0o700);
      }
    }
  }));

// Lo encontró Codex en su décima revisión: el cierre se validaba al escribirlo y no al leerlo. Un manifiesto que
// dijera «publicada» sin haber migrado ni abierto se creía, y su candidata pasaba por ser lo que corre.
test("un cierre que no pudo darse así no se cree: se lee con las mismas reglas con que se escribe, y todo se detiene", () =>
  conCarpeta(async (carpeta) => {
    const uno = await instalar(carpeta);
    const leido = async (publicacion: string) => JSON.parse(await readFile(join(carpeta, publicacion, "manifiesto.json"), "utf8"));
    const noSeCree = async (publicacion: string, cambios: (m: any) => any): Promise<void> => {
      const ruta = join(carpeta, publicacion, "manifiesto.json");
      const bueno = await readFile(ruta, "utf8");
      await writeFile(ruta, JSON.stringify(cambios(JSON.parse(bueno))));
      try {
        for (const pregunta of [todas, pendiente, vigente]) await assert.rejects(pregunta(carpeta), /su cierre no pudo darse así/);
      } finally {
        await writeFile(ruta, bueno);
      }
      assert.ok((await todas(carpeta)).length > 0, "el manifiesto bueno dejó de leerse");
    };
    const sinMarcas = { empezoLaMigracion: null, noSePublica: null, seDecidioAbrir: null, abierta: null };

    // «Publicada» sin haber migrado ni abierto; sin base; con una marca de base que no le toca; o con algo de más.
    await noSeCree(uno.publicacion, (m) => ({ ...m, marcas: sinMarcas }));
    await noSeCree(uno.publicacion, (m) => ({ ...m, base: { ...m.base, marca: null } }));
    await noSeCree(uno.publicacion, (m) => ({ ...m, cierre: { ...m.cierre, marca: OTRA_MARCA } }));
    await noSeCree(uno.publicacion, (m) => ({ ...m, cierre: { ...m.cierre, por: "otra" } }));
    // «No publicada» habiendo migrado; «restaurada» sin conjunto anterior al que volver; y el relevo, que no existe todavía.
    await noSeCree(uno.publicacion, (m) => ({ ...m, cierre: { ...m.cierre, como: "no publicada" } }));
    await noSeCree(uno.publicacion, (m) => ({ ...m, marcas: { ...m.marcas, seDecidioAbrir: null, abierta: null }, cierre: { ...m.cierre, como: "restaurada", marca: OTRA_MARCA } }));
    await noSeCree(uno.publicacion, (m) => ({ ...m, cierre: { ...m.cierre, como: "sustituida" } }));

    // Una que se restauró de verdad: su cierre dice la marca de la base que quedó, que es otra.
    const dos = identificador(T(10), "fedcba9876543210", "000002");
    await crear(carpeta, siguiente(dos, uno.publicacion), T(10));
    await anotarRespaldo(carpeta, dos, "2026/10/06/20261006T211100Z-0a0a0a0a-0b0b-4c0c-8d0d-0e0e0e0e0e0e.dump.age");
    await marcar(carpeta, dos, "empezoLaMigracion", T(11));
    await cerrar(carpeta, dos, "restaurada", { marca: OTRA_MARCA }, T(12));
    await noSeCree(dos, (m) => ({ ...m, cierre: { como: m.cierre.como, en: m.cierre.en } }));
    await noSeCree(dos, (m) => ({ ...m, cierre: { ...m.cierre, marca: MARCA } }));
    await noSeCree(dos, (m) => ({ ...m, cierre: { ...m.cierre, marca: "no-es-una-marca" } }));
    await noSeCree(dos, (m) => ({ ...m, marcas: { ...m.marcas, seDecidioAbrir: T(12).toISOString() } }));
    await noSeCree(dos, (m) => ({ ...m, marcas: sinMarcas }));

    // Una que desistió: con un conjunto anterior, se cierra cuando ese volvió a abrir.
    const tres = identificador(T(20), "fedcba9876543210", "000003");
    await crear(carpeta, { ...siguiente(tres, uno.publicacion), base: { marca: OTRA_MARCA, publicacion: uno.publicacion } }, T(20));
    await marcar(carpeta, tres, "noSePublica", T(21));
    await marcar(carpeta, tres, "seDecidioAbrir", T(22));
    await marcar(carpeta, tres, "abierta", T(23));
    await cerrar(carpeta, tres, "no publicada", {}, T(24));
    await noSeCree(tres, (m) => ({ ...m, marcas: { ...m.marcas, seDecidioAbrir: null, abierta: null } }));
    await noSeCree(tres, (m) => ({ ...m, marcas: sinMarcas }));
    assert.deepEqual((await leido(tres)).cierre.como, "no publicada");
    assert.equal((await todas(carpeta)).length, 3);
  }));

test("dos publicaciones sin cerrar, o dos con el mismo número, no pueden ser: si las hay, alguien tocó la carpeta, y todo se detiene", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta);
    const otra = identificador(T(20), "fedcba9876543210", "000003");
    const copia = async (cambios: Partial<Manifiesto>): Promise<void> => {
      await mkdir(join(carpeta, otra), { recursive: true });
      await writeFile(join(carpeta, otra, "manifiesto.json"), JSON.stringify({ ...m, publicacion: otra, ...cambios }));
    };
    await copia({ numero: 3 });
    await assert.rejects(pendiente(carpeta), /más de una publicación sin cerrar/);
    await assert.rejects(marcar(carpeta, m.publicacion, "noSePublica", T(21)).then(() => pendiente(carpeta)), /más de una publicación sin cerrar/);
    await copia({ numero: 2 });
    for (const pregunta of [todas, pendiente, vigente]) await assert.rejects(pregunta(carpeta), /el mismo número/);
  }));

// ── las marcas ─────────────────────────────────────────────────────────────

test("las marcas solo avanzan: repetir una no la cambia, y cada una pide las que van antes", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const id = m.publicacion;
    await assert.rejects(marcar(carpeta, id, "abierta", T(11)), /sin haberse decidido/);
    await assert.rejects(marcar(carpeta, id, "seDecidioAbrir", T(11)), /ni empezó la migración ni se desistió/);
    const migrando = await marcar(carpeta, id, "empezoLaMigracion", T(11));
    assert.equal(migrando.marcas.empezoLaMigracion, "2026-10-06T21:11:00.000Z");
    // Repetirla —se perdió la respuesta— no cambia nada: ni la hora.
    assert.deepEqual(await marcar(carpeta, id, "empezoLaMigracion", T(15)), migrando);
    // Empezada la migración ya no se puede decir «no se publica»: la base ya pudo cambiar.
    await assert.rejects(marcar(carpeta, id, "noSePublica", T(12)), /ya empezó la migración/);
    const decidida = await marcar(carpeta, id, "seDecidioAbrir", T(12));
    assert.deepEqual(await marcar(carpeta, id, "seDecidioAbrir", T(16)), decidida);
    const abierta = await marcar(carpeta, id, "abierta", T(13));
    assert.deepEqual(abierta.marcas, {
      empezoLaMigracion: "2026-10-06T21:11:00.000Z", noSePublica: null, seDecidioAbrir: "2026-10-06T21:12:00.000Z", abierta: "2026-10-06T21:13:00.000Z",
    });
    assert.deepEqual(await leer(carpeta, id), abierta);
  }));

test("sin el respaldo anotado no se migra; el respaldo se anota una vez, y antes de migrar", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta);
    const id = m.publicacion;
    await assert.rejects(marcar(carpeta, id, "empezoLaMigracion", T(11)), /sin el respaldo anotado no se migra/);
    assert.equal((await leer(carpeta, id)).marcas.empezoLaMigracion, null);
    await assert.rejects(anotarRespaldo(carpeta, id, "el último"), /no es el nombre de un respaldo/);
    const nombre = "2026/10/06/20261006T211100Z-0a0a0a0a-0b0b-4c0c-8d0d-0e0e0e0e0e0e.dump.age";
    const con = await anotarRespaldo(carpeta, id, nombre);
    assert.deepEqual(con.respaldo, { nombre, vigia: null });
    assert.deepEqual(await anotarRespaldo(carpeta, id, nombre), con);
    // Su nombre es el suyo aunque después haya otro más nuevo.
    await assert.rejects(anotarRespaldo(carpeta, id, nombre.replace("211100", "211500")), /ya tiene anotado su respaldo/);
    // Que el vigilante se haya enterado o no, se anota aparte: el respaldo vale igual.
    assert.deepEqual((await anotarVigia(carpeta, id, false)).respaldo, { nombre, vigia: false });
    await marcar(carpeta, id, "empezoLaMigracion", T(12));
    // La primera publicación no tiene qué respaldar: no hay base. Y ya migrando, no se le anota uno después.
    await conCarpeta(async (otra) => {
      const primeraVez = identificador(T(0), "abc123def4567890", "000001");
      await crear(otra, primera(primeraVez), T(0));
      assert.ok((await marcar(otra, primeraVez, "empezoLaMigracion", T(1))).marcas.empezoLaMigracion);
      await assert.rejects(anotarRespaldo(otra, primeraVez, nombre), /ya empezó a migrar/);
      assert.equal((await leer(otra, primeraVez)).respaldo, null);
    });
  }));

test("«no se publica» y «empezó la migración» se excluyen; decidido abrir, ya no hay vuelta", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const id = m.publicacion;
    const desistida = await marcar(carpeta, id, "noSePublica", T(11));
    assert.deepEqual(await marcar(carpeta, id, "noSePublica", T(15)), desistida);
    await assert.rejects(marcar(carpeta, id, "empezoLaMigracion", T(12)), /ya se dijo que no se publica/);
    await marcar(carpeta, id, "seDecidioAbrir", T(12));
    await marcar(carpeta, id, "abierta", T(13));
    assert.equal((await leer(carpeta, id)).marcas.empezoLaMigracion, null);
    // Y al revés: decidido abrir con la candidata, no se puede desistir.
    await conCarpeta(async (otra) => {
      const b = await empezar(otra, { respaldo: true });
      await marcar(otra, b.publicacion, "empezoLaMigracion", T(11));
      await marcar(otra, b.publicacion, "seDecidioAbrir", T(12));
      await assert.rejects(marcar(otra, b.publicacion, "noSePublica", T(13)), /ya empezó la migración|ya se decidió abrir/);
    });
  }));

// Lo encontró Codex en su décima revisión: la primera publicación, desistida, podía anotar que «se decidió abrir» un
// conjunto anterior que no existe, y recuperar contestaba que había que terminar de abrirlo.
test("la primera publicación, si desiste, no tiene conjunto anterior que abrir: no se decide, no se cree un manifiesto que lo diga, y si lo dice la base, se detiene", () =>
  conCarpeta(async (carpeta) => {
    const id = identificador(T(0), "abc123def4567890", "000001");
    await crear(carpeta, primera(id), T(0));
    const desistida = await marcar(carpeta, id, "noSePublica", T(1));
    await assert.rejects(marcar(carpeta, id, "seDecidioAbrir", T(2)), /no hay un conjunto anterior que abrir/);
    const ruta = join(carpeta, id, "manifiesto.json");
    const bueno = await readFile(ruta, "utf8");
    await writeFile(ruta, JSON.stringify({ ...desistida, marcas: { ...desistida.marcas, seDecidioAbrir: T(2).toISOString() } }));
    await assert.rejects(leer(carpeta, id), /sus marcas se contradicen/);
    await writeFile(ruta, bueno);
    // Si es la base la que dice que esta publicación decidió abrir, tampoco hay qué abrir: no se elige nada.
    const d = decidir(desistida, { base: { marca: MARCA, abierta: false, publicacion: id, decidida: true, abrio: false } });
    assert.match((d as { detenerse: string }).detenerse, /no hay un conjunto anterior que abrir/);
    // Lo que sí hace: cerrarse como no publicada, sin haber abierto nada. No queda nada vigente.
    assert.equal((await cerrar(carpeta, id, "no publicada", {}, T(3))).cierre?.como, "no publicada");
    assert.equal(await vigente(carpeta), null);
  }));

test("la base de la primera publicación se fija una vez, cuando ya existe; la de las demás no se cambia", () =>
  conCarpeta(async (carpeta) => {
    const id = identificador(T(0), "abc123def4567890", "000001");
    await crear(carpeta, primera(id), T(0));
    await assert.rejects(fijarBase(carpeta, id, "no es una marca"), /marca/);
    const fijada = await fijarBase(carpeta, id, MARCA);
    assert.equal(fijada.base.marca, MARCA);
    assert.deepEqual(await fijarBase(carpeta, id, MARCA), fijada);
    await assert.rejects(fijarBase(carpeta, id, OTRA_MARCA), /otra base/);
  }));

// ── el cierre ──────────────────────────────────────────────────────────────

test("cerrar como publicada pide haber abierto con la candidata; desde entonces ese es el conjunto vigente, y el manifiesto ya no cambia", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const id = m.publicacion;
    await assert.rejects(cerrar(carpeta, id, "publicada", {}, T(11)), /no abrió/);
    await marcar(carpeta, id, "empezoLaMigracion", T(11));
    await marcar(carpeta, id, "seDecidioAbrir", T(12));
    await assert.rejects(cerrar(carpeta, id, "publicada", {}, T(12)), /no abrió/);
    await marcar(carpeta, id, "abierta", T(13));
    await assert.rejects(cerrar(carpeta, id, "no publicada", {}, T(14)), /abrió con la versión nueva/);
    assert.equal((await vigente(carpeta))?.publicacion, m.anterior!.publicacion, "antes de cerrar ya contaba como vigente");
    const cerrada = await cerrar(carpeta, id, "publicada, con el respaldo sin arrancar", {}, T(14));
    assert.deepEqual(cerrada.cierre, { como: "publicada, con el respaldo sin arrancar", en: "2026-10-06T21:14:00.000Z" });
    assert.deepEqual(await vigente(carpeta), { publicacion: id, commit: m.commit, conjunto: { imagenes: IMAGENES(3), configuracion: `${id}/conjunto.json` }, base: { marca: MARCA } });
    assert.equal(await pendiente(carpeta), null);
    // Repetir el mismo cierre no cambia nada; otro cierre, o cualquier otra anotación, se rechaza.
    assert.deepEqual(await cerrar(carpeta, id, "publicada, con el respaldo sin arrancar", {}, T(20)), cerrada);
    await assert.rejects(cerrar(carpeta, id, "publicada", {}, T(20)), /ya está cerrada/);
    await assert.rejects(marcar(carpeta, id, "abierta", T(20)), /ya está cerrada/);
    await assert.rejects(anotarVigia(carpeta, id, true), /ya está cerrada/);
    assert.deepEqual(await leer(carpeta, id), cerrada);
  }));

test("cerrar como no publicada pide haber desistido y haber vuelto a abrir; el conjunto vigente sigue siendo el de antes", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta);
    const id = m.publicacion;
    await assert.rejects(cerrar(carpeta, id, "no publicada", {}, T(11)), /no se había dicho que no se publica/);
    await marcar(carpeta, id, "noSePublica", T(11));
    await assert.rejects(cerrar(carpeta, id, "no publicada", {}, T(11)), /no volvió a abrir/);
    await marcar(carpeta, id, "seDecidioAbrir", T(12));
    await marcar(carpeta, id, "abierta", T(13));
    await assert.rejects(cerrar(carpeta, id, "publicada", {}, T(14)), /se dijo que no se publica/);
    await cerrar(carpeta, id, "no publicada", {}, T(14));
    assert.equal((await vigente(carpeta))?.publicacion, m.anterior!.publicacion);
    // La primera vez no hay conjunto anterior que volver a abrir: basta con desistir.
    await conCarpeta(async (otra) => {
      const primeraVez = identificador(T(0), "abc123def4567890", "000001");
      await crear(otra, primera(primeraVez), T(0));
      await marcar(otra, primeraVez, "noSePublica", T(1));
      await cerrar(otra, primeraVez, "no publicada", {}, T(2));
      assert.equal(await vigente(otra), null);
      assert.equal(await pendiente(otra), null);
    });
  }));

test("cerrar como restaurada: solo desde una migración empezada y sin abrir, y dice la marca de la base que quedó; el conjunto vigente es el anterior, sobre esa base", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const id = m.publicacion;
    await assert.rejects(cerrar(carpeta, id, "restaurada", { marca: OTRA_MARCA }, T(11)), /no empezó la migración/);
    await marcar(carpeta, id, "empezoLaMigracion", T(11));
    await assert.rejects(cerrar(carpeta, id, "restaurada", {}, T(12)), /marca/);
    await assert.rejects(cerrar(carpeta, id, "restaurada", { marca: MARCA }, T(12)), /la misma marca/);
    const cerrada = await cerrar(carpeta, id, "restaurada", { marca: OTRA_MARCA }, T(12));
    assert.deepEqual(cerrada.cierre, { como: "restaurada", en: "2026-10-06T21:12:00.000Z", marca: OTRA_MARCA });
    const uno = (await todas(carpeta))[0]!;
    assert.deepEqual(await vigente(carpeta), { publicacion: uno.publicacion, commit: uno.commit, conjunto: { imagenes: IMAGENES(1), configuracion: `${uno.publicacion}/conjunto.json` }, base: { marca: OTRA_MARCA } });
    // Ya se decidió abrir: de ahí no se vuelve al respaldo.
    await conCarpeta(async (otra) => {
      const b = await empezar(otra, { respaldo: true });
      await marcar(otra, b.publicacion, "empezoLaMigracion", T(11));
      await marcar(otra, b.publicacion, "seDecidioAbrir", T(12));
      await assert.rejects(cerrar(otra, b.publicacion, "restaurada", { marca: OTRA_MARCA }, T(13)), /ya se decidió abrir/);
    });
  }));

// ── volver al respaldo previo: su registro de pasos ───────────────────────

test("volver al respaldo previo lleva su propio registro: cada paso con su «antes» y su «después», en orden, y repetir una anotación no la cambia", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const id = m.publicacion;
    // Solo desde una migración empezada y sin decidir abrir: de cualquier otro estado no se vuelve al respaldo.
    await assert.rejects(anotarPaso(carpeta, id, "detener", "antes", undefined, T(11)), /no empezó la migración/);
    assert.equal(await vuelta(carpeta, id), null);
    await marcar(carpeta, id, "empezoLaMigracion", T(11));
    assert.equal(await vuelta(carpeta, id), null);

    await assert.rejects(anotarPaso(carpeta, id, "detener", "despues", undefined, T(12)), /sin haber anotado que empezaba/);
    await assert.rejects(anotarPaso(carpeta, id, "apartar", "antes", "feruga_fallida_2", T(12)), /falta terminar «detener»/);
    const uno = await anotarPaso(carpeta, id, "detener", "antes", undefined, T(12));
    assert.deepEqual(uno.pasos, { detener: { antes: "2026-10-06T21:12:00.000Z", despues: null, detalle: null } });
    assert.deepEqual(await anotarPaso(carpeta, id, "detener", "antes", undefined, T(20)), uno);
    await assert.rejects(anotarPaso(carpeta, id, "apartar", "antes", "feruga_fallida_2", T(13)), /falta terminar «detener»/);
    const detenido = await anotarPaso(carpeta, id, "detener", "despues", undefined, T(13));
    // Repetir cualquiera de las dos, ya terminado el paso, lo deja como estaba.
    assert.deepEqual(await anotarPaso(carpeta, id, "detener", "despues", undefined, T(21)), detenido);
    assert.deepEqual(await anotarPaso(carpeta, id, "detener", "antes", undefined, T(22)), detenido);
    assert.equal(detenido.pasos.detener!.despues, "2026-10-06T21:13:00.000Z");
    // El detalle de un paso —a qué nombre se apartó la base, qué marca tiene la restaurada— se anota una vez.
    await anotarPaso(carpeta, id, "apartar", "antes", "feruga_fallida_2", T(14));
    await assert.rejects(anotarPaso(carpeta, id, "apartar", "antes", "feruga_fallida_3", T(15)), /ya tiene anotado otro detalle/);
    await anotarPaso(carpeta, id, "apartar", "despues", undefined, T(15));
    await anotarPaso(carpeta, id, "restaurar", "antes", undefined, T(16));
    await anotarPaso(carpeta, id, "restaurar", "despues", OTRA_MARCA, T(17));
    await assert.rejects(anotarPaso(carpeta, id, "restaurar", "despues", MARCA, T(18)), /ya tiene anotado otro detalle/);
    await anotarPaso(carpeta, id, "levantar", "antes", undefined, T(18));
    const todo = await anotarPaso(carpeta, id, "levantar", "despues", undefined, T(19));
    assert.deepEqual(Object.keys(todo.pasos), ["detener", "apartar", "restaurar", "levantar"]);
    assert.deepEqual([todo.pasos.apartar, todo.pasos.restaurar], [
      { antes: "2026-10-06T21:14:00.000Z", despues: "2026-10-06T21:15:00.000Z", detalle: "feruga_fallida_2" },
      { antes: "2026-10-06T21:16:00.000Z", despues: "2026-10-06T21:17:00.000Z", detalle: OTRA_MARCA },
    ]);
    assert.deepEqual(await vuelta(carpeta, id), todo);
    assert.equal((await stat(join(carpeta, id, "vuelta.json"))).mode & 0o777, 0o600);
    // Ya decidido abrir, no se vuelve al respaldo: ni se empieza a anotar.
    await conCarpeta(async (otra) => {
      const b = await empezar(otra, { respaldo: true });
      await marcar(otra, b.publicacion, "empezoLaMigracion", T(11));
      await marcar(otra, b.publicacion, "seDecidioAbrir", T(12));
      await assert.rejects(anotarPaso(otra, b.publicacion, "detener", "antes", undefined, T(13)), /ya se decidió abrir/);
    });
    // Un registro que no se entiende detiene la vuelta: roto, de otra publicación, o con un paso que no existe.
    for (const malo of ["{ a medias", JSON.stringify({ ...todo, publicacion: "otra" }), JSON.stringify({ ...todo, pasos: { tirar: todo.pasos.detener } }), JSON.stringify({ ...todo, formato: 2 })]) {
      await writeFile(join(carpeta, id, "vuelta.json"), malo);
      await assert.rejects(vuelta(carpeta, id), /no se entiende/, malo.slice(0, 40));
      await assert.rejects(anotarPaso(carpeta, id, "levantar", "despues", undefined, T(20)), /no se entiende/);
    }
    // Y cerrada la publicación —ya se volvió—, su registro no se toca más.
    await writeFile(join(carpeta, id, "vuelta.json"), JSON.stringify(todo));
    await cerrar(carpeta, id, "restaurada", { marca: OTRA_MARCA }, T(23));
    await assert.rejects(anotarPaso(carpeta, id, "levantar", "despues", undefined, T(24)), /ya está cerrada/);
  }));

// ── recuperar: la tabla ────────────────────────────────────────────────────

/** Lo que dice la base de una instalación que atiende, abierta por esa publicación. */
const atendiendo = (porCual: string | null, marca = MARCA): DeLaBase => ({ marca, abierta: true, publicacion: porCual, decidida: porCual !== null, abrio: porCual !== null });
const cerradaPor = (cual: string, o: { decidida?: boolean } = {}): DeLaBase => ({ marca: MARCA, abierta: false, publicacion: cual, decidida: o.decidida === true, abrio: false });

test("recuperar, caso 3: ni se decidió abrir ni empezó la migración → se restablece el conjunto anterior. Que el negocio siga atendiendo por la publicación anterior no es señal de esta", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta);
    const laDeAntes = m.anterior!.publicacion;
    // Murió después de escribir el manifiesto y antes de cerrar: la base sigue abierta, por la anterior.
    assert.deepEqual(decidir(m, { base: atendiendo(laDeAntes) }), { caso: 3 });
    // Murió después de cerrar, o ya con el respaldo: cerrada por esta, sin más.
    assert.deepEqual(decidir(m, { base: cerradaPor(m.publicacion) }), { caso: 3 });
    assert.deepEqual(decidir(await anotarRespaldo(carpeta, m.publicacion, "2026/10/06/20261006T211100Z-0a0a0a0a-0b0b-4c0c-8d0d-0e0e0e0e0e0e.dump.age"), { base: cerradaPor(m.publicacion) }), { caso: 3 });
    // Ya se había dicho que no se publica: se sigue por ahí.
    assert.deepEqual(decidir(await marcar(carpeta, m.publicacion, "noSePublica", T(12)), { base: cerradaPor(m.publicacion) }), { caso: 3 });
  }));

test("recuperar, caso 2: empezó la migración y no hay ninguna señal de apertura → se queda cerrado, y no se repite ni se vuelve solo", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const migrando = await marcar(carpeta, m.publicacion, "empezoLaMigracion", T(11));
    assert.deepEqual(decidir(migrando, { base: cerradaPor(m.publicacion) }), { caso: 2 });
  }));

test("recuperar, caso 1: se decidió abrir o ya abrió —lo diga el manifiesto O la base— → se termina hacia adelante, aunque también diga «empezó la migración»", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const id = m.publicacion;
    const migrando = await marcar(carpeta, id, "empezoLaMigracion", T(11));
    // Lo dice solo la base: se anotó ahí, y el manifiesto no alcanzó a decirlo (o se perdió).
    assert.deepEqual(decidir(migrando, { base: cerradaPor(id, { decidida: true }) }), { caso: 1, conjunto: "candidato" });
    assert.deepEqual(decidir(migrando, { base: atendiendo(id) }), { caso: 1, conjunto: "candidato" });
    // Lo dice solo el manifiesto: murió después de anotarlo y antes de anotarlo en la base.
    const decidida = await marcar(carpeta, id, "seDecidioAbrir", T(12));
    assert.deepEqual(decidir(decidida, { base: cerradaPor(id) }), { caso: 1, conjunto: "candidato" });
    // Abrió y se perdió la respuesta; o abrió, se cobró algo y murió el guion.
    assert.deepEqual(decidir(decidida, { base: atendiendo(id) }), { caso: 1, conjunto: "candidato" });
    assert.deepEqual(decidir(await marcar(carpeta, id, "abierta", T(13)), { base: atendiendo(id) }), { caso: 1, conjunto: "candidato" });
  }));

test("recuperar, caso 1 de una que no se publica: lo que se termina de abrir es el conjunto anterior", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta);
    const id = m.publicacion;
    await marcar(carpeta, id, "noSePublica", T(11));
    const decidida = await marcar(carpeta, id, "seDecidioAbrir", T(12));
    assert.deepEqual(decidir(decidida, { base: cerradaPor(id) }), { caso: 1, conjunto: "anterior" });
    assert.deepEqual(decidir(decidida, { base: atendiendo(id) }), { caso: 1, conjunto: "anterior" });
  }));

test("recuperar se detiene si la identidad no coincide o falta evidencia: otra base, otra publicación, una base que no contesta", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const id = m.publicacion;
    const migrando = await marcar(carpeta, id, "empezoLaMigracion", T(11));
    for (const manifiesto of [m, migrando]) {
      assert.match((decidir(manifiesto, { base: "no contesta" }) as { detenerse: string }).detenerse, /no contesta/);
      assert.match((decidir(manifiesto, { base: "no hay" }) as { detenerse: string }).detenerse, /No hay base/);
      assert.match((decidir(manifiesto, { base: { ...cerradaPor(id), marca: OTRA_MARCA } }) as { detenerse: string }).detenerse, /otra base/);
      // La base dice que la cerró o la abrió una publicación que no es esta ni la que había al empezar.
      assert.match((decidir(manifiesto, { base: cerradaPor("20261006T215000Z-fedcba987654-00000f") }) as { detenerse: string }).detenerse, /otra publicación/);
      assert.match((decidir(manifiesto, { base: atendiendo(null) }) as { detenerse: string }).detenerse, /otra publicación/);
    }
    // Decidida y todo: con otra base, tampoco se termina hacia adelante.
    const decidida = await marcar(carpeta, id, "seDecidioAbrir", T(12));
    assert.match((decidir(decidida, { base: { ...atendiendo(id), marca: OTRA_MARCA } }) as { detenerse: string }).detenerse, /otra base/);
    // Una ya cerrada no se recupera.
    await marcar(carpeta, id, "abierta", T(13));
    assert.match((decidir(await cerrar(carpeta, id, "publicada", {}, T(14)), { base: atendiendo(id) }) as { detenerse: string }).detenerse, /ya está cerrada/);
  }));

test("recuperar la primera publicación: sin base y sin haber empezado a migrar, no hay nada que restablecer; con la migración empezada, hace falta la base", () =>
  conCarpeta(async (carpeta) => {
    const id = identificador(T(0), "abc123def4567890", "000001");
    const m = await crear(carpeta, primera(id), T(0));
    assert.deepEqual(decidir(m, { base: "no hay" }), { caso: 3 });
    const migrando = await marcar(carpeta, id, "empezoLaMigracion", T(1));
    // Murió con la migración recién anotada, antes de que la base naciera: es el mismo caso que si ya hubiera nacido
    // —empezó la migración y nadie decidió abrir—. Qué se hace con él en una primera publicación lo sabe el guion.
    assert.deepEqual(decidir(migrando, { base: "no hay" }), { caso: 2 });
    // Migró: la base nació abierta y sin publicación; todavía no se fijó su marca en el manifiesto.
    assert.deepEqual(decidir(migrando, { base: atendiendo(null) }), { caso: 2 });
    const conBase = await fijarBase(carpeta, id, MARCA);
    assert.deepEqual(decidir(conBase, { base: cerradaPor(id) }), { caso: 2 });
    // Ya sabía cuál era su base, y ya no está: eso no es «todavía no nace».
    assert.match((decidir(conBase, { base: "no hay" }) as { detenerse: string }).detenerse, /No hay base/);
    assert.match((decidir(conBase, { base: { ...cerradaPor(id), marca: OTRA_MARCA } }) as { detenerse: string }).detenerse, /otra base/);
    assert.deepEqual(decidir(conBase, { base: cerradaPor(id, { decidida: true }) }), { caso: 1, conjunto: "candidato" });
  }));

// ── qué corre ──────────────────────────────────────────────────────────────

const HUELLA = (n: number) => String(n).repeat(64);
/** Un contenedor como lo describe `docker inspect`, con lo que aquí se mira. */
const contenedor = (servicio: string, imagen: string, huella: string, o: { corre?: boolean; salud?: string; suelto?: boolean } = {}) => ({
  Name: `/feruga-${servicio}-1`,
  Image: imagen,
  State: { Running: o.corre ?? true, ...(o.salud ? { Health: { Status: o.salud } } : {}) },
  Config: { Labels: { "com.docker.compose.service": servicio, "com.docker.compose.config-hash": huella, "com.docker.compose.oneoff": o.suelto ? "True" : "False" } },
});

test("lo que corre es el conjunto: cada servicio, una vez, andando, con la imagen del manifiesto y la configuración que se guardó", () => {
  const imagenes = { web: `sha256:${HUELLA(1)}`, db: `sha256:${HUELLA(2)}`, proxy: `sha256:${HUELLA(3)}` };
  const esperado = { web: HUELLA(7), db: HUELLA(8) };
  const bien = [contenedor("web", imagenes.web, HUELLA(7), { salud: "healthy" }), contenedor("db", imagenes.db, HUELLA(8))];
  assert.deepEqual(faltasDeLoQueCorre(imagenes, esperado, bien), []);
  // Lo que no se pidió mirar no estorba; ni un contenedor suelto de ese servicio (un «run»).
  assert.deepEqual(faltasDeLoQueCorre(imagenes, esperado, [...bien, contenedor("proxy", "sha256:otra", "x"), contenedor("web", "sha256:otra", "x", { suelto: true })]), []);

  const con = (cambio: ReturnType<typeof contenedor>[]): string => faltasDeLoQueCorre(imagenes, esperado, cambio).join(" | ");
  assert.match(con([bien[1]!]), /web no está corriendo: no hay contenedor/);
  assert.match(con([contenedor("web", imagenes.web, HUELLA(7), { corre: false }), bien[1]!]), /web no está corriendo: su contenedor está detenido/);
  assert.match(con([contenedor("web", imagenes.web, HUELLA(7), { salud: "unhealthy" }), bien[1]!]), /web no está sano/);
  assert.match(con([contenedor("web", `sha256:${HUELLA(9)}`, HUELLA(7)), bien[1]!]), /web corre con otra imagen/);
  assert.match(con([contenedor("web", imagenes.web, HUELLA(5)), bien[1]!]), /web corre con otra configuración/);
  assert.match(con([...bien, contenedor("web", imagenes.web, HUELLA(7))]), /hay 2 contenedores de web/);
  // Todo lo que no coincide, de una vez.
  assert.equal(faltasDeLoQueCorre(imagenes, esperado, []).length, 2);
  // Pedir que se mire un servicio que el conjunto no tiene es un error de quien pregunta, no «todo bien».
  assert.match(faltasDeLoQueCorre(imagenes, { respaldo: HUELLA(1) }, bien).join(" | "), /respaldo no es parte de este conjunto/);
});

// Lo encontró Codex en su décima revisión: un servicio de más en la configuración no entraba al inventario de
// imágenes —podía ir por etiqueta, y hasta traer cómo construirse— y nada lo echaba de menos al comprobar.
test("el conjunto es el que es: un servicio que no es de este sistema no entra en la configuración, vaya como vaya", () => {
  const pub = identificador(T(0), "abc123def4567890", "000001");
  const con = (cambios: Record<string, unknown>) => () => imagenesDe(resuelta(pub, 1, cambios), pub);
  assert.deepEqual(Object.keys(imagenesDe(resuelta(pub, 1), pub)).sort(), ["db", "migracion", "proxy", "respaldo", "web"]);
  assert.throws(con({ extra: { image: "extra:latest", build: { context: "." } } }), /extra no es un servicio de este sistema/);
  assert.throws(con({ extra: { image: "extra:latest" } }), /extra no es un servicio de este sistema/);
  // Ni aunque vaya por su identificador: nadie lo guardaría fuera ni lo miraría al comprobar.
  assert.throws(con({ extra: { image: ID(9) } }), /extra no es un servicio de este sistema/);
  // En un ensayo, lo que en el servidor está fuera —el almacenamiento, el vigilante— corre junto, y se dice cuál es.
  const delEnsayo = resuelta(pub, 1, { almacen: { image: "minio:de-ensayo", build: { context: "docker" } }, vigia: { image: "node:24-alpine" } });
  assert.deepEqual(Object.keys(imagenesDe(delEnsayo, pub, ["almacen", "vigia"])).sort(), ["db", "migracion", "proxy", "respaldo", "web"]);
  assert.throws(() => imagenesDe(delEnsayo, pub, ["almacen"]), /vigia no es un servicio de este sistema/);
  // Lo propio no se puede declarar «de fuera» para sacarlo del inventario.
  assert.throws(() => imagenesDe(resuelta(pub, 1), pub, ["web"]), /web es de este sistema/);
  // Lo encontró Codex al verificar: un servicio que se llame como algo que todo objeto de JavaScript «tiene» pasaba por conocido.
  for (const nombre of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const conEse = JSON.stringify({ services: { ...JSON.parse(resuelta(pub, 1)).services, [nombre]: { image: "extra:latest" } } });
    assert.ok(conEse.includes(`"${nombre}":`), "el servicio de prueba no quedó en la configuración");
    assert.throws(() => imagenesDe(conEse, pub), new RegExp(`${nombre} no es un servicio de este sistema`), nombre);
  }
});

test("comprobar el conjunto completo: lo que se pidió mirar, y nada más corriendo", () => {
  const imagenes = { web: `sha256:${HUELLA(1)}`, db: `sha256:${HUELLA(2)}`, proxy: `sha256:${HUELLA(3)}`, respaldo: `sha256:${HUELLA(4)}` };
  const esperado = { web: HUELLA(7), db: HUELLA(8) };
  const bien = [contenedor("web", imagenes.web, HUELLA(7)), contenedor("db", imagenes.db, HUELLA(8))];
  const completo = (hay: ReturnType<typeof contenedor>[], deFuera: string[] = []) => faltasDeLoQueCorre(imagenes, esperado, hay, { nadaMas: true, deFuera }).join(" | ");
  assert.equal(completo(bien), "");
  // Uno de más, corriendo: sea de un servicio del conjunto que aquí no se esperaba, o de uno que nadie conoce.
  assert.match(completo([...bien, contenedor("proxy", imagenes.proxy, HUELLA(9))]), /corre proxy, que aquí no se esperaba/);
  assert.match(completo([...bien, contenedor("extra", "sha256:otra", "x")]), /corre extra, que aquí no se esperaba/);
  // Lo que no corre —quedó detenido— y lo de un «run» no cuentan: no atienden nada.
  assert.equal(completo([...bien, contenedor("respaldo", imagenes.respaldo, "x", { corre: false }), contenedor("migracion", "sha256:otra", "x", { suelto: true })]), "");
  // En un ensayo, lo que se declaró de fuera corre junto y no es una falta.
  assert.equal(completo([...bien, contenedor("almacen", "sha256:otra", "x")], ["almacen"]), "");
  // Sin pedir «nada más», sigue siendo la comprobación de un paso intermedio: mira lo que se le pide.
  assert.deepEqual(faltasDeLoQueCorre(imagenes, esperado, [...bien, contenedor("proxy", imagenes.proxy, HUELLA(9))]), []);
  // Lo encontró Codex al verificar: un contenedor de más cuyo servicio se llame como algo que todo objeto «tiene» no se escapa.
  for (const nombre of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.match(completo([...bien, contenedor(nombre, "sha256:otra", "x")]), new RegExp(`corre ${nombre}, que aquí no se esperaba`), nombre);
  }
});

// ── por la línea de órdenes, como la usa el guion ──────────────────────────

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const ID = (n: number) => `sha256:${String(n).repeat(64)}`;
/** La configuración resuelta de un conjunto, como la da `docker compose config --format json`, con lo que aquí se mira. */
const resuelta = (publicacion: string, n: number, cambios: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name: "feruga",
    services: {
      db: { image: ID(n) }, migracion: { image: ID(n + 1) }, consola: { image: ID(n + 1) },
      web: { image: ID(n + 2), environment: { VERSION: publicacion } },
      comprobacion: { image: ID(n + 3) }, respaldo: { image: ID(n + 3) }, proxy: { image: ID(n + 4) },
      ...cambios,
    },
  });
const SIN_BASE = JSON.stringify({ base: "no hay" });
const estadoDe = (base: DeLaBase): string => JSON.stringify({ base, esquema: "0026_mantenimiento.sql", motivo: null, sesiones: 0 });

function orden(carpeta: string, args: string[], entrada = ""): Promise<{ codigo: number | null; salida: string; queja: string }> {
  return new Promise((listo) => {
    const hijo = spawn("node", ["operacion/publicacion.ts", carpeta, ...args], { cwd: RAIZ });
    let salida = "";
    let queja = "";
    hijo.stdout.on("data", (d) => { salida += d; });
    hijo.stderr.on("data", (d) => { queja += d; });
    hijo.on("close", (codigo) => listo({ codigo, salida: salida.trim(), queja: queja.trim() }));
    hijo.stdin.end(entrada);
  });
}
/** La orden tiene que salir bien; devuelve lo que dijo. */
async function bien(carpeta: string, args: string[], entrada = ""): Promise<string> {
  const r = await orden(carpeta, args, entrada);
  assert.equal(r.codigo, 0, `${args.join(" ")}: ${r.queja}`);
  return r.salida;
}
/** La orden tiene que fallar con ese código, quejándose de eso. */
async function mal(carpeta: string, args: string[], porQue: RegExp, entrada = "", codigo = 1): Promise<void> {
  const r = await orden(carpeta, args, entrada);
  assert.equal(r.codigo, codigo, `${args.join(" ")}: salió con ${r.codigo}: ${r.salida} ${r.queja}`);
  assert.match(r.queja, porQue);
}

test("por la línea de órdenes: la primera publicación, de principio a fin, y lo que el guion le pregunta", () =>
  conCarpeta(async (carpeta) => {
    assert.equal(await bien(carpeta, ["pendiente"]), "");
    assert.equal(await bien(carpeta, ["vigente"]), "");
    const pub = await bien(carpeta, ["identificador", "abc123def4567890"]);
    assert.match(pub, /^[0-9]{8}T[0-9]{6}Z-abc123def456-[0-9a-f]{6}$/);
    await bien(carpeta, ["crear", pub, "abc123def4567890", SIN_BASE], resuelta(pub, 1));
    // Guardó la configuración resuelta —privada—, y de ella sacó las imágenes.
    assert.equal(await readFile(join(carpeta, pub, "conjunto.json"), "utf8"), resuelta(pub, 1));
    assert.equal((await stat(join(carpeta, pub, "conjunto.json"))).mode & 0o777, 0o600);
    const m = await leer(carpeta, pub);
    assert.deepEqual(m.candidato, {
      imagenes: { db: ID(1), migracion: ID(2), web: ID(3), respaldo: ID(4), proxy: ID(5) },
      configuracion: `${pub}/conjunto.json`, esquema: ESQUEMA_ESPERADO,
    });
    assert.equal(await bien(carpeta, ["pendiente"]), pub);
    assert.equal(await bien(carpeta, ["dato", pub, "commit"]), "abc123def4567890");
    assert.equal(await bien(carpeta, ["dato", pub, "base.marca"]), "");
    assert.equal(await bien(carpeta, ["dato", pub, "anterior.publicacion"]), "");
    assert.equal(await bien(carpeta, ["dato", pub, "candidato.configuracion"]), `${pub}/conjunto.json`);
    assert.equal(await bien(carpeta, ["variables", pub, "candidato"]), [`IMAGEN_DB=${ID(1)}`, `IMAGEN_ADMIN=${ID(2)}`, `IMAGEN_WEB=${ID(3)}`, `IMAGEN_RESPALDO=${ID(4)}`, `IMAGEN_PROXY=${ID(5)}`, `VERSION=${pub}`].join("\n"));
    assert.equal(await bien(carpeta, ["decidir", pub, SIN_BASE]), "3");

    await bien(carpeta, ["marcar", pub, "empezoLaMigracion"]);
    await bien(carpeta, ["base", pub, MARCA]);
    assert.equal(await bien(carpeta, ["decidir", pub, estadoDe(cerradaPor(pub))]), "2");
    await bien(carpeta, ["marcar", pub, "seDecidioAbrir"]);
    assert.equal(await bien(carpeta, ["decidir", pub, estadoDe(cerradaPor(pub))]), "1 candidato");
    await bien(carpeta, ["marcar", pub, "abierta"]);
    await bien(carpeta, ["cerrar", pub, "publicada"]);
    assert.equal(await bien(carpeta, ["pendiente"]), "");
    assert.equal(await bien(carpeta, ["vigente"]), pub);
    assert.deepEqual(
      [await bien(carpeta, ["vigente", "commit"]), await bien(carpeta, ["vigente", "marca"]), await bien(carpeta, ["vigente", "configuracion"])],
      ["abc123def4567890", MARCA, `${pub}/conjunto.json`],
    );
    assert.equal(await bien(carpeta, ["variables", "vigente"]), await bien(carpeta, ["variables", pub, "candidato"]));
  }));

test("por la línea de órdenes: la que sigue pide una base que atiende, abierta y la misma; anota su respaldo; y si no se publica, vuelve a la anterior", () =>
  conCarpeta(async (carpeta) => {
    const uno = await instalar(carpeta);
    const pub = identificador(T(10), "fedcba9876543210", "000002");
    const crear = (estado: string, conf = resuelta(pub, 3)) => orden(carpeta, ["crear", pub, "fedcba9876543210", estado], conf);
    // No se escribe sin saber de la base, ni sobre una cerrada, ni sobre una de antes del mantenimiento.
    for (const [estado, porQue] of [
      ["no-contesta", /no contesta/],
      [SIN_BASE, /otra base/],
      [JSON.stringify({ base: "sin mantenimiento", esquema: "0025_precio_especial.sql" }), /antes del mantenimiento/],
      [estadoDe({ ...atendiendo(uno.publicacion), abierta: false }), /está cerrada/],
      [estadoDe(atendiendo(uno.publicacion, OTRA_MARCA)), /otra base/],
      ["{ esto no", /no se entiende/],
      [estadoDe({ ...atendiendo(uno.publicacion), marca: "no-es-una-marca" }), /no se entiende/],
      [JSON.stringify({ base: { marca: MARCA, publicacion: uno.publicacion, decidida: true, abrio: true } }), /no se entiende/],
    ] as const) {
      const r = await crear(estado);
      assert.equal(r.codigo, 1, estado);
      assert.match(r.queja, porQue);
    }
    // Ni con una configuración que no fija cada imagen por su identificador, o que no dice qué versión contesta.
    for (const [conf, porQue] of [
      [resuelta(pub, 3, { web: { image: "feruga-web:la-de-hoy", environment: { VERSION: pub } } }), /web no va por el identificador de su imagen/],
      [resuelta(pub, 3, { web: { image: ID(5), environment: { VERSION: "otra" } } }), /VERSION/],
      [resuelta(pub, 3, { consola: { image: ID(9) } }), /consola no usa la misma imagen que migracion/],
      [resuelta(pub, 3, { web: { image: ID(5), environment: { VERSION: pub }, build: { context: "." } } }), /web trae cómo construirse/],
      ["no es una configuración", /no es la configuración resuelta/],
    ] as const) {
      const r = await crear(estadoDe(atendiendo(uno.publicacion)), conf);
      assert.equal(r.codigo, 1, conf.slice(0, 60));
      assert.match(r.queja, porQue);
    }
    assert.equal(await bien(carpeta, ["pendiente"]), "");
    assert.deepEqual((await readdir(carpeta)).sort(), ["instalacion", uno.publicacion].sort());

    assert.equal((await crear(estadoDe(atendiendo(uno.publicacion)))).codigo, 0);
    assert.equal(await bien(carpeta, ["dato", pub, "anterior.publicacion"]), uno.publicacion);
    assert.equal(await bien(carpeta, ["dato", pub, "base.publicacion"]), uno.publicacion);
    const nombre = "2026/10/06/20261006T211100Z-0a0a0a0a-0b0b-4c0c-8d0d-0e0e0e0e0e0e.dump.age";
    await mal(carpeta, ["marcar", pub, "empezoLaMigracion"], /sin el respaldo anotado no se migra/);
    await bien(carpeta, ["respaldo", pub, nombre]);
    await bien(carpeta, ["vigia", pub, "no"]);
    assert.deepEqual([await bien(carpeta, ["dato", pub, "respaldo.nombre"]), await bien(carpeta, ["dato", pub, "respaldo.vigia"])], [nombre, "false"]);
    // Se desiste: lo que se vuelve a abrir es el conjunto anterior.
    assert.equal(await bien(carpeta, ["decidir", pub, estadoDe(cerradaPor(pub))]), "3");
    await bien(carpeta, ["marcar", pub, "noSePublica"]);
    await bien(carpeta, ["marcar", pub, "seDecidioAbrir"]);
    assert.equal(await bien(carpeta, ["decidir", pub, estadoDe(cerradaPor(pub))]), "1 anterior");
    assert.equal(await bien(carpeta, ["variables", pub, "anterior"]), [`IMAGEN_ADMIN=${ID(2)}`, `IMAGEN_WEB=${ID(1)}`, `VERSION=${uno.publicacion}`].join("\n"));
    await bien(carpeta, ["marcar", pub, "abierta"]);
    await bien(carpeta, ["cerrar", pub, "no publicada"]);
    assert.equal(await bien(carpeta, ["vigente"]), uno.publicacion);
    // Recuperar se detiene con su propio código, para que el guion no lo confunda con un fallo cualquiera.
    await mal(carpeta, ["decidir", pub, estadoDe(atendiendo(pub))], /ya está cerrada/, "", 3);
    await mal(carpeta, ["decidir", uno.publicacion, "no-contesta"], /ya está cerrada/, "", 3);
  }));

test("por la línea de órdenes: el registro de la vuelta al respaldo se anota paso por paso, y se puede preguntar en qué va", () =>
  conCarpeta(async (carpeta) => {
    const m = await empezar(carpeta, { respaldo: true });
    const id = m.publicacion;
    await marcar(carpeta, id, "empezoLaMigracion", T(11));
    assert.equal(await bien(carpeta, ["vuelta", id]), "");
    await bien(carpeta, ["vuelta", id, "detener", "antes"]);
    await bien(carpeta, ["vuelta", id, "detener", "despues"]);
    await bien(carpeta, ["vuelta", id, "apartar", "antes", "feruga_fallida_2"]);
    assert.equal(await bien(carpeta, ["vuelta", id]), ["detener hecho", "apartar empezado feruga_fallida_2"].join("\n"));
    await mal(carpeta, ["vuelta", id, "restaurar", "antes"], /falta terminar «apartar»/);
    await mal(carpeta, ["vuelta", id, "tirar", "antes"], /Uso:/, "", 2);
    await mal(carpeta, ["vuelta", id, "apartar", "luego"], /Uso:/, "", 2);
  }));

test("por la línea de órdenes: sobre una base de antes del mantenimiento no se decide nada; y un dato es un dato, no un pedazo del manifiesto", () =>
  conCarpeta(async (carpeta) => {
    const pub = identificador(T(0), "abc123def4567890", "000001");
    await bien(carpeta, ["crear", pub, "abc123def4567890", SIN_BASE], resuelta(pub, 1));
    // Esa base no es «no hay»: tiene historia. Tratarla como vacía llevaría a «no hay nada que restablecer».
    await mal(carpeta, ["decidir", pub, JSON.stringify({ base: "sin mantenimiento", esquema: "0025_precio_especial.sql" })], /antes del mantenimiento/, "", 3);
    await mal(carpeta, ["dato", pub, "candidato"], /no es un dato suelto/);
    await mal(carpeta, ["dato", pub, "marcas"], /no es un dato suelto/);
    assert.equal(await bien(carpeta, ["dato", pub, "marcas.abierta"]), "");
    assert.equal(await bien(carpeta, ["dato", pub, "numero"]), "1");
  }));

test("una publicación a medio escribir no llegó a existir: no cuenta, no estorba, y la siguiente la quita", () =>
  conCarpeta(async (carpeta) => {
    const uno = await instalar(carpeta);
    const pub = identificador(T(10), "fedcba9876543210", "000002");
    // Murió mientras armaba su carpeta: quedó aparte, con lo que alcanzó a escribir.
    await mkdir(join(carpeta, `.nueva-${pub}`));
    await writeFile(join(carpeta, `.nueva-${pub}`, "conjunto.json"), "{ a medias");
    assert.deepEqual((await todas(carpeta)).map((m) => m.publicacion), [uno.publicacion]);
    assert.equal(await pendiente(carpeta), null);
    assert.equal((await vigente(carpeta))?.publicacion, uno.publicacion);
    await crear(carpeta, { ...siguiente(pub, uno.publicacion), configuracion: "{}" }, T(10));
    assert.deepEqual((await readdir(carpeta)).sort(), [uno.publicacion, pub, "instalacion"].sort());
    assert.equal(await readFile(join(carpeta, pub, "conjunto.json"), "utf8"), "{}");
  }));

test("por la línea de órdenes: la configuración de un conjunto se puede volver a guardar —cambió el entorno—, con las mismas imágenes y nada más", () =>
  conCarpeta(async (carpeta) => {
    const pub = identificador(T(0), "abc123def4567890", "000001");
    await bien(carpeta, ["crear", pub, "abc123def4567890", SIN_BASE], resuelta(pub, 1));
    const otra = resuelta(pub, 1, { web: { image: ID(3), environment: { VERSION: pub, ORIGEN: "https://otro.ejemplo.mx" } } });
    await bien(carpeta, ["conjunto", pub], otra);
    assert.equal(await readFile(join(carpeta, pub, "conjunto.json"), "utf8"), otra);
    await mal(carpeta, ["conjunto", pub], /no son las imágenes de esa publicación/, resuelta(pub, 2));
    await mal(carpeta, ["conjunto", pub], /no es la configuración resuelta/, "{}");
    assert.equal(await readFile(join(carpeta, pub, "conjunto.json"), "utf8"), otra);
  }));

test("por la línea de órdenes: «corre» compara lo que hay con el conjunto, y dice todo lo que no coincide", () =>
  conCarpeta(async (carpeta) => {
    const pub = identificador(T(0), "abc123def4567890", "000001");
    await bien(carpeta, ["crear", pub, "abc123def4567890", SIN_BASE], resuelta(pub, 1));
    const hay = JSON.stringify([contenedor("web", ID(3), HUELLA(7)), contenedor("db", ID(1), HUELLA(8))]);
    assert.equal(await bien(carpeta, ["corre", pub, "candidato", `web=${HUELLA(7)}`, `db=${HUELLA(8)}`], hay), "");
    await mal(carpeta, ["corre", pub, "candidato", `web=${HUELLA(7)}`, `db=${HUELLA(8)}`, `proxy=${HUELLA(9)}`], /proxy no está corriendo/, hay);
    await mal(carpeta, ["corre", pub, "candidato", `web=${HUELLA(6)}`], /web corre con otra configuración/, hay);
    await mal(carpeta, ["corre", pub, "anterior", `web=${HUELLA(7)}`], /no tiene conjunto anterior/, hay);
    await mal(carpeta, ["corre", pub, "candidato", `web=${HUELLA(7)}`], /docker inspect/, "esto no es JSON");
    // Sin decir qué servicios mirar no hay nada comprobado: no es «todo bien».
    await mal(carpeta, ["corre", pub, "candidato"], /Uso:/, hay, 2);
    await mal(carpeta, ["corre", pub, "candidato", "--nada-mas"], /Uso:/, hay, 2);

    // El conjunto completo: con todos los contenedores de la instalación a la vista, uno que corre de más es una falta.
    const pares = [`web=${HUELLA(7)}`, `db=${HUELLA(8)}`];
    const conOtro = JSON.stringify([...JSON.parse(hay), contenedor("almacen", "sha256:otra", "x")]);
    assert.equal(await bien(carpeta, ["corre", pub, "candidato", "--nada-mas", ...pares], hay), "");
    assert.equal(await bien(carpeta, ["corre", pub, "candidato", ...pares], conOtro), "");
    await mal(carpeta, ["corre", pub, "candidato", "--nada-mas", ...pares], /corre almacen, que aquí no se esperaba/, conOtro);
    // En un ensayo se dice qué corre junto que en el servidor está fuera; lo propio no se puede declarar así.
    assert.equal(await bien(carpeta, ["corre", pub, "candidato", "--nada-mas", "--de-fuera=almacen,vigia", ...pares], conOtro), "");
    await mal(carpeta, ["corre", pub, "candidato", "--nada-mas", "--de-fuera=proxy", ...pares], /proxy es de este sistema/, hay);
    // Una opción que no existe, repetida o que no es de esa orden no se pasa por alto.
    for (const args of [["corre", pub, "candidato", "--todo", ...pares], ["corre", pub, "candidato", "--nada-mas", "--nada-mas", ...pares], ["marcar", pub, "abierta", "--nada-mas"], ["pendiente", "--de-fuera=x"]]) {
      await mal(carpeta, args, /Uso:/, hay, 2);
    }
  }));

test("por la línea de órdenes: un servicio de más en la configuración no se guarda; en un ensayo se declara lo que corre de fuera", () =>
  conCarpeta(async (carpeta) => {
    const pub = identificador(T(0), "abc123def4567890", "000001");
    const conAlmacen = resuelta(pub, 1, { almacen: { image: "almacen:de-ensayo", build: { context: "docker" } } });
    await mal(carpeta, ["crear", pub, "abc123def4567890", SIN_BASE], /almacen no es un servicio de este sistema/, conAlmacen);
    assert.deepEqual(await readdir(carpeta).catch(() => []), []);
    await mal(carpeta, ["crear", pub, "abc123def4567890", SIN_BASE, "--de-fuera=web"], /web es de este sistema/, resuelta(pub, 1));
    await bien(carpeta, ["crear", pub, "abc123def4567890", SIN_BASE, "--de-fuera=almacen"], conAlmacen);
    assert.deepEqual(Object.keys((await leer(carpeta, pub)).candidato.imagenes).sort(), ["db", "migracion", "proxy", "respaldo", "web"]);
    // Volver a guardar la configuración pide lo mismo.
    await mal(carpeta, ["conjunto", pub], /almacen no es un servicio de este sistema/, conAlmacen);
    await bien(carpeta, ["conjunto", pub, "--de-fuera=almacen"], conAlmacen);
  }));

test("por la línea de órdenes: lo que no es una orden, o le falta algo, no hace nada y dice cómo se usa; y un fallo dice por qué", () =>
  conCarpeta(async (carpeta) => {
    for (const args of [[], ["publicar"], ["marcar"], ["marcar", "x"], ["cerrar", "x"], ["vigia", "x", "quizá"], ["dato", "x"], ["variables"], ["decidir", "x"], ["identificador"]]) {
      await mal(carpeta, args, /Uso:/, "", 2);
    }
    await mal(carpeta, ["marcar", "20261006T210000Z-abc123def456-000001", "abierta"], /no tiene manifiesto/);
    await mal(carpeta, ["marcar", "20261006T210000Z-abc123def456-000001", "terminada"], /Uso:/, "", 2);
    await mal(carpeta, ["dato", "../../etc", "commit"], /no es el identificador de una publicación/);
    assert.deepEqual(await readdir(carpeta).catch(() => []), []);
  }));
