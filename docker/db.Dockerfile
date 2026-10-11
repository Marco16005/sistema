# La base de datos de la operación: la imagen oficial de PostgreSQL, por su huella y sin cambios.
# Este archivo solo dice cuál es. Publicar no la construye: toma esa misma imagen, y lo que corre
# se nombra por su identificador, que así es siempre el mismo. Cambiar esta línea cambia el
# servidor de la base, y eso no se hace publicando: publicar se niega, y una versión mayor de
# PostgreSQL tiene su propio procedimiento.
FROM postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
