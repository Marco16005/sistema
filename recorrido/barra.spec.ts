// La entrada y la barra: dar de alta el equipo, tocar el nombre, la clave, y arriba de todo el día,
// quién atiende, el interruptor de contraste y las pantallas a las que se puede ir.
//
// Se usa con guantes y al sol: todo lo que se toca mide 60 px o más y está separado de lo de
// junto; nada se sale de la pantalla de un teléfono; y la barra de las pantallas, que es de vidrio
// y se queda arriba al bajar, es sólida de verdad cuando hace falta leerla.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { aviso, baseNueva, conConsola, darDeAltaEquipo, diaListo, entrar, gente, loQueNoMide, salir, teclear } from "./apoyo.ts";

test.beforeEach(baseNueva);

const pantallas = (page: Page) => page.getByRole("navigation", { name: "Pantallas" });
const ARRIBA = '.barra, nav[aria-label="Pantallas"], .falta-dia';

for (const [ancho, alto] of [[1280, 620], [420, 800], [360, 640]] as const) {
  test(`a ${ancho}×${alto}, en la entrada y en la barra todo lo que se toca mide 60 px o más y está separado, la letra se lee y nada se sale de lado`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const g = await gente();
    const medir = async (donde: string, raices = "body"): Promise<void> => {
      expect(await loQueNoMide(page, raices), donde).toEqual([]);
    };

    // Dar de alta el equipo, y con un código que no vale.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dar de alta este equipo" })).toBeVisible();
    await medir("el alta del equipo");
    await page.getByLabel("Código de alta").fill("AAAAA-AAAAA");
    await page.getByRole("button", { name: "Dar de alta" }).click();
    await expect(aviso(page)).toBeVisible();
    await medir("el alta del equipo, con su aviso");

    // Quién atiende, y su clave; también con la clave mal.
    await darDeAltaEquipo(page);
    await medir("quién atiende");
    await page.getByRole("button", { name: /^Servando/ }).click();
    await expect(page.getByText("Escribe tu clave.")).toBeVisible();
    await medir("la clave");
    await teclear(page, "0000");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(aviso(page)).toBeVisible();
    await medir("la clave, con su aviso");

    // Adentro. El responsable, antes del arranque, es quien más pantallas tiene: seis, con el panel.
    await teclear(page, g.servando.clave);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.locator(".barra")).toContainText("Servando");
    await expect(pantallas(page).getByRole("link")).toHaveCount(6);
    await medir("la barra del responsable, con seis pantallas", ARRIBA);

    // Con el día sin abrir, lo que falta para atender lleva su botón.
    await salir(page);
    await conConsola((db) => db.query("SELECT terminar_arranque('[]'::jsonb, $1)", [g.servando.id]));
    await entrar(page, g.luis);
    await expect(page.getByRole("button", { name: "Abrir la jornada de hoy" })).toBeVisible();
    await medir("la barra de quien atiende, con el día sin abrir", ARRIBA);

    // Y cuando no se puede hablar con el servidor.
    await page.route(/\/api\/sesion$/, (ruta) => ruta.abort());
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();
    await medir("sin conexión");
  });
}

test("en el alta, Enter envía el código; incompleto, el botón está deshabilitado de verdad; y lo que no es enviar no envía", async ({ page }) => {
  const g = await gente();
  await page.goto("/");
  const campo = page.getByLabel("Código de alta");
  const boton = page.getByRole("button", { name: "Dar de alta" });
  await expect(boton).toBeDisabled();
  await campo.fill("ABC");
  await expect(boton).toBeDisabled();
  // Cambiar el contraste a media captura no manda el formulario ni borra lo escrito.
  let enviados = 0;
  await page.route(/\/api\/equipo\/alta$/, (ruta) => { enviados += 1; return ruta.fallback(); });
  await page.getByRole("switch", { name: "Más contraste" }).click();
  await expect(page.getByRole("switch", { name: "Más contraste" })).toHaveAttribute("aria-checked", "true");
  await expect(campo).toHaveValue("ABC");
  expect(enviados).toBe(0);
  // Con un código entero, Enter lo envía.
  await campo.fill("AAAAA-AAAAA");
  await expect(boton).toBeEnabled();
  await campo.press("Enter");
  await expect(aviso(page)).toBeVisible();
  expect(enviados).toBe(1);
  // En la clave, «No soy…» regresa sin intentar entrar.
  await darDeAltaEquipo(page);
  let intentos = 0;
  await page.route(/\/api\/sesion\/entrar$/, (ruta) => { intentos += 1; return ruta.fallback(); });
  await page.getByRole("button", { name: /^Luis/ }).click();
  await teclear(page, g.luis.clave);
  await page.getByRole("button", { name: "No soy Luis" }).click();
  await expect(page.getByRole("heading", { name: "¿Quién atiende?" })).toBeVisible();
  expect(intentos).toBe(0);
});

