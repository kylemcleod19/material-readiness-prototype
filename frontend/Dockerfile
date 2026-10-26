FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# The nginx image runs envsubst on /etc/nginx/templates/*.template at startup,
# so API_UPSTREAM is resolved per deployment (compose: http://api:8000).
ENV API_UPSTREAM=http://api:8000 \
    PORT=8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
