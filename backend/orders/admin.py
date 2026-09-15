from django.contrib import admin

from .models import Order, OrderItem


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ('product_name', 'product_image', 'unit_price')


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        'display_id', 'customer_name', 'phone', 'phone_alt', 'total', 'payment_method',
        'status', 'read', 'created_at',
    )
    list_filter = ('status', 'payment_method', 'read')
    search_fields = ('display_id', 'customer_name', 'phone', 'phone_alt')
    list_editable = ('status', 'read')
    readonly_fields = ('display_id', 'subtotal', 'total', 'created_at', 'updated_at')
    inlines = [OrderItemInline]
