import type { Metadata, Viewport } from "next";
import { Roboto_Mono } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Contraste } from "../componentes/Contraste.tsx";
import { Sesion } from "../componentes/Sesion.tsx";
import { GALLETA_DE_CONTRASTE, contrasteElegido } from "../servidor/contraste.ts";
// Los valores del paquete primero; encima, la capa propia; después la base y las piezas, lo que
// queda de antes, las pantallas ya rediseñadas y, al final y aparte de todo, el comprobante.
import "@ios27_design_system/tokens/css";
import "@ios27_design_system/tokens/css/spacing";
import "@ios27_design_system/tokens/css/animations";
import "../estilo/valores.css";
import "../estilo/base.css";
import "../estilo/piezas.css";
import "../estilo/pantallas.css";
import "../estilo/panel.css";
import "../estilo/sesion.css";
import "../estilo/comprobante.css";

// La interfaz usa la letra de cada equipo: no descarga ninguna. La única que la aplicación sirve
// es la del comprobante, que tiene que salir igual en cualquier equipo y en el papel. Se descarga
// al construir: el mostrador no depende de un sitio externo.
const num = Roboto_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--fuente-num" });

export const metadata: Metadata = {
  title: "Mostrador",
  description: "Compra y venta por kilo: cuentas, comprobantes y cierre del día.",
};

// El contenido llega hasta la orilla (la base le deja su margen a la muesca), el teclado del
// teléfono achica la página en vez de taparla, y la barra del sistema toma el color del fondo.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function Armazon({ children }: { children: ReactNode }) {
  // Lo que este equipo eligió viaja en su galleta: la página sale ya con el contraste puesto. Sin
  // elección no lleva el atributo, y entonces manda lo que el equipo pida (valores.css).
  const contraste = contrasteElegido((await cookies()).get(GALLETA_DE_CONTRASTE)?.value);
  return (
    <html lang="es-MX" className={num.variable} data-contraste={contraste ?? undefined}>
      <body>
        <div className="wrap" tabIndex={-1} data-regreso-del-foco="">
          <Sesion ajustes={<Contraste elegido={contraste} />}>{children}</Sesion>
        </div>
      </body>
    </html>
  );
}
