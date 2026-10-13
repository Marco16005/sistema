"use client";
// Los clientes, para quien dirige: a quién se le da precio especial, cuánto se le ha comprado y
// vendido en esas cuentas, y cuánto movieron esos precios respecto de la lista. Una cuenta queda a
// nombre de un cliente solo cuando lleva precio especial: las demás no dicen de quién fueron.
import { useCallback, useEffect, useRef, useState } from "react";
import { pedir } from "../../../componentes/cliente.ts";
import { cuantosMateriales, fechaConDia, fechaCorta, kilosCortos, pesos, pesosCerrados, precio } from "../../../componentes/formato.ts";
import { Ticket } from "../../../componentes/mostrador/Ticket.tsx";
import type { Comprobante } from "../../../componentes/mostrador/tipos.ts";
import { Tira } from "../../../componentes/panel/Graficas.tsx";
import { Imprimir } from "../../../componentes/panel/Imprimir.tsx";
import { Secciones, SoloQuienDirige } from "../../../componentes/panel/Secciones.tsx";
import type { ClienteDelPanel, FichaDeCliente, TotalesDeClientes } from "../../../componentes/panel/tipos.ts";
import { DIRIGEN, useSesion } from "../../../componentes/Sesion.tsx";

const cuantas = (n: number, una: string, varias: string): string => `${n.toLocaleString("es-MX")} ${n === 1 ? una : varias}`;
const mayuscula = (t: string): string => t.slice(0, 1).toUpperCase() + t.slice(1);
const kg = (t: string): string => `${Number(t) >= 100 ? Math.round(Number(t)).toLocaleString("es-MX") : kilosCortos(t)} kg`;
/** El tamaño de una diferencia, sin su signo: el signo se dice con palabras. */
const tamano = (t: string): string => pesos(Math.abs(Number(t)).toFixed(2));
/** Lo que un precio especial movió respecto de la lista, dicho en llano: «$50.00 de más». */
const deMasODeMenos = (t: string): string => (Number(t) === 0 ? "Igual" : `${tamano(t)} de ${Number(t) > 0 ? "más" : "menos"}`);

/** Lo que los precios especiales movieron en compras o en ventas, como indicador. */
function Movio({ titulo, verbo, diferencia }: { titulo: string; verbo: string; diferencia: string }) {
  const n = Number(diferencia);
  return (
    <div className="indicador">
      <p className="lbl">{titulo}</p>
      <b className="cifra">{n === 0 ? "$0.00" : tamano(diferencia)}</b>
      <small>{n === 0 ? `Se ${verbo} lo mismo que con la lista` : `Se ${verbo} de ${n > 0 ? "más" : "menos"} que con la lista`}</small>
    </div>
  );
}

