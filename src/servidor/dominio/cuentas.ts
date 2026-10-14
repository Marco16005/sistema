// Las cuentas del mostrador. Cada acción llama a su función del núcleo y devuelve la cuenta como
// quedó, leída de una sola consulta: lo que la pantalla muestra y la revisión que mandará al
// confirmar corresponden al mismo instante.
import type pg from "pg";
import type { Bd, Persona } from "../bd.ts";
import { ErrorDeNegocio } from "../errores.ts";

export interface MaterialDeCuenta {
  /** El identificador de este material en la cuenta: el que la pantalla generó al agregarlo. */
  id: string;
  material: { id: number; nombre: string; nombreCorto: string };
  bascula: { id: number; nombre: string; doblePesaje: boolean };
  /** Pesos por kilo: lo que se cobra. Es el de lista, salvo que lleve precio especial. */
  precio: string;
  /** El de la lista del día, fijado al agregarlo. Es del negocio: no va en el comprobante. */
  precioDeLista: string;
  /** Su último cambio de precio, de dar o de quitar; nada si nunca tuvo. Es lo que se manda como «visto» al dar o quitar. */
  eventoDePrecio: string | null;
  /** Si lleva precio especial vigente: quién lo autorizó. */
  precioEspecial: { autorizo: string } | null;
  /** Lo que marcó la báscula cada vez: una pesada, o dos en la báscula grande. */
  pesadas: string[];
  /** Le falta la segunda pesada. */
  porPesar: boolean;
  bruto: string | null;
  tara: string | null;
  /** Lo que pesa vacío el costal, la carretilla o lo que traiga, en la báscula chica. En la grande, cero: ahí la tara es el vehículo. */
  recipiente: string;
  descuento: string;
  /** Kilos que se pagan o se cobran. */
  kg: string | null;
  importe: string | null;
}

export interface Resumen {
  materiales: number;
  porPesar: number;
  suma: string;
  ajuste: string;
  /** En pesos cerrados. */
  total: string;
}

export interface Cuenta {
  id: string;
  tipo: "compra" | "venta";
  etiqueta: string | null;
  estado: "borrador" | "confirmada";
  /** Sube con cada cambio. Es la que se manda al confirmar. */
  revision: number;
  folio: string | null;
  /** Un vehículo que no volvió a pesarse antes de que su jornada cerrara. */
  deOtraJornada: boolean;
  /** A nombre de quién está: solo mientras algún material lleve precio especial. Las demás son anónimas. */
  cliente: { id: string; nombre: string } | null;
  materiales: MaterialDeCuenta[];
  resumen: Resumen;
  /** En una venta abierta: materiales de los que ya no alcanza lo disponible. Es aviso; quien rechaza es el libro. */
  avisos: Array<{ material: string; faltan: string }>;
}

