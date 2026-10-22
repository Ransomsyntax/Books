"""JSON API (session-authenticated, CSRF-protected). One Resource class per entity."""
import csv
import json
from datetime import timedelta
from decimal import Decimal
from functools import wraps

from django.core.paginator import Paginator
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import F, ProtectedError, Q
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from . import services
from .calc import GST_SLABS, compute, is_intra_state, q2
from .cleaning import GSTIN_RE, PAN_RE, ApiError, Cleaner
from .models import (Attachment, Bill, BillAllocation, BillLine, Customer, Invoice, InvoiceLine, Item, MODES,
                     Organization, PaymentMade, PaymentReceived, ReceivedAllocation, StockMovement, Vendor)
from .services import bill_qs, invoice_qs, next_number, paid_expr

Z = Decimal('0.00')
MODE_KEYS = [m[0] for m in MODES]
MODE_LABEL = dict(MODES)
REASONS = ['Stock recount', 'Damaged goods', 'Theft / loss', 'Returned to supplier', 'Found stock', 'Other']


def j(data, status=200):
    return JsonResponse(data, status=status, encoder=DjangoJSONEncoder, safe=False)


def body(request):
    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, 'Invalid JSON body.')
    if not isinstance(data, dict):
        raise ApiError(400, 'Expected a JSON object.')
    return data


def api_view(fn):
    @wraps(fn)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return j({'message': 'Authentication required.'}, 401)
        try:
            return fn(request, *args, **kwargs)
        except ApiError as e:
            return j({'message': e.message, 'errors': e.errors}, e.status)
        except ProtectedError:
            return j({'message': 'This record is used by other transactions and cannot be deleted. Mark it inactive instead.'}, 409)
    return wrapper


def safe_cell(v):
    if isinstance(v, str) and v[:1] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + v
    return v


def parse_range(request):
    today = timezone.localdate()
    c = Cleaner(request.GET.dict())
    fy = today.year if today.month >= 4 else today.year - 1
    start = c.date('start', default=today.replace(year=fy, month=4, day=1))
    end = c.date('end', default=today)
    c.done('Invalid date range.')
    if start > end:
        raise ApiError(400, 'Start date must not be after end date.')
    if (end.year - start.year) * 12 + end.month - start.month >= 24:
        raise ApiError(400, 'Choose a range of 24 months or less.')
    return start, end


class Resource:
    name = ''
    model = None
    search_fields = ()
    orderings = {}
    default_ordering = ('-id',)
    csv_cols = ()

    def base_qs(self):
        return self.model.objects.all()

    def filter_qs(self, qs, request):
        return qs

    def rows(self, objs):
        return [self.row(o) for o in objs]

    def row(self, o):
        raise NotImplementedError

    def detail(self, o):
        return self.row(o)

    def get_object(self, pk):
        obj = self.base_qs().filter(pk=pk).first()
        if obj is None:
            raise ApiError(404, 'Not found.')
        return obj

    def create(self, data, user):
        raise ApiError(405, 'Creating this record is not supported.')

    def update(self, obj, data, user):
        raise ApiError(405, 'Editing this record is not supported.')

    def destroy(self, obj):
        obj.delete()

    def action(self, request, obj, name):
        raise ApiError(404, 'Unknown action.')

    def queryset(self, request):
        qs = self.filter_qs(self.base_qs(), request)
        q = request.GET.get('q', '').strip()
        if q and self.search_fields:
            cond = Q()
            for f in self.search_fields:
                cond |= Q(**{f + '__icontains': q})
            qs = qs.filter(cond)
        o = request.GET.get('ordering', '')
        key = o.lstrip('-')
        if key in self.orderings:
            qs = qs.order_by(('-' if o.startswith('-') else '') + self.orderings[key], '-id')
        else:
            qs = qs.order_by(*self.default_ordering)
        return qs

    def export(self, qs):
        resp = HttpResponse(content_type='text/csv; charset=utf-8')
        resp['Content-Disposition'] = f'attachment; filename="{self.name}.csv"'
        w = csv.writer(resp)
        w.writerow([h for h, _ in self.csv_cols])
        for r in self.rows(list(qs)):
            w.writerow([safe_cell(r.get(k, '')) for _, k in self.csv_cols])
        return resp

    def handle_collection(self, request):
        if request.method == 'GET':
            qs = self.queryset(request)
            if request.GET.get('export') == 'csv':
                return self.export(qs)
            try:
                size = min(max(int(request.GET.get('page_size', 10)), 1), 100)
            except ValueError:
                size = 10
            pag = Paginator(qs, size)
            page = pag.get_page(request.GET.get('page') or 1)
            return j({'count': pag.count, 'page': page.number, 'pages': pag.num_pages,
                      'page_size': size, 'results': self.rows(list(page.object_list))})
        if request.method == 'POST':
            with transaction.atomic():
                obj = self.create(body(request), request.user)
            return j(self.detail(self.get_object(obj.pk)), 201)
        raise ApiError(405, 'Method not allowed.')

    def handle_item(self, request, pk):
        obj = self.get_object(pk)
        if request.method == 'GET':
            return j(self.detail(obj))
        if request.method in ('PUT', 'PATCH'):
            with transaction.atomic():
                self.update(obj, body(request), request.user)
            return j(self.detail(self.get_object(pk)))
        if request.method == 'DELETE':
            with transaction.atomic():
                self.destroy(obj)
            return HttpResponse(status=204)
        raise ApiError(405, 'Method not allowed.')

    def handle_action(self, request, pk, name):
        if request.method != 'POST':
            raise ApiError(405, 'Method not allowed.')
        obj = self.get_object(pk)
        with transaction.atomic():
            self.action(request, obj, name)
        return j(self.detail(self.get_object(pk)))


