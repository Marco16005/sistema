# Codex construye: el costo del patio (0039) — corrida incompleta

> **20 de octubre de 2026.** Corrida de construcción de Codex (`gpt-6-astra`, esfuerzo alto). **Se cortó
> por cuota.** Alcanzó a escribir `db/migraciones/0039_el_costo.sql` y `pruebas/50-costo.test.ts`
> en su copia; su informe quedó a medias (abajo, tal cual). Claude revisó lo escrito, corrió las
> pruebas (50-costo 14/14) y las regresiones, y lo integró. Encargo: `encargo-27` (al final).

# Informe 27 — costo del patio

Estado: iniciado. Trabajo exclusivo en /tmp/feruga-codex-qa14/. No se modificarán archivos del proyecto del usuario ni se ejecutarán instalaciones.

## Plan y alcance
Leer reglas y QA; escribir pruebas 50 primero y observar el fallo; implementar 0039 y actualizar esquema; rehacer plantilla tras cada cambio SQL; ejecutar únicamente los archivos solicitados y tipos, de forma secuencial.

## Avance
- Informe creado antes de iniciar cambios de implementación.

## Decisiones
Pendientes de la lectura.

## Resultados
Pendientes.

## Pendientes y limitaciones
Implementación y verificaciones aún no realizadas.

### Paso 1: lectura y pruebas escritas
- Revisadas reglas de 0006, 0007, 0008, 0009, 0012, 0017, 0037 y confirmación vigente de 0038; panel, apoyo y permisos.
- Escritas 12 pruebas iniciales de costo antes de crear la migración. Incluyen migración real desde SQL hasta 0038, comparación con asientos nuevos, concurrencia con esperarQueEspere y permisos.
- La copia no contiene repositorio Git. El control de alcance será por los archivos editados, sin modificar nada del proyecto original.

### Paso 2: rojo comprobado
`sh qa/prueba.sh pruebas/50-costo.test.ts`: 12 pruebas, 0 pasan, 12 fallan (966 ms). Todas por ausencia de costo_material (42P01) o costo (42703), antes de implementar 0039.

Decisiones de implementación:
- Mantener candado de patio de 0006 y tomar costo_material FOR UPDATE.
- Fijar el ID definitivo después del candado: el identity se evalúa antes de esperar y puede quedar fuera del orden real. Los huecos de secuencia son normales.
- Guardar los productos planeados en transformacion para poder conocer el denominador antes del primer producto; reconstruir ese detalle desde el libro para historia.
- Separación: lista publicada de su jornada; material ausente vale cero, y si todo el denominador vale cero se usan kilos.
- Ajustes sin existencia: última lista publicada con fecha <= jornada del movimiento; si no tiene el material, cero (no buscar un precio viejo de otra lista).
- Apertura: primera jornada con lista publicada que incluya el material, aun si otras listas anteriores lo omitieron; antes de existir cualquier precio queda a cero y permanece inmutable.

### Paso 3: implementación inicial
- Creada 0039 con costo firmado inmutable, acumulado por material, reparto de separación y recálculo histórico usando la misma función de asiento.
- Actualizado exclusivamente ESQUEMA_ESPERADO en esquema.ts.
- No se agregan funciones ejecutables por feruga_app: no hace falta cambiar ENTRADAS de 08-permisos.
- El recálculo corre dentro de la transacción de migración con bloqueo del libro; desactiva solo su guardián de inmutabilidad mientras llena la nueva columna y lo restaura al terminar.
- Se crean saldos cero para el catálogo existente y un disparador para los materiales nuevos.

### Paso 4: primer verde
- `sh qa/plantilla.sh`: correcta, 39 migraciones.
- `sh qa/prueba.sh pruebas/50-costo.test.ts`: 12/12 pasan, 0 fallos (1.346 s).
- La prueba histórica ejecutó SQL de 0001 a 0038, creó historia y aplicó 0039: costos y saldos coinciden con la captura actual, sin cambiar IDs ni fechas originales.

### Paso 5: bordes adicionales
- Añadidos casos de reparto de un centavo entre dos productos y de ID reservado por una sesión bloqueada mientras la primera asienta una compra adicional.
- La historia ahora publica precios posteriores distintos para comprobar que no se usan precios de jornadas futuras en separaciones ya asentadas.
- Añadido índice (transformacion_id, id), parcial para separaciones: evita recorrer el libro entero por cada producto o encabezado histórico.

