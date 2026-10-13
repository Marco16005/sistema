// El sello de los respaldos: la clave que el servidor guarda para sellar cada respaldo que toma.
//
// Se saca de la llave privada de age, FUERA del servidor —la privada nunca debe estar en él—, y lo
// que sale se pone en el .env del servidor como RESPALDO_SELLO. De esa clave no se vuelve a la
// llave privada. Quien restaura no la necesita guardada: la saca otra vez de la llave con que
// descifra, y con ella comprueba que el respaldo lo tomó este negocio y que nadie lo cambió.
//
//   node operacion/sello.ts < llave-privada.txt
//
// Lo mismo, sin este programa (da el mismo resultado):
//   grep -o 'AGE-SECRET-KEY-1[0-9A-Z]*' llave-privada.txt | head -1 | tr -d '\n' | openssl dgst -sha256 -hmac 'feruga: sello de los respaldos, v1' -r | cut -d' ' -f1
import { pathToFileURL } from "node:url";
import { claveDeSello } from "./destino.ts";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2 || process.stdin.isTTY) {
    console.error("Uso: node operacion/sello.ts < llave-privada.txt");
    console.error("La llave privada entra por la entrada estándar, desde un archivo. No se teclea ni se pasa como argumento.");
    process.exit(2);
  }
  let llave = "";
  for await (const trozo of process.stdin) llave += trozo;
  try {
    console.log(claveDeSello(llave));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
