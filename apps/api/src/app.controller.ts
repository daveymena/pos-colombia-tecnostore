import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Res, UnauthorizedException, ForbiddenException, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { InventoryFilesService } from './inventory-files.service';
import { OpenCodeInventoryService } from './opencode-inventory.service';

export const uploadDir =
  process.env.UPLOADS_DIR ||
  (process.cwd().endsWith(join('apps', 'api')) ? join(process.cwd(), 'uploads') : join(process.cwd(), 'apps', 'api', 'uploads'));
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

const imageStorage = diskStorage({
  destination: (req: any, file: any, cb: any) => cb(null, uploadDir),
  filename: (req: any, file: any, cb: any) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname).toLowerCase()}`),
});

function imageFilter(req: any, file: any, cb: any) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(new BadRequestException('Solo se permiten imágenes JPG, PNG, WEBP o GIF'), false);
  cb(null, true);
}

@ApiTags('POS Colombia')
@Controller()
export class AppController {
  constructor(
    private readonly service: AppService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly inventoryFiles: InventoryFilesService,
    private readonly inventoryAi: OpenCodeInventoryService,
  ) {}

  private async context(auth?: string) {
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Se requiere token Bearer');
    try {
      const token = await this.jwt.verifyAsync(auth.slice(7));
      const user = await this.prisma.user.findUnique({ where: { id: token.sub }, select: { id: true, companyId: true, role: true, active: true } });
      if (!user?.active || user.companyId !== token.companyId) throw new UnauthorizedException('Sesión inválida o usuario inactivo');
      return { sub: user.id, companyId: user.companyId, role: user.role };
    } catch (e: any) { if (e?.status === 401) throw e; throw new UnauthorizedException('Token inválido o vencido'); }
  }
  private roles(ctx: any, allowed: string[]) { if (!allowed.includes(ctx.role)) throw new ForbiddenException('No tienes permiso para esta operación'); }

  @Get('health') async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, service: 'pos-api', timestamp: new Date().toISOString() };
  }
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('auth/login') login(@Body() body: { email: string; password: string }) { return this.service.login(body.email, body.password); }
  @ApiBearerAuth() @Get('auth/me') async me(@Headers('authorization') auth: string) { const c = await this.context(auth); return this.service.me(c.sub); }

  @ApiBearerAuth() @Get('dashboard') async dashboard(@Headers('authorization') auth: string, @Query() query: any) { const c = await this.context(auth); return this.service.dashboard(c.companyId, query); }
  @ApiBearerAuth() @Get('company') async company(@Headers('authorization') auth: string) { const c = await this.context(auth); return this.service.company(c.companyId); }
  @ApiBearerAuth() @Patch('company') async updateCompany(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN']); return this.service.updateCompany(c.companyId, c.sub, body); }

  @ApiBearerAuth() @Get('branches') async branches(@Headers('authorization') auth: string) { const c = await this.context(auth); return this.service.branches(c.companyId); }
  @ApiBearerAuth() @Post('branches') async createBranch(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER']); return this.service.createBranch(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Get('warehouses') async warehouses(@Headers('authorization') auth: string) { const c = await this.context(auth); return this.service.warehouses(c.companyId); }
  @ApiBearerAuth() @Get('registers') async registers(@Headers('authorization') auth: string) { const c = await this.context(auth); return this.service.registers(c.companyId); }

  @ApiBearerAuth() @Get('users') async users(@Headers('authorization') auth: string) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER']); return this.service.listUsers(c.companyId); }
  @ApiBearerAuth() @Post('users') async createUser(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN']); return this.service.createUser(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Patch('users/:id') async updateUser(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN']); return this.service.updateUser(c.companyId, c.sub, id, body); }

  @ApiBearerAuth() @Get('categories') async categories(@Headers('authorization') auth: string) { const c = await this.context(auth); return this.service.categories(c.companyId); }
  @ApiBearerAuth() @Post('categories') async createCategory(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.createCategory(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Get('products') async products(@Headers('authorization') auth: string, @Query() query: any) { const c = await this.context(auth); return this.service.listProducts(c.companyId, query); }
  @ApiBearerAuth() @Post('products') async createProduct(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.createProduct(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Patch('products/:id') async updateProduct(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.updateProduct(c.companyId, c.sub, id, body); }
  @ApiBearerAuth() @Post('products/:id/archive') async archiveProduct(@Headers('authorization') auth: string, @Param('id') id: string) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.archiveProduct(c.companyId, c.sub, id); }

  @ApiBearerAuth() @Post('products/:id/image') @UseInterceptors(FileInterceptor('image', { storage: imageStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter }))
  async uploadProductImage(@Headers('authorization') auth: string, @Param('id') id: string, @UploadedFile() file: any) {
    const c = await this.context(auth); this.roles(c, ['ADMIN', 'MANAGER', 'INVENTORY']);
    if (!file) throw new BadRequestException('Adjunta una imagen válida');
    return this.service.setProductImage(c.companyId, c.sub, id, file.filename);
  }

  @ApiBearerAuth() @Get('products/export') async exportProducts(@Headers('authorization') auth: string, @Res({ passthrough: true }) res: any) {
    const c = await this.context(auth); this.roles(c, ['ADMIN', 'MANAGER', 'INVENTORY', 'ACCOUNTANT']);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="productos.csv"' });
    return this.service.exportProducts(c.companyId);
  }

  @ApiBearerAuth() @Post('products/import') @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }))
  async importProducts(@Headers('authorization') auth: string, @UploadedFile() file: any) {
    const c = await this.context(auth); this.roles(c, ['ADMIN', 'MANAGER', 'INVENTORY']);
    if (!file) throw new BadRequestException('Adjunta un archivo CSV');
    return this.service.importProducts(c.companyId, c.sub, file.buffer);
  }

  @ApiBearerAuth() @Get('customers') async customers(@Headers('authorization') auth: string, @Query('search') search?: string) { const c = await this.context(auth); return this.service.listCustomers(c.companyId, search); }
  @ApiBearerAuth() @Post('customers') async createCustomer(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); return this.service.createCustomer(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Patch('customers/:id') async updateCustomer(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: any) { const c = await this.context(auth); return this.service.updateCustomer(c.companyId, c.sub, id, body); }
  @ApiBearerAuth() @Get('suppliers') async suppliers(@Headers('authorization') auth: string, @Query('search') search?: string) { const c = await this.context(auth); return this.service.suppliers(c.companyId, search); }
  @ApiBearerAuth() @Post('suppliers') async createSupplier(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY','ACCOUNTANT']); return this.service.createSupplier(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Patch('suppliers/:id') async updateSupplier(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY','ACCOUNTANT']); return this.service.updateSupplier(c.companyId, c.sub, id, body); }

  @ApiBearerAuth() @Get('inventory') async inventory(@Headers('authorization') auth: string, @Query() query: any) { const c = await this.context(auth); return this.service.listInventory(c.companyId, query); }
  @ApiBearerAuth() @Get('inventory/movements') async stockMovements(@Headers('authorization') auth: string, @Query() query: any) { const c = await this.context(auth); return this.service.stockMovements(c.companyId, query); }
  @ApiBearerAuth() @Post('inventory/adjustments') async adjustStock(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.adjustStock(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Get('inventory/export') async exportInventory(@Headers('authorization') auth: string, @Query('format') format = 'xlsx', @Res() res: any) {
    const c = await this.context(auth); this.roles(c, ['ADMIN', 'MANAGER', 'INVENTORY', 'ACCOUNTANT']);
    const result = await this.inventoryFiles.exportInventory(c.companyId, String(format).toLowerCase());
    res.set({ 'Content-Type': result.contentType, 'Content-Disposition': `attachment; filename="inventario-conteo.${result.extension}"`, 'Cache-Control': 'no-store' });
    res.send(result.buffer);
  }
  @ApiBearerAuth() @Post('inventory/import/preview') @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async previewInventoryImport(@Headers('authorization') auth: string, @UploadedFile() file: any) {
    const c = await this.context(auth); this.roles(c, ['ADMIN', 'MANAGER', 'INVENTORY']);
    if (!file) throw new BadRequestException('Adjunta un archivo Excel, Word, CSV, TXT o JSON.');
    const ext = String(file.originalname || '').toLowerCase().split('.').pop() || '';
    if (!['xlsx', 'docx', 'csv', 'txt', 'tsv', 'json'].includes(ext)) throw new BadRequestException('Formato no admitido. Usa .xlsx, .docx, .csv, .txt, .tsv o .json.');
    return this.inventoryFiles.previewImport(c.companyId, file.buffer, file.originalname);
  }
  @ApiBearerAuth() @Post('inventory/import/apply') async applyInventoryImport(@Headers('authorization') auth: string, @Body() body: any) {
    const c = await this.context(auth); this.roles(c, ['ADMIN', 'MANAGER', 'INVENTORY']);
    return this.inventoryFiles.applyImport(c.companyId, c.sub, body);
  }
  @ApiBearerAuth() @Get('inventory/ai/status') async inventoryAiStatus(@Headers('authorization') auth: string) {
    const c = await this.context(auth); this.roles(c, ['ADMIN', 'MANAGER', 'INVENTORY', 'ACCOUNTANT']);
    return this.inventoryAi.status();
  }
  @ApiBearerAuth() @Post('inventory/ai/insights') async inventoryAiInsights(@Headers('authorization') auth: string) {
    const c = await this.context(auth); this.roles(c, ['ADMIN', 'MANAGER', 'INVENTORY', 'ACCOUNTANT']);
    return this.inventoryAi.inventoryInsights(c.companyId);
  }

  @ApiBearerAuth() @Get('sales') async sales(@Headers('authorization') auth: string, @Query() query: any) { const c = await this.context(auth); return this.service.listSales(c.companyId, query); }
  @ApiBearerAuth() @Post('sales') async createSale(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); return this.service.createSale(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Get('returns') async returns(@Headers('authorization') auth: string) { const c = await this.context(auth); return this.service.listReturns(c.companyId); }
  @ApiBearerAuth() @Post('returns') async createReturn(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','CASHIER']); return this.service.createReturn(c.companyId, c.sub, body); }

  @ApiBearerAuth() @Get('cash/sessions') async cashSessions(@Headers('authorization') auth: string, @Query('status') status?: string) { const c = await this.context(auth); return this.service.cashSessions(c.companyId, c.sub, c.role, status); }
  @ApiBearerAuth() @Post('cash/open') async openCash(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); return this.service.openCash(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Post('cash/movements') async cashMovement(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); return this.service.cashMovement(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Post('cash/sessions/:id/close') async closeCash(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: any) { const c = await this.context(auth); return this.service.closeCash(c.companyId, c.sub, c.role, id, body); }

  @ApiBearerAuth() @Get('purchases') async purchases(@Headers('authorization') auth: string) { const c = await this.context(auth); return this.service.listPurchases(c.companyId); }
  @ApiBearerAuth() @Post('purchases') async createPurchase(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY','ACCOUNTANT']); return this.service.createPurchase(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Post('purchases/:id/receive') async receivePurchase(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.receivePurchase(c.companyId, c.sub, id, body); }
  @ApiBearerAuth() @Post('purchases/:id/cancel') async cancelPurchase(@Headers('authorization') auth: string, @Param('id') id: string) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.cancelPurchase(c.companyId, c.sub, id); }

  @ApiBearerAuth() @Get('expenses') async expenses(@Headers('authorization') auth: string, @Query() query: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','ACCOUNTANT']); return this.service.listExpenses(c.companyId, query); }
  @ApiBearerAuth() @Post('expenses') async createExpense(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','ACCOUNTANT']); return this.service.createExpense(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Get('receivables') async receivables(@Headers('authorization') auth: string) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','ACCOUNTANT']); return this.service.receivables(c.companyId); }
  @ApiBearerAuth() @Post('receivables/:id/payments') async payReceivable(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','CASHIER','ACCOUNTANT']); return this.service.payReceivable(c.companyId, c.sub, id, body); }
  @ApiBearerAuth() @Get('payables') async payables(@Headers('authorization') auth: string) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','ACCOUNTANT']); return this.service.payables(c.companyId); }
  @ApiBearerAuth() @Post('payables/:id/payments') async payPayable(@Headers('authorization') auth: string, @Param('id') id: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','ACCOUNTANT']); return this.service.payPayable(c.companyId, c.sub, id, body); }
  @ApiBearerAuth() @Get('inventory/transfers') async stockTransfers(@Headers('authorization') auth: string) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.stockTransfers(c.companyId); }
  @ApiBearerAuth() @Post('inventory/transfers') async createStockTransfer(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.createStockTransfer(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Get('supplier-returns') async supplierReturns(@Headers('authorization') auth: string) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY','ACCOUNTANT']); return this.service.supplierReturns(c.companyId); }
  @ApiBearerAuth() @Post('supplier-returns') async createSupplierReturn(@Headers('authorization') auth: string, @Body() body: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','INVENTORY']); return this.service.createSupplierReturn(c.companyId, c.sub, body); }
  @ApiBearerAuth() @Get('reports') async reports(@Headers('authorization') auth: string, @Query() query: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','ACCOUNTANT']); return this.service.reports(c.companyId, query); }
  @ApiBearerAuth() @Get('audit-logs') async auditLogs(@Headers('authorization') auth: string, @Query() query: any) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER']); return this.service.auditLogs(c.companyId, query); }
  @ApiBearerAuth() @Get('electronic-invoice/status') async eInvoiceStatus(@Headers('authorization') auth: string) { const c = await this.context(auth); this.roles(c, ['ADMIN','MANAGER','ACCOUNTANT']); return this.service.electronicInvoiceStatus(c.companyId); }
}
