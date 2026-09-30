import django.db.models.deletion
from django.db import migrations, models


def split_by_product(apps, schema_editor):
    """Each old PromoCode could be attached to several products sharing
    one discount_type/discount_value — exactly the bug being fixed here.
    For each old row: keep it for its first product, and clone it (same
    code/discount/active, independent row) for every other product it
    was on, so nothing that was previously discounted stops being so."""
    PromoCode = apps.get_model('products', 'PromoCode')
    for promo in PromoCode.objects.all():
        products = list(promo.products.all())
        if not products:
            promo.delete()
            continue
        first, *rest = products
        promo.product_id = first.id
        promo.save(update_fields=['product'])
        for extra in rest:
            PromoCode.objects.create(
                code=promo.code,
                discount_type=promo.discount_type,
                discount_value=promo.discount_value,
                product_id=extra.id,
                active=promo.active,
            )


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0006_promocode'),
    ]

    operations = [
        migrations.AddField(
            model_name='promocode',
            name='product',
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='promo_code',
                to='products.product',
            ),
        ),
        migrations.RunPython(split_by_product, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='promocode',
            name='products',
        ),
        migrations.AlterField(
            model_name='promocode',
            name='product',
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='promo_code',
                to='products.product',
            ),
        ),
        migrations.AlterField(
            model_name='promocode',
            name='code',
            field=models.CharField(db_index=True, max_length=40),
        ),
    ]
