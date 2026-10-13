// Los colores de la interfaz, por cálculo. La pantalla se usa en el patio, a veces al sol: que un
// texto se lea no se deja a ojo. Aquí se resuelven los valores de cada modo —claro, oscuro, y «más
// contraste» sobre un equipo claro y sobre uno oscuro— y se mide el contraste de cada par
// texto/fondo, con las transparencias ya compuestas sobre lo que tienen debajo.
//
// Los valores salen de dos lados: el paquete de valores (node_modules/@ios27_design_system/tokens)
// y la capa propia (src/estilo/valores.css), que es la única que las pantallas usan.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const PAQUETE = join(RAIZ, "node_modules/@ios27_design_system/tokens/dist/css");
const PROPIA = join(RAIZ, "src/estilo/valores.css");

type Modo = "claro" | "oscuro" | "contraste" | "contraste en un equipo oscuro";
const MODOS: Modo[] = ["claro", "oscuro", "contraste", "contraste en un equipo oscuro"];

interface Bloque { selector: string; oscuro: boolean; valores: Map<string, string> }

/** Los bloques de una hoja de estilos: su selector, si van dentro de «el equipo está en oscuro», y sus variables. */
function bloques(css: string): Bloque[] {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const salida: Bloque[] = [];
  const leer = (texto: string, oscuro: boolean): void => {
    let i = 0;
    while (i < texto.length) {
      const abre = texto.indexOf("{", i);
      if (abre < 0) return;
      const cabeza = texto.slice(i, abre).trim();
      let hondo = 1;
      let j = abre + 1;
      while (j < texto.length && hondo > 0) {
        if (texto[j] === "{") hondo += 1;
        if (texto[j] === "}") hondo -= 1;
        j += 1;
      }
      const cuerpo = texto.slice(abre + 1, j - 1);
      if (cabeza.startsWith("@media")) {
        if (/prefers-color-scheme\s*:\s*dark/.test(cabeza)) leer(cuerpo, true);
      } else if (!cabeza.startsWith("@")) {
        const valores = new Map<string, string>();
        for (const m of cuerpo.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) valores.set(m[1]!, m[2]!.trim());
        if (valores.size) salida.push({ selector: cabeza.replace(/\s+/g, ""), oscuro, valores });
      }
      i = j;
    }
  };
  leer(limpio, false);
  return salida;
}

/** Las variables que valen en ese modo, en el orden en que el navegador las aplicaría. */
async function variables(modo: Modo): Promise<Map<string, string>> {
  const oscuro = modo === "oscuro" || modo === "contraste en un equipo oscuro";
  const alto = modo.startsWith("contraste");
  const v = new Map<string, string>();
  const poner = (b: Bloque): void => { for (const [k, x] of b.valores) v.set(k, x); };
  for (const archivo of ["tokens.css", "materials.css", "spacing.css", "typography.css", "animations.css"]) {
    const bs = bloques(await readFile(join(PAQUETE, archivo), "utf8"));
    bs.filter((b) => !b.oscuro && b.selector === ":root").forEach(poner);
    if (oscuro) bs.filter((b) => b.oscuro && b.selector.startsWith(":root")).forEach(poner);
  }
  const propia = bloques(await readFile(PROPIA, "utf8"));
  propia.filter((b) => !b.oscuro && b.selector === ":root").forEach(poner);
  if (oscuro) propia.filter((b) => b.oscuro && b.selector === ":root").forEach(poner);
  // «Más contraste» manda sobre los dos: su selector pesa más que el de la raíz sola.
  if (alto) propia.filter((b) => !b.oscuro && b.selector === ':root[data-contraste="alto"]').forEach(poner);
  return v;
}

function resolver(v: Map<string, string>, nombre: string, hondo = 0): string {
  const crudo = v.get(nombre);
  assert.ok(crudo !== undefined, `no existe ${nombre}`);
  assert.ok(hondo < 12, `${nombre} se refiere a sí misma`);
  return crudo.replace(/var\(\s*(--[A-Za-z0-9-]+)\s*\)/g, (_m, otra: string) => resolver(v, otra, hondo + 1));
}

