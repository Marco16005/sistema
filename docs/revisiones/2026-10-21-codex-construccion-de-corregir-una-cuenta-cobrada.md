# Codex construye: corregir una cuenta ya cobrada (0040)

> **21 de octubre de 2026.** Corrida de construcción de Codex (`gpt-6-astra`, esfuerzo alto), en su
> copia. Terminó completa: `db/migraciones/0040_corregir_una_cuenta_cobrada.sql` y
> `pruebas/51-corregir-cuenta.test.ts` (18/18). La pantalla, las rutas y el desglose en el cajón los
> hizo Claude al integrar. Encargo: `encargo-28` (al final).

# Informe 28: corregir una cuenta cobrada

Estado: terminado. Migración 0040 implementada; 177 pruebas aprobadas y comprobación de tipos correcta. Trabajo exclusivo en /tmp/feruga-codex-qa14; sin modificar la copia del usuario.

## Plan y restricciones
Leer QA y patrones; escribir primero pruebas 51 y verlas fallar; implementar 0040 y cambios permitidos; reconstruir plantilla tras cada cambio SQL; correr únicamente 51, 49, 50, 18, 15, 16 y tipos, en serie.

## Avance
- Informe creado antes de empezar la inspección.

## Decisiones
Documentadas abajo conforme se tomaron; véase también el detalle final.

## Resultados
Comprobación final: 177/177 pruebas aprobadas, cero fallos; tipos con salida 0. Tabla de corridas al final.

## Registro de ejecución
Se conservan los fallos iniciales y sus correcciones para distinguir el rojo previo de los resultados finales.
- Inspeccionados QA, migraciones 0007/0017/0025/0027/0037/0038/0039, caja, cierre, permisos y bitácora. QA usa bases desechables y plantilla propia.
- Decisión: los kilos de la interfaz son liquidables; se ajustará la diferencia liquidable sin reescribir el peso recibido ni el descuento del comprobante. El costo lo calcularán los disparadores de 0039.
- Decisión: misma mercancía vigente conserva su precio vigente; cambiar de mercancía usa la lista histórica de la cuenta. Así las correcciones sucesivas parten de la última.
- Escritas primero 13 pruebas nuevas: negocio, permisos, reintentos, inmutabilidad y cuatro cruces con espera verificable. Se ejecutan antes de crear 0040.
- Decisión: cero kilos se rechaza (RC004); no se ofrece una cancelación con devolución disfrazada de corrección. Pendiente solo registra; no crea deuda ni pago futuro.
- Rojo comprobado: 51 ejecutó 13 pruebas, 0 pasaron y 13 fallaron antes de crear 0040. Causa principal 42883 (función inexistente); el cruce con corte tampoco pudo observar bloqueo por esa misma ausencia.
- Implementada 0040 y los cuatro ajustes permitidos (versión, ENTRADAS, frase y cuenta de GUARDIA). Envíos usan el protocolo de 0038 y comparan también p_vistas; se bloquea jornada antes del patio, validando antes de clave. Ajustes referencian al movimiento original.
- Decisión adicional: conservar la barrera de 0017 contra conteos posteriores, para no modificar de nuevo lo ya contado; RC005 antes de clave.
- Plantilla reconstruida: 40 migraciones. Primera corrida de implementación: 12/13 pasan. Único fallo propio: la preparación llamaba material(), que busca en el catálogo, con un nombre nuevo. Corregido creando el material en la base desechable de la prueba.
- Agregadas cinco pruebas de precio especial, descuento/peso liquidable y centavos, signos de caja/pendiente, cambio de material en venta y barrera de conteo posterior. SQL sin cambios desde la reconstrucción.
- Segunda corrida 51: 17/18 pasan; faltaba familia_id en el material nuevo de la preparación. Corregido copiando la familia de un material existente. Las cinco coberturas nuevas pasan.
- Regresión 49-cajon: 24/24 pasan, incluida migración con cuentas antiguas y cruces de corte.
- Tercera corrida 51: 17/18; aún faltaba nombre_corto en el material de prueba. Leída la definición completa del catálogo y completada la preparación. No hubo fallos nuevos de la implementación SQL.
- Regresión 50-costo: 14/14 pasan, incluidos reconstrucción histórica, reparto y concurrencia del costo.
- Regresión 18-inventario: 47/47 pasan; sin cambiar ninguna prueba existente.
- Regresión 15-cuentas: 28/28 pasan.
- Regresión 16-cierre: 8/8 pasan.
- Corrida final 51: 18/18 pasan, cero omitidas. Las cuatro concurrencias demuestran espera real consultando pg_stat_activity (wait_event_type='Lock').
- Total de las seis suites solicitadas: 139/139 pruebas pasan (51:18, 49:24, 50:14, 18:47, 15:28, 16:8).
- sh qa/tipos.sh: salida 0, sin errores. El guion genera la caché incremental existente; se guardó en memoria y se restauró exactamente después, para no dejar cambios fuera de los archivos permitidos.
- Guardia adicional del cambio permitido: 08-permisos 37/37 pasan; 39-bitacora, solo patrón GUARDIA, 1/1 pasa (42 parejas con frase). Total final: 177 pruebas aprobadas y tipos correctos.

