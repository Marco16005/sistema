# Codex construye: la base del cajón (0038)

> **20 de octubre de 2026.** Corrida de construcción de Codex (`gpt-6-astra`, esfuerzo alto), en su
> copia. Terminó completa: escribió `db/migraciones/0038_el_cajon.sql` y `pruebas/49-cajon.test.ts`
> (24/24). Las 35 pruebas de otros archivos que reportó en rojo eran pruebas existentes que todavía
> cerraban el día sin corte; Claude las adaptó al integrar. Al integrar, Claude cambió además una
> cosa: cerrar una jornada que no existe responde «La jornada no existe» (RC006) y no «cambió».
> Encargo: `encargo-26` (al final).

# Informe 26: base de datos del cajón

Finalizado el 20 de octubre de 2026. Copia de trabajo: `/tmp/feruga-codex-qa14/`.

## Resultado

Construidos los seis archivos autorizados. La migración 0038 se aplica tanto en una base vacía como sobre cuentas ya confirmadas. **49-cajon: 24/24 pasan. TypeScript: pasa.** Se ejecutaron los once archivos solicitados, uno por uno: **259 pruebas, 224 pasan y 35 fallan**, sin omitidas ni canceladas, considerando la última corrida de cada archivo. Los fallos restantes son incompatibilidades de pruebas existentes con la interfaz exigida y el problema de fechas de demo detallado abajo; no se alteró esa interfaz para hacerlos pasar.

No se modificó ningún archivo bajo `/Users/maantora/Desktop/feruga`. No se ejecutaron npm install/ci, la batería completa, navegador ni simulacros. Solo se accedió a Docker/base mediante los guiones de qa/. No se cambió docker-compose.yml. El informe se creó al empezar y se guardó tras cada etapa.

## Archivos entregados

| Archivo relativo a la copia | Cambio |
|---|---|
| `db/migraciones/0038_el_cajon.sql` | Nuevo: permiso, forma de pago, tablas y funciones del cajón, avisos, guardianes y concesiones. |
| `pruebas/49-cajon.test.ts` | Nuevo: 24 pruebas; ocho escenarios con espera demostrada y actualización de cuentas anteriores a 0038. |
| `src/servidor/esquema.ts` | ESQUEMA_ESPERADO = `0038_el_cajon.sql`. |
| `pruebas/08-permisos.test.ts` | Solo ENTRADAS: seis nombres nuevos; las funciones reemplazadas conservan su nombre. |
| `src/servidor/dominio/bitacora.ts` | Seis frases: permiso_de_corte/usuario, contar/cajon, sacar/caja, meter/caja, corte/jornada y ver/aviso. |
| `pruebas/39-bitacora.test.ts` | Solo cuenta de GUARDIA: 35 → 41. |

Se retiraron el registro temporal de la corrida roja y el `tsconfig.tsbuildinfo` generado por qa/tipos.sh, comprobando que este último nació durante esta sesión. No quedan archivos auxiliares nuevos. La copia no tiene .git; se comprobó el alcance por las escrituras realizadas y las fechas de modificación.

## Qué hace la migración

- Los responsables activos pueden hacer corte; mostrador necesita permiso explícito. Solo un responsable facultado, con clave, cambia ese permiso. La lista de administración conserva la lectura de bloqueos de 0035 y añade hace_corte calculado.
- Los borradores tienen forma_de_pago NULL. Las cuentas históricas confirmadas se completan con efectivo. Las confirmaciones nuevas fijan efectivo/transferencia junto con folio, importe y estado, sin subir revisión. Un reintento conserva la forma original.
- La apertura conserva lo dejado en el último corte de una fecha anterior. Guarda quién contó y cuándo; otra apertura nueva se rechaza con nombre y hora. Las diferencias producen avisos.
- Sacar y meter requieren responsable activo con clave, sin exigir puede_autorizar. Guardan quién registró y quién autorizó. No se impiden retiros por insuficiencia del importe esperado.
- Una única función calcula el efectivo con apertura, cuentas confirmadas en esa jornada, movimientos y retiros de cortes anteriores. Las transferencias quedan fuera; un vehículo terminado hoy entra en hoy.
- Cerrar pide apertura, permiso y clave, guarda corte por número de cierre, cierra a nombre de quien firma y genera aviso si no cuadra. Reabrir conserva su implementación; cerrar de nuevo requiere otro corte y descuenta los retiros previos.
- Los tres libros del dinero rechazan UPDATE/DELETE/TRUNCATE. Los avisos solo permiten el primer visto y cambios de enviado_en. La aplicación lee las tablas, sin escritura directa.
- La función de cierre de cuatro argumentos sigue existiendo para el dueño; se revoca a la aplicación. cerrar_jornada tampoco se concede y cerrar_jornada_abierta sigue ausente.

## Decisiones tomadas sin preguntar

1. **Resultado de los envíos en cada libro:** se añadió envio_id UNIQUE a apertura, movimiento y corte, en vez de extender envio_resultado. El libro inmutable es el resultado original del envío. Las clases nuevas son caja_apertura, caja_movimiento y caja_corte.
2. **Reintento simultáneo:** un candado transaccional por identificador serializa las entradas nuevas del cajón antes de leer su resultado. Todo envío pasa por reservar_envio: los existentes se comprueban ahí, los nuevos se reservan antes de escribir. Una clave mala devuelve NULL, conserva el intento y no reserva el identificador. Cancelar sigue usando la fila única de envio y gana o pierde frente a la reserva de la operación. No se guardan claves ni huellas en el contenido.
3. **Candados de jornada:** abrir y mover usan FOR UPDATE, para serializar también dos conteos distintos del mismo día; confirmar toma FOR SHARE y cerrar FOR UPDATE. Las firmas nuevas toman jornada antes de credencial. El corte calcula el esperado después de obtener el candado.
4. **Visibilidad del cálculo:** esperado_en_cajon es VOLATILE para leer lo confirmado por otra transacción mientras el cierre esperaba. La pantalla y el cierre usan exactamente esa misma fórmula.
5. **Dinero:** importes capturados entre cero y 99 999 999.99, rechazando NaN/infinito y fracciones que requieran redondeo; mover exige mayor que cero. Valores numéricos equivalentes, como 100 y 100.00, son el mismo contenido. Esperado y diferencia admiten signo y agregados del libro, porque sacar más de lo esperado está permitido. Todos los campos monetarios nuevos son numeric(14,2).
6. **Motivo:** se recortan extremos y se convierten secuencias de espacios, saltos y tabulaciones a un espacio; después se valida longitud 1–200. El contenido del envío usa ese texto limpio.
7. **Compatibilidad interna:** confirmar_operacion de tres argumentos se mantiene para consola/apoyos, delegando con efectivo en una interna de cuatro. Ninguna interna queda ejecutable por feruga_app. Se eliminan las antiguas confirmar_cuenta y terminar_vehiculo y se recrean con el argumento de forma por omisión.
8. **Antes de la clave:** se anticipa el rechazo de cuentas pendientes al cerrar, conservando cantidad y mensaje del cierre anterior. terminar_vehiculo comprueba rol, revisión, pesada y jornada destino antes de la clave.
9. **Migración de históricos:** durante el relleno de forma_de_pago se pone cuenta_con_su_cliente en modo inmediato, para no dejar eventos diferidos que impidan reactivar el guardián; después se devuelve a diferido. Esta necesidad la detectó la prueba de actualización con datos reales.
10. **Interfaz fija frente a pruebas antiguas:** no se restituyó el cierre sin corte a la aplicación, no se cambió cerrada_por para poner a la sesión en vez de al firmante, ni se debilitó hace_corte NOT NULL. No se editaron servidor, demo, apoyo ni pruebas fuera de lo autorizado.
11. **Apertura y cuentas:** no se exige contar el cajón para confirmar una cuenta; el plan reserva ese requisito a la pantalla. Sí se exige apertura para mover y cortar.

## Pruebas: resultado final por archivo

| Archivo | Total | Pasan | Fallan |
|---|---:|---:|---:|
| 49-cajon | 24 | 24 | 0 |
| 16-cierre | 8 | 7 | 1 |
| 25-reabrir-el-dia | 19 | 1 | 18 |
| 15-cuentas | 28 | 28 | 0 |
| 10-entradas | 84 | 76 | 8 |
| 08-permisos | 37 | 35 | 2 |
| 39-bitacora | 8 | 8 | 0 |
| 37-panel | 22 | 21 | 1 |
| 38-historial | 7 | 7 | 0 |
| 40-demo | 7 | 2 | 5 |
| 43-exportar | 15 | 15 | 0 |
| **Total** | **259** | **224** | **35** |

`sh qa/tipos.sh`: código 0, incluida la ejecución final tras añadir todas las pruebas. La plantilla se reconstruyó después de cada edición de 0038 y terminó con 38 migraciones.

### Pruebas primero y fallos propios corregidos

Antes de escribir la migración se ejecutó 49-cajon con las 17 pruebas iniciales: fallaron por la columna forma_de_pago ausente (42703), las funciones nuevas ausentes (42883) y aserciones de códigos de negocio aún inexistentes. Después de la primera migración pasaron las 17. Se añadieron pruebas de límites, cancelación, reintentos concurrentes y migración de históricos hasta llegar a 24.

Se corrigieron dos problemas propios encontrados al verificar:
- El rechazo anticipado de cuentas abiertas había perdido su cantidad; se restituyó el mensaje y el caso de 16-cierre pasó.
- La actualización de cuentas históricas dejaba eventos de trigger pendientes antes de ALTER TABLE; se resolvió con el modo inmediato descrito arriba. La prueba verifica que todos los campos originales, incluidos importes y revisión, quedan idénticos y que el borrador sigue con forma NULL.

### Por qué fallan las pruebas existentes