# ====================================================================== parties
def party_stats(kind, ids):
    """kind 'customer'|'vendor' -> {id: {billed, outstanding, overdue}} from posted documents."""
    today = timezone.localdate()
    out = {i: {'billed': Z, 'outstanding': Z, 'overdue': Z} for i in ids}
    if kind == 'customer':
        qs = invoice_qs().filter(customer_id__in=ids, status='sent')
        key = 'customer_id'
    else:
        qs = bill_qs().filter(vendor_id__in=ids, status='open')
        key = 'vendor_id'
    for d in qs:
        s = out[getattr(d, key)]
        bal = d.total - q2(d.paid_sum)
        s['billed'] += d.total
        s['outstanding'] += bal
        if bal > 0 and d.due_date < today:
            s['overdue'] += bal
    return out


class PartyResource(Resource):
    kind = ''
    search_fields = ('name', 'company', 'email', 'phone', 'gstin')
    orderings = {'name': 'name', 'state': 'state', 'created': 'created_at'}
    default_ordering = ('name',)

    def filter_qs(self, qs, request):
        a = request.GET.get('active')
        if a in ('0', '1'):
            qs = qs.filter(active=(a == '1'))
        return qs

    def extra(self, c):
        return {}

    def clean(self, data):
        c = Cleaner(data)
        out = {
            'name': c.text('name', True, 200), 'company': c.text('company', max_len=200),
            'contact_person': c.text('contact_person', max_len=120),
            'email': c.text('email', max_len=254, email=True), 'phone': c.text('phone', max_len=20, phone=True),
            'billing_address': c.text('billing_address', max_len=1000), 'state': c.text('state', max_len=60),
            'gstin': c.text('gstin', max_len=15, upper=True, pattern=GSTIN_RE, pattern_msg='Enter a valid 15-character GSTIN.'),
            'pan': c.text('pan', max_len=10, upper=True, pattern=PAN_RE, pattern_msg='Enter a valid 10-character PAN.'),
            'payment_terms': c.integer('payment_terms', 0, 365, 30),
            'notes': c.text('notes', max_len=2000), 'active': c.boolean('active', True),
        }
        out.update(self.extra(c))
        c.done()
        return out

    def create(self, data, user):
        return self.model.objects.create(**self.clean(data))

    def update(self, obj, data, user):
        for k, v in self.clean(data).items():
            setattr(obj, k, v)
        obj.save()

    def rows(self, objs):
        stats = party_stats(self.kind, [o.pk for o in objs])
        return [self.row(o, stats[o.pk]) for o in objs]

    def detail(self, o):
        return self.row(o, party_stats(self.kind, [o.pk])[o.pk])

    def row(self, o, s):
        r = {'id': o.pk, 'name': o.name, 'company': o.company, 'contact_person': o.contact_person, 'email': o.email,
             'phone': o.phone, 'billing_address': o.billing_address, 'state': o.state, 'gstin': o.gstin, 'pan': o.pan,
             'payment_terms': o.payment_terms, 'notes': o.notes, 'active': o.active,
             'billed': s['billed'], 'outstanding': s['outstanding'], 'overdue': s['overdue']}
        if self.kind == 'customer':
            r['shipping_address'] = o.shipping_address
        return r


class CustomerResource(PartyResource):
    name = 'customers'
    model = Customer
    kind = 'customer'
    csv_cols = [('Name', 'name'), ('Company', 'company'), ('Email', 'email'), ('Phone', 'phone'), ('State', 'state'),
                ('GSTIN', 'gstin'), ('PAN', 'pan'), ('Payment terms (days)', 'payment_terms'),
                ('Billed', 'billed'), ('Receivable', 'outstanding'), ('Overdue', 'overdue'), ('Active', 'active')]

    def extra(self, c):
        return {'shipping_address': c.text('shipping_address', max_len=1000)}


class VendorResource(PartyResource):
    name = 'vendors'
    model = Vendor
    kind = 'vendor'
    csv_cols = [('Name', 'name'), ('Company', 'company'), ('Email', 'email'), ('Phone', 'phone'), ('State', 'state'),
                ('GSTIN', 'gstin'), ('PAN', 'pan'), ('Payment terms (days)', 'payment_terms'),
                ('Billed', 'billed'), ('Payable', 'outstanding'), ('Overdue', 'overdue'), ('Active', 'active')]


