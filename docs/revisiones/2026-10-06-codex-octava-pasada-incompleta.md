# Octava pasada de Codex: incompleta por cuota (6 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución, sobre una copia en `/tmp/feruga-codex-qa8/`.
Se le pidió confirmar el arreglo de la marca de restauración (A7-C-I1), para cerrar la tarea 3 del
despliegue, y revisar las tareas 0 y 1 del rediseño. **Se quedó sin cuota a los tres minutos de
empezar** (lanzada a las 12:28; «You've hit your usage limit… try again at 4:12 PM»).

**Esta revisión no cuenta como hecha y hay que repetirla entera.** No hay veredicto de ninguna de
las dos partes. Su informe (`/tmp/feruga-codex-informe-8.md`) quedó en el encabezado, con las
tres casillas sin marcar.

## Lo que dicen sus registros, y no alcanzó a redactar

Una sola cosa, y es una pista, no una reproducción terminada. La dejó dicha así:

> Detecté un posible problema distinto del bypass anterior: retirar un objeto lo deja
> temporalmente «sobrando», lo que podría impedir retirar a continuación su secuencia. Preparé una
> reproducción con tablas `serial` e `identity` para comprobar si una migración legítima termina
> dejando la base sin emparejar.

Su batería completa iba «avanzando sin fallos» cuando se detuvo; no la terminó, y no cuenta.

## Lo que se hizo con esa pista

Se reprodujo antes de corregir, y **era cierta**. Una pista que sale de sus registros se trata
igual que un hallazgo redactado.

**El defecto.** Desde la corrección de A7-C-I1 la marca exige que las tablas y secuencias sean
exactamente las conocidas: ni una menos, ni una de más. Una migración que quita o recrea una
tabla lo dice con `vida_retirar('tabla')`, y esa función solo trabaja sobre una base emparejada.
Pero al retirar una tabla, la tabla sigue existiendo un momento —hasta el `DROP` que viene
después— y ya no está en la lista: queda «de más». Dos consecuencias:

- una tabla con secuencia propia (`serial`, `identity`): la tabla se retiraba, su secuencia no, y
  al borrar la tabla la secuencia se iba con ella y quedaba «faltando»: **base sin emparejar
  después de una migración legítima**;
- dos tablas retiradas en la misma migración: la segunda llamada encontraba «de más» a la primera
  y se negaba.

En los dos casos el resultado era el seguro —la aplicación deja de atender; no atiende de más—,
pero una migración correcta habría dejado el sistema parado hasta emparejar a mano.

**La prueba, primero.** `pruebas/22-restauracion.test.ts`, «una migración que quita tablas con
sus secuencias propias, o varias tablas, diciéndolo, deja la base emparejada». Falló como debía:
«una migración que retiró lo que quitaba dejó la base sin emparejar».

**La corrección** (`db/migraciones/0023_vida_de_las_tablas.sql`, que aún no se ha aplicado en
ningún servidor de verdad y por eso se corrige en su lugar):

- `vida_retirar` retira la tabla **y las secuencias de sus columnas**, de una vez;
- lleva la cuenta de lo ya retirado **dentro de la misma transacción** y, al comprobar que la
  base está emparejada antes de retirar lo siguiente, no cuenta eso como «de más»
  (`vida_coincide_salvo`). La cuenta vive solo lo que la transacción: fuera de ella no deja nada,
  y la comprobación que usan la aplicación y el migrador sigue siendo la estricta, sin excepción.

Las 21 pruebas de `22-restauracion` pasan. Comprobado por mutación: si retirar una tabla no se
lleva sus secuencias, la prueba nueva falla.

## Los contenedores que dejó

Al quedarse sin cuota no alcanzó a limpiar: quedaron arriba los de su copia
(`feruga_codex_qa8-db-1`, `-db_limpia-1`, `-almacen-1`). Se bajaron a mano, con su volumen. Los
del usuario (`feruga-web-1`, `feruga-db-1`) no se tocaron.

## Lo que queda para repetir

Todo lo que se le pidió, más lo que se construyó mientras tanto: la corrección de arriba; las
tareas 0 y 1 del rediseño; y la tarea 2 (la entrada, la barra, el interruptor de contraste y las
piezas botón e interruptor).
