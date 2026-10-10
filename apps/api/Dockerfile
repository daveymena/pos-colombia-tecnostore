FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY prisma ./prisma
RUN npm install --include=dev --no-audit --no-fund
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY prisma ./prisma
RUN npm install --omit=dev --no-audit --no-fund \
  && npx prisma generate \
  && mkdir -p /app/uploads
COPY --from=build /app/dist ./dist
ENV UPLOADS_DIR=/app/uploads
VOLUME /app/uploads
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
