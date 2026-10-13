# Caja y ganancia: lo que hay que preguntarle al negocio

> **Estado (12 de octubre de 2026):** son preguntas, no un plan. La especificación deja «resultado y
> caja» para después del inventario (control de caja, corte, gastos, costo promedio y margen) y trae
> dos huecos abiertos que tocan aquí: qué se hace hoy cuando algo ya pagado estaba mal (5.4) y con
> cuánto se abre el cajón (6). La entrevista de campo no habló del cajón, de gastos ni de fiado: de
> dinero solo dijo que se paga en pesos cerrados. Nada de lo que sigue se da por sabido.
>
> Cada pregunta dice para qué sirve y qué se haría si no hay preferencia. Con las respuestas se
> escribe el plan.

Hoy el sistema sabe cuánto **se debió** pagar y cobrar cada día (lo que suman los comprobantes), y
el panel enseña «ventas menos compras» aclarando que no es la ganancia. Le faltan dos cosas para
decir la verdad completa: **cuánto dinero hay de verdad en el cajón** y **cuánto costó lo que se
vendió**.

## El cajón

**1. ¿Con cuánto dinero se abre el cajón en la mañana, y de dónde sale?** ¿Se deja del día anterior,
lo trae el dueño, es siempre la misma cantidad?
*Para qué:* el corte del día es «con lo que abrí, más lo que cobré, menos lo que pagué, debería
haber tanto». Sin el fondo de la mañana no hay con qué comparar.
*Si no hay preferencia:* al abrir el día se teclea lo que hay en el cajón; el sistema propone lo
que quedó la noche anterior.

**2. Durante el día, ¿sale dinero del cajón para algo que no sea pagar material?** Gasolina, comida,
un mandado, dinero que el dueño se lleva o manda al banco. **¿Y entra dinero que no sea de una
venta?** Por ejemplo, cuando el cajón se queda corto para pagar y el dueño le mete efectivo.
¿Quién lo hace, y hoy se anota en algún lado?
*Para qué:* son las «entradas y salidas de caja». Si no se anotan, el corte nunca cuadra y no se
sabe si faltó dinero o solo se sacó para algo.
*Si no hay preferencia:* una pantalla con dos botones, «sacar del cajón» y «meter al cajón», con
cuánto y para qué; sacar pide la clave de un responsable.

**3. Al final del día, ¿se cuenta el cajón? ¿Quién lo cuenta?** Cuando sobra o falta, ¿qué se hace?
¿Cuánto es normal que falte o sobre?
*Para qué:* decide cómo es el corte. El redondeo a pesos ya está resuelto (cada comprobante dice lo
que se pagó en pesos cerrados), así que una diferencia ya no debería venir de los centavos.
*Si no hay preferencia:* quien cierra el día cuenta y teclea lo que hay; el sistema dice la
diferencia; el día se puede cerrar aunque no cuadre, y la diferencia queda anotada con quién contó.

**4. ¿Todo se paga y se cobra en efectivo?** Cuando se vende mucho —a una fundidora, a una bodega—,
¿pagan en efectivo ahí mismo, por transferencia, con cheque, o después?
*Para qué:* lo que no es efectivo no pasa por el cajón, y no debe contarse en el corte. Hoy el
sistema supone que todo es efectivo en el mostrador.
*Si no hay preferencia:* al cobrar una venta se dice «efectivo» o «transferencia»; las compras,
siempre efectivo.

**5. ¿Se fía o se adelanta?** ¿Hay clientes que se llevan material y pagan después? ¿Gente a la que
se le da dinero adelantado y luego trae el material? ¿Cuentas que se pagan en partes?
*Para qué:* si existe, hay que llevar quién debe cuánto, y eso cambia el alcance: es la etapa de
«crédito», que la especificación deja al final.
*Si no hay preferencia:* no se construye ahora; una cuenta se paga o se cobra completa al cerrarla.

## Cuando algo ya pagado estaba mal

**6. Hoy, cuando ya se pagó y se dan cuenta de que estaba mal —se pesó mal, se anotó otro material—,
¿qué hacen?** ¿Se regresa dinero? ¿Se recibe o se devuelve material? ¿Con qué frecuencia pasa?
*Para qué:* es la pregunta que la especificación dejó abierta (5.4). Hoy el sistema corrige el
inventario, pero no el dinero: un comprobante cobrado no se toca.
*Si no hay preferencia:* se corrige con otro movimiento que liquida solo la diferencia, con la clave
de un responsable; nunca se borra ni se vuelve a pagar completo.

