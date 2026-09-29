import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('products', '0005_discount_type_and_schedule'),
    ]

    operations = [
        migrations.CreateModel(
            name='PromoCode',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(db_index=True, max_length=40, unique=True)),
                (
                    'discount_type',
                    models.CharField(
                        choices=[('percentage', 'Percentage'), ('fixed', 'Fixed Amount')],
                        default='percentage',
                        max_length=10,
                    ),
                ),
                ('discount_value', models.DecimalField(decimal_places=2, max_digits=10)),
                ('active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('products', models.ManyToManyField(related_name='promo_codes', to='products.product')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
