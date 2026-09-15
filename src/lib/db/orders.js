// Orders now come exclusively from the Django API (backend/orders) — see
// MIGRATION.md. Every exported function here keeps its original name and
// signature so admin/Orders.jsx and OrderSuccess.jsx (both unchanged for
// this) don't know or care that the backend switched.
import {
  createOrder as apiCreateOrder,
  fetchOrders as apiFetchOrders,
  updateOrderStatus as apiUpdateOrderStatus,
  markOrderRead as apiMarkOrderRead,
  fetchMyOrders as apiFetchMyOrders,
} from '../../services/api';

export const ORDER_STATUSES = [
  'Pending',
  'Confirmed',
  'Preparing',
  'Shipped',
  'Delivered',
  'Cancelled',
];

// Django's `created_at` comes back as an ISO string, but admin/Orders.jsx
// calls `order.createdAt.toDate()` / `.toMillis()` exactly like it did for
// a Firestore Timestamp. Rather than touch that component, this tiny shim
// gives a plain ISO string the same two methods a Firestore Timestamp
// had — so the render code keeps working unchanged.
function toTimestampLike(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  return { toDate: () => date, toMillis: () => date.getTime() };
}

// Maps a Django OrderSerializer response onto the exact shape
// admin/Orders.jsx (and OrderSuccess.jsx) expect: a nested `customer`
// object and a flat `items` array of display fields.
function normalizeApiOrder(raw) {
  return {
    id: String(raw.id),
    displayId: raw.display_id,
    customer: {
      name: raw.customer_name || '',
      phone: raw.phone || '',
      phoneAlt: raw.phone_alt || '',
      address: raw.address || '',
      notes: raw.notes || '',
    },
    items: (raw.items || []).map((item) => ({
      id: item.product,
      name: item.product_name,
      image: item.product_image,
      price: Number(item.unit_price) || 0,
      size: item.size || '',
      color: item.color || '',
      quantity: item.quantity,
    })),
    subtotal: Number(raw.subtotal) || 0,
    total: Number(raw.total) || 0,
    currency: raw.currency || 'EGP',
    status: raw.status,
    // Valid next statuses for this order — see Order.ALLOWED_TRANSITIONS
    // on the backend.
    availableTransitions: raw.available_transitions,
    read: Boolean(raw.read),
    createdAt: toTimestampLike(raw.created_at),
  };
}

// DRF's default pagination wraps list results as { results: [...] };
// unwrap defensively either way.
function unwrapList(raw) {
  return Array.isArray(raw) ? raw : raw?.results || [];
}

// Called from checkout. Any signed-out visitor is allowed to create an
// order (see OrderPermission on the Django side) but can never read,
// list, or edit orders afterward — only the admin dashboard can.
export async function createOrder({ customer, items, subtotal, currency, shippingCost = 0 }) {
  const raw = await apiCreateOrder({
    customer_name: customer.name,
    phone: customer.phone,
    phone_alt: customer.phoneAlt || '',
    address: customer.address,
    notes: customer.notes || '',
    currency: currency || 'EGP',
    shipping_cost: shippingCost,
    items: items.map((item) => ({
      product: item.id,
      quantity: item.quantity,
      size: item.size || '',
      color: item.color || '',
      // Fallback snapshot only — the server prefers live product data and
      // only falls back to these if the product was since deleted.
      client_name: item.name,
      client_image: item.image,
      client_price: item.price,
    })),
  });
  return { id: String(raw.id), displayId: raw.display_id };
}

function sortNewestFirst(list) {
  return [...list].sort((a, b) => {
    const at = a.createdAt?.toMillis?.() ?? 0;
    const bt = b.createdAt?.toMillis?.() ?? 0;
    return bt - at;
  });
}

// Live-ish subscription for the admin Orders page — newest first. Django
// has no built-in realtime push, so this polls on an interval instead;
// the function signature (`callback in, unsubscribe fn out`) matches what
// admin components already expect. If true push updates are needed
// later, swap the interval below for a websocket/SSE connection —
// nothing else here would need to change.
export function subscribeOrders(callback) {
  let cancelled = false;
  const load = async () => {
    try {
      const raw = await apiFetchOrders();
      if (cancelled) return;
      callback(sortNewestFirst(unwrapList(raw).map(normalizeApiOrder)));
    } catch (err) {
      console.error('Failed to load orders from the API:', err);
    }
  };
  load();
  const intervalId = setInterval(load, 5000);
  return () => {
    cancelled = true;
    clearInterval(intervalId);
  };
}

// Server-side paginated + filtered fetch for the admin Orders page.
// Backed by OrderViewSet's DjangoFilterBackend/SearchFilter/OrderingFilter
// (see backend/orders/views.py and filters.py) — supports ?status=&
// date_from=&date_to=&customer=&search=&ordering=&page=.
export async function fetchOrdersPage({ page = 1, pageSize, status, search, dateFrom, dateTo, ordering } = {}) {
  const params = { page };
  if (pageSize) params.page_size = pageSize;
  if (status) params.status = status;
  if (search) params.search = search;
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  params.ordering = ordering || '-created_at';

  const raw = await apiFetchOrders(params);
  if (Array.isArray(raw)) {
    // Defensive: pagination disabled server-side for some reason.
    return { results: raw.map(normalizeApiOrder), count: raw.length, next: null, previous: null };
  }
  return {
    results: unwrapList(raw).map(normalizeApiOrder),
    count: raw?.count ?? 0,
    next: raw?.next ?? null,
    previous: raw?.previous ?? null,
  };
}

export async function updateOrderStatus(id, status) {
  await apiUpdateOrderStatus(id, status);
}

export async function markOrderRead(id) {
  await apiMarkOrderRead(id);
}

// Not called from the current UI (no "My Orders" page exists yet) but
// ready for one: looks up every order placed with a given phone number,
// since there are no customer accounts to scope this to instead.
export async function getMyOrders(phone) {
  const raw = await apiFetchMyOrders(phone);
  return sortNewestFirst(unwrapList(raw).map(normalizeApiOrder));
}
