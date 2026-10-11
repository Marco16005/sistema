# Respuesta a la revisión de Codex de las tareas 3 y 4 (4 de octubre de 2026)

Informe: `2026-10-04-codex-revision-de-respaldo-y-proxy.md`. No dio por cerradas las tareas: un
bloqueante, siete importantes y dos menores, y once observaciones sobre pruebas que no acreditaban
todo lo que decían. Se aceptan todos. Cada corrección se hizo con la prueba primero; donde la
prueba y el arreglo se escribieron juntos, se comprobó después por mutación que la prueba falla si
se quita el arreglo.

Quedó en **594 pruebas**, **106 recorridos** y el ensayo de operación con **6 recorridos por HTTPS**.

## Bloqueante

**B1 — La salud fallaba, pero la aplicación seguía atendiendo sobre una base que no es apta.**
Aceptado, y es el más serio: yo había probado que `/api/salud` contestaba 503 y de ahí deduje que
«la aplicación no atiende». El proxy no consulta la salud en cada petición, y un servicio que ya
corre no se detiene porque la base cambie debajo. → `baseApta` (`src/servidor/esquema.ts`): la
base está en la versión del esquema que la aplicación espera y, fuera de desarrollo, no es una
restaurada sin registrar. **Lo pregunta cada ruta en cada petición**, antes que nada
(`src/servidor/ruta.ts`), y la salud usa la misma función.
Pruebas: con una migración de otra versión en la base, **todas** las rutas —con sesión de
responsable, con equipo sin persona y sin equipo— contestan 503, y no cambia ni una fila
(`17-rutas`); fuera de desarrollo, con una base restaurada sin registrar, abrir una compra con
sesión válida contesta 503 y no la abre (`22-restauracion`). Y en el ensayo, **a través del proxy
por HTTPS**: salud 503, la compra se niega, la pantalla no ofrece abrirla, y al quitar la
migración vuelve sin reiniciar nada. Las dos pruebas se vieron fallar antes del arreglo.
Costo: una consulta más por petición (dos fuera de desarrollo). Se acepta.

## Importantes

**I1 — «El último respaldo» podía ser el anterior, dentro del mismo segundo.** Aceptado. → El
nombre lleva el momento **al milisegundo**, y el orden de los nombres es el orden en el tiempo; el
identificador de la corrida solo desempata dos del mismo milisegundo, que no se dan porque los
respaldos van de uno en uno. La prueba que restauraba «el último» ya no espera un segundo entre
los dos. Y `respaldar ahora` dice el nombre de lo que tomó en una línea aparte (`respaldo: …`),
para que quien publique una versión vuelva a **ese**, no «al último».

**I2 — Un manifiesto dañado seguía contando como respaldo reciente.** Aceptado. →
`ultimoUtilizable` lee y valida el manifiesto, del más nuevo hacia atrás; con eso decide el
servicio si ya respaldó. Restaurar «el último» no baja en silencio a uno más viejo: dice que el
más nuevo no sirve y cuál es el último que sí, para pedirlo por su nombre. `lista` dice cuál es el
último con su manifiesto en orden.
Corrijo también una afirmación mía: **no es cierto que «cualquier fallo deja cero manifiestos»**.
Si el fallo llega después de subirlo (al volver a leerlo), el manifiesto ya está en el
almacenamiento, y el servidor no puede borrarlo. La corrida avisa del fallo; si el manifiesto
quedó bien, el respaldo existe y cuenta; si quedó dañado, no cuenta. Lo que decide es lo que se
lee, no cómo terminó la corrida.

**I3 — El esquema del manifiesto podía no ser el del volcado.** Aceptado. → La corrida fija una
instantánea, lee de ella la versión del esquema y **le presta esa misma instantánea a `pg_dump`**
(`pg_export_snapshot` / `--snapshot`). Si entra una migración un instante después, ni el volcado
la trae ni el manifiesto la nombra. La prueba retiene a `pg_dump` justo antes de arrancar, aplica
una migración, y compara el manifiesto contra lo que trae el volcado mismo.

**I4 — Un respaldo de una versión más nueva se restauraba, y `--ensayo` avisaba de un éxito que
no era.** Aceptado. → Restaurar comprueba que la base, ya migrada, quede exactamente en la versión
que este programa conoce; si el manifiesto ya dice que es más nueva, ni lo intenta. Y antes de dar
la base por buena **entra como entra la aplicación** y comprueba que la puede usar: quedó
registrada como restaurada y se lee. Si no, no queda ninguna base.
**Lo que no se hizo:** la decisión 18 pide que el ensayo periódico *levante la aplicación*. Hoy
`--ensayo` acredita que se restauró y que el usuario de la aplicación puede usar la base; no que
el contenedor de la aplicación arranque y atienda. Eso es un guion de varias piezas y va con la
guía (tarea 6). **La decisión 18 no se da por cumplida.**

**I5 — `levantar.sh` comprobaba un entorno y podía aplicar otro.** Aceptado. → La configuración
se resuelve **una sola vez** (`docker compose config`), y ese mismo archivo es el que se comprueba
y el que se levanta. Lleva las claves puestas, así que vive en una carpeta privada mientras dura
la operación. Y una operación a la vez: un candado en la carpeta de la instalación.
El ensayo repite la secuencia de Codex —un intermediario cambia el `.env` justo antes del `up`— y
comprueba que la barrera se disparó, que nada se reemplazó y que el sitio siguió atendiendo.
También, que levantar otra vez sin cambios no reinicia nada.
**Límites:** el candado es entre estos guiones; quien use `docker compose` a mano se lo salta. Y
el guion todavía construye desde la carpeta de trabajo: que una versión nueva del código no entre
sin ventana ni respaldo es justo la tarea 5.