# ====================================================================== items
class ItemResource(Resource):
    name = 'items'
    model = Item
    search_fields = ('name', 'sku', 'category', 'hsn_sac')
    orderings = {'name': 'name', 'sku': 'sku', 'selling_price': 'selling_price', 'stock': 'stock', 'created': 'created_at'}
    default_ordering = ('name',)
    csv_cols = [('Name', 'name'), ('SKU', 'sku'), ('Type', 'type'), ('Category', 'category'), ('HSN/SAC', 'hsn_sac'),
                ('Unit', 'unit'), ('Selling price', 'selling_price'), ('Purchase price', 'purchase_price'),
                ('GST %', 'gst_rate'), ('Stock', 'stock'), ('Reorder level', 'reorder_level'),
                ('Stock value', 'valuation'), ('Status', 'status')]

    def filter_qs(self, qs, request):
        g = request.GET
        if g.get('type') in ('goods', 'service'):
            qs = qs.filter(item_type=g['type'])
        if g.get('category'):
            qs = qs.filter(category=g['category'])
        if g.get('active') in ('0', '1'):
            qs = qs.filter(active=(g['active'] == '1'))
        if g.get('tracked') == '1':
            qs = qs.filter(item_type='goods', track_inventory=True)
        if g.get('stock') == 'out':
            qs = qs.filter(item_type='goods', track_inventory=True, stock__lte=0)
        elif g.get('stock') == 'low':
            qs = qs.filter(item_type='goods', track_inventory=True, stock__gt=0, reorder_level__gt=0, stock__lte=F('reorder_level'))
        return qs

    def row(self, o):
        tracked = o.item_type == 'goods' and o.track_inventory
        if not o.active:
            status = 'Inactive'
        elif tracked and o.stock <= 0:
            status = 'Out of stock'
        elif tracked and o.reorder_level > 0 and o.stock <= o.reorder_level:
            status = 'Low stock'
        else:
            status = 'Active'
        return {'id': o.pk, 'name': o.name, 'sku': o.sku, 'type': o.item_type, 'category': o.category, 'hsn_sac': o.hsn_sac,
                'unit': o.unit, 'description': o.description, 'selling_price': o.selling_price,
                'purchase_price': o.purchase_price, 'gst_rate': o.gst_rate, 'track_inventory': tracked,
                'stock': o.stock if tracked else None, 'reorder_level': o.reorder_level if tracked else None,
                'valuation': q2(o.stock * o.purchase_price) if tracked else None, 'active': o.active, 'status': status,
                'image_data': o.image_data, 'tax_preference': o.tax_preference,
                'sales_account': o.sales_account, 'purchase_account': o.purchase_account,
                'preferred_vendor_id': o.preferred_vendor_id,
                'preferred_vendor_name': o.preferred_vendor.name if o.preferred_vendor else '',
                'inventory_account': o.inventory_account}

    def clean(self, data, instance=None):
        c = Cleaner(data)
        out = {
            'name': c.text('name', True, 200), 'sku': c.text('sku', True, 60, upper=True),
            'item_type': c.choice('item_type', ['goods', 'service'], 'goods'),
            'category': c.text('category', max_len=100), 'hsn_sac': c.text('hsn_sac', max_len=10),
            'unit': c.text('unit', max_len=20, default='nos') or 'nos', 'description': c.text('description', max_len=2000),
            'selling_price': c.number('selling_price', lo=Decimal('0'), hi=Decimal('999999999')),
            'purchase_price': c.number('purchase_price', lo=Decimal('0'), hi=Decimal('999999999')),
            'gst_rate': c.number('gst_rate', default=Decimal('18.00')),
            'track_inventory': c.boolean('track_inventory'),
            'reorder_level': c.number('reorder_level', lo=Decimal('0'), hi=Decimal('99999999'), places=3),
            'active': c.boolean('active', True),
            'image_data': c.text('image_data', max_len=2000000),
            'tax_preference': c.choice('tax_preference', ['taxable', 'non_taxable', 'exempt', 'nil_rated'], 'taxable'),
            'sales_account': c.text('sales_account', max_len=100) or 'Sales',
            'purchase_account': c.text('purchase_account', max_len=100) or 'Cost of Goods Sold',
            'inventory_account': c.text('inventory_account', max_len=100) or 'Inventory Asset',
        }
        vid = c.integer('preferred_vendor_id', required=False)
        if vid is None:
            vid = c.integer('preferred_vendor', required=False)
        out['preferred_vendor_id'] = vid if vid and Vendor.objects.filter(pk=vid).exists() else None
        if out['gst_rate'] < Decimal('0') or out['gst_rate'] > Decimal('100'):
            c.err('gst_rate', 'GST rate must be between 0% and 100%.')
        if out['sku']:
            dup = Item.objects.filter(sku__iexact=out['sku'])
            if instance:
                dup = dup.exclude(pk=instance.pk)
            if dup.exists():
                c.err('sku', 'This SKU is already in use.')
        opening = c.number('opening_stock', lo=Decimal('0'), hi=Decimal('99999999'), places=3)
        c.done()
        if out['item_type'] == 'service':
            out['track_inventory'] = False
            out['reorder_level'] = Decimal('0.000')
            opening = Decimal('0.000')
        if not out['track_inventory']:
            opening = Decimal('0.000')
        return out, opening

    def create(self, data, user):
        out, opening = self.clean(data)
        obj = Item.objects.create(**out)
        if opening > 0:
            services.move_stock(obj.pk, opening, 'opening', 'Opening stock', timezone.localdate(), user, 'Opening stock')
        return obj

    def update(self, obj, data, user):
        out, _ = self.clean(data, obj)
        if out['item_type'] == 'service' and obj.stock != 0:
            raise ApiError(400, 'Adjust stock to zero before changing this item to a service.', {'item_type': 'Stock must be zero.'})
        for k, v in out.items():
            setattr(obj, k, v)
        obj.save()


# ====================================================================== documents
def parse_lines(raw):
    msg = 'Add at least one line item.'
    if not isinstance(raw, list) or not raw:
        raise ApiError(400, msg, {'lines': msg})
    if len(raw) > 200:
        raise ApiError(400, 'Too many lines (max 200).', {'lines': 'Too many lines (max 200).'})
    out, errors = [], []
    for i, r in enumerate(raw, 1):
        c = Cleaner(r)
        iid = c.integer('item', lo=1, default=None)
        item = None
        if iid:
            item = Item.objects.filter(pk=iid).first()
            if item is None:
                c.err('item', 'Item not found.')
        desc = c.text('description', max_len=500) or (item.name if item else '')
        if not desc:
            c.err('description', 'Description is required.')
        hsn = c.text('hsn_sac', max_len=10) or (item.hsn_sac if item else '')
        qty = c.number('quantity', True, lo=Decimal('0.001'), hi=Decimal('99999999'), places=3)
        rate = c.number('rate', True, lo=Decimal('0'), hi=Decimal('999999999'))
        disc = c.number('discount_percent', lo=Decimal('0'), hi=Decimal('100'))
        gst = c.number('gst_rate', default=Decimal('0'))
        if gst < Decimal('0') or gst > Decimal('100'):
            c.err('gst_rate', 'GST rate must be between 0% and 100%.')
        if c.errors:
            errors.append(f'Line {i}: ' + '; '.join(f'{k} - {m}' for k, m in c.errors.items()))
        else:
            out.append({'item': item, 'description': desc, 'hsn_sac': hsn, 'quantity': qty, 'rate': rate,
                        'discount_percent': disc, 'gst_rate': gst, 'position': i})
    if errors:
        raise ApiError(400, 'Please correct the line items.', {'lines': ' | '.join(errors)})
    return out


