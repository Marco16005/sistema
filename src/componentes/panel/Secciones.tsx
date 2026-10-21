"use client";
// Lo que cuelga del panel: el resumen, los días que ha habido, los materiales, la ganancia, lo fiado,
// los gastos, la historia de precios, los clientes, la bitácora, sacar reportes y —para un
// responsable— los ajustes.
// En la barra de arriba todo esto es una sola pantalla, «Panel»; aquí se pasa de una parte a otra.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSesion } from "../Sesion.tsx";

const SECCIONES: Array<[string, string]> = [
  ["/panel", "Resumen"], ["/panel/dias", "Días"], ["/panel/materiales", "Materiales"], ["/panel/ganancia", "Ganancia"], ["/panel/fiado", "Fiado"], ["/panel/gastos", "Gastos"], ["/panel/precios", "Precios"], ["/panel/clientes", "Clientes"], ["/panel/bitacora", "Bitácora"],
  ["/panel/reportes", "Reportes"],
];

export function Secciones() {
  const donde = usePathname();
  const { persona } = useSesion();
  // Los ajustes escriben: son de un responsable. Quien consulta ve el panel, no los ajustes.
  const partes: Array<[string, string]> = persona.rol === "responsable" ? [...SECCIONES, ["/panel/ajustes", "Ajustes"]] : SECCIONES;
  return (
    <nav className="secciones" aria-label="Partes del panel">
      {partes.map(([ruta, nombre]) => (
        <Link key={ruta} href={ruta} aria-current={donde === ruta ? "page" : undefined}>{nombre}</Link>
      ))}
    </nav>
  );
}

/** A quien no dirige el negocio, el panel le dice que no es para él: el servidor tampoco le contesta. */
export function SoloQuienDirige() {
  return <div className="card"><p className="empty">El panel es para quien dirige el negocio.</p></div>;
}
