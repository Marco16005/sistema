// Lo que el servidor manda al panel (src/servidor/dominio/panel.ts). Los números llegan hechos,
// como texto decimal: la pantalla les da formato y los dibuja, no los suma.

export type Periodo = 7 | 30 | 91;

export interface Totales {
  cuentas: number;
  compras: number;
  ventas: number;
  /** En pesos cerrados: lo que suman los comprobantes. */
  pagado: string;
  cobrado: string;
  /** Lo cobrado menos lo pagado. No es la ganancia. */
  diferencia: string;
  kgComprado: string;
  kgVendido: string;
}

export interface Tramo extends Totales {
  desde: string;
  hasta: string;
}

export interface Panel {
  desde: string;
  hasta: string;
  dias: Periodo;
  totales: Totales;
  antes: Totales;
  /** En por ciento, respecto del periodo anterior; nada si antes no hubo. */
  cambio: { cuentas: string | null; pagado: string | null; cobrado: string | null };
  paso: "dia" | "semana";
  serie: Tramo[];
  materiales: Array<{ nombre: string; kgComprado: string; importeComprado: string; kgVendido: string; importeVendido: string }>;
  personas: Array<{ nombre: string; cuentas: number }>;
  horas: Array<{ hora: number; cuentas: number }>;
  inventario: {
    listaDel: string | null;
    valor: string;
    sinPrecio: number;
    materiales: Array<{ nombre: string; kg: string; precio: string | null; valor: string | null }>;
  };
  control: {
    mermas: number;
    mermaKg: string;
    ajustes: number;
    ajusteEntroKg: string;
    ajusteSalioKg: string;
    preciosEspeciales: number;
    diferenciaEnCompras: string;
    diferenciaEnVentas: string;
    reaperturas: number;
  };
}
