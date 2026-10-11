# Respuesta a la séptima pasada de Codex: cierre del bloque de inventario (3 de octubre de 2026)

Informe: `2026-10-03-codex-septima-pasada-cierre-de-inventario.md`.

**Codex da el bloque de inventario por cerrado para pasar al despliegue.** Dio por corregidos los
tres puntos que lo impedían (el error del candado, el marco del mismo origen, la prueba de las dos
copias), no encontró defectos nuevos, y comprobó además que las cabeceras nuevas no rompen la
impresión del comprobante.

Dejó una observación menor, de cobertura, que se acepta.

Estado al cerrar: **535 pruebas y 106 recorridos en verde** (antes 535 y 104).

## Menor — la batería solo inducía un tipo de error del candado

**Aceptado.** Los dos recorridos de «no se puede saber si la pestaña es copia» corrían solo con
`SecurityError`. El caso fino es `AbortError`: es el mismo error que produce el plazo propio, y
llegando sin que el plazo haya vencido no puede tomarse por «es copia». Codex lo probó por su
cuenta y pasó; faltaba dejarlo en la batería.

**Corrección:** los dos recorridos corren ahora con los dos errores (copia, y recarga de la dueña,
con su recuperación posterior). Pasaron a la primera, como él había visto; se comprobaron por
mutación: tratando cualquier aborto como «es copia», fallan los dos de `AbortError` y pasan los
dos de `SecurityError`.

## Lo que queda anotado, sin cambio

Son los límites que el propio Codex dice que solo conviene anotar:

- Una copia que ya soltó la captura no la recibe después de la original: no hay transferencia.
- Sin candados (origen no seguro) no hay exclusividad garantizada. La operación va por HTTPS.
- El segundo de espera al recargar no tiene una cota garantizada por la especificación.
- No se probó: impresora física, «Duplicar pestaña» desde el menú, Ctrl+Shift+T, otros
  navegadores, fallos de `sessionStorage`.

Y su advertencia, que comparto: **cerrar el inventario no es aprobar la salida a operación.** Para
eso falta el despliegue, y en particular validar las pantallas de inventario con el personal.

## El bloque, en números

Siete pasadas de Codex entre el 2 y el 3 de octubre (una incompleta y otra no realizada, por
cuota, las dos repetidas después). El bloque empezó en 520 pruebas y 34 recorridos y cierra en 535
y 106. Lo que cambió de fondo respecto a lo que yo había entregado como terminado:

1. Un envío del que no se supo ya no se suelta por decisión de la pantalla: lo resuelve el
   servidor, cancelándolo o confirmando que entró.
2. Que algo quedó registrado solo lo dice la acción misma.
3. Lo que está a medias vive en una sola pestaña, y lo decide un candado, no un plazo.
4. «El conteo manda» usa el mismo límite con que el conteo arma lo que dice el libro.

Las tres primeras son la misma lección aplicada tres veces: la ausencia de una respuesta nunca
prueba nada.
