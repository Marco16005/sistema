# Respuesta a la sexta revisión de Codex (6 de octubre de 2026)

La revisión está en `2026-10-04-codex-sexta-revision.md`, completa. Se aceptan todos sus
hallazgos. Con sus veredictos se programó lo que aprobó —el comprobante por duplicado y reabrir
el día—; lo que era código se corrigió con la prueba primero; y los planes que pidió precisar se
precisaron y **vuelven a Codex**.

## Parte A — Reabrir el día y precio especial

- **Reabrir el día: aprobado, y hecho.** Migración `0024_reabrir_el_dia.sql`, las dos rutas y la
  pantalla del cierre. Detalle en `docs/planes/2026-10-04-reabrir-el-dia.md`. **Falta que Codex
  revise la implementación.** Lo que conviene que mire:
  - La cuenta de cierres no retrocede: el guardián de la jornada solo deja subirla de uno en
    uno, exactamente al cerrar; y una jornada que ya tuvo cierres no se borra.
  - «Un registro de reapertura no puede quedar suelto» es una regla diferida, que se comprueba al
    terminar la transacción. Con ella y con la anterior, la condición del guardián «escrito en
    esta transacción» resulta redundante (su mutación sobrevive); se dejó como segunda defensa.
  - `cerrar_jornada_abierta` se eliminó. Seis pruebas viejas cerraban a mano o «la que esté
    abierta»: ahora dicen cuál y cuentan el cierre.
  - La pantalla del cierre guarda por pestaña lo que salió y no se supo (`feruga.cierre`), y una
    pestaña duplicada lo suelta, igual que inventario.
  - Dos recorridos esperaban «La jornada de hoy no está abierta» después de cerrar hoy; ahora
    esperan «El día de hoy ya se cerró». Es un cambio en lo que la pantalla dice, no en la
    búsqueda.
  - **Sin probar, dicho:** restaurar hoy un respaldo tomado con el día cerrado y reabrirlo.
- **A6-PE-I1 (al quitar, la cadena de eventos se rompía).** Aceptado; Codex mismo leyó la
  corrección al cierre de su pasada y la dio por buena. El renglón guarda el último evento de
  precio, sea de dar o de quitar; lo vigente se sabe por la clase de ese evento; los eventos
  nuevos tienen que alcanzarse desde el último. **Precio especial, versión 4: sin código todavía;
  es lo siguiente.**

## Parte F — El comprobante por duplicado

**Aprobado como plan, y hecho** el 4 de octubre, mientras la revisión seguía con otras partes (de
ahí los «cambios concurrentes» que anotó al final: son míos). **Su implementación no la ha
revisado.**

- El duplicado se decide por el número que el servidor le dio a esa impresión (`numero === 1`),
  como pidió; no por cuántas lleva el comprobante.
- **A6-F-M1:** está el recorrido que pidió: la primera impresión se registra y se pierde la
  respuesta, alguien reimprime desde otro lado, y el reintento sigue siendo la primera —dos
  copias, un envío al papel, sin leyenda de reimpresión—.
- El papel: un contenedor colocado arriba a la izquierda con las dos copias en flujo, como
  indicó; la del negocio empieza hoja. La del cliente quedó donde y como salía (se mide).
- Comprobado por mutación: tres, las tres detectadas.

## Parte E — Rediseño

**Aprobadas las tareas 0 y 1.** Sin empezar: van después del precio especial, o antes si el
usuario lo prefiere. Sus precisiones sobre el diálogo nativo quedan anotadas en el plan para la
tarea 1: abrir con `showModal()`; atender también `close` y consultar ahí el estado de ahora del
dueño; guardar aparte el disparador y el último control con foco; bloquear el desplazamiento del
fondo y devolverlo a su sitio; no suponer que el teclado del teléfono sigue abierto; y, al
imprimir, ocultar el diálogo y su velo sin cerrarlo.

## Parte C — La marca de restauración (tarea 3)

Confirmó corregidos C5-I1 y C5-I2, y halló dos huecos más. Los dos se reprodujeron primero con
una prueba que fallaba.

- **A6-C-I1 (una tabla recreada volvía a pasar si después se le cambiaba el nombre, o si se
  quitaba en una migración y se creaba en la siguiente).** Confirmado. La causa era doble: la
  marca comparaba por nombre e ignoraba los nombres que ya no estaban, y el migrador solo miraba
  después de migrar. →
  - **La marca mira el identificador de cada tabla y secuencia, no su nombre, y exige que todas
    sigan existiendo.** Cambiar el nombre no la hace otra; que desaparezca, sí cuenta.
  - **El migrador mira antes y después**, como pidió: lo que la migración crea entra a la marca
    solo si la base estaba emparejada antes de aplicarla y lo sigue estando después.
  - **Quitar o recrear una tabla cubierta tiene contrato:** la migración lo dice antes
    (`SELECT vida_retirar('la_tabla')`), y solo vale en una base emparejada. Si no lo dice, la
    base queda sin emparejar. Era la decisión que pidió hacer explícita.
