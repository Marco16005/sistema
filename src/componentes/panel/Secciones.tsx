"use client";
// Lo que cuelga del panel: el resumen, los días que ha habido, la historia de precios, los clientes,
// la bitácora y sacar reportes.
// En la barra de arriba todo esto es una sola pantalla, «Panel»; aquí se pasa de una parte a otra.
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES: Array<[string, string]> = [
  ["/panel", "Resumen"], ["/panel/dias", "Días"], ["/panel/precios", "Precios"], ["/panel/clientes", "Clientes"], ["/panel/bitacora", "Bitácora"],
  ["/panel/reportes", "Reportes"],
];

export function Secciones() {
  const donde = usePathname();
  return (
    <nav className="secciones" aria-label="Partes del panel">
      {SECCIONES.map(([ruta, nombre]) => (
        <Link key={ruta} href={ruta} aria-current={donde === ruta ? "page" : undefined}>{nombre}</Link>
      ))}
    </nav>
  );
}

/** A quien no dirige el negocio, el panel le dice que no es para él: el servidor tampoco le contesta. */
export function SoloQuienDirige() {
  return <div className="card"><p className="empty">El panel es para quien dirige el negocio.</p></div>;
}
