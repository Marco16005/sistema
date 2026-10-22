# Codex revisa: la caja y la ganancia (0038 a 0042, su servidor y sus pantallas) — corrida incompleta

> **21 de octubre de 2026.** Revisión de calidad de Codex (`gpt-6-astra`, esfuerzo alto), en su copia.
> **Se cortó por cuota** en la parte 7 de 8 (las pantallas): no alcanzó a revisar la demostración
> (parte 8) ni a escribir su resumen. Diez hallazgos demostrados (H1 a H10) y una sospecha; abajo,
> tal cual. Lo que se hizo con cada uno está en
> `2026-10-21-respuesta-a-la-revision-de-caja-y-ganancia.md`. Sus pruebas quedaron en su copia
> (`pruebas/90-revision-*.test.ts`). Encargo: `encargo-31` (al final).

# Revisión de calidad: caja y ganancia

Estado: iniciada. Revisión de una sola pasada, en el orden solicitado. Copia de trabajo: `/tmp/feruga-codex-qa14`. No se modifica la aplicación ni se ejecuta la batería completa.

## Hallazgos demostrados

Pendientes de revisión.

## Sospechas pendientes de demostrar

Ninguna por ahora.

## Cobertura

Pendiente: partes 1 a 8. Se actualizará este informe al terminar cada parte. Las verificaciones estáticas se distinguirán de las pruebas ejecutadas.

## Parte 1 — dinero del cajón

Revisión estática de 0038, 0040, 0041, 0042, `caja.ts` y `cierre.ts`. La fórmula vigente agrega apertura, cuentas confirmadas en efectivo, meter/sacar, diferencias de corrección liquidadas en efectivo y abonos en efectivo; descuenta los retiros de todos los cortes previos. Transferencia, crédito y corrección pendiente no agregan efectivo. El gasto del cajón se representa únicamente por su «sacar»: clasificar, anular y reclasificar no lo duplican ni devuelven dinero (decisión expresa del plan).

Prueba propia `pruebas/90-revision-caja-ganancia.test.ts`, caso `QA1`: mezcla todas esas fuentes, compara servidor y SQL, cierra, reabre, vuelve a cerrar y verifica el arrastre a la apertura siguiente y su aviso. Resultado financiero: esperado=856, corte1=856, reabierto=100, corte2=120, apertura anterior=80, aviso=-1. Salida conservada en `qa/revision-31-QA1.log`. La primera ejecución llegó al segundo corte correctamente, pero falló por intentar mover la fecha de una jornada cerrada en la preparación de la prueba; se corrigió únicamente la prueba para crear la jornada siguiente por la entrada administrativa.

Sin hallazgos de doble contabilización en esta combinación. Con jornada cerrada, `estadoDelCajon.esperado` es deliberadamente null y se muestra el corte guardado; SQL `esperado_en_cajon` ya descuenta el retiro de ese corte y representa el saldo posterior, por lo que no debe compararse directamente con el esperado previo al retiro. Si el primer corte tuvo diferencia, al reabrir esta se conserva: el plan pide restar lo retirado, no borrar el faltante/sobrante.

Pendiente: partes 2 a 8.

## Parte 2 — concurrencia

### H1 — Media — candados invertidos: vehículo contra corrección (demostrado)

**Dónde:** `db/migraciones/0038_el_cajon.sql:249` (`terminar_vehiculo`, clave antes de confirmar/inventario); `db/migraciones/0040_corregir_una_cuenta_cobrada.sql:99` y `:153` (patio antes de clave); `db/migraciones/0035_intentos_que_no_se_deshacen.sql:146` (candado de credencial). `cobrar_a_credito` también usa patio antes de clave (0041:237 y :247).

