# Revisión de Codex al bloque de pantallas, con ejecución

**Revisor:** Codex, modelo `gpt-6-astra`, esfuerzo alto. **Fecha:** 2 de octubre de 2026.
**Objeto:** tareas 8 a 11 de la aplicación del mostrador: las pantallas y sus recorridos.

Ejecutó los 18 recorridos con el proyecto montado en solo lectura (**18 aprobados**) y seis
exploraciones propias en navegador, demorando o cortando respuestas, contra la aplicación aislada de
los recorridos. No modificó el proyecto ni reconstruyó imágenes.

## Bloqueantes (comprobados ejecutando)

1. **Cambiar de cuenta permite guardar el peso en otra.** `Mostrador.tsx:131`. Con Compra 1 en
   «12.5 sin enviar» y Compra 2 abierta, al volver a Compra 1 mientras su detalle tarda en llegar, la
   barra marca Compra 1, el encabezado dice Compra 2 y el visor muestra 12.5; «Agregar» lo guarda en
   **Compra 2**. `entrar()` cambia la cuenta activa de inmediato pero conserva el detalle de la anterior.
   *Propone:* cambiar selección, detalle y borrador juntos, e impedir envíos mientras no coincidan.
2. **Editar después de perder una respuesta duplica el material.** `Mostrador.tsx:168`. Se envían 30 kg,
   el servidor los guarda y la respuesta se pierde; al corregir el peso a 35, el envío nuevo lleva
   identificadores nuevos: la cuenta queda con **30 y 35 kg**. *Propone:* conservar el identificador y
   el contenido del envío de resultado desconocido, y resolverlo antes de dejar editar.

## Importantes (comprobados ejecutando)

3. **Cambiar de cuenta durante la segunda pesada rompe la pantalla** («This page couldn't load»): el
   peso pendiente apunta a un material de la otra cuenta. `Mostrador.tsx:437`.
4. **Un doble toque registra e imprime dos reimpresiones.** `Ticket.tsx:33`.
5. **El arranque interpreta «12,5» como 125 kilos**: la limpieza quita todas las comas.
   `arranque/page.tsx:21`. En precios la coma sí es decimal.
6. **En pantalla angosta las cuentas dejan de estar a la vista** al desplazarse: incumple la cuarta
   revisión del prototipo. El defecto venía del propio prototipo. `globals.css:75`.

## Menor

7. **Los recorridos no acreditan la ausencia de cruces durante una transición:** los 18 pasaban con los
   defectos presentes, porque esperan el estado final. *Propone:* respuestas demoradas, respuesta
   perdida tras confirmar, cambio durante la segunda pesada y doble toque; y afirmar el contenido de los
   envíos, no solo lo que se ve.

## Lo que encontró correcto

Con ejecución: límite de cuatro cuentas, selección única en estado estable, material → báscula →
cuenta, conservación de material y peso al cambiar de cuenta y al recargar, vehículo pendiente y
autorización, recuperación tras sesión vencida, restricciones de consulta y patio, precios con coma,
comprobantes y reimpresión ordinaria. Por lectura: las pantallas no calculan dinero; no quedan claves
en el almacenamiento del navegador.

## Lo que no comprobó

La matriz completa de `401 EQUIPO` y `409 PERSONA` a media acción, la recuperación del ticket cuando
falla el registro de la impresión, impresora física, lector de pantalla, contraste medido y teclado
físico. **Hipótesis:** dos corridas simultáneas de `recorrido` se estorbarían, porque comparten base.
