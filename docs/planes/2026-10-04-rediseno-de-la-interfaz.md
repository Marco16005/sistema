# Diseño y plan: rediseño de la interfaz

> **Estado:** el usuario vio el prototipo y lo aprobó el 4 de octubre de 2026 («adelante con este
> nuevo lenguaje»), con dos decisiones: **azul fijo** y **«más contraste» manual y recordado**.
> Codex revisó la primera versión de este plan y pidió cerrar tres contratos antes de codificar
> —la hoja, lo impreso y cómo se comprueba—
> (`docs/revisiones/2026-10-04-codex-quinta-revision.md`, parte E: cinco importantes, uno menor).
> La versión 2 los incorporó, y su sexta revisión la aprobó para empezar
> (`docs/revisiones/2026-10-04-codex-sexta-revision.md`, parte E: «sí se pueden empezar las
> tareas 0 y 1», con precisiones para la hoja que están en la decisión 9).
> **Hechas las tareas 0, 1 y 2** (la línea base del papel; la base, la hoja y autorizar; la
> entrada y la barra). Codex las revisó en su décima pasada (parte E, 9 de octubre): seis
> hallazgos, corregidos ese día y **sin verificar por él todavía**
> (`docs/revisiones/2026-10-07-respuesta-a-la-decima-revision.md`). **Las tareas 3 a 7 se
> hicieron el 10 de octubre, juntas** (el mostrador, el comprobante en pantalla, arranque, precios,
> cierre, inventario y la limpieza): abajo dice cómo, y qué de lo que el plan pedía no se hizo.
> **Falta la 8: probarlo en los equipos de verdad**, que lo hace el usuario.
>
> **Para quien lo ejecute:** con la prueba primero. Codex (`gpt-6-astra`, esfuerzo alto) revisa
> este plan antes de codificar y cada tarea al cerrarla.

## De dónde sale

La aplicación funciona y está pensada para el patio: botones grandes, una decisión por pantalla,
se usa con guantes. Eso se queda. Lo que el usuario pidió es que además **se vea bien**: que por
ser para una bodega no tenga que verse tan sencilla. Instaló para eso los paquetes
`@ios27_design_system/tokens`, `/react` y `/metadata`, y las guías de diseño de Apple.

Los equipos serán de todo: **iOS, Android y Windows**. Es una aplicación web: corre en el
navegador de cada uno.

**La referencia visual es el prototipo**: `prototipo/rediseno-mostrador.html` (fuera de
`sistema/`), publicado en https://claude.ai/artifact/Sua8TA3gs85Xf59HX6L3RS. **Es referencia del
lenguaje, no de las medidas:** sus botones miden entre 44 y 54 px y su letra chica 13 a 16 px, por
debajo de los mínimos de este plan. Y deja elegir el color de acento; la aplicación no: es azul.

## Qué no cambia

**El comportamiento.** Este plan cambia cómo se ve y cómo se siente, no qué hace:

- el flujo validado con el personal (cuentas a la vista, los pasos de una cuenta, el teclado);
- las reglas del envío pendiente y de la pestaña dueña de una captura;
- los textos que la gente lee, y los papeles y nombres con que un lector de pantalla —y los
  recorridos— encuentran cada cosa;
- **el comprobante**, en pantalla y en papel: su letra, sus medidas y su composición.

Los 109 recorridos son la red: tienen que seguir pasando **sin cambiar lo que afirman**. Pero
prueban ejemplos de lo que la aplicación hace; no prueban el foco de una hoja, el orden de
lectura, los tres modos ni el papel. Eso lleva pruebas propias, abajo.

## Decisiones

1. **El lenguaje es el del prototipo**: superficies claras y limpias, esquinas amplias, un solo
   color de acento, los números grandes, barras de vidrio, y hojas que suben desde abajo para lo
   que interrumpe (autorizar, precio especial, confirmar).

2. **De los paquetes entra uno; las piezas son propias.**
   - **`@ios27_design_system/tokens` (1.0.2, MIT) entra como dependencia**, fijada a esa versión
     exacta, y solo su CSS: colores, tamaños de letra, espacios, materiales, curvas. No ejecuta
     nada. Encima va **una capa propia con nombres del negocio** (`--acento`, `--superficie`,
     `--toque`, `--compra`, `--venta`…); las pantallas usan solo esa capa, nunca `--ios27-*`.
   - **`/react` no entra.** Codex leyó su código y no sirve para esto tal como viene: su hoja se
     cierra aunque la aplicación diga que no (al tocar fuera, con Escape o al arrastrarla), y
     aquí una hoja con un envío pendiente no se puede cerrar; su alerta ejecuta la acción y se
     cierra sin esperar el resultado; su control de segmentos no sabe deshabilitar un paso, y
     los pasos de una cuenta se bloquean según el día y el envío; su foco atrapado no vuelve
     inerte el fondo; y su hoja de estilos trae sus propias variables y pone vidrio donde aquí
     va superficie sólida. No se encontró nada indebido en el paquete: no encaja, nada más.
   - **`/metadata`** son las fichas de cada componente: se consultan para que lo propio se
     parezca; no se instalan.
   - Se instala **dentro del contenedor**, como todo. Nada depende de la carpeta del usuario. No
     trae tipografías ni material de Apple.

