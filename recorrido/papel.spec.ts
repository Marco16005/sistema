// El papel: lo que sale de la impresora, renglón por renglón y cada cosa en su lugar. Es lo único
// que el cliente se lleva, y rediseñar la pantalla no puede moverle nada. Cada caso se compara con
// su retrato guardado en recorrido/papel/: lo que dice (el .json: cada renglón, dónde y con qué
// letra) y cómo se ve (el .png: la hoja, punto por punto). Un retrato se vuelve a tomar solo a
// propósito, cuando se decidió cambiar el papel:
//   docker compose --profile recorrido run --rm -e PAPEL=guardar recorrido \
//     sh -c "npm ci --no-audit --no-fund --silent && npx playwright test papel"
import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { baseNueva, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, pesar, teclear } from "./apoyo.ts";
import type { Gente } from "./apoyo.ts";

test.beforeEach(baseNueva);

const CARPETA = "recorrido/papel";

interface Renglon {
  texto: string; x: number; y: number; ancho: number; alto: number; letra: string; tamano: string; peso: string;
  /** Cómo se ve, además de dónde está: su tinta, qué tan tenue va, y si de verdad sale. */
  color: string; opacidad: number; seVe: boolean; estilo: string; adorno: string; caja: string; raya: string; fondo: string;
}
interface Copia { clase: string; x: number; y: number; ancho: number; fondo: string; orilla: string; renglones: Renglon[] }
interface Corte { y: number; alto: number; raya: string; seVe: boolean }
interface Retrato { copias: Copia[]; corte: Corte | null; loDemas: string[]; fondoDeLaHoja: string; paginas: number }

/** Cómo se ve cada retrato: la imagen de la hoja. Va aparte: en el .json no cabe. */
const IMAGEN = new WeakMap<Retrato, Buffer>();

/**
 * Cómo saldría en papel lo que hay en pantalla: cada copia, dónde queda y de qué ancho, y cada
 * renglón con su texto, su lugar dentro de la copia, su letra y cómo se ve (tinta, qué tan tenue,
 * si es visible, sus rayas). La línea de corte entre las dos copias. Lo demás de la página que
 * también saldría —no debe salir nada—. Y en cuántas hojas sale.
 * La fecha, la hora y el identificador de la operación cambian en cada corrida: se dejan en blanco.
 *
 * Y además cómo se ve: una imagen de la hoja, con esas tres cosas ya en blanco. Lo que el retrato
 * de renglones no alcanza a ver —un filtro sobre la hoja entera, algo pintado encima con ::before,
 * un recorte, una letra que se dibuja distinto en la misma caja— sí cambia la imagen.
 *
 * Lo que no ve: el punto exacto en que la impresora térmica corta, ni cómo traduce su controlador
 * los grises. Eso se mira en el papel de verdad (tarea 8 del rediseño). La imagen es de la hoja
 * como la pinta el navegador con los estilos de imprimir, no del PDF vuelto imagen: de las hojas
 * del PDF se cuenta cuántas son.
 */
