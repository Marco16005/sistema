# Revisión de Codex: los intentos de clave que no se deshacen y el sello de los respaldos

**13 de octubre de 2026.** Codex (`gpt-6-astra`, esfuerzo alto) revisó las dos correcciones de
seguridad que se cerraron ese día y que él mismo había dejado abiertas: los intentos de clave
(migración 0035; lo había señalado el 12 de octubre) y la autenticación del respaldo (el sello; lo
había dejado abierto al verificar su décima revisión).

Fueron dos pasadas. **La primera (encargo 24) se cortó**: terminó la parte A —los intentos— y, al
empezar la B, su servicio detuvo la corrida («This content was flagged for possible cybersecurity
risk»). Lo que alcanzó a escribir está abajo, tal cual. La segunda (encargo 25) retomó la parte B
y verificó la corrección de lo que encontró en la primera; su informe va después.

## Primera pasada (encargo 24): el informe de Codex, tal cual — incompleto

```
### [bloqueante] A1. SERIALIZABLE permite adivinar claves sin contar los fallos
Dónde: db/migraciones/0035_intentos_que_no_se_deshacen.sql:139 (comparación), :146 (UPDATE antes de los disparadores).
Escenario: dos conexiones `comoApp`, con equipo válido y jornada abierta. A: BEGIN SERIALIZABLE y SELECT count(*) FROM operacion. B: BEGIN SERIALIZABLE, verificar_clave(equipo, persona, NULL), abrir_cuenta(...) y COMMIT. A: verificar_clave(equipo, persona, candidata) y ROLLBACK. El conflicto 40001 ocurre en UPDATE, antes de los disparadores: su campo `where` revela `fallos = v_fallos + 1` si falla y `fallos = 0` si acierta. Se repite sin saber ninguna clave; seis candidatas malas y la buena dejaron cero fallos y ningún bloqueo.
Confirmado con: `sh qa/node.sh qa/sonda24-serializable.ts` → `clave 555555 ERROR 40001 CONTEXTO SQL statement "UPDATE credencial SET fallos = v_fallos + 1..."`; `clave 481516 ERROR 40001 CONTEXTO SQL statement "UPDATE credencial SET fallos = 0..."`; tras ambas, `cuenta {"fallos":0,"bloqueos":0,"bloqueada_hasta":null}`.
Corrección sugerida: reservar y persistir el intento en un único setval, bajo el candado de la credencial, ANTES de comparar la clave o ejecutar SQL que pueda fallar según su resultado; los disparadores posteriores no deben deshacer esa reserva. Ocultar el contexto del error por sí solo no corrige la cuenta.
- A2. Sin hallazgos adicionales: `sh qa/node.sh qa/sonda24-a.ts` confirmó 42501 para setval/nextval/currval/pg_sequence_last_value incluso por OID; pg_sequences devuelve last_value=null y lastval no entrega la secuencia protegida. Los auxiliares no están concedidos; las funciones para cambiar claves exigen autorización.
- A3. Sin hallazgos adicionales: `sh qa/node.sh qa/sonda24-cuenta.ts` → `nunca_antes: true`, redondeo de +999 µs y columna aislada conserva las otras dos. El máximo generado es 9000000000000099, menor que bigint; no hay nextval ni acceso de aplicación que agote la secuencia. La saturación de bloqueos/fechas es explícita; el corte antes de disparadores está en A1.
- A4. Sin hallazgos adicionales: `sh qa/node.sh qa/sonda24-cuenta.ts` → cambio de clave concurrente rechaza la anterior y cuenta un fallo; `alta deshecha { secuencia: null }`, reutilizar ese id empieza en cero. La exclusión por credencial serializa los intentos; no se repitió la prueba existente de cinco conexiones.
- A5. Sin hallazgos: `sh qa/node.sh qa/sonda24-cuenta.ts` ejecutó pg_dump y pg_restore --single-transaction --no-owner en bases desechables: fallos=2 antes/después; `ACL restaurada { grupo: false, conexion: false, secuencia: false }`. La marca sigue vigente tras crear una secuencia y tras registrar la restauración; solo inventaría public.
- B1. Pendiente: cobertura del sello.
- B2. Pendiente: sustitución, ambigüedades y repetición.
- B3. Pendiente: derivación y exposición de claves.
- B4. Pendiente: correspondencia de claves y primera vuelta.
- B5. Pendiente: configuración del servidor y vigilante.
- C1. Pendiente si alcanza: nombres y carreras.
- C2. Pendiente si alcanza: consultas del panel.
```

## Respuesta a la primera pasada

1. **[bloqueante] A1. En una transacción SERIALIZABLE se podían probar claves sin que contaran** —
   *cierto, corregido en la misma migración 0035* (todavía no estaba aplicada en ninguna base que
   no fuera desechable). La primera versión escribía la cuenta después de comparar la clave: el
   `UPDATE` del renglón, y de ahí sus disparadores, que eran los que la llevaban a la secuencia.
   Con dos conexiones en SERIALIZABLE se consigue que la base aborte a una justo en ese `UPDATE`
   —antes de los disparadores—, y el contexto del error decía cuál de los dos `UPDATE` era: el de
   «acertó» o el de «falló». Así se probaba una clave tras otra con la cuenta en cero. Se reprodujo
   aquí antes de corregir (`pruebas/11-identidad`, «a media comprobación»: cuatro claves malas
   abortadas, cero fallos). **La corrección es la que sugirió:** el intento se aparta directo en la
   secuencia (`guardar_intento`) **antes** de comparar —como si fuera a fallar; el quinto ya
   bloquea—, y si la clave resulta buena, la cuenta se pone en cero ahí mismo, también directo. El
   `UPDATE` del renglón va después y ya no decide nada: lo que la base aborte, se cancele o se
   deshaga a partir de ese punto no se lleva la cuenta. El contexto del error puede seguir
   diciendo qué pasó, pero ya está contado. Y una clave buena cuya transacción se aborta deja la
   cuenta en cero, no un fallo de más (segunda prueba nueva).
