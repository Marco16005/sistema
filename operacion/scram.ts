// El verificador SCRAM-SHA-256 de una clave, como lo guarda PostgreSQL y como lo calcula
// `psql \password` (RFC 5802 y 7677): con él, la clave nueva de la base no viaja en el SQL, y ningún
// registro de la base —de sentencias, de duración, de muestreo, de errores— la puede anotar.
// Lo usa operacion/cambiar-clave-de-la-base.sh. (Revisión de Codex del 3 de noviembre, H7.)
//
//   printf '%s' "$clave" | node operacion/scram.ts      dice el verificador
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

/**
 * El verificador de esa clave, con una sal nueva. Solo letras y números: para esas, la preparación
 * de SASL (SASLprep) no cambia nada, y son las que inventa este sistema.
 */
export function verificadorScram(clave: string, sal: Buffer = randomBytes(16), iteraciones = 4096): string {
  if (!/^[A-Za-z0-9]+$/.test(clave)) throw new Error("La clave lleva solo letras y números");
  const salada = pbkdf2Sync(clave, sal, iteraciones, 32, "sha256");
  const deCliente = createHmac("sha256", salada).update("Client Key").digest();
  const guardada = createHash("sha256").update(deCliente).digest();
  const deServidor = createHmac("sha256", salada).update("Server Key").digest();
  return `SCRAM-SHA-256$${iteraciones}:${sal.toString("base64")}$${guardada.toString("base64")}:${deServidor.toString("base64")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let clave = "";
  for await (const trozo of process.stdin) clave += trozo;
  try {
    console.log(verificadorScram(clave.replace(/\r?\n$/, "")));
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