- **16-cierre, 1:** «con solo vehículos por volver sí se cierra, y quedan pendientes para después», línea 121. Espera cerrada_por = e.mostrador (`2`), pero la orden la firma Rosa (`5`). El contrato exige cerrar_jornada con p_hace, y eso queda guardado. El otro fallo inicial, el mensaje sin cantidad, ya está corregido.
- **25-reabrir-el-dia, 18:** el helper cerrar usa la conexión de aplicación y la función de cuatro argumentos. Ahora recibe 42501, también donde se esperaba RC006/RC012. Solo pasa la prueba de migrar jornadas anteriores. No se llega a verificar el resto de esos escenarios tras su preparación fallida; 49 comprueba reapertura y segundo corte por la nueva entrada.
- **10-entradas, 8:** dos cruces de cierre/agregar y seis casos de vehículo de otro día preparan el cierre con la función de cuatro argumentos como aplicación. Siete fallan directamente con 42501; el cruce que espera un bloqueo falla porque esa llamada se rechaza antes de esperar. Los nombres completos y trazas se conservan en el registro inferior.
- **08-permisos, 2:** «día completo» sigue usando CERRAR_EL_DIA como aplicación (42501). «una tabla temporal con el nombre de una real…» hace CREATE TEMP TABLE usuario (LIKE public.usuario), sin INCLUDING DEFAULTS; copia hace_corte NOT NULL sin su DEFAULT false y el INSERT antiguo no lo proporciona (23502), antes de probar la resolución de search_path. Pasan las guardias de funciones concedidas, search_path, privilegios PUBLIC y ausencia de escrituras directas.
- **37-panel, 1:** «el control cuenta lo que se dio de baja…» llama POST jornada/cerrar, línea 408, con id/jornada/cierres solamente. La ruta existente exige los datos de corte y devuelve 400 FORMA («Lo que hay en el cajón se escribe en pesos…»). No es un rechazo de la función SQL.
- **40-demo, 5:** C.2–C.5, C.6, los dos casos C.7 y C.8 fallan con 23514/vence_despues en consola/demo.ts:27, desplazar. El desplazamiento por columna deja tomada_en en 20 de octubre y vence_en en un día anterior; infringe vence_en > tomada_en, restricción de 0004. Esta migración no altera captura_peso ni su restricción. No se modificó demo ni se corrió un simulacro adicional para corregirlo.

## Qué queda pendiente

No quedó pendiente construcción de la interfaz A–G ni ejecución de los archivos solicitados. La batería indicada **no está completamente verde**: quedan las 35 fallas anteriores, cuya corrección requiere editar archivos/casos fuera del alcance o actualizar sus expectativas al contrato. No se ejecutaron la batería completa ni recorridos de navegador ni simulacros, por instrucción expresa. No se publicó, fusionó ni trasladó nada al proyecto del usuario.

## Registro de ejecución conservado

Lo que sigue es el registro incremental, con resultados intermedios ya superados cuando así se indica arriba.

# Informe 26: base de datos del cajón

Trabajo iniciado el 20 de octubre de 2026 en `/tmp/feruga-codex-qa14/`. No se modificarán archivos del proyecto del usuario. Alcance: los seis archivos autorizados y este informe. Las pruebas se ejecutarán secuencialmente mediante `qa/`.

## Avance
- Informe creado antes de comenzar la implementación.

## Decisiones
- Pendientes de documentar al leer los contratos y patrones existentes.

## Validación
- Pendiente: escribir y ejecutar 49-cajon antes de la migración.

## Pendiente
- Lectura, pruebas iniciales, migración y verificaciones solicitadas.

## Paso 1: lectura y pruebas escritas
- Leídos el plan de negocio, caja.ts, patrones de migraciones 0007, 0016, 0018, 0024, 0025, 0027, 0031, 0035, 0037, apoyo y reapertura.
- Escritas 18 pruebas iniciales en 49-cajon, incluyendo cuatro cruces con espera comprobada.
- Hallazgo previo: 25-reabrir-el-dia y el caso «día completo» de 08-permisos todavía llaman cerrar_el_dia de cuatro entradas como aplicación. Se respetará el REVOKE exigido y no se cambiarán esos casos no autorizados.
- La copia no tiene repositorio .git; se verificará el alcance mediante archivos modificados, sin operaciones de Git.

### Corrida roja (antes de escribir la migración)
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'parse_func.c',
    line: '629',
    routine: 'ParseFuncOrColumn'
  }


## Paso 2: migración y cuatro ajustes permitidos
- Implementados permiso, forma de pago, apertura, movimientos, corte y avisos; tablas de dinero inmutables y permisos SELECT sin escritura directa.
- La corrida roja falló por ausencia de forma_de_pago (42703) y funciones nuevas (42883), además de aserciones que esperaban códigos de negocio. La captura temporal de salida se retiró: no se conserva ningún archivo de registro adicional en la copia.
- Decisión: cada libro guarda su envio_id UNIQUE y su resultado original. Un candado transaccional por envío serializa reintentos; reservar_envio comprueba contenido/cancelación y reserva antes de escribir. Una clave mala deja libre el envío y conserva el intento. No se agrega otra variante a envio_resultado.
- Decisión: abrir y mover toman jornada FOR UPDATE para serializar también conteos simultáneos; confirmar toma FOR SHARE, corte FOR UPDATE. En las firmas nuevas el orden es jornada antes de credencial.
- Decisión: se mantiene confirmar_operacion de tres entradas para la consola/apoyos; delega en la interna de cuatro con efectivo. La aplicación no ejecuta ninguna interna.
- Decisión: esperado y diferencia admiten signo y el resultado agregado del libro; los importes capturados se limitan a 99 999 999.99 sin redondear. Sin apertura no se impide confirmar cuentas (regla del plan).
- Se anticipa el rechazo de cuentas pendientes al cerrar antes de mirar la clave, para no consumir intentos por una orden imposible.
- Cambiados ESQUEMA_ESPERADO, lista ENTRADAS, seis frases y únicamente la cuenta de la GUARDIA (35 → 41).

## Paso 3: primera validación de la construcción
- Plantilla reconstruida: 38 migraciones, sin errores.
- 49-cajon: 17 pruebas, 17 pasan, 0 fallan, 0 omitidas (3.83 s). Corrige el conteo provisional de 18 anotado al escribirlas.

### 16-cierre (salida 1)
```text
✔ el resumen del día trae lo que entró y salió por material, y cuánto hay que pagar y cobrar (176.148126ms)
✖ con cuentas por terminar no se cierra, y el resumen dice cuáles (136.061875ms)
✖ con solo vehículos por volver sí se cierra, y quedan pendientes para después (193.761167ms)
✔ una cuenta con un vehículo y además otro material ya pesado también deja cerrar (190.816083ms)
✔ cerrado el día, el resumen sigue mostrando ese día, ya cerrado (191.187667ms)
✔ sin ninguna jornada no hay resumen (48.425ms)
✔ cierra quien cobra: ni patio ni quien solo consulta (129.777083ms)
✔ el vehículo que se termina al día siguiente no cambia el cierre de ayer y aparece en el de hoy (447.946876ms)
ℹ tests 8
ℹ suites 0
ℹ pass 6
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1627.582876

✖ failing tests:

test at pruebas/16-cierre.test.ts:96:1
✖ con cuentas por terminar no se cierra, y el resumen dice cuáles (136.061875ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /2 cuentas abiertas/. Input:
  
  'Hay cuentas abiertas: se terminan o se descartan antes de cerrar'
  
      at Object.<anonymous> (file:///app/pruebas/16-cierre.test.ts:58:25)
      at expectedException (node:assert:578:17)
      at expectsError (node:assert:703:21)
      at strict.rejects (node:assert:769:3)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async file:///app/pruebas/16-cierre.test.ts:109:5
      at async file:///app/pruebas/16-cierre.test.ts:28:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'Hay cuentas abiertas: se terminan o se descartan antes de cerrar',
    expected: /2 cuentas abiertas/,
    operator: 'match',
    diff: 'simple'
  }

test at pruebas/16-cierre.test.ts:113:1
✖ con solo vehículos por volver sí se cierra, y quedan pendientes para después (193.761167ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  '5' !== '2'
  
      at file:///app/pruebas/16-cierre.test.ts:121:12
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async file:///app/pruebas/16-cierre.test.ts:28:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '5',
    expected: '2',
    operator: 'strictEqual',
    diff: 'simple'
  }
 Container feruga-pruebas-run-deb11faf5783 Creating 
 Container feruga-pruebas-run-deb11faf5783 Created 


```

