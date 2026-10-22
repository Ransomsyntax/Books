from decimal import Decimal

from django.conf import settings
from django.db import models

MONEY = {'max_digits': 14, 'decimal_places': 2}
QTY = {'max_digits': 14, 'decimal_places': 3}


class Organization(models.Model):
    """Single-tenant company profile (always pk=1)."""
    name = models.CharField(max_length=200, default='Convosis Technologies Pvt Ltd')
    company_id = models.CharField(max_length=100, blank=True, default='U62090KL2026PTC103900', help_text='CIN / Registration number')
    gstin = models.CharField(max_length=15, blank=True, default='32AANCC9298C1ZE')
    state = models.CharField(max_length=60, default='Kerala', help_text='Home state; drives CGST/SGST vs IGST.')
    address = models.TextField(blank=True, default='Technolodge Phase II\nKMC 24/222, Anugraha Medical Complex Building')
    city = models.CharField(max_length=100, blank=True, default='Kottayam')
    pincode = models.CharField(max_length=20, blank=True, default='686003')
    country = models.CharField(max_length=100, blank=True, default='India')
    phone = models.CharField(max_length=50, blank=True, default='91-9847017737')
    email = models.EmailField(blank=True, default='admin@convosis.com')
    website = models.CharField(max_length=200, blank=True, default='www.convosis.com')
    logo_data = models.TextField(blank=True, default='/static/books/img/convosis-logo.png')
    template_theme = models.CharField(max_length=50, blank=True, default='convosis')
    template_color = models.CharField(max_length=30, blank=True, default='#1877f2')
    signature_title = models.CharField(max_length=100, blank=True, default='Authorized Signature')
    notes_default = models.TextField(blank=True, default='Thanks for your business.')
    terms_default = models.TextField(blank=True, default='Due on Receipt')
    opening_cash = models.DecimalField(default=Decimal('0.00'), **MONEY)

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return self.name


class Sequence(models.Model):
    key = models.CharField(max_length=20, primary_key=True)
    value = models.PositiveIntegerField(default=0)


class Party(models.Model):
    name = models.CharField(max_length=200)
    party_type = models.CharField(max_length=20, choices=[('business', 'Business'), ('individual', 'Individual')], default='business')
    salutation = models.CharField(max_length=20, blank=True, default='')
    first_name = models.CharField(max_length=100, blank=True, default='')
    last_name = models.CharField(max_length=100, blank=True, default='')
    company = models.CharField(max_length=200, blank=True)
    contact_person = models.CharField(max_length=120, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    mobile = models.CharField(max_length=30, blank=True, default='')
    language = models.CharField(max_length=30, blank=True, default='English')
    gst_treatment = models.CharField(max_length=50, blank=True, default='registered_regular')
    state = models.CharField(max_length=60, blank=True)
    gstin = models.CharField(max_length=15, blank=True)
    pan = models.CharField(max_length=10, blank=True)
    tax_preference = models.CharField(max_length=20, choices=[('taxable', 'Taxable'), ('exempt', 'Tax Exempt')], default='taxable')
    currency = models.CharField(max_length=10, default='INR')
    opening_balance = models.DecimalField(default=Decimal('0.00'), **MONEY)
    payment_terms = models.PositiveSmallIntegerField(default=30, help_text='Days')
    payment_terms_label = models.CharField(max_length=50, blank=True, default='Due on Receipt')
    enable_portal = models.BooleanField(default=False)

    # Billing Address
    billing_attention = models.CharField(max_length=150, blank=True, default='')
    billing_country = models.CharField(max_length=100, blank=True, default='India')
    billing_address_1 = models.CharField(max_length=255, blank=True, default='')
    billing_address_2 = models.CharField(max_length=255, blank=True, default='')
    billing_city = models.CharField(max_length=100, blank=True, default='')
    billing_state = models.CharField(max_length=60, blank=True, default='')
    billing_pincode = models.CharField(max_length=20, blank=True, default='')
    billing_phone = models.CharField(max_length=30, blank=True, default='')
    billing_fax = models.CharField(max_length=50, blank=True, default='')
    billing_address = models.TextField(blank=True)

    # Shipping Address
    shipping_attention = models.CharField(max_length=150, blank=True, default='')
    shipping_country = models.CharField(max_length=100, blank=True, default='India')
    shipping_address_1 = models.CharField(max_length=255, blank=True, default='')
    shipping_address_2 = models.CharField(max_length=255, blank=True, default='')
    shipping_city = models.CharField(max_length=100, blank=True, default='')
    shipping_state = models.CharField(max_length=60, blank=True, default='')
    shipping_pincode = models.CharField(max_length=20, blank=True, default='')
    shipping_phone = models.CharField(max_length=30, blank=True, default='')
    shipping_fax = models.CharField(max_length=50, blank=True, default='')
    shipping_address = models.TextField(blank=True, default='')

    # Extra info
    contact_persons = models.JSONField(default=list, blank=True)
    custom_fields = models.JSONField(default=dict, blank=True)
    remarks = models.TextField(blank=True, default='')
    notes = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True
        ordering = ['name']

    def __str__(self):
        return self.name


class Customer(Party):
    pass


class Vendor(Party):
    pass


class Item(models.Model):
    GOODS, SERVICE = 'goods', 'service'
    name = models.CharField(max_length=200)
    sku = models.CharField(max_length=60, unique=True)
    item_type = models.CharField(max_length=10, choices=[(GOODS, 'Goods'), (SERVICE, 'Service')], default=GOODS)
    category = models.CharField(max_length=100, blank=True)
    hsn_sac = models.CharField(max_length=10, blank=True)
    unit = models.CharField(max_length=20, default='nos')
    description = models.TextField(blank=True)
    selling_price = models.DecimalField(default=Decimal('0.00'), **MONEY)
    purchase_price = models.DecimalField(default=Decimal('0.00'), **MONEY)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('18.00'))
    track_inventory = models.BooleanField(default=False)
    stock = models.DecimalField(default=Decimal('0.000'), **QTY)
    reorder_level = models.DecimalField(default=Decimal('0.000'), **QTY)
    image_data = models.TextField(blank=True, default='')
    tax_preference = models.CharField(max_length=30, default='taxable')
    sales_account = models.CharField(max_length=100, default='Sales')
    purchase_account = models.CharField(max_length=100, default='Cost of Goods Sold')
    preferred_vendor = models.ForeignKey(Vendor, null=True, blank=True, on_delete=models.SET_NULL, related_name='items')
    inventory_account = models.CharField(max_length=100, default='Inventory Asset', blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.sku})'


