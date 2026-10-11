#!/bin/sh
# Prepara el almacenamiento del ensayo como debe estar el de verdad: dos cubos con versiones y
# retención con candado —el de los respaldos de cada hora, 30 días; el de los diarios, 365—, y para
# cada uno una credencial del servidor que sube y lee lo cifrado de su prefijo y no puede borrar ni
# cambiar la retención.
set -eu
export MC_HOST_c="http://raiz:raiz-solo-para-el-ensayo@almacen-ensayo:9000"
# Puede correr más de una vez: cada vez que se levanta el ensayo.
mcli --quiet mb --with-lock --ignore-existing c/ensayo
mcli --quiet retention set --default COMPLIANCE 30d c/ensayo
cat > /tmp/servidor.json <<'J'
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":["arn:aws:s3:::ensayo"]},
 {"Effect":"Allow","Action":["s3:PutObject","s3:GetObject"],"Resource":["arn:aws:s3:::ensayo/feruga/*"]}
]}
J
mcli --quiet admin user add c "$SERVIDOR_USUARIO" "$SERVIDOR_CLAVE"
mcli --quiet admin policy create c servidor /tmp/servidor.json
mcli --quiet admin policy attach c servidor --user "$SERVIDOR_USUARIO"

# El de los diarios: otro cubo, que retiene un año, con su propia credencial.
mcli --quiet mb --with-lock --ignore-existing c/ensayo-diario
mcli --quiet retention set --default COMPLIANCE 365d c/ensayo-diario
cat > /tmp/diario.json <<'J'
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":["arn:aws:s3:::ensayo-diario"]},
 {"Effect":"Allow","Action":["s3:PutObject","s3:GetObject"],"Resource":["arn:aws:s3:::ensayo-diario/feruga/*"]}
]}
J
mcli --quiet admin user add c "$DIARIO_USUARIO" "$DIARIO_CLAVE"
mcli --quiet admin policy create c diario /tmp/diario.json
mcli --quiet admin policy attach c diario --user "$DIARIO_USUARIO"
