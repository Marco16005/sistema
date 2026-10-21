"use client";
// El cajón de un día, y sacar o meter dinero de él.
//
// Lo que se ve lo hace el servidor (cuánto entró, salió y debería haber); aquí no se suma nada.
// Sacar y meter son envíos con la clave de un responsable: como reabrir el día, lo que salió y no
// se supo si llegó se queda guardado en esta pestaña hasta saberlo, y mientras tanto solo se puede
// mandar ese mismo, con la clave de esa misma persona.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Autorizar } from "../Autorizar.tsx";
import type { QuienAutoriza } from "../Autorizar.tsx";
import { cancelarEnvio, identificador, pedir } from "../cliente.ts";
import { pesos } from "../formato.ts";
import { enviar, useAccion } from "../inventario/piezas.tsx";
import type { Pendiente } from "../inventario/piezas.tsx";
import { Teclado, Visor } from "../Teclado.tsx";
import { comoPesos, pesosListos } from "./tipos.ts";
import type { Cajon } from "./tipos.ts";

/** Lo que dice una diferencia de corte: cuadró, faltó o sobró. */
export function queTanCuadro(diferencia: string): string {
  const d = Number(diferencia);
  if (d === 0) return "Cuadró";
  return `${d < 0 ? "Faltaron" : "Sobraron"} ${pesos(String(Math.abs(d).toFixed(2)))}`;
}

const conSigno = (t: string, signo: "+" | "−"): string => `${signo}${pesos(t)}`;

/** Con cuánto se abrió, lo que entró y salió en efectivo, lo metido y sacado, y cuánto debería haber. */
export function ResumenDelCajon({ cajon, children }: { cajon: Cajon; children?: ReactNode }) {
  const a = cajon.apertura;
  return (
    <div className="card">
      <header>
        <h2>El cajón</h2>
        <small>{a ? `Se contó al abrir: ${a.conto}, ${a.hora}` : "No se contó al abrir"}</small>
      </header>
      <div className="pad">
        {!a ? <p className="note" style={{ marginTop: 0 }}>Sin el conteo de la mañana no se sabe cuánto debería haber.</p> : (
          <>
            <div className="tot"><span>Al abrir</span><span className="n">{pesos(a.contado)}</span></div>
            {a.anterior !== null && Number(a.anterior) !== Number(a.contado) ? (
              <div className="tot adj"><span>En el último corte se dejaron</span><span className="n">{pesos(a.anterior)}</span></div>
            ) : null}
            <div className="tot"><span>Cobrado en efectivo</span><span className="n">{conSigno(cajon.efectivo.cobrado, "+")}</span></div>
            <div className="tot"><span>Pagado en efectivo</span><span className="n">{conSigno(cajon.efectivo.pagado, "−")}</span></div>
            {Number(cajon.metido) > 0 ? <div className="tot"><span>Metido al cajón</span><span className="n">{conSigno(cajon.metido, "+")}</span></div> : null}
            {Number(cajon.sacado) > 0 ? <div className="tot"><span>Sacado del cajón</span><span className="n">{conSigno(cajon.sacado, "−")}</span></div> : null}
            {Number(cajon.abonos) > 0 ? <div className="tot"><span>Abonos de lo fiado</span><span className="n">{conSigno(cajon.abonos, "+")}</span></div> : null}
            {Number(cajon.correcciones) !== 0 ? (
              <div className="tot">
                <span>Correcciones de cuentas cobradas</span>
                <span className="n">{conSigno(String(Math.abs(Number(cajon.correcciones)).toFixed(2)), Number(cajon.correcciones) > 0 ? "+" : "−")}</span>
              </div>
            ) : null}
            {Number(cajon.retiradoAntes) > 0 ? (
              <div className="tot"><span>Retirado en el corte anterior</span><span className="n">{conSigno(cajon.retiradoAntes, "−")}</span></div>
            ) : null}
            {cajon.esperado !== null ? (
              <div className="tot big"><span>Debería haber</span><span className="n">{pesos(cajon.esperado)}</span></div>
            ) : null}
          </>
        )}
        {Number(cajon.fiado) > 0 ? <p className="note">Se fiaron {pesos(cajon.fiado)}: no pasan por el cajón hasta que el cliente abone.</p> : null}
        {Number(cajon.transferencia.cobrado) + Number(cajon.transferencia.pagado) > 0 ? (
          <p className="note">
            Por transferencia, que no pasa por el cajón:
            {Number(cajon.transferencia.cobrado) > 0 ? ` cobrado ${pesos(cajon.transferencia.cobrado)}` : ""}
            {Number(cajon.transferencia.cobrado) > 0 && Number(cajon.transferencia.pagado) > 0 ? " ·" : ""}
            {Number(cajon.transferencia.pagado) > 0 ? ` pagado ${pesos(cajon.transferencia.pagado)}` : ""}.
          </p>
        ) : null}

        {cajon.movimientos.length > 0 ? (
          <>
            <p className="lbl" style={{ marginTop: 16 }}>Lo que se sacó y se metió</p>
            {cajon.movimientos.map((m) => (
              <div className="ren" key={m.id}>
                <div className="rn">
                  <b>{m.motivo}</b>
                  <small>{m.tipo === "sacar" ? "Se sacó" : "Se metió"} a las {m.hora} · lo registró {m.registro} · autorizó {m.autorizo}</small>
                </div>
                <div className="ri">{conSigno(m.importe, m.tipo === "sacar" ? "−" : "+")}</div>
              </div>
            ))}
          </>
        ) : null}

        {cajon.cortes.map((c) => (
          <div key={c.cierre} className={Number(c.diferencia) === 0 ? "queda" : "flag"} role="status">
            <b>Corte{cajon.cortes.length > 1 ? ` ${c.cierre}` : ""}, a las {c.hora}: {queTanCuadro(c.diferencia)}.</b>{" "}
            Debía haber {pesos(c.esperado)} y se contaron {pesos(c.contado)}. Se dejaron {pesos(c.seQueda)} para el día siguiente
            {Number(c.retirado) > 0 ? ` y se retiraron ${pesos(c.retirado)}` : ""}. Lo firmó {c.hizo}.
          </div>
        ))}
        {children}
      </div>
    </div>
  );
}

