# El respaldo, y con él la restauración: Node, el cliente de Postgres 17 (pg_dump debe ser de la
# versión del servidor), age y rclone. Corre con la credencial de administración de la base y la
# del almacenamiento; la llave privada del respaldo nunca entra aquí.
#   docker compose run --rm respaldo ahora
#   docker compose run --rm respaldo lista
#
# Es también la imagen de las herramientas de la operación: comprobar, cerrar y abrir, y llevar el
# manifiesto de cada publicación. La imagen de la que parte va por su huella.
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
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
# Lo que corre no usa npm (ni yarn ni corepack): se quitan, y con ellos lo que traen adentro, que es
# donde los escaneos encontraban avisos (revisión de seguridad del 4 de noviembre). Menos instalado,
# menos por dónde.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
ENTRYPOINT ["node", "operacion/respaldar.ts"]
CMD ["servicio"]
