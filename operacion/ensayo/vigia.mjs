// El vigilante de mentira del ensayo: anota cada aviso que recibe y los entrega en /registro.
import { createServer } from "node:http";

const recibidos = [];
createServer((peticion, respuesta) => {
  if (peticion.url === "/registro") {
    respuesta.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(recibidos));
    return;
  }
  recibidos.push(`${peticion.method} ${peticion.url}`);
  // De una falla se guarda también el porqué (el cuerpo): así un ensayo que falla dice qué pasó.
  let cuerpo = "";
  peticion.setEncoding("utf8");
  peticion.on("data", (trozo) => { if (cuerpo.length < 2000) cuerpo += trozo; });
  peticion.on("end", () => {
    if (peticion.url.includes("/fail") && cuerpo) recibidos.push(`MOTIVO ${peticion.url.split("?")[0]}: ${cuerpo}`);
    respuesta.writeHead(200).end("OK");
  });
}).listen(8080);
