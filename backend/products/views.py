import os
import uuid

from django.core.files.storage import default_storage
from rest_framework import filters, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from .models import Category, PromoCode, Product
from .serializers import CategorySerializer, ProductSerializer, PromoCodeSerializer

# Every uploaded file lives under MEDIA_ROOT/products/<product_id>/<variant>/.
# Kept as a helper so the upload and delete actions agree on the exact same
# path shape, and so delete can safety-check a path stays inside it.
def _product_image_dir(product_id, variant):
    return f'products/{product_id}/{variant}'


def _safe_relative_media_path(product_id, value):
    """Resolve a URL or path the client sent back to a path relative to
    MEDIA_ROOT, and confirm it's actually inside this product's own
    products/<id>/ directory before anything is allowed to delete it.
    Returns None if `value` isn't a Django-media path we own (e.g. a
    legacy Firebase Storage URL) — callers should then just skip it,
    exactly like the existing Firebase deleteProductImageSet does for
    URLs it doesn't recognize.
    """
    if not value:
        return None
    from django.conf import settings

    media_url = settings.MEDIA_URL
    idx = value.find(media_url)
    if idx == -1:
        return None
    relative = value[idx + len(media_url):]
    prefix = f'products/{product_id}/'
    if not relative.startswith(prefix):
        return None
    return relative


