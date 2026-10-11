"use client";
// La entrada: manda a cada quien a la pantalla que le toca según su rol y cómo va el día.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ARMAN, useSesion } from "../componentes/Sesion.tsx";

export default function Inicio() {
  const { persona, dia } = useSesion();
  const router = useRouter();
  useEffect(() => {
    if (persona.rol === "responsable" && !dia.arranqueTerminado) router.replace("/arranque");
    else if (persona.rol === "responsable" && dia.jornada && !dia.lista?.publicada) router.replace("/precios");
    else if (ARMAN.includes(persona.rol)) router.replace("/mostrador");
    else router.replace("/precios");
  }, [persona, dia, router]);
  return <p className="cargando">Un momento…</p>;
}