### Regresión 18-inventario
47 pruebas: 42 pasan, 5 fallan (14.782 s). Cuatro fallan con 42501 al llamar como aplicación el cierre antiguo de cuatro parámetros; la quinta espera un candado que no llega porque ese mismo cierre se rechaza por permisos. 0038 retiró esa entrada a feruga_app al exigir corte del cajón. 0039 no altera cierres ni sus permisos. No se modifican estas pruebas, según alcance solicitado.
Pruebas afectadas (líneas de 18-inventario.test.ts): 262, 282, 328, 583 y 640.

### Verificación 50-costo
Comando: `sh qa/prueba.sh pruebas/50-costo.test.ts`. Salida: 0.

```text
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1625.267126
```

### Verificación 19-dominio-inventario
Comando: `sh qa/prueba.sh pruebas/19-dominio-inventario.test.ts`. Salida: 0.

```text
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7886.714837
```

### Verificación 06-transformacion
Comando: `sh qa/prueba.sh pruebas/06-transformacion.test.ts`. Salida: 0.

```text
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 883.894959
```

### Verificación 05-apertura-ajustes
Comando: `sh qa/prueba.sh pruebas/05-apertura-ajustes.test.ts`. Salida: 0.

```text
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1555.963001
```

### Verificación 15-cuentas
Comando: `sh qa/prueba.sh pruebas/15-cuentas.test.ts`. Salida: 0.

```text
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2800.008418
```

### Verificación 37-panel
Comando: `sh qa/prueba.sh pruebas/37-panel.test.ts`. Salida: 0.

```text
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4233.695794
```

### Refuerzo de la prueba sin precios
Se cambiaron los pesos de los productos sin precio a 1 y 1.5 kg, con reparto esperado 40/60; así se distingue reparto ponderado de un reparto en partes iguales. Pendiente ejecutar esa variante final después de terminar la corrida secuencial actual.

### Verificación 40-demo
Comando: `sh qa/prueba.sh pruebas/40-demo.test.ts`. Salida: 0.

```text
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 35185.782766
```

### Verificación 08-permisos
Comando: `sh qa/prueba.sh pruebas/08-permisos.test.ts`. Salida: 0.

```text
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2526.742252
```

### Verificación tipos
`sh qa/tipos.sh`: salida 0.
```text
 Container feruga-pruebas-run-18dda7d369b7 Creating 
 Container feruga-pruebas-run-18dda7d369b7 Created 

```


---

## El encargo

