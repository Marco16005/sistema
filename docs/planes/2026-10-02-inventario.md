# Plan de implementación: inventario en pantalla

> **Para quien lo ejecute:** se avanza tarea por tarea, con prueba primero. Codex (`gpt-6-astra`,
> esfuerzo alto) revisa este plan antes de escribir código y el bloque completo al cerrarlo; sus
> revisiones y las respuestas quedan en `docs/revisiones/`.
>
> **Versión 2**, reescrita tras la revisión de Codex al plan (13 hallazgos, todos atendidos).

**Objetivo:** que desde la pantalla se pueda ver lo que hay en el patio y corregirlo cuando la
realidad y el registro no coinciden: existencias, conteo físico, merma, separación de material
mezclado y corrección de lo ya confirmado. Es lo que falta para poder operar de verdad: hoy un error
ya confirmado no tiene cómo arreglarse desde la pantalla.

**Arquitectura:** la misma de la aplicación del mostrador. El núcleo ya tiene las funciones de
conteo, merma, separación y ajuste; este plan les pone delante una función de entrada por acción —con
persona, rol, validación y repetible—, su ruta y su pantalla. La corrección de un movimiento se
rehace como una sola función que deja el movimiento «como debió ser».

**Herramientas:** las del plan anterior, sin dependencias nuevas.

**Especificación:** `../ESPECIFICACION-TECNICA.md`, apartados 4.2 (merma), 5 (correcciones), 6.3
(el primer conteo), 10.3 (autorizaciones) y 13; el núcleo en `db/migraciones/0006`, `0008` y `0009`;
y el plan anterior, `docs/planes/2026-10-01-aplicacion-mostrador.md`.

## Restricciones globales

Las del plan anterior siguen valiendo todas (portátil, una función del núcleo por acción, la
aplicación no decide reglas, la persona sale de la sesión, números como texto decimal, una decisión
por pantalla, controles grandes). Se agregan:

- **Esto no toca dinero.** Una corrección arregla el inventario. El comprobante y lo que se pagó no
  cambian, y la pantalla lo dice antes de corregir.
- **Nada confirmado se edita.** Toda corrección es un movimiento nuevo que referencia al original,
  con motivo y con quién lo autorizó. El original sigue a la vista.
- **Quien autoriza teclea su clave en ese momento**, y esa clave vale para esa acción y ese contenido.
  Autorizan las personas facultadas (`puede_autorizar`), aunque quien atienda sea una de ellas.
- **Toda acción se puede repetir sin duplicar**, y se prueba también después de deshacer lo que creó.
- **Toda prueba de concurrencia demuestra que hubo espera.**

## Lo que el núcleo tiene hoy y por qué no basta

Las funciones `registrar_conteo`, `registrar_ajuste`, `corregir_material`, `registrar_merma` y
`registrar_transformacion` existen y están probadas, pero la aplicación no debe llamarlas tal cual:

1. **No se pueden repetir.** Una merma o una separación enviada dos veces se asienta dos veces.
2. **Redondean en silencio** y un valor desmedido sale como error de la base, no como regla.
3. **La corrección no se compone.** `corregir_material` mueve la cantidad *original*; si antes se
   corrigió el peso de ese movimiento, mueve kilos que ya no existen. Y `registrar_ajuste` suma una
   cantidad suelta: corregir dos veces el mismo error lo corrige dos veces.
4. **Quien autoriza llega como un número** que la aplicación manda, sin haber demostrado nada.

## Decisiones de diseño

1. **Una función de entrada por acción**, como en el mostrador, en una migración nueva (`0017`):
   `contar_material`, `dar_merma`, `separar_material` y `corregir_movimiento`. Reciben el identificador
   del envío, validan forma y rango con códigos `RC`, y son repetibles. A `feruga_app` se le retiran las
   funciones viejas.
