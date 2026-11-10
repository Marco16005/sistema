# La base de datos de la operación: la imagen oficial de PostgreSQL, por su huella y sin cambios.
# Este archivo solo dice cuál es. Publicar no la construye: toma esa misma imagen, y lo que corre
# se nombra por su identificador, que así es siempre el mismo.
#
# Cambiar esta línea cambia el servidor de la base. Publicar lo acepta solo si es la misma versión
# mayor (17) y el mismo sistema (alpine): por ejemplo, la huella nueva de un parche de seguridad. Lo
# cambia con el negocio cerrado, después del respaldo, y si algo falla vuelve al de antes. Antes de
# cambiarla, se leen las notas de esa versión menor (https://www.postgresql.org/docs/release/): a
# veces piden algo a mano, como reconstruir un índice. Otra versión mayor, u otro sistema, no se
# publica: tiene su propio procedimiento (docs/planes/2026-11-10-cambiar-el-servidor-de-la-base.md).
FROM postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
