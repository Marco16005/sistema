"use client";
// Lo fiado, para quien dirige: quién debe cuánto, cuánto ya está vencido y cuándo fue lo último. Las
// ventas a crédito se hacen en el mostrador y los abonos se registran en el cierre (el cajón).
import { useEffect, useState } from "react";
import type { SaldoDeCliente } from "../../../componentes/caja/Abonar.tsx";
import { pedir } from "../../../componentes/cliente.ts";
import { fechaCorta, pesos, pesosCerrados } from "../../../componentes/formato.ts";
import { Imprimir } from "../../../componentes/panel/Imprimir.tsx";
import { Secciones, SoloQuienDirige } from "../../../componentes/panel/Secciones.tsx";
import { DIRIGEN, useSesion } from "../../../componentes/Sesion.tsx";

export default function PantallaDeFiado() {
  const { persona } = useSesion();
  const [clientes, setClientes] = useState<SaldoDeCliente[] | null>(null);
  const [aviso, setAviso] = useState("");
  const dirige = DIRIGEN.includes(persona.rol);

  useEffect(() => {
    if (!dirige) return;
    pedir<{ clientes: SaldoDeCliente[] }>("GET", "/api/fiado").then((r) => setClientes(r.clientes)).catch((e: Error) => setAviso(e.message));
  }, [dirige]);

  if (!dirige) return <SoloQuienDirige />;
  const deben = clientes?.filter((c) => Number(c.debe) > 0) ?? [];
  const pagaron = clientes?.filter((c) => Number(c.debe) <= 0) ?? [];
  const total = deben.reduce((s, c) => s + Number(c.debe), 0);
  const vencido = deben.reduce((s, c) => s + Number(c.vencido), 0);

  return (
    <div className="panel imprimible">
      <Secciones />
      <div className="top"><h2>Fiado</h2><Imprimir /></div>
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      {clientes === null ? (aviso ? null : <p className="cargando">Un momento…</p>) : (
        <>
          <div className="indicadores">
            <div className="indicador">
              <p className="lbl">Lo que deben</p>
              <b className="cifra">{pesosCerrados(String(total))}</b>
              <small>{deben.length === 1 ? "Un cliente" : `${deben.length} clientes`}</small>
            </div>
            <div className="indicador">
              <p className="lbl">Ya vencido</p>
              <b className="cifra">{pesosCerrados(String(vencido))}</b>
              <small>De ventas cuyo plazo ya pasó</small>
            </div>
          </div>
          <div className="card">
            <header><h2>Quién debe</h2><small>Del que más debe al que menos</small></header>
            <div className="pad">
              {deben.length === 0 ? <p className="empty">Nadie debe nada de lo fiado.</p> : deben.map((c) => (
                <div className="exrow" key={c.cliente}>
                  <span className="rn">
                    <b>{c.nombre}</b>
                    <small>
                      Se le fiaron {pesos(c.fiado)}, ha abonado {pesos(c.abonado)} · última venta fiada el {fechaCorta(c.ultimaVenta)}
                      {c.ultimoAbono ? ` · último abono el ${fechaCorta(c.ultimoAbono)}` : " · sin abonos"}
                      {Number(c.vencido) > 0 ? ` · vencido ${pesos(c.vencido)}` : ""}
                    </small>
                  </span>
                  <span className="ri">{pesos(c.debe)}</span>
                </div>
              ))}
              <p className="note">Se fía en el mostrador, al cobrar una venta, con la clave de quien autoriza. Los abonos se registran en el cierre, en el cajón; los de efectivo cuentan en el corte.</p>
            </div>
          </div>
          {pagaron.length > 0 ? (
            <div className="card">
              <header><h2>Ya pagaron todo</h2><small>{pagaron.length}</small></header>
              <div className="pad">
                {pagaron.map((c) => (
                  <div className="exrow" key={c.cliente}>
                    <span className="rn"><b>{c.nombre}</b><small>Se le fiaron {pesos(c.fiado)} · último abono el {c.ultimoAbono ? fechaCorta(c.ultimoAbono) : "—"}</small></span>
                    <span className="ri">{pesos("0")}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