2. **Una sola forma de corregir.** `corregir_material` y `registrar_ajuste` se eliminan: mover la
   cantidad original o sumar una cantidad suelta no se componen con una corrección previa.
3. **Corregir es decir cómo debió quedar.** `corregir_movimiento` recibe el movimiento original, el
   material correcto y los kilos correctos (cero: no debió registrarse). **Toma el candado del patio y
   después lee**: suma el original y todos los ajustes que lo referencian, por material; arma el
   objetivo con el signo del original; y asienta solo las diferencias, todas referidas al original.
   Antes de asentar comprueba, bajo el candado, que toda salida alcance. Si algo no cabe no queda nada:
   ni asientos, ni envío. Volver a corregir es siempre corregir el original; un ajuste no se corrige.
4. **El conteo manda.** Si después del movimiento ya se contó alguno de los materiales que la corrección
   tocaría, se rechaza: ese conteo ya puso la existencia donde va, y corregir encima descontaría dos
   veces. Lo que no cuadre se arregla contando de nuevo.
5. **Se corrigen** los movimientos de saldo inicial, compra, venta y merma. Los ajustes caen en la
   jornada abierta, con la fecha efectiva del original: los cierres anteriores no cambian.
6. **La clave de quien autoriza la comprueba la base**, dentro de la misma función que escribe (es la
   pieza de `0016`). Sin clave correcta no hay acción, haga lo que haga el servidor. Si la clave no
   pasa, la función contesta «no» sin lanzar error, y el intento queda contado. Lo que no procede se
   rechaza antes de mirar la clave. Quien autoriza puede ser quien atiende: teclea su clave otra vez.
7. **Se autoriza lo que se vio.** La vista previa del conteo devuelve la hora ya fija y lo que el libro
   decía entonces; al ejecutar se manda eso mismo, y si la base calcula otra cosa rechaza con `RC011`.
   Para una corrección, lo que se vio es cuántas correcciones tenía ya el movimiento.
8. **Repetir devuelve lo ya hecho.** El registro de envíos se amplía a estas acciones y una tabla aparte
   guarda qué produjo cada uno: el conteo, la merma, la separación, o —en una corrección— el original y
   la lista de ajustes, que puede ir vacía. El contenido se normaliza (decimales, notas, productos
   ordenados); la clave no entra en él. El reintento se resuelve antes que la clave y antes que
   cualquier condición de acción nueva, como que la jornada siga abierta.
9. **El conteo dice cuándo se contó** y bloquea la jornada antes de asentar, haya o no diferencia.
   Una función interna lo asienta y devuelve el registro; `registrar_conteo` queda como envoltura.
10. **Dos contratos de kilos:** «cero o más» para lo contado y para el objetivo de una corrección; «más
    de cero» para merma, origen y productos. El JSON de productos se valida antes de convertirlo.
11. **Lecturas de una sola consulta.** Los movimientos de un material incluyen los ajustes que le
    llegaron al corregir otro, con el camino a su original.
12. **Existencias es la entrada.** Desde un material se ven sus movimientos, y desde un movimiento se
    corrige en una sola pantalla: «¿cómo debió quedar?», con material, kilos y la opción «no debió registrarse».

## Quién puede qué

| | Responsable | Mostrador | Patio | Consulta y administración |
|---|---|---|---|---|
| Ver existencias y movimientos | sí | sí | sí | sí |
| Registrar conteo, merma y separación | sí | sí | — | — |
| Pedir una corrección | sí | sí | — | — |
| Autorizar un conteo o una corrección | las personas facultadas, con su clave | | | |

## Alcance

**Dentro:** existencias y movimientos por material, conteo, merma, separación y corrección.

**Fuera:** dar de alta personas y materiales desde la pantalla (sigue la consola; el catálogo, por
ahora, por migración), reportes e históricos más allá de los movimientos de un material, y todo lo
que ya estaba fuera: despliegue, básculas, caja y crédito.