2. **A2 a A5, sin hallazgos**: la aplicación no alcanza el esquema de las secuencias por ningún
   lado que probó; el empaquetado y el redondeo no desbloquean antes de tiempo; el alta deshecha no
   deja secuencia huérfana; y respaldar y restaurar conservan la cuenta sin darle permisos a la
   aplicación ni mover la marca de la base.

## Segunda pasada (encargo 25): el informe de Codex, tal cual — terminó completa

```
B1. Cobertura: remoto/diario/como-estaba → traer; publicar --desde-respaldo → versionDe; lista (solo acredita el último) y servicio → ultimoUtilizable; selección, comprobación y repaso diario → leerManifiesto con sello. Lista imprime nombres sin acreditarlos y lo advierte sin clave. El diario recuerda pares ya comprobados hasta siete días si sus tamaños no cambian; no verifica cada corrida. volver depende del programa anterior (B4).

### [importante] B1: una anotación sin sello puede silenciar un hueco real
Dónde: operacion/diario.ts:271, operacion/diario.ts:285
Escenario: respaldo inválido del día anterior → aparece un hueco; añadir elecciones/2026-10-12.hueco.json con formato=1, dia correcto y avisado="inventado" → ningún hueco ni falla. Esta nota decide si se avisa al vigilante; sin otras fallas, pasoDiario manda «bien» (operacion/respaldar.ts:222). No acredita un respaldo.
Confirmado con: `sh qa/node.sh qa/sonda25-integridad.ts` — `B1 nota falsa: huecos 1 -> 0; fallas=0; respaldo sin sello subidos=0`.
Corrección sugerida: autenticar la anotación completa, con dominio propio y día; una nota no autenticada debe volver a avisarse.

### [importante] B1: una elección remota sin sello se fija antes de validar su día y respaldo
Dónde: operacion/diario.ts:161, operacion/diario.ts:372, operacion/diario.ts:407
Escenario: base restaurada sin elección de hoy + elecciones/2026-10-13.json alterado para señalar un par sellado de ayer → se fija y acepta ese par como diario de hoy sin falla. También puede fijarse un objeto inexistente y bloquear la elección de uno válido. Si la base ya tiene elección, prevalece y repone la remota.
Confirmado con: `sh qa/node.sh qa/sonda25-integridad.ts` — `B1 elección falsa: día 2026-10-13 acreditado con objeto del 2026-10-12; fallas=0; mismo par sellado` (registro en memoria; el registro PostgreSQL tampoco comprueba esa correspondencia, operacion/respaldar.ts:158).
Corrección sugerida: sellar la elección con dominio propio; antes de fijarla comprobar el manifiesto y que su instantánea pertenezca al día solicitado. Las elecciones y notas falsas no permiten que el programa restaure ni promueva un par sin sello: todavía exige manifiesto válido y huella. Sí permiten elegir otro par auténtico, bloquear la conservación correcta y ocultar el hueco.

B2. Campos: arreglo JSON en orden fijo; todos los campos usados están incluidos. bytes exige entero seguro positivo; publicacion ausente se firma como null, pero null explícito se rechaza. Los campos extra se descartan. objeto y corrida impiden trasladar el sello a otro nombre, incluso al nombre antiguo al segundo; delMismoMomento solo tolera sus milisegundos, sin cambiar lo firmado. La copia literal entre depósitos con la misma clave sí vale: es necesaria para el diario y no acredita contenido diferente. Sonda: `B2 copia a otro depósito: mismo objeto y sello aceptados`; `B2 renombrar al segundo sin volver a sellar: rechazado`.

### [importante] B2: el sello no demuestra que el respaldo elegido sea el último existente
Dónde: operacion/destino.ts:316, operacion/destino.ts:367; operacion/version-del-respaldo.ts:43
Escenario: hay dos pares auténticos; ocultar/eliminar del listado el más nuevo, dejando el antiguo intacto → traer sin nombre entrega el antiguo sin advertencia; versionDe toma también su publicación. No se puede rejuvenecer su fecha firmada: el problema es la omisión de los posteriores. Requiere poder ocultar el par/listado; sobrescribir solo el contenido bajo un nombre nuevo es rechazado.
Confirmado con: `sh qa/node.sh qa/sonda25-integridad.ts` — `B2 ocultar par nuevo: traer sin nombre entrega 2026-10-11; sin advertencia`.
Corrección sugerida: contrastar con un último objeto/fecha guardado fuera del depósito, o exigir elección explícita y mostrar la antigüedad. Documentar que HMAC autentica contenido, no completitud ni actualidad del listado.

### [importante] B3: claveDeSello toma texto de comentarios y no valida una identidad age
Dónde: operacion/destino.ts:112
Escenario: archivo válido para age con «# AGE-SECRET-KEY-…A» y una identidad activa B → age usa B, pero el sello se deriva de A. Archivos con distintas identidades activas y el mismo comentario dan la misma clave; también se deriva una cadena con checksum inválido. No es una colisión de HMAC, es una selección incorrecta de su entrada.
Confirmado con: `sh qa/node.sh qa/sonda25-clave.ts` — `B3 comentario de otra llave {"ageAcepta":true,"deriva":true,"derivaDeA":true,"publicaDeB":true}`; `B3 checksum incorrecto {"ageAcepta":false,"deriva":true,"derivaDeA":false,"publicaDeB":false}`.
Corrección sugerida: ignorar comentarios, exigir exactamente una identidad X25519 completa y validar longitud/Bech32/checksum; rechazar explícitamente archivos con varias identidades o formatos no soportados. La entrada normal de age-keygen funciona; minúsculas son rechazadas también por age.

B3. Exposición: publicar.sh:467 conserva la privada en una variable de shell; :506 la manda por pipe a version-del-respaldo (memoria/stdin, sin argumento, archivo ni salida); restaurar.ts:106 la pasa a age por stdin. La derivada sí sale por stdout de sello.ts:24 deliberadamente y se guarda en .env. En esta copia no llega al Compose (B5); al agregarla a environment también quedará en la salida de config, archivos temporales de configuración y conjunto.json privado (operacion/pasos.sh:166; operacion/publicacion.ts:428). El manifiesto de respaldo contiene el HMAC, no la clave ni la privada. No se observó una exposición adicional en el flujo normal; no equivale a afirmar que la derivada nunca se escribe en disco.

B4. Versión actual: restaurarDelDestino (operacion/restaurar.ts:213) rechaza null u otra derivada antes de listar/bajar; la consola arma remoto/diario/como-estaba con claveDeSello de la misma entrada que entrega a age. Los guiones actuales no permiten sustituirla por RESPALDO_SELLO. La garantía sobre qué identidad activa descifra queda limitada por B3.

### [importante] B4: la primera vuelta desde la versión que introduce el sello usa un restaurador sin esa protección
Dónde: operacion/volver.sh:143
Escenario: una vez resuelto B5, primera publicación con sello sobre una versión anterior que no lo comprueba → falla la migración → volver.sh ejecuta restaurar.ts de conf_ant. Ese restaurador comprueba huella y contenido, pero no autenticidad; reemplazar coherentemente el respaldo previo y su manifiesto conserva la debilidad anterior. La protección del código nuevo no se ejecuta en esa vuelta. Además, publicar.sh:162 toma el respaldo previo con conf_ant: en esa transición tampoco se sella al crearlo.
Confirmado con: Sin confirmar: para correr aquí. Caso exacto: publicar desde una versión sin sello, forzar fallo antes de abrir, sustituir el par previo por otro coherente cifrado para la misma pública y ejecutar volver.sh; comprobar si acepta el manifiesto sin sello. El despacho a conf_ant está confirmado por lectura; no se corrieron simulacros.
Corrección sugerida: preparar la transición con un restaurador compatible que ya verifique sellos y un respaldo previo sellado, o verificar desde una herramienta confiable actual antes de entregar el archivo al restaurador anterior.

### [bloqueante] B5: Compose no transmite RESPALDO_SELLO y detiene la operación
Dónde: docker-compose.operacion.yml:18
Escenario: poner RESPALDO_SELLO válido en .env/entorno y resolver el Compose de operación → ni comprobacion ni respaldo reciben la variable. exigirEntorno rechaza «Falta RESPALDO_SELLO»; publicar/arrancar queda detenido en la comprobación y el servicio no puede respaldar. No manda «bien».
Confirmado con: `python3 qa/sonda25-compose.py` — `B5 Compose comprobacion: RESPALDO_SELLO presente=False`; `B5 Compose respaldo: RESPALDO_SELLO presente=False`. Solo se ejecutó config con valores ficticios, sin iniciar ni tocar contenedores.
Corrección sugerida: agregar RESPALDO_SELLO al ancla entorno-del-respaldo con interpolación obligatoria y verificar que llegue a comprobacion y respaldo al resolver la configuración.

B5. Ausente/vacío/mal formado: la consola ahora/servicio rechaza la configuración antes de respaldar; no manda «bien» (alertará por silencio). Sonda `sh qa/node.sh qa/sonda25-servidor.ts`: ausente y vacío → «Falta RESPALDO_SELLO»; mal formado → «RESPALDO_SELLO no tiene su forma». La excepción MODO=desarrollo no elimina pedir ni la validación de destinoRclone.

### [importante] B5: una clave de sello con forma válida pero equivocada produce respaldos y avisos de éxito
Dónde: src/servidor/entorno.ts:82; operacion/respaldar.ts:343, operacion/respaldar.ts:355
Escenario: pública correcta + RESPALDO_SELLO de otra privada (o 64 caracteres hex arbitrarios) → se cifra y sella, la comprobación de subida pasa, el vigilante recibe «bien»; el dueño no puede acreditar ese respaldo con su privada. Lista y servicio usando esa misma configuración tampoco detectan la discordancia.
Confirmado con: `sh qa/node.sh qa/sonda25-servidor.ts` — `B5 entorno hex distinto []`; `B5 respaldo real con clave distinta: avisos=inicio,bien; avisado=true; dueño rechaza sello` (pg_dump y age reales, base desechable y depósito en memoria).
Corrección sugerida: generar pública y derivada juntas desde una identidad validada y comprobar un primer respaldo con la privada fuera del servidor antes de dar el alta por buena. El servidor no puede comprobar esa relación solo con la pública y el HMAC derivado; el ensayo periódico lo detecta después, no antes del primer «bien».

C. A1 cerrado para credenciales normales con su secuencia: `sh qa/node.sh qa/sonda24-serializable.ts` vuelve a producir 40001, pero ahora muestra fallos 1, 2, 3, 4 y luego bloqueos=1; la buena posterior devuelve false. `sh qa/node.sh qa/sonda25-aislamiento.ts`: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ y SERIALIZABLE → «cinco fallos contados tras ROLLBACK/error; bloqueo=1». `sh qa/prueba.sh pruebas/11-identidad.test.ts 'media comprobación'`: pass 2, fail 0, incluido acierto que limpia aunque aborte. En db/migraciones/0035_intentos_que_no_se_deshacen.sql:141, antes de guardar_intento solo se bloquea/lee usuario, credencial y secuencia y se descartan usuario ausente, clave null o bloqueo vigente; ninguna instrucción decide si la clave coincide. Un error previo a registrar puede abortar sin contar, pero tampoco comparó la clave. La comparación real va después del registro; el contexto del UPDATE aún distingue ramas, ahora con intento ya contado.

D1. Sin hallazgos en la revisión y la sonda `sh qa/node.sh qa/sonda25-clientes.ts`: «renombrar antes de dar precio: espera comprobada; evento=Renombrado»; «renombrar contra alta: espera comprobada; alta=RC005; un solo cliente»; «cobro toma nombre vigente y lo conserva tras otro cambio». FOR UPDATE del cambio se coordina con FOR SHARE del precio especial; el índice único lower(nombre) resuelve la carrera con alta; el comprobante congela nombre por cliente_id al confirmar (0025:174).

### [importante] D2: un ritmo de salida pequeño desborda el entero y deja sin panel de materiales
Dónde: src/servidor/dominio/materiales-del-panel.ts:140
Escenario: apertura válida de 1,000,000 kg de cobre y venta confirmada de 0.010 kg en las cuatro semanas → ceil(999999.990 × 28 / 0.010) supera int32. Tanto el patio completo como la ficha fallan; las rutas devuelven error interno en vez de los datos.
Confirmado con: `sh qa/node.sh qa/sonda25-panel.ts` — `D2 patio: integer out of range codigo=22003`; `D2 ficha: integer out of range codigo=22003`. Datos asentados con funciones y disparadores activos, sin modificar las consultas.
Corrección sugerida: mantener el cálculo en numeric y acotar lo mostrado (por ejemplo, «más de…»), o devolverlo en un tipo que admita su rango; no convertir sin límite a int.

D2. Base vacía y periodo de un día: sin error; serie=1, cuentas=0, cambio=null (`qa/sonda25-panel.ts`). Los cocientes restantes revisados protegen denominadores cero. Permisos: las tres rutas admiten únicamente responsable/consulta; ruta comprueba el rol antes de consultar. `sh qa/prueba.sh pruebas/37-panel.test.ts 'el panel lo ven'` y `sh qa/prueba.sh pruebas/47-materiales-del-panel.test.ts 'el patio y la ficha los ven'`: pass 1, fail 0 en cada una. Sin hallazgo de acceso indebido.
```

