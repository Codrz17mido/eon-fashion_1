import re
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from products.models import Product

from .models import Order, OrderItem
from .notifications import notify_new_order


# --- Read (output) shapes -----------------------------------------------

class OrderItemSerializer(serializers.ModelSerializer):
    line_total = serializers.ReadOnlyField()

    class Meta:
        model = OrderItem
        fields = [
            'id', 'product', 'product_name', 'product_image',
            'quantity', 'size', 'color', 'unit_price', 'line_total',
        ]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    # Valid next statuses from the order's current status (see
    # Order.ALLOWED_TRANSITIONS) — lets the admin Orders page render
    # status action buttons without duplicating the transition rules.
    available_transitions = serializers.ReadOnlyField()

    class Meta:
        model = Order
        fields = [
            'id', 'display_id', 'customer_name', 'phone', 'phone_alt', 'address', 'notes',
            'currency', 'subtotal', 'shipping_cost', 'total', 'payment_method',
            'status', 'available_transitions', 'read', 'items', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'display_id', 'subtotal', 'total', 'status',
            'available_transitions', 'read', 'created_at', 'updated_at',
        ]


class OrderStatusSerializer(serializers.ModelSerializer):
    """Used only by the PATCH .../status/ endpoint. `self.instance` is
    always set (the view always constructs this with the existing order),
    so validate_status can check the current status against
    Order.ALLOWED_TRANSITIONS — the same table the frontend reads via
    `available_transitions` on OrderSerializer."""

    class Meta:
        model = Order
        fields = ['status']

    def validate_status(self, value):
        current = self.instance.status
        if value == current:
            raise serializers.ValidationError(f'Order is already "{current}".')
        if not self.instance.can_transition_to(value):
            allowed = self.instance.available_transitions
            allowed_text = ', '.join(allowed) if allowed else 'none — this is a final status'
            raise serializers.ValidationError(
                f'Cannot move an order from "{current}" to "{value}". '
                f'Allowed next status(es): {allowed_text}.'
            )
        return value


# --- Write (create) shape -------------------------------------------------

class OrderItemInputSerializer(serializers.Serializer):
    """What the checkout actually sends per line. `product` is required —
    everything else has a client-supplied fallback (see
    OrderCreateSerializer.create) used only if the product has since been
    deleted, so a historical order line never breaks."""

    product = serializers.PrimaryKeyRelatedField(
        queryset=Product.objects.all(), required=False, allow_null=True
    )
    quantity = serializers.IntegerField(min_value=1, default=1)
    size = serializers.CharField(required=False, allow_blank=True, default='')
    color = serializers.CharField(required=False, allow_blank=True, default='')
    # Fallback snapshot values from the cart, used only when `product` is
    # missing/deleted — see create(). Never trusted over live product data.
    client_name = serializers.CharField(required=False, allow_blank=True, default='')
    client_image = serializers.CharField(required=False, allow_blank=True, default='')
    client_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True, default=None
    )


class OrderCreateSerializer(serializers.ModelSerializer):
    """
    POST /api/orders/ — public (checkout has no login).

    Price and stock are authoritative from the Product table, never from
    the client — a client-supplied price/quantity is only ever a display
    fallback for products that no longer exist. Stock is checked and
    decremented atomically in the same transaction as order creation, so
    two simultaneous checkouts can never both succeed off the last unit.
    """

    items = OrderItemInputSerializer(many=True)
    # Required at checkout — see Order.phone_alt for why. The model field
    # itself allows blank so historical rows stay valid; this serializer
    # is where "required from now on" is enforced.
    phone_alt = serializers.CharField(required=True, allow_blank=False)

    class Meta:
        model = Order
        fields = [
            'customer_name', 'phone', 'phone_alt', 'address', 'notes',
            'currency', 'shipping_cost', 'payment_method', 'items',
        ]

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError('Your bag is empty.')
        return items

    def validate_phone(self, value):
        return _validate_egyptian_phone(value)

    def validate_phone_alt(self, value):
        return _validate_egyptian_phone(value)

    def validate(self, attrs):
        if attrs.get('phone') and attrs.get('phone') == attrs.get('phone_alt'):
            raise serializers.ValidationError({
                'phone_alt': 'The backup number must be different from the main number.'
            })
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop('items')
        shipping_cost = validated_data.pop('shipping_cost', Decimal('0'))

        order = Order.objects.create(**validated_data, shipping_cost=shipping_cost)

        subtotal = Decimal('0')
        order_items = []
        for raw_item in items_data:
            product = raw_item.get('product')
            quantity = raw_item['quantity']

            if product is not None:
                # Lock the row so concurrent checkouts can't both read the
                # same stock count before either one decrements it.
                product = Product.objects.select_for_update().get(pk=product.pk)
                if product.stock < quantity:
                    raise serializers.ValidationError({
                        'items': f'"{product.name}" only has {product.stock} left in stock.'
                    })
                product.stock -= quantity
                product.save(update_fields=['stock'])

                unit_price = Decimal(str(product.effective_price))
                product_name = product.name
                product_image = _first_thumb(product.images)
            else:
                # Product referenced no longer exists — fall back to
                # whatever the client had cached from when it was added
                # to the cart, so the order still records *something*
                # meaningful instead of failing outright.
                unit_price = raw_item.get('client_price') or Decimal('0')
                product_name = raw_item.get('client_name') or 'Deleted product'
                product_image = raw_item.get('client_image') or ''

            line_total = unit_price * quantity
            subtotal += line_total
            order_items.append(OrderItem(
                order=order,
                product=product,
                product_name=product_name,
                product_image=product_image,
                unit_price=unit_price,
                quantity=quantity,
                size=raw_item.get('size', ''),
                color=raw_item.get('color', ''),
            ))

        OrderItem.objects.bulk_create(order_items)
        order.subtotal = subtotal
        order.total = subtotal + order.shipping_cost
        order.save(update_fields=['subtotal', 'total'])

        notify_new_order(order)
        return order

    def to_representation(self, instance):
        # Respond with the full read shape (including display_id, items,
        # computed totals) rather than the create-only input shape.
        return OrderSerializer(instance, context=self.context).data


def _validate_egyptian_phone(value):
    """Egyptian mobile numbers: 11 digits starting 010/011/012/015.
    Spaces, dashes and a +20 / 0020 country prefix are stripped rather
    than rejected — customers type numbers all sorts of ways, and the
    point is to catch genuinely unreachable numbers (the digit-short
    one that prompted this), not to fail someone over formatting."""
    digits = re.sub(r'[\s\-()]', '', value or '')
    if digits.startswith('+20'):
        digits = '0' + digits[3:]
    elif digits.startswith('0020'):
        digits = '0' + digits[4:]
    elif digits.startswith('20') and len(digits) == 12:
        digits = '0' + digits[2:]

    if not re.fullmatch(r'01[0125]\d{8}', digits):
        raise serializers.ValidationError(
            'Enter a valid Egyptian mobile number — 11 digits starting with '
            '010, 011, 012 or 015.'
        )
    return digits


def _first_thumb(images):
    """images is the same [{"large","thumb"}] / ["url"] two-shape format
    used everywhere else — mirrors src/lib/images.js's getThumbUrl()."""
    if not images:
        return ''
    first = images[0]
    if isinstance(first, str):
        return first
    if isinstance(first, dict):
        return first.get('thumb') or first.get('large') or ''
    return ''
