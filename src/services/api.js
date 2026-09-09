// Thin fetch wrapper for the Django REST API (see /backend).
//
// This is the single source of truth for admin authentication. Every
// module below reads/writes through here:
//   - src/context/AdminAuthContext.jsx -> adminLogin / adminLogout /
//                                          getCurrentAdmin / restoreSession
//   - src/hooks/useProducts.js         -> fetchProducts / fetchProduct
//   - src/lib/db/products.js           -> createProduct / updateProduct / deleteProduct
//   - src/lib/db/orders.js             -> createOrder / fetchOrders / fetchOrder /
//                                          updateOrderStatus / markOrderRead / cancelOrder
// Admin auth no longer touches Firebase at all — see MIGRATION.md.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

const TOKEN_KEY = 'eon_admin_tokens'; // { access, refresh }

function getTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
  } catch {
    return null;
  }
}

function setTokens(tokens) {
  if (!tokens) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function hasStoredSession() {
  return Boolean(getTokens()?.refresh);
}

// Fired once when a request's refresh attempt genuinely fails (refresh
// token missing/expired/rejected) — i.e. the session is truly over and
// every caller should treat the admin as logged out. AdminAuthContext
// listens for this so a 401 anywhere in the app (not just a manual
// "Sign out" click) clears user state and redirects to /admin/login.
// Centralizing it here means no page/component has to know how tokens
// work — see PART 2 of the phase 4.5 brief ("centralize all
// authentication logic").
const SESSION_EXPIRED_EVENT = 'eon-admin-session-expired';

function announceSessionExpired() {
  setTokens(null);
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

export function onSessionExpired(handler) {
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
}

// DRF error responses show up in a few different shapes depending on
// where they're raised:
//   { "detail": "..." }                        - permission/auth errors
//   { "items": "..." }                          - a single field error string
//   { "items": ["...", "..."] }                 - a field error list
//   { "non_field_errors": ["..."] }              - serializer-level errors
// This pulls the first human-readable string out of any of those shapes,
// so the real validation message (e.g. "only 3 left in stock") always
// makes it to the UI instead of a generic "Request failed: 400".
function extractErrorMessage(detail) {
  if (!detail || typeof detail !== 'object') return null;
  if (typeof detail.detail === 'string') return detail.detail;

  const firstValue = Object.values(detail)[0];
  if (typeof firstValue === 'string') return firstValue;
  if (Array.isArray(firstValue) && typeof firstValue[0] === 'string') return firstValue[0];
  return null;
}

async function request(path, { method = 'GET', body, auth = false, retry = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const tokens = getTokens();
    if (tokens?.access) headers.Authorization = `Bearer ${tokens.access}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Access token expired — try once to refresh and replay the request.
  if (res.status === 401 && auth && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request(path, { method, body, auth, retry: false });
    announceSessionExpired();
  }

  if (!res.ok) {
    let detail;
    try {
      detail = await res.json();
    } catch {
      detail = { detail: res.statusText };
    }
    const err = new Error(extractErrorMessage(detail) || `Request failed: ${res.status}`);
    err.status = res.status;
    err.body = detail;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

// Same auth/401-refresh contract as request(), but for bodies that must
// NOT be JSON-encoded (FormData for multipart file uploads, primarily).
// Used by src/lib/djangoStorage.js for product image upload/delete — kept
// here rather than duplicated so both share one refresh/session-expiry
// path. Deliberately does not set Content-Type: the browser needs to add
// its own multipart boundary for FormData bodies.
export async function authFetch(path, { method = 'GET', body, retry = true } = {}) {
  const tokens = getTokens();
  const headers = {};
  if (tokens?.access) headers.Authorization = `Bearer ${tokens.access}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { method, headers, body });

  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return authFetch(path, { method, body, retry: false });
    announceSessionExpired();
  }

  if (!res.ok) {
    let detail;
    try {
      detail = await res.json();
    } catch {
      detail = { detail: res.statusText };
    }
    const err = new Error(extractErrorMessage(detail) || `Request failed: ${res.status}`);
    err.status = res.status;
    err.body = detail;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

// Concurrent 401s (e.g. the dashboard firing several authed requests at
// once right as the access token expires) must not each kick off their
// own refresh — SIMPLE_JWT rotates refresh tokens, so a second refresh
// call made with an already-rotated-away token would fail and log the
// admin out even though the first refresh actually succeeded. This
// in-flight promise makes every caller share one refresh attempt.
let refreshPromise = null;

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh() {
  const tokens = getTokens();
  if (!tokens?.refresh) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: tokens.refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    // ROTATE_REFRESH_TOKENS is on in settings.py, so a fresh refresh
    // token comes back on every call — the old one stops working, so it
    // must be persisted here or the *next* refresh silently fails.
    setTokens({ access: data.access, refresh: data.refresh || tokens.refresh });
    return true;
  } catch {
    return false;
  }
}

// --- Auth (admin only) -----------------------------------------------

export async function adminLogin(username, password) {
  const data = await request('/auth/login/', {
    method: 'POST',
    body: { username, password },
  });
  setTokens({ access: data.access, refresh: data.refresh });
  return data;
}

export function adminLogout() {
  setTokens(null);
}

export function isAdminLoggedIn() {
  return Boolean(getTokens()?.access);
}

export function getCurrentAdmin() {
  return request('/auth/me/', { auth: true });
}

// Called once on app load. If a refresh token is stored (from a previous
// session), this proves it's still valid and returns the current admin —
// refreshing the access token first if it's already expired, exactly like
// any other authed request. Powers "auto-login after page refresh".
// Returns null (never throws) so callers can treat any failure the same
// way: no valid session.
export async function restoreSession() {
  if (!hasStoredSession()) return null;
  try {
    return await getCurrentAdmin();
  } catch {
    setTokens(null);
    return null;
  }
}

// --- Products -----------------------------------------------------------

// Maps a Django ProductSerializer response onto the exact shape
// src/lib/db/products.js already produces from Firestore (normalize() +
// withEffectivePrice()). Keeping the shapes identical is what lets every
// page/component work unchanged regardless of which backend is active.
export function normalizeApiProduct(raw) {
  const price = Number(raw.price) || 0;
  const isDiscountActive = Boolean(raw.isDiscountActive);
  const effective = isDiscountActive
    ? Number(raw.effectivePrice) || price
    : price;
  return {
    id: String(raw.id),
    name: raw.name || '',
    tag: raw.tag || '',
    category: raw.category || '',
    price: effective,
    originalPrice: isDiscountActive ? price : undefined,
    currency: raw.currency || 'EGP',
    discount_type: raw.discount_type || 'percentage',
    discount_value: Number(raw.discount_value) || 0,
    discount_start: raw.discount_start ?? null,
    discount_end: raw.discount_end ?? null,
    isDiscountActive,
    effectivePrice: effective,
    description: raw.description || '',
    details: Array.isArray(raw.details) ? raw.details : [],
    colors: Array.isArray(raw.colors) ? raw.colors : [],
    sizes: Array.isArray(raw.sizes) ? raw.sizes : [],
    images: Array.isArray(raw.images) ? raw.images : [],
    stock: raw.stock ?? 0,
    visible: raw.visible !== false,
    createdAt: raw.created_at ?? null,
  };
}

// Returns the raw DRF response — either a plain array (pagination somehow
// disabled) or a { count, next, previous, results } page. Callers that
// need the full catalog handle the paging themselves (see
// hooks/useProducts.js); callers that just need "a page" (e.g. related
// products, the admin Products table) use this directly.
export function fetchProducts({ all = false, category, search, ordering, page } = {}) {
  const params = new URLSearchParams();
  if (all) params.set('all', '1');
  if (category) params.set('category', category);
  if (search) params.set('search', search);
  if (ordering) params.set('ordering', ordering);
  if (page) params.set('page', page);
  const qs = params.toString();
  return request(`/products/${qs ? `?${qs}` : ''}`, { auth: all });
}

export function fetchProduct(id) {
  return request(`/products/${id}/`);
}

export function createProduct(data) {
  return request('/products/', { method: 'POST', body: data, auth: true });
}

export function updateProduct(id, data) {
  return request(`/products/${id}/`, { method: 'PATCH', body: data, auth: true });
}

export function deleteProduct(id) {
  return request(`/products/${id}/`, { method: 'DELETE', auth: true });
}

// --- Categories (Phase 2 — replaces Firestore `categories` collection) ---
// Backed by the new Django Category endpoints added in Phase 1
// (backend/products: CategoryViewSet). List responses go through DRF's
// default pagination, so this unwraps `{ results: [...] }` down to a
// plain array — the shape src/lib/db/categories.js and its consumers
// (Categories.jsx, ProductForm.jsx) already expect from Firestore.

export async function fetchCategories() {
  const data = await request('/products/categories/');
  return Array.isArray(data) ? data : data?.results || [];
}

export function createCategory(name) {
  return request('/products/categories/', { method: 'POST', body: { name }, auth: true });
}

export function updateCategory(id, name) {
  return request(`/products/categories/${id}/`, { method: 'PATCH', body: { name }, auth: true });
}

export function deleteCategory(id) {
  return request(`/products/categories/${id}/`, { method: 'DELETE', auth: true });
}

// --- Orders ---------------------------------------------------------------

export function createOrder(order) {
  return request('/orders/', { method: 'POST', body: order });
}

export function fetchOrders(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`/orders/${qs ? `?${qs}` : ''}`, { auth: true });
}

export function fetchOrder(id) {
  return request(`/orders/${id}/`, { auth: true });
}

export function updateOrderStatus(id, statusValue) {
  return request(`/orders/${id}/status/`, { method: 'PATCH', body: { status: statusValue }, auth: true });
}

export function markOrderRead(id) {
  return request(`/orders/${id}/read/`, { method: 'PATCH', auth: true });
}

export function cancelOrder(id) {
  return request(`/orders/${id}/cancel/`, { method: 'POST', auth: true });
}

// Public — no accounts exist, so "my orders" is scoped by phone number
// (matches the phone the customer entered at checkout).
export function fetchMyOrders(phone) {
  return request(`/orders/my-orders/?phone=${encodeURIComponent(phone)}`);
}

// --- Inventory --------------------------------------------------------
// Admin-only, Django-native — no Firebase equivalent, so (unlike
// products/orders) there's no lib/db abstraction layer to go through.

export function fetchInventory({ search, lowStock, outOfStock, ordering, page } = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (lowStock) params.set('low_stock', '1');
  if (outOfStock) params.set('out_of_stock', '1');
  if (ordering) params.set('ordering', ordering);
  if (page) params.set('page', page);
  const qs = params.toString();
  return request(`/inventory/${qs ? `?${qs}` : ''}`, { auth: true });
}

export function updateInventoryStock(id, data) {
  return request(`/inventory/${id}/`, { method: 'PATCH', body: data, auth: true });
}

export function fetchInventoryHistory(productId, page) {
  const qs = page ? `?page=${page}` : '';
  return request(`/inventory/${productId}/history/${qs}`, { auth: true });
}

// --- Customers ----------------------------------------------------------
// Admin-only, Django-native, derived from Order (no Customer model exists
// — see backend/customers/views.py) — no Firebase equivalent, same as
// Inventory above.

export function fetchCustomers({ search, ordering, page } = {}) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (ordering) params.set('ordering', ordering);
  if (page) params.set('page', page);
  const qs = params.toString();
  return request(`/customers/${qs ? `?${qs}` : ''}`, { auth: true });
}