## Respuesta a la segunda pasada

1. **[bloqueante] B5. «Compose no transmite RESPALDO_SELLO»** — *falso en el proyecto: es de su
   copia.* Al poner al día la copia de Codex no se le pasan los `docker-compose*.yml` (así está
   convenido, para no pisar los suyos), y el suyo de operación era el de antes. En el proyecto,
   `docker-compose.operacion.yml` sí lleva `RESPALDO_SELLO` en el entorno del respaldo y de la
   comprobación, obligatorio; y los dos simulacros, que arman la instalación entera en modo de
   operación, pasaron con él. No se cambió nada.
2. **[importante] B1. Una anotación de hueco sin sello podía callar el aviso de un día sin diario**
   — *cierto, corregido.* Las dos anotaciones chicas que el diario deja en su depósito van ahora
   selladas con la misma clave, cada una con su nombre (`selloDeNota`: el sello de una no vale
   para la otra). Una de hueco que no lleve el sello de este negocio no da el hueco por avisado: se
   vuelve a avisar.
3. **[importante] B1. Una elección escrita en el depósito se fijaba en la base sin comprobarla** —
   *cierto, corregido.* La elección escrita también va sellada, y sin sello no se lee: el día
   queda como falla visible («no se puede leer, o no lleva el sello de este negocio») y no se
   elige otro respaldo a escondidas. Además, aunque venga sellada, no se fija si nombra un
   respaldo que no es de ese día. Como él mismo dice, ni antes de esto se lograba restaurar o
   conservar algo sin sello: lo que se podía era elegir otro par auténtico, estorbar y callar.