### 25-reabrir-el-dia (salida 1)
```text
✖ cerrar dice cuál jornada y cuántos cierres llevaba, y la cuenta de cierres sube de uno en uno (152.435626ms)
✖ la jornada de hoy se reabre con la clave de quien autoriza: queda abierta, la misma, y queda registro (116.116458ms)
✖ no se reabre un día que no es hoy, ni lo que no está cerrado, ni una jornada que no existe (117.106125ms)
✖ quien autoriza debe poder autorizar y estar activo; la clave mal no reabre, queda contada y deja el envío sin gastar (128.404333ms)
✖ lo piden mostrador y responsable; patio, consulta y administración no. La aplicación no quita el cierre por su cuenta ni toca el registro (119.081041ms)
✖ una jornada cerrada sigue sin poder modificarse por ningún otro camino, tampoco para el dueño de la base (113.242709ms)
✖ la cuenta de cierres no se mueve a mano ni retrocede: solo sube, de uno en uno, al cerrar (114.817583ms)
✔ al llegar la migración, las jornadas que ya estaban cerradas quedan con un cierre y la abierta con ninguno (274.62825ms)
✖ una petición nueva de reabrir un cierre que ya no es el vigente se rechaza; repetir el mismo envío devuelve lo que hizo y no reabre otra vez (101.802334ms)
✖ una orden vieja de cerrar no cierra un día recién reabierto, ni la jornada del día siguiente (110.710042ms)
✖ el envío de cerrar y el de reabrir: con otro contenido, o cancelado, ya no sirve (124.416792ms)
✖ después de reabrir se atiende como si nada: se cobra, los precios siguen publicados y sin editarse, y los folios siguen su cuenta (123.027709ms)
✖ lo que pasó con el día cerrado no se deshace al reabrir: un vehículo descartado en ese rato no vuelve (119.795792ms)
✖ con la de hoy cerrada, abrir la jornada de hoy dice que se puede reabrir, no que «ya existe» (102.117792ms)
✖ dos reaperturas del mismo cierre a la vez: una reabre y la otra se entera de que ya no hay qué reabrir (104.556083ms)
✖ reabrir y volver a cerrar a la vez pasan uno tras otro, y cada uno deja lo suyo (111.251875ms)
✖ la reapertura que empezó antes de la medianoche y obtuvo el candado después se rechaza (102.468709ms)
✖ reabrir mientras otra sesión intenta abrir la jornada de hoy: se reabre la misma y no nace otra (102.402375ms)
✖ cerrar con cuentas por terminar sigue sin pasar, y no gasta el envío (106.308208ms)
ℹ tests 19
ℹ suites 0
ℹ pass 1
ℹ fail 18
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2475.631043

✖ failing tests:

test at pruebas/25-reabrir-el-dia.test.ts:80:1
✖ cerrar dice cuál jornada y cuántos cierres llevaba, y la cuenta de cierres sube de uno en uno (152.435626ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:83:19
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:91:1
✖ la jornada de hoy se reabre con la clave de quien autoriza: queda abierta, la misma, y queda registro (116.116458ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:94:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:124:1
✖ no se reabre un día que no es hoy, ni lo que no está cerrado, ni una jornada que no existe (117.106125ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:129:5
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async TestContext.<anonymous> (file:///app/pruebas/25-reabrir-el-dia.test.ts:126:3)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:143:1
✖ quien autoriza debe poder autorizar y estar activo; la clave mal no reabre, queda contada y deja el envío sin gastar (128.404333ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:146:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:173:1
✖ lo piden mostrador y responsable; patio, consulta y administración no. La aplicación no quita el cierre por su cuenta ni toca el registro (119.081041ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:176:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:191:1
✖ una jornada cerrada sigue sin poder modificarse por ningún otro camino, tampoco para el dueño de la base (113.242709ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:194:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:233:1
✖ la cuenta de cierres no se mueve a mano ni retrocede: solo sube, de uno en uno, al cerrar (114.817583ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:240:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:276:1
✖ una petición nueva de reabrir un cierre que ya no es el vigente se rechaza; repetir el mismo envío devuelve lo que hizo y no reabre otra vez (101.802334ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:279:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:297:1
✖ una orden vieja de cerrar no cierra un día recién reabierto, ni la jornada del día siguiente (110.710042ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:301:19
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:323:1
✖ el envío de cerrar y el de reabrir: con otro contenido, o cancelado, ya no sirve (124.416792ms)
  AssertionError [ERR_ASSERTION]: se esperaba RC012 y llegó 42501: permission denied for function cerrar_el_dia
  
  '42501' !== 'RC012'
  
      at Object.<anonymous> (file:///app/pruebas/apoyo.ts:57:12)
      at expectedException (node:assert:578:17)
      at expectsError (node:assert:703:21)
      at strict.rejects (node:assert:769:3)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async rechaza (file:///app/pruebas/apoyo.ts:55:3)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:328:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: '42501',
    expected: 'RC012',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at pruebas/25-reabrir-el-dia.test.ts:344:1
✖ después de reabrir se atiende como si nada: se cobra, los precios siguen publicados y sin editarse, y los folios siguen su cuenta (123.027709ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:349:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:363:1
✖ lo que pasó con el día cerrado no se deshace al reabrir: un vehículo descartado en ese rato no vuelve (119.795792ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:370:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:385:1
✖ con la de hoy cerrada, abrir la jornada de hoy dice que se puede reabrir, no que «ya existe» (102.117792ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:388:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:410:1
✖ dos reaperturas del mismo cierre a la vez: una reabre y la otra se entera de que ya no hay qué reabrir (104.556083ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:413:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:427:1
✖ reabrir y volver a cerrar a la vez pasan uno tras otro, y cada uno deja lo suyo (111.251875ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:430:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:446:1
✖ la reapertura que empezó antes de la medianoche y obtuvo el candado después se rechaza (102.468709ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:449:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:465:1
✖ reabrir mientras otra sesión intenta abrir la jornada de hoy: se reabre la misma y no nace otra (102.402375ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:468:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/25-reabrir-el-dia.test.ts:480:1
✖ cerrar con cuentas por terminar sigue sin pasar, y no gasta el envío (106.308208ms)
  AssertionError [ERR_ASSERTION]: se esperaba RC006 y llegó 42501: permission denied for function cerrar_el_dia
  
  '42501' !== 'RC006'
  
      at Object.<anonymous> (file:///app/pruebas/apoyo.ts:57:12)
      at expectedException (node:assert:578:17)
      at expectsError (node:assert:703:21)
      at strict.rejects (node:assert:769:3)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async rechaza (file:///app/pruebas/apoyo.ts:55:3)
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:485:5
      at async file:///app/pruebas/25-reabrir-el-dia.test.ts:60:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: '42501',
    expected: 'RC006',
    operator: 'strictEqual',
    diff: 'simple'
  }
 Container feruga-pruebas-run-0d2c67f1e546 Creating 
 Container feruga-pruebas-run-0d2c67f1e546 Created 


```

### 15-cuentas (salida 0)
```text
✔ una compra de tres materiales, de abrirla al comprobante (131.659167ms)
✔ repetir cada paso no duplica nada (115.509709ms)
✔ una cuenta que no existe no se ve, y no se le agrega nada (193.565667ms)
✔ la cuenta muestra cada material con su báscula, sus pesadas y lo que falta (96.724209ms)
✔ mientras falte una pesada la cuenta no se confirma (95.259501ms)
✔ las cuentas abiertas vienen en el orden en que se abrieron, con lo que llevan (94.242083ms)
✔ quitar, descontar, etiquetar y descartar devuelven la cuenta como quedó (90.565667ms)
✔ desde una cuenta no se toca el material de otra (89.397209ms)
✔ confirmar con la revisión de antes no confirma lo que ya cambió (131.636ms)
✔ la segunda pesada también cuenta como cambio de la cuenta (86.476792ms)
✔ patio arma la cuenta pero no la confirma ni le pone descuento (73.129042ms)
✔ una venta avisa cuando lo apartado ya no alcanza, y el libro rechaza la que sobra (83.05975ms)
✔ una compra no lleva avisos de disponibilidad (73.887ms)
✔ el vehículo de ayer aparece entre las cuentas abiertas, marcado (119.742042ms)
✔ el vehículo de ayer lo termina un responsable con su clave, al precio de ayer y asentado hoy (178.499042ms)
✔ con la clave equivocada el vehículo no se termina y el intento queda contado (178.977958ms)
✔ la clave de quien no es responsable no termina el vehículo, y la clave buena con revisión vieja tampoco (173.200208ms)
✔ la clave de un responsable no sirve para terminar a su nombre una cuenta de hoy (129.167042ms)
✔ el comprobante de un vehículo trae sus dos pesos (88.578ms)
✔ una cuenta que sigue abierta no tiene comprobante (70.886625ms)
✔ un comprobante se encuentra por su folio (84.624584ms)
✔ la primera impresión es el original; la segunda pide motivo y sale marcada (99.5215ms)
✔ repetir una reimpresión con otro motivo se rechaza (95.673916ms)
✔ repetir el registro de una impresión no suma otra (98.196875ms)
✔ leer el comprobante no cuenta como impresión (82.856583ms)
✔ dos impresiones a la vez toman números distintos (156.895958ms)
✔ solo se imprime una cuenta terminada, y la imprime quien cobra (81.314083ms)
✔ una impresión registrada no se cambia ni se borra (79.018709ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3194.682293
 Container feruga-pruebas-run-fa3a5a259346 Creating 
 Container feruga-pruebas-run-fa3a5a259346 Created 

```