export async function verCuenta(bd: Bd, id: string): Promise<Cuenta | null> {
  const [f] = await bd.leer(
    `SELECT o.id, o.tipo, o.etiqueta, o.estado, o.revision, o.folio::text AS folio,
            (o.estado = 'borrador' AND j.cerrada_en IS NOT NULL) AS de_otra_jornada,
            CASE WHEN o.cliente_id IS NOT NULL
                 THEN jsonb_build_object('id', o.cliente_id::text,
                                         'nombre', coalesce(o.cliente_nombre, (SELECT nombre FROM cliente WHERE id = o.cliente_id))) END AS cliente,
            r.materiales AS cuantos, r.por_pesar, r.suma::text AS suma, r.ajuste_redondeo::text AS ajuste, r.total::text AS total,
            coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                       'id', l.id,
                       'material', jsonb_build_object('id', m.id, 'nombre', m.nombre, 'nombreCorto', m.nombre_corto),
                       'bascula', jsonb_build_object('id', i.id, 'nombre', i.nombre, 'doblePesaje', i.doble_pesaje),
                       'precio', l.precio_unitario::text,
                       'precioDeLista', l.precio_lista::text,
                       'eventoDePrecio', l.precio_evento::text,
                       'precioEspecial', CASE WHEN l.precio_autorizado_por IS NOT NULL
                                              THEN jsonb_build_object('autorizo', (SELECT nombre FROM usuario WHERE id = l.precio_autorizado_por)) END,
                       'pesadas', (SELECT coalesce(jsonb_agg(c.valor_kg::text ORDER BY lp.orden), '[]'::jsonb)
                                   FROM linea_pesada lp JOIN captura_peso c ON c.id = lp.captura_id WHERE lp.linea_id = l.id),
                       'porPesar', l.peso_bruto IS NULL,
                       'bruto', l.peso_bruto::text, 'tara', CASE WHEN l.peso_bruto IS NOT NULL THEN l.tara::text END,
                       'recipiente', (CASE WHEN i.doble_pesaje THEN 0 ELSE l.tara END)::numeric(12,3)::text,
                       'descuento', l.descuento_kg::text, 'kg', l.peso_liquidable::text, 'importe', l.importe::text
                     ) ORDER BY l.creada_en, l.id)
              FROM operacion_linea l
              JOIN material m ON m.id = l.material_id
              JOIN instrumento i ON i.id = l.instrumento_id
              WHERE l.operacion_id = o.id), '[]'::jsonb) AS materiales,
            CASE WHEN o.tipo = 'venta' AND o.estado = 'borrador' THEN coalesce((
              SELECT jsonb_agg(jsonb_build_object('material', d.nombre, 'faltan', (-d.disponible_kg)::text) ORDER BY d.nombre)
              FROM disponible d
              WHERE d.disponible_kg < 0
                AND d.material_id IN (SELECT material_id FROM operacion_linea WHERE operacion_id = o.id)), '[]'::jsonb)
            ELSE '[]'::jsonb END AS avisos
     FROM operacion o
     JOIN jornada j ON j.id = o.jornada_id
     JOIN cuenta_resumen r ON r.operacion_id = o.id
     WHERE o.id = $1`,
    [id],
  );
  if (!f) return null;
  return {
    id: f.id, tipo: f.tipo, etiqueta: f.etiqueta, estado: f.estado, revision: f.revision, folio: f.folio,
    deOtraJornada: f.de_otra_jornada,
    cliente: f.cliente,
    materiales: f.materiales,
    resumen: { materiales: f.cuantos, porPesar: f.por_pesar, suma: f.suma, ajuste: f.ajuste, total: f.total },
    avisos: f.avisos,
  };
}

/** La cuenta después de una acción sobre ella. Si ya no está —otra pestaña la descartó—, es una regla, no una falla. */
export async function comoQuedo(bd: Bd, id: string): Promise<Cuenta> {
  const c = await verCuenta(bd, id);
  if (!c) throw new ErrorDeNegocio("RC005", "Esa cuenta ya no está: se descartó");
  return c;
}

export interface CuentaEnLista {
  id: string;
  tipo: "compra" | "venta";
  etiqueta: string | null;
  materiales: number;
  porPesar: number;
  total: string;
  deOtraJornada: boolean;
}

/** Las cuentas sin terminar, en el orden en que se abrieron. Incluye los vehículos que quedaron de otra jornada. */
export const cuentasAbiertas = (bd: Bd): Promise<CuentaEnLista[]> =>
  bd.leer<CuentaEnLista>(
    `SELECT o.id, o.tipo, o.etiqueta, r.materiales, r.por_pesar AS "porPesar", r.total::text AS total,
            j.cerrada_en IS NOT NULL AS "deOtraJornada"
     FROM operacion o
     JOIN jornada j ON j.id = o.jornada_id
     JOIN cuenta_resumen r ON r.operacion_id = o.id
     WHERE o.estado = 'borrador'
     ORDER BY o.creada_en, o.id`,
  );

export async function abrirCuenta(
  bd: Bd, persona: Persona, cuenta: { id: string; tipo: "compra" | "venta"; etiqueta: string | null },
): Promise<Cuenta> {
  await bd.enTransaccion(persona, (c) =>
    c.query("SELECT abrir_cuenta($1, $2, $3, $4)", [cuenta.id, cuenta.tipo, cuenta.etiqueta, persona]));
  return comoQuedo(bd, cuenta.id);
}

export interface EnvioDeMaterial {
  /** Identificadores que genera la pantalla: repetir el envío no agrega otro. */
  linea: string;
  captura: string;
  material: number | string;
  bascula: number | string;
  /** Lo que marcó la báscula, como texto decimal. */
  kg: string;
  /** Lo que pesa vacío el recipiente en que viene, en la báscula chica. Sin recipiente, nada o cero. */
  recipiente?: string;
}

export async function agregarMaterial(bd: Bd, persona: Persona, cuenta: string, envio: EnvioDeMaterial): Promise<Cuenta> {
  await bd.enTransaccion(persona, (c) =>
    c.query("SELECT agregar_material($1, $2, $3, $4::smallint, $5, $6, $7, $8)", [
      cuenta, envio.linea, envio.material, envio.bascula, envio.captura, envio.kg, persona, envio.recipiente ?? "0",
    ]));
  return comoQuedo(bd, cuenta);
}

