import random
import string

from django.db import models

from products.models import Product


def generate_display_id():
    """Human-readable order code, e.g. EON-48291 — digits only (random,
    not sequential), per the store owner's preference."""
    suffix = ''.join(random.choices(string.digits, k=5))
    return f'EON-{suffix}'


class Order(models.Model):
    STATUS_CHOICES = [
        ('Pending', 'Pending'),
        ('Confirmed', 'Confirmed'),
        ('Preparing', 'Preparing'),
        ('Shipped', 'Shipped'),
        ('Delivered', 'Delivered'),
        ('Cancelled', 'Cancelled'),
    ]

    # Cash on Delivery is the only method the storefront actually offers
    # today (no payment-method selector in the checkout UI). This field
    # exists so a future gateway (Stripe, Paymob, ...) is a new choice +
    # a new provider branch, not a schema change — see notifications.py
    # for the same "prepare, don't build yet" pattern applied to
    # notifications.
    PAYMENT_METHOD_CHOICES = [
        ('cod', 'Cash on Delivery'),
        ('stripe', 'Stripe'),
        ('paymob', 'Paymob'),
    ]

    display_id = models.CharField(max_length=20, unique=True, default=generate_display_id)
    customer_name = models.CharField(max_length=200)
    phone = models.CharField(max_length=30, db_index=True)
    # Second contact number, required at checkout: the first order taken
    # after launch came in with a phone number one digit short, leaving
    # no way to reach the customer at all. A backup number makes that
    # recoverable. Existing rows (pre-migration) keep an empty string.
    phone_alt = models.CharField(max_length=30, blank=True, default='')
    address = models.TextField()
    notes = models.TextField(blank=True, default='')

    currency = models.CharField(max_length=10, default='EGP')
    # Sum of item line totals, computed server-side at creation time —
    # never trusted from the client. See OrderCreateSerializer.
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    shipping_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # subtotal + shipping_cost, stored (not just a property) so historical
    # orders keep their exact total even if the calculation logic changes
    # later.
    total = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='cod')

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Pending')
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # --- Order status lifecycle (Phase 5.2) ---------------------------
    # Forward-only fulfillment flow, plus an early-stage "Cancelled" exit.
    # Once an order has shipped there's no cancel path here on purpose —
    # goods are already in transit, so reversing that needs a real
    # return/refund flow, which is out of scope for this phase. Delivered
    # and Cancelled are terminal: nothing can leave them. This is the
    # single source of truth for valid transitions — both the
    # PATCH .../status/ endpoint (via OrderStatusSerializer.validate_status)
    # and the `cancel` action (OrderViewSet.cancel) check against it, and
    # the frontend's status action buttons mirror it via the
    # `available_transitions` field below so the UI never even offers an
    # invalid move.
    ALLOWED_TRANSITIONS = {
        'Pending': ['Confirmed', 'Cancelled'],
        'Confirmed': ['Preparing', 'Cancelled'],
        'Preparing': ['Shipped', 'Cancelled'],
        'Shipped': ['Delivered'],
        'Delivered': [],
        'Cancelled': [],
    }

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.display_id} — {self.customer_name}'

    def recompute_totals(self, save=False):
        self.subtotal = sum((item.line_total for item in self.items.all()), 0)
        self.total = self.subtotal + self.shipping_cost
        if save:
            self.save(update_fields=['subtotal', 'total'])

    def can_transition_to(self, new_status):
        return new_status in self.ALLOWED_TRANSITIONS.get(self.status, [])

    @property
    def available_transitions(self):
        """Valid next statuses from the current one — what the admin
        Orders page renders as status action buttons."""
        return self.ALLOWED_TRANSITIONS.get(self.status, [])


class OrderItem(models.Model):
    order = models.ForeignKey(Order, related_name='items', on_delete=models.CASCADE)
    # Nullable + SET_NULL on purpose: if a product is later deleted, the
    # historical order line must still render correctly using the
    # snapshot fields below — it must never disappear or error out.
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True, blank=True, related_name='order_items')

    # --- snapshot at time of order — the historical record of what was
    # actually sold, independent of whatever the product looks like now.
    product_name = models.CharField(max_length=200)
    product_image = models.URLField(max_length=1000, blank=True, default='')
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    quantity = models.PositiveIntegerField(default=1)
    size = models.CharField(max_length=50, blank=True, default='')
    color = models.CharField(max_length=50, blank=True, default='')

    @property
    def line_total(self):
        return self.unit_price * self.quantity

    def __str__(self):
        return f'{self.quantity} x {self.product_name}'
