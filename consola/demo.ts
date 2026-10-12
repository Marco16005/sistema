// Historia inventada para la demostración local. Nunca se usa fuera de desarrollo.
import pg from "pg";

const EXCLUIDAS = [
  "sesion", "equipo", "codigo_alta", "credencial", "migracion", "vida", "restauracion",
  "mantenimiento", "mantenimiento_publicacion", "respaldo_diario",
];
const identificador = (s: string): string => '"' + s.replaceAll('"', '""') + '"';

/** Solo tablas reales: las vistas también exponen marcas, pero no se actualizan. */
async function columnasDelTiempo(db: pg.Client): Promise<Map<string, string[]>> {
  const { rows } = await db.query(`
    SELECT c.table_name AS tabla, c.column_name AS columna
    FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.data_type = 'timestamp with time zone' AND NOT c.table_name = ANY($1)
    ORDER BY c.table_name, c.ordinal_position`, [EXCLUIDAS]);
  const tablas = new Map<string, string[]>();
  for (const { tabla, columna } of rows) tablas.set(tabla, [...(tablas.get(tabla) ?? []), columna]);
  return tablas;
}

async function desplazar(db: pg.Client, columnas: Map<string, string[]>, desde: Date, destino: Date): Promise<void> {
  for (const [tabla, nombres] of columnas) {
    const cols = nombres.map(identificador);
    await db.query(`UPDATE public.${identificador(tabla)} SET ${cols.map(c =>
      `${c} = CASE WHEN ${c} >= $1 THEN ${c} + ($2::timestamptz - $1::timestamptz) ELSE ${c} END`).join(', ')}
      WHERE ${cols.map(c => `${c} >= $1`).join(' OR ')}`, [desde, destino]);
  }
}

async function conReplica(db: pg.Client, accion: () => Promise<void>): Promise<void> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL session_replication_role = replica");
    await accion();
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}

/** Recorre en el tiempo todo lo que nació desde `desde`: queda como si hubiera nacido en `destino`.
 * Usa una conexión de administración ociosa: esta función es dueña de su transacción.
 */
export async function recorrer(db: pg.Client, desde: Date, destino: Date): Promise<void> {
  const columnas = await columnasDelTiempo(db);
  await conReplica(db, () => desplazar(db, columnas, desde, destino));
}

import { createHash, randomInt, randomUUID } from "node:crypto";
import { crearBd } from "../src/servidor/bd.ts";
import { abrirCuenta, agregarMaterial, confirmar } from "../src/servidor/dominio/cuentas.ts";
import { cerrarJornada } from "../src/servidor/dominio/cierre.ts";
import { estadoDelDia, terminarArranque } from "../src/servidor/dominio/dia.ts";
import { contar, darMerma, previaDeConteo } from "../src/servidor/dominio/inventario.ts";
import { darPrecioEspecial } from "../src/servidor/dominio/precio-especial.ts";

export interface Sembrado {
  dias: number;
  cuentas: number;
  personas: Array<{ nombre: string; rol: string; clave: string }>;
}