4. **[importante] B2. El sello no dice que el respaldo sea el último que se tomó** — *cierto; no
   tiene arreglo desde el depósito, y se dice.* Si alguien escondiera los últimos, «el último»
   sería uno anterior y auténtico. Ahora, al restaurar, se dice de hace cuánto es el respaldo, y si
   se pidió «el último» y tiene más de un día, se advierte con todas sus letras que auténtico no es
   lo mismo que reciente y con qué compararlo: el último «terminó bien» que recibió el vigilante,
   que está fuera del depósito. Está en el README y en la guía. No se guardó un «último respaldo
   conocido» en otro lado: sería un tercer lugar que cuidar, y el vigilante ya lo es.
5. **[importante] B3. La clave del sello salía del primer texto con forma de llave, aunque fuera
   un comentario o estuviera mal escrito** — *cierto, corregido.* La llave se lee ahora como la lee
   `age` (`operacion/llave.ts`): los comentarios no cuentan, tiene que haber una sola identidad, y
   tiene que estar bien escrita hasta su última letra (se comprueba su suma, Bech32). De esa misma
   lectura sale su llave pública, y una prueba la compara con la que dice `age-keygen`.
6. **[importante] B4. La primera vuelta desde la versión que trae el sello la haría un
   restaurador que no lo comprueba** — *cierto en general, y aquí no llega a pasar:* no existe
   ninguna instalación de antes del sello. La primera publicación en el servidor de verdad ya lo
   trae, y desde ahí toda «versión anterior» lo comprueba. Queda dicho en el README. No se corrió
   el caso (él tampoco): no hay versión sin sello de la que partir.
