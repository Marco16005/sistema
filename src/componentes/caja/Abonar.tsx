"use client";
// Registrar un abono de lo fiado (0041): quién paga, cuánto, y si fue en efectivo (entra al cajón
// de hoy) o por transferencia. No pide clave: es dinero que entra. No puede pasar de lo que debe.
//
// Es un envío: lo que salió y no se supo si llegó se queda guardado en esta pestaña, y se manda ese
// mismo otra vez (si ya había entrado, no se abona dos veces).
import { useEffect, useRef, useState } from "react";
import { identificador, pedir } from "../cliente.ts";
import { pesos } from "../formato.ts";
import { Incierto, enviar, useAccion } from "../inventario/piezas.tsx";
import type { Pendiente } from "../inventario/piezas.tsx";
import { Teclado, Visor } from "../Teclado.tsx";
import { comoPesos, pesosListos } from "./tipos.ts";

export interface SaldoDeCliente {
  cliente: string; nombre: string; fiado: string; abonado: string; debe: string; vencido: string;
  primeraVenta: string; ultimaVenta: string; ultimoAbono: string | null;
}
type Abono = Pendiente<{ cliente: string; importe: string; forma: "efectivo" | "transferencia"; nota: string | null }> & { nombre: string };
const DONDE = "feruga.caja.abono";

function recordar(): Abono | null {
  try {
    return JSON.parse(sessionStorage.getItem(DONDE) ?? "null");
  } catch {
    return null;
  }
}

export function Abonar({ alAbonar }: { alAbonar: (mensaje: string) => void }) {
  const [pendiente, setPendiente] = useState<Abono | null>(recordar);
  const actual = useRef(pendiente);
  const [deudores, setDeudores] = useState<SaldoDeCliente[] | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [quien, setQuien] = useState<SaldoDeCliente | null>(null);
  const [importe, setImporte] = useState("");
  const [forma, setForma] = useState<"efectivo" | "transferencia">("efectivo");
  const [nota, setNota] = useState("");
  const { ocupado, aviso, setAviso, hacer } = useAccion();

  useEffect(() => {
    if (!abriendo) return;
    pedir<{ clientes: SaldoDeCliente[] }>("GET", "/api/fiado")
      .then((r) => setDeudores(r.clientes.filter((c) => Number(c.debe) > 0)))
      .catch((e: Error) => setAviso(e.message));
  }, [abriendo, setAviso]);

  const fijar = (v: Abono | null): void => {
    actual.current = v;
    try {
      if (v) sessionStorage.setItem(DONDE, JSON.stringify(v));
      else sessionStorage.removeItem(DONDE);
    } catch {
      // Sin dónde guardar, sigue; solo no sobrevive a una recarga.
    }
    setPendiente(v);
  };

  const mandar = (): Promise<void> =>
    hacer(async () => {
      const r = await enviar<{ clientes: SaldoDeCliente[] }, Abono>(
        "/api/fiado/abonos", actual.current,
        () => ({ id: identificador(), nombre: quien!.nombre, cuerpo: { cliente: quien!.cliente, importe: comoPesos(importe), forma, nota: nota.trim() || null } }),
        fijar,
      );
      if (!r) return;                                            // no se supo: se queda guardado
      const hecho = actual.current!;
      fijar(null);
      const queda = r.clientes.find((c) => c.cliente === hecho.cuerpo.cliente);
      setAbriendo(false);
      setQuien(null);
      setImporte("");
      setNota("");
      alAbonar(`${hecho.nombre} abonó ${pesos(hecho.cuerpo.importe)} ${hecho.cuerpo.forma === "efectivo" ? "en efectivo" : "por transferencia"}.`
        + (queda ? ` Debe ${pesos(queda.debe)}.` : ""));
    });

  if (pendiente) {
    return <Incierto que={`el abono de ${pesos(pendiente.cuerpo.importe)} de ${pendiente.nombre}`} ocupado={ocupado} aviso={aviso} alReintentar={() => void mandar()} />;
  }
  if (!abriendo) {
    return <button className="btn ghostbtn chico" type="button" onClick={() => { setAviso(""); setAbriendo(true); }}>Registrar un abono de lo fiado</button>;
  }

  const listo = quien !== null && pesosListos(importe) && Number(comoPesos(importe)) > 0 && Number(comoPesos(importe)) <= Number(quien.debe);
  return (
    <div className="manual">
      <p className="lbl">¿Quién abona?</p>
      {deudores === null ? <p className="cargando">Un momento…</p> : null}
      {deudores?.length === 0 ? <p className="note" style={{ marginTop: 0 }}>Nadie debe nada de lo fiado.</p> : null}
      <div className="grid">
        {deudores?.map((c) => (
          <button key={c.cliente} type="button" className="mat" aria-pressed={quien?.cliente === c.cliente} onClick={() => setQuien(c)}>
            <b>{c.nombre}</b><span>Debe {pesos(c.debe)}{Number(c.vencido) > 0 ? ` · vencido ${pesos(c.vencido)}` : ""}</span>
          </button>
        ))}
      </div>
      {quien ? (
        <>
          <p className="lbl" style={{ marginTop: 16 }}>¿Cuánto abona?</p>
          <Visor nombre={quien.nombre} nota={`Debe ${pesos(quien.debe)}.`} valor={importe} unidad="pesos" leyenda={`Abono tecleado: ${importe || "nada"} pesos`} />
          <Teclado valor={importe} alCambiar={setImporte} decimales={2} enteros={8} />
          {pesosListos(importe) && Number(comoPesos(importe)) > Number(quien.debe) ? <p className="flag" role="status">No puede abonar más de lo que debe.</p> : null}
          <div className="chips forma" role="group" aria-label="Cómo paga">
            <button type="button" className="chip" aria-pressed={forma === "efectivo"} onClick={() => setForma("efectivo")}>En efectivo</button>
            <button type="button" className="chip" aria-pressed={forma === "transferencia"} onClick={() => setForma("transferencia")}>Por transferencia</button>
          </div>
          <label>
            <span className="lbl" style={{ display: "block", marginTop: 16 }}>Nota (si hace falta)</span>
            <input className="campo" type="text" value={nota} maxLength={200} autoComplete="off" onChange={(e) => setNota(e.target.value)} />
          </label>
        </>
      ) : null}
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      <button className="btn" type="button" disabled={!listo || ocupado} onClick={() => void mandar()}>
        {listo ? `Registrar el abono de ${pesos(comoPesos(importe))}` : "Registrar el abono"}
      </button>
      <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => { setAbriendo(false); setQuien(null); setImporte(""); }}>No registrar</button>
    </div>
  );
}
