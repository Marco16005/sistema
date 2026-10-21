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
  /** Cuántos días tiene el periodo. */
  dias: number;
  totales: Totales;
  antes: Totales;
  /** En por ciento, respecto del periodo anterior; nada si antes no hubo. */
  cambio: { cuentas: string | null; pagado: string | null; cobrado: string | null };
  /** Lo que promedia una cuenta de compra y una de venta, en pesos y en kilos; nada donde no hubo. */
  promedio: { pagado: string | null; kgComprado: string | null; cobrado: string | null; kgVendido: string | null };
  paso: "dia" | "semana" | "cuatro-semanas";
  serie: Tramo[];
  materiales: Array<{ nombre: string; kgComprado: string; importeComprado: string; kgVendido: string; importeVendido: string }>;
  personas: PersonaDelPanel[];
  horas: Array<{ hora: number; cuentas: number }>;
  /** Cada día de la semana que cae en el periodo (1 es lunes): cuántos hay, sus cuentas y las que tocan por día. */
  semana: Array<{ dia: number; dias: number; cuentas: number; porDia: string }>;
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
    /** Renglones con kilos que se pesaron y no se pagaron o no se cobraron. */
    descuentos: number;
    descuentoEnComprasKg: string;
    descuentoEnVentasKg: string;
    descontados: Array<{ nombre: string; kg: string }>;
    /** Renglones de la báscula chica en que se descontó el recipiente, y cuántos kilos pesaban. */
    recipientes: number;
    recipienteEnComprasKg: string;
    recipienteEnVentasKg: string;
  };
}

/** Lo que hizo una persona en el periodo: lo que cobró y lo que conviene vigilar. */
export interface PersonaDelPanel {
  nombre: string;
  cuentas: number;
  compras: number;
  ventas: number;
  pagado: string;
  cobrado: string;
  kg: string;
  descuentoKg: string;
  recipienteKg: string;
  descartadas: number;
  correcciones: number;
  reimpresiones: number;
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

// ── los materiales (src/servidor/dominio/materiales-del-panel.ts) ──

export type PeriodoDeMaterial = 30 | 91;

export interface MaterialDelPatio {
  id: number;
  nombre: string;
  familia: string;
  activo: boolean;
  kg: string;
  /** De compra, en la última lista publicada; nada si esa lista no lo trae. */
  precio: string | null;
  valor: string | null;
  /** El último día en que se vendió o se separó; nada si nunca ha salido. */
  ultimaSalida: string | null;
  diasSinSalir: number | null;
  /** Lo que salió en las últimas cuatro semanas. */
  kgSalio: string;
  /** Para cuántos días alcanza lo que hay, a ese ritmo; nada si no hay o si no salió nada. 3650 quiere decir «diez años o más». */
  alcanzaPara: number | null;
}

export interface Patio {
  hoy: string;
  listaDel: string | null;
  valor: string;
  /** Los materiales con existencia que llevan esos días o más sin salir, o que nunca han salido. */
  seQuedan: { dias: number; materiales: number; valor: string };
  materiales: MaterialDelPatio[];
}

export interface TramoDeMaterial {
  desde: string;
  hasta: string;
  kgComprado: string;
  importeComprado: string;
  kgVendido: string;
  importeVendido: string;
  /** Lo que había en el patio al terminar el tramo. */
  kgAlFinal: string;
}

export interface FichaDeMaterial {
  material: MaterialDelPatio;
  desde: string;
  hasta: string;
  dias: PeriodoDeMaterial;
  paso: "dia" | "semana";
  totales: {
    compras: number;
    ventas: number;
    kgComprado: string;
    importeComprado: string;
    kgVendido: string;
    importeVendido: string;
    /** Lo pagado y lo cobrado por cada kilo que entró o salió; nada si no hubo. */
    porKiloComprado: string | null;
    porKiloVendido: string | null;
    /** No es la ganancia. */
    diferenciaPorKilo: string | null;
    kgDescontadoEnCompras: string;
    kgDescontadoEnVentas: string;
  };
  kgAlEmpezar: string;
  serie: TramoDeMaterial[];
  control: {
    mermas: number;
    mermaKg: string;
    ajustes: number;
    ajusteEntroKg: string;
    ajusteSalioKg: string;
    separadoKg: string;
    deSeparacionKg: string;
  };
  precios: HistoriaDeMaterial | null;
}

// ── la ganancia (src/servidor/dominio/ganancia.ts) ──

export type Agrupar = "dia" | "semana" | "mes";

export interface CifrasDeGanancia {
  vendido: string;
  costo: string;
  margen: string;
  perdidas: string;
  aFavor: string;
  resultado: string;
  kgVendido: string;
}

export interface Ganancia {
  desde: string;
  hasta: string;
  agrupar: Agrupar;
  /** Además: los gastos que cuentan (0042) y lo que queda después de ellos. */
  totales: CifrasDeGanancia & { gastos: string; utilidad: string };
  serie: Array<CifrasDeGanancia & { gastos: string; utilidad: string; desde: string; hasta: string }>;
  materiales: Array<CifrasDeGanancia & { nombre: string }>;
  patio: {
    valor: string;
    valorALista: string;
    listaDel: string | null;
    materiales: Array<{ nombre: string; kg: string; valor: string; costoPorKilo: string | null; precioDeLista: string | null; valorALista: string | null }>;
  };
}

// ── los gastos (src/servidor/dominio/gastos.ts) ──

export interface TipoDeGasto {
  id: string;
  nombre: string;
  /** Si se resta en la ganancia. */
  cuenta: boolean;
  activo: boolean;
}

export interface Gasto {
  id: string;
  fecha: string;
  tipo: string;
  concepto: string;
  importe: string;
  deDonde: "cajon" | "otro";
  registro: string;
  anulado: { por: string; fecha: string; motivo: string } | null;
}

/** Dinero que se sacó del cajón y todavía no se dice en qué se gastó. */
export interface SacarSinGasto {
  id: string;
  fecha: string;
  hora: string;
  importe: string;
  motivo: string;
}

export interface Gastos {
  desde: string;
  hasta: string;
  tipos: TipoDeGasto[];
  gastos: Gasto[];
  porTipo: Array<{ tipo: string; cuenta: boolean; total: string; cuantos: number }>;
  totalQueCuenta: string;
  sinClasificar: SacarSinGasto[];
}
