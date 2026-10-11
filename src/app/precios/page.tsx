"use client";
// Los precios del día, por familia. El responsable los revisa, los cambia y los publica; desde
// ese momento no cambian. Los demás los ven.
import { useEffect, useState } from "react";
import { pedir } from "../../componentes/cliente.ts";
import { fechaCorta, precio as comoPrecio } from "../../componentes/formato.ts";
import { LoQueFalta, useSesion } from "../../componentes/Sesion.tsx";
import type { Dia } from "../../componentes/Sesion.tsx";

interface MaterialConPrecio {
  id: number;
  nombre: string;
  compra: string | null;
  venta: string | null;
  antes: { compra: string; venta: string } | null;
}

interface Lista {
  lista: { id: string; fecha: string; abierta: boolean; publicada: boolean } | null;
  familias: Array<{ id: number; nombre: string; materiales: MaterialConPrecio[] }>;
}

/** Lo que hay escrito en los dos campos de un material. */
type Escrito = Record<number, { compra: string; venta: string }>;

const PRECIO = /^\d{1,5}(\.\d{1,4})?$/;
const limpio = (t: string): string => t.trim().replace(",", ".").replace(/\.$/, "");
/** 2.1000 → 2.10: sin ceros de sobra, pero con centavos. */
const paraEditar = (t: string | null): string => (t === null ? "" : Number(t).toFixed(Math.max(2, (t.replace(/0+$/, "").split(".")[1] ?? "").length)));

export default function PantallaDePrecios() {
  const { persona, dia, ponerDia } = useSesion();
  const [datos, setDatos] = useState<Lista | null>(null);
  const [escrito, setEscrito] = useState<Escrito>({});
  const [aviso, setAviso] = useState("");
  const [guardado, setGuardado] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const recibir = (l: Lista): void => {
    setDatos(l);
    setEscrito(Object.fromEntries(l.familias.flatMap((f) => f.materiales).map((m) => [m.id, { compra: paraEditar(m.compra), venta: paraEditar(m.venta) }])));
  };

  useEffect(() => {
    pedir<Lista>("GET", "/api/precios").then(recibir).catch((e: Error) => setAviso(e.message));
  }, [dia.jornada?.id, dia.lista?.publicada]);

  if (!datos) return aviso ? <div className="flag" role="alert">{aviso}</div> : <p className="cargando">Un momento…</p>;

  const editable = persona.rol === "responsable" && datos.lista?.abierta === true && !datos.lista.publicada;
  const materiales = datos.familias.flatMap((f) => f.materiales);

  /** Lo que cambió respecto de lo guardado, listo para mandarse; o el material que está mal escrito. */
  const cambios = (): { cambios: unknown[] } | { mal: string } => {
    const lista: unknown[] = [];
    for (const m of materiales) {
      const e = escrito[m.id] ?? { compra: "", venta: "" };
      const [compra, venta] = [limpio(e.compra), limpio(e.venta)];
      if (compra === paraEditar(m.compra) && venta === paraEditar(m.venta)) continue;
      if (compra === "" && venta === "") {
        if (m.compra !== null) lista.push({ material: m.id, quitar: true });
        continue;
      }
      if (!PRECIO.test(compra) || !PRECIO.test(venta)) return { mal: m.nombre };
      lista.push({ material: m.id, compra, venta });
    }
    return { cambios: lista };
  };

  const guardar = async (publicar: boolean): Promise<void> => {
    const c = cambios();
    setGuardado("");
    if ("mal" in c) {
      setAviso(`Revisa ${c.mal}: lleva precio de compra y de venta, con punto, o los dos vacíos.`);
      return;
    }
    setOcupado(true);
    setAviso("");
    try {
      if (c.cambios.length) recibir(await pedir<Lista>("POST", "/api/precios", c));
      if (publicar) {
        ponerDia((await pedir<{ dia: Dia }>("POST", "/api/precios/publicar")).dia);
        setGuardado("Lista publicada. Ya se puede atender.");
      } else {
        setGuardado(c.cambios.length ? "Precios guardados. Falta publicarlos." : "No había cambios.");
      }
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const conPrecio = materiales.filter((m) => (escrito[m.id]?.compra ?? "") !== "").length;

  return (
    <div className="angosto" style={{ margin: "0 auto" }}>
      <LoQueFalta para="precios" />
      <div className="card">
        <header>
          <h2>{datos.lista?.abierta ? "Precios de hoy" : datos.lista ? `Precios del ${fechaCorta(datos.lista.fecha)}` : "Precios"}</h2>
          <small>{!datos.lista ? "Todavía no hay lista" : datos.lista.publicada ? "Publicada" : "Sin publicar"}</small>
        </header>
        <div className="pad">
          <p className="note" style={{ marginTop: 0 }}>
            {editable
              ? "Se publican una vez en la mañana y quedan fijos en cada ticket del día. Debajo de cada material está el precio anterior, de referencia. Un material sin precio no se compra ni se vende hoy."
              : datos.lista?.publicada
                ? "Estos precios ya están publicados y no cambian en el día."
                : "Los precios los pone y los publica un responsable."}
          </p>
          <div className="phead"><span>Material</span><span>Compra</span><span>Venta</span></div>
          {datos.familias.map((f) => (
            <div key={f.id}>
              <h3 className="pcat">{f.nombre}</h3>
              {f.materiales.map((m) => (
                <div className="pricerow" key={m.id}>
                  <div className="nm">
                    {m.nombre}
                    {m.antes && datos.lista?.abierta ? <small>antes {comoPrecio(m.antes.compra)} / {comoPrecio(m.antes.venta)}</small> : null}
                  </div>
                  {(["compra", "venta"] as const).map((lado) => editable ? (
                    <input
                      key={lado} type="text" inputMode="decimal" autoComplete="off" placeholder="—"
                      aria-label={`Precio de ${lado} de ${m.nombre}`} value={escrito[m.id]?.[lado] ?? ""}
                      onChange={(e) => { setGuardado(""); setEscrito((antes) => ({ ...antes, [m.id]: { ...(antes[m.id] ?? { compra: "", venta: "" }), [lado]: e.target.value } })); }}
                    />
                  ) : (
                    <span key={lado} className="n" style={{ textAlign: "right", fontFamily: "var(--numeros)" }}>{m[lado] === null ? "—" : comoPrecio(m[lado]!)}</span>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
          {guardado ? <div className="okmsg" role="status" style={{ marginTop: 12, marginBottom: 0 }}>{guardado}</div> : null}
          {editable ? (
            <>
              <button className="btn ghostbtn" type="button" disabled={ocupado} onClick={() => void guardar(false)}>Guardar sin publicar</button>
              <button className="btn" type="button" disabled={ocupado || conPrecio === 0} onClick={() => void guardar(true)}>Publicar lista del día</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
