"use client";
// Los días que ha habido, del más reciente al más viejo. Al tocar uno se ve lo que dejó asentado
// —el mismo reporte de su cierre— y sus cuentas, una por una, con su comprobante.
import { useCallback, useEffect, useRef, useState } from "react";
import { Dinero, Kilos, PreciosEspeciales } from "../../../componentes/cierre/Reporte.tsx";
import type { Cierre } from "../../../componentes/cierre/Reporte.tsx";
import { pedir } from "../../../componentes/cliente.ts";
import { cuantosMateriales, fechaConDia, pesosCerrados } from "../../../componentes/formato.ts";
import { Ticket } from "../../../componentes/mostrador/Ticket.tsx";
import type { Comprobante, Tipo } from "../../../componentes/mostrador/tipos.ts";
import { Imprimir } from "../../../componentes/panel/Imprimir.tsx";
import { Secciones, SoloQuienDirige } from "../../../componentes/panel/Secciones.tsx";
import { DIRIGEN, useSesion } from "../../../componentes/Sesion.tsx";

interface DiaDelHistorial {
  jornada: string;
  fecha: string;
  abierta: boolean;
  cierres: number;
  cuentas: number;
  aPagar: string;
  aCobrar: string;
}

interface CuentaDelDia {
  id: string;
  folio: string;
  tipo: Tipo;
  hora: string;
  cliente: string | null;
  etiqueta: string | null;
  materiales: number;
  total: string;
  atendio: string;
}

const mayuscula = (t: string): string => t.slice(0, 1).toUpperCase() + t.slice(1);
const cuantasCuentas = (n: number): string => (n === 0 ? "Sin cuentas" : `${n} ${n === 1 ? "cuenta" : "cuentas"}`);
/** De quién fue la cuenta, si se supo: el cliente del precio especial, o el nombre que se le puso. */
const deQuien = (c: CuentaDelDia): string => c.cliente ?? c.etiqueta ?? "";