**Sin validar con el personal.** A diferencia del mostrador, estas pantallas no pasaron por un
prototipo. Siguen el mismo lenguaje, pero conviene enseñarlas antes de darlas por buenas.

## Estructura de archivos

```
db/migraciones/0017_inventario.sql     entradas de inventario, estado de un movimiento, resultado de envíos
src/servidor/dominio/inventario.ts     existencias, movimientos, conteo, merma, separación, corrección
src/app/api/inventario/…/route.ts      una ruta por acción
src/app/inventario/page.tsx
src/componentes/inventario/            Existencias, Movimientos, Contar, Merma, Separar, Corregir
src/componentes/Autorizar.tsx          elegir a quien autoriza y teclear su clave (sale del mostrador)
pruebas/18-inventario.test.ts          las entradas, con el rol de la aplicación
pruebas/19-dominio-inventario.test.ts  el dominio y las rutas
recorrido/inventario.spec.ts
```

## Lo que cambió al implementarlo

- **La migración de inventario es la `0017`.** La `0016` nació antes, de la revisión del servidor: la
  autorización con clave comprobada en la base, que aquí se reutiliza.
- **La vista previa de la separación y la del conteo son funciones del núcleo**, no cuentas del servidor.
- **Lo capturado a medias vive por pantalla** (como el paso de cada cuenta en el mostrador), y un envío
  del que no se supo el resultado bloquea la edición hasta que se reintenta, idéntico.
- **`Autorizar` es un componente común**: lo usan el vehículo de otro día, el conteo y la corrección.
- **Las pruebas quedaron** en `18-inventario` (37), `19-dominio-inventario` (10), la matriz de
  `17-rutas`, y `recorrido/inventario.spec.ts` (8).

## Qué vigilar al revisar, y dónde se prueba

| Qué | Prueba |
|---|---|
| Una merma o una separación enviada dos veces | `18`: «repetir el envío no asienta otra» |
| Corregir dos veces a lo mismo, o una corrección sobre otra | `18`: «corregir es llegar a como debió quedar» |
| Corregir el material de un movimiento al que ya se le corrigió el peso | `18`: «primero el peso y después el material» |
| Dos correcciones a la vez sobre el mismo movimiento | `18`: con barrera verificada |
| Un conteo mientras se confirma una venta de ese material | `18`: con barrera verificada |
| La clave de quien no está facultado, o de quien sí pero equivocada | `19`: «autoriza quien está facultado» |
| Kilos desmedidos, negativos, con cuatro decimales, o un JSON de productos mal formado | `18` y `19` |
| Corregir de modo que la existencia quedaría negativa | `18`: se rechaza completa, sin dejar media corrección |
| Patio o consulta llamando las rutas que escriben | `17-rutas`: la matriz |

## Tareas

### Tarea 1 · Entradas de inventario en el núcleo
Archivos: `0017_inventario.sql`, `pruebas/18-inventario.test.ts`, ajustes a `05`, `08` y `09`.

Produce:
- `envio` admite las clases `conteo`, `merma`, `separacion` y `correccion`; tabla inmutable
  `envio_resultado(envio_id, conteo_id, movimiento_id, transformacion_id, ajustes bigint[])`; índice por `referencia_id`.
