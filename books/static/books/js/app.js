'use strict';

const IC = { home: 'M3 11l9-8 9 8v10h-6v-6H9v6H3z', items: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10', inventory: 'M4 4h16v6H4zM4 14h16v6H4z', sales: 'M3 4h3l2 11h10l2-8H7', purchases: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 016 0v2', time: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18', banking: 'M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18', filing: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7', accountant: 'M12 4a3 3 0 100 6 3 3 0 000-6M5 20c0-4 3-6 7-6s7 2 7 6', reports: 'M5 20V10M12 20V4M19 20v-7', documents: 'M3 6h7l2 2h9v11H3z', pay: 'M3 7h18v10H3zM3 11h18' };
const NAV = [
  ['Home', 'home', ['Dashboard', 'Getting Started', 'Recent Updates']],
  ['Items', 'items', ['Items & Services', 'Item Categories', 'Price Lists']],
  ['Inventory', 'inventory', ['Inventory Summary', 'Stock Adjustments', 'Stock Movement', 'Warehouses']],
  ['Sales', 'sales', ['Customers', 'Sales Orders', 'Invoices', 'Recurring Invoices', 'Retainer Invoices', 'Delivery Challans', 'Payments Received', 'Credit Notes', 'E-Way Bills']],
  ['Purchases', 'purchases', ['Vendors', 'Expenses', 'Purchase Orders', 'Bills', 'Payments Made', 'Vendor Credits']],
  ['Time Tracking', 'time', ['Projects', 'Timesheets']],
  ['Banking', 'banking', ['Bank Accounts', 'Transactions', 'Bank Reconciliation', 'Transfers']],
  ['Filing & Compliance', 'filing', ['GST Filing', 'GSTR-1 Summary', 'GSTR-3B Summary', 'Input Tax Credit Summary', 'Tax Liability Summary']],
  ['Accountant', 'accountant', ['Manual Journals', 'Chart of Accounts', 'Transaction Locking']],
  ['Reports', 'reports', ['Reports Center', 'Business Overview', 'Sales Reports', 'Purchase Reports', 'Inventory Reports', 'Receivables', 'Payables', 'Tax Reports', 'Accounting Reports', 'Cash Flow Reports']],
  ['Documents', 'documents', ['All Documents', 'Files', 'Bank Statements', 'Folders', 'Trash']],
  ['Convosis Payments', 'pay', ['Payment Overview', 'Payment Transactions', 'Payment Settings']],
];
const ROUTES = {
  'home/dashboard': r => renderDashboard(r), 'home/getting-started': gettingStarted, 'home/recent-updates': recentUpdates,
  'sales/customers': r => listPage(r, LISTS.customers), 'sales/invoices': r => docMasterDetail(r, 'invoices'), 'sales/payments-received': r => listPage(r, LISTS['payments-received']),
  'purchases/vendors': r => listPage(r, LISTS.vendors), 'purchases/bills': r => docMasterDetail(r, 'bills'), 'purchases/payments-made': r => listPage(r, LISTS['payments-made']),
  'items/items-services': r => listPage(r, LISTS.items),
  'inventory/inventory-summary': r => listPage(r, LISTS.inventory), 'inventory/stock-adjustments': r => listPage(r, LISTS.adjustments), 'inventory/stock-movement': r => listPage(r, LISTS.movements),
};
const PASTEL = {
  home: 'icon-sky',
  items: 'icon-indigo',
  inventory: 'icon-peach',
  sales: 'icon-sky',
  purchases: 'icon-peach',
  time: 'icon-mint',
  banking: 'icon-mint',
  filing: 'icon-lavender',
  accountant: 'icon-indigo',
  reports: 'icon-lavender',
  documents: 'icon-sky',
  pay: 'icon-rose'
};
let openG = pref.get('open', ['home']);

