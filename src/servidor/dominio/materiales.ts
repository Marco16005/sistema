// El catálogo del responsable incluye las bajas y lo que impide retirar un material del patio.
import type { Bd, Persona } from "../bd.ts";

export interface MaterialDelCatalogo {
  id: number;
  nombre: string;
  nombreCorto: string;
  familia: string;
  familiaId: number;
  frecuente: boolean;
  activo: boolean;
  existencia: string;
  enCuentasAbiertas: number;
  conPrecioHoy: boolean;
}

// La lista y cada escritura devuelven la misma lectura, sin multiplicar kilos por renglones.
const MATERIALES = `
  SELECT m.id, m.nombre, m.nombre_corto AS "nombreCorto", f.nombre AS familia, f.id AS "familiaId",
         m.frecuente, m.activo, e.kg::text AS existencia,
         (SELECT count(DISTINCT o.id)::int FROM operacion o JOIN operacion_linea l ON l.operacion_id = o.id
          WHERE o.estado = 'borrador' AND l.material_id = m.id) AS "enCuentasAbiertas",
         EXISTS (SELECT 1 FROM precio p JOIN lista_precios lp ON lp.id = p.lista_id
                 JOIN jornada j ON j.id = lp.jornada_id
                 WHERE p.material_id = m.id AND j.sucursal_id = 1 AND j.cerrada_en IS NULL) AS "conPrecioHoy"
  FROM material m JOIN familia f ON f.id = m.familia_id JOIN existencia e ON e.material_id = m.id
  WHERE m.sucursal_id = 1`;

/** Todo el catálogo —activos y dados de baja—, por familia.orden y luego por nombre sin distinguir mayúsculas. */
export async function materialesDelCatalogo(bd: Bd): Promise<{
  familias: Array<{ id: number; nombre: string }>;
  materiales: MaterialDelCatalogo[];
}> {
  const familias = await bd.leer<{ id: number; nombre: string }>("SELECT id, nombre FROM familia ORDER BY orden");
  const materiales = await bd.leer<MaterialDelCatalogo>(`${MATERIALES} ORDER BY f.orden, lower(m.nombre)`);
  return { familias, materiales };
}

/** Da de alta sin precio; la lista del día se administra aparte. */
export async function altaDeMaterial(
  bd: Bd, persona: Persona, o: { familia: number; nombre: string; nombreCorto: string; frecuente: boolean },
): Promise<MaterialDelCatalogo> {
  return bd.enTransaccion(persona, async (c) => {
    const { rows: [m] } = await c.query<{ id: number }>("SELECT id FROM alta_material($1::smallint, $2, $3, $4, $5)",
      [o.familia, o.nombre, o.nombreCorto, o.frecuente, persona]);
    return (await c.query<MaterialDelCatalogo>(`${MATERIALES} AND m.id = $1`, [m!.id])).rows[0]!;
  });
}

/** Solo cambia vigencia y frecuencia; null conserva el valor que ya había. */
export async function cambiarMaterial(
  bd: Bd, persona: Persona, material: number, o: { activo: boolean | null; frecuente: boolean | null },
): Promise<MaterialDelCatalogo> {
  return bd.enTransaccion(persona, async (c) => {
    await c.query("SELECT cambiar_material($1, $2, $3, $4)", [material, o.activo, o.frecuente, persona]);
    return (await c.query<MaterialDelCatalogo>(`${MATERIALES} AND m.id = $1`, [material])).rows[0]!;
  });
}
