# Respuesta a la quinta revisión de Codex (4 de octubre de 2026)

La revisión está en `2026-10-04-codex-quinta-revision.md`. **Quedó incompleta:** terminó las
partes A, E, D y C, y se le acabó la cuota al empezar la B (la cuenta activa a la vista), que **se
repite**. Aquí se atiende lo que sí entregó. Se aceptan todos sus hallazgos, con una aclaración
(los códigos de error, abajo). Lo que era código se corrigió con la prueba primero; los planes se
reescribieron y **vuelven a Codex antes de codificarse**.

## Parte A — Precio especial y reabrir el día (planes, ahora versión 3)

- **A5-RE-I1 (una orden vieja de cerrar podía cerrar un día recién reabierto).** Aceptado; es el
  mismo problema que ya se había resuelto para reabrir, visto del otro lado. → **Cerrar también va
  dirigido y con envío.** La jornada lleva la cuenta de sus cierres, que solo sube y se cambia
  con su candado tomado; cerrar dice qué jornada y cuántos cierres llevaba cuando la pantalla la
  vio abierta. `cerrar_jornada_abierta` («la que esté abierta ahora») se retira de la ruta.
  Queda dicha la diferencia que pidió: **repetir el mismo envío** devuelve su resultado original
  aunque después se haya deshecho; **una petición nueva** dirigida a algo que ya no es lo vigente
  se rechaza. Decisiones 1, 2 y 6, y sus tareas.
- **A5-PE-I1 (el permiso del guardián, demasiado resumido).** → El renglón guarda el evento que
  explica su precio. El cambio pasa solo si precio, autorizante y evento cambian juntos, y el
  evento nuevo se escribió en esa transacción, es de ese renglón, **nombra como anterior al
  evento que el renglón tenía**, y sus precios, su cliente y su autorizante son los que quedan.
  Como la cadena es una sola, un evento viejo no se vuelve a instalar. Y al revés: un evento no
  puede quedar suelto al terminar la transacción. Decisión 1, con las pruebas que pidió (dar P1 →
  dar P2 → P1 a mano; cambiar solo el autorizante; el evento aislado).
- **A5-PE-I2 («hoy» y los candados).** Tenía razón en las dos cosas. `jornada_abierta` no mira la
  fecha ni toma candado: ahora, ya con los candados, se relee la jornada y se compara con el
  reloj de verdad. Y **el orden de los candados estaba al revés** en la versión 2: las funciones
  que ya existen toman primero la cuenta y después la jornada en modo compartido; el precio
  especial hace lo mismo (cuenta → renglón → jornada de hoy, compartida), y cerrar toma la jornada
  en exclusiva sin tomar cuentas. Decisiones 6 y 7; la prueba con barrera exige que no se traben.
- **A5-PE-I3 (el contenido de los envíos).** → Incluye la acción y el evento que se vio; la clave
  se comprueba solo al dar; quitar no la pide; un envío que ya existe se valida entero antes de
  devolver su resultado. Decisiones 5 y 6.
- **A5-A-M1.** La numeración: reabrir toma la `0024` y va **primero**, como recomendó; el precio
  especial, la que siga. Las listas de archivos se completaron (cerrar, tipos, reporte, envíos,
  retrato). **Una aclaración sobre los códigos:** `RC012` es lo que contesta `reservar_envio`
  hoy para un envío cancelado o con otro contenido. La `0018` contestaba `RC005`, y la `0019` lo
  cambió precisamente a `RC012`. Los planes no cambian ese contrato.

## Parte E — Rediseño de la interfaz (plan, ahora versión 2)

- **E-I1 (restilar puede cambiar lo que hace).** → Decisiones 9 y 10: un solo árbol para ancho y
  angosto; nada se remonta al abrir una hoja, cambiar el contraste o el tamaño; la hoja se
  muestra porque su dueño lo dice y distingue libre, ocupada y envío del que no se supo; cerrar
  una hoja nunca suelta un envío. Se comprueban la memoria y el identificador del envío.