7. **[importante] B5. Un sello con buena forma pero de otra llave da respaldos que el dueño no
   puede acreditar, y avisos de «bien»** — *cierto; atendido como sugiere, sin poder cerrarlo del
   todo.* El servidor no puede saber, con la llave pública y el sello, que los dos salieron de la
   misma privada. Lo que se hizo: `operacion/sello.ts` da ahora **los dos renglones juntos**, de
   la misma llave ya comprobada (`RESPALDO_LLAVE_PUBLICA` y `RESPALDO_SELLO`); y la guía pide,
   antes de dar una instalación por buena, comprobar desde fuera del servidor y con la llave que
   el primer respaldo lleva su sello. Si aun así quedaran disparejos, los respaldos de esos días no
   se pierden —están cifrados para la llave correcta—, pero no se restauran por el camino normal.
8. **C. Lo de la primera pasada (A1), cerrado**: repitió su sonda y otra con los cuatro niveles de
   aislamiento; cada intento fallido queda contado aunque la transacción termine en error.
9. **D1, sin hallazgos** en el cambio de nombre de un cliente.
10. **[importante] D2. Con muchísimo de un material y una salida diminuta, «alcanza para» no cabía
    en un entero y el panel de materiales dejaba de salir** — *cierto, corregido.* Tiene tope: de
    diez años en adelante se dice «más de diez años». Se vio fallar aquí antes de corregir.

Lo que se vio fallar aquí antes de corregirlo: A1, D2, el respaldo sustituido y la edad del
respaldo al restaurar. Lo de la llave (B3) y lo de las anotaciones del diario (B1) se escribió
prueba y arreglo en un solo paso: las fallas las había demostrado la sonda de Codex, no una
corrida de estas pruebas. **Ninguna de estas correcciones la ha vuelto a revisar Codex.**

## El encargo 24