3. **Azul fijo.** Un solo acento, `#0a66e4` en claro (contraste 5.2 a 1 sobre blanco) y
   `#3d8bff` en oscuro (5.1 a 1 sobre su fondo). Sin selector. El verde y el naranja quedan para
   distinguir compra de venta, y el rojo para lo que falla o no tiene vuelta.
   **Un defecto del prototipo, ya medido:** en oscuro, la letra blanca sobre el botón azul da
   3.3 a 1, y no alcanza. Se corrige en la tarea 1 —un azul más profundo para los botones llenos
   en oscuro, o la letra oscura—, y la prueba de contraste lo deja fijo.

4. **Claro, oscuro y «más contraste».**
   - Claro u oscuro **sigue al equipo**, como hoy. No hay botón para eso.
   - **«Más contraste, para el sol» es un interruptor manual**, a un toque, en la barra de arriba
     de todas las pantallas **y también en la de entrada**.
   - **Tres estados, no dos:** *sin elegir* (nadie lo ha tocado en ese navegador), sigue lo que
     pida el equipo (`prefers-contrast`); *normal, elegido*, gana al equipo; *alto, elegido*,
     pone superficie clara y sólida, texto negro, bordes marcados, sin vidrio, **también si el
     equipo está en oscuro**.
   - **Se recuerda por navegador de cada equipo**, no por persona: la tableta del patio se queda
     en contraste alto aunque cambie quién la usa. Sobrevive a salir de la sesión —salir no la
     borra—, a cerrar la aplicación y a reiniciar el equipo. (El usuario lo confirmó así el 4 de
     octubre: por equipo.) No es
     para siempre: borrar los datos del navegador o usar una ventana privada la pierde, y
     **caduca si en cosa de un año nadie toca el interruptor en ese equipo** (el servidor la pide
     por 400 días; Chromium guarda hasta 400 y el WebKit de las pruebas, 365). No se renueva
     sola: renovarla desde la página abría la puerta a que una renovación llegara después de un
     cambio y lo deshiciera. Cuando caduca, un toque la vuelve a poner.
   - **Dónde se guarda: una galleta propia, que pone el servidor.** Aparte de la de la sesión;
     con caducidad larga; solo para este sitio y toda su ruta; `SameSite=Lax`, `HttpOnly`, y
     `Secure` cuando va por HTTPS. El servidor la lee al armar la página, que así llega ya con
     el contraste puesto, sin parpadeo. Una galleta ausente o con otro valor es «sin elegir».
     La página no se guarda en ninguna caché compartida.
   - **La ruta que la pone** no pide sesión y **no depende de la base**: tiene que funcionar
     también en la pantalla de «no se pudo hablar con el servidor» y con el sistema en
     mantenimiento. Acepta solo «alto» o «normal», en un cuerpo bien formado y desde el propio
     sitio; cualquier otra cosa se rechaza. No da ningún privilegio y no toca la base.
   - **El interruptor no miente:** mientras guarda, no admite otro toque; si guardar falla, vuelve
     a como estaba y lo dice. Dos toques seguidos no pueden dejarlo al revés de lo que se ve.
     Cambiarlo no recarga la página ni desmonta nada: una captura a medias sigue ahí.

5. **La letra de la interfaz es la del equipo**: San Francisco en iOS, Roboto en Android, Segoe
   en Windows. Se retiran Barlow y Barlow Condensed. Los números van con ancho fijo
   (`tabular-nums`). **Consecuencia aceptada:** no se verá idéntica en los tres; ninguna medida
   depende del ancho de una letra.
   **El comprobante conserva su letra** (Roboto Mono, que sigue sirviendo la propia aplicación)
   y su hoja de estilos se aparta de todo lo demás: lo que hoy hereda de la base —letra, tamaños,
   72 mm— pasa a estar escrito en ella. Así cambiar la base no mueve un salto de línea del papel.

