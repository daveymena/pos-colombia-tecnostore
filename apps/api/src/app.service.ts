import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
  UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, PaymentMethod, UserRole } from '@prisma/client';
import { PrismaService } from './prisma.service';
import * as bcrypt from 'bcryptjs';

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (n: any, label: string, min = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < min) throw new BadRequestException(`${label} no es vÃƒÂ¡lido`);
  return v;
};
const isRole = (role: string, roles: string[]) => roles.includes(role);

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private async audit(companyId: string, userId: string | undefined, action: string, entity: string, entityId?: string, metadata?: any) {
    await this.prisma.auditLog.create({ data: { companyId, userId, action, entity, entityId, metadata: metadata ?? Prisma.JsonNull } }).catch(() => undefined);
  }

  async setupStatus() {
    return { needed: (await this.prisma.user.count()) === 0 };
  }

  async setupAdmin(body: any) {
    if ((await this.prisma.user.count()) > 0) throw new ForbiddenException('El registro inicial ya fue completado.');
    const name = String(body?.name || '').trim();
    const email = String(body?.email || '').toLowerCase().trim();
    const password = String(body?.password || '');
    const companyName = String(body?.company || '').trim() || 'Mi negocio';
    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Nombre y correo válido son obligatorios.');
    if (password.length < 10) throw new BadRequestException('La contraseña debe tener al menos 10 caracteres.');
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: companyName, currency: 'COP', timezone: 'America/Bogota' } });
      const branch = await tx.branch.create({ data: { companyId: company.id, name: 'Principal' } });
      await tx.warehouse.create({ data: { branchId: branch.id, name: 'Bodega principal' } });
      await tx.register.create({ data: { branchId: branch.id, name: 'Caja 1' } });
      const user = await tx.user.create({ data: { companyId: company.id, name, email, passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN' } });
      await tx.auditLog.create({ data: { companyId: company.id, userId: user.id, action: 'SETUP', entity: 'User', entityId: user.id } });
      const accessToken = await this.jwt.signAsync({ sub: user.id, companyId: user.companyId, role: user.role, email: user.email });
      return { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId } };
    });
  }

  async login(email: string, password: string) {
    if (!email || !password) throw new BadRequestException('Correo y contraseÃƒÂ±a son obligatorios');
    const user = await this.prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Credenciales invÃƒÂ¡lidas');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const accessToken = await this.jwt.signAsync({ sub: user.id, companyId: user.companyId, role: user.role, email: user.email });
    await this.audit(user.companyId, user.id, 'LOGIN', 'User', user.id);
    return { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId } };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, active: true, companyId: true, company: true } });
    if (!user || !user.active) throw new UnauthorizedException('Usuario desactivado');
    return user;
  }

  async dashboard(companyId: string, query: any = {}) {
    const now = new Date();
    // DÃƒÂ­a operativo en America/Bogota (UTC-5 fijo, sin horario de verano).
    const bogotaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const from = query.from ? new Date(query.from) : new Date(`${bogotaDay}T05:00:00.000Z`);
    const to = query.to ? new Date(query.to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('Rango de fechas invÃƒÂ¡lido');
    const saleWhere: any = { companyId, status: { in: ['COMPLETED', 'PARTIALLY_RETURNED'] }, createdAt: { gte: from, lte: to } };
    if (query.branchId) saleWhere.branchId = query.branchId;
    const [products, customers, sales, lowStock, latestSales, inventoryRows, expensesAgg] = await Promise.all([
      this.prisma.product.count({ where: { companyId, active: true } }),
      this.prisma.customer.count({ where: { companyId, active: true } }),
      this.prisma.sale.findMany({ where: saleWhere, include: { items: true, returns: { include: { items: true } } } }),
      this.prisma.inventoryBalance.findMany({ where: { product: { companyId, active: true } }, include: { product: true, warehouse: { include: { branch: true } } }, take: 100 }),
      this.prisma.sale.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 10, include: { branch: true, user: { select: { name: true } } } }),
      this.prisma.inventoryBalance.findMany({ where: { product: { companyId, active: true } }, include: { product: true } }),
      this.prisma.expense.aggregate({ where: { companyId, createdAt: { gte: from, lte: to } }, _sum: { amount: true } }),
    ]);
    const gross = sales.reduce((s, sale) => s + Number(sale.total), 0);
    const returned = sales.reduce((s, sale) => s + sale.returns.filter(r => r.status === 'COMPLETED').reduce((a, r) => a + Number(r.total), 0), 0);
    const net = money(gross - returned);
    const cost = money(sales.reduce((s, sale) => s + sale.items.reduce((a, item) => { const returnedQty = sale.returns.filter(r => r.status === 'COMPLETED' && r.restock).reduce((n, r) => n + r.items.filter(ri => ri.saleItemId === item.id).reduce((t, ri) => t + Number(ri.quantity), 0), 0); return a + Number(item.unitCost) * Math.max(0, Number(item.quantity) - returnedQty); }, 0), 0));
    const totalInventoryCost = money(inventoryRows.reduce((s, r) => s + Number(r.quantity) * Number(r.product.cost), 0));
    const filteredLow = lowStock.filter(r => Number(r.quantity) <= Number(r.product.stockMin));
    return {
      products, customers, grossSales: money(gross), returns: money(returned), salesToday: net,
      transactionsToday: sales.length, averageTicket: sales.length ? money(net / sales.length) : 0,
      costOfSales: cost, grossProfit: money(net - cost), expenses: Number(expensesAgg._sum.amount || 0),
      inventoryValue: totalInventoryCost, lowStock: filteredLow.slice(0, 12), latestSales,
      dailySales: this.groupSalesByDay(sales),
    };
  }

  private groupSalesByDay(sales: any[]) {
    const grouped = new Map<string, number>();
    for (const sale of sales) {
      const key = new Date(sale.createdAt).toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
      grouped.set(key, (grouped.get(key) || 0) + Number(sale.total));
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, total: money(total) }));
  }

  async company(companyId: string) {
    return this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { branches: { include: { warehouses: true, registers: true } } } });
  }

  async updateCompany(companyId: string, userId: string, body: any) {
    const data: any = {};
    for (const key of ['name', 'taxId', 'email', 'phone', 'address', 'logoUrl', 'currency', 'timezone']) if (body[key] !== undefined) data[key] = body[key];
    if (data.name !== undefined && !String(data.name).trim()) throw new BadRequestException('El nombre de la empresa es obligatorio');
    const result = await this.prisma.company.update({ where: { id: companyId }, data });
    await this.audit(companyId, userId, 'UPDATE', 'Company', result.id, data);
    return result;
  }

  async branches(companyId: string) {
    return this.prisma.branch.findMany({ where: { companyId }, include: { warehouses: true, registers: true }, orderBy: { name: 'asc' } });
  }
  async createBranch(companyId: string, userId: string, body: any) {
    if (!body.name?.trim()) throw new BadRequestException('Nombre de sucursal obligatorio');
    try {
      const branch = await this.prisma.$transaction(async tx => {
        const created = await tx.branch.create({ data: { companyId, name: String(body.name).trim(), code: body.code || null, address: body.address || null, phone: body.phone || null } });
        await tx.warehouse.create({ data: { branchId: created.id, name: 'Bodega principal' } });
        await tx.register.create({ data: { branchId: created.id, name: 'Caja 1' } });
        await tx.auditLog.create({ data: { companyId, userId, action: 'CREATE', entity: 'Branch', entityId: created.id } });
        return created;
      });
      return this.prisma.branch.findUnique({ where: { id: branch.id }, include: { warehouses: true, registers: true } });
    } catch (e: any) { if (e.code === 'P2002') throw new ConflictException('Ya existe una sucursal con ese nombre'); throw e; }
  }
  async warehouses(companyId: string) {
    return this.prisma.warehouse.findMany({ where: { branch: { companyId }, active: true }, include: { branch: true }, orderBy: { name: 'asc' } });
  }
  async registers(companyId: string) {
    return this.prisma.register.findMany({ where: { branch: { companyId }, active: true }, include: { branch: true }, orderBy: { name: 'asc' } });
  }

  async listUsers(companyId: string) {
    return this.prisma.user.findMany({ where: { companyId }, select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, lastLoginAt: true }, orderBy: { name: 'asc' } });
  }
  async createUser(companyId: string, userId: string, body: any) {
    if (!body.name?.trim() || !body.email || !body.password) throw new BadRequestException('Nombre, correo y contraseÃƒÂ±a son obligatorios');
    if (String(body.password).length < 10) throw new BadRequestException('La contraseÃƒÂ±a debe tener al menos 10 caracteres');
    const role = Object.values(UserRole).includes(body.role) ? body.role : UserRole.CASHIER;
    const passwordHash = await bcrypt.hash(String(body.password), 12);
    try {
      const user = await this.prisma.user.create({ data: { companyId, name: String(body.name).trim(), email: String(body.email).toLowerCase().trim(), passwordHash, role }, select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } });
      await this.audit(companyId, userId, 'CREATE', 'User', user.id, { role }); return user;
    } catch (e: any) { if (e.code === 'P2002') throw new ConflictException('Ya existe un usuario con ese correo'); throw e; }
  }
  async updateUser(companyId: string, actorId: string, id: string, body: any) {
    const target = await this.prisma.user.findFirst({ where: { id, companyId } });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    const data: any = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.role && Object.values(UserRole).includes(body.role)) data.role = body.role;
    if (body.password) { if (String(body.password).length < 10) throw new BadRequestException('La contraseÃƒÂ±a debe tener al menos 10 caracteres'); data.passwordHash = await bcrypt.hash(String(body.password), 12); }
    const user = await this.prisma.user.update({ where: { id }, data, select: { id: true, name: true, email: true, role: true, active: true } });
    await this.audit(companyId, actorId, 'UPDATE', 'User', id, data); return user;
  }

  async listProducts(companyId: string, query: any = {}) {
    const where: any = { companyId, active: query.includeInactive === 'true' ? undefined : true };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search) where.OR = [{ name: { contains: String(query.search), mode: 'insensitive' } }, { sku: { contains: String(query.search), mode: 'insensitive' } }, { barcode: { contains: String(query.search) } }];
    return this.prisma.product.findMany({ where, include: { category: true, balances: { include: { warehouse: { include: { branch: true } } } } }, orderBy: { name: 'asc' }, take: 1000 });
  }
  async createProduct(companyId: string, userId: string, body: any) {
    if (!body.name?.trim() || !body.sku?.trim() || body.price === undefined) throw new BadRequestException('Nombre, SKU y precio son obligatorios');
    const price = num(body.price, 'Precio'); const cost = num(body.cost ?? 0, 'Costo'); const taxRate = num(body.taxRate ?? 0, 'Impuesto'); const stockMin = num(body.stockMin ?? 0, 'Stock mÃƒÂ­nimo');
    if (taxRate > 100) throw new BadRequestException('El porcentaje de impuesto no puede superar 100');
    if (body.categoryId) {
      const category = await this.prisma.category.findFirst({ where: { id: body.categoryId, companyId, active: true } });
      if (!category) throw new BadRequestException('La categorÃƒÂ­a no pertenece a esta empresa o estÃƒÂ¡ inactiva');
    }
    const promoPrice = body.promoPrice !== undefined && body.promoPrice !== null && body.promoPrice !== '' ? num(body.promoPrice, 'Precio promocional') : null;
    if (promoPrice !== null && promoPrice >= price) throw new BadRequestException('El precio promocional debe ser menor que el precio regular');
    const data: any = { companyId, name: String(body.name).trim(), sku: String(body.sku).trim(), barcode: body.barcode || null, description: body.description || null, brand: body.brand || null, unit: body.unit || 'unidad', kind: body.kind === 'SERVICE' ? 'SERVICE' : 'STOCK', price, cost, taxRate, stockMin, categoryId: body.categoryId || null, promoPrice };
    try { const product = await this.prisma.product.create({ data }); await this.audit(companyId, userId, 'CREATE', 'Product', product.id); return product; }
    catch (e: any) { if (e.code === 'P2002') throw new ConflictException('El SKU ya existe en esta empresa'); throw e; }
  }
  async updateProduct(companyId: string, userId: string, id: string, body: any) {
    const existing = await this.prisma.product.findFirst({ where: { id, companyId } }); if (!existing) throw new NotFoundException('Producto no encontrado');
    const data: any = {};
    for (const k of ['name','sku','barcode','description','brand','unit','active','kind']) if (body[k] !== undefined) data[k] = body[k];
    if (body.categoryId !== undefined) {
      if (body.categoryId) {
        const category = await this.prisma.category.findFirst({ where: { id: body.categoryId, companyId, active: true } });
        if (!category) throw new BadRequestException('La categorÃƒÂ­a no pertenece a esta empresa o estÃƒÂ¡ inactiva');
      }
      data.categoryId = body.categoryId || null;
    }
    for (const k of ['price','cost','taxRate','stockMin']) if (body[k] !== undefined) data[k] = num(body[k], k);
    if (body.promoPrice !== undefined) data.promoPrice = body.promoPrice === null || body.promoPrice === '' ? null : num(body.promoPrice, 'Precio promocional');
    const newPrice = data.price === undefined ? Number(existing.price) : Number(data.price);
    const newPromo = data.promoPrice === undefined ? (existing.promoPrice === null ? null : Number(existing.promoPrice)) : data.promoPrice;
    if (newPromo !== null && newPromo >= newPrice) throw new BadRequestException('El precio promocional debe ser menor que el precio regular');
    if (data.taxRate !== undefined && (Number(data.taxRate) < 0 || Number(data.taxRate) > 100)) throw new BadRequestException('El impuesto debe estar entre 0 y 100');
    const result = await this.prisma.product.update({ where: { id }, data }); await this.audit(companyId, userId, 'UPDATE', 'Product', id, data); return result;
  }
  async archiveProduct(companyId: string, userId: string, id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, companyId } }); if (!product) throw new NotFoundException('Producto no encontrado');
    const result = await this.prisma.product.update({ where: { id }, data: { active: false } }); await this.audit(companyId, userId, 'ARCHIVE', 'Product', id); return result;
  }

  async categories(companyId: string) { return this.prisma.category.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } }); }
  async createCategory(companyId: string, userId: string, body: any) {
    if (!body.name?.trim()) throw new BadRequestException('Nombre obligatorio');
    const result = await this.prisma.category.create({ data: { companyId, name: String(body.name).trim() } }); await this.audit(companyId, userId, 'CREATE', 'Category', result.id); return result;
  }

  async listCustomers(companyId: string, search?: string) {
    return this.prisma.customer.findMany({ where: { companyId, active: true, ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { document: { contains: search } }, { phone: { contains: search } }] } : {}) }, orderBy: { name: 'asc' }, take: 1000 });
  }
  async createCustomer(companyId: string, userId: string, body: any) {
    if (!body.name?.trim()) throw new BadRequestException('El nombre es obligatorio');
    const customer = await this.prisma.customer.create({ data: { companyId, name: String(body.name).trim(), document: body.document || null, phone: body.phone || null, email: body.email || null, address: body.address || null, notes: body.notes || null } });
    await this.audit(companyId, userId, 'CREATE', 'Customer', customer.id); return customer;
  }
  async updateCustomer(companyId: string, userId: string, id: string, body: any) {
    const row = await this.prisma.customer.findFirst({ where: { id, companyId } }); if (!row) throw new NotFoundException('Cliente no encontrado');
    const data: any = {}; for (const k of ['name','document','phone','email','address','notes','active']) if (body[k] !== undefined) data[k] = body[k];
    const result = await this.prisma.customer.update({ where: { id }, data }); await this.audit(companyId, userId, 'UPDATE', 'Customer', id); return result;
  }

  async suppliers(companyId: string, search?: string) {
    return this.prisma.supplier.findMany({ where: { companyId, active: true, ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { taxId: { contains: search } }] } : {}) }, orderBy: { name: 'asc' }, take: 1000 });
  }
  async createSupplier(companyId: string, userId: string, body: any) {
    if (!body.name?.trim()) throw new BadRequestException('Nombre de proveedor obligatorio');
    const result = await this.prisma.supplier.create({ data: { companyId, name: String(body.name).trim(), taxId: body.taxId || null, phone: body.phone || null, email: body.email || null, address: body.address || null } }); await this.audit(companyId, userId, 'CREATE', 'Supplier', result.id); return result;
  }
  async updateSupplier(companyId: string, userId: string, id: string, body: any) {
    const row = await this.prisma.supplier.findFirst({ where: { id, companyId } }); if (!row) throw new NotFoundException('Proveedor no encontrado');
    const data: any = {}; for (const k of ['name','taxId','phone','email','address','active']) if (body[k] !== undefined) data[k] = body[k];
    const result = await this.prisma.supplier.update({ where: { id }, data }); await this.audit(companyId, userId, 'UPDATE', 'Supplier', id); return result;
  }

  async listInventory(companyId: string, query: any = {}) {
    const [products, warehouses, balances] = await Promise.all([
      this.prisma.product.findMany({ where: { companyId, active: true, kind: 'STOCK' }, orderBy: { name: 'asc' }, take: 2000 }),
      this.prisma.warehouse.findMany({ where: { branch: { companyId, active: true }, active: true, ...(query.warehouseId ? { id: query.warehouseId } : {}) }, include: { branch: true }, orderBy: { name: 'asc' } }),
      this.prisma.inventoryBalance.findMany({ where: { product: { companyId, active: true, kind: 'STOCK' }, ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) } }),
    ]);
    const byKey = new Map(balances.map((balance) => [`${balance.productId}:${balance.warehouseId}`, balance]));
    return products.flatMap((product) => warehouses.map((warehouse) => {
      const balance = byKey.get(`${product.id}:${warehouse.id}`);
      return { id: balance?.id || `zero:${product.id}:${warehouse.id}`, productId: product.id, warehouseId: warehouse.id, quantity: balance?.quantity || 0, updatedAt: balance?.updatedAt || null, product, warehouse };
    }));
  }
  async stockMovements(companyId: string, query: any = {}) {
    const where: any = { product: { companyId } }; if (query.productId) where.productId = query.productId; if (query.warehouseId) where.warehouseId = query.warehouseId;
    return this.prisma.stockMovement.findMany({ where, include: { product: true, warehouse: true, user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: Math.min(Number(query.limit) || 250, 1000) });
  }
  async adjustStock(companyId: string, userId: string, body: any) {
    if (!body.productId || !body.warehouseId) throw new BadRequestException('Producto y bodega son obligatorios');
    const qty = num(body.quantity, 'Cantidad'); if (qty <= 0) throw new BadRequestException('La cantidad debe ser mayor que cero');
    const kind = body.direction === 'OUT' ? -1 : 1;
    return this.prisma.$transaction(async tx => {
      const product = await tx.product.findFirst({ where: { id: body.productId, companyId, active: true } }); if (!product) throw new NotFoundException('Producto no encontrado');
      const wh = await tx.warehouse.findFirst({ where: { id: body.warehouseId, branch: { companyId }, active: true } }); if (!wh) throw new NotFoundException('Bodega no encontrada');
      const current = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: wh.id } } });
      if (kind < 0 && Number(current?.quantity || 0) < qty) throw new BadRequestException('Existencias insuficientes para el ajuste');
      if (current) {
        const updated = await tx.inventoryBalance.updateMany({ where: { id: current.id, ...(kind < 0 ? { quantity: { gte: qty } } : {}) }, data: { quantity: kind > 0 ? { increment: qty } : { decrement: qty } } });
        if (!updated.count) throw new ConflictException('El inventario cambiÃƒÂ³ en otra operaciÃƒÂ³n; vuelve a intentarlo');
      } else {
        await tx.inventoryBalance.create({ data: { productId: product.id, warehouseId: wh.id, quantity: qty } });
      }
      const movement = await tx.stockMovement.create({ data: { productId: product.id, warehouseId: wh.id, userId, type: 'ADJUSTMENT', quantity: kind * qty, unitCost: product.cost, reference: body.reference || 'AJUSTE', note: String(body.note || 'Ajuste manual') } });
      await tx.auditLog.create({ data: { companyId, userId, action: 'STOCK_ADJUST', entity: 'Inventory', entityId: movement.id, metadata: { productId: product.id, quantity: kind * qty, note: body.note || '' } } });
      return movement;
    });
  }

  async listSales(companyId: string, query: any = {}) {
    const where: any = { companyId }; if (query.branchId) where.branchId = query.branchId; if (query.status) where.status = query.status;
    if (query.from || query.to) where.createdAt = { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) };
    return this.prisma.sale.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500, include: { items: true, payments: true, branch: true, customer: true, user: { select: { name: true } }, returns: { include: { items: true } } } });
  }

  private async nextNumber(tx: Prisma.TransactionClient, companyId: string, branchId: string, type: string) {
    await tx.documentSequence.upsert({ where: { companyId_branchId_type: { companyId, branchId, type } }, create: { companyId, branchId, type, current: 0 }, update: {} });
    const seq = await tx.documentSequence.update({ where: { companyId_branchId_type: { companyId, branchId, type } }, data: { current: { increment: 1 } } });
    return seq.current;
  }

  async createSale(companyId: string, userId: string, body: any) {
    if (!body.branchId || !Array.isArray(body.items) || body.items.length === 0) throw new BadRequestException('Sucursal y productos son obligatorios');
    if (!Array.isArray(body.payments) || body.payments.length === 0) throw new BadRequestException('Debe registrar al menos un mÃƒÂ©todo de pago');
    return this.prisma.$transaction(async tx => {
      const branch = await tx.branch.findFirst({ where: { id: body.branchId, companyId, active: true }, include: { warehouses: true } });
      if (!branch) throw new NotFoundException('Sucursal no encontrada');
      const warehouseId = body.warehouseId || branch.warehouses.find(w => w.active)?.id;
      if (!warehouseId) throw new BadRequestException('La sucursal necesita una bodega activa');
      const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, branchId: branch.id, active: true } });
      if (!warehouse) throw new BadRequestException('La bodega seleccionada no pertenece a la sucursal');
      if (body.customerId) { const c = await tx.customer.findFirst({ where: { id: body.customerId, companyId, active: true } }); if (!c) throw new BadRequestException('Cliente invÃƒÂ¡lido'); }
      let subtotal = 0, tax = 0;
      const lines: any[] = [];
      for (const item of body.items) {
        const product = await tx.product.findFirst({ where: { id: item.productId, companyId, active: true } });
        if (!product) throw new NotFoundException('Uno de los productos no existe o estÃƒÂ¡ inactivo');
        const qty = num(item.quantity, `Cantidad de ${product.name}`); if (qty <= 0) throw new BadRequestException('La cantidad debe ser mayor a cero');
        const unitPrice = product.promoPrice !== null && Number(product.promoPrice) > 0 && Number(product.promoPrice) < Number(product.price) ? Number(product.promoPrice) : Number(product.price);
        const lineBase = money(unitPrice * qty); const lineTax = money(lineBase * Number(product.taxRate) / 100);
        subtotal += lineBase; tax += lineTax;
        lines.push({ productId: product.id, product, description: product.name, sku: product.sku, quantity: qty, unitPrice, unitCost: Number(product.cost), taxRate: Number(product.taxRate), lineTotal: money(lineBase + lineTax) });
      }
      const discount = num(body.discount || 0, 'Descuento');
      subtotal = money(subtotal); tax = money(tax);
      if (discount > subtotal + tax) throw new BadRequestException('El descuento supera el valor de la venta');
      const total = money(subtotal + tax - discount);
      const payments = body.payments.map((p: any) => {
        const method = String(p.method || 'CASH') as PaymentMethod;
        if (!Object.values(PaymentMethod).includes(method)) throw new BadRequestException('MÃƒÂ©todo de pago invÃƒÂ¡lido');
        const amount = money(num(p.amount, 'Valor de pago'));
        if (amount <= 0) throw new BadRequestException('Cada pago debe ser mayor a cero');
        return { method, amount, reference: p.reference ? String(p.reference) : null };
      });
      const paidTotal = money(payments.filter((p: any) => p.method !== 'CREDIT').reduce((s: number, p: any) => s + p.amount, 0));
      const creditTotal = money(payments.filter((p: any) => p.method === 'CREDIT').reduce((s: number, p: any) => s + p.amount, 0));
      if (Math.abs(paidTotal + creditTotal - total) > 0.01) throw new BadRequestException('Los medios de pago deben sumar el total exacto');
      if (creditTotal > 0 && !body.customerId) throw new BadRequestException('Las ventas a crÃƒÂ©dito requieren identificar al cliente');
      for (const line of lines) {
        if (line.product.kind === 'STOCK') {
          const balance = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: line.productId, warehouseId } } });
          if (!balance || Number(balance.quantity) < line.quantity) throw new BadRequestException(`Inventario insuficiente para ${line.product.name}`);
        }
      }
      let sessionId: string | null = body.sessionId || null;
      if (sessionId) {
        const session = await tx.cashSession.findFirst({ where: { id: sessionId, status: 'OPEN', userId, register: { branchId: branch.id } } });
        if (!session) throw new BadRequestException('La caja seleccionada no estÃƒÂ¡ abierta o no corresponde a la sucursal');
      } else {
        const open = await tx.cashSession.findFirst({ where: { status: 'OPEN', userId, register: { branchId: branch.id } }, orderBy: { openedAt: 'desc' } });
        sessionId = open?.id || null;
        if (!sessionId) throw new BadRequestException('Debes abrir una caja antes de registrar una venta.');
      }
      const number = await this.nextNumber(tx, companyId, branch.id, 'SALE');
      const sale = await tx.sale.create({ data: {
        companyId, branchId: branch.id, userId, customerId: body.customerId || null, sessionId, number,
        subtotal, discount, tax, total, notes: body.notes || null,
        items: { create: lines.map(l => ({ productId: l.productId, description: l.description, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost, taxRate: l.taxRate, lineTotal: l.lineTotal })) },
        payments: { create: payments },
        ...(creditTotal > 0 ? { receivable: { create: { amount: creditTotal, paidAmount: 0, dueDate: body.dueDate ? new Date(body.dueDate) : null, status: 'OPEN' } } } : {}),
      }, include: { items: true, payments: true, customer: true, branch: true } });
      for (const line of lines) {
        if (line.product.kind !== 'STOCK') continue;
        const update = await tx.inventoryBalance.updateMany({ where: { productId: line.productId, warehouseId, quantity: { gte: line.quantity } }, data: { quantity: { decrement: line.quantity } } });
        if (!update.count) throw new ConflictException(`Las existencias de ${line.product.name} cambiaron durante la venta. No se confirmÃƒÂ³ la operaciÃƒÂ³n.`);
        await tx.stockMovement.create({ data: { productId: line.productId, warehouseId, userId, type: 'SALE', quantity: -line.quantity, unitCost: line.unitCost, reference: `VENTA-${sale.id}` } });
      }
      if (sessionId) {
        const cash = payments.filter((p: any) => p.method === 'CASH').reduce((s: number, p: any) => s + p.amount, 0);
        if (cash > 0) await tx.cashMovement.create({ data: { sessionId, type: 'SALE_CASH', amount: cash, description: `Venta #${number}`, reference: sale.id } });
      }
      await tx.auditLog.create({ data: { companyId, userId, action: 'CREATE', entity: 'Sale', entityId: sale.id, metadata: { number, total, items: lines.length } } });
      return sale;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async openCash(companyId: string, userId: string, body: any) {
    const register = await this.prisma.register.findFirst({ where: { id: body.registerId, branch: { companyId }, active: true }, include: { branch: true } });
    if (!register) throw new NotFoundException('Caja no encontrada');
    const openingCash = num(body.openingCash ?? 0, 'Fondo inicial');
    const session = await this.prisma.$transaction(async tx => {
      const existing = await tx.cashSession.findFirst({ where: { registerId: register.id, status: 'OPEN' } });
      if (existing) throw new ConflictException('Esta caja ya tiene un turno abierto');
      const current = await tx.cashSession.create({ data: { registerId: register.id, userId, openingCash, notes: body.notes || null } });
      if (openingCash > 0) await tx.cashMovement.create({ data: { sessionId: current.id, type: 'OPENING', amount: openingCash, description: 'Fondo inicial' } });
      await tx.auditLog.create({ data: { companyId, userId, action: 'OPEN', entity: 'CashSession', entityId: current.id } });
      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return session;
  }
  async cashSessions(companyId: string, userId: string, role: string, status?: string) {
    const where: any = { register: { branch: { companyId } } }; if (status) where.status = status; if (role === 'CASHIER') where.userId = userId;
    return this.prisma.cashSession.findMany({ where, include: { register: { include: { branch: true } }, user: { select: { id: true, name: true } }, movements: true }, orderBy: { openedAt: 'desc' }, take: 300 });
  }
  async cashMovement(companyId: string, userId: string, body: any) {
    if (!body.sessionId) throw new BadRequestException('Turno de caja obligatorio');
    const session = await this.prisma.cashSession.findFirst({ where: { id: body.sessionId, status: 'OPEN', userId, register: { branch: { companyId } } } });
    if (!session) throw new NotFoundException('Turno abierto no encontrado');
    const amount = num(body.amount, 'Importe'); if (amount <= 0) throw new BadRequestException('El importe debe ser mayor a cero');
    const type = body.type === 'IN' ? 'MANUAL_IN' : 'MANUAL_OUT';
    if (type === 'MANUAL_OUT') {
      const bal = await this.cashExpected(session.id);
      if (bal < amount) throw new BadRequestException('El retiro supera el efectivo esperado en caja');
    }
    const row = await this.prisma.cashMovement.create({ data: { sessionId: session.id, type, amount: type === 'MANUAL_OUT' ? -amount : amount, description: String(body.description || (type === 'MANUAL_IN' ? 'Ingreso de caja' : 'Retiro de caja')) } });
    await this.audit(companyId, userId, type, 'CashMovement', row.id); return row;
  }
  private async cashExpected(sessionId: string) {
    const session = await this.prisma.cashSession.findUniqueOrThrow({ where: { id: sessionId } });
    const movements = await this.prisma.cashMovement.aggregate({ where: { sessionId }, _sum: { amount: true } });
    // Opening cash is represented as a movement as well; fallback to the session field for legacy rows.
    const countOpening = await this.prisma.cashMovement.count({ where: { sessionId, type: 'OPENING' } });
    return money((countOpening ? 0 : Number(session.openingCash)) + Number(movements._sum.amount || 0));
  }
  async closeCash(companyId: string, userId: string, role: string, id: string, body: any) {
    const session = await this.prisma.cashSession.findFirst({ where: { id, register: { branch: { companyId } } }, include: { movements: true } });
    if (!session) throw new NotFoundException('Turno de caja no encontrado');
    if (session.status !== 'OPEN') throw new BadRequestException('El turno ya estÃƒÂ¡ cerrado');
    if (session.userId !== userId && !isRole(role, ['ADMIN','MANAGER'])) throw new ForbiddenException('No puedes cerrar un turno de otro usuario');
    const expectedCash = await this.cashExpected(id); const closingCash = num(body.closingCash, 'Efectivo contado');
    const difference = money(closingCash - expectedCash);
    const closed = await this.prisma.cashSession.update({ where: { id }, data: { status: 'CLOSED', closingCash, expectedCash, difference, closedAt: new Date(), notes: body.notes || session.notes } });
    await this.audit(companyId, userId, 'CLOSE', 'CashSession', id, { expectedCash, closingCash, difference }); return { ...closed, expectedCash, difference };
  }

  async listPurchases(companyId: string) {
    return this.prisma.purchase.findMany({ where: { companyId }, include: { supplier: true, items: { include: { product: true } }, warehouse: { include: { branch: true } } }, orderBy: { createdAt: 'desc' }, take: 500 });
  }
  async createPurchase(companyId: string, userId: string, body: any) {
    if (!body.supplierId || !body.number || !Array.isArray(body.items) || !body.items.length) throw new BadRequestException('Proveedor, nÃƒÂºmero e ÃƒÂ­tems son obligatorios');
    const supplier = await this.prisma.supplier.findFirst({ where: { id: body.supplierId, companyId, active: true } }); if (!supplier) throw new NotFoundException('Proveedor no encontrado');
    if (body.warehouseId) { const w = await this.prisma.warehouse.findFirst({ where: { id: body.warehouseId, branch: { companyId } } }); if (!w) throw new BadRequestException('Bodega invÃƒÂ¡lida'); }
    const lines: any[] = []; let subtotal = 0;
    for (const i of body.items) {
      const product = await this.prisma.product.findFirst({ where: { id: i.productId, companyId, active: true, kind: 'STOCK' } }); if (!product) throw new NotFoundException('Producto inventariable de compra no encontrado');
      const quantity = num(i.quantity, 'Cantidad'); if (quantity <= 0) throw new BadRequestException('La cantidad debe ser positiva');
      const unitCost = num(i.unitCost, 'Costo unitario'); const lineTotal = money(quantity * unitCost); subtotal += lineTotal;
      lines.push({ productId: product.id, quantity, unitCost, lineTotal });
    }
    try {
      const purchase = await this.prisma.purchase.create({ data: { companyId, supplierId: supplier.id, number: String(body.number), warehouseId: body.warehouseId || null, subtotal: money(subtotal), tax: 0, total: money(subtotal), status: 'ORDERED', items: { create: lines } }, include: { supplier: true, items: { include: { product: true } }, warehouse: true } });
      await this.audit(companyId, userId, 'CREATE', 'Purchase', purchase.id); return purchase;
    } catch (e: any) { if (e.code === 'P2002') throw new ConflictException('Ese nÃƒÂºmero de compra ya estÃƒÂ¡ registrado'); throw e; }
  }
  async receivePurchase(companyId: string, userId: string, id: string, body: any) {
    return this.prisma.$transaction(async tx => {
      const purchase = await tx.purchase.findFirst({ where: { id, companyId }, include: { items: true } }); if (!purchase) throw new NotFoundException('Compra no encontrada');
      if (['RECEIVED','CANCELLED'].includes(purchase.status)) throw new BadRequestException('Esta compra no se puede recibir en su estado actual');
      const warehouseId = body.warehouseId || purchase.warehouseId; if (!warehouseId) throw new BadRequestException('Selecciona la bodega de recepciÃƒÂ³n');
      const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, branch: { companyId }, active: true } }); if (!warehouse) throw new BadRequestException('Bodega de recepciÃƒÂ³n invÃƒÂ¡lida');
      let receivedThisTime = 0;
      const recMap = body.items && Array.isArray(body.items) ? new Map(body.items.map((x: any) => [x.itemId, num(x.quantity, 'Cantidad recibida')])) : null;
      for (const item of purchase.items) {
        const remaining = Number(item.quantity) - Number(item.receivedQuantity);
        const received = recMap ? Number(recMap.get(item.id) || 0) : remaining;
        if (received < 0 || received > remaining) throw new BadRequestException('Cantidad recibida supera el saldo pendiente de la compra');
        if (!received) continue;
        await tx.purchaseItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: received } } });
        // Calculate the old quantity BEFORE changing the balance so received units
        // are not accidentally counted twice in the weighted-average cost.
        const totalBefore = await tx.inventoryBalance.aggregate({ where: { productId: item.productId }, _sum: { quantity: true } });
        const oldQty = Number(totalBefore._sum.quantity || 0);
        const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
        const newQty = oldQty + received;
        const weightedCost = newQty > 0 ? money(((oldQty * Number(product.cost)) + (received * Number(item.unitCost))) / newQty) : Number(item.unitCost);
        const balance = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId } } });
        if (balance) {
          await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: { increment: received } } });
        } else {
          await tx.inventoryBalance.create({ data: { productId: item.productId, warehouseId, quantity: received } });
        }
        await tx.product.update({ where: { id: item.productId }, data: { cost: weightedCost } });
        await tx.stockMovement.create({ data: { productId: item.productId, warehouseId, userId, type: 'PURCHASE', quantity: received, unitCost: item.unitCost, reference: `COMPRA-${purchase.number}` } });
        receivedThisTime += received;
      }
      if (receivedThisTime <= 0) throw new BadRequestException('Indica al menos una cantidad pendiente para recibir');
      const itemsUpdated = await tx.purchaseItem.findMany({ where: { purchaseId: purchase.id } });
      const allReceived = itemsUpdated.every(i => Number(i.receivedQuantity) >= Number(i.quantity));
      const anyReceived = itemsUpdated.some(i => Number(i.receivedQuantity) > 0);
      const result = await tx.purchase.update({ where: { id }, data: { status: allReceived ? 'RECEIVED' : (anyReceived ? 'PARTIALLY_RECEIVED' : 'ORDERED'), warehouseId, receivedAt: allReceived ? new Date() : purchase.receivedAt }, include: { supplier: true, items: { include: { product: true } }, warehouse: true } });
      if (allReceived) await tx.accountPayable.upsert({ where: { purchaseId: purchase.id }, create: { purchaseId: purchase.id, amount: purchase.total, paidAmount: 0, status: 'OPEN' }, update: {} });
      await tx.auditLog.create({ data: { companyId, userId, action: 'RECEIVE', entity: 'Purchase', entityId: id, metadata: { receivedThisTime, warehouseId } } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async cancelPurchase(companyId: string, userId: string, id: string) {
    const purchase = await this.prisma.purchase.findFirst({ where: { id, companyId }, include: { items: true } }); if (!purchase) throw new NotFoundException('Compra no encontrada');
    if (purchase.items.some(i => Number(i.receivedQuantity) > 0)) throw new BadRequestException('No se puede cancelar una compra que ya tiene mercancÃƒÂ­a recibida');
    const result = await this.prisma.purchase.update({ where: { id }, data: { status: 'CANCELLED' } }); await this.audit(companyId, userId, 'CANCEL', 'Purchase', id); return result;
  }

  async listExpenses(companyId: string, query: any = {}) {
    const where: any = { companyId }; if (query.from || query.to) where.createdAt = { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) };
    return this.prisma.expense.findMany({ where, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 1000 });
  }
  async createExpense(companyId: string, userId: string, body: any) {
    if (!body.category?.trim() || !body.description?.trim()) throw new BadRequestException('CategorÃƒÂ­a y descripciÃƒÂ³n obligatorias');
    const amount = num(body.amount, 'Importe'); if (amount <= 0) throw new BadRequestException('El importe debe ser mayor a cero');
    const method = String(body.paymentMethod || 'CASH').toUpperCase();
    if (body.sessionId) {
      const session = await this.prisma.cashSession.findFirst({ where: { id: body.sessionId, status: 'OPEN', userId, register: { branch: { companyId } } } });
      if (!session) throw new BadRequestException('Turno de caja abierto propio obligatorio para vincular el gasto');
    }
    const expense = await this.prisma.$transaction(async tx => {
      const e = await tx.expense.create({ data: { companyId, userId, category: String(body.category), description: String(body.description), amount, paymentMethod: method, sessionId: body.sessionId || null } });
      if (method === 'CASH' && body.sessionId) await tx.cashMovement.create({ data: { sessionId: body.sessionId, type: 'EXPENSE', amount: -amount, description: `Gasto: ${body.description}`, reference: e.id } });
      await tx.auditLog.create({ data: { companyId, userId, action: 'CREATE', entity: 'Expense', entityId: e.id } }); return e;
    }); return expense;
  }

  async createReturn(companyId: string, userId: string, body: any) {
    if (!body.saleId || !Array.isArray(body.items) || !body.items.length) throw new BadRequestException('Venta y artÃƒÂ­culos a devolver son obligatorios');
    const method = String(body.refundMethod || 'CASH') as PaymentMethod;
    if (!Object.values(PaymentMethod).includes(method) || method === 'CREDIT') throw new BadRequestException('MÃƒÂ©todo de reembolso invÃƒÂ¡lido; el crÃƒÂ©dito de tienda aÃƒÂºn no estÃƒÂ¡ habilitado');
    return this.prisma.$transaction(async tx => {
      const sale = await tx.sale.findFirst({ where: { id: body.saleId, companyId }, include: { items: true, returns: true } }); if (!sale) throw new NotFoundException('Venta no encontrada');
      if (sale.status === 'VOIDED') throw new BadRequestException('No se pueden devolver artÃƒÂ­culos de una venta anulada');
      let total = 0; const returnLines: any[] = [];
      for (const entry of body.items) {
        const item = sale.items.find(i => i.id === entry.saleItemId); if (!item) throw new BadRequestException('ArtÃƒÂ­culo no pertenece a la venta');
        const qty = num(entry.quantity, 'Cantidad a devolver');
        if (qty <= 0 || qty > Number(item.quantity) - Number(item.returnedQty)) throw new BadRequestException(`Cantidad de devoluciÃƒÂ³n invÃƒÂ¡lida para ${item.description}`);
        const amount = money(Number(item.lineTotal) * qty / Number(item.quantity)); total += amount;
        returnLines.push({ item, qty, amount });
      }
      total = money(total); const number = `DEV-${Date.now()}`;
      const result = await tx.saleReturn.create({ data: { saleId: sale.id, number, total, refundMethod: method, restock: body.restock !== false, reason: body.reason || null, items: { create: returnLines.map(l => ({ saleItemId: l.item.id, productId: l.item.productId, quantity: l.qty, amount: l.amount })) } }, include: { items: true } });
      for (const l of returnLines) {
        await tx.saleItem.update({ where: { id: l.item.id }, data: { returnedQty: { increment: l.qty } } });
        if (body.restock !== false) {
          const returnedProduct = await tx.product.findFirst({ where: { id: l.item.productId, companyId } });
          // Services can be returned financially, but must never create physical stock.
          if (returnedProduct?.kind === 'STOCK') {
            const originalMove = await tx.stockMovement.findFirst({ where: { productId: l.item.productId, reference: `VENTA-${sale.id}`, type: 'SALE' }, orderBy: { createdAt: 'asc' } });
            const warehouse = originalMove ? await tx.warehouse.findUnique({ where: { id: originalMove.warehouseId } }) : await tx.warehouse.findFirst({ where: { branchId: sale.branchId, active: true }, orderBy: { name: 'asc' } });
            if (!warehouse) throw new BadRequestException('La sucursal no tiene bodega para recibir devoluciones');
            await tx.inventoryBalance.upsert({ where: { productId_warehouseId: { productId: l.item.productId, warehouseId: warehouse.id } }, create: { productId: l.item.productId, warehouseId: warehouse.id, quantity: l.qty }, update: { quantity: { increment: l.qty } } });
            await tx.stockMovement.create({ data: { productId: l.item.productId, warehouseId: warehouse.id, userId, type: 'RETURN', quantity: l.qty, unitCost: l.item.unitCost, reference: number, note: body.reason || 'DevoluciÃƒÂ³n de cliente' } });
          }
        }
      }
      const updatedItems = await tx.saleItem.findMany({ where: { saleId: sale.id } });
      const fullyReturned = updatedItems.every(i => Number(i.returnedQty) >= Number(i.quantity));
      await tx.sale.update({ where: { id: sale.id }, data: { status: fullyReturned ? 'REFUNDED' : 'PARTIALLY_RETURNED' } });
      if (method === 'CASH' && sale.sessionId) {
        const session = await tx.cashSession.findUnique({ where: { id: sale.sessionId } });
        if (session?.status === 'OPEN') await tx.cashMovement.create({ data: { sessionId: session.id, type: 'REFUND_CASH', amount: -total, description: `DevoluciÃƒÂ³n ${number}`, reference: result.id } });
      }
      await tx.auditLog.create({ data: { companyId, userId, action: 'CREATE', entity: 'SaleReturn', entityId: result.id, metadata: { saleId: sale.id, total } } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async listReturns(companyId: string) {
    return this.prisma.saleReturn.findMany({ where: { sale: { companyId } }, include: { sale: { select: { number: true, createdAt: true, total: true } }, items: { include: { product: true, saleItem: true } } }, orderBy: { createdAt: 'desc' }, take: 300 });
  }

  async receivables(companyId: string) {
    return this.prisma.accountReceivable.findMany({ where: { sale: { companyId } }, include: { sale: { include: { customer: true, branch: true } }, payments: true }, orderBy: { createdAt: 'desc' }, take: 1000 });
  }
  async payReceivable(companyId: string, userId: string, id: string, body: any) {
    const amount = num(body.amount, 'Abono'); if (amount <= 0) throw new BadRequestException('El abono debe ser mayor a cero');
    const method = String(body.method || 'CASH') as PaymentMethod; if (!Object.values(PaymentMethod).includes(method) || method === 'CREDIT') throw new BadRequestException('MÃƒÂ©todo de abono invÃƒÂ¡lido');
    return this.prisma.$transaction(async tx => {
      const receivable = await tx.accountReceivable.findFirst({ where: { id, sale: { companyId } }, include: { sale: true } });
      if (!receivable) throw new NotFoundException('Cuenta por cobrar no encontrada');
      const balance = money(Number(receivable.amount) - Number(receivable.paidAmount));
      if (amount > balance + 0.01) throw new BadRequestException('El abono supera el saldo pendiente');
      const payment = await tx.receivablePayment.create({ data: { receivableId: id, amount, method, reference: body.reference || null } });
      const paidAmount = money(Number(receivable.paidAmount) + amount); const fullyPaid = paidAmount >= Number(receivable.amount) - 0.01;
      await tx.accountReceivable.update({ where: { id }, data: { paidAmount, status: fullyPaid ? 'PAID' : 'PARTIAL' } });
      if (receivable.sale.sessionId && method === 'CASH') {
        const session = await tx.cashSession.findUnique({ where: { id: receivable.sale.sessionId } });
        if (session?.status === 'OPEN') await tx.cashMovement.create({ data: { sessionId: session.id, type: 'CREDIT_COLLECTION', amount, description: `Abono a venta #${receivable.sale.number}`, reference: payment.id } });
      }
      await tx.auditLog.create({ data: { companyId, userId, action: 'RECEIVE_PAYMENT', entity: 'AccountReceivable', entityId: id, metadata: { amount, method } } });
      return { payment, amount: receivable.amount, paidAmount, balance: money(Number(receivable.amount) - paidAmount), status: fullyPaid ? 'PAID' : 'PARTIAL' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async payables(companyId: string) {
    return this.prisma.accountPayable.findMany({ where: { purchase: { companyId } }, include: { purchase: { include: { supplier: true, items: true } }, payments: true }, orderBy: { createdAt: 'desc' }, take: 1000 });
  }
  async payPayable(companyId: string, userId: string, id: string, body: any) {
    const amount = num(body.amount, 'Pago al proveedor'); if (amount <= 0) throw new BadRequestException('El pago debe ser mayor a cero');
    const method = String(body.method || 'TRANSFER') as PaymentMethod; if (!Object.values(PaymentMethod).includes(method) || method === 'CREDIT') throw new BadRequestException('MÃƒÂ©todo de pago invÃƒÂ¡lido');
    return this.prisma.$transaction(async tx => {
      const payable = await tx.accountPayable.findFirst({ where: { id, purchase: { companyId } }, include: { purchase: true } });
      if (!payable) throw new NotFoundException('Cuenta por pagar no encontrada');
      const balance = money(Number(payable.amount) - Number(payable.paidAmount));
      if (amount > balance + 0.01) throw new BadRequestException('El pago supera el saldo pendiente');
      const payment = await tx.payablePayment.create({ data: { payableId: id, amount, method, reference: body.reference || null } });
      const paidAmount = money(Number(payable.paidAmount) + amount); const fullyPaid = paidAmount >= Number(payable.amount) - 0.01;
      await tx.accountPayable.update({ where: { id }, data: { paidAmount, status: fullyPaid ? 'PAID' : 'PARTIAL' } });
      await tx.auditLog.create({ data: { companyId, userId, action: 'PAY_SUPPLIER', entity: 'AccountPayable', entityId: id, metadata: { amount, method } } });
      return { payment, amount: payable.amount, paidAmount, balance: money(Number(payable.amount) - paidAmount), status: fullyPaid ? 'PAID' : 'PARTIAL' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async stockTransfers(companyId: string) {
    const warehouses = await this.prisma.warehouse.findMany({ where: { branch: { companyId } }, select: { id: true } });
    const ids = warehouses.map(w => w.id);
    return this.prisma.stockTransfer.findMany({ where: { OR: [{ fromWarehouseId: { in: ids } }, { toWarehouseId: { in: ids } }] }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 500 });
  }
  async createStockTransfer(companyId: string, userId: string, body: any) {
    if (!body.fromWarehouseId || !body.toWarehouseId || body.fromWarehouseId === body.toWarehouseId || !Array.isArray(body.items) || !body.items.length) throw new BadRequestException('Bodegas diferentes e ÃƒÂ­tems son obligatorios');
    return this.prisma.$transaction(async tx => {
      const ids = [body.fromWarehouseId, body.toWarehouseId];
      const warehouses = await tx.warehouse.findMany({ where: { id: { in: ids }, branch: { companyId }, active: true } });
      if (warehouses.length !== 2) throw new BadRequestException('Una de las bodegas no pertenece a la empresa');
      const lines: any[] = [];
      for (const item of body.items) {
        const product = await tx.product.findFirst({ where: { id: item.productId, companyId, active: true, kind: 'STOCK' } });
        if (!product) throw new NotFoundException('Producto inventariable no encontrado');
        const quantity = num(item.quantity, 'Cantidad'); if (quantity <= 0) throw new BadRequestException('La cantidad debe ser mayor a cero');
        const balance = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: body.fromWarehouseId } } });
        if (!balance || Number(balance.quantity) < quantity) throw new BadRequestException(`Stock insuficiente de ${product.name} en la bodega de origen`);
        lines.push({ product, quantity, balance });
      }
      const transfer = await tx.stockTransfer.create({ data: { fromWarehouseId: body.fromWarehouseId, toWarehouseId: body.toWarehouseId, status: 'COMPLETED', notes: body.notes || null, items: { create: lines.map(l => ({ productId: l.product.id, quantity: l.quantity })) } }, include: { items: true } });
      for (const line of lines) {
        const update = await tx.inventoryBalance.updateMany({ where: { productId: line.product.id, warehouseId: body.fromWarehouseId, quantity: { gte: line.quantity } }, data: { quantity: { decrement: line.quantity } } });
        if (!update.count) throw new ConflictException('El stock de origen cambiÃƒÂ³; vuelve a intentarlo');
        await tx.inventoryBalance.upsert({ where: { productId_warehouseId: { productId: line.product.id, warehouseId: body.toWarehouseId } }, create: { productId: line.product.id, warehouseId: body.toWarehouseId, quantity: line.quantity }, update: { quantity: { increment: line.quantity } } });
        await tx.stockMovement.create({ data: { productId: line.product.id, warehouseId: body.fromWarehouseId, userId, type: 'TRANSFER_OUT', quantity: -line.quantity, unitCost: line.product.cost, reference: transfer.id, note: 'Traslado de inventario' } });
        await tx.stockMovement.create({ data: { productId: line.product.id, warehouseId: body.toWarehouseId, userId, type: 'TRANSFER_IN', quantity: line.quantity, unitCost: line.product.cost, reference: transfer.id, note: 'Traslado de inventario' } });
      }
      await tx.auditLog.create({ data: { companyId, userId, action: 'TRANSFER', entity: 'StockTransfer', entityId: transfer.id, metadata: { fromWarehouseId: body.fromWarehouseId, toWarehouseId: body.toWarehouseId } } });
      return transfer;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async supplierReturns(companyId: string) {
    return this.prisma.supplierReturn.findMany({ where: { companyId }, include: { supplier: true, items: { include: { product: true } } }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  async createSupplierReturn(companyId: string, userId: string, body: any) {
    if (!body.supplierId || !body.warehouseId || !Array.isArray(body.items) || !body.items.length || !body.number) throw new BadRequestException('NÃƒÂºmero, proveedor, bodega e ÃƒÂ­tems son obligatorios');
    return this.prisma.$transaction(async tx => {
      const supplier = await tx.supplier.findFirst({ where: { id: body.supplierId, companyId, active: true } }); if (!supplier) throw new NotFoundException('Proveedor no encontrado');
      const warehouse = await tx.warehouse.findFirst({ where: { id: body.warehouseId, branch: { companyId }, active: true } }); if (!warehouse) throw new NotFoundException('Bodega no encontrada');
      const lines: any[] = []; let total = 0;
      for (const i of body.items) {
        const product = await tx.product.findFirst({ where: { id: i.productId, companyId, active: true, kind: 'STOCK' } }); if (!product) throw new NotFoundException('Producto no encontrado');
        const quantity = num(i.quantity, 'Cantidad'); if (quantity <= 0) throw new BadRequestException('La cantidad debe ser mayor a cero');
        const balance = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } });
        if (!balance || Number(balance.quantity) < quantity) throw new BadRequestException(`No hay existencias suficientes de ${product.name}`);
        const unitCost = Number(product.cost); lines.push({ product, quantity, unitCost, lineTotal: money(quantity * unitCost) }); total += quantity * unitCost;
      }
      const result = await tx.supplierReturn.create({ data: { companyId, supplierId: supplier.id, warehouseId: warehouse.id, number: String(body.number), total: money(total), reason: body.reason || null, items: { create: lines.map(l => ({ productId: l.product.id, quantity: l.quantity, unitCost: l.unitCost, lineTotal: l.lineTotal })) } }, include: { items: true } });
      for (const l of lines) {
        const update = await tx.inventoryBalance.updateMany({ where: { productId: l.product.id, warehouseId: warehouse.id, quantity: { gte: l.quantity } }, data: { quantity: { decrement: l.quantity } } });
        if (!update.count) throw new ConflictException('El inventario cambiÃƒÂ³ durante la devoluciÃƒÂ³n al proveedor');
        await tx.stockMovement.create({ data: { productId: l.product.id, warehouseId: warehouse.id, userId, type: 'SUPPLIER_RETURN', quantity: -l.quantity, unitCost: l.unitCost, reference: result.number, note: body.reason || 'DevoluciÃƒÂ³n a proveedor' } });
      }
      await tx.auditLog.create({ data: { companyId, userId, action: 'SUPPLIER_RETURN', entity: 'SupplierReturn', entityId: result.id } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reports(companyId: string, query: any = {}) {
    const from = query.from ? new Date(query.from) : new Date(new Date().setDate(new Date().getDate() - 29));
    const to = query.to ? new Date(query.to) : new Date();
    const [sales, topItems, inventory, expenses, purchases, sessions] = await Promise.all([
      this.prisma.sale.findMany({ where: { companyId, createdAt: { gte: from, lte: to }, status: { not: 'VOIDED' } }, include: { items: true, returns: { include: { items: true } }, payments: true, branch: true } }),
      this.prisma.saleItem.groupBy({ by: ['productId'], where: { sale: { companyId, createdAt: { gte: from, lte: to }, status: { not: 'VOIDED' } } }, _sum: { quantity: true, lineTotal: true }, orderBy: { _sum: { lineTotal: 'desc' } }, take: 10 }),
      this.prisma.inventoryBalance.findMany({ where: { product: { companyId, active: true } }, include: { product: true, warehouse: { include: { branch: true } } } }),
      this.prisma.expense.findMany({ where: { companyId, createdAt: { gte: from, lte: to } } }),
      this.prisma.purchase.findMany({ where: { companyId, createdAt: { gte: from, lte: to } } }),
      this.prisma.cashSession.findMany({ where: { register: { branch: { companyId } }, openedAt: { gte: from, lte: to } }, include: { register: { include: { branch: true } }, user: { select: { name: true } } } }),
    ]);
    const products = await this.prisma.product.findMany({ where: { id: { in: topItems.map(i => i.productId) } }, select: { id: true, name: true, sku: true } });
    const gross = sales.reduce((s, r) => s + Number(r.total), 0); const refunds = sales.reduce((s, r) => s + r.returns.filter(x => x.status === 'COMPLETED').reduce((a, x) => a + Number(x.total), 0), 0);
    const cost = sales.reduce((s, r) => s + r.items.reduce((a, i) => { const returnedQty = r.returns.filter((x: any) => x.status === 'COMPLETED' && x.restock).reduce((n: number, x: any) => n + x.items.filter((ri: any) => ri.saleItemId === i.id).reduce((t: number, ri: any) => t + Number(ri.quantity), 0), 0); return a + Math.max(0, Number(i.quantity) - returnedQty) * Number(i.unitCost); }, 0), 0);
    const paymentTotals: Record<string, number> = {};
    for (const sale of sales) for (const p of sale.payments) paymentTotals[p.method] = (paymentTotals[p.method] || 0) + Number(p.amount);
    return {
      from, to, salesCount: sales.length, grossSales: money(gross), returns: money(refunds), netSales: money(gross - refunds),
      costOfSales: money(cost), grossProfit: money(gross - refunds - cost), expenses: money(expenses.reduce((s, e) => s + Number(e.amount), 0)),
      purchases: money(purchases.reduce((s, p) => s + Number(p.total), 0)), inventoryValue: money(inventory.reduce((s, i) => s + Number(i.quantity) * Number(i.product.cost), 0)),
      paymentTotals: Object.entries(paymentTotals).map(([method, amount]) => ({ method, amount: money(amount) })),
      topProducts: topItems.map(i => ({ ...i, product: products.find(p => p.id === i.productId) || null })),
      dailySales: this.groupSalesByDay(sales), cashSessions: sessions,
    };
  }

  async exportProducts(companyId: string) {
    const products = await this.prisma.product.findMany({ where: { companyId }, include: { category: true }, orderBy: { name: 'asc' } });
    const head = ['sku', 'name', 'barcode', 'description', 'brand', 'unit', 'kind', 'price', 'cost', 'promoPrice', 'taxRate', 'stockMin', 'category', 'active', 'imageUrl'];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = products.map(p => [p.sku, p.name, p.barcode, p.description, p.brand, p.unit, p.kind, p.price, p.cost, p.promoPrice, p.taxRate, p.stockMin, p.category?.name, p.active ? 'SI' : 'NO', p.imageUrl].map(esc).join(','));
    return '\uFEFF' + head.join(',') + '\n' + lines.join('\n');
  }

  private parseCsv(buffer: Buffer): string[][] {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(v => v.trim() !== '')) rows.push(row);
    return rows;
  }

  async importProducts(companyId: string, userId: string, buffer: Buffer) {
    const rows = this.parseCsv(buffer);
    if (!rows.length) throw new BadRequestException('El archivo CSV estÃƒÂ¡ vacÃƒÂ­o');
    const head = rows[0].map(h => h.trim().toLowerCase());
    const idx = (name: string) => head.indexOf(name);
    if (idx('sku') < 0 || idx('name') < 0) throw new BadRequestException('El CSV debe tener columnas sku y name');
    let created = 0, skipped = 0; const errors: string[] = [];
    const categories = await this.prisma.category.findMany({ where: { companyId, active: true } });
    for (let r = 1; r < rows.length; r++) {
      const col = (n: string) => (rows[r][idx(n)] ?? '').trim();
      try {
        const sku = col('sku'), name = col('name');
        if (!sku || !name) throw new Error('sku y name obligatorios');
        const price = Number(col('price') || 0);
        if (!Number.isFinite(price) || price < 0) throw new Error('precio invÃƒÂ¡lido');
        const exists = await this.prisma.product.findUnique({ where: { companyId_sku: { companyId, sku } } });
        if (exists) { skipped++; continue; }
        const catName = col('category');
        const category = catName ? categories.find(c => c.name.toLowerCase() === catName.toLowerCase()) : undefined;
        await this.prisma.product.create({ data: {
          companyId, sku, name, barcode: col('barcode') || null, description: col('description') || null,
          brand: col('brand') || null, unit: col('unit') || 'unidad', kind: col('kind').toUpperCase() === 'SERVICE' ? 'SERVICE' : 'STOCK',
          price, cost: Number(col('cost') || 0), promoPrice: col('promoprice') ? Number(col('promoprice')) : null,
          taxRate: Number(col('taxrate') || 0), stockMin: Number(col('stockmin') || 0),
          categoryId: category?.id || null, active: col('active').toUpperCase() !== 'NO',
        }});
        created++;
      } catch (e: any) { errors.push(`Fila ${r + 1}: ${e.message}`); }
    }
    await this.audit(companyId, userId, 'IMPORT', 'Product', undefined, { created, skipped, errors: errors.length });
    return { created, skipped, errors };
  }

  async setProductImage(companyId: string, userId: string, id: string, filename: string) {
    const product = await this.prisma.product.findFirst({ where: { id, companyId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const result = await this.prisma.product.update({ where: { id }, data: { imageUrl: `/uploads/${filename}` } });
    await this.audit(companyId, userId, 'UPDATE_IMAGE', 'Product', id);
    return result;
  }

  async auditLogs(companyId: string, query: any = {}) {
    return this.prisma.auditLog.findMany({ where: { companyId, ...(query.entity ? { entity: query.entity } : {}), ...(query.action ? { action: query.action } : {}) }, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 500 });
  }
  async electronicInvoiceStatus(companyId: string) {
    return { configured: false, status: 'NOT_CONFIGURED', companyId, message: 'La integraciÃƒÂ³n de facturaciÃƒÂ³n electrÃƒÂ³nica requiere un proveedor autorizado, credenciales y pruebas de validaciÃƒÂ³n. No se estÃƒÂ¡n emitiendo documentos fiscales desde este sistema.' };
  }
}