- **E-I2 (el paquete `/react`).** Aceptado entero: **no entra.** Entra solo `tokens`, a versión
  exacta y solo su CSS, detrás de una capa propia; `metadata`, como referencia. Las piezas son
  propias. Se le explica al usuario, que pidió usar los paquetes. Y la hoja usa el diálogo nativo
  del navegador: el fondo queda inerte, el foco no sale, y **no se saca del árbol** (no hay
  portal), así que sigue envuelta por la pestaña dueña y los recorridos la encuentran donde la
  buscaban. Como algunos navegadores cierran un diálogo al segundo Escape pase lo que pase, la
  hoja vuelve a mostrarse mientras su dueño diga que va abierta.
- **E-I3 (lo impreso).** Se elige **conservar el papel idéntico**: el comprobante se queda con
  su letra (Roboto Mono) y su hoja de estilos se aparta de todo lo demás. La línea base de lo
  impreso se toma **antes** de la tarea 1 (tarea 0) y se compara desde la tarea 1. De paso se
  corrigió el plan: hoy solo se imprime el comprobante, no el cierre.
- **E-I4 (el contraste recordado).** → Decisión 4, con su contrato: tres estados; galleta propia
  puesta por el servidor, aparte de la de sesión, con caducidad, `SameSite`, `HttpOnly` y
  `Secure` por HTTPS; ausente o con otro valor es «sin elegir»; la ruta no pide sesión **ni
  depende de la base** (tiene que servir con la base caída y en mantenimiento), y valida valor,
  forma y origen; el interruptor no admite otro toque mientras guarda y, si falla, vuelve a como
  estaba; cambiarlo no recarga ni desmonta. Se corrigió lo de Safari: no es «siete días», es
  siete días **sin usar el sitio**; y la preferencia es por navegador, no por equipo físico.
- **E-I5 (las clases no bastan).** → Decisión 11: papeles, deshabilitado de verdad, estados,
  grupos, orden y unicidad; un selector cambia solo con su equivalencia, nunca ensanchando,
  tomando «el primero», forzando o esperando.
- **E-M1.** La respuesta al apoyar el dedo es **visual**; la acción sigue ocurriendo al soltar.
  Con menos movimiento, nada se desplaza: queda un fundido. El prototipo es referencia de
  lenguaje, no de medidas.
- **Pruebas y orden.** La hoja y autorizar pasan a la tarea 1; WebKit entra en la tarea 1, por
  HTTPS de verdad y comprobando primero que el origen es seguro; lo impreso se comprueba desde
  la tarea 1; las tareas 5 y 6 ya dicen qué prueban; la tarea 8 tiene guion y no se da por hecha.

## Parte D — Publicar una versión (diseño, ahora versión 4)

- **D5-B1 (los tres casos se traslapaban).** Aceptado: una publicación que abrió tiene las dos
  marcas, y leída en el orden en que estaba escrita habría ofrecido el respaldo previo después
  de un cobro. → La recuperación es **una tabla que se lee en orden y se queda en la primera que
  se cumple**: señal de apertura en el manifiesto **o** en la base → solo hacia adelante; sin
  ella y con migración empezada → cerrado y salida deliberada; ninguna → conjunto anterior. Ante
  identidad que no coincide o evidencia que falta, se detiene. Y decidir abrir tiene orden:
  manifiesto, base, y solo entonces abrir, con una instrucción que comprueba publicación, base,
  marca y conjunto. El manifiesto se escribe de modo que sobreviva a un apagón.
- **D5-I1 (las salidas deliberadas y la exclusión).** → **Un candado único de la instalación**
  para publicar, recuperar, levantar y migrar a mano. Recuperar comprueba que el migrador y su
  sesión terminaron antes de nada. Publicar una versión corregida tiene entrada propia
  (`--corregida`), la única admitida con un manifiesto sin cerrar.
- **D5-I2 (la activación).** → Volver al respaldo previo tiene sus seis pasos con registro
  propio: apartar la base fallida sin borrarla, restaurar con nombre provisional, registrar,
  nombrar, comprobar por HTTPS **que quien contesta es esa base**, abrir. El manifiesto viejo se
  cierra como «restaurado» y no se continúa. La máquina perdida tiene su propia entrada.
- **D5-I3 (lo que corre de verdad, y la configuración).** → Al preparar se comprueba que lo que
  corre es lo que dice el último manifiesto cerrado. De cada conjunto se guarda la configuración
  resuelta, no solo su huella. Lo que se guarda fuera del servidor se lee de vuelta. El servicio
  de respaldo se repone al terminar, y queda dicho qué pasa si no arranca.
