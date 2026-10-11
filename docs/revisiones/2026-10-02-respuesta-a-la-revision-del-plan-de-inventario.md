# Respuesta a la revisión de Codex al plan de inventario

Los trece hallazgos proceden. El plan quedó reescrito (versión 2).

| # | Veredicto | Qué se hace |
|---|---|---|
| 1 | **Procede** | `corregir_movimiento` exige `READ COMMITTED`, toma el candado del patio y **después** lee. Calcula el objetivo por material con el signo del original, comprueba bajo el candado que toda salida alcance, y asienta solo las diferencias. Si algo no cabe, no queda nada: ni asientos, ni envío |
| 2 | **Procede, por la vía fuerte** | La clave de quien autoriza la comprueba **la propia función de entrada**, en la base, en la misma transacción en que escribe. Sin clave correcta no hay acción, haga lo que haga el servidor. Es la pieza que nació de la revisión del servidor |
| 3 | **Procede** | La vista previa devuelve la hora del conteo ya fija y lo que el libro decía entonces. Al ejecutar se manda lo que se vio; si la base calcula otra cosa, rechaza con `RC011` y hay que volver a ver y a autorizar. Para una corrección, lo que se vio es cuántas correcciones tenía ya ese movimiento |
| 4 | **Procede** | Si después del movimiento ya se contó alguno de los materiales que la corrección tocaría, se rechaza: el conteo ya puso la existencia donde va. Si algo no cuadra, se cuenta de nuevo. El conteo es la verdad más fuerte |
| 5 | **Procede** | Una sola forma de corregir. Las funciones viejas `corregir_material` y `registrar_ajuste` se eliminan; sus pruebas pasan a la nueva. Los ajustes nuevos referencian siempre al original |
| 6 | **Procede** | `envio_resultado` guarda, según la clase, el conteo, el movimiento, la separación, o el original y la lista de ajustes de una corrección (vacía si no hubo cambios). El contenido se normaliza; la clave no entra en él. El reintento se resuelve antes de cualquier condición de acción nueva, y antes de la clave |
| 7 | **Procede** | Una función interna asienta el conteo y devuelve el registro; `registrar_conteo` queda como envoltura para lo que ya la usa |
| 8 | **Procede** | El conteo bloquea la jornada antes de asentar, haya o no diferencia. Prueba en los dos órdenes |
| 9 | **Procede, por la vía de 2** | El fallo queda contado porque la función contesta «no» sin lanzar error. Quien autoriza puede ser quien atiende, tecleando su clave otra vez. La facultad se revisa en la función, también cuando no hay movimiento que asentar |
| 10 | **Procede** | Dos contratos de kilos: «cero o más» para lo contado y para el objetivo de una corrección; «más de cero» para merma, origen y productos. El JSON de productos se valida antes de convertirlo |
| 11 | **Procede** | Cada cruce de la lista es ahora un criterio de la tarea 1, con barrera verificada |
| 12 | **Procede** | Una consulta por respuesta. Los movimientos de un material incluyen los ajustes que llegaron de corregir otro, con el camino a su original. Índice por `referencia_id` |
| 13 | **Procede** | La corrección es una sola pantalla: «¿cómo debió quedar?», con el material y los kilos, y la opción de «no debió registrarse» |

## Lo que queda dicho, no resuelto

- **La atribución histórica.** Si un movimiento con el material equivocado ya quedó cubierto por un
  conteo, la existencia está bien pero el registro sigue diciendo el material equivocado. Se acepta.
- **El dinero.** Corregir el inventario no toca lo pagado. Codex lo marca como suposición: que hay un
  procedimiento fuera del sistema para las diferencias de dinero. Es la pregunta abierta 5.4 de la
  especificación y sigue abierta.