6. **Medidas de patio.** Todo lo que se toca mide **al menos 60 px** y está separado al menos
   8 px de lo de junto —también en diagonal—. El texto, de 17 px para arriba; **la excepción son
   los rótulos**, que pueden ir de 15: el nombre de un control (el interruptor), el renglón chico
   bajo un nombre, y las pantallas de la barra en un teléfono. Un aviso no es un rótulo. La lista
   de lo que cuenta como rótulo está en el medidor (`ROTULOS`, `recorrido/apoyo.ts`), que rechaza
   cualquier otro texto de menos de 17. **Lo que se ve** responde al apoyar el
   dedo; **lo que se hace** sigue ocurriendo al soltar, como hoy: apoyar y arrastrar fuera
   cancela, no cobra. Nada depende de pasar el puntero por encima.

7. **El vidrio, solo en las barras** (arriba, abajo y el velo detrás de una hoja). Lo que se lee
   va sobre superficie sólida. Si el navegador no puede con el desenfoque, si el equipo pide
   menos transparencia, o con «más contraste», la barra es sólida **de verdad** (se comprueba el
   resultado, no la variable). Como mucho dos capas desenfocadas a la vez.

8. **El movimiento, solo con CSS.** Las hojas suben con una curva de resorte, los botones ceden
   al toque. **Si el equipo pide menos movimiento, nada se desplaza ni cambia de tamaño:** queda
   un fundido corto. No entra ninguna librería de animación ni gestos de arrastre.

9. **La hoja es propia, y no decide nada.** Usa el diálogo nativo del navegador (`<dialog>`),
   que ya trae lo difícil: el fondo queda inerte, el foco no sale, y **no se saca del árbol de
   la página** —se queda dentro de quien la abre, así que sigue envuelta por lo que la envuelve
   hoy (la pestaña dueña) y los recorridos la encuentran donde la buscaban—.
   - **Se muestra porque su dueño lo dice, no porque alguien la abrió.** Quien tiene la captura
     —la cuenta, la corrección— decide si la hoja está a la vista y si se puede cerrar, y
     distingue tres momentos: *libre* (se cierra con su botón o con Escape), *ocupada* (está
     enviando: no se cierra) y *envío del que no se supo* (no se cierra: se resuelve).
   - **Cerrar la hoja nunca suelta un envío.** Ni Escape, ni su botón, ni el velo, ni navegar,
     ni cambiar el contraste. «Cancelar» y «resolver» ejecutan el mecanismo de hoy —el del
     servidor—, no esconden la hoja. Si el navegador la cierra por su cuenta (Escape dos veces
     seguidas, en algunos), vuelve a mostrarse, porque su dueño sigue diciendo que va abierta.
   - Al cerrarse, el foco vuelve a donde estaba; si eso ya no existe, a un lugar con sentido.
   - **Precisiones de Codex para construirla** (sexta revisión): se abre con `showModal()`, que
     la pone encima sin moverla del árbol —no con el atributo `open` ni solo con CSS—. No basta
     un efecto que dependa de «va abierta»: si el navegador la cierra y esa condición no cambió,
     el efecto no corre; se atiende también el evento de cierre, y ahí se consulta el estado **de
     ahora** de su dueño. Que el modo estricto de React no reabra algo que el dueño ya cerró.
     Se guardan aparte el control que la abrió y el último que tuvo el foco dentro: al reaparecer
     se devuelve el foco a este; al cerrarse de verdad, a aquel. El diálogo nativo **no** bloquea
     por sí solo el desplazamiento de la página: se bloquea y se devuelve a su sitio. El teclado
     del teléfono puede achicar solo lo visible: no se supone que los botones quedan encima de él,
     ni que sigue abierto después de un cierre impuesto. Al imprimir, la hoja y su velo se
     ocultan con CSS, **sin cerrarla**.

10. **Rediseñar no remonta nada.** Hay **un solo árbol** para ancho y angosto: la disposición
    cambia con CSS, no pintando dos versiones (que duplicarían lo que los recorridos buscan). Los
    componentes conservan su identidad: ni la hoja, ni el contraste, ni el cambio de tamaño
    desmontan una captura. Importa en particular por dos cosas que hoy ocurren **al montar**:
    `SoloEnSuPestana` no deja capturar hasta acreditar que la pestaña es la dueña, y `Ticket`
    manda a imprimir. Un remontaje de más imprimiría otra vez.

11. **Lo que los recorridos encuentran, se conserva.** No solo las clases (`.cta`, `.grid`,
    `.tot`, `.flag`, `.ticket`, `.visor`, `.teclado`, `.ren`, `.prog`, `.barra`, `.que`,
    `.okmsg`, `.exrow`): también los papeles (un botón sigue siendo botón; los pasos no se
    vuelven pestañas), lo que está deshabilitado **de verdad** (no solo que no reciba toques),
    `aria-pressed` y `role="alert"`, los grupos con su nombre, el orden, y que cada cosa esté
    una sola vez. Un selector cambia solo con su explicación de por qué afirma lo mismo; **nunca**
    ensanchando una búsqueda, tomando «el primero», forzando un toque o agregando una espera.

