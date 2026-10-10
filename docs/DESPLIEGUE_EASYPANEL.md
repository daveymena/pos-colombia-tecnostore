# Despliegue a producción en EasyPanel — POS Colombia (TecnoStore)

Esta guía deja el POS corriendo con HTTPS, base de datos persistente y copias de seguridad.
Tiempo estimado: 30–45 minutos.

## 0. Requisitos previos

- [ ] Cuenta de GitHub con este repositorio subido (rama `main`).
- [ ] Servidor con EasyPanel instalado y dominio apuntando a su IP (ej. `pos.tudominio.com`, `api.tudominio.com`).
- [ ] Clave JWT de 32+ caracteres: `openssl rand -base64 36`.

### Si EasyPanel muestra “Cannot access repository or branch main doesn't exist”

El repositorio `daveymena/pos-colombia-tecnostore` es privado, pero GitHub confirma que la rama `main` existe. Autoriza **EasyPanel** en GitHub: **Settings → Applications → Installed GitHub Apps → EasyPanel → Configure → Repository access → Only select repositories → añade `pos-colombia-tecnostore`**. Después vuelve a EasyPanel, reconecta la integración GitHub y selecciona owner `daveymena`, repo `pos-colombia-tecnostore`, branch `main`. No hagas público el repo.

Si el formulario usa Git URL en vez de la integración, usa `https://github.com/daveymena/pos-colombia-tecnostore.git` y configura en EasyPanel un token fine-grained de solo lectura (Contents: Read-only). No pegues ese token en el repositorio, en variables `VITE_*` ni en el chat.

## 1. Base de datos (servicio gestionado de EasyPanel)

1. En EasyPanel: **Services → + Service → PostgreSQL 16**.
2. Nombre: `pos-db`. Guarda usuario, contraseña y nombre de BD.
3. Activa **Mounts**: el volumen de datos ya viene persistente por defecto.
4. Activa **Backups** del servicio (diario, retención 7 días).

`DATABASE_URL` queda así (interna, sin exponer puertos):
`postgresql://pos:TU_CLAVE@pos-db:5432/posdb?schema=public`

## 2. API (App desde GitHub)

1. **Apps → + App → From GitHub**, rama `main`, Build Path: `apps/api` (Dockerfile).
2. Dominio: `https://api.tudominio.com` con HTTPS activado.
3. Variables de entorno:
   - `DATABASE_URL` = la del paso 1 (usa el hostname interno `pos-db`).
   - `JWT_SECRET` = clave de 32+ caracteres.
   - `CORS_ORIGIN` = `https://pos.tudominio.com`
   - `UPLOADS_DIR` = `/app/uploads`
   - `NODE_ENV` = `production`
   - `OPENCODE_API_URL` = `https://opencode.ai/zen/v1` (o URL interna del puente OpenAI-compatible)
   - `OPENCODE_API_KEY` = clave de OpenCode Zen guardada como secreto en EasyPanel; vacío deshabilita IA
   - `OPENCODE_MODEL` = `deepseek-v4-flash-free` u otro ID gratuito habilitado en la cuenta
   - `ENABLE_SWAGGER` = `false` (predeterminado; solo actívalo temporalmente si necesitas la documentación)
4. **Mounts → + Volume**: nombre `pos_uploads`, ruta `/app/uploads` (las fotos de productos sobreviven a cada despliegue).
5. Deploy. La propia imagen ejecuta `prisma migrate deploy` al arrancar y expone `GET /api/health`.

## 3. Carga inicial: empresa + catálogo TecnoStore (una sola vez)

Desde tu PC con acceso a la BD de producción (túnel SSH o variable temporal):

```sh
set DATABASE_URL=postgresql://pos:TU_CLAVE@TU_SERVIDOR:5432/posdb?schema=public
set ADMIN_EMAIL=admin@tutienda.com
set ADMIN_PASSWORD=UnaClaveLargaYSegura123!
set STORE_NAME=TecnoStore Bogotá
set STORE_NIT=901123456-7
npm run db:seed:techstore -w apps/api
```

