// El sello de los respaldos: la clave que el servidor guarda para sellar cada respaldo que toma.
//
// Se saca de la llave privada de age, FUERA del servidor —la privada nunca debe estar en él—. Este
// programa dice los dos renglones que van al .env del servidor, JUNTOS: la llave pública de esa
// llave y su sello. Van juntos a propósito: con el sello de una llave y la pública de otra, el
// servidor tomaría respaldos que el dueño no podría acreditar, y nadie se enteraría hasta
// restaurar. De lo que sale aquí no se vuelve a la llave privada. Quien restaura no necesita
// guardar el sello: lo saca otra vez de la llave con que descifra.
//
//   node operacion/sello.ts < llave-privada.txt
//
// El sello solo, sin este programa (da lo mismo, pero no comprueba que la llave esté bien escrita):
//   grep -v '^#' llave-privada.txt | grep -o 'AGE-SECRET-KEY-1[0-9A-Z]*' | head -1 | tr -d '\n' | openssl dgst -sha256 -hmac 'feruga: sello de los respaldos, v1' -r | cut -d' ' -f1
import { pathToFileURL } from "node:url";
import { claveDeSello } from "./destino.ts";
import { identidadDe } from "./llave.ts";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2 || process.stdin.isTTY) {
    console.error("Uso: node operacion/sello.ts < llave-privada.txt");
    console.error("La llave privada entra por la entrada estándar, desde un archivo. No se teclea ni se pasa como argumento.");
    process.exit(2);
  }
  let llave = "";
  for await (const trozo of process.stdin) llave += trozo;
  try {
    console.log(`RESPALDO_LLAVE_PUBLICA=${identidadDe(llave).publica}`);
    console.log(`RESPALDO_SELLO=${claveDeSello(llave)}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
