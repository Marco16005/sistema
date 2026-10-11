# Plan de implementación: núcleo de datos

> **Para quien lo ejecute:** se avanza tarea por tarea, con prueba primero (se escribe la prueba, se ve
> fallar, se escribe la migración, se ve pasar). Las casillas `- [x]` llevan el avance.

**Estado al 1 de octubre de 2026:** las nueve tareas están hechas. 234 pruebas, todas en verde, corriendo
dentro de contenedores (`docker compose run --rm pruebas`). El plan pasó por una revisión de Codex antes
de escribir el esquema, y el código por dos más al terminarlo: una de lectura y otra ejecutando. Los
hallazgos de las tres y lo que se hizo con cada uno están en `docs/revisiones/`.

**Objetivo:** dejar en PostgreSQL el núcleo de control del PFG —catálogo, precios del día, cuentas,
pesos, existencia derivada, correcciones, apertura, transformación y cierre— con sus reglas escritas
en la base y probadas, antes de construir ninguna pantalla.

**Arquitectura:** las reglas que no pueden romperse viven en la base, no en la aplicación: llaves
foráneas, columnas generadas, disparadores y permisos. El libro mayor de inventario solo se escribe
mediante funciones; la aplicación no tiene permiso de insertar, modificar ni borrar en él. La
existencia es una vista, nunca una columna.

**Herramientas:** PostgreSQL 17 en contenedor, migraciones en SQL plano aplicadas por un migrador
mínimo en TypeScript, pruebas con el corredor de pruebas de Node 24 y la biblioteca `pg`.

**Especificación:** `../ESPECIFICACION-TECNICA.md` y el Anexo D de
`../anteproyecto/ANTEPROYECTO-INTEGRADO.md`. El flujo validado con usuarios está en
`../prototipo/mostrador.html` y `../campo/REVISION-PROTOTIPO.md`.

## Restricciones globales

- **El proyecto es portátil.** La computadora de desarrollo no es la definitiva y no se conocen las
  características de la final. El único requisito de una máquina es Docker: nada depende de programas
  instalados en el sistema, de rutas absolutas ni de la arquitectura del procesador. La base de datos
  y las pruebas corren en contenedores con versión fijada; la configuración entra por variables de
  entorno; los datos viven en volúmenes. Levantar el proyecto en una máquina nueva es clonar y un
  comando.

- Peso en kilogramos, `numeric(12,3)`. Precio, `numeric(14,4)`. Importe, `numeric(14,2)`. **`float` prohibido.**
- Ninguna tabla tiene columna de existencia. La existencia es la vista `existencia`.
- Todo movimiento referencia un material por llave foránea obligatoria.
- Un registro confirmado no se edita ni se borra; se corrige con otro movimiento.
- Peso recibido (`bruto − tara`) entra al inventario; peso liquidable (`recibido − descuento`) se paga.
- El importe de cada renglón se redondea a centavos antes de sumar; el pago es en pesos cerrados y el
  ajuste por redondeo se guarda.
- El precio de un renglón sale de la lista publicada de la jornada, no de quien captura.
- El peso de un renglón sale de una pesada registrada, no se escribe directo en el renglón.
- Nombres de tablas, columnas y funciones en español, como en la especificación.
- Errores de negocio con código propio `RC001`–`RC011` (tabla en `README.md`).

## Cómo se trabaja: Claude y Codex en conjunto

El desarrollo se hace entre dos modelos, por indicación del responsable del proyecto. Codex corre con
el modelo `gpt-6-astra` a esfuerzo alto.

| Momento | Quién | Qué |
|---|---|---|
| Antes de escribir código | Codex | Revisa este plan y las decisiones de diseño contra la especificación; señala reglas sin prueba y riesgos |
| Cada tarea | Claude | Prueba primero, verla fallar, migración, verla pasar |
| Al cerrar un bloque de tareas | Codex | Revisión adversaria del código y de las pruebas contra la especificación |
| Tras cada revisión | Claude | Cada hallazgo confirmado se corrige con su prueba primero; el que no procede se responde con su razón |

Las revisiones se guardan en `docs/revisiones/` para que quede constancia de qué se objetó y qué se hizo.

## Decisiones de diseño del esquema

1. **El libro mayor solo se escribe con funciones.** `movimiento_inventario` y `bitacora` no reciben
   `INSERT`, `UPDATE` ni `DELETE` de la aplicación; las funciones que sí escriben corren con los
   permisos del dueño (`SECURITY DEFINER`, con `search_path` fijo).
