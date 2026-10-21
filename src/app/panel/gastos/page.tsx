"use client";
// Los gastos del negocio, para quien dirige: los de un periodo, cuánto suman por tipo y cuánto se
// resta en la ganancia. Un responsable además los registra, clasifica lo que se sacó del cajón,
// anula uno (queda escrito quién y por qué) y escoge qué tipos se restan. Las cifras y las reglas son
// del servidor (src/servidor/dominio/gastos.ts y la migración 0042).
import { useCallback, useEffect, useRef, useState } from "react";
import { pedir } from "../../../componentes/cliente.ts";
import { fechaCorta, pesos, pesosCerrados } from "../../../componentes/formato.ts";
import { RegistrarGasto, hayGastoPendiente } from "../../../componentes/gastos/RegistrarGasto.tsx";
import { TiposDeGasto } from "../../../componentes/gastos/TiposDeGasto.tsx";
import { useAccion } from "../../../componentes/inventario/piezas.tsx";
import { Imprimir } from "../../../componentes/panel/Imprimir.tsx";
import { Secciones, SoloQuienDirige } from "../../../componentes/panel/Secciones.tsx";
import type { Gasto, Gastos, SacarSinGasto } from "../../../componentes/panel/tipos.ts";
import { DIRIGEN, useSesion } from "../../../componentes/Sesion.tsx";

type Cual = "este" | "pasado" | "otro";
const TOPE = 366;

/** El primero y el último día del mes de `aaaammdd`, corrido `meses` meses. */
function mes(aaaammdd: string, meses: number): { desde: string; hasta: string } {
  const d = new Date(Date.UTC(Number(aaaammdd.slice(0, 4)), Number(aaaammdd.slice(5, 7)) - 1 + meses, 1));
  const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { desde: d.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) };
}
const diasEntre = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;

