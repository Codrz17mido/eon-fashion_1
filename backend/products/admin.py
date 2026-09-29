from django.contrib import admin

from .models import Category, PromoCode, Product


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_at')
    search_fields = ('name',)


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        'name', 'category', 'price', 'discount_type', 'discount_value',
        'discount_active_badge', 'stock', 'low_stock_threshold', 'visible', 'updated_at',
    )
    list_filter = ('category', 'visible', 'discount_type')
    search_fields = ('name', 'description')
    list_editable = ('price', 'discount_type', 'discount_value', 'stock', 'low_stock_threshold', 'visible')
    readonly_fields = ('created_at', 'updated_at')
    fieldsets = (
        (None, {'fields': ('name', 'description', 'category', 'category_relation', 'tag', 'visible')}),
        ('Pricing', {'fields': ('price', 'currency')}),
        ('Discount', {
            'fields': ('discount_type', 'discount_value', 'discount_start', 'discount_end'),
            'description': (
                'Leave start/end blank for an always-on discount while '
                'discount_value > 0. Set either to schedule a limited-time offer.'
            ),
        }),
        ('Inventory', {'fields': ('stock', 'low_stock_threshold', 'sizes', 'colors')}),
        ('Media & details', {'fields': ('images', 'details')}),
        ('Timestamps', {'fields': ('created_at', 'updated_at')}),
    )

    @admin.display(boolean=True, description='Discount active now')
    def discount_active_badge(self, obj):
        return obj.is_discount_active


@admin.register(PromoCode)
class PromoCodeAdmin(admin.ModelAdmin):
    list_display = ('code', 'discount_type', 'discount_value', 'active', 'product_count', 'created_at')
    list_filter = ('active', 'discount_type')
    search_fields = ('code',)
    list_editable = ('active',)
    filter_horizontal = ('products',)
    readonly_fields = ('created_at',)

    @admin.display(description='Products')
    def product_count(self, obj):
        return obj.products.count()
