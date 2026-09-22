/* =========================================================
   VETRA: Product filter panel.
   Shared behavior for the "filter" button next to a search bar.
   Each page that uses it calls initProductFilters() with a small
   config describing which grid to filter and what its cards look
   like. The cards themselves carry data-category/data-price/
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
    grid.insertAdjacentElement("afterend", emptyState);
    return emptyState;
  }

  function applyFilters() {
    const selectedCats = Array.from(
      panel.querySelectorAll("[data-filter-category]:checked")
    ).map((el) => el.value);
    // Typed min/max instead of fixed preset buckets, either side can be
    // left blank (an open-ended range), and an invalid/empty value just
    // doesn't constrain that side rather than erroring.
    const minInput = panel.querySelector("[data-filter-price-min]");
    const maxInput = panel.querySelector("[data-filter-price-max]");
    const minPrice = minInput && minInput.value !== "" ? Number(minInput.value) : null;
    const maxPrice = maxInput && maxInput.value !== "" ? Number(maxInput.value) : null;
    const sortSelect = panel.querySelector("[data-filter-sort]");
    const sortValue = sortSelect ? sortSelect.value : "featured";

    let visibleCount = 0;
    cards.forEach((card) => {
      const cat = card.dataset.category;
      const price = Number(card.dataset.price);
      const catMatch = !selectedCats.length || selectedCats.includes(cat);
      const priceMatch =
        (minPrice === null || price >= minPrice) &&
        (maxPrice === null || price <= maxPrice);
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
    empty.textContent = "No products match your filters.";
    empty.style.display = visibleCount ? "none" : "";

    const activeCount = selectedCats.length + (minPrice !== null ? 1 : 0) + (maxPrice !== null ? 1 : 0);
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
  // Min/max price fields filter live as you type rather than waiting for
  // blur/enter ("change"), there's nothing to wait on, it's just
  // re-showing/hiding already-rendered cards.
  panel.querySelectorAll("[data-filter-price-min], [data-filter-price-max]").forEach((el) => {
    el.addEventListener("input", applyFilters);
  });

  const clearBtn = panel.querySelector("[data-filter-clear]");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      panel.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.checked = false;
      });
      panel.querySelectorAll("[data-filter-price-min], [data-filter-price-max]").forEach((el) => {
        el.value = "";
      });
      const sortSelect = panel.querySelector("[data-filter-sort]");
      if (sortSelect) sortSelect.value = "featured";
      applyFilters();
    });
  }

  // Lets something outside the filter panel, a category card, or a
  // `?cat=` query param on page load, filter the grid to one category,
  // the same way checking that category's checkbox would. If this page's
  // grid has no products (and so no checkbox) for the given category, it
  // still filters to zero results rather than silently doing nothing,
  // an honest "no products in this category yet" beats a dead click.
  function filterByCategory(categoryName) {
    panel.querySelectorAll("[data-filter-category]").forEach((cb) => {
      cb.checked = cb.value === categoryName;
    });
    if (!panel.querySelector(`[data-filter-category][value="${CSS.escape(categoryName)}"]`)) {
      // No matching checkbox exists on this page at all, this page's
      // grid genuinely has zero products in that category, so hide
      // every card rather than (incorrectly) falling back to "show all".
      cards.forEach((card) => {
        card.style.display = "none";
      });
      const empty = ensureEmptyState();
      empty.textContent = `No products in "${categoryName}" yet.`;
      empty.style.display = "";
      const countEl = panel.querySelector("[data-filter-count]");
      if (countEl) countEl.textContent = `Showing 0 of ${cards.length}`;
      filterBtn.classList.add("active");
      return;
    }
    applyFilters();
  }

  applyFilters();

  return { applyFilters, filterByCategory };
}
