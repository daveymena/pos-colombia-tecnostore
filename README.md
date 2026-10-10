# POS Colombia — Starter Full Stack

Sistema POS de base con frontend React + TypeScript + Vite, backend NestJS + Prisma + PostgreSQL, Docker Compose y documentación en español.

## Incluye
- Autenticación JWT básica y roles iniciales.
- Productos, categorías, clientes, proveedores.
- Inventario y movimientos de stock.
- Ventas con varios métodos de pago y actualización transaccional de inventario.
- Caja: apertura/cierre y movimientos.
- Compras y recepción básica.
- Dashboard y reportes básicos.
- Esquema Prisma con relaciones y datos demo.
- API Swagger, validación y configuración por variables de entorno.

> Este proyecto es una base funcional inicial, no un producto certificado ni una solución fiscal lista para producción. Antes de usar con dinero real, completa las pruebas de seguridad, la facturación electrónica DIAN mediante un proveedor autorizado, copias de seguridad, revisión contable y pruebas de concurrencia.

## Requisitos
- Docker Desktop
- Node.js 20+
- npm 10+

## Arranque con Docker
```bash
cp .env.example .env
docker compose up --build
```
Frontend: http://localhost:5173  
API: http://localhost:3000/api  
Swagger: http://localhost:3000/api/docs

## Desarrollo local
```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

## Usuario demo
Tras ejecutar el seed:
- correo: `admin@demo-pos.local`
- contraseña: `Cambiar123!`

Solo para desarrollo local. Cambia esta contraseña antes de cualquier despliegue.

## Estructura
- `apps/api`: NestJS API
- `apps/web`: React/Vite UI
- `prisma`: esquema y seed
- `docker-compose.yml`: PostgreSQL + API + frontend

## Nota de implementación
El POS aplica cálculos en servidor, almacena importes como Decimal y actualiza venta, pagos y stock en una transacción. Aun así, este starter necesita una revisión independiente antes de producción.
