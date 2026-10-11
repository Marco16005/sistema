> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-10d.md`. **Quedó incompleto:** a los cinco minutos se le acabó la
> cuota («You've hit your usage limit… try again at 4:55 PM»; es el límite de cada cinco horas,
> no el semanal). Terminó los puntos 1 a 7 y dejó un hallazgo del 8; **faltan el resto del punto
> 8 (restaurar del diario), el 9 (las seis precisiones del diseño) y el 10 (el veredicto)**. Esos
> tres no cuentan como revisados: se le piden al volver la cuota, retomando la misma conversación.
> En sus registros no quedó ninguna pista más que lo que está aquí.
> Es la parte D de la décima pasada (A precio especial; B publicar: la lógica; C publicar: los
> guiones; D respaldo diario; E rediseño). La parte E no alcanzó a empezar.
> Lo que se hizo con cada hallazgo está en `2026-10-07-respuesta-a-la-decima-revision.md`.

# Décima pasada de calidad, parte D — el respaldo diario — 2026-10-07 (incompleta)

1. Cuál es el diario de un día.

### [importante] Se fija un candidato dañado antes de comprobarlo y se pierde un día recuperable
Dónde: operacion/diario.ts:169, operacion/diario.ts:187, operacion/diario.ts:225
Escenario: primer par con manifiesto válido pero archivo alterado del mismo tamaño; segundo par íntegro ese día → se fija el primero, falla su huella y se escribe un hueco permanente, sin intentar el segundo.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 1` → `P1_DANADO: eligió el archivo dañado; hueco=2026-10-06; segundo bueno sin subir`.
Corrección sugerida: comprobar archivo y manifiesto antes de persistir una elección nueva; saltar candidatos realmente dañados. Una elección ya persistida sí debe permanecer fija.

### [importante] Los nombres antiguos pueden elegir la segunda instantánea del mismo segundo
Dónde: operacion/diario.ts:169, operacion/destino.ts:157
Escenario: dos nombres antiguos sin milisegundos, instantáneas .900 y .100; UUID menor en .900 → se elige .900 aunque .100 es el primero bueno.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 1` → `P1_ANTIGUO: elegido=13:00:00.900Z; primero bueno=13:00:00.100Z`.
Corrección sugerida: ordenar ese grupo por la instantánea validada del manifiesto, como ya hace ultimoUtilizable; fijar un desempate explícito para instantáneas iguales.

1. Fechas: la misma sonda rechaza nombre/manifiesto de días distintos y conserva el día en la hora repetida del cambio de horario. Lectura: medianoche se agrupa en zona del patio; instantáneas idénticas desempatan por objeto. Un reloj que retrocede después de fijar la elección no la cambia (prima «se elige una vez»).
2. Elección persistente y única. La respuesta perdida al escribir la elección conserva el elegido al reiniciar; una elección truncada produce error explícito (`sh qa/node.sh qa/sonda-10d.ts 2`, `P2_PERSISTENCIA`).

### [bloqueante] Perder la conexión del turno permite dos diarios y sobrescribir la elección
Dónde: operacion/respaldar.ts:289, operacion/respaldar.ts:300, operacion/respaldar.ts:184
Escenario: primera puesta al día lista origen y diario vacío y queda detenida; se termina su sesión del candado en una base desechable; aparece un respaldo anterior (p. ej., reloj atrasado); segunda puesta al día lo elige y termina; la primera continúa con su lista vieja, sobrescribe la elección y sube el otro. Ambas declaran éxito.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 2` → `P2_TURNO_PERDIDO: muere sesión PostgreSQL; ambas corridas terminan bien; diarios del mismo día=2`.
Corrección sugerida: cancelar el trabajo al perder la sesión y proteger la elección contra escrituras concurrentes con creación condicional en el depósito; releer la elección ganadora. Un candado perdido no debe permitir seguir publicando.
3. No acepto comprobar solo por arranque sin un plazo máximo de revalidación.

