// Lo que se comprueba antes de dar por buena una instalación: el entorno completo, y que la
// configuración efectiva de Compose no publique a la red nada más que el proxy. (Que el sitio
// conteste por HTTPS con un certificado válido se prueba en el ensayo, contra el proxy de verdad.)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { faltasDeRed } from "../operacion/comprobar.ts";

type Servicio = { ports?: object[]; volumes?: object[]; network_mode?: string; privileged?: boolean };
const local = (target: number, published: string) => ({ mode: "ingress", host_ip: "127.0.0.1", target, published, protocol: "tcp" });
const aLaRed = (target: number, published: string) => ({ mode: "ingress", target, published, protocol: "tcp" });

/** La configuración efectiva de operación, como la entrega «docker compose config --format json». */
const operacion = (cambios: Record<string, Servicio> = {}) => ({
  name: "feruga",
  services: {
    comprobacion: {},
    db: { ports: [local(5432, "54329")], volumes: [{ type: "volume", source: "datos", target: "/var/lib/postgresql/data" }] },
    migracion: {},
    web: { ports: [local(3000, "3210")] },
    respaldo: {},
    proxy: {
      ports: [aLaRed(80, "80"), aLaRed(443, "443")],
      volumes: [
        { type: "bind", source: "/srv/feruga/operacion/Caddyfile", target: "/etc/caddy/Caddyfile" },
        { type: "volume", source: "certificados", target: "/data" },
      ],
    },
    ...cambios,
  },
});

test("la configuración de operación publica a la red solo el proxy, en 80 y 443", () => {
  assert.deepEqual(faltasDeRed(operacion()), []);
  // En esta máquina se puede publicar lo que haga falta: no sale de ella.
  assert.deepEqual(faltasDeRed(operacion({ consola: { ports: [local(9229, "9229"), { ...local(1, "1"), host_ip: "::1" }] } })), []);
});

