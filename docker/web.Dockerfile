# La aplicación, en etapas. La construcción no toca la base ni necesita secretos.
#   web    lo construido, y nada más: es lo que queda sirviendo
#   admin  migraciones y consola, con el código fuente; corre con credenciales de administración
#
# La imagen de la que parte va por su huella, no solo por su etiqueta: la etiqueta se mueve, y con
# ella lo que se construiría mañana con este mismo archivo.
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 TZ=America/Mexico_City

FROM base AS dependencias
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencias AS obra
COPY tsconfig.json tsconfig.node.json next.config.ts ./
COPY src ./src
RUN npx next build

FROM dependencias AS admin
COPY tsconfig.node.json ./
COPY db ./db
COPY consola ./consola
COPY src/servidor ./src/servidor
# Los archivos entran con los permisos que tengan en la carpeta del proyecto. En un servidor que
# los crea solo para su dueño (umask 077), quien corre aquí —que no es root— no podría leerlos.
RUN chmod -R a+rX package.json package-lock.json tsconfig.node.json db consola src
# Lo que corre no usa npm (ni yarn ni corepack): se quitan, y con ellos lo que traen adentro, que es
# donde los escaneos encontraban avisos (revisión de seguridad del 4 de noviembre). Menos instalado,
# menos por dónde.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
CMD ["node", "db/migrar.ts"]

FROM base AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=obra --chown=node:node /app/.next/standalone ./
COPY --from=obra --chown=node:node /app/.next/static ./.next/static
# Lo que corre no usa npm (ni yarn ni corepack): se quitan, y con ellos lo que traen adentro, que es
# donde los escaneos encontraban avisos (revisión de seguridad del 4 de noviembre). Menos instalado,
# menos por dónde.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
EXPOSE 3000
CMD ["node", "server.js"]
