'use strict';

const Modal = (() => {
  const stack = [];
  function open({ title, body, footer = '', wide = false, onClose }) {
    const el = document.createElement('div');
    el.className = 'mo';
    el.innerHTML = `<div class="md ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mh"><h2>${esc(title)}</h2><button type="button" class="x" data-close aria-label="Close">×</button></div><div class="mb">${body}</div>${footer ? `<div class="mf">${footer}</div>` : ''}</div>`;
    $('#modal-root').appendChild(el);
    const m = { el, body: $('.mb', el), beforeClose: null, prev: document.activeElement };
    m.close = () => {
      const i = stack.indexOf(m); if (i >= 0) stack.splice(i, 1);
      el.remove();
      if (!stack.length) document.body.classList.remove('modal-open');
      if (onClose) onClose();
      if (m.prev && m.prev.isConnected && m.prev.focus) m.prev.focus();
    };
    m.request = async () => { if (m.beforeClose && !(await m.beforeClose())) return; m.close(); };
    el.addEventListener('click', e => { if (e.target.closest('[data-close]')) m.request(); });
    stack.push(m);
    document.body.classList.add('modal-open');
    const f = el.querySelector('input:not([type=hidden]):not([disabled]),select,textarea') || el.querySelector('.mf .p');
    if (f) f.focus();
    return m;
  }
  document.addEventListener('keydown', e => {
    if (!stack.length) return;
    const top = stack[stack.length - 1];
    if (e.key === 'Escape') { e.stopImmediatePropagation(); top.request(); }
    if (e.key === 'Tab') {
      const f = $$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled])', top.el);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  return { open, get top() { return stack[stack.length - 1]; }, count: () => stack.length };
})();

function confirmBox({ title, message, okText = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const m = Modal.open({
      title, body: `<p>${esc(message)}</p>`, onClose: () => fin(false),
      footer: `<button class="btn" type="button" data-close>Cancel</button><button class="btn ${danger ? 'd' : 'p'}" type="button" data-ok>${esc(okText)}</button>`,
    });
    $('[data-ok]', m.el).addEventListener('click', () => { fin(true); m.close(); });
    $('[data-ok]', m.el).focus();
  });
}