def display_status(doc, posted, today):
    if doc.status == 'draft':
        return 'Draft'
    if doc.status == 'void':
        return 'Void'
    paid = q2(doc.paid_sum)
    if doc.total - paid <= 0:
        return 'Paid'
    if doc.due_date < today:
        return 'Overdue'
    return 'Partially Paid' if paid > 0 else ('Sent' if posted == 'sent' else 'Open')


class DocResource(Resource):
    Model = Line = Party = None
    party_attr = line_fk = prefix = posted = ''
    search_fields = ()
    orderings = {'date': 'date', 'due_date': 'due_date', 'number': 'number', 'total': 'total', 'created': 'created_at'}
    default_ordering = ('-date', '-id')
    send_action = ''

    @property
    def model(self):
        return self.Model

    def base_qs(self):
        return (invoice_qs() if self.Model is Invoice else bill_qs())

    def filter_qs(self, qs, request):
        g, today, P = request.GET, timezone.localdate(), self.posted
        st = g.get('status', '')
        if st == 'draft':
            qs = qs.filter(status='draft')
        elif st == 'void':
            qs = qs.filter(status='void')
        elif st == 'paid':
            qs = qs.filter(status=P, paid_sum__gte=F('total'))
        elif st == 'overdue':
            qs = qs.filter(status=P, paid_sum__lt=F('total'), due_date__lt=today)
        elif st == 'partial':
            qs = qs.filter(status=P, paid_sum__gt=0, paid_sum__lt=F('total'), due_date__gte=today)
        elif st == 'unpaid':
            qs = qs.filter(status=P, paid_sum=0, due_date__gte=today)
        if g.get('open') == '1':
            qs = qs.filter(status=P, paid_sum__lt=F('total'))
        pid = g.get(self.party_attr)
        if pid and pid.isdigit():
            qs = qs.filter(**{self.party_attr + '_id': int(pid)})
        c = Cleaner(g.dict())
        d1, d2 = c.date('date_from'), c.date('date_to')
        if d1:
            qs = qs.filter(date__gte=d1)
        if d2:
            qs = qs.filter(date__lte=d2)
        return qs

    def party(self, o):
        return getattr(o, self.party_attr)

    def row(self, o):
        paid = q2(o.paid_sum)
        etype = 'invoice' if isinstance(o, Invoice) else 'bill'
        att_count = Attachment.objects.filter(entity_type=etype, entity_id=o.pk).count()
        return {'id': o.pk, 'number': o.number, 'party_id': self.party(o).pk, 'party': self.party(o).name,
                'date': o.date, 'due_date': o.due_date, 'place_of_supply': o.place_of_supply,
                'order_number': getattr(o, 'order_number', '') or '', 'attachment_count': att_count,
                'status': display_status(o, self.posted, timezone.localdate()), 'raw_status': o.status,
                'subtotal': o.subtotal, 'total': o.total, 'paid': paid, 'balance': o.total - paid if o.status == self.posted else Z}

    def detail(self, o):
        r = self.row(o)
        etype = 'invoice' if isinstance(o, Invoice) else 'bill'
        party = self.party(o)
        attachments = [
            {'id': a.pk, 'filename': a.filename, 'file_size': a.file_size, 'mime_type': a.mime_type,
             'url': a.file.url if a.file else a.file_data, 'file_data': a.file_data, 'created_at': a.created_at}
            for a in Attachment.objects.filter(entity_type=etype, entity_id=o.pk)
        ]
        party_info = {
            'id': party.pk, 'name': party.name, 'company': party.company,
            'email': party.email, 'phone': party.phone, 'gstin': party.gstin,
            'billing_address': party.billing_address, 'state': party.state,
        }
        if hasattr(party, 'shipping_address'):
            party_info['shipping_address'] = party.shipping_address
        r.update({'cgst': o.cgst, 'sgst': o.sgst, 'igst': o.igst, 'notes': o.notes,
                  'order_number': getattr(o, 'order_number', '') or '',
                  'intra_state': is_intra_state(o.place_of_supply, Organization.get().state),
                  'attachments': attachments, 'party_details': party_info,
                  'lines': [{'id': l.pk, 'item': l.item_id, 'description': l.description, 'hsn_sac': l.hsn_sac,
                             'quantity': l.quantity, 'rate': l.rate, 'discount_percent': l.discount_percent,
                             'gst_rate': l.gst_rate, 'taxable': l.taxable, 'tax_amount': l.tax_amount,
                             'line_total': l.line_total} for l in o.lines.all()],
                  'payments': [{'payment_id': a.payment_id, 'number': a.payment.number, 'date': a.payment.date,
                                'amount': a.amount} for a in o.allocations.select_related('payment')]})
        r.update(self.extra_detail(o))
        return r

    def extra_detail(self, o):
        return {}

    def extra_clean(self, c):
        return {}

    def parse(self, data):
        c = Cleaner(data)
        org = Organization.get()
        pid = c.integer(self.party_attr, lo=1, required=True)
        party = self.Party.objects.filter(pk=pid).first() if pid else None
        if pid and party is None:
            c.err(self.party_attr, 'Not found.')
        date_ = c.date('date', required=True)
        due = c.date('due_date')
        if party and not party.active:
            c.err(self.party_attr, 'This record is inactive.')
        if date_ and not due and party:
            due = date_ + timedelta(days=party.payment_terms)
        if date_ and due and due < date_:
            c.err('due_date', 'Due date cannot be before the document date.')
        pos = c.text('place_of_supply', max_len=60) or (party.state if party and party.state else org.state)
        head = {self.party_attr: party, 'date': date_, 'due_date': due, 'place_of_supply': pos,
                'notes': c.text('notes', max_len=2000)}
        head.update(self.extra_clean(c))
        c.done()
        return head, parse_lines(data.get('lines'))

    def write(self, obj, head, lines):
        intra = is_intra_state(head['place_of_supply'], Organization.get().state)
        comp, tot = compute(lines, intra)
        for k, v in head.items():
            setattr(obj, k, v)
        for k, v in tot.items():
            setattr(obj, k, v)
        obj.save()
        obj.lines.all().delete()
        self.Line.objects.bulk_create([self.Line(**{self.line_fk: obj}, item=l['item'], description=l['description'],
                                                 hsn_sac=l['hsn_sac'], quantity=l['quantity'], rate=l['rate'],
                                                 discount_percent=l['discount_percent'], gst_rate=l['gst_rate'],
                                                 taxable=l['taxable'], tax_amount=l['tax_amount'],
                                                 line_total=l['line_total'], position=l['position']) for l in comp])

    def create(self, data, user):
        head, lines = self.parse(data)
        obj = self.Model(number=next_number(self.prefix), status='draft')
        self.write(obj, head, lines)
        return obj

    def update(self, obj, data, user):
        is_inv = isinstance(obj, Invoice)
        if obj.status != 'draft':
            if not data.get('force'):
                raise ApiError(409, 'Only drafts can be edited. Void this document and create a new one.')
            if is_inv and obj.status == 'sent':
                services.apply_stock(obj, +1, 'sale_void', user)
            elif not is_inv and obj.status == 'open':
                services.apply_stock(obj, -1, 'purchase_void', user)
            head, lines = self.parse(data)
            self.write(obj, head, lines)
            if is_inv and obj.status == 'sent':
                services.apply_stock(obj, -1, 'sale', user)
            elif not is_inv and obj.status == 'open':
                services.apply_stock(obj, +1, 'purchase', user)
            return
        head, lines = self.parse(data)
        self.write(obj, head, lines)

    def destroy(self, obj):
        is_inv = isinstance(obj, Invoice)
        if obj.status != 'draft':
            if is_inv and obj.status == 'sent':
                services.apply_stock(obj, +1, 'sale_void', None)
            elif not is_inv and obj.status == 'open':
                services.apply_stock(obj, -1, 'purchase_void', None)
            obj.allocations.all().delete()
        Attachment.objects.filter(entity_type='invoice' if is_inv else 'bill', entity_id=obj.pk).delete()
        obj.delete()