class IsAdminOrReadOnly(permissions.BasePermission):
    """Anyone can GET; only an authenticated staff (admin) user can
    create, update, or delete. There are no customer accounts, so this
    is the only write permission the API needs."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return bool(request.user and request.user.is_staff)


class CategoryViewSet(viewsets.ModelViewSet):
    """
    GET    /api/products/categories/          -> list (public)
    GET    /api/products/categories/<id>/     -> retrieve (public)
    POST   /api/products/categories/          -> create (admin)
    PUT    /api/products/categories/<id>/     -> full update (admin)
    PATCH  /api/products/categories/<id>/     -> partial update (admin)
    DELETE /api/products/categories/<id>/     -> delete (admin)

    Phase 1: this is additive. Nothing on Product or its API currently
    writes through this — Product.category (string) stays the field the
    frontend reads/writes until Phase 2.
    """

    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsAdminOrReadOnly]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name']
    ordering_fields = ['name', 'created_at']


class PromoCodeViewSet(viewsets.ModelViewSet):
    """
    Admin-only CRUD for coupon codes, plus one public read action:

    GET  /api/products/promo-codes/            -> list (admin)
    POST /api/products/promo-codes/            -> create (admin)
    ...standard ModelViewSet routes, all admin-only...
    GET  /api/products/promo-codes/check/?code=XXX -> public lookup used
         by the cart page. Deliberately returns only what the frontend
         needs to preview a discount (type, value, which product ids it
         applies to) — never the full list of codes, so this can't be
         used to enumerate active coupons.
    """

    queryset = PromoCode.objects.all()
    serializer_class = PromoCodeSerializer
    permission_classes = [permissions.IsAdminUser]

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAdminUser], url_path='find')
    def find(self, request):
        """Admin-only exact lookup by code (active or not) — used by the
        Add/Edit Product form so typing an existing code updates that
        code (adding this product to it) instead of erroring on the
        unique constraint by trying to create a duplicate."""
        code = (request.query_params.get('code') or '').strip().upper()
        if not code:
            return Response({'error': 'No code provided.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            promo = PromoCode.objects.get(code=code)
        except PromoCode.DoesNotExist:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(promo).data)

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAdminUser], url_path='for-product')
    def for_product(self, request):
        """Admin-only: the promo code currently attached to a given
        product (if any) — lets the Add/Edit Product form pre-fill the
        promo code fields when editing a product that already has one.
        A product could technically be on more than one code; this
        returns the most recently created, since the product form only
        edits one at a time."""
        product_id = request.query_params.get('product_id')
        if not product_id:
            return Response({'error': 'No product_id provided.'}, status=status.HTTP_400_BAD_REQUEST)
        promo = PromoCode.objects.filter(products__id=product_id).order_by('-created_at').first()
        if not promo:
            return Response(None)
        return Response(self.get_serializer(promo).data)

    @action(detail=False, methods=['get'], permission_classes=[permissions.AllowAny], url_path='check')
    def check(self, request):
        code = (request.query_params.get('code') or '').strip().upper()
        if not code:
            # 'error' listed first: services/api.js's extractErrorMessage()
            # reads the first key of a non-2xx JSON body as the display
            # message, so 'valid' (a bool, not a string) coming first
            # would make it fall through to a generic "Request failed: 400".
            return Response({'error': 'No code provided.', 'valid': False}, status=status.HTTP_400_BAD_REQUEST)
        try:
            promo = PromoCode.objects.get(code=code, active=True)
        except PromoCode.DoesNotExist:
            return Response({'error': 'Invalid or inactive code.', 'valid': False}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            'valid': True,
            'code': promo.code,
            'discount_type': promo.discount_type,
            'discount_value': promo.discount_value,
            'product_ids': list(promo.products.values_list('id', flat=True)),
        })


class ProductViewSet(viewsets.ModelViewSet):
    """
    GET    /api/products/          -> list (public, visible only unless ?all=1 + admin)
    GET    /api/products/<id>/     -> retrieve (public)
    POST   /api/products/          -> create (admin)
    PUT    /api/products/<id>/     -> full update (admin)
    PATCH  /api/products/<id>/     -> partial update (admin)
    DELETE /api/products/<id>/     -> delete (admin)
    """

    serializer_class = ProductSerializer
    permission_classes = [IsAdminOrReadOnly]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'category']
    ordering_fields = ['price', 'created_at', 'stock']

    def get_queryset(self):
        qs = Product.objects.all()
        show_all = self.request.query_params.get('all') == '1'
        if not (show_all and self.request.user and self.request.user.is_staff):
            qs = qs.filter(visible=True)
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category__iexact=category)
        return qs

    # POST   /api/products/<id>/images/  -> upload one large+thumb pair,
    #                                        returns {large, thumb} absolute URLs
    # DELETE /api/products/<id>/images/  -> best-effort delete of one pair
    #
    # Django only owns the *files* here — it never writes to Product.images
    # itself. The frontend (ProductForm.jsx) still PATCHes the product's
    # `images` JSON field afterwards, exactly as it already does for the
    # Firebase Storage path. This keeps the existing {large, thumb} JSON
    # shape and API contract on Product completely unchanged.
    @action(
        detail=True,
        methods=['post', 'delete'],
        url_path='images',
        parser_classes=[MultiPartParser, FormParser],
        permission_classes=[IsAdminOrReadOnly],
    )
    def images(self, request, pk=None):
        # IsAdminOrReadOnly already rejects non-staff for POST/DELETE (both
        # are non-SAFE methods) — same permission class the rest of this
        # viewset uses, so admin-only enforcement is identical everywhere.
        product = self.get_object()
        if request.method == 'POST':
            return self._upload_images(request, product)
        return self._delete_images(request, product)

    def _upload_images(self, request, product):
        large_file = request.FILES.get('large')
        thumb_file = request.FILES.get('thumb')
        if not large_file or not thumb_file:
            return Response(
                {'detail': 'Both "large" and "thumb" files are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        result = {}
        for variant, f in (('large', large_file), ('thumb', thumb_file)):
            ext = os.path.splitext(f.name)[1] or '.webp'
            filename = f'{uuid.uuid4().hex}{ext}'
            relative_path = f'{_product_image_dir(product.id, variant)}/{filename}'
            saved_path = default_storage.save(relative_path, f)
            result[variant] = request.build_absolute_uri(default_storage.url(saved_path))

        return Response(result, status=status.HTTP_201_CREATED)

    def _delete_images(self, request, product):
        # Best-effort, non-fatal — mirrors deleteProductImageSet() on the
        # frontend: a file that's already gone, or a legacy Firebase URL
        # this view doesn't own, is silently skipped rather than erroring.
        # DELETE requests use query params, not a JSON/multipart body — this
        # view's parser_classes are Multipart/Form only (needed for the POST
        # upload), which won't parse an application/json DELETE body.
        for variant in ('large', 'thumb'):
            value = request.query_params.get(variant)
            relative_path = _safe_relative_media_path(product.id, value)
            if relative_path and default_storage.exists(relative_path):
                default_storage.delete(relative_path)
        return Response(status=status.HTTP_204_NO_CONTENT)
