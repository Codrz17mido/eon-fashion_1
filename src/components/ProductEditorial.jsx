import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { getLargeUrl } from '../lib/images';
import { DiscountPill, PriceWithDiscount, DiscountCountdown } from './DiscountBadge';

// Full-bleed editorial layout: image on one side, copy on the other,
// alternating per index — reads like a fashion magazine spread rather
// than a product grid.
export default function ProductEditorial({ product, index, formatPrice }) {
  const reversed = index % 2 === 1;

  return (
    <div className="grid items-center gap-10 border-t border-line py-16 md:grid-cols-2 md:gap-16 md:py-28">
      <div className={reversed ? 'md:order-2' : ''}>
        <Link
          to={`/product/${product.id}`}
          aria-label={`View ${product.name}`}
          className="relative block overflow-hidden"
        >
          {(() => {
            const src = getLargeUrl(product.images[0]);
            return (
              src && (
                <img
                  src={src}
                  alt={product.name}
                  className="block h-auto w-full"
                  loading="lazy"
                  decoding="async"
                />
              )
            );
          })()}
          <span className="eyebrow absolute left-5 top-5 bg-bg/85 px-3 py-1.5 text-ink backdrop-blur-sm">
            {product.tag}
          </span>
          <span className="absolute right-5 top-5">
            <DiscountPill product={product} />
          </span>
        </Link>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-10%' }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className={`max-w-md ${reversed ? 'md:order-1 md:ml-auto md:text-right' : ''}`}
      >
        <p className="eyebrow text-electric">
          {String(index + 1).padStart(2, '0')} — {product.category || 'EON'}
        </p>
        <h3 className="font-display mt-4 text-4xl font-medium leading-[1.05] text-ink md:text-5xl">
          {product.name}
        </h3>
        <div className="mt-4">
          <PriceWithDiscount product={product} formatPrice={formatPrice} />
          <DiscountCountdown endIso={product.discount_end} />
        </div>
        <p className="mt-6 text-base leading-relaxed text-ink-soft">
          {product.description}
        </p>
        <Link
          to={`/product/${product.id}`}
          className={`eyebrow group mt-8 inline-flex items-center gap-3 border border-ink px-7 py-4 text-ink transition-colors duration-300 hover:bg-ink hover:text-bg ${
            reversed ? 'md:flex-row-reverse' : ''
          }`}
        >
          View Product
          <span className="transition-transform duration-300 group-hover:translate-x-1">
            →
          </span>
        </Link>
      </motion.div>
    </div>
  );
}