### [importante] La caché puede ocultar corrupción hasta perder el origen, y después ni el reinicio la descubre
Dónde: operacion/diario.ts:146, operacion/diario.ts:148
Escenario: diario comprobado; se sustituye su archivo por otros bytes del mismo tamaño; servicio vivo hasta vencer los 30 días → ninguna alerta. Al vencer el origen, el recorrido comienza en un día posterior: ni reiniciar revisa ya aquel diario.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 3` → `P3_CORRUPCION: cambio del mismo tamaño no se detecta antes de 30 días; reinicio posterior tampoco revisa ese día`.
Corrección sugerida: revalidación periódica con fecha límite anterior al vencimiento del origen; auditar también los diarios fuera de la ventana de 30 días. El arranque no debe ser el único disparador.
4. Hueco permanente y aviso único.

### [importante] Un hueco erróneo o ilegible bloquea para siempre la recuperación del día
Dónde: operacion/diario.ts:150, operacion/diario.ts:178
Escenario: reloj adelantado al día siguiente; el día real todavía no tiene respaldo → se escribe hueco. Se corrige el reloj y llega un par bueno → nunca se sube. Además, basta la existencia de un archivo de hueco, incluso JSON truncado, para omitir también un diario íntegro y su comprobación.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 4` → `P4_RELOJ: reloj adelantado marca hueco del día abierto; al corregirlo ignora su respaldo bueno para siempre` y `P4_MARCADOR: hueco con JSON truncado tapa un diario íntegro sin comprobarlo ni avisar`.
Corrección sugerida: validar el marcador, separar «aviso pendiente/emitido» de «no reintentar» y permitir resolver un hueco con evidencia nueva respetando la elección existente. Antes de declarar cerrado un día, comprobar coherencia temporal.

4. Lista parcial: la misma sonda inyecta una lista exitosa que omite un par y reproduce el hueco permanente; no demuestra que rclone produzca esa omisión. Lectura: rclone con salida distinta de cero falla antes de entregar la lista; un error ordinario de red no se interpreta como lista vacía.
5. Fallos parciales y reintentos. La sonda confirma que archivo sin manifiesto no cuenta y el reintento completa el mismo par. Lectura: manifiesto sin archivo tampoco entra en respaldosEntre; fallos de subir/bajar se propagan sin marcar hueco.

### [importante] Una elección pendiente desaparece del seguimiento cuando vence todo su día de origen
Dónde: operacion/diario.ts:118, operacion/diario.ts:146
Escenario: elección persistida, subida no terminada; servicio regresa después de vencer todos los respaldos horarios de aquel día → el recorrido empieza en un día más reciente y declara éxito, sin informar que el elegido ya no está.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 5` → `P5_ELEGIDO_VENCIDO: elección pendiente del 6 de octubre; vence todo su origen; 7 de noviembre declara éxito sin avisar el hueco`.
Corrección sugerida: incluir elecciones pendientes del depósito diario en los días por revisar, incluso sin respaldos horarios; resolverlas como diario comprobado o hueco avisado.

### [importante] Un día con error permanente impide respaldar todos los posteriores
Dónde: operacion/diario.ts:164, operacion/diario.ts:229
Escenario: elección vieja ilegible (también sirve un permiso denegado específico de un objeto); hay un día posterior sano → cada corrida aborta en el viejo y nunca intenta el nuevo, mientras el viejo permanezca en la ventana.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 5` → `P5_BLOQUEO: elección vieja ilegible impide procesar días posteriores sanos en todos los reintentos`.
Corrección sugerida: aislar errores por día y reunirlos al final; conservar la elección fallida y su alerta, pero procesar los días independientes.
6. Turno: ambos caminos toman el mismo candado y lo conservan durante el diario; la pérdida de sesión rompe esa garantía (hallazgo del punto 2).