**Reproducción:** `sh qa/prueba.sh pruebas/90-revision-caja-ganancia.test.ts QA2b`. Se deja un vehículo de ayer listo para terminar hoy y una compra corregible; misma firma. La conexión B toma exactamente el prefijo de candados de la corrección (jornada compartida, patio), A entra por `terminar_vehiculo` y queda esperando patio tras tomar credencial; B entra por `corregir_cuenta` y espera credencial. El prefijo se toma con conexión administrativa exclusivamente para detener de forma determinista esa intercalación en la base desechable; las dos funciones son las originales. **Salida:** `QA2b: terminar=40P01; corregir=pasó` (`qa/revision-31-QA2b.log`). No se demostró pérdida de datos: PostgreSQL deshace una operación, pero un cobro válido falla al usuario.

**Arreglo propuesto:** unificar el orden jornada → patio → credencial en todas las entradas que combinan esos recursos, incluida `terminar_vehiculo`; comprobar que las rutas antiguas de inventario usan el mismo orden. Reintentar automáticamente un deadlock puede ayudar, pero no sustituye arreglar el orden.

### H2 — Media — el resumen puede combinar jornada abierta con cajón cerrado (demostrado)

**Dónde:** `src/servidor/dominio/cierre.ts:75` y `:103`. Se lee primero el cierre y, en otra consulta independiente, `estadoDelCajon`.

**Reproducción:** caso `QA2c`, cierre real entre ambas lecturas del dominio mediante un adaptador `Bd.leer`. **Salida:** `jornada.abierta=true; cajon.jornada.abierta=false` (`qa/revision-31-QA2c.log`). El JSON puede llevar cero cierres fuera y un corte dentro, así como totales de operaciones anteriores a los del cajón. No es un corte mal guardado, sino una respuesta incoherente al consultar concurrentemente.

**Arreglo propuesto:** obtener todo el resumen de una misma instantánea (preferentemente una sola consulta; alternativamente transacción de lectura REPEATABLE READ compartida por ambas consultas). No basta envolverlo en READ COMMITTED.

**Sin hallazgo en los cruces ejecutados:** caso `QA2a`, corrección/abono/gasto nuevo/anulación contra corte, en los dos órdenes: ocho intercalaciones reales, todas correctas. Cada cambio primero queda incluido; si el corte llegó antes, recibe RC006 y no entra a la jornada cerrada. Salida en `qa/revision-31-QA2a.log`. Movimiento y confirmación tienen el mismo candado de jornada; además se inspeccionaron sus pruebas existentes en 49, sin ejecutarlas aún. Clasificar un sacar antiguo después del cierre es permitido expresamente por el diseño de gastos retrospectivos y no cambia efectivo.

Parte 1: QA1 terminó con 1 prueba aprobada, 0 fallidas tras arreglar la preparación. Partes pendientes: 3 a 8.

## Parte 3 — permisos

Se inspeccionaron todas las rutas solicitadas y la puerta común `src/servidor/ruta.ts`: la persona procede de la sesión, no del cuerpo; escritura exige origen, equipo, sesión, rol y `x-persona`. Matriz observada:

| Entrada | Lectura | Escritura |
|---|---|---|
| Caja | mostrador, responsable, consulta | mostrador/responsable; sacar/meter con clave de responsable |
| Avisos | responsable, consulta | visto: responsable |
| Cerrar | — | mostrador/responsable; firma de responsable o mostrador con permiso y clave |
| Confirmar / terminar vehículo / fiar | — | mostrador/responsable; vehículo con clave de responsable, fiado con responsable facultado |
| Correcciones | mostrador, responsable, consulta | mostrador/responsable y clave de persona facultada (la restricción de usuario limita esa facultad a responsable) |
| Fiado / abonos | mostrador, responsable, consulta | abono: mostrador/responsable |
| Gastos y tipos | responsable, consulta | responsable; sin otra clave, excepción expresa del plan |
| Ganancia | responsable, consulta | — |
| Permiso de corte | — | responsable facultado, con su propia clave |

No se encontró una ruta de escritura que conceda a un rol más que la función de base correspondiente. El renglón de una corrección se comprueba contra la cuenta de la URL. Las claves se comprueban dentro de la función que escribe; el dominio deja confirmar la transacción que devuelve NULL y solo después la ruta convierte el resultado en error CLAVE, conservando el intento.

