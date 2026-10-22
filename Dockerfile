
# syntax=docker/dockerfile:1

# Build Angular
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies first to benefit from Docker layer caching.
COPY package.json package-lock.json ./
# Plugin natif local (dépendance « file: » de package.json)
COPY plugins/ ./plugins/
RUN npm ci

COPY . .
# Version inscrite dans le client (même numérotation que le serveur : 26.11.0, 26.11.0-beta.2…).
# Sans elle : le tag Git du commit construit s'il est dans le contexte, sinon « dev ».
ARG THERMOBOX_VERSION=""
ARG THERMOBOX_COMMIT=""
RUN THERMOBOX_VERSION="$THERMOBOX_VERSION" THERMOBOX_COMMIT="$THERMOBOX_COMMIT" npm run build -- --configuration production

# Serve the compiled SPA with Nginx
FROM nginx:1.28-alpine AS runtime

ENV API_UPSTREAM=http://localhost:8080

# Nginx template is rendered at container startup using API_UPSTREAM.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/Thermobox-Ng-Client/browser/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