class InvoiceResource(DocResource):
    name = 'invoices'
    Model, Line, Party = Invoice, InvoiceLine, Customer
    party_attr, line_fk, prefix, posted = 'customer', 'invoice', 'INV', 'sent'
    search_fields = ('number', 'customer__name')
    csv_cols = [('Invoice#', 'number'), ('Customer', 'party'), ('Date', 'date'), ('Due date', 'due_date'),
                ('Status', 'status'), ('Taxable', 'subtotal'), ('Total', 'total'), ('Paid', 'paid'), ('Balance', 'balance')]

    def extra_clean(self, c):
        return {'terms': c.text('terms', max_len=2000), 'order_number': c.text('order_number', max_len=60)}

    def extra_detail(self, o):
        return {'terms': o.terms, 'order_number': o.order_number}

    def action(self, request, obj, name):
        if name == 'send':
            services.send_invoice(obj, request.user)
        elif name == 'void':
            services.void_invoice(obj, request.user)
        else:
            raise ApiError(404, 'Unknown action.')


class BillResource(DocResource):
    name = 'bills'
    Model, Line, Party = Bill, BillLine, Vendor
    party_attr, line_fk, prefix, posted = 'vendor', 'bill', 'BILL', 'open'
    search_fields = ('number', 'vendor__name', 'vendor_ref')
    csv_cols = [('Bill#', 'number'), ('Vendor', 'party'), ('Date', 'date'), ('Due date', 'due_date'),
                ('Status', 'status'), ('Taxable', 'subtotal'), ('Total', 'total'), ('Paid', 'paid'), ('Balance', 'balance')]

    def extra_clean(self, c):
        return {'vendor_ref': c.text('vendor_ref', max_len=60), 'order_number': c.text('order_number', max_len=60)}

    def extra_detail(self, o):
        return {'vendor_ref': o.vendor_ref, 'order_number': o.order_number}

    def action(self, request, obj, name):
        if name == 'approve':
            services.approve_bill(obj, request.user)
        elif name == 'void':
            services.void_bill(obj, request.user)
        else:
            raise ApiError(404, 'Unknown action.')


