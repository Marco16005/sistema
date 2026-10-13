# Node para correr las pruebas; el cliente de Postgres, age y rclone para las de respaldo y
# restauración, que usan los mismos programas que la operación; y el cliente de MinIO, con que las
# pruebas preparan el almacenamiento (cubo con candado, credenciales) y miran sus versiones.
FROM node:24-alpine
# openssl es solo para una prueba: que la receta de la guía para sacar el sello de los respaldos sin
# este sistema (grep + openssl) dé lo mismo que operacion/sello.ts.
RUN apk add --no-cache postgresql17-client age rclone minio-client openssl
