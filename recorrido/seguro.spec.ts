// Antes que nada: el navegador de los recorridos trata a la aplicación como la tratará el de verdad.
// Los candados entre pestañas —lo que impide que una copia se quede con una captura a medias— solo
// existen en un origen seguro. Si aquí faltaran, los recorridos de pestañas probarían otro camino
// (el de los avisos, que no garantiza nada) creyendo probar este.
import { expect, test } from "@playwright/test";

test("el origen es seguro, hay candados entre pestañas y hay diálogo nativo", async ({ page }) => {
  await page.goto("/");
  const hay = await page.evaluate(() => ({
    seguro: window.isSecureContext,
    candados: typeof navigator.locks?.request === "function",
    avisos: typeof BroadcastChannel === "function",
    dialogo: typeof HTMLDialogElement === "function" && typeof HTMLDialogElement.prototype.showModal === "function",
    identificadores: typeof crypto.randomUUID === "function",
  }));
  expect(hay).toEqual({ seguro: true, candados: true, avisos: true, dialogo: true, identificadores: true });
});
