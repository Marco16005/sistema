# Revisión de Codex al código del núcleo de datos

**Revisor:** Codex, modelo `gpt-6-astra`, esfuerzo alto. **Fecha:** 1 de octubre de 2026.
**Objeto:** las migraciones `0001`–`0011` y las pruebas, ya terminadas (212 pruebas en verde al momento
de la revisión).

## Cómo se hizo, y su límite

**Codex no pudo ejecutar nada.** Su entorno le negó el acceso al motor de Docker y a la base de
datos, de modo que revisó leyendo el código. Entregó cuatro hipótesis, cada una con la secuencia que
la demostraría, y un script propio para comprobarlas.

Ese script no se corrió: ejecutar por él lo que su entorno le prohíbe no corresponde. Cada hipótesis
se tomó como lo que era —una sospecha fundada sobre el código— y se comprobó con una prueba propia,
escrita antes de tocar el código. **Las cuatro resultaron defectos reales.**

## Las cuatro hipótesis

| # | Hipótesis | Comprobación | Corrección |
|---|---|---|---|
| **H1** | Un movimiento puede entrar a una jornada después de cerrada: el disparador del libro miraba si la jornada estaba cerrada sin bloquearla | Prueba con dos sesiones: una cierra la jornada sin terminar su transacción, la otra registra una merma. **Falló**: la merma entraba | Asentar un movimiento bloquea su jornada contra el cierre. Quien llega tarde espera y, al releer, la encuentra cerrada |
| **H2** | Contar renglones y sumar importes no identifica la cuenta revisada: se puede cambiar 10 kg de cartón ($21) por 2.8 kg de PET ($21) y confirmar | Prueba con ese cambio exacto. **Falló**: se confirmaba el PET | Cada cuenta lleva una revisión que sube con cualquier cambio a sus renglones o pesadas. Confirmar exige la revisión que se tenía a la vista, y ya no es opcional |
| **H3** | Un conteo puede absorber una salida posterior: el movimiento tomaba como fecha el inicio de su transacción, que puede ser anterior al conteo aunque se asiente después | Prueba con una transacción abierta antes del conteo y una merma asentada después. **Falló**: el conteo daba +10 y borraba la merma | El momento de un movimiento es el de su asiento, tomado ya con el candado del patio. El orden de las fechas es el orden en que se escribió el libro |
| **H4** | Una tabla temporal llamada `instrumento` suplanta a la real en la validación de la pesada, porque esa función no fijaba dónde buscar sus tablas | Prueba con la conexión de la aplicación y una copia temporal con más capacidad. **Falló**: aceptaba 1 500 kg en una báscula de 300 | Todas las funciones del esquema fijan su ruta de búsqueda. Una prueba nueva recorre el catálogo de funciones y falla si alguna no lo hace |

## Sobre la respuesta a la revisión anterior

Codex señaló que tres puntos marcados como resueltos no lo estaban del todo, y tenía razón:

- **A2 / C7** («una jornada cerrada ya no recibe movimientos») — incompleto por H1.
- **A9** («confirmar lo que se vio») — incompleto por H2.
- **C3** («el conteo no pierde lo vendido después») — incompleto por H3.
- **A3** («`search_path` fijo») — incompleto por H4: estaba fijo en las funciones con permisos elevados,
  no en las que corren con los de quien llama.

## Pruebas que señaló como insuficientes

Las cuatro observaciones eran correctas y corresponden a los mismos casos: la prueba del conflicto
cambiaba a la vez el número y la suma; la del cierre empezaba con la jornada ya cerrada; la del
conteo no abría su transacción antes; la de permisos suplantaba `usuario` pero no `instrumento`.
Las cuatro se cubren con las pruebas nuevas.

Al escribir la prueba de H3 apareció además un defecto de las propias pruebas: el momento del conteo
viajaba como fecha de JavaScript, que conserva milisegundos, y las dos sesiones caían en el mismo.
Ahora viaja como texto con la precisión completa de la base.

## Estado tras la revisión

220 pruebas en verde, corridas dentro del contenedor.

## Pendiente

Para que Codex pueda ejecutar las pruebas y no solo leer, su entorno necesita acceso al motor de
Docker. Eso es una decisión de quien administra la máquina.
