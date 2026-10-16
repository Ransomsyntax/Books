"""Business logic: numbering, stock movements, document lifecycle, dashboard analytics."""
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import DecimalField, F, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from .calc import q2
from .cleaning import ApiError
from .models import (Bill, Customer, Invoice, Item, Organization, PaymentMade, PaymentReceived,
                     Sequence, StockMovement, Vendor)

DEC = DecimalField(max_digits=14, decimal_places=2)
Z = Decimal('0.00')


def paid_expr():
    return Coalesce(Sum('allocations__amount'), Value(Z), output_field=DEC)


def invoice_qs():
    return Invoice.objects.select_related('customer').annotate(paid_sum=paid_expr())


def bill_qs():
    return Bill.objects.select_related('vendor').annotate(paid_sum=paid_expr())


def next_number(prefix):
    """Call inside the same transaction that creates the record so a rollback frees the number."""
    with transaction.atomic():
        seq, _ = Sequence.objects.select_for_update().get_or_create(key=prefix)
        seq.value += 1
        seq.save(update_fields=['value'])
        return f'{prefix}-{seq.value:06d}'


def fmt_qty(d):
    return format(Decimal(d).normalize(), 'f')


# ---------------------------------------------------------------- stock
def move_stock(item_id, change, kind, reference, on, user=None, reason='', notes=''):
    item = Item.objects.select_for_update().get(pk=item_id)
    new = item.stock + change
    if new < 0:
        raise ApiError(400, f'Insufficient stock for {item.name}: available {fmt_qty(item.stock)}, required {fmt_qty(-change)}.')
    item.stock = new
    item.save(update_fields=['stock'])
    StockMovement.objects.create(item=item, date=on, kind=kind, reference=reference, change=change,
                                 balance_after=new, reason=reason, notes=notes,
                                 created_by=user if getattr(user, 'pk', None) else None)


def stock_totals(doc):
    agg = {}
    for ln in doc.lines.select_related('item'):
        it = ln.item
        if it and it.item_type == Item.GOODS and it.track_inventory:
            agg[it.pk] = agg.get(it.pk, Decimal('0')) + ln.quantity
    return agg


def apply_stock(doc, sign, kind, user):
    for item_id, qty in sorted(stock_totals(doc).items()):
        move_stock(item_id, sign * qty, kind, doc.number, doc.date, user)


# ---------------------------------------------------------------- lifecycle
@transaction.atomic
def send_invoice(inv, user):
    if inv.status != 'draft':
        raise ApiError(409, 'Only draft invoices can be sent.')
    apply_stock(inv, -1, 'sale', user)
    inv.status = 'sent'
    inv.sent_at = timezone.now()
    inv.save(update_fields=['status', 'sent_at', 'updated_at'])


@transaction.atomic
def void_invoice(inv, user):
    if inv.status != 'sent':
        raise ApiError(409, 'Only sent invoices can be voided (delete drafts instead).')
    if inv.allocations.exists():
        raise ApiError(409, 'Payments are applied to this invoice. Delete those payments first.')
    apply_stock(inv, +1, 'sale_void', user)
    inv.status = 'void'
    inv.save(update_fields=['status', 'updated_at'])


@transaction.atomic
def approve_bill(bill, user):
    if bill.status != 'draft':
        raise ApiError(409, 'Only draft bills can be approved.')
    apply_stock(bill, +1, 'purchase', user)
    bill.status = 'open'
    bill.save(update_fields=['status', 'updated_at'])


@transaction.atomic
def void_bill(bill, user):
    if bill.status != 'open':
        raise ApiError(409, 'Only open bills can be voided (delete drafts instead).')
    if bill.allocations.exists():
        raise ApiError(409, 'Payments are applied to this bill. Delete those payments first.')
    apply_stock(bill, -1, 'purchase_void', user)
    bill.status = 'void'
    bill.save(update_fields=['status', 'updated_at'])


# ---------------------------------------------------------------- dashboard
def _sum(qs, field):
    return qs.aggregate(t=Sum(field))['t'] or Z