**Ejecutado:** selección de 49 (`clave mala|permiso:|libros inmutables|concurrencia:|ordinaria en curso`): 9 aprobadas; caso de facultad/roles/clave mala de 51: 1 aprobada; caso de clave mala/roles de 53: 1 aprobada. Logs `qa/revision-31-permisos-{caja,correccion,fiado}.log`. Se comprobó además que la aplicación no puede cerrar por la firma antigua sin corte ni modificar los libros. Estas pruebas también completan los cruces de mover y confirmar contra corte de la parte 2. No se ejecutó una matriz HTTP de sesiones reales para cada ruta: su cobertura aquí es estática.

Pendiente: partes 4 a 8.

## Parte 4 — envíos repetidos

### H3 — Media — fiar acepta otro contenido como si fuera el mismo pedido (demostrado)

**Dónde:** `db/migraciones/0041_el_fiado.sql:187` (`cobrar_a_credito` devuelve inmediatamente cualquier cuenta confirmada), `:121` (`confirmar_operacion` tampoco contrasta forma), y `db/migraciones/0038_el_cajon.sql:227` (`terminar_vehiculo`, devolución anticipada).

**Reproducción:** caso propio `QA4`: fiar una venta al cliente A sin plazo, repetir para cliente B con plazo 2099-01-01; devuelve éxito y la venta de A sin plazo. Pedir confirmar esa cuenta «efectivo» devuelve éxito con «credito». Pedir fiar una venta ya cobrada en efectivo también devuelve éxito con «efectivo». Salida en `qa/revision-31-QA4.log`. Son llamadas con contenido válido y distintos entre sí; no duplican inventario ni crédito, pero incumplen el requisito explícito de rechazar un reenvío con otro contenido y pueden dar por aceptada una orden diferente. Las pruebas existentes de 49 y 53 incluso fijan el comportamiento permisivo; no es una suposición sobre ellas.

**Arreglo propuesto:** conservar el contenido de la confirmación/fiado y comparar cliente resuelto, vencimiento, forma, revisión y autorización al reintentar; devolver RC012/RC011 ante discrepancias. Unificar la resolución entre confirmar, fiar y terminar vehículo para que dos formas competidoras no reciban ambas éxito. Se puede usar un envío de confirmación persistido con su contenido o una comparación estricta con el resultado inmutable.

**Sin otros hallazgos en lo ejecutado:** 49, selección de apertura, movimiento y duplicados concurrentes de apertura/movimiento/corte: 5 aprobadas; 51 reenvío de corrección después de otra corrección y cierre, cambiado/cancelado: 1; 53 abono repetido/cambiado/cancelado después del corte: 1; 55 gasto repetido/cambiado/cancelado: 1. Logs `qa/revision-31-reenvios-{caja,correccion,abono,gasto}.log`. El caso del corte con clave mala de la parte 3 ya cubrió reenvío cambiado y devolución del corte original. `envio_del_cajon` serializa el UUID antes de leer resultado; `reservar_envio` vuelve a resolver la carrera contra cancelación antes de escribir. No se observó duplicación de asientos.

Pendiente: partes 5 a 8.

## Parte 5 — costo y ganancia (avance guardado)

### H4 — Alta — las correcciones producen una ganancia falsa (demostrado)

**Dónde:** `src/servidor/dominio/ganancia.ts:69` (CIFRAS), `:94` (mov); `db/migraciones/0040_corregir_una_cuenta_cobrada.sql:163` (asientos de corrección como ajuste); `src/app/panel/ganancia/page.tsx:117` (los presenta como bajas/faltantes o sobrantes de conteo).