/** Las hojas de estilo propias, sin comentarios. */
async function hojasDeEstilo(): Promise<Array<{ camino: string; css: string }>> {
  const salida: Array<{ camino: string; css: string }> = [];
  const mirar = async (carpeta: string): Promise<void> => {
    for (const e of await readdir(carpeta, { withFileTypes: true })) {
      const camino = join(carpeta, e.name);
      if (e.isDirectory()) await mirar(camino);
      else if (e.name.endsWith(".css")) salida.push({ camino: camino.slice(RAIZ.length), css: (await readFile(camino, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "") });
    }
  };
  await mirar(join(RAIZ, "src"));
  return salida;
}

interface Color { r: number; g: number; b: number; a: number }

function color(texto: string): Color {
  const t = texto.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1]!;
    const par = h.length <= 4 ? [...h].map((c) => c + c) : h.match(/../g)!;
    const [r, g, b, a] = par.map((x) => parseInt(x, 16));
    return { r: r!, g: g!, b: b!, a: a === undefined ? 1 : a / 255 };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(t);
  if (m) {
    const [r, g, b, a] = m[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: r!, g: g!, b: b!, a: a === undefined ? 1 : a };
  }
  throw new Error(`no sé leer el color «${texto}»`);
}

/** Lo de arriba, con su transparencia, puesto sobre lo de abajo (que ya es sólido). */
const sobre = (arriba: Color, abajo: Color): Color => ({
  r: arriba.r * arriba.a + abajo.r * (1 - arriba.a), g: arriba.g * arriba.a + abajo.g * (1 - arriba.a),
  b: arriba.b * arriba.a + abajo.b * (1 - arriba.a), a: 1,
});

function luminancia(c: Color): number {
  const canal = (x: number): number => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(c.r) + 0.7152 * canal(c.g) + 0.0722 * canal(c.b);
}

function contraste(a: Color, b: Color): number {
  const [clara, oscura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara! + 0.05) / (oscura! + 0.05);
}

/**
 * Cada par que la interfaz usa: qué va encima, sobre qué capas (de arriba hacia abajo; la última
 * es sólida) y si es texto. El texto pide 4.5 a 1 (7 a 1 con «más contraste»); lo que no es texto
 * —el borde de un control, el aro del foco— pide 3 a 1 (4.5 con «más contraste»).
 */
const PARES: Array<{ que: string; encima: string; capas: string[]; texto: boolean }> = [
  { que: "el texto sobre el fondo", encima: "--texto", capas: ["--fondo"], texto: true },
  { que: "el texto sobre una tarjeta", encima: "--texto", capas: ["--superficie"], texto: true },
  { que: "el texto sobre un relleno", encima: "--texto", capas: ["--relleno", "--superficie"], texto: true },
  { que: "el texto secundario sobre el fondo", encima: "--texto-2", capas: ["--fondo"], texto: true },
  { que: "el texto secundario sobre una tarjeta", encima: "--texto-2", capas: ["--superficie"], texto: true },
  { que: "el acento como texto sobre una tarjeta", encima: "--acento", capas: ["--superficie"], texto: true },
  { que: "el acento como texto sobre el fondo", encima: "--acento", capas: ["--fondo"], texto: true },
  { que: "el acento sobre su tinte (botón suave)", encima: "--acento", capas: ["--acento-suave", "--superficie"], texto: true },
  { que: "la letra de un botón lleno", encima: "--sobre-acento", capas: ["--acento-lleno"], texto: true },
  { que: "la letra de un botón de peligro", encima: "--sobre-alerta", capas: ["--alerta-llena"], texto: true },
  { que: "un aviso de error sobre una tarjeta", encima: "--alerta", capas: ["--superficie"], texto: true },
  { que: "un aviso de error sobre su tinte", encima: "--alerta", capas: ["--alerta-suave", "--superficie"], texto: true },
  { que: "«compra» sobre una tarjeta", encima: "--compra", capas: ["--superficie"], texto: true },
  { que: "«venta» sobre una tarjeta", encima: "--venta", capas: ["--superficie"], texto: true },
  { que: "un «listo» sobre una tarjeta", encima: "--bien", capas: ["--superficie"], texto: true },
  { que: "el texto sobre la barra de vidrio", encima: "--texto", capas: ["--vidrio", "--fondo"], texto: true },
  // La barra se queda arriba y por debajo le pasa de todo: se mide con lo más oscuro y con lo más claro detrás.
  { que: "el texto sobre la barra de vidrio, con algo negro pasando por debajo", encima: "--texto", capas: ["--vidrio", "#000000"], texto: true },
  { que: "el texto sobre la barra de vidrio, con algo blanco pasando por debajo", encima: "--texto", capas: ["--vidrio", "#ffffff"], texto: true },
  { que: "la letra de un botón gris sobre el fondo", encima: "--texto", capas: ["--relleno", "--fondo"], texto: true },
  { que: "un aviso de error sobre el fondo", encima: "--alerta", capas: ["--fondo"], texto: true },
  { que: "el borde de un control sobre el fondo", encima: "--borde-control", capas: ["--fondo"], texto: false },
  { que: "la palanca del interruptor, encendida, contra el fondo", encima: "--acento-lleno", capas: ["--fondo"], texto: false },
  { que: "el borde de un control sobre una tarjeta", encima: "--borde-control", capas: ["--superficie"], texto: false },
  { que: "el aro del foco sobre el fondo", encima: "--foco", capas: ["--fondo"], texto: false },
  { que: "el aro del foco sobre una tarjeta", encima: "--foco", capas: ["--superficie"], texto: false },
  // En la barra de las pantallas el aro va por dentro del enlace. En los que no son la pantalla actual, sobre el
  // vidrio de la barra; en el de la pantalla actual, sobre su relleno de acento: ahí va del color de su letra.
  { que: "el aro del foco, por dentro de un enlace de la barra", encima: "--foco", capas: ["--vidrio", "--fondo"], texto: false },
  { que: "el aro del foco, por dentro del enlace de la pantalla actual", encima: "--sobre-acento", capas: ["--acento-lleno"], texto: false },
];