export default function PantallaDeLosClientes() {
  const { persona } = useSesion();
  const dirige = DIRIGEN.includes(persona.rol);
  const [clientes, setClientes] = useState<ClienteDelPanel[] | null>(null);
  const [totales, setTotales] = useState<TotalesDeClientes | null>(null);
  const [aviso, setAviso] = useState("");
  const [elegido, setElegido] = useState<ClienteDelPanel | null>(null);
  const [ficha, setFicha] = useState<FichaDeCliente | null>(null);
  const [comprobante, setComprobante] = useState<{ comprobante: Comprobante; negocio: string } | null>(null);

  const traer = useCallback(() => {
    pedir<{ clientes: ClienteDelPanel[]; totales: TotalesDeClientes }>("GET", "/api/clientes/resumen")
      .then((r) => { setClientes(r.clientes); setTotales(r.totales); setAviso(""); })
      .catch((e: Error) => setAviso(e.message));
  }, []);
  useEffect(() => { if (dirige) traer(); }, [dirige, traer]);

  /** Qué cliente se está viendo: la ficha de otro, si llega tarde, ya no se pinta. */
  const viendo = useRef<string | null>(null);
  /** El último comprobante que se pidió: si llega cuando ya se está viendo otra cosa, no se pinta. */
  const pedido = useRef(0);
  const abrir = (c: ClienteDelPanel): void => {
    viendo.current = c.id;
    pedido.current++;
    setElegido(c);
    setFicha(null);
    setComprobante(null);
    setAviso("");
    window.scrollTo(0, 0);
    pedir<{ ficha: FichaDeCliente }>("GET", `/api/clientes/${c.id}`)
      .then((r) => { if (viendo.current === c.id) setFicha(r.ficha); })
      .catch((e: Error) => { if (viendo.current === c.id) setAviso(e.message); });
  };
  const volver = (): void => { viendo.current = null; pedido.current++; setElegido(null); setFicha(null); setComprobante(null); setAviso(""); };
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
    const c = ficha?.cliente ?? elegido;
    const mayorKg = Math.max(0, ...(ficha?.materiales ?? []).flatMap((m) => [Number(m.kgComprado), Number(m.kgVendido)]));
    return (
      <div className="panel imprimible">
        <Secciones />
        <div className="top">
          <button className="quitar" type="button" onClick={volver}>‹ Clientes</button>
          <h2>{c.nombre}</h2>
          {ficha ? <Imprimir /> : null}
        </div>
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        <p className="note periodo">
          {c.activo ? "" : "Dado de baja · "}{c.ultimaVez ? `${cuantas(c.cuentas, "cuenta", "cuentas")} con precio especial · la última, el ${fechaCorta(c.ultimaVez)}` : "Todavía no tiene ninguna cuenta cobrada con precio especial"}
        </p>
        {!ficha ? (aviso ? null : <p className="cargando">Un momento…</p>) : (
          <>
            <div className="indicadores">
              <div className="indicador">
                <p className="lbl">Se le compró</p>
                <b className="cifra">{pesosCerrados(c.pagado)}</b>
                <small>{cuantas(c.compras, "cuenta", "cuentas")} · {kg(c.kgComprado)}</small>
              </div>
              <div className="indicador">
                <p className="lbl">Se le vendió</p>
                <b className="cifra">{pesosCerrados(c.cobrado)}</b>
                <small>{cuantas(c.ventas, "cuenta", "cuentas")} · {kg(c.kgVendido)}</small>
              </div>
              <Movio titulo="Sus precios en compras" verbo="le pagó" diferencia={c.diferenciaEnCompras} />
              <Movio titulo="Sus precios en ventas" verbo="le cobró" diferencia={c.diferenciaEnVentas} />
            </div>

            <div className="a-dos">
              <div className="card">
                <header><h2>Sus precios especiales</h2><small>Contra la lista de ese día</small></header>
                <div className="pad">
                  {ficha.precios.length === 0 ? <p className="empty">No tiene ninguno en una cuenta cobrada.</p> : null}
                  {ficha.precios.map((p, k) => (
                    <div className="mov" key={`${p.folio}-${k}`}>
                      <div className="tot"><b>{p.material}</b><span className="n">{deMasODeMenos(p.diferencia)}</span></div>
                      <small>{p.tipo === "compra" ? "Compra" : "Venta"} {p.folio} · {fechaCorta(p.fecha)} · {kilosCortos(p.kg)} kg</small>
                      <small>A {precio(p.precio)} por kilo; en la lista estaba a {precio(p.precioLista)}</small>
                      <small>Lo autorizó {p.autorizo}</small>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <header><h2>Lo que se le compró y vendió</h2><small>{cuantas(ficha.materiales.length, "material", "materiales")}</small></header>
                <div className="pad">
                  {ficha.materiales.length === 0 ? <p className="empty">Nada todavía.</p> : null}
                  {ficha.materiales.map((m) => (
                    <div className="mov" key={m.nombre}>
                      <b>{m.nombre}</b>
                      {Number(m.kgComprado) > 0 ? (
                        <><Tira parte={Number(m.kgComprado)} de={mayorKg} clase="compra" /><small>Se le compró {kg(m.kgComprado)} · {pesos(m.importeComprado)}</small></>
                      ) : null}
                      {Number(m.kgVendido) > 0 ? (
                        <><Tira parte={Number(m.kgVendido)} de={mayorKg} clase="venta" /><small>Se le vendió {kg(m.kgVendido)} · {pesos(m.importeVendido)}</small></>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <header><h2>Sus cuentas</h2><small>{cuantas(ficha.cuentas.length, "cuenta", "cuentas")}</small></header>
              <div className="pad">
                {ficha.cuentas.length === 0 ? <p className="empty">Ninguna cuenta cobrada a su nombre.</p> : null}
                {ficha.cuentas.map((u) => (
                  <button className="exrow" type="button" key={u.id} onClick={() => verComprobante(u.folio)} aria-label={`Ver el comprobante ${u.folio}`}>
                    <span className="rn">
                      <b>{u.tipo === "compra" ? "Compra" : "Venta"} · {mayuscula(fechaConDia(u.fecha))}</b>
                      <small>Folio {u.folio} · {cuantosMateriales(u.materiales).toLowerCase()} · atendió {u.atendio}</small>
                    </span>
                    <span className="ri">{pesosCerrados(u.total)}</span>
                  </button>
                ))}
                <p className="note">Solo están las cuentas que llevaron precio especial: las demás no quedan a nombre de nadie.</p>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="panel">
      <Secciones />
      <div className="top"><h2>Clientes</h2></div>
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      {clientes === null || totales === null ? (aviso ? null : <p className="cargando">Un momento…</p>) : clientes.length === 0 ? (
        <div className="card"><p className="empty">Todavía no hay clientes: se dan de alta en Ajustes, o en el mostrador al darles su primer precio especial.</p></div>
      ) : (
        <>
          <div className="indicadores">
            <div className="indicador">
              <p className="lbl">Clientes</p>
              <b className="cifra">{totales.activos.toLocaleString("es-MX")}</b>
              <small>Con precio especial{totales.clientes > totales.activos ? ` · ${cuantas(totales.clientes - totales.activos, "dado de baja", "dados de baja")}` : ""}</small>
            </div>
            <div className="indicador">
              <p className="lbl">Cuentas a su nombre</p>
              <b className="cifra">{totales.cuentas.toLocaleString("es-MX")}</b>
              <small>Las que llevaron precio especial</small>
            </div>
            <Movio titulo="Sus precios en compras" verbo="pagó" diferencia={totales.diferenciaEnCompras} />
            <Movio titulo="Sus precios en ventas" verbo="cobró" diferencia={totales.diferenciaEnVentas} />
          </div>
          <div className="card">
            <div className="pad">
              {clientes.map((c) => (
                <button className="exrow cliente" type="button" key={c.id} onClick={() => abrir(c)}>
                  <span className="rn">
                    <b>{c.nombre}</b>
                    <small>
                      {c.ultimaVez ? `${cuantas(c.cuentas, "cuenta", "cuentas")} · la última, el ${fechaCorta(c.ultimaVez)}` : "Sin cuentas cobradas"}{c.activo ? "" : " · dado de baja"}
                    </small>
                  </span>
                  <span className="dinero">
                    <small>Compras <b>{pesosCerrados(c.pagado)}</b></small>
                    <small>Ventas <b>{pesosCerrados(c.cobrado)}</b></small>
                  </span>
                </button>
              ))}
              <p className="note">
                Una cuenta queda a nombre de un cliente solo cuando lleva precio especial. Lo que aquí se suma son esas cuentas, desde que se usa el sistema.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
