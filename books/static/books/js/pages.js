'use strict';

const PAGE = { reload: null };

function listPage(root, cfg) {
  const st = { q: '', page: 1, size: 10, ordering: cfg.ordering || '', f: {} };
  let cache = {};
  root.innerHTML = `<div class="bc">Home / ${esc(cfg.bc)}</div><div class="hd"><h1>${esc(cfg.title)}</h1><div class="act"><button class="btn" data-x="csv" type="button">Export CSV</button>${cfg.onNew ? `<button class="btn p" data-x="new" type="button">+ ${esc(cfg.newLabel)}</button>` : ''}</div></div>${cfg.note ? `<div class="note">${cfg.note}</div>` : ''}
<div class="card" style="margin-top:14px"><div class="tb"><input class="in" type="search" id="tq" placeholder="Search ${esc(cfg.title.toLowerCase())}" aria-label="Search" style="max-width:300px">${(cfg.filters || []).map(f => `<select class="btn" data-f="${f.name}" aria-label="${esc(f.label)}">${opts(f.opts, '')}</select>`).join('')}<span class="sub" id="cnt"></span></div><div class="tw" id="lt">${spinner}</div><div class="pager" id="pgr"></div></div>`;
  const params = () => ({ ...(cfg.params || {}), ...st.f, q: st.q, ordering: st.ordering });
  async function load() {
    PAGE.reload = load;
    $('#lt', root).innerHTML = spinner;
    try {
      const p = await api(cfg.api + '/?' + qs({ ...params(), page: st.page, page_size: st.size }));
      if (!root.isConnected) return;
      if (p.page !== st.page) st.page = p.page;
      cache = Object.fromEntries(p.results.map(r => [String(r.id), r]));
      const sortMark = c => c.s ? (st.ordering === c.s ? ' ▲' : st.ordering === '-' + c.s ? ' ▼' : '') : '';
      const empty = !p.count ? (st.q || Object.values(st.f).some(Boolean) ? 'No matching records.' : esc(cfg.empty || 'No records yet.')) : '';
      $('#lt', root).innerHTML = `<table><thead><tr>${cfg.cols.map(c => `<th ${c.s ? `data-s="${c.s}" tabindex="0" aria-sort="${st.ordering === c.s ? 'ascending' : st.ordering === '-' + c.s ? 'descending' : 'none'}"` : ''} class="${c.r ? 'r' : ''}">${esc(c.h)}${sortMark(c)}</th>`).join('')}${cfg.actions ? '<th></th>' : ''}</tr></thead><tbody>${p.results.map(r => `<tr>${cfg.cols.map(c => `<td class="${c.r ? 'r' : ''}">${c.f(r)}</td>`).join('')}${cfg.actions ? `<td class="rowa">${cfg.actions(r).map(([a, l, k]) => `<button type="button" class="${k || ''}" data-act="${a}" data-id="${r.id}">${esc(l)}</button>`).join('')}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${cfg.cols.length + 1}"><div class="empty">${empty}${!p.count && !st.q && cfg.onNew ? `<br><button class="btn p" data-x="new" type="button" style="margin-top:8px">+ ${esc(cfg.newLabel)}</button>` : ''}</div></td></tr>`}</tbody></table>`;
      $('#cnt', root).textContent = p.count + (p.count === 1 ? ' record' : ' records');
      $('#pgr', root).innerHTML = `<span class="sub">Page ${p.page} of ${p.pages}</span><span class="act"><select class="btn" data-size aria-label="Rows per page">${opts([10, 25, 50, 100].map(n => [n, n + ' / page']), st.size)}</select><button class="btn" data-x="pv" type="button" ${p.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn" data-x="nx" type="button" ${p.page >= p.pages ? 'disabled' : ''}>Next</button></span>`;
    } catch (e) { if (root.isConnected) $('#lt', root).innerHTML = errBox(e.message, true); }
  }
  let t;
  $('#tq', root).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; load(); }, 250); });
  root.addEventListener('change', e => {
    if (e.target.dataset.f) { st.f[e.target.dataset.f] = e.target.value; st.page = 1; load(); }
    if (e.target.hasAttribute('data-size')) { st.size = Number(e.target.value); st.page = 1; load(); }
  });
  const sortBy = th => { const k = th.dataset.s; st.ordering = st.ordering === k ? '-' + k : k; st.page = 1; load(); };
  root.addEventListener('keydown', e => { const th = e.target.closest && e.target.closest('th[data-s]'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortBy(th); } });
  root.addEventListener('click', async e => {
    const th = e.target.closest('th[data-s]'); if (th) return sortBy(th);
    if (e.target.closest('[data-retry]')) return load();
    const x = e.target.closest('[data-x]');
    if (x) {
      const a = x.dataset.x;
      if (a === 'nx') { st.page++; load(); } else if (a === 'pv') { st.page--; load(); }
      else if (a === 'new') cfg.onNew();
      else if (a === 'csv') location.href = '/api/' + cfg.api + '/?' + qs({ ...params(), export: 'csv' });
      return;
    }
    const b = e.target.closest('[data-act]');
    if (b) { try { await cfg.onAction(b.dataset.act, cache[b.dataset.id]); } catch (err) { toast(err.message, 'err'); } }
  });
  load();
}

async function deleteRecord(resource, row, label) {
  if (!(await confirmBox({ title: 'Delete ' + label + '?', message: 'This cannot be undone.', okText: 'Delete', danger: true }))) return;
  await api(`${resource}/${row.id}/`, { method: 'DELETE' });
  toast(label + ' deleted'); refresh();
}

