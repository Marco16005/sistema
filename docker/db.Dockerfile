# La base de datos de la operación: la imagen oficial de PostgreSQL, por su huella y sin cambios.
# Este archivo solo dice cuál es. Publicar no la construye: toma esa misma imagen, y lo que corre
# se nombra por su identificador, que así es siempre el mismo. Cambiar esta línea cambia el
# servidor de la base, y eso no se hace publicando: publicar se niega, y una versión mayor de
# PostgreSQL tiene su propio procedimiento.
FROM postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
