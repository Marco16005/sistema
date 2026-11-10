#!/bin/sh
set -eu
pg_restore --single-transaction --exit-on-error --no-owner --dbname codex44-restaurada /trabajo/anual.dump
psql -d codex44-restaurada -v ON_ERROR_STOP=1 -c 'SELECT (SELECT count(*) FROM operacion) operaciones,(SELECT count(*) FROM operacion_linea) lineas,(SELECT count(*) FROM bitacora) bitacora,pg_database_size(current_database()) bytes;'
