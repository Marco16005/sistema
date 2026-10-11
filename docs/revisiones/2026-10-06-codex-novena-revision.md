> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-9.md`. **Quedó incompleto:** terminó la parte A y se le acabó la cuota
> a los cuatro minutos, empezando la B («You've hit your usage limit… try again at Oct 9th, 2026
> 10:09 PM»). Las partes B y C —el rediseño, tareas 0, 1 y 2— **no están revisadas**. Lo que dejó
> en sus registros sin redactar, y lo que se hizo con ello, está en la respuesta:
> `2026-10-06-respuesta-a-la-novena-revision.md`.

# Novena pasada de calidad — 2026-10-06

- [x] Parte A — Marca de restauración: completa; tarea 3 cerrable.
- [ ] Parte B — Rediseño, tareas 0 y 1: en curso.
- [ ] Parte C — Rediseño, tarea 2: pendiente.
- [ ] Limpieza y comprobación final.

Revisión sobre copia en `/tmp/feruga-codex-qa9/`, sin modificar el original. No se repiten las verificaciones cerradas en la séptima salvo las reproducciones solicitadas. Clasificación: bloqueante / importante / menor.

Arranque inicial de contenedores del usuario:
- feruga-web-1: `2026-10-06T18:27:32.651225421Z`, running.
- feruga-db-1: `2026-10-06T16:16:00.606274421Z`, running.

## Parte A — Completa, con ejecución

**Veredicto: sí, cerrar la tarea 3 de restauración dentro del alcance escrito. Sin hallazgos nuevos.** A7-C-I1 y la pista de la octava quedan corregidos.

Una sola batería completa propia: tipos aprobados; **650/650**, cero fallos, cero omitidas, 115.27 s (`bateria.log`). Incluye la reproducción real con `pg_dump`/`pg_restore` de la secuencia de folios renombrada: se rechaza antes de migrar, después de migrar y después del intento de retirar la antigua. La prueba comprueba la ruta de salud en operación, no solo la función SQL. Registrar la restauración sí habilita la base y salta el bloque de folios.

La reproducción incorporada de la octava pasa: serial, identity, varias tablas y secuencia suelta se retiran declaradamente y se eliminan; recreación posterior y recreación dentro de la misma migración conservan la marca. Además ejecuté `qa9-a.ts` (`a-dirigida.log`): serial + identity + secuencia suelta retiradas y recreadas juntas, con marca estricta vigente. Dos retiros pendientes sin DROP dejan la comprobación estricta falsa; ROLLBACK restituye la marca. La variable que escribe la función desaparece al COMMIT/ROLLBACK (puede quedar la cadena vacía del parámetro personalizado, sin OID exceptuados).

**`feruga.retiradas` no es una credencial.** Una conexión puede falsificarla e incluso ponerla a nivel de sesión; lo ejecuté tanto como administrador como con el rol de aplicación. Con una tabla extra, `SQL_DE_VIDA` sigue dando falso: la aplicación y el chequeo previo del migrador no leen esa variable. El rol de aplicación recibe `42501` al intentar `vida_retirar`. Una configuración de sesión puesta expresamente por el administrador sí puede sobrevivir, pero no vuelve apta a la base. No debe confundirse con el `set_config(..., true)` local que usa la función. Manipular además la marca como administrador cae en el emparejamiento manual excluido.

Revisión adicional del mecanismo: ambas diferencias del conjunto se calculan contra OID de tablas/secuencias de `public`, además de identidad de servidor/base; renombrar no concede identidad a un objeto nuevo. El migrador solo incorpora objetos si el conjunto era exacto antes y no faltan objetos después. Los retiros recorren las dependencias `a` e `i` de secuencias de columnas; una secuencia suelta requiere su propia llamada. No encontré otra restauración no registrada aceptada dentro de lo prometido. No se presentan como hallazgos las exclusiones documentadas (copia física, datos solos, funciones/vistas/disparadores, intervención administrativa en la marca).

