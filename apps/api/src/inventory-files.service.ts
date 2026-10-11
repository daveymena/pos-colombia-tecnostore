import { BadRequestException, ConflictException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as mammoth from 'mammoth';
import * as cheerio from 'cheerio';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { PrismaService } from './prisma.service';
import { OpenCodeInventoryService } from './opencode-inventory.service';

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
  guessed?: string[];
  warehouseDefaulted?: boolean;
  willCreate?: boolean;
  newSku?: string;
};

const cleanHeader = (value: unknown) => String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const parseNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  let text = String(value ?? '').trim().replace(/[$\s]/g, '').replace(/cop/gi, '').replace(/[^\d.,-]/g, '');
  if (!text || text === '-' || text === '.' || text === ',') return Number.NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else {
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
    else if (lastDot >= 0) text = text.replace(/,/g, '');
  }
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : Number.NaN;
};
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const nonEmpty = (cells: string[]) => cells.some((cell) => String(cell ?? '').trim() !== '');

@Injectable()
export class InventoryFilesService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly ai?: OpenCodeInventoryService) {}

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
        if (nonEmpty(row)) rows.push(row);
        row = [];
      } else value += char;
    }
    row.push(value);
    if (nonEmpty(row)) rows.push(row);
    return rows;
  }

  private async readXlsx(buffer: Buffer): Promise<Matrix> {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as any);
    let best: Matrix = [];
    for (const sheet of book.worksheets) {
      const rows: Matrix = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values: string[] = [];
        for (let i = 1; i <= sheet.columnCount; i++) {
          const cell = row.getCell(i);
          const cellValue: any = cell.value;
          values.push(cellValue && typeof cellValue === 'object' && 'formula' in cellValue ? '' : cell.text || '');
        }
        if (nonEmpty(values)) rows.push(values);
      });
      if (rows.flat().filter((c) => String(c).trim()).length > best.flat().filter((c) => String(c).trim()).length) best = rows;
    }
    if (!best.length) throw new BadRequestException('El Excel no tiene filas con datos.');
    return best;
  }

  private async readDocx(buffer: Buffer): Promise<Matrix> {
    const { value: html } = await mammoth.convertToHtml({ buffer });
    const $ = cheerio.load(html);
    const tables = $('table').toArray();
    if (!tables.length) {
      const lines = $('p').toArray().map((p) => $(p).text().trim()).filter(Boolean);
      if (lines.length >= 2) return this.parseDelimited(lines.join('\n'), '\t');
      throw new BadRequestException('El Word no trae tabla ni lista legible. Pega el conteo en una tabla o usa la plantilla.');
    }
    let best: Matrix = [];
    for (const table of tables) {
      const rows = $(table).find('tr').toArray().map((tr) => $(tr).find('th,td').toArray().map((cell) => $(cell).text().trim()));
      if (rows.flat().filter((c) => c).length > best.flat().filter((c) => c).length) best = rows;
    }
    return best;
  }

  private async readXlsxLoose(buffer: Buffer): Promise<Matrix> {
    // Respaldo para archivos que ExcelJS no puede abrir (dibujos/comentarios heredados):
    // lee directamente sheet1.xml + cadenas compartidas del ZIP.
    const zip = await JSZip.loadAsync(buffer);
    const sheetEntry = Object.keys(zip.files).find((name) => /^xl\/worksheets\/sheet1\.xml$/i.test(name));
    if (!sheetEntry) throw new BadRequestException('El Excel no trae una hoja legible.');
    const stringsEntry = Object.keys(zip.files).find((name) => /^xl\/sharedStrings\.xml$/i.test(name));
    let shared: string[] = [];
    if (stringsEntry) {
      const xml = await zip.files[stringsEntry].async('string');
      const $ = cheerio.load(xml, { xmlMode: true });
      shared = $('si').toArray().map((si) => $(si).find('t').toArray().map((t) => $(t).text()).join(''));
    }
    const sheetXml = await zip.files[sheetEntry].async('string');
    const $ = cheerio.load(sheetXml, { xmlMode: true });
    const rows: Matrix = [];
    $('sheetData > row').each((_, row) => {
      const values: string[] = [];
      $(row).find('c').each((__, cell) => {
        const type = $(cell).attr('t');
        if (type === 'inlineStr') values.push($(cell).find('is t').toArray().map((t) => $(t).text()).join(''));
        else if (type === 's') values.push(shared[Number($(cell).find('v').text())] ?? '');
        else if (type === 'str' || type === undefined) values.push($(cell).find('v').text() || '');
        else values.push($(cell).find('v').text() || '');
      });
      if (nonEmpty(values)) rows.push(values);
    });
    if (!rows.length) throw new BadRequestException('El Excel no tiene filas con datos.');
    return rows;
  }

  private async readMatrix(buffer: Buffer, filename: string): Promise<Matrix> {
    if (buffer.length > 12 * 1024 * 1024) throw new BadRequestException('El archivo supera el tamaño máximo permitido.');
    const magic = buffer.subarray(0, 4);
    const ext = filename.toLowerCase().split('.').pop() || '';
    if (magic[0] === 0xd0 && magic[1] === 0xcf) {
      throw new BadRequestException('Es un archivo Office antiguo (.xls/.doc). Ábrelo y guárdalo como .xlsx o .docx, o copia las filas a la plantilla.');
    }
    const looksZip = magic[0] === 0x50 && magic[1] === 0x4b;
    if (looksZip || ext === 'xlsx') {
      let lastError: any = null;
      for (const reader of [() => this.readXlsx(buffer), () => this.readXlsxLoose(buffer)]) {
        try { return await reader(); }
        catch (error: any) {
          if (error instanceof BadRequestException && /hojas/.test(error.message)) throw error;
          lastError = error;
        }
      }
      if (ext === 'docx') {
        try { return await this.readDocx(buffer); } catch { /* sigue abajo */ }
      }
      if (['xlsx', 'xls', 'ods'].includes(ext)) {
        throw new BadRequestException('El Excel está dañado o usa funciones no soportadas. Prueba guardarlo de nuevo como .xlsx o usa la plantilla.');
      }
      try { return await this.readDocx(buffer); }
      catch { throw new BadRequestException('No se pudo leer el archivo como Excel ni como Word.'); }
    }
    if (ext === 'docx' || looksZip) {
      try { return await this.readDocx(buffer); } catch { /* sigue a texto */ }
    }
    if (ext === 'json') {
      let parsed: unknown;
      try { parsed = JSON.parse(buffer.toString('utf8').replace(/^﻿/, '')); }
      catch { throw new BadRequestException('El archivo JSON no tiene formato válido.'); }
      if (!Array.isArray(parsed) || !parsed.length || typeof parsed[0] !== 'object') throw new BadRequestException('El JSON debe ser una lista de filas de inventario.');
      const records = parsed as Record<string, unknown>[];
      const keys = Object.keys(records[0]);
      return [keys, ...records.map((record) => keys.map((key) => String(record[key] ?? '')))];
    }
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    if (!text.trim()) throw new BadRequestException('El archivo está vacío o no es texto legible.');
    const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5).join('\n');
    const counts: Record<string, number> = { '\t': 0, ';': 0, ',': 0, '|': 0 };
    for (const d of Object.keys(counts)) counts[d] = sample.split(d).length - 1;
    const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return this.parseDelimited(text, ordered[0][1] > 0 ? ordered[0][0] : ',');
  }

  private headerIndex(headers: string[]) {
    const aliases: Record<string, string[]> = {
      sku: ['sku', 'codigo', 'codigoproducto', 'referencia', 'productcode', 'cod'],
      name: ['nombre', 'nombredelproducto', 'nombreproducto', 'productname', 'name', 'producto', 'product', 'descripcion', 'description', 'articulo', 'item'],
      barcode: ['barcode', 'codigobarras', 'ean', 'upc', 'gtin'],
      warehouseId: ['warehouseid', 'bodegaid', 'idbodega'],
      warehouse: ['warehouse', 'bodega', 'almacen', 'warehousename', 'nombrebodega'],
      branch: ['branch', 'sucursal', 'branchname', 'nombresucursal'],
      counted: ['countedquantity', 'cantidadcontada', 'conteo', 'conteofisico', 'existenciafisica', 'stockcontado', 'nuevacantidad', 'quantity', 'cantidad', 'cantfisica', 'cantidade', 'cant', 'qty', 'stock', 'existencias', 'existencia', 'inventario', 'cantidadfisica'],
    };
    const normalized = headers.map(cleanHeader);
    const found: Record<string, number> = {};
    for (const [key, names] of Object.entries(aliases)) {
      const pos = normalized.findIndex((header) => names.includes(header));
      if (pos >= 0) found[key] = pos;
    }
    return found;
  }

  private detectHeaderRow(matrix: Matrix): number {
    for (let i = 0; i < Math.min(matrix.length, 6); i++) {
      const idx = this.headerIndex(matrix[i]);
      if (idx.sku !== undefined || idx.name !== undefined || idx.barcode !== undefined || idx.counted !== undefined) return i;
    }
    return 0;
  }

  private slugSku(name: string, taken: Set<string>): string {
    const base = (name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'ITEM');
    let candidate = base;
    let n = 2;
    while (taken.has(candidate.toLowerCase())) candidate = `${base}-${n++}`;
    return candidate;
  }

  async mapAssist(buffer: Buffer, filename: string, model?: string) {
    if (!this.ai) throw new BadRequestException('El asistente IA no está disponible en este servidor.');
    let matrix: Matrix;
    try { matrix = await this.readMatrix(buffer, filename); }
    catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('No se pudo leer el archivo para el mapeo.');
    }
    const headerAt = this.detectHeaderRow(matrix);
    const headers = matrix[headerAt] || [];
    const samples = matrix.slice(headerAt + 1).filter((row) => nonEmpty(row)).slice(0, 5);
    if (!headers.length || !samples.length) throw new BadRequestException('El archivo no trae encabezados ni filas de ejemplo para mapear.');
    const mapping = await this.ai.assistJson(
      'Eres un integrador de datos de inventario. Dadas unas cabeceras y filas de ejemplo de un archivo de conteo físico, devuelve SOLO un JSON con el mapeo a estos campos: sku, name, barcode, warehouseId, warehouse, branch, counted. Usa el índice de columna (base 0) o null si no existe. Responde únicamente el JSON, sin explicaciones.',
      `Cabeceras: ${JSON.stringify(headers)}\nEjemplos: ${JSON.stringify(samples)}`,
      model,
    );
    return { headers, mapping, samples: samples.length };
  }

  async previewImport(companyId: string, buffer: Buffer, filename: string, overrides?: { mapping?: Record<string, number | null>; createMissing?: boolean }) {
    let matrix: Matrix;
    try { matrix = await this.readMatrix(buffer, filename); }
    catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('No se pudo leer el archivo. Comprueba que sea un Excel, Word, CSV, TXT o JSON válido.');
    }
    const headerAt = this.detectHeaderRow(matrix);
    const dataRows = matrix.slice(headerAt + 1).filter((row) => nonEmpty(row));
    if (!dataRows.length) throw new BadRequestException('El archivo no trae filas de conteo debajo de los encabezados.');
    const auto = this.headerIndex(matrix[headerAt] || []);
    // Si no se detecta nada útil, intenta con la primera fila de datos como si no hubiera encabezados.
    let index = auto;
    let startAt = 0;
    if (index.sku === undefined && index.name === undefined && index.barcode === undefined && index.counted === undefined) {
      index = { sku: 0, counted: 1 };
      startAt = -1; // incluye todas las filas como datos
    }
    if (overrides?.mapping) {
      for (const [key, value] of Object.entries(overrides.mapping)) {
        if (value === null || value === undefined) delete (index as any)[key];
        else (index as any)[key] = Number(value);
      }
    }
    const rows = startAt === -1 ? matrix.slice(headerAt).filter((row) => nonEmpty(row)) : dataRows;
    const lineBase = startAt === -1 ? headerAt + 1 : headerAt + 2;

    const [products, warehouses, balances] = await Promise.all([
      this.prisma.product.findMany({ where: { companyId, active: true }, select: { id: true, sku: true, name: true, barcode: true } }),
      this.prisma.warehouse.findMany({ where: { branch: { companyId }, active: true }, include: { branch: { select: { name: true } } } }),
      this.prisma.inventoryBalance.findMany({ where: { product: { companyId } }, select: { productId: true, warehouseId: true, quantity: true } }),
    ]);
    if (!warehouses.length) throw new BadRequestException('La empresa no tiene bodegas activas.');
    const defaultWarehouse = warehouses[0];
    const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
    const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [String(p.barcode).toLowerCase(), p]));
    const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
    const balanceByKey = new Map(balances.map((b) => [`${b.productId}:${b.warehouseId}`, Number(b.quantity)]));
    const skuSet = new Set(products.map((p) => p.sku.toLowerCase()));
    const seenSkus = new Set<string>();
    const out: InventoryImportRow[] = [];
    const seen = new Set<string>();
    rows.forEach((cells, i) => {
      const line = lineBase + i;
      const guessed: string[] = [];
      const get = (pos?: number) => (pos === undefined ? '' : String(cells[pos] ?? '').trim());
      const skuText = get(index.sku);
      const nameText = get(index.name);
      const barcodeText = get(index.barcode);
      const countedQuantity = index.counted === undefined ? Number.NaN : parseNumber(cells[index.counted]);
      let product = skuText ? bySku.get(skuText.toLowerCase()) : undefined;
      if (!product && barcodeText) { product = byBarcode.get(barcodeText.toLowerCase()); if (product) guessed.push('producto por código de barras'); }
      if (!product && nameText) {
        product = byName.get(nameText.toLowerCase());
        if (product) guessed.push('producto por nombre exacto');
        else {
          const matches = products.filter((p) => p.name.toLowerCase().includes(nameText.toLowerCase()) || nameText.toLowerCase().includes(p.name.toLowerCase()));
          if (matches.length === 1) { product = matches[0]; guessed.push('producto por nombre aproximado'); }
        }
      }
      let warehouseId = index.warehouseId !== undefined ? get(index.warehouseId) : '';
      const warehouseName = index.warehouse !== undefined ? get(index.warehouse) : '';
      const branchName = index.branch !== undefined ? get(index.branch) : '';
      let warehouse = warehouseId ? warehouses.find((item) => item.id === warehouseId) : undefined;
      if (!warehouse && warehouseName) {
        const matches = warehouses.filter((item) => item.name.toLowerCase() === warehouseName.toLowerCase() && (!branchName || item.branch.name.toLowerCase() === branchName.toLowerCase()));
        if (matches.length === 1) { warehouse = matches[0]; guessed.push('bodega por nombre'); }
      }
      let warehouseDefaulted = false;
      if (!warehouse) { warehouse = defaultWarehouse; warehouseDefaulted = true; guessed.push(`bodega por defecto: ${defaultWarehouse.name}`); }
      const row: InventoryImportRow = { line, sku: skuText || nameText || barcodeText, countedQuantity, valid: true, guessed, warehouseDefaulted };
      const canCreate = Boolean(overrides?.createMissing) && (skuText || nameText) && Number.isFinite(countedQuantity) && (countedQuantity as number) >= 0;
      if (!product && canCreate) {
        const desiredSku = skuText || this.slugSku(nameText, seenSkus);
        if (skuSet.has(desiredSku.toLowerCase())) {
          row.valid = false;
          row.error = 'Otro producto de esta empresa ya usa ese SKU; cámbialo en el archivo.';
        } else {
          row.valid = true;
          row.willCreate = true;
          row.newSku = desiredSku;
          row.productName = nameText || desiredSku;
          row.sku = desiredSku;
          guessed.push('se creará el producto (precio y costo en 0)');
          seenSkus.add(desiredSku.toLowerCase());
        }
      } else if (!product) { row.valid = false; row.error = 'No se encontró el producto por SKU, código de barras ni nombre. Revísalo o créalo antes.'; }
      else if (index.counted === undefined || !Number.isFinite(countedQuantity) || countedQuantity < 0) { row.valid = false; row.error = 'No se identificó una cantidad contada válida en la fila.'; }
      if (product) { row.productId = product.id; row.productName = product.name; if (!row.sku) row.sku = product.sku; }
      if (warehouse) { row.warehouseId = warehouse.id; row.warehouseName = warehouse.name; row.branchName = warehouse.branch.name; }
      if (row.valid && product && warehouse) {
        const key = `${product.id}:${warehouse.id}`;
        if (seen.has(key)) { row.valid = false; row.error = 'Producto y bodega repetidos en el mismo archivo.'; }
        seen.add(key);
        const expectedQuantity = balanceByKey.get(key) ?? 0;
        row.expectedQuantity = expectedQuantity;
        row.delta = Math.round((countedQuantity - expectedQuantity) * 1000) / 1000;
      }
      out.push(row);
    });
    if (!out.length) throw new BadRequestException('No se encontraron filas de inventario para importar.');
    return { filename, total: out.length, valid: out.filter((row) => row.valid).length, invalid: out.filter((row) => !row.valid).length, headers: matrix[headerAt] || [], detected: index, rows: out };
  }

  async applyImport(companyId: string, userId: string, input: { rows: InventoryImportRow[]; note?: string }) {
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 5000) throw new BadRequestException('El conteo debe tener entre 1 y 5000 filas.');
    if (input.rows.some((row) => !row.valid || (!row.productId && !row.willCreate) || !row.warehouseId || !Number.isFinite(Number(row.countedQuantity)))) {
      throw new BadRequestException('Corrige o excluye todas las filas inválidas antes de aplicar el conteo.');
    }
    const unique = new Set<string>();
    for (const row of input.rows) {
      const key = `${row.willCreate ? `new:${String(row.newSku || row.sku).toLowerCase()}` : row.productId}:${row.warehouseId}`;
      if (unique.has(key)) throw new BadRequestException('El mismo producto y bodega aparecen más de una vez.');
      unique.add(key);
    }
    const importId = `CONTEO-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    return this.prisma.$transaction(async (tx) => {
      const applied: { sku: string; counted: number; delta: number; created?: boolean }[] = [];
      for (const row of input.rows) {
        let productId = row.productId;
        let created = false;
        if (row.willCreate && !productId) {
          const sku = row.newSku || row.sku;
          if (!sku) throw new BadRequestException(`Fila ${row.line}: falta SKU para crear el producto.`);
          const dup = await tx.product.findUnique({ where: { companyId_sku: { companyId, sku } } });
          if (dup) throw new BadRequestException(`Fila ${row.line}: el SKU ${sku} ya existe; vuelve a cargar la vista previa.`);
          const createdProduct = await tx.product.create({ data: { companyId, sku, name: (row.productName || sku).slice(0, 120), kind: 'STOCK', price: 0, cost: 0, taxRate: 0, stockMin: 0 } });
          productId = createdProduct.id;
          created = true;
        }
        const product = await tx.product.findFirst({ where: { id: productId, companyId, active: true }, select: { id: true, sku: true, cost: true } });
        const warehouse = await tx.warehouse.findFirst({ where: { id: row.warehouseId, branch: { companyId }, active: true }, select: { id: true } });
        if (!product || !warehouse) throw new BadRequestException(`Fila ${row.line}: producto o bodega no pertenece a esta empresa.`);
        const balance = await tx.inventoryBalance.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } });
        const current = Number(balance?.quantity ?? 0);
        if (row.expectedQuantity !== undefined && Math.abs(current - Number(row.expectedQuantity)) > 0.0005) throw new ConflictException(`El stock de ${product.sku} cambió desde la vista previa. Vuelve a cargar el archivo y revisa el nuevo saldo.`);
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
          await tx.inventoryBalance.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: counted } });
        }
        applied.push({ sku: product.sku, counted, delta, created });
      }
      await tx.auditLog.create({ data: { companyId, userId, action: 'INVENTORY_COUNT_IMPORT', entity: 'Inventory', entityId: importId, metadata: { rows: applied.length, changed: applied.filter((row) => row.delta !== 0).length, created: applied.filter((row) => row.created).length, note: input.note || null } } });
      return { importId, rows: applied.length, changed: applied.filter((row) => row.delta !== 0).length, unchanged: applied.filter((row) => row.delta === 0 && !row.created).length, created: applied.filter((row) => row.created).length, applied };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 30000, timeout: 120000 });
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
      return { buffer: Buffer.from(`﻿${lines.join('\r\n')}`, 'utf8'), contentType: 'text/plain; charset=utf-8', extension: 'txt' };
    }
    if (format === 'csv') {
      const lines = [headers.join(','), ...records.map((record) => headers.map((header) => csvCell((record as any)[header])).join(','))];
      return { buffer: Buffer.from(`﻿${lines.join('\r\n')}`, 'utf8'), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
    }
    if (format === 'json') return { buffer: Buffer.from(JSON.stringify(records, null, 2), 'utf8'), contentType: 'application/json; charset=utf-8', extension: 'json' };
    throw new BadRequestException('Formato no válido. Usa xlsx, docx, txt, csv o json.');
  }
}
