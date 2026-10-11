// Capturas de las pantallas, para verlas sin levantar nada. No es una prueba: corre solo si se pide.
//   docker compose --profile recorrido run --rm -e CAPTURAS=1 recorrido npx playwright test capturas
import { test } from "@playwright/test";
import { aviso, baseNueva, conConsola, contarImpresiones, darDeAltaEquipo, diaListo, entrar, gente, pesar, salir, teclear } from "./apoyo.ts";

test.skip(!process.env.CAPTURAS, "solo cuando se piden capturas");
test.use({ viewport: { width: 1180, height: 820 } });

test("capturas de las pantallas", async ({ page }) => {
  const foto = (nombre: string) => page.screenshot({ path: `recorrido/capturas/${nombre}.png`, fullPage: true });
  await baseNueva();
  const g = await gente();
  await contarImpresiones(page);

  await page.goto("/");
  await foto("01-alta-de-equipo");
  await darDeAltaEquipo(page);
  await foto("02-quien-atiende");
  await page.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, "4815");
  await foto("03-clave");
  await teclear(page, "16");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Kilos de Cartón").fill("10000");
  await page.getByLabel("Kilos de Aluminio bote").fill("212.75");
  await page.getByRole("group", { name: "Origen del saldo de Aluminio bote" }).getByRole("button", { name: "contado" }).click();
  await foto("04-arranque");

  await baseNueva();
  const h = await gente();
  await diaListo(h, [["Cartón", "1870"], ["Aluminio bote", "212.75"]]);
  await darDeAltaEquipo(page);
  await entrar(page, h.servando);
  await page.getByRole("link", { name: "Precios" }).click();
  await foto("05-precios-publicados");
  await salir(page);

  await entrar(page, h.luis);
  await page.getByRole("button", { name: "+ Compra" }).click();
  await foto("06-paso-1-material");
  await page.getByRole("button", { name: "Aluminio", exact: true }).click();
  await foto("07-paso-1-familia");
  await page.getByRole("button", { name: "Frecuentes", exact: true }).click();
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await foto("08-paso-2-bascula");
  await page.getByRole("button", { name: /^Báscula 2/ }).click();
  await teclear(page, "30.2");
  await foto("09-paso-2-peso");
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  await page.getByRole("button", { name: /Agregar otro material/ }).click();
  await pesar(page, "Aluminio bote", "Báscula 3", "4.11");
  await foto("10-paso-3-cuenta");

  await page.getByRole("button", { name: "+ Compra" }).click();
  await pesar(page, "Pesado", "Báscula 1", "5200", "Fierro");
  await page.getByRole("button", { name: "+ Venta" }).click();
  await foto("11-venta-con-disponible");
  await page.getByRole("complementary", { name: "Cuentas abiertas" }).locator(".cta", { hasText: "Compra 2" }).click();
  await foto("12-vehiculo-pendiente");
  await page.getByRole("complementary", { name: "Cuentas abiertas" }).locator(".cta", { hasText: "Compra 1" }).click();
  await page.getByRole("button", { name: "Pagar e imprimir ticket" }).click();
  await page.locator(".ticket").waitFor();
  await foto("13-comprobante");
  await page.getByRole("button", { name: "Listo" }).click();
  await page.getByRole("link", { name: "Cierre" }).click();
  await page.getByText("Kilos del día").waitFor();
  await foto("14-cierre");

  // ── inventario ──
  await page.getByRole("link", { name: "Inventario" }).click();
  await page.getByRole("heading", { name: "Lo que hay en el patio" }).waitFor();
  await foto("16-inventario-existencias");
  await page.getByRole("button", { name: "Contar", exact: true }).click();
  await page.getByRole("button", { name: "Papel", exact: true }).click();
  await foto("17-contar-material");
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await teclear(page, "1850");
  await foto("18-contar-kilos");
  await page.getByRole("button", { name: "Ver la diferencia" }).click();
  await page.locator(".tot.big").waitFor();
  await foto("19-contar-diferencia");
  await page.getByRole("button", { name: "Autorizar el conteo" }).click();
  await page.getByRole("button", { name: /^Servando/ }).click();
  await teclear(page, "481");
  await foto("20-autorizar");
  await teclear(page, "516");
  await page.getByRole("button", { name: "Autorizar a nombre de Servando" }).click();
  await page.locator(".okmsg").waitFor();
  await foto("21-conteo-hecho");
  await page.getByRole("button", { name: "Separar", exact: true }).click();
  await page.getByRole("button", { name: "Papel", exact: true }).click();
  await page.locator(".grid").getByRole("button", { name: /^Cartón/ }).click();
  await teclear(page, "100");
  await page.getByRole("button", { name: "Seguir" }).click();
  await page.getByRole("button", { name: /Agregar lo que salió/ }).click();
  await page.getByRole("button", { name: "Plástico", exact: true }).click();
  await page.locator(".grid").getByRole("button", { name: /^PET/ }).click();
  await teclear(page, "88.5");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByRole("button", { name: "Ver lo que se pierde" }).click();
  await page.locator(".tot.big").waitFor();
  await foto("22-separar");
  await page.getByRole("button", { name: "Registrar la separación" }).click();
  await page.locator(".okmsg").waitFor();
  await page.locator(".exrow", { hasText: "Aluminio bote" }).click();
  await page.getByRole("heading", { name: "Aluminio bote" }).waitFor();
  await foto("23-movimientos");
  await page.getByRole("button", { name: /^Corregir compra/ }).click();
  await page.getByRole("button", { name: "Cambiar kilos" }).click();
  await teclear(page, "4.5");
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await page.getByRole("button", { name: "Se tecleó mal el peso" }).click();
  await foto("24-corregir");
  await page.getByRole("button", { name: "No corregir" }).click();
  await page.getByRole("button", { name: "Regresar a existencias" }).click();

  await page.setViewportSize({ width: 420, height: 860 });
  await page.getByRole("link", { name: "Mostrador" }).click();
  await page.getByRole("heading", { name: /Compra|Venta/ }).first().waitFor();
  await foto("15-angosto-mostrador");
});