2. **El peso de un renglón lo pone un disparador** al asentar una pesada (`linea_pesada` →
   `captura_peso`). La aplicación no tiene permiso de columna sobre el peso.
3. **El precio de un renglón lo pone un disparador** desde la lista publicada de la jornada, según sea
   compra o venta. La aplicación no tiene permiso de columna sobre el precio.
4. **Peso recibido, peso liquidable e importe son columnas generadas.** La aritmética no puede
   desviarse porque nadie la escribe.
5. **La existencia nunca es negativa**, garantizado en el disparador de inserción del libro mayor.
   Toda escritura al libro toma **un solo candado del patio** (`pg_advisory_xact_lock`) y exige
   aislamiento `READ COMMITTED`, de modo que la suma se lee después del candado y ve lo ya
   confirmado. Un candado en vez de uno por material: con una sola caja el rendimiento no importa y
   desaparece cualquier interbloqueo entre materiales.
6. **Doble pesaje como dos pesadas del mismo renglón**, del mismo instrumento, con el signo que
   corresponde: en compra la segunda es menor; en venta, mayor.
7. **Idempotencia por identificador de la estación.** La llave primaria de la operación la genera el
   cliente; confirmar una operación ya confirmada devuelve la misma sin escribir nada. Cada cuenta
   lleva una **revisión** que sube con cualquier cambio a sus renglones o pesadas; quien confirma
   manda la revisión que tenía a la vista, y si ya no coincide la confirmación falla en vez de
   asentar algo distinto. Contar renglones y sumar importes no basta: se puede cambiar un material
   por otro que cueste igual.
8. **Inmutabilidad por disparador y por permisos.** Una operación confirmada solo admite el cambio de
   su estado de pago, que queda separado del estado de registro desde la primera migración.
9. **La transformación conserva la masa por construcción.** Entra completa por una función que la
   valida y la escribe en una transacción; la merma no se recibe, se calcula como origen menos
   productos, así que el encabezado no puede contradecir al libro.
10. **Cada prueba corre en su propia base**, copiada de una plantilla recién migrada.
11. **Errores de negocio con código propio** `RC001`–`RC011`, para que la aplicación los traduzca sin
    interpretar textos. Los errores nativos de Postgres no se traducen. Toda función fija su ruta
    de búsqueda, para que una tabla temporal no pueda suplantar a una real.
12. **Cada edición bloquea el objeto cuyo estado la permite.** Editar una cuenta bloquea la cuenta;
    abrir una cuenta bloquea la jornada contra su cierre; cargar apertura bloquea la sucursal contra
    el cierre del corte; cambiar un precio bloquea la lista contra su publicación; asentar un
    movimiento bloquea su jornada contra el cierre. Una función de negocio por transacción.
    El momento de un movimiento es el de su asiento, tomado con el candado del patio, no el del
    inicio de su transacción.
13. **La base valida atributos; la identidad la acredita el servidor.** Las funciones reciben el
    identificador de la persona y comprueban su rol y su facultad, pero no pueden saber si quien llama
    es esa persona: eso lo garantiza la aplicación, que es la única con credenciales de `feruga_app`.
    La autenticación y la clave de quien autoriza pertenecen al plan de la aplicación.
14. **Una cuenta con vehículo pendiente sobrevive al cierre de su jornada.** La termina un responsable
    en una jornada posterior, con el precio original; sus movimientos caen en la jornada en que se
    confirma, de modo que un cierre ya hecho no cambia.
15. **Venta de mostrador con precio de lista.** El núcleo maneja un precio de compra y uno de venta.
    La venta por volumen con precio pactado llega con el crédito.
16. **El límite de cuatro cuentas abiertas es regla de la pantalla**, no de la base.
17. **Un solo orden de candados dentro de una cuenta: primero la cuenta, después el renglón.** Abrir un
    renglón, asentar una pesada, confirmar y descartar ya lo seguían; cambiar o quitar un renglón pasa
    por `fijar_descuento` y `quitar_renglon` para seguirlo también. La aplicación no modifica ni borra
    renglones directamente.
18. **Cada movimiento tiene un momento efectivo**, que es desde cuándo vale al reconstruir lo que el
    libro decía en una fecha. Normalmente es su asiento; una corrección vale desde lo que corrige y el
    ajuste de un conteo, desde que se contó. Así un conteo no vuelve a corregir lo ya corregido.
