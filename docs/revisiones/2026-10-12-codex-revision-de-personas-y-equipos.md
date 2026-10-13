# Codex revisa: personas y equipos desde la pantalla

> **12 de octubre de 2026.** Una pasada de revisión de Codex (`gpt-6-astra`, esfuerzo alto) sobre la migración
> 0031, su dominio, sus rutas y la pantalla de Ajustes: lo más delicado de seguridad que se ha puesto en la
> aplicación, y no lo escribió él. **Terminó completa.** Encargo: `encargo-22` (al final).
> No encontró cómo fabricarse un jefe. Encontró un «bloqueante», un «importante» y un «menor»; lo que se hizo
> con cada uno está en «Respuesta».

## El informe de Codex, tal cual

1. FABRICARSE UN JEFE — Sin hallazgos en esta pasada: roles anómalos, NULL, nombre del jefe y permisos directos; `sh qa/node.sh qa/sonda22.ts 1` → «P1: ascenso concurrente a responsable rechazado con RC008 tras FOR UPDATE».

2. PASAR SIN LA CLAVE, O SIN LA FACULTAD

### [importante] Con las credenciales SQL de la aplicación se pueden borrar los intentos fallidos
Dónde: db/migraciones/0013_identidad.sql:126; db/migraciones/0031_personas_y_equipos_en_pantalla.sql:188
Escenario: con acceso SQL como feruga_app, una huella vigente y el identificador de un responsable facultado, ejecutar BEGIN → codigo_para_equipo con una clave candidata → ROLLBACK si devuelve NULL. Repetir: no hay bloqueo ni registro persistente del fallo. Es una debilidad heredada que alcanza las nuevas funciones; no se confirmó un camino equivalente por HTTP.
Confirmado con: `sh qa/node.sh qa/sonda22.ts 2` → `P2: 7 claves malas con ROLLBACK; {"fallos":0,"bloqueos":0}; clave buena aún pasa=true` (conexión comoApp).
Corrección sugerida: para cubrir el compromiso de credenciales SQL, persistir el límite de intentos fuera de la transacción controlada por feruga_app, mediante un servicio o conexión separada sin acceso desde ese rol. Devolver falso por sí solo no garantiza persistencia.

3. LO QUE SE VE UNA SOLA VEZ — Sin hallazgos en la lectura: respuestas con secretos llevan no-store; bitácora sin claves/códigos; el rechazo que activa el reintento precede a la autorización y al alta. Una respuesta perdida permite recuperar el acceso cambiando la clave desde la lista.

4. LAS LISTAS — Sin hallazgos en la lectura: exigen responsable activo facultado; filtran sucursal 1, no devuelven huellas ni claves, y excluyen equipos dados de baja de es_este y adentro_de. Por SQL reciben un identificador, no acreditan sesión; por HTTP la identidad sale de la sesión.

5. DAR DE BAJA EQUIPOS

### [bloqueante] Dos bajas cruzadas dejan al negocio sin equipos vigentes
Dónde: db/migraciones/0031_personas_y_equipos_en_pantalla.sql:217
Escenario: quedan A y B, con dos responsables facultados. En transacciones solapadas, desde A se da de baja B y desde B se da de baja A. Cada autorización ve su propio equipo aún vigente; ambas bajas se confirman y quedan cero equipos. Sin un código vigente ya disponible, hace falta la consola para recuperar el acceso.
Confirmado con: `sh qa/node.sh qa/sonda22.ts 5` → `P5: baja A→B=true; baja B→A=true; equipos vigentes=0` (dos conexiones comoApp).
Corrección sugerida: serializar las bajas por sucursal antes de comprobar la vigencia del equipo solicitante y volver a comprobarla dentro del bloqueo; mantenerlo hasta confirmar. Preservar la regla de que quede al menos un equipo vigente.

