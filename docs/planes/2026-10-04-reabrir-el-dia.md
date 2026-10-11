# Diseño y plan: reabrir el día

> **Estado:** aprobado en concepto por el usuario el 4 de octubre de 2026. Codex revisó tres
> versiones del plan y aprobó la tercera (`docs/revisiones/2026-10-04-codex-sexta-revision.md`,
> parte A: «sí se puede codificar como está»). **Hecho el 6 de octubre de 2026: base, servidor y
> pantalla. Codex revisó la implementación ese mismo día y la dio por cerrada**
> (`docs/revisiones/2026-10-06-codex-septima-revision.md`, parte A), con dos menores ya corregidos.
>
> **Para quien lo ejecute:** con la prueba primero. Codex (`gpt-6-astra`, esfuerzo alto) revisa
> este plan antes de codificar y el resultado al cerrarlo.

## De dónde sale

El usuario probó la aplicación a mano el 4 de octubre: cerró el día y ya no pudo seguir. Así está
hecho hoy: hay una sola jornada por fecha, una jornada cerrada no se modifica (`RC001`), y abrir la
de hoy cuando ya existe se rechaza («La jornada del … ya existe»). **Un cierre por error a media
tarde dejaría al negocio sin comprar ni vender hasta el día siguiente.**

Lo que decidió, consultado el negocio:

- Lo normal es **cerrar una sola vez al día**.
- Si alguien cierra por error, **se puede reabrir, pero solo el mismo día y con la clave de un
  dueño**, y queda registro.
- Los precios del día **no cambian** una vez publicados. Eso se queda como está.

## Qué se propone

**Reabrir es deshacer el cierre de hoy, no abrir otra jornada.** Vuelve a ser la misma jornada:
con su lista de precios ya publicada, sus operaciones y sus cuentas. Nada se duplica.

- **Solo la jornada de hoy** (la fecha de la jornada es la de hoy en la zona de la sucursal). Ayer
  ya no se reabre: para eso está abrir la jornada de hoy.
- **Lo autoriza alguien con permiso de autorizar, con su clave**, en el equipo donde se pide. Lo
  puede pedir quien puede cerrar (mostrador o responsable).
- **Queda registro que no se borra**: qué jornada, cuándo se había cerrado y quién la cerró, cuándo
  se reabrió, quién lo pidió y quién lo autorizó. Y una línea en la bitácora.
- **Se puede reabrir más de una vez** el mismo día; cada vez queda su registro.
- **El reporte del día** se calcula de los libros, no se guarda: al volver a cerrar dice lo que
  haya entonces. Un reporte que ya se hubiera impreso quedó viejo, y el registro dice que hubo
  reapertura.

**Qué se puede afirmar, y qué no.** Mientras el día está cerrado **no se agregan operaciones
cobradas ni movimientos ordinarios de inventario a esa jornada**: por eso reabrir no desordena sus
libros. Pero **no es cierto que la base quede exactamente como estaba** (la primera versión de este
plan lo decía, y Codex lo refutó leyendo las migraciones): las cuentas de vehículos que quedaron
pendientes sí pueden cambiar con el día cerrado —segunda pesada, descuento, etiqueta, descartarlas—,
se pueden reimprimir comprobantes, y la gente entra y sale. Reabrir no deshace nada de eso: una
cuenta descartada en ese rato no vuelve.

**La pantalla.** Hoy, con el día cerrado, se ofrece «Abrir la jornada de hoy», que falla. En su
lugar: «El día de hoy ya se cerró» y **«Reabrir el día»**, que pide quién autoriza y su clave. Si
el día cerrado es de ayer, se ofrece abrir el de hoy, como siempre.

## Decisiones

