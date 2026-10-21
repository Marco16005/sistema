# Codex construye: el fiado (0041) — corrida incompleta

> **21 de octubre de 2026.** Corrida de construcción de Codex (`gpt-6-astra`, esfuerzo alto). **Se cortó
> por cuota** después de escribir `db/migraciones/0041_el_fiado.sql` y `pruebas/53-fiado.test.ts`
> (16/16) con sus ajustes en los archivos compartidos, y de pasar la regresión del cajón (49, 24/24).
> No alcanzó el resto de las regresiones ni el informe final: Claude las corrió y pasaron, y lo
> integró. Encargo: `encargo-29` (al final).

# Informe 29 — Fiado (0041)

Estado: iniciado. Trabajo exclusivo en /tmp/feruga-codex-qa14/. No se modificarán archivos del proyecto original ni se instalarán dependencias.

## Alcance y reglas
Crear únicamente 0041_el_fiado.sql y 53-fiado.test.ts; ajustar únicamente ESQUEMA_ESPERADO, ENTRADAS de permisos, frases de bitácora y cuenta GUARDIA. Ejecutar pruebas primero, QA dirigido y tipos, una corrida a la vez. Reconstruir plantilla al cambiar migración.

## Pasos
1. Informe creado antes de inspeccionar o modificar código.

## Decisiones
Pendientes de lectura del proyecto.

## Validación
Pendiente.

## Pendientes
Lectura, pruebas rojas, implementación, QA dirigido y tipos.

2. Leídas las migraciones y entradas indicadas, el plan/cuestionario y QA. La copia no tiene .git. Detectado el guardián diferido de cliente de 0025: requiere ampliación para crédito sin precio especial. Pruebas 53 escritas antes de crear 0041 (16 casos, incluidos cruces de abonos y corte).

Decisiones: conservar todos los clientes con crédito en saldo_de_clientes y añadir tiene_deuda; FIFO por momento de creación del crédito, desempate por operación. Sin plazo no vence, pero consume primero los abonos si la venta es más vieja. No inventar umbral de volumen: la selección del caso queda en quien autoriza con facultad. Abonos siguen el patrón de envío del cajón y se serializan por cliente.

3. Corrida roja completada: 16 pruebas, 0 pasan, 16 fallan por funciones cobrar_a_credito/registrar_abono ausentes (42883). Registro: /tmp/feruga-codex-29-rojo.log.
4. Implementada 0041: crédito/abono inmutables, cliente y total comprobados diferidamente, confirmación interna conservada, facultad/clave, envíos, saldo FIFO y esperado del cajón con correcciones de 0040. Ajustados únicamente los cuatro archivos auxiliares autorizados. Se conserva la política de confirmar_cuenta para cuentas de jornada cerrada (RC008). READ COMMITTED obligatorio al escribir fiado/abonos, como el inventario, para evitar sumas con instantánea vieja.

5. Plantilla reconstruida correctamente con 0041. Primera corrida verde de 53: 16/16 pasan, 0 fallan (3.68 s). Incluye espera demostrada con esperarQueEspere en los dos abonos y en ambos órdenes abono/corte. Registro: /tmp/feruga-codex-29-fiado.log. Pendiente: regresiones dirigidas y tipos.
6. Regresión 49-cajon: 24/24 pasan, 0 fallan (5.68 s), incluida migración de cuentas antiguas y todos sus cruces de cierre. Registro: /tmp/feruga-codex-29-49.log.


---

## El encargo

