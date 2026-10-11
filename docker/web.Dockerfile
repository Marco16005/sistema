# La aplicación, en etapas. La construcción no toca la base ni necesita secretos.
#   web    lo construido, y nada más: es lo que queda sirviendo
#   admin  migraciones y consola, con el código fuente; corre con credenciales de administración
#
# La imagen de la que parte va por su huella, no solo por su etiqueta: la etiqueta se mueve, y con
# ella lo que se construiría mañana con este mismo archivo.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
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
USER node
CMD ["node", "db/migrar.ts"]

FROM base AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=obra --chown=node:node /app/.next/standalone ./
COPY --from=obra --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