## Entrega y alcance final

Creados únicamente:
- `db/migraciones/0040_corregir_una_cuenta_cobrada.sql`.
- `pruebas/51-corregir-cuenta.test.ts`.

Modificados únicamente:
- `src/servidor/esquema.ts`: ESQUEMA_ESPERADO apunta a 0040.
- `pruebas/08-permisos.test.ts`: ENTRADAS incluye corregir_cuenta.
- `src/servidor/dominio/bitacora.ts`: frase de «corregir operacion», con folio, autorizante y motivo disponibles.
- `pruebas/39-bitacora.test.ts`: solo la cuenta de GUARDIA, de 41 a 42.

Revisión final por fecha de modificación: solo estos seis archivos de la copia quedaron modificados. No se modificó docker-compose.yml ni se ejecutaron instalaciones. No se escribió en /Users/maantora/Desktop/feruga. Todas las operaciones con Docker/PostgreSQL se hicieron mediante los guiones QA autorizados; no se intervino directamente en los contenedores del usuario ni en la base feruga. Todas las corridas fueron secuenciales.

## Qué implementa 0040

- Registro inmutable con todos los campos de la interfaz, número único por renglón, diferencia calculada y envío único. SELECT para feruga_app; sin escrituras directas. Guardianes contra UPDATE, DELETE y TRUNCATE.
- Entrada corregir_cuenta con la firma solicitada y devolución NULL al fallar la clave, conservando el intento. Solo mostrador/responsable registra; autoriza una persona activa con puede_autorizar mediante autorizo_con_clave.
- Validación de cuenta confirmada, jornada abierta, material activo y precio histórico. Misma mercancía vigente conserva precio vigente, incluido el especial original. Otra mercancía usa compra/venta de operacion.lista_id.
- Estado anterior tomado de la última corrección, o del renglón original. Vista desactualizada RC011; sin cambio RC005. No se toca el comprobante ni se vuelve a pagar el total.
- Ajustes firmados por la diferencia de kilos, referidos al movimiento original. Comprueba existencia antes de pedir clave. Los disparadores de 0039 valoran cada ajuste; no se reescribe costo histórico.
- Envíos con el protocolo de 0038: repetir devuelve el resultado original, incluso después de otra corrección o del cierre; otro contenido y envío cancelado reciben RC012. La clave y la huella no forman parte del contenido persistido.
- Jornada en bloqueo compartido y candado del patio antes de leer correcciones vigentes. El corte espera una corrección en curso; una corrección que esperaba un corte encuentra la jornada cerrada. Dos correcciones concurrentes no pisan la vista anterior.
- esperado_en_cajon incluye solo las diferencias en efectivo de la jornada de registro. En compra se resta la diferencia; en venta se suma. cerrar_el_dia sigue usando esta misma función.
- Bitácora con folio, renglón, antes, después, diferencia, liquidación, autorizante y motivo. Los campos JSON «renglón», «después» y «liquidación» llevan tilde, como la interfaz solicitada.

