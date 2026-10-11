# Respuesta a la novena revisión de Codex (6 de octubre de 2026)

El informe está en `2026-10-06-codex-novena-revision.md`. **Quedó incompleto por cuota**: terminó
la parte A y se detuvo empezando la B. La cuota es la semanal: no vuelve hasta el **9 de octubre
a las 10:09 de la noche**.

| Parte | Qué era | Cómo quedó |
|---|---|---|
| A | La marca de restauración | **Completa. Cierra la tarea 3 del despliegue**, sin hallazgos |
| B | Rediseño, tareas 0 y 1 | **Sin revisar.** Dejó dos pistas en sus registros (abajo) |
| C | Rediseño, tarea 2 | **Sin revisar.** Dejó una pista en sus registros (abajo) |

**Las partes B y C no cuentan como revisadas y hay que repetirlas enteras** cuando vuelva la
cuota. Mientras tanto las tareas 0, 1 y 2 del rediseño quedan hechas y verificadas aquí, pero
**sin la revisión de Codex**.

## Parte A — La marca de restauración: cerrada

Sin nada que corregir. Corrió su propia batería (650 de 650), repitió su reproducción de la
séptima (se rechaza antes de migrar, después y al intentar retirar la vieja), terminó la que
había dejado preparada en la octava (`serial`, `identity` y secuencias sueltas se retiran y se
recrean juntas sin perder el emparejamiento) y probó que la cuenta de lo retirado dentro de una
transacción (`feruga.retiradas`) no es una llave: falsificarla no vuelve apta a una base con una
tabla de más, porque ni la aplicación ni el migrador la leen, y el usuario de la aplicación no
puede retirar nada. Con esto la tarea 3 queda cerrada después de nueve vueltas.

## Lo que dejó en sus registros sin redactar, y lo que se hizo

Tres pistas: una con su reproducción ya fallando, dos anotadas «para comprobar con ejecución».
Las tres eran ciertas. Cada una se reprodujo con una prueba que falló antes de corregir.

### 1. La hoja que reaparece no devolvía el foco a donde estaba (parte B)

Su reproducción, en su copia: con el foco en una tecla de la hoja, el navegador la cierra por su
cuenta; la hoja reaparece —bien—, pero el foco queda en su primer control y no en la tecla. El
plan lo promete («al reaparecer se devuelve el foco a este»).

**La causa:** al volver a mostrarse, el navegador pone el foco en el primer control de la hoja, y
eso pasaba por «el último que tuvo el foco» y lo pisaba antes de usarlo.
**La prueba** (`recorrido/diseno.spec.ts`, «si el navegador cierra la hoja por su cuenta,
reaparece con el foco donde estaba…»): falló como la suya. Se hace dos veces, desde dos controles
distintos, y termina comprobando que al cerrarla su dueño no queda nada encima y lo de atrás se
puede usar.
**La corrección** (`src/componentes/base/Hoja.tsx`): el control se anota antes de volver a
mostrarla.

### 2. El retrato del papel no veía toda la apariencia impresa (parte B)

Cierto: medía dónde queda cada renglón, su texto y su letra, pero no su tinta, ni qué tan tenue
va, ni si de verdad sale. Un comprobante en blanco —con los renglones en su lugar pero ocultos—
habría pasado; también uno en gris, o con la barra de las pantallas impresa encima.

**Lo que ahora mide** (`recorrido/papel.spec.ts`): de cada renglón, además, el color, la opacidad
con que llega al papel, si es visible, su estilo, su adorno, sus rayas y su fondo; de cada copia,
su fondo y su orilla; la línea de corte entre las dos copias; el fondo de la hoja; y **lo demás
de la página que también saldría**, que tiene que ser nada. Tres cosas se afirman sin depender de
ningún retrato guardado: no sale nada que no sea el comprobante, todo renglón se ve, y el papel
es blanco.

**De dónde salen los retratos nuevos: del sistema de antes del rediseño**, no del de hoy. Se
levantó aparte la copia que Codex hizo para su séptima pasada (del 6 de octubre por la mañana,
antes de la tarea 1; no trae `src/estilo/`), y se tomaron ahí. Dos comprobaciones:
- en todo lo que la línea base original ya medía, los retratos nuevos dicen **exactamente lo
  mismo** que ella, renglón por renglón, en los cuatro casos (y con eso queda confirmado también
  el retrato que se había convertido a mano de «lugar en la ventana» a «lugar en el papel»);
- el comprobante de hoy, con la entrada y la barra ya rediseñadas, **pasa contra esos retratos**:
  el rediseño no le cambió al papel ni la tinta, ni lo tenue, ni las rayas, ni lo que sale.

Comprobado por mutación, siete de siete: la tinta en gris, el fondo que deja de ser blanco, los
renglones de detalle más tenues, las rayas continuas, la línea de corte de puntos, el comprobante
oculto (papel en blanco) y la barra de las pantallas saliendo en el papel.

**Lo que sigue sin ver, y se dice:** dónde corta de verdad la impresora térmica y cómo traduce su
controlador los grises. Eso se mira en el papel (tarea 8).

### 3. El interruptor de contraste podía cambiar de instancia a medio guardar (parte C)

Cierto. El interruptor vive en varias pantallas —las de entrada, la barra— y cada uno llevaba su
propia cuenta. Si la pantalla cambiaba mientras se guardaba (tocar el interruptor y, enseguida,
«Salir»), el que aparecía no sabía que se estaba guardando: admitía otro toque, y si el guardado
fallaba, la pantalla volvía a como estaba pero él seguía diciendo lo contrario.

**La prueba** (`recorrido/contraste.spec.ts`, «si la pantalla cambia mientras se guarda…»): falló
en «sigue ocupado». Afirma que el interruptor que aparece está deshabilitado mientras se guarda,
que un toque forzado no manda otra petición, y que si no se pudo guardar él también vuelve a como
estaba y lo dice.
**La corrección** (`src/componentes/Contraste.tsx`): lo que se sabe del contraste —si va alto, si
se está guardando, si falló— ya no es de cada interruptor sino de la página: un solo lugar, que
todos leen.

## Lo que salió al comprobar por mutación lo de la tarea 2

No es de Codex, pero se anota aquí porque es la misma clase de cosa. Al romper a propósito el
interruptor para ver que sus recorridos fallan, **una mutación sobrevivió**: si cambiar el
contraste recargara la página al terminar de guardar, el recorrido «no recarga la página ni
pierde una captura a medias» pasaba igual —miraba al instante de tocar, antes de que el guardado
terminara, y la captura a medias sobrevive a una recarga—. Se reforzó: espera a que guarde,
cuenta las cargas de la página y vuelve a mirar al final. Ahora la detecta. En total, de la
tarea 2 se probaron 35 mutaciones: 34 detectadas a la primera y esa, después de reforzar.

## Los contenedores que dejó

Otra vez sin limpiar, por la cuota: los de su copia (`feruga_codex_qa9-*`) se bajaron a mano, con
su volumen. Los del usuario no se tocaron: anotó sus horas de arranque al empezar
(`feruga-web-1`, 18:27 UTC; `feruga-db-1`, 16:16 UTC).

## Lo que queda para la siguiente pasada

Las partes B y C enteras, sobre el estado de ahora: el rediseño, tareas 0, 1 y 2, con estas tres
correcciones. Y lo que se programe hasta entonces.
