// Lo que el servidor manda sobre el inventario, tal como llega a la pantalla.

export interface MaterialEnExistencia {
  id: number;
  nombre: string;
  nombreCorto: string;
  kg: string;
  apartado: string;
  disponible: string;
  ultimoConteo: { fecha: string; hora: string; diferencia: string } | null;
}

export interface Familia {
  id: number;
  nombre: string;
  materiales: MaterialEnExistencia[];
}

export interface Movimiento {
  id: string;
  tipo: "apertura" | "compra" | "venta" | "merma" | "ajuste" | "transformacion";
  kg: string;
  fecha: string;
  hora: string;
  quien: string;
  autorizo: string | null;
  motivo: string | null;
  folio: string | null;
  original: { id: string; tipo: string; material: { id: number; nombre: string }; folio: string | null } | null;
  correcciones: number;
  quedo: Array<{ material: string; kg: string }> | null;
  yaContado: boolean;
  corregible: boolean;
}

export interface PreviaDeConteo {
  contado: string;
  contadoEn: string;
  hora: string;
  registrado: string;
  diferencia: string;
}

export interface Elegido {
  id: number;
  nombre: string;
}

const NOMBRES: Record<string, string> = {
  apertura: "Saldo inicial", compra: "Compra", venta: "Venta", merma: "Merma", transformacion: "Separación",
};
/** Cómo se llama un movimiento en pantalla. Un ajuste es una corrección si viene de otro movimiento; si no, salió de un conteo. */
export const nombreDeMovimiento = (m: { tipo: string; original?: unknown }): string =>
  m.tipo === "ajuste" ? (m.original ? "Corrección" : "Conteo") : (NOMBRES[m.tipo] ?? m.tipo);

/** Lo tecleado, como lo espera el servidor: sin punto colgando. */
export const comoTexto = (tecleado: string): string => tecleado.replace(/\.$/, "");
const KILOS = /^\d{1,6}(\.\d{1,3})?$/;
/** Kilos que tienen que ser más de cero. */
export const kilosListos = (tecleado: string): boolean => KILOS.test(comoTexto(tecleado)) && Number(tecleado) > 0;
/** Kilos que pueden ser cero: lo contado, o el objetivo de una corrección. */
export const kilosOCero = (tecleado: string): boolean => KILOS.test(comoTexto(tecleado));
