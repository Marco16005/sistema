"use client";
import { Mostrador } from "../../componentes/mostrador/Mostrador.tsx";
import { ARMAN, useSesion } from "../../componentes/Sesion.tsx";

export default function PantallaDelMostrador() {
  const { persona } = useSesion();
  if (!ARMAN.includes(persona.rol)) {
    return <div className="card"><p className="empty">El mostrador es para quien atiende. Tú puedes ver los precios y el cierre.</p></div>;
  }
  return <Mostrador />;
}