- `estado_de_movimiento(p_movimiento bigint) → TABLE (material_id int, kg numeric)`, de solo lectura.
- `previa_de_conteo(p_material int, p_contado numeric, p_contado_en timestamptz) → TABLE (contado_en, registrado_kg, diferencia_kg)`
- `contar_material(p_envio uuid, p_material int, p_contado numeric, p_contado_en timestamptz, p_registrado numeric, p_nota text, p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint) → conteo` (sin conteo si la clave no pasó)
- `dar_merma(p_envio uuid, p_material int, p_kg numeric, p_motivo text, p_usuario bigint) → movimiento_inventario`
- `previa_de_separacion(p_origen int, p_kg numeric, p_productos jsonb) → numeric` (lo que se pierde)
- `separar_material(p_envio uuid, p_origen int, p_kg numeric, p_productos jsonb, p_nota text, p_usuario bigint) → transformacion`
- `corregir_movimiento(p_envio uuid, p_movimiento bigint, p_material int, p_kg numeric, p_correcciones_vistas int, p_motivo text, p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint) → (original bigint, ajustes bigint[])` (vacío si la clave no pasó)
- Se eliminan `corregir_material` y `registrar_ajuste`. A `feruga_app` se le retiran `registrar_conteo`,
  `registrar_merma` y `registrar_transformacion`.

- [x] **Roles y autorización:** cada entrada exige persona con rol; conteo y corrección, que autorice una
      persona facultada y activa con su clave; clave equivocada: no se asienta nada, la función contesta
      «no» y el fallo queda contado; clave buena de quien no está facultado: se rechaza sin gastar
      intento; autorizarse a uno mismo; desde un equipo que no está dado de alta.
- [x] **Repetición:** el mismo envío igual devuelve el mismo registro (también con dos conteos sin
      diferencia); con otro contenido se rechaza; en dos sesiones a la vez, la segunda espera y recibe
      lo de la primera; un reintento después de otra corrección, y después de cerrar la jornada,
      devuelve el resultado anterior sin volver a imponerlo.
- [x] **Validación:** kilos en cero donde no valen, negativos, infinitos, desmedidos o con cuatro
      decimales; motivo vacío; JSON de productos que no es lista, con elementos que no son objetos, sin
      material, con kilos que no son número, repetidos, con el origen entre ellos, o que pesan más que
      el origen. Todo sale como regla `RC`, nunca como error de la base.
- [x] **Corregir:** a otro material, a otro peso, a los dos, a cero; a lo que ya está (no asienta nada);
      primero el peso y después el material; de vuelta al material original; una venta y una merma
      respetan el signo; una venta reclasificada exige existencia del destino; si no alcanza no queda
      nada —ni el primer asiento, ni el envío, ni el resultado—; un ajuste, una separación o un conteo no
      se corrigen; con un conteo posterior del material se rechaza, y con uno anterior no; dos
      correcciones a la vez pasan una tras otra y la segunda ve lo que dejó la primera (`RC011`); lo
      corregido cae en la jornada abierta y el cierre de la jornada original no cambia.
- [x] **Contar:** con hora anterior no pierde lo vendido después; a futuro, de antes de la jornada o más
      viejo que el último conteo se rechaza; si lo que el libro decía cambió desde la vista previa,
      `RC011`; conteo sin diferencia contra el cierre de la jornada, en los dos órdenes, con barrera.
- [x] El respaldo y la restauración siguen pasando.

### Tarea 2 · Dominio y rutas
Archivos: `dominio/inventario.ts`, `src/app/api/inventario/*`,
`pruebas/19-dominio-inventario.test.ts`, la matriz de `17-rutas`.

Produce: `existencias(bd)` (por familia: kilos, apartado, disponible y el último conteo),
`movimientosDe(bd, material)` (con folio, quién, motivo, si es corregible, cuántas correcciones lleva
y cómo quedó; un ajuste llegado de otro material trae el camino a su original),
`previaDeConteo(bd, material, contado, hora)`, `contar(bd, persona, huella, envio)`, `darMerma`,
`previaDeSeparacion`, `separar`, `corregir(bd, persona, huella, envio)`, `quienesAutorizan(bd)`.

Rutas: `GET inventario`, `GET inventario/materiales/[material]`, `POST inventario/conteo/previa`,
`POST inventario/conteo`, `POST inventario/merma`, `POST inventario/separacion/previa`,
`POST inventario/separacion`, `POST inventario/correccion`, `GET inventario/autorizan`.