**Reproducción:** caso propio `QA5a`, log `qa/revision-31-QA5a.log`. Apertura $1000; comprar 100 kg de cartón a $2.10, vender 10 kg a $2.50 y corregir la venta a 20 kg, cobrando $25 adicionales en efectivo. Corte y patio cuadran: efectivo $840 + patio $168 − apertura $1000 = **ganancia $8**. Ganancia devuelve **resultado −$17 y pérdidas $21**: conserva vendido $25/costo $21 originales, resta el ajuste de inventario de $21 y nunca agrega los $25 de la corrección. Segundo escenario: comprar 100 kg y corregir a 90 devolviendo $21; efectivo+patio se mantienen en $1000 (resultado $0), pero Ganancia informa **pérdida $21**.

**Causa:** el informe no lee `correccion_de_cuenta`; todos sus ajustes de kilos son tratados como pérdidas/sobrantes de conteo, sin su contrapartida monetaria. Afecta también a periodos posteriores, otros materiales y liquidaciones por transferencia; el ejemplo usa efectivo para conciliar inequívocamente con el corte.

**Arreglo propuesto:** distinguir los ajustes procedentes de correcciones de los conteos, integrar en el día de corrección su diferencia de ingreso/costo y su movimiento de inventario, conservando el comprobante histórico; evitar que una corrección de compra sea una baja y una devolución de venta un sobrante de conteo. Hacer una conciliación de resultado con caja, transferencias, crédito e inventario, sin contar una misma diferencia dos veces. Definir expresamente cómo se presentan las diferencias pendientes, manteniendo separado resultado de efectivo cobrado.

### H5 — Alta — «Lo que queda» omite los redondeos realmente pagados/cobrados (demostrado)

**Dónde:** `src/servidor/dominio/ganancia.ts:94` y `:69`: usa `operacion_linea.importe` y no incorpora `operacion.ajuste_redondeo`; presentación de utilidad en `src/app/panel/ganancia/page.tsx:124`.

**Reproducción:** caso `QA5b`, log `qa/revision-31-QA5b.log`. Comprar 1 kg a $2.10 paga $2; venderlo a $2.50 cobra $3. Sin inventario restante, deudas ni gastos, la caja crece **$1.00**, pero «Lo que queda» es **$0.40**. Faltan $0.10 de redondeo favorable en compra y $0.50 en venta. Es acumulativo al vender y comprar muchas cuentas pequeñas. El costo a centavos es una decisión explícita y razonable; el fallo es no tener ninguna conciliación de esos redondeos en la utilidad final, que la pantalla presenta sin esa salvedad.

**Arreglo propuesto:** mantener el costo promedio y el margen por material con centavos, pero agregar un rubro independiente de ajustes de redondeo de compras y ventas, con sus signos, a resultado/utilidad del periodo; mostrarlo para conciliar contra el cierre. No repartirlo arbitrariamente entre materiales.

### H6 — Alta — recálculo de 0039 confunde el ID antiguo con el orden real de asiento (demostrado)

**Dónde:** `db/migraciones/0039_el_costo.sql:124` (recorre historia `ORDER BY id`), `:78` (productos anteriores por `id < p.id`); el ID solo se vuelve seguro para movimientos **nuevos** en `:140`. Antes, `db/migraciones/0006_inventario.sql:81` toma el candado después de reservar el identity y fija `creado_en` después del candado (:86).

**Reproducción:** archivo propio `pruebas/90-revision-costo-historico.test.ts`, casos ejecutados por separado `QA5c` y `QA5e`. Se crea una base vacía y se aplican solo SQL hasta 0038. A confirma una compra dentro de una transacción; B intenta una venta y espera inventario; A asienta otra compra y confirma; B termina. Todas las operaciones son válidas. Es la misma intercalación posible entre dos renglones de una confirmación y otra confirmación concurrente.

