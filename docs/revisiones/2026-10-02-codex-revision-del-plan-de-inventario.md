# Revisión de Codex al plan de inventario

**Revisor:** Codex, modelo `gpt-6-astra`, esfuerzo alto. **Fecha:** 2 de octubre de 2026.
**Objeto:** `docs/planes/2026-10-02-inventario.md`, primera versión. Revisión por lectura.

Veredicto: «el plan es viable, pero todavía tiene decisiones sin cerrar que afectan la corrección de
existencias, la autorización y los reintentos».

## Bloqueantes

1. **La corrección debe tomar el candado antes de calcular el estado vigente.** El candado del patio se
   toma al insertar (`0006:81`); si `corregir_movimiento` ya leyó, dos sesiones que quieren dejar 100 en
   80 asientan −20 cada una y queda 60. *Propone:* candado, después leer y sumar; objetivo por material
   con el signo del original; solo diferencias netas; todo o nada, comprobando las salidas bajo el
   candado antes de insertar.
2. **`p_autoriza` sigue sin demostrar que se comprobó una clave.** El disparador solo mira que la persona
   esté activa y facultada (`0006:110`). Una ruta puede mandar como autorizador a alguien cuya clave
   nunca comprobó. *Propone:* o una acreditación emitida al verificar y consumida al escribir, o declarar
   que se confía en el servidor.
3. **La vista previa no queda ligada a lo que se autoriza.** La base recalcula la diferencia del conteo
   bajo el candado; la pantalla puede mostrar una y asentarse otra (10.3). *Propone:* hora absoluta fija
   desde la previa, y al ejecutar, rechazar si lo revisado cambió.

## Importantes

4. **Corregir un movimiento cuyo error ya absorbió un conteo descuenta dos veces.** Compra de 100, conteo
   de 90 (−10), corrección de la compra a 90 (otros −10): queda 80. *Propone:* rechazar la corrección si
   hubo un conteo posterior de los materiales afectados, y encaminar a un conteo nuevo.
5. **`revierte` y la función vieja necesitan política.** `corregir_material` mueve siempre la cantidad
   original. *Propone:* ajustes con `revierte=false`, contar también los históricos, y **retirar** la
   función vieja. «Corrección sobre corrección» es volver a corregir el mismo original, no un ajuste.
6. **`envio_resultado` no alcanza para los cuatro resultados:** una corrección produce varios movimientos
   o ninguno; hay que normalizar el contenido; el reintento va antes de las condiciones de una acción
   nueva; la clave no entra en el contenido.
7. **El conteo debe devolver su identificador desde la inserción**, no buscarse después.
8. **Carrera con el cierre cuando el conteo no produce movimiento:** nadie bloquea la jornada.
9. **Reglas de la autorización:** fallos, revocación entre comprobar y ejecutar, autorizarse a uno mismo
   (compatible: vuelve a teclear su clave).
10. **Validación:** el conteo y el objetivo de una corrección admiten cero; merma, origen y productos,
    no. Validar la estructura del JSON antes de convertirlo; productos repetidos; que la diferencia quepa.
11. **Pruebas:** faltan los cruces —mismo envío en dos sesiones, reintento tras otra corrección y tras
    cerrar, correcciones sucesivas, corrección antes y después de un conteo, fallo en el segundo asiento,
    conteo sin diferencia contra el cierre—, con barrera verificada.

## Menores

12. **Lecturas:** una sola consulta por respuesta; un ajuste en el material destino debe llevar al
    original; índice por `referencia_id`.
13. **Pantalla:** la función admite cambiar material y peso juntos y la pantalla obligaba a escoger uno.

## Lo que encontró correcto

Los ajustes referidos al original, con su fecha efectiva heredada, hacen que un conteo posterior a la
corrección no la descuente otra vez. Asentar en la jornada abierta no altera los cierres anteriores.
La corrección no toca comprobantes ni pagos. Los roles propuestos coinciden con los del núcleo.
