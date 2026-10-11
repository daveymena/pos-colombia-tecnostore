import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, Users, Boxes, FileText, LogOut, Search, Plus,
  RefreshCw, CircleDollarSign, TrendingUp, AlertTriangle, Menu, X, Truck, Wallet,
  ClipboardList, RotateCcw, Receipt, ChartNoAxesCombined, Settings, ShieldCheck, ArrowLeftRight,
  Building2, UserCog, Tags, Landmark, BadgeDollarSign, History, CheckCircle2, Printer, Download, Upload, FileDown, Sparkles, Bot,
} from 'lucide-react';

const API = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000/api';
const API_ORIGIN = API.replace(/\/api\/?$/, '');
const imgSrc = (p:any) => p?.imageUrl ? `${API_ORIGIN}${p.imageUrl}` : '';
type AnyRow = Record<string, any>;
type User = { id:string; name:string; email:string; role:string; companyId:string };
type Product = { id:string; name:string; sku:string; barcode?:string; price:string|number; cost:string|number; taxRate:string|number; kind?:string; promoPrice?:string|number|null; imageUrl?:string|null; balances?:any[] };
type FieldSpec = { key:string; label:string; type?:string; required?:boolean; options?:{value:string;label:string}[]; placeholder?:string; step?:string; defaultValue?:any };
const money = (v:any) => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:2}).format(Number(v||0));
const shortDate = (v:any) => v ? new Date(v).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'}) : '—';
const showValue = (value:any) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return Array.isArray(value) ? `${value.length} registro(s)` : (value.name || value.title || value.id || JSON.stringify(value));
  return String(value);
};
const roleNames:Record<string,string> = {ADMIN:'Administrador',MANAGER:'Gerente',CASHIER:'Cajero',INVENTORY:'Inventario',ACCOUNTANT:'Contabilidad'};
const sections = [
  {name:'Dashboard', label:'Dashboard', icon:LayoutDashboard, group:'GENERAL'},
  {name:'Punto de venta', label:'Punto de venta', icon:ShoppingCart, group:'OPERACIÓN'},
  {name:'Asistente', label:'Asistente IA', icon:Bot, group:'OPERACIÓN'},
  {name:'Ventas', label:'Ventas', icon:CircleDollarSign, group:'OPERACIÓN'},
  {name:'Caja', label:'Caja y turnos', icon:Wallet, group:'OPERACIÓN'},
  {name:'Productos', label:'Productos', icon:Package, group:'INVENTARIO'},
  {name:'Categorías', label:'Categorías', icon:Tags, group:'INVENTARIO'},
  {name:'Inventario', label:'Inventario', icon:Boxes, group:'INVENTARIO'},
  {name:'Movimientos', label:'Kardex / movimientos', icon:History, group:'INVENTARIO'},
  {name:'Traslados', label:'Traslados', icon:ArrowLeftRight, group:'INVENTARIO'},
  {name:'Compras', label:'Compras', icon:Truck, group:'ABASTECIMIENTO'},
  {name:'Proveedores', label:'Proveedores', icon:Building2, group:'ABASTECIMIENTO'},
  {name:'Devoluciones proveedor', label:'Devoluciones a proveedor', icon:RotateCcw, group:'ABASTECIMIENTO'},
  {name:'Clientes', label:'Clientes', icon:Users, group:'RELACIONES'},
  {name:'Devoluciones', label:'Devoluciones de venta', icon:RotateCcw, group:'RELACIONES'},
  {name:'Cuentas por cobrar', label:'Cuentas por cobrar', icon:BadgeDollarSign, group:'FINANZAS'},
  {name:'Cuentas por pagar', label:'Cuentas por pagar', icon:Landmark, group:'FINANZAS'},
  {name:'Gastos', label:'Gastos', icon:Receipt, group:'FINANZAS'},
  {name:'Reportes', label:'Reportes', icon:ChartNoAxesCombined, group:'ANÁLISIS'},
  {name:'Usuarios', label:'Usuarios y roles', icon:UserCog, group:'ADMINISTRACIÓN'},
  {name:'Sucursales', label:'Sucursales y cajas', icon:Building2, group:'ADMINISTRACIÓN'},
  {name:'Configuración', label:'Configuración empresa', icon:Settings, group:'ADMINISTRACIÓN'},
  {name:'Auditoría', label:'Auditoría', icon:ShieldCheck, group:'ADMINISTRACIÓN'},
  {name:'Facturación electrónica', label:'Facturación electrónica', icon:FileText, group:'ADMINISTRACIÓN'},
];

const endpoints:Record<string,string> = {
  'Dashboard':'/dashboard','Productos':'/products','Categorías':'/categories','Inventario':'/inventory',
  'Movimientos':'/inventory/movements','Ventas':'/sales','Clientes':'/customers','Proveedores':'/suppliers',
  'Compras':'/purchases','Caja':'/cash/sessions','Devoluciones':'/returns','Devoluciones proveedor':'/supplier-returns',
  'Cuentas por cobrar':'/receivables','Cuentas por pagar':'/payables','Gastos':'/expenses','Reportes':'/reports',
  'Usuarios':'/users','Sucursales':'/branches','Traslados':'/inventory/transfers','Auditoría':'/audit-logs',
  'Facturación electrónica':'/electronic-invoice/status','Configuración':'/company',
};