- **QA5c:** orden por ID compra +10, venta −20, compra +10; orden efectivo compra +10, compra +10, venta −20. Existencia real final 0. Aplicar 0039 devuelve **RC002** y no puede actualizar esta historia válida. Log `qa/revision-31-QA5c.log`.
- **QA5e:** stock inicial 10 kg/$20; después dos compras de 10 kg/$40 antes de una venta de 10 kg. Promedio correcto al vender $100/30; costo de venta **$33.33**, patio **$66.67**. La migración pasa, pero graba costo **$30.00** y patio **$70.00**, porque intercala la venta antes de la segunda compra según el ID. Log `qa/revision-31-QA5e.log`.

**Arreglo propuesto:** reconstruir el orden de asiento histórico usando la evidencia registrada después del candado (`creado_en`, más desempate y dependencias de referencia/transformación), conservando los identificadores originales. Adaptar también la búsqueda de componentes anteriores de una transformación; no basta ordenar solo el bucle. Mantener la asignación de ID bajo candado para asientos nuevos. Validar migración con ambas intercalaciones y un caso de transformación histórica concurrente.

**Cobertura restante de parte 5 sin hallazgos:** lectura completa de 0039. Pruebas seleccionadas de 50: 6 aprobadas (conteos positivos/negativos, separación con basura a valor y sin precios, migración secuencial, costo de salida que espera compra, ID definitivo nuevo). No son la batería completa. Pruebas seleccionadas de 52: 2 aprobadas (margen/pérdidas y gastos excluidos/anulados). Prueba propia `QA5d`: gastos en días y fronteras de semana/mes; total $210, semanas 10/90/110, meses 60/150, fuera del periodo excluido. Logs `qa/revision-31-{costo,ganancia,QA5d}.log`. El promedio nuevo y el reparto conservan centavos en lo probado; el fallo histórico no se reproduce en el trigger nuevo, que ya reasigna ID bajo candado.

Pendiente: partes 6 a 8.

## Parte 6 — fiado

### H7 — Alta — corregir una venta fiada deja el saldo original y admite cobrar de más (demostrado)

**Dónde:** `db/migraciones/0041_el_fiado.sql:302` (tope del abono solo suma crédito menos abono), `:321` (vista `saldo_de_clientes`, misma omisión); `db/migraciones/0040_corregir_una_cuenta_cobrada.sql:152` (acepta corrección de una venta a crédito y no produce ajuste de crédito); `src/servidor/dominio/fiado.ts:32` (expone esa vista).

**Reproducción:** caso propio `QA6`, log `qa/revision-31-QA6.log`: fiar 100 kg a $2.50 = $250; corregir a 50 kg = $125 con diferencia «pendiente» (no se pagó ni devolvió dinero). La corrección y el inventario se asientan, pero Fiado sigue mostrando **$250**. `registrar_abono` acepta **$250** completos y declara la deuda saldada: el cliente ha pagado **$125 de más** respecto de la venta corregida. La igualdad técnica «crédito original menos abonos» se cumple, pero deja fuera una corrección que la propia aplicación permitió.

**Arreglo propuesto:** registrar una nota de ajuste de crédito inmutable vinculada a la corrección y considerarla tanto en saldo/vencido/FIFO como en el tope de abono, bajo el mismo candado de cliente. Distinguir diferencias ya liquidadas en efectivo/transferencia para no duplicarlas. Resolver el caso de créditos ya abonados que se reducen (devolución o saldo a favor explícito); mientras no exista esa regla, impedir o encauzar la corrección de cuentas a crédito en vez de dejar un saldo silenciosamente desactualizado. La decisión usada en esta revisión es que una diferencia pendiente de una venta fiada debe reflejarse en lo que debe el cliente: no se inventó un pago para compensarla.

**Sin hallazgos en crédito no corregido:** la vista agrega abonos antes de unirlos a créditos, no multiplica importes. FIFO por orden de creación (no por vencimiento) coincide con lo descrito. Pruebas seleccionadas de 53: saldo/vencido FIFO, abonos efectivo/transferencia y rechazo de adelantos, dos abonos concurrentes que excederían saldo: **3 aprobadas**, log `qa/revision-31-saldos.log`. El candado del cliente impide que ambos abonos gasten el mismo saldo. Partes de corte, roles e idempotencia ya comprobadas arriba.

