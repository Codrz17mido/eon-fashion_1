import { useEffect, useState } from 'react';

// Small pill shown on a product (e.g. "-20%" or "-50 EGP"), plus an
// optional countdown when the product carries a discount_end. Renders
// nothing when the product has no active discount.
function useCountdown(endIso) {
  const [remaining, setRemaining] = useState(() => getRemaining(endIso));

  useEffect(() => {
    if (!endIso) return undefined;
    const id = setInterval(() => setRemaining(getRemaining(endIso)), 1000);
    return () => clearInterval(id);
  }, [endIso]);

  return remaining;
}

function getRemaining(endIso) {
  if (!endIso) return null;
  const diff = new Date(endIso).getTime() - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return { days, hours, minutes, seconds };
}

export function DiscountPill({ product }) {
  if (!product.isDiscountActive) return null;
  const label =
    product.discount_type === 'fixed'
      ? `-${Number(product.discount_value)} ${product.currency || 'EGP'}`
      : `-${Number(product.discount_value)}%`;

  return (
    <span className="eyebrow inline-flex items-center bg-electric px-2.5 py-1 text-bg">
      {label}
    </span>
  );
}

export function PriceWithDiscount({ product, formatPrice }) {
  if (!product.isDiscountActive || product.originalPrice === undefined) {
    return <span className="font-mono text-lg text-ink-soft">{formatPrice(product.price, product.currency)}</span>;
  }
  return (
    <span className="font-mono flex items-baseline gap-2 text-lg">
      <span className="text-ink-soft line-through opacity-60">
        {formatPrice(product.originalPrice, product.currency)}
      </span>
      <span className="text-electric">
        {formatPrice(product.price, product.currency)}
      </span>
    </span>
  );
}

export function DiscountCountdown({ endIso }) {
  const remaining = useCountdown(endIso);
  if (!endIso || !remaining) return null;

  return (
    <p className="eyebrow mt-2 text-ink-soft">
      Offer ends in {remaining.days > 0 && `${remaining.days}d `}
      {String(remaining.hours).padStart(2, '0')}:
      {String(remaining.minutes).padStart(2, '0')}:
      {String(remaining.seconds).padStart(2, '0')}
    </p>
  );
}
