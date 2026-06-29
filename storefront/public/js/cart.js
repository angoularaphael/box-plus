/**
 * Panier matériel — localStorage
 */
(function () {
  const STORAGE_KEY = 'bc-cart';

  function read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function write(lines) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    window.dispatchEvent(new CustomEvent('bccart:change', { detail: lines }));
    return lines;
  }

  function lineKey(line) {
    return `${line.product_id}|${line.variant_id || ''}`;
  }

  function count() {
    return read().reduce((s, l) => s + (l.qty || 1), 0);
  }

  function add(item) {
    const lines = read();
    const key = lineKey(item);
    const idx = lines.findIndex((l) => lineKey(l) === key);
    if (idx >= 0) {
      lines[idx].qty = (lines[idx].qty || 1) + (item.qty || 1);
    } else {
      lines.push({
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        name: item.name,
        variant_label: item.variant_label || '',
        price_cents: item.price_cents,
        price_label: item.price_label,
        image: item.image || null,
        qty: item.qty || 1,
      });
    }
    return write(lines);
  }

  function setQty(productId, variantId, qty) {
    const lines = read();
    const next = lines
      .map((l) => {
        if (l.product_id !== productId) return l;
        if (String(l.variant_id || '') !== String(variantId || '')) return l;
        return qty > 0 ? { ...l, qty } : null;
      })
      .filter(Boolean);
    return write(next);
  }

  function remove(productId, variantId) {
    return write(
      read().filter(
        (l) =>
          !(l.product_id === productId && String(l.variant_id || '') === String(variantId || ''))
      )
    );
  }

  function clear() {
    return write([]);
  }

  function totalCents() {
    return read().reduce((s, l) => s + (l.price_cents || 0) * (l.qty || 1), 0);
  }

  function formatCents(cents) {
    return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
  }

  window.BCCart = {
    read,
    add,
    setQty,
    remove,
    clear,
    count,
    totalCents,
    formatCents,
  };
})();
