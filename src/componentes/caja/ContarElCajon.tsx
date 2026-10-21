"use client";
// Contar el cajón al abrir el día, antes de pagar o cobrar. Se dice lo que hay de verdad; si no es
// lo que se dejó en el último corte, la base lo anota y le avisa al responsable.
//
// Es un envío: lo que salió y no se supo si llegó se queda guardado en esta pestaña, y se manda ese
// mismo otra vez (si ya había entrado, no se cuenta dos veces).
import { useRef, useState } from "react";
import { identificador } from "../cliente.ts";
import { pesos } from "../formato.ts";
import { Incierto, enviar, useAccion } from "../inventario/piezas.tsx";
import type { Pendiente } from "../inventario/piezas.tsx";
import type { Dia } from "../Sesion.tsx";
import { Teclado, Visor } from "../Teclado.tsx";
import { comoPesos, pesosListos } from "./tipos.ts";

type Conteo = Pendiente<{ jornada: string; contado: string }>;
const DONDE = "feruga.caja.apertura";

function recordar(jornada: string): Conteo | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(DONDE) ?? "null");
    return v && v.cuerpo?.jornada === jornada ? v : null;
  } catch {
    return null;
  }
}

export function ContarElCajon({ jornada, sugerido, alContar }: { jornada: string; sugerido: string | null; alContar: (dia: Dia) => void }) {
  const [pendiente, setPendiente] = useState<Conteo | null>(() => recordar(jornada));
  const actual = useRef(pendiente);
  const [tecleado, setTecleado] = useState("");
  const { ocupado, aviso, hacer } = useAccion();

  const fijar = (v: Conteo | null): void => {
    actual.current = v;
    try {
      if (v) sessionStorage.setItem(DONDE, JSON.stringify(v));
      else sessionStorage.removeItem(DONDE);
    } catch {
      // Sin dónde guardar, sigue; solo no sobrevive a una recarga.
    }
    setPendiente(v);
  };

  const contar = (cuanto: string): Promise<void> =>
    hacer(async () => {
      const r = await enviar<{ dia: Dia }, Conteo>(
        "/api/caja/abrir", actual.current, () => ({ id: identificador(), cuerpo: { jornada, contado: cuanto } }), fijar,
      );
      if (!r) return;                                            // no se supo: se queda guardado
      fijar(null);
      alContar(r.dia);
    });

  if (pendiente) {
    return (
      <div className="falta-dia" role="status">
        <b>Contar el cajón</b>
        <Incierto que={`el conteo de ${pesos(pendiente.cuerpo.contado)}`} ocupado={ocupado} aviso={aviso} alReintentar={() => void contar(pendiente.cuerpo.contado)} />
      </div>
    );
  }

  const listo = pesosListos(tecleado) && tecleado !== "";
  return (
    <div className="falta-dia" role="status">
      <b>Antes de atender, cuenta el cajón</b>
      Teclea cuánto dinero hay. Al cerrar el día se compara con lo que debería haber.
      {sugerido !== null ? <p className="note">En el último corte se dejaron {pesos(sugerido)}.</p> : null}
      <Visor nombre="En el cajón" valor={tecleado} unidad="pesos" leyenda={`Dinero tecleado: ${tecleado || "nada"} pesos`} />
      <Teclado valor={tecleado} alCambiar={setTecleado} decimales={2} enteros={8} alTerminar={() => { if (listo && !ocupado) void contar(comoPesos(tecleado)); }} />
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      <button className="btn" type="button" disabled={!listo || ocupado} onClick={() => void contar(comoPesos(tecleado))}>
        {listo ? `Hay ${pesos(comoPesos(tecleado))}` : "Teclea lo que hay"}
      </button>
      {sugerido !== null && tecleado === "" ? (
        <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => void contar(sugerido)}>
          Hay {pesos(sugerido)}, lo mismo que se dejó
        </button>
      ) : null}
    </div>
  );
}
