"use client";
// Cobrar una venta a crédito (0041): a nombre de un cliente conocido —o uno nuevo—, con la fecha en
// que debe pagar si se pactó, y la clave de una persona facultada. Es para cargas grandes y gente
// conocida: no pasa por el cajón, y lo que debe se ve en el Panel, en «Fiado».
//
// Repetirlo con lo mismo no fía dos veces: si la cuenta ya quedó cobrada así, la base la devuelve
// como está; con otros datos, lo rechaza. Lo elegido se guarda con la cuenta (en la memoria del
// mostrador): recargar no lo pierde, y si salió y no se supo, se ofrece mandar eso mismo otra vez.
// Mientras no se sepa, lo elegido no se cambia ni se descarta (revisión de Codex del 22 de octubre):
// solo se manda otra vez, igual. Cambiar quién firma se puede después de preguntar por la cuenta:
// si ya no está abierta, el fiado entró, y el mostrador enseña su comprobante.
import { useEffect, useState } from "react";
import { Autorizar } from "../Autorizar.tsx";
import type { QuienAutoriza } from "../Autorizar.tsx";
import { ErrorDeApi, pedir } from "../cliente.ts";
import { pesosCerrados } from "../formato.ts";
import type { Cuenta } from "./tipos.ts";

interface Cliente { id: string; nombre: string }

/**
 * Lo elegido para fiar una cuenta; quién firmó si salió y no se supo si entró; y si lo elegido ya
 * salió alguna vez sin saberse —entonces no se cambia hasta que el servidor conteste algo—.
 */
export interface DatosDeFiado { cliente: Cliente | null; nuevo: string | null; vence: string; sinSaber: QuienAutoriza | null; salio?: boolean }

/** Que no haya respuesta, o que el servidor falle, no dice si entró. */
const noSeSupo = (e: unknown): boolean => e instanceof ErrorDeApi && (e.codigo === "RED" || e.estado >= 500);

export function Fiar(p: {
  cuenta: Cuenta; hoy: string; aviso: string; ocupado: boolean;
  /** Lo que ya se había elegido para esta cuenta, y dónde guardarlo. */
  guardado: DatosDeFiado | null; alGuardar: (datos: DatosDeFiado | null) => void;
  /** Manda el cobro dejándolo dicho con la cuenta mientras no se sepa si entró. */
  cobrar: <T>(peticion: () => Promise<T>) => Promise<T>;
  hacer: (accion: () => Promise<void>) => Promise<void>;
  alTerminar: (hecha: Cuenta) => Promise<void>; alSalir: () => void;
  /** Vuelve a pedir la cuenta: si ya no está abierta, el mostrador averigua si se cobró y enseña su comprobante. */
  alNoSaber: () => Promise<void>;
}) {
  // Si la cuenta ya está a nombre de alguien (por un precio especial), se le fía a esa misma persona.
  const fijo = p.cuenta.cliente;
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [datos, setDatos] = useState<DatosDeFiado>(() => p.guardado ?? { cliente: fijo, nuevo: null, vence: "", sinSaber: null });
  const { cliente, nuevo, vence, sinSaber } = datos;
  const fijado = datos.salio === true;
  const poner = (cambio: Partial<DatosDeFiado>): void => {
    const quedan = { ...datos, ...cambio };
    setDatos(quedan);
    p.alGuardar(quedan);
  };
  const setCliente = (c: Cliente | null): void => poner({ cliente: c });
  const setNuevo = (n: string | null): void => poner({ nuevo: n });
  const setVence = (v: string): void => poner({ vence: v });
  const [autorizando, setAutorizando] = useState(sinSaber !== null);
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
        explicacion={sinSaber && !p.ocupado
          ? `No se supo si la venta se fió. Teclea la clave otra vez: con los mismos datos, si ya había entrado no se fía dos veces. (${pesosCerrados(p.cuenta.resumen.total)} a nombre de ${nombre}.)`
          : `${pesosCerrados(p.cuenta.resumen.total)} a nombre de ${nombre}${vence ? `, que paga a más tardar el ${vence.split("-").reverse().join("/")}` : ""}. Lo autoriza una persona facultada.`}
        personas={quienes} quien={sinSaber ?? undefined} boton={(quien) => `Fiar a nombre de ${quien}`} cancelar="Regresar"
        alSoltar={async () => {
          // Antes de soltar a quien firmó, se pregunta por la cuenta: si ya no está abierta, el fiado entró.
          try {
            await pedir("GET", `/api/cuentas/${p.cuenta.id}`);
          } catch (e) {
            if (e instanceof ErrorDeApi && e.estado === 404) {
              p.alGuardar(null);
              await p.alNoSaber();
              return;
            }
            throw e;
          }
          poner({ sinSaber: null });
        }}
        aviso={p.aviso} ocupado={p.ocupado} alCancelar={() => { if (!sinSaber) setAutorizando(false); }}
        alAutorizar={(quien, clave) =>
          p.hacer(async () => {
            try {
              const r = await p.cobrar(() => pedir<{ cuenta: Cuenta }>("POST", `/api/cuentas/${p.cuenta.id}/fiar`, {
                revision: p.cuenta.revision, cliente: cliente?.id ?? null, clienteNuevo: cliente ? null : nuevo!.trim(),
                vence: vence || null, autoriza: quien.id, clave,
              }));
              p.alGuardar(null);
              // Dentro de esta misma acción: una acción no llama a otra, que la guarda contra el doble toque la detendría.
              await p.alTerminar(r.cuenta);
            } catch (e) {
              // Sin respuesta, se queda dicho quién firmó y lo elegido queda fijo: el siguiente intento es ese
              // mismo. Con respuesta, ya se sabe que no entró, y se puede cambiar.
              const incierto = noSeSupo(e);
              poner({ sinSaber: incierto ? quien : null, salio: incierto });
              throw e;
            }
          })}
      />
    );
  }

  const listo = nombre !== "" && (!vence || vence >= p.hoy);
  if (fijado) {
    return (
      <div className="card">
        <div className="pad">
          <p className="que"><b>Fiar la venta</b><span>{pesosCerrados(p.cuenta.resumen.total)} a nombre de {nombre}{vence ? `, que paga a más tardar el ${vence.split("-").reverse().join("/")}` : ""}.</span></p>
          <div className="flag" role="status">
            No se supo si la venta se fió. Mientras no se sepa no se cambia nada: se manda lo mismo otra vez, y si ya había entrado no se fía dos veces.
          </div>
          {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
          <button className="btn" type="button" disabled={p.ocupado} onClick={() => setAutorizando(true)}>Pedir la clave de quien autoriza</button>
          <button className="btn ghostbtn chico" type="button" disabled={p.ocupado} onClick={() => void p.hacer(p.alNoSaber)}>Ver si ya entró</button>
        </div>
      </div>
    );
  }
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
        <button className="btn ghostbtn chico" type="button" disabled={p.ocupado} onClick={() => { p.alGuardar(null); p.alSalir(); }}>No fiar: regresar a la cuenta</button>
      </div>
    </div>
  );
}
