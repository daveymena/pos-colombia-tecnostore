import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// Seed de PRODUCCIÓN para tienda de tecnología.
// Uso: ADMIN_EMAIL=admin@tutienda.com ADMIN_PASSWORD='ClaveSegura123!' npm run db:seed:techstore -w apps/api
// Precios de vitrina con IVA incluido: se calcula la base gravable automáticamente.

const prisma = new PrismaClient();
const IVA = 0.19;
const base = (shelf: number) => Math.round(shelf / (1 + IVA));
const costOf = (b: number) => Math.round(b * 0.72);

const CATEGORIES = [
  'Portátiles', 'Celulares y Tabletas', 'Audio', 'Video y Monitores',
  'Accesorios', 'Redes y Conectividad', 'Componentes PC', 'Videojuegos',
  'Hogar Inteligente', 'Impresión', 'Servicios Técnicos',
];

type P = { sku: string; name: string; cat: string; shelf: number; stock: number; min: number; barcode?: string; service?: boolean };
const PRODUCTS: P[] = [
  { sku: 'TEC-NB-001', name: 'Portátil Lenovo IdeaPad Slim 5 Ryzen 7 · 16GB · 512GB', cat: 'Portátiles', shelf: 3499000, stock: 8, min: 2 },
  { sku: 'TEC-NB-002', name: 'Portátil HP Pavilion 15 i5 · 8GB · 512GB SSD', cat: 'Portátiles', shelf: 2899000, stock: 10, min: 2 },
  { sku: 'TEC-NB-003', name: 'MacBook Air 13" Chip M3 · 8GB · 256GB', cat: 'Portátiles', shelf: 5999000, stock: 5, min: 1 },
  { sku: 'TEC-PH-001', name: 'Samsung Galaxy A55 5G · 256GB', cat: 'Celulares y Tabletas', shelf: 1799000, stock: 15, min: 3 },
  { sku: 'TEC-PH-002', name: 'iPhone 13 · 128GB', cat: 'Celulares y Tabletas', shelf: 2999000, stock: 8, min: 2 },
  { sku: 'TEC-PH-003', name: 'Xiaomi Redmi Note 13 Pro · 256GB', cat: 'Celulares y Tabletas', shelf: 1299000, stock: 20, min: 4 },
  { sku: 'TEC-AU-001', name: 'Audífonos Sony WH-1000XM5 Noise Cancelling', cat: 'Audio', shelf: 1499000, stock: 10, min: 2 },
  { sku: 'TEC-AU-002', name: 'Apple AirPods Pro (2.ª gen)', cat: 'Audio', shelf: 999000, stock: 12, min: 2 },
  { sku: 'TEC-AU-003', name: 'Parlante JBL Flip 6 Bluetooth', cat: 'Audio', shelf: 549000, stock: 15, min: 3 },
  { sku: 'TEC-VD-001', name: 'Monitor LG UltraGear 27" QHD 165Hz', cat: 'Video y Monitores', shelf: 1199000, stock: 8, min: 2 },
  { sku: 'TEC-VD-002', name: 'Smart TV Samsung 55" Crystal UHD 4K', cat: 'Video y Monitores', shelf: 2199000, stock: 6, min: 1 },
  { sku: 'TEC-AC-001', name: 'Teclado mecánico Logitech G Pro X', cat: 'Accesorios', shelf: 449000, stock: 15, min: 3 },
  { sku: 'TEC-AC-002', name: 'Mouse Logitech G502 Hero', cat: 'Accesorios', shelf: 249000, stock: 20, min: 4 },
  { sku: 'TEC-CP-001', name: 'SSD Kingston NV2 1TB NVMe', cat: 'Componentes PC', shelf: 329000, stock: 25, min: 5 },
  { sku: 'TEC-RD-001', name: 'Router TP-Link Archer AX55 WiFi 6', cat: 'Redes y Conectividad', shelf: 399000, stock: 12, min: 2 },
  { sku: 'TEC-GM-001', name: 'Consola PlayStation 5 Slim · Lector de disco', cat: 'Videojuegos', shelf: 2599000, stock: 6, min: 1 },
  { sku: 'TEC-GM-002', name: 'Consola Nintendo Switch OLED', cat: 'Videojuegos', shelf: 1899000, stock: 8, min: 2 },
  { sku: 'TEC-HI-001', name: 'Bombillo inteligente Xiaomi (pack x2)', cat: 'Hogar Inteligente', shelf: 89000, stock: 30, min: 6 },
  { sku: 'TEC-PR-001', name: 'Impresora HP LaserJet M111w WiFi', cat: 'Impresión', shelf: 649000, stock: 8, min: 2 },
  { sku: 'TEC-AC-003', name: 'Batería portátil Anker 20000mAh 22.5W', cat: 'Accesorios', shelf: 189000, stock: 25, min: 5 },
  { sku: 'TEC-SV-001', name: 'Servicio: instalación y configuración de equipo', cat: 'Servicios Técnicos', shelf: 80000, stock: 0, min: 0, service: true },
  { sku: 'TEC-SV-002', name: 'Servicio: mantenimiento preventivo de PC', cat: 'Servicios Técnicos', shelf: 120000, stock: 0, min: 0, service: true },
];

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminEmail || adminPassword.length < 10) {
    throw new Error('Define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 10 caracteres) antes del seed de producción.');
  }
  const company = await prisma.company.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' }, update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: process.env.STORE_NAME || 'TecnoStore Colombia',
      taxId: process.env.STORE_NIT || null,
      email: process.env.STORE_EMAIL || adminEmail,
      phone: process.env.STORE_PHONE || undefined,
      address: process.env.STORE_ADDRESS || undefined,
      currency: 'COP', timezone: 'America/Bogota',
    },
  });
  const branch = await prisma.branch.upsert({
    where: { companyId_name: { companyId: company.id, name: process.env.STORE_BRANCH || 'Principal' } }, update: {},
    create: { companyId: company.id, name: process.env.STORE_BRANCH || 'Principal', address: process.env.STORE_ADDRESS || undefined },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { branchId_name: { branchId: branch.id, name: 'Bodega principal' } }, update: {},
    create: { branchId: branch.id, name: 'Bodega principal' },
  });
  await prisma.register.upsert({
    where: { branchId_name: { branchId: branch.id, name: 'Caja 1' } }, update: {},
    create: { branchId: branch.id, name: 'Caja 1' },
  });
  await prisma.user.upsert({
    where: { email: adminEmail }, update: {},
    create: { companyId: company.id, name: process.env.ADMIN_NAME || 'Administrador', email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 12), role: UserRole.ADMIN },
  });
  const catIds: Record<string, string> = {};
  for (const name of CATEGORIES) {
    const cat = await prisma.category.upsert({
      where: { companyId_name: { companyId: company.id, name } }, update: {},
      create: { companyId: company.id, name },
    });
    catIds[name] = cat.id;
  }
  let n = 0;
  if (process.env.SEED_DEMO_CATALOG === 'true') {
    for (const [i, p] of PRODUCTS.entries()) {
      const b = base(p.shelf);
      const product = await prisma.product.upsert({
        where: { companyId_sku: { companyId: company.id, sku: p.sku } }, update: {},
        create: {
          companyId: company.id, categoryId: catIds[p.cat] ?? null, name: p.name, sku: p.sku,
          barcode: p.barcode || `77000${String(100000 + i)}`, kind: p.service ? 'SERVICE' : 'STOCK',
          price: b, cost: costOf(b), taxRate: 19, stockMin: p.min,
        },
      });
      if (!p.service && p.stock > 0) {
        await prisma.inventoryBalance.upsert({
          where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
          update: {}, create: { productId: product.id, warehouseId: warehouse.id, quantity: p.stock },
        });
        const move = await prisma.stockMovement.findFirst({ where: { productId: product.id, warehouseId: warehouse.id, reference: 'SALDO-INICIAL' } });
        if (!move) await prisma.stockMovement.create({ data: { productId: product.id, warehouseId: warehouse.id, type: 'OPENING', quantity: p.stock, unitCost: costOf(b), reference: 'SALDO-INICIAL', note: 'Inventario inicial demo' } });
      }
      n++;
    }
  }
  await prisma.customer.upsert({
    where: { id: '00000000-0000-4000-8000-000000000010' }, update: {},
    create: { id: '00000000-0000-4000-8000-000000000010', companyId: company.id, name: 'Consumidor final', document: '2222222222' },
  });
  console.log(`Seed TecnoStore OK: estructura y ${CATEGORIES.length} categorías, ${n} productos demo, empresa "${company.name}", admin ${adminEmail}`);
}
main().finally(() => prisma.$disconnect());