export function fetchCustomerDetail(phone) {
  return request(`/customers/${encodeURIComponent(phone)}/`, { auth: true });
}

// --- Analytics ------------------------------------------------------------
// Admin-only, Django-native, derived from Order/OrderItem/Product — no
// Firebase equivalent.

export function fetchAnalyticsSummary() {
  return request('/analytics/summary/', { auth: true });
}

// --- Reports (Phase 5.5) --------------------------------------------------
// Admin-only, Django-native, derived from Order/OrderItem/Product — same
// "nothing stored, nothing to drift" principle as Analytics/Customers.

function dateRangeParams({ dateFrom, dateTo } = {}) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  return params;
}

export function fetchSalesReport({ dateFrom, dateTo } = {}) {
  const qs = dateRangeParams({ dateFrom, dateTo }).toString();
  return request(`/reports/sales/${qs ? `?${qs}` : ''}`, { auth: true });
}

export function fetchOrdersReport({ dateFrom, dateTo } = {}) {
  const qs = dateRangeParams({ dateFrom, dateTo }).toString();
  return request(`/reports/orders/${qs ? `?${qs}` : ''}`, { auth: true });
}

export function fetchInventoryReport() {
  return request('/reports/inventory/', { auth: true });
}

export function fetchProductsReport({ dateFrom, dateTo, limit } = {}) {
  const params = dateRangeParams({ dateFrom, dateTo });
  if (limit !== undefined) params.set('limit', limit);
  const qs = params.toString();
  return request(`/reports/products/${qs ? `?${qs}` : ''}`, { auth: true });
}

// Client-side CSV export — no new dependency, mirrors the "kept to the
// existing stack" choice already made for Analytics' chart bars.
export function exportRowsAsCsv(filename, rows) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
