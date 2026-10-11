# Revisión de Codex al plan de la aplicación

**Revisor:** Codex, modelo `gpt-6-astra`, esfuerzo alto. **Fecha:** 1 de octubre de 2026.
**Objeto:** `docs/planes/2026-10-01-aplicacion-mostrador.md` en su primera versión, contrastado con
las 11 migraciones del núcleo, sus pruebas, la especificación y la revisión del prototipo con el personal.

Codex leyó todo y no ejecutó pruebas ni modificó archivos. Su veredicto: **«el plan es viable, pero
todavía no está listo para implementarse tal como está escrito»**. Los bloqueos están en la atribución
de identidad, el primer arranque y la autorización de vehículos de jornadas anteriores. Lo que sigue es
el informe condensado; las referencias son a archivo y línea del núcleo.

## Bloqueantes

1. **El vínculo entre la identidad acreditada y la persona que llega al núcleo no está cerrado.**
   Las funciones con `p_usuario` confían en el identificador que reciben. Guardar precios, abrir
   cuentas, capturar pesos, etiquetar y descartar son escrituras directas que no verifican rol
   (`0011:34`); `quitar_renglon` y `fijar_descuento` ni siquiera reciben persona (`0005:283`). «La base
   valida rol y facultad» no describe todas las acciones. *Propone:* matriz de autorización por acción
   aplicada en el servidor, también a las lecturas; derivar de la sesión `p_usuario`, `creada_por`,
   `tomada_por` y `feruga.usuario`, nunca del cuerpo de la petición; probar suplantación y llamadas
   directas de consulta, patio y administración.

2. **El primer arranque tiene dependencias circulares.** `alta_persona(..., autor)` exige un
   responsable que todavía no existe; el primer código de equipo necesita autor y el primer equipo
   necesita código; «sin cookie de equipo toda ruta responde 401» impediría la propia ruta de alta.
   *Propone:* arranque administrativo por consola dentro de Docker (migrar, crear el usuario de conexión
   limitado, crear la primera persona con su clave, emitir un código), repetible sin duplicar ni
   restablecer; enumerar las excepciones al requisito de equipo.

3. **`confirmar(..., autoriza?)` no corresponde a la firma real.** Solo existe
   `confirmar_operacion(uuid, bigint, int)`; para una jornada cerrada exige que el propio `p_usuario`
   sea responsable (`0007:34`). *Propone:* o se acredita al responsable en ese momento y confirma él,
   mostrando quién quedará registrado, o se amplía el núcleo con operador y autorizador separados. La
   autorización debe quedar ligada a esa cuenta y esa revisión.

## Importantes

4. **El bloqueo por intentos puede perder cuentas o deshacerse.** Leer-incrementar sin candado deja
   que varios intentos cuenten como uno; lanzar el rechazo dentro de la transacción revierte el
   incremento. *Propone:* bloquear la credencial al verificar, confirmar el intento antes de responder,
   separar la transacción de autenticación de la de negocio, canjear el código de equipo atómicamente.
5. **Cuatro dígitos y una cookie permanente piden más controles.** 10 000 combinaciones; bloquear
   cinco minutos solo frena. *Propone:* seis dígitos al menos para responsables, verificador con sal y
   costo, límites acumulativos, códigos con entropía, caducidad y uso único guardados por huella,
   respuesta uniforme para inexistente, inactiva o equivocada.
6. **«Tras un rato sin actividad» no define una sesión revocable.** Sellar la cookie no resuelve
   inactividad, baja de equipo o persona, cambio de clave ni dos pestañas con personas distintas.
   *Propone:* sesión con identificador y actividad en el servidor, duración inactiva y absoluta,
   comprobación en cada petición, rechazo de acciones preparadas bajo otra sesión.
7. **Falta protección ante peticiones de otro origen y condiciones de transporte.** *Propone:*
   mutaciones solo por métodos no seguros, comprobación de origen, cookies `HttpOnly`, `SameSite` y
   `Secure` con HTTPS; si el certificado queda fuera, puerto en loopback.
8. **Las migraciones nuevas necesitan sus propios permisos.** El `GRANT SELECT ON ALL TABLES` de 0011
   no alcanza a tablas futuras y la ejecución pública está revocada por omisión (`0011:18`).
9. **Falta concretar la unidad transaccional y el uso del pool.** Agregar material son tres
   inserciones, no una función. *Propone:* «una acción de negocio por transacción», un cliente reservado
   del pool de principio a fin, identidad con `set_config(..., true)` dentro de esa transacción, probar
   que una petición no hereda la persona de otra.
