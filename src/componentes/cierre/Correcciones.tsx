"use client";
// Las correcciones de una cuenta ya cobrada (0040): se ven las que lleva y, quien cobra, corrige un
// material —los kilos que de verdad eran, o el material que de verdad era—. Se liquida solo la
// diferencia; el comprobante original no cambia. Lo autoriza con su clave una persona facultada.
//
// Corregir es un envío con clave: como reabrir el día, lo que salió y no se supo si llegó se queda
// guardado en esta pestaña hasta saberlo, y mientras tanto solo se puede mandar ese mismo. Hay un
// solo lugar para guardarlo: mientras haya una corrección sin saberse, no se empieza otra en
// ninguna cuenta (revisión de Codex del 21 de octubre).
import { useCallback, useEffect, useRef, useState } from "react";
import { Autorizar } from "../Autorizar.tsx";
import type { QuienAutoriza } from "../Autorizar.tsx";
import { cancelarEnvio, identificador, pedir } from "../cliente.ts";
import { fechaCorta, kilos, pesos } from "../formato.ts";
import { enviar, useAccion } from "../inventario/piezas.tsx";
import type { Pendiente } from "../inventario/piezas.tsx";
import type { Catalogo } from "../mostrador/tipos.ts";
import { Teclado, Visor } from "../Teclado.tsx";

type Liquidacion = "efectivo" | "transferencia" | "pendiente" | "credito";

interface Correccion {
  numero: number; materialAntes: string; materialDespues: string; kgAntes: string; kgDespues: string; precio: string;
  importeAntes: string; importeDespues: string; diferencia: string; liquidacion: Liquidacion; fecha: string; hora: string;
  motivo: string; autorizo: string; registro: string;
}
interface Renglon { linea: string; material: { id: number; nombre: string }; kg: string; precio: string; importe: string; correcciones: number }
interface Cuenta { id: string; folio: string; tipo: "compra" | "venta"; fecha: string; fiada: boolean; renglones: Renglon[]; correcciones: Correccion[] }

type Envio = Pendiente<{ linea: string; kg: string; material: number; vistas: number; liquidacion: Liquidacion; motivo: string; autoriza: string }>
  & { quien: QuienAutoriza; operacion: string; folio?: string };
const DONDE = "feruga.correccion";

/** Qué quiere decir una diferencia: quién le debe a quién. En una venta fiada, cuánto se fió de más o de menos. */
export function queSignifica(tipo: "compra" | "venta", diferencia: string, fiada = false): string {
  const d = Number(diferencia);
  const cuanto = pesos(String(Math.abs(d).toFixed(2)));
  if (d === 0) return "Sin diferencia de dinero";
  if (fiada) return d > 0 ? `Se fió de menos: ${cuanto}` : `Se fió de más: ${cuanto}`;
  if (tipo === "compra") return d > 0 ? `Se pagó de menos: falta pagarle ${cuanto}` : `Se pagó de más: el vendedor devuelve ${cuanto}`;
  return d > 0 ? `Se cobró de menos: el cliente debe ${cuanto}` : `Se cobró de más: se le devuelven ${cuanto}`;
}
const COMO: Record<Liquidacion, string> = { efectivo: "en efectivo", transferencia: "por transferencia", pendiente: "sin liquidar", credito: "a lo que debe el cliente" };
const BOTON: Record<Liquidacion, string> = { efectivo: "En efectivo, hoy", transferencia: "Por transferencia", pendiente: "No se liquidó", credito: "A lo que debe el cliente" };

function guardado(): Envio | null {
  try {
    return JSON.parse(sessionStorage.getItem(DONDE) ?? "null");
  } catch {
    return null;
  }
}
const recordar = (operacion: string): Envio | null => {
  const v = guardado();
  return v && v.operacion === operacion ? v : null;
};
/** La corrección de la que no se supo, si hay: de qué cuenta es, y su folio si se guardó. */
export function correccionPendiente(): { operacion: string; folio: string | null } | null {
  const v = guardado();
  return v ? { operacion: v.operacion, folio: v.folio ?? null } : null;
}

