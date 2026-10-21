"use client";
// La ganancia, para quien dirige: lo que se vendió, lo que costó lo vendido (a costo promedio), lo
// que se perdió en bajas y conteos, y lo que hay en el patio valuado a lo que costó. Se escoge el
// periodo y si se ve por día, por semana o por mes. Solo lee: las cifras llegan hechas del servidor
// (src/servidor/dominio/ganancia.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { pedir } from "../../../componentes/cliente.ts";
import { diaCorto, fechaCorta, kilosCortos, pesos, pesosCerrados, precio } from "../../../componentes/formato.ts";
import { Barras } from "../../../componentes/panel/Graficas.tsx";
import { Imprimir } from "../../../componentes/panel/Imprimir.tsx";
import { Secciones, SoloQuienDirige } from "../../../componentes/panel/Secciones.tsx";
import type { Agrupar, CifrasDeGanancia, Ganancia } from "../../../componentes/panel/tipos.ts";
import { DIRIGEN, useSesion } from "../../../componentes/Sesion.tsx";

const PERIODOS: Array<{ dias: number; nombre: string }> = [
  { dias: 7, nombre: "7 días" }, { dias: 30, nombre: "30 días" }, { dias: 91, nombre: "3 meses" }, { dias: 365, nombre: "1 año" },
];
const AGRUPAR: Array<{ como: Agrupar; nombre: string; columna: string }> = [
  { como: "dia", nombre: "Por día", columna: "Día" }, { como: "semana", nombre: "Por semana", columna: "Semana" }, { como: "mes", nombre: "Por mes", columna: "Mes" },
];
const TOPE = 366;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** Un resultado se lee con su signo: «−$57» es que se perdió. */
const conSigno = (t: string): string => (Number(t) < 0 ? "−" : "") + pesosCerrados(String(Math.abs(Number(t))));
const kg = (t: string): string => `${Number(t) >= 100 ? Math.round(Number(t)).toLocaleString("es-MX") : kilosCortos(t)} kg`;
/** Qué parte de lo vendido quedó de margen, en por ciento. */
const porCiento = (c: CifrasDeGanancia): string | null =>
  Number(c.vendido) > 0 ? `${((Number(c.margen) / Number(c.vendido)) * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %` : null;
function delTramo(t: { desde: string; hasta: string }, como: Agrupar): string {
  if (como === "dia") return fechaCorta(t.desde);
  if (como === "mes") return `${MESES[Number(t.desde.slice(5, 7)) - 1]} ${t.desde.slice(0, 4)}`;
  return `${diaCorto(t.desde)} – ${diaCorto(t.hasta)}`;
}
const diasEntre = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;

