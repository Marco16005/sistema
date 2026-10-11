"use client";
// El cierre del día: lo que falta por terminar, lo que entró y salió, y cuánto hay que pagar y
// cobrar. También desde aquí se busca un comprobante por su folio, y se reabre el día de hoy si se
// cerró por error.
//
// Cerrar y reabrir dicen qué vieron: cuál jornada, y cuántos cierres llevaba o cuál cierre era. Y
// los dos son envíos, con la misma regla que los de inventario: lo que salió y no se supo si llegó
// se queda guardado en esta pestaña hasta saberlo, y mientras tanto solo se puede mandar ese mismo.
import { useCallback, useEffect, useRef, useState } from "react";
import { Autorizar } from "../../componentes/Autorizar.tsx";
import type { QuienAutoriza } from "../../componentes/Autorizar.tsx";
import { ErrorDeApi, cancelarEnvio, identificador, pedir } from "../../componentes/cliente.ts";
import { ajuste, cuantosMateriales, fechaCorta, kilos, pesos, pesosCerrados, precio } from "../../componentes/formato.ts";
import { Incierto, enviar, useAccion } from "../../componentes/inventario/piezas.tsx";
import type { Pendiente as Envio } from "../../componentes/inventario/piezas.tsx";
import { Ticket } from "../../componentes/mostrador/Ticket.tsx";
import { nombreDe, segundaPesada } from "../../componentes/mostrador/tipos.ts";
import type { Comprobante, Tipo } from "../../componentes/mostrador/tipos.ts";
import { COBRAN, LoQueFalta, useSesion } from "../../componentes/Sesion.tsx";
import type { Dia } from "../../componentes/Sesion.tsx";
import { SoloEnSuPestana } from "../../componentes/SoloEnSuPestana.tsx";
import { soltoLoHeredado } from "../../componentes/pestana.ts";

interface Pendiente {
  id: string;
  tipo: Tipo;
  etiqueta: string | null;
  materiales: number;
}

interface PrecioDado {
  folio: string;
  cliente: string;
  material: string;
  kg: string;
  precioDeLista: string;
  precio: string;
  diferencia: string;
  autorizo: string;
}

/** Una diferencia en dinero, con su signo a la vista: «+$50.00», «−$50.00». */
const conSigno = (t: string): string => (Number(t) < 0 ? "−" : "+") + pesos(String(Math.abs(Number(t)).toFixed(2)));
/** Lo que una diferencia quiere decir: en una compra, positiva es que se pagó de más; en una venta, que se cobró de más. */
const significado = (compra: boolean, t: string): string =>
  Number(t) === 0 ? (compra ? "En compras, sin diferencia" : "En ventas, sin diferencia")
    : compra ? `En compras se pagó de ${Number(t) > 0 ? "más" : "menos"}` : `En ventas se cobró de ${Number(t) > 0 ? "más" : "menos"}`;