async function retratar(page: Page): Promise<Retrato> {
  await page.emulateMedia({ media: "print" });
  try {
    await page.evaluate(() => document.fonts.ready);
    const visto = await page.evaluate(() => {
      const redondo = (n: number): number => Math.round(n * 100) / 100;
      const fijo = (t: string): string =>
        t.replace(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/, "DD/MM/AAAA HH:MM").replace(/Operación [0-9a-f]{8}/, "Operación xxxxxxxx");
      // El nombre con que la aplicación sirve una letra lleva un sello que cambia al construir; la letra es la misma.
      const sinSello = (familia: string): string => familia.replace(/_[0-9a-f]{6}(?=[,"' ]|$)/g, "");
      const raya = (s: CSSStyleDeclaration): string =>
        ["Top", "Right", "Bottom", "Left"].map((lado) => {
          const estilo = s.getPropertyValue(`border-${lado.toLowerCase()}-style`);
          return estilo === "none" ? "" : `${lado.toLowerCase()}: ${estilo} ${s.getPropertyValue(`border-${lado.toLowerCase()}-width`)} ${s.getPropertyValue(`border-${lado.toLowerCase()}-color`)}`;
        }).filter(Boolean).join("; ");
      const papel = document.querySelector<HTMLElement>(".papel");
      /** Qué tan tenue llega al papel: lo suyo por lo de todo lo que lo envuelve, hasta la hoja. */
      const opacidad = (e: Element): number => {
        let o = 1;
        for (let n: Element | null = e; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
        return redondo(o);
      };
      const sale = (e: Element): boolean => {
        const s = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return s.visibility === "visible" && s.display !== "none" && r.width > 0 && r.height > 0;
      };
      const copias = Array.from(document.querySelectorAll<HTMLElement>(".papel > .ticket, .papel > .ticket-negocio")).map((copia) => {
        const c = copia.getBoundingClientRect();
        const sc = getComputedStyle(copia);
        const hojas = Array.from(copia.querySelectorAll<HTMLElement>("div, hr, span")).filter((e) => e.children.length === 0);
        return {
          // Dónde queda en el papel, no en la ventana: que la página esté desplazada no cambia lo que sale impreso.
          clase: copia.className, x: redondo(c.x + window.scrollX), y: redondo(c.y + window.scrollY), ancho: redondo(c.width),
          fondo: sc.backgroundColor, orilla: raya(sc),
          renglones: hojas.map((e) => {
            const r = e.getBoundingClientRect();
            const s = getComputedStyle(e);
            return {
              texto: fijo(e.textContent ?? ""), x: redondo(r.x - c.x), y: redondo(r.y - c.y), ancho: redondo(r.width), alto: redondo(r.height),
              letra: sinSello(s.fontFamily), tamano: s.fontSize, peso: s.fontWeight,
              color: s.color, opacidad: opacidad(e), seVe: sale(e) || (r.height === 0 && s.visibility === "visible"),
              estilo: s.fontStyle, adorno: s.textDecorationLine, caja: s.textTransform, raya: raya(s), fondo: s.backgroundColor,
            };
          }),
        };
      });
      const linea = document.querySelector<HTMLElement>(".papel > .corte");
      const corte = linea && getComputedStyle(linea).display !== "none"
        ? { y: redondo(linea.getBoundingClientRect().y + window.scrollY), alto: redondo(linea.getBoundingClientRect().height), raya: raya(getComputedStyle(linea)), seVe: getComputedStyle(linea).visibility === "visible" }
        : null;
      // Lo demás: cualquier cosa fuera del comprobante que el papel también llevaría.
      const loDemas = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
        .filter((e) => !papel?.contains(e) && sale(e))
        .map((e) => e.tagName.toLowerCase() + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).join(".") : ""));
      return { copias, corte, loDemas, fondoDeLaHoja: getComputedStyle(document.body).backgroundColor };
    });
    // Lo que de verdad va a la impresora: las hojas del documento impreso.
    const pdf = (await page.pdf()).toString("latin1");
    const paginas = (pdf.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
    const retrato: Retrato = { ...visto, paginas };
    // Y cómo se ve. Lo que cambia en cada corrida se pone en blanco para la foto, y se regresa.
    await page.evaluate(() => {
      const fijo = (t: string): string =>
        t.replace(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/, "DD/MM/AAAA HH:MM").replace(/Operación [0-9a-f]{8}/, "Operación xxxxxxxx");
      const cambiados: Array<[Element, string]> = [];
      for (const e of Array.from(document.querySelectorAll(".papel div, .papel span")).filter((x) => x.children.length === 0)) {
        const texto = e.textContent ?? "";
        if (fijo(texto) === texto) continue;
        cambiados.push([e, texto]);
        e.textContent = fijo(texto);
      }
      (window as unknown as { delPapel: Array<[Element, string]> }).delPapel = cambiados;
    });
    try {
      IMAGEN.set(retrato, await page.locator(".papel").screenshot({ animations: "disabled", caret: "hide", scale: "css" }));
    } finally {
      await page.evaluate(() => {
        for (const [e, texto] of (window as unknown as { delPapel: Array<[Element, string]> }).delPapel) e.textContent = texto;
      });
    }
    return retrato;
  } finally {
    await page.emulateMedia({ media: "screen" });
  }
}

/** En cuántos puntos se ve distinta una imagen de otra; o que no miden lo mismo. Las lee el navegador, que sabe. */
function puntosDistintos(page: Page, una: Buffer, otra: Buffer): Promise<number | string> {
  return page.evaluate(async ([a, b]) => {
    const leer = async (base64: string): Promise<ImageData> => {
      const mapa = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const pincel = new OffscreenCanvas(mapa.width, mapa.height).getContext("2d")!;
      pincel.drawImage(mapa, 0, 0);
      return pincel.getImageData(0, 0, mapa.width, mapa.height);
    };
    const [x, y] = [await leer(a!), await leer(b!)];
    if (x.width !== y.width || x.height !== y.height) return `miden distinto: ${x.width}×${x.height} y ${y.width}×${y.height}`;
    let distintos = 0;
    // Un punto cambia si alguno de sus cuatro valores se mueve más de un pelo: lo que el ojo no distingue no cuenta.
    for (let k = 0; k < x.data.length; k += 4) {
      if ([0, 1, 2, 3].some((c) => Math.abs(x.data[k + c]! - y.data[k + c]!) > 8)) distintos += 1;
    }
    return distintos;
  }, [una.toString("base64"), otra.toString("base64")]);
}

/** Dónde empiezan a ser distintas dos cosas leídas de JSON, y cómo; o nada, si son iguales. */
function primeraDiferencia(guardado: unknown, visto: unknown, camino = "retrato"): string | null {
  if (typeof guardado !== "object" || guardado === null || typeof visto !== "object" || visto === null) {
    return guardado === visto ? null : `${camino}: decía ${JSON.stringify(guardado)} y dice ${JSON.stringify(visto)}`;
  }
  for (const llave of new Set([...Object.keys(guardado), ...Object.keys(visto)])) {
    const d = primeraDiferencia((guardado as Record<string, unknown>)[llave], (visto as Record<string, unknown>)[llave], `${camino}.${llave}`);
    if (d !== null) return d;
  }
  return null;
}

/** En qué se aparta ese retrato del guardado: en lo que dice, en cómo se ve, o en nada. */
async function diferencias(page: Page, caso: string, retrato: Retrato): Promise<string[]> {
  const cambios: string[] = [];
  const donde = primeraDiferencia(JSON.parse(readFileSync(`${CARPETA}/${caso}.json`, "utf8")), JSON.parse(JSON.stringify(retrato)));
  if (donde !== null) cambios.push(`lo que dice el papel cambió (${donde})`);
  const puntos = await puntosDistintos(page, readFileSync(`${CARPETA}/${caso}.png`), IMAGEN.get(retrato)!);
  if (puntos !== 0) cambios.push(typeof puntos === "number" ? `el papel se ve distinto en ${puntos} puntos` : `el papel se ve distinto: las imágenes ${puntos}`);
  return cambios;
}

/** Compara con el retrato guardado; o lo guarda, si se pidió tomarlo de nuevo. */
async function comparar(page: Page, caso: string, retrato: Retrato): Promise<void> {
  const archivo = `${CARPETA}/${caso}.json`;
  // Esto no depende de ningún retrato guardado: en el papel sale el comprobante y nada más, y todo renglón se ve.
  expect(retrato.loDemas, `en el papel de «${caso}» saldría algo que no es el comprobante`).toEqual([]);
  const renglones = retrato.copias.flatMap((c) => c.renglones);
  expect(renglones.filter((r) => !r.seVe).map((r) => r.texto), `renglones de «${caso}» que no saldrían`).toEqual([]);
  expect(renglones.filter((r) => r.texto.trim() && r.opacidad < 0.5).map((r) => r.texto), `renglones de «${caso}» demasiado tenues`).toEqual([]);
  expect(retrato.fondoDeLaHoja, "el papel es blanco").toBe("rgb(255, 255, 255)");
  if (process.env.PAPEL === "guardar") {
    mkdirSync(CARPETA, { recursive: true });
    writeFileSync(archivo, JSON.stringify(retrato, null, 1) + "\n");
    writeFileSync(`${CARPETA}/${caso}.png`, IMAGEN.get(retrato)!);
    return;
  }
  for (const guardado of [archivo, `${CARPETA}/${caso}.png`]) expect(existsSync(guardado), `falta el retrato de «${caso}» (${guardado}): se toma con PAPEL=guardar`).toBe(true);
  expect(retrato, `el papel de «${caso}» cambió`).toEqual(JSON.parse(readFileSync(archivo, "utf8")));
  // Si cambió cómo se ve, lo que se vio queda junto al guardado, para ponerlos lado a lado.
  const cambios = await diferencias(page, caso, retrato);
  if (cambios.length > 0) writeFileSync(`${CARPETA}/${caso}.visto.png`, IMAGEN.get(retrato)!);
  expect(cambios, `el papel de «${caso}» cambió (lo que se vio quedó en ${CARPETA}/${caso}.visto.png)`).toEqual([]);
}

async function listo(page: Page, saldos: Array<[string, string]> = []): Promise<Gente> {
  const g = await gente();
  await diaListo(g, saldos);
  await contarImpresiones(page);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  return g;
}

test("el papel de una compra: dos copias, cada una en su hoja", async ({ page }) => {
  await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$63");
  const retrato = await retratar(page);
  expect(retrato.copias.map((c) => c.clase)).toEqual(["ticket", "ticket-negocio"]);
  expect(retrato.paginas).toBe(2);
  await comparar(page, "compra", retrato);
});

// Lo señaló Codex en su décima revisión, sin poder correrlo: el retrato de renglones puede dar por bueno un papel que
// ya no se ve igual. Con la hoja entera sin tinta, cada renglón conserva su caja, su color y su opacidad, y el PDF, sus
// hojas. Aquí se le hace eso al papel a propósito —y otras dos cosas que los renglones tampoco ven—, y la guardia tiene
// que notarlo.
test("la guardia del papel nota un papel que ya no se ve igual aunque cada renglón siga en su lugar: sin tinta, con algo pintado encima, o recortado", async ({ page }) => {
  test.skip(process.env.PAPEL === "guardar", "al tomar los retratos no hay con qué comparar");
  await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$63");
  expect(await diferencias(page, "compra", await retratar(page))).toEqual([]);
  const CAMBIOS: Array<[string, string]> = [
    ["la hoja entera, sin tinta", "@media print{.papel{filter:opacity(0)}}"],
    ["algo pintado encima de una copia", '@media print{.ticket{position:relative}.ticket::after{content:"";position:absolute;inset:0;background:#fff}}'],
    ["una copia recortada a la mitad", "@media print{.ticket{clip-path:inset(0 0 50% 0)}}"],
  ];
  for (const [que, estilo] of CAMBIOS) {
    const puesto = await page.addStyleTag({ content: estilo });
    const cambios = await diferencias(page, "compra", await retratar(page));
    expect(cambios.some((c) => c.includes("se ve distinto")), `${que}: ${cambios.join("; ") || "no notó nada"}`).toBe(true);
    await puesto.evaluate((e) => (e as Element).remove());
  }
  // Y sin nada de eso vuelve a verse igual: lo que notó era el cambio, no la corrida. (Solo la imagen: después de
  // tanto poner y quitar, algún renglón se acomoda dos centésimas de punto más allá, y eso el retrato de renglones lo anota.)
  expect((await diferencias(page, "compra", await retratar(page))).filter((c) => c.includes("se ve distinto"))).toEqual([]);
});

test("el papel de una venta larga, de cuatro materiales", async ({ page }) => {
  await listo(page, [["Cartón", "500"], ["Aluminio bote", "200"], ["Fierro pesado", "900"], ["PET", "300"]]);
  await page.getByRole("button", { name: "+ Venta" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100.5");
  for (const [material, kg, familia] of [["Bote", "50.25", "Aluminio"], ["Pesado", "300", "Fierro"], ["PET", "80.125", "Plástico"]] as const) {
    await page.getByRole("button", { name: "＋ Agregar otro material" }).click();
    await pesar(page, material, "Báscula 2", kg, familia);
  }
  await page.getByRole("button", { name: "Cobrar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("A COBRAR");
  const retrato = await retratar(page);
  expect(retrato.paginas).toBe(2);
  await comparar(page, "venta-larga", retrato);
});

test("el papel de un vehículo, con sus dos pesadas y un descuento", async ({ page }) => {
  const g = await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Pesado", "Báscula 1", "5200", "Fierro");
  await page.getByRole("button", { name: "Pesar vacío", exact: true }).click();
  await teclear(page, "3400");
  await page.getByRole("button", { name: "Guardar peso vacío" }).click();
  await expect(page.locator(".tot.big")).toHaveText("Se paga$12,240");
  // El descuento todavía no tiene pantalla: se pone por su ruta, como lo hará la pantalla.
  const linea = await conConsola(async (db) => (await db.query("SELECT id, operacion_id FROM operacion_linea")).rows[0] as { id: string; operacion_id: string });
  const puesto = await page.evaluate(async ({ cuenta, renglon, persona }) => {
    const r = await fetch(`/api/cuentas/${cuenta}/descuento`, {
      method: "POST", headers: { "content-type": "application/json", "x-persona": persona }, body: JSON.stringify({ linea: renglon, kg: "20" }),
    });
    return r.status;
  }, { cuenta: linea.operacion_id, renglon: linea.id, persona: String(g.luis.id) });
  expect(puesto).toBe(200);
  await page.reload();
  await expect(page.locator(".tot.big")).toHaveText("Se paga$12,104");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("Descuento: 20.000 kg");
  await expect(page.locator(".ticket")).toContainText("Báscula 1 · 5,200 − 3,400 kg");
  await comparar(page, "vehiculo-con-descuento", await retratar(page));
});

test("el papel de una compra con precio especial: lleva el nombre del cliente y el precio que se aplicó, y nada más", async ({ page }) => {
  const g = await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "100");
  await page.getByRole("button", { name: "Precio especial para Cartón" }).click();
  await page.getByRole("button", { name: "Es un cliente nuevo" }).click();
  await page.getByLabel("Nombre del cliente nuevo").fill("Don Chuy");
  await teclear(page, "0.5");
  await page.getByRole("button", { name: "Autorizar el precio especial", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, g.servando.clave);
  await page.getByRole("button", { name: "Autorizar a nombre de Servando" }).click();
  await expect(page.locator(".tot.big")).toHaveText("Se paga$260");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("Cliente: Don Chuy");
  const retrato = await retratar(page);
  expect(retrato.paginas).toBe(2);
  // Lo que es del negocio no sale: ni que es especial, ni cuánto era la lista.
  expect(retrato.copias.flatMap((c) => c.renglones.map((r) => r.texto)).join(" ")).not.toMatch(/especial|lista|2\.10/i);
  await comparar(page, "compra-con-cliente", retrato);
});

test("el papel de una reimpresión: una sola copia, con su leyenda", async ({ page }) => {
  await listo(page);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Cartón", "Báscula 2", "30");
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await expect(page.locator(".ticket")).toContainText("A PAGAR$63");
  await page.getByRole("button", { name: "Imprimir otra vez" }).click();
  await page.getByRole("button", { name: "No salió el papel" }).click();
  await expect(page.locator(".ticket")).toContainText("REIMPRESIÓN 2 · No salió el papel");
  const retrato = await retratar(page);
  expect(retrato.copias.map((c) => c.clase)).toEqual(["ticket"]);
  expect(retrato.paginas).toBe(1);
  await comparar(page, "reimpresion", retrato);
});