for (const modo of MODOS) {
  test(`en modo ${modo}, cada texto se lee sobre su fondo`, async () => {
    const v = await variables(modo);
    const de = (nombre: string): Color => color(nombre.startsWith("--") ? resolver(v, nombre) : nombre);
    const alto = modo.startsWith("contraste");
    const cortos: string[] = [];
    for (const par of PARES) {
      // Se compone de abajo hacia arriba.
      let fondo = de(par.capas.at(-1)!);
      assert.equal(fondo.a, 1, `${par.capas.at(-1)} debe ser sólido en modo ${modo}`);
      for (const capa of par.capas.slice(0, -1).reverse()) fondo = sobre(de(capa), fondo);
      const razon = contraste(sobre(de(par.encima), fondo), fondo);
      const minimo = par.texto ? (alto ? 7 : 4.5) : (alto ? 4.5 : 3);
      if (razon < minimo) cortos.push(`${par.que}: ${razon.toFixed(2)} a 1 (pide ${minimo})`);
    }
    assert.deepEqual(cortos, [], `no se leen bien en modo ${modo}`);
  });
}

test("el aro del foco del enlace de la pantalla actual no es del color de su relleno: va del color con que ahí se escribe", async () => {
  // Lo encontró Codex en su décima revisión: el aro iba por dentro, en --foco, sobre --acento-lleno. En claro son el
  // mismo azul (1.00 a 1): el foco desaparecía justo en la pantalla en que se está.
  const sesion = await readFile(new URL("../src/estilo/sesion.css", import.meta.url), "utf8");
  assert.match(sesion, /\.pantallas a\[aria-current="true"\]:focus-visible\{outline-color:var\(--sobre-acento\)\}/);
  // Y sin esa regla, el par que quedaba —el aro de siempre sobre el relleno de acento— no se distingue en claro.
  const claro = await variables("claro");
  assert.ok(contraste(color(resolver(claro, "--foco")), color(resolver(claro, "--acento-lleno"))) < 3, "si este par ya se distingue, la regla sobra");
});

test("el acento es azul y fijo; con «más contraste» no hay vidrio ni transparencias, también si el equipo está en oscuro", async () => {
  assert.equal(resolver(await variables("claro"), "--acento").toLowerCase(), "#0a66e4");
  for (const modo of ["contraste", "contraste en un equipo oscuro"] as const) {
    const v = await variables(modo);
    for (const solido of ["--vidrio", "--relleno", "--acento-suave", "--alerta-suave", "--separador", "--texto-2"]) {
      assert.equal(color(resolver(v, solido)).a, 1, `${solido} sigue siendo transparente en modo ${modo}`);
    }
    assert.equal(resolver(v, "--desenfoque"), "none", `sigue habiendo desenfoque en modo ${modo}`);
    // Y es claro, sea cual sea el modo del equipo: fondo blanco, texto negro.
    assert.ok(luminancia(color(resolver(v, "--fondo"))) > 0.9, `el fondo no es claro en modo ${modo}`);
    assert.ok(luminancia(color(resolver(v, "--texto"))) < 0.05, `el texto no es oscuro en modo ${modo}`);
  }
});