# ====================================================================== payments
class PaymentResource(Resource):
    Model = Doc = Alloc = Party = None
    party_attr = doc_attr = prefix = posted = ''
    orderings = {'date': 'date', 'number': 'number', 'amount': 'amount'}
    default_ordering = ('-date', '-id')

    @property
    def model(self):
        return self.Model

    def base_qs(self):
        return self.Model.objects.select_related(self.party_attr).annotate(applied=paid_expr())

    def filter_qs(self, qs, request):
        pid = request.GET.get(self.party_attr)
        if pid and pid.isdigit():
            qs = qs.filter(**{self.party_attr + '_id': int(pid)})
        return qs

    def row(self, o):
        applied = q2(o.applied)
        p = getattr(o, self.party_attr)
        return {'id': o.pk, 'number': o.number, 'party_id': p.pk, 'party': p.name, 'date': o.date, 'mode': o.mode,
                'mode_label': MODE_LABEL.get(o.mode, o.mode), 'account': o.account, 'amount': o.amount,
                'applied': applied, 'unapplied': o.amount - applied, 'reference': o.reference, 'notes': o.notes}

    def detail(self, o):
        r = self.row(o)
        r['allocations'] = [{'doc_id': getattr(a, self.doc_attr + '_id'), 'number': getattr(a, self.doc_attr).number,
                             'amount': a.amount} for a in o.allocations.select_related(self.doc_attr)]
        return r

    def allocate(self, pay, raw):
        if raw in (None, []):
            return
        if not isinstance(raw, list):
            raise ApiError(400, 'Invalid allocations.', {'allocations': 'Invalid allocations.'})

        def fail(msg):
            raise ApiError(400, msg, {'allocations': msg})
        existing = sum((a.amount for a in pay.allocations.all()), Z)
        rows, seen, total = [], set(), Z
        for r in raw:
            c = Cleaner(r)
            did = c.integer(self.doc_attr, lo=1, required=True)
            amt = c.number('amount', True, lo=Decimal('0.01'), hi=Decimal('999999999'))
            if c.errors:
                fail('Each allocation needs a valid document and a positive amount.')
            if did in seen:
                fail('The same document appears more than once.')
            seen.add(did)
            doc = self.Doc.objects.select_for_update().filter(pk=did).first()
            if doc is None:
                fail('Document not found.')
            if getattr(doc, self.party_attr + '_id') != getattr(pay, self.party_attr + '_id'):
                fail(f'{doc.number} belongs to a different party.')
            if doc.status != self.posted:
                fail(f'{doc.number} is {doc.status}; payments can only be applied to posted documents.')
            bal = doc.total - sum((a.amount for a in doc.allocations.all()), Z)
            if amt > bal:
                fail(f'{doc.number}: amount exceeds the balance due ({bal}).')
            rows.append((doc, amt))
            total += amt
        if existing + total > pay.amount:
            fail('Applied amount exceeds the payment amount.')
        for doc, amt in rows:
            a, created = self.Alloc.objects.get_or_create(payment=pay, **{self.doc_attr: doc}, defaults={'amount': amt})
            if not created:
                a.amount += amt
                a.save(update_fields=['amount'])

    def create(self, data, user):
        c = Cleaner(data)
        pid = c.integer(self.party_attr, lo=1, required=True)
        party = self.Party.objects.filter(pk=pid).first() if pid else None
        if pid and party is None:
            c.err(self.party_attr, 'Not found.')
        out = {'date': c.date('date', required=True), 'mode': c.choice('mode', MODE_KEYS, 'bank_transfer'),
               'account': c.text('account', max_len=60, default='Bank Account') or 'Bank Account',
               'amount': c.number('amount', True, lo=Decimal('0.01'), hi=Decimal('999999999')),
               'reference': c.text('reference', max_len=80), 'notes': c.text('notes', max_len=2000)}
        c.done()
        pay = self.Model.objects.create(number=next_number(self.prefix), created_by=user, **{self.party_attr: party}, **out)
        self.allocate(pay, data.get('allocations'))
        return pay

    def action(self, request, obj, name):
        if name != 'apply':
            raise ApiError(404, 'Unknown action.')
        self.allocate(obj, body(request).get('allocations'))


class PaymentReceivedResource(PaymentResource):
    name = 'payments-received'
    Model, Doc, Alloc, Party = PaymentReceived, Invoice, ReceivedAllocation, Customer
    party_attr, doc_attr, prefix, posted = 'customer', 'invoice', 'PR', 'sent'
    search_fields = ('number', 'customer__name', 'reference')
    csv_cols = [('Receipt#', 'number'), ('Customer', 'party'), ('Date', 'date'), ('Mode', 'mode_label'),
                ('Reference', 'reference'), ('Amount', 'amount'), ('Applied', 'applied'), ('Unapplied', 'unapplied')]


class PaymentMadeResource(PaymentResource):
    name = 'payments-made'
    Model, Doc, Alloc, Party = PaymentMade, Bill, BillAllocation, Vendor
    party_attr, doc_attr, prefix, posted = 'vendor', 'bill', 'PM', 'open'
    search_fields = ('number', 'vendor__name', 'reference')
    csv_cols = [('Payment#', 'number'), ('Vendor', 'party'), ('Date', 'date'), ('Mode', 'mode_label'),
                ('Reference', 'reference'), ('Amount', 'amount'), ('Applied', 'applied'), ('Unapplied', 'unapplied')]


# ====================================================================== stock
class StockMovementResource(Resource):
    name = 'stock-movements'
    model = StockMovement
    search_fields = ('item__name', 'item__sku', 'reference', 'reason')
    orderings = {'date': 'date', 'item': 'item__name'}
    default_ordering = ('-date', '-id')
    csv_cols = [('Date', 'date'), ('Item', 'item'), ('SKU', 'sku'), ('Type', 'kind_label'), ('Reference', 'reference'),
                ('Change', 'change'), ('Balance after', 'balance_after'), ('Reason', 'reason')]

    def base_qs(self):
        return StockMovement.objects.select_related('item')

    def filter_qs(self, qs, request):
        k = request.GET.get('kind')
        if k:
            qs = qs.filter(kind=k)
        i = request.GET.get('item')
        if i and i.isdigit():
            qs = qs.filter(item_id=int(i))
        return qs

    def row(self, o):
        return {'id': o.pk, 'date': o.date, 'item_id': o.item_id, 'item': o.item.name, 'sku': o.item.sku, 'kind': o.kind,
                'kind_label': o.get_kind_display(), 'reference': o.reference, 'change': o.change,
                'balance_after': o.balance_after, 'reason': o.reason, 'notes': o.notes}