def _months(start, end):
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def _aging(docs, today):
    b = [Z] * 5
    for d in docs:
        bal = d.total - q2(d.paid_sum)
        if bal <= 0:
            continue
        late = (today - d.due_date).days
        idx = 0 if late <= 0 else 1 if late <= 30 else 2 if late <= 60 else 3 if late <= 90 else 4
        b[idx] += bal
    return b


def _period(s, e):
    inv = Invoice.objects.filter(status='sent', date__range=(s, e))
    bl = Bill.objects.filter(status='open', date__range=(s, e))
    rev, exp = _sum(inv, 'subtotal'), _sum(bl, 'subtotal')
    out_tax = _sum(inv, 'cgst') + _sum(inv, 'sgst') + _sum(inv, 'igst')
    in_tax = _sum(bl, 'cgst') + _sum(bl, 'sgst') + _sum(bl, 'igst')
    return {'revenue': rev, 'expenses': exp, 'profit': rev - exp, 'gst_payable': out_tax - in_tax}


def dashboard(start, end):
    today = timezone.localdate()
    org = Organization.get()
    days = (end - start).days + 1
    p_end = start - timedelta(days=1)
    p_start = p_end - timedelta(days=days - 1)
    cur, prev = _period(start, end), _period(p_start, p_end)

    inv_open = list(invoice_qs().filter(status='sent', paid_sum__lt=F('total')))
    bill_open = list(bill_qs().filter(status='open', paid_sum__lt=F('total')))
    rec_total = sum((i.total - q2(i.paid_sum) for i in inv_open), Z)
    pay_total = sum((b.total - q2(b.paid_sum) for b in bill_open), Z)
    rec_over = sum((i.total - q2(i.paid_sum) for i in inv_open if i.due_date < today), Z)
    pay_over = sum((b.total - q2(b.paid_sum) for b in bill_open if b.due_date < today), Z)

    cash = org.opening_cash + _sum(PaymentReceived.objects.all(), 'amount') - _sum(PaymentMade.objects.all(), 'amount')
    opening = (org.opening_cash + _sum(PaymentReceived.objects.filter(date__lt=start), 'amount')
               - _sum(PaymentMade.objects.filter(date__lt=start), 'amount'))

    months = _months(start, end)
    idx = {m: i for i, m in enumerate(months)}
    n = len(months)
    c_in, c_out, rev_m, exp_m = [Z] * n, [Z] * n, [Z] * n, [Z] * n

    def bucket(rows, arr):
        for d, amt in rows:
            i = idx.get((d.year, d.month))
            if i is not None:
                arr[i] += amt

    bucket(PaymentReceived.objects.filter(date__range=(start, end)).values_list('date', 'amount'), c_in)
    bucket(PaymentMade.objects.filter(date__range=(start, end)).values_list('date', 'amount'), c_out)
    bucket(Invoice.objects.filter(status='sent', date__range=(start, end)).values_list('date', 'subtotal'), rev_m)
    bucket(Bill.objects.filter(status='open', date__range=(start, end)).values_list('date', 'subtotal'), exp_m)
    labels = [date(y, m, 1).strftime('%b %y') for y, m in months]

    mix = {}
    from .models import InvoiceLine
    for cat, amt in InvoiceLine.objects.filter(invoice__status='sent', invoice__date__range=(start, end)).values_list('item__category', 'taxable'):
        key = cat or 'Uncategorised'
        mix[key] = mix.get(key, Z) + amt

    top = {}
    for name, amt in Invoice.objects.filter(status='sent', date__range=(start, end)).values_list('customer__name', 'subtotal'):
        top[name] = top.get(name, Z) + amt

    p_inv = list(invoice_qs().filter(status='sent', date__range=(start, end)))
    count = len(p_inv)
    gross = sum((i.total for i in p_inv), Z)
    paid_cnt = sum(1 for i in p_inv if i.total - q2(i.paid_sum) <= 0)

    goods = Item.objects.filter(item_type='goods', track_inventory=True)
    inv_value = sum((i.stock * i.purchase_price for i in goods), Z)
    growth = None
    if prev['revenue']:
        growth = float((cur['revenue'] - prev['revenue']) / prev['revenue'] * 100)

    return {
        'period': {'start': start, 'end': end, 'prev_start': p_start, 'prev_end': p_end},
        'kpis': {
            'revenue': {'value': cur['revenue'], 'prev': prev['revenue']},
            'expenses': {'value': cur['expenses'], 'prev': prev['expenses']},
            'profit': {'value': cur['profit'], 'prev': prev['profit']},
            'gst_payable': {'value': cur['gst_payable'], 'prev': prev['gst_payable']},
            'receivables': {'value': rec_total}, 'payables': {'value': pay_total},
            'cash': {'value': cash},
            'outstanding_invoices': {'value': len(inv_open)}, 'outstanding_bills': {'value': len(bill_open)},
            'inventory_value': {'value': inv_value},
            'overdue_receivables': {'value': rec_over},
            'sales_growth': {'value': growth},
        },
        'receivables': {'total': rec_total, 'overdue': rec_over},
        'payables': {'total': pay_total, 'overdue': pay_over},
        'cash': {'opening': opening, 'incoming': sum(c_in, Z), 'outgoing': sum(c_out, Z),
                 'closing': opening + sum(c_in, Z) - sum(c_out, Z), 'labels': labels, 'in': c_in, 'out': c_out},
        'monthly': {'labels': labels, 'revenue': rev_m, 'expenses': exp_m},
        'mix': [{'label': k, 'value': v} for k, v in sorted(mix.items(), key=lambda x: -x[1])],
        'aging': {'receivable': _aging(inv_open, today), 'payable': _aging(bill_open, today)},
        'top_customers': [{'name': k, 'value': v} for k, v in sorted(top.items(), key=lambda x: -x[1])[:5]],
        'sales': {'count': count, 'average': (gross / count).quantize(Decimal('0.01')) if count else Z,
                  'paid': paid_cnt, 'unpaid': count - paid_cnt},
        'inventory': {'value': inv_value, 'active_items': Item.objects.filter(active=True).count(),
                      'low': sum(1 for i in goods if 0 < i.stock <= i.reorder_level and i.reorder_level > 0),
                      'out': sum(1 for i in goods if i.stock <= 0)},
        'activity': recent_activity(8),
    }


