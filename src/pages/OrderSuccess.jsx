import { useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import PageTransition from '../components/PageTransition';

export default function OrderSuccess() {
  const { orderId } = useParams();
  const [searchParams] = useSearchParams();
  const total = Number(searchParams.get('total'));

  // Fires Meta's "Purchase" conversion event — this is the event the
  // ad account actually optimizes/reports against, distinct from the
  // PageView that fires on every page via the pixel snippet in
  // index.html. The order value travels in the URL (?total=...) rather
  // than router navigation state, because state doesn't survive a page
  // refresh or a direct link open — losing it silently sent `value:
  // undefined` to Meta, which is what caused the "Parameter 'currency'
  // is invalid" console warning (Meta rejects the event when value is
  // missing, and reports it against the neighboring currency param).
  // Guarded by orderId in sessionStorage so a refresh (or revisiting
  // this URL later) never double-counts the same order as two purchases.
  //
  // Meta's Events Manager flagged low parameter coverage on this event —
  // it wants content_ids/contents/content_type/num_items describing what
  // was actually bought, not just the total. Cart.jsx stashes each line
  // item (id/price/quantity) in sessionStorage right before clearing the
  // cart, specifically so this handler can still read it here.
  useEffect(() => {
    if (!orderId || !total || typeof window === 'undefined' || typeof window.fbq !== 'function') return;
    const key = `eon_purchase_tracked_${orderId}`;
    if (sessionStorage.getItem(key)) return;

    const itemsKey = `eon_order_items_${orderId}`;
    let lineItems = [];
    try {
      lineItems = JSON.parse(sessionStorage.getItem(itemsKey) || '[]');
    } catch {
      lineItems = [];
    }

    const purchaseParams = {
      value: total,
      currency: 'EGP',
      order_id: orderId,
    };

    if (lineItems.length > 0) {
      purchaseParams.content_ids = lineItems.map((i) => String(i.id));
      purchaseParams.contents = lineItems.map((i) => ({
        id: String(i.id),
        quantity: i.quantity,
        item_price: i.price,
      }));
      purchaseParams.content_type = 'product';
      purchaseParams.num_items = lineItems.reduce((sum, i) => sum + i.quantity, 0);
    } else {
      // Fallback so the event still fires with *something* identifying
      // the order if the sessionStorage entry is missing (e.g. an old
      // tab still open from before this change shipped).
      purchaseParams.content_ids = [orderId];
    }

    window.fbq('track', 'Purchase', purchaseParams);
    sessionStorage.setItem(key, '1');
    sessionStorage.removeItem(itemsKey);
  }, [orderId, total]);

  return (
    <PageTransition>
      <section className="mx-auto flex min-h-[80vh] max-w-[1600px] flex-col items-center justify-center px-6 text-center md:px-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="flex h-16 w-16 items-center justify-center rounded-full border border-electric text-electric"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 12.5l5 5L20 6.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.div>

        <p className="eyebrow mt-8 text-electric">Order Submitted Successfully</p>
        <h1 className="font-display mt-4 text-4xl font-medium md:text-6xl">
          Thank You
        </h1>
        <p className="mt-6 max-w-md text-ink-soft">
          Your order has been received. We'll contact you shortly to
          confirm the details.
        </p>

        <div className="mt-8 border border-line px-8 py-4">
          <p className="eyebrow text-gray-mid">Order ID</p>
          <p className="font-mono mt-1 text-xl tracking-wider">{orderId}</p>
        </div>

        <Link
          to="/collection"
          className="eyebrow mt-10 border border-ink px-8 py-4 hover:bg-ink hover:text-bg"
        >
          Continue Shopping
        </Link>
      </section>
    </PageTransition>
  );
}
