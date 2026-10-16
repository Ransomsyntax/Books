'use strict';

const $ = (s, e = document) => e.querySelector(s);
const $$ = (s, e = document) => Array.from(e.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const inr = v => { const n = num(v); return (n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const qty = v => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const fd = s => s ? String(s).split('-').reverse().join('/') : '—';
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = s => String(s || '').trim().toLowerCase();
const GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28, 40];
const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const APP = { org: { state: '' }, user: {}, today: iso(new Date()), counts: {} };

const pref = {
  get(k, d) { try { const v = localStorage.getItem('cvb_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cvb_' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};

function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = kind === 'err' ? 'err' : '';
  t.style.display = 'block';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.style.display = 'none'; }, kind === 'err' ? 5000 : 2600);
}

class ApiErr extends Error {
  constructor(status, data) {
    super((data && data.message) || ('Request failed (' + status + ')'));
    this.status = status;
    this.errors = (data && data.errors) || {};
  }
}
const csrf = () => { const m = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
const qs = o => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); }); return p.toString(); };

async function api(path, opt = {}) {
  const method = opt.method || 'GET';
  const init = { method, credentials: 'same-origin', headers: { 'Accept': 'application/json', 'X-CSRFToken': csrf() } };
  if (opt.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opt.body); }
  let res;
  try { res = await fetch('/api/' + path, init); } catch (e) { throw new ApiErr(0, { message: 'Network error: could not reach the server.' }); }
  if (res.status === 401) { location.href = '/accounts/login/?next=/'; throw new ApiErr(401, { message: 'Session expired.' }); }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON body */ }
  if (!res.ok) throw new ApiErr(res.status, data);
  return data;
}

const BADGE = { Paid: 'ok', Overdue: 'ba', 'Partially Paid': 'wa', Sent: 'in', Open: 'in', Draft: 'gr', Void: 'gr', Active: 'ok', Inactive: 'gr', 'Low stock': 'wa', 'Out of stock': 'ba' };
const badge = s => `<span class="st ${BADGE[s] || 'gr'}">${esc(s)}</span>`;
const spinner = '<div class="spin" role="status">Loading…</div>';
const errBox = (msg, retry) => `<div class="empty" role="alert"><div>${esc(msg)}${retry ? '<br><button class="btn" data-retry type="button" style="margin-top:8px">Retry</button>' : ''}</div></div>`;
