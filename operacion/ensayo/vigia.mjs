// El vigilante de mentira del ensayo: anota cada aviso que recibe y los entrega en /registro.
import { createServer } from "node:http";

const recibidos = [];
createServer((peticion, respuesta) => {
  if (peticion.url === "/registro") {
    respuesta.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(recibidos));
    return;
  }
  recibidos.push(`${peticion.method} ${peticion.url}`);
  peticion.resume();
  peticion.on("end", () => respuesta.writeHead(200).end("OK"));
}).listen(8080);
