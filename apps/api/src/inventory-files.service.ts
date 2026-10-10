import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { PrismaService } from './prisma.service';

type Matrix = string[][];
export type InventoryImportRow = {
  line: number;
  sku: string;
  productId?: string;
  productName?: string;
  warehouseId?: string;
  warehouseName?: string;
  branchName?: string;
  expectedQuantity?: number;
  countedQuantity?: number;
  delta?: number;
  valid: boolean;
  error?: string;
};

const cleanHeader = (value: unknown) => String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
const parseNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  let text = String(value ?? '').trim().replace(/\s/g, '').replace(/[$COP]/gi, '');
  if (!text) return Number.NaN;
  // Accept Colombian 1.234,5 as well as spreadsheet 1234.5.
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (text.includes(',') && !text.includes('.')) text = text.replace(',', '.');
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : Number.NaN;
};
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

@Injectable()
export class InventoryFilesService {
  constructor(private readonly prisma: PrismaService) {}

  private parseDelimited(text: string, delimiter: string): Matrix {
    const rows: Matrix = []; let row: string[] = []; let value = ''; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
        else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) { row.push(value); value = ''; }
      else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row.push(value); value = '';
        if (row.some((cell) => cell.trim() !== '')) rows.push(row);
        row = [];
      } else value += char;
    }
    row.push(value);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    return rows;
  }

  private async readMatrix(buffer: Buffer, filename: string): Promise<Matrix> {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'xlsx') {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(buffer as any);
      const sheet = book.worksheets[0];
      if (!sheet) throw new BadRequestException('El libro de Excel no contiene hojas.');
      const rows: Matrix = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values: string[] = [];
        for (let i = 1; i <= sheet.columnCount; i++) {
          const cell = row.getCell(i);
          const cellValue: any = cell.value;
          values.push(cellValue && typeof cellValue === 'object' && 'formula' in cellValue ? '' : cell.text || '');
        }
        rows.push(values);
      });
      return rows;
    }
    if (ext === 'docx') {
      const { value: html } = await mammoth.convertToHtml({ buffer });
      const $ = cheerio.load(html);
      const table = $('table').first();
      if (!table.length) throw new BadRequestException('El Word debe contener una tabla de inventario. Descarga la plantilla DOCX desde Inventario.');
      return table.find('tr').toArray().map((tr) => $(tr).find('th,td').toArray().map((cell) => $(cell).text().trim()));
    }
    if (ext === 'json') {
      let parsed: unknown;
      try { parsed = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, '')); }
      catch { throw new BadRequestException('El archivo JSON no tiene formato válido.'); }
      if (!Array.isArray(parsed) || !parsed.length || typeof parsed[0] !== 'object') throw new BadRequestException('El JSON debe ser una lista de filas de inventario.');
      const records = parsed as Record<string, unknown>[];
      const keys = Object.keys(records[0]);
      return [keys, ...records.map((record) => keys.map((key) => String(record[key] ?? '')))];
    }
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
    return this.parseDelimited(text, delimiter);
  }

  private headerIndex(headers: string[]) {
    const aliases: Record<string, string[]> = {
      sku: ['sku', 'codigo', 'codigoproducto', 'referencia', 'productcode'],
      warehouseId: ['warehouseid', 'bodegaid', 'idbodega'],
      warehouse: ['warehouse', 'bodega', 'almacen', 'warehousename', 'nombrebodega'],
      branch: ['branch', 'sucursal', 'branchname', 'nombresucursal'],
      counted: ['countedquantity', 'cantidadcontada', 'conteo', 'existenciafisica', 'stockcontado', 'nuevacantidad', 'quantity', 'cantidad'],
    };
    const normalized = headers.map(cleanHeader);
    const found: Record<string, number> = {};
    for (const [key, names] of Object.entries(aliases)) {
      const pos = normalized.findIndex((header) => names.includes(header));
      if (pos >= 0) found[key] = pos;
    }
    return found;
  }

  async previewImport(companyId: string, buffer: Buffer, filename: string) {
    let matrix: Matrix;
    try { matrix = await this.readMatrix(buffer, filename); }
    catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('No se pudo leer el archivo. Comprueba que sea un Excel, Word, CSV, TXT o JSON válido.');
    }
    if (matrix.length < 2) throw new BadRequestException('El archivo debe incluir encabezados y al menos una fila.');
    const index = this.headerIndex(matrix[0]);
    if (index.sku === undefined || index.counted === undefined) {
      throw new BadRequestException('Faltan encabezados obligatorios: SKU y Cantidad contada. Descarga una plantilla desde Inventario.');
    }

    const [products, warehouses, balances] = await Promise.all([
      this.prisma.product.findMany({ where: { companyId, active: true }, select: { id: true, sku: true, name: true } }),
      this.prisma.warehouse.findMany({ where: { branch: { companyId }, active: true }, include: { branch: { select: { name: true } } } }),
      this.prisma.inventoryBalance.findMany({ where: { product: { companyId } }, select: { productId: true, warehouseId: true, quantity: true } }),
    ]);
    const productBySku = new Map(products.map((product) => [product.sku.toLowerCase(), product]));
    const balanceByKey = new Map(balances.map((balance) => [`${balance.productId}:${balance.warehouseId}`, Number(balance.quantity)]));
    const rows: InventoryImportRow[] = [];
    const seen = new Set<string>();
    for (let i = 1; i < matrix.length; i++) {
      const cells = matrix[i];
      if (!cells.some((cell) => String(cell ?? '').trim())) continue;
      const sku = String(cells[index.sku] ?? '').trim();
      const countedQuantity = parseNumber(cells[index.counted]);
      let product = productBySku.get(sku.toLowerCase());
      let warehouseId = index.warehouseId !== undefined ? String(cells[index.warehouseId] ?? '').trim() : '';
      const warehouseName = index.warehouse !== undefined ? String(cells[index.warehouse] ?? '').trim() : '';
      const branchName = index.branch !== undefined ? String(cells[index.branch] ?? '').trim() : '';
      let warehouse = warehouseId ? warehouses.find((item) => item.id === warehouseId) : undefined;
      if (!warehouse && warehouseName) {
        const matches = warehouses.filter((item) => item.name.toLowerCase() === warehouseName.toLowerCase() && (!branchName || item.branch.name.toLowerCase() === branchName.toLowerCase()));
        if (matches.length === 1) warehouse = matches[0];
      }
      const row: InventoryImportRow = { line: i + 1, sku, countedQuantity, valid: true };
      if (!sku) { row.valid = false; row.error = 'Falta SKU.'; }
      else if (!product) { row.valid = false; row.error = 'No existe un producto activo con este SKU en esta empresa.'; }
      else if (!Number.isFinite(countedQuantity) || countedQuantity < 0) { row.valid = false; row.error = 'La cantidad contada debe ser un número igual o mayor que cero.'; }
      else if (!warehouse) { row.valid = false; row.error = warehouseName ? 'Bodega no identificada o ambigua; usa warehouseId de la plantilla.' : 'Falta la bodega.'; }
      if (product) {
        row.productId = product.id;
        row.productName = product.name;
      }
      if (warehouse) {
        row.warehouseId = warehouse.id;
        row.warehouseName = warehouse.name;
        row.branchName = warehouse.branch.name;
      }
      if (row.valid && product && warehouse) {
        const key = `${product.id}:${warehouse.id}`;
        if (seen.has(key)) { row.valid = false; row.error = 'SKU y bodega repetidos en el mismo archivo.'; }
        seen.add(key);
        const expectedQuantity = balanceByKey.get(key) ?? 0;
        row.expectedQuantity = expectedQuantity;
        row.delta = Math.round((countedQuantity - expectedQuantity) * 1000) / 1000;
      }
      rows.push(row);
    }
    if (!rows.length) throw new BadRequestException('No se encontraron filas de inventario para importar.');
    return { filename, total: rows.length, valid: rows.filter((row) => row.valid).length, invalid: rows.filter((row) => !row.valid).length, rows };
  }

  async applyImport(companyId: string, userId: string, input: { rows: InventoryImportRow[]; note?: string }) {
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 5000) throw new BadRequestException('El conteo debe tener entre 1 y 5000 filas.');
    if (input.rows.some((row) => !row.valid || !row.productId || !row.warehouseId || !Number.isFinite(Number(row.countedQuantity)))) {
      throw new BadRequestException('Corrige o excluye todas las filas inválidas antes de aplicar el conteo.');
    }
    const unique = new Set<string>();
    for (const row of input.rows) {
      const key = `${row.productId}:${row.warehouseId}`;
      if (unique.has(key)) throw new BadRequestException('El mismo SKU y bodega aparecen más de una vez.');
      unique.add(key);
    }
    const importId = `CONTEO-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    return this.prisma.$transaction(async (tx) => {
      const applied: { sku: string; counted: number; delta: number }[] = [];
      for (const row of input.rows) {
        const product = await tx.product.findFirst({ where: { id: row.productId, companyId, active: true }, select: { id: true, sku: true, cost: true } });
        const warehouse = await tx.warehouse.findFirst({ where: { id: row.warehouseId, branch: { companyId }, active: true }, select: { id: true } });
        if (!product || !warehouse) throw new BadRequestException(`Fila ${row.line}: producto o bodega no pertenece a esta empresa.`);
        const balance = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } });
        const current = Number(balance?.quantity ?? 0);
        if (Math.abs(current - Number(row.expectedQuantity ?? 0)) > 0.0005) throw new ConflictException(`El stock de ${product.sku} cambió desde la vista previa. Vuelve a cargar el archivo y revisa el nuevo saldo.`);
        const counted = Math.round(Number(row.countedQuantity) * 1000) / 1000;
        const delta = Math.round((counted - current) * 1000) / 1000;
        if (delta !== 0) {
          if (balance) {
            const updated = await tx.inventoryBalance.updateMany({ where: { id: balance.id, quantity: balance.quantity }, data: { quantity: counted } });
            if (!updated.count) throw new ConflictException(`El stock de ${product.sku} cambió durante la aplicación.`);
          } else {
            await tx.inventoryBalance.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: counted } });
          }
          await tx.stockMovement.create({ data: { productId: product.id, warehouseId: warehouse.id, userId, type: 'ADJUSTMENT', quantity: delta, unitCost: product.cost, reference: importId, note: (input.note || 'Conteo físico importado').slice(0, 240) } });
        } else if (!balance) {
          // Persist an explicitly counted zero so it remains visible in stock listings and future count templates.
          await tx.inventoryBalance.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: counted } });
        }
        applied.push({ sku: product.sku, counted, delta });
      }
      await tx.auditLog.create({ data: { companyId, userId, action: 'INVENTORY_COUNT_IMPORT', entity: 'Inventory', entityId: importId, metadata: { rows: applied.length, changed: applied.filter((row) => row.delta !== 0).length, note: input.note || null } } });
      return { importId, rows: applied.length, changed: applied.filter((row) => row.delta !== 0).length, unchanged: applied.filter((row) => row.delta === 0).length, applied };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async exportInventory(companyId: string, format: string) {
    const [products, warehouses, balances] = await Promise.all([
      this.prisma.product.findMany({ where: { companyId, active: true, kind: 'STOCK' }, include: { category: true }, orderBy: { name: 'asc' } }),
      this.prisma.warehouse.findMany({ where: { branch: { companyId, active: true }, active: true }, include: { branch: { select: { name: true } } }, orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }] }),
      this.prisma.inventoryBalance.findMany({ where: { product: { companyId, active: true, kind: 'STOCK' }, warehouse: { branch: { companyId, active: true }, active: true } }, select: { productId: true, warehouseId: true, quantity: true } }),
    ]);
    const balanceByKey = new Map(balances.map((balance) => [`${balance.productId}:${balance.warehouseId}`, Number(balance.quantity)]));
    const records = products.flatMap((product) => warehouses.map((warehouse) => {
      const quantity = balanceByKey.get(`${product.id}:${warehouse.id}`) ?? 0;
      return {
        sku: product.sku,
        producto: product.name,
        codigoBarras: product.barcode ?? '',
        categoria: product.category?.name ?? '',
        sucursal: warehouse.branch.name,
        bodega: warehouse.name,
        warehouseId: warehouse.id,
        cantidadActual: quantity,
        cantidadContada: quantity,
        costoUnitario: Number(product.cost),
        valorInventario: Math.round(quantity * Number(product.cost) * 100) / 100,
        stockMinimo: Number(product.stockMin),
      };
    }));
    const headers = ['sku', 'producto', 'codigoBarras', 'sucursal', 'bodega', 'warehouseId', 'cantidadActual', 'cantidadContada', 'costoUnitario', 'valorInventario', 'stockMinimo'];
    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Conteo inventario');
      sheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(14, header.length + 3) }));
      sheet.addRows(records);
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF29234A' } };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
    }
    if (format === 'docx') {
      const tableRows = [headers.map((header) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: header, bold: true })] })] })), ...records.map((record) => headers.map((header) => new TableCell({ children: [new Paragraph(String((record as any)[header] ?? ''))] })))]
        .map((cells) => new TableRow({ children: cells }));
      const doc = new Document({ sections: [{ children: [new Paragraph({ text: 'Conteo de inventario POS Colombia', heading: 'Heading1' }), new Paragraph({ text: 'Edite la columna cantidadContada. Conserve SKU, bodega y warehouseId para reimportar.' }), new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } })] }] });
      return { buffer: await Packer.toBuffer(doc), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' };
    }
    if (format === 'txt' || format === 'tsv') {
      const lines = [headers.join('\t'), ...records.map((record) => headers.map((header) => String((record as any)[header] ?? '').replace(/[\t\r\n]/g, ' ')).join('\t'))];
      return { buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8'), contentType: 'text/plain; charset=utf-8', extension: 'txt' };
    }
    if (format === 'csv') {
      const lines = [headers.join(','), ...records.map((record) => headers.map((header) => csvCell((record as any)[header])).join(','))];
      return { buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8'), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
    }
    if (format === 'json') return { buffer: Buffer.from(JSON.stringify(records, null, 2), 'utf8'), contentType: 'application/json; charset=utf-8', extension: 'json' };
    throw new BadRequestException('Formato no válido. Usa xlsx, docx, txt, csv o json.');
  }
}