La baja cierra las sesiones del equipo; las siguientes peticiones se rechazan. Las cuentas ya guardadas permanecen en el servidor. Sin confirmar: para correr aquí, dar de baja un equipo con una pesada aún en tránsito y comprobar desde otro equipo qué quedó registrado.

6. LA PANTALLA

### [menor] La clave tecleada sigue en el estado de React hasta recibir respuesta
Dónde: src/componentes/ajustes/ConTuClave.tsx:31
Escenario: teclear la clave y enviar con una respuesta que queda pendiente → el componente conserva la clave completa en estado y en las propiedades de Teclado durante toda la espera; solo la borra al finalizar. El DOM muestra puntos, no los dígitos.
Confirmado con: `nl -ba src/componentes/ajustes/ConTuClave.tsx` → línea 31 `await alTeclear(clave);`, línea 33 `setClave("");` dentro de finally; línea 44 pasa `valor={clave}` al teclado.
Corrección sugerida: vaciar el estado antes de esperar la petición y deshabilitar el teclado mientras se envía. Esto reduce la retención en la interfaz; no borra las copias necesarias para transmitirla.

Lectura: sin respuesta/5xx activa «no se supo»; las reglas 4xx conservan el diálogo. El rol se comprueba antes de renderizar Ajustes. Escape no cierra el secreto, pero recargar descarta unaVez; volver a otra pestaña no lo borra por sí mismo.
Sin confirmar: para correr aquí, (a) doble toque/Enter al cambiar clave con respuesta demorada: contar POST y comprobar que la clave mostrada sea la vigente; (b) recibir el secreto en pestaña oculta y recargar antes de verlo: comprobar recuperación cambiando clave o pidiendo otro código; (c) retener el POST, responder 503 y luego una regla RC005 en otro intento: verificar «no se supo» solo en el primero.


## Respuesta

1. **[bloqueante] Dos bajas cruzadas dejan al negocio sin equipos** — *cierto, corregido*. Con dos
   equipos y dos responsables facultados, cada uno dando de baja el del otro a la vez, cada baja veía
   vigente su propio equipo y las dos pasaban. Se escribió la prueba primero (falló: «la segunda
   sesión nunca quedó esperando»). Ahora las bajas de equipo van en fila (migración 0032): la
   segunda espera a la primera y, al pasar, la comprobación de la clave vuelve a mirar si el equipo
   desde el que se pide sigue vigente —ya no lo está— y contesta que no. Siempre queda al menos un
   equipo. Prueba: «dos responsables que se dan de baja el equipo uno al otro a la vez…»
   (`pruebas/45-administracion`).