type Movimiento = Pendiente<{ jornada: string; tipo: "sacar" | "meter"; importe: string; motivo: string; autoriza: string }> & { quien: QuienAutoriza };
const DONDE = "feruga.caja.movimiento";

function recordar(): Movimiento | null {
  try {
    return JSON.parse(sessionStorage.getItem(DONDE) ?? "null");
  } catch {
    return null;
  }
}

/**
 * Sacar o meter dinero: cuánto, para qué, y la clave de un responsable. `jornada` es la abierta;
 * `alCambiar` recibe el cajón como quedó.
 */
export function MoverDinero({ jornada, alCambiar }: { jornada: string; alCambiar: (cajon: Cajon, mensaje: string) => void }) {
  const [pendiente, setPendiente] = useState<Movimiento | null>(recordar);
  const actual = useRef(pendiente);
  const [tipo, setTipo] = useState<"sacar" | "meter" | null>(null);
  const [importe, setImporte] = useState("");
  const [motivo, setMotivo] = useState("");
  const [autorizando, setAutorizando] = useState(false);
  const [responsables, setResponsables] = useState<QuienAutoriza[] | null>(null);
  const { ocupado, aviso, setAviso, hacer } = useAccion();

  const fijar = (v: Movimiento | null): void => {
    actual.current = v;
    try {
      if (v) sessionStorage.setItem(DONDE, JSON.stringify(v));
      else sessionStorage.removeItem(DONDE);
    } catch {
      // Sin dónde guardar, sigue; solo no sobrevive a una recarga.
    }
    setPendiente(v);
  };

  const enAutorizar = autorizando || pendiente !== null;
  useEffect(() => {
    if (!enAutorizar) return;
    pedir<{ personas: Array<QuienAutoriza & { rol: string }> }>("GET", "/api/personas")
      .then((r) => setResponsables(r.personas.filter((x) => x.rol === "responsable")))
      .catch(() => setResponsables([]));
  }, [enAutorizar]);

  const terminar = (cajon: Cajon, que: Movimiento["cuerpo"]): void => {
    fijar(null);
    setAutorizando(false);
    setTipo(null);
    setImporte("");
    setMotivo("");
    alCambiar(cajon, `${que.tipo === "sacar" ? "Se sacaron" : "Se metieron"} ${pesos(que.importe)}: ${que.motivo}.`);
  };

  const mandar = (quien: QuienAutoriza, clave: string): Promise<void> =>
    hacer(async () => {
      const r = await enviar<{ cajon: Cajon }, Movimiento>(
        "/api/caja/movimientos", actual.current,
        () => ({ id: identificador(), quien, cuerpo: { jornada, tipo: tipo!, importe: comoPesos(importe), motivo: motivo.trim(), autoriza: quien.id } }),
        fijar, { clave },
      );
      if (r) terminar(r.cajon, actual.current!.cuerpo);
    });

  /** Que autorice otra persona un movimiento del que no se supo: primero se resuelve ese envío. */
  const soltar = (): Promise<void> =>
    hacer(async () => {
      const p = actual.current;
      if (!p) return;
      if ((await cancelarEnvio(p.id)) === "entro") {
        const cajon = (await pedir<{ cajon: Cajon }>("GET", `/api/caja?jornada=${p.cuerpo.jornada}`)).cajon;
        terminar(cajon, p.cuerpo);
        return;
      }
      fijar(null);
    });

  if (enAutorizar) {
    const que = pendiente?.cuerpo ?? { tipo: tipo!, importe: comoPesos(importe), motivo: motivo.trim() };
    return (
      <Autorizar
        titulo={que.tipo === "sacar" ? "Sacar dinero del cajón" : "Meter dinero al cajón"}
        explicacion={pendiente && !ocupado
          ? "No se supo si quedó registrado. Teclea la clave otra vez: si ya había entrado, no se registra dos veces."
          : `${pesos(que.importe)} · ${que.motivo}. Lo autoriza un responsable con su clave.`}
        personas={responsables} quien={pendiente?.quien} alSoltar={soltar}
        boton={(nombre) => `Autorizar a nombre de ${nombre}`} cancelar="No hacerlo"
        aviso={aviso} ocupado={ocupado} alAutorizar={mandar}
        alCancelar={() => { if (!actual.current) { setAviso(""); setAutorizando(false); } }}
      />
    );
  }

  if (tipo === null) {
    return (
      <div className="dos">
        <button className="btn ghostbtn chico" type="button" onClick={() => setTipo("sacar")}>Sacar dinero</button>
        <button className="btn ghostbtn chico" type="button" onClick={() => setTipo("meter")}>Meter dinero</button>
      </div>
    );
  }

  const listo = pesosListos(importe) && Number(comoPesos(importe)) > 0 && motivo.trim() !== "";
  return (
    <div className="manual">
      <p className="lbl">{tipo === "sacar" ? "¿Cuánto se saca?" : "¿Cuánto se mete?"}</p>
      <Visor nombre={tipo === "sacar" ? "Sale del cajón" : "Entra al cajón"} valor={importe} unidad="pesos" leyenda={`Cantidad tecleada: ${importe || "nada"} pesos`} />
      <Teclado valor={importe} alCambiar={setImporte} decimales={2} enteros={8} />
      <label>
        <span className="lbl" style={{ display: "block", marginTop: 16 }}>¿Para qué?</span>
        <input
          className="campo" type="text" value={motivo} maxLength={200} autoComplete="off" enterKeyHint="done"
          placeholder={tipo === "sacar" ? "La tienda, gasolina, un mandado…" : "El dueño metió para pagar…"} onChange={(e) => setMotivo(e.target.value)}
        />
      </label>
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      <button className="btn" type="button" disabled={!listo} onClick={() => { setAviso(""); setAutorizando(true); }}>Pedir la clave de un responsable</button>
      <button className="btn ghostbtn chico" type="button" onClick={() => { setTipo(null); setImporte(""); setMotivo(""); }}>No hacerlo</button>
    </div>
  );
}