19. **El conteo es un registro propio** (`conteo`): lo contado, cuándo, lo que el libro decía y la
    diferencia. Su momento es obligatorio, no futuro y dentro de la jornada abierta, y no se admite
    uno más viejo que otro ya capturado del mismo material.

## Alcance de este plan y lo que deja fuera

Dentro: el esquema, sus reglas y sus pruebas. Fuera, para planes siguientes: la aplicación web, el
agente local, la lectura automática de básculas, la caja y el despliegue.

**En el núcleo el peso se teclea.** La integración de básculas está fuera del alcance del PFG
(anteproyecto D.10), así que en esta etapa quien opera elige la báscula y escribe el peso que marca
el display. El modelo ya distingue la pesada tecleada de la automática, para que conectar las básculas
después no cambie tablas.

## Estructura de archivos

```
sistema/
  docker-compose.yml               base de datos y corredor de pruebas, en contenedores
  docker/pruebas.Dockerfile        Node 24 y cliente de Postgres para las pruebas
  package.json                     scripts: bd, plantilla, test, migrar, tipos
  db/migrar.ts                     aplica en orden las migraciones que falten
  db/plantilla.ts                  arma la base plantilla de la que se copia cada prueba
  db/migraciones/
    0001_base.sql                  sucursal, usuario, bitácora, inmutabilidad, roles de persona
    0002_catalogo.sql              familias y los 27 materiales levantados en campo
    0003_jornada_precios.sql       jornada, lista de precios del día, publicación
    0004_instrumentos_capturas.sql básculas y pesadas
    0005_operaciones.sql           cuentas, renglones y pesadas de cada renglón
    0006_inventario.sql            libro mayor y vista de existencia
    0007_confirmacion.sql          confirmar una cuenta
    0008_apertura_ajustes.sql      saldo inicial, corte, ajustes y merma
    0009_transformacion.sql        separar material mezclado
    0010_cierre.sql                cierre de jornada y reportes
    0011_permisos.sql              rol de la aplicación
  pruebas/apoyo.ts                 base nueva por prueba, escenario y atajos
  pruebas/NN-*.test.ts             una por tarea
```

## Qué vigilar al revisar

Casos que la especificación implica y que más pueden morder a quien use el sistema:

1. **Dos ventas simultáneas del mismo material** que juntas rebasan la existencia: la segunda debe
   fallar, no dejar el saldo en negativo. Prueba en la tarea 4.
2. **Reintento de una confirmación** por red inestable: no debe duplicar movimientos ni folio. Tarea 4.
3. **Medio peso exacto** en el redondeo (10.50): debe ir a 11. Tarea 4.
4. **Cuenta con vehículo pendiente de segunda pesada** que alguien intenta terminar: debe negarse. Tarea 4.
5. **Arranque con saldo en cero**: sin existencia suficiente la venta se rechaza. Hay dos vías
   válidas para tenerla: una compra posterior, o un conteo registrado por persona facultada. Tarea 5.

## Tareas

### Tarea 1 · Base del proyecto
Archivos: `package.json`, `docker-compose.yml`, `docker/pruebas.Dockerfile`, `db/migrar.ts`, `db/plantilla.ts`,
`pruebas/apoyo.ts`, `0001_base.sql`, `pruebas/01-base.test.ts`.
Produce: tablas `sucursal`, `usuario`, `bitacora`; funciones `rechazar_cambio()`,
`exigir_rol(usuario bigint, VARIADIC roles text[])`, `anotar(...)`, `auditar()`.
- [x] Pruebas: la bitácora no admite modificar ni borrar; `exigir_rol` rechaza al rol equivocado y al
      usuario inactivo; cambiar un usuario deja rastro en bitácora; solo un responsable puede ser
      persona facultada.
- [x] Verlas fallar, escribir la migración, verlas pasar.

### Tarea 2 · Catálogo, jornada y precios
Archivos: `0002_catalogo.sql`, `0003_jornada_precios.sql`, `pruebas/02-catalogo-precios.test.ts`.
Produce: `familia`, `material`, `jornada`, `lista_precios`, `precio`;
`abrir_jornada(sucursal smallint, fecha date, usuario bigint) → jornada`,
`publicar_lista(lista bigint, usuario bigint)`.
- [x] Pruebas: 27 materiales en 6 familias y 4 frecuentes; ninguna tabla tiene columna de existencia;
      una lista publicada no se puede cambiar; solo un responsable publica; abrir jornada copia los
      precios de la última lista publicada; no puede haber dos jornadas abiertas.