### 10-entradas (salida 1)
```text
✔ abrir una cuenta la deja en la jornada de hoy, con su lista y a nombre de quien la abrió (106.866167ms)
✔ abrir de nuevo la misma cuenta devuelve la que ya estaba, con lo que llevaba (85.923209ms)
✔ una cuenta descartada no revive con un reintento (66.142917ms)
✔ la misma cuenta con otra etiqueta se rechaza; con la suya, aunque después se le haya cambiado, no (63.227ms)
✔ el mismo identificador de cuenta con otro sentido se rechaza (62.4365ms)
✔ una cuenta solo es de compra o de venta (56.638125ms)
✔ sin jornada abierta no se abre una cuenta (53.288583ms)
✔ con la lista de precios sin publicar no se abre una cuenta (51.102209ms)
✔ dos envíos a la vez de la misma cuenta dejan una sola (123.280666ms)
✔ agregar un material deja el renglón con su peso, el precio de la lista y la pesada a nombre de quien pesó (69.21525ms)
✔ en una venta el material sale al precio de venta (68.390708ms)
✔ repetir el envío de un material devuelve el mismo y no agrega otro (69.939167ms)
✔ el mismo envío con otro contenido se rechaza y no cambia nada (71.08875ms)
✔ una pesada ya usada no sirve para otro material (74.91875ms)
✔ un peso que la báscula no puede marcar no deja ni renglón ni pesada (63.003292ms)
✔ un peso con más de tres decimales se rechaza en vez de redondearse (69.022751ms)
✔ un peso en cero, negativo o que no es número se rechaza (62.261583ms)
✔ no se agrega a una cuenta que no existe ni a una ya confirmada (71.97925ms)
✔ un material sin precio hoy, o dado de baja, no se agrega (77.851ms)
✔ en la báscula grande el material queda esperando su segunda pesada (73.011667ms)
✔ dos envíos a la vez del mismo material dejan uno solo (136.031333ms)
✔ el mismo identificador de material en dos cuentas a la vez: la segunda se rechaza (139.46975ms)
✔ la misma pesada en dos materiales a la vez: la segunda se rechaza (154.71975ms)
✔ el identificador de un material que se quitó no sirve para agregar otra cosa (110.478458ms)
✔ un peso desmedido o infinito se rechaza como regla, no como error de la base (87.842709ms)
✖ cerrar la jornada mientras se agrega un material: el que llega segundo respeta al primero (105.468917ms)
✖ agregar un material mientras se cierra la jornada: el cierre espera y el material queda (5338.259336ms)
✔ en una compra el vehículo se pesa cargado y después vacío (72.54725ms)
✔ en una venta el vehículo se pesa vacío y después cargado (68.071041ms)
✔ repetir la segunda pesada devuelve lo ya asentado; con otro peso se rechaza (67.908208ms)
✔ una segunda pesada que no tiene sentido no deja pesada (65.642208ms)
✔ en báscula chica no hay segunda pesada, ni en un material que no existe (64.608292ms)
✖ el vehículo que vuelve otro día se pesa aunque su jornada ya cerró (58.317958ms)
✖ la confirmación ordinaria no termina un vehículo de otro día, ni siquiera en manos de un responsable (58.16925ms)
✖ lo termina un responsable que teclea su clave: queda a su nombre, al precio de ayer y asentado hoy (59.220041ms)
✖ con la clave equivocada el vehículo no se termina, la función contesta que no y el intento queda contado (62.69725ms)
✖ la clave de quien no es responsable no termina el vehículo (59.496959ms)
✖ lo que no procede se rechaza antes de mirar la clave: no gasta un intento (60.075792ms)
✔ quitar un material lo saca de la cuenta; repetirlo no falla (66.618ms)
✔ de una cuenta confirmada no se quita nada (66.941834ms)
✔ el descuento en kilos baja lo que se paga, no lo que entra al patio (66.45925ms)
✔ un descuento negativo, con más de tres decimales o mayor que el peso se rechaza (61.456583ms)
✔ la etiqueta se pone, se limpia y cuenta como cambio de la cuenta (58.026584ms)
✔ descartar una cuenta con materiales no deja cuenta ni renglones, pero sí rastro (65.67825ms)
✔ descartar una cuenta vacía no deja rastro: no pasó nada (56.174958ms)
✔ el responsable pone y cambia el precio de un material en la lista de hoy (54.563542ms)
✔ solo el responsable toca los precios (51.132708ms)
✔ un precio negativo, con más de cuatro decimales o que no es número se rechaza (53.316917ms)
✔ un precio desmedido o infinito se rechaza como regla (58.61425ms)
✔ no se pone precio a un material que no existe o está dado de baja (59.643667ms)
✔ quitar un precio deja al material sin precio; repetirlo no falla (56.895834ms)
✔ dos que guardan precios en orden contrario pasan uno tras otro, sin interbloquearse (117.067041ms)
✔ publicada la lista, sus precios ya no se ponen ni se quitan (55.864791ms)
✔ sin jornada abierta no hay lista donde poner precios (45.696542ms)
✔ una cuenta recién abierta se resume en ceros (55.930167ms)
✔ el resumen da la suma, el ajuste y el total en pesos cerrados, sin contar lo que falta por pesar (62.547583ms)
✔ lo que anuncia el resumen es lo que queda al confirmar (90.632625ms)
✔ abrir_cuenta rechaza a quien solo consulta, a administración y a quien ya no está (54.38175ms)
✔ abrir_cuenta deja pasar al mostrador y al responsable (57.582709ms)
✔ agregar_material rechaza a quien solo consulta, a administración y a quien ya no está (59.850916ms)
✔ agregar_material deja pasar al mostrador y al responsable (62.837708ms)
✔ segunda_pesada rechaza a quien solo consulta, a administración y a quien ya no está (65.803041ms)
✔ segunda_pesada deja pasar al mostrador y al responsable (67.01225ms)
✔ quitar_material rechaza a quien solo consulta, a administración y a quien ya no está (66.403542ms)
✔ quitar_material deja pasar al mostrador y al responsable (62.132625ms)
✔ etiquetar_cuenta rechaza a quien solo consulta, a administración y a quien ya no está (66.153625ms)
✔ etiquetar_cuenta deja pasar al mostrador y al responsable (70.135792ms)
✔ poner_recipiente rechaza a quien solo consulta, a administración y a quien ya no está (96.181584ms)
✔ poner_recipiente deja pasar al mostrador y al responsable (67.416875ms)
✔ descartar_cuenta rechaza a quien solo consulta, a administración y a quien ya no está (71.360666ms)
✔ descartar_cuenta deja pasar al mostrador y al responsable (71.740792ms)
✔ poner_descuento rechaza a quien solo consulta, a administración y a quien ya no está (70.278167ms)
✔ poner_descuento deja pasar al mostrador y al responsable (68.564583ms)
✔ abrir_cuenta deja pasar a patio, que arma cuentas pero no las confirma (57.312917ms)
✔ agregar_material deja pasar a patio, que arma cuentas pero no las confirma (58.526333ms)
✔ segunda_pesada deja pasar a patio, que arma cuentas pero no las confirma (61.468833ms)
✔ quitar_material deja pasar a patio, que arma cuentas pero no las confirma (63.181542ms)
✔ etiquetar_cuenta deja pasar a patio, que arma cuentas pero no las confirma (64.920458ms)
✔ poner_recipiente deja pasar a patio, que arma cuentas pero no las confirma (59.674666ms)
✔ descartar_cuenta deja pasar a patio, que arma cuentas pero no las confirma (63.116334ms)
✔ poner_descuento no es para patio (62.289584ms)
✔ la aplicación ya no escribe directo en cuentas, materiales, pesadas ni precios (61.940791ms)
✔ confirmar espera a quien está agregando un material, y al ver la cuenta cambiada no confirma (123.540208ms)
✔ quitar un material y confirmar la misma cuenta no se bloquean entre sí (131.23975ms)
ℹ tests 84
ℹ suites 0
ℹ pass 76
ℹ fail 8
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11407.928172

✖ failing tests:

test at pruebas/10-entradas.test.ts:355:1
✖ cerrar la jornada mientras se agrega un material: el que llega segundo respeta al primero (105.468917ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async file:///app/pruebas/10-entradas.test.ts:366:7
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/10-entradas.test.ts:377:1
✖ agregar un material mientras se cierra la jornada: el cierre espera y el material queda (5338.259336ms)
  Error: la segunda sesión nunca quedó esperando: no hubo bloqueo
      at esperarQueEspere (file:///app/pruebas/apoyo.ts:223:9)
      at async file:///app/pruebas/10-entradas.test.ts:387:7
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7)

test at pruebas/10-entradas.test.ts:466:1
✖ el vehículo que vuelve otro día se pesa aunque su jornada ya cerró (58.317958ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async vehiculoDeAyer (file:///app/pruebas/10-entradas.test.ts:457:3)
      at async file:///app/pruebas/10-entradas.test.ts:468:15
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/10-entradas.test.ts:476:1
✖ la confirmación ordinaria no termina un vehículo de otro día, ni siquiera en manos de un responsable (58.16925ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async vehiculoDeAyer (file:///app/pruebas/10-entradas.test.ts:457:3)
      at async file:///app/pruebas/10-entradas.test.ts:478:15
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/10-entradas.test.ts:489:1
✖ lo termina un responsable que teclea su clave: queda a su nombre, al precio de ayer y asentado hoy (59.220041ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async vehiculoDeAyer (file:///app/pruebas/10-entradas.test.ts:457:3)
      at async file:///app/pruebas/10-entradas.test.ts:491:15
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/10-entradas.test.ts:505:1
✖ con la clave equivocada el vehículo no se termina, la función contesta que no y el intento queda contado (62.69725ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async vehiculoDeAyer (file:///app/pruebas/10-entradas.test.ts:457:3)
      at async file:///app/pruebas/10-entradas.test.ts:507:15
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/10-entradas.test.ts:521:1
✖ la clave de quien no es responsable no termina el vehículo (59.496959ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async vehiculoDeAyer (file:///app/pruebas/10-entradas.test.ts:457:3)
      at async file:///app/pruebas/10-entradas.test.ts:523:15
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }

test at pruebas/10-entradas.test.ts:531:1
✖ lo que no procede se rechaza antes de mirar la clave: no gasta un intento (60.075792ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async vehiculoDeAyer (file:///app/pruebas/10-entradas.test.ts:457:3)
      at async file:///app/pruebas/10-entradas.test.ts:533:15
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }
 Container feruga-pruebas-run-98bd881c7698 Creating 
 Container feruga-pruebas-run-98bd881c7698 Created 


```

### 08-permisos (salida 1)
```text
✔ la aplicación no escribe directo en el libro de inventario (85.406208ms)
✔ la aplicación no escribe, cambia ni borra la bitácora (59.54ms)
✔ la aplicación no confirma una cuenta por su lado ni le pone folio (55.818208ms)
✔ la aplicación no escribe el peso ni el precio de un renglón (59.766458ms)
✔ la aplicación cambia y quita renglones solo por las funciones que dicen quién lo hace (68.217084ms)
✔ la aplicación no altera ni quita una pesada (65.11975ms)
✔ la aplicación no se da de alta personas ni se sube el rol (52.376334ms)
✔ la aplicación no abre, cierra ni publica saltándose las funciones (56.837833ms)
✔ la aplicación no puede apagar los disparadores (56.275542ms)
✔ la aplicación no crea objetos en el esquema (50.925417ms)
✖ una tabla temporal con el nombre de una real no engaña a las funciones (55.147875ms)
✔ una tabla temporal de básculas no engaña a la validación de la pesada (69.36975ms)
✔ todas las funciones del esquema fijan dónde buscan sus tablas (39.044209ms)
✔ la aplicación ejecuta las funciones de entrada y ninguna otra (59.002958ms)
✔ ninguna función del esquema queda abierta a cualquiera (56.427375ms)
✔ una función creada después nace cerrada para la aplicación (55.287917ms)
✔ la aplicación no escribe directo en ninguna tabla, y no lee las de identidad (63.666917ms)
✔ la aplicación no puede fijar la revisión de una cuenta (56.035333ms)
✖ con las credenciales de la aplicación se hace un día completo (159.895167ms)
✔ abrir_jornada rechaza a quien solo consulta (49.188791ms)
✔ abrir_jornada rechaza a una persona dada de baja (49.391916ms)
✔ publicar_lista rechaza a quien solo consulta (50.438ms)
✔ publicar_lista rechaza a una persona dada de baja (49.652333ms)
✔ confirmar_operacion rechaza a quien solo consulta (53.072ms)
✔ confirmar_operacion rechaza a una persona dada de baja (51.931ms)
✔ registrar_apertura rechaza a quien solo consulta (44.4435ms)
✔ registrar_apertura rechaza a una persona dada de baja (45.970291ms)
✔ cerrar_corte rechaza a quien solo consulta (43.464208ms)
✔ cerrar_corte rechaza a una persona dada de baja (52.116666ms)
✔ registrar_conteo rechaza a quien solo consulta (43.832333ms)
✔ registrar_conteo rechaza a una persona dada de baja (44.7015ms)
✔ registrar_merma rechaza a quien solo consulta (47.1945ms)
✔ registrar_merma rechaza a una persona dada de baja (43.068584ms)
✔ registrar_transformacion rechaza a quien solo consulta (44.429209ms)
✔ registrar_transformacion rechaza a una persona dada de baja (45.191125ms)
✔ cerrar_jornada rechaza a quien solo consulta (43.932625ms)
✔ cerrar_jornada rechaza a una persona dada de baja (43.306584ms)
ℹ tests 37
ℹ suites 0
ℹ pass 35
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2168.372709

✖ failing tests:

test at pruebas/08-permisos.test.ts:120:1
✖ una tabla temporal con el nombre de una real no engaña a las funciones (55.147875ms)
  error: null value in column "hace_corte" of relation "usuario" violates not-null constraint
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async file:///app/pruebas/08-permisos.test.ts:123:5
      at async file:///app/pruebas/apoyo.ts:273:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 247,
    severity: 'ERROR',
    code: '23502',
    detail: 'Failing row contains (424242, 1, Falso, responsable, t, t, null).',
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: 'pg_temp_37',
    table: 'usuario',
    column: 'hace_corte',
    dataType: undefined,
    constraint: undefined,
    file: 'execMain.c',
    line: '2022',
    routine: 'ExecConstraints'
  }

test at pruebas/08-permisos.test.ts:216:1
✖ con las credenciales de la aplicación se hace un día completo (159.895167ms)
  error: permission denied for function cerrar_el_dia
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async una (file:///app/pruebas/apoyo.ts:65:13)
      at async file:///app/pruebas/08-permisos.test.ts:244:23
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    length: 104,
    severity: 'ERROR',
    code: '42501',
    detail: undefined,
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: undefined,
    table: undefined,
    column: undefined,
    dataType: undefined,
    constraint: undefined,
    file: 'aclchk.c',
    line: '2843',
    routine: 'aclcheck_error'
  }
 Container feruga-pruebas-run-78a5bc9b342c Creating 
 Container feruga-pruebas-run-78a5bc9b342c Created 


```

