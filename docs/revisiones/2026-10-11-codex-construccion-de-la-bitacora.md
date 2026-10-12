## Pasos
1. Crear informe y lista de pasos: hecho.
2. Inventariar parejas y detalle: hecho.
3. Escribir y correr pruebas de dominio en rojo: hecho; ERR_MODULE_NOT_FOUND de bitacora.ts.
4. Implementar dominio y pasar pruebas: hecho; 6/6.
5. Probar ruta en rojo e implementarla: hecho; rojo por módulo ausente, luego 8/8 en verde.
6. Cerrar informe: hecho.

## Parejas
abrir jornada → fecha → abrió el día.
publicar lista_precios → precios → publicó los precios.
confirmar operacion → folio, tipo, total; opcionales: excepcion, jornada_original → confirmó la compra 1 por $21.00.
apertura material → kg, origen → registró 1,000 kg de Cartón al arrancar.
cerrar_corte sucursal → sin detalle → cerró el inventario de arranque.
conteo material → contado, registrado, diferencia, contado_en, autoriza → contó 10 kg de Cartón.
ajuste material → kg, motivo, autoriza, referencia → ajustó 10 kg de Cartón: Corrección.
corregir_material movimiento_inventario → de, a, kg, motivo, autoriza → cambió 10 kg de Cartón a PET: Corrección.
merma material → kg, motivo → dio de baja 10 kg de Cartón: Mojado.
transformar transformacion → origen, kg, productos [{material, kg}], merma → separó 10 kg de Cartón (merma: 1 kg).
cerrar jornada → fecha, vehiculos_pendientes, cierre (desde 0024) → cerró el día.
descartar operacion → tipo, etiqueta, materiales, suma → descartó una compra sin confirmar.
bloquear credencial → equipo, hasta, bloqueos_seguidos → bloqueó temporalmente el acceso de Luis.
alta equipo → nombre → dio de alta el equipo Báscula.
clave credencial → sin detalle → cambió la clave de Luis.
baja usuario → sin detalle → dio de baja a Luis.
baja equipo → sin detalle → dio de baja el equipo Báscula.
reimprimir operacion → numero, motivo, folio → reimprimió el comprobante 1: Extraviado.
corregir movimiento_inventario → material, kg, motivo, autoriza, ajustes → corrigió un movimiento a 10 kg de Cartón: Corrección.
cancelar_envio envio → sin detalle → canceló un envío pendiente.
registrar_restauracion restauracion → respaldo_de, folio_antes, folio_despues → restauró un respaldo.
reabrir jornada → fecha, cierre, cerrada_en, cerrada_por, autoriza → reabrió el día (cierre 2).
precio_especial operacion → clase, evento, linea, material, cliente, cliente_nombre, lista, anterior, queda, autoriza (dar); deshace (quitar, sin queda ni autoriza) → aplicó un precio especial de $2.60 por kilo de Cartón a Don Chuy (autorizó Servando) / quitó el precio especial de Cartón a Don Chuy.
mantenimiento publicacion → paso, publicacion, motivo (cerrar), marca (abrir) → cerró el acceso por mantenimiento / preparó la reapertura después del mantenimiento / abrió el acceso después del mantenimiento.
insert usuario → antes=null, despues=fila completa → dio de alta a Luis.
update usuario → antes, despues (filas completas) → actualizó los datos de Luis.
delete usuario → antes=fila completa, despues=null → eliminó a Luis.
insert material → antes=null, despues=fila completa → dio de alta el material Cartón.
update material → antes, despues (filas completas) → actualizó el material Cartón.
delete material → antes=fila completa, despues=null → eliminó el material Cartón.

## Archivos
pruebas/39-bitacora.test.ts: 8 pruebas de dominio y ruta, incluida la guardia de migraciones.
src/servidor/dominio/bitacora.ts: consulta, validación y 30 parejas con frase.
src/app/api/bitacora/route.ts: GET dinámico; responsable y consulta.

## Pruebas
Comando: sh qa/prueba.sh pruebas/39-bitacora.test.ts

```text
✔ GUARDIA: toda pareja anotada en las migraciones tiene frase propia (14.176875ms)
✔ compra, merma y cierre salen recientes primero, con persona y hora del patio (112.10075ms)
✔ pagina sin repetir ni saltar; entrega 50 por omisión y limita a 200 (975.125583ms)
✔ filtra persona y día local, incluso juntos, y no expone detalle desconocido (72.329833ms)
✔ rechaza cursores, personas, cantidades y fechas mal formados (62.97825ms)
✔ las treinta parejas tienen frases completas y resuelven nombres sin revelar datos internos (109.133042ms)
✔ ruta: responsable y consulta leen, los otros roles reciben ROL y sin persona da 401 (756.491709ms)
✔ ruta: antes, persona o día inválidos devuelven 400 FORMA (354.663209ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

## Decisiones mías
Orden por id numérico descendente, igual que el cursor; día por ocurrido_en en la zona del patio, no por la fecha de la jornada.
Precio especial: «aplicó» identifica a usuario_id; «autorizó Nombre» identifica al autorizante, que puede ser otro.
Nombres de materiales, clientes y personas resueltos en SQL; números extraídos como texto y solo formateados, sin sumas en TypeScript.
Auditoría de catálogos: solo nombre de antes/despues; ningún objeto completo sale al consumidor.
Restauración y cancelación de envío quedan breves: el detalle no identifica una operación útil para el dueño; se omiten referencias técnicas.
Mantenimiento se cuenta por su paso; transformaciones por material de origen, kilos y merma, sin volcar productos.
Baja de equipo usa el nombre de su alta en bitácora, o lo omite si no hay alta.
Las seis parejas insert/update/delete × usuario/material se anotan con lower(TG_OP) y TG_TABLE_NAME; se nombrarán a mano en la guardia.

## Dudas o cosas raras que viste en el código existente
La ruta nueva requiere registrarse al integrar en pruebas/17-rutas.test.ts, como avisaste; ese archivo no se tocó.
0011 permite leer las tablas existentes entonces; equipo nace en 0013 sin SELECT para feruga_app (fallo 42501 comprobado). Su nombre se obtiene del alta en bitacora; sin alta se omite.

La copia no contiene repositorio Git; git status no pudo verificar el estado. Solo se escribieron los tres archivos nuevos autorizados y este informe.
