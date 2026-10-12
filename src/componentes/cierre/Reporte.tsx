// Lo que un día dejó asentado: los kilos de cada material, los precios especiales y el dinero. Lo
// usan el cierre del día y el historial, que enseña este mismo reporte de un día que ya pasó.
import type { ReactNode } from "react";
import { ajuste, fechaCorta, kilos, pesos, pesosCerrados, precio } from "../formato.ts";
import type { Tipo } from "../mostrador/tipos.ts";

export interface Pendiente {
  id: string;
  tipo: Tipo;
  etiqueta: string | null;
  materiales: number;
}

export interface PrecioDado {
  folio: string;
  cliente: string;
  material: string;
  kg: string;
  precioDeLista: string;
  precio: string;
  diferencia: string;
  autorizo: string;
}

export interface Cierre {
  jornada: { id: string; fecha: string; abierta: boolean; cierres: number; cerradaEn: string | null };
  reaperturas: Array<{ cierre: number; cerradaEn: string; reabiertaEn: string; autorizo: string }>;
  operaciones: number;
  aPagar: string;
  aCobrar: string;
  ajustes: string;
  materiales: Array<{ nombre: string; entro: string; salio: string }>;
  /** Los precios especiales de lo cobrado en el día. La diferencia es en dinero: lo cobrado menos lo que habría dado la lista. */
  preciosEspeciales: { compras: PrecioDado[]; ventas: PrecioDado[]; diferenciaEnCompras: string; diferenciaEnVentas: string };
  porTerminar: Pendiente[];
  vehiculosPorVolver: Pendiente[];
}

/** Una diferencia en dinero, con su signo a la vista: «+$50.00», «−$50.00». */
const conSigno = (t: string): string => (Number(t) < 0 ? "−" : "+") + pesos(String(Math.abs(Number(t)).toFixed(2)));
/** Lo que una diferencia quiere decir: en una compra, positiva es que se pagó de más; en una venta, que se cobró de más. */
const significado = (compra: boolean, t: string): string =>
  Number(t) === 0 ? (compra ? "En compras, sin diferencia" : "En ventas, sin diferencia")
    : compra ? `En compras se pagó de ${Number(t) > 0 ? "más" : "menos"}` : `En ventas se cobró de ${Number(t) > 0 ? "más" : "menos"}`;

/** Cuánto entró y cuánto salió de cada material. */
export function Kilos({ cierre }: { cierre: Cierre }) {
  return (
    <div className="card">
      <header>
        <h2>{cierre.jornada.abierta ? "Kilos del día" : `Kilos del ${fechaCorta(cierre.jornada.fecha)}`}</h2>
        <small>{cierre.operaciones} {cierre.operaciones === 1 ? "cuenta terminada" : "cuentas terminadas"}</small>
      </header>
      <div className="pad">
        {cierre.materiales.length === 0 ? <p className="empty">Todavía no se ha movido nada.</p> : (
          <div className="scroll">
            <table>
              <thead><tr><th>Material</th><th>Entró</th><th>Salió</th></tr></thead>
              <tbody>
                {cierre.materiales.map((m) => (
                  <tr key={m.nombre}><td>{m.nombre}</td><td className="mn">{kilos(m.entro)}</td><td className="mn">{kilos(m.salio)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Estos totales los saca el sistema; nadie suma a mano.</p>
      </div>
    </div>
  );
}

/** Qué precios especiales se dieron, a quién y cuánto significaron. Nada, si no hubo. */
export function PreciosEspeciales({ cierre }: { cierre: Cierre }) {
  if (cierre.preciosEspeciales.compras.length + cierre.preciosEspeciales.ventas.length === 0) return null;
  return (
    <div className="card">
      <header><h2>Precios especiales del día</h2><small>Qué se dio, a quién y cuánto significó</small></header>
      <div className="pad">
        {([["Compras", cierre.preciosEspeciales.compras], ["Ventas", cierre.preciosEspeciales.ventas]] as const).map(([titulo, dados]) => (
          dados.length > 0 ? (
            <div key={titulo}>
              <p className="lbl">{titulo}</p>
              {dados.map((d, k) => (
                <div className="ren" key={`${d.folio}-${k}`}>
                  <div className="rn">
                    <b>{d.cliente} · {d.material}</b>
                    <small>Folio {d.folio} · {kilos(d.kg)} kg × {precio(d.precio)} · lista {precio(d.precioDeLista)} · Autorizó {d.autorizo}</small>
                  </div>
                  <div className="ri">{conSigno(d.diferencia)}</div>
                </div>
              ))}
            </div>
          ) : null
        ))}
        {cierre.preciosEspeciales.compras.length > 0 ? (
          <div className="tot"><span>{significado(true, cierre.preciosEspeciales.diferenciaEnCompras)}</span><span className="n">{pesos(String(Math.abs(Number(cierre.preciosEspeciales.diferenciaEnCompras)).toFixed(2)))}</span></div>
        ) : null}
        {cierre.preciosEspeciales.ventas.length > 0 ? (
          <div className="tot"><span>{significado(false, cierre.preciosEspeciales.diferenciaEnVentas)}</span><span className="n">{pesos(String(Math.abs(Number(cierre.preciosEspeciales.diferenciaEnVentas)).toFixed(2)))}</span></div>
        ) : null}
        <p className="note">Respecto del precio de lista de cada material. Es informativo: no cambia lo que suman los comprobantes.</p>
      </div>
    </div>
  );
}

/** Cuánto hay que cobrar y pagar, y si el día se reabrió. Lo que se puede hacer con el día va adentro, al final. */
export function Dinero({ cierre, children }: { cierre: Cierre; children?: ReactNode }) {
  return (
    <div className="card">
      <header>
        <h2>Dinero del día</h2>
        <small>{cierre.jornada.abierta ? "Jornada abierta" : `Jornada cerrada · cierre ${cierre.jornada.cierres}${cierre.jornada.cerradaEn ? `, ${cierre.jornada.cerradaEn}` : ""}`}</small>
      </header>
      <div className="pad">
        <div className="tot"><span>A cobrar por ventas</span><span className="n">{pesosCerrados(cierre.aCobrar)}</span></div>
        <div className="tot"><span>A pagar por compras</span><span className="n">{pesosCerrados(cierre.aPagar)}</span></div>
        <div className="tot adj"><span>Ajustes por redondeo</span><span className="n">{ajuste(cierre.ajustes)}</span></div>
        <p className="note">Es lo que suman los comprobantes del día. El conteo del cajón todavía se lleva aparte.</p>
        {cierre.reaperturas.length > 0 ? (
          <p className="note">
            Este día se reabrió después de cerrarse
            {cierre.reaperturas.map((x) => ` · cierre ${x.cierre} (${x.cerradaEn}), reabierto ${x.reabiertaEn} con autorización de ${x.autorizo}`).join("")}.
            Un reporte anterior a la reapertura ya no es el del día.
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
