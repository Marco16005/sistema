"use client";
// Separar material mezclado: de qué material y cuántos kilos, qué salió de ahí, y lo que se pierde.
import { identificador, pedir } from "../cliente.ts";
import { kilos } from "../formato.ts";
import { ElegirMaterial, Incierto, TeclearKilos, enviar, useAccion } from "./piezas.tsx";
import type { Pendiente } from "./piezas.tsx";
import { comoTexto, kilosListos } from "./tipos.ts";
import type { Elegido, Familia } from "./tipos.ts";

export interface EstadoDeSeparacion {
  paso: "origen" | "kilos" | "productos" | "producto" | "kilos-producto" | "revisar";
  origen: Elegido | null;
  kg: string;
  productos: Array<Elegido & { kg: string }>;
  /** El producto que se está agregando. */
  nuevo: Elegido | null;
  kgNuevo: string;
  /** Lo que se pierde, calculado por el servidor. */
  merma: string | null;
  /** La separación que ya salió y de la que todavía no se sabe: mientras esté, no se cambia nada. */
  pendiente: Pendiente<{ origen: number; kg: string; productos: Array<{ material: number; kg: string }>; nota: null }> | null;
}
export const SEPARACION_NUEVA: EstadoDeSeparacion = {
  paso: "origen", origen: null, kg: "", productos: [], nuevo: null, kgNuevo: "", merma: null, pendiente: null,
};

export function Separar(p: {
  e: EstadoDeSeparacion; poner: (cambio: Partial<EstadoDeSeparacion>) => void; familias: Familia[];
  alTerminar: (mensaje: string) => void; alSalir: () => void;
}) {
  const { e, poner } = p;
  const { ocupado, aviso, setAviso, hacer } = useAccion();

  // Con un envío sin resultado solo hay una pantalla: lo que salió, y mandarlo otra vez.
  const fijo = Boolean(e.pendiente);

  if (!e.origen || (!fijo && e.paso === "origen")) {
    return (
      <ElegirMaterial
        pregunta="¿Qué material se separó?" familias={p.familias}
        alElegir={(origen) => poner({ origen, paso: "kilos", kg: "", productos: [], merma: null })} cancelar="Regresar a existencias" alCancelar={p.alSalir}
      />
    );
  }
  const origen = e.origen;

  if (!fijo && e.paso === "kilos") {
    return (
      <TeclearKilos
        titulo={origen.nombre} subtitulo="Lo que se tomó para separar" pregunta="¿Cuántos kilos?" nombre="Se separan" valor={e.kg}
        alCambiar={(kg) => poner({ kg })} listo={kilosListos(e.kg)} boton="Seguir" alSeguir={() => poner({ paso: "productos" })}
        cancelar="Es otro material" alCancelar={() => poner({ paso: "origen" })}
      />
    );
  }

  if (!fijo && (e.paso === "producto" || (e.paso === "kilos-producto" && !e.nuevo))) {
    return (
      <ElegirMaterial
        pregunta="¿Qué salió?" familias={p.familias} excluir={[origen.id, ...e.productos.map((x) => x.id)]}
        alElegir={(nuevo) => poner({ nuevo, kgNuevo: "", paso: "kilos-producto" })} cancelar="Regresar a la separación" alCancelar={() => poner({ paso: "productos" })}
      />
    );
  }
  if (!fijo && e.paso === "kilos-producto" && e.nuevo) {
    const nuevo = e.nuevo;
    return (
      <TeclearKilos
        titulo={nuevo.nombre} subtitulo={`Salió de ${kilos(e.kg)} kg de ${origen.nombre}`} pregunta="¿Cuántos kilos salieron?" nombre="Salió" valor={e.kgNuevo}
        alCambiar={(kgNuevo) => poner({ kgNuevo })} listo={kilosListos(e.kgNuevo)} boton="Agregar"
        alSeguir={() => poner({ productos: [...e.productos, { ...nuevo, kg: comoTexto(e.kgNuevo) }], nuevo: null, kgNuevo: "", merma: null, paso: "productos" })}
        cancelar="Es otro material" alCancelar={() => poner({ paso: "producto" })}
      />
    );
  }

  const cuerpo = { origen: origen.id, kg: comoTexto(e.kg), productos: e.productos.map((x) => ({ material: x.id, kg: x.kg })) };

  const verPerdida = (): Promise<void> =>
    hacer(async () => {
      const r = await pedir<{ merma: string }>("POST", "/api/inventario/separacion/previa", cuerpo);
      poner({ merma: r.merma, paso: "revisar" });
      window.scrollTo(0, 0);
    });

  const registrar = (): Promise<void> =>
    hacer(async () => {
      const r = await enviar<{ separacion: { merma: string } }, NonNullable<EstadoDeSeparacion["pendiente"]>>(
        "/api/inventario/separacion", e.pendiente ?? null, () => ({ id: identificador(), cuerpo: { ...cuerpo, nota: null } }),
        (pendiente) => poner({ pendiente }),
      );
      if (r) p.alTerminar(`Separación registrada: de ${kilos(e.kg)} kg de ${origen.nombre} salieron ${e.productos.length} ${e.productos.length === 1 ? "material" : "materiales"} y se perdieron ${kilos(r.separacion.merma)} kg.`);
    });

  const revisando = fijo || (e.paso === "revisar" && e.merma !== null);
  return (
    <div className="card">
      <header><h2>Separar {origen.nombre}</h2><small>{kilos(e.kg)} kg</small></header>
      <div className="pad">
        <p className="lbl">{e.productos.length ? "Lo que salió" : "Todavía no dices qué salió"}</p>
        {e.productos.map((x) => (
          <div className="ren" key={x.id}>
            <div className="rn"><b>{x.nombre}</b></div>
            <div className="ri">{kilos(x.kg)} kg</div>
            {!revisando ? (
              <button className="quitar" type="button" aria-label={`Quitar ${x.nombre}`} onClick={() => poner({ productos: e.productos.filter((y) => y.id !== x.id), merma: null })}>Quitar</button>
            ) : null}
          </div>
        ))}
        {revisando ? (
          <>
            {e.merma !== null ? <div className="tot big"><span>Se pierde</span><span className="n">{kilos(e.merma)} kg</span></div> : null}
            <p className="note">Lo que se pierde es lo que se tomó menos lo que salió: tierra, agua, lo que no es material.</p>
            {fijo ? (
              <Incierto que="la separación" ocupado={ocupado} aviso={aviso} alReintentar={() => void registrar()} />
            ) : (
              <>
                {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
                <button className="btn" type="button" disabled={ocupado} onClick={() => void registrar()}>Registrar la separación</button>
                <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => { setAviso(""); poner({ paso: "productos", merma: null }); }}>Corregir lo que salió</button>
              </>
            )}
          </>
        ) : (
          <>
            <button className="mas" type="button" onClick={() => { setAviso(""); poner({ paso: "producto" }); }}>
              {e.productos.length ? "＋ Agregar otro material que salió" : "＋ Agregar lo que salió"}
            </button>
            {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
            <button className="btn" type="button" disabled={ocupado || e.productos.length === 0} onClick={() => void verPerdida()}>Ver lo que se pierde</button>
            <button className="btn ghostbtn chico" type="button" onClick={() => poner({ paso: "kilos" })}>Corregir los kilos que se separan</button>
          </>
        )}
      </div>
    </div>
  );
}