/**
 * La petición dice de qué cuenta es el material. Si el material es de otra, no se toca: lo que la
 * pantalla tiene a la vista no es lo que cambiaría. Devuelve si el material existe.
 */
async function esDeEstaCuenta(c: pg.PoolClient, cuenta: string, linea: string): Promise<boolean> {
  const { rows } = await c.query("SELECT operacion_id FROM operacion_linea WHERE id = $1", [linea]);
  if (rows.length && rows[0].operacion_id !== cuenta) {
    throw new ErrorDeNegocio("RC005", "Ese material no es de esta cuenta");
  }
  return rows.length > 0;
}

export async function segundaPesada(
  bd: Bd, persona: Persona, cuenta: string, linea: string, envio: { captura: string; kg: string },
): Promise<Cuenta> {
  await bd.enTransaccion(persona, async (c) => {
    await esDeEstaCuenta(c, cuenta, linea);
    await c.query("SELECT segunda_pesada($1, $2, $3, $4)", [linea, envio.captura, envio.kg, persona]);
  });
  return comoQuedo(bd, cuenta);
}

/** Quita el material. Si ya no estaba —un reintento—, devuelve la cuenta como está. */
export async function quitarMaterial(bd: Bd, persona: Persona, cuenta: string, linea: string): Promise<Cuenta> {
  await bd.enTransaccion(persona, async (c) => {
    if (await esDeEstaCuenta(c, cuenta, linea)) await c.query("SELECT quitar_material($1, $2)", [linea, persona]);
  });
  return comoQuedo(bd, cuenta);
}

export async function ponerDescuento(bd: Bd, persona: Persona, cuenta: string, linea: string, kg: string): Promise<Cuenta> {
  await bd.enTransaccion(persona, async (c) => {
    await esDeEstaCuenta(c, cuenta, linea);
    await c.query("SELECT poner_descuento($1, $2, $3)", [linea, kg, persona]);
  });
  return comoQuedo(bd, cuenta);
}

/** Lo que pesa vacío el recipiente de un material ya pesado en la báscula chica. Cero es quitarlo. */
export async function ponerRecipiente(bd: Bd, persona: Persona, cuenta: string, linea: string, kg: string): Promise<Cuenta> {
  await bd.enTransaccion(persona, async (c) => {
    await esDeEstaCuenta(c, cuenta, linea);
    await c.query("SELECT poner_recipiente($1, $2, $3)", [linea, kg, persona]);
  });
  return comoQuedo(bd, cuenta);
}

export async function etiquetar(bd: Bd, persona: Persona, cuenta: string, etiqueta: string | null): Promise<Cuenta> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT etiquetar_cuenta($1, $2, $3)", [cuenta, etiqueta, persona]));
  return comoQuedo(bd, cuenta);
}

export async function descartar(bd: Bd, persona: Persona, cuenta: string): Promise<void> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT descartar_cuenta($1, $2)", [cuenta, persona]));
}

/**
 * Confirma la cuenta tal como se vio. `revision` es la que venía con lo que la pantalla mostró:
 * nunca se lee aquí, porque entonces se confirmaría lo que hay y no lo que la persona revisó.
 */
export async function confirmar(bd: Bd, persona: Persona, cuenta: string, revision: number): Promise<Cuenta> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT confirmar_cuenta($1, $2, $3)", [cuenta, persona, revision]));
  return comoQuedo(bd, cuenta);
}

/**
 * Termina el vehículo que quedó de otra jornada. Lo confirma un responsable, que demuestra serlo
 * con su clave en ese momento; queda él como quien confirmó. Devuelve nada si la clave no pasó.
 *
 * La clave la comprueba la base, dentro de la misma función que confirma: no hay forma de
 * terminar el vehículo sin ella. Cuando no pasa, la función contesta sin error y la transacción
 * se confirma, de modo que el intento fallido queda contado.
 */
export async function terminarVehiculo(
  bd: Bd, huella: string, quien: { responsable: Persona; clave: string }, cuenta: string, revision: number,
): Promise<Cuenta | null> {
  const hecha = await bd.enTransaccion(quien.responsable, async (c) =>
    (await c.query("SELECT id FROM terminar_vehiculo($1, $2, $3, $4, $5)", [cuenta, revision, quien.responsable, quien.clave, huella])).rows[0].id);
  return hecha ? comoQuedo(bd, cuenta) : null;
}