## Decisiones tomadas sin consultar

1. **Cero kilos:** se rechaza con RC004. La corrección no ofrece anular por completo una cuenta con devolución, conforme al alcance indicado.
2. **Peso liquidable y descuento:** se compara contra peso_liquidable; el ajuste mueve su diferencia. No se recalcula ni se elimina el descuento original. Prueba concreta: recibido 30.2, liquidable 30, corregido 25 deja 25.2 en patio y devuelve $10.50. Al cambiar material se retiran los kilos liquidables vigentes y se agregan los nuevos, según la interfaz; el descuento original no se traslada.
3. **Correcciones sucesivas y precio:** mismo material significa el material vigente de la última corrección. Conserva su precio; cualquier cambio de material usa la lista histórica de la cuenta, incluso al regresar a un material anterior.
4. **Conteo posterior:** se conserva la barrera de 0017: RC005 si un conteo ya cubrió el movimiento en alguno de los materiales afectados. Evita corregir dos veces lo contado. Se prueba que no consume clave.
5. **Importes:** se usan centavos por renglón; no se rehace el redondeo a pesos cerrados del ticket. La diferencia es exactamente importe_despues menos importe_antes.
6. **Pendiente:** registra la diferencia sin modificar el cajón; no implementa deuda, abonos ni liquidación posterior.
7. **Contenido del envío:** incluye p_vistas y todos los datos de negocio y autorización; equivalencias numéricas y espacios exteriores del motivo se normalizan. Repetir con otra cantidad de correcciones vistas es otro contenido.
8. **Costo:** el importe a liquidar usa el precio histórico que corresponda; el costo del ajuste usa 0039. Por ejemplo, PET corregido de una cuenta antigua se liquida a $7.50/kg aunque el ajuste positivo sin existencias se valore a los $99/kg de la jornada actual de la prueba.
9. **Verificación adicional acotada:** además de las seis suites pedidas se corrió 08-permisos y solo GUARDIA de 39-bitacora por los archivos que se pidió modificar. No se ejecutó batería completa, recorridos ni simulacros.

## Pruebas finales con números

Todos los comandos se ejecutaron desde `/tmp/feruga-codex-qa14/`.

| Comando | Resultado final |
|---|---:|
| `sh qa/plantilla.sh` | 40 migraciones, salida 0 |
| `sh qa/prueba.sh pruebas/51-corregir-cuenta.test.ts` | 18/18 |
| `sh qa/prueba.sh pruebas/49-cajon.test.ts` | 24/24 |
| `sh qa/prueba.sh pruebas/50-costo.test.ts` | 14/14 |
| `sh qa/prueba.sh pruebas/18-inventario.test.ts` | 47/47 |
| `sh qa/prueba.sh pruebas/15-cuentas.test.ts` | 28/28 |
| `sh qa/prueba.sh pruebas/16-cierre.test.ts` | 8/8 |
| `sh qa/prueba.sh pruebas/08-permisos.test.ts` | 37/37 |
| `sh qa/prueba.sh pruebas/39-bitacora.test.ts GUARDIA` | 1/1 |
| `sh qa/tipos.sh` | Salida 0, sin errores |

**Total: 177 pruebas aprobadas; las seis suites solicitadas aportan 139.** Sin pruebas fallidas, canceladas u omitidas en estas corridas finales.

Caso principal: apertura $1,000; compra 30 kg a $2.10 = $63; cajón esperado $937. Corrección a 25 kg: importe $52.50, diferencia −$10.50, ajuste −5 kg con costo −$10.50, patio 25 kg, valor $52.50, cajón $947.50. El corte cuenta $947.50 y registra diferencia $0.00. Cuenta y renglones originales se comparan completos antes y después.