2. **[importante] Con las credenciales de la base que usa la aplicación se pueden borrar los intentos
   fallidos** — *cierto, y NO se corrigió: queda anotado como pendiente antes del servidor de verdad*.
   Quien tenga la contraseña con que la aplicación entra a la base (no la de una persona: la del
   servidor) puede probar una clave dentro de una transacción y deshacerla si no pasó: el intento no
   queda contado y no hay bloqueo. No es de la migración 0031: es de cómo se cuentan los intentos desde
   la 0013, y vale para toda autorización (reabrir el día, precio especial, conteos). Por la pantalla
   y por las rutas no se puede: cada pedido va en su propia transacción y se confirma. Lo que cambia
   con los ajustes es lo que se gana adivinando la clave de un responsable desde ahí: antes,
   autorizar; ahora, además, dar de alta a un cajero o un equipo. Sigue sin poderse nombrar a un
   responsable. Corregirlo de raíz pide contar los intentos fuera de la transacción de quien
   pregunta (otra conexión, o un servicio aparte): es un cambio de arquitectura. Mientras, lo que lo
   contiene es que esa contraseña no salga del servidor —ya es así: vive en el entorno del servidor
   y la base no se publica a la red—. Va a la lista de lo que hay que cerrar antes de datos reales.

   **Corregido el 13 de octubre de 2026 (migración 0035).** No hizo falta otra conexión ni un
   servicio aparte: la cuenta de intentos vive, además, en una secuencia por persona, y una
   secuencia no es de la transacción —lo que se le escribe se queda aunque todo lo demás se
   deshaga—. `comprobar_clave` decide con lo que dice la secuencia; las tres columnas de la tabla
   le siguen, y un disparador por columna lleva a la secuencia lo que se les escriba. La
   aplicación no tiene ningún permiso sobre el esquema de las secuencias. Antes de corregir se
   reprodujo el hallazgo aquí (cinco claves malas deshechas, y la buena entraba); ahora cinco
   claves malas bloquean aunque las cinco se deshagan, juntas o una tras otra; un acierto limpia
   la cuenta aunque lo que siga falle; la cuenta sobrevive a respaldar y restaurar; y la lista de
   personas de los ajustes dice quién está bloqueado según la secuencia (`pruebas/11-identidad`,
   `09-respaldo`). Lo que no cambia: quien tiene esa contraseña puede seguir bloqueando a alguien
   a propósito, a fuerza de fallar —ya podía—, y el renglón de la bitácora que anota un bloqueo sí
   es de la transacción: si quien pregunta la deshace, el bloqueo queda pero su renglón no. La
   prueba de la credencial a la que le falta su secuencia se escribió junto con su arreglo: esa
   no se vio fallar antes. **Esta corrección no la ha revisado Codex.**

3. **[menor] La clave tecleada sigue en la pantalla hasta recibir respuesta** — *cierto, corregido*.
   La hoja la borraba al terminar; ahora, antes de esperar. Recorrido: «tocar dos veces el botón de
   la hoja…», que primero se vio fallar (seis puntos llenos mientras el servidor contestaba).

De lo que dejó «para correr aquí»:

- **(a) Doble toque**: se corrió. El segundo toque no manda nada (el botón ya está deshabilitado
  cuando llega): un solo pedido, y la clave que se enseña es la que vale. Mismo recorrido.
- **(b) Recibir el secreto y recargar antes de verlo**: se pierde, y es como está diseñado: la
  persona ya existe y se le cambia la clave; el código de equipo se pide otro.
- **(c) «No se supo» solo sin respuesta o con falla del servidor**: por lectura, sí; no se le hizo
  recorrido propio.
- **Dar de baja un equipo con una pesada en tránsito**: no se corrió. Las cuentas viven en el
  servidor, no en el equipo: lo que ya llegó queda, y lo que no llegó, no.

### Aparte: la baja de un material mientras alguien lo agrega a una cuenta

No es de esta pasada (el catálogo lo escribió Codex y quedó fuera de su propia revisión): lo señaló
la revisión automática de seguridad del guardado `a9777c9`. La baja comprobaba que el material no
estuviera en una cuenta abierta, pero quien lo agregaba en ese instante ya había leído que seguía
activo, y entraba. Se escribió la prueba (falló: el renglón «pasó»), y ahora el renglón que nace
relee el material ya bloqueado (migración 0032). No se cerró, a propósito, que un conteo le ponga
existencia a un material en el instante de su baja: los movimientos de inventario sobre un material
dado de baja tienen que seguir pudiéndose; si pasa, se ve y el material se reactiva.

## El encargo