```text
CONSTRUCCIÓN, una sola pasada: el COSTO de lo que hay en el patio (migración 0039) y sus pruebas.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL 17, Docker Compose). Todo en español.
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa14/   (la misma de tu encargo anterior; ya trae tu 0038)
TU INFORME: /tmp/feruga-codex-informe-27.md

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja SOLO en /tmp/feruga-codex-qa14/. No ejecutes npm ci ni npm install. No sustituyas su
  docker-compose.yml. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 más allá de lo que hacen los guiones de
  qa/, ni la base «feruga»: son del usuario.
- NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
- Tu cuota puede cortarse. Crea el informe al empezar y GUÁRDALO después de cada paso.

HERRAMIENTAS: las de qa/ (ver qa/LEEME.md). Rehaz la plantilla (sh qa/plantilla.sh) cada vez que
cambies la migración. NO corras la batería completa, recorridos ni simulacros.

ARCHIVOS: crea SOLO
  db/migraciones/0039_el_costo.sql
  pruebas/50-costo.test.ts
y cambia SOLO src/servidor/esquema.ts (ESQUEMA_ESPERADO = "0039_el_costo.sql"), y si agregas
funciones que la aplicación ejecute, pruebas/08-permisos.test.ts (ENTRADAS). Si alguna prueba
existente deja de pasar, anótala con la razón; arregla solo lo tuyo.

LO QUE QUIERE EL NEGOCIO (respuestas del dueño, docs/planes/2026-10-12-caja-y-ganancia-preguntas.md,
al final, puntos 8 a 11): saber cuánto le costó lo que vendió, para ver la ganancia por día, semana,
mes y material, y cuánto dinero tiene «parado» en el patio, valuado a lo que costó. Decisiones:
  · Costo PROMEDIO por material (promedio ponderado móvil, en el orden en que se asientan los
    movimientos del libro de inventario, movimiento_inventario).
  · Al SEPARAR (transformación) el costo de lo que se separó se reparte entre las partes según lo
    que vale cada una en la lista de COMPRA de ese día (kilos × precio de compra); lo que salió de
    basura —la merma de la separación, que no es producto— NO lleva costo: lo cargan las partes
    buenas. Si ninguna parte tiene precio ese día, se reparte por kilos.
  · Compactar, empacar, cortar o desoldar no cambian el material: no existen en el libro.
  · Lo dado de baja (merma) es PÉRDIDA del día en que se da de baja, a costo promedio.
  · Lo que ya había en el patio al empezar (movimientos de tipo 'apertura') se toma al precio de
    COMPRA de la lista del primer día publicado (la primera lista publicada que tenga precio para
    ese material); sin precio, a cero.
  · Nada de facturas ni impuestos.

LEE PRIMERO: db/migraciones/0006_inventario.sql (movimiento_inventario y sus reglas), 0008
(apertura, ajustes, revierte), 0009 (registrar_transformacion), 0017 (corregir_movimiento, conteos,
mermas), 0007 (confirmar_operacion: dónde nace el movimiento de compra y de venta), 0012
(operacion_linea, importe), 0037 (la más reciente, estilo); src/servidor/dominio/panel.ts (cómo lee
el panel; lo de la ganancia lo escribirá Claude contra lo que tú dejes).

═══ LO QUE HAY QUE CONSTRUIR (interfaz fija: Claude escribe el panel contra ella) ═══
1. movimiento_inventario.costo numeric(16,2) NOT NULL: lo que ese movimiento AGREGA (+) o QUITA (−)
   del valor del patio, en pesos. Se calcula al asentar el movimiento (un disparador BEFORE INSERT o
   lo que decidas) y no cambia después.
     · compra: + el importe de su renglón (operacion_linea.importe).
     · apertura: + kilos × precio de compra de la primera lista publicada con precio para ese material.
     · venta, merma, ajuste que resta, y el material de ORIGEN de una separación: − kilos × costo
       promedio de ese momento, en centavos; si el movimiento se lleva TODO lo que había, se lleva
       todo el valor (que no queden centavos huérfanos).
     · ajuste que suma: + kilos × costo promedio de ese momento; si no había existencia, a precio de
       compra de la lista de ese día (o de la última publicada); sin precio, a cero.
     · productos de una separación: el costo que salió del origen, repartido como dice arriba; los
       centavos del redondeo, al último producto. La suma de los productos es exactamente lo que
       salió del origen.
2. costo_material(material_id PK, kg numeric(14,3), valor numeric(16,2)): cuánto hay y cuánto
   vale a costo, al día con el libro. Cuando kg llega a cero, valor también. La aplicación lo lee.
3. Lo que ya existe en la base se recalcula al migrar, en el orden de asiento (id), con las mismas
   reglas: después de migrar, costo_material coincide con la suma del libro por material y cada
   movimiento tiene su costo.
4. Concurrencia: dos movimientos del mismo material a la vez no leen el mismo promedio; el segundo
   espera al primero (toma costo_material FOR UPDATE o equivalente). Pruébalo con espera demostrada
   (esperarQueEspere de pruebas/apoyo.ts), no con Promise.all solo.
5. Legible por la aplicación (SELECT); nada que la aplicación escriba directo.

═══ PRUEBAS (primero; míralas fallar) ═══ pruebas/50-costo.test.ts. Lo mínimo:
 - compra a dos precios distintos → el promedio; una venta saca a ese promedio; la ganancia de esa
   venta = importe − costo.
 - venta de todo lo que había → el valor queda en cero exacto.
 - merma → costo negativo a promedio (pérdida).
 - ajuste que suma y que resta (conteo), con y sin existencia previa.
 - apertura a precio de la primera lista; sin precio, cero.
 - separación con dos productos con precio y basura: el origen sale a promedio, los productos se
   reparten por valor de lista y la suma cuadra al centavo; separación sin precios: por kilos.
 - la migración recalcula una base con historia (arma movimientos con la plantilla anterior a 0039
   o con un recálculo que la migración deje como función) y queda igual que asentando uno por uno.
 - concurrencia con espera demostrada.
Corre también 18-inventario, 19-dominio-inventario, 06-transformacion, 05-apertura-ajustes,
15-cuentas, 37-panel y 40-demo; y sh qa/tipos.sh.

AL TERMINAR: el informe completo en /tmp/feruga-codex-informe-27.md (qué hiciste, decisiones
tomadas por tu cuenta, cómo quedaron las pruebas con números, qué falla y por qué, qué no
alcanzaste). En tu respuesta final, solo tres renglones y la ruta del informe.

```
