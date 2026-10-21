// Lo que el servidor manda sobre cuentas, catálogo y comprobantes, tal como llega a la pantalla.

export type Tipo = "compra" | "venta";

/** Cómo se pagó o se cobró. Solo el efectivo pasa por el cajón; a crédito es una venta fiada. */
export type FormaDePago = "efectivo" | "transferencia" | "credito";

export interface CuentaEnLista {
  id: string;
  tipo: Tipo;
  etiqueta: string | null;
  materiales: number;
  porPesar: number;
  total: string;
  deOtraJornada: boolean;
}

export interface MaterialDeCuenta {
  id: string;
  material: { id: number; nombre: string; nombreCorto: string };
  bascula: { id: number; nombre: string; doblePesaje: boolean };
  /** Pesos por kilo: lo que se cobra. Es el de lista, salvo que lleve precio especial. */
  precio: string;
  precioDeLista: string;
  /** Su último cambio de precio: es lo que se manda como «visto» al darle o quitarle un precio especial. */
  eventoDePrecio: string | null;
  /** Si lleva precio especial: quién lo autorizó. */
  precioEspecial: { autorizo: string } | null;
  pesadas: string[];
  porPesar: boolean;
  bruto: string | null;
  tara: string | null;
  /** Lo que pesa vacío el recipiente, en la báscula chica. En la grande, cero: ahí la tara es el vehículo. */
  recipiente: string;
  descuento: string;
  kg: string | null;
  importe: string | null;
}

export interface Cuenta {
  id: string;
  tipo: Tipo;
  etiqueta: string | null;
  estado: "borrador" | "confirmada";
  revision: number;
  folio: string | null;
  formaDePago: FormaDePago | null;
  deOtraJornada: boolean;
  /** A nombre de quién está: solo mientras algún material lleve precio especial. */
  cliente: { id: string; nombre: string } | null;
  materiales: MaterialDeCuenta[];
  resumen: { materiales: number; porPesar: number; suma: string; ajuste: string; total: string };
  avisos: Array<{ material: string; faltan: string }>;
}

export interface MaterialDelCatalogo {
  id: number;
  nombre: string;
  nombreCorto: string;
  frecuente: boolean;
  precio: string | null;
  disponible: string | null;
}

export interface Bascula {
  id: number;
  nombre: string;
  doblePesaje: boolean;
}

export interface Catalogo {
  frecuentes: MaterialDelCatalogo[];
  familias: Array<{ id: number; nombre: string; materiales: MaterialDelCatalogo[] }>;
  basculas: Bascula[];
}

export interface Comprobante {
  id: string;
  folio: string;
  tipo: Tipo;
  etiqueta: string | null;
  /** El cliente, cuando la cuenta se cobró con precio especial. Las demás son anónimas. */
  cliente: string | null;
  fecha: string;
  hora: string;
  atendio: string;
  formaDePago: FormaDePago;
  /** Si se fió: hasta cuándo debe pagar, si se pactó (AAAA-MM-DD). */
  credito: { vence: string | null } | null;
  materiales: Array<{ nombre: string; bascula: string; bruto: string; tara: string; recipiente: string; descuento: string; kg: string; precio: string; importe: string }>;
  suma: string;
  ajuste: string;
  total: string;
  impresiones: number;
}

export interface Impresion {
  numero: number;
  motivo: string | null;
}

/** En una compra el vehículo llega cargado y vuelve vacío; en una venta, al revés. */
export const primeraPesada = (tipo: Tipo): string => (tipo === "compra" ? "cargado" : "vacío");
export const segundaPesada = (tipo: Tipo): string => (tipo === "compra" ? "vacío" : "cargado");

export const nombreDe = (c: { tipo: Tipo; etiqueta: string | null }): string => c.etiqueta ?? (c.tipo === "compra" ? "Compra" : "Venta");
