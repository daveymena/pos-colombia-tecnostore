FROM node:20-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm config set fetch-retries 5 && npm config set fetch-retry-mintimeout 20000 && npm config set fetch-retry-maxtimeout 120000 && npm config set fetch-timeout 120000 && \
  success=0; for i in 1 2 3 4 5; do echo "=== npm ci intento $i/5 ==="; if npm ci --no-audit --no-fund; then success=1; break; else echo "!!! intento $i falló, esperando 20s..."; sleep 20; fi; done; test $success -eq 1
COPY . .
RUN npm run db:generate
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
ARG GIT_SHA=local
ENV GIT_SHA=${GIT_SHA}
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat
COPY apps/api/package.json ./package.json
COPY apps/api/prisma ./prisma
RUN npm config set fetch-retries 5 && npm config set fetch-retry-mintimeout 20000 && npm config set fetch-retry-maxtimeout 120000 && npm config set fetch-timeout 120000 && \
  success=0; for i in 1 2 3; do echo "=== npm install prod intento $i/3 ==="; if npm install --omit=dev --no-audit --no-fund; then success=1; break; else echo "!!! intento $i falló, esperando 20s..."; sleep 20; fi; done; test $success -eq 1 \
  && npx prisma generate \
  && mkdir -p /app/uploads
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/web/dist ./web
ENV UPLOADS_DIR=/app/uploads WEB_DIST_DIR=/app/web
VOLUME /app/uploads
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "echo '=== POS boot: migrate ===' && npx prisma migrate deploy && echo '=== POS boot: start ===' && node dist/src/main.js"]