/** Cómo está pintada la barra de las pantallas: si desenfoca lo de atrás, y qué tan sólido es su fondo. */
const vidrio = (page: Page) =>
  pantallas(page).evaluate((n) => {
    const s = getComputedStyle(n) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
    const filtro = [s.backdropFilter, s.webkitBackdropFilter].find((f) => f && f !== "none") ?? "none";
    const partes = /rgba?\(([^)]+)\)/.exec(s.backgroundColor)?.[1]?.split(/[,\s/]+/).filter(Boolean).map(Number) ?? [];
    return { desenfoca: filtro !== "none", solidez: partes.length === 4 ? partes[3]! : partes.length === 3 ? 1 : 0, posicion: s.position };
  });

/** Una página larga, con las cuentas a un lado: para ver qué se queda arriba al bajar. */
async function enElMostradorYLargo(page: Page): Promise<void> {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await expect(page.locator(".grid")).toBeVisible();
  await page.addStyleTag({ content: ".app{min-height:2400px}" });
}

test("en pantalla ancha la barra de las pantallas se queda arriba al bajar, es de vidrio, y las cuentas quedan debajo de ella, no tapadas", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await enElMostradorYLargo(page);
  await page.evaluate(() => window.scrollTo(0, 700));
  expect(await page.evaluate(() => window.scrollY)).toBe(700);
  const barra = (await pantallas(page).boundingBox())!;
  expect(barra.y).toBeGreaterThanOrEqual(0);
  expect(barra.y).toBeLessThan(16);
  expect(await vidrio(page)).toEqual({ desenfoca: true, solidez: expect.any(Number), posicion: "sticky" });
  expect((await vidrio(page)).solidez).toBeLessThan(1);
  // Las cuentas abiertas siguen a la vista, y empiezan donde la barra termina.
  const cuentas = (await page.getByRole("complementary", { name: "Cuentas abiertas" }).boundingBox())!;
  expect(cuentas.y).toBeGreaterThanOrEqual(barra.y + barra.height);
  expect(cuentas.y).toBeLessThan(barra.y + barra.height + 24);
  // Y lo que queda debajo de la barra no se puede tocar a través de ella: un toque en la barra es de la barra.
  await pantallas(page).getByRole("link", { name: "Cierre" }).click();
  await expect(page).toHaveURL(/\/cierre$/);
});

test("con más contraste la barra de las pantallas es sólida de verdad: sin desenfoque y con fondo opaco, y la pantalla en que se está se distingue", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await enElMostradorYLargo(page);
  expect((await vidrio(page)).desenfoca).toBe(true);
  await page.getByRole("switch", { name: "Más contraste" }).click();
  await expect(page.getByRole("switch", { name: "Más contraste" })).toHaveAttribute("aria-checked", "true");
  expect(await vidrio(page)).toEqual({ desenfoca: false, solidez: 1, posicion: "sticky" });
  // La pantalla en que se está: fondo distinto del de las demás, las dos opacas.
  const fondos = await pantallas(page).getByRole("link").evaluateAll((enlaces) =>
    enlaces.map((a) => ({ aqui: a.getAttribute("aria-current") === "true", fondo: getComputedStyle(a).backgroundColor })));
  const aqui = fondos.filter((f) => f.aqui);
  expect(aqui).toHaveLength(1);
  expect(fondos.filter((f) => !f.aqui).every((f) => f.fondo !== aqui[0]!.fondo)).toBe(true);
});

test("si el equipo pide menos transparencia, la barra de las pantallas es sólida sin que nadie toque nada", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "solo Chromium deja simular que el equipo pide menos transparencia");
  await page.setViewportSize({ width: 1280, height: 620 });
  await enElMostradorYLargo(page);
  expect((await vidrio(page)).desenfoca).toBe(true);
  const consola = await page.context().newCDPSession(page);
  await consola.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches)).toBe(true);
  expect(await vidrio(page)).toEqual({ desenfoca: false, solidez: 1, posicion: "sticky" });
});

test("en pantalla angosta la barra de las pantallas no se queda fija: al bajar, arriba quedan las cuentas", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await enElMostradorYLargo(page);
  // Sin nada detrás que pase, no hace falta vidrio: no se desenfoca.
  expect(await vidrio(page)).toEqual({ desenfoca: false, solidez: 1, posicion: "static" });
  await page.evaluate(() => window.scrollTo(0, 700));
  const barra = (await pantallas(page).boundingBox())!;
  expect(barra.y + barra.height).toBeLessThan(0);
  const cuentas = (await page.getByRole("complementary", { name: "Cuentas abiertas" }).boundingBox())!;
  expect(Math.abs(cuentas.y)).toBeLessThan(1);
});

