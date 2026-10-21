"use client";
// Registrar un gasto (0042): de qué tipo, el concepto, cuánto y de dónde salió el dinero. Si salió
// del cajón es de hoy y cuenta en el corte; si salió de otro lado, puede ser de cualquier día que
// ya pasó. También clasifica un «sacar» del cajón que ya estaba: entonces el día y lo que se sacó ya
// están dichos, y solo falta el tipo.
//
// Es un envío: lo que salió y no se supo si llegó se queda guardado en esta pestaña, y se manda ese
// mismo otra vez (si ya había entrado, no se registra dos veces).
import { useRef, useState } from "react";
import { identificador } from "../cliente.ts";
import { comoPesos, pesosListos } from "../caja/tipos.ts";
import { fechaCorta, pesos } from "../formato.ts";
import { Incierto, enviar, useAccion } from "../inventario/piezas.tsx";
import type { Pendiente } from "../inventario/piezas.tsx";
import type { SacarSinGasto, TipoDeGasto } from "../panel/tipos.ts";

type DeDonde = "cajon" | "otro";
type Registro = Pendiente<{ fecha: string; tipo: string; concepto: string; importe: string; deDonde: DeDonde; movimiento: string | null }> & { nombre: string };
const DONDE = "feruga.gasto";

function recordar(): Registro | null {
  try {
    return JSON.parse(sessionStorage.getItem(DONDE) ?? "null");
  } catch {
    return null;
  }
}

/** Si en esta pestaña quedó un gasto del que no se supo: la pantalla abre el registro para resolverlo. */
export const hayGastoPendiente = (): boolean => recordar() !== null;

/** Lo que se registra, en palabras: para el aviso de «no se supo» y el de «listo». */
const enPalabras = (r: Registro): string => `el gasto de ${pesos(r.cuerpo.importe)} (${r.nombre}: ${r.cuerpo.concepto})`;