### 39-bitacora (salida 0)
```text
✔ GUARDIA: toda pareja anotada en las migraciones tiene frase propia (17.959792ms)
✔ compra, merma y cierre salen recientes primero, con persona y hora del patio (111.850334ms)
✔ pagina sin repetir ni saltar; entrega 50 por omisión y limita a 200 (87.533125ms)
✔ filtra persona y día local, incluso juntos, y no expone detalle desconocido (60.614958ms)
✔ rechaza cursores, personas, cantidades y fechas mal formados (54.513291ms)
✔ las parejas tienen frases completas y resuelven nombres sin revelar datos internos (64.696166ms)
✔ ruta: responsable y consulta leen, los otros roles reciben ROL y sin persona da 401 (608.929ms)
✔ ruta: antes, persona o día inválidos devuelven 400 FORMA (328.080958ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1450.928334
 Container feruga-pruebas-run-7c9ebb79c5f7 Creating 
 Container feruga-pruebas-run-7c9ebb79c5f7 Created 

```

### 37-panel (salida 1)
```text
✔ el panel suma lo del periodo: cuentas, dinero en pesos cerrados y kilos, por compra y por venta (142.915958ms)
✔ la serie trae todos los días del periodo, también los que no tuvieron nada, y cada uno dice lo que su cierre (123.104333ms)
✔ lo anterior al periodo no entra en sus totales: es con lo que se compara (110.122334ms)
✔ sin nada en el periodo anterior no hay con qué comparar, y no se inventa un por ciento (110.245125ms)
✔ una cuenta que sigue abierta no cuenta en el panel (117.76175ms)
✔ a tres meses el panel va por semanas: trece tramos de siete días, sin perder ni repetir un día (102.629209ms)
✔ los materiales salen del que más kilos movió al que menos, con lo comprado y lo vendido de cada uno (110.636875ms)
✔ quién atendió, del que más cuentas terminó al que menos; y a qué hora, sin perder ninguna cuenta (108.670125ms)
✔ lo que hay en el patio vale lo que diría la última lista publicada, a precio de compra (160.516459ms)
✔ sin ningún día todavía, el panel sale vacío y no truena (67.853166ms)
✔ sin decir hasta cuándo, el periodo termina hoy, en la fecha del patio (143.137667ms)
✔ la cuenta promedio: lo que se paga y lo que entra por cuenta de compra, y lo que se cobra y sale por cuenta de venta (118.055375ms)
✔ por día de la semana: cuántas cuentas hubo y cuántas por cada día de ese nombre que cae en el periodo (111.798542ms)
✔ los kilos descontados: cuántos renglones, cuántos kilos en compras y en ventas, de qué materiales, y quién cobró esas cuentas (138.834209ms)
✔ los kilos de recipiente: cuántos renglones, cuántos kilos en compras y en ventas, y quién cobró esas cuentas (135.390042ms)
✔ de cada persona, lo que conviene vigilar: las cuentas que descartó, lo que corrigió y lo que reimprimió, aunque no haya cobrado nada (115.053292ms)
✔ un periodo elegido de tal día a tal día: lo suyo, día por día, y se compara con los mismos días de antes (233.161875ms)
✔ un periodo largo va por semanas, y uno de muchos meses, de cuatro en cuatro semanas: el último tramo termina el último día y no se pierde ninguno (125.601541ms)
✔ el panel lo ven quien dirige y quien consulta; el mostrador, el patio y la administración técnica, no (602.014792ms)
✔ el periodo es uno de los tres que hay; sin decirlo son siete días, y otro número no pasa (407.309542ms)
✖ el control cuenta lo que se dio de baja, lo que ajustó un conteo, los precios especiales y las veces que se reabrió el día (514.279334ms)
✔ el periodo también se elige de tal día a tal día; con fechas que no son, al revés o de más de un año, no pasa (419.154292ms)
ℹ tests 22
ℹ suites 0
ℹ pass 21
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4334.763252

✖ failing tests:

test at pruebas/37-panel.test.ts:389:1
✖ el control cuenta lo que se dio de baja, lo que ajustó un conteo, los precios especiales y las veces que se reabrió el día (514.279334ms)
  Error: POST /api/x respondió 400: {"error":{"codigo":"FORMA","mensaje":"Lo que hay en el cajón se escribe en pesos, con punto y hasta dos centavos"}}
      at Navegador.bien (file:///app/pruebas/navegador.ts:51:33)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async file:///app/pruebas/37-panel.test.ts:408:21
      at async file:///app/pruebas/37-panel.test.ts:360:5
      at async file:///app/pruebas/mundo.ts:49:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
 Container feruga-pruebas-run-bf1fdda83f9a Creating 
 Container feruga-pruebas-run-bf1fdda83f9a Created 


```

### 38-historial (salida 0)
```text
✔ los dos días salen del reciente al viejo y sus cuentas y totales coinciden con cada cierre (125.476667ms)
✔ un día sin cuentas tiene ceros y una cuenta sin confirmar no altera el historial ni el detalle (75.695042ms)
✔ el detalle ordena por folio numérico y trae hora del patio, tipo, total, renglones y quien confirmó (164.68225ms)
✔ el vehículo terminado mañana aparece solo mañana aunque su jornada de llegada sea ayer (185.412208ms)
✔ el historial entrega 31 días por omisión y nunca más de 100 (58.924041ms)
✔ ambas rutas dejan leer a responsable y consulta, rechazan los otros roles y piden persona (649.017792ms)
✔ las rutas rechazan fechas e identificadores inválidos con FORMA y un día inexistente con NO_EXISTE (341.831584ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1708.344584
 Container feruga-pruebas-run-f6839aa854bd Creating 
 Container feruga-pruebas-run-f6839aa854bd Created 

```

### 40-demo (salida 1)
```text
✔ C.1 recorrer conserva intervalos, deja lo anterior y restaura los disparadores (167.414292ms)
✖ C.2–C.5 jornadas, horas, panel, precios e inventario verosímiles (645.863626ms)
✖ C.6 misma semilla, misma historia; otra semilla cambia los importes (939.305625ms)
✖ C.7 rechaza fuera de desarrollo, parámetros inválidos y segunda corrida sin escribir (480.212333ms)
✖ C.7 conserva el arranque, personas e id de la jornada del dueño (550.819167ms)
✔ C.7 rechaza una jornada cerrada o varias jornadas sin movimiento (194.793834ms)
✖ C.8 mermas, conteos semanales y precios especiales aparecen en el panel (784.591625ms)
ℹ tests 7
ℹ suites 0
ℹ pass 2
ℹ fail 5
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3883.764419

✖ failing tests:

test at pruebas/40-demo.test.ts:81:1
✖ C.2–C.5 jornadas, horas, panel, precios e inventario verosímiles (645.863626ms)
  error: new row for relation "captura_peso" violates check constraint "vence_despues"
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async desplazar (file:///app/consola/demo.ts:27:5)
      at async conReplica (file:///app/consola/demo.ts:37:5)
      at async llevar (file:///app/consola/demo.ts:150:7)
      at async file:///app/consola/demo.ts:371:28
      at async llevar (file:///app/consola/demo.ts:149:21)
      at async sembrarDemo (file:///app/consola/demo.ts:334:9)
      at async file:///app/pruebas/40-demo.test.ts:83:13
      at async conBase (file:///app/pruebas/apoyo.ts:31:5) {
    length: 331,
    severity: 'ERROR',
    code: '23514',
    detail: 'Failing row contains (b3fed5af-7b63-4622-aed3-6ad164283b6d, 2, 61.278, tecleada, null, 2026-10-20 19:45:55.949443+00, 3, 2026-10-10 23:38:29.989443+00).',
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: 'public',
    table: 'captura_peso',
    column: undefined,
    dataType: undefined,
    constraint: 'vence_despues',
    file: 'execMain.c',
    line: '2074',
    routine: 'ExecConstraints'
  }

test at pruebas/40-demo.test.ts:142:1
✖ C.6 misma semilla, misma historia; otra semilla cambia los importes (939.305625ms)
  error: new row for relation "captura_peso" violates check constraint "vence_despues"
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async desplazar (file:///app/consola/demo.ts:27:5)
      at async conReplica (file:///app/consola/demo.ts:37:5)
      at async llevar (file:///app/consola/demo.ts:150:7)
      at async file:///app/consola/demo.ts:371:28
      at async llevar (file:///app/consola/demo.ts:149:21)
      at async sembrarDemo (file:///app/consola/demo.ts:334:9)
      at async file:///app/pruebas/40-demo.test.ts:146:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5) {
    length: 330,
    severity: 'ERROR',
    code: '23514',
    detail: 'Failing row contains (7b94e618-bf5a-4f5e-a17e-9756a2aa341b, 3, 2.010, tecleada, null, 2026-10-20 19:45:56.893185+00, 3, 2026-10-13 15:06:29.994185+00).',
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: 'public',
    table: 'captura_peso',
    column: undefined,
    dataType: undefined,
    constraint: 'vence_despues',
    file: 'execMain.c',
    line: '2074',
    routine: 'ExecConstraints'
  }

test at pruebas/40-demo.test.ts:159:1
✖ C.7 rechaza fuera de desarrollo, parámetros inválidos y segunda corrida sin escribir (480.212333ms)
  error: new row for relation "captura_peso" violates check constraint "vence_despues"
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async desplazar (file:///app/consola/demo.ts:27:5)
      at async conReplica (file:///app/consola/demo.ts:37:5)
      at async llevar (file:///app/consola/demo.ts:150:7)
      at async file:///app/consola/demo.ts:371:28
      at async llevar (file:///app/consola/demo.ts:149:21)
      at async sembrarDemo (file:///app/consola/demo.ts:334:9)
      at async file:///app/pruebas/40-demo.test.ts:169:5
      at async desarrollo (file:///app/pruebas/40-demo.test.ts:72:16) {
    length: 331,
    severity: 'ERROR',
    code: '23514',
    detail: 'Failing row contains (acb4feda-c7a4-4a7e-a928-92c3746b4cf9, 3, 19.972, tecleada, null, 2026-10-20 19:45:57.369214+00, 2, 2026-10-12 15:27:29.993214+00).',
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: 'public',
    table: 'captura_peso',
    column: undefined,
    dataType: undefined,
    constraint: 'vence_despues',
    file: 'execMain.c',
    line: '2074',
    routine: 'ExecConstraints'
  }

test at pruebas/40-demo.test.ts:178:1
✖ C.7 conserva el arranque, personas e id de la jornada del dueño (550.819167ms)
  error: new row for relation "captura_peso" violates check constraint "vence_despues"
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async desplazar (file:///app/consola/demo.ts:27:5)
      at async conReplica (file:///app/consola/demo.ts:37:5)
      at async llevar (file:///app/consola/demo.ts:150:7)
      at async file:///app/consola/demo.ts:371:28
      at async llevar (file:///app/consola/demo.ts:149:21)
      at async sembrarDemo (file:///app/consola/demo.ts:334:9)
      at async file:///app/pruebas/40-demo.test.ts:185:13
      at async conBase (file:///app/pruebas/apoyo.ts:31:5) {
    length: 331,
    severity: 'ERROR',
    code: '23514',
    detail: 'Failing row contains (f669ebda-0939-45ce-b3ff-43b5c23cedb5, 3, 27.772, tecleada, null, 2026-10-20 19:45:57.924975+00, 2, 2026-10-10 16:46:29.992975+00).',
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: 'public',
    table: 'captura_peso',
    column: undefined,
    dataType: undefined,
    constraint: 'vence_despues',
    file: 'execMain.c',
    line: '2074',
    routine: 'ExecConstraints'
  }

test at pruebas/40-demo.test.ts:211:1
✖ C.8 mermas, conteos semanales y precios especiales aparecen en el panel (784.591625ms)
  error: new row for relation "captura_peso" violates check constraint "vence_despues"
      at /app/node_modules/pg/lib/client.js:694:17
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async desplazar (file:///app/consola/demo.ts:27:5)
      at async conReplica (file:///app/consola/demo.ts:37:5)
      at async llevar (file:///app/consola/demo.ts:150:7)
      at async file:///app/consola/demo.ts:371:28
      at async llevar (file:///app/consola/demo.ts:149:21)
      at async sembrarDemo (file:///app/consola/demo.ts:334:9)
      at async file:///app/pruebas/40-demo.test.ts:212:3
      at async conBase (file:///app/pruebas/apoyo.ts:31:5) {
    length: 331,
    severity: 'ERROR',
    code: '23514',
    detail: 'Failing row contains (4cdfb035-d274-4173-ae91-ae6e00178849, 2, 61.278, tecleada, null, 2026-10-20 19:45:58.891485+00, 3, 2026-10-10 23:38:29.985485+00).',
    hint: undefined,
    position: undefined,
    internalPosition: undefined,
    internalQuery: undefined,
    where: undefined,
    schema: 'public',
    table: 'captura_peso',
    column: undefined,
    dataType: undefined,
    constraint: 'vence_despues',
    file: 'execMain.c',
    line: '2074',
    routine: 'ExecConstraints'
  }
 Container feruga-pruebas-run-1b37df4562b1 Creating 
 Container feruga-pruebas-run-1b37df4562b1 Created 


```

