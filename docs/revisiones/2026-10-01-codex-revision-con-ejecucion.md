# Revisión de Codex con ejecución

**Revisor:** Codex, modelo `gpt-6-astra`, esfuerzo alto. **Fecha:** 1 de octubre de 2026.
**Objeto:** el núcleo de datos tras corregir las cuatro hipótesis de la revisión anterior (220 pruebas).

A diferencia de la revisión anterior, esta vez Codex tuvo acceso a Docker y a la base: corrió la
batería en contenedores aislados y escribió sus propias reproducciones en bases desechables. No
modificó el proyecto.

## Lo que verificó

- **La batería completa:** 220 pruebas, 220 aprobadas.
- **Las cuatro correcciones anteriores, con reproducciones propias:** H1 rechaza con `RC006` y el saldo
  no cambia; H2 falla con `RC011`; H3 da diferencia 0 y conserva la merma; H4 rechaza con `RC004`.
- Concurrencia sobre publicación de precios, cierre del corte, doble confirmación, ventas, separación
  y corrección de material, reutilización de pesadas e inmutabilidad: **sin defecto reproducido**.

## Los cuatro defectos que encontró, ejecutados

| # | Qué pasaba | Su evidencia | Corrección |
|---|---|---|---|
| **1** | Dos conteos contabilizaban dos veces la misma diferencia. El conteo reconstruía lo que el libro decía en el momento contado, y dejaba fuera el ajuste de un conteo anterior, asentado después de ese momento | Apertura de 100 kg, se cuentan 110; dos capturas del conteo dejaban 120 kg. También con dos momentos distintos | Cada movimiento tiene un **momento efectivo**: una corrección vale desde lo que corrige y el ajuste de un conteo, desde que se contó. El conteo se guarda como registro propio, y uno más viejo que otro ya capturado se rechaza |
| **2** | Dos rutas normales de una cuenta podían quedar esperándose una a la otra: editar o quitar un renglón tomaba primero el renglón y luego la cuenta; asentar una pesada y confirmar, al revés | `40P01 deadlock detected` entre confirmar y borrar un renglón, y entre asentar una pesada y poner un descuento | **Un solo orden: primero la cuenta, después el renglón.** Cambiar o quitar un renglón pasa por funciones (`fijar_descuento`, `quitar_renglon`) que siguen ese orden; la aplicación ya no puede hacerlo con un UPDATE o DELETE directo |
| **3** | El conteo aceptaba fecha futura, fecha anterior al arranque y fecha vacía, y producía existencias falsas | Con 90 kg reales: fecha 2099 dejaba 100; fecha 1900, 200; sin fecha, 300 | El momento del conteo es obligatorio, no puede estar en el futuro y tiene que caer dentro de la jornada abierta |
| **4** | Cambiar la etiqueta de la cuenta no subía la revisión, así que se podía confirmar con una vista vieja | Revisión 3 antes y después del cambio; `confirmar_operacion(…, 3)` pasaba | Cambiar la etiqueta sube la revisión |

Al escribir la prueba del primero apareció un caso más de la misma familia, que no estaba en el
informe: **una corrección de captura hecha después de contar se corregía otra vez con el conteo.**
Lo cubre la misma solución del momento efectivo, y tiene su prueba.

## Lo que no clasificó como defecto

- El estado de pago no tiene función para cambiarse. Correcto: la caja está fuera del alcance del núcleo.
- La corrida con volúmenes nuevos no mostró impedimento de arranque. Advierte que eso no equivale a
  probar otra arquitectura de procesador.

## Estado tras la revisión

234 pruebas en verde, corridas dentro del contenedor.
