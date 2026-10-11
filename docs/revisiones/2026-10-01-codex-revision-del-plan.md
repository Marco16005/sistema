# Revisión de Codex al plan del núcleo de datos

**Revisor:** Codex, modelo `gpt-6-astra`, esfuerzo alto. **Fecha:** 1 de octubre de 2026.
**Objeto:** `docs/planes/2026-10-01-nucleo-de-datos.md` contra `ESPECIFICACION-TECNICA.md` y los
documentos de campo. Solo lectura; no vio código. La respuesta a cada hallazgo está en
`2026-10-01-respuesta-a-la-revision-del-plan.md`.

Dictamen: *«No empezaría las migraciones sin cerrar los puntos críticos siguientes. El enfoque
general —libro mayor, existencia derivada y correcciones compensatorias— es adecuado.»*

## A. Las once decisiones del esquema

**Críticos**

- **A1. El candado consultivo no garantiza por sí solo una lectura actualizada.** Con `REPEATABLE
  READ`, la segunda transacción espera el candado pero sigue viendo la instantánea vieja y puede
  sobrevender. Fijar y comprobar el aislamiento admitido.
- **A2. Faltan bloqueos sobre los objetos cuyo estado habilita la escritura.** Confirmar mientras otra
  sesión agrega o quita un renglón; dos sesiones confirmando el mismo identificador; cerrar la jornada
  mientras otra abre una cuenta; cerrar el corte mientras otra carga apertura; publicar la lista
  mientras otra cambia un precio. El candado por material no coordina nada de esto.
- **A3. La frontera de autorización queda incompleta.** `exigir_rol(usuario)` demuestra que ese
  identificador tiene un rol, no que quien llamó sea esa persona; lo mismo con quien autoriza un
  ajuste. Además: `search_path`, ejecución concedida a `PUBLIC` por omisión y auxiliares que no deben
  ser interfaz pública.

**Altos**

- **A4.** Los bloqueos por material pueden interbloquear cuentas válidas con materiales en orden inverso.
- **A5.** La inmutabilidad debe cubrir todo el conjunto confirmado: renglones, vínculos, pesadas usadas,
  inserción directa de una operación ya «confirmada», y la excepción de pago limitada a su columna.
- **A6.** Rutas distintas de `INSERT`/`UPDATE`/`DELETE`: `TRUNCATE`, propiedad de los objetos,
  `session_replication_role`. No prometer resistencia frente al superusuario.
- **A7.** Columnas generadas: no encadenarlas, y definir la nulabilidad del renglón incompleto.
- **A8.** El disparador de saldo debe definir qué filas ve (antes o después de insertar).
- **A9.** La idempotencia definida es menor que la exigida: confirmar por identificador no distingue un
  reintento idéntico de uno con contenido distinto.
- **A10.** El precio congelado no queda protegido solo por llenar una columna: cambio de material,
  lista de otra jornada, y la distinción entre venta de menudeo y de mayoreo.
- **A11.** Conservar masa al final no garantiza una transformación íntegra: encabezado contra libro,
  cantidades negativas, disponibilidad del origen.

**Medios**

- **A12.** Doble pesaje: cardinalidad y ciclo de vida, además del signo.
- **A13.** Contrato numérico: importe a 2 decimales contra «dinero a 4» en la especificación; argumentos
  con más de tres decimales; `NaN`.
- **A14.** Los códigos de error no tienen todavía contrato comprobable.

## B. Pruebas que faltan

Confirmación simultánea del mismo identificador; edición de renglones durante la confirmación;
aislamiento no admitido; rutas directas con credenciales de la aplicación; cuenta con dos materiales
donde el segundo no alcanza; cuentas con materiales en orden inverso; cierre concurrente con apertura
de cuenta y corte concurrente con apertura; material inexistente, borrado de material referenciado y
`NaN`; tercera pesada, posición duplicada, peso cero en doble pesaje y pesada reutilizada tras quitar
el renglón; segunda pesada en otra jornada; publicación concurrente con cambio de precio; corrección
de material equivocado entre dos materiales; merma y ajuste mayores que el saldo; conteo concurrente
con venta; transformación sin saldo o con cantidades inválidas, comprobada al cierre de la
transacción; dos renglones de 1 kg a $0.3350; límite de cuentas abiertas y disponibilidad con ventas
abiertas; valor en riesgo y error relativo; cierre con todos los tipos de movimiento y ajuste
posterior que no altera una jornada cerrada; cada función pública con roles permitidos y prohibidos.

## C. Casos límite del dominio

- **C1 (alto).** El vehículo pendiente puede impedir abrir la jornada en la que debe completarse: no
  se puede cerrar hoy con la cuenta abierta ni abrir mañana, y la especificación admite la segunda
  pesada al día siguiente.
- **C2 (alto).** Corregir el material equivocado no cabe en una sola llamada de ajuste: hay que restar
  de uno y sumar a otro, de forma atómica.
- **C3 (alto).** Un conteo es un saldo observado; la firma de ajuste recibe una diferencia.
- **C4 (alto).** Arrancar en cero no significa prohibir ventas hasta un conteo: una compra posterior
  ya da existencia legítima.
- **C5 (medio).** La báscula grande no reparte una carga entre materiales.
- **C6 (medio).** Falta identificar con qué material del catálogo se compra una mezcla.
- **C7 (medio).** El cierre puede cambiar después de cerrado si un movimiento posterior cae en él.
- **C8 (medio).** Importe calculado no equivale a pago realizado.
- **C9 (bajo).** Los documentos discrepan sobre el catálogo: 27 materiales, seis familias de navegación.

## D. Qué simplificar para un solo patio

- **D1.** Serializar por material puede ser complejidad prematura: considerar un único bloqueo del patio.
- **D2.** El disparador diferido de la transformación puede ser innecesario si todo entra por una función.
- **D3.** La prueba de «total impreso» promete una integración fuera de alcance.

## E. Portabilidad y forma de probar

- **E1.** Copiar una base no aísla todo: los roles son del clúster, no de la base.
- **E2.** Restaurar en otra base del mismo clúster oculta dependencias: `pg_dump` no incluye roles.
- **E3.** Restaurar datos no vuelve a ejecutar las garantías: hace falta una auditoría posterior.
- **E4.** «Cliente de Postgres» no fija compatibilidad: debe ser el 17 y dentro del contenedor.
- **E5.** Las pruebas concurrentes necesitan dos conexiones a la misma base y barreras verificables, no esperas arbitrarias.
- **E6.** Criterios verificables de «solo Docker»: zona horaria, código de salida, paralelismo acotado.
