"use client";
// Los avisos del cajón: un corte que no cuadró, o un cajón que abrió con otra cantidad de la que se
// dejó. Le llegan al responsable: en la barra, en cuanto entra, y en el panel, donde dice que ya
// los vio. Mientras no haya servidor solo se ven aquí; con servidor, también por Telegram y correo.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { claseDeBoton } from "../base/Boton.tsx";
import { pedir } from "../cliente.ts";
import { fechaCorta, pesos } from "../formato.ts";
import type { Aviso } from "./tipos.ts";

/** Lo que dice un aviso, en una frase. */
export function queDice(a: Aviso): string {
  const d = Number(a.diferencia);
  const cuanto = pesos(String(Math.abs(d).toFixed(2)));
  return a.clase === "corte"
    ? `El corte del ${fechaCorta(a.fecha)} no cuadró: ${d < 0 ? "faltaron" : "sobraron"} ${cuanto}. Lo contó ${a.conto}, a las ${a.hora}.`
    : `El ${fechaCorta(a.fecha)} el cajón abrió con ${cuanto} de ${d < 0 ? "menos" : "más"} de lo que se dejó en el último corte. Lo contó ${a.conto}, a las ${a.hora}.`;
}

/** Los avisos sin ver, pedidos al servidor; `null` mientras llegan. */
function useAvisos(): [Aviso[] | null, (a: Aviso[]) => void] {
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const turno = useRef(0);
  useEffect(() => {
    const mio = ++turno.current;
    pedir<{ avisos: Aviso[] }>("GET", "/api/avisos")
      .then((r) => { if (mio === turno.current) setAvisos(r.avisos); })
      .catch(() => { if (mio === turno.current) setAvisos([]); });
  }, []);
  return [avisos, setAvisos];
}

/** En la barra de un responsable: cuántos avisos hay sin ver, y a dónde ir a verlos. Nada si no hay. */
export function AvisosEnLaBarra() {
  const [avisos] = useAvisos();
  if (!avisos?.length) return null;
  return (
    <div className="flag avisos-de-caja" role="status">
      <span>
        <b>{avisos.length === 1 ? "Un aviso del cajón." : `${avisos.length} avisos del cajón.`}</b> {queDice(avisos[0]!)}
      </span>
      <Link className={claseDeBoton("gris", true)} href="/panel">Ver en el panel</Link>
    </div>
  );
}

/** En el panel: los avisos sin ver, y —si quien mira es responsable— decir que ya los vio. */
export function AvisosDelCajon({ puedeVer }: { puedeVer: boolean }) {
  const [avisos, setAvisos] = useAvisos();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const ver = useCallback(async (a: Aviso): Promise<void> => {
    if (ocupado) return;
    setOcupado(true);
    setError("");
    try {
      setAvisos((await pedir<{ avisos: Aviso[] }>("POST", `/api/avisos/${a.id}/visto`)).avisos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }, [ocupado, setAvisos]);

  if (!avisos?.length) return null;
  return (
    <div className="card">
      <header><h2>Avisos del cajón</h2><small>{avisos.length === 1 ? "Uno sin ver" : `${avisos.length} sin ver`}</small></header>
      <div className="pad">
        {avisos.map((a) => (
          <div className="ren" key={a.id}>
            <div className="rn"><b>{a.clase === "corte" ? "Corte que no cuadró" : "Cajón que abrió distinto"}</b><small>{queDice(a)}</small></div>
            {puedeVer ? <button className="quitar" type="button" disabled={ocupado} onClick={() => void ver(a)}>Ya lo vi</button> : null}
          </div>
        ))}
        {error ? <div className="flag" role="alert">{error}</div> : null}
        <p className="note">{puedeVer ? "Dejan de salir cuando un responsable dice que ya los vio; queda quién y cuándo." : "Los marca como vistos un responsable."}</p>
      </div>
    </div>
  );
}
