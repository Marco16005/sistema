// A qué horas toca respaldo. El horario se escribe como horas del día, en la hora del lugar
// («07:00,08:00,…»), y de ahí salen los instantes: cuál es el siguiente, y cuál fue el último que
// ya debía haberse tomado. Son cuentas puras —no miran el reloj ni duermen— para poder probarlas
// con la medianoche y con los cambios de horario.
//
// Con cambio de horario cada hora del día dispara una sola vez: la que no existe ese día (el reloj
// salta) se recorre lo que dura el salto —las 02:30 caen a las 03:30—; la que ocurre dos veces (el
// reloj regresa), la primera.

export interface Hora {
  h: number;
  m: number;
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DIA = 24 * 3_600_000;

/** Lee «07:00,08:00,19:30». Las deja en orden y sin repetir. Cualquier otra cosa es un error: un horario mal escrito no se adivina. */
export function leerHorario(texto: string): Hora[] {
  const horas = new Map<number, Hora>();
  for (const trozo of texto.split(",")) {
    const m = HORA.exec(trozo.trim());
    if (!m) throw new Error(`El horario de respaldo no se entiende: «${texto}». Va como horas del día separadas por coma, por ejemplo 07:00,08:00,19:30`);
    const hora = { h: Number(m[1]), m: Number(m[2]) };
    horas.set(hora.h * 60 + hora.m, hora);
  }
  return [...horas.entries()].sort(([a], [b]) => a - b).map(([, hora]) => hora);
}

const formatos = new Map<string, Intl.DateTimeFormat>();

/** La fecha y la hora que marca el reloj de ese lugar en ese instante, como si fueran UTC. */
function pared(zona: string, instante: number): number {
  let formato = formatos.get(zona);
  if (!formato) {
    formato = new Intl.DateTimeFormat("en-US", {
      timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatos.set(zona, formato);
  }
  const p: Record<string, number> = {};
  for (const parte of formato.formatToParts(instante)) if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/** Cuánto va adelantado el reloj de ese lugar respecto de UTC en ese instante. */
const desfase = (zona: string, instante: number): number => pared(zona, instante) - Math.floor(instante / 1000) * 1000;

/** El instante en que el reloj de ese lugar marca esa fecha y hora (dadas como si fueran UTC). */
function instanteDe(zona: string, enPared: number): number {
  // Los dos desfases que puede haber alrededor: el de antes y el de después de un cambio de horario.
  const candidatos = [desfase(zona, enPared - DIA), desfase(zona, enPared + DIA)].map((d) => enPared - d);
  const exactos = candidatos.filter((t) => pared(zona, t) === enPared);
  // Si la hora ocurre dos veces, la primera. Si no existe, la que resulta de recorrerla lo que dura el salto.
  return exactos.length > 0 ? Math.min(...exactos) : Math.max(...candidatos);
}

/** Los instantes de respaldo de los días alrededor de ese, en orden y sin repetir. */
function alrededor(horario: readonly Hora[], zona: string, de: Date): number[] {
  const hoy = pared(zona, de.getTime());
  const medianoche = hoy - (((hoy % DIA) + DIA) % DIA);
  const instantes = new Set<number>();
  for (let dia = -2; dia <= 2; dia += 1) {
    for (const hora of horario) instantes.add(instanteDe(zona, medianoche + dia * DIA + (hora.h * 60 + hora.m) * 60_000));
  }
  return [...instantes].sort((a, b) => a - b);
}

/** El primer momento de respaldo estrictamente posterior a ese instante. */
export function siguiente(horario: readonly Hora[], zona: string, despuesDe: Date): Date {
  const t = alrededor(horario, zona, despuesDe).find((instante) => instante > despuesDe.getTime());
  if (t === undefined) throw new Error("El horario de respaldo está vacío");
  return new Date(t);
}

/** El último momento de respaldo que ya llegó a ese instante. */
export function ultimoDebido(horario: readonly Hora[], zona: string, hasta: Date): Date {
  const t = alrededor(horario, zona, hasta).filter((instante) => instante <= hasta.getTime()).at(-1);
  if (t === undefined) throw new Error("El horario de respaldo está vacío");
  return new Date(t);
}

/**
 * ¿Toca respaldar ahora? Sí, si nunca se ha respaldado, si el último respaldo es anterior a la
 * última hora debida, o si el último respaldo es «del futuro»: el reloj retrocedió, y esperar a que
 * lo rebase dejaría horas sin respaldar.
 */
export function toca(horario: readonly Hora[], zona: string, ahora: Date, ultimoRespaldo: Date | null): boolean {
  if (ultimoRespaldo === null || ultimoRespaldo.getTime() > ahora.getTime()) return true;
  return ultimoRespaldo.getTime() < ultimoDebido(horario, zona, ahora).getTime();
}