/** Lo que lleva corregido una cuenta y, si `puedeCorregir`, corregirla. `alCorregir` avisa que cambió (el cajón, si fue en efectivo). */
export function Correcciones({ operacion, puedeCorregir, alCorregir, alCambiarPendiente }: {
  operacion: string; puedeCorregir: boolean; alCorregir?: () => void;
  /** Cambió lo que queda sin saberse (se guardó una corrección incierta, o se resolvió): la pantalla lo vuelve a mirar. */
  alCambiarPendiente?: () => void;
}) {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [pendiente, setPendiente] = useState<Envio | null>(() => recordar(operacion));
  const actual = useRef(pendiente);
  const [corrigiendo, setCorrigiendo] = useState<{ linea: string; kg: string; material: number | null; liquidacion: Liquidacion | null; motivo: string } | null>(null);
  const [autorizando, setAutorizando] = useState(false);
  const [quienes, setQuienes] = useState<QuienAutoriza[] | null>(null);
  const [materiales, setMateriales] = useState<Array<{ id: number; nombre: string }> | null>(null);
  const [hecho, setHecho] = useState("");
  const { ocupado, aviso, setAviso, hacer } = useAccion();

  const traer = useCallback(() => {
    pedir<{ cuenta: Cuenta }>("GET", `/api/comprobantes/${operacion}/correcciones`).then((r) => setCuenta(r.cuenta)).catch((e: Error) => setAviso(e.message));
  }, [operacion, setAviso]);
  useEffect(traer, [traer]);

  const fijar = (v: Envio | null): void => {
    actual.current = v;
    try {
      if (v) sessionStorage.setItem(DONDE, JSON.stringify(v));
      else sessionStorage.removeItem(DONDE);
    } catch {
      // Sin dónde guardar, sigue; solo no sobrevive a una recarga.
    }
    setPendiente(v);
    alCambiarPendiente?.();
  };

  const enAutorizar = autorizando || pendiente !== null;
  useEffect(() => {
    if (!enAutorizar) return;
    pedir<{ personas: QuienAutoriza[] }>("GET", "/api/inventario/autorizan").then((r) => setQuienes(r.personas)).catch(() => setQuienes([]));
  }, [enAutorizar]);
  const tipo = cuenta?.tipo;
  useEffect(() => {
    if (!corrigiendo || corrigiendo.material === null || materiales || !tipo) return;
    pedir<Catalogo>("GET", `/api/catalogo?tipo=${tipo}`)
      .then((c) => setMateriales(c.familias.flatMap((f) => f.materiales).map((m) => ({ id: m.id, nombre: m.nombre }))))
      .catch(() => setMateriales([]));
  }, [corrigiendo, materiales, tipo]);

  const terminar = (quedo: Cuenta): void => {
    fijar(null);
    setAutorizando(false);
    setCorrigiendo(null);
    setCuenta(quedo);
    const ultima = quedo.correcciones.at(-1);
    setHecho(ultima ? `Corregido. ${queSignifica(quedo.tipo, ultima.diferencia, quedo.fiada)}, ${COMO[ultima.liquidacion]}.` : "Corregido.");
    alCorregir?.();
  };

  const mandar = (quien: QuienAutoriza, clave: string): Promise<void> =>
    hacer(async () => {
      const r = await enviar<{ cuenta: Cuenta }, Envio>(
        `/api/comprobantes/${operacion}/correcciones`, actual.current,
        () => {
          const c = corrigiendo!;
          const renglon = cuenta!.renglones.find((x) => x.linea === c.linea)!;
          return {
            id: identificador(), quien, operacion, folio: cuenta!.folio,
            cuerpo: { linea: c.linea, kg: c.kg.replace(/\.$/, ""), material: c.material ?? renglon.material.id, vistas: renglon.correcciones, liquidacion: c.liquidacion!, motivo: c.motivo.trim(), autoriza: quien.id },
          };
        },
        fijar, { clave },
      );
      if (r) terminar(r.cuenta);
    });

  // Primero se sabe qué pasó con ese envío, y solo entonces se suelta: si no se puede saber, se
  // queda guardado y con la misma persona.
  const soltar = (): Promise<void> =>
    hacer(async () => {
      const p = actual.current;
      if (!p) return;
      const resuelto = await cancelarEnvio(p.id);
      fijar(null);
      if (resuelto === "entro") {
        setHecho("Esa corrección ya había quedado registrada.");
        traer();
        alCorregir?.();
      }
    });

  if (!cuenta) return aviso ? <div className="flag" role="alert">{aviso}</div> : null;
  // Otra cuenta tiene una corrección de la que no se supo: esa se resuelve primero.
  const deOtra = pendiente === null ? correccionPendiente() : null;
  const otraSinSaber = deOtra !== null && deOtra.operacion !== operacion;

  if (enAutorizar && puedeCorregir) {
    const c = pendiente?.cuerpo ?? (corrigiendo ? { ...corrigiendo, kg: corrigiendo.kg } : null);
    const renglon = cuenta.renglones.find((x) => x.linea === c?.linea);
    return (
      <Autorizar
        titulo={`Corregir la cuenta ${cuenta.folio}`}
        explicacion={pendiente && !ocupado
          ? "No se supo si la corrección quedó registrada. Teclea la clave otra vez: si ya había entrado, no se registra dos veces."
          : `${renglon?.material.nombre ?? ""}: ${kilos(renglon?.kg ?? "0")} kg pasan a ${kilos((c?.kg ?? "0").replace(/\.$/, "") || "0")} kg. Lo autoriza una persona facultada.`}
        personas={quienes} quien={pendiente?.quien} alSoltar={soltar}
        boton={(nombre) => `Corregir a nombre de ${nombre}`} cancelar="Regresar"
        aviso={aviso} ocupado={ocupado} alAutorizar={mandar}
        alCancelar={() => { if (!actual.current) { setAviso(""); setAutorizando(false); } }}
      />
    );
  }

  const renglon = corrigiendo ? cuenta.renglones.find((x) => x.linea === corrigiendo.linea) ?? null : null;
  const kgListos = corrigiendo !== null && /^\d{1,6}(\.\d{1,3})?$/.test(corrigiendo.kg.replace(/\.$/, "")) && Number(corrigiendo.kg) > 0;
  const mismoMaterial = corrigiendo?.material === null || corrigiendo?.material === renglon?.material.id;
  // Con el mismo material la diferencia se sabe aquí (al precio que se cobró); con otro, la dice el sistema al guardar.
  const diferencia = renglon && kgListos && mismoMaterial
    ? (Math.round(Number(corrigiendo!.kg) * Number(renglon.precio) * 100) / 100 - Number(renglon.importe)).toFixed(2) : null;
  const listo = corrigiendo !== null && kgListos && corrigiendo.liquidacion !== null && corrigiendo.motivo.trim() !== ""
    && (!mismoMaterial || Number(corrigiendo.kg) !== Number(renglon?.kg));

  return (
    <div className="card">
      <header><h2>Correcciones</h2><small>Cuenta {cuenta.folio}, del {fechaCorta(cuenta.fecha)}</small></header>
      <div className="pad">
        {hecho ? <div className="okmsg" role="status">{hecho}</div> : null}
        {cuenta.correcciones.length === 0 ? <p className="note" style={{ marginTop: 0 }}>No lleva ninguna corrección.</p> : cuenta.correcciones.map((c) => (
          <div className="ren" key={c.numero + c.fecha + c.hora}>
            <div className="rn">
              <b>{c.materialAntes === c.materialDespues ? c.materialDespues : `${c.materialAntes} → ${c.materialDespues}`}: {kilos(c.kgAntes)} → {kilos(c.kgDespues)} kg</b>
              <small>{queSignifica(cuenta.tipo, c.diferencia, cuenta.fiada)}, {COMO[c.liquidacion]} · {fechaCorta(c.fecha)}, {c.hora} · {c.motivo} · autorizó {c.autorizo}, lo registró {c.registro}</small>
            </div>
          </div>
        ))}

        {puedeCorregir && otraSinSaber ? (
          <p className="flag" role="status">
            Quedó una corrección {deOtra!.folio ? `de la cuenta ${deOtra!.folio} ` : ""}sin saber si se registró. Primero se resuelve esa: búscala por su folio.
          </p>
        ) : null}
        {puedeCorregir && !otraSinSaber && !corrigiendo ? (
          <>
            <p className="lbl" style={{ marginTop: 16 }}>¿Qué material se corrige?</p>
            {cuenta.renglones.map((r) => (
              <button
                key={r.linea} type="button" className="btn ghostbtn chico"
                onClick={() => { setHecho(""); setAviso(""); setCorrigiendo({ linea: r.linea, kg: "", material: null, liquidacion: null, motivo: "" }); }}
              >
                {r.material.nombre} · {kilos(r.kg)} kg · {pesos(r.importe)}
              </button>
            ))}
            <p className="note">Si se dan cuenta antes de cobrar, se corrige en la cuenta misma. Esto es para lo que ya se cobró: se liquida solo la diferencia.</p>
          </>
        ) : null}

        {puedeCorregir && !otraSinSaber && corrigiendo && renglon ? (
          <div className="manual">
            <p className="que"><b>{renglon.material.nombre}</b><span>Ahora: {kilos(renglon.kg)} kg a {pesos(renglon.precio)} el kilo, {pesos(renglon.importe)}</span></p>
            <p className="lbl">¿Cuántos kilos eran de verdad?</p>
            <Visor nombre="Kilos que se pagan o se cobran" valor={corrigiendo.kg} />
            <Teclado valor={corrigiendo.kg} alCambiar={(kg) => setCorrigiendo({ ...corrigiendo, kg })} decimales={3} enteros={6} />
            {corrigiendo.material === null ? (
              <button className="btn ghostbtn chico" type="button" onClick={() => setCorrigiendo({ ...corrigiendo, material: renglon.material.id })}>Era otro material</button>
            ) : (
              <label>
                <span className="lbl" style={{ display: "block", marginTop: 16 }}>¿Qué material era?</span>
                <select className="campo" value={corrigiendo.material} onChange={(e) => setCorrigiendo({ ...corrigiendo, material: Number(e.target.value) })}>
                  {(materiales ?? [renglon.material]).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                </select>
              </label>
            )}
            {kgListos ? (
              <p className="queda" role="status">
                {diferencia !== null ? queSignifica(cuenta.tipo, diferencia, cuenta.fiada) : "Con otro material, la diferencia la calcula el sistema al precio de lista de ese día."}
              </p>
            ) : null}
            <p className="lbl" style={{ marginTop: 16 }}>¿Cómo se liquida la diferencia?</p>
            <div className="chips" role="group" aria-label="Cómo se liquida">
              {(cuenta.fiada ? ["credito", "efectivo", "transferencia"] as const : ["efectivo", "transferencia", "pendiente"] as const).map((l) => (
                <button key={l} type="button" className="chip" aria-pressed={corrigiendo.liquidacion === l} onClick={() => setCorrigiendo({ ...corrigiendo, liquidacion: l })}>
                  {BOTON[l]}
                </button>
              ))}
            </div>
            {cuenta.fiada ? <p className="note">Esta venta se fió: la diferencia puede ir a lo que debe el cliente, o pagarse en el momento.</p> : null}
            <label>
              <span className="lbl">¿Por qué se corrige?</span>
              <input className="campo" type="text" value={corrigiendo.motivo} maxLength={200} autoComplete="off" placeholder="Se pesó con el costal, se anotó otro material…"
                onChange={(e) => setCorrigiendo({ ...corrigiendo, motivo: e.target.value })} />
            </label>
            {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
            <button className="btn" type="button" disabled={!listo} onClick={() => { setAviso(""); setAutorizando(true); }}>Pedir la clave de quien autoriza</button>
            <button className="btn ghostbtn chico" type="button" onClick={() => setCorrigiendo(null)}>No corregir</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