export default function App() {
  const [token,setToken] = useState(localStorage.getItem('pos_token') || '');
  const [user,setUser] = useState<User|null>(JSON.parse(localStorage.getItem('pos_user') || 'null'));
  const [email,setEmail] = useState((import.meta as any).env.DEV ? 'admin@demo-pos.local' : '');
  const [password,setPassword] = useState((import.meta as any).env.DEV ? 'Cambiar123!' : '');
  const [section,setSection] = useState('Dashboard');
  const [data,setData] = useState<Record<string,any>>({});
  const [search,setSearch] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [mobileMenu,setMobileMenu] = useState(false);
  const [cart,setCart] = useState<{product:Product;quantity:number}[]>([]);
  const [cartSearch,setCartSearch] = useState('');
  const [branchId,setBranchId] = useState('');
  const [warehouseId,setWarehouseId] = useState('');
  const [customerId,setCustomerId] = useState('');
  const [paymentLines,setPaymentLines] = useState<{method:string;amount:string}[]>([{method:'CASH',amount:''}]);
  const [modal,setModal] = useState<{mode:string;page:string;row?:AnyRow}|null>(null);
  const [form,setForm] = useState<Record<string,any>>({});
  const [asMessages,setAsMessages]=useState<{from:'user'|'ai';text:string;actions?:any[]}[]>([{from:'ai',text:'Hola, soy el asistente del POS. Puedo buscar y crear productos, fijar precios y promociones, ajustar inventario y resumir ventas o stock bajo. Escribe lo que necesitas en lenguaje normal.'}]);
  const [asInput,setAsInput]=useState('');
  const [asExecute,setAsExecute]=useState(false);
  const [asModel,setAsModel]=useState('');
  const [asModels,setAsModels]=useState<string[]>([]);
  const [asBusy,setAsBusy]=useState(false);

  async function sendAssistant(e?:React.FormEvent) {
    if(e) e.preventDefault();
    const text=asInput.trim(); if(!text||asBusy) return;
    setAsMessages(m=>[...m,{from:'user',text}]); setAsInput(''); setAsBusy(true); setError('');
    try {
      const body:any={message:text,execute:asExecute}; if(asModel) body.model=asModel;
      const res=await request('/ai/assistant',{method:'POST',body:JSON.stringify(body)});
      setAsMessages(m=>[...m,{from:'ai',text:res.reply,actions:res.executed||[]}]);
      if((res.executed||[]).length) { await loadCore(); await loadPage(section); }
    } catch(err:any) { setAsMessages(m=>[...m,{from:'ai',text:`No pude procesarlo: ${err.message||'error del asistente'}`} ]); }
    finally { setAsBusy(false); }
  }

  const request = useCallback(async (path:string, init:RequestInit={}) => {
    const res = await fetch(`${API}${path}`,{...init,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(init.headers||{})}});
    const body = await res.json().catch(()=>({message:'El servidor devolvió una respuesta no válida'}));
    if (!res.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : (body.message || `Error HTTP ${res.status}`));
    return body;
  },[token]);

  const setRows = (key:string, value:any) => setData(prev=>({...prev,[key]:value}));
  const uploadFile = useCallback(async (path:string, form:FormData) => {
    const res = await fetch(`${API}${path}`,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{})},body:form});
    const body = await res.json().catch(()=>({message:'El servidor devolvió una respuesta no válida'}));
    if (!res.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : (body.message || `Error HTTP ${res.status}`));
    return body;
  },[token]);
  const downloadFile = useCallback(async (path:string, filename:string) => {
    const res = await fetch(`${API}${path}`,{headers:{...(token?{Authorization:`Bearer ${token}`}:{})}});
    if (!res.ok) throw new Error(`No se pudo descargar (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },[token]);
  const loadResource = useCallback(async (key:string, path:string, silent=false) => {
    try { const value = await request(path); setRows(key,value); return value; }
    catch(e:any) { if(!silent) setError(e.message || `No se pudo cargar ${key}`); return undefined; }
  },[request]);

  const loadCore = useCallback(async () => {
    if (!token) return;
    setBusy(true); setError('');
    const core:[string,string][] = [
      ['dashboard','/dashboard'],['products','/products'],['inventory','/inventory'],['sales','/sales'],
      ['customers','/customers'],['branches','/branches'],['warehouses','/warehouses'],['registers','/registers'],
      ['cashSessions','/cash/sessions'],['suppliers','/suppliers'],['categories','/categories'],
    ];
    await Promise.all(core.map(async ([key,path])=>{try{setRows(key,await request(path));}catch{/* the current role may not have permission */}}));
    setBusy(false);
  },[token,request]);

  const loadPage = useCallback(async (page:string) => {
    const path = endpoints[page];
    if (path) await loadResource(page,path);
    if (page === 'Punto de venta') {
      setError('');
      await Promise.all([
        loadResource('products','/products',true), loadResource('branches','/branches',true),
        loadResource('warehouses','/warehouses',true), loadResource('registers','/registers',true),
        loadResource('customers','/customers',true), loadResource('cashSessions','/cash/sessions?status=OPEN',true),
      ]);
    }
    if (page === 'Dashboard') await Promise.all([loadResource('inventory','/inventory',true),loadResource('sales','/sales',true)]);
    if (page === 'Sucursales') await Promise.all([loadResource('warehouses','/warehouses',true),loadResource('registers','/registers',true)]);
  },[loadResource]);

  useEffect(()=>{ if(token && user) loadCore(); },[token,user,loadCore]);
  useEffect(()=>{ if(token && user) loadPage(section); },[token,user,section,loadPage]);
  useEffect(()=>{ if(token && section==='Asistente' && !asModels.length) request('/inventory/ai/models').then((m:any)=>{ if(Array.isArray(m?.models)) setAsModels(m.models); }).catch(()=>{}); },[token,section,request,asModels.length]);
  const [setupNeeded,setSetupNeeded]=useState<boolean|null>(null);
  const [setupName,setSetupName]=useState('');
  const [setupCompany,setSetupCompany]=useState('');
  useEffect(()=>{ if(!token) fetch(`${API}/auth/setup-needed`).then(r=>r.json()).then(d=>setSetupNeeded(!!d?.needed)).catch(()=>setSetupNeeded(false)); },[token]);

  async function login(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const res = await request('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
      localStorage.setItem('pos_token',res.accessToken); localStorage.setItem('pos_user',JSON.stringify(res.user));
      setToken(res.accessToken); setUser(res.user); setSection('Dashboard');
    } catch(e:any) { setError(e.message || 'No fue posible iniciar sesión'); }
    finally { setBusy(false); }
  }
  async function setup(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const res = await request('/auth/setup',{method:'POST',body:JSON.stringify({name:setupName,email,password,company:setupCompany})});
      localStorage.setItem('pos_token',res.accessToken); localStorage.setItem('pos_user',JSON.stringify(res.user));
      setToken(res.accessToken); setUser(res.user); setSetupNeeded(false); setSection('Dashboard');
    } catch(e:any) { setError(e.message || 'No fue posible crear la cuenta inicial'); }
    finally { setBusy(false); }
  }
  function logout() { localStorage.removeItem('pos_token');localStorage.removeItem('pos_user');setToken('');setUser(null);setData({});setCart([]); }
  async function refresh() { await loadCore(); await loadPage(section); }
  const products:Product[] = data.products || [];
  const inventory:any[] = data.inventory || [];
  const branches:any[] = data.branches || [];
  const warehouses:any[] = data.warehouses || [];
  const customers:any[] = data.customers || [];
  const suppliers:any[] = data.suppliers || [];
  const sales:any[] = data.sales || [];
  const sessions:any[] = data.cashSessions || [];
  const currentBranch = branches.find(b=>b.id===branchId) || branches[0];
  const validWarehouses = warehouses.filter(w=>!currentBranch || w.branchId===currentBranch.id);
  const currentWarehouse = validWarehouses.find(w=>w.id===warehouseId) || validWarehouses[0];
  const openSession = sessions.find(s=>s.status==='OPEN' && s.userId===user?.id);
  const cartTotal = useMemo(()=>Math.round(cart.reduce((sum,line)=>sum+Number(line.product.promoPrice && Number(line.product.promoPrice)>0 && Number(line.product.promoPrice)<Number(line.product.price) ? line.product.promoPrice : line.product.price)*line.quantity*(1+Number(line.product.taxRate||0)/100),0)*100)/100,[cart]);
  const filteredProducts = products.filter(p=>`${p.name} ${p.sku} ${p.barcode||''}`.toLowerCase().includes(cartSearch.toLowerCase()));
  const displayedRows = useMemo(()=>{
    const val = data[section];
    const rows = Array.isArray(val) ? val : [];
    if(!search.trim()) return rows;
    const query = search.toLowerCase();
    return rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query));
  },[data,section,search]);

  function addToCart(p:Product) { setCart(old=>{const found=old.find(x=>x.product.id===p.id);return found?old.map(x=>x.product.id===p.id?{...x,quantity:x.quantity+1}:x):[...old,{product:p,quantity:1}];}); }
  async function checkout() {
    setError('');setNotice('');
    if(!cart.length) return;
    if(!currentBranch || !currentWarehouse) { setError('Crea o selecciona una sucursal con bodega antes de vender.'); return; }
    if(!openSession) { setError('Debes abrir una caja antes de registrar ventas. Entra a Caja y abre un turno.'); return; }
    const paymentSum = paymentLines.reduce((sum,p)=>sum+Number(p.amount||0),0);
    const normalizedPayments = paymentLines.map((p,i)=>({method:p.method,amount:paymentLines.length===1?cartTotal:Number(p.amount),reference:undefined}));
    if(paymentLines.length>1 && Math.abs(paymentSum-cartTotal)>0.01) { setError(`Los medios de pago deben sumar ${money(cartTotal)}.`); return; }
    if(normalizedPayments.some(p=>p.amount<=0)) { setError('Cada medio de pago debe tener un importe mayor que cero.'); return; }
    if(normalizedPayments.some(p=>p.method==='CREDIT') && !customerId) { setError('Selecciona un cliente para ventas a crédito.'); return; }
    setBusy(true);
    try {
      const sale = await request('/sales',{method:'POST',body:JSON.stringify({branchId:currentBranch.id,warehouseId:currentWarehouse.id,customerId:customerId||undefined,sessionId:openSession.id,items:cart.map(l=>({productId:l.product.id,quantity:l.quantity})),payments:normalizedPayments})});
      setNotice(`Venta #${sale.number} registrada correctamente por ${money(sale.total)}.`);setCart([]);setCustomerId('');setPaymentLines([{method:'CASH',amount:''}]);
      await loadCore();await loadPage('Ventas');setSection('Ventas');
    } catch(e:any) {setError(e.message || 'No se pudo registrar la venta');}
    finally {setBusy(false);}
  }

  function options(key:string) {
    if(key==='categoryId') return (data.categories||[]).map((x:any)=>({value:x.id,label:x.name}));
    if(key==='productId') return products.map(x=>({value:x.id,label:`${x.name} (${x.sku})`}));
    if(key==='warehouseId'||key==='fromWarehouseId'||key==='toWarehouseId') return warehouses.map((x:any)=>({value:x.id,label:`${x.name} · ${x.branch?.name||''}`}));
    if(key==='supplierId') return suppliers.map(x=>({value:x.id,label:x.name}));
    if(key==='customerId') return customers.map(x=>({value:x.id,label:`${x.name}${x.document?` · ${x.document}`:''}`}));
    if(key==='registerId') return (data.registers||[]).map((x:any)=>({value:x.id,label:`${x.name} · ${x.branch?.name||''}`}));
    if(key==='sessionId') return sessions.filter(s=>s.status==='OPEN').map((x:any)=>({value:x.id,label:`${x.register?.name} · ${x.user?.name||''} · ${shortDate(x.openedAt)}`}));
    if(key==='saleId') return sales.filter(s=>s.status!=='VOIDED').map(s=>({value:s.id,label:`Venta #${s.number} · ${money(s.total)} · ${shortDate(s.createdAt)}`}));
    if(key==='saleItemId') { const sale=sales.find((s:any)=>s.id===form.saleId); return (sale?.items||[]).map((i:any)=>({value:i.id,label:`${i.description} · vendido ${i.quantity}, devuelto ${i.returnedQty||0}`})); }
    if(key==='role') return Object.entries(roleNames).map(([value,label])=>({value,label}));
    const enums:Record<string,{value:string;label:string}[]> = {
      kind:[{value:'STOCK',label:'Producto inventariable'},{value:'SERVICE',label:'Servicio'}],direction:[{value:'IN',label:'Entrada'},{value:'OUT',label:'Salida'}],
      paymentMethod:[{value:'CASH',label:'Efectivo'},{value:'CARD',label:'Tarjeta'},{value:'TRANSFER',label:'Transferencia'},{value:'QR',label:'QR'},{value:'OTHER',label:'Otro'}],
      method:[{value:'CASH',label:'Efectivo'},{value:'CARD',label:'Tarjeta'},{value:'TRANSFER',label:'Transferencia'},{value:'QR',label:'QR'},{value:'OTHER',label:'Otro'}],
      refundMethod:[{value:'CASH',label:'Efectivo'},{value:'TRANSFER',label:'Transferencia'},{value:'CARD',label:'Tarjeta'},{value:'OTHER',label:'Otro'}],
      type:[{value:'IN',label:'Ingreso'},{value:'OUT',label:'Retiro'}],methodSale:[{value:'CASH',label:'Efectivo'}],
    };
    return enums[key]||[];
  }

  const formFields = (page:string, mode:string, row?:AnyRow):FieldSpec[] => {
    if(mode==='closeCash') return [{key:'closingCash',label:'Efectivo contado al cierre',type:'number',required:true,step:'0.01'},{key:'notes',label:'Observaciones',type:'text'}];
    if(mode==='cashMovement') return [{key:'sessionId',label:'Turno abierto',type:'select',options:options('sessionId'),required:true},{key:'type',label:'Movimiento',type:'select',options:options('type'),required:true,defaultValue:'IN'},{key:'amount',label:'Importe',type:'number',required:true,step:'0.01'},{key:'description',label:'Descripción',required:true}];
    if(mode==='receivablePayment'||mode==='payablePayment') return [{key:'amount',label:'Importe',type:'number',required:true,step:'0.01'},{key:'method',label:'Método',type:'select',required:true,options:options('method')},{key:'reference',label:'Referencia'}];
    const defs:Record<string,FieldSpec[]> = {
      'Productos':[{key:'name',label:'Nombre',required:true},{key:'sku',label:'SKU',required:true},{key:'barcode',label:'Código de barras'},{key:'brand',label:'Marca'},{key:'unit',label:'Unidad',defaultValue:'unidad'},{key:'kind',label:'Tipo',type:'select',options:options('kind'),defaultValue:'STOCK'},{key:'categoryId',label:'Categoría',type:'select',options:options('categoryId')},{key:'cost',label:'Costo',type:'number',required:true,step:'0.01',defaultValue:0},{key:'price',label:'Precio de venta',type:'number',required:true,step:'0.01'},{key:'promoPrice',label:'Precio promocional',type:'number',step:'0.01'},{key:'taxRate',label:'Impuesto (%)',type:'number',step:'0.01',defaultValue:0},{key:'stockMin',label:'Stock mínimo',type:'number',step:'0.001',defaultValue:0}],
      'Categorías':[{key:'name',label:'Nombre de categoría',required:true}],
      'Clientes':[{key:'name',label:'Nombre completo',required:true},{key:'document',label:'Documento'},{key:'phone',label:'Teléfono'},{key:'email',label:'Correo',type:'email'},{key:'address',label:'Dirección'},{key:'notes',label:'Notas'}],
      'Proveedores':[{key:'name',label:'Razón social / nombre',required:true},{key:'taxId',label:'NIT / identificación'},{key:'phone',label:'Teléfono'},{key:'email',label:'Correo',type:'email'},{key:'address',label:'Dirección'}],
      'Usuarios':[{key:'name',label:'Nombre',required:true},{key:'email',label:'Correo',type:'email',required:true},{key:'password',label:mode==='edit'?'Nueva contraseña (vacía = no cambiar)':'Contraseña temporal',type:'password',...(mode==='edit'?{required:false}:{required:true})},{key:'role',label:'Rol',type:'select',required:true,options:options('role'),defaultValue:'CASHIER'}],
      'Sucursales':[{key:'name',label:'Nombre de sucursal',required:true},{key:'code',label:'Código'},{key:'address',label:'Dirección'},{key:'phone',label:'Teléfono'}],
      'Configuración':[{key:'name',label:'Nombre de la empresa',required:true},{key:'taxId',label:'NIT'},{key:'email',label:'Correo',type:'email'},{key:'phone',label:'Teléfono'},{key:'address',label:'Dirección'},{key:'currency',label:'Moneda (ISO)',defaultValue:'COP'},{key:'timezone',label:'Zona horaria',defaultValue:'America/Bogota'},{key:'logoUrl',label:'URL del logotipo'}],
      'Inventario':[{key:'productId',label:'Producto',type:'select',options:options('productId'),required:true},{key:'warehouseId',label:'Bodega',type:'select',options:options('warehouseId'),required:true},{key:'direction',label:'Movimiento',type:'select',options:options('direction'),required:true,defaultValue:'IN'},{key:'quantity',label:'Cantidad',type:'number',step:'0.001',required:true},{key:'reference',label:'Referencia'},{key:'note',label:'Motivo',required:true}],
      'Compras':[{key:'supplierId',label:'Proveedor',type:'select',options:options('supplierId'),required:true},{key:'number',label:'Número de compra',required:true,defaultValue:`OC-${Date.now().toString().slice(-7)}`},{key:'warehouseId',label:'Bodega de recepción',type:'select',options:options('warehouseId'),required:true},{key:'productId',label:'Producto',type:'select',options:options('productId'),required:true},{key:'quantity',label:'Cantidad',type:'number',step:'0.001',required:true},{key:'unitCost',label:'Costo unitario',type:'number',step:'0.01',required:true}],
      'Caja':[{key:'registerId',label:'Caja',type:'select',options:options('registerId'),required:true},{key:'openingCash',label:'Fondo inicial',type:'number',step:'0.01',required:true,defaultValue:0},{key:'notes',label:'Observaciones'}],
      'Gastos':[{key:'category',label:'Categoría',required:true},{key:'description',label:'Descripción',required:true},{key:'amount',label:'Valor',type:'number',step:'0.01',required:true},{key:'paymentMethod',label:'Método de pago',type:'select',options:options('paymentMethod'),defaultValue:'CASH',required:true},{key:'sessionId',label:'Descontar de turno abierto',type:'select',options:options('sessionId')}],
      'Devoluciones':[{key:'saleId',label:'Venta original',type:'select',options:options('saleId'),required:true},{key:'saleItemId',label:'Artículo vendido',type:'select',options:options('saleItemId'),required:true},{key:'quantity',label:'Cantidad a devolver',type:'number',step:'0.001',required:true},{key:'refundMethod',label:'Método de reembolso',type:'select',options:options('refundMethod'),required:true,defaultValue:'CASH'},{key:'reason',label:'Motivo'},{key:'restock',label:'Devolver al inventario',type:'select',options:[{value:'true',label:'Sí'},{value:'false',label:'No'}],defaultValue:'true'}],
      'Traslados':[{key:'fromWarehouseId',label:'Bodega origen',type:'select',options:options('fromWarehouseId'),required:true},{key:'toWarehouseId',label:'Bodega destino',type:'select',options:options('toWarehouseId'),required:true},{key:'productId',label:'Producto',type:'select',options:options('productId'),required:true},{key:'quantity',label:'Cantidad',type:'number',step:'0.001',required:true},{key:'notes',label:'Observaciones'}],
      'Devoluciones proveedor':[{key:'number',label:'Número de devolución',required:true,defaultValue:`DP-${Date.now().toString().slice(-7)}`},{key:'supplierId',label:'Proveedor',type:'select',options:options('supplierId'),required:true},{key:'warehouseId',label:'Bodega',type:'select',options:options('warehouseId'),required:true},{key:'productId',label:'Producto',type:'select',options:options('productId'),required:true},{key:'quantity',label:'Cantidad',type:'number',step:'0.001',required:true},{key:'reason',label:'Motivo'}],
    };
    return defs[page] || [];
  };

  function openCreate(page:string) {
    const fields=formFields(page,'create');const initial:Record<string,any>={};fields.forEach(f=>{initial[f.key]=f.defaultValue ?? (f.type==='select' ? (f.options?.[0]?.value || '') : '');});
    if(page==='Configuración') Object.assign(initial,data.Configuración||{});
    setForm(initial);setModal({mode:page==='Configuración'?'updateCompany':'create',page});setError('');
  }
  function openAction(mode:string,page:string,row:AnyRow) {
    const fields=formFields(page,mode,row);const initial:Record<string,any>={};fields.forEach(f=>{initial[f.key]=f.defaultValue ?? (f.type==='select' ? (f.options?.[0]?.value || '') : '');});
    if(mode==='closeCash') {initial.closingCash='';initial.notes=row.notes||'';}
    if(mode==='receivablePayment'||mode==='payablePayment') {initial.amount='';initial.method='CASH';initial.reference='';}
    if(page==='Devoluciones' && row?.id) { initial.saleId=row.id; const first=(row.items||[]).find((i:any)=>Number(i.quantity)>Number(i.returnedQty||0)); if(first) initial.saleItemId=first.id; }
    setForm(initial);setModal({mode,page,row});setError('');
  }
  function openEdit(page:string,row:AnyRow) {
    const fields=formFields(page,'edit',row);const initial:Record<string,any>={};
    fields.forEach(f=>{let v=(row as any)?.[f.key];if(v===undefined&&f.key==='categoryId')v=(row as any)?.category?.id;initial[f.key]=v ?? f.defaultValue ?? (f.type==='select' ? (f.options?.[0]?.value || '') : '');});
    if(page==='Usuarios') initial.password='';
    setForm(initial);setModal({mode:'edit',page,row});setError('');
  }
  const isNumeric = (key:string) => ['price','cost','taxRate','stockMin','promoPrice','quantity','unitCost','amount','openingCash','closingCash','discount'].includes(key);
  async function saveForm(e:React.FormEvent) {
    e.preventDefault(); if(!modal) return; setBusy(true);setError('');setNotice('');
    const {page,mode,row}=modal;
    try {
      let result:any;
      if(mode==='closeCash') result=await request(`/cash/sessions/${row?.id}/close`,{method:'POST',body:JSON.stringify({closingCash:Number(form.closingCash),notes:form.notes})});
      else if(mode==='cashMovement') result=await request('/cash/movements',{method:'POST',body:JSON.stringify({...form,amount:Number(form.amount)})});
      else if(mode==='receivablePayment') result=await request(`/receivables/${row?.id}/payments`,{method:'POST',body:JSON.stringify({...form,amount:Number(form.amount)})});
      else if(mode==='payablePayment') result=await request(`/payables/${row?.id}/payments`,{method:'POST',body:JSON.stringify({...form,amount:Number(form.amount)})});
      else if(mode==='updateCompany') result=await request('/company',{method:'PATCH',body:JSON.stringify(form)});
      else if(page==='Compras') result=await request('/purchases',{method:'POST',body:JSON.stringify({supplierId:form.supplierId,number:form.number,warehouseId:form.warehouseId,items:[{productId:form.productId,quantity:Number(form.quantity),unitCost:Number(form.unitCost)}]})});
      else if(page==='Inventario') result=await request('/inventory/adjustments',{method:'POST',body:JSON.stringify({...form,quantity:Number(form.quantity)})});
      else if(page==='Caja') result=await request('/cash/open',{method:'POST',body:JSON.stringify({...form,openingCash:Number(form.openingCash)})});
      else if(page==='Gastos') result=await request('/expenses',{method:'POST',body:JSON.stringify({...form,amount:Number(form.amount)})});
      else if(page==='Devoluciones') result=await request('/returns',{method:'POST',body:JSON.stringify({saleId:form.saleId,items:[{saleItemId:form.saleItemId,quantity:Number(form.quantity)}],refundMethod:form.refundMethod,reason:form.reason,restock:form.restock!=='false'})});
      else if(page==='Traslados') result=await request('/inventory/transfers',{method:'POST',body:JSON.stringify({fromWarehouseId:form.fromWarehouseId,toWarehouseId:form.toWarehouseId,items:[{productId:form.productId,quantity:Number(form.quantity)}],notes:form.notes})});
      else if(page==='Devoluciones proveedor') result=await request('/supplier-returns',{method:'POST',body:JSON.stringify({...form,items:[{productId:form.productId,quantity:Number(form.quantity)}]})});
      else if(mode==='edit'&&row?.id) {
        const payload={...form}; Object.keys(payload).forEach(k=>{if(payload[k]==='') delete payload[k];});
        if(page==='Usuarios'&&!payload.password) delete payload.password;
        result=await request(`${endpoints[page]}/${row.id}`,{method:'PATCH',body:JSON.stringify(payload)});
      }
      else {
        const payload={...form}; Object.keys(payload).forEach(k=>{if(payload[k]==='') delete payload[k];});
        result=await request(`${endpoints[page]||''}`,{method:'POST',body:JSON.stringify(payload)});
      }
      setModal(null);setNotice(mode==='edit'?'Cambios guardados correctamente.':mode==='closeCash'?'Caja cerrada correctamente.':mode==='receivablePayment'?'Abono registrado.':mode==='payablePayment'?'Pago a proveedor registrado.':mode==='updateCompany'?'Configuración actualizada.': 'Operación registrada correctamente.');
      if(page==='Productos'||page==='Inventario'||page==='Compras'||page==='Devoluciones'||page==='Devoluciones proveedor'||page==='Traslados'||page==='Caja'||page==='Gastos'||page==='Cuentas por cobrar'||page==='Cuentas por pagar'||page==='Configuración'||page==='Sucursales') await loadCore();
      await loadPage(page); await loadPage('Dashboard');
    } catch(e:any) {setError(e.message||'No se pudo guardar la información.');}
    finally {setBusy(false);}
  }
  async function action(path:string,verb='POST',body:any={}) {
    setBusy(true);setError('');setNotice('');
    try {await request(path,{method:verb,body:JSON.stringify(body)});setNotice('Operación completada correctamente.');await loadCore();await loadPage(section);}
    catch(e:any) {setError(e.message||'No se pudo completar la operación.');}
    finally {setBusy(false);}
  }
  async function receivePurchase(row:AnyRow) {
    if(!window.confirm(`¿Registrar la recepción de las cantidades pendientes de la compra ${row.number}?`)) return;
    await action(`/purchases/${row.id}/receive`,'POST',{});
  }
  async function cancelPurchase(row:AnyRow) {
    if(!window.confirm(`¿Cancelar la compra ${row.number}? Solo se puede si no se ha recibido mercancía.`)) return;
    await action(`/purchases/${row.id}/cancel`);
  }

  const columns:Record<string,{key:string;label:string;money?:boolean;date?:boolean}[]> = {
    'Productos':[{key:'imageUrl',label:'Imagen'},{key:'name',label:'Producto'},{key:'sku',label:'SKU'},{key:'barcode',label:'Código de barras'},{key:'cost',label:'Costo',money:true},{key:'price',label:'Precio',money:true},{key:'taxRate',label:'Impuesto %'},{key:'active',label:'Activo'}],
    'Categorías':[{key:'name',label:'Categoría'},{key:'active',label:'Activa'}],
    'Clientes':[{key:'name',label:'Cliente'},{key:'document',label:'Documento'},{key:'phone',label:'Teléfono'},{key:'email',label:'Correo'}],
    'Proveedores':[{key:'name',label:'Proveedor'},{key:'taxId',label:'NIT'},{key:'phone',label:'Teléfono'},{key:'email',label:'Correo'}],
    'Usuarios':[{key:'name',label:'Usuario'},{key:'email',label:'Correo'},{key:'role',label:'Rol'},{key:'active',label:'Activo'},{key:'lastLoginAt',label:'Último acceso',date:true}],
    'Sucursales':[{key:'name',label:'Sucursal'},{key:'code',label:'Código'},{key:'address',label:'Dirección'},{key:'phone',label:'Teléfono'}],
    'Inventario':[{key:'product.name',label:'Producto'},{key:'product.sku',label:'SKU'},{key:'warehouse.branch.name',label:'Sucursal'},{key:'warehouse.name',label:'Bodega'},{key:'quantity',label:'Existencia'},{key:'product.stockMin',label:'Stock mínimo'}],
    'Movimientos':[{key:'createdAt',label:'Fecha',date:true},{key:'product.name',label:'Producto'},{key:'type',label:'Tipo'},{key:'quantity',label:'Cantidad'},{key:'warehouse.name',label:'Bodega'},{key:'reference',label:'Referencia'},{key:'note',label:'Nota'}],
    'Ventas':[{key:'number',label:'Número'},{key:'createdAt',label:'Fecha',date:true},{key:'customer.name',label:'Cliente'},{key:'user.name',label:'Cajero'},{key:'branch.name',label:'Sucursal'},{key:'status',label:'Estado'},{key:'total',label:'Total',money:true}],
    'Compras':[{key:'number',label:'Compra'},{key:'createdAt',label:'Fecha',date:true},{key:'supplier.name',label:'Proveedor'},{key:'warehouse.name',label:'Bodega'},{key:'status',label:'Estado'},{key:'total',label:'Total',money:true}],
    'Caja':[{key:'register.name',label:'Caja'},{key:'register.branch.name',label:'Sucursal'},{key:'user.name',label:'Cajero'},{key:'openedAt',label:'Apertura',date:true},{key:'status',label:'Estado'},{key:'openingCash',label:'Fondo inicial',money:true},{key:'expectedCash',label:'Efectivo esperado',money:true},{key:'difference',label:'Diferencia',money:true}],
    'Devoluciones':[{key:'number',label:'Devolución'},{key:'sale.number',label:'Venta'},{key:'createdAt',label:'Fecha',date:true},{key:'total',label:'Total',money:true},{key:'refundMethod',label:'Reembolso'},{key:'reason',label:'Motivo'}],
    'Devoluciones proveedor':[{key:'number',label:'Documento'},{key:'supplier.name',label:'Proveedor'},{key:'createdAt',label:'Fecha',date:true},{key:'total',label:'Total',money:true},{key:'status',label:'Estado'},{key:'reason',label:'Motivo'}],
    'Gastos':[{key:'createdAt',label:'Fecha',date:true},{key:'category',label:'Categoría'},{key:'description',label:'Descripción'},{key:'paymentMethod',label:'Método'},{key:'user.name',label:'Registró'},{key:'amount',label:'Valor',money:true}],
    'Cuentas por cobrar':[{key:'sale.number',label:'Venta'},{key:'sale.customer.name',label:'Cliente'},{key:'amount',label:'Valor',money:true},{key:'paidAmount',label:'Pagado',money:true},{key:'status',label:'Estado'},{key:'dueDate',label:'Vencimiento',date:true}],
    'Cuentas por pagar':[{key:'purchase.number',label:'Compra'},{key:'purchase.supplier.name',label:'Proveedor'},{key:'amount',label:'Valor',money:true},{key:'paidAmount',label:'Pagado',money:true},{key:'status',label:'Estado'}],
    'Traslados':[{key:'id',label:'Identificador'},{key:'fromWarehouseId',label:'Bodega origen'},{key:'toWarehouseId',label:'Bodega destino'},{key:'status',label:'Estado'},{key:'createdAt',label:'Fecha',date:true}],
    'Auditoría':[{key:'createdAt',label:'Fecha',date:true},{key:'user.name',label:'Usuario'},{key:'action',label:'Acción'},{key:'entity',label:'Módulo'},{key:'entityId',label:'Registro'}],
  };
  const nested = (obj:any,path:string) => path.split('.').reduce((v,k)=>v?.[k],obj);

  if(!token || !user) return <div className="login-wrap"><div className="login-card"><div className="brand-mark">P</div><p className="eyebrow">SISTEMA DE GESTIÓN COMERCIAL</p><h1>POS Colombia</h1><p className="muted">Ventas, inventario, caja y administración en un solo lugar.</p>{setupNeeded
    ? <form onSubmit={setup} className="stack"><p className="small"><b>Configuración inicial:</b> crea la empresa y tu cuenta de administrador. Este formulario solo aparece cuando no existe ningún usuario.</p><label>Tu nombre<input value={setupName} onChange={e=>setSetupName(e.target.value)} required autoComplete="name"/></label><label>Nombre del negocio<input value={setupCompany} onChange={e=>setSetupCompany(e.target.value)} placeholder="Mi negocio"/></label><label>Correo electrónico<input value={email} onChange={e=>setEmail(e.target.value)} type="email" required autoComplete="username"/></label><label>Contraseña (mínimo 10 caracteres)<input value={password} onChange={e=>setPassword(e.target.value)} type="password" required minLength={10} autoComplete="new-password"/></label>{error&&<div className="error">{error}</div>}<button className="primary full" disabled={busy}>{busy?'Creando…':'Crear empresa y cuenta'}</button></form>
    : <form onSubmit={login} className="stack"><label>Correo electrónico<input value={email} onChange={e=>setEmail(e.target.value)} type="email" required autoComplete="username"/></label><label>Contraseña<input value={password} onChange={e=>setPassword(e.target.value)} type="password" required autoComplete="current-password"/></label>{error&&<div className="error">{error}</div>}<button className="primary full" disabled={busy}>{busy?'Ingresando…':'Iniciar sesión'}</button></form>}<p className="small muted">{(import.meta as any).env.DEV ? 'Demo local: admin@demo-pos.local · Cambiar123!' : 'Acceso restringido a personal autorizado.'}</p></div></div>;

  const pageRows = Array.isArray(data[section]) ? displayedRows : [];
  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu?'open':''}`}><div className="logo-row"><div className="brand-mark smallmark">P</div><div><b>POS Colombia</b><small>Gestión comercial</small></div><button className="icon-btn mobile-only" onClick={()=>setMobileMenu(false)}><X size={18}/></button></div>
      <div className="company-pill"><span className="green-dot"></span>{data['Configuración']?.name||'Mi negocio'}<span className="side-cop">COP</span></div>
      <div className="sidebar-scroll">{Array.from(new Set(sections.map(s=>s.group))).map(group=><div key={group}><p className="nav-label">{group}</p>{sections.filter(s=>s.group===group).map(s=>{const Icon=s.icon;return <button key={s.name} className={`nav-item ${section===s.name?'active':''}`} onClick={()=>{setSection(s.name);setMobileMenu(false);setSearch('');setError('');setNotice('')}}><Icon size={17}/><span>{s.label}</span></button>;})}</div>)}</div>
      <div className="sidebar-bottom"><div className="user-mini"><div className="avatar">{user.name.slice(0,1)}</div><div className="mini-user-text"><b>{user.name}</b><small>{roleNames[user.role]||user.role}</small></div></div><button className="nav-item" onClick={logout}><LogOut size={18}/>Cerrar sesión</button></div>
    </aside>
    {mobileMenu&&<button className="mobile-nav-scrim" aria-label="Cerrar menú" onClick={()=>setMobileMenu(false)} />}
    <main className="main-area"><header className="topbar"><button className="icon-btn mobile-only" onClick={()=>setMobileMenu(true)}><Menu/></button><div className="breadcrumb"><span className="muted small">POS Colombia /</span><b> {section}</b></div><div className="top-actions"><span className="status"><span className="green-dot"></span> API conectada si responde</span><button className="icon-btn" onClick={refresh} title="Actualizar datos"><RefreshCw size={17}/></button><div className="avatar">{user.name.slice(0,1)}</div></div></header>
      <div className="content">
        {error&&<div className="error banner">{error}<button onClick={()=>setError('')} aria-label="Cerrar error">×</button></div>}
        {notice&&<div className="success-banner"><CheckCircle2 size={17}/><span>{notice}</span><button onClick={()=>setNotice('')}>Cerrar</button></div>}
        {section==='Dashboard'&&<DashboardView data={data.dashboard||{}} sales={sales} inventory={inventory} onNav={setSection} money={money} />}
        {section==='Punto de venta'&&<div><div className="page-heading"><div><p className="eyebrow">CAJA RÁPIDA</p><h1>Punto de venta</h1><p className="muted">Busca productos, agrega al carrito y registra un cobro.</p></div><div className="heading-actions"><span className={`status-pill ${openSession?'good':'warn'}`}>{openSession?'Caja abierta':'Caja cerrada'}</span><button className="secondary" onClick={()=>setSection('Caja')}><Wallet size={16}/> Gestionar caja</button></div></div>
          <div className="pos-context panel"><label>Sucursal<select value={currentBranch?.id||''} onChange={e=>{setBranchId(e.target.value);setWarehouseId('')}}><option value="">Seleccionar sucursal</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Bodega<select value={currentWarehouse?.id||''} onChange={e=>setWarehouseId(e.target.value)}><option value="">Seleccionar bodega</option>{validWarehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>Cliente<select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">Consumidor final</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Turno de caja<select value={openSession?.id||''} onChange={()=>{}} disabled><option value="">{openSession?`${openSession.register?.name} · ${openSession.user?.name||user.name}`:'No hay turno abierto'}</option></select></label></div>
          <div className="pos-layout"><section className="panel"><div className="searchbox"><Search size={18}/><input value={cartSearch} onChange={e=>setCartSearch(e.target.value)} placeholder="Buscar por nombre, SKU o código de barras…"/><span className="small muted">{filteredProducts.length} productos</span></div><div className="product-grid">{filteredProducts.map(p=><button className="product-card" key={p.id} onClick={()=>addToCart(p)}>{imgSrc(p)?<img src={imgSrc(p)} alt={p.name} className="product-img"/>:<div className="product-illustration"><Package size={27}/></div>}<b>{p.name}</b><small>{p.sku}</small><strong>{money(p.promoPrice && Number(p.promoPrice)>0 && Number(p.promoPrice)<Number(p.price)?p.promoPrice:p.price)}</strong><span className="add-chip"><Plus size={14}/> Agregar</span></button>)}</div>{!filteredProducts.length&&<Empty text="No hay productos para mostrar."/>}</section>
            <section className="panel cart-panel"><div className="panel-head"><div><h3>Venta actual</h3><p className="muted small">{cart.reduce((s,l)=>s+l.quantity,0)} unidad(es)</p></div><button className="text-btn" onClick={()=>setCart([])}>Vaciar</button></div>{cart.map(l=><div className="cart-line" key={l.product.id}><div className="grow"><b>{l.product.name}</b><small>{money(l.product.promoPrice&&Number(l.product.promoPrice)>0&&Number(l.product.promoPrice)<Number(l.product.price)?l.product.promoPrice:l.product.price)} c/u</small><div className="qty"><button onClick={()=>setCart(c=>c.map(x=>x.product.id===l.product.id?{...x,quantity:Math.max(.001,Math.round((x.quantity-1)*1000)/1000)}:x))}>−</button><span>{l.quantity}</span><button onClick={()=>setCart(c=>c.map(x=>x.product.id===l.product.id?{...x,quantity:x.quantity+1}:x))}>+</button></div></div><strong>{money(Number(l.product.promoPrice && Number(l.product.promoPrice)>0 && Number(l.product.promoPrice)<Number(l.product.price)?l.product.promoPrice:l.product.price)*l.quantity*(1+Number(l.product.taxRate||0)/100))}</strong><button className="remove" onClick={()=>setCart(c=>c.filter(x=>x.product.id!==l.product.id))}>×</button></div>)}{!cart.length&&<Empty text="Agrega productos para comenzar una venta."/>}
              <div className="cart-total"><span>Total estimado con impuestos</span><strong>{money(cartTotal)}</strong></div><div className="payment-heading"><b>Medios de pago</b><button className="text-btn" onClick={()=>setPaymentLines(v=>[...v,{method:'TRANSFER',amount:''}])} disabled={paymentLines.length>=4}><Plus size={13}/> Añadir medio</button></div>{paymentLines.map((p,i)=><div className="payment-line" key={i}><select value={p.method} onChange={e=>setPaymentLines(old=>old.map((r,j)=>i===j?{...r,method:e.target.value}:r))}><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option><option value="QR">QR</option><option value="CREDIT">Crédito</option><option value="OTHER">Otro</option></select>{paymentLines.length>1?<input type="number" min="0.01" step="0.01" placeholder="Importe" value={p.amount} onChange={e=>setPaymentLines(old=>old.map((r,j)=>i===j?{...r,amount:e.target.value}:r))}/>:<div className="fixed-amount">{money(cartTotal)}</div>}{paymentLines.length>1&&<button className="remove" onClick={()=>setPaymentLines(old=>old.filter((_,j)=>j!==i))}>×</button>}</div>)}<button className="primary full checkout-btn" disabled={!cart.length||busy} onClick={checkout}>{busy?'Procesando…':'Confirmar venta · '+money(cartTotal)}</button><p className="small muted">El servidor vuelve a validar precios, pagos y existencias.</p></section></div></div>}
        {section==='Asistente'&&<div><div className="page-heading"><div><p className="eyebrow">AYUDA OPERATIVA</p><h1>Asistente IA</h1><p className="muted">Crea productos, fija precios y promociones, ajusta inventario y consulta ventas o stock con lenguaje normal.</p></div><div className="heading-actions"><select value={asModel} onChange={e=>setAsModel(e.target.value)} title="Modelo gratuito"><option value="">Modelo: auto</option>{asModels.map(m=><option key={m} value={m}>{m}</option>)}</select><label className="check-label" title="Con este interruptor apagado solo propongo acciones sin ejecutarlas"><input type="checkbox" checked={asExecute} onChange={e=>setAsExecute(e.target.checked)}/> Ejecutar acciones</label></div></div>
          <section className="panel assistant-panel"><div className="chat-log">{asMessages.map((m,i)=><div key={i} className={`chat-msg ${m.from}`}><div className="chat-avatar">{m.from==='ai'?<Bot size={16}/>:user.name.slice(0,1)}</div><div className="chat-bubble"><p>{m.text}</p>{(m.actions||[]).map((a:any,j:number)=><span key={j} className={`pill ${a.ok?'green':''}`}>{a.tool}: {a.ok?'ok':'falló'}</span>)}</div></div>)}{asBusy&&<div className="chat-msg ai"><div className="chat-avatar"><Bot size={16}/></div><div className="chat-bubble"><p>Procesando…</p></div></div>}</div>
          <form className="chat-input" onSubmit={sendAssistant}><input value={asInput} onChange={e=>setAsInput(e.target.value)} placeholder='Ej: crea el producto "Cable USB-C 2m" a $25000 con costo $14000' maxLength={1000}/><button className="primary" disabled={asBusy||!asInput.trim()}>{asBusy?'…':'Enviar'}</button></form>
          <p className="field-help">Sin “Ejecutar acciones” solo propongo el plan. Con el interruptor activado ejecuto con tu usuario y rol; todo queda auditado. Nunca vendo, cobro ni toco usuarios o facturación.</p></section></div>}
        {section!=='Dashboard'&&section!=='Punto de venta'&&section!=='Asistente'&&<ModuleView page={section} data={data[section]} rows={pageRows} search={search} setSearch={setSearch} openCreate={openCreate} openAction={openAction} openEdit={openEdit} columns={columns} nested={nested} money={money} shortDate={shortDate} busy={busy} receivePurchase={receivePurchase} cancelPurchase={cancelPurchase} dataAll={data} request={request} uploadFile={uploadFile} downloadFile={downloadFile} loadPage={loadPage} onSettings={()=>openCreate('Configuración')}/>}
        <footer className="footer"><span>POS Colombia · Moneda COP · Zona horaria America/Bogota</span><span>{busy?'Procesando operación…':'Datos sincronizados bajo demanda'} · Versión de desarrollo</span></footer>
      </div>
    </main>
    {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><div className="modal-card"><div className="modal-head"><div><p className="eyebrow">{modal.mode==='updateCompany'?'PREFERENCIAS DEL NEGOCIO':'GESTIÓN DEL SISTEMA'}</p><h2>{modal.mode==='closeCash'?'Cerrar turno de caja':modal.mode==='cashMovement'?'Registrar movimiento de caja':modal.mode==='receivablePayment'?'Registrar abono':modal.mode==='payablePayment'?'Registrar pago al proveedor':modal.mode==='updateCompany'?'Configuración de empresa':modal.mode==='edit'?`Editar · ${modal.page}`:`Nuevo registro · ${modal.page}`}</h2></div><button className="icon-btn" onClick={()=>setModal(null)}><X size={18}/></button></div><form onSubmit={saveForm} className="modal-form"><div className="form-grid">{formFields(modal.page,modal.mode,modal.row).map(field=><label key={field.key} className={field.type==='textarea'?'span-2':''}>{field.label}{field.type==='select'?<select value={form[field.key]??''} required={field.required} onChange={e=>setForm(f=>({...f,[field.key]:e.target.value,...(field.key==='saleId'?{saleItemId:''}:{})}))}><option value="">Seleccionar…</option>{(field.options||[]).map(o=><option value={o.value} key={o.value}>{o.label}</option>)}</select>:field.type==='textarea'?<textarea value={form[field.key]??''} required={field.required} onChange={e=>setForm(f=>({...f,[field.key]:e.target.value}))}/>:<input value={form[field.key]??''} required={field.required} type={field.type||'text'} step={field.step} placeholder={field.placeholder} onChange={e=>setForm(f=>({...f,[field.key]:e.target.value}))}/>}</label>)}</div>{modal.page==='Compras'&&<p className="field-help">Esta entrada crea una orden con una referencia. Después debes usar “Recibir” para que la mercancía entre en inventario.</p>}{modal.page==='Devoluciones'&&<p className="field-help">La devolución solo acepta cantidades aún no devueltas en la venta elegida.</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={()=>setModal(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Guardando…':'Guardar'}</button></div></form></div></div>}
  </div>;
}

function DashboardView({data,sales,inventory,onNav,money}:any) {
  const stats=[
    {label:'Ventas netas del periodo',value:money(data.salesToday),note:`${data.transactionsToday||0} transacciones`,icon:<CircleDollarSign/>,tone:'purple'},
    {label:'Productos activos',value:data.products??0,note:'En catálogo',icon:<Package/>,tone:'blue'},
    {label:'Clientes',value:data.customers??0,note:'Registrados',icon:<Users/>,tone:'orange'},
    {label:'Utilidad bruta estimada',value:money(data.grossProfit),note:'Ventas netas menos costo de venta',icon:<TrendingUp/>,tone:'green'},
  ];
  const max=Math.max(1,...(data.dailySales||[]).map((x:any)=>Number(x.total)));
  return <><div className="page-heading"><div><p className="eyebrow">RESUMEN DEL NEGOCIO</p><h1>¡Hola! Bienvenido al POS 👋</h1><p className="muted">Indicadores calculados desde los registros disponibles.</p></div><div className="heading-actions"><button className="primary" onClick={()=>onNav('Punto de venta')}><ShoppingCart size={16}/> Nueva venta</button></div></div>
    <div className="stat-grid">{stats.map((s:any)=><div className="stat-card" key={s.label}><div className={`stat-icon ${s.tone}`}>{s.icon}</div><div className="stat-label">{s.label}</div><div className="stat-value">{s.value}</div><div className="stat-note">{s.note}</div></div>)}</div>
    <div className="stat-grid stat-grid-secondary"><div className="mini-stat"><span>Ventas brutas</span><b>{money(data.grossSales)}</b></div><div className="mini-stat"><span>Devoluciones</span><b>{money(data.returns)}</b></div><div className="mini-stat"><span>Gastos registrados</span><b>{money(data.expenses)}</b></div><div className="mini-stat"><span>Valor costo inventario</span><b>{money(data.inventoryValue)}</b></div></div>
    <div className="two-col"><section className="panel"><div className="panel-head"><div><h3>Ventas por día</h3><p className="muted small">Dentro del rango consultado</p></div><button className="text-btn" onClick={()=>onNav('Reportes')}>Ver reportes →</button></div>{(data.dailySales||[]).length?<div className="bar-chart">{(data.dailySales||[]).slice(-14).map((x:any)=><div className="bar-column" key={x.date} title={`${x.date}: ${money(x.total)}`}><div className="bar" style={{height:`${Math.max(5,(Number(x.total)/max)*100)}%`}}></div><span>{String(x.date).slice(5)}</span></div>)}</div>:<Empty text="Las ventas aparecerán aquí cuando existan operaciones."/>}</section><section className="panel"><div className="panel-head"><div><h3>Productos con stock bajo</h3><p className="muted small">Requieren revisión</p></div><AlertTriangle color="#d97706" size={20}/></div>{(data.lowStock||[]).slice(0,7).map((x:any)=><div className="low-row" key={x.id}><div className="product-dot">{x.product.name.slice(0,1)}</div><div className="grow"><b>{x.product.name}</b><small>{x.warehouse?.name||''}</small></div><span className="stock-low">{Number(x.quantity)} uds.</span></div>)}{!(data.lowStock||[]).length&&<Empty text="No se detectan alertas de stock con los datos actuales."/>}<button className="secondary full" onClick={()=>onNav('Inventario')}>Abrir inventario</button></section></div>
    <section className="panel"><div className="panel-head"><div><h3>Ventas recientes</h3><p className="muted small">Últimas transacciones registradas</p></div><button className="text-btn" onClick={()=>onNav('Ventas')}>Ver historial →</button></div><div className="table-wrap"><table><thead><tr><th>Venta</th><th>Fecha</th><th>Cliente</th><th>Sucursal</th><th>Estado</th><th>Total</th></tr></thead><tbody>{sales.slice(0,7).map((s:any)=><tr key={s.id}><td><b>#{s.number}</b></td><td>{new Date(s.createdAt).toLocaleString('es-CO')}</td><td>{s.customer?.name||'Consumidor final'}</td><td>{s.branch?.name||'—'}</td><td><span className={`pill ${s.status==='COMPLETED'?'green':''}`}>{s.status}</span></td><td><b>{money(s.total)}</b></td></tr>)}</tbody></table>{!sales.length&&<Empty text="Todavía no se han registrado ventas."/>}</div></section>
  </>;
}

function ModuleView({page,data,rows,search,setSearch,openCreate,openAction,openEdit,columns,nested,money,shortDate,busy,receivePurchase,cancelPurchase,dataAll,request,uploadFile,downloadFile,loadPage,onSettings}:any) {
  const [localBusy,setLocalBusy]=useState(false);
  const [localMessage,setLocalMessage]=useState('');
  const importRef = React.useRef<HTMLInputElement>(null);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const inventoryImportRef = React.useRef<HTMLInputElement>(null);
  const [uploadRow,setUploadRow]=useState<any>(null);
  const [inventoryPreview,setInventoryPreview]=useState<any>(null);
  const [inventoryFile,setInventoryFile]=useState<File|null>(null);
  const [inventoryMapping,setInventoryMapping]=useState<any>(null);
  const [inventoryCreateMissing,setInventoryCreateMissing]=useState(true);
  const [inventoryAiStatus,setInventoryAiStatus]=useState<any>(null);
  const [inventoryAiResult,setInventoryAiResult]=useState<any>(null);
  const [inventoryAiError,setInventoryAiError]=useState('');
  const [inventoryAiTask,setInventoryAiTask]=useState('insights');
  const [inventoryAiModel,setInventoryAiModel]=useState('');
  const [inventoryAiModels,setInventoryAiModels]=useState<string[]>([]);
  const [inventoryAiCover,setInventoryAiCover]=useState('30');
  const [inventoryAiProduct,setInventoryAiProduct]=useState('');
  useEffect(()=>{
    if(page==='Inventario') { request('/inventory/ai/status').then((s:any)=>{setInventoryAiStatus(s); if(s?.model) setInventoryAiModel(cur=>cur||'');}).catch(()=>setInventoryAiStatus({configured:false})); request('/inventory/ai/models').then((m:any)=>{ if(Array.isArray(m?.models)) setInventoryAiModels(m.models); }).catch(()=>{}); }
  },[page,request]);
  async function importCsv(file:File) {
    setLocalBusy(true);setLocalMessage('');
    try {
      const form = new FormData(); form.append('file',file);
      const result = await uploadFile('/products/import',form);
      setLocalMessage(`Importados ${result.created}, omitidos ${result.skipped}.${result.errors?.length?` Errores: ${result.errors.slice(0,3).join(' | ')}`:''}`);
      await loadPage(page); await loadPage('Dashboard');
    } catch(e:any) { setLocalMessage(e.message||'No se pudo importar el archivo.'); }
    finally { setLocalBusy(false); if(importRef.current) importRef.current.value=''; }
  }
  async function uploadImage(file:File) {
    if(!uploadRow) return;
    setLocalBusy(true);setLocalMessage('');
    try {
      const form = new FormData(); form.append('image',file);
      await uploadFile(`/products/${uploadRow.id}/image`,form);
      setLocalMessage('Imagen actualizada.');
      await loadPage(page); await loadPage('Dashboard');
    } catch(e:any) { setLocalMessage(e.message||'No se pudo subir la imagen.'); }
    finally { setLocalBusy(false); setUploadRow(null); if(uploadRef.current) uploadRef.current.value=''; }
  }
  async function previewInventoryFile(file:File, mapping?:any, createMissing?:boolean) {
    setLocalBusy(true);setLocalMessage('');setInventoryPreview(null);
    try {
      const form = new FormData(); form.append('file',file);
      if(mapping) form.append('mapping',JSON.stringify(mapping));
      form.append('createMissing',(createMissing??inventoryCreateMissing)?'true':'false');
      const result = await uploadFile('/inventory/import/preview',form);
      setInventoryPreview(result); setInventoryFile(file);
      if(mapping) setInventoryMapping(mapping);
    } catch(e:any) { setLocalMessage(e.message||'No se pudo leer el archivo de inventario.'); }
    finally { setLocalBusy(false); if(inventoryImportRef.current) inventoryImportRef.current.value=''; }
  }
  async function mapInventoryWithAi() {
    if(!inventoryFile) { setLocalMessage('Elige primero el archivo a mapear.'); return; }
    setLocalBusy(true);setLocalMessage('');
    try {
      const form = new FormData(); form.append('file',inventoryFile);
      if(inventoryAiModel) form.append('model',inventoryAiModel);
      const result = await uploadFile('/inventory/import/map-assist',form);
      setLocalMessage(`IA sugiere columnas: ${Object.entries(result.mapping||{}).filter(([,v])=>v!==null).map(([k,v])=>`${k}→columna ${Number(v)+1}`).join(', ')||'sin coincidencias'}. Revisa la vista previa antes de aplicar.`);
      await previewInventoryFile(inventoryFile, result.mapping||{});
    } catch(e:any) { setLocalMessage(e.message||'No se pudo mapear con IA.'); }
    finally { setLocalBusy(false); }
  }
  async function applyInventoryFile() {
    if(!inventoryPreview) return;
    const validRows = inventoryPreview.rows.filter((row:any)=>row.valid);
    if(!validRows.length) return;
    setLocalBusy(true);setLocalMessage('');
    try {
      const result = await request('/inventory/import/apply',{method:'POST',body:JSON.stringify({rows:validRows,note:`Conteo importado: ${inventoryPreview.filename}`})});
      setLocalMessage(`Conteo aplicado: ${result.changed} saldo(s) ajustado(s), ${result.created||0} producto(s) creado(s), ${result.unchanged} sin cambio. Referencia ${result.importId}.`);
      setInventoryPreview(null); await loadPage(page); await loadPage('Dashboard');
    } catch(e:any) { setLocalMessage(e.message||'No se pudo aplicar el conteo.'); }
    finally { setLocalBusy(false); }
  }
  async function runInventoryAi() {
    setLocalBusy(true);setInventoryAiError('');setInventoryAiResult(null);
    try {
      const body:any={}; if(inventoryAiModel) body.model=inventoryAiModel;
      if(inventoryAiTask==='restock') body.coverDays=Number(inventoryAiCover)||30;
      if(inventoryAiTask==='copy') { if(!inventoryAiProduct) throw new Error('Selecciona un producto para generar su descripción.'); body.productId=inventoryAiProduct; }
      const result=await request(`/inventory/ai/${inventoryAiTask}`,{method:'POST',body:JSON.stringify(body)});
      setInventoryAiResult({kind:inventoryAiTask,...result});
    }
    catch(e:any) { setInventoryAiError(e.message||'El asistente no está disponible.'); }
    finally { setLocalBusy(false); }
  }
  async function applyPromo(productId:string, price:number) {
    if(!window.confirm(`¿Aplicar precio promocional de ${money(price)}? Se puede quitar editando el producto.`)) return;
    setLocalBusy(true);setInventoryAiError('');
    try { await request(`/products/${productId}`,{method:'PATCH',body:JSON.stringify({promoPrice:price})}); setLocalMessage('Precio promocional aplicado.'); await loadPage(page); await loadPage('Dashboard'); }
    catch(e:any) { setInventoryAiError(e.message||'No se pudo aplicar la promoción.'); }
    finally { setLocalBusy(false); }
  }
  const headers=columns[page]||[];
  const tableRows=Array.isArray(rows)?rows:[];
  const isTable=Array.isArray(data) || ['Usuarios','Sucursales','Caja','Cuentas por cobrar','Cuentas por pagar','Auditoría','Movimientos','Traslados','Devoluciones proveedor','Devoluciones','Ventas','Inventario','Compras','Productos','Clientes','Proveedores','Categorías','Gastos'].includes(page);
  const titles:Record<string,{eyebrow:string;title:string;desc:string}>={
    'Ventas':{eyebrow:'TRANSACCIONES',title:'Historial de ventas',desc:'Consulta operaciones, medios de pago, clientes y estados.'},'Caja':{eyebrow:'CONTROL DE EFECTIVO',title:'Caja y turnos',desc:'Aperturas, movimientos, cierres y diferencias por cajero.'},
    'Productos':{eyebrow:'CATÁLOGO',title:'Productos',desc:'Precios, costos, códigos de barras, impuestos y stock mínimo.'},'Inventario':{eyebrow:'EXISTENCIAS',title:'Inventario',desc:'Saldos por bodega y ajustes auditados.'},'Movimientos':{eyebrow:'KARDEX',title:'Movimientos de inventario',desc:'Historial de entradas, salidas, ventas y ajustes.'},
    'Compras':{eyebrow:'ABASTECIMIENTO',title:'Compras',desc:'Órdenes, recepción de mercancía y cuentas por pagar.'},'Reportes':{eyebrow:'ANÁLISIS',title:'Reportes del negocio',desc:'Indicadores basados en ventas, devoluciones, compras, gastos e inventario.'},
    'Configuración':{eyebrow:'EMPRESA',title:'Configuración',desc:'Datos comerciales y regionales de la empresa.'},'Facturación electrónica':{eyebrow:'DOCUMENTOS FISCALES',title:'Facturación electrónica',desc:'Estado de configuración de la integración tributaria.'},
  };
  const title=titles[page]||{eyebrow:'GESTIÓN COMERCIAL',title:page,desc:`Administra y consulta la información de ${page.toLowerCase()}.`};
  const canCreate=['Productos','Categorías','Clientes','Proveedores','Usuarios','Sucursales','Inventario','Compras','Caja','Gastos','Devoluciones','Traslados','Devoluciones proveedor'].includes(page);
  const rowAction=async(path:string,body:any={})=>{setLocalBusy(true);setLocalMessage('');try{await request(path,{method:'POST',body:JSON.stringify(body)});setLocalMessage('Operación completada.');await loadPage(page);await loadPage('Dashboard');}catch(e:any){setLocalMessage(e.message||'La operación falló.');}finally{setLocalBusy(false);}};
  function cellValue(row:any,col:any) { const value=nested(row,col.key); if(col.money)return money(value);if(col.date)return shortDate(value);if(typeof value==='boolean')return value?'Sí':'No';return showValue(value); }
  return <><div className="page-heading"><div><p className="eyebrow">{title.eyebrow}</p><h1>{title.title}</h1><p className="muted">{title.desc}</p></div><div className="heading-actions">{page==='Caja'&&<button className="secondary" onClick={()=>openAction('cashMovement',page,{})}><Plus size={16}/> Movimiento de caja</button>}{canCreate&&<button className="primary" onClick={()=>openCreate(page)}><Plus size={16}/>{page==='Caja'?'Abrir caja':page==='Inventario'?'Ajustar stock':page==='Compras'?'Nueva compra':page==='Gastos'?'Registrar gasto':'Nuevo registro'}</button>}{page==='Configuración'&&<button className="primary" onClick={onSettings}><Settings size={16}/> Editar empresa</button>}<button className="secondary" onClick={()=>loadPage(page)}><RefreshCw size={16}/> Actualizar</button></div></div>
    {localMessage&&<div className="success-banner"><CheckCircle2 size={16}/>{localMessage}<button onClick={()=>setLocalMessage('')}>Cerrar</button></div>}
    {page==='Inventario'&&<>
      <section className="panel inventory-tools">
        <div className="inventory-tools-copy"><div className="inventory-tools-icon"><Boxes size={20}/></div><div><h3>Conteo físico y archivos</h3><p className="muted small">Sube el archivo como venga (Excel, Word o texto): el sistema ubica SKU, producto y cantidades, y la IA ayuda a mapear columnas raras.</p>{(dataAll?.products||[]).length===0&&<p className="field-help">Aún no hay productos: primero créalos en Productos (Nuevo registro o Importar CSV) y luego exporta la plantilla de conteo.</p>}</div></div>
        <div className="inventory-tool-actions">
          <input ref={inventoryImportRef} type="file" accept=".xlsx,.xls,.docx,.doc,.csv,.txt,.tsv,.json,.ods" hidden onChange={e=>{const f=e.target.files?.[0];if(f)previewInventoryFile(f);}}/>
          <button className="primary" disabled={localBusy} onClick={()=>inventoryImportRef.current?.click()}><Upload size={16}/>{localBusy?'Leyendo…':'Importar conteo'}</button>
          <div className="export-buttons"><span className="small muted">Exportar</span>{(['xlsx','docx','txt'] as const).map(f=><button key={f} className="secondary compact-format" disabled={localBusy} onClick={async()=>{try{await downloadFile(`/inventory/export?format=${f}`,`inventario-conteo.${f}`);}catch(e:any){setLocalMessage(e.message||'No se pudo exportar el inventario.');}}}>{f==='xlsx'?'Excel':f==='docx'?'Word':'Texto'}</button>)}</div>
          <button className="secondary ai-button" disabled={localBusy||!inventoryAiStatus?.configured} title={inventoryAiStatus?.configured?'Analiza rotación, mínimos y riesgos sin cambiar stock':'Configura el puente OpenCode en el servidor para habilitar IA'} onClick={runInventoryAi}><Sparkles size={16}/>{localBusy?'Analizando…':'Asistente IA'}</button>
        </div>
        {inventoryAiStatus?.configured&&<div className="ai-taskbar">
          <div className="ai-tasks">{[['insights','Análisis'],['restock','Reposición'],['pricing','Precios'],['copy','Descripción']].map(([v,l])=><button key={v} className={`ai-task${inventoryAiTask===v?' active':''}`} onClick={()=>{setInventoryAiTask(v);setInventoryAiResult(null);setInventoryAiError('');}}>{l}</button>)}</div>
          <div className="ai-options">
            <select value={inventoryAiModel} onChange={e=>setInventoryAiModel(e.target.value)} title="Modelo gratuito">
              <option value="">Modelo: {inventoryAiStatus?.model||'auto'}</option>
              {inventoryAiModels.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
            {inventoryAiTask==='restock'&&<label className="ai-cover">Cobertura <input type="number" min={7} max={120} value={inventoryAiCover} onChange={e=>setInventoryAiCover(e.target.value)}/> días</label>}
            {inventoryAiTask==='copy'&&<select value={inventoryAiProduct} onChange={e=>setInventoryAiProduct(e.target.value)}><option value="">Selecciona producto…</option>{(dataAll?.products||[]).map((p:any)=><option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select>}
          </div>
        </div>}
        {!inventoryAiStatus?.configured&&<p className="field-help inventory-ai-hint">IA pendiente de configuración del puente OpenCode en EasyPanel. La importación y el resto del POS funcionan sin IA.</p>}
      </section>
      {inventoryPreview&&<section className="panel inventory-preview">
        <div className="panel-head"><div><h3>Vista previa del conteo</h3><p className="muted small">{inventoryPreview.filename} · {inventoryPreview.valid} válidas · {inventoryPreview.invalid} con error. Nada se ha guardado todavía.</p></div><button className="text-btn" onClick={()=>setInventoryPreview(null)}>Descartar</button></div>
        <div className="table-wrap"><table><thead><tr><th>Fila</th><th>SKU / producto</th><th>Sucursal / bodega</th><th>Actual</th><th>Contado</th><th>Diferencia</th><th>Revisión</th></tr></thead><tbody>{inventoryPreview.rows.map((row:any)=><tr key={`${row.line}-${row.sku}`}><td>{row.line}</td><td><b>{row.sku||'—'}</b><small className="preview-product-name">{row.productName||''}</small>{(row.guessed||[]).map((g:string)=><small key={g} className="preview-guess">{g}</small>)}</td><td>{row.branchName||'—'} / {row.warehouseName||'—'}{row.warehouseDefaulted&&<small className="preview-guess">bodega por defecto</small>}</td><td>{row.expectedQuantity??'—'}</td><td>{row.countedQuantity??'—'}</td><td>{row.delta===undefined?'—':Number(row.delta)>0?`+${row.delta}`:row.delta}</td><td>{row.valid?(row.willCreate?<span className="pill warning">Nuevo</span>:<span className="pill green">Lista</span>):<span className="pill danger-pill">{row.error}</span>}</td></tr>)}</tbody></table></div>
        <div className="preview-footer"><p className="field-help">Se aplicarán solo filas válidas; las filas con error se omiten. Si un saldo cambia después de esta vista previa, se cancela toda la operación y deberás importar de nuevo.</p><label className="check-label"><input type="checkbox" checked={inventoryCreateMissing} onChange={e=>{setInventoryCreateMissing(e.target.checked); if(inventoryFile) previewInventoryFile(inventoryFile, inventoryMapping, e.target.checked);}}/> Crear productos faltantes (precio y costo en 0, editables luego)</label><div className="preview-actions">{inventoryAiStatus?.configured&&<button className="secondary" disabled={localBusy||!inventoryFile} onClick={mapInventoryWithAi}><Sparkles size={16}/>Mapear columnas con IA</button>}<button className="primary" disabled={localBusy||inventoryPreview.valid===0} onClick={applyInventoryFile}><CheckCircle2 size={16}/>{localBusy?'Aplicando…':`Aplicar ${inventoryPreview.valid} filas válidas`}</button></div></div>
      </section>}
      {inventoryAiError&&<div className="error banner">{inventoryAiError}<button onClick={()=>setInventoryAiError('')}>Cerrar</button></div>}
      {inventoryAiResult&&<section className="panel inventory-ai-result"><div className="panel-head"><div><p className="eyebrow">ASISTENTE DE INVENTARIO · {inventoryAiResult.model||''}</p><h3>{inventoryAiResult.kind==='restock'?'Plan de reposición':inventoryAiResult.kind==='pricing'?'Precios y promociones':inventoryAiResult.kind==='copy'?'Descripción comercial':'Oportunidades y alertas'}</h3></div><button className="text-btn" onClick={()=>setInventoryAiResult(null)}>Cerrar</button></div>
      {inventoryAiResult.kind==='insights'&&<div className="ai-metrics"><span>{inventoryAiResult.metrics?.inventoryRows} referencias</span><span>Valor costo {money(inventoryAiResult.metrics?.inventoryCostValueCOP)}</span><span>{inventoryAiResult.metrics?.belowMinimumCount} en mínimo o por debajo</span></div>}
      {inventoryAiResult.kind==='restock'&&<><div className="ai-metrics"><span>Cobertura {inventoryAiResult.coverDays} días</span><span>Costo estimado {money(inventoryAiResult.totalOrderCostCOP)}</span><span>{(inventoryAiResult.lines||[]).length} líneas</span></div><div className="table-wrap"><table><thead><tr><th>SKU</th><th>Producto</th><th>Stock</th><th>Días cobert.</th><th>Pedir</th><th>Costo</th></tr></thead><tbody>{(inventoryAiResult.lines||[]).slice(0,20).map((l:any)=><tr key={l.productId+l.warehouse}><td>{l.sku}</td><td>{l.name}</td><td>{l.stock}</td><td>{l.daysOfCover??'—'}</td><td><b>{l.suggestedOrder}</b></td><td>{money(l.orderCostCOP)}</td></tr>)}</tbody></table></div></>}
      {inventoryAiResult.kind==='pricing'&&<div className="table-wrap"><table><thead><tr><th>SKU</th><th>Producto</th><th>Margen</th><th>Precio</th><th>Promo sugerida</th><th></th></tr></thead><tbody>{(inventoryAiResult.promoCandidates||[]).map((c:any)=><tr key={c.productId}><td>{c.sku}</td><td>{c.name}</td><td>{c.marginPct}%</td><td>{money(c.priceCOP)}</td><td><b>{money(c.suggestedPromoCOP)}</b></td><td><button className="table-action" disabled={localBusy} onClick={()=>applyPromo(c.productId,c.suggestedPromoCOP)}>Aplicar</button></td></tr>)}</tbody></table>{!(inventoryAiResult.promoCandidates||[]).length&&<p className="field-help">Sin candidatas a promoción con los criterios actuales.</p>}</div>}
      {inventoryAiResult.kind==='copy'&&<><p className="small muted">SKU {inventoryAiResult.sku}</p></>}
      <p className="ai-analysis">{inventoryAiResult.analysis||inventoryAiResult.copy}</p><p className="field-help">La IA propone; no modifica productos, compras ni existencias. Las promociones solo se aplican si las confirmas.</p></section>}
    </>}
    {page==='Configuración'&&data&&!Array.isArray(data)&&<section className="panel company-details"><div className="company-initial">{(data.name||'N').slice(0,1)}</div><div className="company-info"><h2>{data.name||'Empresa sin nombre'}</h2><p>{data.taxId||'NIT sin configurar'} · {data.currency||'COP'} · {data.timezone||'America/Bogota'}</p><p>{data.email||'Correo pendiente'} · {data.phone||'Teléfono pendiente'}</p><p>{data.address||'Dirección pendiente'}</p></div></section>}
    {page==='Facturación electrónica'&&<section className="panel invoice-status"><div className="invoice-icon"><FileText size={25}/></div><div><span className="pill warning">{data?.status||'NOT_CONFIGURED'}</span><h2>Integración no configurada</h2><p>{data?.message||'Debe configurarse un proveedor autorizado, credenciales, numeración y entorno de pruebas antes de emitir documentos fiscales.'}</p><p className="field-help">Esta versión no genera ni valida facturas electrónicas DIAN. Los recibos POS comerciales no reemplazan una factura electrónica validada.</p></div></section>}
    {page==='Reportes'&&data&&!Array.isArray(data)&&<><div className="stat-grid"><StatCard label="Ventas brutas" value={money(data.grossSales)}/><StatCard label="Devoluciones" value={money(data.returns)}/><StatCard label="Ventas netas" value={money(data.netSales)}/><StatCard label="Costo de ventas" value={money(data.costOfSales)}/><StatCard label="Utilidad bruta" value={money(data.grossProfit)}/><StatCard label="Gastos" value={money(data.expenses)}/><StatCard label="Compras" value={money(data.purchases)}/><StatCard label="Valor inventario" value={money(data.inventoryValue)}/></div><div className="two-col"><section className="panel"><div className="panel-head"><div><h3>Ventas por día</h3><p className="muted small">Últimos 30 días por defecto</p></div></div>{(data.dailySales||[]).length?<div className="bar-chart">{(data.dailySales||[]).slice(-30).map((x:any)=><div className="bar-column" key={x.date} title={`${x.date}: ${money(x.total)}`}><div className="bar" style={{height:`${Math.max(5,(Number(x.total)/Math.max(1,...data.dailySales.map((z:any)=>Number(z.total))))*100)}%`}}></div><span>{String(x.date).slice(5)}</span></div>)}</div>:<Empty text="Aún no hay datos de ventas."/>}</section><section className="panel"><div className="panel-head"><div><h3>Ventas por método de pago</h3><p className="muted small">Importes registrados en transacciones</p></div></div>{(data.paymentTotals||[]).map((x:any)=><div className="low-row" key={x.method}><div className="grow"><b>{x.method}</b><small>Medio de pago</small></div><strong>{money(x.amount)}</strong></div>)}</section></div><section className="panel"><div className="panel-head"><h3>Productos más vendidos</h3></div><div className="table-wrap"><table><thead><tr><th>Producto</th><th>SKU</th><th>Cantidad</th><th>Valor línea</th></tr></thead><tbody>{(data.topProducts||[]).map((x:any,i:number)=><tr key={x.productId}><td>{x.product?.name||'Producto'}</td><td>{x.product?.sku||'—'}</td><td>{Number(x._sum?.quantity||0)}</td><td>{money(x._sum?.lineTotal)}</td></tr>)}</tbody></table></div></section></>}
    {page==='Sucursales'&&Array.isArray(data)&&<section className="panel"><div className="panel-head"><div><h3>Sucursales registradas</h3><p className="muted small">Al crear una sucursal se crean una bodega y una caja por defecto.</p></div></div><div className="branch-cards">{data.map((b:any)=><div className="branch-card" key={b.id}><div className="product-dot"><Building2 size={18}/></div><h3>{b.name}</h3><p>{b.address||'Dirección sin configurar'}</p><div className="branch-meta"><span>{(b.warehouses||[]).length} bodegas</span><span>{(b.registers||[]).length} cajas</span></div><div className="small muted">{(b.registers||[]).map((r:any)=>r.name).join(', ')||'Sin cajas'}</div></div>)}</div><div className="table-wrap"><table><thead><tr><th>Sucursal</th><th>Código</th><th>Dirección</th><th>Teléfono</th></tr></thead><tbody>{data.map((b:any)=><tr key={b.id}><td><b>{b.name}</b></td><td>{b.code||'—'}</td><td>{b.address||'—'}</td><td>{b.phone||'—'}</td></tr>)}</tbody></table></div></section>}
    {page==='Caja'&&<div className="section-tips"><Wallet size={16}/> Para evitar diferencias, registra todo retiro o ingreso por medio de “Movimiento de caja”. El efectivo esperado incluye fondo inicial, ventas en efectivo, retiros e ingresos.</div>}
    {page==='Compras'&&<div className="section-tips"><Truck size={16}/> Crear la orden no suma existencias. Usa el botón “Recibir” cuando la mercancía realmente llegue a la bodega.</div>}
    {isTable&&<section className="panel"><div className="panel-head"><div><h3>{page}</h3><p className="muted small">{tableRows.length} registro(s) cargados</p></div><div className="table-tools"><div className="searchbox table-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar en registros…"/></div>{page==='Productos'&&<><input ref={importRef} type="file" accept=".csv" hidden onChange={e=>{const f=e.target.files?.[0]; if(f) importCsv(f);}}/><button className="icon-btn" onClick={()=>importRef.current?.click()} title="Importar CSV"><Upload size={16}/></button><input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={e=>{const f=e.target.files?.[0]; if(f) uploadImage(f);}}/><button className="icon-btn" onClick={async()=>{setLocalBusy(true);setLocalMessage('');try{await downloadFile('/products/export','productos.csv');setLocalMessage('Exportación descargada.');}catch(e:any){setLocalMessage(e.message||'No se pudo exportar.');}finally{setLocalBusy(false);}}} title="Exportar CSV del servidor"><FileDown size={16}/></button></>}<button className="icon-btn" onClick={()=>{const content=[headers.map((c:any)=>c.label).join(','),...tableRows.map((r:any)=>headers.map((c:any)=>`"${String(cellValue(r,c)).replace(/"/g,'""')}"`).join(','))].join('\n');const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`${page.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.csv`;a.click();URL.revokeObjectURL(url);}} title="Exportar CSV"><Download size={16}/></button></div></div><div className="table-wrap"><table><thead><tr>{headers.map((col:any)=><th key={col.key}>{col.label}</th>)}{['Caja','Compras','Cuentas por cobrar','Cuentas por pagar','Ventas','Productos','Clientes','Proveedores','Usuarios','Categorías','Sucursales'].includes(page)&&<th>Acciones</th>}</tr></thead><tbody>{tableRows.map((row:any)=>{const actions:any[]=[];if(['Productos','Clientes','Proveedores','Usuarios','Categorías','Sucursales'].includes(page))actions.push(<button key="edit" className="table-action" onClick={()=>openEdit(page,row)}>Editar</button>);if(page==='Productos'){actions.push(<button key="img" className="table-action" onClick={()=>{setUploadRow(row);setTimeout(()=>uploadRef.current?.click(),0);}}>Imagen</button>);actions.push(<button key="arch" className="table-action danger" onClick={async()=>{if(!window.confirm(`¿Archivar "${row.name||row.sku}"? Se ocultará del POS pero queda en el historial.`))return;setLocalBusy(true);setLocalMessage('');try{await request(`/products/${row.id}/archive`,{method:'POST'});setLocalMessage('Producto archivado.');await loadPage(page);}catch(e:any){setLocalMessage(e.message||'No se pudo archivar.');}finally{setLocalBusy(false);}}}>Archivar</button>);}if(page==='Caja'&&row.status==='OPEN')actions.push(<button key="close" className="table-action" onClick={()=>openAction('closeCash',page,row)}>Cerrar caja</button>);if(page==='Compras'&&!['RECEIVED','CANCELLED'].includes(row.status))actions.push(<button key="receive" className="table-action" onClick={()=>receivePurchase(row)}>Recibir</button>,<button key="cancel" className="table-action danger" onClick={()=>cancelPurchase(row)}>Cancelar</button>);if(page==='Cuentas por cobrar'&&row.status!=='PAID')actions.push(<button key="pay" className="table-action" onClick={()=>openAction('receivablePayment',page,row)}>Abonar</button>);if(page==='Cuentas por pagar'&&row.status!=='PAID')actions.push(<button key="pay" className="table-action" onClick={()=>openAction('payablePayment',page,row)}>Registrar pago</button>);if(page==='Ventas'&&['COMPLETED','PARTIALLY_RETURNED'].includes(row.status))actions.push(<button key="print" className="table-action" onClick={()=>printReceipt(row,money)}>Imprimir</button>,<button key="return" className="table-action" onClick={()=>{openAction('create','Devoluciones',row)}}>Devolver</button>);return <tr key={row.id||row.number}>{headers.map((col:any)=><td key={col.key}>{col.key==='status'?<span className={`pill ${['COMPLETED','RECEIVED','PAID','OPEN'].includes(nested(row,col.key))?'green':''}`}>{cellValue(row,col)}</span>:col.key==='imageUrl'?(nested(row,'imageUrl')?<img src={`${API_ORIGIN}${nested(row,'imageUrl')}`} alt={nested(row,'name')||'Producto'} className="thumb"/>:<span className="thumb-empty"><Package size={16}/></span>):cellValue(row,col)}</td>)}{['Caja','Compras','Cuentas por cobrar','Cuentas por pagar','Ventas','Productos','Clientes','Proveedores','Usuarios','Categorías','Sucursales'].includes(page)&&<td><div className="row-actions">{actions.length?actions:<span className="muted small">—</span>}</div></td>}</tr>})}</tbody></table>{!tableRows.length&&<Empty text={data===undefined?'No se pudo cargar la información o no tienes permiso para consultarla.':'No hay registros para mostrar.'}/>}</div></section>}
  </>;
}