Concurrencia demostrada mediante pg_stat_activity, no una pausa supuesta: dos correcciones con vista 0 dejan una y rechazan la segunda con RC011; mismo envío devuelve el mismo registro sin gastar la clave mala del reintento; corrección antes del corte queda incluida; corte antes de corrección produce RC006.

## Qué falló y por qué

- Antes de implementar: 13/13 fallaron, principalmente por 42883 al no existir corregir_cuenta; un cruce tampoco pudo demostrar espera porque la función no existía. Es el rojo inicial solicitado.
- Durante la preparación de la nueva suite hubo tres corridas con un fallo propio: primero se usó un ayudante de búsqueda para un material inexistente; luego el INSERT de preparación carecía de familia_id y después de nombre_corto. Se corrigió exclusivamente pruebas/51. La corrida final pasa completa.
- Ninguna prueba existente ejecutada dejó de pasar. No se cambiaron expectativas existentes fuera de ENTRADAS y la cuenta de GUARDIA autorizadas.

## Qué no se hizo / límites

No quedó pendiente trabajo solicitado en esta entrega. La pantalla, sus rutas y una eventual liquidación posterior de diferencias pendientes quedan fuera del alcance de estos seis archivos. No se modificaron caja.ts ni cierre.ts: ambos siguen consultando esperado_en_cajon, y su desglose visual de correcciones corresponde a la integración de pantalla.

No se aplicó 0040 a la base del usuario; quedó aplicada solo a la plantilla QA y sus bases de prueba. La migración SQL se creó una vez y la plantilla se reconstruyó después; los ajustes posteriores fueron solo de pruebas.


---

## El encargo