## Los gastos

**7. ¿Qué gastos tiene el negocio, y de dónde se pagan?** Sueldos, renta, luz, fletes, gasolina,
mantenimiento. ¿Salen del cajón o de otro lado? **¿Quiere llevarlos en el sistema?**
*Para qué:* hay dos números distintos. Uno es lo que deja comprar y vender material (el margen).
Otro es lo que queda después de pagar todo lo demás (la utilidad). El primero sale solo de lo que
el sistema ya sabe; el segundo pide que alguien capture los gastos.
*Si no hay preferencia:* primero el margen; los gastos se agregan después, capturados a mano por
tipo, y solo los que el dueño quiera ver.

## Cuánto costó lo que se vendió

**8. ¿El material se vende como se compró, o se trabaja antes?** Se separa, se limpia, se quema el
cable, se compacta. Cuando de un material salen varios (lo mezclado se separa en cobre, aluminio y
basura), **¿cómo piensa el dueño lo que costó cada parte?**
*Para qué:* el sistema ya sabe separar material en kilos. Para la ganancia tiene que repartir
también lo que costó.
*Si no hay preferencia:* se reparte según lo que vale cada parte en la lista de compra de ese día, y
lo que salió de basura no se lleva costo: lo cargan las partes buenas.

**9. Lo que se echa a perder o se da de baja (mojado, tierra, basura), ¿se toma como pérdida del día
o se reparte en lo que queda?**
*Para qué:* cambia la ganancia de cada día y el valor de lo que hay en el patio.
*Si no hay preferencia:* es pérdida del día en que se da de baja, y se ve aparte en el reporte.

**10. Lo que ya había en el patio el día que se empiece a usar el sistema, ¿a qué costo se toma?**
*Para qué:* de eso no hay comprobante de compra, y la primera venta necesita un costo.
*Si no hay preferencia:* al precio de compra de la lista de ese primer día.

**11. ¿Cómo quiere ver la ganancia?** ¿Por día, por semana, por mes? ¿Por material? ¿Le interesa
saber cuánto dinero tiene «parado» en el patio?
*Para qué:* decide qué pantallas se hacen primero.
*Si no hay preferencia:* en el panel, por semana y por mes, por material, junto a lo que hay en el
patio valuado a lo que costó.

## Quién puede

**12. ¿Quién puede sacar dinero del cajón, quién cuenta el corte, y quién ve la ganancia?**
*Para qué:* son permisos. Hoy el mostrador cobra y cierra el día, y el panel lo ven el responsable
y quien consulta.
*Si no hay preferencia:* sacar del cajón, con la clave de un responsable; el corte lo cuenta quien
cierra el día; la ganancia la ven el responsable y quien consulta, no el mostrador ni el patio.

## Aparte, dos cosas que quedaron pendientes

**13. ¿Quiere saber de quién fue cada cuenta, o solo las de precio especial?** Hoy una cuenta queda
a nombre de un cliente solo cuando lleva precio especial. Llevar a todos los clientes pide que en
el mostrador se elija o se escriba el cliente en cada cuenta: son unos segundos más por cuenta, y
con mucha venta chica puede estorbar.
*Si no hay preferencia:* se queda como está; el nombre escrito a mano sigue siendo opcional.

**14. ¿El sistema tiene que ver con facturas o con Hacienda, o eso lo lleva el contador aparte?**
*Si no hay preferencia:* aparte. El sistema da los archivos para Excel y el contador trabaja con
ellos.

## Lo que sigue, con las respuestas

1. **El corte del cajón**: fondo de la mañana, entradas y salidas, conteo y diferencia. Es lo que
   más rápido se ve, y no depende de las preguntas 8 a 11.
2. **El costo y la ganancia**: costo promedio por material, margen por día y por material, y el
   patio valuado a lo que costó. Es lo que cambia el modelo de datos.
3. **Los gastos**, si el dueño los quiere.
4. Lo de antes del servidor de verdad: autenticar el respaldo antes de restaurarlo, la guía de
   operación, probar las pantallas en los equipos del patio, y contratar servidor y dominio.