const money = f => ({ r: 1, f });
const docStatusFilters = (posted) => [{ name: 'status', label: 'Status', opts: [['', 'All statuses'], ['draft', 'Draft'], ['unpaid', posted], ['partial', 'Partially Paid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']] }];
const LISTS = {
  customers: {
    api: 'customers', title: 'Customers', bc: 'Sales', newLabel: 'New customer', onNew: () => partyForm('customers'), empty: 'No customers yet.',
    filters: [{ name: 'active', label: 'Status', opts: [['', 'All'], ['1', 'Active'], ['0', 'Inactive']] }],
    cols: [{ h: 'Name', s: 'name', f: r => `<button class="lk" type="button" data-act="view" data-id="${r.id}">${esc(r.name)}</button>${r.active ? '' : ' ' + badge('Inactive')}` }, { h: 'Contact', f: r => esc(r.email || r.phone || '—') }, { h: 'State', s: 'state', f: r => esc(r.state || '—') }, { h: 'Billed', ...money(r => inr(r.billed)) }, { h: 'Receivable', ...money(r => inr(r.outstanding)) }, { h: 'Overdue', ...money(r => r.overdue > 0 ? `<span class="dn">${inr(r.overdue)}</span>` : inr(0)) }],
    actions: () => [['edit', 'Edit'], ['delete', 'Delete', 'd']],
    onAction: (a, r) => a === 'view' ? partyDetail('customers', r.id) : a === 'edit' ? partyForm('customers', r.id) : deleteRecord('customers', r, 'customer'),
  },
  vendors: {
    api: 'vendors', title: 'Vendors', bc: 'Purchases', newLabel: 'New vendor', onNew: () => partyForm('vendors'), empty: 'No vendors yet.',
    filters: [{ name: 'active', label: 'Status', opts: [['', 'All'], ['1', 'Active'], ['0', 'Inactive']] }],
    cols: [{ h: 'Name', s: 'name', f: r => `<button class="lk" type="button" data-act="view" data-id="${r.id}">${esc(r.name)}</button>${r.active ? '' : ' ' + badge('Inactive')}` }, { h: 'Contact', f: r => esc(r.email || r.phone || '—') }, { h: 'State', s: 'state', f: r => esc(r.state || '—') }, { h: 'Billed', ...money(r => inr(r.billed)) }, { h: 'Payable', ...money(r => inr(r.outstanding)) }, { h: 'Overdue', ...money(r => r.overdue > 0 ? `<span class="dn">${inr(r.overdue)}</span>` : inr(0)) }],
    actions: () => [['edit', 'Edit'], ['delete', 'Delete', 'd']],
    onAction: (a, r) => a === 'view' ? partyDetail('vendors', r.id) : a === 'edit' ? partyForm('vendors', r.id) : deleteRecord('vendors', r, 'vendor'),
  },
  items: {
    api: 'items', title: 'Items & Services', bc: 'Items', newLabel: 'New item', onNew: () => itemForm(), empty: 'No items yet.',
    filters: [{ name: 'type', label: 'Type', opts: [['', 'All types'], ['goods', 'Goods'], ['service', 'Services']] }, { name: 'active', label: 'Status', opts: [['', 'All'], ['1', 'Active'], ['0', 'Inactive']] }],
    cols: [
      {
        h: 'Item name', s: 'name', f: r => `
          <div style="display:flex;align-items:center;gap:10px;">
            ${r.image_data ? `<img src="${esc(r.image_data)}" alt="${esc(r.name)}" style="width:32px;height:32px;border-radius:7px;object-fit:cover;border:1px solid var(--bd-glass);box-shadow:0 2px 6px rgba(0,0,0,0.1);flex-shrink:0;">` : `<div style="width:32px;height:32px;border-radius:7px;background:var(--surface-glass-subtle);border:1px solid var(--bd-glass);display:grid;place-items:center;font-size:12px;font-weight:600;color:var(--accent);flex-shrink:0;">${esc((r.name || 'I')[0].toUpperCase())}</div>`}
            <div>
              <div style="font-weight:600;color:var(--tx);">${esc(r.name)}</div>
              <div class="sub" style="font-size:11px;">${esc(r.unit || 'nos')}${r.hsn_sac ? ' · HSN ' + esc(r.hsn_sac) : ''}</div>
            </div>
          </div>`
      },
      { h: 'SKU', s: 'sku', f: r => esc(r.sku) },
      { h: 'Type', f: r => r.type === 'goods' ? 'Goods' : 'Service' },
      { h: 'Selling price', s: 'selling_price', ...money(r => inr(r.selling_price)) },
      { h: 'Purchase price', ...money(r => inr(r.purchase_price)) },
      { h: 'GST', r: 1, f: r => num(r.gst_rate) + '%' },
      { h: 'Stock', s: 'stock', r: 1, f: r => r.stock == null ? '—' : qty(r.stock) + ' ' + esc(r.unit || '') },
      { h: 'Reorder at', r: 1, f: r => r.reorder_level == null ? '—' : qty(r.reorder_level) },
      { h: 'Status', f: r => badge(r.status) }
    ],
    actions: r => [['edit', 'Edit'], ...(r.track_inventory ? [['adjust', 'Adjust']] : []), ['delete', 'Delete', 'd']],
    onAction: (a, r) => a === 'edit' ? itemForm(r.id) : a === 'adjust' ? adjustForm(r.id) : deleteRecord('items', r, 'item'),
  },
  invoices: {
    api: 'invoices', title: 'Invoices', bc: 'Sales', newLabel: 'New invoice', onNew: () => docForm('invoices'), ordering: '-date', empty: 'No invoices yet.',
    filters: docStatusFilters('Sent'),
    cols: [{ h: 'Date', s: 'date', f: r => fd(r.date) }, { h: 'Invoice#', s: 'number', f: r => `<button class="lk" type="button" data-act="view" data-id="${r.id}">${esc(r.number)}</button>${r.attachment_count ? ' <span title="Has attachments">📎</span>' : ''}` }, { h: 'Customer', f: r => esc(r.party) }, { h: 'Status', f: r => badge(r.status) }, { h: 'Due date', s: 'due_date', f: r => fd(r.due_date) }, { h: 'Total', s: 'total', ...money(r => inr(r.total)) }, { h: 'Balance due', ...money(r => inr(r.balance)) }],
    actions: () => [['view', 'View'], ['edit', 'Edit'], ['delete', 'Delete', 'd']],
    onAction: (a, r) => a === 'view' ? docMasterDetail($('#pg'), 'invoices', r.id) : a === 'edit' ? docForm('invoices', r.id) : deleteRecord('invoices', r, 'invoice'),
  },
  bills: {
    api: 'bills', title: 'Bills', bc: 'Purchases', newLabel: 'New bill', onNew: () => docForm('bills'), ordering: '-date', empty: 'No bills yet.',
    filters: docStatusFilters('Open'),
    cols: [{ h: 'Date', s: 'date', f: r => fd(r.date) }, { h: 'Bill#', s: 'number', f: r => `<button class="lk" type="button" data-act="view" data-id="${r.id}">${esc(r.number)}</button>${r.attachment_count ? ' <span title="Has attachments">📎</span>' : ''}` }, { h: 'Vendor', f: r => esc(r.party) }, { h: 'Status', f: r => badge(r.status) }, { h: 'Due date', s: 'due_date', f: r => fd(r.due_date) }, { h: 'Total', s: 'total', ...money(r => inr(r.total)) }, { h: 'Balance due', ...money(r => inr(r.balance)) }],
    actions: () => [['view', 'View'], ['edit', 'Edit'], ['delete', 'Delete', 'd']],
    onAction: (a, r) => a === 'view' ? docMasterDetail($('#pg'), 'bills', r.id) : a === 'edit' ? docForm('bills', r.id) : deleteRecord('bills', r, 'bill'),
  },
  'payments-received': {
    api: 'payments-received', title: 'Payments Received', bc: 'Sales', newLabel: 'Record payment', onNew: () => paymentForm('payments-received'), ordering: '-date', empty: 'No payments recorded yet.',
    cols: [{ h: 'Date', s: 'date', f: r => fd(r.date) }, { h: 'Receipt#', s: 'number', f: r => `<button class="lk" type="button" data-act="view" data-id="${r.id}">${esc(r.number)}</button>` }, { h: 'Customer', f: r => esc(r.party) }, { h: 'Mode', f: r => esc(r.mode_label) }, { h: 'Reference', f: r => esc(r.reference || '—') }, { h: 'Amount', s: 'amount', ...money(r => inr(r.amount)) }, { h: 'Unapplied', ...money(r => inr(r.unapplied)) }],
    actions: () => [['view', 'View'], ['delete', 'Delete', 'd']],
    onAction: (a, r) => a === 'view' ? paymentDetail('payments-received', r.id) : deleteRecord('payments-received', r, 'payment'),
  },
  'payments-made': {
    api: 'payments-made', title: 'Payments Made', bc: 'Purchases', newLabel: 'Record payment', onNew: () => paymentForm('payments-made'), ordering: '-date', empty: 'No payments recorded yet.',
    cols: [{ h: 'Date', s: 'date', f: r => fd(r.date) }, { h: 'Payment#', s: 'number', f: r => `<button class="lk" type="button" data-act="view" data-id="${r.id}">${esc(r.number)}</button>` }, { h: 'Vendor', f: r => esc(r.party) }, { h: 'Mode', f: r => esc(r.mode_label) }, { h: 'Reference', f: r => esc(r.reference || '—') }, { h: 'Amount', s: 'amount', ...money(r => inr(r.amount)) }, { h: 'Unapplied', ...money(r => inr(r.unapplied)) }],
    actions: () => [['view', 'View'], ['delete', 'Delete', 'd']],
    onAction: (a, r) => a === 'view' ? paymentDetail('payments-made', r.id) : deleteRecord('payments-made', r, 'payment'),
  },
  inventory: {
    api: 'items', title: 'Inventory Summary', bc: 'Inventory', params: { tracked: 1 }, empty: 'No inventory-tracked items yet. Create a goods item with “Track inventory” on.',
    filters: [{ name: 'stock', label: 'Stock level', opts: [['', 'All'], ['low', 'Low stock'], ['out', 'Out of stock']] }],
    cols: [{ h: 'Item', s: 'name', f: r => esc(r.name) }, { h: 'SKU', s: 'sku', f: r => esc(r.sku) }, { h: 'On hand', s: 'stock', r: 1, f: r => qty(r.stock) + ' ' + esc(r.unit) }, { h: 'Reorder at', r: 1, f: r => qty(r.reorder_level) }, { h: 'Unit cost', ...money(r => inr(r.purchase_price)) }, { h: 'Stock value', ...money(r => inr(r.valuation)) }, { h: 'Status', f: r => badge(r.status) }],
    actions: () => [['adjust', 'Adjust']], onAction: (a, r) => adjustForm(r.id),
  },
  adjustments: {
    api: 'stock-adjustments', title: 'Stock Adjustments', bc: 'Inventory', newLabel: 'New adjustment', onNew: () => adjustForm(), ordering: '-date', empty: 'No stock adjustments yet.',
    cols: [{ h: 'Date', s: 'date', f: r => fd(r.date) }, { h: 'Reference', f: r => esc(r.reference) }, { h: 'Item', s: 'item', f: r => esc(r.item) }, { h: 'Reason', f: r => esc(r.reason) }, { h: 'Change', r: 1, f: r => `<span class="${num(r.change) < 0 ? 'dn' : 'up'}">${num(r.change) > 0 ? '+' : ''}${qty(r.change)}</span>` }, { h: 'Balance after', r: 1, f: r => qty(r.balance_after) }],
  },
  movements: {
    api: 'stock-movements', title: 'Stock Movement', bc: 'Inventory', ordering: '-date', empty: 'No stock movements yet.',
    filters: [{ name: 'kind', label: 'Type', opts: [['', 'All types'], ['opening', 'Opening stock'], ['sale', 'Sales'], ['sale_void', 'Sales voided'], ['purchase', 'Purchases'], ['purchase_void', 'Purchases voided'], ['adjustment', 'Adjustments']] }],
    cols: [{ h: 'Date', s: 'date', f: r => fd(r.date) }, { h: 'Item', s: 'item', f: r => esc(r.item) }, { h: 'Type', f: r => esc(r.kind_label) }, { h: 'Reference', f: r => esc(r.reference || '—') }, { h: 'Change', r: 1, f: r => `<span class="${num(r.change) < 0 ? 'dn' : 'up'}">${num(r.change) > 0 ? '+' : ''}${qty(r.change)}</span>` }, { h: 'Balance after', r: 1, f: r => qty(r.balance_after) }],
  },
};

