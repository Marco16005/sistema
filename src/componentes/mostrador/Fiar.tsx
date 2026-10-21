"use client";
// Cobrar una venta a crédito (0041): a nombre de un cliente conocido —o uno nuevo—, con la fecha en
// que debe pagar si se pactó, y la clave de una persona facultada. Es para cargas grandes y gente
// conocida: no pasa por el cajón, y lo que debe se ve en el Panel, en «Fiado».
//
// Repetirlo no fía dos veces: si la cuenta ya quedó cobrada, la base devuelve la cuenta como está.
import { useEffect, useState } from "react";
import { Autorizar } from "../Autorizar.tsx";
import type { QuienAutoriza } from "../Autorizar.tsx";
import { pedir } from "../cliente.ts";
import { pesosCerrados } from "../formato.ts";
import type { Cuenta } from "./tipos.ts";

interface Cliente { id: string; nombre: string }

export function Fiar(p: {
  cuenta: Cuenta; hoy: string; aviso: string; ocupado: boolean;
  hacer: (accion: () => Promise<void>) => Promise<void>;
  alTerminar: (hecha: Cuenta) => Promise<void>; alSalir: () => void;
}) {
  // Si la cuenta ya está a nombre de alguien (por un precio especial), se le fía a esa misma persona.
  const fijo = p.cuenta.cliente;
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(fijo);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [vence, setVence] = useState("");
  const [autorizando, setAutorizando] = useState(false);
  const [quienes, setQuienes] = useState<QuienAutoriza[] | null>(null);

  useEffect(() => {
    if (fijo) return;
    pedir<{ clientes: Cliente[] }>("GET", "/api/clientes").then((r) => setClientes(r.clientes)).catch(() => setClientes([]));
  }, [fijo]);
  useEffect(() => {
    if (!autorizando) return;
    pedir<{ personas: QuienAutoriza[] }>("GET", "/api/inventario/autorizan").then((r) => setQuienes(r.personas)).catch(() => setQuienes([]));
  }, [autorizando]);

  const nombre = cliente?.nombre ?? nuevo?.trim() ?? "";
  if (autorizando) {
    return (
      <Autorizar
        titulo="Fiar la venta"
        explicacion={`${pesosCerrados(p.cuenta.resumen.total)} a nombre de ${nombre}${vence ? `, que paga a más tardar el ${vence.split("-").reverse().join("/")}` : ""}. Lo autoriza una persona facultada.`}
        personas={quienes} boton={(quien) => `Fiar a nombre de ${quien}`} cancelar="Regresar"
        aviso={p.aviso} ocupado={p.ocupado} alCancelar={() => setAutorizando(false)}
        alAutorizar={(quien, clave) =>
          p.hacer(async () => {
            const r = await pedir<{ cuenta: Cuenta }>("POST", `/api/cuentas/${p.cuenta.id}/fiar`, {
              revision: p.cuenta.revision, cliente: cliente?.id ?? null, clienteNuevo: cliente ? null : nuevo!.trim(),
              vence: vence || null, autoriza: quien.id, clave,
            });
            // Dentro de esta misma acción: una acción no llama a otra, que la guarda contra el doble toque la detendría.
            await p.alTerminar(r.cuenta);
          })}
      />
    );
  }

  const listo = nombre !== "" && (!vence || vence >= p.hoy);
  return (
    <div className="card">
      <div className="pad">
        <p className="que"><b>Fiar la venta</b><span>{pesosCerrados(p.cuenta.resumen.total)}. No pasa por el cajón: queda a cuenta del cliente hasta que abone.</span></p>
        <p className="lbl">¿A quién se le fía?</p>
        {fijo ? (
          <p className="note" style={{ marginTop: 0 }}>Esta cuenta ya está a nombre de <b>{fijo.nombre}</b>: se le fía a ese cliente.</p>
        ) : nuevo !== null ? (
          <>
            <label className="lbl" htmlFor="fiar-nuevo">Nombre del cliente nuevo</label>
            <input id="fiar-nuevo" className="campo" type="text" value={nuevo} maxLength={80} autoComplete="off" autoCapitalize="words" enterKeyHint="done"
              onChange={(x) => setNuevo(x.target.value)} />
            <button className="btn ghostbtn chico" type="button" onClick={() => setNuevo(null)}>Elegir uno de la lista</button>
          </>
        ) : (
          <>
            {clientes === null ? <p className="cargando">Un momento…</p> : null}
            {clientes?.length === 0 ? <p className="note" style={{ marginTop: 0 }}>Todavía no hay clientes registrados.</p> : null}
            <div className="grid">
              {clientes?.map((c) => (
                <button key={c.id} type="button" className="mat" aria-pressed={cliente?.id === c.id} onClick={() => setCliente(c)}><b>{c.nombre}</b></button>
              ))}
            </div>
            <button className="btn ghostbtn chico" type="button" onClick={() => { setCliente(null); setNuevo(""); }}>Es un cliente nuevo</button>
          </>
        )}
        <label>
          <span className="lbl" style={{ display: "block", marginTop: 16 }}>¿Hasta cuándo paga? (si se pactó)</span>
          <input className="campo" type="date" value={vence} min={p.hoy} onChange={(x) => setVence(x.target.value)} />
        </label>
        {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
        <button className="btn" type="button" disabled={!listo || p.ocupado} onClick={() => setAutorizando(true)}>Pedir la clave de quien autoriza</button>
        <button className="btn ghostbtn chico" type="button" disabled={p.ocupado} onClick={p.alSalir}>No fiar: regresar a la cuenta</button>
      </div>
    </div>
  );
}