```text
Revisión de control de calidad, UNA sola pasada y corta: PERSONAS Y EQUIPOS DESDE LA PANTALLA
(migración 0031 y lo que cuelga de ella) y la pantalla de Ajustes. Es lo más delicado de seguridad
que se ha puesto en la aplicación: revisa como quien quiere romperlo. No lo escribiste tú.
(El catálogo —migración 0030, materiales.ts, sus rutas— sí lo escribiste tú: NO lo revises.)
Proyecto: gestión de una recicladora (Next.js, PostgreSQL, Docker Compose).
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa12/   (al día con el proyecto, 12 de octubre de 2026)
EL INFORME: /tmp/feruga-codex-informe-22.md

CÓMO VA ESTA PASADA
Tu cuota puede cortarse a los pocos minutos. Gasta en pensar y en confirmar con una sonda; no en
leer de más. Crea el informe al empezar con la lista de los puntos y GUÁRDALO después de cada punto.
NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo y sigue. Los puntos van en orden de
importancia: si se corta, que haya quedado lo primero.

YA ESTÁ PREPARADO — no lo rehagas
- La copia, sin node_modules. OJO: tu plantilla feruga_plantilla_codex tiene 30 migraciones (hasta la
  0030); la copia ahora trae también la 0031. Antes de cualquier sonda: `sh qa/plantilla.sh` (deja 31).
- Comandos (ver qa/LEEME.md):
    sh qa/plantilla.sh
    sh qa/prueba.sh <archivo de pruebas> ['parte del nombre']
    sh qa/sql.sh "<SQL>"
    sh qa/node.sh <programa.ts>          (tus sondas van en qa/)
- NO corras la batería completa, ni los recorridos del navegador, ni los simulacros: aquí ya se
  corren. Si para confirmar algo hace falta un recorrido, escribe el caso exacto y márcalo
  «Sin confirmar: para correr aquí».

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja en /tmp/feruga-codex-qa12/ (ahí sí puedes crear sondas tuyas, en qa/). No corrijas el
  código: di qué está mal y cómo se arregla. No sustituyas su docker-compose.yml. No ejecutes npm ci
  ni npm install. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 ni la base «feruga»: son del usuario.
- Formato, corto. Por hallazgo:
    ### [bloqueante | importante | menor] título
    Dónde: archivo:línea
    Escenario: los pasos concretos (entradas → resultado malo)
    Confirmado con: el comando y el renglón de su salida  —o—  «Sin confirmar: hipótesis» / «para correr aquí»
    Corrección sugerida: una o dos líneas
  Por punto sin hallazgos: un renglón. Sin introducciones. En español. No reportes estilo ni gustos.

LA DECISIÓN QUE SE IMPLEMENTÓ (del dueño, 12 de octubre de 2026)
Antes, dar de alta y de baja personas y equipos y cambiar claves era SOLO de la consola de
administración, con otras credenciales (0013_identidad.sql): la aplicación no podía, para que quien
se meta a ella no se fabrique un jefe. Ahora hay un punto medio:
  · Lo pide un RESPONSABLE FACULTADO PARA AUTORIZAR (usuario.puede_autorizar), y lo demuestra con su
    clave en ese momento, desde un equipo dado de alta. Tener la sesión abierta no basta.
  · Desde la pantalla: alta, baja y cambio de clave de personas de MOSTRADOR, PATIO y CONSULTA; y
    alta (por código) y baja de equipos.
  · Los responsables, quien administra (rol administracion) y la facultad de autorizar siguen siendo
    SOLO de la consola. Ningún camino desde la aplicación debe poder crearlos, cambiarles la clave,
    darlos de baja, ni dar la facultad.
  · Lo que no procede se rechaza ANTES de mirar la clave (no gasta intento); una clave que no pasa no
    es un error: la función contesta nada/falso, para que el intento quede contado.

QUÉ LEER
- db/migraciones/0031_personas_y_equipos_en_pantalla.sql   LO PRINCIPAL. Siete funciones para la aplicación.
- db/migraciones/0013_identidad.sql      las de la consola que 0031 llama por dentro (alta_persona, fijar_clave,
                                         baja_persona, crear_codigo_alta, baja_equipo), comprobar_clave, canjear_codigo.
- db/migraciones/0017_inventario.sql     autorizo_con_clave (línea ~80).
- src/servidor/dominio/administracion.ts, src/servidor/clave.ts, src/app/api/administracion/**   dominio y rutas.
- pruebas/45-administracion.test.ts      lo que ya se probó (17 pruebas): no repitas eso; busca lo que NO cubre.
- src/app/panel/ajustes/page.tsx y src/componentes/ajustes/ (ConTuClave.tsx, Personas.tsx, Equipos.tsx,
  Materiales.tsx)                        la pantalla.

LOS PUNTOS, en este orden
1. FABRICARSE UN JEFE. Busca CUALQUIER camino, con las credenciales de la aplicación (feruga_app) y
   las siete funciones nuevas —solas o combinadas con las que ya había—, que termine en: una persona
   con rol responsable o administracion que no existía; alguien con puede_autorizar que no lo tenía;
   la clave de un responsable o de administracion cambiada; uno de ellos dado de baja. Piensa en: el
   rol con mayúsculas, espacios o caracteres raros ('Responsable', ' responsable', 'responsable\n');
   NULL en cada argumento; el nombre de una persona que coincide con el de un responsable; dar de
   baja y volver a dar de alta con otro rol; una persona que cambia entre la comprobación y el
   cambio (hay un FOR UPDATE y una segunda comprobación: ¿alcanzan?). Confirma con sql.sh como
   feruga_app si puedes (mira en pruebas/apoyo.ts cómo se conecta `comoApp`).
2. PASAR SIN LA CLAVE, O SIN LA FACULTAD. ¿Alguna de las cinco que escriben hace algo sin que
   autorizo_con_clave haya dicho que sí? ¿Con p_clave NULL o vacía? ¿Con una huella de equipo que no
   existe o dado de baja? ¿Un responsable SIN facultad, o uno dado de baja, o bloqueado? ¿El
   bloqueo por intentos se puede esquivar alternando funciones, o repartiendo intentos entre
   equipos? ¿El orden «primero lo que no procede, después la clave» le regala a alguien sin clave
   algo que no deba saber (más allá de lo que la lista ya enseña a un responsable facultado)?
3. LO QUE SE VE UNA SOLA VEZ. La clave nueva de una persona se sortea en administracion.ts
   (randomInt, 4 dígitos, reintenta si la base dice «se adivina sola») y viaja en la respuesta; el
   código de equipo lo genera la base. ¿Queda alguno escrito donde no debe: en la bitácora, en un
   console.error, en un mensaje de error, en una respuesta que se pueda guardar en caché? ¿El
   reintento de conClaveNueva puede gastar intentos de clave de quien lo pide, o dar de alta dos
   veces? Si la respuesta se pierde en el camino (la persona quedó dada de alta y nadie vio su
   clave), ¿la pantalla lo deja resolver (cambiarle la clave) o deja algo trabado?
4. LAS LISTAS. personas_para_administrar y equipos_para_administrar: ¿devuelven algo que no deban
   (huellas, claves, la sucursal de otro)? ¿Un equipo dado de baja puede salir como «es este»?
   ¿«adentro_de» puede nombrar un equipo dado de baja? ¿Quién las puede llamar?
5. DAR DE BAJA EQUIPOS. No se puede el propio. ¿Se puede dejar al negocio sin ningún equipo vigente
   por otro camino (dos responsables, cada uno da de baja el del otro a la vez)? ¿Qué pasa con la
   sesión de quien atendía en el equipo dado de baja y con una cuenta que tenía a medias?
6. LA PANTALLA. usePedidoConClave (ConTuClave.tsx): ¿un doble toque manda dos veces? ¿La clave
   tecleada se queda en memoria o en el DOM después de mandarla? ¿El aviso «no se supo» aparece
   cuando debe (sin respuesta o 5xx) y no cuando el servidor contestó con una regla? La hoja de «se
   ve una sola vez» no se cierra con Escape: ¿hay forma de perder la clave sin haberla visto
   (recargar, cambiar de pestaña, que llegue otra respuesta)? Quien no es responsable, ¿alcanza a
   ver algo de /panel/ajustes antes del aviso?
```
