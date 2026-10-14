# El recipiente en la báscula chica y el nombre de cada cuenta

**Pedido el 14 de octubre de 2026**, después de que el dueño revisó el sistema con su gente. Dos cosas, las
dos sin agregar pasos a quien no las usa: «que todo se mantenga lo más ágil posible, pero para no
perderse y poder identificar todo mucho más fácil».

## 1. El recipiente: costal, carretilla, cubeta

**Lo que pasaba.** En la báscula chica se tomaba lo que marcaba y nada más. Un costal de unos 200 g
sobre kilos de cobre de primera se pagaba como cobre; lo que llegaba en carretilla, igual. Corregirlo
después en el inventario es tarde: ya se pagó y ya entró al patio.

**Lo que se hizo.**

- Al pesar en una báscula chica, después de teclear lo que marca, aparece **«¿Viene en algo? Costal,
  carretilla…»**. Se toca, se teclea lo que pesa vacío el recipiente, y la pantalla dice al momento
  cuánto queda de material. Lo que marcó se puede corregir sin perder el recipiente (dos botones arriba
  del teclado: «Marcó…» y «Recipiente…»). «No viene en nada» lo quita.
- Si se olvidó o se tecleó mal, en la cuenta cada material de báscula chica tiene el botón
  **«Recipiente»**: se teclea el peso y se guarda; con cero se quita. Mientras la cuenta no se cobre.
- El recipiente **baja lo que se paga o se cobra y también lo que entra o sale del patio**: es la tara
  del renglón (`peso recibido = bruto − tara`). El inventario queda bien desde el principio. A diferencia
  del «descuento» (tierra, agua), que baja lo que se paga pero no lo que entra al patio y sigue sin
  pantalla.
- El ticket lo imprime: «Báscula 2 · marcó 15.6 kg» y «Recipiente: 0.4 kg», junto a los kilos que se pagan.
- En el Panel, «Para vigilar» dice en cuántos renglones se descontó recipiente y cuántos kilos pesaban,
  en compras y en ventas; y en «Quién atendió», los kilos de recipiente de las cuentas que cobró cada
  quien, como el descuento.

**Decisiones.**

| # | Decisión | Por qué |
|---|---|---|
| 1 | El peso del recipiente **se teclea cada vez**; no hay lista de recipientes con su peso | Lo pidió el dueño: cada costal y cada carretilla pesa distinto |
| 2 | Solo en la **báscula chica**. En la grande no se ofrece y la base lo rechaza | Ahí la tara es el vehículo vacío, y se mide con la segunda pesada |
| 3 | El recipiente tiene que pesar **menos que lo que marcó** la báscula | Un renglón sin material no existe; la base ya lo exigía (`peso_positivo`) |
| 4 | Lo pone **quien pesa** (mostrador, patio, responsable), no solo quien cobra | Es parte de pesar, igual que agregar el material |
| 5 | En el panel se le atribuye a **quien cobró** la cuenta | Lo vio en la cuenta antes de cobrarla; es como se atribuye el descuento |

**Cambia la especificación.** `ESPECIFICACION-TECNICA.md` dice en P7 «¿Taras conocidas? No se usan. Tara
en cero por omisión; sin catálogo de taras». Con esto la tara sí se usa en la báscula chica, tecleada,
y sigue sin catálogo. La especificación no se tocó: es documento del dueño.

**Dónde está.** `db/migraciones/0037_el_recipiente_en_la_bascula_chica.sql` (`poner_recipiente`, y
`agregar_material` con una octava entrada que vale cero si no se dice: lo que la llamaba con siete
sigue igual, y su envío se guarda como antes); `src/app/api/cuentas/[cuenta]/recipiente/route.ts`;
la pantalla en `src/componentes/mostrador/Mostrador.tsx` y el ticket en `Ticket.tsx`; el panel en
`src/servidor/dominio/panel.ts`.

## 2. El nombre de cada cuenta

**Lo que pasaba.** Con varias cuentas abiertas solo se veían «Compra 1», «Compra 2»… El sistema ya
guardaba un nombre por cuenta (`etiquetar_cuenta`, desde la 0012), pero no había pantalla para
cambiarlo.

**Lo que se hizo.** Al abrir una cuenta sigue saliendo «Compra 3» sin preguntar nada. Junto al nombre,
arriba de la cuenta, está **«Cambiar nombre»**: se escribe «Don Chuy» o «camioneta roja», hasta 40
letras, y así aparece en la lista de cuentas abiertas. Enter guarda, igual que el botón. Lo cambian
quienes atienden y quien dirige.

**No sale en el ticket del cliente**: es una nota para el mostrador. (El nombre del cliente sigue
saliendo en el ticket solo cuando la cuenta lleva precio especial, como antes.)

## Verificado

Pruebas nuevas: `pruebas/48-recipiente.test.ts` (11: lo que se paga y lo que entra al patio, en compra
y en venta; la báscula grande; valores raros; repetir el envío; corregirlo desde la cuenta; con
descuento; la cuenta de otro), el panel en `pruebas/37-panel.test.ts`, los permisos y las rutas
(`08`, `10`, `17`), y en el navegador `recorrido/recipiente.spec.ts` (5) y las medidas de patio de
`recorrido/mostrador-medidas.spec.ts` con el recipiente, su corrección y el nombre, en las tres
medidas de pantalla.

Las pruebas de la base y del panel se vieron fallar antes de escribir el código. Las del navegador se
escribieron después de la pantalla; para saber que sirven, se rompió a propósito el envío del
recipiente y el guardado del nombre, y fallaron tres de las cinco.

El 14 de octubre pasaron los tipos y las **1067 pruebas**, **226 recorridos en Chromium** (14 omitidos) y
**219 en WebKit** (15 omitidos). Después se acortó el renglón del recipiente en el ticket, y se
volvieron a correr el recipiente, el papel y las medidas del mostrador en los dos navegadores. Los
simulacros de operación y de publicación no se repitieron: no cambió nada de la operación, y la
migración 0037 se aplicó en la demostración del dueño, con sus datos, sin problema.

Aparte, una prueba de los guiones (`pruebas/36-guiones.test.ts`) falló una vez con `EPIPE`: el guion
terminaba antes de leer lo que se le escribía. Era de la prueba, no del guion; ya no truena por eso.
