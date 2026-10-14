"use client";
// El comprobante, como sale en papel. Trae todo lo necesario para reconstruir cómo se llegó al
// total: por material su báscula y sus pesos, y al pie la suma, el ajuste por redondeo y el total.
import { useEffect, useRef, useState } from "react";
import { ErrorDeApi, identificador, pedir } from "../cliente.ts";
import { ajuste, fechaDeTicket, kilos, kilosCortos, pesos, pesosCerrados, precio } from "../formato.ts";
import type { Comprobante, Impresion } from "./tipos.ts";

const MOTIVOS = ["No salió el papel", "Se atascó", "Copia para el cliente", "Copia para el negocio"];

interface Props {
  comprobante: Comprobante;
  negocio: string;
  /** La impresión que se acaba de registrar; vacío si solo se está consultando. */
  impresion: Impresion | null;
  /** Quien cobra puede reimprimir; quien consulta, solo ver. */
  puedeImprimir: boolean;
  alTerminar: () => void;
}

export function Ticket({ comprobante: inicial, negocio, impresion: primera, puedeImprimir, alTerminar }: Props) {
  const [comprobante, setComprobante] = useState(inicial);
  const [impresion, setImpresion] = useState<Impresion | null>(primera);
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const enCurso = useRef(false);
  /** La impresión que salió y de la que no se supo: si se reintenta, es esa misma. */
  const incierta = useRef<{ id: string; motivo: string | null } | null>(null);
  const compra = comprobante.tipo === "compra";
  // La primera impresión de un comprobante sale por duplicado, en un solo envío a la impresora: la
  // copia del cliente y la del negocio. Cuál es la primera lo dice el número que el servidor le
  // dio a esta impresión, no cuántas lleva el comprobante: un reintento de la primera sigue
  // siéndolo aunque después ya se haya reimpreso desde otro lado.
  const porDuplicado = impresion?.numero === 1;

  // El comprobante, como sale en papel. Las dos copias se pintan con esto mismo: no pueden diferir
  // más que en la leyenda.
  const cuerpo = (delNegocio: boolean) => (
    <>
      <div className="c b">{negocio}</div>
      <div className="c">{compra ? "COMPRA" : "VENTA"}</div>
      {delNegocio ? <div className="c b">COPIA DEL NEGOCIO</div> : null}
      <hr />
      <div className="r"><span>Folio {comprobante.folio}</span><span>{fechaDeTicket(comprobante.fecha)} {comprobante.hora}</span></div>
      <div>Atendió: {comprobante.atendio}</div>
      {comprobante.cliente ? <div>Cliente: {comprobante.cliente}</div> : null}
      <hr />
      {comprobante.materiales.map((m, k) => (
        <div key={k}>
          <div>{m.nombre}</div>
          <div className="r s"><span>{kilos(m.kg)} kg × {precio(m.precio)}</span><span>{pesos(m.importe)}</span></div>
          <div className="s">
            {m.bascula}
            {Number(m.recipiente) > 0 ? ` · marcó ${kilosCortos(m.bruto)} kg`
              : Number(m.tara) > 0 ? ` · ${kilosCortos(m.bruto)} − ${kilosCortos(m.tara)} kg` : ""}
          </div>
          {Number(m.recipiente) > 0 ? <div className="s">Recipiente: {kilosCortos(m.recipiente)} kg</div> : null}
          {Number(m.descuento) > 0 ? <div className="s">Descuento: {kilos(m.descuento)} kg</div> : null}
        </div>
      ))}
      <hr />
      <div className="r"><span>Suma</span><span>{pesos(comprobante.suma)}</span></div>
      <div className="r"><span>Ajuste por redondeo</span><span>{ajuste(comprobante.ajuste)}</span></div>
      <div className="r b g"><span>{compra ? "A PAGAR" : "A COBRAR"}</span><span>{pesosCerrados(comprobante.total)}</span></div>
      <hr />
      {impresion && impresion.numero > 1
        ? <div className="c b">REIMPRESIÓN {impresion.numero} · {impresion.motivo}</div>
        : null}
      <div className="c">Operación {comprobante.id.slice(0, 8)}</div>
      <div className="c">No es comprobante fiscal</div>
    </>
  );

  // Cada impresión registrada se manda al papel una vez.
  useEffect(() => {
    if (impresion) window.print();
  }, [impresion]);

  const imprimir = async (motivo: string | null): Promise<void> => {
    // Una a la vez: un doble toque no registra ni imprime dos.
    if (enCurso.current) return;
    enCurso.current = true;
    setOcupado(true);
    setAviso("");
    const envio = incierta.current && incierta.current.motivo === motivo ? incierta.current : { id: identificador(), motivo };
    incierta.current = envio;
    try {
      const r = await pedir<{ impresion: Impresion; comprobante: Comprobante }>(
        "POST", `/api/comprobantes/${comprobante.id}/imprimir`, envio,
      );
      incierta.current = null;
      setComprobante(r.comprobante);
      setImpresion(r.impresion);
      setPidiendoMotivo(false);
    } catch (e) {
      // Con un rechazo se sabe que no se registró; sin respuesta, no: el reintento manda la misma.
      if (!(e instanceof ErrorDeApi && e.codigo === "RED")) incierta.current = null;
      setAviso((e as Error).message);
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  };

  return (
    <div className="card">
      <header>
        <h2>{impresion && impresion.numero > 1 ? `Reimpresión ${impresion.numero}` : "Comprobante"}</h2>
        <small>Folio {comprobante.folio}</small>
      </header>
      <div className="pad">
        <div className="papel">
          <div className="ticket" data-folio={comprobante.folio}>{cuerpo(false)}</div>
          {/* La copia del negocio existe solo en el papel: en pantalla no se ve ni se lee. */}
          {porDuplicado ? (
            <>
              <div className="corte" aria-hidden="true" />
              <div className="ticket-negocio" aria-hidden="true">{cuerpo(true)}</div>
            </>
          ) : null}
        </div>

        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        {pidiendoMotivo ? (
          <>
            <p className="lbl" style={{ marginTop: 16 }}>¿Por qué se imprime otra vez?</p>
            <div className="motivos">
              {MOTIVOS.map((m) => <button key={m} className="btn ghostbtn chico" style={{ marginTop: 0 }} type="button" disabled={ocupado} onClick={() => void imprimir(m)}>{m}</button>)}
            </div>
          </>
        ) : null}
        <button className="btn" type="button" onClick={alTerminar}>Listo</button>
        {puedeImprimir && !pidiendoMotivo ? (
          <button
            className="btn ghostbtn chico" type="button" disabled={ocupado}
            onClick={() => (comprobante.impresiones === 0 ? void imprimir(null) : setPidiendoMotivo(true))}
          >
            {comprobante.impresiones === 0 ? "Imprimir" : "Imprimir otra vez"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
