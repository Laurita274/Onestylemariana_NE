/* ===========================================================
   OneStyleMariana — Controlador SPA del Panel Administrativo (#/admin)
   Depende de: OneStyleAPI (api.js), OSM.toast (toast.js) y OSM.* (helpers.js)
   =========================================================== */
(() => {
  'use strict';

  window.OSM = window.OSM || {};

  const PANELS = ['resumen', 'pedidos', 'catalogo', 'inventario', 'atributos', 'novedades', 'perfil'];
  const NEXT_STATE_BY_STAGE = {
    1: 'Confirmado',
    2: 'En Empaque',
    3: 'Despachado',
    4: 'Entregado'
  };

  const state = {
    initialized: false,
    activePanel: 'resumen',
    orders: { page: 1, per_page: 8, estado: '', q: '', items: [], pagination: null },
    catalog: { page: 1, per_page: 8, q: '', categoria: '', estado: '', items: [], pagination: null },
    categories: [],
    attributes: { tallas: [], colores: [] },
    novedades: { config: null, items: [] },
    selectedOrder: null,
    selectedProductForVariant: null
  };

  let orderDrawer = null;
  let productModal = null;
  let variantModal = null;
  let categoryModal = null;
  let sizeModal = null;
  let colorModal = null;
  let novItemModal = null;

  function badgeForOrderState(estado, etapa) {
    const stage = Number(etapa ?? 1);
    if (stage === 0 || estado === 'Cancelado') return `<span class="osm-badge osm-badge--Cancelado">${OSM.esc(estado || 'Cancelado')}</span>`;
    const cls = `osm-badge--${String(estado || 'Registrado').replace(/\s+/g, '-')}`;
    return `<span class="osm-badge ${OSM.esc(cls)}">${OSM.esc(estado || 'Registrado')}</span>`;
  }

  function updateSidebarIdentity() {
    const user = OneStyleAPI.getSavedUser();
    const nameEl = document.getElementById('admUserName');
    const roleEl = document.getElementById('admUserRole');
    if (user && nameEl) {
      nameEl.textContent = `${user.nombre || ''} ${user.apellido || ''}`.trim() || user.email || 'Administradora';
    }
    if (user && roleEl) {
      roleEl.textContent = user.rol || 'Administradora';
    }
  }

  /* =========================================================
     1. RESUMEN Y MÉTRICAS CONSOLIDADAS (GET /api/admin/dashboard)
     ========================================================= */
  async function loadResumen() {
    const kpiPending = document.getElementById('admKpiPending');
    const kpiRevenue = document.getElementById('admKpiRevenue');
    const kpiAlerts = document.getElementById('admKpiAlerts');
    const kpiCatalog = document.getElementById('admKpiCatalog');
    const barsWrap = document.getElementById('admStateBars');
    const alertsBody = document.getElementById('admLowStockBody');
    const recentBody = document.getElementById('admRecentOrdersBody');
    const navPending = document.getElementById('admNavPendingBadge');
    const navCatalog = document.getElementById('admNavCatalogBadge');
    const navAlerts = document.getElementById('admNavAlertsBadge');

    if (barsWrap) barsWrap.innerHTML = OSM.skeletonBlock('8rem');
    if (alertsBody) alertsBody.innerHTML = OSM.skeletonRows(4, 3);
    if (recentBody) recentBody.innerHTML = OSM.skeletonRows(5, 4);

    try {
      const res = await OneStyleAPI.admin.dashboard();
      const d = (res && res.data) || {};
      const ped = d.pedidos || {};
      const inv = d.inventario || {};
      const cat = d.catalogo || {};
      const porEstado = ped.conteo_por_estado || ped.por_estado || {};
      const pendingCount = Number(ped.pedidos_pendientes ?? ped.pendientes_atencion ?? 0);
      const totalRevenue = Number(ped.ventas_totales ?? ped.ingresos_totales ?? 0);
      const alertCount = Number(inv.alertas_total ?? ((inv.bajo_stock_count || 0) + (inv.agotados_count || 0)));
      const visCount = Number(cat.productos_visibles ?? cat.productos_activos ?? 0);

      if (kpiPending) kpiPending.textContent = String(pendingCount);
      if (kpiRevenue) kpiRevenue.textContent = OSM.money(totalRevenue);
      if (kpiAlerts) kpiAlerts.textContent = String(alertCount);
      if (kpiCatalog) kpiCatalog.textContent = `${visCount} / ${cat.total_productos ?? 0}`;

      if (navPending) {
        navPending.textContent = String(pendingCount);
        navPending.classList.toggle('d-none', pendingCount <= 0);
      }
      if (navCatalog) {
        navCatalog.textContent = String(visCount);
        navCatalog.classList.toggle('d-none', visCount <= 0);
      }
      if (navAlerts) {
        navAlerts.textContent = String(alertCount);
        navAlerts.classList.toggle('d-none', alertCount <= 0);
      }

      const totalOrders = Math.max(1, Number(ped.total_pedidos || 0));
      const statesOrder = ['Registrado', 'Confirmado', 'En Empaque', 'Despachado', 'Entregado', 'Cancelado'];
      if (barsWrap) {
        barsWrap.innerHTML = statesOrder.map(st => {
          const count = Number(porEstado[st] || 0);
          const pct = Math.round((count / totalOrders) * 100);
          const cancelCls = st === 'Cancelado' ? 'is-cancel' : '';
          return `
            <div class="adm-bar__row ${cancelCls}">
              <span>${OSM.esc(st)}</span>
              <progress class="adm-bar__progress" value="${pct}" max="100"></progress>
              <span class="adm-bar__num">${count}</span>
            </div>`;
        }).join('');
      }

      const alertas = Array.isArray(inv.alertas)
        ? inv.alertas.slice(0, 6)
        : [
          ...(Array.isArray(inv.agotados) ? inv.agotados : []),
          ...(Array.isArray(inv.alertas_bajo_stock) ? inv.alertas_bajo_stock : [])
        ].slice(0, 6);

      if (alertsBody) {
        if (!alertas.length) {
          alertsBody.innerHTML = `<tr><td colspan="4">${OSM.emptyState('bi-check2-circle', 'Inventario saludable', 'Todas las variantes superan el umbral mínimo de stock.')}</td></tr>`;
        } else {
          alertsBody.innerHTML = alertas.map(a => `
            <tr>
              <td>
                <div class="t-strong">${OSM.esc(a.nombre_producto || a.sku)}</div>
                <div class="t-muted">${OSM.esc(a.sku)} · ${OSM.esc(a.color || '')} / Talla ${OSM.esc(a.talla || '')}</div>
              </td>
              <td>
                <span class="osm-badge ${Number(a.stock_disponible) === 0 ? 'osm-badge--low' : 'osm-badge--Registrado'}">
                  ${Number(a.stock_disponible)} disp.
                </span>
              </td>
              <td class="t-muted">Mín. ${Number(a.umbral_alerta ?? 3)}</td>
              <td class="t-right">
                <a href="#/admin/inventario" class="osm-btn osm-btn--sm">Ajustar</a>
              </td>
            </tr>`).join('');
        }
      }

      const recientes = Array.isArray(d.pedidos_recientes) ? d.pedidos_recientes : [];
      if (recentBody) {
        if (!recientes.length) {
          recentBody.innerHTML = `<tr><td colspan="5">${OSM.emptyState('bi-inbox', 'Sin pedidos recientes', 'Los nuevos pedidos aparecerán aquí en tiempo real.')}</td></tr>`;
        } else {
          recentBody.innerHTML = recientes.map(o => {
            const desp = o.datos_despacho || {};
            return `
              <tr>
                <td class="t-strong">${OSM.esc(o.codigo_orden)}</td>
                <td>
                  <div>${OSM.esc(desp.nombre_receptor || 'Cliente')}</div>
                  <div class="t-muted">${OSM.esc(desp.ciudad || 'Colombia')}</div>
                </td>
                <td class="t-strong">${OSM.money(o.total)}</td>
                <td>${badgeForOrderState(o.estado, o.etapa_fsm)}</td>
                <td class="t-right">
                  <button type="button" class="osm-btn osm-btn--sm" data-adm-open-order="${Number(o.id_pedido)}">
                    Gestionar
                  </button>
                </td>
              </tr>`;
          }).join('');
        }
      }
    } catch (err) {
      OSM.handleError(err, 'No se pudo cargar el resumen');
    }
  }

  /* =========================================================
     2. GESTIÓN DE PEDIDOS OMS + PAGINACIÓN EN SERVIDOR + DRAWER
     ========================================================= */
  async function loadPedidos() {
    const tbody = document.getElementById('admOrdersBody');
    const info = document.getElementById('admOrdersPageInfo');
    const label = document.getElementById('admOrdersPageLabel');
    const prev = document.getElementById('admOrdersPrev');
    const next = document.getElementById('admOrdersNext');
    if (!tbody) return;

    tbody.innerHTML = OSM.skeletonRows(6, 5);

    try {
      const res = await OneStyleAPI.admin.orders.list({
        page: state.orders.page,
        per_page: state.orders.per_page,
        estado: state.orders.estado,
        q: state.orders.q
      });
      const data = (res && res.data) || {};
      const items = Array.isArray(data.items)
        ? data.items
        : (Array.isArray(data.pedidos) ? data.pedidos : []);
      state.orders.items = items;
      state.orders.pagination = data;

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${OSM.emptyState('bi-bag-x', 'No se encontraron pedidos', 'Prueba ajustando el filtro de estado o el término de búsqueda.')}</td></tr>`;
      } else {
        tbody.innerHTML = items.map(p => {
          const desp = p.datos_despacho || {};
          const itemsSummary = (p.detalle_items || [])
            .map(i => `${OSM.esc(i.nombre_producto)} (${OSM.esc(i.talla)}) ×${Number(i.cantidad)}`)
            .join(', ');
          const waMsg = `Hola ${desp.nombre_receptor || ''}, te escribimos de OneStyleMariana sobre tu pedido ${p.codigo_orden} (${p.estado}).`;
          const waHref = OSM.whatsappUrl(desp.telefono, waMsg);

          return `
            <tr>
              <td>
                <div class="t-strong">${OSM.esc(p.codigo_orden)}</div>
                <div class="t-muted">${OSM.formatDate(p.fecha_creacion)}</div>
              </td>
              <td>
                <div class="t-strong">${OSM.esc(desp.nombre_receptor || 'Cliente')}</div>
                <div class="t-muted">${OSM.esc(desp.ciudad || '')} · ${OSM.esc(desp.telefono || desp.email || '')}</div>
              </td>
              <td>
                <div class="text-truncate adm-cell-truncate" title="${OSM.esc(itemsSummary)}">${itemsSummary || '—'}</div>
              </td>
              <td class="t-strong">${OSM.money(p.total)}</td>
              <td>${badgeForOrderState(p.estado, p.etapa_fsm)}</td>
              <td class="t-right">
                <div class="adm-actions">
                  ${waHref ? `<a href="${OSM.esc(waHref)}" target="_blank" rel="noopener noreferrer" class="osm-btn osm-btn--sm osm-btn--whatsapp" title="Contactar por WhatsApp"><i class="bi bi-whatsapp"></i></a>` : ''}
                  <button type="button" class="osm-btn osm-btn--sm osm-btn--primary" data-adm-open-order="${Number(p.id_pedido)}">
                    <i class="bi bi-sliders"></i> Estado / Detalle
                  </button>
                </div>
              </td>
            </tr>`;
        }).join('');
      }

      const page = Number(data.page || 1);
      const totalPages = Number(data.total_pages || 1);
      const total = Number(data.total ?? items.length);
      if (info) info.textContent = `Mostrando ${items.length} de ${total} pedidos`;
      if (label) label.textContent = `Página ${page} de ${totalPages}`;
      if (prev) prev.disabled = !data.has_prev;
      if (next) next.disabled = !data.has_next;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${OSM.emptyState('bi-exclamation-triangle', 'Error al consultar pedidos', OneStyleAPI.friendlyError(err))}</td></tr>`;
      OSM.handleError(err);
    }
  }

  async function openOrderDetail(idPedido) {
    let order = state.orders.items.find(o => Number(o.id_pedido) === Number(idPedido));
    if (!order) {
      try {
        const res = await OneStyleAPI.admin.orders.list({ page: 1, per_page: 50 });
        const list = (res && res.data && (res.data.items || res.data.pedidos)) || [];
        order = list.find(o => Number(o.id_pedido) === Number(idPedido));
      } catch (_) { }
    }
    if (!order) {
      OSM.toast.warning('No se encontró el detalle del pedido seleccionado.');
      return;
    }
    state.selectedOrder = order;
    renderOrderDrawer(order);
    if (orderDrawer) orderDrawer.show();
  }

  function renderOrderDrawer(order) {
    const titleEl = document.getElementById('admDrawerOrderCode');
    const badgeEl = document.getElementById('admDrawerOrderBadge');
    const bodyEl = document.getElementById('admDrawerOrderBody');
    const footEl = document.getElementById('admDrawerOrderFoot');
    if (!bodyEl || !footEl) return;

    const stage = Number(order.etapa_fsm ?? 1);
    const nextState = NEXT_STATE_BY_STAGE[stage] || null;
    const canCancel = stage === 1 || stage === 2;
    const desp = order.datos_despacho || {};

    if (titleEl) titleEl.textContent = `Pedido ${order.codigo_orden}`;
    if (badgeEl) badgeEl.innerHTML = badgeForOrderState(order.estado, stage);

    const steps = [
      { step: 1, label: 'Registrado', icon: 'bi-receipt' },
      { step: 2, label: 'Confirmado', icon: 'bi-check-lg' },
      { step: 3, label: 'En Empaque', icon: 'bi-box-seam' },
      { step: 4, label: 'Despachado', icon: 'bi-truck' },
      { step: 5, label: 'Entregado', icon: 'bi-bag-check' }
    ];

    const stepperHtml = stage === 0
      ? `<div class="adm-cancelled"><i class="bi bi-x-octagon me-2"></i>Pedido cancelado — el stock ha sido reintegrado automáticamente al inventario.</div>`
      : `<ol class="adm-stepper">
          ${steps.map(s => {
        const cls = s.step < stage ? 'done' : (s.step === stage ? 'current' : '');
        return `
              <li class="adm-step ${cls}">
                <div class="adm-step__dot"><i class="bi ${s.icon}"></i></div>
                <div>${OSM.esc(s.label)}</div>
              </li>`;
      }).join('')}
        </ol>`;

    const itemsHtml = (order.detalle_items || []).map(it => `
      <div class="adm-line">
        <div>
          <strong>${OSM.esc(it.nombre_producto)}</strong>
          <small>SKU: ${OSM.esc(it.sku || '—')} · ${OSM.esc(it.color)} / Talla ${OSM.esc(it.talla)} × ${Number(it.cantidad)}</small>
        </div>
        <div class="t-strong">${OSM.money(it.subtotal)}</div>
      </div>`).join('');

    const histHtml = (order.historial || []).map(h => `
      <li>
        <strong>${OSM.esc(h.estado)}</strong>
        <small>${OSM.formatDate(h.fecha)} — ${OSM.esc(h.motivo_cambio || 'Actualizado en OMS')}</small>
      </li>`).join('');

    bodyEl.innerHTML = `
      ${stepperHtml}

      <div class="adm-section-title">Datos de Envío y Contacto</div>
      <dl class="adm-kv">
        <dt>Destinatario</dt><dd>${OSM.esc(desp.nombre_receptor || '—')}</dd>
        <dt>Teléfono</dt><dd>${OSM.esc(desp.telefono || '—')}</dd>
        <dt>Correo</dt><dd>${OSM.esc(desp.email || '—')}</dd>
        <dt>Dirección</dt><dd>${OSM.esc(desp.direccion_envio || '—')}${desp.barrio ? ' (' + OSM.esc(desp.barrio) + ')' : ''}</dd>
        <dt>Ciudad</dt><dd>${OSM.esc(desp.ciudad || '—')}</dd>
        <dt>Notas</dt><dd>${OSM.esc(desp.observaciones || 'Sin observaciones')}</dd>
      </dl>

      <div class="adm-section-title">Prendas Consolidadas</div>
      <div>${itemsHtml || '<p class="text-muted small">Sin detalle de ítems.</p>'}</div>
      <div class="d-flex justify-content-between align-items-center pt-3 mt-1">
        <span class="text-uppercase small fw-semibold">Total del Pedido</span>
        <strong class="fs-5">${OSM.money(order.total)}</strong>
      </div>

      <div class="adm-section-title">Trazabilidad FSM</div>
      <ul class="adm-timeline">${histHtml || '<li><small>Sin historial adicional</small></li>'}</ul>
    `;

    const waMsg = `Hola ${desp.nombre_receptor || ''}, te contactamos de OneStyleMariana sobre tu pedido ${order.codigo_orden} por valor de ${OSM.money(order.total)}. Estado actual: ${order.estado}.`;
    const waHref = OSM.whatsappUrl(desp.telefono, waMsg);

    footEl.innerHTML = `
      ${waHref ? `<a href="${OSM.esc(waHref)}" target="_blank" rel="noopener noreferrer" class="osm-btn osm-btn--whatsapp"><i class="bi bi-whatsapp"></i> WhatsApp Cliente</a>` : ''}
      ${canCancel ? `<button type="button" class="osm-btn osm-btn--danger" data-adm-fsm="Cancelado"><i class="bi bi-x-circle"></i> Cancelar y Liberar Stock</button>` : ''}
      ${nextState ? `<button type="button" class="osm-btn osm-btn--gold" data-adm-fsm="${OSM.esc(nextState)}">Avanzar a ${OSM.esc(nextState)} <i class="bi bi-arrow-right"></i></button>` : ''}
    `;
  }

  async function executeOrderTransition(btn, nuevoEstado) {
    const order = state.selectedOrder;
    if (!order) return;

    if (nuevoEstado === 'Cancelado') {
      const ok = await OSM.confirm(
        `¿Confirmas la cancelación del pedido ${order.codigo_orden}? Las unidades descontadas se reintegrarán inmediatamente al inventario disponible.`,
        { title: 'Cancelar pedido y reintegrar stock', confirmText: 'Sí, cancelar pedido', danger: true }
      );
      if (!ok) return;
    }

    await OSM.run(btn, async () => {
      try {
        const res = await OneStyleAPI.admin.orders.transition(order.id_pedido, {
          nuevo_estado: nuevoEstado,
          motivo: `Actualizado en Panel OMS a ${nuevoEstado}`
        });
        OSM.toast.success(res.message || `Pedido actualizado a ${nuevoEstado}`);
        if (res.data) {
          state.selectedOrder = res.data;
          renderOrderDrawer(res.data);
        }
        await loadPedidos();
        await loadResumen();
        if (typeof window.syncCatalogFromBackend === 'function') {
          window.syncCatalogFromBackend();
        }
      } catch (err) {
        OSM.handleError(err, 'Transición no permitida');
      }
    }, 'Actualizando...');
  }

  /* =========================================================
     3. CATÁLOGO INTEGRADO EN SPA (#/admin/catalogo)
     ========================================================= */
  async function loadCatalogMetadata() {
    try {
      const [catRes, attrRes] = await Promise.all([
        OneStyleAPI.admin.catalog.categories(),
        OneStyleAPI.admin.catalog.attributes()
      ]);
      state.categories = (catRes && catRes.data) || [];
      state.attributes = (attrRes && attrRes.data) || { tallas: [], colores: [] };

      const filterCat = document.getElementById('admCatFilterCat');
      const modalCat = document.getElementById('admProdCategoria');
      if (filterCat) {
        const prev = filterCat.value;
        filterCat.innerHTML = `<option value="">Todas las categorías</option>` +
          state.categories.map(c => `<option value="${OSM.esc(c.slug)}">${OSM.esc(c.nombre_categoria)}</option>`).join('');
        if (prev) filterCat.value = prev;
      }
      if (modalCat) {
        const prev = modalCat.value;
        modalCat.innerHTML = state.categories.map(c =>
          `<option value="${Number(c.id_categoria)}">${OSM.esc(c.nombre_categoria)}</option>`
        ).join('');
        if (prev) modalCat.value = prev;
      }

      const tallaSel = document.getElementById('admVarTalla');
      const prodTallaSel = document.getElementById('admProdTalla');
      const tallasHtml = (state.attributes.tallas || []).map(t =>
        `<option value="${Number(t.id_talla)}">${OSM.esc(t.nombre_talla || t.codigo_talla)}</option>`
      ).join('');
      if (tallaSel) {
        const prev = tallaSel.value;
        tallaSel.innerHTML = tallasHtml;
        if (prev) tallaSel.value = prev;
      }
      if (prodTallaSel) {
        const prev = prodTallaSel.value;
        prodTallaSel.innerHTML = tallasHtml;
        if (prev) prodTallaSel.value = prev;
      }

      const colorSel = document.getElementById('admVarColor');
      const prodColorSel = document.getElementById('admProdColor');
      const coloresHtml = (state.attributes.colores || []).map(c =>
        `<option value="${Number(c.id_color)}">${OSM.esc(c.nombre_color)}</option>`
      ).join('');
      if (colorSel) {
        const prev = colorSel.value;
        colorSel.innerHTML = coloresHtml;
        if (prev) colorSel.value = prev;
      }
      if (prodColorSel) {
        const prev = prodColorSel.value;
        prodColorSel.innerHTML = coloresHtml;
        if (prev) prodColorSel.value = prev;
      }
    } catch (_) { }
  }

  async function loadCatalogo() {
    const tbody = document.getElementById('admCatalogBody');
    const info = document.getElementById('admCatalogPageInfo');
    const label = document.getElementById('admCatalogPageLabel');
    const prev = document.getElementById('admCatalogPrev');
    const next = document.getElementById('admCatalogNext');
    if (!tbody) return;

    tbody.innerHTML = OSM.skeletonRows(6, 5);

    try {
      const res = await OneStyleAPI.admin.catalog.products({
        page: state.catalog.page,
        per_page: state.catalog.per_page,
        q: state.catalog.q,
        categoria: state.catalog.categoria,
        estado: state.catalog.estado
      });
      const data = (res && res.data) || {};
      const items = Array.isArray(data.items) ? data.items : [];
      state.catalog.items = items;

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${OSM.emptyState('bi-tags', 'Sin prendas para este filtro', 'Crea una nueva prenda o limpia los filtros de búsqueda.')}</td></tr>`;
      } else {
        tbody.innerHTML = items.map(p => {
          const varCount = Array.isArray(p.variantes) ? p.variantes.length : 0;
          const totalStock = Number(p.stock_total_disponible ?? 0);
          const isVis = p.estado === 'activo';
          return `
            <tr>
              <td>
                <div class="adm-cell-product">
                  <div class="adm-thumb">
                    ${p.img ? `<img src="${OSM.esc(p.img)}" alt="${OSM.esc(p.name)}">` : `<i class="bi bi-bag"></i>`}
                  </div>
                  <div>
                    <div class="t-strong">${OSM.esc(p.name || p.nombre)}</div>
                    <div class="t-muted">${OSM.esc(p.desc || p.descripcion || '')}</div>
                  </div>
                </div>
              </td>
              <td><span class="osm-badge">${OSM.esc(p.nombre_categoria || p.cat || 'General')}</span></td>
              <td class="t-strong">${OSM.money(p.price || p.precio_base)}</td>
              <td>
                <span class="osm-badge ${totalStock === 0 ? 'osm-badge--low' : (totalStock <= 3 ? 'osm-badge--Registrado' : 'osm-badge--ok')}">
                  ${totalStock} uds (${varCount} SKU)
                </span>
              </td>
              <td>
                <label class="osm-switch" title="Cambiar visibilidad en tienda">
                  <input type="checkbox" data-adm-vis="${Number(p.id_producto)}" ${isVis ? 'checked' : ''}>
                  <span>${isVis ? 'Visible' : 'Oculto'}</span>
                </label>
              </td>
              <td class="t-right">
                <div class="adm-actions">
                  <button type="button" class="osm-btn osm-btn--sm" data-adm-add-var="${Number(p.id_producto)}">
                    <i class="bi bi-plus-lg"></i> Variante SKU
                  </button>
                </div>
              </td>
            </tr>`;
        }).join('');
      }

      const page = Number(data.page || 1);
      const totalPages = Number(data.total_pages || 1);
      const total = Number(data.total ?? items.length);
      if (info) info.textContent = `Mostrando ${items.length} de ${total} prendas`;
      if (label) label.textContent = `Página ${page} de ${totalPages}`;
      if (prev) prev.disabled = !data.has_prev;
      if (next) next.disabled = !data.has_next;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${OSM.emptyState('bi-exclamation-triangle', 'No se pudo cargar el catálogo', OneStyleAPI.friendlyError(err))}</td></tr>`;
      OSM.handleError(err);
    }
  }

  /* =========================================================
     4. INVENTARIO Y AJUSTE DE STOCK POR SKU (#/admin/inventario)
     ========================================================= */
  async function loadInventario() {
    const tbody = document.getElementById('admInventoryBody');
    if (!tbody) return;
    tbody.innerHTML = OSM.skeletonRows(6, 6);

    try {
      const res = await OneStyleAPI.admin.catalog.products({ page: 1, per_page: 50 });
      const items = (res && res.data && res.data.items) || [];
      const variants = [];
      items.forEach(p => {
        (p.variantes || []).forEach(v => {
          variants.push({
            ...v,
            nombre_producto: p.name || p.nombre,
            categoria: p.nombre_categoria || p.cat
          });
        });
      });

      if (!variants.length) {
        tbody.innerHTML = `<tr><td colspan="6">${OSM.emptyState('bi-boxes', 'Sin variantes registradas', 'Agrega variantes de talla y color desde la pestaña Catálogo.')}</td></tr>`;
        return;
      }

      variants.sort((a, b) => Number(a.stock_disponible ?? 0) - Number(b.stock_disponible ?? 0));

      tbody.innerHTML = variants.map(v => {
        const disp = Number(v.stock_disponible ?? v.stock ?? 0);
        const fis = Number(v.stock_fisico ?? v.stock ?? 0);
        const resv = Number(v.stock_reservado ?? 0);
        const badgeCls = disp === 0 ? 'osm-badge--low' : (disp <= 3 ? 'osm-badge--Registrado' : 'osm-badge--ok');
        return `
          <tr>
            <td class="t-strong">${OSM.esc(v.sku)}</td>
            <td>
              <div class="t-strong">${OSM.esc(v.nombre_producto)}</div>
              <div class="t-muted">${OSM.esc(v.color)} · Talla ${OSM.esc(v.talla)}</div>
            </td>
            <td class="t-strong">${OSM.money(v.precio)}</td>
            <td>${fis} físico <span class="t-muted">(${resv} reservado)</span></td>
            <td><span class="osm-badge ${badgeCls}">${disp} disponible</span></td>
            <td class="t-right">
              <div class="adm-stock-adjust justify-content-end">
                <input type="number" min="0" class="osm-input" value="${fis}" data-stock-input="${Number(v.id_variante)}" aria-label="Nuevo stock físico para ${OSM.esc(v.sku)}">
                <button type="button" class="osm-btn osm-btn--sm osm-btn--primary" data-stock-save="${Number(v.id_variante)}">
                  Guardar
                </button>
              </div>
            </td>
          </tr>`;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${OSM.emptyState('bi-exclamation-triangle', 'Error al cargar inventario', OneStyleAPI.friendlyError(err))}</td></tr>`;
      OSM.handleError(err);
    }
  }

  /* =========================================================
     4b. GESTIÓN DE ATRIBUTOS MAESTROS (#/admin/atributos)
     ========================================================= */
  async function loadAtributos() {
    await loadCatalogMetadata();

    const catsCount = document.getElementById('admCatsCount');
    const sizesCount = document.getElementById('admSizesCount');
    const colorsCount = document.getElementById('admColorsCount');

    if (catsCount) catsCount.textContent = String(state.categories.length);
    if (sizesCount) sizesCount.textContent = String((state.attributes.tallas || []).length);
    if (colorsCount) colorsCount.textContent = String((state.attributes.colores || []).length);

    const catsTbody = document.getElementById('admCatsTableBody');
    if (catsTbody) {
      if (!state.categories.length) {
        catsTbody.innerHTML = `<tr><td colspan="6">${OSM.emptyState('bi-folder-x', 'Sin categorías', 'Crea una categoría para organizar tus prendas.')}</td></tr>`;
      } else {
        catsTbody.innerHTML = state.categories.map(c => `
          <tr>
            <td>${Number(c.id_categoria)}</td>
            <td class="t-strong">${OSM.esc(c.nombre_categoria)}</td>
            <td><code>${OSM.esc(c.slug)}</code></td>
            <td class="t-muted">${OSM.esc(c.descripcion_categoria || '—')}</td>
            <td><span class="osm-badge osm-badge--ok">${c.activo !== false ? 'Activa' : 'Inactiva'}</span></td>
            <td class="t-right">
              <button type="button" class="osm-btn osm-btn--sm osm-btn--danger" data-adm-del-cat="${Number(c.id_categoria)}" data-adm-cat-name="${OSM.esc(c.nombre_categoria)}">
                <i class="bi bi-trash3"></i> Eliminar
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    const sizesTbody = document.getElementById('admSizesTableBody');
    if (sizesTbody) {
      const tallas = state.attributes.tallas || [];
      if (!tallas.length) {
        sizesTbody.innerHTML = `<tr><td colspan="4">${OSM.emptyState('bi-rulers', 'Sin tallas maestras', 'Agrega tallas como XS, S, M, L, XL, etc.')}</td></tr>`;
      } else {
        sizesTbody.innerHTML = tallas.map(t => `
          <tr>
            <td>${Number(t.id_talla)}</td>
            <td><span class="osm-badge osm-badge--gold fs-6">${OSM.esc(t.nombre_talla || t.codigo_talla)}</span></td>
            <td><span class="osm-badge osm-badge--ok">${t.activo !== false ? 'Activa' : 'Inactiva'}</span></td>
            <td class="t-right">
              <button type="button" class="osm-btn osm-btn--sm osm-btn--danger" data-adm-del-size="${Number(t.id_talla)}" data-adm-size-name="${OSM.esc(t.nombre_talla || t.codigo_talla)}">
                <i class="bi bi-trash3"></i> Eliminar
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    const colorsTbody = document.getElementById('admColorsTableBody');
    if (colorsTbody) {
      const colores = state.attributes.colores || [];
      if (!colores.length) {
        colorsTbody.innerHTML = `<tr><td colspan="6">${OSM.emptyState('bi-palette', 'Sin colores maestros', 'Agrega tonos y códigos de color.')}</td></tr>`;
      } else {
        colorsTbody.innerHTML = colores.map(c => `
          <tr>
            <td>${Number(c.id_color)}</td>
            <td><span class="adm-color-swatch" data-hex="${OSM.esc(c.codigo_hex || '#000000')}"></span></td>
            <td class="t-strong">${OSM.esc(c.nombre_color)}</td>
            <td><code>${OSM.esc(c.codigo_hex || '—')}</code></td>
            <td><span class="osm-badge osm-badge--ok">${c.activo !== false ? 'Activo' : 'Inactivo'}</span></td>
            <td class="t-right">
              <button type="button" class="osm-btn osm-btn--sm osm-btn--danger" data-adm-del-color="${Number(c.id_color)}" data-adm-color-name="${OSM.esc(c.nombre_color)}">
                <i class="bi bi-trash3"></i> Eliminar
              </button>
            </td>
          </tr>
        `).join('');
        // Aplicar el color de fondo dinámicamente mediante JS (estricto cumplimiento CSP ZAP)
        colorsTbody.querySelectorAll('.adm-color-swatch').forEach(swatch => {
          if (swatch.dataset.hex) {
            swatch.style.backgroundColor = swatch.dataset.hex;
          }
        });
      }
    }
  }

  /* =========================================================
     4c. GESTIÓN DEL APARTADO DE NOVEDADES (#/admin/novedades)
     ========================================================= */
  async function loadNovedades() {
    try {
      const [cfgRes, itemsRes, prodsRes] = await Promise.all([
        OneStyleAPI.admin.novedades.getConfig(),
        OneStyleAPI.admin.novedades.items(),
        OneStyleAPI.admin.catalog.products({ page: 1, per_page: 50 })
      ]);

      const cfg = (cfgRes && cfgRes.data) || {};
      const items = (itemsRes && itemsRes.data) || [];
      const prods = (prodsRes && prodsRes.data && prodsRes.data.items) || state.catalog.items || [];

      state.novedades.config = cfg;
      state.novedades.items = items;
      if (prods.length) state.catalog.items = prods;

      // 1. Rellenar formulario de configuración
      const form = document.getElementById('admNovedadesConfigForm');
      if (form) {
        if (form.elements.titulo) form.elements.titulo.value = cfg.titulo || '';
        if (form.elements.subtitulo) form.elements.subtitulo.value = cfg.subtitulo || '';
        if (form.elements.eyebrow) form.elements.eyebrow.value = cfg.eyebrow || '';
        if (form.elements.descripcion) form.elements.descripcion.value = cfg.descripcion || '';
        if (form.elements.boton_texto) form.elements.boton_texto.value = cfg.boton_texto || 'Ver Colección →';
      }

      // 2. Rellenar lista de checkboxes de prendas
      const checksWrap = document.getElementById('admNovProductsChecks');
      if (checksWrap) {
        const destSet = new Set((cfg.productos_destacados || []).map(String));
        if (!prods.length) {
          checksWrap.innerHTML = '<p class="text-muted small p-2 mb-0">No hay prendas registradas en el catálogo.</p>';
        } else {
          checksWrap.innerHTML = prods.map(p => {
            const pid = String(p.id_producto);
            const slug = String(p.slug_key || p.id || '');
            const isChecked = destSet.has(pid) || destSet.has(slug) || destSet.has(p.name);
            return `
              <label class="d-flex align-items-center gap-2 py-1 px-2 border-bottom">
                <input type="checkbox" name="nov_products" value="${OSM.esc(slug || pid)}" ${isChecked ? 'checked' : ''}>
                <span class="small t-strong">${OSM.esc(p.name || p.nombre)}</span>
                <span class="t-muted small ms-auto">${OSM.money(p.price || p.precio_base)}</span>
              </label>
            `;
          }).join('');
        }
      }

      // 3. Rellenar tabla de cápsulas de novedades
      const tbody = document.getElementById('admNovItemsTableBody');
      const countEl = document.getElementById('admNovItemsCount');
      if (countEl) countEl.textContent = `${items.length} cápsulas`;

      if (tbody) {
        if (!items.length) {
          tbody.innerHTML = `<tr><td colspan="5">${OSM.emptyState('bi-stars', 'Sin cápsulas registradas', 'Crea una cápsula o anuncio destacado para la sección de novedades.')}</td></tr>`;
        } else {
          tbody.innerHTML = items.map(it => `
            <tr>
              <td>
                <div class="t-strong">${OSM.esc(it.titulo)}</div>
                <div class="t-muted small">${OSM.esc(it.descripcion || '—')}</div>
              </td>
              <td><span class="osm-badge osm-badge--gold">${OSM.esc(it.tag || 'Nuevo')}</span></td>
              <td class="small">${OSM.esc(it.producto_id || 'Ninguna')}</td>
              <td><span class="osm-badge ${it.activo !== false ? 'osm-badge--ok' : 'osm-badge--low'}">${it.activo !== false ? 'Activa' : 'Inactiva'}</span></td>
              <td class="t-right">
                <div class="adm-actions justify-content-end">
                  <button type="button" class="osm-btn osm-btn--sm" data-adm-edit-nov-item="${Number(it.id)}">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button type="button" class="osm-btn osm-btn--sm osm-btn--danger" data-adm-del-nov-item="${Number(it.id)}" data-adm-nov-title="${OSM.esc(it.titulo)}">
                    <i class="bi bi-trash3"></i>
                  </button>
                </div>
              </td>
            </tr>
          `).join('');
        }
      }

      // 4. Llenar select de productos en modal de cápsula
      const modalProdSel = document.getElementById('admNovItemProduct');
      if (modalProdSel) {
        modalProdSel.innerHTML = '<option value="">(Opcional) Ninguna</option>' +
          prods.map(p => `<option value="${OSM.esc(p.slug_key || p.id_producto)}">${OSM.esc(p.name || p.nombre)}</option>`).join('');
      }
    } catch (err) {
      OSM.handleError(err, 'No se pudo cargar el módulo de novedades');
    }
  }

  /* =========================================================
     5. PERFIL DE LA ADMINISTRADORA Y CAMBIO DE CONTRASEÑA
     ========================================================= */
  async function loadPerfil() {
    try {
      const res = await OneStyleAPI.auth.getProfile();
      const u = (res && res.data) || OneStyleAPI.getSavedUser() || {};
      const form = document.getElementById('admProfileForm');
      if (form) {
        form.elements.nombre.value = u.nombre || '';
        form.elements.apellido.value = u.apellido || '';
        form.elements.email.value = u.email || '';
        form.elements.telefono.value = u.telefono || '';
      }
      updateSidebarIdentity();
    } catch (err) {
      OSM.handleError(err);
    }
  }

  /* =========================================================
     6. EVENTOS Y NAVEGACIÓN INTERNA DEL PANEL
     ========================================================= */
  function bindEvents() {
    if (state.initialized) return;
    state.initialized = true;

    const drawerEl = document.getElementById('admOrderDrawer');
    if (drawerEl) orderDrawer = new bootstrap.Offcanvas(drawerEl);

    const prodModalEl = document.getElementById('admProductModal');
    if (prodModalEl) productModal = new bootstrap.Modal(prodModalEl);

    const varModalEl = document.getElementById('admVariantModal');
    if (varModalEl) variantModal = new bootstrap.Modal(varModalEl);

    const catModalEl = document.getElementById('admCategoryModal');
    if (catModalEl) categoryModal = new bootstrap.Modal(catModalEl);

    const sizeModalEl = document.getElementById('admSizeModal');
    if (sizeModalEl) sizeModal = new bootstrap.Modal(sizeModalEl);

    const colorModalEl = document.getElementById('admColorModal');
    if (colorModalEl) colorModal = new bootstrap.Modal(colorModalEl);

    const novItemModalEl = document.getElementById('admNovedadItemModal');
    if (novItemModalEl) novItemModal = new bootstrap.Modal(novItemModalEl);

    // Filtros y búsqueda con debounce en Pedidos
    const orderSearch = document.getElementById('admOrderSearch');
    if (orderSearch) {
      orderSearch.addEventListener('input', OSM.debounce(() => {
        state.orders.q = OSM.clean(orderSearch.value);
        state.orders.page = 1;
        loadPedidos();
      }, 300));
    }

    const orderStateSel = document.getElementById('admOrderStateFilter');
    if (orderStateSel) {
      orderStateSel.addEventListener('change', () => {
        state.orders.estado = orderStateSel.value;
        state.orders.page = 1;
        loadPedidos();
      });
    }

    const ordPrev = document.getElementById('admOrdersPrev');
    const ordNext = document.getElementById('admOrdersNext');
    if (ordPrev) ordPrev.addEventListener('click', () => { if (state.orders.page > 1) { state.orders.page--; loadPedidos(); } });
    if (ordNext) ordNext.addEventListener('click', () => { state.orders.page++; loadPedidos(); });

    // Filtros y búsqueda en Catálogo
    const catSearch = document.getElementById('admCatSearch');
    if (catSearch) {
      catSearch.addEventListener('input', OSM.debounce(() => {
        state.catalog.q = OSM.clean(catSearch.value);
        state.catalog.page = 1;
        loadCatalogo();
      }, 300));
    }

    const catFilterCat = document.getElementById('admCatFilterCat');
    if (catFilterCat) {
      catFilterCat.addEventListener('change', () => {
        state.catalog.categoria = catFilterCat.value;
        state.catalog.page = 1;
        loadCatalogo();
      });
    }

    const catFilterState = document.getElementById('admCatFilterState');
    if (catFilterState) {
      catFilterState.addEventListener('change', () => {
        state.catalog.estado = catFilterState.value;
        state.catalog.page = 1;
        loadCatalogo();
      });
    }

    const catPrev = document.getElementById('admCatalogPrev');
    const catNext = document.getElementById('admCatalogNext');
    if (catPrev) catPrev.addEventListener('click', () => { if (state.catalog.page > 1) { state.catalog.page--; loadCatalogo(); } });
    if (catNext) catNext.addEventListener('click', () => { state.catalog.page++; loadCatalogo(); });

    // Delegación en contenedor Admin
    const adminView = document.getElementById('view-admin');
    if (adminView) {
      adminView.addEventListener('click', async e => {
        const openOrdBtn = e.target.closest('[data-adm-open-order]');
        if (openOrdBtn) {
          openOrderDetail(Number(openOrdBtn.dataset.admOpenOrder));
          return;
        }

        const newProdBtn = e.target.closest('#admOpenNewProductBtn');
        if (newProdBtn && productModal) {
          const f = document.getElementById('admProductForm');
          if (f) f.reset();
          productModal.show();
          return;
        }

        const openCatBtn = e.target.closest('#admPanelNewCatBtn, #admProdQuickCatBtn');
        if (openCatBtn && categoryModal) {
          const f = document.getElementById('admCatModalForm');
          if (f) f.reset();
          categoryModal.show();
          return;
        }

        const openSizeBtn = e.target.closest('#admPanelNewSizeBtn, #admProdQuickSizeBtn, #admVarQuickSizeBtn');
        if (openSizeBtn && sizeModal) {
          const f = document.getElementById('admSizeModalForm');
          if (f) f.reset();
          sizeModal.show();
          return;
        }

        const openColorBtn = e.target.closest('#admPanelNewColorBtn, #admProdQuickColorBtn, #admVarQuickColorBtn');
        if (openColorBtn && colorModal) {
          const f = document.getElementById('admColorModalForm');
          if (f) f.reset();
          colorModal.show();
          return;
        }

        const openNovItemBtn = e.target.closest('#admOpenNovItemModalBtn');
        if (openNovItemBtn && novItemModal) {
          const f = document.getElementById('admNovItemForm');
          if (f) f.reset();
          const titleEl = document.getElementById('admNovItemModalTitle');
          if (titleEl) titleEl.innerHTML = '<i class="bi bi-stars me-1"></i> Nueva Cápsula de Novedad';
          const idEl = document.getElementById('admNovItemId');
          if (idEl) idEl.value = '';
          novItemModal.show();
          return;
        }

        const editNovItemBtn = e.target.closest('[data-adm-edit-nov-item]');
        if (editNovItemBtn && novItemModal) {
          const id = Number(editNovItemBtn.dataset.admEditNovItem);
          const item = (state.novedades.items || []).find(it => Number(it.id) === id);
          if (item) {
            const f = document.getElementById('admNovItemForm');
            if (f) {
              f.reset();
              f.elements.id.value = item.id;
              f.elements.titulo.value = item.titulo || '';
              f.elements.tag.value = item.tag || '';
              f.elements.descripcion.value = item.descripcion || '';
              f.elements.imagen_url.value = item.imagen_url || '';
              if (f.elements.producto_id) f.elements.producto_id.value = item.producto_id || '';
            }
            const titleEl = document.getElementById('admNovItemModalTitle');
            if (titleEl) titleEl.innerHTML = '<i class="bi bi-pencil-square me-1"></i> Editar Cápsula de Novedad';
            novItemModal.show();
          }
          return;
        }

        const delNovItemBtn = e.target.closest('[data-adm-del-nov-item]');
        if (delNovItemBtn) {
          const id = Number(delNovItemBtn.dataset.admDelNovItem);
          const title = delNovItemBtn.dataset.admNovTitle || `Cápsula #${id}`;
          const ok = await OSM.confirm(`¿Confirmas la eliminación de la cápsula "${title}"?`, {
            title: 'Eliminar Cápsula de Novedad', confirmText: 'Sí, eliminar', danger: true
          });
          if (!ok) return;
          await OSM.run(delNovItemBtn, async () => {
            try {
              const res = await OneStyleAPI.admin.novedades.deleteItem(id);
              OSM.toast.success(res.message || 'Cápsula eliminada correctamente.');
              await loadNovedades();
              if (typeof window.syncNovedadesFromBackend === 'function') window.syncNovedadesFromBackend();
            } catch (err) {
              OSM.handleError(err, 'No se pudo eliminar la cápsula');
            }
          });
          return;
        }

        const delCatBtn = e.target.closest('[data-adm-del-cat]');
        if (delCatBtn) {
          const id = Number(delCatBtn.dataset.admDelCat);
          const name = delCatBtn.dataset.admCatName || `Categoría #${id}`;
          const ok = await OSM.confirm(`¿Confirmas la eliminación de la categoría "${name}"?`, {
            title: 'Eliminar Categoría', confirmText: 'Sí, eliminar', danger: true
          });
          if (!ok) return;
          await OSM.run(delCatBtn, async () => {
            try {
              const res = await OneStyleAPI.admin.catalog.deleteCategory(id);
              OSM.toast.success(res.message || 'Categoría eliminada.');
              await loadCatalogMetadata();
              if (state.activePanel === 'atributos') await loadAtributos();
              if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
            } catch (err) {
              OSM.handleError(err, 'No se pudo eliminar la categoría');
            }
          });
          return;
        }

        const delSizeBtn = e.target.closest('[data-adm-del-size]');
        if (delSizeBtn) {
          const id = Number(delSizeBtn.dataset.admDelSize);
          const name = delSizeBtn.dataset.admSizeName || `Talla #${id}`;
          const ok = await OSM.confirm(`¿Confirmas la eliminación de la talla "${name}"?`, {
            title: 'Eliminar Talla', confirmText: 'Sí, eliminar', danger: true
          });
          if (!ok) return;
          await OSM.run(delSizeBtn, async () => {
            try {
              const res = await OneStyleAPI.admin.catalog.deleteSize(id);
              OSM.toast.success(res.message || 'Talla eliminada.');
              await loadCatalogMetadata();
              if (state.activePanel === 'atributos') await loadAtributos();
              if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
            } catch (err) {
              OSM.handleError(err, 'No se pudo eliminar la talla');
            }
          });
          return;
        }

        const delColorBtn = e.target.closest('[data-adm-del-color]');
        if (delColorBtn) {
          const id = Number(delColorBtn.dataset.admDelColor);
          const name = delColorBtn.dataset.admColorName || `Color #${id}`;
          const ok = await OSM.confirm(`¿Confirmas la eliminación del color "${name}"?`, {
            title: 'Eliminar Color', confirmText: 'Sí, eliminar', danger: true
          });
          if (!ok) return;
          await OSM.run(delColorBtn, async () => {
            try {
              const res = await OneStyleAPI.admin.catalog.deleteColor(id);
              OSM.toast.success(res.message || 'Color eliminado.');
              await loadCatalogMetadata();
              if (state.activePanel === 'atributos') await loadAtributos();
              if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
            } catch (err) {
              OSM.handleError(err, 'No se pudo eliminar el color');
            }
          });
          return;
        }

        const attrTabBtn = e.target.closest('.adm-tab[data-attr-tab]');
        if (attrTabBtn) {
          const tab = attrTabBtn.dataset.attrTab;
          document.querySelectorAll('.adm-tab[data-attr-tab]').forEach(b => b.classList.toggle('active', b === attrTabBtn));
          const tabCats = document.getElementById('admAttrTabCats');
          const tabSizes = document.getElementById('admAttrTabSizes');
          const tabColors = document.getElementById('admAttrTabColors');
          if (tabCats) tabCats.classList.toggle('d-none', tab !== 'cats');
          if (tabSizes) tabSizes.classList.toggle('d-none', tab !== 'sizes');
          if (tabColors) tabColors.classList.toggle('d-none', tab !== 'colors');
          return;
        }

        const addVarBtn = e.target.closest('[data-adm-add-var]');
        if (addVarBtn && variantModal) {
          const pid = Number(addVarBtn.dataset.admAddVar);
          state.selectedProductForVariant = state.catalog.items.find(p => Number(p.id_producto) === pid) || { id_producto: pid };
          const titleEl = document.getElementById('admVarProductName');
          if (titleEl) titleEl.textContent = state.selectedProductForVariant.name || `Producto #${pid}`;
          const f = document.getElementById('admVariantForm');
          if (f) f.reset();
          variantModal.show();
          return;
        }

        const stockBtn = e.target.closest('[data-stock-save]');
        if (stockBtn) {
          const vid = Number(stockBtn.dataset.stockSave);
          const input = adminView.querySelector(`[data-stock-input="${vid}"]`);
          const nuevoStock = Number(input ? input.value : -1);
          if (!Number.isInteger(nuevoStock) || nuevoStock < 0) {
            OSM.toast.warning('Ingresa una cantidad entera mayor o igual a 0.');
            return;
          }
          await OSM.run(stockBtn, async () => {
            try {
              const res = await OneStyleAPI.admin.catalog.adjustStock(vid, { stock_fisico: nuevoStock });
              OSM.toast.success(res.message || 'Stock actualizado correctamente.');
              await loadInventario();
              await loadResumen();
              if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
            } catch (err) {
              OSM.handleError(err, 'No se pudo ajustar el stock');
            }
          }, '...');
        }
      });

      adminView.addEventListener('change', async e => {
        const visInput = e.target.closest('[data-adm-vis]');
        if (!visInput) return;
        const pid = Number(visInput.dataset.admVis);
        const visible = visInput.checked;
        visInput.disabled = true;
        try {
          const res = await OneStyleAPI.admin.catalog.setVisibility(pid, visible);
          OSM.toast.success(res.message || 'Visibilidad actualizada.');
          await loadCatalogo();
          if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
        } catch (err) {
          visInput.checked = !visible;
          OSM.handleError(err, 'Error al cambiar visibilidad');
        } finally {
          visInput.disabled = false;
        }
      });
    }

    // Botones de transición dentro del Drawer de Pedido
    const drawerFoot = document.getElementById('admDrawerOrderFoot');
    if (drawerFoot) {
      drawerFoot.addEventListener('click', e => {
        const fsmBtn = e.target.closest('[data-adm-fsm]');
        if (!fsmBtn) return;
        executeOrderTransition(fsmBtn, fsmBtn.dataset.admFsm);
      });
    }

    // Formulario de Creación de Prenda + Primera Variante
    const prodForm = document.getElementById('admProductForm');
    if (prodForm) {
      const prodSchema = {
        nombre: [OSM.rules.required('Ingresa el nombre de la prenda.'), OSM.rules.minLength(3)],
        descripcion: [OSM.rules.required('Ingresa una descripción breve.')],
        precio_base: [OSM.rules.positiveNumber('Ingresa un precio base mayor a 0.')],
        sku_inicial: [OSM.rules.required('Ingresa el SKU inicial.')],
        stock_inicial: [OSM.rules.integerMin(0, 'Ingresa un stock inicial válido (0 o más).')]
      };
      OSM.liveValidate(prodForm, prodSchema);

      prodForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!OSM.validate(prodForm, prodSchema)) return;
        const btn = document.getElementById('admSaveProductBtn');
        await OSM.run(btn, async () => {
          try {
            const payload = {
              nombre: OSM.clean(prodForm.elements.nombre.value),
              descripcion: OSM.clean(prodForm.elements.descripcion.value),
              precio_base: Number(prodForm.elements.precio_base.value),
              fk_id_categoria: Number(prodForm.elements.fk_id_categoria.value || 1),
              imagen_url: OSM.clean(prodForm.elements.imagen_url.value) || null,
              variantes: [
                {
                  sku: OSM.clean(prodForm.elements.sku_inicial.value).toUpperCase(),
                  fk_id_talla: Number(prodForm.elements.fk_id_talla.value || 2),
                  fk_id_color: Number(prodForm.elements.fk_id_color.value || 1),
                  stock_fisico: Number(prodForm.elements.stock_inicial.value || 0),
                  precio_variante: Number(prodForm.elements.precio_base.value)
                }
              ]
            };
            const res = await OneStyleAPI.admin.catalog.createProduct(payload);
            OSM.toast.success(res.message || 'Prenda creada exitosamente.');
            if (productModal) productModal.hide();
            await loadCatalogo();
            await loadResumen();
            if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
          } catch (err) {
            OSM.handleError(err, 'No se pudo registrar la prenda');
          }
        }, 'Guardando...');
      });
    }

    // Formulario para añadir variante SKU
    const varForm = document.getElementById('admVariantForm');
    if (varForm) {
      const varSchema = {
        sku: [OSM.rules.required('Ingresa el código SKU.')],
        precio_variante: [OSM.rules.positiveNumber('El precio debe ser mayor a 0.')],
        stock_fisico: [OSM.rules.integerMin(0, 'Ingresa un stock entero mayor o igual a 0.')]
      };
      OSM.liveValidate(varForm, varSchema);

      varForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!state.selectedProductForVariant) return;
        if (!OSM.validate(varForm, varSchema)) return;
        const btn = document.getElementById('admSaveVariantBtn');
        await OSM.run(btn, async () => {
          try {
            const res = await OneStyleAPI.admin.catalog.addVariant(state.selectedProductForVariant.id_producto, {
              sku: OSM.clean(varForm.elements.sku.value).toUpperCase(),
              fk_id_talla: Number(varForm.elements.fk_id_talla.value),
              fk_id_color: Number(varForm.elements.fk_id_color.value),
              precio_variante: Number(varForm.elements.precio_variante.value),
              stock_fisico: Number(varForm.elements.stock_fisico.value)
            });
            OSM.toast.success(res.message || 'Variante SKU agregada.');
            if (variantModal) variantModal.hide();
            await loadCatalogo();
            await loadInventario();
            if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
          } catch (err) {
            OSM.handleError(err, 'No se pudo crear la variante');
          }
        }, 'Guardando...');
      });
    }

    // Formulario de Perfil de la Administradora
    const profForm = document.getElementById('admProfileForm');
    if (profForm) {
      const profSchema = {
        nombre: [OSM.rules.required('El nombre es obligatorio.'), OSM.rules.minLength(2)],
        apellido: [OSM.rules.required('El apellido es obligatorio.'), OSM.rules.minLength(2)],
        email: [OSM.rules.required('El correo es obligatorio.'), OSM.rules.email()],
        telefono: [OSM.rules.phone()]
      };
      OSM.liveValidate(profForm, profSchema);

      profForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!OSM.validate(profForm, profSchema)) return;
        const btn = document.getElementById('admSaveProfileBtn');
        await OSM.run(btn, async () => {
          try {
            const res = await OneStyleAPI.auth.updateProfile({
              nombre: OSM.clean(profForm.elements.nombre.value),
              apellido: OSM.clean(profForm.elements.apellido.value),
              email: OSM.clean(profForm.elements.email.value),
              telefono: OSM.clean(profForm.elements.telefono.value)
            });
            OneStyleAPI.setSession(OneStyleAPI.getToken(), res.data);
            if (typeof window.syncCurrentUserFromStorage === 'function') {
              window.syncCurrentUserFromStorage();
            }
            updateSidebarIdentity();
            OSM.toast.success(res.message || 'Perfil actualizado.');
          } catch (err) {
            OSM.handleError(err, 'No se pudo actualizar el perfil');
          }
        }, 'Guardando...');
      });
    }

    // Formulario de Cambio de Contraseña Autenticado
    const pwdForm = document.getElementById('admPasswordForm');
    if (pwdForm) {
      const pwdSchema = {
        contrasena_actual: [OSM.rules.required('Ingresa tu contraseña actual.')],
        nueva_password: [OSM.rules.required('Ingresa la nueva contraseña.'), OSM.rules.minLength(8, 'Mínimo 8 caracteres (RN-SEG-008).')],
        confirmar_password: [
          OSM.rules.required('Confirma la nueva contraseña.'),
          OSM.rules.match(() => pwdForm.elements.nueva_password.value, 'Las contraseñas no coinciden.')
        ]
      };
      OSM.liveValidate(pwdForm, pwdSchema);

      pwdForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!OSM.validate(pwdForm, pwdSchema)) return;
        const btn = document.getElementById('admSavePasswordBtn');
        await OSM.run(btn, async () => {
          try {
            const res = await OneStyleAPI.auth.changePassword({
              contrasena_actual: pwdForm.elements.contrasena_actual.value,
              nueva_password: pwdForm.elements.nueva_password.value
            });
            pwdForm.reset();
            OSM.toast.success(res.message || 'Contraseña actualizada exitosamente.');
          } catch (err) {
            OSM.handleError(err, 'Error al cambiar contraseña');
          }
        }, 'Actualizando...');
      });
    }
    // Sincronización entre input de color nativo y campo de texto hexadecimal
    function syncColorInputs(pickerId, hexId) {
      const picker = document.getElementById(pickerId);
      const text = document.getElementById(hexId);
      if (!picker || !text) return;
      picker.addEventListener('input', () => { text.value = picker.value.toUpperCase(); });
      text.addEventListener('input', () => {
        if (/^#[0-9A-Fa-f]{6}$/.test(text.value)) {
          picker.value = text.value;
        }
      });
    }
    syncColorInputs('admQuickColorPicker', 'admQuickColorHex');
    syncColorInputs('admModalColorPicker', 'admModalColorHex');

    // Manejador genérico de Categorías
    async function submitCategory(form, modal) {
      const catSchema = {
        nombre_categoria: [OSM.rules.required('Ingresa el nombre de la categoría.'), OSM.rules.minLength(2)]
      };
      if (!OSM.validate(form, catSchema)) return;
      const btn = form.querySelector('button[type="submit"]');
      await OSM.run(btn, async () => {
        try {
          const payload = {
            nombre_categoria: OSM.clean(form.elements.nombre_categoria.value),
            descripcion_categoria: OSM.clean(form.elements.descripcion_categoria.value)
          };
          const res = await OneStyleAPI.admin.catalog.createCategory(payload);
          OSM.toast.success(res.message || 'Categoría creada exitosamente.');
          form.reset();
          if (modal) modal.hide();
          await loadCatalogMetadata();
          if (res.data && res.data.id_categoria) {
            const prodCatSel = document.getElementById('admProdCategoria');
            if (prodCatSel) prodCatSel.value = String(res.data.id_categoria);
          }
          if (state.activePanel === 'atributos') await loadAtributos();
          if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
        } catch (err) {
          OSM.handleError(err, 'No se pudo crear la categoría');
        }
      }, 'Guardando...');
    }

    const quickCatForm = document.getElementById('admQuickCatForm');
    if (quickCatForm) {
      OSM.liveValidate(quickCatForm, { nombre_categoria: [OSM.rules.required('Ingresa el nombre de la categoría.'), OSM.rules.minLength(2)] });
      quickCatForm.addEventListener('submit', e => { e.preventDefault(); submitCategory(quickCatForm, null); });
    }
    const catModalForm = document.getElementById('admCatModalForm');
    if (catModalForm) {
      OSM.liveValidate(catModalForm, { nombre_categoria: [OSM.rules.required('Ingresa el nombre de la categoría.'), OSM.rules.minLength(2)] });
      catModalForm.addEventListener('submit', e => { e.preventDefault(); submitCategory(catModalForm, categoryModal); });
    }

    // Manejador genérico de Tallas
    async function submitSize(form, modal) {
      const sizeSchema = {
        nombre_talla: [OSM.rules.required('Ingresa la nomenclatura de la talla.')]
      };
      if (!OSM.validate(form, sizeSchema)) return;
      const btn = form.querySelector('button[type="submit"]');
      await OSM.run(btn, async () => {
        try {
          const payload = {
            nombre_talla: OSM.clean(form.elements.nombre_talla.value)
          };
          const res = await OneStyleAPI.admin.catalog.createSize(payload);
          OSM.toast.success(res.message || 'Talla registrada exitosamente.');
          form.reset();
          if (modal) modal.hide();
          await loadCatalogMetadata();
          if (res.data && res.data.id_talla) {
            const prodTalla = document.getElementById('admProdTalla');
            const varTalla = document.getElementById('admVarTalla');
            if (prodTalla) prodTalla.value = String(res.data.id_talla);
            if (varTalla) varTalla.value = String(res.data.id_talla);
          }
          if (state.activePanel === 'atributos') await loadAtributos();
          if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
        } catch (err) {
          OSM.handleError(err, 'No se pudo registrar la talla');
        }
      }, 'Guardando...');
    }

    const quickSizeForm = document.getElementById('admQuickSizeForm');
    if (quickSizeForm) {
      OSM.liveValidate(quickSizeForm, { nombre_talla: [OSM.rules.required('Ingresa la nomenclatura de la talla.')] });
      quickSizeForm.addEventListener('submit', e => { e.preventDefault(); submitSize(quickSizeForm, null); });
    }
    const sizeModalForm = document.getElementById('admSizeModalForm');
    if (sizeModalForm) {
      OSM.liveValidate(sizeModalForm, { nombre_talla: [OSM.rules.required('Ingresa la nomenclatura de la talla.')] });
      sizeModalForm.addEventListener('submit', e => { e.preventDefault(); submitSize(sizeModalForm, sizeModal); });
    }

    // Manejador genérico de Colores
    async function submitColor(form, modal) {
      const colorSchema = {
        nombre_color: [OSM.rules.required('Ingresa el nombre del color.'), OSM.rules.minLength(2)],
        codigo_hex: [OSM.rules.required('Ingresa el código hexadecimal.')]
      };
      if (!OSM.validate(form, colorSchema)) return;
      const btn = form.querySelector('button[type="submit"]');
      await OSM.run(btn, async () => {
        try {
          const payload = {
            nombre_color: OSM.clean(form.elements.nombre_color.value),
            codigo_hex: OSM.clean(form.elements.codigo_hex.value)
          };
          const res = await OneStyleAPI.admin.catalog.createColor(payload);
          OSM.toast.success(res.message || 'Color registrado exitosamente.');
          form.reset();
          if (modal) modal.hide();
          await loadCatalogMetadata();
          if (res.data && res.data.id_color) {
            const prodColor = document.getElementById('admProdColor');
            const varColor = document.getElementById('admVarColor');
            if (prodColor) prodColor.value = String(res.data.id_color);
            if (varColor) varColor.value = String(res.data.id_color);
          }
          if (state.activePanel === 'atributos') await loadAtributos();
          if (typeof window.syncCatalogFromBackend === 'function') window.syncCatalogFromBackend();
        } catch (err) {
          OSM.handleError(err, 'No se pudo registrar el color');
        }
      }, 'Guardando...');
    }

    const quickColorForm = document.getElementById('admQuickColorForm');
    if (quickColorForm) {
      OSM.liveValidate(quickColorForm, { nombre_color: [OSM.rules.required('Ingresa el nombre del color.')] });
      quickColorForm.addEventListener('submit', e => { e.preventDefault(); submitColor(quickColorForm, null); });
    }
    const colorModalForm = document.getElementById('admColorModalForm');
    if (colorModalForm) {
      OSM.liveValidate(colorModalForm, { nombre_color: [OSM.rules.required('Ingresa el nombre del color.')] });
      colorModalForm.addEventListener('submit', e => { e.preventDefault(); submitColor(colorModalForm, colorModal); });
    }

    // Formulario de Configuración Editorial de Novedades
    const novConfigForm = document.getElementById('admNovedadesConfigForm');
    if (novConfigForm) {
      const novSchema = {
        titulo: [OSM.rules.required('El título principal es obligatorio.'), OSM.rules.minLength(3)]
      };
      OSM.liveValidate(novConfigForm, novSchema);
      novConfigForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!OSM.validate(novConfigForm, novSchema)) return;
        const btn = document.getElementById('admSaveNovConfigBtn');
        await OSM.run(btn, async () => {
          try {
            const checkedProds = Array.from(novConfigForm.querySelectorAll('input[name="nov_products"]:checked')).map(cb => cb.value);
            const payload = {
              titulo: OSM.clean(novConfigForm.elements.titulo.value),
              subtitulo: OSM.clean(novConfigForm.elements.subtitulo.value),
              eyebrow: OSM.clean(novConfigForm.elements.eyebrow.value),
              descripcion: OSM.clean(novConfigForm.elements.descripcion.value),
              boton_texto: OSM.clean(novConfigForm.elements.boton_texto.value),
              productos_destacados: checkedProds
            };
            const res = await OneStyleAPI.admin.novedades.updateConfig(payload);
            OSM.toast.success(res.message || 'Configuración de novedades actualizada.');
            await loadNovedades();
            if (typeof window.syncNovedadesFromBackend === 'function') window.syncNovedadesFromBackend();
          } catch (err) {
            OSM.handleError(err, 'No se pudo guardar la configuración de novedades');
          }
        }, 'Guardando...');
      });
    }

    // Formulario de Cápsula / Anuncio de Novedad
    const novItemForm = document.getElementById('admNovItemForm');
    if (novItemForm) {
      const itemSchema = {
        titulo: [OSM.rules.required('El título de la cápsula es obligatorio.'), OSM.rules.minLength(3)]
      };
      OSM.liveValidate(novItemForm, itemSchema);
      novItemForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!OSM.validate(novItemForm, itemSchema)) return;
        const btn = document.getElementById('admSaveNovItemBtn');
        await OSM.run(btn, async () => {
          try {
            const idVal = novItemForm.elements.id.value;
            const payload = {
              titulo: OSM.clean(novItemForm.elements.titulo.value),
              tag: OSM.clean(novItemForm.elements.tag.value) || 'Nuevo',
              descripcion: OSM.clean(novItemForm.elements.descripcion.value),
              imagen_url: OSM.clean(novItemForm.elements.imagen_url.value) || 'img/corset-canela.jpg',
              producto_id: OSM.clean(novItemForm.elements.producto_id.value) || null
            };
            if (idVal) {
              const res = await OneStyleAPI.admin.novedades.updateItem(Number(idVal), payload);
              OSM.toast.success(res.message || 'Cápsula de novedad actualizada.');
            } else {
              const res = await OneStyleAPI.admin.novedades.createItem(payload);
              OSM.toast.success(res.message || 'Cápsula de novedad creada.');
            }
            if (novItemModal) novItemModal.hide();
            await loadNovedades();
            if (typeof window.syncNovedadesFromBackend === 'function') window.syncNovedadesFromBackend();
          } catch (err) {
            OSM.handleError(err, 'No se pudo guardar la cápsula');
          }
        }, 'Guardando...');
      });
    }
  }

  /* =========================================================
     7. APERTURA DE SUBPANELES (#/admin, #/admin/pedidos, etc.)
     ========================================================= */
  async function open(panelName = 'resumen') {
    bindEvents();
    updateSidebarIdentity();

    const target = PANELS.includes(panelName) ? panelName : 'resumen';
    state.activePanel = target;

    document.querySelectorAll('#view-admin .adm-panel').forEach(p => {
      p.classList.toggle('active', p.id === `adm-panel-${target}`);
    });
    document.querySelectorAll('#admSidebarNav a[data-adm-nav]').forEach(a => {
      a.classList.toggle('active', a.dataset.admNav === target);
    });

    if (!state.categories.length) {
      await loadCatalogMetadata();
    }

    if (target === 'resumen') await loadResumen();
    if (target === 'pedidos') await loadPedidos();
    if (target === 'catalogo') await loadCatalogo();
    if (target === 'inventario') await loadInventario();
    if (target === 'atributos') await loadAtributos();
    if (target === 'novedades') await loadNovedades();
    if (target === 'perfil') await loadPerfil();
  }

  OSM.admin = { open, reload: () => open(state.activePanel) };
})();
