"use client";
// Dar merma: material que se descarta y sale del patio, con su motivo.
import { identificador } from "../cliente.ts";
import { kilos } from "../formato.ts";
import { ElegirMaterial, Incierto, Motivo, TeclearKilos, enviar, useAccion } from "./piezas.tsx";
import type { Pendiente } from "./piezas.tsx";
import { comoTexto, kilosListos } from "./tipos.ts";
import type { Elegido, Familia } from "./tipos.ts";

export interface EstadoDeMerma {
  paso: "material" | "kilos" | "motivo";
  material: Elegido | null;
  kg: string;
  motivo: string;
  /** La merma que ya salió y de la que todavía no se sabe: mientras esté, no se cambia nada. */
  pendiente: Pendiente<{ material: number; kg: string; motivo: string }> | null;
}
export const MERMA_NUEVA: EstadoDeMerma = { paso: "material", material: null, kg: "", motivo: "", pendiente: null };

const MOTIVOS = ["Mojado", "Basura o tierra", "Se tiró"];

export function Merma(p: {
  e: EstadoDeMerma; poner: (cambio: Partial<EstadoDeMerma>) => void; familias: Familia[];
  alTerminar: (mensaje: string) => void; alSalir: () => void;
}) {
  const { e, poner } = p;
  const { ocupado, aviso, setAviso, hacer } = useAccion();

  const registrar = (material: Elegido): Promise<void> =>
    hacer(async () => {
      const r = await enviar<{ merma: { kg: string } }, NonNullable<EstadoDeMerma["pendiente"]>>(
        "/api/inventario/merma", e.pendiente ?? null,
        () => ({ id: identificador(), cuerpo: { material: material.id, kg: comoTexto(e.kg), motivo: e.motivo } }),
        (pendiente) => poner({ pendiente }),
      );
      if (r) p.alTerminar(`Merma registrada: ${kilos(r.merma.kg)} kg de ${material.nombre}.`);
    });

  if (e.pendiente && e.material) {
    const material = e.material;
    return (
      <div className="card">
        <div className="pad">
          <p className="que"><b>{material.nombre}</b><span>Merma de {kilos(e.pendiente.cuerpo.kg)} kg · {e.pendiente.cuerpo.motivo}</span></p>
          <Incierto que="la merma" ocupado={ocupado} aviso={aviso} alReintentar={() => void registrar(material)} />
        </div>
      </div>
    );
  }

  if (e.paso === "material" || !e.material) {
    return (
      <ElegirMaterial
        pregunta="¿De qué material es la merma?" familias={p.familias}
        alElegir={(material) => poner({ material, paso: "kilos", kg: "" })} cancelar="Regresar a existencias" alCancelar={p.alSalir}
      />
    );
  }
  const material = e.material;

  if (e.paso === "kilos") {
    return (
      <TeclearKilos
        titulo={material.nombre} subtitulo="Lo que se descarta y sale del patio" pregunta="¿Cuántos kilos?" nombre="Merma" valor={e.kg}
        alCambiar={(kg) => poner({ kg })} listo={kilosListos(e.kg)} boton="Seguir" alSeguir={() => poner({ paso: "motivo" })}
        cancelar="Es otro material" alCancelar={() => poner({ paso: "material" })}
      />
    );
  }

  return (
    <div className="card">
      <div className="pad">
        <p className="que"><b>{material.nombre}</b><span>Merma de {kilos(e.kg)} kg</span></p>
        <p className="lbl">¿Por qué?</p>
        <Motivo opciones={MOTIVOS} valor={e.motivo} alCambiar={(motivo) => poner({ motivo })} />
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        <button className="btn" type="button" disabled={ocupado || e.motivo.trim() === ""} onClick={() => void registrar(material)}>Registrar la merma</button>
        <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => { setAviso(""); poner({ paso: "kilos" }); }}>Corregir los kilos</button>
      </div>
    </div>
  );
}
