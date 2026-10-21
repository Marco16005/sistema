"use client";
// El cierre del día: lo que falta por terminar, el cajón —lo que se sacó y se metió, cuánto debería
// haber— y el corte con que se cierra; lo que entró y salió, y cuánto hay que pagar y cobrar.
// También desde aquí se busca un comprobante por su folio, y se reabre el día de hoy si se cerró
// por error.
//
// Cerrar es hacer el corte: se cuenta el cajón, se dice cuánto se queda para mañana, y lo firma con
// su clave quien tiene permiso de corte. Cerrar y reabrir dicen qué vieron: cuál jornada, y cuántos
// cierres llevaba o cuál cierre era. Y los dos son envíos, con la misma regla que los de
// inventario: lo que salió y no se supo si llegó se queda guardado en esta pestaña hasta saberlo, y
// mientras tanto solo se puede mandar ese mismo, con la clave de la misma persona.
import { useCallback, useEffect, useRef, useState } from "react";
import { Autorizar } from "../../componentes/Autorizar.tsx";
import type { QuienAutoriza } from "../../componentes/Autorizar.tsx";
import { ErrorDeApi, cancelarEnvio, identificador, pedir } from "../../componentes/cliente.ts";
import { Abonar } from "../../componentes/caja/Abonar.tsx";
import { ContarElCajon } from "../../componentes/caja/ContarElCajon.tsx";
import { MoverDinero, ResumenDelCajon, queTanCuadro } from "../../componentes/caja/ElCajon.tsx";
import { centavos, comoPesos, pesosListos } from "../../componentes/caja/tipos.ts";
import { Correcciones } from "../../componentes/cierre/Correcciones.tsx";
import { Dinero, Kilos, PreciosEspeciales } from "../../componentes/cierre/Reporte.tsx";
import type { Cierre } from "../../componentes/cierre/Reporte.tsx";
import { cuantosMateriales, pesos } from "../../componentes/formato.ts";
import { enviar, useAccion } from "../../componentes/inventario/piezas.tsx";
import type { Pendiente as Envio } from "../../componentes/inventario/piezas.tsx";
import { Ticket } from "../../componentes/mostrador/Ticket.tsx";
import { nombreDe, segundaPesada } from "../../componentes/mostrador/tipos.ts";
import type { Comprobante } from "../../componentes/mostrador/tipos.ts";
import { COBRAN, LoQueFalta, useSesion } from "../../componentes/Sesion.tsx";
import type { Dia } from "../../componentes/Sesion.tsx";
import { SoloEnSuPestana } from "../../componentes/SoloEnSuPestana.tsx";
import { Teclado, Visor } from "../../componentes/Teclado.tsx";
import { soltoLoHeredado } from "../../componentes/pestana.ts";

/** Lo que salió de esta pantalla y todavía no se sabe si llegó. Sobrevive a una recarga; la clave no se guarda. */
interface AMedias {
  cierre: (Envio<{ jornada: string; cierres: number; contado: string; seQueda: string; hace: string }> & { quien: QuienAutoriza }) | null;
  reapertura: (Envio<{ jornada: string; cierre: number; autoriza: string }> & { quien: QuienAutoriza }) | null;
}

const DONDE = "feruga.cierre";