Crea 11 categorías, 22 productos con IVA 19%, stock inicial, sucursal, bodega, caja y el usuario administrador. **Guarda la contraseña en un gestor; no la dejes en el historial.**

## 4. Web (App desde GitHub)

1. **Apps → + App → From GitHub**, Build Path: `apps/web` (Dockerfile).
2. Dominio: `https://pos.tudominio.com` con HTTPS.
3. Build Arg: `VITE_API_URL=https://api.tudominio.com/api` (se fija al compilar; si cambias el dominio de la API, reconstruye).
4. Deploy y abre el dominio: el login ya NO trae credenciales de prueba (solo aparecen en desarrollo local).

## Importación y exportación de inventario

- En **Inventario → Importar conteo**, admite `.xlsx`, `.docx`, `.csv`, `.txt`, `.tsv` y `.json` (máx. 10 MB).
- Muestra una vista previa de stock actual, conteo físico, diferencia y errores. Solo aplica las filas válidas después de confirmar; si el stock cambió mientras revisabas, rechaza todo el lote y pide importar de nuevo.
- Exporta Excel, Word, texto tabulado, CSV o JSON. Edita `cantidadContada` y conserva `sku`, `bodega`/`sucursal` y `warehouseId` al reimportar.
- Cada cambio crea un movimiento de ajuste auditado `CONTEO-*`; nunca sobrescribe stock sin registrar el kardex.

## Asistente de inventario con OpenCode

Cuando estén configuradas las variables del puente, **Inventario → Análisis IA** analiza mínimos, valor al costo y salidas de los últimos 30 días. Envía datos agregados de producto e inventario, sin información de clientes ni credenciales. Es de solo lectura: no crea compras ni modifica productos o existencias. Si el proveedor falla o no tiene clave, el POS sigue funcionando sin IA.

## 5. Verificación post-despliegue (checklist)

- [ ] `https://api.tudominio.com/api/health` → `{"ok":true}`.
- [ ] Login con el administrador creado en el paso 3.
- [ ] Cambia la contraseña del administrador (Usuarios → editar).
- [ ] Crea un usuario CAJERO de prueba y confirma que NO ve Reportes/Configuración (RBAC).
- [ ] Registra una venta de prueba, una devolución parcial y ciérrala; revisa cuadre de caja en 0.
- [ ] Sube la foto de un producto y confirma que carga (volumen `pos_uploads`).
- [ ] Exporta la plantilla, edita `cantidadContada`, vuelve a importarla y verifica saldo y kardex.
- [ ] Si configuraste OpenCode, ejecuta un análisis y confirma que la respuesta solo da sugerencias.
- [ ] Swagger queda apagado por defecto en producción; si necesitas `/api/docs`, activa `ENABLE_SWAGGER=true` solo mientras lo usas.
- [ ] Confirma backup diario de `pos-db` y descarga una copia inicial.

## 6. Operación diaria

- **Copias**: además del backup de EasyPanel, programa `pg_dump` semanal externo.
- **Actualizaciones**: push a `main` → Redeploy en EasyPanel (las migraciones corren solas; los uploads persisten en el volumen).
- **Facturación electrónica**: el sistema muestra `NOT_CONFIGURED` a propósito. Para emitir facturas DIAN contrata un proveedor autorizado e integra su API en `ElectronicInvoice`; los comprobantes POS actuales son comerciales, no fiscales.
- **Multi-sucursal**: crea sucursales desde Configuración (cada una nace con bodega y caja). Para otras tiendas o líneas de negocio, repite el seed con otro `STORE_NAME` o crea una empresa adicional.

## 7. Qué NO hacer en producción

- No uses `prisma db push` ni el seed demo (`seed.ts`) contra la BD productiva.
- No publiques `JWT_SECRET`, `POSTGRES_PASSWORD` ni `ADMIN_PASSWORD` en el repo o chats.
- No expongas el puerto 5432 a internet; usa la red interna de EasyPanel.
