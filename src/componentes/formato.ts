// Cómo se escriben en pantalla los números que manda el servidor. Aquí no se calcula nada: los
// importes, las sumas y los totales llegan hechos, como texto decimal, y solo se les da formato.

const es = (n: number, minimo: number, maximo: number): string =>
  n.toLocaleString("es-MX", { minimumFractionDigits: minimo, maximumFractionDigits: maximo });

/** $1,234.50 */
export const pesos = (t: string): string => "$" + es(Number(t), 2, 2);
/** $1,235 — lo que se paga o se cobra, en pesos cerrados. */
export const pesosCerrados = (t: string): string => "$" + es(Number(t), 0, 0);
/** $28.00 o $6.2500 — un precio por kilo, con los decimales que tenga. */
export const precio = (t: string): string => "$" + es(Number(t), 2, 4);
/** 12.350 */
export const kilos = (t: string): string => es(Number(t), 3, 3);
/** 5,200 o 12.35 — sin ceros de sobra, para los pesos de un vehículo y lo disponible. */
export const kilosCortos = (t: string): string => es(Number(t), 0, 3);
/** +12.350 o −19.500: kilos que entran o salen, o una diferencia. */
export function kilosConSigno(t: string): string {
  const n = Number(t);
  return (n > 0 ? "+" : n < 0 ? "−" : "") + es(Math.abs(n), 3, 3);
}
/** +$0.50, −$0.42 o $0.00 */
export function ajuste(t: string): string {
  const n = Number(t);
  return n === 0 ? "$0.00" : (n > 0 ? "+" : "−") + "$" + es(Math.abs(n), 2, 2);
}

export const cuantosMateriales = (n: number): string => (n === 0 ? "Sin materiales" : `${n} ${n === 1 ? "material" : "materiales"}`);

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** 2026-10-01 → 1 de octubre */
export function fechaCorta(aaaammdd: string): string {
  const [, mes, dia] = aaaammdd.split("-");
  return `${Number(dia)} de ${MESES[Number(mes) - 1]}`;
}
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** 2026-10-01 → jueves 1 de octubre */
export function fechaConDia(aaaammdd: string): string {
  const [anio, mes, dia] = aaaammdd.split("-").map(Number);
  return `${DIAS[new Date(Date.UTC(anio!, mes! - 1, dia!)).getUTCDay()]} ${fechaCorta(aaaammdd)}`;
}
/** 2026-10-01 → 1 oct: para el pie de una gráfica, donde no cabe más. */
export function diaCorto(aaaammdd: string): string {
  const [, mes, dia] = aaaammdd.split("-");
  return `${Number(dia)} ${MESES[Number(mes) - 1]!.slice(0, 3)}`;
}
/** 2026-10-01 → 01/10/2026 */
export function fechaDeTicket(aaaammdd: string): string {
  const [anio, mes, dia] = aaaammdd.split("-");
  return `${dia}/${mes}/${anio}`;
}

export const NOMBRE_DE_ROL: Record<string, string> = {
  responsable: "responsable", mostrador: "mostrador", patio: "patio", consulta: "consulta", administracion: "administración",
};