12. **Dónde vive:** `src/estilo/` (valores, base y, aparte, el comprobante) y
    `src/componentes/base/` (botón, hoja, aviso, interruptor, campo, barra, fila). `globals.css`
    se reparte y desaparece al final.

## Archivos

```
package.json, package-lock.json            la dependencia, fijada
src/estilo/valores.css                     la capa propia sobre los valores del paquete
src/estilo/base.css                        letra, fondo, foco, toque, movimiento
src/estilo/comprobante.css                 el comprobante, en pantalla y en papel, sin heredar nada
src/componentes/base/*.tsx                 las piezas
src/componentes/Autorizar.tsx              pasa a ser una hoja (tarea 1)
src/componentes/Contraste.tsx              el interruptor
src/app/api/equipo/contraste/route.ts      POST: pone la galleta; sin sesión y sin base
src/app/layout.tsx                         lee la galleta; la letra
src/componentes/**, src/app/**/page.tsx    cada pantalla, en su tarea
src/app/globals.css                        se va vaciando; se borra al final
pruebas/27-estilo.test.ts                  contraste de los colores, por cálculo
pruebas/17-rutas.test.ts                   la ruta nueva en la matriz
recorrido/diseno.spec.ts                   la hoja, el contraste, las medidas
recorrido/papel.spec.ts                    el comprobante impreso, contra su línea base
recorrido/capturas.spec.ts                 los tres modos; ancho y angosto; estados de error y pendiente
docker/recorrido.Dockerfile                WebKit
playwright.webkit.config.ts                por HTTPS de verdad (ver tarea 1)
docs/guia-de-prueba-en-equipos.md          el guion de la tarea 8
```

## Tareas

Cada una se integra sola —no se editan a la vez `Mostrador`, `Cierre` y `Autorizar`— y termina
con: los recorridos completos en verde, el papel igual a su línea base, y capturas para que el
usuario las vea en los tres modos, a 1280×620 y 420×800, con sus estados de error y pendiente.

- [x] **0. La línea base, antes de tocar nada** (6 de octubre). `recorrido/papel.spec.ts`: el
      comprobante impreso —cada copia, dónde queda y de qué ancho; cada renglón con su texto, su
      lugar y su letra; y en cuántas hojas sale— en cuatro casos: una compra, una venta de cuatro
      materiales, un vehículo con sus dos pesadas y un descuento, y una reimpresión. Los retratos
      están en `recorrido/papel/` y se vuelven a tomar solo a propósito (`PAPEL=guardar`). Se
      tomaron ya con el comprobante por duplicado. Comprobado por mutación: cambiarle medio punto
      a la letra, quitarle su letra o angostar el papel dos milímetros hace fallar los cuatro.
      Las capturas de las pantallas de antes: `recorrido/capturas/antes-del-rediseno/`.
      **Ampliado el 6 de octubre por la noche**, por una pista de Codex (novena pasada): el
      retrato no veía la apariencia —un comprobante oculto, en gris o con la barra impresa encima
      habría pasado—. Ahora mide también la tinta de cada renglón, qué tan tenue llega, si es
      visible, sus rayas y su fondo; la línea de corte; y lo demás de la página que saldría, que
      tiene que ser nada. **Los retratos nuevos se tomaron del sistema de antes del rediseño**
      (la copia de la mañana del 6 de octubre, levantada aparte): en lo que la línea base
      original ya medía dicen exactamente lo mismo que ella, y el comprobante de hoy pasa contra
      ellos. Los originales no se perdieron: son un subconjunto de los nuevos. Siete mutaciones,
      siete detectadas. Detalle: `docs/revisiones/2026-10-06-respuesta-a-la-novena-revision.md`.