1. **Se reabre un cierre en particular, y se cierra una apertura en particular.** La jornada
   lleva la cuenta de sus cierres (cero mientras no se ha cerrado nunca; uno al primer cierre…).
   Ese número **solo sube, se cambia con el candado de la jornada tomado, y nunca retrocede**; a
   las jornadas que ya existen se les pone al migrar (uno a las cerradas, cero a la abierta).
   - **Reabrir** dice qué jornada y **qué cierre vio la pantalla**; si la jornada ya se reabrió y
     se volvió a cerrar, ese cierre ya no es el vigente y la petición se rechaza.
   - **Cerrar** dice qué jornada y **cuántos cierres llevaba cuando la pantalla la vio abierta**.
     Hoy cerrar no dice nada: `cerrar_jornada_abierta` cierra «la que esté abierta» en ese
     momento. Con reapertura eso ya no sirve: A manda cerrar, se asienta el cierre 1 y se pierde
     la respuesta; B reabre; el reintento de A cerraría otra vez un día que alguien acababa de
     reabrir con la clave del dueño. Y una petición retenida podría cerrar hasta la jornada del
     día siguiente. Dirigido, ese cierre viejo se rechaza: la jornada ya no lleva cero cierres.
   Sin esto, una petición atrasada —de otra pestaña, o un reintento con la respuesta perdida—
   desharía lo que otra persona hizo después.
2. **Las dos llevan identificador de envío**, con su resultado guardado y su cancelación, como
   las demás acciones que escriben: un envío del que no se supo se resuelve en el servidor. La
   clave nunca se guarda en el navegador para reintentar.
   **Dos cosas distintas, que no se confunden:** *repetir el mismo envío* devuelve su resultado
   original —el reintento de reabrir el cierre 1 contesta «reabierto», aunque después se haya
   vuelto a cerrar; el reintento del cierre 1 contesta «cerrado, cierre 1», aunque después se
   haya reabierto—, sin volver a hacer nada. *Una petición nueva* (otro envío) dirigida a algo
   que ya no es lo vigente se rechaza.
3. **`reabrir_jornada(envío, jornada, cierre visto, autoriza, clave, huella, usuario)`**, en la
   base. Si ese envío ya se resolvió, devuelve lo que dejó. Comprueba la clave de quien autoriza:
   una clave mala **no lanza error** —devuelve «rechazada»— para que el intento quede contado, y
   la ruta lo traduce. Reserva el envío. Toma la jornada con candado y, **ya con el candado en la
   mano**, mira la fecha de hoy con el reloj de verdad en la zona de la sucursal: si la jornada no
   es de hoy, se rechaza (una petición que empezó antes de la medianoche y obtuvo el candado
   después, también). Si la jornada no está cerrada, o su cierre vigente no es el que se vio, se
   rechaza. Anota la reapertura y le quita el cierre.
4. **Una reapertura por cierre, y un guardián que exige esa prueba exacta.** `reapertura` guarda
   jornada, número de cierre, cuándo se había cerrado y quién, cuándo se reabrió, quién lo pidió y
   quién lo autorizó; no se edita, no se borra ni se vacía, y **no puede haber dos del mismo
   cierre**. El guardián de la jornada cerrada deja pasar un solo cambio: poner en vacío `cerrada_en`
   y `cerrada_por`, con **todo lo demás idéntico**, y solo si existe la reapertura de **esa**
   jornada y **ese** número de cierre, escrita en **esta** transacción. Borrar nunca entra por la
   excepción. La prueba no se puede reutilizar: al volver a cerrar, el cierre es otro número.
5. **El estado del día** que lee la pantalla dice si la jornada de hoy existe y está cerrada, y
   cuál es su cierre vigente: de ahí sale ofrecer reabrir en vez de abrir, y con qué cierre pedirlo.
6. **`abrir_jornada_de_hoy`**, cuando la de hoy ya existe y está cerrada, lo dice («ya se cerró:
   se puede reabrir con la clave de un dueño») en vez de «ya existe».
   **`cerrar_jornada_abierta` se retira** de la ruta: cerrar pasa a ser `cerrar` con envío,
   jornada y cierres vistos, comprobados con el candado tomado. Las reglas del cierre —qué
   cuentas lo impiden, qué deja pendiente— no cambian.