### 43-exportar (salida 0)
```text
✔ comoCsv lleva marca UTF-8, termina cada renglón con CRLF y deja null vacío (0.90175ms)
✔ comoCsv encierra comas, comillas y saltos y duplica las comillas (0.109334ms)
✔ comoCsv protege fórmulas solo en columnas de texto y conserva números negativos (0.072625ms)
✔ comoCsv desarma la fórmula que quedaría al principio de una celda en un programa que separa con punto y coma, tabulador o renglón (0.1165ms)
✔ comoCsv también desarma la fórmula escondida tras espacios, y la escrita con signos de ancho completo (0.137542ms)
✔ comoCsv no toca lo que no es fórmula: un guion o un signo en medio de un nombre, ni las columnas que no son de texto (0.096ms)
✔ cuentas ordena por fecha y folio, suma renglones y omite abiertas y días fuera del periodo (145.49175ms)
✔ cuentas conserva cliente y etiqueta y usa kilos recibidos aunque haya descuento (516.128124ms)
✔ el periodo rechaza fechas inválidas, orden invertido y más de 366 días incluidos (395.487083ms)
✔ dias coincide con cada cierre, incluye jornadas vacías y excluye las ajenas al periodo (135.096583ms)
✔ renglones conserva el orden de captura, descuento, precio especial y decimales de dos materiales (488.210084ms)
✔ precios exporta listas publicadas en orden por fecha, familia y material; omite la sin publicar (126.264666ms)
✔ ruta permite responsable y consulta y entrega cada CSV con marca y encabezados de descarga (471.243ms)
✔ ruta rechaza mostrador, patio y administracion con ROL y sin persona con 401 (544.368626ms)
✔ ruta devuelve JSON FORMA si falta un parámetro, la hoja no existe o el periodo es inválido (423.364708ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3360.240584
 Container feruga-pruebas-run-5dca08edeff8 Creating 
 Container feruga-pruebas-run-5dca08edeff8 Created 

```

## Paso 4: ajustes tras verificar compatibilidad
- Corregido un fallo propio de 16-cierre: el rechazo anticipado de cuentas abiertas conserva ahora la cantidad («Hay 2 cuentas abiertas…»).
- Se limpia el motivo colapsando espacios, saltos y tabulaciones antes de validar longitud y reservar el contenido.
- Añadidas seis pruebas: corte cancelado/cuentas pendientes antes de clave; tope/ceros/personas inactivas; reintentos simultáneos de los tres tipos; confirmación ordinaria antes del corte. Total previsto: 23.
- Diferencias de interfaz que no se corregirán fuera del alcance: cerrada_por debe ser quien firma, no la sesión; LIKE public.usuario sin INCLUDING DEFAULTS copia hace_corte NOT NULL pero no false; petición antigua a jornada/cerrar no lleva contado/se_queda/hace/clave.

### Verificación final: sh qa/prueba.sh pruebas/49-cajon.test.ts (salida 0)
```text
✔ forma de pago: omisión, transferencia, revisión e inmutabilidad (222.0545ms)
✔ terminar vehículo conserva la forma y cuenta en la jornada en que se terminó (212.384291ms)
✔ apertura: un conteo, reintento, cancelación, roles y jornada (210.230542ms)
✔ apertura guarda el último se_queda anterior: igual no avisa, distinto sí (265.625709ms)
✔ cantidades se rechazan sin redondear y antes de mirar la clave (133.362042ms)
✔ movimientos: responsables sin facultad, firma, reintento y envío cancelado (226.222292ms)
✔ movimientos: lo improcedente no prueba la clave; la clave mala cuenta y permite reintentar (273.132875ms)
✔ esperado suma solo efectivo y movimientos, con total en pesos cerrados (256.830792ms)
✔ corte: firma, reintento, aviso, permiso y día abierto ante clave mala (234.801667ms)
✔ reabrir exige otro corte y resta lo retirado; un reintento viejo no vuelve a cerrar (334.114042ms)
✔ permiso: facultad, clave, destinatario, bitácora y lista de personas (463.997667ms)
✔ ver aviso: solo responsable y la primera persona que lo vio se conserva (180.791375ms)
✔ libros inmutables y ninguna entrada para cerrar sin corte desde la aplicación (237.706209ms)
✔ concurrencia: movimiento entra antes del corte, el corte espera y lo cuenta (283.947959ms)
✔ concurrencia: corte entra antes, movimiento espera y encuentra cerrado (194.475292ms)
✔ concurrencia: confirmación entra antes del corte, el corte espera y lo cuenta (251.594042ms)
✔ concurrencia: corte entra antes, confirmación espera y encuentra cerrado (202.082542ms)
✔ el cierre cancelado y el cierre con cuentas abiertas no gastan clave ni dejan corte (187.429958ms)
✔ ceros, centavos y tope exacto; motivo limpio y personas inactivas (273.507042ms)
✔ dos envíos iguales de apertura a la vez esperan y devuelven el mismo resultado (192.461083ms)
✔ dos envíos iguales de movimiento a la vez esperan y devuelven el mismo resultado (187.122334ms)
✔ dos envíos iguales de corte a la vez esperan y devuelven el mismo resultado (189.281291ms)
✔ una confirmación ordinaria en curso detiene el corte y su efectivo se cuenta (199.2915ms)
ℹ tests 23
ℹ suites 0
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5526.057711
 Container feruga-pruebas-run-8e77a56d4c90 Creating 
 Container feruga-pruebas-run-8e77a56d4c90 Created 

```

### Verificación final: sh qa/prueba.sh pruebas/16-cierre.test.ts (salida 1)
```text
✔ el resumen del día trae lo que entró y salió por material, y cuánto hay que pagar y cobrar (181.633417ms)
✔ con cuentas por terminar no se cierra, y el resumen dice cuáles (165.583417ms)
✖ con solo vehículos por volver sí se cierra, y quedan pendientes para después (199.126042ms)
✔ una cuenta con un vehículo y además otro material ya pesado también deja cerrar (200.047167ms)
✔ cerrado el día, el resumen sigue mostrando ese día, ya cerrado (198.732334ms)
✔ sin ninguna jornada no hay resumen (54.1155ms)
✔ cierra quien cobra: ni patio ni quien solo consulta (132.084458ms)
✔ el vehículo que se termina al día siguiente no cambia el cierre de ayer y aparece en el de hoy (377.024667ms)
ℹ tests 8
ℹ suites 0
ℹ pass 7
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1619.928418

✖ failing tests:

test at pruebas/16-cierre.test.ts:113:1
✖ con solo vehículos por volver sí se cierra, y quedan pendientes para después (199.126042ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  '5' !== '2'
  
      at file:///app/pruebas/16-cierre.test.ts:121:12
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async file:///app/pruebas/16-cierre.test.ts:28:7
      at async conBase (file:///app/pruebas/apoyo.ts:31:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '5',
    expected: '2',
    operator: 'strictEqual',
    diff: 'simple'
  }
 Container feruga-pruebas-run-fb5caf75c315 Creating 
 Container feruga-pruebas-run-fb5caf75c315 Created 


```

### Verificación final: sh qa/tipos.sh (salida 0)
```text
 Container feruga-pruebas-run-c61bdc2af3a4 Creating 
 Container feruga-pruebas-run-c61bdc2af3a4 Created 

```

