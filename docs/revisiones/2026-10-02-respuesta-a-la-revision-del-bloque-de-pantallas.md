# Respuesta a la revisión de Codex al bloque de pantallas

Los siete hallazgos proceden. Cada uno se reproduce primero en un recorrido —con la respuesta
demorada o cortada, como lo hizo Codex— y después se corrige.

| # | Veredicto | Qué se hace |
|---|---|---|
| 1 | **Procede** | La pantalla trabaja siempre sobre la cuenta que **muestra**: el paso, el material y el peso salen de la cuenta cuyo detalle está en pantalla, no de la que se acaba de tocar. Mientras el detalle de la cuenta elegida no llega, la pantalla espera y no ofrece ninguna acción |
| 2 | **Procede** | Un envío del que no se supo el resultado queda guardado con su contenido, y mientras no se resuelva no se puede teclear otro peso: se reintenta el mismo, o al refrescar la cuenta se descubre que sí había entrado |
| 3 | **Procede** | La segunda pesada a medio teclear es de su cuenta, como el peso de la primera: se guarda por cuenta y sobrevive al cambio |
| 4 | **Procede** | Mientras se registra una impresión no se puede pedir otra, y el reintento usa el mismo identificador |
| 5 | **Procede** | En el arranque la coma es decimal, igual que en precios. Lo que no se entiende se rechaza en vez de limpiarse |
| 6 | **Procede** | En pantalla angosta las cuentas van en una tira que se queda arriba al desplazarse. Corrige también al prototipo |
| 7 | **Procede** | Recorridos nuevos con respuestas demoradas y cortadas, que afirman a qué cuenta y con qué contenido salió cada envío |

Queda anotado en el README que los recorridos corren de una batería a la vez.

## Lo que esto dice de las pruebas, otra vez

Es la misma lección del bloque de base, ahora en la pantalla: probé estados estables y los defectos
estaban en las transiciones. Un recorrido que espera a que todo se asiente antes de seguir no puede
ver lo que pasa mientras tanto. La regla para las pantallas de inventario: cada acción que escribe
tiene un recorrido con la respuesta demorada y otro con la respuesta perdida.
