# Un almacenamiento compatible con S3 (MinIO), solo para la batería de pruebas. Ahí se prueban de
# verdad las versiones, la retención con candado y lo que puede y no puede cada credencial: lo
# mismo que se le va a pedir al almacenamiento contratado. No forma parte de la operación.
FROM alpine:3.24
RUN apk add --no-cache minio
EXPOSE 9000
ENTRYPOINT ["minio", "server", "/datos", "--address", ":9000", "--quiet"]
