/* =========================================================
   VETRA: Customer cart and saved-for-later stores.

   Two localStorage-backed item lists (vetra_customer_cart and
   vetra_customer_saved_for_later) that survive page navigation and
   reloads, unlike the rest of this app's mock data. Each entry is
   just {id, qty}; name, price, and image are always looked up live
   from products.js's catalog, so a line never goes stale.

   Cart and Saved for later share the same shape, so one factory
   builds both instead of duplicating the module. "Save for later"
   (cart.js's wireSaveForLaterButton) just moves entries between the
   two stores.

   Loaded on every page that can add to or read the cart: dashboard.html,
   explore.html, store.html, cart.html. Always loads after products.js,
   since getItems() needs getProduct() to resolve each line.
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
      /* localStorage unavailable (private mode, etc.), so the list just won't persist. */
    }
  }

  // Resolves each stored {id, qty} against the live product catalog and
  // drops any line whose product no longer exists, so nothing renders a
  // broken row. Only resolves what's already cached (see
  // assets/products.js), so a page must await VetraCatalog.load()/.loadOne()
  // for every id in getIds() before calling this.
  function getItems() {
    return load()
      .map((entry) => {
        const product = typeof getProduct === "function" ? getProduct(entry.id) : null;
        return product ? { id: entry.id, qty: entry.qty, product } : null;
      })
      .filter(Boolean);
  }

  // The raw product ids currently in the list, with no catalog lookup.
  // Lets a page preload exactly these before calling getItems().
  function getIds() {
    return load().map((entry) => entry.id);
  }

  // How much of one product is already in this list, no catalog lookup
  // needed, same reasoning as getIds(). Lets a browse-page card
  // (product-grid.js) cap its "add more" stepper at stock minus what
  // the shopper already has in their cart. Without this, repeated adds
  // across visits or cards could silently exceed what's actually
  // available.
  function getQty(id) {
    const entry = load().find((e) => e.id === id);
    return entry ? entry.qty : 0;
  }

  // Stock minus whatever's already in this list, the actual number a
  // shopper can still add. `rawStock` of null, undefined, or Infinity
  // means no cap, same fallback every stock-aware stepper in this app
  // uses. One shared place for this, instead of product-grid.js and
  // product.html each doing the same subtraction independently.
  function getRemainingStock(id, rawStock) {
    if (rawStock == null || rawStock === Infinity) return Infinity;
    return Math.max(0, Number(rawStock) - getQty(id));
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

  // Every entry, wholesale. Used to move a whole list into another
  // store, e.g. "Save for later" moving every cart line at once.
  function replaceAll(entries) {
    save(entries);
  }

  return {
    getItems, getIds, getQty, getRemainingStock, addItem, setQty, removeItem, clear, getCount, getSubtotal,
    getRawEntries: load, replaceAll,
  };
}

const CartStore = createItemStore("vetra_customer_cart");
const SavedForLaterStore = createItemStore("vetra_customer_saved_for_later");
