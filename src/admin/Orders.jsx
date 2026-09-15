import { useEffect, useState, Fragment } from 'react';
import {
  fetchOrdersPage,
  updateOrderStatus,
  markOrderRead,
  ORDER_STATUSES,
} from '../lib/db/orders';

const STATUS_COLORS = {
  Pending: 'bg-amber-100 text-amber-700',
  Confirmed: 'bg-blue-100 text-blue-700',
  Preparing: 'bg-purple-100 text-purple-700',
  Shipped: 'bg-indigo-100 text-indigo-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
};

const PAGE_SIZE = 24;

function formatDate(ts) {
  if (!ts?.toDate) return '—';
  return ts.toDate().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Debounces a fast-changing value (the search box) so every keystroke
// doesn't fire its own request — the dashboard only searches ~350ms after
// the admin stops typing.
function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function AdminOrders() {
  const [expanded, setExpanded] = useState(null);

  // Filters
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 350);

  // Data
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch, dateFrom, dateTo]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetchOrdersPage({ page, pageSize: PAGE_SIZE, status, search: debouncedSearch, dateFrom, dateTo })
      .then((res) => {
        if (!active) return;
        setOrders(res.results);
        setCount(res.count);
        setHasNext(Boolean(res.next));
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Failed to load orders.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, status, debouncedSearch, dateFrom, dateTo]);

  const displayedOrders = orders;
  const totalCount = count;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const canPrev = page > 1;
  const canNext = hasNext;
  const unreadCount = orders.filter((o) => !o.read).length;

  const toggleExpand = (order) => {
    const next = expanded === order.id ? null : order.id;
    setExpanded(next);
    if (next && !order.read) {
      markOrderRead(order.id);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, read: true } : o)));
    }
  };

  const handleStatusChange = async (order, newStatus) => {
    const revert = orders;
    setUpdatingId(order.id);
    setError('');
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: newStatus } : o)));
    try {
      await updateOrderStatus(order.id, newStatus);
    } catch (err) {
      setOrders(revert);
      setError(err.message || 'Failed to update order status.');
    } finally {
      setUpdatingId(null);
    }
  };

  // Orders carry `availableTransitions` straight from
  // Order.ALLOWED_TRANSITIONS (see orders/models.py) so the buttons below
  // can never offer a move the backend would reject. Falls back to
  // offering every other status if that field is ever missing.
  const transitionsFor = (order) =>
    order.availableTransitions ?? ORDER_STATUSES.filter((s) => s !== order.status);

  const clearFilters = () => {
    setStatus('');
    setSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = status || search || dateFrom || dateTo;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-medium">Orders</h1>
      <p className="mt-1 text-sm text-black/50">
        {totalCount} total — {unreadCount} unread
      </p>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-black/40">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone, order ID…"
            className="mt-1 block w-56 rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-black/40">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 block rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
          >
            <option value="">All</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-black/40">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 block rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-black/40">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 block rounded-md border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
          />
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="rounded-md px-3 py-2 text-xs text-black/50 underline hover:text-black"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-black/10 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-black/10 bg-black/[0.02] text-xs uppercase tracking-wide text-black/40">
            <tr>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-black/40">
                  Loading orders…
                </td>
              </tr>
            )}

            {!loading && displayedOrders.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-black/40">
                  {hasActiveFilters ? 'No orders match these filters.' : 'No orders yet.'}
                </td>
              </tr>
            )}

            {!loading &&
              displayedOrders.map((order) => (
                <Fragment key={order.id}>
                  <tr
                    onClick={() => toggleExpand(order)}
                    className="cursor-pointer border-b border-black/5 last:border-0 hover:bg-black/[0.02]"
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 font-mono text-xs">
                        {!order.read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        )}
                        {order.displayId}
                      </span>
                    </td>
                    <td className="px-4 py-3">{order.customer?.name}</td>
                    <td className="px-4 py-3 font-mono">
                      {order.subtotal?.toLocaleString()} {order.currency}
                    </td>
                    <td className="px-4 py-3 text-black/50">{formatDate(order.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                          STATUS_COLORS[order.status] || 'bg-black/5'
                        }`}
                      >
                        {order.status}
                      </span>
                    </td>
                  </tr>
                  {expanded === order.id && (
                    <tr className="border-b border-black/5 bg-black/[0.015]">
                      <td colSpan={5} className="px-4 py-4">
                        <p className="text-xs uppercase tracking-wide text-black/40">
                          Order details — {order.displayId}
                        </p>
                        <div className="mt-3 grid gap-6 md:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-black/40">
                              Customer
                            </p>
                            <p className="mt-1">{order.customer?.name}</p>
                            <p className="text-black/60">{order.customer?.phone}</p>
                            {order.customer?.phoneAlt && (
                              <p className="text-black/60">{order.customer.phoneAlt} (backup)</p>
                            )}
                            <p className="text-black/60">{order.customer?.address}</p>
                            {order.customer?.notes && (
                              <p className="mt-1 text-black/50">Notes: {order.customer.notes}</p>
                            )}
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-black/40">Items</p>
                            <ul className="mt-1 space-y-1">
                              {order.items?.map((item, i) => (
                                <li key={i} className="text-black/70">
                                  {item.name} — {item.color} / {item.size} × {item.quantity} —{' '}
                                  {(item.price * item.quantity).toLocaleString()} {order.currency}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="mt-4">
                          <p className="text-xs uppercase tracking-wide text-black/40">
                            Update status
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {transitionsFor(order).length === 0 && (
                              <span className="text-sm text-black/40">
                                {order.status} is a final status — no further changes possible.
                              </span>
                            )}
                            {transitionsFor(order).map((nextStatus) => (
                              <button
                                key={nextStatus}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStatusChange(order, nextStatus);
                                }}
                                disabled={updatingId === order.id}
                                className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                                  nextStatus === 'Cancelled'
                                    ? 'border border-red-300 text-red-700 hover:bg-red-50'
                                    : `${STATUS_COLORS[nextStatus] || 'bg-black/5'} hover:brightness-95`
                                }`}
                              >
                                {updatingId === order.id
                                  ? 'Updating…'
                                  : nextStatus === 'Cancelled'
                                    ? 'Cancel order'
                                    : `Mark as ${nextStatus}`}
                              </button>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && totalCount > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-black/40">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-black/15 px-3 py-1.5 disabled:opacity-30"
            >
              Previous
            </button>
            <button
              disabled={!canNext}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-black/15 px-3 py-1.5 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