Pendiente: partes 7 y 8.

## Parte 7 — pantallas y envíos inciertos

### H8 — Media — cambiar firmante pierde el envío antes de resolverlo (demostrado sin navegador)

**Dónde:** `src/componentes/cierre/Correcciones.tsx:124` (`soltar`, llama `fijar(null)` antes de `cancelarEnvio`); `src/app/cierre/page.tsx:172` (`soltarCierre`, mismo orden).

**Reproducción:** dejar una corrección o corte sin respuesta; tocar «Autoriza otra persona» mientras falla la red hacia cancelar. `pruebas/90-revision-pendientes.test.ts`, caso `QA7a`, extrae por AST y ejecuta **los callbacks originales** con una cancelación que rechaza por red; no monta React ni ejecuta recorridos. **Salida en ambos:** `borrado -> cancelar -> error de red; UUID perdido antes de saber si entró`. Log `qa/revision-31-QA7a.log`. El estado y sessionStorage ya perdieron el identificador, aunque la petición original todavía puede entrar. El helper general `enviar` y el «soltar» de MoverDinero sí esperan la resolución antes de borrar.

**Arreglo propuesto:** conservar estado/UUID hasta recibir y validar «entró» o «cancelado»; si falló la cancelación, mantener la misma persona y el mismo envío. Solo entonces limpiar o recuperar el resultado. Aplicarlo a ambos callbacks.

### H9 — Media — cambiar de comprobante oculta y sobrescribe otra corrección incierta (demostrado por código y callback)

**Dónde:** `src/componentes/cierre/Correcciones.tsx:31`, `:43`, `:69`; `src/app/cierre/page.tsx:225` (buscar) y `:383` (componente con key por comprobante).

**Reproducción:** enviar una corrección del folio A y perder la respuesta; recargar o salir de la búsqueda, luego buscar folio B. `recordar(B)` devuelve null aunque sessionStorage contiene el envío de A. B puede crear su propio envío y `fijar` escribe en la misma clave global `feruga.correccion`, perdiendo A. El caso `QA7b` ejecuta el `recordar` original con almacenamiento simulado y demuestra que el envío A no resuelto desaparece de la vista al consultar B; la sobrescritura se verifica en el escritor estático. Log `qa/revision-31-QA7b.log`. No se ejecutó la secuencia visual en navegador.

**Arreglo propuesto:** resolver primero cualquier corrección pendiente y llevar a su comprobante, o persistir un mapa por cuenta y ofrecer acceso visible a todas las pendientes. La búsqueda de otro folio no debe poder sustituir un UUID sin resolver.

### H10 — Media — cobrar/fiar no conservan el pedido incierto y permiten cambiarlo (verificado estáticamente)

**Dónde:** `src/componentes/mostrador/Mostrador.tsx:329` y `:663`, `:1028`; `src/componentes/mostrador/Fiar.tsx:23` y `:48`.

**Reproducción propuesta:** elegir transferencia, enviar y perder la respuesta; recargar mientras la cuenta sigue borrador (petición retrasada o que no llegó). La forma vive solo en `useState('efectivo')`: se pierde y el siguiente cobro usa efectivo. En Fiar se pierden cliente/plazo/firmante, y tras un error se permite regresar y cambiarlos sin resolver el intento original. Estas tres entradas usan `pedir` directamente, sin un pedido persistido ni bloqueo de edición por resultado incierto. El H3 demuestra además que, si ganó el primer pedido, el segundo con otro contenido puede recibir éxito igualmente. No se afirma haber reproducido la recarga en navegador: se inspeccionaron el envío, el estado inicial y la memoria de Mostrador (que conserva pesos/precios, pero no la confirmación).