export default function PantallaDeGanancia() {
  const { persona, dia } = useSesion();
  const [dias, setDias] = useState<number | null>(30);
  const [desde, setDesde] = useState(`${dia.hoy.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(dia.hoy);
  const [agrupar, setAgrupar] = useState<Agrupar | null>(null);
  const [g, setG] = useState<Ganancia | null>(null);
  const [aviso, setAviso] = useState("");
  const dirige = DIRIGEN.includes(persona.rol);
  const falta = dias !== null ? "" : !desde || !hasta ? "Falta decir de qué día a qué día."
    : desde > hasta ? "El primer día no puede ser posterior al último." : diasEntre(desde, hasta) > TOPE ? "Cabe hasta un año. Elige un periodo más corto." : "";
  const pedido = falta ? "" : `${dias !== null ? `dias=${dias}` : `desde=${desde}&hasta=${hasta}`}${agrupar ? `&agrupar=${agrupar}` : ""}`;

  const ultima = useRef(0);
  const cargar = useCallback(() => {
    if (!dirige || !pedido) return;
    const esta = ++ultima.current;
    pedir<{ ganancia: Ganancia }>("GET", `/api/panel/ganancia?${pedido}`)
      .then((r) => { if (esta === ultima.current) { setG(r.ganancia); setAviso(""); } })
      .catch((e: Error) => { if (esta === ultima.current) setAviso(e.message); });
  }, [dirige, pedido]);
  useEffect(cargar, [cargar]);

  if (!dirige) return <SoloQuienDirige />;

  const como = g?.agrupar ?? "dia";
  const t = g?.totales;
  return (
    <div className="panel imprimible">
      <Secciones />
      <div className="top"><h2>Ganancia</h2><Imprimir /></div>
      <div className="chips" role="group" aria-label="Periodo">
        {PERIODOS.map((p) => (
          <button key={p.dias} type="button" className="chip" aria-pressed={p.dias === dias} onClick={() => setDias(p.dias)}>{p.nombre}</button>
        ))}
        <button type="button" className="chip" aria-pressed={dias === null} onClick={() => setDias(null)}>Otro periodo</button>
      </div>
      {dias === null ? (
        <>
          <div className="filtros">
            <label><span className="lbl">Desde</span><input className="campo" type="date" value={desde} max={dia.hoy} onChange={(e) => setDesde(e.target.value)} /></label>
            <label><span className="lbl">Hasta</span><input className="campo" type="date" value={hasta} max={dia.hoy} onChange={(e) => setHasta(e.target.value)} /></label>
          </div>
          {falta ? <p className="note" role="status">{falta}</p> : null}
        </>
      ) : null}
      <div className="chips" role="group" aria-label="Cómo se agrupa">
        {AGRUPAR.map((x) => (
          <button key={x.como} type="button" className="chip" aria-pressed={x.como === como} onClick={() => setAgrupar(x.como)}>{x.nombre}</button>
        ))}
      </div>
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      {!g || !t ? (aviso ? null : <p className="cargando">Un momento…</p>) : (
        <>
          <p className="note periodo" role="status">Del {fechaCorta(g.desde)} al {fechaCorta(g.hasta)}</p>
          <div className="indicadores">
            <div className="indicador">
              <p className="lbl">Vendido</p>
              <b className="cifra">{pesosCerrados(t.vendido)}</b>
              <small>{kg(t.kgVendido)}</small>
            </div>
            <div className="indicador">
              <p className="lbl">Lo que costó lo vendido</p>
              <b className="cifra">{pesosCerrados(t.costo)}</b>
              <small>A costo promedio de cada material</small>
            </div>
            <div className="indicador">
              <p className="lbl">Margen</p>
              <b className="cifra">{conSigno(t.margen)}</b>
              <small>{porCiento(t) ? `${porCiento(t)} de lo vendido` : "Sin ventas en el periodo"}</small>
            </div>
            <div className="indicador">
              <p className="lbl">Lo que dejó el material</p>
              <b className="cifra">{conSigno(t.resultado)}</b>
              <small>
                Margen{Number(t.perdidas) > 0 ? `, menos ${pesosCerrados(t.perdidas)} de bajas y faltantes` : ""}
                {Number(t.aFavor) > 0 ? `, más ${pesosCerrados(t.aFavor)} que sobró al contar` : ""}
              </small>
            </div>
            <div className="indicador">
              <p className="lbl">Lo que queda</p>
              <b className="cifra">{conSigno(t.utilidad)}</b>
              <small>{Number(t.gastos) > 0 ? `Después de ${pesosCerrados(t.gastos)} de gastos` : "Sin gastos que resten en el periodo"}</small>
            </div>
          </div>

          <div className="card">
            <header><h2>Vendido y lo que costó</h2><small>{AGRUPAR.find((x) => x.como === como)!.nombre}</small></header>
            <div className="pad">
              {Number(t.vendido) === 0 && Number(t.perdidas) === 0 && Number(t.aFavor) === 0
                ? <p className="empty">No se vendió ni se dio de baja nada en este periodo.</p> : (
                  <>
                    <Barras
                      clases={["venta", "compra"]} tope={(mayor) => pesosCerrados(String(mayor))}
                      columnas={g.serie.map((s) => ({ clave: s.desde, rotulo: como === "mes" ? MESES[Number(s.desde.slice(5, 7)) - 1]!.slice(0, 3) : diaCorto(s.desde), valores: [Number(s.vendido), Number(s.costo)] }))}
                    />
                    <p className="leyenda"><span><i className="barrita venta" />Vendido</span><span><i className="barrita compra" />Lo que costó</span></p>
                    <details className="numeros">
                      <summary>Ver los números</summary>
                      <div className="scroll">
                        <table>
                          <thead><tr><th>{AGRUPAR.find((x) => x.como === como)!.columna}</th><th>Vendido</th><th>Costó</th><th>Margen</th><th>Bajas</th><th>Dejó</th><th>Gastos</th><th>Queda</th></tr></thead>
                          <tbody>
                            {g.serie.map((s) => (
                              <tr key={s.desde}>
                                <td>{delTramo(s, como)}</td>
                                <td className="mn">{pesosCerrados(s.vendido)}</td><td className="mn">{pesosCerrados(s.costo)}</td>
                                <td className="mn">{conSigno(s.margen)}</td><td className="mn">{pesosCerrados(s.perdidas)}</td>
                                <td className="mn">{conSigno(s.resultado)}</td>
                                <td className="mn">{pesosCerrados(s.gastos)}</td><td className="mn">{conSigno(s.utilidad)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </>
                )}
              <p className="note">Lo que costó es el costo promedio de lo que había en el patio al venderlo. Los gastos que se restan son los de los tipos marcados en «Gastos».</p>
            </div>
          </div>

          <div className="a-dos">
            <div className="card">
              <header><h2>Por material</h2><small>Del que más dejó al que menos</small></header>
              <div className="pad">
                {g.materiales.length === 0 ? <p className="empty">Ningún material se vendió ni se dio de baja.</p> : g.materiales.map((m) => (
                  <div className="exrow" key={m.nombre}>
                    <span className="rn">
                      <b>{m.nombre}</b>
                      <small>
                        {Number(m.vendido) > 0 ? `Vendido ${pesosCerrados(m.vendido)} (${kg(m.kgVendido)}), costó ${pesosCerrados(m.costo)}` : "Sin ventas"}
                        {porCiento(m) ? ` · margen ${porCiento(m)}` : ""}
                        {Number(m.perdidas) > 0 ? ` · bajas ${pesosCerrados(m.perdidas)}` : ""}
                      </small>
                    </span>
                    <span className="ri">{conSigno(m.resultado)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <header><h2>Lo que hay en el patio</h2><small>{g.patio.listaDel ? `A lista del ${fechaCorta(g.patio.listaDel)}` : "Sin lista publicada"}</small></header>
              <div className="pad">
                <div className="tot"><span>Lo que costó</span><span className="n">{pesosCerrados(g.patio.valor)}</span></div>
                <div className="tot adj"><span>A precio de compra de la lista</span><span className="n">{pesosCerrados(g.patio.valorALista)}</span></div>
                {g.patio.materiales.map((m) => (
                  <div className="exrow" key={m.nombre}>
                    <span className="rn">
                      <b>{m.nombre}</b>
                      <small>
                        {kg(m.kg)}{m.costoPorKilo ? ` · costó ${precio(m.costoPorKilo)} el kilo` : ""}
                        {m.precioDeLista ? ` · lista ${precio(m.precioDeLista)}` : " · sin precio en la lista"}
                      </small>
                    </span>
                    <span className="ri">{pesos(m.valor)}</span>
                  </div>
                ))}
                <p className="note">Es el dinero que hay «parado» en el patio: lo que se pagó por lo que todavía no se vende.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
