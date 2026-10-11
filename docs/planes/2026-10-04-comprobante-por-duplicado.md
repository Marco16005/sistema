# Diseño y plan: el comprobante sale por duplicado

> **Estado:** lo pidió el usuario el 4 de octubre de 2026. Codex revisó el plan y lo aprobó
> (`docs/revisiones/2026-10-04-codex-sexta-revision.md`, parte F: sin importantes; un menor, ya
> incorporado). **Hecho el 4 de octubre. Codex revisó la implementación el 6 y la dio por cerrada**
> (`docs/revisiones/2026-10-06-codex-septima-revision.md`, parte B), sin hallazgos.
>
> **Para quien lo ejecute:** con la prueba primero. Es un cambio chico, de pantalla: no toca la
> base ni el servidor.

## De dónde sale

Al preguntar cuánto se puede perder si se muere el servidor, la respuesta fue: a lo más una hora
(el respaldo es cada hora). Pero lo capturado en esa hora no se puede volver a capturar de ningún
lado si el negocio no se queda con papel: el comprobante se lo lleva el cliente. El usuario
decidió: **que salga por duplicado, y el negocio se queda con una copia.**

## Qué se propone

- **La primera impresión de un comprobante saca dos copias en un solo envío a la impresora**: la
  del cliente, igual que hoy, y la del negocio, con el mismo contenido y la leyenda **«COPIA DEL
  NEGOCIO»**. Entre las dos, un salto de página (la impresora con cortador corta ahí) y una línea
  punteada, por si no corta.
- **En pantalla se sigue viendo un solo comprobante.** La copia existe solo en el papel.
- **Una reimpresión saca una sola copia**, como hoy, con su motivo. A los motivos se agrega
  «Copia para el negocio», para cuando la que se perdió o se atascó fue esa.
- **No cambia nada en la base ni en el servidor.** Una impresión registrada sigue siendo un envío
  a la impresora; que la primera lleve dos copias es una regla fija, no un dato.

**Sin firma.** Se le preguntó al usuario si la copia del negocio debía llevar una línea de nombre
y firma, y contestó que no: los comprobantes del negocio no llevan firma. Las dos copias son
iguales, salvo la leyenda.

## Decisiones

1. **Un solo envío a la impresora, no dos.** Se llama a imprimir una vez, y el papel trae las dos
   copias. Dos envíos serían dos ventanas de impresión y dos oportunidades de que salga una sola.
2. **La copia no duplica lo que la pantalla y los recorridos encuentran.** Va en su propio
   elemento, con clase propia (no `.ticket`), oculta en pantalla y fuera del árbol de
   accesibilidad. Se revisa cada búsqueda por texto de los recorridos del comprobante: ninguna
   debe pasar a encontrar dos cosas. Una búsqueda se puede acotar al comprobante del cliente
   diciendo por qué afirma lo mismo; nunca se ensancha ni se toma «la primera».
3. **Las dos copias salen del mismo dato**, pintadas por la misma función: no pueden diferir más
   que en la leyenda.
4. **Va antes de la línea base del rediseño.** El rediseño promete no mover el papel y compara
   contra una línea base (su tarea 0): esa línea base se toma **después** de este cambio.

## Archivos

```
src/componentes/mostrador/Ticket.tsx        la copia del negocio; el motivo nuevo
src/app/globals.css                         el papel: dos copias, salto y línea de corte
recorrido/mostrador.spec.ts (o el que cubra el cobro)   lo de abajo
../ESPECIFICACION-TECNICA.md                el comprobante por duplicado
```

## Tareas

- [x] **Lo que sale en papel**, mirado en la vista de impresión, con la prueba primero: al cobrar
      se manda a imprimir **una vez**; el papel trae dos copias, la segunda con «COPIA DEL
      NEGOCIO»; mismo folio, mismos renglones, mismo total; la del negocio empieza hoja y va
      debajo, sin encimarse. En compra y en venta; con un comprobante largo. La del cliente sale
      donde y como salía: arriba a la izquierda, a 72 mm.
- [x] **En pantalla** se ve uno solo, y un lector de pantalla encuentra uno solo.
- [x] **La reimpresión** saca una copia, con su motivo; «Copia para el negocio» está entre los
      motivos. La primera impresión pedida a mano (cuando no se imprimió al cobrar) también saca dos.
- [x] **La impresión de la que no se supo** (lo que pidió Codex, A6-F-M1): se registra, se pierde
      la respuesta, mientras tanto alguien reimprime desde otro lado, y el reintento —el mismo
      envío— sigue siendo la primera: dos copias, un solo envío al papel, y no dice «reimpresión».
      Por eso el duplicado se decide por **el número que el servidor le dio a esa impresión**, no
      por cuántas lleva el comprobante.
- [x] **Los recorridos de siempre** siguen pasando sin cambiar lo que afirman: 113 (los 109 de
      antes y los cuatro de `recorrido/duplicado.spec.ts`).
- [x] Revisión de Codex, con ejecución: cerrada, sin hallazgos. Comprobó además el papel en PDF
      (dos hojas; la copia del cliente, palabra por palabra en el mismo lugar que antes).

Comprobado por mutación: tres —decidir el duplicado por cuántas impresiones lleva; quitarle a la
copia el salto de hoja; dejarla visible en pantalla—, y las tres hacen fallar algún recorrido.

**Cómo quedó:** `Ticket.tsx` pinta las dos copias con la misma función; la del negocio
(`.ticket-negocio`, fuera del árbol de accesibilidad) existe solo cuando la impresión es la
número 1. En `globals.css`, las copias van una debajo de la otra dentro de un mismo contenedor
de papel (`.papel`), que es el que se coloca arriba a la izquierda; antes se colocaba el
comprobante mismo, y dos colocados igual se habrían encimado.

## Lo que hay que mirar con lupa

1. **El corte.** Que la impresora corte entre copias depende de su configuración; la línea
   punteada es el respaldo. Se prueba con la impresora de verdad (tarea 8 del rediseño).
2. **Que no se vuelva costumbre no arrancar la copia.** Eso no lo arregla el sistema: es del
   negocio guardar su copia.