class Document(models.Model):
    DRAFT, VOID = 'draft', 'void'
    number = models.CharField(max_length=30, unique=True)
    date = models.DateField()
    due_date = models.DateField()
    place_of_supply = models.CharField(max_length=60)
    status = models.CharField(max_length=10, default=DRAFT)
    subtotal = models.DecimalField(default=Decimal('0.00'), **MONEY)  # taxable value
    cgst = models.DecimalField(default=Decimal('0.00'), **MONEY)
    sgst = models.DecimalField(default=Decimal('0.00'), **MONEY)
    igst = models.DecimalField(default=Decimal('0.00'), **MONEY)
    total = models.DecimalField(default=Decimal('0.00'), **MONEY)
    order_number = models.CharField(max_length=60, blank=True, default='')
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Invoice(Document):
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name='invoices')
    terms = models.TextField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.number


class Bill(Document):
    vendor = models.ForeignKey(Vendor, on_delete=models.PROTECT, related_name='bills')
    vendor_ref = models.CharField(max_length=60, blank=True)

    def __str__(self):
        return self.number


class Line(models.Model):
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    description = models.CharField(max_length=500)
    hsn_sac = models.CharField(max_length=10, blank=True)
    quantity = models.DecimalField(**QTY)
    rate = models.DecimalField(**MONEY)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    taxable = models.DecimalField(**MONEY)
    tax_amount = models.DecimalField(**MONEY)
    line_total = models.DecimalField(**MONEY)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        abstract = True
        ordering = ['position', 'id']


class InvoiceLine(Line):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='lines')


class BillLine(Line):
    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name='lines')


MODES = [('cash', 'Cash'), ('bank_transfer', 'Bank transfer'), ('upi', 'UPI'),
         ('cheque', 'Cheque'), ('card', 'Card'), ('other', 'Other')]


class Payment(models.Model):
    number = models.CharField(max_length=30, unique=True)
    date = models.DateField()
    mode = models.CharField(max_length=20, choices=MODES, default='bank_transfer')
    account = models.CharField(max_length=60, default='Bank Account')
    amount = models.DecimalField(**MONEY)
    reference = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        abstract = True


class PaymentReceived(Payment):
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name='payments')


class PaymentMade(Payment):
    vendor = models.ForeignKey(Vendor, on_delete=models.PROTECT, related_name='payments')


class ReceivedAllocation(models.Model):
    payment = models.ForeignKey(PaymentReceived, on_delete=models.CASCADE, related_name='allocations')
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name='allocations')
    amount = models.DecimalField(**MONEY)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['payment', 'invoice'], name='uniq_received_alloc')]


class BillAllocation(models.Model):
    payment = models.ForeignKey(PaymentMade, on_delete=models.CASCADE, related_name='allocations')
    bill = models.ForeignKey(Bill, on_delete=models.PROTECT, related_name='allocations')
    amount = models.DecimalField(**MONEY)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['payment', 'bill'], name='uniq_bill_alloc')]


class StockMovement(models.Model):
    KINDS = [('opening', 'Opening stock'), ('sale', 'Sale'), ('sale_void', 'Sale voided'),
             ('purchase', 'Purchase'), ('purchase_void', 'Purchase voided'), ('adjustment', 'Adjustment')]
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='movements')
    date = models.DateField()
    kind = models.CharField(max_length=15, choices=KINDS)
    reference = models.CharField(max_length=40, blank=True)
    change = models.DecimalField(**QTY)
    balance_after = models.DecimalField(**QTY)
    reason = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        ordering = ['-date', '-id']


class Attachment(models.Model):
    entity_type = models.CharField(max_length=40, db_index=True)  # 'invoice', 'bill', 'customer', 'vendor', 'item'
    entity_id = models.PositiveIntegerField(db_index=True)
    file = models.FileField(upload_to='attachments/%Y/%m/', blank=True, null=True)
    file_data = models.TextField(blank=True, default='')
    filename = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField(default=0)
    mime_type = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.filename} ({self.entity_type} #{self.entity_id})'

