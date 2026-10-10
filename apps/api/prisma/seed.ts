import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const companyId = '00000000-0000-4000-8000-000000000001';
  const company = await prisma.company.upsert({
    where: { id: companyId }, update: {},
    create: { id: companyId, name: 'Mi Negocio Demo', taxId: '900000000-1', currency: 'COP', timezone: 'America/Bogota' },
  });
  const branch = await prisma.branch.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Principal' } }, update: {},
    create: { companyId: company.id, name: 'Principal', code: 'PPL', address: 'Colombia' },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { branchId_name: { branchId: branch.id, name: 'Bodega principal' } }, update: {},
    create: { branchId: branch.id, name: 'Bodega principal' },
  });
  await prisma.register.upsert({
    where: { branchId_name: { branchId: branch.id, name: 'Caja 1' } }, update: {},
    create: { branchId: branch.id, name: 'Caja 1' },
  });
  const passwordHash = await bcrypt.hash('Cambiar123!', 12);
  await prisma.user.upsert({
    where: { email: 'admin@demo-pos.local' }, update: {},
    create: { companyId: company.id, name: 'Administrador Demo', email: 'admin@demo-pos.local', passwordHash, role: UserRole.ADMIN },
  });
  await prisma.category.upsert({
    where: { companyId_name: { companyId: company.id, name: 'General' } }, update: {},
    create: { companyId: company.id, name: 'General' },
  });
  const product = await prisma.product.upsert({
    where: { companyId_sku: { companyId: company.id, sku: 'DEMO-001' } }, update: {},
    create: { companyId: company.id, name: 'Producto de demostración', sku: 'DEMO-001', barcode: '770000000001', cost: 5000, price: 8000, taxRate: 0 },
  });
  await prisma.inventoryBalance.upsert({
    where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } }, update: {},
    create: { productId: product.id, warehouseId: warehouse.id, quantity: 50 },
  });
  const openingMove = await prisma.stockMovement.findFirst({ where: { productId: product.id, warehouseId: warehouse.id, reference: 'SALDO-INICIAL' } });
  if (!openingMove) await prisma.stockMovement.create({ data: { productId: product.id, warehouseId: warehouse.id, type: 'OPENING', quantity: 50, unitCost: 5000, reference: 'SALDO-INICIAL', note: 'Inventario inicial demo' } });
  await prisma.customer.upsert({
    where: { id: '00000000-0000-4000-8000-000000000010' }, update: {},
    create: { id: '00000000-0000-4000-8000-000000000010', companyId: company.id, name: 'Cliente mostrador', document: '2222222222' },
  });
  await prisma.supplier.upsert({
    where: { id: '00000000-0000-4000-8000-000000000020' }, update: {},
    create: { id: '00000000-0000-4000-8000-000000000020', companyId: company.id, name: 'Proveedor Demo', taxId: '900000001-2' },
  });
}
main().finally(() => prisma.$disconnect());
