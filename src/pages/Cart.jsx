import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import { useCart } from '../context/CartContext';
import { createOrder } from '../lib/db/orders';

const fmt = (n) => `${n.toLocaleString()} EGP`;

// Cairo/Giza get the discounted in-city rate; every other governorate
// pays the standard out-of-town rate. Keep this list exhaustive (all 27
// governorates) so "Other" never silently applies to somewhere that
// should count as Cairo/Giza — and so the dropdown always resolves to
// a real fee, never an unset one.
const CAIRO_GIZA_FEE = 50;
const OTHER_FEE = 70;
const GOVERNORATES = [
  'Cairo', 'Giza',
  'Alexandria', 'Aswan', 'Asyut', 'Beheira', 'Beni Suef', 'Dakahlia',
  'Damietta', 'Faiyum', 'Gharbia', 'Ismailia', 'Kafr El Sheikh',
  'Luxor', 'Matrouh', 'Minya', 'Monufia', 'New Valley', 'North Sinai',
  'Port Said', 'Qalyubia', 'Qena', 'Red Sea', 'Sharqia', 'Sohag',
  'South Sinai', 'Suez',
];
const shippingFeeFor = (governorate) =>
  governorate === 'Cairo' || governorate === 'Giza' ? CAIRO_GIZA_FEE : OTHER_FEE;

// Strips spaces/dashes and a +20 / 0020 / 20 country prefix, so the two
// numbers can be compared and validated regardless of how they were
// typed. Kept in sync with _validate_egyptian_phone in
// backend/orders/serializers.py.
const normalizePhone = (value) => {
  let digits = String(value || '').replace(/[\s\-()]/g, '');
  if (digits.startsWith('+20')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('0020')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('20') && digits.length === 12) digits = '0' + digits.slice(2);
  return digits;
};

const isValidEgyptianPhone = (value) => /^01[0125]\d{8}$/.test(normalizePhone(value));