/* detail dialogs */
const kvBox = pairs => `<div class="kv">${pairs.map(([k, v]) => `<div><span>${esc(k)}</span>${v}</div>`).join('')}</div>`;

/* ==================== Document Sheet & Template Customizer ==================== */
function renderDocSheet(d, kind, customOpts = {}) {
  const inv = kind === 'invoices';
  const org = APP.org || {};
  const theme = customOpts.theme || org.template_theme || (inv ? 'convosis' : 'modern');
  const color = customOpts.color || org.template_color || '#1877f2';
  const showLogo = customOpts.show_logo !== false;
  const showSig = customOpts.show_signature !== false;
  const showWords = customOpts.show_words !== false;
  const showHsn = customOpts.show_hsn !== false;
  const title = customOpts.title || (inv ? 'TAX INVOICE' : 'BILL');

  const isPaid = d.status === 'Paid' || (d.raw_status !== 'draft' && num(d.balance) <= 0);
  const isOverdue = d.status === 'Overdue';
  const isDraft = d.raw_status === 'draft';
  const ribClass = isPaid ? 'paid' : isOverdue ? 'overdue' : isDraft ? 'draft' : 'open';
  const ribText = isPaid ? 'Paid' : isOverdue ? 'Overdue' : isDraft ? 'Draft' : (inv ? 'Sent' : 'Open');

  const linesHtml = (d.lines || []).map((l, i) => `
    <tr>
      <td style="width:36px;color:#64748b;font-weight:600;">${i + 1}</td>
      <td>
        <div style="font-weight:600;color:#0f172a;">${esc(l.description)}</div>
      </td>
      ${showHsn ? `<td style="color:#475569;">${esc(l.hsn_sac || '—')}</td>` : ''}
      <td class="r" style="font-weight:600;">${qty(l.quantity)}</td>
      <td class="r">${inr(l.rate).replace('₹', '')}</td>
      <td class="r" style="font-weight:700;">${inr(l.line_total).replace('₹', '')}</td>
    </tr>
  `).join('');

  const party = d.party_details || {};
  const partyName = esc(d.party || party.name || (inv ? 'Customer' : 'Vendor'));
  const partyAddr = esc(party.billing_address || '');
  const partyGstin = party.gstin ? `<div style="margin-top:2px;">GSTIN <b>${esc(party.gstin)}</b></div>` : '';
  const partyState = party.state ? `<div>State: ${esc(party.state)}</div>` : '';

  const companyIdLine = org.company_id ? `<div>Company ID : <b>${esc(org.company_id)}</b></div>` : '<div>Company ID : U62090KL2026PTC103900</div>';
  const orgAddrHtml = (org.address || 'Technolodge Phase II\nKMC 24/222, Anugraha Medical Complex Building').split('\n').map(l => `<div>${esc(l)}</div>`).join('');
  const orgCityState = `<div>${esc(org.city || 'Kottayam')} ${esc(org.state || 'Keralam')} ${esc(org.pincode || '686003')}</div>`;
  const orgCountry = `<div>${esc(org.country || 'India')}</div>`;
  const orgGstin = org.gstin ? `<div>GSTIN <b>${esc(org.gstin)}</b></div>` : '<div>GSTIN 32AANCC9298C1ZE</div>';
  const orgPhone = org.phone ? `<div>${esc(org.phone)}</div>` : '<div>91-9847017737</div>';
  const orgEmail = org.email ? `<div>${esc(org.email)}</div>` : '<div>admin@convosis.com</div>';
  const orgWeb = org.website ? `<div>${esc(org.website)}</div>` : '<div>www.convosis.com</div>';
  const logoSrc = org.logo_data || '/static/books/img/convosis-logo.png';

  const orderNum = d.order_number || d.vendor_ref || '';
  const isDarkHead = theme === 'modern' || (!inv && theme !== 'convosis');

  return `
    <div class="doc-sheet theme-${theme}" style="--theme-color:${color};">
      <div class="doc-ribbon ${ribClass}"><span>${ribText}</span></div>

      <div class="doc-sheet-header">
        <div class="doc-company-box">
          ${showLogo ? `<img class="doc-company-logo" src="${esc(logoSrc)}" alt="${esc(org.name || 'Convosis')}">` : ''}
          <div class="doc-company-name">${esc(org.name || 'Convosis Technologies Pvt Ltd')}</div>
          <div class="doc-company-detail">
            ${companyIdLine}
            ${orgAddrHtml}
            ${orgCityState}
            ${orgCountry}
            ${orgGstin}
            ${orgPhone}
            ${orgEmail}
            ${orgWeb}
          </div>
        </div>

        <div class="doc-title-box">
          <div class="doc-main-heading" style="color:${color};">${esc(title)}</div>
          ${!inv ? `<div style="font-size:14px;font-weight:700;margin-bottom:8px;color:#0f172a;">Bill# ${esc(d.number)}</div><div style="font-size:12px;color:#475569;margin-bottom:8px;">Balance Due <b style="color:${color};font-size:14px;">${inr(d.balance)}</b></div>` : ''}
          <table class="doc-meta-grid">
            ${inv ? `<tr><td>#</td><td>: <b>${esc(d.number)}</b></td></tr>` : ''}
            ${inv ? `<tr><td>Invoice Date</td><td>: ${fd(d.date)}</td></tr>` : `<tr><td>Bill Date</td><td>: ${fd(d.date)}</td></tr>`}
            <tr><td>Terms</td><td>: ${esc(d.terms || 'Due on Receipt')}</td></tr>
            <tr><td>Due Date</td><td>: ${fd(d.due_date)}</td></tr>
            ${inv ? `<tr><td>Place Of Supply</td><td>: ${esc(d.place_of_supply || org.state || 'Kerala')}</td></tr>` : ''}
            ${orderNum ? `<tr><td>Order Number</td><td>: ${esc(orderNum)}</td></tr>` : ''}
          </table>
        </div>
      </div>

      <div class="doc-party-sec">
        <div class="doc-party-title">${inv ? 'Bill To' : 'Bill From'}</div>
        <div class="doc-party-name" style="color:${color};">${partyName}</div>
        <div class="doc-party-detail">
          ${partyAddr ? `<div>${partyAddr}</div>` : ''}
          ${partyState}
          ${partyGstin}
        </div>
      </div>

      <table class="doc-items-tbl ${isDarkHead ? 'dark-head' : ''}">
        <thead>
          <tr>
            <th>#</th>
            <th>Item &amp; Description</th>
            ${showHsn ? '<th>HSN/SAC</th>' : ''}
            <th class="r">Qty</th>
            <th class="r">Rate</th>
            <th class="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${linesHtml}
        </tbody>
      </table>

      <div class="doc-bottom-split">
        <div class="doc-bottom-left">
          ${showWords ? `
            <div class="doc-words-block">
              <div class="doc-words-label">Total In Words</div>
              <div class="doc-words-val">${numToWordsINR(d.total)}</div>
            </div>
          ` : ''}
          ${d.notes ? `
            <div class="doc-notes-block">
              <div class="doc-notes-label">Notes</div>
              <div>${esc(d.notes)}</div>
            </div>
          ` : ''}
          ${d.terms ? `
            <div class="doc-terms-block">
              <div class="doc-notes-label">Terms &amp; Conditions</div>
              <div>${esc(d.terms)}</div>
            </div>
          ` : ''}
        </div>

        <div class="doc-bottom-right">
          <div class="doc-totals-box">
            <div class="doc-totals-row">
              <span>Sub Total</span>
              <span style="font-weight:600;">${inr(d.subtotal).replace('₹', '')}</span>
            </div>
            ${d.intra_state ? `
              <div class="doc-totals-row"><span>CGST</span><span>${inr(d.cgst)}</span></div>
              <div class="doc-totals-row"><span>SGST</span><span>${inr(d.sgst)}</span></div>
            ` : (num(d.igst) > 0 ? `<div class="doc-totals-row"><span>IGST</span><span>${inr(d.igst)}</span></div>` : '')}
            <div class="doc-totals-row main-total">
              <span>Total</span>
              <span>${inr(d.total)}</span>
            </div>
            ${num(d.paid) > 0 ? `
              <div class="doc-totals-row">
                <span>Payment Made / Credits</span>
                <span style="color:#10b981;font-weight:600;">(-) ${inr(d.paid)}</span>
              </div>
            ` : ''}
            <div class="doc-totals-row bal-due" style="color:${color};">
              <span>Balance Due</span>
              <span>${inr(d.balance)}</span>
            </div>
          </div>
        </div>
      </div>

      ${showSig ? `
        <div class="doc-signature-sec">
          <div class="doc-signature-box">
            <div class="doc-sig-line"></div>
            <div class="doc-sig-label">${esc(org.signature_title || 'Authorized Signature')}</div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function openTemplateCustomizer(doc, kind, onUpdate) {
  const inv = kind === 'invoices';
  const org = APP.org;
  const currentTheme = org.template_theme || (inv ? 'convosis' : 'modern');
  const currentColor = org.template_color || '#1877f2';

  formModal({
    title: 'Customize ' + (inv ? 'Invoice' : 'Bill') + ' Template',
    wide: true,
    submit: 'Save Template Settings',
    body: `
      <div style="margin-bottom:14px;padding:12px;background:var(--surface-glass-subtle);border-radius:8px;font-size:12.5px;color:var(--sub);">
        Select template layouts, colors, and configure company details displayed on your invoices and bills.
      </div>
      <div class="fgrid">
        ${fld({ name: 'template_theme', label: 'Template Layout Style', type: 'select', opts: [
          ['convosis', 'Convosis Classic (Standard Boxed Meta — Image 1)'],
          ['modern', 'Modern Ribbon (Dark Items Header & Ribbon — Image 2)'],
          ['executive', 'Executive Indigo (Top Banner Accent)'],
          ['minimal', 'Minimalist (Clean Lines & Borders)']
        ], value: currentTheme, col: 'c2' })}

        ${fld({ name: 'template_color', label: 'Primary Accent Color', type: 'select', opts: [
          ['#1877f2', 'Convosis Blue (#1877f2)'],
          ['#0d6efd', 'Royal Blue (#0d6efd)'],
          ['#10b981', 'Emerald Green (#10b981)'],
          ['#ff8a00', 'Vibrant Orange (#ff8a00)'],
          ['#6366f1', 'Indigo (#6366f1)'],
          ['#1e293b', 'Dark Slate (#1e293b)']
        ], value: currentColor })}

        ${fld({ name: 'signature_title', label: 'Signature Line Title', value: org.signature_title || 'Authorized Signature' })}
        ${fld({ name: 'company_id', label: 'Company ID / CIN', value: org.company_id || 'U62090KL2026PTC103900' })}
        ${fld({ name: 'phone', label: 'Company Phone', value: org.phone || '91-9847017737' })}
        ${fld({ name: 'email', label: 'Company Email', value: org.email || 'admin@convosis.com' })}
        ${fld({ name: 'website', label: 'Company Website', value: org.website || 'www.convosis.com' })}
        ${fld({ name: 'address', label: 'Company Address', type: 'textarea', value: org.address || 'Technolodge Phase II\nKMC 24/222, Anugraha Medical Complex Building', col: 'c2' })}
        ${fld({ name: 'terms_default', label: 'Default Terms', type: 'textarea', value: org.terms_default || 'Due on Receipt', col: 'c2' })}
        ${fld({ name: 'notes_default', label: 'Default Notes', type: 'textarea', value: org.notes_default || 'Thanks for your business.', col: 'c2' })}
      </div>
    `,
    onSubmit: async d => {
      APP.org = await api('organization/', { method: 'PUT', body: d });
      applyOrg();
      toast('Template customized successfully');
      if (onUpdate) onUpdate();
    }
  });
}

async function openAttachmentsModal(kind, id, docNumber, onCountChange) {
  const inv = kind === 'invoices', etype = inv ? 'invoice' : 'bill';
  let attList = [];
  try {
    attList = await api(`attachments/?entity_type=${etype}&entity_id=${id}`);
  } catch (e) { attList = []; }

  const m = Modal.open({
    title: `Attachments · ${docNumber}`,
    wide: false,
    body: `
      <div style="margin-bottom:14px;">
        <div class="dropzone" id="att-dropzone">
          <input type="file" id="att-file-picker" multiple style="display:none">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:6px;color:var(--accent);"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          <div style="font-weight:600;font-size:13px;color:var(--tx);margin-bottom:2px;">Click to upload or drag & drop files</div>
          <div style="font-size:11px;color:var(--sub);">PDF, PNG, JPG, DOC up to 10MB</div>
        </div>
      </div>
      <h3 style="font-size:13px;font-weight:700;margin:16px 0 8px;color:var(--tx);">Attached Files (<span id="att-count-txt">${attList.length}</span>)</h3>
      <div id="att-items-box">${renderList()}</div>
    `,
    footer: `<button class="btn" type="button" data-close>Close</button>`
  });

  function renderList() {
    if (!attList.length) return `<div class="sub" style="text-align:center;padding:16px;">No files attached to this document yet.</div>`;
    return `<div style="display:flex;flex-direction:column;gap:6px;">${attList.map(a => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface-glass);border:1px solid var(--bd-glass);border-radius:6px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent);flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div style="min-width:0;">
            <div style="font-weight:600;font-size:12.5px;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(a.filename)}</div>
            <div style="font-size:11px;color:var(--sub);">${fmtBytes(a.file_size)} · ${fd(a.created_at ? a.created_at.split('T')[0] : '')}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <a class="btn" href="${esc(a.url || a.file_data)}" download="${esc(a.filename)}" target="_blank" style="padding:3px 8px;font-size:11px;">View</a>
          <button class="btn d" type="button" data-del-att="${a.id}" style="padding:3px 8px;font-size:11px;">Delete</button>
        </div>
      </div>
    `).join('')}</div>`;
  }

  const drop = $('#att-dropzone', m.el);
  const fin = $('#att-file-picker', m.el);
  if (drop && fin) {
    drop.addEventListener('click', () => fin.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });
    fin.addEventListener('change', () => handleFiles(fin.files));
  }

  async function handleFiles(files) {
    for (const f of Array.from(files)) {
      const reader = new FileReader();
      await new Promise(res => {
        reader.onload = async ev => {
          try {
            const created = await api('attachments/', {
              method: 'POST',
              body: { entity_type: etype, entity_id: id, filename: f.name, file_size: f.size, mime_type: f.type, file_data: ev.target.result }
            });
            attList.unshift(created);
          } catch (err) { toast('Upload failed: ' + err.message, 'err'); }
          res();
        };
        reader.readAsDataURL(f);
      });
    }
    $('#att-items-box', m.el).innerHTML = renderList();
    $('#att-count-txt', m.el).textContent = attList.length;
    if (onCountChange) onCountChange(attList.length);
    toast('File(s) attached');
  }

  m.el.addEventListener('click', async e => {
    const btn = e.target.closest('[data-del-att]');
    if (!btn) return;
    const attId = btn.dataset.delAtt;
    try {
      await api(`attachments/${attId}/`, { method: 'DELETE' });
      attList = attList.filter(a => String(a.id) !== String(attId));
      $('#att-items-box', m.el).innerHTML = renderList();
      $('#att-count-txt', m.el).textContent = attList.length;
      if (onCountChange) onCountChange(attList.length);
      toast('Attachment deleted');
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function docMasterDetail(root, kind, selectedId) {
  const inv = kind === 'invoices';
  let curFilter = '';
  let searchQuery = '';
  let docs = [];
  let curDoc = null;

  PAGE.reload = () => docMasterDetail(root, kind, curDoc ? curDoc.id : selectedId);

  root.innerHTML = `
    <div class="split-view-container">
      <div class="master-col">
        <div class="master-col-hd">
          <div style="display:flex;align-items:center;gap:6px;">
            <select class="btn" id="master-filter-sel" style="font-weight:700;font-size:14px;border:none;background:transparent;padding:4px 0;cursor:pointer;">
              <option value="">All ${inv ? 'Invoices' : 'Bills'}</option>
              <option value="draft">Draft</option>
              <option value="unpaid">${inv ? 'Sent' : 'Open'}</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button class="btn p" id="master-new-btn" type="button" title="Create New">+ New</button>
            <button class="btn" id="master-view-mode-btn" type="button" title="Switch to Table View">≡ Table</button>
          </div>
        </div>
        <div class="master-search-bar">
          <input class="in" type="search" id="master-q-in" placeholder="Search ${inv ? 'invoices' : 'bills'}…" style="width:100%;height:32px;font-size:12px;">
        </div>
        <div class="master-list-scroll" id="master-list-box">${spinner}</div>
      </div>
      <div class="detail-col" id="detail-col-box">
        <div style="display:grid;place-items:center;height:100%;color:var(--sub);">${spinner}</div>
      </div>
    </div>
  `;

  async function loadList() {
    try {
      const qParams = { page_size: 100, ordering: '-date' };
      if (curFilter) qParams.status = curFilter;
      if (searchQuery) qParams.q = searchQuery;
      const res = await api(`${kind}/?` + qs(qParams));
      docs = res.results || [];
      renderMasterList();
      if (docs.length > 0) {
        const found = selectedId ? docs.find(d => String(d.id) === String(selectedId)) : null;
        loadDetail((found || docs[0]).id);
      } else {
        $('#detail-col-box', root).innerHTML = `<div class="empty" style="margin:auto;"><div>No ${inv ? 'invoices' : 'bills'} found.<br><button class="btn p" id="empty-new-btn" style="margin-top:10px;">+ New ${inv ? 'Invoice' : 'Bill'}</button></div></div>`;
        const eb = $('#empty-new-btn', root);
        if (eb) eb.addEventListener('click', () => docForm(kind));
      }
    } catch (e) {
      $('#master-list-box', root).innerHTML = errBox(e.message);
    }
  }

  function renderMasterList() {
    const box = $('#master-list-box', root);
    if (!docs.length) {
      box.innerHTML = `<div class="empty" style="padding:30px 10px;"><div>No records matching.</div></div>`;
      return;
    }
    box.innerHTML = docs.map(d => {
      const isActive = curDoc && String(curDoc.id) === String(d.id);
      const isPaid = d.status === 'Paid';
      const isOverdue = d.status === 'Overdue';
      const badgeClass = isPaid ? 'ok' : isOverdue ? 'ba' : d.raw_status === 'draft' ? 'gr' : 'in';
      const badgeText = isOverdue ? 'OVERDUE' : d.status.toUpperCase();
      return `
        <div class="doc-row-card ${isActive ? 'active' : ''}" data-id="${d.id}">
          <input type="checkbox" style="margin-top:2px;" onclick="event.stopPropagation()">
          <div class="doc-row-info">
            <div class="doc-row-top">
              <span class="doc-row-party">${esc(d.party)}</span>
              <span class="doc-row-amt">${inr(d.total)}</span>
            </div>
            <div class="doc-row-sub">
              <span>${esc(d.number)}</span>
              <span>•</span>
              <span>${fd(d.date)}</span>
              ${d.attachment_count ? '<span title="Has attachments">📎</span>' : ''}
            </div>
            <div class="doc-row-badge-line">
              <span class="st ${badgeClass}">${badgeText}</span>
              ${isOverdue ? '<span style="font-size:12px;">✉️</span>' : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function loadDetail(id) {
    const detailBox = $('#detail-col-box', root);
    detailBox.innerHTML = `<div style="display:grid;place-items:center;height:100%;">${spinner}</div>`;
    try {
      curDoc = await api(`${kind}/${id}/`);
      renderMasterList();
      renderDetailPane();
    } catch (e) {
      detailBox.innerHTML = errBox(e.message);
    }
  }

  function renderDetailPane() {
    if (!curDoc) return;
    const d = curDoc;
    const detailBox = $('#detail-col-box', root);
    const posted = d.raw_status === (inv ? 'sent' : 'open');
    const attCount = (d.attachments ? d.attachments.length : (d.attachment_count || 0));

    detailBox.innerHTML = `
      <div class="doc-detail-bar">
        <div class="doc-detail-title-grp">
          <h1 class="doc-detail-title">${esc(d.number)}</h1>
          <div class="doc-detail-actions">
            <button class="btn" type="button" data-act="edit">Edit</button>
            ${d.raw_status === 'draft' ? `<button class="btn p" type="button" data-act="send">${inv ? 'Send' : 'Approve'}</button>` : ''}
            <button class="btn" type="button" data-act="print">PDF/Print</button>
            ${posted && num(d.balance) > 0 ? `<button class="btn p" type="button" data-act="pay">Record Payment</button>` : ''}
            <button class="btn" type="button" data-act="custom">Customize Template</button>
            <button class="btn d" type="button" data-act="delete">Delete</button>
          </div>
        </div>
        <div class="doc-detail-tools">
          <button class="btn" type="button" data-act="att" title="Manage Attachments" style="display:flex;align-items:center;gap:4px;">
            <span>📎</span> <b id="detail-att-cnt">${attCount}</b>
          </button>
          <button class="btn" type="button" data-act="close" title="Close">✕</button>
        </div>
      </div>
      <div class="doc-canvas-scroll" id="doc-sheet-viewport">
        ${renderDocSheet(d, kind)}
      </div>
    `;
  }

  root.addEventListener('click', async e => {
    const card = e.target.closest('.doc-row-card');
    if (card) {
      const id = card.dataset.id;
      loadDetail(id);
      return;
    }
    const actBtn = e.target.closest('[data-act]');
    if (actBtn && curDoc) {
      const act = actBtn.dataset.act;
      const d = curDoc;
      if (act === 'edit') return docForm(kind, d.id);
      if (act === 'print') return window.print();
      if (act === 'pay') return paymentForm(inv ? 'payments-received' : 'payments-made', { party: d.party_id, doc: d.id, amount: d.balance });
      if (act === 'custom') return openTemplateCustomizer(d, kind, () => {
        $('#doc-sheet-viewport', root).innerHTML = renderDocSheet(curDoc, kind);
      });
      if (act === 'att') return openAttachmentsModal(kind, d.id, d.number, newCount => {
        const cntEl = $('#detail-att-cnt', root);
        if (cntEl) cntEl.textContent = newCount;
        d.attachment_count = newCount;
        renderMasterList();
      });
      if (act === 'send') {
        try {
          await api(`${kind}/${d.id}/${inv ? 'send' : 'approve'}/`, { method: 'POST', body: {} });
          toast(d.number + (inv ? ' sent' : ' approved'));
          loadDetail(d.id);
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'delete') {
        if (!(await confirmBox({ title: 'Delete ' + (inv ? 'invoice ' : 'bill ') + d.number + '?', message: 'This will completely remove the document and restore balances. This cannot be undone.', okText: 'Delete', danger: true }))) return;
        try {
          await api(`${kind}/${d.id}/`, { method: 'DELETE' });
          toast(d.number + ' deleted');
          curDoc = null;
          loadList();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'close') {
        listPage(root, LISTS[kind]);
      }
    }
  });

  const filSel = $('#master-filter-sel', root);
  if (filSel) {
    filSel.addEventListener('change', () => {
      curFilter = filSel.value;
      loadList();
    });
  }
  const nBtn = $('#master-new-btn', root);
  if (nBtn) nBtn.addEventListener('click', () => docForm(kind));
  const vmBtn = $('#master-view-mode-btn', root);
  if (vmBtn) {
    vmBtn.addEventListener('click', () => {
      listPage(root, LISTS[kind]);
    });
  }
  let t;
  const qIn = $('#master-q-in', root);
  if (qIn) {
    qIn.addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => {
        searchQuery = e.target.value.trim();
        loadList();
      }, 250);
    });
  }

  loadList();
}

async function docDetail(kind, id) {
  const inv = kind === 'invoices', d = await api(`${kind}/${id}/`), posted = d.raw_status === (inv ? 'sent' : 'open');
  const attCount = (d.attachments ? d.attachments.length : (d.attachment_count || 0));

  const m = Modal.open({
    title: `${inv ? 'Invoice' : 'Bill'} ${d.number}`, wide: true,
    body: `
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;">
        <button class="btn" type="button" data-do="edit">Edit</button>
        <button class="btn" type="button" data-do="print">PDF/Print</button>
        <button class="btn" type="button" data-do="custom">Customize Template</button>
        <button class="btn" type="button" data-do="att">📎 Attachments (${attCount})</button>
        ${d.raw_status === 'draft' ? `<button class="btn p" type="button" data-do="post">${inv ? 'Mark as sent' : 'Approve bill'}</button>` : ''}
        ${posted && num(d.balance) > 0 ? `<button class="btn p" type="button" data-do="pay">Record Payment</button>` : ''}
        <button class="btn d" type="button" data-do="delete">Delete</button>
      </div>
      <div id="modal-sheet-viewport" style="display:flex;justify-content:center;background:rgba(0,0,0,0.02);padding:14px;border-radius:6px;max-height:75vh;overflow-y:auto;">
        ${renderDocSheet(d, kind)}
      </div>
    `,
    footer: `<button class="btn" type="button" data-close>Close</button>`,
  });

  m.el.addEventListener('click', async e => {
    const a = e.target.closest('[data-do]'); if (!a) return;
    const act = a.dataset.do;
    try {
      if (act === 'print') return window.print();
      if (act === 'edit') { m.close(); return docForm(kind, id); }
      if (act === 'custom') return openTemplateCustomizer(d, kind, () => {
        $('#modal-sheet-viewport', m.el).innerHTML = renderDocSheet(d, kind);
      });
      if (act === 'att') return openAttachmentsModal(kind, d.id, d.number);
      if (act === 'pay') { m.close(); return paymentForm(inv ? 'payments-received' : 'payments-made', { party: d.party_id, doc: d.id, amount: d.balance }); }
      if (act === 'post') { await api(`${kind}/${id}/${inv ? 'send' : 'approve'}/`, { method: 'POST', body: {} }); toast(d.number + (inv ? ' sent' : ' approved')); m.close(); refresh(); }
      if (act === 'delete') {
        if (!(await confirmBox({ title: 'Delete ' + (inv ? 'invoice ' : 'bill ') + d.number + '?', message: 'This cannot be undone.', okText: 'Delete', danger: true }))) return;
        await api(`${kind}/${id}/`, { method: 'DELETE' });
        toast(d.number + ' deleted'); m.close(); refresh();
      }
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function paymentDetail(kind, id) {
  const rec = kind === 'payments-received', d = await api(`${kind}/${id}/`);
  const m = Modal.open({
    title: `Payment ${d.number}`,
    body: `${kvBox([[rec ? 'Customer' : 'Vendor', esc(d.party)], ['Date', fd(d.date)], ['Mode', esc(d.mode_label)], ['Account', esc(d.account)], ['Reference', esc(d.reference || '—')], ['Amount', inr(d.amount)], ['Applied', inr(d.applied)], ['Unapplied', inr(d.unapplied)]])}
${d.allocations.length ? `<table><thead><tr><th>${rec ? 'Invoice' : 'Bill'}</th><th class="r">Applied</th></tr></thead><tbody>${d.allocations.map(a => `<tr><td>${esc(a.number)}</td><td class="r">${inr(a.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="sub">Not applied to any document.</p>'}${d.notes ? `<p><span class="sub">Notes:</span> ${esc(d.notes)}</p>` : ''}
<p class="hp">Deleting a payment restores the balance due on the documents it was applied to.</p>`,
    footer: '<button class="btn" type="button" data-close>Close</button><button class="btn d" type="button" data-do="delete">Delete payment</button>',
  });
  m.el.addEventListener('click', async e => {
    if (!e.target.closest('[data-do=delete]')) return;
    try {
      if (!(await confirmBox({ title: 'Delete payment ' + d.number + '?', message: 'Balances on the applied documents will be restored.', okText: 'Delete', danger: true }))) return;
      await api(`${kind}/${id}/`, { method: 'DELETE' }); toast('Payment deleted'); m.close(); refresh();
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function partyDetail(kind, id) {
  const cust = kind === 'customers', docs = cust ? 'invoices' : 'bills', pk = cust ? 'customer' : 'vendor', pay = cust ? 'payments-received' : 'payments-made';
  const [p, dl, pl] = await Promise.all([api(`${kind}/${id}/`), api(`${docs}/?` + qs({ [pk]: id, page_size: 20, ordering: '-date' })), api(`${pay}/?` + qs({ [pk]: id, page_size: 20 }))]);
  const m = Modal.open({
    title: p.name, wide: true,
    body: `${kvBox([['Billed', inr(p.billed)], [cust ? 'Receivable' : 'Payable', inr(p.outstanding)], ['Overdue', `<span class="${num(p.overdue) > 0 ? 'dn' : ''}">${inr(p.overdue)}</span>`], ['Email', esc(p.email || '—')], ['Phone', esc(p.phone || '—')], ['State', esc(p.state || '—')], ['GSTIN', esc(p.gstin || '—')], ['Payment terms', p.payment_terms + ' days']])}
<h3 style="font-size:14px;margin:12px 0 6px">${cust ? 'Invoices' : 'Bills'}</h3>${dl.results.length ? `<div class="tw"><table><thead><tr><th>Number</th><th>Date</th><th>Status</th><th class="r">Total</th><th class="r">Balance</th></tr></thead><tbody>${dl.results.map(d => `<tr><td><button class="lk" type="button" data-open="${d.id}">${esc(d.number)}</button></td><td>${fd(d.date)}</td><td>${badge(d.status)}</td><td class="r">${inr(d.total)}</td><td class="r">${inr(d.balance)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">None yet.</p>'}
<h3 style="font-size:14px;margin:12px 0 6px">Payments</h3>${pl.results.length ? `<div class="tw"><table><thead><tr><th>Number</th><th>Date</th><th>Mode</th><th class="r">Amount</th></tr></thead><tbody>${pl.results.map(x => `<tr><td>${esc(x.number)}</td><td>${fd(x.date)}</td><td>${esc(x.mode_label)}</td><td class="r">${inr(x.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">None yet.</p>'}`,
    footer: `<button class="btn" type="button" data-close>Close</button><button class="btn" type="button" data-do="edit">Edit</button><button class="btn" type="button" data-do="pay">Record payment</button>`,
  });
  m.el.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'), a = e.target.closest('[data-do]');
    if (o) { m.close(); docDetail(docs, o.dataset.open).catch(err => toast(err.message, 'err')); }
    if (a && a.dataset.do === 'edit') { m.close(); partyForm(kind, id); }
    if (a && a.dataset.do === 'pay') { m.close(); paymentForm(pay, { party: id }); }
  });
}


function gettingStarted(root) {
  const c = APP.counts;
  const steps = [['Set your organization’s home state and opening balance', !!APP.org.gstin || APP.org.opening_cash != 0, 'Open settings', () => orgForm()], ['Add your first customer', c.customers > 0, 'Add customer', () => partyForm('customers')], ['Add a vendor', c.vendors > 0, 'Add vendor', () => partyForm('vendors')], ['Add items or services', c.items > 0, 'Add item', () => itemForm()], ['Create and send your first invoice', c.invoices > 0, 'New invoice', () => docForm('invoices')], ['Record a payment', c.payments > 0, 'Record payment', () => paymentForm('payments-received')]];
  root.innerHTML = `<h1>Hello, ${esc(APP.user.name || 'admin')}</h1><div class="sub">${esc(APP.org.name)}</div><div class="tabs"><a href="#/home/dashboard">Dashboard</a><a class="on" href="#/home/getting-started">Getting Started</a><a href="#/home/recent-updates">Recent Updates</a></div>
<div class="card"><h3>Set up Convosis Books</h3><div class="cb"><ul class="chk">${steps.map((s, i) => `<li class="${s[1] ? 'done' : ''}"><span class="tick">${s[1] ? '✓' : ''}</span><span style="flex:1">${esc(s[0])}</span>${s[1] ? '' : `<button class="btn" type="button" data-step="${i}">${esc(s[2])}</button>`}</li>`).join('')}</ul></div></div>`;
  root.addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) steps[b.dataset.step][3](); });
  PAGE.reload = () => gettingStarted(root);
}
async function recentUpdates(root) {
  root.innerHTML = `<h1>Recent Updates</h1><div class="tabs"><a href="#/home/dashboard">Dashboard</a><a href="#/home/getting-started">Getting Started</a><a class="on" href="#/home/recent-updates">Recent Updates</a></div><div class="card"><div class="cb" id="rl">${spinner}</div></div>`;
  PAGE.reload = () => recentUpdates(root);
  try { const a = await api('activity/?limit=50'); if (root.isConnected) $('#rl', root).innerHTML = activityList(a); }
  catch (e) { if (root.isConnected) $('#rl', root).innerHTML = errBox(e.message); }
}
function plannedPage(root, group, name) {
  root.innerHTML = `<div class="bc">Home / ${esc(group || 'Not found')}</div><h1>${esc(name || 'Page not found')}</h1><div class="card" style="margin-top:14px"><div class="empty" style="height:220px"><div><b>Not built yet</b><br>This screen is planned for a later release.<br><a href="#/home/dashboard">Back to Dashboard</a></div></div></div>`;
  PAGE.reload = null;
}