/** Camina con Tab —o hacia atrás— hasta que el foco está en ese control. */
async function caminarHasta(page: Page, control: Locator, tecla: "Tab" | "Shift+Tab" = "Tab"): Promise<void> {
  for (let k = 0; k < 150 && !(await control.evaluate((e) => e === document.activeElement)); k++) await page.keyboard.press(tecla);
  await expect(control).toBeFocused();
}

// Lo encontró Codex en su décima revisión: el teclado en pantalla escucha Enter desde la ventana, y lo tomaba por
// «terminar» aunque el foco estuviera en otro control. Enter sobre «Más contraste» enviaba la clave.
test("en la clave, Enter sobre un control al que se llegó con Tab es de ese control y no envía la clave; con el foco donde lo dejó un toque, Enter sigue siendo «entrar»", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  const interruptor = page.getByRole("switch", { name: "Más contraste" });
  const escribirLaClave = async (): Promise<void> => {
    await page.getByRole("button", { name: /^Luis/ }).click();
    for (const digito of g.luis.clave) await page.keyboard.press(digito);
    await expect(page.locator(".puntos")).toHaveAttribute("aria-label", `${g.luis.clave.length} dígitos escritos`);
  };
  await escribirLaClave();
  await caminarHasta(page, interruptor);
  await page.keyboard.press("Enter");
  await expect(interruptor).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Escribe tu clave.")).toBeVisible();
  await expect(page.locator(".barra")).toHaveCount(0);
  await expect(interruptor).toBeEnabled();
  // «No soy Luis», igual: regresa a la lista, y nadie entró.
  await caminarHasta(page, page.getByRole("button", { name: "No soy Luis" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "¿Quién atiende?" })).toBeVisible();
  // Con el foco donde lo dejó un toque —se tocó el interruptor, y ahí se quedó—, Enter es «entrar».
  await escribirLaClave();
  await interruptor.click();
  await expect(interruptor).toHaveAttribute("aria-checked", "false");
  await expect(interruptor).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(page.locator(".barra")).toContainText("Luis");
});

test("en el mostrador, con un peso a medio teclear: tocando y tecleando en el teclado del equipo, Enter lo agrega; sobre un control de la barra al que se llegó con Tab, Enter es de ese control y el peso sigue ahí", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  const elegir = async (): Promise<void> => {
    await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
    await page.getByRole("button", { name: /^Báscula 2/ }).click();
  };
  // Como en un mostrador con teclado: se toca el material y la báscula —el foco se queda en ese botón—, se teclea, Enter.
  await elegir();
  for (const tecla of "30") await page.keyboard.press(tecla);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^En esta cuenta/)).toBeVisible();
  // Otro peso, a medio teclear; y ahora se camina con Tab, hacia atrás, hasta el interruptor de la barra.
  await page.getByRole("button", { name: "＋ Agregar otro material" }).click();
  await elegir();
  for (const tecla of "12") await page.keyboard.press(tecla);
  const tecleado = page.locator(".visor .digits");
  await expect(tecleado).toHaveAttribute("aria-label", "Peso tecleado: 12 kilos");
  const interruptor = page.getByRole("switch", { name: "Más contraste" });
  await caminarHasta(page, interruptor, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(interruptor).toHaveAttribute("aria-checked", "true");
  await expect(tecleado).toHaveAttribute("aria-label", "Peso tecleado: 12 kilos");
  await expect(page.getByRole("button", { name: /^(Agregar a la cuenta|Guardar peso)/ })).toBeVisible();
});