interface Cierre {
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

/** Lo que salió de esta pantalla y todavía no se sabe si llegó. Sobrevive a una recarga; la clave no se guarda. */
interface AMedias {
  cierre: Envio<{ jornada: string; cierres: number }> | null;
  reapertura: (Envio<{ jornada: string; cierre: number; autoriza: string }> & { quien: QuienAutoriza }) | null;
}

const DONDE = "feruga.cierre";

function recordar(): AMedias {
  try {
    const v = JSON.parse(sessionStorage.getItem(DONDE) ?? "null");
    if (v && typeof v === "object") return { cierre: v.cierre ?? null, reapertura: v.reapertura ?? null };
  } catch {
    // Sin memoria no hay nada a medias.
  }
  return { cierre: null, reapertura: null };
}

/** Lo guardado se lee hasta saber que esta pestaña no es copia de otra: una copia no se queda con el envío a medias. */
export default function PantallaDeCierre() {
  return <SoloEnSuPestana><Pantalla /></SoloEnSuPestana>;
}

function Pantalla() {
  const { persona, dia, ponerDia } = useSesion();
  const [cierre, setCierre] = useState<Cierre | null | undefined>(undefined);
  const [aMedias, setAMedias] = useState<AMedias>(recordar);
  const actual = useRef(aMedias);
  const { ocupado, aviso, setAviso, hacer } = useAccion();
  const [nota, setNota] = useState(() =>
    soltoLoHeredado("cierre") ? "Había un cierre o una reapertura a medias: sigue en la otra pestaña, donde se empezó." : "");
  const [porCerrar, setPorCerrar] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  const [quienes, setQuienes] = useState<QuienAutoriza[] | null>(null);
  const [folio, setFolio] = useState("");
  const [encontrado, setEncontrado] = useState<{ comprobante: Comprobante; negocio: string } | null>(null);
  const [avisoDeFolio, setAvisoDeFolio] = useState("");

  const fijar = (cambio: Partial<AMedias>): void => {
    const v = { ...actual.current, ...cambio };
    actual.current = v;
    try {
      sessionStorage.setItem(DONDE, JSON.stringify(v));
    } catch {
      // Sin dónde guardar, la pantalla sigue; solo no sobrevive a una recarga.
    }
    setAMedias(v);
  };

  const cargar = useCallback(() => {
    pedir<{ cierre: Cierre | null }>("GET", "/api/cierre").then((r) => setCierre(r.cierre)).catch((e: Error) => setAviso(e.message));
  }, [setAviso]);
  useEffect(cargar, [cargar, dia.jornada?.id, dia.jornada?.cierres, dia.cerradaHoy?.cierre]);

  /** Vuelve a ver cómo está el día: lo que se tenía a la vista ya cambió. Devuelve cómo está, si se pudo saber. */
  const verDeNuevo = async (): Promise<Dia | null> => {
    let visto: Dia | null = null;
    try {
      visto = (await pedir<{ dia: Dia }>("GET", "/api/dia")).dia;
      ponerDia(visto);
    } catch {
      // Se queda lo que había; el aviso del rechazo ya dice qué pasó.
    }
    cargar();
    return visto;
  };

  // Una reapertura que sí había entrado se resuelve con lo que hizo ENTONCES. Lo que la pantalla
  // dice del día sale de cómo está AHORA: entre tanto pudo volver a cerrarse.
  const reaperturaResuelta = (ahora: Dia | null, recien: boolean): string => {
    if (!ahora) return "Esa reapertura ya había quedado registrada.";
    if (!ahora.jornada) return "Esa reapertura ya había quedado registrada, y después el día se volvió a cerrar. Sigue cerrado.";
    return recien
      ? "El día quedó abierto otra vez. Quedó registro de quién lo autorizó."
      : "Esa reapertura ya había quedado registrada: el día está abierto otra vez.";
  };

  // Quiénes pueden autorizar: se pide al llegar a ese paso, y otra vez cuando un envío se suelta.
  const reapertura = aMedias.reapertura;
  const hayReapertura = Boolean(reapertura);
  const enAutorizar = autorizando || hayReapertura;
  useEffect(() => {
    if (!enAutorizar) return;
    pedir<{ personas: QuienAutoriza[] }>("GET", "/api/inventario/autorizan").then((r) => setQuienes(r.personas)).catch(() => setQuienes([]));
  }, [enAutorizar, hayReapertura]);

  const cerrar = (): Promise<void> =>
    hacer(async () => {
      setPorCerrar(false);
      setNota("");
      const pendiente = actual.current.cierre;
      if (!pendiente && !cierre) return;
      try {
        const r = await enviar<{ cierre: Cierre & { cierre: number }; dia: Dia }, NonNullable<AMedias["cierre"]>>(
          "/api/jornada/cerrar", pendiente,
          () => ({ id: identificador(), cuerpo: { jornada: cierre!.jornada.id, cierres: cierre!.jornada.cierres } }),
          (queda) => fijar({ cierre: queda }),
        );
        if (!r) return;                                          // no se supo: se queda guardado
        fijar({ cierre: null });
        setCierre(r.cierre);
        ponerDia(r.dia);
        // Un reintento de un cierre que sí había entrado, y entre tanto alguien reabrió: no se cierra otra vez.
        if (r.cierre.jornada.abierta) setNota("Ese cierre ya había quedado registrado, y después el día se reabrió. Sigue abierto.");
      } catch (e) {
        await verDeNuevo();
        throw e;
      }
    });

  const queReabrir = reapertura
    ? { id: reapertura.cuerpo.jornada, cierre: reapertura.cuerpo.cierre }
    : dia.cerradaHoy;

  /** Que autorice otra persona una reapertura de la que no se supo: primero se resuelve ese envío. */
  const soltar = (): Promise<void> =>
    hacer(async () => {
      if (!reapertura) return;
      if ((await cancelarEnvio(reapertura.id)) === "entro") {
        fijar({ reapertura: null });
        setAutorizando(false);
        setNota(reaperturaResuelta(await verDeNuevo(), false));
      } else {
        fijar({ reapertura: null });
      }
    });

  const reabrir = (quien: QuienAutoriza, clave: string): Promise<void> =>
    hacer(async () => {
      setNota("");
      const pendiente = actual.current.reapertura;
      if (!pendiente && !queReabrir) return;
      let suelto = false;
      try {
        const r = await enviar<{ dia: Dia }, NonNullable<AMedias["reapertura"]>>(
          "/api/jornada/reabrir", pendiente,
          () => ({ id: identificador(), quien, cuerpo: { jornada: queReabrir!.id, cierre: queReabrir!.cierre, autoriza: quien.id } }),
          (queda) => { suelto = queda === null; fijar({ reapertura: queda }); }, { clave },
        );
        if (!r) return;                                          // no se supo: se queda guardado
        fijar({ reapertura: null });
        setAutorizando(false);
        ponerDia(r.dia);
        setNota(reaperturaResuelta(r.dia, true));
        cargar();
      } catch (e) {
        // Una clave que no pasó se vuelve a intentar aquí mismo. Cualquier otra regla habla del día:
        // ya no es hoy, o ese cierre ya no es el vigente. Se sale a verlo como está.
        if (e instanceof ErrorDeApi && e.codigo !== "CLAVE" && suelto) {
          setAutorizando(false);
          await verDeNuevo();
        }
        throw e;
      }
    });

  const buscar = async (): Promise<void> => {
    setAvisoDeFolio("");
    setEncontrado(null);
    try {
      setEncontrado(await pedir("GET", `/api/comprobantes?folio=${encodeURIComponent(folio.trim())}`));
    } catch (e) {
      setAvisoDeFolio((e as Error).message);
    }
  };

  if (cierre === undefined) return aviso ? <div className="flag" role="alert">{aviso}</div> : <p className="cargando">Un momento…</p>;
  const puedeCerrar = COBRAN.includes(persona.rol);
  const puedeBuscar = persona.rol !== "patio" && persona.rol !== "administracion";
  const cierrePendiente = aMedias.cierre !== null;

  if (enAutorizar && puedeCerrar) {
    return (
      <div className="angosto" style={{ margin: "0 auto" }}>
        <Autorizar
          titulo="Reabrir el día"
          explicacion={reapertura && !ocupado
            ? "No se supo si el día se reabrió. Teclea la clave otra vez: si ya había entrado, no se reabre dos veces."
            : "El día de hoy se cerró. Al reabrirlo vuelve a ser la misma jornada, con sus precios y sus cuentas, y queda registro de quién lo autorizó."}
          personas={quienes} quien={reapertura?.quien} alSoltar={soltar} boton={(nombre) => `Reabrir a nombre de ${nombre}`} cancelar="No reabrir"
          aviso={aviso} ocupado={ocupado} alAutorizar={reabrir}
          alCancelar={() => { if (!reapertura) { setAviso(""); setAutorizando(false); } }}
        />
        {reapertura ? <p className="note">Hay una reapertura de la que no se supo: se resuelve antes de salir de aquí.</p> : null}
      </div>
    );
  }

  return (
    <div className="angosto" style={{ margin: "0 auto" }}>
      {!dia.jornada && !dia.cerradaHoy ? <LoQueFalta para="precios" /> : null}
      {nota ? <div className="okmsg" role="status">{nota}</div> : null}

      {/* Con un cierre del que no se supo, primero se resuelve ese: después se ofrece reabrir. */}
      {dia.cerradaHoy && !dia.jornada && !cierrePendiente ? (
        <div className="card">
          <header><h2>El día de hoy ya se cerró</h2><small>Cierre {dia.cerradaHoy.cierre}</small></header>
          <div className="pad">
            <p className="note" style={{ marginTop: 0 }}>
              {puedeCerrar
                ? "Si se cerró por error, se puede reabrir: vuelve a ser la misma jornada. Lo autoriza con su clave quien puede autorizar, y queda registro."
                : "Si se cerró por error, lo reabre quien atiende el mostrador o un responsable."}
            </p>
            {cierre === null || cierre.jornada.abierta ? null : aviso ? <div className="flag" role="alert">{aviso}</div> : null}
            {puedeCerrar
              ? <button className="btn" type="button" disabled={ocupado} onClick={() => { setAviso(""); setNota(""); setAutorizando(true); window.scrollTo(0, 0); }}>Reabrir el día</button>
              : null}
          </div>
        </div>
      ) : null}

      {cierre === null ? (
        <div className="card"><p className="empty">Todavía no hay ninguna jornada.</p></div>
      ) : (
        <>
          {cierre.jornada.abierta ? (
            <div className="card">
              <header><h2>Sin terminar</h2><small>Hay que resolverlo antes de cerrar</small></header>
              <div className="pad">
                {cierre.porTerminar.length === 0 ? <p className="empty">Nada pendiente en el mostrador.</p> : null}
                {cierre.porTerminar.map((c, k) => (
                  <div key={c.id} className="flag" style={k === 0 ? { marginTop: 0 } : undefined}>
                    <b>{nombreDe(c)}</b><br />
                    Cuenta abierta, {cuantosMateriales(c.materiales).toLowerCase()}. Se termina o se descarta.
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {cierre.vehiculosPorVolver.length > 0 ? (
            <div className="card">
              <header><h2>Vehículos por volver</h2><small>No impiden cerrar</small></header>
              <div className="pad">
                {cierre.vehiculosPorVolver.map((c) => (
                  <div className="ren" key={c.id}>
                    <div className="rn"><b>{nombreDe(c)}</b><small>Falta pesar {segundaPesada(c.tipo)}. Puede volver otro día: se paga al precio de hoy.</small></div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

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

          {cierre.preciosEspeciales.compras.length + cierre.preciosEspeciales.ventas.length > 0 ? (
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
          ) : null}

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
              {cierrePendiente && puedeCerrar ? (
                <Incierto que="el cierre" ocupado={ocupado} aviso={aviso} alReintentar={() => void cerrar()} />
              ) : (
                <>
                  {aviso && (cierre.jornada.abierta || !dia.cerradaHoy) ? <div className="flag" role="alert">{aviso}</div> : null}
                  {cierre.jornada.abierta && puedeCerrar ? (
                    <button
                      className="btn" type="button" disabled={ocupado || cierre.porTerminar.length > 0}
                      onClick={() => (porCerrar ? void cerrar() : setPorCerrar(true))}
                    >
                      {porCerrar ? "Toca otra vez para cerrar el día" : "Cerrar el día"}
                    </button>
                  ) : null}
                  {cierre.jornada.abierta && cierre.porTerminar.length > 0 ? <p className="note">Para cerrar, primero termina o descarta las cuentas abiertas.</p> : null}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {puedeBuscar ? (
        <div className="card">
          <header><h2>Buscar un comprobante</h2><small>Por su folio</small></header>
          <form className="pad" onSubmit={(e) => { e.preventDefault(); void buscar(); }}>
            <div className="mrow">
              <input className="campo" style={{ flex: "1 1 130px" }} inputMode="numeric" aria-label="Folio" placeholder="Folio" value={folio} onChange={(e) => setFolio(e.target.value)} />
              <button className="btn" type="submit" disabled={!/^\d+$/.test(folio.trim())}>Buscar</button>
            </div>
            {avisoDeFolio ? <div className="flag" role="alert">{avisoDeFolio}</div> : null}
          </form>
        </div>
      ) : null}
      {encontrado ? (
        <Ticket
          key={encontrado.comprobante.id} comprobante={encontrado.comprobante} negocio={encontrado.negocio} impresion={null}
          puedeImprimir={puedeCerrar} alTerminar={() => setEncontrado(null)}
        />
      ) : null}
    </div>
  );
}
