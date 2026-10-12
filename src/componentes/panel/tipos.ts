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

// ── la historia de precios (src/servidor/dominio/historia-de-precios.ts) ──

export type PeriodoDePrecios = 30 | 91 | 365;

export interface ParDePrecios {
  compra: string;
  venta: string;
}

/** Un día en que el precio de un material quedó distinto del que traía; sin precios, ese día dejó de tenerlo. */
export interface CambioDePrecio {
  fecha: string;
  compra: string | null;
  venta: string | null;
}

export interface HistoriaDeMaterial {
  id: number;
  nombre: string;
  familia: string;
  /** Lo que valía al empezar el periodo; nada si entonces no tenía precio. */
  alEmpezar: ParDePrecios | null;
  /** Lo que vale en la última lista publicada; nada si hoy no tiene precio. */
  ahora: ParDePrecios | null;
  cambios: CambioDePrecio[];
  /** Contra qué se compara: lo que valía al empezar o, si no tenía, el primer precio que tuvo en el periodo. */
  base: ParDePrecios | null;
  /** De la base a lo de ahora, en por ciento; nada si falta alguno de los dos. */
  variacion: { compra: string | null; venta: string | null };
  /** Cuántas veces cambió después de su base. */
  veces: number;
}

export interface HistoriaDePrecios {
  desde: string;
  hasta: string;
  dias: PeriodoDePrecios;
  /** Cuántas listas se publicaron en el periodo. */
  listas: number;
  materiales: HistoriaDeMaterial[];
}

// ── los clientes (src/servidor/dominio/clientes.ts) ──

export interface ClienteDelPanel {
  id: string;
  nombre: string;
  activo: boolean;
  /** Cuentas cobradas a su nombre: las que llevaron precio especial. */
  cuentas: number;
  compras: number;
  ventas: number;
  pagado: string;
  cobrado: string;
  kgComprado: string;
  kgVendido: string;
  /** Lo que sus precios especiales movieron respecto de la lista. En compras, positivo es que se le pagó de más; en ventas, que se le cobró de más. */
  diferenciaEnCompras: string;
  diferenciaEnVentas: string;
  ultimaVez: string | null;
}

export interface TotalesDeClientes {
  clientes: number;
  activos: number;
  cuentas: number;
  diferenciaEnCompras: string;
  diferenciaEnVentas: string;
}

export interface FichaDeCliente {
  cliente: ClienteDelPanel;
  materiales: Array<{ nombre: string; kgComprado: string; importeComprado: string; kgVendido: string; importeVendido: string }>;
  precios: Array<{
    fecha: string;
    folio: string;
    tipo: "compra" | "venta";
    material: string;
    kg: string;
    precioLista: string;
    precio: string;
    diferencia: string;
    autorizo: string;
  }>;
  cuentas: Array<{ id: string; folio: string; fecha: string; tipo: "compra" | "venta"; total: string; materiales: number; atendio: string }>;
}