10. **Idempotencia parcial.** `abrirCuenta` recibe identificador; agregar material, segunda pesada e
    impresión no. *Propone:* identificadores por intención generados en el cliente, recuperar la
    respuesta en el reintento y rechazar el mismo identificador con contenido distinto.
11. **La revisión debe viajar con el contenido mostrado.** Varias consultas en `READ COMMITTED` pueden
    mezclar instantes; el auxiliar `confirmar` de las pruebas lee la revisión vigente y copiarlo anularía
    la protección (`apoyo.ts:162`). *Propone:* contenido y revisión en una sola consulta; ante `RC011`,
    refrescar y pedir nueva confirmación humana.
12. **Primeros precios y precios parciales.** La primera jornada nace con lista vacía (`0003:106`) y
    publicar exige al menos un precio, no todos (`0003:135`). *Propone:* editor construido desde el
    catálogo; mostrar materiales sin precio; no inventar en TypeScript la obligación de completarlos.
13. **Disponibilidad: aviso temprano contra rechazo definitivo.** La vista `disponible` existe
    (`0006:52`), pero agregar una pesada no produce `RC002`: eso ocurre al confirmar (`0006:115`).
14. **Faltan totales de borrador y un contrato numérico.** `suma`, `ajuste` y `total` son nulos hasta
    confirmar; `numeric(12,3)` puede redondear una entrada antes de que el disparador la vea. *Propone:*
    vista del núcleo para el resumen provisional; pesos como cadenas decimales validadas en su forma.
15. **El cierre confunde cuentas que bloquean con vehículos pendientes.** El núcleo permite cerrar con
    vehículos en espera (`0010:36`); `cuentas_pendientes` cuenta todo borrador (`0010:69`). *Propone:*
    separarlos, incluir en las cuentas abiertas los pendientes de jornadas anteriores, definir el «día»
    con la zona horaria, y un recorrido de dos jornadas.
16. **El navegador no certifica una impresión.** `afterprint` ocurre también al cancelar. *Propone:*
    registrar el intento antes de abrir el diálogo, con identificador idempotente, consecutivo por
    operación y motivo en reimpresiones; búsqueda por folio.
17. **«Pagar o cobrar» promete un estado que esta entrega no registra.** `estado_pago` nace pendiente y
    no hay vía para liquidarlo (`0005:20`, `0011:40`). *Propone:* presentar «a pagar / a cobrar» sin
    afirmar liquidación.
18. **Las pruebas de rutas sin servidor necesitan un adaptador explícito de cookies** y probar los
    encabezados de salida; agregar una prueba HTTP real desde la tarea 3.
19. **Separar construcción, migración y servicio** en contenedores; serializar migraciones; construir
    sin base ni secretos; secretos en ejecución.
20. **Un paquete no borra las diferencias entre Node, Next y Playwright:** configuraciones de tipos
    separadas, versiones exactas, imagen propia para el navegador.
21. **Las pruebas no cubren varias promesas.** Los cinco puntos de «qué vigilar» no tienen prueba
    asignada que los ejercite. Además, instalar `pgcrypto` en `public` rompe la guarda de `search_path`
    (`08-permisos.test.ts:149`).
22. **Operaciones cotidianas sin salida.** Faltan procedimientos de consola para altas posteriores,
    cambio de clave y bajas; pantallas de consulta y de patio sin definir. **Suposición que requiere
    decisión:** arrancar en cero impide vender el primer día material que ya está en el patio.
23. **El flujo validado perdió criterios al resumirse:** máximo de cuatro cuentas, recordar paso y
    material al cambiar de cuenta, distinguir la activa, pasar a la siguiente al terminar.

## Menor

24. **Orden de tareas:** el arranque de identidad aparece antes de la migración que lo sostiene; la
    primera comprobación desde vacío llega muy tarde; «una imagen» es ambiguo.

## Lo que encontró correcto

- Todas las lecturas y funciones de las tareas 4, 5 y 6 tienen permiso y firma reales, con las salvedades
  de autorización anteriores.
- **Descartar una cuenta con materiales sí está soportado** por la cascada y sus disparadores.
- Peso tecleado, flujo material → báscula → cuenta, aritmética en PostgreSQL, `READ COMMITTED`, revisión
  obligatoria y dominio probado con credenciales limitadas.

## Lo que no comprobó

No ejecutó pruebas, construcciones ni migraciones. No pudo verificar lo que aún no existe: adaptadores,
imágenes, migraciones nuevas, impresión física ni la computadora definitiva.
