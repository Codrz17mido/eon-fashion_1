from rest_framework import serializers

from .models import Category, Product


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'created_at']
        read_only_fields = ['id', 'created_at']


class ProductSerializer(serializers.ModelSerializer):
    effectivePrice = serializers.ReadOnlyField(source='effective_price')
    isDiscountActive = serializers.ReadOnlyField(source='is_discount_active')
    # Additive, read-only for now (Phase 1) — the existing `category`
    # string field below is untouched so current frontend consumers keep
    # working unchanged. This just exposes the new FK's id alongside it;
    # nothing writes to category_relation through this serializer yet.
    category_relation_id = serializers.ReadOnlyField()

    class Meta:
        model = Product
        fields = [
            'id',
            'name',
            'description',
            'price',
            'discount_type',
            'discount_value',
            'discount_start',
            'discount_end',
            'effectivePrice',
            'isDiscountActive',
            'category',
            'category_relation_id',
            'sizes',
            'colors',
            'stock',
            'low_stock_threshold',
            'tag',
            'currency',
            'visible',
            'details',
            'images',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