```text
CONSTRUCCIÓN, una sola pasada: CORREGIR UNA CUENTA YA COBRADA (migración 0040) y sus pruebas.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL 17, Docker Compose). Todo en español.
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa14/   (al día: ya trae 0038 el cajón y 0039 el costo)
TU INFORME: /tmp/feruga-codex-informe-28.md

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
  db/migraciones/0040_corregir_una_cuenta_cobrada.sql
  pruebas/51-corregir-cuenta.test.ts
y cambia SOLO src/servidor/esquema.ts (ESQUEMA_ESPERADO), pruebas/08-permisos.test.ts (ENTRADAS),
src/servidor/dominio/bitacora.ts (frase de cada pareja nueva de anotar) y pruebas/39-bitacora.test.ts
(solo la cuenta de la GUARDIA). Si una prueba existente deja de pasar, anótala; arregla solo lo tuyo.

LO QUE QUIERE EL NEGOCIO (docs/planes/2026-10-15-caja-y-ganancia.md, parte 2; respuesta 6 del
cuestionario): si se dan cuenta a tiempo, la cuenta abierta se corrige ahí mismo (eso ya existe).
Si ya se cobró, es una corrección administrativa: «otro movimiento que liquida solo la diferencia,
con la clave de un responsable; nunca se borra ni se vuelve a pagar completo». El comprobante
original no se toca. La especificación (P1, P6) dice además: correcciones de error de registro,
autorizadas por personas nombradas (las facultadas para autorizar), sin cancelación con devolución.

LEE PRIMERO: db/migraciones/0017_inventario.sql (corregir_movimiento: el patrón de corrección del
inventario, con «correcciones vistas», clave y envío), 0038_el_cajon.sql (esperado_en_cajon, el
patrón de envíos del cajón), 0039_el_costo.sql (costo de los ajustes), 0007 (confirmar_operacion y
el movimiento de cada renglón), 0025/0027 (precio especial: precio_unitario, precio_lista), 0037
(estilo); src/servidor/dominio/caja.ts y cierre.ts.

═══ INTERFAZ FIJA (Claude escribe la pantalla contra ella) ═══
- correccion_de_cuenta: id, operacion_id, linea_id, numero (1, 2… por renglón), material_antes,
  material_despues, kg_antes, kg_despues (kilos que se pagan o cobran: el peso liquidable), precio
  (el que queda), importe_antes, importe_despues, diferencia (= importe_despues − importe_antes),
  liquidacion ('efectivo' | 'transferencia' | 'pendiente'), jornada_id (la abierta, en la que se
  registra), motivo, autorizado_por, registrado_por, creado_en, envio_id. Inmutable.
- corregir_cuenta(p_envio uuid, p_linea uuid, p_kg numeric, p_material int, p_vistas int,
  p_liquidacion text, p_motivo text, p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint)
  RETURNS correccion_de_cuenta — NULL si la clave no pasa (intento contado).
    · p_usuario: mostrador o responsable. p_autoriza: facultado (autorizo_con_clave de 0017).
    · El renglón es de una cuenta CONFIRMADA (si no: RC005). Hay jornada abierta (RC006 si no).
    · p_vistas: cuántas correcciones tenía ese renglón cuando se vio; si ya son más: RC011.
    · Lo vigente de un renglón es lo de su última corrección, o lo original. Corregir a lo mismo
      (mismos kilos y mismo material): RC005.
    · Mismo material: el precio es el que se cobró (precio_unitario, aunque haya sido especial).
      Otro material: el precio de lista de ese material en la lista de la jornada de la cuenta,
      de compra o de venta según la cuenta (sin precio ese día: RC009). Material dado de baja: RC005.
    · importe_despues = round(kg_despues × precio, 2).
    · El patio: ajustes (tipo 'ajuste', con referencia al movimiento del renglón y motivo claro) por
      la diferencia de kilos; si cambió el material, sale lo vigente del material de antes y entra lo
      corregido del nuevo. Con su costo, según las reglas de 0039. En una VENTA que aumenta kilos,
      lo que sale no puede dejar el patio en negativo (la regla de siempre).
    · Lo que no procede se rechaza ANTES de mirar la clave.
    · Envío: como los del cajón (repetirlo devuelve lo mismo; con otro contenido se rechaza;
      cancelar_envio sirve).
    · anotar(p_usuario, 'corregir', 'operacion', operacion_id, {folio, renglón, antes, después,
      diferencia, liquidación, autoriza}).
- esperado_en_cajon (CREATE OR REPLACE): suma también las correcciones registradas en esa jornada
  con liquidacion 'efectivo': en una COMPRA, una diferencia positiva es dinero que sale del cajón
  (se pagó de menos y se completa) y una negativa, dinero que entra (el vendedor devuelve); en una
  VENTA, al revés. Explícalo en un comentario. El corte (cerrar_el_dia) usa esa misma función.
- La aplicación lee la tabla (SELECT); no escribe directo.

═══ PRUEBAS (primero; míralas fallar) ═══ pruebas/51-corregir-cuenta.test.ts. Lo mínimo:
 - compra de 30 kg pagada; se corrige a 25 kg en efectivo: diferencia −$10.50, el patio baja 5 kg,
   el esperado del cajón sube $10.50, el comprobante original sigue igual.
 - venta corregida a más kilos por transferencia: el cajón no cambia; sin existencia suficiente: rechazo.
 - cambio de material: precio de lista de ese día; sale lo de antes, entra lo nuevo.
 - corregir dos veces el mismo renglón: la segunda parte de la primera; con p_vistas viejo: RC011.
 - mismo valor: RC005; cuenta abierta: RC005; sin jornada abierta: RC006; quien autoriza sin
   facultad: RC008 sin gastar intento; clave mala: NULL y el intento contado; patio y consulta: RC008.
 - envío repetido, cambiado y cancelado.
 - el corte de ese día cuadra con la corrección en efectivo incluida.
 - concurrencia: dos correcciones del mismo renglón a la vez, con espera demostrada.
Corre también 49-cajon, 50-costo, 18-inventario, 15-cuentas y 16-cierre; y sh qa/tipos.sh.

AL TERMINAR: el informe completo en /tmp/feruga-codex-informe-28.md (qué hiciste, decisiones
tomadas por tu cuenta, pruebas con números, qué falla y por qué, qué no alcanzaste). En tu
respuesta final, solo tres renglones y la ruta del informe.

```
