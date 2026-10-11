// Proceso hijo de la prueba «perder la conexión a media acción no tumba el servidor».
// A media transacción se le termina la conexión desde otra sesión. Lo que debe pasar: la acción
// se rechaza, el proceso sigue vivo y la acción siguiente se atiende con una conexión nueva.
// Corre aparte porque el defecto, cuando existe, mata al proceso entero.
import pg from "pg";
import { crearBd } from "../../src/servidor/bd.ts";

const [url, urlDelDueno, modo] = process.argv.slice(2);
const bd = crearBd(url!, { conexiones: 1 });
const dueno = new pg.Client({ connectionString: urlDelDueno });
await dueno.connect();
const pausa = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

let rechazada = false;
try {
  await bd.enTransaccion(null, async (c) => {
    const pid = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    if (modo === "consultando") {
      const dormida = c.query("SELECT pg_sleep(5)");
      await pausa(200);
      await dueno.query("SELECT pg_terminate_backend($1)", [pid]);
      await dormida;
    } else {
      // La acción está en JavaScript, sin consulta en curso, cuando la conexión se cae.
      await dueno.query("SELECT pg_terminate_backend($1)", [pid]);
      await pausa(500);
    }
  });
} catch {
  rechazada = true;
}
const despues = await bd.leer("SELECT 1 AS uno");
console.log(JSON.stringify({ rechazada, uno: despues[0]!.uno }));
await bd.cerrar();
await dueno.end();