- [x] Pruebas: las existencias cuadran con el libro y con las ventas abiertas; los movimientos de un
      material traen su folio y sus correcciones; la vista previa del conteo y de la separación
      coincide con lo que después se asienta; autoriza quien está facultado y con su clave, y la
      equivocada cuenta como fallo y no asienta nada; cada rol contra cada ruta; lo mal formado se
      rechaza antes de tocar la base; un día con conteo, merma, separación y corrección por las rutas.

### Tarea 3 · Pantallas
Archivos: `src/app/inventario/page.tsx`, `src/componentes/inventario/*`, `src/componentes/Autorizar.tsx`.

- [x] **Existencias:** por familia, kilos de cada material y lo apartado en ventas abiertas; el último
      conteo y su diferencia. Tocar un material abre sus movimientos.
- [x] **Movimientos de un material:** del más reciente al más viejo, con folio, quién, motivo, y cómo
      quedó el que se corrigió. Los que se pueden corregir traen su botón.
- [x] **Contar:** material → kilos contados (y, si no fue ahora, a qué hora) → lo que dice el libro, lo
      contado y la diferencia → quién autoriza y su clave.
- [x] **Merma:** material → kilos → motivo.
- [x] **Separar:** de qué material y cuántos kilos → los productos, uno por uno → lo que se pierde → registrar.
- [x] **Corregir:** el movimiento como está hoy → «¿cómo debió quedar?»: material, kilos, o «no debió
      registrarse» → motivo → aviso de que no toca dinero → quién autoriza y su clave. Si no alcanza la
      existencia, lo dice y propone contar.
- [x] `Autorizar` se saca del mostrador y se usa también ahí, para el vehículo de otro día.

### Tarea 4 · Recorrido en navegador
Archivos: `recorrido/inventario.spec.ts`.

- [x] Existencias después de un arranque y una compra; un conteo con diferencia, autorizado con clave,
      y la existencia queda en lo contado; una merma; una separación con su pérdida; una corrección de
      material y otra de peso desde los movimientos, y la clave equivocada no corrige; patio ve y no
      puede; consulta ve.

**Revisión de Codex al bloque completo**, con ejecución: hecha el 2 de octubre, completa. Dio por
corregidos sus hallazgos de servidor y de pantallas (uno de servidor, «a medias») y encontró tres
nuevos, los tres aceptados y corregidos con la prueba primero:

1. **Bloqueante:** recargar con una merma en el aire permitía descontarla dos veces. Ahora lo que
   sale queda guardado antes de salir, con su identificador y su contenido, y no se puede editar
   hasta saber qué pasó; se suelta solo con una regla del servidor. Vale para las cuatro acciones.
2. **Importante:** «el conteo manda» se eludía fechando el conteo en el instante exacto del
   movimiento. El límite ahora es inclusivo, el mismo con que el conteo arma lo que dice el libro.
3. **Menor:** faltaban los recorridos de transiciones en inventario. Ahora son las cuatro acciones
   contra cinco cruces.

Además: la matriz de rutas prueba ahora cada ruta que escribe con un cuerpo bien formado (lo que
había quedado «a medias»), y la misma regla del envío pendiente se llevó al mostrador, donde una
falla del servidor después de guardar un peso dejaba agregarlo dos veces.

Informe y respuesta: `docs/revisiones/2026-10-02-codex-revision-del-bloque-de-inventario.md` y
`docs/revisiones/2026-10-02-respuesta-a-la-revision-del-bloque-de-inventario.md`.

**Verificación de Codex a esas correcciones.** Por la mañana quedó incompleta (se le acabó la
cuota); sus guiones dejaron tres cosas demostradas, que se corrigieron. Por la noche se repitió,
completa: dio por corregidos el límite del conteo, la matriz de rutas y el mostrador, y encontró
tres cosas más, las tres aceptadas y corregidas con la prueba primero:

