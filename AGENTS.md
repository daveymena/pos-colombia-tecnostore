# AGENTS.md — pos-colombia-tecnostore

Monorepo npm workspaces: `apps/api` (NestJS 10 + Prisma 6 + PostgreSQL 16) y
`apps/web` (React 18 + Vite 6). Sin tests, sin linter, sin CI.

## Comandos (orden importa)

```bash
cp .env.example .env        # JWT_SECRET de 32+ caracteres, obligatorio
npm install
npm run db:generate         # prisma generate
npm run db:migrate          # SOLO dev local (usa `migrate dev`)
npm run db:seed             # seed DEMO (nunca contra prod)
npm run dev                 # concurrently: api (:3000) + web (:5173)
npm run build               # api (nest build) y luego web (tsc --noEmit + vite)
```

- Login demo local tras seed: `admin@demo-pos.local` / `Cambiar123!`.
- `npm run build -w apps/web` corre `tsc --noEmit`: un error de tipos rompe el build Docker.
- Boot de prod: `prisma migrate deploy` corre en el CMD del contenedor, no a mano.
- Seed de prod (una sola vez, por Console de EasyPanel):
  `npm run db:seed:techstore -w apps/api` con `ADMIN_EMAIL`/`ADMIN_PASSWORD`/
  `STORE_NAME` en el env; **borra `ADMIN_PASSWORD` del env después**.

## API (`apps/api/src`)

- Un solo controller (`app.controller.ts`) delegando a `app.service.ts`.
  Servicios aparte solo: `inventory-files.service.ts` (conteo físico),
  `opencode-inventory.service.ts` (puente LLM), `pos-assistant.service.ts`
  (agente con herramientas).
- Prefijo global `api`: todo cuelga de `/api`. Health: `GET /api/health`
  → `{ok, service:'pos-api', commit: <GIT_SHA>}`; usa `commit` para verificar
  deploys.
- Auth Bearer JWT (8h) + roles por ruta (`ADMIN,MANAGER,INVENTORY,CASHIER,
  ACCOUNTANT`). `ValidationPipe` con `forbidNonWhitelisted`: campos no
  declarados son rechazados.
- Sin `DELETE`: productos se archivan (`POST /products/:id/archive`);
  ventas/compras/movimientos son inmutables (se corrigen con devoluciones y
  ajustes, nunca editando).
- Swagger solo si `NODE_ENV !== production` o `ENABLE_SWAGGER=true`, en
  `api/docs`.

## IA (no romper este contrato)

- `POST /api/ai/assistant` `{message, execute?, model?}` — agente con
  herramientas (buscar/crear/actualizar productos, **actualizar en lote**
  `updateProductsBySearch` —máx 20 por mensaje—, promos, bodegas
  (`listWarehouses`), stock, lowStock, salesToday). Con `execute:false`
  (default) solo propone el plan. El asistente guarda memoria corta en
  proceso (últimos 3 intercambios por empresa+usuario) para resolver
  referencias como "esos"/"todos" en el mensaje siguiente.
- IA de inventario (solo lectura): `GET /api/inventory/ai/status|models`,
  `POST /api/inventory/ai/insights|restock|pricing|copy`.
- Proveedor en `opencode-inventory.service.ts`: **OpenCode Server interno**
  (`OPENCODE_SERVER_URL`, default `http://opencode1_oc-zen:4000`) con
  modelos free (`-free`) y de pago si la cuenta los tiene; respaldo
  **Groq gratuito** (`GROQ_API_KEY`, `GROQ_MODEL`). **Sin modelos locales**
  (sin Ollama). Rotación: modelo pedido por la UI → `OPENCODE_MODEL` →
  `FREE_MODELS` (los más capaces primero) → Groq. Un FreeTierError corta
  la cadena y va directo a Groq; al final, 503 con detalle.
- Diagnóstico: `GET /api/inventory/ai/status` → `configured`,
  `serverConnected`, `fallbackModels`, `fallbackConfigured`.

## Web (`apps/web/src`)

- Casi todo vive en `App.tsx` (~580 líneas): estado, modales, tablas
  genéricas (`ModuleView`) y chatbot. El flotante y la sección Asistente
  comparten el mismo estado.
- Base de la API fijada en build: `VITE_API_URL` (arg Docker, default `/api`).

## Deploy (EasyPanel, `Dockerfile` raíz)

- El `Dockerfile` raíz empaqueta API+web en una sola imagen (`:3000`,
  web en `/` vía `WEB_DIST_DIR`, API en `/api`). Los `Dockerfile` de
  `apps/api` y `apps/web` y `docker-compose.yml` son para **dev local**;
  prod usa el raíz (o `docker-compose.prod.yml` con Postgres gestionado).
- EasyPanel pasa TODO el env como `--build-arg` y sale en el log del deploy:
  nunca commitees `.env`; rota secretos si quedaron expuestos y quita
  `ADMIN_PASSWORD` tras el seed.
- Volúmenes: uploads en `/app/uploads` (`pos_uploads`). Checklist post-deploy
  en `docs/DESPLIEGUE_EASYPANEL.md`.

## Convenciones

- Español en UI, errores y commits (`feat:`/`fix:`/`docs:`).
- Dinero como `Decimal`, precios COP; ventas/pagos/stock se actualizan en
  transacción; todo cambio relevante deja `auditLog`.
- Verificación sin tests: `GET /api/health`, Swagger temporal
  (`ENABLE_SWAGGER=true`) y checklist de `docs/DESPLIEGUE_EASYPANEL.md`.
