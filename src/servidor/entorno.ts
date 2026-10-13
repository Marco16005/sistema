// Lo que cada proceso pide de su entorno para arrancar. Nada arranca con valores de desarrollo si
// no se dijo expresamente que es desarrollo (MODO=desarrollo): ni el migrador, ni la consola, ni la
// aplicación, ni el respaldo. Cada uno lo comprueba al iniciar, con esta misma función y por su
// cuenta: la garantía no depende de un paso previo que se pueda saltar, ni de que exista el
// archivo de entorno.
//
// Los mensajes dicen qué variable falla y por qué. Nunca repiten su valor.

/** Lo que usa cada proceso: las claves de la base, la aplicación, el respaldo, y el sitio publicado. */
export type Parte = "administracion" | "conexion" | "aplicacion" | "respaldo" | "sitio";

type Entorno = Record<string, string | undefined>;

/** Los valores que traen el archivo de desarrollo y los recorridos. Fuera de desarrollo no valen. */
const DE_DESARROLLO = new Set([
  "desarrollo", "desarrollo_web", "recorrido", "recorrido_web",
  "solo-para-desarrollo-cambiar-antes-de-usar-en-serio", "una-clave-solo-para-los-recorridos-0123456789",
]);

const NOMBRE_DE_MAQUINA = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const ORIGEN_SEGURO = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;
const LLAVE_PUBLICA_DE_AGE = /^age1[0-9a-z]{58}$/;
/** «remoto:cubo/carpeta»: el remoto de rclone y el camino dentro de él. */
const DESTINO_DE_RESPALDO = /^([A-Za-z0-9_]+):[^:]+$/;
/** Horas del día separadas por coma: 07:00,08:00,19:30. El respaldo las lee con la misma regla. */
const HORARIO = /^\s*([01]\d|2[0-3]):[0-5]\d\s*(,\s*([01]\d|2[0-3]):[0-5]\d\s*)*$/;

/** Quién se conecta y con qué clave, según la dirección de conexión. */
function deLaDireccion(direccion: string | undefined): { usuario: string; clave: string } | null {
  if (!direccion) return null;
  try {
    const u = new URL(direccion);
    return { usuario: decodeURIComponent(u.username), clave: decodeURIComponent(u.password) };
  } catch {
    return null;
  }
}

/** Una clave que viaja dentro de una dirección de conexión: larga, al azar, de letras y números. */
function claveDeBase(nombre: string, valor: string | undefined): string | null {
  if (!valor) return `Falta ${nombre}`;
  if (DE_DESARROLLO.has(valor)) return `${nombre} trae el valor de desarrollo`;
  if (!/^[A-Za-z0-9]+$/.test(valor)) return `${nombre} debe llevar solo letras y números: viaja dentro de una dirección`;
  if (valor.length < 20) return `${nombre} debe tener 20 caracteres o más`;
  return null;
}