### [importante] La puesta al día puede consumir varias horas y retrasar los respaldos horarios
Dónde: operacion/respaldar.ts:334, operacion/respaldar.ts:269, operacion/destino.ts:49
Escenario: arranque a las 07:00 con tres diarios por verificar; cada descarga tarda 29 minutos, dentro del plazo individual de 30 → el primer respaldo horario empieza a las 08:27. No hay presupuesto global y el diario retiene además el turno contra corridas manuales.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 6` → `P6_PLAZO_SIMULADO: arranca 07:00; tres descargas de 29 min cada una; primer respaldo horario empieza 08:27`. Se avanzó un reloj simulado; no se esperaron 87 minutos reales.
Corrección sugerida: limitar el trabajo diario por corrida con plazo global cancelable y progreso persistente; priorizar la instantánea horaria ya debida y liberar el turno a tiempo.
7. Avisos y secretos. Lectura: el éxito horario se envía antes del diario y sus errores se capturan aparte; al vigilante diario se envían fechas o un fallo genérico, sin detalles del depósito.

### [importante] El aviso único se consume aunque nadie lo haya recibido
Dónde: operacion/diario.ts:132, operacion/diario.ts:150, operacion/respaldar.ts:133
Escenario: se guarda el hueco; falla la petición de aviso; siguiente corrida ve el marcador, omite el hueco y envía éxito. Si ocurre entre dos señales puntuales, el vigilante puede no alertar nunca. También hay una ventana de muerte entre guardar el marcador y notificar.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 7` → `P7_AVISO_PERDIDO: falla entrega del único aviso de hueco; siguiente corrida avisa bien sin reenviarlo`.
Corrección sugerida: guardar aviso pendiente y confirmar entrega por separado; reenviar hasta confirmación. Preferir posible duplicado a perder el único aviso.

### [importante] La señal diaria puede coincidir con la horaria pese a pasar la validación
Dónde: src/servidor/entorno.ts:115, operacion/respaldar.ts:53
Escenario: RESPALDO_VIGIA_URL=https://vigia.invalid/ping/TEST y RESPALDO_VIGIA_DIARIO_URL igual con / final → entorno válido; vigiaHttp elimina la diagonal y el fallo diario apaga el éxito horario en la misma señal.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 7` → `P7_SENAL_COMPARTIDA: entorno acepta URLs que solo difieren en / final; vigiaHttp las convierte en la misma señal` (fetch interceptado, sin peticiones externas).
Corrección sugerida: comparar URLs normalizadas con las mismas reglas utilizadas al enviar; exigir identificadores de señal distintos.

### [menor] Una URL del vigilante con contraseña aceptada se imprime completa al fallar
Dónde: src/servidor/entorno.ts:114, operacion/respaldar.ts:135
Escenario: configurar https://usuario:contraseña@vigia/ping/id, permitido por el validador → fetch rechaza las credenciales y su mensaje, copiado al registro, incluye la contraseña.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 7` → `P7_SECRETO: error de fetch copia contraseña sintética de URL del vigilante al registro local` y `P7_URL_CON_CLAVE: validación de entorno acepta credenciales en la URL`. Solo datos sintéticos.
Corrección sugerida: rechazar userinfo al validar y registrar un error saneado, sin repetir la URL ni sus secretos.
8. Restauración y credenciales: revisión en curso.

### [importante] Dos alias hacia el mismo depósito burlan la separación de retenciones
Dónde: src/servidor/entorno.ts:98, src/servidor/entorno.ts:104
Escenario: hora:cubo-hora/p y diario:cubo-hora/p, ambos remotos S3 del mismo proveedor/endpoint → se comparan «hora:cubo-hora» y «diario:cubo-hora», se aceptan distintos aunque sean el mismo depósito físico. Si retiene 30 días, el diario no queda protegido un año.
Confirmado con: `sh qa/node.sh qa/sonda-10d.ts 7` → `P8_MISMO_CUBO: dos alias rclone al mismo cubo se aceptan como depósitos distintos`. Confirma el validador; no se cambió ningún depósito real.
Corrección sugerida: comparar identidad física del depósito (proveedor/endpoint y cubo), independiente del alias; verificar retenciones efectivas al aprovisionar.
9. Pendiente: aceptación de las seis precisiones.
10. Pendiente: veredicto y orden de correcciones.