export default function PantallaDeLosDias() {
  const { persona } = useSesion();
  const dirige = DIRIGEN.includes(persona.rol);
  const [dias, setDias] = useState<DiaDelHistorial[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [aviso, setAviso] = useState("");
  const [elegido, setElegido] = useState<DiaDelHistorial | null>(null);
  const [detalle, setDetalle] = useState<{ cierre: Cierre; cuentas: CuentaDelDia[] } | null>(null);
  const [comprobante, setComprobante] = useState<{ comprobante: Comprobante; negocio: string } | null>(null);

  /** Trae los días anteriores a esa fecha; sin fecha, los más recientes. */
  const traer = useCallback((antes: string | null) => {
    pedir<{ dias: DiaDelHistorial[]; hayMas: boolean }>("GET", `/api/historial${antes ? `?antes=${antes}` : ""}`)
      .then((r) => { setDias((ya) => (antes && ya ? [...ya, ...r.dias] : r.dias)); setHayMas(r.hayMas); setAviso(""); })
      .catch((e: Error) => setAviso(e.message));
  }, []);
  useEffect(() => { if (dirige) traer(null); }, [dirige, traer]);

  /** Qué día se está viendo: el detalle de otro, si llega tarde, ya no se pinta. */
  const viendo = useRef<string | null>(null);
  /** El último comprobante que se pidió: si llega cuando ya se está viendo otra cosa, no se pinta. */
  const pedido = useRef(0);
  const abrir = (dia: DiaDelHistorial): void => {
    viendo.current = dia.jornada;
    pedido.current++;
    setElegido(dia);
    setDetalle(null);
    setComprobante(null);
    setAviso("");
    window.scrollTo(0, 0);
    pedir<{ cierre: Cierre; cuentas: CuentaDelDia[] }>("GET", `/api/historial/${dia.jornada}`)
      .then((r) => { if (viendo.current === dia.jornada) setDetalle(r); })
      .catch((e: Error) => { if (viendo.current === dia.jornada) setAviso(e.message); });
  };
  const volver = (): void => { viendo.current = null; pedido.current++; setElegido(null); setDetalle(null); setComprobante(null); setAviso(""); };
  const verComprobante = (folio: string): void => {
    const este = ++pedido.current;
    setAviso("");
    pedir<{ comprobante: Comprobante; negocio: string }>("GET", `/api/comprobantes?folio=${folio}`)
      .then((r) => { if (este === pedido.current) { setComprobante(r); window.scrollTo(0, 0); } })
      .catch((e: Error) => { if (este === pedido.current) setAviso(e.message); });
  };

  if (!dirige) return <SoloQuienDirige />;

  if (comprobante) {
    return (
      <div className="angosto" style={{ margin: "0 auto" }}>
        <Ticket
          key={comprobante.comprobante.id} comprobante={comprobante.comprobante} negocio={comprobante.negocio} impresion={null}
          puedeImprimir={false} alTerminar={() => setComprobante(null)}
        />
      </div>
    );
  }

  if (elegido) {
    return (
      <div className="angosto imprimible" style={{ margin: "0 auto" }}>
        <Secciones />
        <div className="top">
          <button className="quitar" type="button" onClick={volver}>‹ Días</button>
          <h2>{mayuscula(fechaConDia(elegido.fecha))}</h2>
          {detalle ? <Imprimir /> : null}
        </div>
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        {!detalle ? (aviso ? null : <p className="cargando">Un momento…</p>) : (
          <>
            <Dinero cierre={detalle.cierre} />
            <Kilos cierre={detalle.cierre} />
            <PreciosEspeciales cierre={detalle.cierre} />
            <div className="card">
              <header><h2>Cuentas del día</h2><small>{cuantasCuentas(detalle.cuentas.length)}</small></header>
              <div className="pad">
                {detalle.cuentas.length === 0 ? <p className="empty">Ese día no se terminó ninguna cuenta.</p> : null}
                {detalle.cuentas.map((c) => (
                  <button className="exrow" type="button" key={c.id} onClick={() => verComprobante(c.folio)} aria-label={`Ver el comprobante ${c.folio}`}>
                    <span className="rn">
                      <b>{c.tipo === "compra" ? "Compra" : "Venta"}{deQuien(c) ? ` · ${deQuien(c)}` : ""}</b>
                      <small>Folio {c.folio} · {c.hora} · {cuantosMateriales(c.materiales).toLowerCase()} · atendió {c.atendio}</small>
                    </span>
                    <span className="ri">{pesosCerrados(c.total)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="angosto" style={{ margin: "0 auto" }}>
      <Secciones />
      <div className="top"><h2>Días</h2></div>
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      {dias === null ? (aviso ? null : <p className="cargando">Un momento…</p>) : (
        <div className="card">
          <div className="pad">
            {dias.length === 0 ? <p className="empty">Todavía no hay ningún día.</p> : null}
            {dias.map((d) => (
              <button className="exrow dia" type="button" key={d.jornada} onClick={() => abrir(d)}>
                <span className="rn">
                  <b>{mayuscula(fechaConDia(d.fecha))}</b>
                  <small>{cuantasCuentas(d.cuentas)} · {d.abierta ? "abierto" : d.cierres > 1 ? `cerrado (se reabrió ${d.cierres - 1 === 1 ? "una vez" : `${d.cierres - 1} veces`})` : "cerrado"}</small>
                </span>
                <span className="dinero">
                  <small>Compras <b>{pesosCerrados(d.aPagar)}</b></small>
                  <small>Ventas <b>{pesosCerrados(d.aCobrar)}</b></small>
                </span>
              </button>
            ))}
            {hayMas ? <button className="btn ghostbtn" type="button" onClick={() => traer(dias.at(-1)!.fecha)}>Ver días anteriores</button> : null}
          </div>
        </div>
      )}
    </div>
  );
}
