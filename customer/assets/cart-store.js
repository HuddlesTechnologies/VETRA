/* =========================================================
   VETRA — CUSTOMER CART + SAVED-FOR-LATER STORES
   Two real, localStorage-backed item lists (keys: vetra_customer_cart
   and vetra_customer_saved_for_later) so both survive navigating
   between pages and a reload — unlike the rest of this app's mock
   data. Stores only {id, qty} pairs; name/price/image are always
   looked up live from products.js's PRODUCTS catalog, so a line never
   goes stale relative to the catalog (and there's nothing to keep in
   sync by hand).

   Cart and Saved-for-later are the exact same shape, so one factory
   builds both rather than duplicating this module — "Save for later"
   (cart.js's wireSaveForLaterButton) just moves entries from one
   store to the other; nothing else about the API differs.

   Loaded on every page that can add to or read the cart:
   dashboard.html, explore.html, store.html, cart.html — always
   after products.js, since getItems() needs getProduct() to
   resolve each line.
   ========================================================= */

function createItemStore(lsKey) {
  function load() {
    try {
      const raw = localStorage.getItem(lsKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function save(entries) {
    try {
      localStorage.setItem(lsKey, JSON.stringify(entries));
    } catch (e) {
      /* localStorage unavailable (private mode, etc.) — list just won't persist */
    }
  }

  // Resolves each stored {id, qty} against the live product catalog and
  // drops any line whose product no longer exists, rather than rendering
  // a broken row. Only resolves what's already cached (see
  // assets/products.js) — a page must await VetraCatalog.load()/.loadOne()
  // for every id in getIds() before calling this.
  function getItems() {
    return load()
      .map((entry) => {
        const product = typeof getProduct === "function" ? getProduct(entry.id) : null;
        return product ? { id: entry.id, qty: entry.qty, product } : null;
      })
      .filter(Boolean);
  }

  // The raw product ids currently in the list, with no catalog lookup —
  // lets a page preload exactly these before calling getItems().
  function getIds() {
    return load().map((entry) => entry.id);
  }

  function addItem(id, qty = 1) {
    const entries = load();
    const existing = entries.find((e) => e.id === id);
    if (existing) {
      existing.qty += qty;
    } else {
      entries.push({ id, qty });
    }
    save(entries);
    return getItems();
  }

  function setQty(id, qty) {
    let entries = load();
    if (qty <= 0) {
      entries = entries.filter((e) => e.id !== id);
    } else {
      const existing = entries.find((e) => e.id === id);
      if (existing) existing.qty = qty;
    }
    save(entries);
    return getItems();
  }

  function removeItem(id) {
    return setQty(id, 0);
  }

  function clear() {
    save([]);
  }

  function getCount() {
    return load().reduce((sum, e) => sum + e.qty, 0);
  }

  function getSubtotal() {
    return getItems().reduce((sum, i) => sum + i.product.price * i.qty, 0);
  }

  // Every entry, wholesale — used to move a whole list into another
  // store (e.g. "Save for later" moving every cart line at once).
  function replaceAll(entries) {
    save(entries);
  }

  return {
    getItems, getIds, addItem, setQty, removeItem, clear, getCount, getSubtotal,
    getRawEntries: load, replaceAll,
  };
}

const CartStore = createItemStore("vetra_customer_cart");
const SavedForLaterStore = createItemStore("vetra_customer_saved_for_later");