/** Lo que le falta al entorno para esas partes. Vacío: está bien. En desarrollo, dicho expresamente, no se exige nada. */
export function faltasDelEntorno(env: Entorno, partes: readonly Parte[]): string[] {
  if (env.MODO === "desarrollo") return [];
  const faltas: string[] = [];
  const anotar = (falta: string | null): void => {
    if (falta) faltas.push(falta);
  };
  const pide = (parte: Parte): boolean => partes.includes(parte);

  // Cada contenedor recibe la clave que usa dentro de su dirección de conexión: el migrador, la del
  // dueño de la base; la aplicación, la de su usuario.
  const direccion = deLaDireccion(env.DATABASE_URL);
  const bdClave = env.BD_CLAVE ?? (direccion?.usuario === "feruga" ? direccion.clave : undefined);
  const webClave = env.WEB_BD_CLAVE ?? (direccion && direccion.usuario !== "feruga" ? direccion.clave : undefined);

  if (pide("administracion")) anotar(claveDeBase("BD_CLAVE", bdClave));
  if (pide("conexion")) {
    anotar(claveDeBase("WEB_BD_CLAVE", webClave));
    if (webClave && bdClave && webClave === bdClave) faltas.push("WEB_BD_CLAVE debe ser distinta de BD_CLAVE");
  }

  const origenes = (env.ORIGEN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (pide("aplicacion")) {
    const sesion = env.SESION_CLAVE;
    if (!sesion) faltas.push("Falta SESION_CLAVE");
    else if (DE_DESARROLLO.has(sesion)) faltas.push("SESION_CLAVE trae el valor de desarrollo");
    else if (sesion.length < 32) faltas.push("SESION_CLAVE debe tener 32 caracteres o más");
    if (env.COOKIE_SEGURA !== "1") faltas.push("COOKIE_SEGURA debe ser 1: la cookie solo viaja por HTTPS");
    if (origenes.length === 0) faltas.push("Falta ORIGEN");
    else if (!origenes.every((o) => ORIGEN_SEGURO.test(o))) faltas.push("ORIGEN debe ser https:// y el nombre del sitio, sin ruta");
  }

  if (pide("respaldo")) {
    // El sello dice quién tomó cada respaldo: se saca de la llave privada, fuera del servidor (operacion/sello.ts).
    if (!env.RESPALDO_SELLO) faltas.push("Falta RESPALDO_SELLO");
    else if (!/^[0-9a-f]{64}$/.test(env.RESPALDO_SELLO)) {
      faltas.push("RESPALDO_SELLO no tiene su forma (64 letras hexadecimales): es lo que da operacion/sello.ts con la llave privada. La llave privada misma no va aquí");
    }
    if (!env.RESPALDO_LLAVE_PUBLICA) faltas.push("Falta RESPALDO_LLAVE_PUBLICA");
    else if (!LLAVE_PUBLICA_DE_AGE.test(env.RESPALDO_LLAVE_PUBLICA)) {
      faltas.push("RESPALDO_LLAVE_PUBLICA no tiene la forma de una llave pública de age (empieza con age1). La privada no va aquí");
    }
    /**
     * Un destino: «remoto:cubo/carpeta», con su remoto configurado. Devuelve cuál es su depósito, si
     * tiene buena forma: a dónde llega —qué clase de almacenamiento, en qué servicio, qué cubo—, no
     * cómo se llama el remoto. Dos remotos con otro nombre que llevan al mismo cubo son un solo depósito.
     */
    const deposito = (cual: "RESPALDO_DESTINO" | "RESPALDO_DESTINO_DIARIO"): string | null => {
      const destino = DESTINO_DE_RESPALDO.exec(env[cual] ?? "");
      if (!env[cual]) faltas.push(`Falta ${cual}`);
      else if (!destino) faltas.push(`${cual} va como remoto:cubo/carpeta`);
      else {
        // El remoto se configura en el entorno, con las variables de rclone: ahí va la credencial del almacenamiento.
        const variable = (nombre: string): string => `RCLONE_CONFIG_${destino[1]!.toUpperCase()}_${nombre}`;
        if (!env[variable("TYPE")]) faltas.push(`Falta ${variable("TYPE")}: el remoto «${destino[1]}» de ${cual} no está configurado`);
        else if (env[variable("TYPE")] === "s3") {
          for (const nombre of ["ACCESS_KEY_ID", "SECRET_ACCESS_KEY"]) if (!env[variable(nombre)]) faltas.push(`Falta ${variable(nombre)}`);
        }
        const servicio = (env[variable("ENDPOINT")] ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
        const cubo = env[cual]!.slice(destino[1]!.length + 1).split("/")[0]!;
        return [(env[variable("TYPE")] ?? "").toLowerCase(), servicio, cubo].join(" ");
      }
      return null;
    };
    /**
     * La señal de un vigilante, como se le avisa (operacion/respaldar.ts le quita las diagonales del
     * final, y el nombre de la máquina no distingue mayúsculas). Nula si no es una dirección https://
     * completa; y no lleva usuario ni contraseña, que acabarían impresos en un registro.
     */
    const senal = (cual: "RESPALDO_VIGIA_URL" | "RESPALDO_VIGIA_DIARIO_URL", paraQue: string): string | null => {
      const valor = env[cual];
      if (!valor) {
        faltas.push(`Falta ${cual}: ${paraQue}`);
        return null;
      }
      let u: URL | null = null;
      try {
        u = new URL(valor);
      } catch {
        u = null;
      }
      if (!u || u.protocol !== "https:" || !/^https:\/\/[^\s/]+\/\S*$/i.test(valor)) {
        faltas.push(`${cual} debe ser una dirección https:// completa`);
        return null;
      }
      if (u.username !== "" || u.password !== "") {
        faltas.push(`${cual} no lleva usuario ni contraseña: la señal va en la ruta de la dirección`);
        return null;
      }
      return `${u.origin}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    };
    const deCadaHora = deposito("RESPALDO_DESTINO");
    // El respaldo diario se guarda un año, y el candado lo da el depósito: tiene que ser otro.
    const diario = deposito("RESPALDO_DESTINO_DIARIO");
    if (diario && diario === deCadaHora) {
      faltas.push("RESPALDO_DESTINO_DIARIO debe ser otro depósito que el de RESPALDO_DESTINO: cada uno retiene por su plazo, 30 días y un año");
    }
    if (!env.RESPALDO_HORARIO) faltas.push("Falta RESPALDO_HORARIO");
    else if (!HORARIO.test(env.RESPALDO_HORARIO)) faltas.push("RESPALDO_HORARIO va como horas del día separadas por coma: 07:00,08:00,19:30");
    // Sin vigilante nadie se entera de que un respaldo no se tomó: no se opera sin él.
    const deCadaRespaldo = senal("RESPALDO_VIGIA_URL", "a quién se le avisa de cada respaldo");
    // El diario avisa por su propia señal: si compartiera la del respaldo de cada hora, su fallo apagaría el aviso de un respaldo bueno.
    const delDiario = senal("RESPALDO_VIGIA_DIARIO_URL", "a quién se le avisa del respaldo diario");
    if (delDiario !== null && delDiario === deCadaRespaldo) faltas.push("RESPALDO_VIGIA_DIARIO_URL debe ser su propia señal, no la de RESPALDO_VIGIA_URL");
  }

  if (pide("sitio")) {
    if (!env.DOMINIO) faltas.push("Falta DOMINIO");
    else if (!NOMBRE_DE_MAQUINA.test(env.DOMINIO)) faltas.push("DOMINIO debe ser solo el nombre del sitio, sin https:// ni ruta");
    else if (origenes.length !== 1 || origenes[0] !== `https://${env.DOMINIO}`) faltas.push("ORIGEN debe ser https:// seguido de DOMINIO");
  }
  return faltas;
}

/** Detiene el proceso si a su entorno le falta algo. */
export function exigirEntorno(env: Entorno, partes: readonly Parte[]): void {
  const faltas = faltasDelEntorno(env, partes);
  if (faltas.length === 0) return;
  throw new Error(
    `El entorno no sirve para operar:\n  · ${faltas.join("\n  · ")}\n` +
      "Si esto es una máquina de desarrollo, dilo expresamente: MODO=desarrollo (está en .env.desarrollo).",
  );
}