- [x] **1. La base, la hoja y autorizar** (6 de octubre). **Falta que Codex la revise**: lo
      intentó dos veces y se quedó sin cuota (vuelve el 9 de octubre por la noche). De su
      novena pasada salió una corrección: la hoja que el navegador cierra por su cuenta
      reaparecía con el foco en su primer control y no en el que lo tenía.
      - [x] **La dependencia**: `@ios27_design_system/tokens` 1.0.2, exacta, con su huella en el
        archivo de versiones. Solo su CSS (colores, espacios y tiempos).
      - [x] **La capa propia** (`src/estilo/valores.css`) y **los contrastes por cálculo**
        (`pruebas/27-estilo.test.ts`): cada par texto/fondo en los cuatro modos —claro, oscuro,
        «más contraste» y «más contraste» en un equipo oscuro—, con las transparencias compuestas;
        4.5 a 1 (7 con más contraste) para texto, 3 a 1 (4.5) para bordes y foco. La prueba movió
        tres valores del prototipo que no se leían: el texto secundario (el del paquete, al 60 %,
        no alcanza), el azul en oscuro (más claro como texto; el botón lleno conserva el azul
        hondo), y el tinte del azul (más tenue). Y una regla: las pantallas no nombran `--ios27-*`.
      - [x] **La base** (`src/estilo/base.css`): la letra del equipo, 17 px; el foco; sin destello
        al tocar ni espera de doble toque; la respuesta al apoyar el dedo; los campos de 16 px o
        más (un iPhone acerca la página con menos); jalar hacia abajo no recarga; el margen
        respeta la muesca; con menos movimiento, nada se desplaza.
      - [x] **El comprobante, apartado** (`src/estilo/comprobante.css`): todo lo que heredaba va
        escrito ahí. El papel quedó igual: los cuatro retratos pasan. (Uno se había tomado con la
        página desplazada; el retrato ahora mide el lugar en el papel, no en la ventana.)
      - [x] **Las pantallas de antes, con los valores nuevos.** Los nombres viejos de
        `globals.css` apuntan a la capa nueva, y se quitaron de un jalón las mayúsculas espaciadas
        (eran de la letra condensada, que ya no está) y las esquinas de 3 px. Es un estado de
        paso: todo se ve ya con el azul, la letra y las esquinas nuevas, y cada pantalla se
        termina en su tarea. Los 126 recorridos pasaron sin tocarlos.
      - [x] **La hoja** (`src/componentes/base/Hoja.tsx`, diálogo nativo) y **autorizar como
        hoja** (`Autorizar.tsx`), con `recorrido/diseno.spec.ts`: lo de atrás queda inerte y no se
        desplaza; el foco no sale; lo que se toca mide 60 px o más; en angosto sube desde abajo y
        en ancho va al centro; libre, Escape la cierra y el foco vuelve a la página; ocupada o
        con un envío del que no se supo, no se cierra ni con Escape dos veces, y el envío sigue
        ahí; con menos movimiento no se desplaza; al imprimir no sale, y no se cierra para eso.
        **La hoja la cierra su dueño:** donde hoy se puede «regresar» con un envío pendiente
        (conteo y corrección, que al regresar muestran el aviso y no dejan cambiar nada) se sigue
        pudiendo; al reabrir el día, no. Cerrarla nunca suelta el envío.
        **Un recorrido cambió sus pasos, no lo que afirma:** «irse al mostrador y volver no
        pierde el envío», en conteo y corrección. La hoja tapa la navegación, así que primero se
        sale de ella y al volver se entra otra vez.
        **Estado de paso:** donde se autoriza, lo que hay detrás de la hoja todavía es la página
        sin el paso anterior; que se vea el paso detrás va con cada pantalla.
      - [ ] **Botón** como pieza: se crea con la primera pantalla que lo use (tarea 2).
      - [x] **WebKit**, por HTTPS de verdad (`docker compose --profile webkit run --rm
        recorrido_webkit`, `playwright.webkit.config.ts`): un proxy con su propia autoridad
        delante de la aplicación de los recorridos, y el navegador confía en esa autoridad —no se
        ignora ningún error de certificado—. Empieza comprobando que el origen es seguro y que hay
        candados entre pestañas y diálogo nativo (`recorrido/seguro.spec.ts`, que corre también en
        Chromium). **Corren todos los recorridos, no solo los delicados: 129, y pasan** —el
        mostrador, el inventario con sus envíos inciertos y sus pestañas duplicadas, la hoja,
        cerrar y reabrir el día, el duplicado—. El del papel no corre ahí: cuenta las hojas de un
        PDF, que solo Chromium produce.