### Tarea 3 · Básculas, pesadas, cuentas y renglones
Archivos: `0004_instrumentos_capturas.sql`, `0005_operaciones.sql`, `pruebas/03-cuentas-pesos.test.ts`.
Produce: `instrumento`, `captura_peso`, `operacion`, `operacion_linea`, `linea_pesada`.
- [x] Pruebas: una cuenta no nace sin lista publicada; el precio del renglón sale de la lista según
      compra o venta; el peso sale de la pesada y recibido, liquidable e importe se calculan solos; el
      descuento baja lo que se paga y no lo que entra; una pesada no sirve para dos renglones; pesada
      de otra báscula, vencida, fuera de capacidad o que no es múltiplo de la división se rechaza;
      doble pesaje en compra y en venta con su orden; varias cuentas abiertas a la vez; un renglón se
      quita mientras la cuenta está abierta.

### Tarea 4 · Libro mayor, existencia y confirmación
Archivos: `0006_inventario.sql`, `0007_confirmacion.sql`, `pruebas/04-existencia.test.ts`.
Produce: `movimiento_inventario`, vista `existencia`,
`confirmar_operacion(operacion uuid, usuario bigint, revision int) → operacion`, vistas `disponible` y `renglon_riesgo`.
- [x] Pruebas: 30 compras suben la existencia exactamente lo esperado (A2); 10 sobreventas se rechazan
      sin escribir nada (A3); conservación en cualquier corte; redondeo con los tres ejemplos del
      responsable y el medio peso; total impreso igual al almacenado; confirmar dos veces no duplica;
      no se confirma sin renglones ni con segunda pesada pendiente; dos ventas simultáneas; una cuenta
      confirmada no se modifica ni se borra, y una abierta sí se descarta; movimientos inmutables (A7).

### Tarea 5 · Apertura, ajustes y merma
Archivos: `0008_apertura_ajustes.sql`, `pruebas/05-apertura-ajustes.test.ts`.
Produce: `registrar_apertura(material int, kg numeric, origen text, usuario bigint)`,
`cerrar_corte(sucursal smallint, usuario bigint)`,
`registrar_conteo(material int, contado numeric, autoriza bigint, usuario bigint, nota text, contado_en timestamptz)`,
`registrar_ajuste(material int, kg numeric, motivo text, autoriza bigint, usuario bigint, referencia bigint)`,
`corregir_material(movimiento bigint, material int, motivo text, autoriza bigint, usuario bigint)`,
`registrar_merma(material int, kg numeric, motivo text, usuario bigint)`.
- [x] Pruebas: la apertura guarda si fue contada o estimada; cerrado el corte se rechaza (A8); el
      ajuste exige motivo y persona facultada; una corrección deja intacto el original y corrige el
      saldo; con saldo en cero la venta se rechaza hasta registrar el conteo; el primer conteo absorbe
      el error de una apertura estimada.

### Tarea 6 · Transformación de material
Archivos: `0009_transformacion.sql`, `pruebas/06-transformacion.test.ts`.
Produce: `transformacion`,
`registrar_transformacion(origen int, kg numeric, productos jsonb, nota text, usuario bigint) → transformacion`.
- [x] Pruebas: separar un lote mueve las existencias y conserva la masa; una transformación que no
      cuadra se rechaza completa.

### Tarea 7 · Cierre de jornada
Archivos: `0010_cierre.sql`, `pruebas/07-cierre.test.ts`.
Produce: `cerrar_jornada(jornada bigint, usuario bigint) → jornada`, vistas `cierre_material` y
`cierre_resumen`.
- [x] Pruebas: los totales por material coinciden con el recálculo independiente (A5); la jornada no
      cierra con cuentas abiertas; en una jornada cerrada no se abren ni se confirman cuentas.

### Tarea 8 · Permisos de la aplicación
Archivos: `0011_permisos.sql`, `pruebas/08-permisos.test.ts`.
Produce: rol `feruga_app`.
- [x] Pruebas: con el rol de la aplicación no se puede insertar, modificar ni borrar en el libro mayor
      ni en la bitácora, ni escribir peso o precio directo en un renglón, ni fijar el folio; y sí se
      puede hacer el flujo completo por las vías previstas.

### Tarea 9 · Respaldo que se restaura
Archivos: `pruebas/09-respaldo.test.ts`.
- [x] Prueba: se vuelca una base con operaciones, se restaura en otra y la existencia por material es
      idéntica; el siguiente folio no repite ninguno ya emitido (A9).