function recordar(): AMedias {
  try {
    const v = JSON.parse(sessionStorage.getItem(DONDE) ?? "null");
    // Un cierre guardado por una versión anterior de la pantalla no traía el corte: no se puede reintentar.
    if (v && typeof v === "object") return { cierre: v.cierre?.quien ? v.cierre : null, reapertura: v.reapertura ?? null };
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
  /** El corte a medio hacer: lo que se contó, lo que se queda, y en qué va. */
  const [corte, setCorte] = useState<{ paso: "contar" | "dejar" | "firmar"; contado: string; seQueda: string } | null>(null);
  const [firman, setFirman] = useState<QuienAutoriza[] | null>(null);
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

  // Quiénes pueden firmar el corte: los responsables, y quien de mostrador tenga el permiso.
  const cierrePorFirmar = aMedias.cierre;
  const enFirmar = corte?.paso === "firmar" || cierrePorFirmar !== null;
  useEffect(() => {
    if (!enFirmar) return;
    pedir<{ personas: Array<QuienAutoriza & { rol: string; haceCorte: boolean }> }>("GET", "/api/personas")
      .then((r) => setFirman(r.personas.filter((x) => x.haceCorte).map((x) => ({ id: x.id, nombre: x.nombre, digitos: x.rol === "responsable" ? 6 : 4 }))))
      .catch(() => setFirman([]));
  }, [enFirmar]);

  const cerrar = (quien: QuienAutoriza, clave: string): Promise<void> =>
    hacer(async () => {
      setNota("");
      const pendiente = actual.current.cierre;
      if (!pendiente && (!cierre || !corte)) return;
      let suelto = false;
      try {
        const r = await enviar<{ cierre: Cierre & { cierre: number }; dia: Dia }, NonNullable<AMedias["cierre"]>>(
          "/api/jornada/cerrar", pendiente,
          () => ({
            id: identificador(), quien,
            cuerpo: { jornada: cierre!.jornada.id, cierres: cierre!.jornada.cierres, contado: comoPesos(corte!.contado), seQueda: comoPesos(corte!.seQueda), hace: quien.id },
          }),
          (queda) => { suelto = queda === null; fijar({ cierre: queda }); }, { clave },
        );
        if (!r) return;                                          // no se supo: se queda guardado
        fijar({ cierre: null });
        setCorte(null);
        setCierre(r.cierre);
        ponerDia(r.dia);
        // Un reintento de un cierre que sí había entrado, y entre tanto alguien reabrió: no se cierra otra vez.
        if (r.cierre.jornada.abierta) setNota("Ese cierre ya había quedado registrado, y después el día se reabrió. Sigue abierto.");
      } catch (e) {
        // Una clave que no pasó se vuelve a intentar aquí mismo. Cualquier otra regla habla del día:
        // se cerró o se reabrió, o le falta algo. Se sale a verlo como está.
        if (!(e instanceof ErrorDeApi && e.codigo === "CLAVE") && (suelto || !actual.current.cierre)) {
          setCorte(null);
          await verDeNuevo();
        }
        throw e;
      }
    });

  /** Que firme otra persona un cierre del que no se supo: primero se resuelve ese envío. */
  const soltarCierre = (): Promise<void> =>
    hacer(async () => {
      const p = actual.current.cierre;
      if (!p) return;
      fijar({ cierre: null });
      if ((await cancelarEnvio(p.id)) === "entro") {
        setCorte(null);
        setNota("Ese cierre ya había quedado registrado.");
        await verDeNuevo();
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

  if (enFirmar && puedeCerrar) {
    const que = cierrePorFirmar?.cuerpo ?? { contado: comoPesos(corte!.contado), seQueda: comoPesos(corte!.seQueda) };
    return (
      <div className="angosto" style={{ margin: "0 auto" }}>
        <Autorizar
          titulo="Firmar el corte y cerrar el día"
          explicacion={cierrePorFirmar && !ocupado
            ? "No se supo si el día se cerró. Teclea la clave otra vez: si ya había entrado, no se cierra dos veces."
            : `Se contaron ${pesos(que.contado)} y se quedan ${pesos(que.seQueda)} para mañana. Lo firma con su clave un responsable o quien tenga permiso de corte.`}
          personas={firman} quien={cierrePorFirmar?.quien} alSoltar={soltarCierre} verbo="firma el corte"
          boton={(nombre) => `Cerrar el día a nombre de ${nombre}`} cancelar="Regresar al corte"
          aviso={aviso} ocupado={ocupado} alAutorizar={cerrar}
          alCancelar={() => { if (!actual.current.cierre) { setAviso(""); setCorte({ ...corte!, paso: "dejar" }); } }}
        />
        {cierrePorFirmar ? <p className="note">Hay un cierre del que no se supo: se resuelve antes de salir de aquí.</p> : null}
      </div>
    );
  }

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
      {dia.cerradaHoy && !dia.jornada ? (
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

          {cierre.jornada.abierta && puedeCerrar && !cierre.cajon.apertura ? (
            <ContarElCajon jornada={cierre.jornada.id} sugerido={cierre.cajon.sugerido} alContar={(d) => { ponerDia(d); cargar(); }} />
          ) : null}
          <ResumenDelCajon cajon={cierre.cajon}>
            {cierre.jornada.abierta && puedeCerrar && cierre.cajon.apertura ? (
              corte ? (
                <Corte
                  esperado={cierre.cajon.esperado ?? "0"} fondo={cierre.cajon.apertura.contado} corte={corte} aviso={aviso}
                  alCambiar={setCorte} alCancelar={() => { setAviso(""); setCorte(null); }}
                />
              ) : (
                <>
                  <p className="lbl" style={{ marginTop: 16 }}>Dinero que no es de una cuenta</p>
                  <MoverDinero jornada={cierre.jornada.id} alCambiar={(_c, mensaje) => { setNota(mensaje); cargar(); }} />
                  <Abonar alAbonar={(mensaje) => { setNota(mensaje); cargar(); }} />
                  {aviso && !dia.cerradaHoy ? <div className="flag" role="alert">{aviso}</div> : null}
                  <button
                    className="btn" type="button" disabled={ocupado || cierre.porTerminar.length > 0}
                    onClick={() => { setAviso(""); setNota(""); setCorte({ paso: "contar", contado: "", seQueda: "" }); }}
                  >
                    Hacer el corte y cerrar el día
                  </button>
                  {cierre.porTerminar.length > 0 ? <p className="note">Para cerrar, primero termina o descarta las cuentas abiertas.</p> : null}
                </>
              )
            ) : null}
          </ResumenDelCajon>
          <Kilos cierre={cierre} />
          <PreciosEspeciales cierre={cierre} />
          <Dinero cierre={cierre} />
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
      {encontrado ? (
        // Lo ya cobrado se corrige aquí: se liquida solo la diferencia, con la clave de quien autoriza.
        <Correcciones key={encontrado.comprobante.id} operacion={encontrado.comprobante.id} puedeCorregir={puedeCerrar && dia.jornada !== null} alCorregir={cargar} />
      ) : null}
    </div>
  );
}

/**
 * El corte, antes de firmarlo: cuánto hay en el cajón —y si cuadra con lo que debería haber— y
 * cuánto se queda para mañana. Lo demás se lo lleva quien hace el corte.
 */
function Corte(p: {
  esperado: string; fondo: string; aviso: string;
  corte: { paso: "contar" | "dejar" | "firmar"; contado: string; seQueda: string };
  alCambiar: (corte: { paso: "contar" | "dejar" | "firmar"; contado: string; seQueda: string }) => void;
  alCancelar: () => void;
}) {
  const { corte } = p;
  if (corte.paso === "contar") {
    const listo = pesosListos(corte.contado) && corte.contado !== "";
    const diferencia = ((centavos(corte.contado) - centavos(p.esperado)) / 100).toFixed(2);
    // Lo que se propone dejar: el fondo con que se abrió hoy, si alcanza.
    const sugerido = (Math.min(centavos(corte.contado), centavos(p.fondo)) / 100).toFixed(2);
    return (
      <div className="manual">
        <p className="lbl">¿Cuánto hay en el cajón?</p>
        <Visor nombre="Contado" nota={`Debería haber ${pesos(p.esperado)}.`} valor={corte.contado} unidad="pesos" leyenda={`Dinero contado: ${corte.contado || "nada"} pesos`} />
        <Teclado
          valor={corte.contado} alCambiar={(contado) => p.alCambiar({ ...corte, contado })} decimales={2} enteros={8}
          alTerminar={() => { if (listo) p.alCambiar({ paso: "dejar", contado: corte.contado, seQueda: sugerido }); }}
        />
        {listo ? (
          <p className={Number(diferencia) === 0 ? "queda" : "flag"} role="status">
            <b>{queTanCuadro(diferencia)}.</b> {Number(diferencia) === 0 ? "" : "El día se puede cerrar igual: la diferencia queda anotada y se le avisa al responsable."}
          </p>
        ) : null}
        <button className="btn" type="button" disabled={!listo} onClick={() => p.alCambiar({ paso: "dejar", contado: corte.contado, seQueda: sugerido })}>Seguir</button>
        <button className="btn ghostbtn chico" type="button" onClick={p.alCancelar}>No cerrar todavía</button>
      </div>
    );
  }
  const listo = pesosListos(corte.seQueda) && corte.seQueda !== "" && centavos(corte.seQueda) <= centavos(corte.contado);
  const retira = ((centavos(corte.contado) - centavos(corte.seQueda)) / 100).toFixed(2);
  return (
    <div className="manual">
      <p className="lbl">¿Cuánto se queda en el cajón para mañana?</p>
      <Visor nombre="Se queda" nota={`Se contaron ${pesos(comoPesos(corte.contado))}.`} valor={corte.seQueda} unidad="pesos" leyenda={`Se queda: ${corte.seQueda || "nada"} pesos`} />
      <Teclado valor={corte.seQueda} alCambiar={(seQueda) => p.alCambiar({ ...corte, seQueda })} decimales={2} enteros={8} />
      <p className="queda" role="status">
        {listo ? <>Se lleva quien hace el corte: <b>{pesos(retira)}</b></> : "No puede quedarse más de lo que se contó."}
      </p>
      {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
      <button className="btn" type="button" disabled={!listo} onClick={() => p.alCambiar({ ...corte, paso: "firmar" })}>Firmar el corte</button>
      <button className="btn ghostbtn chico" type="button" onClick={() => p.alCambiar({ ...corte, paso: "contar" })}>Volver a contar</button>
    </div>
  );
}