export function RegistrarGasto(p: {
  hoy: string;
  tipos: TipoDeGasto[];
  /** El «sacar» que se clasifica, si es eso. */
  sacar: SacarSinGasto | null;
  alRegistrar: (mensaje: string) => void;
  alCancelar: () => void;
}) {
  const [pendiente, setPendiente] = useState<Registro | null>(recordar);
  const actual = useRef(pendiente);
  const activos = p.tipos.filter((t) => t.activo);
  const [tipo, setTipo] = useState<TipoDeGasto | null>(null);
  const [deDonde, setDeDonde] = useState<DeDonde>(p.sacar ? "cajon" : "otro");
  const [fecha, setFecha] = useState(p.sacar?.fecha ?? p.hoy);
  const [concepto, setConcepto] = useState(p.sacar?.motivo ?? "");
  const [importe, setImporte] = useState(p.sacar ? p.sacar.importe : "");
  const { ocupado, aviso, hacer } = useAccion();

  const fijar = (v: Registro | null): void => {
    actual.current = v;
    try {
      if (v) sessionStorage.setItem(DONDE, JSON.stringify(v));
      else sessionStorage.removeItem(DONDE);
    } catch {
      // Sin dónde guardar, sigue; solo no sobrevive a una recarga.
    }
    setPendiente(v);
  };

  // Del cajón sin un «sacar» que clasificar, el gasto sale hoy: la fecha no se escoge.
  const elDia = p.sacar ? p.sacar.fecha : deDonde === "cajon" ? p.hoy : fecha;
  const mandar = (): Promise<void> =>
    hacer(async () => {
      const r = await enviar<{ hecho: true }, Registro>(
        "/api/gastos", actual.current,
        () => ({
          id: identificador(), nombre: tipo!.nombre,
          cuerpo: { fecha: elDia, tipo: tipo!.id, concepto: concepto.trim(), importe: comoPesos(importe), deDonde, movimiento: p.sacar?.id ?? null },
        }),
        fijar,
      );
      if (!r) return;                                            // no se supo: se queda guardado
      const hecho = actual.current!;
      fijar(null);
      p.alRegistrar(`Se registró ${enPalabras(hecho)}${hecho.cuerpo.deDonde === "cajon" && !hecho.cuerpo.movimiento ? ", que sale del cajón de hoy" : ""}.`);
    });

  if (pendiente) {
    return <div className="manual"><Incierto que={enPalabras(pendiente)} ocupado={ocupado} aviso={aviso} alReintentar={() => void mandar()} /></div>;
  }

  const fechaBien = /^\d{4}-\d{2}-\d{2}$/.test(elDia) && elDia <= p.hoy;
  const listo = tipo !== null && concepto.trim() !== "" && pesosListos(importe) && Number(comoPesos(importe)) > 0 && fechaBien;
  return (
    <div className="manual registrar-gasto">
      {p.sacar ? (
        <p className="note" style={{ marginTop: 0 }}>
          Se sacaron {pesos(p.sacar.importe)} del cajón el {fechaCorta(p.sacar.fecha)} a las {p.sacar.hora}: «{p.sacar.motivo}». Di de qué tipo fue el gasto.
        </p>
      ) : null}
      <p className="lbl">¿De qué tipo es?</p>
      <div className="chips" role="group" aria-label="Tipo de gasto">
        {activos.map((t) => (
          <button key={t.id} type="button" className="chip" aria-pressed={tipo?.id === t.id} onClick={() => setTipo(t)}>{t.nombre}</button>
        ))}
      </div>
      {tipo && !tipo.cuenta ? <p className="note">Los gastos de este tipo no se restan en la ganancia.</p> : null}

      {p.sacar ? null : (
        <>
          <p className="lbl" style={{ marginTop: 16 }}>¿De dónde salió el dinero?</p>
          <div className="chips forma" role="group" aria-label="De dónde salió el dinero">
            <button type="button" className="chip" aria-pressed={deDonde === "cajon"} onClick={() => setDeDonde("cajon")}>Del cajón, hoy</button>
            <button type="button" className="chip" aria-pressed={deDonde === "otro"} onClick={() => setDeDonde("otro")}>De otro lado</button>
          </div>
          {deDonde === "cajon" ? (
            <p className="note">Sale del cajón de hoy: cuenta en el corte como dinero que se sacó.</p>
          ) : (
            <label>
              <span className="lbl" style={{ display: "block", marginTop: 16 }}>¿De qué día es?</span>
              <input className="campo" type="date" value={fecha} max={p.hoy} onChange={(e) => setFecha(e.target.value)} />
            </label>
          )}
        </>
      )}

      <label>
        <span className="lbl" style={{ display: "block", marginTop: 16 }}>Concepto</span>
        <input className="campo" type="text" value={concepto} maxLength={200} autoComplete="off" placeholder="Por ejemplo: diésel del camión" onChange={(e) => setConcepto(e.target.value)} />
      </label>
      <label>
        <span className="lbl" style={{ display: "block", marginTop: 16 }}>Cuánto, en pesos</span>
        <input
          className="campo" type="text" inputMode="decimal" autoComplete="off" value={importe} readOnly={p.sacar !== null}
          onChange={(e) => setImporte(e.target.value.replace(/[^\d.]/g, ""))}
        />
      </label>
      {importe !== "" && !pesosListos(importe) ? <p className="flag" role="status">Escribe la cantidad en pesos, con hasta dos decimales.</p> : null}
      {!fechaBien && deDonde === "otro" ? <p className="flag" role="status">La fecha no puede ser posterior a hoy.</p> : null}

      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      <button className="btn" type="button" disabled={!listo || ocupado} onClick={() => void mandar()}>
        {listo ? `Registrar el gasto de ${pesos(comoPesos(importe))}` : "Registrar el gasto"}
      </button>
      <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={p.alCancelar}>No registrar</button>
    </div>
  );
}