- [x] **2. La entrada y la barra** (`Sesion.tsx`; 6 de octubre). **Falta que Codex la revise**
      (misma razón que la tarea 1).
      - [x] **El interruptor de contraste** (`Contraste.tsx`, `src/servidor/contraste.ts`,
        `POST /api/equipo/contraste`): manual, a un toque, en todas las pantallas —la de entrada,
        la de «sin conexión» y la barra—, y recordado por equipo en una galleta propia que pone el
        servidor (dura 400 días; el código de la página no la lee). Tres estados: sin elegir,
        sigue al equipo; «normal» elegido le gana al equipo; «alto» es claro aunque el equipo
        esté en oscuro. La página llega del servidor con el contraste puesto y no se guarda en
        cachés de paso. `recorrido/contraste.spec.ts` (8): se activa, se sale, se entra y sigue;
        se abre otro navegador con lo que aquel guardó y sigue (**una recarga no acredita un
        reinicio, y se probó aparte**); «normal» contra un equipo que pide contraste; el equipo
        cambia de parecer sin que nadie haya elegido y la pantalla lo sigue al momento; **con el
        sistema en mantenimiento y con la base caída** sigue ahí, funciona y se recuerda; si la
        red falla al guardar vuelve a como estaba y lo dice; mientras guarda no admite otro
        toque; cambiarlo no recarga ni pierde una captura a medias; otra pestaña lo ve al
        recargar. La ruta, en `pruebas/17-rutas.test.ts`: solo «alto» o «normal», en un cuerpo
        bien formado y desde el propio sitio; sin sesión y sin base.
        **Lo que no se hizo como decía el plan:** «dos toques seguidos con las respuestas
        llegando al revés» no puede ocurrir —mientras guarda, el interruptor está deshabilitado
        de verdad—, y eso es lo que se prueba.
      - [x] **Las piezas botón e interruptor** (`src/componentes/base/Boton.tsx`,
        `Interruptor.tsx`; estilos en `src/estilo/piezas.css`, adonde se mudó también la hoja).
        **Lo que se sabe del contraste es de la página, no de cada interruptor** (otra pista de
        Codex): el interruptor aparece en varias pantallas, y si la pantalla cambia mientras se
        guarda, el que aparece sigue ocupado, y si no se pudo guardar él también vuelve a como
        estaba y lo dice.
        El botón es de tipo «button» mientras no se le diga «submit». Clases: lleno, tinte, gris,
        peligro y de línea. Lo usan las pantallas de entrada, la barra y «lo que falta para
        atender»; las demás pantallas siguen con `.btn` hasta su tarea.
      - [x] **La entrada** (alta del equipo, quién atiende, la clave, sin conexión) y **la barra**
        (`src/estilo/sesion.css`): arriba, el día, el interruptor y quién atiende con «Salir»;
        debajo, las pantallas, en una píldora de vidrio. **En pantalla ancha la píldora se queda
        arriba al bajar**, y las cuentas del mostrador empiezan debajo de ella; **en angosta no
        se queda fija** —ahí arriba se quedan las cuentas, como ya estaba validado— y no lleva
        vidrio. En un teléfono el interruptor se queda con su dibujo y su palanca (el rótulo
        sigue para quien no ve la pantalla) y el rol no se muestra.
        `recorrido/barra.spec.ts` (10): a 1280×620, 420×800 y 360×640, en cada pantalla de
        entrada —también con su aviso— y en la barra con cinco pantallas, todo lo que se toca
        mide 60 px o más y está a 8 px o más de lo de junto, ninguna letra va de menos de 15 px y
        la página no se desplaza de lado (`loQueNoMide`, en `recorrido/apoyo.ts`, que sirve para
        las tareas que siguen); la barra se queda arriba y es de vidrio; **con más contraste, y
        cuando el equipo pide menos transparencia, es sólida de verdad** (se mide lo que el
        navegador pinta, no la variable); se recorre con el teclado en su orden y marca dónde se
        está; lo que se toca cede al apoyar el dedo y lo que hace ocurre al soltar (apoyar y
        arrastrar fuera no lleva a ningún lado); con menos movimiento no se encoge.
      - [x] **Lo que las pruebas encontraron y se corrigió:** un tinte puesto directo sobre el
        fondo gris no se leía (el aviso rojo de la entrada daba 4.4 a 1; el azul, 4.2): ahora un
        tinte lleva siempre su superficie debajo (`--tinte-acento`, `--tinte-alerta`), y una
        regla lo vigila. Con el equipo pidiendo más contraste sin que nadie eligiera, la hoja no
        marcaba su borde y el comprobante en pantalla seguía crema: ahora lo que cambia con el
        contraste lo traen los valores (`--borde-marcado`) y ninguna hoja de estilos pregunta
        por su cuenta. Al cambiar de pantalla, el interruptor decía lo que el servidor mandó al
        principio y no lo que se veía. Y con menos movimiento, los enlaces seguían encogiéndose
        al tocarlos.
      - [x] **Reglas nuevas en `pruebas/27-estilo.test.ts`:** el vidrio tiene salida sólida (sin
        desenfoque o con menos transparencia); nada cambia al pasar el puntero salvo donde hay
        puntero; el texto sobre el vidrio se lee con lo más oscuro y con lo más claro pasando
        por debajo.
      - [x] Capturas, en los tres modos y los dos tamaños, con sus avisos:
        `recorrido/capturas/rediseno/2-*.png` (48).
      - [x] **Verificado** (6 de octubre, noche; números al final de este documento): la batería
        completa, todos los recorridos en Chromium y en WebKit, el ensayo de operación por HTTPS
        y el papel, igual a su línea base.
      - [x] **Comprobado por mutación.** Los recorridos de la barra y los del contraste se
        escribieron antes que el diseño, pero la primera vez que corrieron ya estaba construido:
        no se les vio fallar. Por eso se rompió el código a propósito, una cosa a la vez, para
        ver que cada uno falla cuando debe. **Del interruptor y su ruta, 12 mutaciones**: la ruta
        guardando cualquier valor o atendiendo a otro sitio; la galleta legible por la página,
        de un mes, sin marca de segura por HTTPS o viajando a otros sitios; la galleta leída sin
        cuidado; la página sin el contraste puesto desde el servidor; no volver a como estaba si
        falla; no seguir al equipo sin elección; admitir otro toque mientras guarda; y recargar
        la página al guardar. **Esta última sobrevivió**: el recorrido miraba al instante de
        tocar, y una recarga que llegara al terminar de guardar pasaba (la captura a medias
        sobrevive a recargar). Se reforzó —espera a que guarde, cuenta las cargas y vuelve a
        mirar al final— y ahora la detecta. De la barra y las reglas de estilo, 23 mutaciones,
        **todas detectadas**: un enlace de 46 px; la barra que no se queda fija; el interruptor
        fuera de su orden; el interruptor como botón de envío (con Enter en el código cambiaría
        el contraste en vez de mandarlo); encogerse con menos movimiento; no seguir al equipo
        cuando cambia de parecer; la ruta dependiendo de la base; desenfoque con más contraste;
        sin salida para menos transparencia; fija en angosto; las cuentas tapadas por la barra;
        enlaces a 4 px; letra de 13.5; cinco pantallas sacando la página de lado; un tinte
        directo sobre el fondo; el vidrio sin salida; un cambio al pasar el puntero sin puntero;
        los bordes sin marcar; el comprobante en pantalla sin seguir al equipo; un vidrio
        demasiado transparente; una hoja de estilos preguntando por el contraste; la palanca
        que no se distingue; el borde de un control que no se ve.
        **No comprobado por mutación, y se dice:** que la página no se guarda en cachés de paso
        (el encabezado lo pone el armazón al leer la galleta: no hay qué romper sin romper lo
        demás); que el botón sea de tipo «button» por omisión (ningún botón de esta tarea vive
        dentro de un formulario salvo el que envía: se probará con la primera pantalla que lo
        tenga); y tres pares de color nuevos que pasaron a la primera (el botón gris sobre el
        fondo, el aviso directo sobre el fondo, y el texto sobre el vidrio con algo blanco debajo).
      **Queda dicho:** el teclado de la clave y el visor conservan su forma de antes: son del
      mostrador y se rediseñan con él (tarea 3). La pantalla detrás de la barra —mostrador,
      precios, cierre— sigue en su estado de paso.