// ── el rediseño, tarea por tarea: cada pantalla en sus tres modos (claro, oscuro y más contraste),
//    ancha y angosta, con sus estados de aviso. Quedan en recorrido/capturas/rediseno/. ──
const MODOS = [
  ["claro", { colorScheme: "light", contrast: "no-preference" }],
  ["oscuro", { colorScheme: "dark", contrast: "no-preference" }],
  ["contraste", { colorScheme: "light", contrast: "more" }],
] as const;
const TAMANOS = [["ancha", 1280, 620], ["angosta", 420, 800]] as const;

for (const [modo, medios] of MODOS) {
  for (const [tamano, ancho, alto] of TAMANOS) {
    test(`rediseño, tarea 2: la entrada y la barra, en ${modo} y ${tamano}`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await page.emulateMedia(medios);
      const foto = (nombre: string) => page.screenshot({ path: `recorrido/capturas/rediseno/2-${nombre}-${modo}-${tamano}.png`, fullPage: true });
      await baseNueva();
      const g = await gente();

      await page.goto("/");
      await page.getByRole("heading", { name: "Dar de alta este equipo" }).waitFor();
      await foto("1-alta");
      await page.getByLabel("Código de alta").fill("AAAAA-AAAAA");
      await page.getByRole("button", { name: "Dar de alta" }).click();
      await aviso(page).waitFor();
      await foto("2-alta-con-aviso");
      await darDeAltaEquipo(page);
      await foto("3-quien-atiende");
      await page.getByRole("button", { name: /^Servando/ }).click();
      await teclear(page, "0000");
      await foto("4-clave");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await aviso(page).waitFor();
      await foto("5-clave-con-aviso");
      await teclear(page, g.servando.clave);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await page.locator(".barra").waitFor();
      await page.getByRole("heading").first().waitFor();
      await foto("6-barra-del-responsable");
      await salir(page);
      await conConsola((db) => db.query("SELECT terminar_arranque('[]'::jsonb, $1)", [g.servando.id]));
      await entrar(page, g.luis);
      await page.getByRole("button", { name: "Abrir la jornada de hoy" }).waitFor();
      await foto("7-dia-sin-abrir");
      await page.route(/\/api\/sesion$/, (ruta) => ruta.abort());
      await page.reload();
      await page.getByRole("heading", { name: "Sin conexión" }).waitFor();
      await foto("8-sin-conexion");
    });
  }
}