function printReceipt(sale:any,moneyFn:(value:any)=>string) {
  const clean=(v:any)=>String(v??'').replace(/[&<>"']/g,(c:string)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
  const rows=(sale.items||[]).map((item:any)=>`<tr><td>${clean(item.description)}<small>${clean(item.sku||'')}</small><div>${Number(item.quantity)} × ${moneyFn(item.unitPrice)}</div></td><td style="text-align:right">${moneyFn(item.lineTotal)}</td></tr>`).join('');
  const payments=(sale.payments||[]).map((p:any)=>`<p>${clean(p.method)} <span>${moneyFn(p.amount)}</span></p>`).join('');
  const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante POS #${clean(sale.number)}</title><style>body{font:12px Arial,sans-serif;width:280px;margin:12px auto;color:#111}h1{font-size:18px;text-align:center;margin:5px 0}p{margin:5px 0}header{text-align:center;border-bottom:1px dashed #777;padding-bottom:10px}table{width:100%;border-collapse:collapse;margin:10px 0}td{padding:7px 0;border-bottom:1px dotted #bbb;vertical-align:top}td:first-child{width:68%}small{display:block;color:#555;margin:3px 0} .totals{border-top:1px dashed #777;padding-top:7px}.totals p,p span{display:flex;justify-content:space-between}.big{font-size:16px;font-weight:bold}.footer{text-align:center;border-top:1px dashed #777;padding-top:10px;margin-top:12px}@media print{body{margin:0 auto}}</style></head><body><header><h1>${clean(sale.company?.name||sale.branch?.name||'POS Colombia')}</h1><p>Comprobante de venta</p><p>Venta #${clean(sale.number)}</p><p>${clean(new Date(sale.createdAt).toLocaleString('es-CO'))}</p><p>Sucursal: ${clean(sale.branch?.name||'—')}</p><p>Atendió: ${clean(sale.user?.name||'—')}</p><p>Cliente: ${clean(sale.customer?.name||'Consumidor final')}</p></header><table>${rows}</table><div class="totals"><p><span>Subtotal</span><span>${moneyFn(sale.subtotal)}</span></p><p><span>Descuento</span><span>${moneyFn(sale.discount)}</span></p><p><span>Impuestos</span><span>${moneyFn(sale.tax)}</span></p><p class="big"><span>TOTAL</span><span>${moneyFn(sale.total)}</span></p></div><h3>Pagos</h3>${payments}<div class="footer"><p>Gracias por su compra</p><p>Comprobante comercial, no equivale por sí mismo a factura electrónica DIAN.</p></div><script>window.onload=()=>window.print()</script></body></html>`;
  const win=window.open('','_blank','width=420,height=700');
  if(!win) { window.alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para imprimir.'); return; }
  win.document.open();win.document.write(html);win.document.close();
}

function StatCard({label,value}:any){return <div className="stat-card compact-stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>}
function Empty({text}:any){return <div className="empty"><Package size={25}/><p>{text}</p></div>}