**I6 — `comprobar red` aceptaba exposición que no pasa por `ports`.** Aceptado. → Rechaza
`network_mode: host` (y cualquier red que no sea la de los contenedores), `privileged`, y el
socket de Docker también cuando se monta la carpeta que lo contiene (`/`, `/var`, `/var/run`,
`/run`). Tampoco en un ensayo.
**Límite, dicho:** no es una auditoría de todo lo que Compose permite (capacidades, dispositivos,
espacio de procesos de la máquina). Lo que de verdad contesta desde fuera se comprueba desde otra
máquina, en la tarea 7.

**I7 — Un reloj que retrocede dejaba horas sin respaldar.** Aceptado. → Un último respaldo «del
futuro» cuenta como pendiente. Y la corrida se anota con el reloj de la máquina, que es con el que
se decide: así tampoco se pone a respaldar sin parar si el reloj de la base va adelantado. Dos
pruebas: la secuencia de Codex, y el reloj de la base cinco segundos adelante.

## Menores

**M1 — El ensayo exponía sus secretos de prueba.** Aceptado. La llave de prueba ya se genera sin
que Docker guarde su salida (`--log-driver none`). La clave del almacenamiento de mentira sí sigue
en los argumentos de `mcli`, en el ensayo y en el apoyo de las pruebas: son credenciales
desechables de un almacenamiento en memoria. **El alcance de «ninguna clave viaja en argumentos»
es la operación** (`pg_dump`, `pg_restore`, `rclone`, `age`), que es lo que las pruebas miran. La
guía no copiará ese patrón para la llave de verdad.

**M2 — El ensayo dejaba su entorno si fallaba pronto.** Aceptado. La limpieza se instala al crear
la carpeta y sirve aunque el proyecto de Compose todavía no exista.

## Las pruebas que no acreditaban todo lo que decían

1. **«pg_dump sin permiso» pasaba por otra razón.** Cierto: fallaba antes, al leer `migracion`.
   Ahora quien se conecta puede leer la versión del esquema, y la prueba exige el error de
   `pg_dump`. De paso: el error de un programa se guarda con su **principio y su final**; antes
   solo el final, y el principio —que es donde `pg_dump` dice qué pasó— se perdía.
2. **«Restaurar el último» evitaba el empate.** Corregido con I1.
3. **«Nada atiende con una base no apta» no se deducía de la salud.** Corregido con B1.
4. **«Fallo = no hay manifiesto».** Corregido con I2: prueba del manifiesto dañado después de subir.
5. **Orden de arranque.** Ahora con barrera: el ensayo toma el candado del migrador, deja a la
   migración esperando, y comprueba que mientras tanto ni la aplicación ni el proxy arrancan y que
   la base sigue sin migrar. **Sigue sin barrera** que la base espere a la comprobación (se ve en
   que, con el entorno mal puesto, la base nunca arranca) y que la migración espere a que la base
   esté lista.
6. **«Nada del ensayo sale a la red».** Ya no se busca una cadena en un listado: se mira cada
   contenedor, cada puerto que publica y en qué dirección, y que ninguno use la red de la máquina.
7. **Validación del certificado.** Sin cambio; la mutación (quitarle la autoridad al navegador)
   sí se corrió: falla con `ERR_CERT_AUTHORITY_INVALID`.
8. **Persistencia del certificado.** Sin cambio: **no está comprobada por mutación**.
9. **«Candados entre pestañas».** Era una sola página. Ahora son dos: lo que una tiene tomado, la
   otra no lo consigue; al cerrarse la primera, sí.
10. **Los avisos del respaldo manual** se comprueban con el identificador de esa corrida.
11. **`--ensayo`.** Ver I4.

## Lo demás que señaló

- **Plazos que faltaban:** `pg_dump --version`, y el descifrado y la restauración, ya tienen
  plazo. No se provocó un bloqueo en ellos: **sin prueba**.
- **Que el reinicio del motor no repite el orden de Compose:** cierto, y es otra razón de B1. La
  barrera permanente es que cada ruta pregunte si la base es apta, no el orden de arranque.
- **Las respuestas del negocio** (cuánto se puede perder, comprobantes, custodios) siguen
  pendientes: que estén como configuración no las vuelve decisiones aprobadas. De acuerdo.

## Mutaciones corridas en esta ronda

Las siete de los arreglos (reloj que retrocede, reloj de la base adelantado, nombres al segundo,
dar por bueno un manifiesto sin leerlo, volcar sin la instantánea compartida, restaurar sin mirar
la versión, fiarse solo del manifiesto): todas hacen fallar su prueba. En el ensayo, tres:
levantar lo que haya en el `.env` al momento del `up` (falla en su paso: «no levantó lo que había
comprobado»); la aplicación sin ninguna dependencia (falla, pero **antes** y por otra razón: sin
dependencias arranca con el entorno mal puesto); y la aplicación esperando a la base pero no a la
migración, que es la que de verdad prueba la barrera: falla con «web arrancó antes de que
terminara la migración».

**No se repitieron** las 23 mutaciones anteriores de la tarea 3 después de estos cambios, ni las
de `comprobar red` nuevas (se vieron fallar antes del arreglo, que es lo equivalente).

## Lo que sigue sin poderse confirmar aquí

Lo mismo que dice el informe: un motor Docker vacío, el certificado público y su renovación, el
proveedor real, el acceso desde otra máquina, volcados de varios GB, y el reinicio completo de la
máquina. Todo eso es de la tarea 7.

Se le devuelve a Codex para verificar antes de empezar la tarea 5.