7. **El reporte del cierre dice cuál cierre es** (su número y su hora) y si esa jornada se reabrió
   antes: quien tenga un reporte impreso puede ver que quedó viejo.

## Archivos

```
db/migraciones/0024_reabrir_el_dia.sql        la cuenta de cierres, la tabla, reabrir, cerrar dirigido, el guardián, el mensaje
src/servidor/esquema.ts
src/servidor/dominio/dia.ts                   el estado del día (con los cierres que lleva); reabrir
src/servidor/dominio/cierre.ts                cerrar, dirigido y con envío; el reporte dice su número
src/servidor/dominio/envios.ts                las dos clases de envío nuevas, su resultado y su cancelación
src/app/api/jornada/reabrir/route.ts          POST
src/app/api/jornada/cerrar/route.ts           recibe envío, jornada y cierres vistos
src/app/cierre/page.tsx                       cierra con envío; lo que se ofrece con el día cerrado; autorizar
src/componentes/Sesion.tsx                    el día trae sus cierres; «hoy ya se cerró»
pruebas/25-reabrir-el-dia.test.ts, 07-cierre, 08-permisos, 10-entradas, 16-cierre, 17-rutas, 22-restauracion (el retrato: cierres y reaperturas)
recorrido/reabrir-el-dia.spec.ts, y los recorridos que cierran el día
```

**Esta va primero, y el precio especial después** (así lo recomendó Codex): lo común a las dos
—la jornada con su cuenta de cierres, los envíos, el cierre dirigido— se cierra aquí, y el precio
especial se monta encima sin volver a escribir las mismas funciones.

## Tareas

Todas con la prueba primero. Migración `0024_reabrir_el_dia.sql`; pruebas en
`pruebas/25-reabrir-el-dia.test.ts` (19) y recorridos en `recorrido/reabrir-el-dia.spec.ts` (7).

- [x] **Reglas, en la base:** reabre la de hoy cerrada; no reabre la de otro día; no reabre una
      que está abierta; sin jornada no hay qué reabrir; quien autoriza debe tener permiso y estar
      activo; la clave mal no reabre, **queda contada** (bloqueo real por intentos) y deja el
      envío sin gastar; patio, consulta y administración no pueden pedirlo; la aplicación no puede
      quitar el cierre por su cuenta ni tocar el registro.
- [x] **La cuenta de cierres:** sube en cada cierre; no se mueve a mano ni retrocede, tampoco
      para el dueño de la base; una jornada que ya tuvo cierres no se borra; las que ya existían
      quedan con uno si estaban cerradas y cero si no.
- [x] **La petición de reabrir que llega tarde:** una petición nueva de reabrir un cierre que ya
      no es el vigente se rechaza (`RC011`) y el día sigue cerrado.
- [x] **La petición de cerrar que llega tarde:** el reintento del mismo envío contesta «cerrado,
      cierre 1» y no cierra otra vez; una petición nueva que vio cero cierres se rechaza; una
      orden retenida hasta que hay otra jornada abierta no cierra la nueva.
- [x] **El envío, en las dos acciones:** repetido, devuelve su resultado original —sin pedir la
      clave otra vez—; con otro contenido o cancelado, `RC012`.
- [x] **El guardián:** una jornada cerrada no se modifica por ningún otro camino: ni la fecha, ni
      quién la cerró, ni borrarla, ni quitarle el cierre sin registro, con uno de otro cierre o de
      otra hora, o cambiando a la vez otro campo; ni dos veces en la misma transacción. Un
      registro escrito suelto, sin reabrir, no se queda.
- [x] **Después de reabrir:** se abre una cuenta, se cobra; la lista sigue publicada y sin
      editarse; los folios siguen su cuenta; no nace otra jornada.