let uid = 0;
const opts = (list, sel) => list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(sel == null ? '' : sel) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
function fld(o) {
  const id = 'i' + (++uid), v = o.value == null ? '' : o.value, req = o.req ? ' required aria-required="true"' : '', at = o.attrs || '';
  let ctl;
  if (o.type === 'checkbox') return `<div class="fg ${o.col || ''}"><label class="ck"><input type="checkbox" name="${o.name}" ${v ? 'checked' : ''} ${at}> ${esc(o.label)}</label><div class="er" data-err="${o.name}" role="alert"></div></div>`;
  if (o.type === 'select') ctl = `<select class="in" id="${id}" name="${o.name}"${req} ${at}>${opts(o.opts, v)}</select>`;
  else if (o.type === 'textarea') ctl = `<textarea class="in" id="${id}" name="${o.name}" rows="${o.rows || 2}" maxlength="${o.max || 2000}" ${at}>${esc(v)}</textarea>`;
  else ctl = `<input class="in" id="${id}" name="${o.name}" type="${o.type || 'text'}" value="${esc(v)}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${req} ${at}>`;
  return `<div class="fg ${o.col || ''}"><label for="${id}">${esc(o.label)}${o.req ? ' <span class="rq">*</span>' : ''}</label>${ctl}<div class="er" data-err="${o.name}" role="alert"></div>${o.help ? `<div class="hp">${esc(o.help)}</div>` : ''}</div>`;
}
function readForm(form) {
  const d = {};
  for (const el of form.elements) {
    if (!el.name || el.type === 'submit' || el.type === 'button' || el.disabled) continue;
    if (el.type === 'radio') {
      if (el.checked) d[el.name] = el.value;
      continue;
    }
    d[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return d;
}
function clearErrors(form) { $$('[data-err]', form).forEach(e => { e.textContent = ''; }); }
function showErrors(form, errors, msg) {
  let general = msg || '', first = null;
  for (const [k, v] of Object.entries(errors || {})) {
    const el = form.querySelector(`[data-err="${k}"]`);
    if (el) { el.textContent = v; if (!first) first = el; } else general += (general ? ' ' : '') + k + ': ' + v;
  }
  const g = form.querySelector('[data-err="_"]');
  if (g) g.textContent = general;
  const target = first || g;
  if (target && target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
  const inp = first && first.parentElement.querySelector('input,select,textarea');
  if (inp) inp.focus();
}

function formModal({ title, body, submit = 'Save', actions, wide, onSubmit, onReady }) {
  const id = 'f' + (++uid);
  const acts = actions || [{ label: submit, value: 'save', primary: true }];
  const m = Modal.open({
    title, wide,
    body: `<form id="${id}" novalidate>${body}<div class="fe" data-err="_" role="alert"></div></form>`,
    footer: `<button type="button" class="btn" data-close>Cancel</button>` + acts.map(a => `<button type="submit" form="${id}" name="action" value="${a.value}" class="btn ${a.primary ? 'p' : ''}">${esc(a.label)}</button>`).join(''),
  });
  const form = $('#' + id, m.el);
  let dirty = false;
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('change', () => { dirty = true; });
  m.markDirty = () => { dirty = true; };
  m.beforeClose = async () => !dirty || await confirmBox({ title: 'Discard changes?', message: 'You have unsaved changes that will be lost.', okText: 'Discard', danger: true });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btns = $$('button[type=submit]', m.el);
    btns.forEach(b => { b.disabled = true; });
    clearErrors(form);
    try {
      await onSubmit(readForm(form), e.submitter ? e.submitter.value : acts[0].value, form);
      dirty = false; m.close();
    } catch (err) {
      if (err && err.cancel) return;
      if (err instanceof ApiErr) showErrors(form, err.errors, err.message);
      else { showErrors(form, {}, (err && err.message) || 'Unexpected error.'); console.error(err); }
    } finally { btns.forEach(b => { b.disabled = false; }); }
  });
  if (onReady) onReady(form, m);
  return m;
}

/* ---------- parties ---------- */
async function partyForm(kind, id) {
  const one = kind === 'customers' ? 'customer' : 'vendor';
  const r = id ? await api(`${kind}/${id}/`) : { payment_terms: 30, active: true, state: APP.org.state };
  const stOpts = [['', 'Select state'], ...STATES];
  formModal({
    title: (id ? 'Edit ' : 'New ') + one, wide: true,
    body: `<div class="fgrid">${[
      fld({ name: 'name', label: 'Display name', req: 1, value: r.name, col: 'c2', attrs: 'maxlength="200"' }),
      fld({ name: 'company', label: 'Company name', value: r.company }), fld({ name: 'contact_person', label: 'Contact person', value: r.contact_person }),
      fld({ name: 'email', label: 'Email', type: 'email', value: r.email }), fld({ name: 'phone', label: 'Phone', type: 'tel', value: r.phone }),
      fld({ name: 'state', label: 'State / place of supply', type: 'select', opts: stOpts, value: r.state }),
      fld({ name: 'payment_terms', label: 'Payment terms (days)', type: 'number', value: r.payment_terms, attrs: 'min="0" max="365" step="1"' }),
      fld({ name: 'gstin', label: 'GSTIN', value: r.gstin, attrs: 'maxlength="15"', ph: '22AAAAA0000A1Z5' }), fld({ name: 'pan', label: 'PAN', value: r.pan, attrs: 'maxlength="10"' }),
      fld({ name: 'billing_address', label: 'Billing address', type: 'textarea', value: r.billing_address, col: 'c2' }),
      kind === 'customers' ? fld({ name: 'shipping_address', label: 'Shipping address', type: 'textarea', value: r.shipping_address, col: 'c2' }) : '',
      fld({ name: 'notes', label: 'Notes', type: 'textarea', value: r.notes, col: 'c2' }),
      id ? fld({ name: 'active', label: 'Active', type: 'checkbox', value: r.active }) : '',
    ].join('')}</div>`,
    onSubmit: async d => {
      if (!id) d.active = true;
      await api(id ? `${kind}/${id}/` : `${kind}/`, { method: id ? 'PUT' : 'POST', body: d });
      toast(`${one[0].toUpperCase() + one.slice(1)} ${id ? 'updated' : 'created'}`); refresh();
    },
  });
}


async function itemForm(id) {
  const [r, vendors] = await Promise.all([
    id ? api(`items/${id}/`) : {
      type: 'goods',
      item_type: 'goods',
      gst_rate: 18,
      selling_price: '',
      purchase_price: '',
      active: true,
      unit: 'pcs',
      track_inventory: true,
      tax_preference: 'taxable',
      sales_account: 'Sales',
      purchase_account: 'Cost of Goods Sold',
      inventory_account: 'Inventory Asset',
      preferred_vendor_id: null,
      image_data: '',
      category: '',
      hsn_sac: '',
      description: '',
      reorder_level: '',
      sku: ''
    },
    api('lookup/vendors/').catch(() => [])
  ]);

  const isGoods = (r.type || r.item_type || 'goods') === 'goods';
  const img = r.image_data || '';

  // Units list as specified in requirements
  const ITEM_UNITS = [
    ['box', 'box (Box)'],
    ['cm', 'cm (Centimeter)'],
    ['dz', 'dz (Dozen)'],
    ['ft', 'ft (Feet)'],
    ['g', 'g (Grams)'],
    ['in', 'in (Inches)'],
    ['kg', 'kg (Kilograms)'],
    ['km', 'km (Kilometers)'],
    ['lb', 'lb (Pounds)'],
    ['mg', 'mg (Milli Grams)'],
    ['ml', 'ml (Milli Litre)'],
    ['m', 'm (Meter)'],
    ['pcs', 'pcs (Pieces)'],
  ];

  const curUnit = r.unit || 'pcs';
  let unitFound = false;
  const unitOptsHtml = ITEM_UNITS.map(([val, label]) => {
    const isSel = (val.toLowerCase() === curUnit.toLowerCase() || label.toLowerCase() === curUnit.toLowerCase());
    if (isSel) unitFound = true;
    return `<option value="${esc(val)}" ${isSel ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
  const extraUnitOpt = (!unitFound && curUnit) ? `<option value="${esc(curUnit)}" selected>${esc(curUnit)}</option>` : '';

  // Comprehensive Sales Accounts hierarchy as specified
  const SALES_ACCOUNT_GROUPS = [
    {
      group: 'Income',
      accounts: [
        { val: 'Sales', label: 'Sales' },
        { val: 'Discount', label: 'Discount' },
        { val: 'General Income', label: 'General Income' },
        { val: 'Interest Income', label: 'Interest Income' },
        { val: 'Late Fee Income', label: 'Late Fee Income' },
        { val: 'Other Charges', label: 'Other Charges' },
        { val: 'Shipping Charge', label: 'Shipping Charge' }
      ]
    },
    {
      group: 'Other Current Asset',
      accounts: [
        { val: 'Advance Tax', label: 'Advance Tax' },
        { val: 'CGST TDS Receivable', label: 'CGST TDS Receivable' },
        { val: 'Employee Advance', label: 'Employee Advance' },
        { val: 'IGST TDS Receivable', label: 'IGST TDS Receivable' },
        { val: 'Input Tax Credits', label: 'Input Tax Credits' },
        { val: 'Input CGST', label: '  • Input CGST' },
        { val: 'Input IGST', label: '  • Input IGST' },
        { val: 'Input SGST', label: '  • Input SGST' },
        { val: 'Prepaid Expenses', label: 'Prepaid Expenses' },
        { val: 'Reverse Charge Tax Input but not due', label: 'Reverse Charge Tax Input but not due' },
        { val: 'SGST TDS Receivable', label: 'SGST TDS Receivable' },
        { val: 'TDS Receivable', label: 'TDS Receivable' }
      ]
    },
    {
      group: 'Fixed Asset',
      accounts: [
        { val: 'Furniture and Equipment', label: 'Furniture and Equipment' }
      ]
    },
    {
      group: 'Other Current Liability',
      accounts: [
        { val: 'CGST TDS Payable', label: 'CGST TDS Payable' },
        { val: 'Employee Reimbursements', label: 'Employee Reimbursements' },
        { val: 'GST Payable', label: 'GST Payable' },
        { val: 'Output CGST', label: '  • Output CGST' },
        { val: 'Output IGST', label: '  • Output IGST' },
        { val: 'Output SGST', label: '  • Output SGST' },
        { val: 'IGST TDS Payable', label: 'IGST TDS Payable' },
        { val: 'Opening Balance Adjustments', label: 'Opening Balance Adjustments' },
        { val: 'Overseas Tax Payable', label: 'Overseas Tax Payable' },
        { val: 'SGST TDS Payable', label: 'SGST TDS Payable' },
        { val: 'Tax Payable', label: 'Tax Payable' },
        { val: 'TDS Payable', label: 'TDS Payable' },
        { val: 'Unearned Revenue', label: 'Unearned Revenue' }
      ]
    }
  ];

  const curSalesAccount = r.sales_account || 'Sales';
  let salesFound = false;
  const salesAccountsHtml = SALES_ACCOUNT_GROUPS.map(grp => {
    const opts = grp.accounts.map(acc => {
      const isSel = (acc.val === curSalesAccount);
      if (isSel) salesFound = true;
      return `<option value="${esc(acc.val)}" ${isSel ? 'selected' : ''}>${esc(acc.label)}</option>`;
    }).join('');
    return `<optgroup label="${esc(grp.group)}">${opts}</optgroup>`;
  }).join('');
  const extraSalesOpt = (!salesFound && curSalesAccount) ? `<option value="${esc(curSalesAccount)}" selected>${esc(curSalesAccount)}</option>` : '';

  // Purchase accounts list
  const PURCHASE_ACCOUNTS = [
    'Cost of Goods Sold',
    'Purchase Account',
    'Material Expense',
    'Operating Expense',
    'Raw Materials',
    'Subcontractor Expense',
    'Freight & Shipping Costs'
  ];
  const curPurchAccount = r.purchase_account || 'Cost of Goods Sold';
  let purchFound = false;
  const purchaseAccountsHtml = PURCHASE_ACCOUNTS.map(acc => {
    const isSel = (acc === curPurchAccount);
    if (isSel) purchFound = true;
    return `<option value="${esc(acc)}" ${isSel ? 'selected' : ''}>${esc(acc)}</option>`;
  }).join('');
  const extraPurchOpt = (!purchFound && curPurchAccount) ? `<option value="${esc(curPurchAccount)}" selected>${esc(curPurchAccount)}</option>` : '';

  // Inventory accounts list
  const INVENTORY_ACCOUNTS = [
    'Inventory Asset',
    'Work in Progress',
    'Finished Goods',
    'Raw Materials Inventory'
  ];
  const curInvAccount = r.inventory_account || 'Inventory Asset';
  let invFound = false;
  const inventoryAccountsHtml = INVENTORY_ACCOUNTS.map(acc => {
    const isSel = (acc === curInvAccount);
    if (isSel) invFound = true;
    return `<option value="${esc(acc)}" ${isSel ? 'selected' : ''}>${esc(acc)}</option>`;
  }).join('');
  const extraInvOpt = (!invFound && curInvAccount) ? `<option value="${esc(curInvAccount)}" selected>${esc(curInvAccount)}</option>` : '';

  // Preferred Vendor options
  const curVendorId = r.preferred_vendor_id != null ? String(r.preferred_vendor_id) : '';
  const vendorOptsHtml = (vendors || []).map(v => {
    const isSel = (String(v.id) === curVendorId);
    return `<option value="${v.id}" ${isSel ? 'selected' : ''}>${esc(v.name)}</option>`;
  }).join('');

  // Default tax slabs configuration matching Zoho Books requirements
  const DEFAULT_TAX_SLABS = [0, 5, 12, 18, 28, 40];
  const curRate = num(r.gst_rate != null ? r.gst_rate : 18);
  const isCustomRate = !DEFAULT_TAX_SLABS.includes(curRate);

  const intraOptionsHtml = `
    <optgroup label="Tax Group">
      ${isCustomRate ? `<option value="${curRate}" selected>GST${curRate} [${curRate}%]</option>` : ''}
      <option value="0" ${curRate === 0 ? 'selected' : ''}>GST0 [0%]</option>
      <option value="5" ${curRate === 5 ? 'selected' : ''}>GST5 [5%]</option>
      <option value="12" ${curRate === 12 ? 'selected' : ''}>GST12 [12%]</option>
      <option value="18" ${curRate === 18 ? 'selected' : ''}>GST18 [18%]</option>
      <option value="28" ${curRate === 28 ? 'selected' : ''}>GST28 [28%]</option>
      <option value="40" ${curRate === 40 ? 'selected' : ''}>GST40 [40%]</option>
    </optgroup>
    <option value="__add_new__" style="color:var(--accent); font-weight:600;">+ Add New Tax Rate…</option>
  `;

  const interOptionsHtml = `
    <optgroup label="Tax">
      ${isCustomRate ? `<option value="${curRate}" selected>IGST${curRate} [${curRate}%]</option>` : ''}
      <option value="0" ${curRate === 0 ? 'selected' : ''}>IGST0 [0%]</option>
      <option value="5" ${curRate === 5 ? 'selected' : ''}>IGST5 [5%]</option>
      <option value="12" ${curRate === 12 ? 'selected' : ''}>IGST12 [12%]</option>
      <option value="18" ${curRate === 18 ? 'selected' : ''}>IGST18 [18%]</option>
      <option value="28" ${curRate === 28 ? 'selected' : ''}>IGST28 [28%]</option>
      <option value="40" ${curRate === 40 ? 'selected' : ''}>IGST40 [40%]</option>
    </optgroup>
    <option value="__add_new__" style="color:var(--accent); font-weight:600;">+ Add New Tax Rate…</option>
  `;

  formModal({
    title: id ? 'Edit Item' : 'New Item',
    wide: true,
    body: `
    <div class="zoho-item-modal">
      <!-- Top Section: Item Details (Left) + Picture Upload (Right) -->
      <div class="zoho-top-grid">
        <div class="zoho-left-fields">
          <!-- Name -->
          <div class="fg">
            <label for="item_name" class="req-label">Name<span class="rq">*</span></label>
            <input class="in" type="text" id="item_name" name="name" value="${esc(r.name || '')}" placeholder="Item name" required autofocus>
            <div class="er" data-err="name" role="alert"></div>
          </div>

          <!-- Type (Radio: Goods / Service) -->
          <div class="fg">
            <label class="zoho-label">Type <span class="help-tip" title="Goods have physical inventory, services do not.">?</span></label>
            <div class="zoho-radio-group">
              <label class="radio-label">
                <input type="radio" name="item_type" value="goods" ${isGoods ? 'checked' : ''}>
                <span>Goods</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="item_type" value="service" ${!isGoods ? 'checked' : ''}>
                <span>Service</span>
              </label>
            </div>
            <div class="er" data-err="item_type" role="alert"></div>
          </div>

          <!-- Unit (Dropdown with Enter Option + Add New) -->
          <div class="fg">
            <label for="item_unit_select" class="zoho-label">Unit <span class="help-tip" title="Choose from dropdown or enter custom measuring unit for GST & billing.">?</span></label>
            <div class="unit-combo-group">
              <select class="in" id="item_unit_select">
                <option value="">Select Unit…</option>
                ${unitOptsHtml}
                ${extraUnitOpt}
                <option value="__add_new__" style="color:var(--accent); font-weight:600;">+ Add New Unit…</option>
              </select>
              <input class="in" type="text" id="item_unit" name="unit" value="${esc(r.unit || 'pcs')}" placeholder="Unit (or type here)" maxlength="20" required title="Selected unit or enter custom unit directly">
            </div>
            <div class="er" data-err="unit" role="alert"></div>
          </div>

          <!-- SKU -->
          <div class="fg">
            <label for="item_sku" class="req-label">SKU<span class="rq">*</span> <span class="help-tip" title="Stock Keeping Unit (unique identifier).">?</span></label>
            <input class="in" type="text" id="item_sku" name="sku" value="${esc(r.sku || '')}" placeholder="e.g. PROD-001" maxlength="60" required style="text-transform:uppercase;">
            <div class="er" data-err="sku" role="alert"></div>
          </div>

          <!-- HSN / SAC Code -->
          <div class="fg">
            <label for="item_hsn" class="zoho-label">HSN / SAC Code</label>
            <div class="hsn-search-wrap">
              <input class="in" type="text" id="item_hsn" name="hsn_sac" list="hsn_presets" value="${esc(r.hsn_sac || '')}" placeholder="Type to add or search HSN/SAC" maxlength="10">
              <svg class="hsn-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <datalist id="hsn_presets">
                <option value="8471">8471 - Computers, laptops & electronic hardware</option>
                <option value="8517">8517 - Telephones, smartphones & transmission apparatus</option>
                <option value="8528">8528 - Monitors, displays & televisions</option>
                <option value="4820">4820 - Registers, notebooks & office stationery</option>
                <option value="9983">9983 - Professional, IT & software consulting services</option>
                <option value="9984">9984 - Telecommunications & cloud information services</option>
                <option value="9987">9987 - Maintenance, support & engineering repair services</option>
              </datalist>
            </div>
            <div class="er" data-err="hsn_sac" role="alert"></div>
          </div>

          <!-- Tax Preference & 2 GST Rate Fields -->
          <div class="fgrid" style="gap:10px;">
            <div class="fg">
              <label for="item_tax_pref" class="req-label">Tax Preference<span class="rq">*</span></label>
              <select class="in" id="item_tax_pref" name="tax_preference">
                <option value="taxable" ${r.tax_preference !== 'exempt' && r.tax_preference !== 'non_taxable' && r.tax_preference !== 'nil_rated' ? 'selected' : ''}>Taxable</option>
                <option value="non_taxable" ${r.tax_preference === 'non_taxable' ? 'selected' : ''}>Non-Taxable</option>
                <option value="exempt" ${r.tax_preference === 'exempt' ? 'selected' : ''}>Exempt</option>
                <option value="nil_rated" ${r.tax_preference === 'nil_rated' ? 'selected' : ''}>Nil Rated (0%)</option>
              </select>
            </div>

            <!-- GST Field 1: Intra-State Tax Rate (CGST + SGST) -->
            <div class="fg" id="gstIntraWrap">
              <label for="item_gst_intra" class="zoho-label">Intra-State Tax Rate</label>
              <select class="in" id="item_gst_intra" name="gst_rate">
                ${intraOptionsHtml}
              </select>
            </div>
          </div>

          <!-- GST Field 2: Inter-State Tax Rate (IGST) -->
          <div class="fg" id="gstInterWrap">
            <label for="item_gst_inter" class="zoho-label">Inter-State Tax Rate (IGST)</label>
            <select class="in" id="item_gst_inter">
              ${interOptionsHtml}
            </select>
          </div>

          <div class="fg">
            <label for="item_category" class="zoho-label">Category</label>
            <input class="in" type="text" id="item_category" name="category" value="${esc(r.category || '')}" placeholder="e.g. Hardware, Software, Services" maxlength="100">
          </div>
        </div>

        <!-- Right: Picture Upload Box (Zoho Books Style) -->
        <div class="zoho-right-image">
          <label class="zoho-label">Item Image</label>
          <div class="zoho-image-dropzone" id="itemImageDropzone">
            <input type="file" id="itemImageFileInput" accept="image/*" style="display:none;">
            <input type="hidden" name="image_data" id="itemImageDataInput" value="${esc(img)}">

            <div id="dropzoneEmpty" class="dropzone-empty-state" style="${img ? 'display:none;' : ''}">
              <div class="dropzone-icon">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
              </div>
              <div class="dropzone-text">
                <span>Drag Image(s) here or</span>
                <button type="button" class="btn-browse-link" id="btnBrowseImage">Browse images</button>
              </div>
              <div class="dropzone-hint">Supports PNG, JPG, WebP up to 2MB</div>
            </div>

            <div id="dropzonePreview" class="dropzone-preview-state" style="${img ? '' : 'display:none;'}">
              <img id="itemImagePreviewImg" src="${esc(img)}" alt="Item Preview">
              <div class="preview-actions">
                <button type="button" class="btn btn-sm" id="btnChangeImage">Change</button>
                <button type="button" class="btn btn-sm btn-danger-link" id="btnRemoveImage">Remove</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Horizontal Divider -->
      <hr class="zoho-divider">

      <!-- Half & Half: Sales Information (Left) and Purchase Information (Right) -->
      <div class="zoho-split-grid">
        <!-- Left Half: Sales Information -->
        <div class="zoho-card-section" id="salesSection">
          <div class="section-header-title">
            <h3 class="section-title">Sales Information</h3>
          </div>
          <div class="section-body" id="salesBody">
            <div class="fg">
              <label for="item_selling_price" class="req-label">Selling Price<span class="rq">*</span></label>
              <div class="input-currency-group">
                <span class="currency-tag">INR</span>
                <input class="in" type="number" step="0.01" min="0" id="item_selling_price" name="selling_price" value="${esc(r.selling_price || '')}" placeholder="0.00" required>
              </div>
              <div class="er" data-err="selling_price" role="alert"></div>
            </div>

            <div class="fg">
              <label for="item_sales_account" class="req-label">Account<span class="rq">*</span></label>
              <select class="in" id="item_sales_account" name="sales_account">
                ${salesAccountsHtml}
                ${extraSalesOpt}
                <option value="__add_new__" style="color:var(--accent); font-weight:600;">+ Add New Account…</option>
              </select>
              <div class="er" data-err="sales_account" role="alert"></div>
            </div>

            <div class="fg">
              <label for="item_sales_desc" class="zoho-label">Description</label>
              <textarea class="in" id="item_sales_desc" name="description" rows="3" placeholder="Sales description for customer invoices…">${esc(r.description || '')}</textarea>
            </div>
          </div>
        </div>

        <!-- Right Half: Purchase Information -->
        <div class="zoho-card-section" id="purchaseSection">
          <div class="section-header-title">
            <h3 class="section-title">Purchase Information</h3>
          </div>
          <div class="section-body" id="purchaseBody">
            <div class="fg">
              <label for="item_purchase_price" class="req-label">Cost Price / Purchase Price<span class="rq">*</span></label>
              <div class="input-currency-group">
                <span class="currency-tag">INR</span>
                <input class="in" type="number" step="0.01" min="0" id="item_purchase_price" name="purchase_price" value="${esc(r.purchase_price || '')}" placeholder="0.00" required>
              </div>
              <div class="er" data-err="purchase_price" role="alert"></div>
            </div>

            <div class="fg">
              <label for="item_purchase_account" class="req-label">Account<span class="rq">*</span></label>
              <select class="in" id="item_purchase_account" name="purchase_account">
                ${purchaseAccountsHtml}
                ${extraPurchOpt}
                <option value="__add_new__" style="color:var(--accent); font-weight:600;">+ Add New Account…</option>
              </select>
              <div class="er" data-err="purchase_account" role="alert"></div>
            </div>

            <!-- Preferred Vendor (Requested in Purchase Info) -->
            <div class="fg">
              <label for="item_preferred_vendor" class="zoho-label">Preferred Vendor <span class="help-tip" title="Choose or add default vendor for bills & purchase orders.">?</span></label>
              <select class="in" id="item_preferred_vendor" name="preferred_vendor_id">
                <option value="">Select a vendor…</option>
                ${vendorOptsHtml}
                <option value="__add_new__" style="color:var(--accent); font-weight:600;">+ Add New Vendor…</option>
              </select>
              <div class="er" data-err="preferred_vendor_id" role="alert"></div>
            </div>

            <div class="fg">
              <label for="item_purchase_desc" class="zoho-label">Description</label>
              <textarea class="in" id="item_purchase_desc" rows="3" placeholder="Purchase description for vendor bills…"></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom: Inventory Information (for Goods) -->
      <div class="zoho-card-section" id="inventorySection">
        <div class="section-header-check">
          <label class="ck-section">
            <input type="checkbox" id="chkTrackInventory" name="track_inventory" ${r.track_inventory ? 'checked' : ''}>
            <span>Track Inventory for this item</span>
          </label>
        </div>
        <div class="section-body" id="inventoryBody" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-top:10px;">
          ${id ? '' : `
          <div class="fg" id="openingStockWrap">
            <label class="zoho-label">Opening Stock</label>
            <input class="in" type="number" step="0.001" min="0" name="opening_stock" placeholder="0.000">
          </div>
          `}
          <div class="fg">
            <label class="zoho-label">Reorder Point / Level</label>
            <input class="in" type="number" step="0.001" min="0" name="reorder_level" value="${r.reorder_level == null ? '' : r.reorder_level}" placeholder="0.000">
          </div>
          <div class="fg">
            <label for="item_inventory_account" class="zoho-label">Inventory Account</label>
            <select class="in" id="item_inventory_account" name="inventory_account">
              ${inventoryAccountsHtml}
              ${extraInvOpt}
              <option value="__add_new__" style="color:var(--accent); font-weight:600;">+ Add New Account…</option>
            </select>
          </div>
        </div>
        ${id ? '<div class="hp">Stock quantity adjustments are tracked through Stock Adjustments.</div>' : ''}
      </div>

      ${id ? `
      <div style="margin-top:6px;">
        <label class="ck"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> Active Item</label>
      </div>
      ` : ''}
    </div>
    `,
    onReady: (form, m) => {
      // 1. Picture upload and preview handling
      const fileInput = $('#itemImageFileInput', form);
      const dataInput = $('#itemImageDataInput', form);
      const emptyState = $('#dropzoneEmpty', form);
      const previewState = $('#dropzonePreview', form);
      const previewImg = $('#itemImagePreviewImg', form);
      const dropzone = $('#itemImageDropzone', form);

      const processFile = file => {
        if (!file || !/^image\//.test(file.type)) {
          toast('Please choose a valid image file (PNG, JPG, WebP).', 'err');
          return;
        }
        const reader = new FileReader();
        reader.onload = e => {
          const imgObj = new Image();
          imgObj.onload = () => {
            const maxDim = 600;
            let w = imgObj.width, h = imgObj.height;
            if (w > maxDim || h > maxDim) {
              if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
              else { w = Math.round((w * maxDim) / h); h = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgObj, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

            previewImg.src = dataUrl;
            dataInput.value = dataUrl;
            emptyState.style.display = 'none';
            previewState.style.display = '';
            m.markDirty();
          };
          imgObj.src = e.target.result;
        };
        reader.readAsDataURL(file);
      };

      $('#btnBrowseImage', form).onclick = e => { e.preventDefault(); e.stopPropagation(); fileInput.click(); };
      $('#btnChangeImage', form).onclick = e => { e.preventDefault(); e.stopPropagation(); fileInput.click(); };
      $('#btnRemoveImage', form).onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        dataInput.value = '';
        previewImg.src = '';
        previewState.style.display = 'none';
        emptyState.style.display = '';
        fileInput.value = '';
        m.markDirty();
      };
      dropzone.onclick = e => {
        if (!previewState.style.display && emptyState.style.display !== 'none') {
          fileInput.click();
        }
      };
      fileInput.onchange = () => {
        if (fileInput.files && fileInput.files[0]) processFile(fileInput.files[0]);
      };

      // Drag and drop events
      ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('dragover'); });
      });
      ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('dragover'); });
      });
      dropzone.addEventListener('drop', e => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          processFile(e.dataTransfer.files[0]);
        }
      });

      // 2. Generic "+ Add New" helper for dropdowns
      const setupAddNew = (selectEl, { promptText, placeholder, onAdd }) => {
        if (!selectEl) return;
        let prevVal = selectEl.value;
        selectEl.addEventListener('focus', () => {
          if (selectEl.value !== '__add_new__') prevVal = selectEl.value;
        });
        selectEl.addEventListener('change', async () => {
          if (selectEl.value === '__add_new__') {
            const input = window.prompt(promptText, placeholder || '');
            if (input && input.trim()) {
              const clean = input.trim();
              try {
                let res = { value: clean, text: clean };
                if (onAdd) {
                  const customRes = await onAdd(clean);
                  if (customRes === false) {
                    selectEl.value = prevVal;
                    return;
                  }
                  if (customRes && typeof customRes === 'object') {
                    res = customRes;
                  }
                }
                const addOpt = selectEl.querySelector('option[value="__add_new__"]');
                const opt = document.createElement('option');
                opt.value = res.value;
                opt.textContent = res.text || res.value;
                opt.selected = true;
                if (addOpt) {
                  addOpt.parentNode.insertBefore(opt, addOpt);
                } else {
                  selectEl.appendChild(opt);
                }
                selectEl.value = res.value;
                prevVal = res.value;
                selectEl.dispatchEvent(new Event('input', { bubbles: true }));
                m.markDirty();
                return;
              } catch (err) {
                toast(err.message || 'Failed to add option', 'err');
              }
            }
            selectEl.value = prevVal;
          } else {
            prevVal = selectEl.value;
          }
        });
      };

      // 3. Unit Dropdown + Direct Enter Input Sync & Add New Unit
      const unitSelect = $('#item_unit_select', form);
      const unitInput = $('#item_unit', form);
      unitSelect.addEventListener('change', () => {
        if (unitSelect.value && unitSelect.value !== '__add_new__') {
          unitInput.value = unitSelect.value;
          unitInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      unitInput.addEventListener('input', () => {
        const val = unitInput.value.trim().toLowerCase();
        const opt = Array.from(unitSelect.options).find(o => o.value.toLowerCase() === val || o.text.toLowerCase().startsWith(val));
        if (opt && opt.value !== '__add_new__') {
          unitSelect.value = opt.value;
        } else {
          unitSelect.value = '';
        }
      });
      setupAddNew(unitSelect, {
        promptText: 'Enter new unit of measurement (e.g. roll, bundle, set):',
        onAdd: val => {
          unitInput.value = val;
          return { value: val, text: val };
        }
      });

      // 4. GST Rates (Intra-state & Inter-state sync + Add New Tax Rate)
      const intra = $('#item_gst_intra', form);
      const inter = $('#item_gst_inter', form);
      const taxPref = $('#item_tax_pref', form);

      intra.addEventListener('change', () => {
        if (intra.value !== '__add_new__') inter.value = intra.value;
      });
      inter.addEventListener('change', () => {
        if (inter.value !== '__add_new__') intra.value = inter.value;
      });

      const handleNewTaxRate = async val => {
        const numVal = parseFloat(val);
        if (isNaN(numVal) || numVal < 0 || numVal > 100) {
          toast('Please enter a valid tax percentage between 0% and 100%', 'err');
          return false;
        }
        const rateStr = String(numVal);
        const intraText = `GST${numVal} [${numVal}%]`;
        const interText = `IGST${numVal} [${numVal}%]`;

        // Ensure in Intra
        if (!intra.querySelector(`option[value="${rateStr}"]`)) {
          const opt = document.createElement('option');
          opt.value = rateStr;
          opt.textContent = intraText;
          const group = intra.querySelector('optgroup') || intra;
          group.appendChild(opt);
        }
        // Ensure in Inter
        if (!inter.querySelector(`option[value="${rateStr}"]`)) {
          const opt = document.createElement('option');
          opt.value = rateStr;
          opt.textContent = interText;
          const group = inter.querySelector('optgroup') || inter;
          group.appendChild(opt);
        }
        intra.value = rateStr;
        inter.value = rateStr;
        toast(`Tax rate ${numVal}% added`);
        return { value: rateStr, text: intraText };
      };

      setupAddNew(intra, {
        promptText: 'Enter new GST tax rate percentage (e.g. 6 or 10):',
        onAdd: handleNewTaxRate
      });
      setupAddNew(inter, {
        promptText: 'Enter new GST tax rate percentage (e.g. 6 or 10):',
        onAdd: handleNewTaxRate
      });

      const syncTaxPref = () => {
        const isTaxable = taxPref.value === 'taxable';
        intra.disabled = !isTaxable;
        inter.disabled = !isTaxable;
        if (!isTaxable) {
          intra.value = '0';
          inter.value = '0';
        }
      };
      taxPref.addEventListener('change', syncTaxPref);
      syncTaxPref();

      // 5. Sales Account (+ Add New)
      const salesAcctSelect = $('#item_sales_account', form);
      setupAddNew(salesAcctSelect, {
        promptText: 'Enter new sales account name:',
        onAdd: val => {
          toast(`Sales account "${val}" added`);
          return { value: val, text: val };
        }
      });

      // 6. Purchase Account (+ Add New)
      const purchAcctSelect = $('#item_purchase_account', form);
      setupAddNew(purchAcctSelect, {
        promptText: 'Enter new purchase account name:',
        onAdd: val => {
          toast(`Purchase account "${val}" added`);
          return { value: val, text: val };
        }
      });

      // 7. Preferred Vendor (+ Add New Vendor with API creation)
      const vendorSelect = $('#item_preferred_vendor', form);
      setupAddNew(vendorSelect, {
        promptText: 'Enter new vendor name:',
        onAdd: async val => {
          const v = await api('vendors/', {
            method: 'POST',
            body: { name: val, active: true, state: (APP.org && APP.org.state) || '' }
          });
          toast(`Vendor "${v.name}" created!`);
          return { value: v.id, text: v.name };
        }
      });

      // 8. Inventory Account (+ Add New)
      const invAcctSelect = $('#item_inventory_account', form);
      setupAddNew(invAcctSelect, {
        promptText: 'Enter new inventory account name:',
        onAdd: val => {
          toast(`Inventory account "${val}" added`);
          return { value: val, text: val };
        }
      });

      // 9. Type Radio (Goods vs Service)
      const invSec = $('#inventorySection', form);
      const trackInvCheck = $('#chkTrackInventory', form);
      const syncType = () => {
        const isSvc = form.elements.item_type.value === 'service';
        invSec.style.display = isSvc ? 'none' : '';
        trackInvCheck.disabled = isSvc;
        if (isSvc) trackInvCheck.checked = false;
        syncTrackInv();
      };
      $$('input[name="item_type"]', form).forEach(r => r.addEventListener('change', syncType));



      // 11. Inventory Tracking Sync
      const invBody = $('#inventoryBody', form);
      const syncTrackInv = () => {
        invBody.style.display = trackInvCheck.checked ? 'grid' : 'none';
      };
      trackInvCheck.addEventListener('change', syncTrackInv);
      syncType();
    },
    onSubmit: async d => {
      if (!id) d.active = true;
      if (!d.selling_price) d.selling_price = '0.00';
      if (!d.purchase_price) d.purchase_price = '0.00';
      await api(id ? `items/${id}/` : 'items/', { method: id ? 'PUT' : 'POST', body: d });
      toast('Item ' + (id ? 'updated' : 'created'));
      refresh();
    },
  });
}

/*  invoices / bills  */
async function docForm(kind, id) {
  const inv = kind === 'invoices', pk = inv ? 'customer' : 'vendor';
  const [parties, items, rec] = await Promise.all([api(`lookup/${inv ? 'customers' : 'vendors'}/`), api('lookup/items/'), id ? api(`${kind}/${id}/`) : null]);
  if (!parties.length) { toast(`Create a ${pk} first.`, 'err'); return; }
  const itemOpts = [['', '— Custom line —'], ...items.map(i => [i.id, i.name + (i.sku ? ' (' + i.sku + ')' : '')])];
  const r = rec || { date: APP.today, lines: [{}], place_of_supply: '', notes: APP.org.notes_default || 'Thanks for your business.', terms: APP.org.terms_default || 'Due on Receipt', order_number: '' };
  const byId = Object.fromEntries(items.map(i => [String(i.id), i]));
  const row = l => `<tr class="ln"><td><select class="in l-item" aria-label="Item">${opts(itemOpts, l.item)}</select><input class="in l-desc" aria-label="Description" placeholder="Description" maxlength="500" value="${esc(l.description || '')}"></td><td><input class="in l-hsn" aria-label="HSN/SAC" maxlength="10" value="${esc(l.hsn_sac || '')}"></td><td><input class="in l-qty" type="number" step="0.001" min="0" aria-label="Quantity" value="${esc(l.quantity || 1)}"></td><td><input class="in l-rate" type="number" step="0.01" min="0" aria-label="Rate" value="${esc(l.rate == null ? '' : l.rate)}"></td><td><input class="in l-disc" type="number" step="0.01" min="0" max="100" aria-label="Discount %" value="${esc(l.discount_percent || 0)}"></td><td><select class="in l-gst" aria-label="GST rate">${opts(GST_SLABS.map(x => [x, x + '%']), l.gst_rate != null ? num(l.gst_rate) : 18)}</select></td><td class="r l-amt">—</td><td><button type="button" class="btn ic" data-rm aria-label="Remove line">×</button></td></tr>`;
  const partyId = r.party_id || '';
  const due0 = r.due_date || '';
  const pendingFiles = [];

  formModal({
    title: `${id ? 'Edit' : 'New'} ${inv ? 'invoice' : 'bill'}${id ? ' ' + r.number : ''}`, wide: true,
    actions: id ? [{ label: 'Update ' + (inv ? 'Invoice' : 'Bill'), value: 'update', primary: true }, { label: 'Save as draft', value: 'draft' }] : [{ label: 'Save as draft', value: 'draft' }, { label: inv ? 'Save & send' : 'Save & approve', value: 'post', primary: true }],
    body: `<div class="fgrid">${[
      fld({ name: pk, label: inv ? 'Customer' : 'Vendor', type: 'select', req: 1, opts: [['', 'Select…'], ...parties.map(p => [p.id, p.name])], value: partyId }),
      fld({ name: 'place_of_supply', label: 'Place of supply', type: 'select', opts: STATES, value: r.place_of_supply || APP.org.state, help: 'Same state as your organization → CGST + SGST; otherwise IGST.' }),
      fld({ name: 'date', label: 'Date', type: 'date', req: 1, value: r.date }),
      fld({ name: 'due_date', label: 'Due date', type: 'date', value: due0 }),
      fld({ name: 'order_number', label: 'Order Number', value: r.order_number || '', ph: 'e.g. 653248543' }),
      inv ? '' : fld({ name: 'vendor_ref', label: 'Vendor reference', value: r.vendor_ref }),
    ].join('')}</div>
    <h3 style="margin:16px 0 6px;font-size:14px">Line items</h3>
    <div class="tw"><table class="lt"><thead><tr><th style="min-width:230px">Item / description</th><th>HSN/SAC</th><th>Qty</th><th>Rate (₹)</th><th>Disc %</th><th>GST</th><th class="r">Amount</th><th></th></tr></thead><tbody id="lines">${r.lines.map(row).join('')}</tbody></table></div>
    <div class="er" data-err="lines" role="alert"></div>
    <button type="button" class="btn" data-add style="margin-top:8px">+ Add line</button>
    <div class="tot" aria-live="polite"><div><span>Taxable value</span><b data-t="sub">₹0.00</b></div><div data-t-row="cgst"><span>CGST</span><b data-t="cgst">₹0.00</b></div><div data-t-row="sgst"><span>SGST</span><b data-t="sgst">₹0.00</b></div><div data-t-row="igst"><span>IGST</span><b data-t="igst">₹0.00</b></div><div class="gt"><span>Total</span><b data-t="total">₹0.00</b></div></div>
    <div class="fgrid" style="margin-top:12px">${fld({ name: 'notes', label: 'Notes', type: 'textarea', value: r.notes != null ? r.notes : (APP.org.notes_default || 'Thanks for your business.'), col: 'c2' })}${inv ? fld({ name: 'terms', label: 'Terms & conditions', type: 'textarea', value: r.terms != null ? r.terms : (APP.org.terms_default || 'Due on Receipt'), col: 'c2' }) : ''}</div>
    <div style="margin-top:14px;padding:12px;border:1px solid var(--bd-glass);border-radius:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <label style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          Attached Files
        </label>
        <input type="file" id="doc-file-input" multiple style="display:none">
        <button type="button" class="btn" onclick="this.previousElementSibling.click()">+ Attach File</button>
      </div>
      <div id="doc-attach-badges" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
    </div>`,
    onReady: (form, m) => {
      const tb = $('#lines', form);
      let dueTouched = !!due0;
      const calc = () => {
        const intra = norm(form.elements.place_of_supply.value) === norm(APP.org.state);
        const t = { sub: 0, cgst: 0, sgst: 0, igst: 0 };
        $$('tr.ln', form).forEach(tr => {
          const taxable = r2(num($('.l-qty', tr).value) * num($('.l-rate', tr).value) * (100 - num($('.l-disc', tr).value)) / 100);
          const tax = taxable * num($('.l-gst', tr).value) / 100;
          const cg = intra ? r2(tax / 2) : 0, ig = intra ? 0 : r2(tax);
          t.sub += taxable; t.cgst += cg; t.sgst += cg; t.igst += ig;
          $('.l-amt', tr).textContent = inr(taxable + cg * 2 + ig);
        });
        $$('[data-t]', form).forEach(el => { const k = el.dataset.t; el.textContent = inr(k === 'total' ? t.sub + t.cgst + t.sgst + t.igst : t[k]); });
        $('[data-t-row=cgst]', form).style.display = $('[data-t-row=sgst]', form).style.display = intra ? '' : 'none';
        $('[data-t-row=igst]', form).style.display = intra ? 'none' : '';
      };
      const setDue = () => {
        if (dueTouched) return;
        const p = parties.find(x => String(x.id) === form.elements[pk].value), d = form.elements.date.value;
        if (d) form.elements.due_date.value = addDays(d, p ? p.payment_terms : 30);
      };
      form.addEventListener('input', e => { if (e.target.name === 'due_date') dueTouched = true; if (e.target.name === 'date') setDue(); calc(); });
      form.addEventListener('change', e => {
        if (e.target.classList.contains('l-item')) {
          const it = byId[e.target.value], tr = e.target.closest('tr');
          if (it) { $('.l-desc', tr).value = it.name; $('.l-hsn', tr).value = it.hsn_sac || ''; $('.l-rate', tr).value = inv ? it.selling_price : it.purchase_price; $('.l-gst', tr).value = String(num(it.gst_rate)); }
        }
        if (e.target.name === pk) {
          const p = parties.find(x => String(x.id) === e.target.value);
          if (p && p.state) form.elements.place_of_supply.value = p.state;
          setDue();
        }
        calc();
      });
      form.addEventListener('click', e => {
        if (e.target.closest('[data-add]')) { tb.insertAdjacentHTML('beforeend', row({})); m.markDirty(); calc(); }
        const rm = e.target.closest('[data-rm]');
        if (rm) { if ($$('tr.ln', form).length > 1) { rm.closest('tr').remove(); m.markDirty(); calc(); } else toast('At least one line is required.', 'err'); }
      });

      // Render existing attachments if editing
      const attachBox = $('#doc-attach-badges', form);
      const renderAttach = () => {
        let h = '';
        if (r.attachments && r.attachments.length) {
          h += r.attachments.map(a => `<div class="attach-file-badge"><span>📎 ${esc(a.filename)} (${fmtBytes(a.file_size)})</span><button type="button" data-del-att="${a.id}" title="Remove file">×</button></div>`).join('');
        }
        h += pendingFiles.map((f, i) => `<div class="attach-file-badge" style="border-style:dashed;"><span>📎 ${esc(f.name)} (${fmtBytes(f.size)}) <small style="color:var(--accent);">new</small></span><button type="button" data-rem-pen="${i}" title="Remove file">×</button></div>`).join('');
        if (!h) h = '<span class="sub" style="font-size:12px;">No files attached yet.</span>';
        attachBox.innerHTML = h;
      };
      renderAttach();

      attachBox.addEventListener('click', async e => {
        const delBtn = e.target.closest('[data-del-att]');
        if (delBtn) {
          const attId = delBtn.dataset.delAtt;
          try {
            await api(`attachments/${attId}/`, { method: 'DELETE' });
            r.attachments = (r.attachments || []).filter(a => String(a.id) !== String(attId));
            renderAttach();
            toast('Attachment removed');
          } catch (err) { toast(err.message, 'err'); }
          return;
        }
        const remBtn = e.target.closest('[data-rem-pen]');
        if (remBtn) {
          pendingFiles.splice(Number(remBtn.dataset.remPen), 1);
          renderAttach();
        }
      });

      const fileIn = $('#doc-file-input', form);
      if (fileIn) {
        fileIn.addEventListener('change', () => {
          Array.from(fileIn.files).forEach(f => {
            const reader = new FileReader();
            reader.onload = ev => {
              pendingFiles.push({ name: f.name, size: f.size, type: f.type, data: ev.target.result });
              renderAttach();
              m.markDirty();
            };
            reader.readAsDataURL(f);
          });
          fileIn.value = '';
        });
      }

      if (!due0) setDue();
      calc();
    },
    onSubmit: async (d, action, form) => {
      d.force = true;
      d.lines = $$('tr.ln', form).map(tr => ({ item: $('.l-item', tr).value || null, description: $('.l-desc', tr).value, hsn_sac: $('.l-hsn', tr).value, quantity: $('.l-qty', tr).value, rate: $('.l-rate', tr).value, discount_percent: $('.l-disc', tr).value || 0, gst_rate: $('.l-gst', tr).value }));
      const saved = await api(id ? `${kind}/${id}/` : `${kind}/`, { method: id ? 'PUT' : 'POST', body: d });

      // Save pending attachments
      for (const pf of pendingFiles) {
        try {
          await api('attachments/', {
            method: 'POST',
            body: { entity_type: inv ? 'invoice' : 'bill', entity_id: saved.id, filename: pf.name, file_size: pf.size, mime_type: pf.type, file_data: pf.data }
          });
        } catch (e) { console.error('Attachment upload error:', e); }
      }

      if (action === 'post') {
        try { await api(`${kind}/${saved.id}/${inv ? 'send' : 'approve'}/`, { method: 'POST', body: {} }); toast(`${saved.number} ${inv ? 'sent' : 'approved'}`); }
        catch (e) { toast(`${saved.number} saved as draft, but could not be ${inv ? 'sent' : 'approved'}: ${e.message}`, 'err'); }
      } else toast(`${saved.number} ${id ? 'updated' : 'saved'}`);
      refresh();
    },
  });
}

/* payments */
async function paymentForm(kind, pre = {}) {
  const rec = kind === 'payments-received', pk = rec ? 'customer' : 'vendor', docKey = rec ? 'invoice' : 'bill', docs = rec ? 'invoices' : 'bills';
  const parties = await api(`lookup/${rec ? 'customers' : 'vendors'}/`);
  if (!parties.length) { toast(`Create a ${pk} first.`, 'err'); return; }
  formModal({
    title: rec ? 'Record payment received' : 'Record payment made', wide: true,
    body: `<div class="fgrid">${[
      fld({ name: pk, label: rec ? 'Customer' : 'Vendor', type: 'select', req: 1, opts: [['', 'Select…'], ...parties.map(p => [p.id, p.name])], value: pre.party || '' }),
      fld({ name: 'date', label: 'Payment date', type: 'date', req: 1, value: APP.today }),
      fld({ name: 'amount', label: 'Amount (₹)', type: 'number', req: 1, value: pre.amount || '', attrs: 'min="0.01" step="0.01"' }),
      fld({ name: 'mode', label: 'Payment mode', type: 'select', opts: [['bank_transfer', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['card', 'Card'], ['other', 'Other']], value: 'bank_transfer' }),
      fld({ name: 'account', label: 'Bank / cash account', value: 'Bank Account' }), fld({ name: 'reference', label: 'Reference number' }),
      fld({ name: 'notes', label: 'Notes', type: 'textarea', col: 'c2' }),
    ].join('')}</div>
    <h3 style="margin:16px 0 6px;font-size:14px">Apply to ${rec ? 'invoices' : 'bills'}</h3>
    <div id="alloc"><div class="sub">Select a ${pk} to see outstanding ${docs}.</div></div>
    <div class="er" data-err="allocations" role="alert"></div>
    <div class="cs" style="margin-top:10px"><div><span>Applied</span><b id="ap">₹0.00</b></div><div><span>Unapplied (kept as credit on payment)</span><b id="un">₹0.00</b></div></div>`,
    onReady: (form, m) => {
      let list = [];
      const sum = () => $$('.al-in', form).reduce((a, i) => a + num(i.value), 0);
      const totals = () => { const a = sum(); $('#ap', form).textContent = inr(a); $('#un', form).textContent = inr(num(form.elements.amount.value) - a); };
      const load = async () => {
        const pid = form.elements[pk].value, box = $('#alloc', form);
        if (!pid) { box.innerHTML = `<div class="sub">Select a ${pk} to see outstanding ${docs}.</div>`; list = []; totals(); return; }
        box.innerHTML = spinner;
        try {
          const p = await api(`${docs}/?` + qs({ open: 1, [pk]: pid, page_size: 100, ordering: 'due_date' }));
          list = p.results;
          box.innerHTML = list.length ? `<div class="tw"><table><thead><tr><th>Number</th><th>Due</th><th class="r">Balance due</th><th class="r" style="width:150px">Apply (₹)</th></tr></thead><tbody>${list.map(d => `<tr><td>${esc(d.number)}</td><td>${fd(d.due_date)}</td><td class="r">${inr(d.balance)}</td><td><input class="in al-in r" type="number" min="0" step="0.01" max="${esc(d.balance)}" data-id="${d.id}" aria-label="Apply to ${esc(d.number)}"></td></tr>`).join('')}</tbody></table></div><button type="button" class="btn" data-auto style="margin-top:8px">Auto-apply (oldest due first)</button>` : `<div class="sub">No outstanding ${docs} for this ${pk}. The full amount will remain unapplied.</div>`;
          if (pre.doc) { const i = $(`.al-in[data-id="${pre.doc}"]`, form); if (i) { const d = list.find(x => String(x.id) === String(pre.doc)); i.value = d.balance; if (!form.elements.amount.value) form.elements.amount.value = d.balance; } pre.doc = null; }
          totals();
        } catch (e) { box.innerHTML = errBox(e.message); }
      };
      form.elements[pk].addEventListener('change', load);
      form.addEventListener('input', totals);
      form.addEventListener('click', e => {
        if (!e.target.closest('[data-auto]')) return;
        let left = num(form.elements.amount.value);
        $$('.al-in', form).forEach(i => { const d = list.find(x => String(x.id) === i.dataset.id); const a = Math.min(left, num(d.balance)); i.value = a > 0 ? r2(a) : ''; left = r2(left - a); });
        m.markDirty(); totals();
      });
      if (pre.party) load(); else totals();
    },
    onSubmit: async (d, a, form) => {
      d.allocations = $$('.al-in', form).filter(i => num(i.value) > 0).map(i => ({ [docKey]: Number(i.dataset.id), amount: i.value }));
      const applied = d.allocations.reduce((s, x) => s + num(x.amount), 0);
      if (applied > num(d.amount) + 0.001) throw new ApiErr(400, { message: 'Please correct the allocations.', errors: { allocations: 'Applied amount exceeds the payment amount.' } });
      const p = await api(kind + '/', { method: 'POST', body: d });
      toast(`Payment ${p.number} recorded`); refresh();
    },
  });
}


async function adjustForm(preItem) {
  const items = (await api('lookup/items/')).filter(i => i.track_inventory);
  if (!items.length) { toast('Create an inventory-tracked goods item first.', 'err'); return; }
  const REASONS = ['Stock recount', 'Damaged goods', 'Theft / loss', 'Returned to supplier', 'Found stock', 'Other'];
  formModal({
    title: 'New stock adjustment',
    body: `<div class="fgrid">${[
      fld({ name: 'date', label: 'Adjustment date', type: 'date', req: 1, value: APP.today }),
      fld({ name: 'item', label: 'Item', type: 'select', req: 1, opts: [['', 'Select…'], ...items.map(i => [i.id, i.name + ' (' + i.sku + ')'])], value: preItem || '' }),
      fld({ name: 'new_quantity', label: 'New quantity on hand', type: 'number', req: 1, attrs: 'min="0" step="0.001"' }),
      fld({ name: 'reason', label: 'Reason', type: 'select', req: 1, opts: [['', 'Select a reason'], ...REASONS] }),
      fld({ name: 'notes', label: 'Notes', type: 'textarea', col: 'c2', max: 1000 }),
    ].join('')}</div><div class="note" id="prev" style="margin-top:12px">Select an item and enter the new quantity to preview the change.</div>`,
    submit: 'Review & apply',
    onReady: form => {
      const upd = () => {
        const it = items.find(i => String(i.id) === form.elements.item.value), nq = form.elements.new_quantity.value;
        $('#prev', form).textContent = it && nq !== '' ? `${it.name}: ${qty(it.stock)} → ${qty(nq)} ${it.unit} (difference ${num(nq) - num(it.stock) >= 0 ? '+' : ''}${qty(num(nq) - num(it.stock))}, value ${inr((num(nq) - num(it.stock)) * num(it.purchase_price))})` : 'Select an item and enter the new quantity to preview the change.';
      };
      form.addEventListener('input', upd); form.addEventListener('change', upd); upd();
    },
    onSubmit: async d => {
      const it = items.find(i => String(i.id) === d.item);
      if (it && d.new_quantity !== '') {
        const ok = await confirmBox({ title: 'Apply stock adjustment?', message: `${it.name}: ${qty(it.stock)} → ${qty(d.new_quantity)}. This changes inventory immediately and can only be reversed by another adjustment.`, okText: 'Apply adjustment' });
        if (!ok) throw { cancel: true };
      }
      await api('stock-adjustments/', { method: 'POST', body: d });
      toast('Stock adjusted'); refresh();
    },
  });
}

/* organization  */
function orgForm() {
  const o = APP.org;
  formModal({
    title: 'Organization Profile & Settings', wide: true,
    body: `<div class="tabs-sub" style="display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid var(--bd-glass);padding-bottom:8px;">
      <button type="button" class="btn p org-tab-btn" data-otab="general">Company Profile</button>
      <button type="button" class="btn org-tab-btn" data-otab="template">Invoice & Bill Template</button>
    </div>
    <div id="otab-general" class="otab-pane">
      <div class="fgrid">
        ${fld({ name: 'name', label: 'Company / Organization Name', req: 1, value: o.name, col: 'c2' })}
        ${fld({ name: 'company_id', label: 'Company ID / CIN', value: o.company_id || '', ph: 'e.g. U62090KL2026PTC103900' })}
        ${fld({ name: 'gstin', label: 'GSTIN', value: o.gstin || '', ph: '32AANCC9298C1ZE' })}
        ${fld({ name: 'state', label: 'Home State', type: 'select', req: 1, opts: STATES, value: o.state })}
        ${fld({ name: 'address', label: 'Address / Building / Street', type: 'textarea', value: o.address, col: 'c2' })}
        ${fld({ name: 'city', label: 'City', value: o.city || 'Kottayam' })}
        ${fld({ name: 'pincode', label: 'Pincode', value: o.pincode || '686003' })}
        ${fld({ name: 'country', label: 'Country', value: o.country || 'India' })}
        ${fld({ name: 'phone', label: 'Phone', value: o.phone || '91-9847017737' })}
        ${fld({ name: 'email', label: 'Email', type: 'email', value: o.email || 'admin@convosis.com' })}
        ${fld({ name: 'website', label: 'Website', value: o.website || 'www.convosis.com' })}
        ${fld({ name: 'opening_cash', label: 'Opening Cash & Bank Balance (₹)', type: 'number', value: o.opening_cash, attrs: 'step="0.01"' })}
      </div>
      <div style="margin-top:14px;padding:14px;border:1px solid var(--bd-glass);border-radius:8px;display:flex;align-items:center;gap:18px;">
        <div style="width:72px;height:72px;border-radius:8px;border:1px solid var(--bd-glass);background:#fff;display:grid;place-items:center;overflow:hidden;padding:4px;">
          <img id="org-logo-preview" src="${esc(o.logo_data || '/static/books/img/convosis-logo.png')}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain;">
        </div>
        <div style="flex:1;">
          <label style="font-weight:600;font-size:13px;display:block;margin-bottom:4px;">Company Logo</label>
          <input type="file" id="org-logo-file" accept="image/*" style="display:none">
          <input type="hidden" name="logo_data" id="org-logo-input" value="${esc(o.logo_data || '/static/books/img/convosis-logo.png')}">
          <button type="button" class="btn" onclick="this.previousElementSibling.previousElementSibling.click()">Upload Logo</button>
          <button type="button" class="btn" id="reset-logo-btn" style="margin-left:6px;">Reset to Default</button>
          <div class="hp" style="margin-top:4px;">Recommended size: 240x80px PNG or JPG with transparent/white background.</div>
        </div>
      </div>
    </div>
    <div id="otab-template" class="otab-pane" style="display:none;">
      <div class="fgrid">
        ${fld({ name: 'template_theme', label: 'Default Template Style', type: 'select', opts: [['convosis', 'Convosis Classic (Standard Boxed)'], ['modern', 'Modern Ribbon (Dark Bar & Corner Ribbon)'], ['executive', 'Executive Indigo (Top Banner)'], ['minimal', 'Minimalist (Clean Lines)']], value: o.template_theme || 'convosis', col: 'c2' })}
        ${fld({ name: 'template_color', label: 'Template Accent Color', type: 'select', opts: [['#1877f2', 'Convosis Blue (#1877f2)'], ['#0d6efd', 'Royal Blue (#0d6efd)'], ['#10b981', 'Emerald Green (#10b981)'], ['#ff8a00', 'Vibrant Orange (#ff8a00)'], ['#6366f1', 'Indigo (#6366f1)'], ['#1e293b', 'Dark Slate (#1e293b)']], value: o.template_color || '#1877f2' })}
        ${fld({ name: 'signature_title', label: 'Signature Line Title', value: o.signature_title || 'Authorized Signature' })}
        ${fld({ name: 'terms_default', label: 'Default Terms & Conditions', type: 'textarea', value: o.terms_default || 'Due on Receipt', col: 'c2' })}
        ${fld({ name: 'notes_default', label: 'Default Notes', type: 'textarea', value: o.notes_default || 'Thanks for your business.', col: 'c2' })}
      </div>
    </div>`,
    onReady: form => {
      $$('.org-tab-btn', form).forEach(btn => {
        btn.addEventListener('click', () => {
          $$('.org-tab-btn', form).forEach(b => b.classList.remove('p'));
          btn.classList.add('p');
          const tab = btn.dataset.otab;
          $('#otab-general', form).style.display = tab === 'general' ? '' : 'none';
          $('#otab-template', form).style.display = tab === 'template' ? '' : 'none';
        });
      });
      const fIn = $('#org-logo-file', form);
      if (fIn) {
        fIn.addEventListener('change', () => {
          const file = fIn.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = e => {
            const imgObj = new Image();
            imgObj.onload = () => {
              const maxW = 600, maxH = 240;
              let w = imgObj.width, h = imgObj.height;
              if (w > maxW || h > maxH) {
                const ratio = Math.min(maxW / w, maxH / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
              }
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(imgObj, 0, 0, w, h);
              const dataUrl = canvas.toDataURL('image/png');
              $('#org-logo-preview', form).src = dataUrl;
              $('#org-logo-input', form).value = dataUrl;
            };
            imgObj.src = e.target.result;
          };
          reader.readAsDataURL(file);
        });
      }
      const resBtn = $('#reset-logo-btn', form);
      if (resBtn) {
        resBtn.addEventListener('click', () => {
          $('#org-logo-preview', form).src = '/static/books/img/convosis-logo.png';
          $('#org-logo-input', form).value = '/static/books/img/convosis-logo.png';
        });
      }
    },
    onSubmit: async d => {
      APP.org = await api('organization/', { method: 'PUT', body: d });
      applyOrg();
      toast('Organization settings updated');
      refresh();
    },
  });
}