- [x] **3 a 7, de una vez (10 de octubre de 2026). Falta que Codex lo revise.** El plan las
      separaba pantalla por pantalla; se hicieron juntas porque lo que faltaba era casi todo
      apariencia compartida: las pantallas de adentro —mostrador, comprobante en pantalla,
      arranque, precios, cierre, inventario— usan las mismas clases, y bastó reescribir esa hoja
      en el lenguaje nuevo. **Ningún estado ni efecto se tocó**; en el mostrador solo se movió
      de lugar el botón «Precio especial» (va en su renglón, junto a «Quitar»).
      - **La hoja:** `src/estilo/pantallas.css` (antes `src/app/globals.css`, que ya no existe):
        tarjetas sin borde y de radio grande; botones de píldora, lleno para lo que sigue y gris
        para lo que regresa; los tres pasos como un solo control; materiales y básculas como
        tarjetas; el peso grande y al centro (se fue la cara de báscula oscura); teclado de teclas
        redondeadas, también en la clave y en la hoja de autorizar; totales con la cifra grande;
        avisos de 17 px. Todo con los valores de `valores.css`: ya no quedan los nombres de antes
        (`--bg`, `--fg`, `--f-cond`…) ni las letras Barlow.
      - **Medidas de patio, medidas de verdad** en cada pantalla y en tres tamaños (1280×620,
        420×800, 360×640): `recorrido/mostrador-medidas.spec.ts` —sin cuentas, material, otra
        familia, báscula, el peso, la cuenta, el precio especial y su hoja de autorizar, una
        cuenta en espera, la segunda pesada— y `recorrido/pantallas-medidas.spec.ts` —el
        comprobante en pantalla (el papel mismo no: es papel), inventario (lo que hay, contar,
        los movimientos de un material), precios (como los ve el mostrador y como los pone el
        responsable), cierre y arranque—. Todo lo que se toca mide 60 px o más y está a 8 o más
        de lo de junto; el texto, 17; nada se sale de lado. Para cumplirlo, los renglones del
        inventario pasaron a ser renglones separados, y los pasos llevan 8 px entre sí.
      - **El papel no cambió:** sus cinco retratos (renglones e imagen) siguen iguales.
      - **Lo que el plan pedía y NO se hizo, dicho:** en inventario, cada acción «ahora con
        hoja» (siguen siendo pantallas; solo autorizar es hoja); el pulgar animado de los pasos;
        y de los recorridos de la tarea 3: girado, con la letra agrandada, con importes enormes y
        nombres largos, y que el envío y la pestaña dueña se conserven al cambiar de modo y de
        tamaño (lo de diez cuentas y la tira angosta sí tiene recorrido, de antes). Merma,
        separar y corregir no se midieron una por una: usan las mismas piezas que contar.
