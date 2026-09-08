from django.db import migrations, models


def copy_discount_to_discount_value(apps, schema_editor):
    Product = apps.get_model('products', 'Product')
    for product in Product.objects.all():
        product.discount_value = product.discount
        product.save(update_fields=['discount_value'])


def copy_discount_value_to_discount(apps, schema_editor):
    Product = apps.get_model('products', 'Product')
    for product in Product.objects.all():
        product.discount = int(product.discount_value)
        product.save(update_fields=['discount'])


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0004_populate_categories'),
    ]

    operations = [
        migrations.AddField(
            model_name='product',
            name='discount_type',
            field=models.CharField(
                max_length=10,
                choices=[('percentage', 'Percentage'), ('fixed', 'Fixed Amount')],
                default='percentage',
            ),
        ),
        migrations.AddField(
            model_name='product',
            name='discount_value',
            field=models.DecimalField(max_digits=10, decimal_places=2, default=0),
        ),
        migrations.AddField(
            model_name='product',
            name='discount_start',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='product',
            name='discount_end',
            field=models.DateTimeField(null=True, blank=True),
        ),
        # Carry over existing percent values from the old `discount`
        # field so nothing loses its current discount.
        migrations.RunPython(copy_discount_to_discount_value, copy_discount_value_to_discount),
        migrations.RemoveField(
            model_name='product',
            name='discount',
        ),
    ]