function drawNav(cur) {
  const items = NAV.map(([l, k, ch], i) => `${i === 11 ? '<div class="sec">APPS</div>' : ''}<div class="ni ${openG.includes(k) ? 'open' : ''} ${cur.startsWith(k + '/') ? 'act' : ''}"><button type="button" data-g="${k}" aria-expanded="${openG.includes(k)}"><div class="nav-pastel-icon ${PASTEL[k] || 'icon-sky'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${IC[k]}"/></svg></div><span class="lb">${esc(l)}</span>${k === 'home' ? '<span class="pastel-chip chip-sky">Live</span>' : ''}<svg class="ar" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button><div class="ch">${ch.map(c => `<a href="#/${k}/${slug(c)}" class="${cur === k + '/' + slug(c) ? 'on' : ''}" ${cur === k + '/' + slug(c) ? 'aria-current="page"' : ''}>${esc(c)}</a>`).join('')}</div></div>`).join('');
  const footer = `<div class="sidebar-footer"><div class="user-snippet" onclick="orgForm()"><div class="user-avatar-badge" id="sidebarUserAvatar">${esc((APP.user.name || 'A')[0].toUpperCase())}</div><div class="user-info"><span class="user-name" id="sidebarUserName">${esc(APP.user.name || APP.user.username || 'Admin')}</span><span class="user-role-tag"><span style="width:6px; height:6px; background:var(--accent); border-radius:50%; display:inline-block;"></span><span>Owner / Admin</span></span></div></div></div>`;
  $('#side').innerHTML = items + footer;
}

function route() {
  destroyCharts(); PAGE.reload = null;
  const h = location.hash.slice(2) || 'home/dashboard', pg = $('#pg'), root = document.createElement('div');
  pg.replaceChildren(root);
  drawNav(h);
  document.body.classList.remove('mo');
  closePops();
  const fn = ROUTES[h];
  if (fn) { Promise.resolve().then(() => fn(root)).catch(e => { root.innerHTML = errBox(e.message); console.error(e); }); }
  else { const g = NAV.find(n => h.startsWith(n[1] + '/')), nm = g && g[2].find(c => slug(c) === h.split('/')[1]); plannedPage(root, g && g[0], nm); }
  window.scrollTo(0, 0);
}
async function refresh() { try { await loadMe(); } catch (e) { /* keep stale header */ } if (PAGE.reload) PAGE.reload(); else route(); }