- [ ] **8. En los equipos de verdad.** Lo hace el usuario, con un guion corto que se llena y se
      guarda (equipo, sistema y navegador con su versión): el teclado en pantalla abierto;
      vertical y horizontal; la barra del navegador y los bordes de la pantalla; acercar; el
      toque que se arrepiente y el doble toque; el sol y el contraste; el lector de pantalla; una
      hoja que se desplaza sin mover el fondo; salir, entrar y reiniciar con el contraste
      recordado; **imprimir de verdad**. Un iPhone o iPad, un Android, y Windows con Edge y con
      Chrome. El navegador de pruebas se parece, pero no es el equipo: **no se da por comprobado
      hasta que se haga.**
- [ ] Revisión de Codex, por tarea.

**Lo nuevo va encima de la tarea 1.** Las pantallas de precio especial y de reabrir el día usan
la hoja y autorizar; su parte de base de datos y de servidor no depende de este plan y puede ir
antes.

## Verificado

**10 de octubre de 2026, sobre el estado final de las tareas 3 a 7** (y con la pantalla del precio
especial dentro): tipos y **865 pruebas**, cero fallos; **187 recorridos en Chromium** y **180 en
WebKit**; el papel, igual a sus cinco retratos, en renglones y en imagen; y **el simulacro de
operación**, completo, sobre las pantallas ya restilizadas. El rediseño rompió un solo recorrido
—con nueve cuentas, la activa ya no cabía entera en su grupo— y se arregló dándole a cada grupo
lugar para una cuenta completa. Después de la última corrida completa solo cambió un color (el
paso en que se está va invertido, porque en oscuro no se distinguía); con él se repitieron los
recorridos del mostrador, las cuentas, el papel y el precio especial. Capturas en claro
(`recorrido/capturas/`), y del mostrador y el inventario en oscuro y con más contraste
(`recorrido/capturas/rediseno/3-*`). El simulacro de publicación no se repitió: pasó el mismo día
sobre el estado anterior al restilizado, que no toca nada de publicar.

**6 de octubre de 2026, por la noche, sobre el estado final de las tareas 0, 1 y 2** (con las tres
correcciones que salieron de la novena pasada de Codex): tipos y **650 pruebas**, cero fallos;
**152 recorridos en Chromium** y **147 en WebKit** por HTTPS de verdad (los que se saltan son los
de capturas, que solo corren si se piden; el del papel y el de «menos transparencia» son solo de
Chromium); **el ensayo de operación**, con sus 6 recorridos por HTTPS sobre una instalación desde
cero; y el papel, igual a sus retratos, que son del sistema de antes del rediseño.

**Lo que no está verificado:** nada de esto en un equipo de verdad (tarea 8), y **la revisión de
Codex de las tareas 0, 1 y 2**, que se quedó sin cuota dos veces; vuelve el 9 de octubre a las
10:09 de la noche.

## Lo que se queda fuera

Botón de claro/oscuro. Selector de color. Arrastrar para cerrar. Sonido y vibración. Aplicación
instalable. Imprimir el cierre (hoy solo se imprime el comprobante). Cambiar textos, salvo donde
la nueva disposición lo obligue (y se dice dónde).

## Lo que hay que mirar con lupa

1. **Que rediseñar no cambie lo que hace.** `Mostrador.tsx` son 736 líneas con mucha regla
   dentro. Los recorridos, después de cada paso, no al final.
2. **Una hoja es una forma nueva de tapar la pantalla**, y hoy cada pantalla bloquea lo que debe
   mientras no se sabe de un envío. La hoja no puede ser un atajo para soltarlo.
3. **Contraste alto en un equipo en modo oscuro.** Son tres apariencias, no dos.
4. **El vidrio en tabletas modestas.** Si se traba, se quita: no es parte de la función.
5. **La letra cambia de un equipo a otro.** Un rótulo que cabe en Windows puede no caber en
   Android.
6. **El papel.** Es lo único que el cliente se lleva: no cambia ni un renglón.
7. **Un paquete joven, de un solo autor.** Por eso entra solo su CSS, a versión exacta y detrás
   de una capa propia.
