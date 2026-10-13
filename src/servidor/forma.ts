// La forma de lo que llega en una petición. Aquí no hay reglas del negocio: solo se comprueba que
// cada dato sea del tipo que dice ser, para no mandarle a la base algo que no entiende.
import { ErrorDeForma } from "./numeros.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUMERO_DE_FILA = /^[1-9][0-9]{0,17}$/;

// El carácter nulo y los demás de control no son texto que alguien teclee, y la base no los admite.
const DE_CONTROL = /[\u0000-\u001f\u007f]/;

/** Un texto, de cero a `maximo` caracteres, sin caracteres de control. */
export function texto(valor: unknown, nombre: string, maximo: number): string {
  if (typeof valor !== "string" || valor.length > maximo || DE_CONTROL.test(valor)) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return valor;
}

/** Un texto que puede no venir. */
export function textoOpcional(valor: unknown, nombre: string, maximo: number): string | null {
  return valor === undefined || valor === null ? null : texto(valor, nombre, maximo);
}

/** El identificador que la pantalla genera para una cuenta, un material o una pesada. */
export function uuid(valor: unknown, nombre: string): string {
  if (typeof valor !== "string" || !UUID.test(valor)) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return valor;
}

/** El identificador de una persona o un folio: un número grande, que viaja como texto para no perder dígitos. */
export function fila(valor: unknown, nombre: string): string {
  const comoTexto = typeof valor === "number" && Number.isSafeInteger(valor) ? String(valor) : valor;
  // Hasta 18 dígitos cabe siempre en la columna; más, ya no.
  if (typeof comoTexto !== "string" || !NUMERO_DE_FILA.test(comoTexto)) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return comoTexto;
}

/** Un número entero entre 1 y `maximo`, llegue como número o como texto. */
function enteroHasta(valor: unknown, nombre: string, maximo: number): number {
  const n = typeof valor === "string" && /^[1-9][0-9]{0,9}$/.test(valor) ? Number(valor) : valor;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > maximo) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return n;
}

// Los topes son los de la columna: un número con buena forma pero que no cabe se rechaza aquí,
// con su mensaje, en vez de reventar en la base.
/** El identificador de un material. */
export const material = (valor: unknown): number => enteroHasta(valor, "el material", 2_147_483_647);
/** El identificador de una báscula. */
export const bascula = (valor: unknown): number => enteroHasta(valor, "la báscula", 32_767);

/** Un día del calendario, AAAA-MM-DD, que exista. */
export function dia(valor: unknown, nombre: string): string {
  const fecha = typeof valor === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(valor) && !valor.startsWith("0000") ? new Date(`${valor}T00:00:00Z`) : null;
  if (fecha === null || !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
    throw new ErrorDeForma(`Falta ${nombre} o no es un día que exista, escrito AAAA-MM-DD`);
  }
  return valor as string;
}

export function unoDe<T extends string>(valor: unknown, nombre: string, opciones: readonly T[]): T {
  if (typeof valor !== "string" || !(opciones as readonly string[]).includes(valor)) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return valor as T;
}

/** Una lista, de cero a `maximo` elementos. */
export function lista(valor: unknown, nombre: string, maximo: number): unknown[] {
  if (!Array.isArray(valor) || valor.length > maximo) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return valor;
}

export function objeto(valor: unknown, nombre: string): Record<string, unknown> {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return valor as Record<string, unknown>;
}

/** Un entero de cero en adelante, como la revisión de una cuenta. */
export function entero(valor: unknown, nombre: string): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0 || valor > 2_147_483_647) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return valor;
}

/** Una hora del día, HH:MM. */
export function hora(valor: unknown, nombre: string): string {
  if (typeof valor !== "string" || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(valor)) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return valor;
}

/** Un momento exacto, tal como lo escribe la base: es el que la vista previa devolvió. */
export function momento(valor: unknown, nombre: string): string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/.test(valor)) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return valor;
}

/** Kilos que el servidor mandó y la pantalla devuelve tal cual: lo que el libro decía. Puede llevar signo. */
export function kilosVistos(valor: unknown, nombre: string): string {
  if (typeof valor !== "string" || !/^-?\d{1,12}(\.\d{1,3})?$/.test(valor)) {
    throw new ErrorDeForma(`Falta ${nombre} o no tiene la forma esperada`);
  }
  return valor;
}

/** Un texto que tiene que decir algo. */
export function textoConAlgo(valor: unknown, nombre: string, maximo: number): string {
  const t = texto(valor, nombre, maximo);
  if (t.trim() === "") throw new ErrorDeForma(`Falta ${nombre}`);
  return t;
}
