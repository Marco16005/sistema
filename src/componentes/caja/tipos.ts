// El cajón, tal como llega del servidor (src/servidor/dominio/caja.ts). El dinero viene como texto
// decimal con dos centavos.

export interface MovimientoDeCaja {
  id: string;
  tipo: "sacar" | "meter";
  importe: string;
  motivo: string;
  registro: string;
  autorizo: string;
  hora: string;
}

export interface CorteDeCaja {
  cierre: number;
  esperado: string;
  contado: string;
  /** Lo contado menos lo esperado: negativo es que faltó. */
  diferencia: string;
  seQueda: string;
  retirado: string;
  hizo: string;
  hora: string;
}

export interface Cajon {
  jornada: { id: string; fecha: string; abierta: boolean; cierres: number };
  apertura: { contado: string; anterior: string | null; conto: string; hora: string } | null;
  sugerido: string | null;
  efectivo: { cobrado: string; pagado: string };
  transferencia: { cobrado: string; pagado: string };
  movimientos: MovimientoDeCaja[];
  metido: string;
  sacado: string;
  /** Lo que movieron en el cajón las correcciones liquidadas en efectivo: positivo es que entró. */
  correcciones: string;
  /** Los abonos de lo fiado que entraron en efectivo, y lo que se vendió fiado (que no pasa por el cajón). */
  abonos: string;
  fiado: string;
  retiradoAntes: string;
  /** Lo que debería haber ahora. Nada mientras no se cuente al abrir, o con el día cerrado. */
  esperado: string | null;
  cortes: CorteDeCaja[];
}

export interface Aviso {
  id: string;
  clase: "corte" | "apertura";
  fecha: string;
  diferencia: string;
  conto: string;
  hora: string;
}

/** Lo tecleado, como lo espera el servidor: sin punto colgando. */
export const comoPesos = (tecleado: string): string => tecleado.replace(/\.$/, "") || "0";
/** Que lo tecleado sea una cantidad de dinero: pesos con hasta dos centavos. */
export const pesosListos = (tecleado: string): boolean => /^\d{1,8}(\.\d{1,2})?$/.test(comoPesos(tecleado));
/** En centavos, para comparar y restar sin que el punto flotante se coma uno. */
export const centavos = (t: string): number => Math.round(Number(comoPesos(t)) * 100);