test("el medidor de patio nota lo que tiene que notar: dos controles a menos de 8 px en diagonal, o que se tocan por una esquina; y una letra de menos de 17 px que no es un rótulo", async ({ page }) => {
  // Lo encontró Codex en su décima revisión: el medidor solo comparaba de lado y de arriba abajo, y dejaba pasar 15 px en cualquier texto.
  const con = async (cuerpo: string): Promise<string[]> => {
    await page.setContent(`<!doctype html><style>*{margin:0;box-sizing:border-box}body{position:relative;font:17px sans-serif}button{position:absolute;width:60px;height:60px;border:0;font:inherit}</style>${cuerpo}`);
    return loQueNoMide(page);
  };
  const dos = (izquierda: number, arriba: number): string => `<button style="left:0;top:0">a</button><button style="left:${izquierda}px;top:${arriba}px">b</button>`;
  // Separados 1 px de lado y 1 px de arriba abajo: de esquina a esquina, 1.4 px. Y tocándose por una esquina.
  expect(await con(dos(61, 61))).toEqual(["«a» y «b» están a 1 px, en diagonal"]);
  expect(await con(dos(60, 60))).toEqual(["«a» y «b» están a 0 px, en diagonal"]);
  // A 6 y 6 —8.5 px de esquina a esquina— ya están separados. De lado y uno sobre otro, como siempre.
  expect(await con(dos(66, 66))).toEqual([]);
  expect(await con(dos(64, 0))).toEqual(["«a» y «b» están a 4 px"]);
  expect(await con(dos(0, 64))).toEqual(["«a» y «b» están a 4 px, uno sobre otro"]);
  expect(await con(dos(68, 0))).toEqual([]);
  // La letra: de 17 para arriba; de 15, solo un rótulo; de menos, nada.
  expect(await con('<p style="font-size:15px">Se lee</p>')).toEqual(["«Se lee» va en letra de 15px, y no es un rótulo"]);
  expect(await con('<p><small style="font-size:15px">Mostrador</small></p><p class="lbl" style="font-size:15px">Peso</p>')).toEqual([]);
  expect(await con('<p><small style="font-size:14px">Mostrador</small></p>')).toEqual(["«Mostrador» va en letra de 14px"]);
  expect(await con('<p style="font-size:17px">Se lee</p>')).toEqual([]);
});

test("la barra se recorre con el teclado en su orden, y marca la pantalla en que se está", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await expect(page.getByRole("button", { name: "+ Compra" })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const orden: string[] = [];
  for (let k = 0; k < 6; k++) {
    await page.keyboard.press("Tab");
    orden.push(await page.evaluate(() => (document.activeElement?.textContent ?? "").trim()));
  }
  expect(orden).toEqual(["Más contraste", "Salir", "Mostrador", "Inventario", "Precios", "Cierre"]);
  const aqui = () => pantallas(page).locator('[aria-current="true"]');
  await expect(aqui()).toHaveText(["Mostrador"]);
  // Con el foco en «Cierre», Enter lleva ahí.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cierre$/);
  await expect(aqui()).toHaveText(["Cierre"]);
  // Siguen siendo enlaces, uno por pantalla; el día y quién atiende van arriba.
  await expect(pantallas(page).getByRole("link")).toHaveText(["Mostrador", "Inventario", "Precios", "Cierre"]);
  await expect(page.locator(".barra")).toContainText("Luis");
  await expect(page.locator(".barra .dia")).toHaveText(/^\d{1,2} de [a-z]+$/);
});

/** Qué tanto se encoge algo en este momento: 1 si nada. */
const escala = (page: Page, nombre: string, papel: "link" | "button") =>
  page.getByRole(papel, { name: nombre, exact: true }).evaluate((e) => {
    const m = getComputedStyle(e).transform;
    return m === "none" ? 1 : Number(/matrix\(([^,]+)/.exec(m)?.[1] ?? "1");
  });

test("lo que se toca cede al apoyar el dedo y lo que hace ocurre al soltar: apoyar y arrastrar fuera no lleva a ningún lado; con menos movimiento, no se encoge", async ({ page }) => {
  const g = await gente();
  await diaListo(g);
  await darDeAltaEquipo(page);
  await entrar(page, g.luis);
  await expect(page.getByRole("button", { name: "+ Compra" })).toBeVisible();

  const apoyar = async (nombre: string, papel: "link" | "button"): Promise<void> => {
    const caja = (await page.getByRole(papel, { name: nombre, exact: true }).boundingBox())!;
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await page.mouse.down();
  };
  const arrastrarFueraYSoltar = async (): Promise<void> => {
    await page.mouse.move(640, 500, { steps: 4 });
    await page.mouse.up();
  };

  for (const [nombre, papel] of [["Cierre", "link"], ["Salir", "button"]] as const) {
    await apoyar(nombre, papel);
    await expect.poll(() => escala(page, nombre, papel), `«${nombre}» cede al apoyar`).toBeLessThan(0.985);
    await arrastrarFueraYSoltar();
    await expect.poll(() => escala(page, nombre, papel)).toBe(1);
  }
  // Nada de eso hizo nada: sigue en el mostrador, y sigue adentro.
  await expect(page).toHaveURL(/\/mostrador$/);
  await expect(page.locator(".barra")).toContainText("Luis");

  // Con menos movimiento, nada cambia de tamaño al apoyar.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [nombre, papel] of [["Cierre", "link"], ["Salir", "button"]] as const) {
    await apoyar(nombre, papel);
    await page.waitForTimeout(250);                    // lo que dura, de sobra, la respuesta al toque
    expect(await escala(page, nombre, papel), `«${nombre}» se encoge aunque se pidió menos movimiento`).toBe(1);
    await arrastrarFueraYSoltar();
  }
  await expect(page).toHaveURL(/\/mostrador$/);
});