**Arreglo propuesto:** persistir la orden de confirmación antes del primer envío (cuenta/revisión/forma y, para fiado, cliente/plazo/autoriza; nunca clave); ante red/5xx ofrecer únicamente resolver/repetir ese contenido. Recuperar explícitamente el resultado de esa cuenta aunque ya no figure entre las abiertas. Coordinarlo con el rechazo estricto de contenido de H3.

**Resto de cobertura:** se leyeron los tres componentes de caja que escriben, Avisos, Correcciones, cierre, RegistrarGasto, TiposDeGasto, pantallas Ganancia/Fiado/Gastos, Fiar y el cobro de Mostrador; comparación con `enviar` y `pestana.ts`. Apertura/movimiento/abono/gasto conservan UUID y cuerpo antes de salir; claves van aparte y no se guardan. Cierre y Mostrador se montan detrás de `SoloEnSuPestana`; la lista CAJA de `pestana.ts` incluye las cinco claves nuevas. Los textos de anulación de gasto y cambio retroactivo de tipos corresponden a la base. Los errores de ganancia/corrección fiada también afectan a los textos de sus pantallas (H4, H5, H7).

**Sospecha separada, sin reproducción visual:** Gastos lee `hayGastoPendiente` al montar y no usa `SoloEnSuPestana`; `Sesion` inicia `pestanaLista` sin esperarlo. Puede leer el envío heredado antes de resolver si la pestaña es propia o dudosa. La idempotencia del UUID limita duplicados, pero falta verificar la secuencia de duplicación/recarga/rechazo del candado con este formulario. Ubicación: `src/app/panel/gastos/page.tsx:66`, `src/componentes/Sesion.tsx:117`. No se cuenta como hallazgo demostrado.

Pendiente: parte 8.


---

## El encargo