def recent_activity(limit=10):
    ev = []
    for o in Invoice.objects.select_related('customer').exclude(status='draft').order_by('-created_at')[:limit]:
        ev.append({'type': 'invoice', 'id': o.pk, 'title': f'Invoice {o.number} ' + ('voided' if o.status == 'void' else 'issued'),
                   'detail': o.customer.name, 'amount': o.total, 'date': o.date, 'at': o.created_at})
    for o in PaymentReceived.objects.select_related('customer').order_by('-created_at')[:limit]:
        ev.append({'type': 'payment_received', 'id': o.pk, 'title': f'Payment {o.number} received', 'detail': o.customer.name,
                   'amount': o.amount, 'date': o.date, 'at': o.created_at})
    for o in Bill.objects.select_related('vendor').exclude(status='draft').order_by('-created_at')[:limit]:
        ev.append({'type': 'bill', 'id': o.pk, 'title': f'Bill {o.number} ' + ('voided' if o.status == 'void' else 'recorded'),
                   'detail': o.vendor.name, 'amount': o.total, 'date': o.date, 'at': o.created_at})
    for o in PaymentMade.objects.select_related('vendor').order_by('-created_at')[:limit]:
        ev.append({'type': 'payment_made', 'id': o.pk, 'title': f'Payment {o.number} made', 'detail': o.vendor.name,
                   'amount': o.amount, 'date': o.date, 'at': o.created_at})
    for o in StockMovement.objects.select_related('item').filter(kind='adjustment').order_by('-created_at')[:limit]:
        ev.append({'type': 'stock', 'id': o.pk, 'title': f'Stock adjusted: {o.item.name}', 'detail': o.reason,
                   'amount': None, 'date': o.date, 'at': o.created_at})
    ev.sort(key=lambda e: e['at'], reverse=True)
    return ev[:limit]