### Cierre de 49-cajon: actualización de datos anteriores incluida (salida 1)
```text
✔ forma de pago: omisión, transferencia, revisión e inmutabilidad (181.181541ms)
✔ terminar vehículo conserva la forma y cuenta en la jornada en que se terminó (185.058666ms)
✔ apertura: un conteo, reintento, cancelación, roles y jornada (180.1845ms)
✔ apertura guarda el último se_queda anterior: igual no avisa, distinto sí (220.976083ms)
✔ cantidades se rechazan sin redondear y antes de mirar la clave (144.435208ms)
✔ movimientos: responsables sin facultad, firma, reintento y envío cancelado (230.227625ms)
✔ movimientos: lo improcedente no prueba la clave; la clave mala cuenta y permite reintentar (282.707292ms)
✔ esperado suma solo efectivo y movimientos, con total en pesos cerrados (259.37275ms)
✔ corte: firma, reintento, aviso, permiso y día abierto ante clave mala (252.843751ms)
✔ reabrir exige otro corte y resta lo retirado; un reintento viejo no vuelve a cerrar (323.066916ms)
✔ permiso: facultad, clave, destinatario, bitácora y lista de personas (456.346209ms)
✔ ver aviso: solo responsable y la primera persona que lo vio se conserva (189.286209ms)
✔ libros inmutables y ninguna entrada para cerrar sin corte desde la aplicación (247.511792ms)
✔ concurrencia: movimiento entra antes del corte, el corte espera y lo cuenta (258.342417ms)
✔ concurrencia: corte entra antes, movimiento espera y encuentra cerrado (197.514541ms)
✔ concurrencia: confirmación entra antes del corte, el corte espera y lo cuenta (279.114042ms)
✔ concurrencia: corte entra antes, confirmación espera y encuentra cerrado (214.036084ms)
✔ el cierre cancelado y el cierre con cuentas abiertas no gastan clave ni dejan corte (198.543667ms)
✔ ceros, centavos y tope exacto; motivo limpio y personas inactivas (285.628083ms)
✔ dos envíos iguales de apertura a la vez esperan y devuelven el mismo resultado (197.786208ms)
✔ dos envíos iguales de movimiento a la vez esperan y devuelven el mismo resultado (172.628917ms)
✔ dos envíos iguales de corte a la vez esperan y devuelven el mismo resultado (177.291166ms)
✔ una confirmación ordinaria en curso detiene el corte y su efectivo se cuenta (188.648666ms)
✖ migrar conserva los importes y revisiones y marca efectivo en las cuentas antiguas (275.2065ms)
ℹ tests 24
ℹ suites 0
ℹ pass 23
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5738.549419

✖ failing tests:

test at pruebas/49-cajon.test.ts:396:1
✖ migrar conserva los importes y revisiones y marca efectivo en las cuentas antiguas (275.2065ms)
  Error: Falló la migración 0038_el_cajon.sql: cannot ALTER TABLE "operacion" because it has pending trigger events. Las anteriores quedaron aplicadas (0) y la base sigue cerrada para la aplicación hasta que esta entre.
      at aplicarPendientes (file:///app/db/migrar.ts:294:13)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async conCandado (file:///app/db/migrar.ts:71:12)
      at async file:///app/pruebas/49-cajon.test.ts:412:9
      at async conBaseVacia (file:///app/pruebas/apoyo.ts:46:5)
      at async TestContext.<anonymous> (file:///app/pruebas/49-cajon.test.ts:403:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7)
 Container feruga-pruebas-run-6dc493572ee8 Creating 
 Container feruga-pruebas-run-6dc493572ee8 Created 


```

## Paso 5: actualización de una base con datos
- La prueba adicional encontró un fallo real: el UPDATE de cuentas antiguas deja pendiente el trigger diferido cuenta_con_su_cliente y PostgreSQL impide ALTER TABLE para reactivar el guardián. Se ejecuta esa restricción en modo inmediato durante el relleno y se devuelve a diferido. Se reconstruye la plantilla tras corregirlo.

### Verificación tras corregir la actualización: sh qa/prueba.sh pruebas/49-cajon.test.ts (salida 0)
```text
✔ forma de pago: omisión, transferencia, revisión e inmutabilidad (183.376875ms)
✔ terminar vehículo conserva la forma y cuenta en la jornada en que se terminó (177.022542ms)
✔ apertura: un conteo, reintento, cancelación, roles y jornada (178.125875ms)
✔ apertura guarda el último se_queda anterior: igual no avisa, distinto sí (216.114792ms)
✔ cantidades se rechazan sin redondear y antes de mirar la clave (129.752458ms)
✔ movimientos: responsables sin facultad, firma, reintento y envío cancelado (210.821667ms)
✔ movimientos: lo improcedente no prueba la clave; la clave mala cuenta y permite reintentar (248.4225ms)
✔ esperado suma solo efectivo y movimientos, con total en pesos cerrados (225.359042ms)
✔ corte: firma, reintento, aviso, permiso y día abierto ante clave mala (207.748958ms)
✔ reabrir exige otro corte y resta lo retirado; un reintento viejo no vuelve a cerrar (306.958166ms)
✔ permiso: facultad, clave, destinatario, bitácora y lista de personas (430.264708ms)
✔ ver aviso: solo responsable y la primera persona que lo vio se conserva (171.875125ms)
✔ libros inmutables y ninguna entrada para cerrar sin corte desde la aplicación (209.507875ms)
✔ concurrencia: movimiento entra antes del corte, el corte espera y lo cuenta (220.567458ms)
✔ concurrencia: corte entra antes, movimiento espera y encuentra cerrado (173.8305ms)
✔ concurrencia: confirmación entra antes del corte, el corte espera y lo cuenta (237.126667ms)
✔ concurrencia: corte entra antes, confirmación espera y encuentra cerrado (187.9915ms)
✔ el cierre cancelado y el cierre con cuentas abiertas no gastan clave ni dejan corte (175.446625ms)
✔ ceros, centavos y tope exacto; motivo limpio y personas inactivas (249.716958ms)
✔ dos envíos iguales de apertura a la vez esperan y devuelven el mismo resultado (173.931125ms)
✔ dos envíos iguales de movimiento a la vez esperan y devuelven el mismo resultado (171.510792ms)
✔ dos envíos iguales de corte a la vez esperan y devuelven el mismo resultado (177.328417ms)
✔ una confirmación ordinaria en curso detiene el corte y su efectivo se cuenta (183.875ms)
✔ migrar conserva los importes y revisiones y marca efectivo en las cuentas antiguas (298.339042ms)
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5252.997419
 Container feruga-pruebas-run-f2e543a9a2cf Creating 
 Container feruga-pruebas-run-f2e543a9a2cf Created 

```

### Verificación tras corregir la actualización: sh qa/tipos.sh (salida 0)
```text
 Container feruga-pruebas-run-2d6fadfd91a8 Creating 
 Container feruga-pruebas-run-2d6fadfd91a8 Created 

```


---

## El encargo

