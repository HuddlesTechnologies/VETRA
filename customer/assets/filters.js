/* =========================================================
   VETRA — PRODUCT FILTER PANEL
   Shared behavior for the "filter" button next to a search bar.
   Each page that uses it calls initProductFilters() with a small
   config describing which grid to filter and what its cards look
   like — the cards themselves carry data-category/data-price/
   data-name attributes for this to read.
   ========================================================= */

function initProductFilters(config) {
  const filterBtn = document.querySelector(config.triggerSelector);
  const panel = document.getElementById(config.panelId);
  const grid = document.querySelector(config.gridSelector);
  if (!filterBtn || !panel || !grid) return;

  const cards = Array.from(grid.children);
  let emptyState = null;

  function ensureEmptyState() {
    if (emptyState) return emptyState;
    emptyState = document.createElement("div");
    emptyState.className = "filter-empty-state";
    emptyState.textContent = "No products match your filters.";
    grid.insertAdjacentElement("afterend", emptyState);
    return emptyState;
  }

  function applyFilters() {
    const selectedCats = Array.from(
      panel.querySelectorAll("[data-filter-category]:checked")
    ).map((el) => el.value);
    const selectedPrices = Array.from(
      panel.querySelectorAll("[data-filter-price]:checked")
    ).map((el) => el.value);
    const sortSelect = panel.querySelector("[data-filter-sort]");
    const sortValue = sortSelect ? sortSelect.value : "featured";

    let visibleCount = 0;
    cards.forEach((card) => {
      const cat = card.dataset.category;
      const price = Number(card.dataset.price);
      const catMatch = !selectedCats.length || selectedCats.includes(cat);
      const priceMatch =
        !selectedPrices.length ||
        selectedPrices.some((bucket) => {
          const [min, max] = bucket.split("-").map(Number);
          return price >= min && (max === 0 || price <= max);
        });
      const show = catMatch && priceMatch;
      card.style.display = show ? "" : "none";
      if (show) visibleCount += 1;
    });

    const sorted = [...cards].sort((a, b) => {
      if (sortValue === "price-asc") return Number(a.dataset.price) - Number(b.dataset.price);
      if (sortValue === "price-desc") return Number(b.dataset.price) - Number(a.dataset.price);
      if (sortValue === "name-asc") return a.dataset.name.localeCompare(b.dataset.name);
      return cards.indexOf(a) - cards.indexOf(b); // "featured" = original order
    });
    sorted.forEach((card) => grid.appendChild(card));

    const empty = ensureEmptyState();
    empty.style.display = visibleCount ? "none" : "";

    const activeCount = selectedCats.length + selectedPrices.length;
    filterBtn.classList.toggle("active", activeCount > 0);

    const countEl = panel.querySelector("[data-filter-count]");
    if (countEl) {
      countEl.textContent = visibleCount === cards.length
        ? `Showing all ${cards.length}`
        : `Showing ${visibleCount} of ${cards.length}`;
    }
  }

  filterBtn.addEventListener("click", () => {
    panel.classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("open")) return;
    if (panel.contains(e.target) || filterBtn.contains(e.target)) return;
    panel.classList.remove("open");
  });

  panel.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("change", applyFilters);
  });

  const clearBtn = panel.querySelector("[data-filter-clear]");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      panel.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.checked = false;
      });
      const sortSelect = panel.querySelector("[data-filter-sort]");
      if (sortSelect) sortSelect.value = "featured";
      applyFilters();
    });
  }

  applyFilters();
}
