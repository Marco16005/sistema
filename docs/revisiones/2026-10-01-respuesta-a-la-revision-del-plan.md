# Respuesta a la revisión de Codex al plan

Cada hallazgo se contrastó con el código que ya existía al llegar la revisión (tareas 1 a 4). Tres
veredictos posibles: **procede** (se corrige con prueba primero), **ya cubierto** (el código lo
resolvía y se agrega la prueba que lo demuestra si faltaba) y **diferido** (pertenece a un plan
posterior, con su razón).

| # | Veredicto | Qué se hace |
|---|---|---|
| A1 | **Procede** | El libro mayor exige `READ COMMITTED` y rechaza cualquier otro aislamiento con `RC010`. Con ese nivel, la suma se lee en una instrucción posterior al candado y ve lo ya confirmado |
| A2 | **Procede** | Era el hueco más serio. Cada edición de una cuenta bloquea la cuenta; abrir una cuenta bloquea la jornada contra su cierre; cargar apertura bloquea la sucursal contra el cierre del corte; cambiar un precio bloquea la lista contra su publicación. Todo relee el estado después del bloqueo |
| A3 | **Procede en parte** | Se cierra lo que es de la base: ejecución revocada a `PUBLIC`, auxiliares no expuestos, `search_path` fijo, esquema sin permiso de creación. **Diferido** lo que es de la aplicación: quién acredita a la persona. Queda escrito en el plan que la base valida atributos de una identidad que acredita el servidor |
| A4 | **Procede, por la vía de D1** | Se adopta un solo candado del patio para toda escritura al libro mayor. Sin varios candados no hay orden que cuidar ni interbloqueo posible entre materiales |
| A5 | **Procede** | Una pesada usada queda consumida para siempre aunque se quite el renglón; quitar una pesada suelta se rechaza; se prueban la inserción directa como confirmada, el traslado de un renglón a otra cuenta y el cambio de pago junto con otra columna |
| A6 | **Procede** | Guardas contra `TRUNCATE` en todas las tablas del núcleo; pruebas con el rol real de la aplicación, incluido `session_replication_role`. Se documenta que nada resiste al superusuario |
| A7 | **Ya cubierto** | Las tres columnas generadas salen de columnas base, no encadenadas. El renglón incompleto solo existe en borrador y la confirmación lo rechaza |
| A8 | **Ya cubierto** | El disparador corre antes de insertar y compara lo visible más el movimiento nuevo; la confirmación inserta renglón por renglón. Hay prueba con dos renglones del mismo material |
| A9 | **Procede** | `confirmar_operacion` recibe la revisión de la cuenta que el operador vio. Si la cuenta cambió, falla con `RC011` en vez de confirmar algo distinto. (La primera solución comparaba número de materiales y suma; la revisión del código mostró que no bastaba.) El registro de una operación completa en un solo envío pertenece al plan de operación sin conexión |
| A10 | **Procede en parte** | Cambio de material ya estaba prohibido; se prueba que la cuenta queda atada a la lista de su jornada aunque se mande otra. **Decisión de alcance:** el núcleo tiene un precio de compra y uno de venta de mostrador; la venta por volumen con precio pactado llega con el crédito |
| A11 | **Procede, por la vía de D2** | La merma deja de ser un dato que se recibe: se calcula como origen menos productos, así el encabezado no puede contradecir al libro. Cantidades positivas, al menos un producto, y saldo del origen comprobado |
| A12 | **Procede** | Tercera pesada, posición repetida y pesos iguales en doble pesaje, con prueba. El vencimiento solo se mira al asentar la pesada, así que descargar el camión no la invalida |
| A13 | **Procede** | `NaN` excluido de precios, pesos y cantidades. Las cantidades se normalizan a tres decimales una sola vez y la conservación se comprueba sobre lo almacenado. La especificación se alinea: precios a 4 decimales, importes a 2 |
| A14 | **Procede** | Tabla de códigos en `README.md`; las pruebas afirman códigos, no textos. Los errores nativos de Postgres (llave foránea, interbloqueo) no se traducen |
| B | **Procede** | Todas las pruebas listadas que caen en el núcleo se agregan a su tarea. El límite de cuatro cuentas se queda como regla de la pantalla, no de la base: cuando capturen las tabletas el número será otro |
| C1 | **Procede** | Contradicción real. Una cuenta con vehículo pendiente sobrevive al cierre de su jornada. Al día siguiente la termina un responsable, con el precio original; sus movimientos caen en la jornada en que se confirma, de modo que el cierre anterior no cambia |
| C2 | **Procede** | Función `corregir_material`: resta de uno y suma al otro en una sola transacción, ambos con referencia al movimiento original |
| C3 | **Procede** | Función `registrar_conteo`: recibe lo contado, calcula la diferencia bajo el candado y la asienta |
| C4 | **Procede** | La regla es «sin existencia suficiente se rechaza», no «hasta que haya conteo». Se prueban las dos vías válidas |
| C5 | **Ya cubierto** | Un renglón de báscula grande es de un solo material; los usuarios confirmaron que la carga revuelta se pesa en mostrador |
| C6 | **Pregunta abierta** | Falta saber con qué material del catálogo se compra una mezcla. Se le pregunta al responsable |
| C7 | **Procede** | Todo movimiento que no sea apertura exige una jornada abierta y queda en ella. Una jornada cerrada ya no recibe movimientos |
| C8 | **Ya cubierto** | `total` es lo que debe liquidarse; `estado_pago` es aparte y el núcleo no afirma ningún desembolso |
| C9 | **Procede** | Documentos alineados: 27 materiales, seis familias de navegación |
| D1 | **Se adopta** | Un candado del patio |
| D2 | **Se adopta** | Sin disparador diferido: la transformación se valida y se escribe dentro de su función |
| D3 | **Se adopta** | La prueba se llama por lo que demuestra: los datos del comprobante coinciden con un recálculo independiente |
| E1 | **Procede** | Pruebas de permisos con una conexión real del rol de la aplicación |
| E2, E3 | **Procede** | La restauración se prueba en un segundo servidor vacío, reconstruyendo antes los roles, y con auditoría posterior: saldos, vínculos, disparadores activos y permisos |
| E4 | **Procede** | Cliente 17 dentro del contenedor; la prueba comprueba la versión |
| E5 | **Procede** | Las pruebas concurrentes verifican en `pg_stat_activity` que la segunda sesión está esperando, en lugar de dormir un tiempo fijo |
| E6 | **Procede** | Zona horaria explícita en los contenedores; las pruebas ya corren de una en una y propagan su código de salida |