```
Revisión de control de calidad, UNA sola pasada: DOS CORRECCIONES DE SEGURIDAD que tú mismo dejaste
abiertas en revisiones anteriores, y que se cerraron hoy. No las escribiste tú. Revisa como quien
quiere romperlas.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL, Docker Compose).
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa12/   (al día con el proyecto, 13 de octubre de 2026)
EL INFORME: /tmp/feruga-codex-informe-24.md

CÓMO VA ESTA PASADA
Tu cuota puede cortarse. Gasta en pensar y en confirmar con una sonda; no en leer de más. Crea el
informe al empezar con la lista de los puntos y GUÁRDALO después de cada punto.
NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo y sigue. Los puntos van en orden de
importancia: si se corta, que haya quedado lo primero.

YA ESTÁ PREPARADO — no lo rehagas
- La copia, sin node_modules. OJO: tu plantilla feruga_plantilla_codex tiene 33 migraciones; la
  copia ahora trae hasta la 0036. Antes de cualquier sonda: `sh qa/plantilla.sh` (deja 36).
- Comandos (ver qa/LEEME.md):
    sh qa/plantilla.sh
    sh qa/prueba.sh <archivo de pruebas> ['parte del nombre']
    sh qa/sql.sh "<SQL>"
    sh qa/node.sh <programa.ts>          (tus sondas van en qa/)
- NO corras la batería completa, ni los recorridos del navegador, ni los simulacros
  (operacion/ensayo*.sh): aquí ya se corren. Si para confirmar algo hace falta uno de esos, escribe
  el caso exacto y márcalo «Sin confirmar: para correr aquí».

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

═══ A. LOS INTENTOS DE CLAVE QUE NO SE DESHACEN (migración 0035) ═══

Lo que encontraste el 12 de octubre: con las credenciales SQL de feruga_app se podía probar una clave
dentro de una transacción y hacer ROLLBACK si no pasaba; el fallo no quedaba contado y nunca había
bloqueo. Lo que se hizo: la cuenta (fallos, bloqueos seguidos, bloqueada_hasta) vive ADEMÁS en una
secuencia por persona, intentos.c<usuario_id>, que no es transaccional. comprobar_clave decide con
lo que dice la secuencia; las tres columnas de `credencial` le siguen, y tres disparadores (uno por
columna) llevan a la secuencia lo que se les escriba. El esquema `intentos` no tiene permisos para
feruga_app.

Leer: db/migraciones/0035_intentos_que_no_se_deshacen.sql (entera, es corta);
      db/migraciones/0013_identidad.sql (comprobar_clave original ~104, entrar ~187, verificar_clave ~206, fijar_clave ~255);
      pruebas/11-identidad.test.ts (busca «deshag»: lo que ya se probó; no lo repitas).

A1. Con la conexión de la aplicación (feruga_app; en las pruebas, `comoApp`), busca CUALQUIER manera
    de probar claves de una persona sin que la cuenta suba, o de bajarla o ponerla en cero sin saber
    la clave: SAVEPOINT / ROLLBACK TO, transacciones preparadas, REPEATABLE READ o SERIALIZABLE (¿la
    lectura de la secuencia se queda en una foto vieja?), cancelar la consulta o statement_timeout /
    lock_timeout a media función, muchas conexiones a la vez, cualquier otra función que llame a
    comprobar_clave (entrar, verificar_clave, las de autorizar de 0016/0017/0025/0031), y cualquier
    función que la aplicación SÍ pueda ejecutar y que escriba fallos/bloqueos/bloqueada_hasta.
A2. ¿feruga_app puede leer, mover, crear o borrar algo en el esquema `intentos`, directa o
    indirectamente (setval, nextval, currval, lastval, pg_sequences, pg_sequence_last_value,
    funciones SECURITY DEFINER que tomen un nombre)? ¿Puede enterarse por ahí de cuántos fallos
    lleva alguien o de si su clave fue correcta?
A3. El empaquetado (intento_empacado / intentos_de / credencial_cuenta): ¿hay valores de las
    columnas —o un orden de los tres disparadores— que dejen la secuencia en algo distinto de lo que
    se escribió, o que desbloqueen antes de tiempo? ¿El redondeo a milisegundos puede desbloquear
    antes de la hora? ¿Qué pasa con la secuencia en su valor máximo?
A4. Carreras: dos comprobar_clave a la vez de la misma persona; un fijar_clave (consola) a la vez
    que un intento; el alta de una persona que se deshace (¿queda una secuencia huérfana que luego
    estorbe o que herede otra persona con el mismo id?).
A5. Respaldar y restaurar (operacion/restaurar.ts usa pg_restore --single-transaction --no-owner):
    ¿las secuencias de `intentos` vuelven con su valor y SIN permisos para feruga_app ni para el
    usuario de conexión de la web (db/rol.ts)? ¿La marca de vida (src/servidor/esquema.ts, solo
    mira `public`) se ve afectada por secuencias que nacen fuera de una migración?
NO es hallazgo (ya se sabe y está dicho en la migración): quien tiene esa contraseña puede bloquear a
alguien a propósito a fuerza de fallar; el renglón de bitácora del bloqueo sí se deshace con la
transacción; la política de 5 intentos y bloqueos de 5, 15 y 60 minutos no cambió.

═══ B. EL SELLO DE LOS RESPALDOS ═══

Lo que dejaste abierto al verificar tu décima revisión (bloqueante): quien pudiera escribir en el
almacenamiento sustituía un respaldo y su manifiesto —cifrando lo suyo con la llave pública y
rehaciendo tamaño y SHA-256— y al instalar o volver se ejecutaba su SQL con la conexión
administrativa, antes de auditar; y el manifiesto decidía además qué commit se le pedía al operador.
Lo que se hizo: cada manifiesto lleva `sello` = HMAC-SHA256 de todo lo que dice, con una clave que
se DERIVA de la llave privada de age (claveDeSello: HMAC-SHA256 con una etiqueta fija como clave y
el renglón AGE-SECRET-KEY-1… como mensaje). El servidor guarda solo la derivada (RESPALDO_SELLO) y
con ella sella; quien restaura la deriva de la llave con que va a descifrar y comprueba el sello
ANTES de bajar, descifrar o restaurar. La clave viaja dentro del objeto `Destino` (campo `sello`,
obligatorio de decir aunque sea null): leerManifiesto la exige.

Leer: operacion/destino.ts (entero: es donde está todo), operacion/sello.ts,
      operacion/respaldar.ts (~250-360 y la consola al final), operacion/restaurar.ts (~205-240 y la consola),
      operacion/version-del-respaldo.ts, operacion/diario.ts (solo donde llama a leerManifiesto),
      operacion/publicar.sh (~495-560: instalar desde un respaldo), operacion/volver.sh (~140-150),
      src/servidor/entorno.ts (~80), pruebas/23-respaldo.test.ts (busca «el sello»: lo ya probado).

B1. Busca CUALQUIER camino por el que algo que viene del almacenamiento se crea, se descifre, se
    restaure o decida un commit SIN pasar por el sello comprobado con la clave derivada de la llave
    del operador: restaurar --remoto / --diario / --como-estaba, publicar.sh --desde-respaldo,
    volver.sh, version-del-respaldo.ts, la lista, el servicio al decidir «ya se respaldó», el diario
    al elegir y al repasar. ¿Queda algún `leerManifiesto`/JSON.parse de un manifiesto sin clave?
B2. Con poder de ESCRITURA en el depósito (no en el servidor) y conociendo la llave pública y
    manifiestos sellados anteriores: ¿se puede hacer pasar por bueno algo que el servidor no selló?
    Piensa en: reusar un sello viejo con otro contenido; ambigüedades de lo que entra al HMAC
    (selloDe: orden fijo en un JSON; `publicacion` ausente vs null; números; campos de más);
    renombrar un respaldo sellado (nombre de antes, al segundo: OBJETO / delMismoMomento);
    reponer un respaldo viejo válido como «el último»; mover uno del depósito de cada hora al
    diario o al revés; un manifiesto válido cuyo objeto se sustituye.
B3. La derivación (claveDeSello): ¿hay entradas distintas que den la misma clave, o una llave
    válida que no se reconozca (minúsculas, varios renglones, llaves de otro tipo)? ¿La clave o la
    llave pueden acabar en argumentos de un proceso, en lo que se imprime, en un archivo temporal o
    en un manifiesto? ¿El guion publicar.sh expone la llave al pasarla a version-del-respaldo?
B4. restaurarDelDestino exige que destino.sello sea el derivado de la llave que descifra. ¿Se le
    puede dar la vuelta? ¿Y volver.sh, que restaura «con el programa de la versión ANTERIOR»: qué
    pasa en la primera publicación que trae el sello, cuando la versión anterior no lo comprueba?
    Dilo aunque sea solo de documentar.
B5. El servidor: con RESPALDO_SELLO mal puesto (otro, vacío, mal formado), ¿se toma un respaldo que
    luego nadie puede acreditar sin que nadie se entere? ¿El vigilante recibe «bien»?
NO es hallazgo (ya se sabe y está dicho): un servidor comprometido entero tiene la clave y puede
sellar; restaurar un ARCHIVO que el operador ya tiene (sin --remoto) no tiene manifiesto ni sello;
los respaldos de antes del sello no se restauran con esta versión (no existe ninguno real).

═══ C. SI SOBRA CUOTA ═══
C1. db/migraciones/0036_el_nombre_de_un_cliente_en_pantalla.sql (cambiar_nombre_de_cliente): carreras
    con dar_precio_especial (0033/0027) y con alta_cliente; ¿un cliente puede quedar con el nombre
    de otro, o una cuenta cobrada con un nombre que no era el suyo en ese momento?
C2. src/servidor/dominio/panel.ts y materiales-del-panel.ts son consultas nuevas de solo lectura
    para quien dirige: ¿alguna deja ver algo a un rol que no debe, o revienta con datos raros
    (división entre cero, periodos de un día, bases vacías)?

AL TERMINAR: el informe completo en /tmp/feruga-codex-informe-24.md, y en tu respuesta final solo
un resumen de tres renglones y la ruta del informe.
```