class StockAdjustmentResource(StockMovementResource):
    name = 'stock-adjustments'

    def base_qs(self):
        return StockMovement.objects.select_related('item').filter(kind='adjustment')

    def create(self, data, user):
        c = Cleaner(data)
        iid = c.integer('item', lo=1, required=True)
        new = c.number('new_quantity', True, lo=Decimal('0'), hi=Decimal('99999999'), places=3)
        on = c.date('date', required=True)
        reason = c.choice('reason', REASONS, required=True)
        notes = c.text('notes', max_len=1000)
        item = Item.objects.select_for_update().filter(pk=iid, item_type='goods', track_inventory=True).first() if iid else None
        if iid and item is None:
            c.err('item', 'Select an inventory-tracked goods item.')
        c.done()
        change = new - item.stock
        if change == 0:
            raise ApiError(400, 'The new quantity equals the current stock; nothing to adjust.', {'new_quantity': 'No change.'})
        ref = next_number('ADJ')
        services.move_stock(item.pk, change, 'adjustment', ref, on, user, reason, notes)
        return StockMovement.objects.filter(reference=ref).first()


RESOURCES = {r.name: r for r in (
    CustomerResource(), VendorResource(), ItemResource(), InvoiceResource(), BillResource(),
    PaymentReceivedResource(), PaymentMadeResource(), StockMovementResource(), StockAdjustmentResource())}


@api_view
def collection(request, name):
    res = RESOURCES.get(name)
    if res is None:
        raise ApiError(404, 'Unknown resource.')
    return res.handle_collection(request)


@api_view
def item(request, name, pk):
    res = RESOURCES.get(name)
    if res is None:
        raise ApiError(404, 'Unknown resource.')
    return res.handle_item(request, pk)


@api_view
def action(request, name, pk, act):
    res = RESOURCES.get(name)
    if res is None:
        raise ApiError(404, 'Unknown resource.')
    return res.handle_action(request, pk, act)


# ====================================================================== misc endpoints
def org_json(o):
    return {
        'name': o.name,
        'company_id': o.company_id,
        'gstin': o.gstin,
        'state': o.state,
        'address': o.address,
        'city': o.city,
        'pincode': o.pincode,
        'country': o.country,
        'phone': o.phone,
        'email': o.email,
        'website': o.website,
        'logo_data': o.logo_data or '/static/books/img/convosis-logo.png',
        'template_theme': o.template_theme or 'convosis',
        'template_color': o.template_color or '#1877f2',
        'signature_title': o.signature_title or 'Authorized Signature',
        'notes_default': o.notes_default or 'Thanks for your business.',
        'terms_default': o.terms_default or 'Due on Receipt',
        'opening_cash': o.opening_cash,
    }


@api_view
def me(request):
    u = request.user
    return j({'user': {'username': u.get_username(), 'name': u.get_full_name() or u.get_username()},
              'organization': org_json(Organization.get()), 'today': timezone.localdate(),
              'counts': {'customers': Customer.objects.count(), 'vendors': Vendor.objects.count(),
                         'items': Item.objects.count(), 'invoices': Invoice.objects.exclude(status='draft').count(),
                         'bills': Bill.objects.exclude(status='draft').count(),
                         'payments': PaymentReceived.objects.count() + PaymentMade.objects.count()}})


@api_view
def organization(request):
    org = Organization.get()
    if request.method == 'GET':
        return j(org_json(org))
    if request.method not in ('PUT', 'PATCH'):
        raise ApiError(405, 'Method not allowed.')
    c = Cleaner(body(request))
    out = {
        'name': c.text('name', True, 200),
        'company_id': c.text('company_id', max_len=100),
        'state': c.text('state', True, 60),
        'address': c.text('address', max_len=1000),
        'city': c.text('city', max_len=100),
        'pincode': c.text('pincode', max_len=20),
        'country': c.text('country', max_len=100),
        'phone': c.text('phone', max_len=50),
        'email': c.text('email', max_len=254),
        'website': c.text('website', max_len=200),
        'gstin': c.text('gstin', max_len=15, upper=True, pattern=GSTIN_RE, pattern_msg='Enter a valid 15-character GSTIN.'),
        'opening_cash': c.number('opening_cash', lo=Decimal('-999999999'), hi=Decimal('999999999')),
        'template_theme': c.text('template_theme', max_len=50),
        'template_color': c.text('template_color', max_len=30),
        'signature_title': c.text('signature_title', max_len=100),
        'notes_default': c.text('notes_default', max_len=2000),
        'terms_default': c.text('terms_default', max_len=2000),
    }
    c.done()
    d = body(request)
    if 'logo_data' in d:
        out['logo_data'] = d['logo_data']
    for k, v in out.items():
        setattr(org, k, v)
    org.save()
    return j(org_json(org))