```text
CONSTRUCCIÓN, una sola pasada: el FIADO —ventas a crédito y sus abonos— (migración 0041) y sus pruebas.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL 17, Docker Compose). Todo en español.
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa14/   (al día: trae 0038 el cajón, 0039 el costo y tu 0040)
TU INFORME: /tmp/feruga-codex-informe-29.md

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja SOLO en /tmp/feruga-codex-qa14/. No ejecutes npm ci ni npm install. No sustituyas su
  docker-compose.yml. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 más allá de lo que hacen los guiones de
  qa/, ni la base «feruga»: son del usuario.
- NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
- Tu cuota puede cortarse. Crea el informe al empezar y GUÁRDALO después de cada paso.

HERRAMIENTAS: las de qa/ (ver qa/LEEME.md). Rehaz la plantilla cada vez que cambies la migración.
NO corras la batería completa, recorridos ni simulacros.

ARCHIVOS: crea SOLO
  db/migraciones/0041_el_fiado.sql
  pruebas/53-fiado.test.ts
y cambia SOLO src/servidor/esquema.ts (ESQUEMA_ESPERADO), pruebas/08-permisos.test.ts (ENTRADAS),
src/servidor/dominio/bitacora.ts (frase de cada pareja nueva de anotar) y pruebas/39-bitacora.test.ts
(solo la cuenta de la GUARDIA). Si una prueba existente deja de pasar, anótala; arregla solo lo tuyo.

LO QUE QUIERE EL NEGOCIO (docs/planes/2026-10-15-caja-y-ganancia.md, parte 4; respuestas 4 y 5 del
cuestionario): «se fía, pero en cargas grandes, con gente conocida y casos particulares, con
clientes mucho más grandes. Pagar por adelantado y traer el material después, no». La
especificación (P2): crédito con plazo pactado caso por caso y solo en pedidos de volumen.
Por eso: solo VENTAS se fían; no hay adelantos ni compras a crédito.

LEE PRIMERO: db/migraciones/0038_el_cajon.sql (forma_de_pago, confirmar_cuenta, esperado_en_cajon,
el patrón de envíos y claves del cajón), 0040 (cómo se extendió esperado_en_cajon), 0025/0027/0033/
0034 (clientes: cliente, nombre_de_cliente, operacion.cliente_id y cliente_nombre, alta_cliente),
0016 (terminar_vehiculo), 0037 (estilo); src/servidor/dominio/caja.ts y clientes.ts.

═══ INTERFAZ FIJA (Claude escribe las pantallas contra ella) ═══
1. operacion.forma_de_pago admite 'credito', solo en ventas (RC005 si es compra).
2. cobrar_a_credito(p_cuenta uuid, p_usuario bigint, p_revision int, p_cliente bigint,
   p_cliente_nuevo text, p_vence date, p_autoriza bigint, p_clave text, p_huella text)
   RETURNS operacion — confirma la venta como lo hace confirmar_cuenta, con forma 'credito', a
   nombre de un cliente: uno que ya existe (p_cliente) o uno nuevo (p_cliente_nuevo, con la regla de
   nombres de 0034; exactamente uno de los dos). Si la cuenta ya lleva cliente por un precio
   especial, tiene que ser ese mismo (RC005 si no). p_vence: la fecha en que debe pagar, si se pactó
   (puede ir vacía; no puede ser anterior a hoy). Lo autoriza un responsable FACULTADO con su clave
   (autorizo_con_clave); clave mala: NULL y el intento contado; lo que no procede se rechaza antes.
   p_usuario: mostrador o responsable. La cuenta queda a nombre del cliente (cliente_id y
   cliente_nombre como en 0025). Repetirla ya confirmada devuelve la cuenta sin cambiar nada.
   anotar(p_usuario, 'fiar', 'operacion', id, {folio, cliente, importe, vence, autoriza}).
3. credito: (operacion_id PK, cliente_id, importe = total de la venta, vence_el, autorizado_por,
   creado_en). Inmutable. Lo escribe solo cobrar_a_credito.
4. abono: id, cliente_id, importe > 0, forma 'efectivo' | 'transferencia', jornada_id (la abierta),
   nota (texto limpio, opcional, hasta 200), registrado_por, creado_en, envio_id. Inmutable.
   registrar_abono(p_envio uuid, p_cliente bigint, p_importe numeric, p_forma text, p_nota text,
   p_usuario bigint) RETURNS abono — mostrador o responsable, sin clave (es dinero que entra).
   Jornada abierta (RC006); en efectivo, con el cajón contado ese día (RC006 si no). No puede pasar
   de lo que el cliente debe (RC004, diciendo cuánto debe). Envíos como los del cajón (repetir
   devuelve lo mismo; otro contenido o cancelado, RC012). anotar(p_usuario, 'abonar', 'cliente', ...).
5. esperado_en_cajon (CREATE OR REPLACE): las ventas a crédito NO suman (no son efectivo); los
   abonos en EFECTIVO de esa jornada SÍ suman. Conserva todo lo de 0040.
6. saldo_de_clientes (vista o función que la aplicación pueda leer): por cliente con algo fiado:
   cliente_id, nombre, fiado (suma de créditos), abonado (suma de abonos), debe (= fiado − abonado),
   vencido (lo que se debe de créditos con vence_el anterior a hoy, aplicando los abonos a lo más
   viejo primero), primera y última venta a crédito, último abono. Solo los que deben algo, o
   todos con una columna que lo diga: decide y dilo.
7. Un cliente dado de baja no recibe crédito nuevo (RC005) pero sí abonos.
8. La aplicación lee las tablas nuevas (SELECT); no escribe directo.

═══ PRUEBAS (primero; míralas fallar) ═══ pruebas/53-fiado.test.ts. Lo mínimo:
 - una venta a crédito a un cliente existente y a uno nuevo: queda confirmada, con forma 'credito',
   a su nombre, y el inventario sale; el cajón no cambia.
 - compra a crédito: RC005; venta con precio especial a otro cliente: RC005; vence en el pasado:
   rechazo; los dos clientes o ninguno: RC005.
 - clave mala: NULL e intento contado; quien autoriza sin facultad: RC008 sin gastar intento;
   patio y consulta: RC008.
 - abonos: en efectivo suben el esperado del cajón; por transferencia no; más de lo que debe: RC004;
   sin cajón contado en efectivo: RC006; envío repetido, cambiado y cancelado.
 - saldo: fiado, abonado, debe y vencido con abonos aplicados a lo más viejo.
 - el corte de un día con una venta a crédito y un abono en efectivo cuadra.
 - concurrencia: dos abonos a la vez que juntos pasan de lo que debe: uno espera y el segundo se
   rechaza (espera demostrada con esperarQueEspere).
Corre también 49-cajon, 51-corregir-cuenta, 26-precio-especial, 42-clientes y 15-cuentas; y
sh qa/tipos.sh.

AL TERMINAR: el informe completo en /tmp/feruga-codex-informe-29.md (qué hiciste, decisiones
tomadas por tu cuenta, pruebas con números, qué falla y por qué, qué no alcanzaste). En tu
respuesta final, solo tres renglones y la ruta del informe.

```