/** Mulberry32: solo los datos del negocio dependen de la semilla, nunca claves ni UUID. */
function generador(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => {
    let t = estado += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function nuevaClave(): string {
  for (;;) {
    const clave = randomInt(0, 1000000).toString().padStart(6, '0');
    if (!/^(.)\1+$/.test(clave) && !'0123456789'.includes(clave) && !'9876543210'.includes(clave)) return clave;
  }
}

/**
 * De a cuánto se mueve un material según lo que vale el kilo: los gramos (milésimas de kilo) entre
 * los que cae una compra de menudeo, y los kilos que hay que juntar para que valga la pena venderlo.
 */
const lote = (precio: number): { compra: [number, number]; venta: number } =>
  precio >= 50 ? { compra: [300, 6000], venta: 40 } : precio >= 15 ? { compra: [1000, 20000], venta: 120 } : { compra: [4000, 90000], venta: 400 };

/** Los precios se dicen redondos: al peso lo caro, a cincuenta centavos lo de en medio y a diez lo barato. */
const paso = (precio: number): number => (precio >= 50 ? 1 : precio >= 10 ? 0.5 : 0.1);
const redondo = (precio: number): number => Math.round(precio / paso(precio)) * paso(precio);
/** El precio de compra y el de venta como se publican: redondos, y el de venta siempre arriba del de compra. */
function alPublico(p: { compra: number; margen: number }): [string, string] {
  const compra = redondo(p.compra);
  return [compra.toFixed(2), Math.max(redondo(compra * p.margen), compra + paso(compra)).toFixed(2)];
}

/** Le da a una base de desarrollo `dias` días de historia verosímil, hasta ayer, y deja hoy abierto y con precios. */
export async function sembrarDemo(o: {
  url: string;
  dias?: number;
  semilla?: number;
  decir?: (linea: string) => void;
}): Promise<Sembrado> {
  if (process.env.MODO !== 'desarrollo') throw new Error('La demostración solo se siembra con MODO=desarrollo');
  const dias = o.dias ?? 56;
  if (!Number.isInteger(dias) || dias < 2 || dias > 120) throw new Error('La demostración requiere entre 2 y 120 días enteros');
  const semilla = o.semilla ?? 1;
  if (!Number.isSafeInteger(semilla)) throw new Error('La semilla debe ser un entero seguro');
  const azar = generador(semilla);
  const entero = (min: number, max: number): number => min + Math.floor(azar() * (max - min + 1));
  const elegir = <T>(lista: T[]): T => lista[entero(0, lista.length - 1)]!;
  const db = new pg.Client({ connectionString: o.url, connectionTimeoutMillis: 10000 });
  const bd = crearBd(o.url, { conexiones: 1 });
  const resultado: Sembrado = { dias: 0, cuentas: 0, personas: [] };
  await db.connect();
  try {
    // Evita que dos sembradores mezclen sus marcas. La consola debe usarse sin otras escrituras.
    await db.query('SELECT pg_advisory_lock(714014, 1)');
    const { rows: [estado] } = await db.query(`SELECT
      EXISTS (SELECT 1 FROM operacion WHERE estado = 'confirmada') AS movimiento,
      (SELECT count(*)::int FROM jornada) AS jornadas,
      EXISTS (SELECT 1 FROM jornada WHERE cerrada_en IS NOT NULL) AS cerrada,
      hoy_en(1::smallint)::text AS hoy, clock_timestamp() AS ahora,
      (SELECT zona FROM sucursal WHERE id = 1) AS zona`);
    if (estado.movimiento) throw new Error('la demostración ya tiene movimiento: solo se siembra sobre una base sin cuentas. Si es una siembra que se interrumpió, no se retoma: hay que empezar con una base nueva');
    if (estado.jornadas > 1 || estado.cerrada) throw new Error('La demostración requiere ninguna jornada o una sola jornada abierta');
    const columnas = await columnasDelTiempo(db);
    const { rows: fechas } = await db.query(`SELECT d::date::text AS fecha, extract(dow FROM d)::int AS semana,
        (d::date + time '00:00') AT TIME ZONE $2 AS medianoche
      FROM generate_series($1::date - $3::int, $1::date, interval '1 day') d
      WHERE extract(dow FROM d) <> 0 OR d::date = $1::date ORDER BY d`, [estado.hoy, estado.zona, dias]);
    const primera = fechas[0]!;
    const momento = (dia: typeof primera, minutos: number): Date => new Date(dia.medianoche.getTime() + minutos * 60000);
    const reloj = async (): Promise<Date> => (await db.query('SELECT clock_timestamp() AS t')).rows[0].t;
    // Se descubre el catálogo de columnas una vez por sembrado, sin guardarlo entre bases.
    const llevar = async <T>(destino: Date, accion: () => Promise<T>): Promise<T> => {
      const desde = await reloj(); // ANTES del BEGIN de cada acción: now() usa el inicio de su transacción.
      const valor = await accion();
      await conReplica(db, () => desplazar(db, columnas, desde, destino));
      return valor;
    };
    const sql = async (quien: string | null, consulta: string, valores: unknown[] = []) =>
      bd.enTransaccion(quien, async c => (await c.query(consulta, valores)).rows);

    // La instalación puede llevar una semana viva. Se conserva todo; su historia previa se
    // comprime, en orden, a los 30 minutos iniciales para que quepa en el primer día.
    const union = [...columnas].flatMap(([t, cs]) => cs.map(c =>
      `SELECT ${identificador(c)} AS t FROM public.${identificador(t)} WHERE ${identificador(c)} IS NOT NULL`)).join(' UNION ALL ');
    const extremos = (await db.query(`SELECT min(t)::text AS primero, max(t)::text AS ultimo FROM (${union}) x`)).rows[0];
    await conReplica(db, async () => {
      if (extremos.primero) {
        for (const [tabla, cs] of columnas) {
          await db.query(`UPDATE public.${identificador(tabla)} SET ${cs.map(nombre => {
            const c = identificador(nombre);
            return `${c} = $3::timestamptz + (${c} - $1::timestamptz) *
              least(1.0, 1800.0 / greatest(1.0, extract(epoch FROM ($2::timestamptz - $1::timestamptz))))`;
          }).join(', ')} WHERE ${cs.map(c => `${identificador(c)} IS NOT NULL`).join(' OR ')}`,
          [extremos.primero, extremos.ultimo, momento(primera, 420)]);
        }
      }
      if (estado.jornadas) await db.query('UPDATE jornada SET fecha = $1::date', [primera.fecha]);
    });

    const personas = (await db.query('SELECT id, nombre, rol, puede_autorizar, activo FROM usuario ORDER BY id')).rows;
    const agregarPersona = async (rol: string, preferido: string, autoriza = false) => {
      const nombres = [preferido, 'Marta', 'Rosa', 'Beto', 'Ana', 'Luis', 'Pedro', 'Elena', 'Juan'];
      let nombre = nombres.find(n => !personas.some(p => p.nombre.toLocaleLowerCase() === n.toLocaleLowerCase()));
      for (let n = 2; !nombre; n++) {
        const candidato = `${preferido} ${n}`;
        if (!personas.some(p => p.nombre.toLocaleLowerCase() === candidato.toLocaleLowerCase())) nombre = candidato;
      }
      const clave = nuevaClave();
      const [p] = await llevar(momento(primera, 452), () => sql(null,
        'SELECT * FROM alta_persona($1, $2, $3, $4)', [nombre, rol, autoriza, clave]));
      personas.push(p);
      resultado.personas.push({ nombre: nombre!, rol, clave });
      return p;
    };
    if (!personas.some(p => p.activo && p.rol === 'responsable')) await agregarPersona('responsable', 'Marta', true);
    // Dos personas de mostrador: la existente y una más; con una base vacía, se dan ambas de alta.
    while (personas.filter(p => p.activo && p.rol === 'mostrador').length < 2) await agregarPersona('mostrador', 'Rosa');
    for (const [rol, nombre] of [['patio', 'Beto'], ['consulta', 'Ana']]) {
      if (!personas.some(p => p.activo && p.rol === rol)) await agregarPersona(rol!, nombre!);
    }
    // Las claves que ya existen son de sus dueños: no se conocen ni se cambian. Lo que pide
    // autorización —los conteos y los precios especiales— lo autoriza un responsable que el
    // sembrador dio de alta; si ya había uno, se agrega otro.
    let credencialDemo = resultado.personas.find(p => p.rol === 'responsable');
    if (!credencialDemo) {
      await agregarPersona('responsable', 'Elena', true);
      credencialDemo = resultado.personas.at(-1)!;
    }
    const responsable = personas.find(p => p.activo && p.rol === 'responsable')!.id as string;
    const mostradores = personas.filter(p => p.activo && p.rol === 'mostrador').map(p => p.id as string);
    const materiales = (await db.query(`SELECT m.id, m.nombre, m.frecuente, f.nombre AS familia
      FROM material m JOIN familia f ON f.id = m.familia_id WHERE m.activo AND m.sucursal_id = 1 ORDER BY m.id`)).rows;
    if (!materiales.length) throw new Error('La demostración necesita materiales activos');
    const precios = new Map<number, { compra: number; margen: number }>();
    for (const m of materiales) {
      // De qué orden es el kilo de cada cosa. El cobre y el bronce comparten familia, así que esos
      // dos se distinguen por su nombre; lo demás, por su familia. Son precios de demostración.
      const [propio, familia] = [m.nombre.toLowerCase(), m.familia.toLowerCase()];
      const base = /cobre de segunda/.test(propio) ? 128 : /cobre/.test(propio) ? 150 : /bronce/.test(propio) ? 85
        : /aluminio/.test(familia) ? 28 : /fierro/.test(familia) ? 6
        : /papel/.test(familia) ? 2.2 : /pl[aá]stico/.test(familia) ? 7 : 22;
      precios.set(m.id, { compra: base * (0.9 + azar() * 0.2), margen: 1.12 + azar() * 0.13 });
    }
    if (!(await estadoDelDia(bd)).arranqueTerminado) {
      // Completa el arranque sin duplicar saldos que alguien ya haya capturado. De cada material hay
      // del orden de un lote: unos kilos de lo caro, cientos de lo barato.
      const abiertos = new Set((await db.query("SELECT material_id FROM movimiento_inventario WHERE tipo = 'apertura'")).rows.map(f => f.material_id));
      const saldos = materiales.filter(m => !abiertos.has(m.id)).map(m => {
        const junto = lote(precios.get(m.id)!.compra).venta;
        return { material: m.id, kg: entero(Math.round(junto * 0.5), Math.round(junto * 2.5)).toFixed(3), origen: 'estimado' as const };
      });
      await llevar(momento(primera, 455), () => terminarArranque(bd, responsable, saldos));
    }
    const autorizacion = { autoriza: personas.find(p => p.nombre === credencialDemo!.nombre)!.id as string, clave: credencialDemo!.clave };
    // El equipo desde el que «se autoriza»: uno de demostración, que ningún navegador tiene.
    const huella = createHash('sha256').update(randomUUID()).digest('hex');
    await llevar(momento(primera, 457), async () => {
      const [codigo] = await sql(responsable, "SELECT crear_codigo_alta('Demostración', $1) AS codigo", [responsable]);
      await sql(responsable, 'SELECT canjear_codigo($1, $2)', [codigo.codigo, huella]);
    });
    const frecuentes = materiales.filter(m => m.frecuente);
    let siguienteMerma = entero(2, 4);
    let semanaContada = '';
    let especiales = 0;
    for (const [indice, dia] of fechas.entries()) {
      const hoy = dia.fecha === estado.hoy;
      // Hoy puede ser domingo: se deja preparado, sin atender. Antes de las 8, tampoco hay cuentas.
      const limite = hoy ? estado.ahora.getTime() : Infinity;
      const temprano = (minutos: number) => new Date(Math.min(momento(dia, minutos).getTime(), limite - 60000));
      if (indice > 0 || !estado.jornadas) {
        await llevar(temprano(470), () => sql(responsable,
          'SELECT * FROM abrir_jornada(1::smallint, $1::date, $2)', [estado.hoy, responsable]));
      }
      const actual = await estadoDelDia(bd);
      // Los precios especiales exigen que la jornada sea la de hoy. Se trabaja ahora,
      // y al cerrar se devuelve también su fecha civil al día inventado.
      if (indice === 0 && estado.jornadas) await conReplica(db, async () => {
        await db.query('UPDATE jornada SET fecha = $1::date WHERE id = $2', [estado.hoy, actual.jornada!.id]);
      });
      let cambios = materiales;
      if (indice > 0) {
        cambios = [];
        if (azar() < 0.6) {
          const candidatos = [...materiales];
          const cuantos = entero(1, Math.min(3, candidatos.length));
          for (let n = 0; n < cuantos; n++) {
            const [m] = candidatos.splice(entero(0, candidatos.length - 1), 1);
            cambios.push(m);
            precios.get(m.id)!.compra *= 1 + (azar() < 0.5 ? -1 : 1) * (0.02 + azar() * 0.04);
          }
        }
      }
      await llevar(temprano(475), () => bd.enTransaccion(responsable, async c => {
        for (const m of cambios) {
          const [compra, venta] = alPublico(precios.get(m.id)!);
          await c.query('SELECT fijar_precio($1, $2, $3, $4)', [m.id, compra, venta, responsable]);
        }
        await c.query('SELECT publicar_lista($1, $2)', [actual.lista!.id, responsable]);
      }));
      const compras = dia.semana === 6 ? entero(15, 22) : entero(23, 40);
      const ventas = dia.semana === 6 ? entero(1, 2) : entero(2, 5);
      const turnos = Array.from({ length: compras + ventas }, (_, n) => ({
        tipo: n < compras ? 'compra' as const : 'venta' as const,
        minuto: azar() < 0.72 ? entero(540, 779) : entero(480, 1075),
      })).sort((a, b) => a.minuto - b.minuto);
      let ultimo = 480;
      let cuentasDelDia = 0;
      let especialDelDia = false;
      for (const turno of turnos) {
        // Se separan también las cuentas que sortearon el mismo minuto.
        ultimo = Math.max(ultimo + 1, turno.minuto);
        const destino = momento(dia, ultimo);
        if (hoy && (dia.semana === 0 || destino.getTime() + 60000 > limite)) continue;
        const quien = azar() < 0.12 ? responsable : elegir(mostradores);
        const renglones: Array<{ material: number; kg: string; bascula: number }> = [];
        if (turno.tipo === 'compra') {
          const cuantos = entero(1, Math.min(3, materiales.length));
          const usados = new Set<number>();
          for (let n = 0; n < cuantos; n++) {
            const bolsa = (azar() < 0.8 && frecuentes.length ? frecuentes : materiales).filter(m => !usados.has(m.id));
            const m = elegir(bolsa.length ? bolsa : materiales.filter(m => !usados.has(m.id)));
            usados.add(m.id);
            // Lo caro llega de a poco y lo barato por costales: nadie trae sesenta kilos de cobre al menudeo.
            const [minimo, maximo] = lote(precios.get(m.id)!.compra).compra;
            renglones.push({ material: m.id, kg: (entero(minimo, maximo) / 1000).toFixed(3), bascula: entero(2, 3) });
          }
        } else {
          // Se vende lo que ya se juntó, y primero lo que más vale: uno o dos lotes, casi enteros. Así
          // el patio no se llena sin fin. Un arranque con poco no vende hasta juntar: no se inventa inventario.
          const juntados = (await db.query(`SELECT d.material_id, d.disponible_kg::text AS kg
            FROM disponible d JOIN material m ON m.id = d.material_id
            WHERE m.activo AND d.disponible_kg > 0 ORDER BY d.material_id`)).rows
            .map(f => ({ material: f.material_id as number, kg: Number(f.kg), precio: precios.get(f.material_id)!.compra }))
            .filter(j => j.kg >= lote(j.precio).venta)
            .sort((x, y) => y.kg * y.precio - x.kg * x.precio || x.material - y.material);
          if (!juntados.length) continue;
          for (const j of juntados.slice(0, entero(1, 2))) {
            // Hasta 950 kg por pesada: las básculas chicas llegan a mil.
            const kg = Math.min(950, Math.floor(j.kg * (0.6 + azar() * 0.35)));
            renglones.push({ material: j.material, kg: kg.toFixed(3), bascula: entero(2, 3) });
          }
        }
        await llevar(destino, async () => {
          let c = await abrirCuenta(bd, quien, { id: randomUUID(), tipo: turno.tipo, etiqueta: 'Demostración' });
          for (const renglon of renglones) c = await agregarMaterial(bd, quien, c.id, {
            linea: randomUUID(), captura: randomUUID(), ...renglon,
          });
          if (!hoy && turno.tipo === 'compra' && indice % 3 === 0 && !especialDelDia) {
            const nombre = ['Don Chuy (demostración)', 'Doña Lupita (demostración)', 'Taller López (demostración)'][especiales % 3]!;
            const cliente = (await db.query('SELECT id FROM cliente WHERE nombre = $1', [nombre])).rows[0];
            const especial = await darPrecioEspecial(bd, quien, huella, {
              id: randomUUID(), cuenta: c.id, linea: c.materiales[0]!.id, visto: null,
              cliente: cliente?.id ?? null, clienteNuevo: cliente ? null : nombre,
              diferencia: '0.1500', ...autorizacion,
            });
            if (!especial) throw new Error('No se pudo autorizar el precio de demostración');
            c = especial;
            especialDelDia = true;
            especiales++;
          }
          await confirmar(bd, quien, c.id, c.revision);
        });
        resultado.cuentas++;
        cuentasDelDia++;
      }
      if (!hoy) {
        const control = momento(dia, Math.max(1080, ultimo + 2));
        const disponibles = (await db.query(`SELECT material_id, kg::text AS kg FROM existencia
          WHERE kg > 5 ORDER BY material_id`)).rows;
        if (indice >= siguienteMerma && disponibles.length) {
          const m = elegir(disponibles);
          await llevar(control, () => darMerma(bd, mostradores[0]!, {
            id: randomUUID(), material: m.material_id, kg: (entero(250, 1500) / 1000).toFixed(3),
            motivo: 'Demostración: humedad y residuos al separar',
          }));
          siguienteMerma = indice + entero(3, 5);
        }
        const semana = (await db.query("SELECT to_char(date_trunc('week', $1::date), 'YYYY-MM-DD') AS semana", [dia.fecha])).rows[0].semana;
        if (semana !== semanaContada && disponibles.length) {
          const m = elegir(disponibles);
          // Se relee después de la merma. La previa se obtiene después del marcador del recorrido.
          const kg = (await db.query('SELECT kg::text FROM existencia WHERE material_id = $1', [m.material_id])).rows[0].kg;
          const contado = (Number(kg) - entero(100, 500) / 1000).toFixed(3);
          await llevar(new Date(control.getTime() + 60000), async () => {
            const previa = await previaDeConteo(bd, m.material_id, contado, null);
            const hecho = await contar(bd, mostradores[0]!, huella, {
              id: randomUUID(), material: m.material_id, contado, contadoEn: previa.contadoEn,
              registrado: previa.registrado, nota: 'Demostración: conteo semanal inventado', ...autorizacion,
            });
            if (!hecho) throw new Error('No se pudo autorizar el conteo de demostración');
          });
          semanaContada = semana;
        }
        const d = await estadoDelDia(bd);
        await llevar(momento(dia, Math.max(1085, ultimo + 5)), () => cerrarJornada(bd, responsable, {
          id: randomUUID(), jornada: d.jornada!.id, cierres: d.jornada!.cierres,
        }));
        await conReplica(db, async () => {
          await db.query('UPDATE jornada SET fecha = $1::date WHERE id = $2', [dia.fecha, d.jornada!.id]);
        });
        resultado.dias++;
      }
      o.decir?.(`Demostración · ${dia.fecha}: ${cuentasDelDia} cuentas; ${hoy ? 'abierta' : 'cerrada'}`);
    }
    return resultado;
  } finally {
    await bd.cerrar();
    await db.end(); // También libera el candado de sesión en errores.
  }
}

