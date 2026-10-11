# Revisión de Codex al bloque de base de la aplicación, con ejecución

**Revisor:** Codex, modelo `gpt-6-astra`, esfuerzo alto. **Fecha:** 1 de octubre de 2026.
**Objeto:** tareas 1 a 3 del plan de la aplicación: `0012_mostrador.sql`, `0013_identidad.sql`, sus
pruebas, el piso del servidor (`bd.ts`, `errores.ts`, `numeros.ts`, `migrar.ts`, `rol.ts`) y la imagen.

Codex ejecutó con su propia plantilla para no estorbar: **356 pruebas, 356 aprobadas**, incluida la de
respaldo y restauración; **25 escenarios propios** (concurrencia con conexiones independientes,
reintentos, valores inválidos, conexiones interrumpidas, restauración con identidad); y construyó la
imagen `web` sin `DATABASE_URL`. No modificó el proyecto.

## Hallazgos (todos comprobados ejecutando, salvo el 9)

1. **Bloqueante — perder la conexión a media transacción tumba el proceso.** `bd.ts:46`. Terminó desde
   otra sesión la conexión que `enTransaccion` tenía reservada: el proceso Node salió con código 1 por un
   evento `error` sin manejador en el cliente, pese al `try/catch`. El manejador del pool solo cubre las
   conexiones ociosas. *Propone:* manejador durante toda la reserva, marcar la conexión inservible,
   rechazar la acción sin terminar el proceso; probarlo en un proceso hijo.

2. **Importante — descartar borra la memoria que impide resucitar la cuenta.** `0012:107`, `0012:295`.
   Abrir, descartar y repetir la apertura deja otra vez una cuenta (1 → 0 → 1). Además: repetir
   `abrir_cuenta` con otra etiqueta se acepta en silencio; y tras quitar un material, su identificador se
   puede reutilizar con **otra pesada y otro material**. *Propone:* conservar las intenciones procesadas
   con su contenido original aunque el objeto se elimine, y rechazar contenido distinto.

3. **Importante — dos personas entrando a la vez al mismo equipo: una falla con `23505`.** `0013:181`.
   El candado de la credencial serializa a una persona, no al equipo. *Propone:* serializar por equipo
   antes de comprobar la clave.

4. **Importante — se puede agregar material a una cuenta cuya jornada cerró mientras tanto.** `0012:134`,
   con la raíz en `0005:141`. Con `cerrar_jornada` a medio confirmar, `agregar_material` espera la cuenta
   pero ya había leído la jornada como abierta: termina bien y deja el material en una jornada cerrada.
   *Propone:* tomar `FOR SHARE` sobre la jornada antes de comprobar que sigue abierta.

5. **Importante — `asegurarRol` conserva privilegios de un usuario que ya existía.** `rol.ts:20`. Un rol
   previo miembro de `pg_write_all_data` siguió pudiendo `UPDATE credencial`. *Propone:* verificar
   membresías, privilegios y propiedad antes de reutilizarlo, y rechazarlo si excede.

6. **Importante — colisiones de identificador entre cuentas salen como `23505`.** `0012:139`. El mismo
   identificador de material en dos cuentas a la vez, o la misma pesada en dos materiales, eluden el
   rechazo de negocio. Lo mismo al canjear dos códigos con la misma huella (`0013:154`). Sin inserciones
   parciales. *Propone:* reservar los identificadores de forma atómica o manejar esas restricciones
   concretas, sin convertir cualquier `23505`.

7. **Importante — pesos y precios fuera de rango salen como `22003`.** `0012:23`, `0012:48`. `Infinity` o
   `1000000000` kg, e `Infinity` o `10000000000` de precio. *Propone:* comprobar finitud y rango antes de
   asignar.

8. **Menor — dos altas a la vez dejan dos personas activas con el mismo nombre.** `0013:271`. *Propone:*
   índice único parcial sobre el nombre de las personas activas.

9. **Menor — pruebas que pueden pasar sin demostrar lo que anuncian** (por lectura). `10-entradas:41`
   oculta un fallo con `.catch(() => {})` y no comprueba que se conserven los materiales. Las pruebas
   concurrentes hechas solo con `Promise.all` no garantizan que las dos lleguen juntas al punto de
   conflicto. *Propone:* transacción abierta, espera verificada desde una conexión observadora y
   liberación, como ya hacen otras pruebas del proyecto.

## Lo que encontró correcto

- `feruga_app` no conserva escrituras directas ni alcanza la consola ni el esquema `extensiones`; las
  funciones nuevas nacen sin ejecución pública.
- Los errores en incorporaciones y canjes deshacen la operación completa.
- Los fallos de clave se acumulan bajo concurrencia; alternar `entrar` y `verificar_clave`, o tener una
  sesión abierta, no reinicia el bloqueo.
- Vínculo sesión–equipo, caducidad, salida, bajas y cambio de clave.
- Seis cruces de las entradas contra confirmar: sin interbloqueo y con el rechazo esperado.
- `cuenta_resumen` coincide con lo asentado. La persona no se filtra entre conexiones. El candado del
  migrador serializa. La restauración conserva sesiones, fallos, `pgcrypto` y permisos.

## Lo que no comprobó

No detuvo el servidor compartido ni simuló la caída completa de Docker. No evaluó la consola ni las
cookies, que entraron durante su revisión.