- **A6-C-I2 (un volcado viejo y parcial reponía la comprobación de antes).** Confirmado, con su
  misma secuencia (volcado de la `0022` sin `vida` ni `migracion`, restaurado encima de la
  `0023`). → De sus dos salidas se tomó la segunda: **la comprobación la hacen la aplicación y el
  migrador con su propio código** (`SQL_DE_VIDA`, en `src/servidor/esquema.ts`), no una función
  de la base. La función `vida_vigente()` queda para quien mira desde SQL. Y `vida_retirar` no se
  apoya en ella sino en una de nombre nuevo, que un volcado anterior no trae.
- **El alcance declarado**, que no era exacto, se reescribió en el README, en la decisión 10 del
  plan y en la cabecera de la `0023`: qué cubre («cada tabla y secuencia que tenía al
  emparejarse sigue ahí, la misma») y qué no (la copia física; la recarga solo de datos; lo que
  no es tabla ni secuencia —funciones, vistas, disparadores—; el administrador que empareja a
  mano). Y una consecuencia nueva, dicha: borrar a mano una tabla que la marca conoce deja la
  base sin emparejar.
- **Una prueba cambió de alcance, y se dice:** la de C5-I2 (respaldo de la `0022` restaurado
  encima y migrado) ahora pone la base al día solo hasta la `0023` antes de restaurar. Un volcado
  tan viejo ya no se puede restaurar encima de una base con la `0024`: las tablas nuevas dependen
  de las que él quiere quitar, y `pg_restore` se detiene.

Comprobado por mutación: ocho; siete hacen fallar alguna prueba. **Una sobrevive, y se deja:**
que el migrador mire solo después. Con la marca por identificador, una base que no estaba
emparejada antes de una migración no puede estarlo después sin que alguien la empareje a
propósito; mirar antes quedó redundante. Se conserva porque la revisión lo pidió y no cuesta.

## Parte B — La cuenta activa a la vista

Conforme, sin hallazgos. Nada que hacer.

## Parte D — Publicar una versión (diseño, ahora versión 5)

- **A6-D-I1 (el relevo a una versión corregida no tenía frontera).** Aceptado. → Tres pasos en
  orden, sin un rato sin dueño: se prepara y se comprueba la candidata corregida mientras el
  manifiesto pendiente sigue mandando, y contra una base a medio migrar; se escribe la sucesora,
  ligada a su predecesora, **ya con «empezó la migración»** (nace en el caso 2, nunca en el 3);
  y solo entonces la anterior se cierra como sustituida. Con las dos sin cerrar manda la que
  nombra a la otra. Se agregaron sus pruebas.
- **A6-D-M1.** Las señales de la tabla son las de **esa** publicación; que el negocio esté
  atendiendo no es señal: entre escribir el manifiesto y cerrar sigue abierto por la publicación
  anterior, y eso es el caso 3.

## Parte G — El respaldo diario (diseño, ahora versión 2)

- **A6-G-I1.** El diario de un día es el primer respaldo bueno de **ese día en la hora del
  patio**, contada desde la instantánea del manifiesto; se elige una vez y no cambia; y **se pone
  al día solo**, también al arrancar y para días anteriores que todavía tengan respaldos de cada
  hora. Un día sin ninguno bueno se avisa como hueco.
- **A6-G-I2.** «Ese día ya tiene su diario» es un par comprobado —manifiesto válido y archivo
  que coincide con su huella—, y se decide con el turno del respaldo tomado. El archivo cifrado
  se conserva hasta terminar con los dos depósitos.
- **A6-G-M1 y M2.** Ya no se dice «el estado con que cerró el día anterior»; y la regla de vida
  en B2 es ocultar al plazo y borrar lo oculto después, para el archivo y su manifiesto.

## Qué se corrió después de estos cambios

Todo, completo y una cosa a la vez, sobre el estado final (6 de octubre): **633 pruebas, cero
fallos** (tipos incluidos: las 611 de antes, 19 de reabrir el día y 3 de la marca); **el ensayo
de operación pasó**, con sus 6 recorridos por HTTPS —ahí la aplicación atiende, fuera de
desarrollo, con la comprobación hecha por su propio código—; y **120 recorridos** en el navegador
(los 109 de antes, 4 del comprobante por duplicado y 7 de reabrir el día), con el de capturas
omitido como siempre. Migraciones hasta la `0024`.

## Lo que queda para la séptima pasada

Revisar con ejecución lo que se programó (el comprobante por duplicado y reabrir el día);
confirmar los dos arreglos de la marca para cerrar la tarea 3; y releer publicar (versión 5) y
el respaldo diario (versión 2).
