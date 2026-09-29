from rest_framework.routers import DefaultRouter

from .views import CategoryViewSet, ProductViewSet, PromoCodeViewSet

router = DefaultRouter(trailing_slash=True)
# 'categories' and 'promo-codes' must be registered before the empty ''
# prefix below — DefaultRouter matches in registration order, and an
# empty-prefix ViewSet registered first would shadow them as if they
# were product lookups (e.g. /promo-codes/ read as product id
# "promo-codes").
router.register('categories', CategoryViewSet, basename='category')
router.register('promo-codes', PromoCodeViewSet, basename='promocode')
router.register('', ProductViewSet, basename='product')

urlpatterns = router.urls
