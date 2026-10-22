// El respaldo diario, que se guarda un año. Los respaldos de cada hora duran 30 días; de cada día
// se guarda además uno —el primero que salió bien ese día— en otro depósito, que dura 365.
//
// Lo que aquí se prueba es la decisión: cuál es «el diario» de un día, cuándo un día ya lo tiene,
// y qué se hace cuando algo falla a medias. Los depósitos son de mentira —guardan en memoria y
// fallan cuando se les dice—, para poder poner el reloj y el tropiezo donde hace falta. Que de
// verdad llegue a un almacenamiento con candado se prueba en pruebas/23-respaldo.test.ts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { nombreDeManifiesto, nombreDeObjeto, selloDe, selloDeNota } from "../operacion/destino.ts";
import type { Destino, Entrada, Manifiesto, SelloAnterior } from "../operacion/destino.ts";
import { REPASAR_CADA, REVALIDAR_CADA, anotarAvisados, diaDelPatio, eleccionesEnMemoria, ponerAlDia, sinComprobar } from "../operacion/diario.ts";
import type { AlDia, Comprobados, Eleccion, Elecciones } from "../operacion/diario.ts";

const PATIO = "America/Mexico_City";      // sin cambio de horario desde 2022: seis horas detrás de UTC

type Operacion = "subir" | "bajar" | "listar";
const SELLO_DE_PRUEBA = "5e".repeat(32);

/** Un depósito en memoria. Anota lo que se le pide, y tropieza donde se le diga. */
class Deposito implements Destino {
  /** La clave del sello: la misma en el depósito de cada hora y en el diario, como en el servidor. */
  sello = SELLO_DE_PRUEBA;
  /** Los sellos de llaves que ya se cambiaron: solo comprueban lo de antes del cambio. */
  anteriores: SelloAnterior[] = [];
  objetos = new Map<string, Buffer>();
  subidas: string[] = [];
  bajadas: string[] = [];
  /**
   * Lo que debe fallar. «antes»: falla sin hacer nada (no hay red). «despues»: lo hace y falla (se
   * perdió la respuesta).
   */
  tropiezo: (operacion: Operacion, nombre: string) => "antes" | "despues" | null = () => null;
  /** Lo que el depósito guarda mal: recibe una cosa y deja otra, del mismo tamaño. */
  estropea: (nombre: string) => boolean = () => false;
  /** Lo que tarda cada operación con cada cosa, en milisegundos de un reloj de mentira: lo adelanta, sin esperar. */
  tarda: (nombre: string, operacion: Operacion) => number = () => 0;
  transcurrido = 0;
  /** El reloj de mentira, que puede ser de varios depósitos a la vez. */
  reloj: () => number = () => this.transcurrido;
  /** El plazo que se le dio a cada operación, y a qué hora de ese reloj empezó. */
  plazos: Array<{ operacion: Operacion; nombre: string; plazo: number | undefined; al: number }> = [];
  /** Algo que pasa cuando una subida ya salió y todavía no llega: para que otro corra en medio. */
  antesDeSubir: (nombre: string) => Promise<void> = async () => {};

  /** Lo que la operación tarda. Si es más que su plazo, se corta al plazo, como hace el programa que sube y baja. */
  private esperar(operacion: Operacion, nombre: string, plazo: number | undefined): void {
    this.plazos.push({ operacion, nombre, plazo, al: this.reloj() });
    const cuanto = this.tarda(nombre, operacion);
    if (plazo !== undefined && cuanto > plazo) {
      this.transcurrido += plazo;
      throw new Error("se acabó el plazo de la operación");
    }
    this.transcurrido += cuanto;
  }

  async subir(archivo: string, nombre: string, plazo?: number): Promise<void> {
    const como = this.tropiezo("subir", nombre);
    if (como === "antes") throw new Error("el depósito no contesta");
    const recibido = await readFile(archivo);
    this.esperar("subir", nombre, plazo);
    await this.antesDeSubir(nombre);
    this.objetos.set(nombre, this.estropea(nombre) ? Buffer.alloc(recibido.length, "?") : recibido);
    this.subidas.push(nombre);
    if (como === "despues") throw new Error("se perdió la respuesta");
  }

  async bajar(nombre: string, archivo: string, plazo?: number): Promise<void> {
    if (this.tropiezo("bajar", nombre)) throw new Error("el depósito no contesta");
    this.bajadas.push(nombre);
    this.esperar("bajar", nombre, plazo);
    const contenido = this.objetos.get(nombre);
    if (!contenido) throw new Error(`No está en el destino: ${nombre}`);
    await writeFile(archivo, contenido);
  }

  async listar(plazo?: number): Promise<Entrada[]> {
    if (this.tropiezo("listar", "")) throw new Error("el depósito no contesta");
    this.esperar("listar", "", plazo);
    return [...this.objetos].map(([nombre, contenido]) => ({ nombre, bytes: contenido.length }));
  }

  /** Los respaldos que tiene: los objetos cifrados, en orden. */
  respaldos(): string[] {
    return [...this.objetos.keys()].filter((n) => n.endsWith(".dump.age")).sort();
  }
}

let cuenta = 0;

/** Deja en el depósito un respaldo de cada hora, tomado en ese instante, como lo deja quien respalda. Devuelve su nombre. */
function respaldoDe(
  deposito: Deposito, instante: string,
  como: { sinManifiesto?: boolean; manifiestoDanado?: boolean; nombreDeAntes?: boolean; archivoDanado?: boolean; sello?: string } = {},
): string {
  cuenta += 1;
  const corrida = `00000000-0000-4000-8000-${String(cuenta).padStart(12, "0")}`;
  // El nombre de antes llevaba el momento solo al segundo: dos del mismo segundo no se ordenan por su nombre.
  const objeto = como.nombreDeAntes ? nombreDeObjeto(new Date(instante), corrida).replace(/(T\d{6})\d{3}Z-/, "$1Z-") : nombreDeObjeto(new Date(instante), corrida);
  const contenido = Buffer.from(`lo cifrado del respaldo de ${instante} (${corrida})`);
  const dicho: Omit<Manifiesto, "sello"> = {
    formato: 1, corrida, instantanea: new Date(instante).toISOString(), objeto, bytes: contenido.length,
    sha256: createHash("sha256").update(contenido).digest("hex"), pgDump: "pg_dump (PostgreSQL) 17.6", llavePublica: "age1" + "q".repeat(58),
    esquema: "0025_precio_especial.sql",
  };
  const manifiesto: Manifiesto = { ...dicho, sello: selloDe(dicho, como.sello ?? SELLO_DE_PRUEBA) };
  // Dañado: lo que quedó guardado pesa lo mismo y no es lo que dice su manifiesto.
  deposito.objetos.set(objeto, como.archivoDanado ? Buffer.alloc(contenido.length, "#") : contenido);
  if (!como.sinManifiesto) deposito.objetos.set(nombreDeManifiesto(objeto), Buffer.from(como.manifiestoDanado ? "{ no es json" : JSON.stringify(manifiesto, null, 2) + "\n"));
  return objeto;
}

interface AlCorrer {
  /** Si el vigilante recibe el aviso de los huecos. Por omisión, sí: y entonces quedan anotados. */
  avisa?: boolean;
  turno?: () => Promise<void>;
  /** Cuánto puede tardar la corrida, en milisegundos del reloj de mentira de los depósitos. */
  presupuesto?: number;
}

interface Mundo {
  origen: Deposito;
  diario: Deposito;
  dicho: string[];
  /** Donde queda decidida la elección de cada día: la base. Sobrevive a reiniciar el servicio. */
  elecciones: Elecciones;
  /** Como si la base se hubiera restaurado de un respaldo de antes: ya no trae las elecciones. */
  restaurarLaBase(): void;
  /**
   * Una corrida a esa hora (UTC), en el mismo proceso que las anteriores: recuerda lo que ya
   * comprobó. Como quien respalda, avisa de los huecos y, si el aviso llegó, lo deja anotado.
   */
  correr(ahora: string, o?: AlCorrer): Promise<AlDia>;
  /** Como si el servicio se hubiera reiniciado: ya no recuerda nada de lo comprobado. */
  reiniciar(): void;
}

function mundo(): Mundo {
  const [origen, diario] = [new Deposito(), new Deposito()];
  origen.reloj = diario.reloj = () => origen.transcurrido + diario.transcurrido;
  const dicho: string[] = [];
  let comprobados: Comprobados = sinComprobar();
  let registro = eleccionesEnMemoria();
  // La misma vista siempre, aunque la base se «restaure»: quien la tiene en la mano sigue viendo la de ahora.
  const elecciones: Elecciones = { de: (dia) => registro.de(dia), fijar: (e) => registro.fijar(e) };
  return {
    origen, diario, dicho, elecciones,
    restaurarLaBase: () => { registro = eleccionesEnMemoria(); },
    correr: async (ahora, o = {}) => {
      const p = {
        origen, diario, zona: PATIO, ahora: new Date(ahora), comprobados, elecciones, decir: (linea: string) => dicho.push(linea),
        reloj: () => origen.transcurrido + diario.transcurrido,
        ...(o.turno ? { turno: o.turno } : {}), ...(o.presupuesto !== undefined ? { presupuesto: o.presupuesto } : {}),
      };
      const hecho = await ponerAlDia(p);
      if (o.avisa !== false) await anotarAvisados(p, hecho.huecos);
      return hecho;
    },
    reiniciar: () => { comprobados = sinComprobar(); },
  };
}

/** Lo que una corrida deja cuando no hubo huecos, ni nada sin resolver, ni le faltó tiempo. */
const SIN_MAS = { huecos: [], fallas: [], pendientes: 0 };
/** Los días del calendario de uno a otro, los dos incluidos. */
function diasDe(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  for (let d = Date.parse(`${desde}T00:00:00Z`); d <= Date.parse(`${hasta}T00:00:00Z`); d += 24 * 3_600_000) dias.push(new Date(d).toISOString().slice(0, 10));
  return dias;
}
/** Los días que una corrida no pudo resolver, y por qué. */
const fallasDe = (hecho: AlDia): string[] => hecho.fallas.map((f) => `${f.dia}: ${f.motivo}`);

