/* =========================================================
   VETRA — ADD PRODUCT MODAL
   Shared by vendor/dashboard.html and vendor/products.html.
   Both pages ship an identical #add-product-modal in their markup;
   this file wires it up and, on submit, prepends a real product
   card to whichever .vendor-products-grid exists on the page —
   no backend, so this is in-memory / page-local only, the same
   way the rest of this demo site behaves (nothing persists across
   a reload — see the Edit/Remove handlers already on the grid).

   dashboard.js / products.js call VetraAddProduct.open() from
   their own "Add Product" button handler.
   ========================================================= */

const VetraAddProduct = (() => {
  const MAX_IMAGES = 4;

  let modal, form, nameInput, priceInput, stockInput;
  let imageSlots = [];
  let imageFiles = new Array(MAX_IMAGES).fill(null);
  let imageObjectUrls = new Array(MAX_IMAGES).fill(null);
  let videoSlot, videoInput, videoRemoveBtn, videoFileNameEl;
  let videoFile = null;
  let videoObjectUrl = null;
  let lastFocusedEl = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setImagePreview(index, file) {
    const slot = imageSlots[index];
    if (!slot) return;

    if (imageObjectUrls[index]) {
      URL.revokeObjectURL(imageObjectUrls[index]);
      imageObjectUrls[index] = null;
    }

    const existingPreview = slot.querySelector(".media-preview-img");
    if (existingPreview) existingPreview.remove();
    const existingRemove = slot.querySelector(".media-remove-btn");
    if (existingRemove) existingRemove.remove();

    imageFiles[index] = file;

    if (!file) {
      slot.classList.remove("has-media");
      return;
    }

    const url = URL.createObjectURL(file);
    imageObjectUrls[index] = url;

    const img = document.createElement("img");
    img.className = "media-preview-img";
    img.src = url;
    img.alt = "";
    slot.appendChild(img);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "media-remove-btn";
    removeBtn.setAttribute("aria-label", "Remove image");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = slot.querySelector(".media-upload-input");
      if (input) input.value = "";
      setImagePreview(index, null);
    });
    slot.appendChild(removeBtn);

    slot.classList.add("has-media");
  }

  function setVideoPreview(file) {
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
      videoObjectUrl = null;
    }

    videoFile = file;

    if (!file) {
      videoSlot.classList.remove("has-media");
      videoFileNameEl.textContent = "";
      return;
    }

    videoObjectUrl = URL.createObjectURL(file);
    videoFileNameEl.textContent = file.name;
    videoSlot.classList.add("has-media");
  }

  function wireImageSlots() {
    imageSlots = Array.from(document.querySelectorAll("#ap-image-grid .media-upload-slot"));
    imageSlots.forEach((slot, index) => {
      const input = slot.querySelector(".media-upload-input");
      if (!input) return;
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (file) setImagePreview(index, file);
      });
    });
  }

  function wireStockStepper() {
    const decBtn = document.getElementById("ap-stock-decrement");
    const incBtn = document.getElementById("ap-stock-increment");
    if (!decBtn || !incBtn || !stockInput) return;

    function step(delta) {
      const min = Number(stockInput.min) || 0;
      const current = Number(stockInput.value) || 0;
      stockInput.value = Math.max(min, current + delta);
    }

    decBtn.addEventListener("click", () => step(-1));
    incBtn.addEventListener("click", () => step(1));
  }

  function wireVideoSlot() {
    videoSlot = document.getElementById("ap-video-slot");
    videoInput = document.getElementById("ap-video-input");
    videoRemoveBtn = document.getElementById("ap-video-remove");
    videoFileNameEl = videoSlot ? videoSlot.querySelector(".video-file-name") : null;
    if (!videoSlot || !videoInput) return;

    videoInput.addEventListener("change", () => {
      const file = videoInput.files && videoInput.files[0];
      if (file) setVideoPreview(file);
    });

    if (videoRemoveBtn) {
      videoRemoveBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        videoInput.value = "";
        setVideoPreview(null);
      });
    }
  }

  function resetForm() {
    form.reset();
    for (let i = 0; i < MAX_IMAGES; i++) {
      const input = imageSlots[i] && imageSlots[i].querySelector(".media-upload-input");
      if (input) input.value = "";
      setImagePreview(i, null);
    }
    if (videoInput) videoInput.value = "";
    setVideoPreview(null);
  }

  function stockPillMarkup(stock) {
    const isLow = stock === 0 || stock <= 5;
    const text = stock === 0 ? "Out of stock" : `${stock} in stock`;
    return `<span class="stock-pill${isLow ? " low" : ""}">${text}</span>`;
  }

  function buildProductCard({ name, price, stock, imageUrl }) {
    const card = document.createElement("div");
    card.className = "vendor-product-card";
    card.innerHTML = `
      <div class="img-placeholder product-img">
        <img src="${imageUrl}" alt="${escapeHtml(name)}">
      </div>
      ${stockPillMarkup(stock)}
      <div class="product-body">
        <p class="product-name">${escapeHtml(name)}</p>
        <p class="product-price">₦${Number(price).toLocaleString()}</p>
      </div>
      <div class="vendor-actions">
        <button class="edit-btn" data-action="edit" type="button">Edit</button>
        <button class="remove-btn" data-action="remove" type="button">Remove</button>
      </div>
    `;
    return card;
  }

  function handleSubmit(e) {
    e.preventDefault();

    if (!form.reportValidity()) return;

    const hasImage = imageFiles.some(Boolean);
    if (!hasImage) {
      const firstSlot = imageSlots[0];
      if (firstSlot) firstSlot.scrollIntoView({ behavior: "smooth", block: "center" });
      alert("Add at least one product photo before saving.");
      return;
    }

    const grid = document.querySelector(".vendor-products-grid");
    if (grid) {
      // A fresh object URL, independent of the form's own preview URLs —
      // those get revoked by resetForm() inside close() right below, and
      // reusing one would leave the newly-added card's photo blank.
      const firstImageFile = imageFiles.find(Boolean);
      const card = buildProductCard({
        name: nameInput.value.trim(),
        price: Number(priceInput.value),
        stock: Number(stockInput.value),
        imageUrl: URL.createObjectURL(firstImageFile),
      });
      grid.prepend(card);
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    close();
  }

  function open() {
    if (!modal) return;
    lastFocusedEl = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (nameInput) nameInput.focus();
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
    resetForm();
    if (lastFocusedEl && typeof lastFocusedEl.focus === "function") lastFocusedEl.focus();
  }

  function init() {
    modal = document.getElementById("add-product-modal");
    if (!modal) return;

    form = document.getElementById("add-product-form");
    nameInput = document.getElementById("ap-name");
    priceInput = document.getElementById("ap-price");
    stockInput = document.getElementById("ap-stock");

    wireImageSlots();
    wireVideoSlot();
    wireStockStepper();

    const closeBtn = document.getElementById("add-product-close");
    const cancelBtn = document.getElementById("add-product-cancel");
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (cancelBtn) cancelBtn.addEventListener("click", close);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) close();
    });

    if (form) form.addEventListener("submit", handleSubmit);
  }

  document.addEventListener("DOMContentLoaded", init);

  return { open, close };
})();

// `const` at top level doesn't attach to `window` the way `var` does —
// dashboard.js / products.js check `window.VetraAddProduct`, so expose
// it explicitly.
window.VetraAddProduct = VetraAddProduct;