test("sin haber elegido, si el equipo pide más contraste se le da el mismo que al elegirlo; «normal», elegido, le gana al equipo", async () => {
  const propia = bloques(await readFile(PROPIA, "utf8"));
  const elegido = propia.filter((b) => b.selector === ':root[data-contraste="alto"]');
  // Va dentro de «el equipo pide más contraste», y solo para quien no ha elegido nada.
  const css = (await readFile(PROPIA, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const m = /@media\s*\(prefers-contrast\s*:\s*more\)\s*\{\s*:root:not\(\[data-contraste\]\)\s*\{([^}]*)\}\s*\}/.exec(css);
  assert.ok(m, "falta el bloque para el equipo que pide más contraste sin que nadie haya elegido");
  assert.equal(elegido.length, 1);
  const delEquipo = new Map<string, string>();
  for (const d of m[1]!.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) delEquipo.set(d[1]!, d[2]!.trim());
  assert.deepEqual([...delEquipo].sort(), [...elegido[0]!.valores].sort(), "los dos bloques de más contraste dicen cosas distintas");
  // «normal» elegido no lleva ninguna regla propia: lo que importa es que el bloque del equipo no le aplique.
  assert.ok(!/data-contraste="normal"/.test(css), "«normal» no necesita reglas: basta con que tenga el atributo");
});

test("con más contraste los bordes se marcan: el valor existe, vale cero sin él, y lo usan la hoja y la barra", async () => {
  assert.equal(parseFloat(resolver(await variables("claro"), "--borde-marcado")), 0);
  assert.equal(parseFloat(resolver(await variables("oscuro"), "--borde-marcado")), 0);
  for (const modo of ["contraste", "contraste en un equipo oscuro"] as const) {
    assert.ok(parseFloat(resolver(await variables(modo), "--borde-marcado")) >= 2, modo);
  }
  // Nadie pregunta por su cuenta si hay más contraste (así se le olvidaba al equipo que lo pide sin que nadie elija):
  // fuera de la capa de valores y del comprobante, que no hereda nada, ninguna hoja nombra el atributo.
  for (const hoja of await hojasDeEstilo()) {
    if (hoja.camino.endsWith("valores.css") || hoja.camino.endsWith("comprobante.css")) continue;
    assert.ok(!hoja.css.includes("data-contraste"), `${hoja.camino} pregunta por el contraste en vez de usar los valores`);
  }
  // El comprobante sí pregunta, y entonces por los dos caminos: elegido, y pedido por el equipo.
  const comprobante = (await hojasDeEstilo()).find((h) => h.camino.endsWith("comprobante.css"))!.css;
  assert.match(comprobante, /:root\[data-contraste="alto"\]\s*:is\(\.ticket,\.ticket-negocio\)\{([^}]+)\}/);
  const elegido = /:root\[data-contraste="alto"\]\s*:is\(\.ticket,\.ticket-negocio\)\{([^}]+)\}/.exec(comprobante)![1];
  const pedido = /@media\s*\(prefers-contrast:more\)\s*\{\s*:root:not\(\[data-contraste\]\)\s*:is\(\.ticket,\.ticket-negocio\)\{([^}]+)\}/.exec(comprobante)?.[1];
  assert.equal(pedido, elegido, "el comprobante en pantalla no sigue al equipo que pide más contraste");
});

// Sobre el fondo gris, el azul encima de su tinte da 4.2 a 1 y el rojo 4.4: no alcanzan. Por eso un
// tinte no se pone solo: va con su superficie debajo (--tinte-acento, --tinte-alerta), y entonces
// lo que se mide arriba —el color sobre su tinte sobre superficie— es lo que de verdad se ve.
test("un tinte nunca va directo sobre lo que haya detrás: lleva su superficie debajo", async () => {
  const v = bloques(await readFile(PROPIA, "utf8")).find((b) => b.selector === ":root" && !b.oscuro)!.valores;
  for (const [tinte, suave] of [["--tinte-acento", "--acento-suave"], ["--tinte-alerta", "--alerta-suave"]] as const) {
    assert.equal(v.get(tinte)?.replace(/\s+/g, ""), `linear-gradient(var(${suave}),var(${suave}))var(--superficie)`, tinte);
  }
  for (const hoja of await hojasDeEstilo()) {
    if (hoja.camino.endsWith("valores.css")) continue;
    for (const solo of ["var(--acento-suave)", "var(--alerta-suave)"]) {
      assert.ok(!hoja.css.includes(solo), `${hoja.camino} usa ${solo} solo, sin superficie debajo`);
    }
  }
});