/** Lo que el diario guarda de ese respaldo es idéntico a lo que hay en el de cada hora: el archivo y su manifiesto. */
function igualQueElOrigen(m: Mundo, objeto: string): void {
  assert.deepEqual(m.diario.objetos.get(objeto), m.origen.objetos.get(objeto), `el archivo de ${objeto}`);
  assert.deepEqual(m.diario.objetos.get(nombreDeManifiesto(objeto)), m.origen.objetos.get(nombreDeManifiesto(objeto)), `el manifiesto de ${objeto}`);
}

// ── qué día es ─────────────────────────────────────────────────────────────

test("el día de un respaldo es el del patio, no el de la hora universal; también cuando cambia el horario", () => {
  // Las 23:30 del 6 en el patio son las 05:30 del 7 en hora universal.
  assert.equal(diaDelPatio(new Date("2026-10-07T05:30:00Z"), PATIO), "2026-10-06");
  assert.equal(diaDelPatio(new Date("2026-10-07T06:00:00Z"), PATIO), "2026-10-07");
  assert.equal(diaDelPatio(new Date("2026-10-06T13:00:00Z"), PATIO), "2026-10-06");
  // Donde sí cambia el horario: en Ciudad Juárez la medianoche es a las 07:00 UTC en invierno y a las 06:00 en verano.
  const juarez = "America/Ciudad_Juarez";
  assert.equal(diaDelPatio(new Date("2026-03-07T06:30:00Z"), juarez), "2026-03-06");
  assert.equal(diaDelPatio(new Date("2026-03-09T06:30:00Z"), juarez), "2026-03-09");
  assert.equal(diaDelPatio(new Date("2026-11-01T06:30:00Z"), juarez), "2026-11-01");
  assert.equal(diaDelPatio(new Date("2026-11-02T06:30:00Z"), juarez), "2026-11-01");
});

// ── cuál es el diario ──────────────────────────────────────────────────────

test("el primer respaldo bueno del día va al depósito diario, idéntico y con su manifiesto; el segundo no; y al día siguiente, el primero de ese día", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");            // las 07:00 del patio
  const hecho = await m.correr("2026-10-06T13:00:30Z");
  assert.deepEqual(hecho, { subidos: [{ dia: "2026-10-06", objeto: siete }], ...SIN_MAS });
  assert.deepEqual(m.diario.respaldos(), [siete]);
  igualQueElOrigen(m, siete);

  // A las 08:00 hay otro respaldo de cada hora: el día ya tiene su diario, y no se sube nada.
  respaldoDe(m.origen, "2026-10-06T14:00:00.000Z");
  assert.deepEqual(await m.correr("2026-10-06T14:00:30Z"), { subidos: [], ...SIN_MAS });
  assert.deepEqual(m.diario.respaldos(), [siete]);

  // Al día siguiente, el primero de ese día.
  const manana = respaldoDe(m.origen, "2026-10-07T13:00:00.000Z");
  assert.deepEqual(await m.correr("2026-10-07T13:00:30Z"), { subidos: [{ dia: "2026-10-07", objeto: manana }], ...SIN_MAS });
  assert.deepEqual(m.diario.respaldos(), [siete, manana]);
  igualQueElOrigen(m, manana);
});

test("el día se cuenta en la hora del patio: un respaldo de las 23:30 es del día que termina, aunque su carpeta diga el siguiente", async () => {
  const m = mundo();
  const deNoche = respaldoDe(m.origen, "2026-10-07T05:30:00.000Z");         // 23:30 del 6, en el patio
  assert.ok(deNoche.startsWith("2026/10/07/"), "su nombre va en hora universal");
  const deManana = respaldoDe(m.origen, "2026-10-07T13:00:00.000Z");        // 07:00 del 7
  const hecho = await m.correr("2026-10-07T13:00:30Z");
  assert.deepEqual(hecho.subidos, [{ dia: "2026-10-06", objeto: deNoche }, { dia: "2026-10-07", objeto: deManana }]);
});

