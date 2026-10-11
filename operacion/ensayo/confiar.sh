#!/bin/sh
# Le dice al navegador del ensayo que confíe en la autoridad del proxy de ensayo. Así el recorrido
# valida el certificado de verdad, en vez de ignorar sus errores.
set -eu
almacen="sql:$HOME/.pki/nssdb"
mkdir -p "$HOME/.pki/nssdb"
certutil -d "$almacen" -N --empty-password 2>/dev/null || true
certutil -d "$almacen" -D -n "Autoridad del ensayo" 2>/dev/null || true
certutil -d "$almacen" -A -t "C,," -n "Autoridad del ensayo" -i /ca/raiz.crt
