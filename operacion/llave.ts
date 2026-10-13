// La llave privada de los respaldos, leída como la lee `age`: qué identidad trae un archivo de
// age-keygen, y cuál es su llave pública.
//
// De la llave privada sale el sello de los respaldos (operacion/destino.ts). Para que el sello sea
// el de la llave con que `age` va a descifrar —y no el de un texto parecido que ande en el
// archivo—, aquí se exige lo mismo que exige él: los renglones que empiezan con «#» son
// comentarios y no cuentan; tiene que haber una sola identidad; y tiene que estar bien escrita
// hasta su última letra (las identidades de age llevan una suma de comprobación: Bech32).
// Solo las de age-keygen (X25519); las de un complemento u otra clase no sirven para esto.
import { createPrivateKey, createPublicKey } from "node:crypto";

const LETRAS = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERADORES = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** La suma de Bech32 (BIP 173) sobre esos valores de cinco bits. */
function suma(valores: number[]): number {
  let c = 1;
  for (const v of valores) {
    const alto = c >>> 25;
    c = ((c & 0x1ffffff) << 5) ^ v;
    for (let k = 0; k < 5; k += 1) if ((alto >>> k) & 1) c ^= GENERADORES[k]!;
  }
  return c;
}

const delPrefijo = (prefijo: string): number[] => [...[...prefijo].map((l) => l.charCodeAt(0) >>> 5), 0, ...[...prefijo].map((l) => l.charCodeAt(0) & 31)];

/** De grupos de `de` bits a grupos de `a` bits. Sin relleno al leer: lo que sobre tiene que ser ceros, y menos de un grupo. */
function regrupar(datos: number[], de: number, a: number, rellenar: boolean): number[] | null {
  let [acumulado, bits] = [0, 0];
  const salida: number[] = [];
  for (const d of datos) {
    acumulado = ((acumulado << de) | d) & 0xffff;      // con lo de abajo basta: nunca se usan más de quince bits
    bits += de;
    while (bits >= a) {
      bits -= a;
      salida.push((acumulado >>> bits) & ((1 << a) - 1));
    }
  }
  if (rellenar) {
    if (bits > 0) salida.push((acumulado << (a - bits)) & ((1 << a) - 1));
  } else if (bits >= de || ((acumulado << (a - bits)) & ((1 << a) - 1)) !== 0) {
    return null;
  }
  return salida;
}

/** Los bytes que lleva un texto Bech32 con ese prefijo, si está bien escrito. Si no, nada. */
function leerBech32(texto: string, prefijo: string): Buffer | null {
  const t = texto.toLowerCase();
  if (!t.startsWith(`${prefijo}1`)) return null;
  const valores = [...t.slice(prefijo.length + 1)].map((l) => LETRAS.indexOf(l));
  if (valores.length < 7 || valores.includes(-1) || suma([...delPrefijo(prefijo), ...valores]) !== 1) return null;
  const bytes = regrupar(valores.slice(0, -6), 5, 8, false);
  return bytes ? Buffer.from(bytes) : null;
}

/** El texto Bech32 de esos bytes, con ese prefijo. */
function escribirBech32(bytes: Buffer, prefijo: string): string {
  const valores = regrupar([...bytes], 8, 5, true)!;
  const resto = suma([...delPrefijo(prefijo), ...valores, 0, 0, 0, 0, 0, 0]) ^ 1;
  const comprobacion = [0, 1, 2, 3, 4, 5].map((k) => (resto >>> (5 * (5 - k))) & 31);
  return `${prefijo}1${[...valores, ...comprobacion].map((v) => LETRAS[v]).join("")}`;
}

/** El encabezado con que se le entrega a Node una llave privada X25519 de 32 bytes (PKCS#8). */
const X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");

export interface Identidad {
  /** El renglón de la llave privada, tal como lo escribe age-keygen: AGE-SECRET-KEY-1… */
  secreta: string;
  /** Su llave pública: age1… Es la que va en el .env del servidor. */
  publica: string;
}

/**
 * La identidad que trae ese texto —el archivo de age-keygen, con sus comentarios, o el renglón
 * solo—, y su llave pública. Falla si no trae ninguna, si trae más de una, o si no está bien escrita.
 */
export function identidadDe(texto: string): Identidad {
  const renglones = texto.split(/\r?\n/).map((r) => r.trim()).filter((r) => r !== "" && !r.startsWith("#"));
  if (renglones.length === 0) throw new Error("Eso no es una llave privada de age: no trae el renglón que empieza con AGE-SECRET-KEY-1");
  if (renglones.length > 1) throw new Error("Aquí va una sola llave privada de age: el archivo trae más de un renglón que no es comentario");
  const secreta = renglones[0]!;
  // age escribe sus identidades en mayúsculas, y así se le pide: es también lo que entra al sello.
  const bytes = secreta === secreta.toUpperCase() ? leerBech32(secreta, "age-secret-key-") : null;
  if (!bytes || bytes.length !== 32) {
    throw new Error("Eso no es una llave privada de age bien escrita: tiene que ser el renglón AGE-SECRET-KEY-1… completo, como lo dio age-keygen");
  }
  const privada = createPrivateKey({ key: Buffer.concat([X25519, bytes]), format: "der", type: "pkcs8" });
  const publica = createPublicKey(privada).export({ format: "der", type: "spki" }).subarray(-32);
  return { secreta, publica: escribirBech32(Buffer.from(publica), "age") };
}