test("el vidrio tiene salida: si el navegador no desenfoca, o el equipo pide menos transparencia, la barra va sobre superficie sólida", async () => {
  const css = (await hojasDeEstilo()).map((h) => h.css).join("\n").replace(/\s+/g, "");
  assert.match(css, /\.vidrio\{[^}]*background:var\(--vidrio\)[^}]*backdrop-filter:var\(--desenfoque\)/);
  assert.match(css, /@supportsnot\(\(backdrop-filter:blur\(1px\)\)or\(-webkit-backdrop-filter:blur\(1px\)\)\)\{\.vidrio\{[^}]*background:var\(--superficie\)/);
  assert.match(css, /@media\(prefers-reduced-transparency:reduce\)\{\.vidrio\{[^}]*background:var\(--superficie\)[^}]*backdrop-filter:none/);
});

test("nada depende de pasar el puntero por encima: lo que cambia al pasarlo va solo donde hay puntero", async () => {
  for (const hoja of await hojasDeEstilo()) {
    // Se quitan los bloques que solo valen donde hay puntero fino; lo que quede no puede decir :hover.
    let resto = hoja.css;
    for (;;) {
      const a = resto.search(/@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{/);
      if (a < 0) break;
      let hondo = 0;
      let j = resto.indexOf("{", a);
      do { if (resto[j] === "{") hondo += 1; if (resto[j] === "}") hondo -= 1; j += 1; } while (hondo > 0 && j < resto.length);
      resto = resto.slice(0, a) + resto.slice(j);
    }
    assert.ok(!resto.includes(":hover"), `${hoja.camino} cambia algo al pasar el puntero, también donde no hay puntero`);
  }
});

test("lo que se toca mide al menos 60 px y el texto 17: son valores de la capa, no de cada pantalla", async () => {
  const v = await variables("claro");
  assert.ok(parseFloat(resolver(v, "--toque")) >= 60);
  assert.ok(parseFloat(resolver(v, "--letra-base")) >= 17);
  assert.ok(parseFloat(resolver(v, "--separacion-de-toque")) >= 8);
});

test("las pantallas usan los nombres del negocio: los valores del paquete solo se nombran en la capa propia", async () => {
  const fuera: string[] = [];
  const mirar = async (carpeta: string): Promise<void> => {
    for (const e of await readdir(carpeta, { withFileTypes: true })) {
      const camino = join(carpeta, e.name);
      if (e.isDirectory()) await mirar(camino);
      else if (/\.(tsx?|css)$/.test(e.name) && camino !== PROPIA && (await readFile(camino, "utf8")).includes("--ios27-")) fuera.push(camino.slice(RAIZ.length));
    }
  };
  await mirar(join(RAIZ, "src"));
  assert.deepEqual(fuera, []);
});

// Dos veces una hoja nueva le puso su estilo, sin querer, a algo que ya existía, por llamar a una
// clase con un nombre que ya estaba tomado: «.b» y «.compra» del panel deformaron el comprobante
// impreso (11 de octubre), y «.ajuste» de los ajustes le cayó al interruptor de «más contraste»
// de la barra (12 de octubre). Una regla cuyo selector es una clase sola le pega a todo lo que se
// llame así, esté donde esté.
test("una hoja nueva no le cae encima a lo que ya existía: lo que el panel y los ajustes definen con una clase sola no se nombra en ninguna otra hoja", async () => {
  const carpeta = join(RAIZ, "src/estilo");
  const hojas = new Map<string, string>();
  for (const archivo of (await readdir(carpeta)).filter((f) => f.endsWith(".css"))) {
    hojas.set(archivo, (await readFile(join(carpeta, archivo), "utf8")).replace(/\/\*[\s\S]*?\*\//g, ""));
  }
  const repetidas: string[] = [];
  for (const nueva of ["panel.css", "ajustes.css"]) {
    const solas = new Set([...hojas.get(nueva)!.matchAll(/(?:^|[},])\s*\.([a-z][a-z0-9-]*)\s*\{/g)].map((m) => m[1]!));
    assert.ok(solas.size > 0, `${nueva} no tiene ninguna regla de una clase sola: ¿cambió cómo se escribe?`);
    for (const clase of solas) {
      for (const [otra, css] of hojas) {
        if (otra !== nueva && new RegExp(`\\.${clase}(?![a-z0-9-])`).test(css)) repetidas.push(`.${clase}, de ${nueva}, ya se usa en ${otra}`);
      }
    }
  }
  assert.deepEqual(repetidas, []);
});