## El encargo 25

```
Revisión de control de calidad, UNA sola pasada. Es la continuación de la número 24, que se cortó
al terminar la parte A. Aquí va lo que faltó: la integridad de los respaldos (parte B), y dos
comprobaciones cortas (C y D). Es una revisión defensiva del sistema propio de un negocio: se trata
de confirmar que las comprobaciones de integridad se aplican siempre, y de decir dónde no.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL, Docker Compose).
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa12/   (al día con el proyecto, 13 de octubre de 2026)
EL INFORME: /tmp/feruga-codex-informe-25.md

CÓMO VA ESTA PASADA
Tu cuota puede cortarse. Gasta en pensar y en confirmar con una sonda; no en leer de más. Crea el
informe al empezar con la lista de los puntos y GUÁRDALO después de cada punto.
NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo y sigue. Los puntos van en orden de
importancia: si se corta, que haya quedado lo primero.

YA ESTÁ PREPARADO — no lo rehagas
- La copia, sin node_modules. OJO: la migración 0035 CAMBIÓ desde tu pasada anterior (se corrigió
  lo que encontraste). Antes de cualquier sonda: `sh qa/plantilla.sh` (deja 36 migraciones).
- Comandos (ver qa/LEEME.md):
    sh qa/plantilla.sh
    sh qa/prueba.sh <archivo de pruebas> ['parte del nombre']
    sh qa/sql.sh "<SQL>"
    sh qa/node.sh <programa.ts>          (tus sondas van en qa/)
- NO corras la batería completa, ni los recorridos del navegador, ni los simulacros
  (operacion/ensayo*.sh): aquí ya se corren. Si para confirmar algo hace falta uno de esos, escribe
  el caso exacto y márcalo «Sin confirmar: para correr aquí».

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja en /tmp/feruga-codex-qa12/ (ahí sí puedes crear sondas tuyas, en qa/). No corrijas el
  código: di qué está mal y cómo se arregla. No sustituyas su docker-compose.yml. No ejecutes npm ci
  ni npm install. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 ni la base «feruga»: son del usuario.
- Formato, corto. Por hallazgo:
    ### [bloqueante | importante | menor] título
    Dónde: archivo:línea
    Escenario: los pasos concretos (entradas → resultado incorrecto)
    Confirmado con: el comando y el renglón de su salida  —o—  «Sin confirmar: hipótesis» / «para correr aquí»
    Corrección sugerida: una o dos líneas
  Por punto sin hallazgos: un renglón. Sin introducciones. En español. No reportes estilo ni gustos.

═══ B. EL SELLO DE INTEGRIDAD DE LOS RESPALDOS ═══

Contexto. Cada respaldo es un archivo cifrado con `age` más un manifiesto JSON que lo describe
(nombre, tamaño, SHA-256, momento, versión del esquema y la publicación que corría). Al verificar
tu décima revisión dejaste abierto que el manifiesto y el archivo solo se comparaban entre sí: si
los dos objetos del depósito se reemplazaban de forma coherente, el programa de restauración los
aceptaba. Lo que se hizo: cada manifiesto lleva ahora `sello` = HMAC-SHA256 de todos sus campos, con
una clave que se DERIVA de la llave privada de age del dueño (función claveDeSello). El servidor
guarda solo la clave derivada (variable RESPALDO_SELLO) y con ella sella al respaldar; quien
restaura la deriva de la llave con que va a descifrar y comprueba el sello ANTES de bajar,
descifrar o restaurar. La clave viaja dentro del objeto `Destino` (campo `sello`, que hay que
decir siempre, aunque sea null); leerManifiesto la exige como tercer argumento.

Leer: operacion/destino.ts (entero: ahí está todo), operacion/sello.ts,
      operacion/respaldar.ts (~250-365 y la consola al final), operacion/restaurar.ts (~205-245 y la consola),
      operacion/version-del-respaldo.ts, operacion/diario.ts (donde llama a leerManifiesto y alrededor),
      operacion/publicar.sh (~495-560), operacion/volver.sh (~140-150),
      src/servidor/entorno.ts (~80), pruebas/23-respaldo.test.ts (busca «el sello»: lo ya probado; no lo repitas).

B1. COBERTURA. Confirma que todo camino que lee un manifiesto del depósito, o que decide algo a
    partir de él, pasa por leerManifiesto con la clave: restaurar --remoto / --diario / --como-estaba,
    publicar.sh --desde-respaldo, volver.sh, version-del-respaldo.ts, la orden «lista», el servicio
    cuando decide que ya se respaldó, y el diario cuando elige el respaldo del día y cuando repasa
    uno ya subido. En tu pasada anterior alcanzaste a notar que el diario toma algunas decisiones
    con archivos distintos del manifiesto sellado (la «elección» y las anotaciones que guarda en el
    depósito): di exactamente cuáles, qué se decide con ellos, y si un archivo de esos alterado en
    el depósito puede llevar a restaurar o a conservar por un año algo que el servidor no selló.
B2. QUÉ CUBRE EL SELLO. Revisa selloDe y leerManifiesto: ¿todos los campos que después se usan
    entran al HMAC, en una forma sin ambigüedad (orden fijo en un arreglo JSON; `publicacion`
    ausente frente a null; números; campos de más, que se descartan)? ¿Un manifiesto sellado para
    un respaldo puede acreditar otro objeto, otro nombre (incluido el nombre «de antes», al segundo:
    OBJETO y delMismoMomento), u otro depósito (el de cada hora frente al diario)? ¿Un respaldo
    sellado antiguo puede presentarse como «el último»?
B3. LA CLAVE. claveDeSello: ¿hay entradas distintas que den la misma clave, o una llave válida que
    no se reconozca? ¿La llave privada o la clave derivada pueden terminar en los argumentos de un
    proceso, en la salida de un programa, en un archivo temporal o dentro de un manifiesto?
    publicar.sh le pasa la llave a version-del-respaldo.ts por la entrada estándar: confirma que no
    queda en ningún otro lado.
B4. COHERENCIA AL RESTAURAR. restaurarDelDestino exige que destino.sello sea el derivado de la llave
    que descifra. ¿Hay algún camino de la consola o de los guiones que arme el Destino con otra
    clave, o con null, y aun así restaure? volver.sh restaura «con el programa de la versión
    ANTERIOR»: describe qué ocurre en la primera publicación que trae el sello, cuando la versión
    anterior todavía no lo comprueba. Dilo aunque solo sea para documentarlo.
B5. EL SERVIDOR. Con RESPALDO_SELLO ausente, vacío, mal formado o distinto del que corresponde a la
    llave pública configurada: ¿se toma un respaldo que después no se puede acreditar sin que nadie
    se entere? ¿El vigilante recibe «bien»? ¿Hay manera de detectarlo a tiempo?
NO es hallazgo (ya se sabe y está documentado): quien controle el servidor entero tiene la clave
derivada; restaurar un ARCHIVO local (sin --remoto) no tiene manifiesto ni sello; los respaldos
anteriores al sello no se restauran con esta versión (no existe ninguno real).

═══ C. VERIFICACIÓN DE LO QUE ENCONTRASTE EN LA PASADA 24 (A1) ═══
En db/migraciones/0035_intentos_que_no_se_deshacen.sql, comprobar_clave ahora registra el intento
en la secuencia de la persona (guardar_intento) ANTES de comparar la clave, y si resulta correcta
pone la cuenta en cero ahí mismo; el UPDATE del renglón va después. Las pruebas nuevas están en
pruebas/11-identidad.test.ts (busca «media comprobación»). Repite tu sonda
qa/sonda24-serializable.ts y di si quedó cerrado: ¿cada verificación fallida queda contada aunque
la transacción termine en error o se deshaga, en cualquier nivel de aislamiento? ¿Quedó algún
enunciado ANTES del registro cuyo resultado dependa de si la clave era correcta?

═══ D. SI SOBRA CUOTA ═══
D1. db/migraciones/0036_el_nombre_de_un_cliente_en_pantalla.sql (cambiar_nombre_de_cliente):
    concurrencia con dar_precio_especial (0033/0027) y con alta_cliente; ¿un cliente puede quedar
    con el nombre de otro, o una cuenta cobrada con un nombre que no era el suyo en ese momento?
D2. src/servidor/dominio/panel.ts y materiales-del-panel.ts son consultas nuevas de solo lectura
    para quien dirige: ¿alguna muestra algo a un rol que no debe, o falla con datos límite
    (división entre cero, periodos de un día, bases vacías)?

AL TERMINAR: el informe completo en /tmp/feruga-codex-informe-25.md, y en tu respuesta final solo
un resumen de tres renglones y la ruta del informe.
```
