## Pasos
1. Crear el informe: hecho.
2. Escribir pruebas del dominio y registrar su falla: hecho.
   Falla observada: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/servidor/dominio/historial.ts' imported from /app/pruebas/38-historial.test.ts
3. Implementar el dominio y registrar el resultado: hecho.
   Corrida del dominio: tests 5, pass 5, fail 0.
4. Agregar pruebas de rutas, registrar su falla e implementar: hecho.
   Corrida roja: tests 7, pass 5, fail 2.
   Falla observada: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/app/api/historial/route.ts' imported from /app/pruebas/mundo.ts
   Corrida final: tests 7, pass 7, fail 0.
5. Cerrar el informe: hecho.
   No quedó trabajo solicitado sin alcanzar.

## Archivos
- pruebas/38-historial.test.ts
- src/servidor/dominio/historial.ts
- src/app/api/historial/route.ts
- src/app/api/historial/[jornada]/route.ts
- Informe: /tmp/feruga-codex-informe-12.md

## Pruebas
Última salida de `sh qa/prueba.sh pruebas/38-historial.test.ts`, tal cual:

```text
✔ los dos días salen del reciente al viejo y sus cuentas y totales coinciden con cada cierre (114.844458ms)
✔ un día sin cuentas tiene ceros y una cuenta sin confirmar no altera el historial ni el detalle (68.624875ms)
✔ el detalle ordena por folio numérico y trae hora del patio, tipo, total, renglones y quien confirmó (158.486ms)
✔ el vehículo terminado mañana aparece solo mañana aunque su jornada de llegada sea ayer (168.469167ms)
✔ el historial entrega 31 días por omisión y nunca más de 100 (58.683041ms)
✔ ambas rutas dejan leer a responsable y consulta, rechazan los otros roles y piden persona (638.048875ms)
✔ las rutas rechazan fechas e identificadores inválidos con FORMA y un día inexistente con NO_EXISTE (320.941917ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

## Decisiones mías
- Cantidades no enteras, no finitas o menores que 1 dan ErrorDeForma; las mayores que 100 se limitan a 100.
- La fecha se valida en el dominio, también para llamadas directas; se rechazan fechas imposibles y el año 0000.
- Se usa fila(): identificadores positivos de hasta 18 dígitos, siguiendo la convención existente.
- El detalle consulta las cuentas primero para validar el identificador antes de llamar al cierre.
- Cada función del dominio usa una consulta; los importes y las horas se resuelven en PostgreSQL.

## Dudas o cosas raras que viste en el código existente
- pruebas/17-rutas.test.ts exige registrar toda ruta nueva en MATRIZ: al integrar habrá que agregar ambas con responsable y consulta, y jornada a PARAMETROS. No se modificó ese archivo ni se corrió la batería completa.