- [x] **Lo que pasó con el día cerrado no se deshace:** un vehículo descartado en ese rato no
      vuelve; el que volvió a pesarse se cobra ya reabierto.
- [x] **Cruces, con barrera:** dos reaperturas a la vez; reabrir y cerrar a la vez; la que obtuvo
      el candado después de la medianoche se rechaza; reabrir mientras otra sesión intenta abrir
      la jornada de hoy.
- [x] **El servidor:** las dos rutas en la matriz de quién pasa, con su cuerpo; el estado del día
      con «hoy ya se cerró», su cierre vigente y los cierres que lleva; un ciclo entero por las
      rutas (cerrar, clave mala, reabrir, repetir el cierre viejo, cerrar otra vez).
- [x] **Lo que ya existía sigue igual:** las pruebas del cierre pasan pidiéndolo como ahora. Seis
      pruebas viejas cerraban el día a mano o «la que esté abierta»: ahora dicen cuál y cuentan el
      cierre. Dos recorridos esperaban «La jornada de hoy no está abierta» después de cerrar hoy:
      ahora esperan «El día de hoy ya se cerró», que es lo que la pantalla dice.
- [x] **La pantalla:** cerrar, ver que se ofrece reabrir (y no «abrir la jornada de hoy»),
      reabrir con la clave, atender, volver a cerrar y ver en el reporte que se reabrió y quién lo
      autorizó. Con la clave mal. Quien no cobra no ve cómo reabrir. La respuesta perdida, al
      cerrar y al reabrir, antes y después de recargar. Dos pestañas, una atrasada. Una pestaña
      duplicada no hereda el envío a medias. Con el día cerrado de ayer se ofrece abrir el de hoy.
- [x] **Respaldo:** el retrato de la restauración incluye la cuenta de cierres, las reaperturas
      y lo que dejaron sus envíos.
- [x] **Restaurar hoy un respaldo tomado con el día cerrado, y reabrirlo:** no lo prueba la
      batería; lo probó Codex en su séptima revisión, con el programa de restaurar, y pasó (la
      sesión de antes queda cerrada, se reabre, el cierre viejo repetido no vuelve a cerrar, y la
      compra siguiente sale con folio del bloque nuevo).
- [x] Revisión de Codex, con ejecución: cerrada. Sus dos menores: el aviso al resolver una
      reapertura que ya había entrado ahora dice cómo está el día en ese momento (dos recorridos
      más, nueve en total); y una prueba vieja del cierre vuelve a preguntarle al servidor.

Comprobado por mutación: trece en la base y seis en la pantalla. Dieciocho hacen fallar alguna
prueba. **Una sobrevive, y se deja:** quitarle al guardián la condición de que el registro sea de
esta transacción. Es redundante con otras dos reglas —un registro no puede quedar suelto al
terminar su transacción, y la cuenta de cierres no retrocede—: con ellas, un registro del cierre
vigente solo puede haberse escrito en la transacción en curso. Se conserva como segunda defensa.

**Cómo quedó, en dos líneas.** La jornada lleva `cierres`. `cerrar_el_dia(envío, jornada,
cierres vistos, quién)` y `reabrir_jornada(envío, jornada, cierre visto, autoriza, clave, equipo,
quién)` sustituyen a «cerrar la que esté abierta», que se eliminó. En la pantalla del cierre, lo
que salió y no se supo se guarda por pestaña (`feruga.cierre`), como en inventario.

## Lo que hay que mirar con lupa

1. **Que no se pueda reabrir un día que no es hoy** por ningún camino, incluida la medianoche.
2. **Que el guardián no quede más flojo que antes** para todo lo que no sea esta reapertura.
3. **Lo que ya se entregó.** Si el cierre se imprimió o se reportó, reabrir lo deja viejo: el
   registro tiene que alcanzar para explicarlo.
4. **El respaldo.** Un respaldo tomado con el día cerrado y restaurado el mismo día: se puede
   reabrir igual, con las mismas reglas.
