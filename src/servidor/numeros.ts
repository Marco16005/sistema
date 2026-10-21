// Los pesos y los precios cruzan el servidor como texto decimal, sin pasar por un número de
// JavaScript: así no se redondean por el camino. Aquí solo se mira la forma; si el valor es
// admisible —capacidad, división, existencia— lo decide la base.

/** La petición trae algo que no tiene la forma esperada. */
export class ErrorDeForma extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeForma";
  }
}

// Los mismos topes que pone la base: 999 999 kg por pesada y 99 999.9999 pesos por kilo.
const KILOS = /^\d{1,6}(\.\d{1,3})?$/;
const PRECIO = /^\d{1,5}(\.\d{1,4})?$/;

export function kilos(texto: unknown): string {
  if (typeof texto !== "string" || !KILOS.test(texto)) {
    throw new ErrorDeForma("El peso se escribe en kilos, con punto y hasta tres decimales");
  }
  return texto;
}

/** Lo que pesa vacío un recipiente: como un peso, pero cero vale (es «sin recipiente»). */
export function recipiente(texto: unknown): string {
  if (typeof texto !== "string" || !KILOS.test(texto)) {
    throw new ErrorDeForma("Lo que pesa el recipiente se escribe en kilos, con punto y hasta tres decimales");
  }
  return texto;
}

/** Dinero del cajón: pesos con hasta dos centavos, de cero en adelante. Que sea más que cero lo decide la base. */
const PESOS = /^\d{1,8}(\.\d{1,2})?$/;
export function pesos(texto: unknown, nombre = "La cantidad"): string {
  if (typeof texto !== "string" || !PESOS.test(texto)) {
    throw new ErrorDeForma(`${nombre} se escribe en pesos, con punto y hasta dos centavos`);
  }
  return texto;
}

export function precio(texto: unknown): string {
  if (typeof texto !== "string" || !PRECIO.test(texto)) {
    throw new ErrorDeForma("El precio se escribe en pesos, con punto y hasta cuatro decimales");
  }
  return texto;
}
