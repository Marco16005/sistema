# El respaldo, y con él la restauración: Node, el cliente de Postgres 17 (pg_dump debe ser de la
# versión del servidor), age y rclone. Corre con la credencial de administración de la base y la
# del almacenamiento; la llave privada del respaldo nunca entra aquí.
#   docker compose run --rm respaldo ahora
#   docker compose run --rm respaldo lista
#
# Es también la imagen de las herramientas de la operación: comprobar, cerrar y abrir, y llevar el
# manifiesto de cada publicación. La imagen de la que parte va por su huella.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
RUN apk add --no-cache postgresql17-client age rclone
WORKDIR /app
ENV TZ=America/Mexico_City
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --omit=dev
COPY db ./db
COPY operacion ./operacion
COPY src/servidor ./src/servidor
# Los archivos entran con los permisos que tengan en la carpeta del proyecto. En un servidor que
# los crea solo para su dueño (umask 077), quien corre aquí —que no es root— no podría leerlos.
RUN chmod -R a+rX package.json package-lock.json db operacion src
USER node
ENTRYPOINT ["node", "operacion/respaldar.ts"]
CMD ["servicio"]
