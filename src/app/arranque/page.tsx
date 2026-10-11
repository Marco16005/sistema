"use client";
// El arranque: lo que ya hay en el patio antes de empezar a registrar. Se captura una vez; lo que
// después resulte distinto se corrige por conteo. Lo escrito se guarda en este equipo mientras
// tanto, para que cerrar la ventana no lo pierda.
import { useEffect, useState } from "react";
import { pedir } from "../../componentes/cliente.ts";
import { kilos } from "../../componentes/formato.ts";
import { useSesion } from "../../componentes/Sesion.tsx";
import type { Dia } from "../../componentes/Sesion.tsx";

interface Hoja {
  terminado: boolean;
  familias: Array<{ id: number; nombre: string; materiales: Array<{ id: number; nombre: string; kg: string | null; origen: string | null }> }>;
}

type Origen = "contado" | "estimado";
type Escrito = Record<number, { kg: string; origen: Origen }>;

const DONDE = "feruga.arranque";
const KILOS = /^\d{1,6}(\.\d{1,3})?$/;
// La coma es decimal, como en los precios. Lo que no se entiende se rechaza: no se le quitan signos hasta que «parezca» un número.
const limpio = (t: string): string => t.trim().replace(",", ".").replace(/\.$/, "");

function recordar(): Escrito {
  try {
    const e = JSON.parse(localStorage.getItem(DONDE) ?? "null");
    return e && typeof e === "object" ? (e as Escrito) : {};
  } catch {
    return {};
  }
}

export default function PantallaDeArranque() {
  const { persona, ponerDia } = useSesion();
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [escrito, setEscrito] = useState<Escrito>(recordar);
  const [revisando, setRevisando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (persona.rol !== "responsable") return;
    pedir<{ arranque: Hoja }>("GET", "/api/arranque").then((r) => setHoja(r.arranque)).catch((e: Error) => setAviso(e.message));
  }, [persona.rol]);
  useEffect(() => {
    localStorage.setItem(DONDE, JSON.stringify(escrito));
  }, [escrito]);

  if (persona.rol !== "responsable") {
    return <div className="card"><p className="empty">El arranque lo hace un responsable.</p></div>;
  }
  if (!hoja) return aviso ? <div className="flag" role="alert">{aviso}</div> : <p className="cargando">Un momento…</p>;

  const materiales = hoja.familias.flatMap((f) => f.materiales);

  if (hoja.terminado) {
    const cargados = materiales.filter((m) => m.kg !== null);
    return (
      <div className="angosto" style={{ margin: "0 auto" }}>
        <div className="card">
          <header><h2>Arranque terminado</h2><small>{cargados.length ? `${cargados.length} materiales con saldo` : "Se arrancó en ceros"}</small></header>
          <div className="pad">
            {cargados.map((m) => (
              <div className="ren" key={m.id}>
                <div className="rn"><b>{m.nombre}</b><small>{m.origen}</small></div>
                <div className="ri">{kilos(m.kg!)} kg</div>
              </div>
            ))}
            <p className="note">El saldo inicial ya no se cambia. Si algo resulta distinto, se corrige con un conteo.</p>
          </div>
        </div>
      </div>
    );
  }

  const capturados = materiales
    .map((m) => ({ ...m, kgEscrito: limpio(escrito[m.id]?.kg ?? ""), origenEscrito: escrito[m.id]?.origen ?? ("estimado" as Origen) }))
    .filter((m) => m.kgEscrito !== "");
  const malos = capturados.filter((m) => !KILOS.test(m.kgEscrito) || Number(m.kgEscrito) <= 0);

  const poner = (id: number, cambio: Partial<{ kg: string; origen: Origen }>): void =>
    setEscrito((antes) => ({ ...antes, [id]: { ...(antes[id] ?? { kg: "", origen: "estimado" }), ...cambio } }));

  const terminar = async (): Promise<void> => {
    setOcupado(true);
    setAviso("");
    try {
      const r = await pedir<{ dia: Dia }>("POST", "/api/arranque/terminar", {
        saldos: capturados.map((m) => ({ material: m.id, kg: m.kgEscrito, origen: m.origenEscrito })),
      });
      localStorage.removeItem(DONDE);
      ponerDia(r.dia);
      setHoja((await pedir<{ arranque: Hoja }>("GET", "/api/arranque")).arranque);
    } catch (e) {
      setAviso((e as Error).message);
      setRevisando(false);
    } finally {
      setOcupado(false);
    }
  };

  if (revisando) {
    return (
      <div className="angosto" style={{ margin: "0 auto" }}>
        <div className="card">
          <header><h2>Revisa antes de terminar</h2><small>{capturados.length ? `${capturados.length} materiales` : "Sin saldo inicial"}</small></header>
          <div className="pad">
            {capturados.length === 0 ? <p className="empty">Vas a arrancar en ceros: sin nada registrado en el patio.</p> : null}
            {capturados.map((m) => (
              <div className="ren" key={m.id}>
                <div className="rn"><b>{m.nombre}</b><small>{m.origenEscrito}</small></div>
                <div className="ri">{kilos(m.kgEscrito)} kg</div>
              </div>
            ))}
            <div className="flag">
              <b>Esto se hace una sola vez.</b> Después ya no se puede cambiar el saldo inicial: lo que resulte distinto se corrige con un conteo.
            </div>
            {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
            <button className="btn" type="button" disabled={ocupado} onClick={() => void terminar()}>Terminar el arranque</button>
            <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => setRevisando(false)}>Regresar a corregir</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="angosto" style={{ margin: "0 auto" }}>
      <div className="card">
        <header><h2>Lo que ya hay en el patio</h2><small>Se captura una sola vez</small></header>
        <div className="pad">
          <p className="note" style={{ marginTop: 0 }}>
            Escribe los kilos de lo que ya tienes, material por material, y di si lo pesaste («contado») o es un aproximado («estimado»).
            Lo que dejes vacío arranca en cero. Sin esto no se puede vender lo que ya está en el patio.
          </p>
          {hoja.familias.map((f) => (
            <div key={f.id}>
              <h3 className="pcat">{f.nombre}</h3>
              {f.materiales.map((m) => {
                const e = escrito[m.id] ?? { kg: "", origen: "estimado" as Origen };
                return (
                  <div className="saldorow" key={m.id}>
                    <div className="nm">{m.nombre}</div>
                    <input
                      type="text" inputMode="decimal" autoComplete="off" placeholder="0" aria-label={`Kilos de ${m.nombre}`}
                      value={e.kg} onChange={(ev) => poner(m.id, { kg: ev.target.value })}
                    />
                    <div className="origen" role="group" aria-label={`Origen del saldo de ${m.nombre}`} style={e.kg.trim() === "" ? { visibility: "hidden" } : undefined}>
                      {(["estimado", "contado"] as const).map((o) => (
                        <button key={o} type="button" aria-pressed={e.origen === o} onClick={() => poner(m.id, { origen: o })}>{o}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {malos.length ? <div className="flag" role="alert">Revisa {malos[0]!.nombre}: los kilos van con punto y hasta tres decimales.</div> : null}
          {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
          <button className="btn" type="button" disabled={malos.length > 0} onClick={() => { setAviso(""); setRevisando(true); window.scrollTo(0, 0); }}>
            {capturados.length ? `Revisar ${capturados.length} ${capturados.length === 1 ? "material" : "materiales"}` : "Arrancar en ceros"}
          </button>
        </div>
      </div>
    </div>
  );
}