- **D5-M1.** La promesa quedó acotada: antes de cerrar no se altera lo que atiende; entre cerrar
  y abrir, cerrado; desde que se decide abrir, no se retrocede.

## Parte C — Respaldo y restauración (tarea 3)

Confirmó corregidos C-I1, C-I2, C-I3 y C-M1, y la compatibilidad con una base que ya tenía la
`0022` anterior. Encontró dos huecos nuevos, los dos reproducidos primero con una prueba que
fallaba.

- **C5-I1 (la identidad de una sola tabla no acredita las demás).** Confirmado: un volcado que
  deja fuera la tabla de la marca recreaba todas las otras y la base seguía pasando por buena.
  De sus dos caminos —declararlo como límite, o ampliar la marca— se tomó el segundo, porque
  costaba poco: **la marca guarda la identidad de todas las tablas y secuencias**, y basta que
  una exista con otro identificador. Las tablas que crea una migración posterior entran a la
  marca al migrar (`vida_abarcar`, que llama el migrador dentro de la misma transacción), **y
  solo si la base ya estaba emparejada**: migrar nunca empareja. Una tabla que se quita y no
  vuelve no cuenta.
- **C5-I2 (la `0023` adoptaba, al migrar, un respaldo de la `0022` restaurado encima).**
  Confirmado. → Como en la `0022`: al llegar la `0023`, solo se empareja sola una instalación
  sin operaciones ni folios usados. Una que ya operaba se empareja a mano, una vez.
- **Lo que destapó la prueba:** restaurar un volcado viejo encima de una base más nueva deja las
  funciones que el volcado no conocía, y la `0023`, al aplicarse otra vez, tropezaba con ellas.
  Ahora las crea con «o reemplaza».
- **Límites, dichos** (README, la decisión 10 del plan y la propia migración): la copia física
  del servidor; la recarga solo de datos sobre las mismas tablas, que la revisión reprodujo con
  `--data-only` y que esta marca no puede ver; el administrador que empareja a mano; y una
  migración que tuviera que recrear una tabla ya cubierta, que deja la base sin emparejar y
  debe volver a emparejarla ella misma. La forma admitida de restaurar es el programa.
- **Un límite de la transición, que no llega a operación:** un respaldo de una instalación que
  nunca operó, anterior a la `0023`, restaurado encima de una que sí operó, se adoptaría al
  migrar. No puede existir: no hay ninguna instalación en operación, y la primera nacerá ya con
  la `0023`.
- La `0023` se reescribió en su lugar (la columna única se cambió por el mapa de todas): nadie
  la había aplicado fuera de las bases de prueba. La de desarrollo del usuario sigue en la `0022`.

Comprobado por mutación: cinco —la `0023` adopta también a una base que ya operaba; la marca no
compara las tablas; `vida_abarcar` no mira si estaba emparejada; el migrador no agrega las tablas
nuevas; una tabla que falta cuenta como distinta—, y las cinco hacen fallar alguna prueba.
Una prueba que pasó a la primera («migrar no empareja una base que no lo estaba», sobre una copia
de la plantilla) se retiró: no distinguía nada, porque esa copia no está emparejada por la base,
no por las tablas. La sustituye una comprobación dentro de la prueba de C5-I1, que sí falla con
la tercera mutación.

Su batería dio 607 de 608 por una sustitución suya en la copia (lo dijo, y la prueba suelta
pasó). Aquí, completa, sobre el estado final:

## Qué se corrió después de estos cambios

Todo, completo y una cosa a la vez: **611 pruebas, cero fallos** (tipos incluidos; son las 608
de antes y tres nuevas de la marca); **el ensayo de operación pasó**, con sus 6 recorridos por
HTTPS —y ahí la aplicación atiende, fuera de desarrollo, sobre una instalación nueva emparejada
con la marca de todas las tablas—; y **109 recorridos** en el navegador, con el de capturas
omitido como siempre. Migraciones hasta la `0023`.

## Lo que queda para la sexta pasada

La parte B, que no alcanzó; confirmar los dos arreglos de la marca para cerrar la tarea 3; y
volver a leer los planes: precio especial y reabrir (versión 3), rediseño (versión 2) y publicar
(versión 4).