1. **Alta:** un rechazo al reintento no impedía que el primer envío llegara después y se asentara
   (dos mermas). Ahora un envío del que no se supo se resuelve en el servidor: se cancela
   (`0018_cancelar_envio.sql`), y o ya había entrado, o ya no entra.
2. **Importante:** si daban de baja a quien autorizó, el conteo o la corrección quedaban sin
   salida. Ahora ese envío se cancela y autoriza otra persona, sola o con el botón «Autoriza otra
   persona».
3. **Menor:** una prueba no repetía idéntico el conteo.

Una tercera pasada, sobre esa cancelación, la dio por buena en la base y encontró que la pantalla
todavía soltaba una captura sin cancelar su envío cuando era su «primer intento» —y otra pestaña
podía haber mandado el mismo—, y que leía una respuesta sin confirmación como «cancelado». Las dos
cosas se corrigieron: ninguna captura se suelta sin que el servidor confirme, con todas sus letras,
que el envío quedó resuelto. Informe y respuesta:
`…-codex-verificacion-de-la-cancelacion-de-envios.md` y
`…-respuesta-a-la-verificacion-de-la-cancelacion.md`.

Una cuarta pasada confirmó esas dos correcciones y dejó tres cosas, las tres atendidas: la
pantalla ya no deduce que algo quedó registrado (lo confirma la acción misma, y un identificador
que ya no sirve tiene su código, `RC012`, en `0019_envio_ocupado.sql`); una pestaña duplicada ya
no hereda la captura a medias (`src/componentes/pestana.ts`); y tres recorridos afirman ahora qué
se le pidió al servidor. Informe y respuesta: `…-codex-cuarta-pasada-cancelacion.md` y
`…-respuesta-a-la-cuarta-pasada.md`.

Una quinta pasada confirmó `RC012` y el orden completo del envío, y venció mi protección de
pestañas duplicadas, que dependía de una espera: ahora la exclusión la da un candado del navegador,
y la copia suelta también lo que el mostrador tenía a medias. Informe y respuesta:
`…-codex-quinta-pasada.md` y `…-respuesta-a-la-quinta-pasada.md`.

**La sexta pasada** no se pudo hacer en la madrugada del 3 por cuota y se hizo esa tarde. Confirmó
el candado entre pestañas y la copia del mostrador, y que recargar no pierde la captura. No dio el
cierre por tres cosas, ya atendidas: un error al pedir el candado se tomaba por «es mía» (ahora la
pestaña queda en duda, sin soltar ni dejar capturar); un marco del mismo origen le borraba lo suyo
a la página (la aplicación ya no corre dentro de un marco); y una prueba veía la misma copia dos
veces. Informe y respuesta: `docs/revisiones/2026-10-03-codex-sexta-pasada.md` y
`docs/revisiones/2026-10-03-respuesta-a-la-sexta-pasada.md`.

**Bloque cerrado.** En su séptima pasada (3 de octubre) Codex dio por corregidos los tres puntos y
**dio el bloque de inventario por cerrado para pasar al despliegue**, con una observación de
cobertura que quedó atendida. Cierra en 535 pruebas y 106 recorridos. Informe y respuesta:
`docs/revisiones/2026-10-03-codex-septima-pasada-cierre-de-inventario.md` y
`docs/revisiones/2026-10-03-respuesta-a-la-septima-pasada.md`. Cerrar el bloque no es aprobar la
salida a operación: falta el despliegue y validar estas pantallas con el personal.

Los documentos anteriores, en orden: `…-codex-verificacion-de-las-correcciones-de-inventario.md` (la
incompleta), `…-codex-verificacion-de-las-correcciones-de-inventario-repeticion.md` y
`…-respuesta-a-la-verificacion-de-inventario.md`, todos en `docs/revisiones/` con fecha 2026-10-02.

### Tarea 5 · Documentación
- [x] README, especificación (15.4) y capturas de las pantallas nuevas.