```text
REVISIÓN DE CALIDAD, una sola pasada: la caja y la ganancia (migraciones 0038 a 0042, su servidor y sus pantallas).
Proyecto: gestión de una recicladora (Next.js 16, React 19, PostgreSQL 17, Docker Compose). Todo en español.
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa14/   (al día con todo lo que se revisa)
TU INFORME: /tmp/feruga-codex-informe-31.md

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja SOLO en /tmp/feruga-codex-qa14/. No ejecutes npm ci ni npm install. No sustituyas su
  docker-compose.yml. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 más allá de lo que hacen los guiones de
  qa/, ni la base «feruga»: son del usuario.
- NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
- Tu cuota puede cortarse. Crea el informe al empezar y GUÁRDALO después de revisar cada parte,
  con lo encontrado hasta ese momento. Revisa en el orden de abajo: lo primero es lo que más importa.

HERRAMIENTAS: las de qa/ (ver qa/LEEME.md). NO corras la batería completa, recorridos ni simulacros.
Puedes escribir pruebas nuevas en tu copia para demostrar un hallazgo (pruebas/90-revision-*.test.ts)
y correrlas una por una. NO corrijas el código de la aplicación: anota el arreglo que propones.

QUÉ ES (para entender la intención): plan docs/planes/2026-10-15-caja-y-ganancia.md, y las respuestas
del negocio al final de docs/planes/2026-10-12-caja-y-ganancia-preguntas.md. En corto:
- Antes de atender se cuenta el cajón (caja_apertura). Durante el día se saca o se mete dinero con la
  clave de un responsable (caja_movimiento). Cerrar el día es el corte (caja_corte): se cuenta, se
  dice cuánto se queda, y lo firma con su clave un responsable o alguien de mostrador con permiso de
  corte. Si no cuadra, sale un aviso. Cada cuenta dice si fue en efectivo, por transferencia o a crédito.
- Lo que costó cada movimiento de inventario lo pone la base al asentarlo, a costo promedio (0039).
- Una cuenta ya cobrada se corrige con la clave de un responsable y se liquida la diferencia (0040).
- Una venta se fía a un cliente conocido; los abonos llegan después; los de efectivo entran al cajón (0041).
- Los gastos se registran a mano; uno del cajón es también un «sacar»; cada tipo dice si se resta en
  la ganancia (0042).

QUÉ REVISAR, EN ESTE ORDEN
1. EL DINERO DEL CAJÓN (0038, 0040, 0041, 0042 y src/servidor/dominio/caja.ts, cierre.ts):
   ¿«lo que debería haber» (esperado_en_cajon) cuenta cada peso una sola vez? Busca casos con:
   cuentas en efectivo, transferencia y crédito; sacar/meter; correcciones liquidadas en efectivo,
   transferencia o sin liquidar; abonos en efectivo y transferencia; gastos del cajón nuevos y
   clasificados; anular un gasto; reabrir el día y volver a cerrarlo; dos cierres en un día; la
   apertura del día siguiente con lo que se dejó. ¿Lo que muestra el servidor (estadoDelCajon) y lo
   que guarda el corte coinciden siempre con esperado_en_cajon?
2. LO QUE PASA A LA VEZ: un corte mientras alguien saca dinero, abona, corrige una cuenta, registra o
   anula un gasto, o confirma una cuenta en efectivo. ¿Puede algo quedar asentado en una jornada ya
   cortada, o fuera del corte? ¿Los candados se toman en el mismo orden en todas las funciones?
3. QUIÉN PUEDE QUÉ: permisos de cada función (exigir_rol, permiso de corte, clave tecleada y
   comprobada en la misma función que escribe; con clave equivocada no queda nada escrito pero sí
   cuenta el intento). Rutas: roles de cada una (src/app/api/caja, avisos, jornada/cerrar, cuentas/*/
   confirmar|terminar-vehiculo|fiar, comprobantes/*/correcciones, fiado, gastos, panel/ganancia,
   administracion/personas/*/corte). ¿Alguna ruta deja hacer a un rol lo que la base no debería?
4. ENVÍOS QUE SE REPITEN: abrir el cajón, mover, cerrar con corte, corregir, fiar, abonar, registrar
   gasto. Repetir devuelve lo mismo; con otro contenido o cancelado, se rechaza. ¿Algún camino asienta
   dos veces o se queda sin poder resolverse?
5. EL COSTO Y LA GANANCIA (0039, src/servidor/dominio/ganancia.ts): costo promedio con compras y
   ventas a la vez; separar (transformación) con varias partes y basura; bajas y ajustes; el recálculo
   histórico de la migración. ¿Lo que dice Ganancia de un día cuadra con el cierre de ese día y con
   el libro de inventario? ¿Los gastos se restan en el tramo correcto (día, semana, mes)?
6. LO FIADO (0041, fiado.ts): saldo por cliente, lo vencido, abonos que no pasan de lo que se debe,
   una venta fiada que luego se corrige (0040). ¿Cuadra «lo que deben» con lo fiado menos lo abonado?
7. LAS PANTALLAS (src/app/cierre/page.tsx, src/componentes/caja/*, src/componentes/cierre/
   Correcciones.tsx, src/componentes/gastos/*, src/app/panel/{ganancia,fiado,gastos}/page.tsx, la
   parte de cobrar de src/componentes/mostrador/ y Fiar): lo que queda guardado en la pestaña mientras
   no se sabe si un envío entró (patrón de enviar en src/componentes/inventario/piezas.tsx y
   src/componentes/pestana.ts); textos que digan algo distinto de lo que hace la base.
8. LA DEMO (consola/demo.ts, el flujo «cajon»): ¿lo inventado deja cortes, aperturas y avisos coherentes?

AL TERMINAR: el informe completo en /tmp/feruga-codex-informe-31.md. Para cada hallazgo: gravedad
(alta: dinero o datos mal; media: falla que alguien puede encontrar; baja: claridad), dónde (archivo y
línea), cómo reproducirlo (idealmente una prueba tuya y su salida), y el arreglo que propones. Separa
lo que demostraste de lo que sospechas. Di también qué revisaste sin encontrar nada y qué no alcanzaste.
En tu respuesta final, solo tres renglones y la ruta del informe.

```
