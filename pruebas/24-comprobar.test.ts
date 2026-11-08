// Lo que se comprueba antes de dar por buena una instalación: el entorno completo, y que la
// configuración efectiva de Compose no publique a la red nada más que el proxy. (Que el sitio
// conteste por HTTPS con un certificado válido se prueba en el ensayo, contra el proxy de verdad.)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { faltasDeRed } from "../operacion/comprobar.ts";

type Servicio = { ports?: object[]; volumes?: object[]; network_mode?: string; privileged?: boolean; networks?: Record<string, object | null> };
const local = (target: number, published: string) => ({ mode: "ingress", host_ip: "127.0.0.1", target, published, protocol: "tcp" });
const aLaRed = (target: number, published: string) => ({ mode: "ingress", target, published, protocol: "tcp" });

/** La configuración efectiva de operación, como la entrega «docker compose config --format json». */
const operacion = (cambios: Record<string, Servicio> = {}) => ({
  name: "feruga",
  services: {
    comprobacion: {},
    db: { volumes: [{ type: "volume", source: "datos", target: "/var/lib/postgresql/data" }] },
    migracion: {},
    web: {},
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

/** Lo que se dice cuando el proxy va detrás de otro: la red que comparten. */
const ENTRADA = { entrada: "feruga-entrada" };

test("la configuración de operación publica a la red solo el proxy, en 80 y 443", () => {
  assert.deepEqual(faltasDeRed(operacion()), []);
});

test("ni en esta máquina publica nadie más que el proxy: publicado, aunque sea en 127.0.0.1, otro contenedor lo alcanza por su dirección", () => {
  // Así llegó el proxy al puerto de la base (revisión de seguridad de Codex del 5 de noviembre, R40-01).
  const proxy = operacion().services.proxy;
  const casos: Array<[Record<string, Servicio>, RegExp]> = [
    [{ db: { ports: [local(5432, "54329")] } }, /db.*54329/],
    [{ web: { ports: [local(3000, "3210")] } }, /web.*3210/],
    [{ consola: { ports: [local(9229, "9229")] } }, /consola.*9229/],
    [{ consola: { ports: [{ ...local(9230, "9230"), host_ip: "::1" }] } }, /consola.*9230/],
    // Del proxy, solo sus 80 y 443: ni en esta máquina su puerto de administración.
    [{ proxy: { ...proxy, ports: [...proxy.ports, local(2019, "2019")] } }, /proxy.*2019/],
  ];
  for (const [cambio, dice] of casos) {
    for (const o of [{}, { local: true }]) {
      const faltas = faltasDeRed(operacion(cambio), o);
      assert.ok(faltas.length > 0, `debió rechazar ${JSON.stringify(cambio)} ${JSON.stringify(o)}`);
      assert.match(faltas.join("\n"), dice);
    }
  }
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
  // La red general de Docker tampoco: no es la de este proyecto, y en ella cualquier otro contenedor
  // del servidor —el otro proxy, por ejemplo— llegaría a sus puertos por dirección (Codex, R43-07).
  for (const o of [{}, { local: true }, ENTRADA]) {
    assert.match(faltasDeRed(operacion({ db: { network_mode: "bridge" } }), o).join("\n"), /db usa la red general de Docker/, JSON.stringify(o));
  }
  // Sin red ninguna, y una carpeta cualquiera del proyecto, pasan.
  assert.deepEqual(faltasDeRed(operacion({ otro: { network_mode: "none", volumes: [{ type: "bind", source: "/srv/feruga/operacion", target: "/o" }] } })), []);
});

test("en un ensayo el proxy se queda en esta máquina, y eso se acepta solo si se dice; lo demás se exige igual", () => {
  const proxy = operacion().services.proxy;
  const ensayo = operacion({ proxy: { ...proxy, ports: [local(80, "8480"), local(443, "8443")] } });
  assert.match(faltasDeRed(ensayo).join("\n"), /no publica el 443/);
  assert.deepEqual(faltasDeRed(ensayo, { local: true }), []);
  // Decir que es un ensayo no deja publicar la base: ni a la red, ni en esta máquina.
  assert.match(faltasDeRed(operacion({ db: { ports: [aLaRed(5432, "5432")] } }), { local: true }).join("\n"), /db.*5432/);
  assert.match(faltasDeRed({ ...ensayo, services: { ...ensayo.services, db: { ports: [local(5432, "54339")] } } }, { local: true }).join("\n"), /db.*54339/);
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
  RESPALDO_LLAVE_PUBLICA: "age1" + "q".repeat(58), RESPALDO_SELLO: "0f".repeat(32), RESPALDO_DESTINO: "respaldo:respaldos-del-patio/feruga", RESPALDO_HORARIO: "07:00,08:00",
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
  // La base publicada solo en esta máquina tampoco pasa: así se publicaba antes en operación (R40-01).
  const enLaMaquina = await comprobar(["red"], {}, JSON.stringify(operacion({ db: { ports: [local(5432, "54329")] } })));
  assert.equal(enLaMaquina.codigo, 1);
  assert.match(enLaMaquina.queja, /db.*54329/);
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

/**
 * La de operación detrás de otro proxy (docker-compose.detras.yml), como la entrega Compose: el
 * proxy sin puertos, en el frente y en la red que comparte con el otro, que existe aparte.
 */
const detras = (cambios: Record<string, Servicio> = {}, redes: Record<string, object> = {}) => {
  const proxy = { ...operacion().services.proxy, ports: [], networks: { frente: null, entrada: { aliases: ["feruga-proxy"] } } };
  return {
    ...operacion({ proxy, ...cambios }),
    networks: { entrada: { name: "feruga-entrada", external: true }, fondo: { name: "feruga_fondo" }, frente: { name: "feruga_frente" }, ...redes },
  };
};

test("detrás de otro proxy: el de feruga no publica nada y está en la red que comparte con el otro; se acepta solo si se dice", () => {
  assert.deepEqual(faltasDeRed(detras(), ENTRADA), []);
  // En un ensayo es lo mismo: ni en esta máquina publica.
  assert.deepEqual(faltasDeRed(detras(), { ...ENTRADA, local: true }), []);
  // Sin decirlo, una red de fuera es una puerta que nadie revisó, y sin 80 y 443 no hay sitio.
  const sinDecir = faltasDeRed(detras()).join("\n");
  assert.match(sinDecir, /proxy.*feruga-entrada/);
  assert.match(sinDecir, /no publica el 443/);
  // Dicho, pero con el proxy de siempre: publica, y no está en la red.
  const comoSiempre = faltasDeRed(operacion(), ENTRADA).join("\n");
  assert.match(comoSiempre, /proxy publica a la red el puerto 80.*detrás de otro proxy/);
  assert.match(comoSiempre, /proxy publica a la red el puerto 443/);
  assert.match(comoSiempre, /El proxy no está en la red feruga-entrada/);
});

test("detrás de otro proxy, lo demás se rechaza diciendo qué", () => {
  const proxy = detras().services.proxy;
  const casos: Array<[ReturnType<typeof detras>, RegExp]> = [
    // Ni en esta máquina publica el proxy: el otro le llega por la red compartida.
    [detras({ proxy: { ...proxy, ports: [local(80, "8480")] } }), /proxy publica en esta máquina el puerto 8480/],
    // La red tiene que ser la que se dijo, y existir aparte: si la crea este Compose, el otro proxy no está en ella.
    [detras({ proxy: { ...proxy, networks: { frente: null, otra: {} } } }, { otra: { name: "otra-red", external: true } }), /otra-red/],
    [detras({}, { entrada: { name: "feruga-entrada" } }), /feruga-entrada.*aparte/],
    // Nadie más de feruga en la red compartida: el otro proxy llegaría a la aplicación sin pasar por el de feruga, o a la base.
    [detras({ web: { networks: { frente: null, fondo: null, entrada: null } } }), /web.*feruga-entrada/],
    [detras({ db: { networks: { fondo: null, entrada: null } } }), /db.*feruga-entrada/],
    // Ni en otra red de fuera.
    [detras({ respaldo: { networks: { fondo: null, otra: null } } }, { otra: { name: "de-otro-proyecto", external: true } }), /respaldo.*de-otro-proyecto/],
  ];
  for (const [config, dice] of casos) {
    for (const o of [ENTRADA, { ...ENTRADA, local: true }]) {
      const faltas = faltasDeRed(config, o);
      assert.ok(faltas.length > 0, `debió rechazar ${JSON.stringify(config.services)} ${JSON.stringify(o)}`);
      assert.match(faltas.join("\n"), dice);
    }
  }
});

test("con el proxy de siempre, ningún servicio está en una red de fuera", () => {
  const conRedDeFuera = { ...operacion({ web: { networks: { frente: null, fondo: null, ajena: null } } }), networks: { ajena: { name: "de-otro-proyecto", external: true } } };
  assert.match(faltasDeRed(conRedDeFuera).join("\n"), /web.*de-otro-proyecto/);
  assert.match(faltasDeRed(conRedDeFuera, { local: true }).join("\n"), /web.*de-otro-proyecto/);
  // Las suyas, aunque las nombre, pasan.
  assert.deepEqual(faltasDeRed({ ...operacion({ web: { networks: { frente: null, fondo: null } } }), networks: { frente: { name: "feruga_frente" }, fondo: { name: "feruga_fondo" } } }), []);
});

test("por la consola: la red compartida se dice en el entorno o en la orden, y se pueden pedir las redes de fuera", async () => {
  const config = JSON.stringify(detras());
  assert.equal((await comprobar(["red"], {}, config)).codigo, 1);
  const porEntorno = await comprobar(["red"], { RED_DE_ENTRADA: "feruga-entrada" }, config);
  assert.equal(porEntorno.codigo, 0, porEntorno.queja);
  assert.equal((await comprobar(["red", "--entrada=feruga-entrada"], {}, config)).codigo, 0);
  assert.equal((await comprobar(["red", "--local", "--entrada=feruga-entrada"], {}, config)).codigo, 0);
  // Vacía es como no decirla: el proxy de siempre pasa.
  assert.equal((await comprobar(["red"], { RED_DE_ENTRADA: "" }, JSON.stringify(operacion()))).codigo, 0);
  // Las redes que tienen que existir antes de levantar, una por renglón.
  const fuera = await comprobar(["redes-de-fuera"], {}, config);
  assert.equal(fuera.codigo, 0, fuera.queja);
  assert.equal(fuera.salida, "feruga-entrada\n");
  assert.equal((await comprobar(["redes-de-fuera"], {}, JSON.stringify(operacion()))).salida, "");
  assert.equal((await comprobar(["redes-de-fuera"], {}, "no es json")).codigo, 1);
});

test("la red compartida se reconoce por su nombre en Docker, no por su clave ni por el orden en que se declara (Codex, R43-01)", () => {
  // Otra clave con el mismo nombre, sin «external»: Compose puede reusar esa red, y la base quedaría
  // junto al otro proxy. Se rechaza en cualquier orden, y aunque el proxy de siempre esté bien.
  const colision = { colision: { name: "feruga-entrada" } };
  const db = { db: { networks: { fondo: null, colision: null } } };
  for (const redes of [
    { ...colision, entrada: { name: "feruga-entrada", external: true }, fondo: { name: "feruga_fondo" }, frente: { name: "feruga_frente" } },
    { entrada: { name: "feruga-entrada", external: true }, fondo: { name: "feruga_fondo" }, frente: { name: "feruga_frente" }, ...colision },
  ]) {
    const config = { ...detras(db), networks: redes };
    for (const o of [ENTRADA, { ...ENTRADA, local: true }]) {
      const faltas = faltasDeRed(config, o).join("\n");
      assert.match(faltas, /db está en la red feruga-entrada/, JSON.stringify(Object.keys(redes)));
      assert.match(faltas, /feruga-entrada la crearía esta configuración/);
    }
  }
  // El proxy en esa red por una clave que no es de fuera tampoco cuenta como estar en la compartida.
  const proxy = { ...detras().services.proxy, networks: { frente: null, colision: null } };
  assert.match(faltasDeRed({ ...detras({ proxy }), networks: { ...colision, frente: { name: "feruga_frente" } } }, ENTRADA).join("\n"), /El proxy no está en la red feruga-entrada/);
});

test("el nombre de la red compartida es uno solo, sin blancos: si no, no se sabe cuál se revisó (Codex, R43-02)", async () => {
  for (const malo of ["feruga entrada", "   ", "feruga-entrada\notra", "../feruga", "-feruga", "feruga*"]) {
    assert.match(faltasDeRed(detras(), { entrada: malo }).join("\n"), /RED_DE_ENTRADA.*no es un nombre de red/, JSON.stringify(malo));
  }
  for (const bueno of ["feruga-entrada", "feruga_ensayo-entrada", "red.1"]) {
    const config = { ...detras(), networks: { entrada: { name: bueno, external: true }, frente: { name: "feruga_frente" } } };
    assert.deepEqual(faltasDeRed(config, { entrada: bueno }), [], bueno);
  }
  // Las redes de fuera se dicen una por renglón solo si cada nombre es uno solo; si no, no se dice ninguna.
  const conEspacio = { ...detras(), networks: { entrada: { name: "codex43-a codex43-b", external: true } } };
  const fuera = await comprobar(["redes-de-fuera"], {}, JSON.stringify(conEspacio));
  assert.equal(fuera.codigo, 1);
  assert.equal(fuera.salida, "");
  assert.match(fuera.queja, /codex43-a codex43-b.*no es un nombre de red/);
});
