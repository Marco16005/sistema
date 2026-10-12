## Pasos
1. Informe: hecho.
2. Pruebas de recorrer y fallo inicial: hecho; C.1 falla sin recorrido (bitacora.ocurrido_en).
3. recorrer y columnas: hecho; C.1 pasa. Lista dinámica de columnas timestamptz de tablas reales.
4. Pruebas C.2–C.7 y fallo inicial: hecho; falla por ausencia de sembrarDemo.
5. Sembrado básico: hecho; C.1–C.7 en verde.
6. Mermas, conteos y precios especiales: no alcanzado.
7. Informe final: no alcanzado.

## Archivos
consola/demo.ts: recorrido transaccional.
pruebas/40-demo.test.ts: C.1.

## Pruebas
✔ C.1 recorrer conserva intervalos, deja lo anterior y restaura los disparadores (157.038791ms)
✔ C.2–C.5 jornadas, horas, panel, precios e inventario verosímiles (3702.378627ms)
✔ C.6 misma semilla, misma historia; otra semilla cambia los importes (7727.029545ms)
✔ C.7 rechaza fuera de desarrollo, parámetros inválidos y segunda corrida sin escribir (2665.10046ms)
✔ C.7 conserva el arranque, personas e id de la jornada del dueño (3202.322752ms)
✔ C.7 rechaza una jornada cerrada o varias jornadas sin movimiento (206.0615ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0

## Cuánto tarda
Pendiente.

## Decisiones mías
Hoy siempre quedará abierto y con precios; si es domingo, sin cuentas.
Se encontró un recorrer residual: se comprobó el fallo al retirar su acción, antes de restaurarla.

## Lo que no alcancé o me preocupa
Trabajo en curso.

---

## Cómo quedó (anotado por Claude, 11 de octubre de 2026)

**La corrida de Codex quedó incompleta.** Fueron dos. La primera se detuvo a preguntar qué hacer si
hoy es domingo y no construyó nada; se le contestó en el encargo (hoy siempre queda abierto y con
precios; si es domingo, sin cuentas). La segunda llegó hasta el paso 5 de 7 —`recorrer` y el
sembrado básico, con C.1 a C.7 en verde— y se cortó por cuota a media escritura del paso 6. El
archivo `consola/demo.ts` quedó con los parches del paso 6 aplicados a medias: importaciones y
variables declaradas dos veces, dos versiones del precio especial, y no compilaba. El informe de
arriba es el que alcanzó a guardar; su sección «Archivos» y «Cuánto tarda» no se actualizaron.

Lo que se hizo después, ya en el proyecto:

- Se reparó `consola/demo.ts` dejando una sola versión de cada cosa: quien autoriza lo inventado es
  siempre un responsable que el sembrador dio de alta (las claves que ya existen no se conocen ni
  se cambian), con un equipo de demostración propio. Se quitó la segunda prueba C.8, que repetía
  la primera. Con eso pasan los tipos y las 7 pruebas de `pruebas/40-demo.test.ts`, C.8 incluida.
- Se ensayó sobre una copia de la demostración del usuario: 48 días y 1,522 cuentas en 15 segundos.
  Funcionaba, pero no era creíble: se compraba el triple de lo que se vendía y quedaban más de un
  millón de pesos de cobre en el patio. Se cambió qué se compra y qué se vende: lo caro llega de a
  poco y lo barato por costales, y se vende por lotes lo que ya se juntó, primero lo que más vale.
  En el segundo ensayo: compras de $85 a $95 mil por semana, ventas de $90 a $120 mil, compra media
  de $463, y unos $52 mil de material en el patio.
- Se conectó a la consola (`demo sembrar`) y se corrió en la demostración del usuario, con una
  copia previa de su base (`demo-antes-de-sembrar.dump`, fuera del repositorio).

- Al ver las capturas salieron dos cosas más, y se corrigieron: los precios se publicaban con
  cuatro decimales («$88.4225 el kilo») y el cobre costaba menos que el bronce (los dos comparten
  familia, y el precio se decidía por el nombre de la familia). Ahora son redondos y de su orden.
  Y en una base nueva el saldo inicial era de más de mil kilos de cada material, también del cobre:
  ahora es del orden de un lote. La demostración del usuario se devolvió a su copia y se sembró
  otra vez con esto: 48 días y 1,617 cuentas.

**No lo revisó nadie más.** El sembrador solo corre en desarrollo y sobre una base sin movimiento,
así que no toca nada de operación; aun así, entra en la pasada de Codex que queda pendiente.
