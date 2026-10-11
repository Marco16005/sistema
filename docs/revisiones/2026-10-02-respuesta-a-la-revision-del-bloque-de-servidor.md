# Respuesta a la revisión de Codex al bloque de servidor

Los siete hallazgos proceden. Cada uno con su prueba primero.

| # | Veredicto | Qué se hace |
|---|---|---|
| 1 | **Procede, y cambia cómo se autoriza** | La aplicación deja de llamar a `confirmar_operacion`. Recibe dos entradas: `confirmar_cuenta`, que **rechaza** una cuenta de jornada cerrada, y `terminar_vehiculo`, que recibe la clave del responsable y **la comprueba dentro de la misma función**, en la base. Ya no hay forma de terminar ese vehículo sin clave, ni desde una sesión de responsable ni por un descuido del servidor. La pantalla pide la clave siempre |
| 2 | **Procede** | El sello de la cookie se prepara antes de canjear el código: si la configuración no sirve, falla antes de gastar nada. La ruta de salud revisa también esa configuración |
| 3 | **Procede** | Si la cuenta ya no está, la respuesta es la regla «esa cuenta ya no está», no una falla interna |
| 4 | **Procede** | Los textos con carácter nulo se rechazan en la validación común |
| 5 | **Procede** | Repetir una impresión con otro motivo se rechaza |
| 6 | **Procede** | El catálogo sale de una sola consulta |
| 7 | **Procede** | «Dos arranques a la vez» pasa a barrera verificada. La matriz gana peticiones válidas donde importa, empezando por el responsable que intenta terminar un vehículo de otro día por la ruta ordinaria |

**Sobre el origen:** la aplicación en contenedor declara ahora sus orígenes de forma explícita
(`ORIGEN`). La comparación con `Host` queda solo para cuando no se configuró nada.

## La pieza nueva: la clave de quien autoriza se comprueba en la base

Hasta aquí, cuando una segunda persona autorizaba algo, el servidor comprobaba su clave en una
transacción y después llamaba a la función del núcleo con el identificador de esa persona. La base no
podía saber si la clave se había comprobado: confiaba en que el servidor lo hiciera bien.

Ahora la función de entrada recibe la clave y la comprueba ella misma, en la misma transacción en que
escribe. Si la clave no pasa, la función **no lanza error**: contesta que no, de modo que el intento
fallido queda contado; el servidor lo traduce a «la clave no pasó». Es la misma pieza que usará el
inventario para autorizar conteos y correcciones.