@api_view
def attachments_view(request, pk=None):
    if request.method == 'GET':
        if pk:
            att = Attachment.objects.filter(pk=pk).first()
            if not att:
                raise ApiError(404, 'Attachment not found.')
            return j({'id': att.pk, 'entity_type': att.entity_type, 'entity_id': att.entity_id,
                      'filename': att.filename, 'file_size': att.file_size, 'mime_type': att.mime_type,
                      'url': att.file.url if att.file else att.file_data, 'file_data': att.file_data,
                      'created_at': att.created_at})
        etype = request.GET.get('entity_type', '').strip()
        eid = request.GET.get('entity_id', '').strip()
        qs = Attachment.objects.all()
        if etype:
            qs = qs.filter(entity_type=etype)
        if eid and eid.isdigit():
            qs = qs.filter(entity_id=int(eid))
        return j([
            {'id': a.pk, 'entity_type': a.entity_type, 'entity_id': a.entity_id,
             'filename': a.filename, 'file_size': a.file_size, 'mime_type': a.mime_type,
             'url': a.file.url if a.file else a.file_data, 'file_data': a.file_data,
             'created_at': a.created_at} for a in qs
        ])
    if request.method == 'POST':
        if request.content_type and 'multipart/form-data' in request.content_type:
            f = request.FILES.get('file')
            etype = request.POST.get('entity_type', 'invoice')
            eid = int(request.POST.get('entity_id') or 0)
            if not f:
                raise ApiError(400, 'File is required.')
            att = Attachment.objects.create(
                entity_type=etype, entity_id=eid, file=f,
                filename=f.name, file_size=f.size, mime_type=getattr(f, 'content_type', ''),
                created_by=request.user
            )
            return j({'id': att.pk, 'filename': att.filename, 'file_size': att.file_size,
                      'url': att.file.url if att.file else '', 'mime_type': att.mime_type}, 201)
        else:
            d = body(request)
            c = Cleaner(d)
            etype = c.text('entity_type', required=True, max_len=40)
            eid = c.integer('entity_id', required=True, lo=0)
            fname = c.text('filename', required=True, max_len=255)
            fsize = c.integer('file_size', default=0, lo=0)
            fdata = d.get('file_data', '')
            mtype = c.text('mime_type', max_len=100)
            c.done()
            att = Attachment.objects.create(
                entity_type=etype, entity_id=eid, filename=fname, file_size=fsize,
                file_data=fdata, mime_type=mtype, created_by=request.user
            )
            return j({'id': att.pk, 'filename': att.filename, 'file_size': att.file_size,
                      'file_data': att.file_data, 'url': att.file_data, 'mime_type': att.mime_type}, 201)
    if request.method == 'DELETE':
        if not pk:
            raise ApiError(400, 'Attachment ID required.')
        att = Attachment.objects.filter(pk=pk).first()
        if att:
            if att.file:
                try:
                    att.file.delete(save=False)
                except Exception:
                    pass
            att.delete()
        return HttpResponse(status=204)
    raise ApiError(405, 'Method not allowed.')


@api_view
def lookup(request, name):
    if name == 'customers':
        data = [{'id': o.pk, 'name': o.name, 'state': o.state, 'payment_terms': o.payment_terms}
                for o in Customer.objects.filter(active=True).order_by('name')]
    elif name == 'vendors':
        data = [{'id': o.pk, 'name': o.name, 'state': o.state, 'payment_terms': o.payment_terms}
                for o in Vendor.objects.filter(active=True).order_by('name')]
    elif name == 'items':
        data = [{'id': o.pk, 'name': o.name, 'sku': o.sku, 'type': o.item_type, 'hsn_sac': o.hsn_sac, 'category': o.category,
                 'selling_price': o.selling_price, 'purchase_price': o.purchase_price, 'gst_rate': o.gst_rate,
                 'track_inventory': o.item_type == 'goods' and o.track_inventory, 'stock': o.stock, 'unit': o.unit}
                for o in Item.objects.filter(active=True).order_by('name')]
    else:
        raise ApiError(404, 'Unknown lookup.')
    return j(data)


@api_view
def dashboard_view(request):
    start, end = parse_range(request)
    return j(services.dashboard(start, end))


@api_view
def activity_view(request):
    try:
        limit = min(max(int(request.GET.get('limit', 30)), 1), 100)
    except ValueError:
        limit = 30
    return j(services.recent_activity(limit))


@api_view
def search_view(request):
    q = request.GET.get('q', '').strip()
    if len(q) < 2:
        return j([])
    out = []
    for o in Customer.objects.filter(Q(name__icontains=q) | Q(company__icontains=q) | Q(email__icontains=q))[:5]:
        out.append({'type': 'customer', 'id': o.pk, 'label': o.name, 'sub': 'Customer'})
    for o in Vendor.objects.filter(Q(name__icontains=q) | Q(company__icontains=q) | Q(email__icontains=q))[:5]:
        out.append({'type': 'vendor', 'id': o.pk, 'label': o.name, 'sub': 'Vendor'})
    for o in Invoice.objects.select_related('customer').filter(Q(number__icontains=q) | Q(customer__name__icontains=q))[:5]:
        out.append({'type': 'invoice', 'id': o.pk, 'label': o.number, 'sub': f'Invoice · {o.customer.name}'})
    for o in Bill.objects.select_related('vendor').filter(Q(number__icontains=q) | Q(vendor__name__icontains=q) | Q(vendor_ref__icontains=q))[:5]:
        out.append({'type': 'bill', 'id': o.pk, 'label': o.number, 'sub': f'Bill · {o.vendor.name}'})
    for o in Item.objects.filter(Q(name__icontains=q) | Q(sku__icontains=q))[:5]:
        out.append({'type': 'item', 'id': o.pk, 'label': o.name, 'sub': f'Item · {o.sku}'})
    return j(out)


def health_view(request):
    return JsonResponse({'status': 'ok', 'timestamp': timezone.now().isoformat()})