export default function Cart() {
  const { items, updateQuantity, removeItem, subtotal, clearCart } = useCart();
  const [customer, setCustomer] = useState({
    name: '', phone: '', phoneAlt: '', address: '', governorate: 'Cairo', notes: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const checkoutTracked = useRef(false);

  const shippingCost = shippingFeeFor(customer.governorate);
  const total = subtotal + shippingCost;

  // Fires Meta's "InitiateCheckout" once per visit to this page while
  // the bag has items — signals "customer started checking out",
  // distinct from AddToCart (adding an item) and Purchase (completed
  // order). Guarded by a ref rather than sessionStorage: unlike
  // Purchase, re-firing on a later separate visit to the cart is fine
  // and expected — we just don't want it firing again on every re-render
  // of this same page (e.g. as quantities change).
  useEffect(() => {
    if (checkoutTracked.current) return;
    if (items.length === 0) return;
    if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
    window.fbq('track', 'InitiateCheckout', {
      value: subtotal,
      currency: 'EGP',
      content_ids: items.map((i) => i.id),
      num_items: items.reduce((sum, i) => sum + i.quantity, 0),
    });
    checkoutTracked.current = true;
  }, [items, subtotal]);

  const handleChange = (e) =>
    setCustomer((c) => ({ ...c, [e.target.name]: e.target.value }));

  const handleCheckout = async () => {
    if (submitting) return;
    if (items.length === 0) {
      setError('Your bag is empty.');
      return;
    }
    if (!customer.name || !customer.phone || !customer.phoneAlt || !customer.address) {
      setError('Fill in your name, both phone numbers, and address to continue.');
      return;
    }
    // Mirrors the backend's _validate_egyptian_phone so a bad number is
    // caught before a round trip. The backend check is the real one —
    // this is just for a faster, clearer message.
    if (!isValidEgyptianPhone(customer.phone)) {
      setError('Enter a valid Egyptian mobile number — 11 digits starting with 010, 011, 012 or 015.');
      return;
    }
    if (!isValidEgyptianPhone(customer.phoneAlt)) {
      setError('Enter a valid backup mobile number — 11 digits starting with 010, 011, 012 or 015.');
      return;
    }
    if (normalizePhone(customer.phone) === normalizePhone(customer.phoneAlt)) {
      setError('The backup number must be different from the main number.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const { displayId } = await createOrder({
        customer,
        items,
        subtotal,
        currency: 'EGP',
        shippingCost,
      });
      // OrderSuccess needs each line item's id/price/quantity to build
      // Meta's `contents`/`content_ids`/`num_items` — router state doesn't
      // survive a refresh or a direct link open (see OrderSuccess.jsx), so
      // this rides in sessionStorage instead, keyed by order id, and
      // clearCart() below would otherwise erase it.
      sessionStorage.setItem(
        `eon_order_items_${displayId}`,
        JSON.stringify(items.map((i) => ({ id: i.id, price: i.price, quantity: i.quantity })))
      );
      clearCart();
      navigate(`/order-success/${displayId}?total=${total}`);
    } catch (err) {
      // Surface real validation messages (e.g. "only 3 left in stock")
      // when the backend provides one, instead of only a generic
      // message — same error element, just more useful text in it.
      setError(err?.message || 'Something went wrong placing your order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <PageTransition>
        <section className="mx-auto flex min-h-[70vh] max-w-[1600px] flex-col items-center justify-center px-6 text-center md:px-10">
          <p className="eyebrow text-electric">Your Bag</p>
          <h1 className="font-display mt-4 text-4xl font-medium md:text-5xl">
            It's empty in here.
          </h1>
          <Link
            to="/collection"
            className="eyebrow mt-8 border border-ink px-8 py-4 hover:bg-ink hover:text-bg"
          >
            Explore Collection
          </Link>
        </section>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <section className="mx-auto max-w-[1600px] px-6 pt-36 pb-24 md:px-10">
        <p className="eyebrow text-electric">Checkout</p>
        <h1 className="font-display mt-4 text-5xl font-medium md:text-6xl">Your Bag</h1>

        <div className="mt-14 grid gap-16 md:grid-cols-[1.3fr_1fr]">
          {/* Items */}
          <div>
            <ul className="divide-y divide-line border-y border-line">
              {items.map((item) => (
                <li key={item.lineId} className="flex gap-5 py-6">
                  <div className="h-32 w-24 flex-shrink-0 overflow-hidden bg-gray">
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col justify-between">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-display text-lg">{item.name}</p>
                        <p className="mt-1 text-sm text-gray-mid">
                          {item.color} / {item.size}
                        </p>
                      </div>
                      <button
                        onClick={() => removeItem(item.lineId)}
                        className="text-xs text-gray-mid hover:text-electric"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center border border-line">
                        <button
                          className="px-3 py-1.5 text-ink-soft hover:text-electric"
                          onClick={() => updateQuantity(item.lineId, item.quantity - 1)}
                        >
                          −
                        </button>
                        <span className="font-mono px-3 text-sm">{item.quantity}</span>
                        <button
                          className="px-3 py-1.5 text-ink-soft hover:text-electric"
                          onClick={() => updateQuantity(item.lineId, item.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <p className="font-mono text-base">{fmt(item.price * item.quantity)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <button
              onClick={clearCart}
              className="mt-6 text-xs text-gray-mid underline hover:text-electric"
            >
              Clear bag
            </button>
          </div>

          {/* Checkout form */}
          <div>
            <div className="border border-line p-8">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Subtotal</span>
                  <span className="font-mono">{fmt(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft">Shipping</span>
                  <span className="font-mono">{fmt(shippingCost)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-line pt-2">
                  <span className="text-ink-soft">Total</span>
                  <span className="font-mono text-lg">{fmt(total)}</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-mid">
                Cash on Delivery only.
              </p>

              <div className="mt-8 space-y-5">
                <Field label="Full name" name="name" value={customer.name} onChange={handleChange} />
                <Field label="Phone number" name="phone" value={customer.phone} onChange={handleChange} type="tel" />
                <Field label="Backup phone number" name="phoneAlt" value={customer.phoneAlt} onChange={handleChange} type="tel" />
                <div>
                  <label className="eyebrow text-gray-mid" htmlFor="governorate">
                    Governorate
                  </label>
                  <div className="relative mt-2">
                    <select
                      id="governorate"
                      name="governorate"
                      value={customer.governorate}
                      onChange={handleChange}
                      className="w-full appearance-none border-b border-line bg-bg py-3 pr-8 text-ink outline-none focus:border-electric"
                    >
                      {GOVERNORATES.map((g) => (
                        <option key={g} value={g} className="bg-bg text-ink">
                          {g}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-gray-mid">
                      ▾
                    </span>
                  </div>
                </div>
                <Field label="Delivery address" name="address" value={customer.address} onChange={handleChange} textarea />
                <Field label="Order notes (optional)" name="notes" value={customer.notes} onChange={handleChange} textarea />
              </div>

              {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

              <button
                onClick={handleCheckout}
                disabled={submitting}
                aria-busy={submitting}
                className="eyebrow mt-8 flex w-full items-center justify-center gap-3 bg-electric py-4 text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Placing Order…' : 'Place Order'}
              </button>
              <p className="mt-4 text-center text-xs text-gray-mid">
                We'll contact you to confirm — nothing is charged automatically.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}

function Field({ label, name, value, onChange, type = 'text', textarea = false }) {
  return (
    <div>
      <label className="eyebrow text-gray-mid" htmlFor={name}>
        {label}
      </label>
      {textarea ? (
        <textarea
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          rows={2}
          className="mt-2 w-full resize-none border-b border-line bg-transparent py-3 outline-none focus:border-electric"
        />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          className="mt-2 w-full border-b border-line bg-transparent py-3 outline-none focus:border-electric"
        />
      )}
    </div>
  );
}