test("un respaldo sin manifiesto, o con el manifiesto dañado, no es «el primero bueno»: lo es el siguiente", async () => {
  const m = mundo();
  respaldoDe(m.origen, "2026-10-06T13:00:00.000Z", { sinManifiesto: true });      // una corrida que no terminó
  respaldoDe(m.origen, "2026-10-06T14:00:00.000Z", { manifiestoDanado: true });
  const bueno = respaldoDe(m.origen, "2026-10-06T15:00:00.000Z");
  assert.deepEqual((await m.correr("2026-10-06T15:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: bueno }]);
});

// ── cuando falla, y se reintenta ───────────────────────────────────────────

test("el diario que falla a las 07:00 y se reintenta a las 08:00 sube el de las 07:00, no el más nuevo", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.tropiezo = () => "antes";
  await assert.rejects(m.correr("2026-10-06T13:00:30Z"), /no contesta/);
  assert.deepEqual(m.diario.respaldos(), []);
  m.diario.tropiezo = () => null;
  respaldoDe(m.origen, "2026-10-06T14:00:00.000Z");
  assert.deepEqual((await m.correr("2026-10-06T14:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: siete }]);
});

test("el que se elige, se elige una vez: si después ese respaldo deja de servir, se avisa del hueco y no se sube otro en su lugar", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  // Queda elegido, pero su archivo no alcanza a subirse.
  m.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === siete ? "antes" : null);
  assert.match(fallasDe(await m.correr("2026-10-06T13:00:30Z")).join(" | "), /no contesta/);
  m.diario.tropiezo = () => null;
  // Mientras tanto el de las 07:00 se daña en el depósito de cada hora, y a las 08:00 hay otro, bueno.
  m.origen.objetos.set(siete, Buffer.from("otra cosa"));
  const ocho = respaldoDe(m.origen, "2026-10-06T14:00:00.000Z");
  m.reiniciar();                                  // la elección no vive en la memoria del servicio: sobrevive a reiniciarlo
  const hecho = await m.correr("2026-10-06T14:00:30Z");
  assert.deepEqual(hecho.subidos, []);
  assert.deepEqual(hecho.huecos.map((h) => h.dia), ["2026-10-06"]);
  assert.match(hecho.huecos[0]!.motivo, /elegido/);
  assert.ok(!m.diario.objetos.has(ocho), "subió otro en silencio");
  // Se avisa una vez: en la corrida siguiente ya no es noticia.
  assert.deepEqual(await m.correr("2026-10-06T15:00:30Z"), { subidos: [], ...SIN_MAS });
});

test("un día en que el diario falló todo el día se recupera al día siguiente; y una falla después del último respaldo del día, también", async () => {
  const m = mundo();
  const lunes = respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  m.diario.tropiezo = () => "antes";
  for (const hora of ["13", "14", "20"]) await assert.rejects(m.correr(`2026-10-05T${hora}:00:30Z`));
  respaldoDe(m.origen, "2026-10-06T02:00:00.000Z");                         // el último del lunes: las 20:00 del patio
  await assert.rejects(m.correr("2026-10-06T02:00:30Z"));
  // El martes vuelve el depósito: se sube el del lunes —su primero— y el del martes.
  m.diario.tropiezo = () => null;
  const martes = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  assert.deepEqual((await m.correr("2026-10-06T13:00:30Z")).subidos, [{ dia: "2026-10-05", objeto: lunes }, { dia: "2026-10-06", objeto: martes }]);
});

test("la subida que cruza la medianoche, y el servicio que vuelve al otro día: cada respaldo queda en el día de su instantánea", async () => {
  const m = mundo();
  // El respaldo es de las 23:59 del lunes; para cuando se pregunta ya es martes.
  const lunes = respaldoDe(m.origen, "2026-10-06T05:59:00.000Z");
  assert.deepEqual((await m.correr("2026-10-06T06:01:00Z")).subidos, [{ dia: "2026-10-05", objeto: lunes }]);
  // El servicio estuvo caído desde entonces y vuelve el jueves, con respaldos del martes y del jueves ya hechos por otra vía.
  const martes = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  const jueves = respaldoDe(m.origen, "2026-10-08T13:00:00.000Z");
  m.reiniciar();
  const hecho = await m.correr("2026-10-08T13:00:30Z");
  assert.deepEqual(hecho.subidos, [{ dia: "2026-10-06", objeto: martes }, { dia: "2026-10-08", objeto: jueves }]);
  // El miércoles no tuvo ningún respaldo: no se puede reconstruir, y no se le pone al del jueves la etiqueta del miércoles.
  assert.deepEqual(hecho.huecos.map((h) => h.dia), ["2026-10-07"]);
});

test("si se pierde la respuesta al subir el manifiesto, el reintento reconoce el par que ya está y no sube otro", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === nombreDeManifiesto(siete) ? "despues" : null);
  assert.match(fallasDe(await m.correr("2026-10-06T13:00:30Z")).join(" | "), /se perdió la respuesta/);
  m.diario.tropiezo = () => null;
  assert.deepEqual(await m.correr("2026-10-06T14:00:30Z"), { subidos: [], ...SIN_MAS });
  assert.equal(m.diario.subidas.filter((n) => n === siete).length, 1, "volvió a subir el archivo");
  igualQueElOrigen(m, siete);
});

test("si lo que se perdió fue la respuesta al subir el archivo, lo huérfano no cuenta como diario: el reintento lo completa", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === siete ? "despues" : null);
  assert.equal((await m.correr("2026-10-06T13:00:30Z")).fallas.length, 1, "ese día tenía que quedar sin resolver");
  assert.ok(m.diario.objetos.has(siete) && !m.diario.objetos.has(nombreDeManifiesto(siete)), "quedó el archivo sin su manifiesto");
  m.diario.tropiezo = () => null;
  assert.deepEqual((await m.correr("2026-10-06T14:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: siete }]);
  igualQueElOrigen(m, siete);
  // Lo que ya quedó subido no se vuelve a subir: se baja, se compara con lo elegido, y se completa con su manifiesto.
  assert.equal(m.diario.subidas.filter((n) => n === siete).length, 1, "volvió a subir un archivo que ya estaba, entero");
  assert.ok(m.diario.bajadas.includes(siete), "dio por bueno lo que había sin bajarlo");
});

test("lo que quedó subido a medias y no es lo elegido —pesa lo mismo y es otra cosa— no se completa: se repone del original", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === nombreDeManifiesto(siete) ? "antes" : null);
  assert.equal((await m.correr("2026-10-06T13:00:30Z")).fallas.length, 1);
  m.diario.tropiezo = () => null;
  m.diario.objetos.set(siete, Buffer.alloc(m.diario.objetos.get(siete)!.length, "x"));
  assert.deepEqual((await m.correr("2026-10-06T14:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: siete }]);
  igualQueElOrigen(m, siete);
  assert.equal(m.diario.subidas.filter((n) => n === siete).length, 2, "completó con su manifiesto un archivo que no era el elegido");

  // Y si lo subido sí es lo elegido, pero el manifiesto que ahora hay en el depósito de cada hora ya no dice lo mismo
  // que la elección, tampoco se completa con ese: el elegido ya no sirve, y se avisa.
  const otro = mundo();
  const ocho = respaldoDe(otro.origen, "2026-10-06T14:00:00.000Z");
  otro.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === nombreDeManifiesto(ocho) ? "antes" : null);
  await otro.correr("2026-10-06T14:00:30Z");
  otro.diario.tropiezo = () => null;
  const cambiado = { ...(JSON.parse(otro.origen.objetos.get(nombreDeManifiesto(ocho))!.toString("utf8")) as Manifiesto), sha256: "0".repeat(64) };
  otro.origen.objetos.set(nombreDeManifiesto(ocho), Buffer.from(JSON.stringify(cambiado, null, 2) + "\n"));
  const hecho = await otro.correr("2026-10-06T15:00:30Z");
  assert.deepEqual([hecho.subidos, hecho.huecos.map((h) => h.dia)], [[], ["2026-10-06"]]);
  assert.ok(!otro.diario.objetos.has(nombreDeManifiesto(ocho)), "completó el diario con un manifiesto que no es el del elegido");
});

test("un diario dañado no cuenta, y se repone: el archivo que ya no coincide con su huella, o el manifiesto que ya no se lee", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  await m.correr("2026-10-06T13:00:30Z");
  // Alguien pisó el archivo con otra cosa del mismo tamaño. El servicio se reinicia y lo comprueba de nuevo.
  const bueno = m.diario.objetos.get(siete)!;
  m.diario.objetos.set(siete, Buffer.alloc(bueno.length, "x"));
  m.reiniciar();
  assert.deepEqual((await m.correr("2026-10-06T14:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: siete }]);
  igualQueElOrigen(m, siete);
  // Ahora el manifiesto. Sin reiniciar: cambió de tamaño, y eso se ve en la lista.
  m.diario.objetos.set(nombreDeManifiesto(siete), Buffer.from("{ no es json"));
  assert.deepEqual((await m.correr("2026-10-06T15:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: siete }]);
  igualQueElOrigen(m, siete);
});

test("lo ya comprobado no se vuelve a bajar en cada corrida; al reiniciar el servicio, sí, una vez", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  await m.correr("2026-10-06T13:00:30Z");
  const bajadasDelArchivo = (): number => m.diario.bajadas.filter((n) => n === siete).length;
  const antes = bajadasDelArchivo();
  await m.correr("2026-10-06T14:00:30Z");
  await m.correr("2026-10-06T15:00:30Z");
  assert.equal(bajadasDelArchivo(), antes, "volvió a bajar un diario que ya había comprobado");
  m.reiniciar();
  await m.correr("2026-10-06T16:00:30Z");
  assert.equal(bajadasDelArchivo(), antes + 1, "al reiniciar no lo comprobó");
  await m.correr("2026-10-06T17:00:30Z");
  assert.equal(bajadasDelArchivo(), antes + 1);
});

// Lo encontró Codex en su décima revisión: comprobado una vez, un diario ya no se volvía a mirar mientras el
// servicio siguiera corriendo; y cuando vencía su original, ni reiniciando.
test("lo comprobado se vuelve a comprobar cada semana, mientras su original exista: uno que se dañó se nota a tiempo, y se repone", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  await m.correr("2026-10-06T13:00:30Z");
  const bajadas = (): number => m.diario.bajadas.filter((n) => n === siete).length;
  const antes = bajadas();
  // Seis días después, sin reiniciar: todavía no toca.
  respaldoDe(m.origen, "2026-10-12T13:00:00.000Z");
  await m.correr("2026-10-12T13:00:30Z");
  assert.equal(bajadas(), antes, "lo volvió a bajar antes de la semana");
  // Alguien pisa el diario con otra cosa del mismo tamaño: la lista no lo delata.
  m.diario.objetos.set(siete, Buffer.alloc(m.diario.objetos.get(siete)!.length, "x"));
  // A la semana se vuelve a bajar, no coincide, y se repone con el original, que todavía está.
  const hecho = await m.correr(new Date(Date.parse("2026-10-06T13:00:30Z") + REVALIDAR_CADA).toISOString());
  assert.ok(bajadas() > antes, "a la semana no lo volvió a comprobar");
  assert.deepEqual(hecho.subidos.filter((s) => s.dia === "2026-10-06"), [{ dia: "2026-10-06", objeto: siete }]);
  igualQueElOrigen(m, siete);
});

test("los diarios que ya no tienen original también se repasan, uno por corrida; si uno ya no coincide con su huella, no hay con qué reponerlo, y se avisa", async () => {
  const m = mundo();
  // Tres diarios cuyos originales ya no están. En el depósito de cada hora solo hay lo de hoy.
  const viejos = ["2026-10-03", "2026-10-04", "2026-10-05"].map((dia) => respaldoDe(m.diario, `${dia}T13:00:00.000Z`));
  const hoy = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.objetos.set(viejos[1]!, Buffer.alloc(m.diario.objetos.get(viejos[1]!)!.length, "x"));
  const repasados = (): string[] => m.diario.bajadas.filter((n) => viejos.includes(n));

  const primera = await m.correr("2026-10-06T13:00:30Z");
  assert.deepEqual(primera.subidos, [{ dia: "2026-10-06", objeto: hoy }]);
  assert.deepEqual(repasados(), [viejos[0]], "tenía que repasar uno, el más viejo");
  assert.deepEqual(primera.huecos, []);
  const segunda = await m.correr("2026-10-06T14:00:30Z");
  assert.deepEqual(repasados(), [viejos[0], viejos[1]]);
  assert.deepEqual(segunda.huecos.map((h) => h.dia), ["2026-10-04"]);
  assert.match(segunda.huecos[0]!.motivo, /ya no coincide con su huella, y su original ya venció/);
  await m.correr("2026-10-06T15:00:30Z");
  assert.deepEqual(repasados(), viejos);
  // Ya se repasaron los tres: no se vuelven a bajar hasta dentro de un mes. Y el dañado ya se avisó.
  const cuarta = await m.correr("2026-10-06T16:00:30Z");
  assert.deepEqual(repasados(), viejos);
  assert.deepEqual(cuarta.huecos, []);
  await m.correr(new Date(Date.parse("2026-10-06T13:00:30Z") + REPASAR_CADA).toISOString());
  assert.equal(repasados().length, 4, "al mes no volvió a repasar");
});

// ── los huecos ─────────────────────────────────────────────────────────────

test("un día sin ningún respaldo bueno se avisa como hueco, una sola vez; hoy, que todavía no termina, no es hueco", async () => {
  const m = mundo();
  const lunes = respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  respaldoDe(m.origen, "2026-10-06T13:00:00.000Z", { manifiestoDanado: true });   // el martes solo tuvo uno, y no sirve
  // Miércoles por la mañana, antes del primer respaldo del día.
  const hecho = await m.correr("2026-10-07T12:00:00Z");
  assert.deepEqual(hecho.subidos, [{ dia: "2026-10-05", objeto: lunes }]);
  assert.deepEqual(hecho.huecos.map((h) => h.dia), ["2026-10-06"]);
  assert.ok(m.dicho.some((linea) => linea.includes("2026-10-06")), "no dijo de qué día es el hueco");
  // Otra corrida, y un reinicio: el hueco ya se avisó.
  assert.deepEqual(await m.correr("2026-10-07T12:30:00Z"), { subidos: [], ...SIN_MAS });
  m.reiniciar();
  assert.deepEqual((await m.correr("2026-10-07T12:45:00Z")).huecos, []);
  // Y cuando llega el respaldo del miércoles, es del miércoles.
  const miercoles = respaldoDe(m.origen, "2026-10-07T13:00:00.000Z");
  assert.deepEqual((await m.correr("2026-10-07T13:00:30Z")).subidos, [{ dia: "2026-10-07", objeto: miercoles }]);
});

test("no se inventan huecos de antes de que hubiera respaldos, ni de después de hoy", async () => {
  const m = mundo();
  const unico = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  respaldoDe(m.origen, "2026-10-09T13:00:00.000Z");                         // un reloj adelantado dejó uno «del futuro»
  const hecho = await m.correr("2026-10-06T13:00:30Z");
  assert.deepEqual(hecho, { subidos: [{ dia: "2026-10-06", objeto: unico }], ...SIN_MAS });
});

test("sin respaldos de cada hora no hay nada que poner al día; y si un depósito no contesta, se dice y no se marca ningún hueco", async () => {
  const m = mundo();
  assert.deepEqual(await m.correr("2026-10-06T13:00:30Z"), { subidos: [], ...SIN_MAS });
  respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  m.origen.tropiezo = (operacion) => (operacion === "listar" ? "antes" : null);
  await assert.rejects(m.correr("2026-10-07T13:00:30Z"), /no contesta/);
  m.origen.tropiezo = () => null;
  m.diario.tropiezo = (operacion) => (operacion === "listar" ? "antes" : null);
  await assert.rejects(m.correr("2026-10-07T13:00:30Z"), /no contesta/);
  assert.equal(m.diario.objetos.size, 0, "escribió algo en el diario sin haber podido verlo");
});

test("si el depósito de cada hora no contesta al leer un manifiesto, no se concluye que ese día no tuvo respaldo: se falla, y se reintenta", async () => {
  const m = mundo();
  const lunes = respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  // Ya es martes, y el manifiesto del lunes no se puede bajar: no hay red.
  m.origen.tropiezo = (operacion) => (operacion === "bajar" ? "antes" : null);
  assert.match(fallasDe(await m.correr("2026-10-06T13:00:30Z")).join(" | "), /no contesta/);
  assert.equal(m.diario.objetos.size, 0, "dio por perdido un día que solo no se pudo leer");
  m.origen.tropiezo = () => null;
  assert.deepEqual(await m.correr("2026-10-06T14:00:30Z"), { subidos: [{ dia: "2026-10-05", objeto: lunes }], ...SIN_MAS });
});

test("si es el depósito diario el que no contesta al comprobar un diario que ya está, no se da por dañado ni se vuelve a subir", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  await m.correr("2026-10-06T13:00:30Z");
  m.reiniciar();
  m.diario.tropiezo = (operacion, nombre) => (operacion === "bajar" && nombre === siete ? "antes" : null);
  assert.match(fallasDe(await m.correr("2026-10-06T14:00:30Z")).join(" | "), /no contesta/);
  assert.equal(m.diario.subidas.filter((n) => n === siete).length, 1, "volvió a subir un diario que no pudo comprobar");
});

// Dos huecos que no cubría ninguna prueba; los destapó romper el programa a propósito.
test("si el elegido cambió en el depósito de cada hora sin cambiar de tamaño, tampoco sirve: se nota por su huella, al bajarlo", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === siete ? "antes" : null);
  assert.equal((await m.correr("2026-10-06T13:00:30Z")).fallas.length, 1, "ese día tenía que quedar sin resolver");
  m.diario.tropiezo = () => null;
  // Mismo nombre, mismo tamaño, otro contenido: la lista y el manifiesto no lo delatan.
  m.origen.objetos.set(siete, Buffer.alloc(m.origen.objetos.get(siete)!.length, "x"));
  const hecho = await m.correr("2026-10-06T14:00:30Z");
  assert.deepEqual(hecho.subidos, []);
  assert.deepEqual(hecho.huecos.map((h) => h.dia), ["2026-10-06"]);
  assert.ok(!m.diario.objetos.has(siete), "subió al depósito de un año algo que no es el respaldo");
});

test("lo subido al depósito diario se baja y se compara: si quedó otra cosa, el día no se da por cubierto, y se repone", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.estropea = (nombre) => nombre === siete;
  assert.match(fallasDe(await m.correr("2026-10-06T13:00:30Z")).join(" | "), /no coincide/);
  assert.ok(!m.diario.objetos.has(nombreDeManifiesto(siete)), "dejó manifiesto para un archivo que no es el respaldo");
  // El depósito vuelve a guardar bien: la corrida siguiente lo repone, sin haberlo dado por hecho.
  m.diario.estropea = () => false;
  assert.deepEqual((await m.correr("2026-10-06T14:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: siete }]);
  igualQueElOrigen(m, siete);
  // Y lo mismo con el manifiesto: si lo que quedó no es lo que se subió, la corrida falla.
  const manana = respaldoDe(m.origen, "2026-10-07T13:00:00.000Z");
  m.diario.estropea = (nombre) => nombre === nombreDeManifiesto(manana);
  assert.match(fallasDe(await m.correr("2026-10-07T13:00:30Z")).join(" | "), /manifiesto/);
  m.diario.estropea = () => false;
  assert.deepEqual((await m.correr("2026-10-07T14:00:30Z")).subidos, [{ dia: "2026-10-07", objeto: manana }]);
});

// ── lo que encontró Codex en su décima revisión ────────────────────────────

test("el primero del día cuyo archivo está dañado no se elige: se prueba el que sigue, y el día no se pierde", async () => {
  const m = mundo();
  // El de las 07:00 tiene su manifiesto en orden, y el archivo —del mismo tamaño— no es lo que el manifiesto dice.
  const danado = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z", { archivoDanado: true });
  const bueno = respaldoDe(m.origen, "2026-10-06T14:00:00.000Z");
  const hecho = await m.correr("2026-10-06T14:00:30Z");
  assert.deepEqual(hecho, { subidos: [{ dia: "2026-10-06", objeto: bueno }], ...SIN_MAS });
  assert.ok(!m.diario.objetos.has(danado), "subió al depósito de un año un archivo dañado");
  // Lo elegido —y eso ya no cambia— es el bueno.
  assert.equal(JSON.parse(m.diario.objetos.get("elecciones/2026-10-06.json")!.toString()).objeto, bueno);
  // Y si todos los del día están dañados, hoy todavía puede llegar uno: no se elige nada, ni se avisa todavía.
  const otro = mundo();
  respaldoDe(otro.origen, "2026-10-06T13:00:00.000Z", { archivoDanado: true });
  assert.deepEqual(await otro.correr("2026-10-06T13:00:30Z"), { subidos: [], ...SIN_MAS });
  assert.equal(otro.diario.objetos.size, 0);
});

test("entre respaldos con el nombre de antes que caen en el mismo segundo, cuál fue primero lo dice su manifiesto, no su nombre", async () => {
  const m = mundo();
  // El que se nombra primero —su identificador es menor— es en realidad el segundo de ese segundo.
  const segundo = respaldoDe(m.origen, "2026-10-06T13:00:00.900Z", { nombreDeAntes: true });
  const primero = respaldoDe(m.origen, "2026-10-06T13:00:00.100Z", { nombreDeAntes: true });
  assert.ok(segundo < primero, "por su nombre, el orden es el contrario: de eso se trata");
  assert.deepEqual((await m.correr("2026-10-06T13:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: primero }]);
});

test("con el turno perdido no se escribe nada en el depósito diario: ni la elección, ni el archivo, ni el aviso anotado", async () => {
  const m = mundo();
  respaldoDe(m.origen, "2026-10-05T13:00:00.000Z", { manifiestoDanado: true });   // ayer no tuvo ninguno que sirva
  respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  const perdido = async (): Promise<void> => { throw new Error("se perdió el turno de los respaldos"); };
  const hecho = await m.correr("2026-10-06T13:00:30Z", { turno: perdido, avisa: false });
  assert.match(fallasDe(hecho).join(" | "), /2026-10-06: se perdió el turno/);
  assert.equal(m.diario.objetos.size, 0, "escribió en el depósito diario sin tener el turno");
  await assert.rejects(anotarAvisados({ diario: m.diario, ahora: new Date("2026-10-06T13:00:30Z"), comprobados: sinComprobar(), turno: perdido }, hecho.huecos), /se perdió el turno/);
  assert.equal(m.diario.objetos.size, 0);
  // Y si se pierde a media subida, se detiene donde iba: cada cosa que se escribe pregunta antes por el turno.
  const hasta = async (cuantas: number): Promise<string[]> => {
    const otro = mundo();
    respaldoDe(otro.origen, "2026-10-06T13:00:00.000Z");
    let veces = 0;
    const seCorta = async (): Promise<void> => {
      veces += 1;
      if (veces > cuantas) throw new Error("se perdió el turno de los respaldos");
    };
    assert.match(fallasDe(await otro.correr("2026-10-06T13:00:30Z", { turno: seCorta })).join(" | "), /se perdió el turno/);
    return [...otro.diario.objetos.keys()].map((n) => (n.startsWith("elecciones/") ? "la elección" : n.endsWith(".manifiesto.json") ? "el manifiesto" : "el archivo"));
  };
  assert.deepEqual(await hasta(1), ["la elección"]);
  assert.deepEqual(await hasta(2), ["la elección", "el archivo"]);
});

test("un hueco ya avisado no cierra el día: si aparece con qué —el reloj estaba adelantado—, el día recibe su diario", async () => {
  const m = mundo();
  respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  // El reloj del servidor da por terminado el martes cuando todavía no había respaldo del martes.
  const adelantado = await m.correr("2026-10-07T12:00:00Z");
  assert.deepEqual(adelantado.huecos.map((h) => h.dia), ["2026-10-06"]);
  assert.ok(m.diario.objetos.has("elecciones/2026-10-06.hueco.json"), "el aviso llegó, y tenía que quedar anotado");
  // Corregido el reloj, llega el respaldo del martes. El hueco anotado no lo tapa.
  const martes = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  assert.deepEqual((await m.correr("2026-10-06T13:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: martes }]);
  igualQueElOrigen(m, martes);
});

test("una anotación de hueco que no se lee no acredita que alguien se haya enterado, ni tapa un diario que sí está", async () => {
  const m = mundo();
  const lunes = respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  respaldoDe(m.origen, "2026-10-06T13:00:00.000Z", { manifiestoDanado: true });
  // Dos anotaciones a medio escribir: la de un día que sí tiene con qué, y la de uno que no.
  m.diario.objetos.set("elecciones/2026-10-05.hueco.json", Buffer.from("{ a medio escri"));
  m.diario.objetos.set("elecciones/2026-10-06.hueco.json", Buffer.from("{ a medio escri"));
  const hecho = await m.correr("2026-10-07T12:00:00Z", { avisa: false });
  assert.deepEqual(hecho.subidos, [{ dia: "2026-10-05", objeto: lunes }], "la anotación tapó un día que sí tenía respaldo");
  assert.deepEqual(hecho.huecos.map((h) => h.dia), ["2026-10-06"], "dio por avisado un hueco con una anotación que no se lee");
  // Una anotación de otro día guardada bajo ese nombre, tampoco.
  m.diario.objetos.set("elecciones/2026-10-06.hueco.json", Buffer.from(JSON.stringify({ formato: 1, dia: "2026-10-01", motivo: "x", avisado: "2026-10-02T00:00:00.000Z" })));
  m.reiniciar();
  assert.deepEqual((await m.correr("2026-10-07T12:30:00Z", { avisa: false })).huecos.map((h) => h.dia), ["2026-10-06"]);
});

test("el hueco se da por avisado cuando el aviso llegó: si no llegó, la corrida siguiente lo vuelve a decir", async () => {
  const m = mundo();
  respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  respaldoDe(m.origen, "2026-10-06T13:00:00.000Z", { manifiestoDanado: true });
  // El vigilante no contesta: no queda anotado, y se repite.
  for (const hora of ["12:00", "12:30"]) {
    assert.deepEqual((await m.correr(`2026-10-07T${hora}:00Z`, { avisa: false })).huecos.map((h) => h.dia), ["2026-10-06"]);
  }
  assert.ok(!m.diario.objetos.has("elecciones/2026-10-06.hueco.json"), "anotó como avisado un hueco del que nadie se enteró");
  // Ahora sí llega: se anota, y ya no se repite —tampoco después de reiniciar—.
  assert.deepEqual((await m.correr("2026-10-07T13:00:00Z")).huecos.map((h) => h.dia), ["2026-10-06"]);
  assert.deepEqual((await m.correr("2026-10-07T13:30:00Z")).huecos, []);
  m.reiniciar();
  assert.deepEqual((await m.correr("2026-10-07T14:00:00Z")).huecos, []);
});

test("una elección que quedó sin completar no se olvida cuando vencen los respaldos de ese día: se avisa", async () => {
  const m = mundo();
  const lunes = respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  // El lunes se elige, y su archivo no alcanza a subirse.
  m.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === lunes ? "antes" : null);
  assert.equal((await m.correr("2026-10-05T13:00:30Z")).fallas.length, 1);
  m.diario.tropiezo = () => null;
  // El servicio vuelve un mes después: los respaldos de aquel lunes ya vencieron, y solo hay los de hoy.
  m.origen.objetos.clear();
  const hoy = respaldoDe(m.origen, "2026-11-07T13:00:00.000Z");
  m.reiniciar();
  const hecho = await m.correr("2026-11-07T13:00:30Z");
  assert.deepEqual(hecho.subidos, [{ dia: "2026-11-07", objeto: hoy }]);
  // Y de ese día hasta ayer se recorre de corrido: los días de en medio, sin ningún respaldo, también son huecos.
  assert.deepEqual(hecho.huecos.map((h) => h.dia), diasDe("2026-10-05", "2026-11-06"), "el día con la elección sin completar, o los que le siguen sin respaldo, se olvidaron en silencio");
  assert.match(hecho.huecos[0]!.motivo, /elegido.*ya no está/);
  assert.match(hecho.huecos[1]!.motivo, /no tuvo ningún respaldo que sirva/);
});

test("los días se recorren de corrido desde el primero del que se sabe algo —un respaldo, una elección, un diario— hasta ayer; y el que ya tiene su diario no es un hueco aunque su original haya vencido", async () => {
  // Lo encontró Codex en la segunda vuelta de su décima revisión: con una elección vieja y respaldos que empezaban
  // días después, los días de en medio no se miraban.
  const m = mundo();
  const lunes = respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  m.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === lunes ? "antes" : null);
  await m.correr("2026-10-05T13:00:30Z");
  m.diario.tropiezo = () => null;
  // Ya no queda ningún respaldo de cada hora —ni de hoy—: solo la elección del lunes. Se recorre hasta ayer, y hoy no cuenta.
  m.origen.objetos.clear();
  m.reiniciar();
  const sinOrigen = await m.correr("2026-10-08T13:00:30Z", { avisa: false });
  assert.deepEqual(sinOrigen.huecos.map((h) => h.dia), ["2026-10-05", "2026-10-06", "2026-10-07"]);

  // Otro patio: diarios del 3 y del 4 (sus originales ya vencieron), nada del 5, y respaldos desde el 6.
  const otro = mundo();
  respaldoDe(otro.diario, "2026-10-03T13:00:00.000Z");
  respaldoDe(otro.diario, "2026-10-04T13:00:00.000Z");
  const martes = respaldoDe(otro.origen, "2026-10-06T13:00:00.000Z");
  const hecho = await otro.correr("2026-10-06T13:00:30Z");
  assert.deepEqual(hecho.subidos, [{ dia: "2026-10-06", objeto: martes }]);
  assert.deepEqual(hecho.huecos.map((h) => h.dia), ["2026-10-05"], "o inventó huecos en días que tienen su diario, o no vio el día que falta");
});

test("un día que no se puede resolver no detiene a los demás: se dice cuál y por qué, y los otros reciben su diario", async () => {
  const m = mundo();
  respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  const martes = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  const miercoles = respaldoDe(m.origen, "2026-10-07T13:00:00.000Z");
  // La elección del lunes no se puede leer: de ese día no se elige otro sin que alguien lo vea.
  m.diario.objetos.set("elecciones/2026-10-05.json", Buffer.from("{ no es json"));
  const hecho = await m.correr("2026-10-07T13:00:30Z");
  assert.deepEqual(hecho.subidos, [{ dia: "2026-10-06", objeto: martes }, { dia: "2026-10-07", objeto: miercoles }]);
  assert.deepEqual(hecho.fallas.map((f) => f.dia), ["2026-10-05"]);
  assert.match(hecho.fallas[0]!.motivo, /la elección del diario del 2026-10-05 no se puede leer/);
  assert.deepEqual(hecho.huecos, [], "un día que no se pudo leer no es un día sin respaldo");
});

test("cada corrida tiene un tiempo: lo que no alcanza queda para la siguiente, y no se da por perdido ni por hecho", async () => {
  const m = mundo();
  const dias = ["2026-10-05", "2026-10-06", "2026-10-07"].map((dia) => respaldoDe(m.origen, `${dia}T13:00:00.000Z`));
  // Cada archivo tarda 12 minutos en bajar. Un día son dos bajadas —traer el original y comprobar lo subido—: con media
  // hora alcanza para un día entero, y el que sigue se corta al acabarse el tiempo, no cuando termine.
  const lento = (nombre: string, operacion: Operacion): number => (operacion === "bajar" && nombre.endsWith(".dump.age") ? 12 * 60_000 : 0);
  m.origen.tarda = lento;
  m.diario.tarda = lento;
  const reloj = (): number => m.origen.transcurrido + m.diario.transcurrido;
  const primera = await m.correr("2026-10-07T13:00:30Z", { presupuesto: 30 * 60_000 });
  assert.deepEqual(primera, { subidos: [{ dia: "2026-10-05", objeto: dias[0] }], huecos: [], fallas: [], pendientes: 2 });
  assert.ok(reloj() <= 30 * 60_000, `la corrida de media hora tardó ${reloj() / 60_000} minutos`);
  assert.ok(m.dicho.some((linea) => /quedan 2 días por poner al día/.test(linea)));
  const segunda = await m.correr("2026-10-07T14:00:30Z", { presupuesto: 30 * 60_000 });
  assert.deepEqual([segunda.subidos.map((s) => s.dia), segunda.pendientes, segunda.fallas], [["2026-10-06"], 1, []]);
  const tercera = await m.correr("2026-10-07T15:00:30Z", { presupuesto: 30 * 60_000 });
  assert.deepEqual([tercera.subidos.map((s) => s.dia), tercera.pendientes], [["2026-10-07"], 0]);
  assert.deepEqual(m.diario.respaldos(), dias);
});

test("el tiempo de la corrida vale también dentro de un día: cada subida, bajada y listado recibe lo que queda, y lo que no cabe se corta", async () => {
  // Lo encontró Codex en la segunda vuelta de su décima revisión: con cinco minutos de corrida, tres subidas de 29
  // —cada una dentro de su plazo propio, de 30— tardaban 87, con el turno tomado y el respaldo de la hora esperando.
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  // Subir el archivo tarda 29 minutos; lo chico —la elección, el manifiesto— pasa enseguida.
  m.diario.tarda = (nombre, operacion) => (operacion === "subir" && nombre.endsWith(".dump.age") ? 29 * 60_000 : 0);
  const reloj = (): number => m.origen.transcurrido + m.diario.transcurrido;
  const hecho = await m.correr("2026-10-06T13:00:30Z", { presupuesto: 5 * 60_000 });
  assert.deepEqual(hecho, { subidos: [], huecos: [], fallas: [], pendientes: 1 });
  assert.ok(reloj() <= 5 * 60_000, `con cinco minutos de corrida tardó ${reloj() / 60_000}`);
  assert.deepEqual(m.diario.respaldos(), [], "dio algo por subido");
  // Los listados y la subida grande llevan su plazo: lo que le queda a la corrida. Lo chico, un minuto.
  for (const deposito of [m.origen, m.diario]) assert.equal(deposito.plazos.find((x) => x.operacion === "listar")!.plazo, 5 * 60_000);
  assert.equal(m.diario.plazos.find((x) => x.operacion === "subir" && x.nombre === siete)!.plazo, 5 * 60_000);
  assert.equal(m.diario.plazos.find((x) => x.operacion === "subir" && x.nombre.startsWith("elecciones/"))!.plazo, 60_000);
  // Con el tiempo ya vencido no se empieza otra cosa: ni otro candidato, ni otro paso del mismo día.
  const antes = m.diario.plazos.length + m.origen.plazos.length;
  assert.equal((await m.correr("2026-10-06T13:10:30Z", { presupuesto: 0 })).pendientes, 1);
  assert.equal(m.diario.plazos.length + m.origen.plazos.length, antes + 2, "con el tiempo vencido hizo algo más que listar");

  // El caso de Codex, tal cual: las tres subidas tardan 29 minutos, también las chicas. Una elección que no pasa
  // en un minuto no es «falta tiempo»: es que el depósito no contesta. Se dice como falla, y pronto.
  const otro = mundo();
  respaldoDe(otro.origen, "2026-10-06T13:00:00.000Z");
  otro.diario.tarda = (_nombre, operacion) => (operacion === "subir" ? 29 * 60_000 : 0);
  const lento = await otro.correr("2026-10-06T13:00:30Z", { presupuesto: 5 * 60_000 });
  assert.match(fallasDe(lento).join(" | "), /2026-10-06: se acabó el plazo de la operación/);
  assert.ok(otro.origen.transcurrido + otro.diario.transcurrido <= 2 * 60_000, "tardó más de dos minutos en darse cuenta");
  assert.deepEqual(otro.diario.respaldos(), []);
});

test("con el tiempo vencido no se empieza ninguna subida ni bajada grande: ni el siguiente candidato, ni el siguiente paso del mismo día", async () => {
  const P = 30_000;
  /** Corre con ese tiempo, y devuelve lo grande —archivos— que empezó cuando ya no quedaba. */
  const aDestiempo = async (m: Mundo, ahora: string): Promise<string[]> => {
    const [empieza, deOrigen, deDiario] = [m.origen.reloj(), m.origen.plazos.length, m.diario.plazos.length];
    const hecho = await m.correr(ahora, { presupuesto: P });
    assert.deepEqual([hecho.subidos, hecho.fallas, hecho.pendientes], [[], [], 1]);
    return [...m.origen.plazos.slice(deOrigen).map((x) => ({ ...x, donde: "del de cada hora" })), ...m.diario.plazos.slice(deDiario).map((x) => ({ ...x, donde: "del diario" }))]
      .filter((x) => x.nombre.endsWith(".dump.age") && x.al - empieza >= P).map((x) => `${x.operacion} ${x.donde}`);
  };
  const laEleccionTarda = (nombre: string, operacion: Operacion): number => (operacion === "bajar" && nombre.startsWith("elecciones/") ? P : 0);

  // El primer candidato se lleva todo el tiempo, y resulta dañado: no se prueba el siguiente.
  const candidatos = mundo();
  const danado = respaldoDe(candidatos.origen, "2026-10-06T13:00:00.000Z", { archivoDanado: true });
  respaldoDe(candidatos.origen, "2026-10-06T14:00:00.000Z");
  candidatos.origen.tarda = (nombre, operacion) => (operacion === "bajar" && nombre === danado ? P : 0);
  assert.deepEqual(await aDestiempo(candidatos, "2026-10-06T14:00:30Z"), [], "probó otro candidato sin tiempo");

  // Traer el elegido se lleva todo el tiempo: no se empieza a subir.
  const alSubir = mundo();
  respaldoDe(alSubir.origen, "2026-10-06T13:00:00.000Z");
  alSubir.origen.tarda = (nombre, operacion) => (operacion === "bajar" && nombre.endsWith(".dump.age") ? P : 0);
  assert.deepEqual(await aDestiempo(alSubir, "2026-10-06T13:00:30Z"), [], "empezó a subir sin tiempo");

  // Subirlo se lleva todo el tiempo: no se empieza a bajarlo para comprobarlo.
  const alComprobar = mundo();
  respaldoDe(alComprobar.origen, "2026-10-06T13:00:00.000Z");
  alComprobar.diario.tarda = (nombre, operacion) => (operacion === "subir" && nombre.endsWith(".dump.age") ? P : 0);
  assert.deepEqual(await aDestiempo(alComprobar, "2026-10-06T13:00:30Z"), [], "empezó a comprobar lo subido sin tiempo");

  // El día ya tiene su diario, y toca volver a comprobarlo (el servicio se reinició): sin tiempo, no se baja.
  const completo = mundo();
  respaldoDe(completo.origen, "2026-10-06T13:00:00.000Z");
  await completo.correr("2026-10-06T13:00:30Z");
  completo.reiniciar();
  completo.diario.tarda = laEleccionTarda;
  assert.deepEqual(await aDestiempo(completo, "2026-10-06T14:00:30Z"), [], "empezó a comprobar el diario sin tiempo");

  // Quedó el archivo subido, sin manifiesto: sin tiempo, no se baja para compararlo.
  const aMedias = mundo();
  const siete = respaldoDe(aMedias.origen, "2026-10-06T13:00:00.000Z");
  aMedias.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === nombreDeManifiesto(siete) ? "antes" : null);
  await aMedias.correr("2026-10-06T13:00:30Z");
  aMedias.diario.tropiezo = () => null;
  aMedias.diario.tarda = laEleccionTarda;
  assert.deepEqual(await aDestiempo(aMedias, "2026-10-06T14:00:30Z"), [], "empezó a comparar lo que quedó subido sin tiempo");

  // Quedó elegido y nada subido: sin tiempo, no se trae el elegido.
  const soloElegido = mundo();
  const ocho = respaldoDe(soloElegido.origen, "2026-10-06T14:00:00.000Z");
  soloElegido.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === ocho ? "antes" : null);
  await soloElegido.correr("2026-10-06T14:00:30Z");
  soloElegido.diario.tropiezo = () => null;
  soloElegido.diario.tarda = laEleccionTarda;
  assert.deepEqual(await aDestiempo(soloElegido, "2026-10-06T15:00:30Z"), [], "empezó a traer el elegido sin tiempo");
});

test("lo que tarda un manifiesto cuenta: si se lleva lo que quedaba no se empieza el archivo grande, tampoco al repasar; y a lo grande nunca se le da más de lo que queda", async () => {
  // Lo encontró Codex el 21 de octubre (H32-1): el tiempo se miraba antes del manifiesto, no entre él y el archivo.
  const P = 50_000;
  const tarde = (d: Deposito, empieza: number) => d.plazos.filter((x) => x.nombre.endsWith(".dump.age") && x.al - empieza >= P).map((x) => `${x.operacion} ${x.nombre}`);

  // El manifiesto del elegido se lleva todo el tiempo: no se baja el archivo.
  const m = mundo();
  const r = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.origen.tarda = (nombre, operacion) => (operacion === "bajar" && nombre === nombreDeManifiesto(r) ? P : 0);
  let empieza = m.origen.reloj();
  const hecho = await m.correr("2026-10-06T13:00:30Z", { presupuesto: P });
  assert.deepEqual([hecho.subidos, hecho.pendientes], [[], 1]);
  assert.deepEqual(tarde(m.origen, empieza), [], "bajó el archivo sin tiempo");

  // Al repasar un diario sin original: su manifiesto se lleva el tiempo, y su archivo no se baja.
  const v = mundo();
  const viejo = respaldoDe(v.diario, "2026-10-05T13:00:00.000Z");
  respaldoDe(v.origen, "2026-10-06T13:00:00.000Z");
  v.diario.tarda = (nombre, operacion) => (operacion === "bajar" && nombre === nombreDeManifiesto(viejo) ? P : 0);
  empieza = v.origen.reloj();
  await v.correr("2026-10-06T13:00:30Z", { presupuesto: P });
  assert.deepEqual(tarde(v.diario, empieza), [], "bajó el diario a repasar sin tiempo");
  // Y no queda dicho que no se pudo repasar: le toca otra vez en la corrida siguiente.
  const despues = await v.correr("2026-10-06T14:00:30Z");
  assert.deepEqual([despues.huecos, fallasDe(despues)], [[], []]);
  assert.ok(v.diario.bajadas.includes(viejo), "no lo repasó en la corrida siguiente");

  // Con poco tiempo, lo grande recibe ese poco como plazo, no el minuto de las notas.
  const c = mundo();
  respaldoDe(c.origen, "2026-10-06T13:00:00.000Z");
  c.origen.tarda = (_nombre, operacion) => (operacion === "listar" ? P - 10_000 : 0);
  empieza = c.origen.reloj();
  await c.correr("2026-10-06T13:00:30Z", { presupuesto: P });
  const grandes = [...c.origen.plazos, ...c.diario.plazos].filter((x) => x.nombre.endsWith(".dump.age"));
  assert.ok(grandes.length > 0);
  for (const g of grandes) assert.ok(g.plazo! <= P - (g.al - empieza), `${g.operacion} ${g.nombre}: plazo ${g.plazo} con ${P - (g.al - empieza)} de tiempo`);
});

test("al cambiar la llave, lo sellado con la anterior se sigue acreditando con su sello anterior —solo lo de antes del cambio—; sin él, se avisa", async () => {
  // Lo encontró Codex el 21 de octubre (H32-3): con solo el sello nuevo, los diarios de antes se avisaban como perdidos.
  const NUEVO = "ab".repeat(32);
  const cambio = new Date("2026-10-06T06:00:00.000Z");
  const preparar = (conAnterior: boolean) => {
    const m = mundo();
    const viejo = respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
    return { m, viejo, rotar: () => {
      for (const d of [m.origen, m.diario]) {
        d.sello = NUEVO;
        d.anteriores = conAnterior ? [{ clave: SELLO_DE_PRUEBA, hasta: cambio }] : [];
      }
      m.reiniciar();       // que vuelva a comprobar lo de antes
    } };
  };

  const { m, viejo, rotar } = preparar(true);
  await m.correr("2026-10-05T13:00:30Z");
  assert.ok(m.diario.objetos.has(viejo));
  rotar();
  const nuevo = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z", { sello: NUEVO });
  const hecho = await m.correr("2026-10-06T13:00:30Z");
  assert.deepEqual([hecho.huecos, fallasDe(hecho)], [[], []]);
  assert.deepEqual(hecho.subidos, [{ dia: "2026-10-06", objeto: nuevo }]);
  // El sello anterior no acredita nada de después del cambio.
  const falso = respaldoDe(m.origen, "2026-10-06T14:00:00.000Z", { sello: SELLO_DE_PRUEBA });
  const otro = mundo();
  for (const d of [otro.origen, otro.diario]) { d.sello = NUEVO; d.anteriores = [{ clave: SELLO_DE_PRUEBA, hasta: cambio }]; }
  otro.origen.objetos.set(falso, m.origen.objetos.get(falso)!);
  otro.origen.objetos.set(nombreDeManifiesto(falso), m.origen.objetos.get(nombreDeManifiesto(falso))!);
  const conElFalso = await otro.correr("2026-10-06T14:00:30Z");
  assert.deepEqual(conElFalso.subidos, [], "un sello anterior acreditó un respaldo de después del cambio");

  // Sin el sello anterior en el servidor, lo de antes no se puede acreditar: se dice. (Por eso la guía pide ponerlo.)
  const sin = preparar(false);
  await sin.m.correr("2026-10-05T13:00:30Z");
  sin.rotar();
  respaldoDe(sin.m.origen, "2026-10-06T13:00:00.000Z", { sello: NUEVO });
  const sinAnterior = await sin.m.correr("2026-10-06T13:00:30Z");
  assert.deepEqual(sinAnterior.huecos.map((h) => h.dia), ["2026-10-05"]);
});

test("con un sello anterior, una anotación solo se cree si su día ya había terminado en el patio cuando se cambió la llave", async () => {
  // Lo señaló la revisión de seguridad del 22 de octubre: una anotación del día del cambio pudo escribirse ya con
  // la llave nueva, y con la vieja no se cree.
  const NUEVO = "ab".repeat(32);
  const huecosCon = async (hasta: string): Promise<string[]> => {
    const m = mundo();
    for (const d of [m.origen, m.diario]) { d.sello = NUEVO; d.anteriores = [{ clave: SELLO_DE_PRUEBA, hasta: new Date(hasta) }]; }
    respaldoDe(m.origen, "2026-10-06T13:00:00.000Z", { manifiestoDanado: true });
    const nota = { formato: 1, dia: "2026-10-06", motivo: "x", avisado: "2026-10-07T00:00:00.000Z" };
    m.diario.objetos.set("elecciones/2026-10-06.hueco.json", Buffer.from(JSON.stringify({
      ...nota, sello: selloDeNota(NOTA_DE_HUECO, [1, nota.dia, nota.motivo, nota.avisado], SELLO_DE_PRUEBA),
    })));
    return (await m.correr("2026-10-07T12:00:00Z", { avisa: false })).huecos.map((h) => h.dia);
  };
  // El 6 termina en el patio el 7 a las 06:00 (UTC). Si la llave se cambió después, la anotación del 6 con la vieja se cree.
  assert.deepEqual(await huecosCon("2026-10-07T08:00:00Z"), []);
  // Si se cambió a media mañana del 6, no: el hueco se vuelve a decir.
  assert.deepEqual(await huecosCon("2026-10-06T18:00:00Z"), ["2026-10-06"]);
});

test("un día al que se le acaba el tiempo no se queda «pendiente» para siempre: a la segunda corrida seguida se dice, como falla", async () => {
  const m = mundo();
  respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  const martes = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  // Bajar el original del lunes tarda más que una corrida entera, de las de siempre (20 minutos).
  m.origen.tarda = (nombre, operacion) => (operacion === "bajar" && nombre.endsWith(".dump.age") && nombre.includes("20261005") ? 25 * 60_000 : 0);
  const primera = await m.correr("2026-10-06T13:00:30Z");
  assert.deepEqual([primera.pendientes, primera.fallas], [2, []], "a la primera queda pendiente, sin más");
  const segunda = await m.correr("2026-10-06T14:00:30Z");
  assert.deepEqual(segunda.fallas.map((f) => f.dia), ["2026-10-05"]);
  assert.match(segunda.fallas[0]!.motivo, /dos corridas seguidas.*no alcanz/);
  // Una corrida corta —la del arranque del servicio— no cuenta para eso: no tuvo el tiempo de siempre.
  const otro = mundo();
  respaldoDe(otro.origen, "2026-10-05T13:00:00.000Z");
  otro.origen.tarda = (nombre, operacion) => (operacion === "bajar" && nombre.endsWith(".dump.age") ? 6 * 60_000 : 0);
  for (const hora of ["13", "14", "15"]) assert.deepEqual((await otro.correr(`2026-10-06T${hora}:00:30Z`, { presupuesto: 5 * 60_000 })).fallas, []);
  // Y cuando por fin cabe, la cuenta empieza de nuevo.
  m.origen.tarda = () => 0;
  const tercera = await m.correr("2026-10-06T15:00:30Z");
  assert.deepEqual([tercera.subidos.map((x) => x.dia), tercera.fallas, tercera.pendientes], [["2026-10-05", "2026-10-06"], [], 0]);
  assert.ok(m.diario.objetos.has(martes));
  // Una semana después toca volver a comprobar el diario del lunes, y esa vez se le acaba el tiempo: es la primera, no la tercera.
  m.diario.tarda = (nombre, operacion) => (operacion === "bajar" && nombre.endsWith(".dump.age") && nombre.includes("20261005") ? 25 * 60_000 : 0);
  const despues = await m.correr(new Date(Date.parse("2026-10-06T15:00:30Z") + REVALIDAR_CADA).toISOString());
  assert.deepEqual(despues.fallas, [], "contó como una vez más la que era la primera");
  assert.ok(despues.pendientes > 0);
});

// ── la elección, en la base ────────────────────────────────────────────────

test("la elección de cada día queda decidida en la base, una sola vez: la escritura atrasada de quien perdió el turno no cambia cuál es el diario", async () => {
  // Lo encontró Codex (décima revisión, dos veces): preguntar por el turno antes de escribir no protege una escritura
  // que ya salió. A elige, su sesión muere con la elección en camino; aparece un respaldo anterior; B toma el turno y
  // termina; llega la escritura de A. Antes quedaban la elección de A y el diario de B. Ahora los dos leen la misma.
  const m = mundo();
  const elDeA = respaldoDe(m.origen, "2026-10-06T14:00:00.000Z");
  let elAnterior = "";
  let deB = null as AlDia | null;
  let enCamino = false;
  m.diario.antesDeSubir = async (nombre) => {
    if (enCamino || !nombre.startsWith("elecciones/")) return;
    enCamino = true;
    elAnterior = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
    // B: otro proceso —no recuerda nada—, con la misma base y los mismos depósitos.
    deB = await ponerAlDia({ origen: m.origen, diario: m.diario, zona: PATIO, ahora: new Date("2026-10-06T14:00:40Z"), comprobados: sinComprobar(), elecciones: m.elecciones });
  };
  const perdioElTurno = (() => {
    let veces = 0;
    return async (): Promise<void> => {
      veces += 1;
      if (veces > 1) throw new Error("se perdió el turno de los respaldos");
    };
  })();
  const deA = await m.correr("2026-10-06T14:00:30Z", { turno: perdioElTurno });
  assert.ok(enCamino && deB, "el caso no se dio");
  assert.deepEqual(deB!.subidos, [{ dia: "2026-10-06", objeto: elDeA }], "B eligió otro: dos corridas, dos diarios distintos del mismo día");
  assert.match(fallasDe(deA).join(" | "), /se perdió el turno/);
  assert.deepEqual(m.diario.respaldos(), [elDeA]);
  assert.ok(!m.diario.objetos.has(elAnterior));
  // Lo escrito lleva además su sello; lo demás es, letra por letra, la elección de la base.
  const { sello, ...escrita } = JSON.parse(m.diario.objetos.get("elecciones/2026-10-06.json")!.toString("utf8")) as Eleccion & { sello: string };
  assert.equal(escrita.objeto, elDeA, "lo que quedó escrito como elección no es el diario que hay");
  assert.deepEqual(await m.elecciones.de("2026-10-06"), escrita);
  assert.match(sello, /^[0-9a-f]{64}$/);
});

test("si al fijar la elección otro ya había fijado la suya, vale la que llegó primero: se sube esa, no la propia", async () => {
  const m = mundo();
  const primero = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  const segundo = respaldoDe(m.origen, "2026-10-06T14:00:00.000Z");
  // Otra corrida fija el segundo justo cuando esta iba a fijar el primero.
  const seAdelanta: Elecciones = {
    de: (dia) => m.elecciones.de(dia),
    fijar: async (e) => {
      const contenido = m.origen.objetos.get(segundo)!;
      await m.elecciones.fijar({ formato: 1, dia: e.dia, objeto: segundo, bytes: contenido.length, sha256: createHash("sha256").update(contenido).digest("hex") });
      return m.elecciones.fijar(e);
    },
  };
  const hecho = await ponerAlDia({ origen: m.origen, diario: m.diario, zona: PATIO, ahora: new Date("2026-10-06T14:00:30Z"), comprobados: sinComprobar(), elecciones: seAdelanta });
  assert.deepEqual(hecho.subidos, [{ dia: "2026-10-06", objeto: segundo }]);
  assert.deepEqual(m.diario.respaldos(), [segundo]);
  igualQueElOrigen(m, segundo);
  assert.ok(!m.diario.objetos.has(primero));
  assert.equal((JSON.parse(m.diario.objetos.get("elecciones/2026-10-06.json")!.toString("utf8")) as Eleccion).objeto, segundo);
});

test("la elección también queda escrita en el depósito diario: si la base se restaura de antes y ya no la trae, se toma de ahí, y no se elige otra", async () => {
  const m = mundo();
  const siete = respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === siete ? "antes" : null);
  await m.correr("2026-10-06T13:00:30Z");
  m.diario.tropiezo = () => null;
  // Se pierde la máquina: la base vuelve de un respaldo anterior a la elección. Y aparece un respaldo más temprano.
  m.restaurarLaBase();
  m.reiniciar();
  assert.equal(await m.elecciones.de("2026-10-06"), null);
  respaldoDe(m.origen, "2026-10-06T12:00:00.000Z");
  assert.deepEqual((await m.correr("2026-10-06T14:00:30Z")).subidos, [{ dia: "2026-10-06", objeto: siete }]);
  assert.equal((await m.elecciones.de("2026-10-06"))?.objeto, siete, "la elección tomada del depósito no quedó en la base");
  // Al revés: la base la tiene y lo escrito en el depósito ya no se lee. Manda la base, y lo escrito se repone.
  const otro = mundo();
  const lunes = respaldoDe(otro.origen, "2026-10-05T13:00:00.000Z");
  otro.diario.tropiezo = (operacion, nombre) => (operacion === "subir" && nombre === lunes ? "antes" : null);
  await otro.correr("2026-10-05T13:00:30Z");
  otro.diario.tropiezo = () => null;
  otro.diario.objetos.set("elecciones/2026-10-05.json", Buffer.from("{ no es json"));
  const hecho = await otro.correr("2026-10-05T14:00:30Z");
  assert.deepEqual([hecho.subidos, hecho.fallas], [[{ dia: "2026-10-05", objeto: lunes }], []]);
  assert.equal((JSON.parse(otro.diario.objetos.get("elecciones/2026-10-05.json")!.toString("utf8")) as Eleccion).objeto, lunes);
});

// ── las anotaciones del depósito diario llevan sello ───────────────────────
// Lo encontró Codex (docs/revisiones/2026-10-13-codex-revision-de-los-intentos-y-el-sello.md, B1): el
// manifiesto de cada respaldo ya iba sellado, pero no las dos anotaciones chicas que el diario deja
// en su depósito. Quien pudiera escribir ahí no lograba que se restaurara nada suyo, pero sí callar
// el aviso de un día sin diario, o hacer que la base tomara por elección de un día el respaldo de otro.

const NOTA_DE_HUECO = "aviso de un día sin diario";
const NOTA_DE_ELECCION = "elección del diario";

test("una anotación de hueco sin el sello de este negocio no da el hueco por avisado, aunque sea de ese día y esté bien formada", async () => {
  const m = mundo();
  respaldoDe(m.origen, "2026-10-06T13:00:00.000Z", { manifiestoDanado: true });
  const nota = { formato: 1, dia: "2026-10-06", motivo: "x", avisado: "2026-10-07T00:00:00.000Z" };
  const poner = (algo: unknown): void => { m.diario.objetos.set("elecciones/2026-10-06.hueco.json", Buffer.from(JSON.stringify(algo))); m.reiniciar(); };
  const huecos = async (hora: string): Promise<string[]> => (await m.correr(`2026-10-07T${hora}:00Z`, { avisa: false })).huecos.map((h) => h.dia);
  poner(nota);
  assert.deepEqual(await huecos("12:00"), ["2026-10-06"], "una anotación sin sello calló el aviso");
  // Con el sello de otra clave, con el de otra clase de anotación, o cambiada después de sellada: tampoco.
  poner({ ...nota, sello: selloDeNota(NOTA_DE_HUECO, [1, nota.dia, nota.motivo, nota.avisado], "ab".repeat(32)) });
  assert.deepEqual(await huecos("12:10"), ["2026-10-06"]);
  poner({ ...nota, sello: selloDeNota(NOTA_DE_ELECCION, [1, nota.dia, nota.motivo, nota.avisado], SELLO_DE_PRUEBA) });
  assert.deepEqual(await huecos("12:20"), ["2026-10-06"]);
  poner({ ...nota, avisado: "2026-10-08T00:00:00.000Z", sello: selloDeNota(NOTA_DE_HUECO, [1, nota.dia, nota.motivo, nota.avisado], SELLO_DE_PRUEBA) });
  assert.deepEqual(await huecos("12:30"), ["2026-10-06"]);
  // La que deja el propio programa cuando el aviso llegó, sí: y sobrevive a reiniciar el servicio.
  assert.deepEqual((await m.correr("2026-10-07T12:40:00Z")).huecos.map((h) => h.dia), ["2026-10-06"]);
  m.reiniciar();
  assert.deepEqual(await huecos("12:50"), []);
});

test("una elección escrita en el depósito que no lleva el sello de este negocio no se fija en la base, aunque nombre un respaldo que sí lo lleva", async () => {
  const m = mundo();
  const lunes = respaldoDe(m.origen, "2026-10-05T13:00:00.000Z");
  respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  const delLunes = JSON.parse(m.origen.objetos.get(nombreDeManifiesto(lunes))!.toString()) as Manifiesto;
  // La base no tiene elección del martes, y en el depósito alguien dejó una: el respaldo del lunes, que es auténtico.
  const falsa = { formato: 1, dia: "2026-10-06", objeto: lunes, bytes: delLunes.bytes, sha256: delLunes.sha256 };
  m.diario.objetos.set("elecciones/2026-10-06.json", Buffer.from(JSON.stringify(falsa)));
  const hecho = await m.correr("2026-10-06T14:00:00Z");
  assert.equal(await m.elecciones.de("2026-10-06"), null, "se fijó una elección que nadie selló");
  assert.match(fallasDe(hecho).join(" | "), /2026-10-06.*elección.*no se puede leer/);
  // El lunes, que no tiene nada raro, se resuelve como siempre.
  assert.deepEqual(hecho.subidos, [{ dia: "2026-10-05", objeto: lunes }]);
  // Sellada con la clave de este negocio pero nombrando un respaldo de otro día: tampoco. El diario de un día es de ese día.
  m.diario.objetos.set("elecciones/2026-10-06.json", Buffer.from(JSON.stringify({
    ...falsa, sello: selloDeNota(NOTA_DE_ELECCION, [1, falsa.dia, falsa.objeto, falsa.bytes, falsa.sha256], SELLO_DE_PRUEBA),
  })));
  m.reiniciar();
  const otra = await m.correr("2026-10-06T14:30:00Z");
  assert.equal(await m.elecciones.de("2026-10-06"), null, "se fijó como diario del martes un respaldo del lunes");
  assert.match(fallasDe(otra).join(" | "), /2026-10-06.*no es de ese día/);
});

// ── el repaso, cuando algo no sale ─────────────────────────────────────────

test("un diario viejo que ya no coincide con su huella se avisa hasta que el vigilante lo recibe, sin esperar al repaso del mes siguiente", async () => {
  // Lo encontró Codex en la segunda vuelta de su décima revisión: el repaso quedaba anotado como hecho antes de que
  // llegara el aviso; si el aviso no llegaba, la corrida siguiente decía «bien», y así un mes.
  const m = mundo();
  const viejo = respaldoDe(m.diario, "2026-10-05T13:00:00.000Z");
  respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.objetos.set(viejo, Buffer.alloc(m.diario.objetos.get(viejo)!.length, "x"));
  const primera = await m.correr("2026-10-06T13:00:30Z", { avisa: false });
  assert.deepEqual(primera.huecos.map((h) => h.dia), ["2026-10-05"]);
  // El aviso no llegó. La corrida siguiente lo repite —sin volver a bajar el archivo: ya se sabe que está dañado—.
  const segunda = await m.correr("2026-10-06T14:00:30Z", { avisa: false });
  assert.deepEqual(segunda.huecos.map((h) => h.dia), ["2026-10-05"], "el aviso que no llegó se dio por dado");
  assert.match(segunda.huecos[0]!.motivo, /ya no coincide con su huella, y su original ya venció/);
  assert.equal(m.diario.bajadas.filter((n) => n === viejo).length, 1, "volvió a bajar el archivo para repetir el aviso");
  // Cuando llega, queda anotado, y ya no se repite.
  assert.deepEqual((await m.correr("2026-10-06T15:00:30Z")).huecos.map((h) => h.dia), ["2026-10-05"]);
  assert.deepEqual((await m.correr("2026-10-06T16:00:30Z")).huecos, []);
});

test("un diario viejo que no se deja leer no acapara el repaso: los demás se repasan, y de él se sigue diciendo que no se pudo", async () => {
  // Lo encontró Codex en la segunda vuelta de su décima revisión: cada corrida escogía al mismo, fallaba, y el
  // siguiente —dañado— no se comprobaba nunca.
  const m = mundo();
  const [terco, danado] = ["2026-10-04", "2026-10-05"].map((dia) => respaldoDe(m.diario, `${dia}T13:00:00.000Z`));
  respaldoDe(m.origen, "2026-10-06T13:00:00.000Z");
  m.diario.objetos.set(danado!, Buffer.alloc(m.diario.objetos.get(danado!)!.length, "x"));
  m.diario.tropiezo = (operacion, nombre) => (operacion === "bajar" && nombre === nombreDeManifiesto(terco!) ? "antes" : null);
  const primera = await m.correr("2026-10-06T13:00:30Z");
  assert.match(fallasDe(primera).join(" | "), /el repaso: .*no contesta/);
  const segunda = await m.correr("2026-10-06T14:00:30Z");
  assert.deepEqual(segunda.huecos.map((h) => h.dia), ["2026-10-05"], "el diario dañado no se llegó a comprobar");
  // Del que no se deja leer se sigue diciendo, en cada corrida, hasta que su repaso salga.
  assert.match(fallasDe(segunda).join(" | "), /el repaso: .*no contesta/);
  m.diario.tropiezo = () => null;
  const tercera = await m.correr("2026-10-06T15:00:30Z");
  assert.deepEqual([tercera.fallas, tercera.huecos], [[], []]);
  assert.ok(m.diario.bajadas.includes(terco!), "cuando se dejó leer, no se repasó");
});