/** Anular un gasto: por qué, y se manda. Queda escrito. */
function Anular({ gasto, alAnular }: { gasto: Gasto; alAnular: (mensaje: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const { ocupado, aviso, hacer } = useAccion();
  if (!abierto) {
    return <button className="btn ghostbtn chico" type="button" aria-label={`Anular el gasto de ${pesos(gasto.importe)}: ${gasto.concepto}`} onClick={() => setAbierto(true)}>Anular</button>;
  }
  const mandar = (): Promise<void> =>
    hacer(async () => {
      await pedir("POST", `/api/gastos/${gasto.id}/anular`, { motivo: motivo.trim() });
      alAnular(`Se anuló el gasto de ${pesos(gasto.importe)} (${gasto.concepto}).`);
    });
  return (
    <div className="manual">
      <label>
        <span className="lbl" style={{ display: "block" }}>¿Por qué se anula?</span>
        <input className="campo" type="text" value={motivo} maxLength={200} autoComplete="off" placeholder="Por ejemplo: se capturó dos veces" onChange={(e) => setMotivo(e.target.value)} />
      </label>
      {gasto.deDonde === "cajon" ? <p className="note">Salió del cajón: anularlo no regresa el dinero, que ya se sacó; solo deja de contar como gasto, y lo sacado vuelve a quedar por clasificar. Se puede mientras ese día no se cierre.</p> : null}
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      <div className="dos">
        <button className="btn" type="button" disabled={!motivo.trim() || ocupado} onClick={() => void mandar()}>Anular el gasto</button>
        <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => { setAbierto(false); setMotivo(""); }}>No anular</button>
      </div>
    </div>
  );
}

export default function PantallaDeGastos() {
  const { persona, dia } = useSesion();
  const [cual, setCual] = useState<Cual>("este");
  const [desde, setDesde] = useState(`${dia.hoy.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(dia.hoy);
  const [g, setG] = useState<Gastos | null>(null);
  const [aviso, setAviso] = useState("");
  const [hecho, setHecho] = useState("");
  // El registro abierto: uno nuevo, o clasificar un «sacar». Si quedó uno sin saberse, se abre solo.
  const [registrando, setRegistrando] = useState<{ sacar: SacarSinGasto | null } | null>(() => (hayGastoPendiente() ? { sacar: null } : null));
  const dirige = DIRIGEN.includes(persona.rol);
  const escribe = persona.rol === "responsable";

  const periodo = cual === "este" ? { desde: `${dia.hoy.slice(0, 8)}01`, hasta: dia.hoy } : cual === "pasado" ? mes(dia.hoy, -1) : { desde, hasta };
  const falta = cual !== "otro" ? "" : !desde || !hasta ? "Falta decir de qué día a qué día."
    : desde > hasta ? "El primer día no puede ser posterior al último." : diasEntre(desde, hasta) > TOPE ? "Cabe hasta un año. Elige un periodo más corto." : "";
  const pedido = falta ? "" : `desde=${periodo.desde}&hasta=${periodo.hasta}`;

  const ultima = useRef(0);
  const cargar = useCallback(() => {
    if (!dirige || !pedido) return;
    const esta = ++ultima.current;
    pedir<{ gastos: Gastos }>("GET", `/api/gastos?${pedido}`)
      .then((r) => { if (esta === ultima.current) { setG(r.gastos); setAviso(""); } })
      .catch((e: Error) => { if (esta === ultima.current) setAviso(e.message); });
  }, [dirige, pedido]);
  useEffect(cargar, [cargar]);

  if (!dirige) return <SoloQuienDirige />;
  const listo = (mensaje: string): void => {
    setHecho(mensaje);
    setRegistrando(null);
    cargar();
  };
  const noCuenta = g?.porTipo.filter((t) => !t.cuenta).reduce((s, t) => s + Number(t.total), 0) ?? 0;

  return (
    <div className="panel imprimible">
      <Secciones />
      <div className="top"><h2>Gastos</h2><Imprimir /></div>
      <div className="chips" role="group" aria-label="Periodo">
        <button type="button" className="chip" aria-pressed={cual === "este"} onClick={() => setCual("este")}>Este mes</button>
        <button type="button" className="chip" aria-pressed={cual === "pasado"} onClick={() => setCual("pasado")}>El mes pasado</button>
        <button type="button" className="chip" aria-pressed={cual === "otro"} onClick={() => setCual("otro")}>Otro periodo</button>
      </div>
      {cual === "otro" ? (
        <>
          <div className="filtros">
            <label><span className="lbl">Desde</span><input className="campo" type="date" value={desde} max={dia.hoy} onChange={(e) => setDesde(e.target.value)} /></label>
            <label><span className="lbl">Hasta</span><input className="campo" type="date" value={hasta} max={dia.hoy} onChange={(e) => setHasta(e.target.value)} /></label>
          </div>
          {falta ? <p className="note" role="status">{falta}</p> : null}
        </>
      ) : null}
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      {hecho ? <p className="note hecho" role="status">{hecho}</p> : null}

      {!g ? (aviso ? null : <p className="cargando">Un momento…</p>) : (
        <>
          <p className="note periodo" role="status">Del {fechaCorta(g.desde)} al {fechaCorta(g.hasta)}</p>
          <div className="indicadores dos">
            <div className="indicador">
              <p className="lbl">Se resta en la ganancia</p>
              <b className="cifra">{pesosCerrados(g.totalQueCuenta)}</b>
              <small>De los tipos que se restan, sin los anulados</small>
            </div>
            <div className="indicador">
              <p className="lbl">No se resta</p>
              <b className="cifra">{pesosCerrados(String(noCuenta))}</b>
              <small>{noCuenta > 0 ? "De los tipos que no se restan" : "Todos los gastos del periodo se restan"}</small>
            </div>
          </div>

          {escribe ? (
            registrando ? (
              <div className="card registrar">
                <header><h2>{registrando.sacar ? "Clasificar lo que se sacó" : "Registrar un gasto"}</h2></header>
                <div className="pad">
                  <RegistrarGasto
                    key={registrando.sacar?.id ?? "nuevo"} hoy={dia.hoy} tipos={g.tipos} sacar={registrando.sacar}
                    alRegistrar={listo} alCancelar={() => setRegistrando(null)}
                  />
                </div>
              </div>
            ) : (
              <button className="btn" type="button" onClick={() => { setHecho(""); setRegistrando({ sacar: null }); }}>Registrar un gasto</button>
            )
          ) : null}

          {escribe && g.sinClasificar.length > 0 && !registrando ? (
            <div className="card por-clasificar">
              <header><h2>Lo que se sacó del cajón</h2><small>Últimos 30 días, sin decir en qué se gastó</small></header>
              <div className="pad">
                {g.sinClasificar.map((s) => (
                  <div className="exrow" key={s.id}>
                    <span className="rn">
                      <b>{s.motivo}</b>
                      <small>{fechaCorta(s.fecha)}, {s.hora}</small>
                      <button className="btn ghostbtn chico" type="button" aria-label={`Clasificar como gasto los ${pesos(s.importe)} que se sacaron: ${s.motivo}`} onClick={() => { setHecho(""); setRegistrando({ sacar: s }); }}>
                        Es un gasto
                      </button>
                    </span>
                    <span className="ri">{pesos(s.importe)}</span>
                  </div>
                ))}
                <p className="note">Si lo que se sacó fue un gasto, se dice de qué tipo para que cuente en la ganancia. Si no lo fue (por ejemplo, se llevó al banco), se deja así.</p>
              </div>
            </div>
          ) : null}

          <div className="a-dos">
            <div className="card">
              <header><h2>Por tipo</h2><small>Sin los anulados</small></header>
              <div className="pad">
                {g.porTipo.length === 0 ? <p className="empty">No hay gastos en este periodo.</p> : g.porTipo.map((t) => (
                  <div className="exrow" key={t.tipo}>
                    <span className="rn">
                      <b>{t.tipo}</b>
                      <small>{t.cuantos === 1 ? "Un gasto" : `${t.cuantos} gastos`}{t.cuenta ? "" : " · no se resta en la ganancia"}</small>
                    </span>
                    <span className="ri">{pesos(t.total)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <header><h2>Los gastos</h2><small>{g.gastos.length === 1 ? "Uno" : g.gastos.length}</small></header>
              <div className="pad">
                {g.gastos.length === 0 ? <p className="empty">No hay gastos en este periodo.</p> : g.gastos.map((x) => (
                  <div className="exrow" key={x.id} data-anulado={x.anulado ? "" : undefined}>
                    <span className="rn">
                      <b>{x.concepto}</b>
                      <small>
                        {fechaCorta(x.fecha)} · {x.tipo} · {x.deDonde === "cajon" ? "del cajón" : "de otro lado"} · lo registró {x.registro}
                      </small>
                      {x.anulado ? <small className="anulado">Anulado el {fechaCorta(x.anulado.fecha)} por {x.anulado.por}: {x.anulado.motivo}</small>
                        : escribe ? <Anular gasto={x} alAnular={listo} /> : null}
                    </span>
                    <span className="ri">{x.anulado ? <s>{pesos(x.importe)}</s> : pesos(x.importe)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {escribe ? <TiposDeGasto tipos={g.tipos} alCambiar={cargar} /> : null}
        </>
      )}
    </div>
  );
}