```text
CONSTRUCCIÓN, una sola pasada: la base de datos del CAJÓN (migración 0038) y sus pruebas.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL 17, Docker Compose). Todo en español.
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa14/   (al día con el proyecto, 20 de octubre de 2026)
TU INFORME: /tmp/feruga-codex-informe-26.md

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja SOLO en /tmp/feruga-codex-qa14/. No ejecutes npm ci ni npm install. No sustituyas su
  docker-compose.yml. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 más allá de lo que hacen los guiones de
  qa/, ni la base «feruga»: son del usuario.
- NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
- Tu cuota puede cortarse. Crea el informe al empezar y GUÁRDALO después de cada paso. Los pasos
  van en orden: si se corta, que lo hecho sirva.

HERRAMIENTAS (ver qa/LEEME.md)
    sh qa/plantilla.sh                     rehace TU plantilla: hazlo cada vez que cambies la migración
    sh qa/prueba.sh <archivo> ['patrón']    corre un archivo de pruebas
    sh qa/tipos.sh                         tipos de TypeScript
    sh qa/sql.sh "<SQL>"                   SQL en una base desechable
NO corras la batería completa, ni recorridos del navegador, ni simulacros: eso se corre aquí.

ARCHIVOS: crea SOLO estos dos, y cambia SOLO los cuatro de la lista:
  crear:   db/migraciones/0038_el_cajon.sql
           pruebas/49-cajon.test.ts
  cambiar: src/servidor/esquema.ts            (ESQUEMA_ESPERADO = "0038_el_cajon.sql")
           pruebas/08-permisos.test.ts        (lista ENTRADAS: las funciones nuevas que la aplicación ejecuta)
           src/servidor/dominio/bitacora.ts   (una frase por cada pareja nueva de anotar(), como las demás)
           pruebas/39-bitacora.test.ts        (SOLO la cuenta de parejas de la GUARDIA)
Nada más.

EL SERVIDOR YA ESTÁ ESCRITO contra la interfaz de abajo (lo escribió Claude, y ya está en tu copia):
src/servidor/dominio/caja.ts (léelo: dice qué tablas, columnas y funciones usa), cierre.ts
(cerrarJornada con el corte), cuentas.ts (confirmar con forma de pago), comprobante.ts, dia.ts,
administracion.ts (permisoDeCorte), identidad.ts; las rutas en src/app/api/caja/, avisos/,
jornada/cerrar, administracion/personas/[persona]/corte. Y pruebas ya adaptadas: 16-cierre (cierra
con corte: cuenta el cajón y firma con clave), y las que solo necesitan un día cerrado usan el
cierre de cuatro entradas con la conexión del dueño (cerrarSinCorte en pruebas/apoyo.ts).
ÚSALO PARA COMPROBAR QUE TU MIGRACIÓN CASA: con ella, esos archivos tienen que pasar. Si algo no
casa, manda la interfaz de abajo; NO cambies el servidor ni esas pruebas: anota la diferencia.

LEE PRIMERO (lo justo): docs/planes/2026-10-15-caja-y-ganancia.md (parte 1: qué quiere el negocio
y las decisiones); src/servidor/dominio/caja.ts; db/migraciones/0024_reabrir_el_dia.sql
(cerrar_el_dia, reabrir_jornada: el patrón de envío, resultado y clave que hay que seguir);
0016_autorizacion.sql (confirmar_cuenta, terminar_vehiculo); 0007 (confirmar_operacion); 0025
(operacion_cambia, el guardián de cuentas); 0018 (reservar_envio y cancelar_envio: cancelar sirve
para cualquier envío que pase por reservar_envio, así que todo lo nuevo que tenga envío debe pasar
por ahí); 0031 (personas desde la pantalla: exigir_quien_administra, persona_que_se_administra y
cómo comprueban la clave); 0035 (comprobar_clave y personas_para_administrar); 0037 (la más
reciente, como ejemplo de estilo); pruebas/apoyo.ts (conApp, equipoDeAlta, personaConClave,
esperarQueEspere, CERRAR_EL_DIA, cerrarSinCorte); pruebas/25-reabrir-el-dia.test.ts.

ESTILO DE LA CASA: comentarios en español llano que digan el porqué; lo que no procede se rechaza
ANTES de mirar la clave (no gasta un intento); una clave que no pasa NO es error: la función
contesta nada (NULL) o falso, para que el intento quede contado; repetir el mismo envío devuelve lo
que hizo la primera vez y con otro contenido se rechaza (reservar_envio); todo registro de dinero es
inmutable (triggers rechazar_cambio de UPDATE/DELETE/TRUNCATE); SECURITY DEFINER con search_path;
códigos: RC004 número que no vale, RC005 forma, RC006 día/jornada, RC008 no le toca, RC011 lo que se
vio ya cambió, RC012 envío. Cantidades de dinero: numeric(14,2), de cero en adelante, hasta dos
decimales, sin NaN ni infinito, tope 99 999 999.99 (rechazar, no redondear).

═══ NOMBRES EXACTOS (el servidor ya los usa) ═══
  usuario.hace_corte
  operacion.forma_de_pago
  caja_apertura(jornada_id, contado, anterior, contado_por, contado_en)
  caja_movimiento(id, jornada_id, tipo, importe, motivo, registrado_por, autorizado_por, creado_en)
  caja_corte(jornada_id, cierre, esperado, contado, diferencia, se_queda, retirado, hecho_por, registrado_por, hecho_en)
  aviso(id, clase, jornada_id, diferencia, creado_en, creado_por, visto_por, visto_en, enviado_en)
  funciones: puede_hacer_corte, permiso_de_corte, confirmar_cuenta, terminar_vehiculo, abrir_el_cajon,
  mover_caja, esperado_en_cajon, cerrar_el_dia (nueva de nueve entradas), ver_aviso;
  personas_para_administrar con una columna más: hace_corte.
Puedes agregar columnas (por ejemplo, el envío), pero no cambiar ni quitar éstas.

═══ LO QUE HAY QUE CONSTRUIR (la interfaz es fija) ═══

A. EL PERMISO DE CORTE
   - usuario.hace_corte boolean NOT NULL DEFAULT false; solo puede ser true en rol 'mostrador'
     (los responsables lo tienen siempre, sin columna).
   - puede_hacer_corte(p_usuario bigint) RETURNS boolean: activo y (responsable, o mostrador con hace_corte).
   - permiso_de_corte(p_huella text, p_usuario bigint, p_clave text, p_persona bigint, p_puede boolean)
     RETURNS boolean — como las de 0031: pide un responsable FACULTADO (exigir_quien_administra) y su
     clave; la persona es de las que se administran (persona_que_se_administra) y de rol mostrador
     (si no: RC008 con frase clara). Clave que no pasa: false. Si ya estaba así: true sin anotar.
     Si cambia: anotar(p_usuario, 'permiso_de_corte', 'usuario', id, {"puede": ...}).
   - personas_para_administrar: que devuelva también hace_corte = puede_hacer_corte de esa persona
     (verdadero para los responsables). Cambia su tipo de salida: recrearla.

B. LA FORMA DE PAGO
   - operacion.forma_de_pago text, 'efectivo' o 'transferencia'; vacía mientras es borrador; toda
     confirmada la lleva (las ya confirmadas: 'efectivo'). Se fija al confirmar, en esa misma
     transacción; después no cambia (el guardián lo impide); fijarla NO sube la revisión.
   - confirmar_cuenta(p_cuenta uuid, p_usuario bigint, p_revision int, p_forma text DEFAULT 'efectivo')
     y terminar_vehiculo(p_cuenta uuid, p_revision int, p_responsable bigint, p_clave text, p_huella text,
     p_forma text DEFAULT 'efectivo'): quitar las de antes (DROP) y crear éstas, para que quien llama
     con las entradas de antes siga igual. Forma que no es ninguna de las dos: RC005, antes de todo.
     Repetir la confirmación de una cuenta ya confirmada devuelve lo de siempre y no cambia su forma.

C. CONTAR EL CAJÓN AL ABRIR
   - caja_apertura: una por jornada (jornada_id PK), contado, anterior (lo que se dejó —se_queda— en
     el último corte de un día anterior a éste; nada si nunca hubo corte), contado_por, contado_en.
     Inmutable.
   - abrir_el_cajon(p_envio uuid, p_jornada bigint, p_contado numeric, p_usuario bigint) RETURNS caja_apertura
     roles mostrador y responsable; la jornada tiene que ser la abierta y la que se nombra (RC006 si
     no); envío repetido devuelve la misma; si ese día ya se contó con otro envío: RC005 diciendo a qué
     hora y quién. Si hay anterior y el contado es distinto: un aviso de clase 'apertura' con la
     diferencia (contado − anterior). anotar(p_usuario, 'contar', 'cajon', jornada, {contado, anterior}).
     Toma la jornada contra su cierre como lo hace agregar un renglón.

D. SACAR Y METER
   - caja_movimiento: id, jornada_id, tipo 'sacar' | 'meter', importe > 0, motivo (texto limpio,
     1 a 200 letras), registrado_por, autorizado_por, creado_en. Inmutable.
   - mover_caja(p_envio uuid, p_jornada bigint, p_tipo text, p_importe numeric, p_motivo text,
     p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint) RETURNS caja_movimiento
     p_usuario: mostrador o responsable. p_autoriza: CUALQUIER responsable activo (no hace falta que
     sea facultado; si no es responsable: RC008 sin mirar la clave). Jornada abierta y nombrada; el
     cajón ya contado ese día (RC006 si no). Clave que no pasa: NULL (el servidor lee la columna id
     del resultado y entiende NULL como «la clave no pasó»). Repetir el envío devuelve el mismo sin
     pedir clave otra vez (sigue el patrón de reabrir_jornada con envio_resultado, o el que te parezca
     mejor; dilo). anotar(p_usuario, 'sacar'|'meter', 'caja', id, {importe, motivo, autoriza}).
     No se bloquea por «no alcanza»: el cajón real manda.

E. EL CORTE, AL CERRAR EL DÍA
   - caja_corte: (jornada_id, cierre) PK — cierre es el número de cierre de la jornada —, esperado,
     contado, diferencia (= contado − esperado), se_queda (0 ≤ se_queda ≤ contado), retirado
     (= contado − se_queda), hecho_por (quien firmó con su clave), registrado_por (la sesión),
     hecho_en. Inmutable.
   - esperado_en_cajon(p_jornada bigint) RETURNS numeric — UNA sola fórmula, que usan el corte y la
     pantalla (concédesela a la aplicación): apertura.contado
       + total de las VENTAS confirmadas en esa jornada (confirmada_en_jornada) con forma 'efectivo'
       − total de las COMPRAS confirmadas en esa jornada con forma 'efectivo'
       + lo metido − lo sacado en esa jornada
       − lo retirado en los cortes anteriores de esa misma jornada (si se reabrió).
     Sin apertura: NULL. (total = operacion.total, en pesos cerrados.)
   - cerrar_el_dia(p_envio uuid, p_jornada bigint, p_cierres int, p_contado numeric, p_se_queda numeric,
     p_hace bigint, p_clave text, p_huella text, p_usuario bigint) RETURNS cierre_hecho
     — la nueva entrada de la aplicación para cerrar. Orden: rol de p_usuario (mostrador o
     responsable); forma; envío repetido devuelve lo que hizo; puede_hacer_corte(p_hace) (RC008 si
     no); la jornada abierta con esos cierres (RC011 si no, como hoy); apertura del cajón (RC006 si
     no la hay); LUEGO la clave de p_hace (NULL si no pasa: el día sigue abierto y el intento queda
     contado; el servidor lee jornada_id y entiende NULL como «la clave no pasó»); luego cerrar
     (cerrar_jornada con p_hace como quien cierra), asentar el corte con el número de cierre que
     quedó, y si la diferencia no es cero un aviso de clase 'corte'.
     anotar(p_hace, 'corte', 'jornada', id, {esperado, contado, diferencia, se_queda, registro}).
     El esperado se calcula con la jornada ya tomada FOR UPDATE: un mover_caja o una confirmación a
     la vez o entra antes y se cuenta, o espera y encuentra el día cerrado. PRUÉBALO con espera
     demostrada (esperarQueEspere), no con Promise.all solo.
   - La cerrar_el_dia de CUATRO entradas se queda (las pruebas y la consola la usan con la conexión
     del dueño) pero la aplicación ya no la puede ejecutar: REVOKE a feruga_app. Revisa también que
     cerrar_jornada_abierta / cerrar_jornada no estén al alcance de la aplicación. Dilo en la migración.
   - Reabrir no cambia: el siguiente cierre pide su propio corte.

F. LOS AVISOS
   - aviso: id, clase 'corte' | 'apertura', jornada_id, diferencia, creado_en, creado_por (quien
     contó), visto_por, visto_en, enviado_en (vacío: lo usará el servidor para Telegram y correo).
     Solo visto_por/visto_en (una vez) y enviado_en cambian.
   - ver_aviso(p_aviso bigint, p_usuario bigint) RETURNS aviso: responsable; repetirlo no falla ni
     cambia quién lo vio. anotar(p_usuario, 'ver', 'aviso', id).

G. LO DEMÁS
   - Las tablas nuevas, legibles por la aplicación como las demás (SELECT); ninguna escritura directa.
   - envio: las clases nuevas que uses (amplía el CHECK como lo hizo 0024).
   - Concede a feruga_app las funciones de entrada nuevas y quita las que dejan de serlo; ponlas en
     ENTRADAS de pruebas/08-permisos.test.ts.

═══ PRUEBAS (primero; míralas fallar antes de escribir la migración) ═══
pruebas/49-cajon.test.ts, con la conexión de la aplicación (comoApp/conApp) donde aplique. Lo mínimo:
 1. Forma de pago: por omisión efectivo; transferencia queda; otra palabra RC005; no sube la
    revisión; ya confirmada no cambia; terminar_vehiculo con forma.
 2. Apertura: guarda «anterior» del último corte; diferencia → aviso 'apertura'; igual → sin aviso;
    mismo envío no duplica; segundo conteo con otro envío RC005; día cerrado o jornada que no es la
    abierta RC006; patio/consulta RC008.
 3. Sacar/meter: con clave buena queda con quién registró y quién autorizó; clave mala → NULL y el
    intento contado; quien autoriza no es responsable → RC008 sin gastar intento; importe 0, negativo,
    tres decimales, motivo vacío o de 201 letras → rechazo; sin apertura RC006; mismo envío no duplica;
    un envío cancelado (cancelar_envio) ya no entra.
 4. Esperado: con compras y ventas en efectivo y en transferencia, metido y sacado, da la fórmula
    exacta; las de transferencia no cuentan; un vehículo de otro día terminado hoy cuenta en hoy.
 5. Corte: cuadra → sin aviso; no cuadra → aviso 'corte' con la diferencia; se_queda > contado RC004;
    sin permiso RC008; mostrador con permiso sí; clave mala → NULL, el día sigue abierto; sin apertura
    RC006; reabrir y volver a cerrar: el segundo esperado ya resta lo retirado; la siguiente apertura
    guarda como «anterior» el se_queda; la aplicación ya no puede llamar la de cuatro entradas.
 6. Concurrencia: corte y mover_caja a la vez, con espera demostrada; corte y confirmar a la vez.
 7. Permiso: solo un responsable facultado con su clave; a mostrador sí; a patio, consulta o
    responsable no; queda en la bitácora; personas_para_administrar lo dice.
 8. ver_aviso: responsable sí, mostrador no; repetirlo no cambia quién lo vio.
Después corre: 49-cajon, 16-cierre, 25-reabrir-el-dia, 15-cuentas, 10-entradas, 08-permisos,
39-bitacora, 37-panel, 38-historial, 40-demo y 43-exportar; y sh qa/tipos.sh. Anota cuáles fallan y
por qué; arregla solo lo tuyo.

AL TERMINAR: el informe completo en /tmp/feruga-codex-informe-26.md: qué hiciste, cada decisión que
tomaste por tu cuenta, cómo quedaron las pruebas (con los números), qué pruebas existentes fallan y
por qué, y lo que no alcanzaste. En tu respuesta final, solo un resumen de tres renglones y la ruta
del informe.

```