test("cualquier otra cosa publicada a la red se rechaza diciendo cuál", () => {
  const proxy = operacion().services.proxy;
  const casos: Array<[Record<string, Servicio>, RegExp]> = [
    // La base o la aplicación, a la red: sin dirección es todas las interfaces.
    [{ db: { ports: [aLaRed(5432, "5432")] } }, /db.*5432/],
    [{ db: { ports: [{ ...local(5432, "5432"), host_ip: "0.0.0.0" }] } }, /db.*5432/],
    [{ db: { ports: [{ ...local(5432, "5432"), host_ip: "::" }] } }, /db.*5432/],
    [{ web: { ports: [aLaRed(3000, "3000")] } }, /web.*3000/],
    [{ web: { ports: [{ ...local(3000, "3000"), host_ip: "192.168.1.10" }] } }, /web.*3000/],
    // El proxy, con algo más que 80 y 443: su puerto de administración, o cualquier otro.
    [{ proxy: { ...proxy, ports: [...proxy.ports, aLaRed(2019, "2019")] } }, /proxy.*2019/],
    [{ proxy: { ...proxy, ports: [aLaRed(80, "80"), aLaRed(443, "8443")] } }, /proxy.*8443/],
    [{ proxy: { ...proxy, ports: [aLaRed(80, "80"), aLaRed(3000, "443")] } }, /proxy.*3000/],
    // Un servicio que no es el proxy, en el 443.
    [{ respaldo: { ports: [aLaRed(443, "443")] } }, /respaldo.*443/],
    // El socket de Docker dentro de un contenedor es darle la máquina entera.
    [{ proxy: { ...proxy, volumes: [...proxy.volumes, { type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" }] } }, /proxy.*docker\.sock/],
    [{ respaldo: { volumes: [{ type: "bind", source: "/run/docker.sock", target: "/algo" }] } }, /respaldo.*docker\.sock/],
  ];
  for (const [cambio, dice] of casos) {
    const faltas = faltasDeRed(operacion(cambio));
    assert.ok(faltas.length > 0, `debió rechazar ${JSON.stringify(cambio)}`);
    assert.match(faltas.join("\n"), dice);
  }
  // Y si el proxy no existe o no publica el 443, no hay sitio.
  const { proxy: _sin, ...sinProxy } = operacion().services;
  assert.match(faltasDeRed({ services: sinProxy }).join("\n"), /proxy/);
  assert.match(faltasDeRed(operacion({ proxy: { ports: [aLaRed(80, "80")] } })).join("\n"), /443/);
});

test("lo que sale a la red sin pasar por «ports» también se rechaza: la red de la máquina, sus privilegios y su socket por otro camino", () => {
  const casos: Array<[Record<string, Servicio>, RegExp]> = [
    // Con la red de la máquina, cada puerto que el contenedor abra queda en la red, sin publicar nada.
    [{ otro: { network_mode: "host" } }, /otro.*red de la máquina/],
    [{ web: { ports: [local(3000, "3210")], network_mode: "host" } }, /web.*red de la máquina/],
    // Colgarse de la red de otro contenedor tampoco es lo que se comprobó.
    [{ otro: { network_mode: "service:proxy" } }, /otro.*red/],
    [{ otro: { network_mode: "container:abc" } }, /otro.*red/],
    // Un contenedor con privilegios de la máquina no está contenido.
    [{ respaldo: { privileged: true } }, /respaldo.*privilegi/],
    // El socket de Docker, montando la carpeta que lo contiene.
    [{ otro: { volumes: [{ type: "bind", source: "/var/run", target: "/hostrun" }] } }, /otro.*docker\.sock/],
    [{ otro: { volumes: [{ type: "bind", source: "/run", target: "/algo" }] } }, /otro.*docker\.sock/],
    [{ otro: { volumes: [{ type: "bind", source: "/var", target: "/algo" }] } }, /otro.*docker\.sock/],
    [{ otro: { volumes: [{ type: "bind", source: "/", target: "/maquina" }] } }, /otro.*docker\.sock/],
    [{ otro: { volumes: [{ type: "bind", source: "/var/run/", target: "/hostrun" }] } }, /otro.*docker\.sock/],
  ];
  for (const [cambio, dice] of casos) {
    const faltas = faltasDeRed(operacion(cambio));
    assert.ok(faltas.length > 0, `debió rechazar ${JSON.stringify(cambio)}`);
    assert.match(faltas.join("\n"), dice);
    // Tampoco en un ensayo.
    assert.match(faltasDeRed(operacion(cambio), { local: true }).join("\n"), dice);
  }
  // La red de siempre, dicha expresamente, y una carpeta cualquiera del proyecto, pasan.
  assert.deepEqual(faltasDeRed(operacion({ otro: { network_mode: "bridge", volumes: [{ type: "bind", source: "/srv/feruga/operacion", target: "/o" }] } })), []);
});

test("en un ensayo el proxy se queda en esta máquina, y eso se acepta solo si se dice; lo demás se exige igual", () => {
  const proxy = operacion().services.proxy;
  const ensayo = operacion({ proxy: { ...proxy, ports: [local(80, "8480"), local(443, "8443")] } });
  assert.match(faltasDeRed(ensayo).join("\n"), /no publica el 443/);
  assert.deepEqual(faltasDeRed(ensayo, { local: true }), []);
  // Decir que es un ensayo no deja publicar la base a la red.
  assert.match(faltasDeRed(operacion({ db: { ports: [aLaRed(5432, "5432")] } }), { local: true }).join("\n"), /db.*5432/);
  assert.match(faltasDeRed({ services: {} }, { local: true }).join("\n"), /no trae servicios/);
});

/** Corre el programa de comprobación como proceso aparte. */
function comprobar(args: string[], entorno: Record<string, string>, entrada = ""): Promise<{ codigo: number | null; salida: string; queja: string }> {
  return new Promise((listo, mal) => {
    const hijo = spawn(process.execPath, ["operacion/comprobar.ts", ...args], { env: { PATH: process.env.PATH ?? "", ...entorno }, stdio: ["pipe", "pipe", "pipe"] });
    let salida = "";
    let queja = "";
    hijo.stdout.on("data", (trozo: Buffer) => (salida += trozo.toString()));
    hijo.stderr.on("data", (trozo: Buffer) => (queja += trozo.toString()));
    hijo.on("error", mal);
    hijo.on("close", (codigo) => listo({ codigo, salida, queja }));
    hijo.stdin.end(entrada);
  });
}

const BUENO = {
  DATABASE_URL: "postgres://feruga:Qm3vT8xLp2Rk9Zc4Wn7Yb5Hd@db:5432/feruga", WEB_BD_CLAVE: "Jf6Gs1Ua0Ve8Xi3Ko9Ml2Np7",
  SESION_CLAVE: "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8", COOKIE_SEGURA: "1", DOMINIO: "patio.ejemplo.mx", ORIGEN: "https://patio.ejemplo.mx",
  RESPALDO_LLAVE_PUBLICA: "age1" + "q".repeat(58), RESPALDO_DESTINO: "respaldo:respaldos-del-patio/feruga", RESPALDO_HORARIO: "07:00,08:00",
  RESPALDO_VIGIA_URL: "https://vigia.ejemplo.mx/ping/0b2c1f", RCLONE_CONFIG_RESPALDO_TYPE: "s3",
  RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID: "llaveDelServidor", RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY: "secretoDelServidor0123456789",
  RESPALDO_DESTINO_DIARIO: "diario:respaldos-de-un-anio/feruga", RESPALDO_VIGIA_DIARIO_URL: "https://vigia.ejemplo.mx/ping/7d9e3a",
  RCLONE_CONFIG_DIARIO_TYPE: "s3", RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID: "llaveDelDiario", RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY: "secretoDelDiario0123456789",
};

test("por la consola: el entorno completo pasa; al que le falta algo se le dice qué, sin repetir ninguna clave", async () => {
  const bien = await comprobar(["entorno"], BUENO);
  assert.equal(bien.codigo, 0, bien.queja);

  const mal = await comprobar(["entorno"], { ...BUENO, SESION_CLAVE: "corta", RESPALDO_VIGIA_URL: "" });
  assert.equal(mal.codigo, 1);
  assert.match(mal.queja, /SESION_CLAVE/);
  assert.match(mal.queja, /RESPALDO_VIGIA_URL/);
  for (const clave of [BUENO.WEB_BD_CLAVE, "Qm3vT8xLp2Rk9Zc4Wn7Yb5Hd", BUENO.RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY]) {
    assert.ok(!(mal.salida + mal.queja + bien.salida + bien.queja).includes(clave));
  }
  // Decir que es desarrollo no vale aquí: lo que se comprueba es que sirva para operar.
  const desarrollo = await comprobar(["entorno"], { ...BUENO, MODO: "desarrollo", SESION_CLAVE: "corta" });
  assert.equal(desarrollo.codigo, 1);
  assert.match(desarrollo.queja, /MODO/);
});

test("por la consola: la configuración efectiva entra por la entrada estándar", async () => {
  const bien = await comprobar(["red"], {}, JSON.stringify(operacion()));
  assert.equal(bien.codigo, 0, bien.queja);
  const mal = await comprobar(["red"], {}, JSON.stringify(operacion({ db: { ports: [aLaRed(5432, "5432")] } })));
  assert.equal(mal.codigo, 1);
  assert.match(mal.queja, /db.*5432/);
  // Lo que no es una configuración no pasa por buena.
  assert.equal((await comprobar(["red"], {}, "")).codigo, 1);
  assert.equal((await comprobar(["red"], {}, "{}")).codigo, 1);
  assert.equal((await comprobar(["otra-cosa"], {})).codigo, 2);
  // En un ensayo se dice expresamente que el proxy no sale de la máquina.
  const proxy = operacion().services.proxy;
  const ensayo = JSON.stringify(operacion({ proxy: { ...proxy, ports: [local(80, "8480"), local(443, "8443")] } }));
  assert.equal((await comprobar(["red"], {}, ensayo)).codigo, 1);
  assert.equal((await comprobar(["red", "--local"], {}, ensayo)).codigo, 0);
});