async function loadMe() {
  const me = await api('me/');
  APP.user = me.user; APP.org = me.organization; APP.today = me.today; APP.counts = me.counts;
  applyOrg();
}
function applyOrg() {
  const [y, m] = APP.today.split('-').map(Number), fy = m >= 4 ? y : y - 1;
  $('#orgname').textContent = APP.org.name;
  $('#orgfy').textContent = `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
  $('#um').textContent = (APP.user.name || 'A')[0].toUpperCase();
  $('#who').textContent = 'Signed in as ' + (APP.user.username || '');
  const av = $('#sidebarUserAvatar'); if (av) av.textContent = (APP.user.name || 'A')[0].toUpperCase();
  const un = $('#sidebarUserName'); if (un) un.textContent = APP.user.name || APP.user.username || 'Admin';
}

/* menus */
const closePops = () => {
  $$('.pop.on').forEach(p => { p.classList.remove('on'); p.style.display = ''; });
  $$('.user-menu-wrap.open').forEach(w => w.classList.remove('open'));
};
const QC = [['Customer', () => partyForm('customers')], ['Vendor', () => partyForm('vendors')], ['Invoice', () => docForm('invoices')], ['Bill', () => docForm('bills')], ['Payment received', () => paymentForm('payments-received')], ['Payment made', () => paymentForm('payments-made')], ['Item', () => itemForm()], ['Stock adjustment', () => adjustForm()]];
$('#qcm').innerHTML = QC.map((q, i) => `<button class="mi" type="button" data-q="${i}">New ${esc(q[0].toLowerCase())}</button>`).join('');

(function initUserMenuHover() {
  const wrap = $('#userMenuWrapper') || $('#um')?.closest('.user-menu-wrap') || $('#um')?.closest('.rel');
  const menu = $('#umm');
  if (!wrap || !menu) return;
  let timer = null;

  wrap.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    menu.classList.add('on');
    wrap.classList.add('open');
  });

  wrap.addEventListener('mouseleave', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      menu.classList.remove('on');
      wrap.classList.remove('open');
    }, 180);
  });
})();

function openRecord(t, id) {
  const M = { customer: ['sales/customers', () => partyDetail('customers', id)], vendor: ['purchases/vendors', () => partyDetail('vendors', id)], invoice: ['sales/invoices', () => docMasterDetail($('#pg'), 'invoices', id)], bill: ['purchases/bills', () => docMasterDetail($('#pg'), 'bills', id)], item: ['items/items-services', () => itemForm(id)] };
  const [r, fn] = M[t];
  if (location.hash !== '#/' + r) location.hash = '#/' + r;
  fn().catch(e => toast(e.message, 'err'));
}

document.addEventListener('click', async e => {
  const t = e.target;
  const tog = (btn, pop) => {
    if (!t.closest(btn)) return false;
    const p = $(pop);
    if (!p) return false;
    const on = p.classList.contains('on');
    closePops();
    if (!on) {
      p.classList.add('on');
      const w = p.closest('.user-menu-wrap');
      if (w) w.classList.add('open');
    }
    return true;
  };
  if (tog('#qc', '#qcm') || tog('#um', '#umm')) return;
  const q = t.closest('[data-q]');
  if (q) { closePops(); QC[q.dataset.q][1]().catch(err => toast(err.message, 'err')); return; }
  const sr = t.closest('#qr [data-t]');
  if (sr) { closePops(); $('#q').value = ''; openRecord(sr.dataset.t, sr.dataset.id); return; }
  const a = t.closest('[data-a]');
  if (a && a.closest('#umm')) {
    closePops();
    if (a.dataset.a === 'org') orgForm();
    if (a.dataset.a === 'logout') { try { await fetch('/accounts/logout/', { method: 'POST', headers: { 'X-CSRFToken': csrf() }, credentials: 'same-origin' }); } finally { location.href = '/accounts/login/'; } }
    return;
  }
  if (!t.closest('.pop')) closePops();
  const g = t.closest('[data-g]');
  if (g) { const k = g.dataset.g; openG = openG.includes(k) ? openG.filter(x => x !== k) : [...openG, k]; pref.set('open', openG); document.body.classList.remove('col'); drawNav(location.hash.slice(2) || 'home/dashboard'); return; }
  if (t.closest('#burger')) { innerWidth <= 900 ? document.body.classList.toggle('mo') : document.body.classList.toggle('col'); return; }
  if (t.closest('#orgbtn')) orgForm();
  if (t.closest('[data-retry]') && PAGE.reload) PAGE.reload();
});
const rfshBtn = $('#rfsh');
if (rfshBtn) rfshBtn.addEventListener('click', () => { refresh(); toast('Refreshed'); });

let qt;
$('#q').addEventListener('input', e => {
  clearTimeout(qt);
  const v = e.target.value.trim(), box = $('#qr');
  if (v.length < 2) { box.classList.remove('on'); return; }
  qt = setTimeout(async () => {
    try {
      const r = await api('search/?' + qs({ q: v }));
      if ($('#q').value.trim() !== v) return;
      box.innerHTML = r.length ? r.map(x => `<button class="mi" type="button" data-t="${esc(x.type)}" data-id="${esc(x.id)}"><b>${esc(x.label)}</b> <span class="sub">${esc(x.sub)}</span></button>`).join('') : '<div class="sub" style="padding:8px">No results</div>';
      box.classList.add('on');
    } catch (err) { /* search is best-effort */ }
  }, 220);
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !Modal.count()) { e.preventDefault(); $('#q').focus(); }
  if (e.key === 'Escape') closePops();
});

loadMe().then(() => { route(); addEventListener('hashchange', route); }).catch(err => {
  $('#pg').innerHTML = errBox('Could not load the application: ' + err.message, false);
});
