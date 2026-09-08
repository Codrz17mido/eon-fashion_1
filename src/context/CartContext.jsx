import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { getThumbUrl } from '../lib/images';

const CartContext = createContext(null);
const STORAGE_KEY = 'eon_cart_v1';

function loadCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadCart);
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = (product, { size, color, quantity = 1 }) => {
    setItems((prev) => {
      const lineId = `${product.id}-${size}-${color}`;
      const existing = prev.find((i) => i.lineId === lineId);
      if (existing) {
        return prev.map((i) =>
          i.lineId === lineId ? { ...i, quantity: i.quantity + quantity } : i
        );
      }
      return [
        ...prev,
        {
          lineId,
          id: product.id,
          name: product.name,
          price: product.effectivePrice ?? product.price,
          image: getThumbUrl(product.images[0]),
          size,
          color,
          quantity,
        },
      ];
    });
    setIsCartOpen(true);

    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      window.fbq('track', 'AddToCart', {
        content_ids: [product.id],
        content_name: product.name,
        value: (product.effectivePrice ?? product.price) * quantity,
        currency: 'EGP',
      });
    }
  };

  const updateQuantity = (lineId, quantity) => {
    if (quantity <= 0) {
      removeItem(lineId);
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.lineId === lineId ? { ...i, quantity } : i))
    );
  };

  const removeItem = (lineId) => {
    setItems((prev) => prev.filter((i) => i.lineId !== lineId));
  };

  const clearCart = () => setItems([]);

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items]
  );

  const count = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items]
  );

  const value = {
    items,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    subtotal,
    count,
    isCartOpen,
    setIsCartOpen,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
