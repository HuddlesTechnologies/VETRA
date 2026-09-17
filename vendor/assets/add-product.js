/* =========================================================
   VETRA — ADD/EDIT PRODUCT MODAL
   Shared by vendor/dashboard.html and vendor/products.html. Real
   backend wiring: on submit, any newly-picked image/video files are
   uploaded to POST /api/uploads first (Cloudinary URLs come back),
   then the product itself is created (POST /api/products) or
   updated (PATCH /api/products/:id) with those URLs. Grid refresh
   after either is delegated to VetraVendorProducts.reload() —
   assets/products-data.js — instead of hand-building a card here,
   so the grid always reflects exactly what the server has.

   Edit mode: product-actions.js calls VetraAddProduct.open(product)
   with a real product row (from VetraVendorProducts.getProduct(id))
   to prefill every field, including up to 4 existing image URLs and
   an existing video URL — each slot only re-uploads if the vendor
   actually replaces it; otherwise the existing URL is kept as-is.
   ========================================================= */

const VetraAddProduct = (() => {
  const MAX_IMAGES = 4;

  const MAX_KEYWORDS = 5;

  let modal, form, nameInput, priceInput, stockInput, categoryInput, colorInput, storageInput, descriptionInput, keywordsInput, submitBtn, modalTitle;
  let imageSlots = [];
  let imageFiles = new Array(MAX_IMAGES).fill(null);
  let imageObjectUrls = new Array(MAX_IMAGES).fill(null);
  let existingImageUrls = new Array(MAX_IMAGES).fill(null);
  let videoSlot, videoInput, videoRemoveBtn, videoFileNameEl;
  let videoFile = null;
  let videoObjectUrl = null;
  let existingVideoUrl = null;
  let lastFocusedEl = null;
  let editingProductId = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Renders (or clears, if src is null) the live thumbnail for one of the
  // up-to-4 image upload slots. `src` is either an object URL (a freshly
  // picked local file) or a real Cloudinary URL (an existing image being
  // prefilled in edit mode) — visually identical either way.
  function showImagePreview(index, src) {
    const slot = imageSlots[index];
    if (!slot) return;

    const existingPreview = slot.querySelector(".media-preview-img");
    if (existingPreview) existingPreview.remove();
    const existingRemove = slot.querySelector(".media-remove-btn");
    if (existingRemove) existingRemove.remove();

    if (!src) {
      slot.classList.remove("has-media");
      return;
    }

    const img = document.createElement("img");
    img.className = "media-preview-img";
    img.src = src;
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
      clearImageSlot(index);
    });
    slot.appendChild(removeBtn);

    slot.classList.add("has-media");
  }

  function clearImageSlot(index) {
    if (imageObjectUrls[index]) {
      URL.revokeObjectURL(imageObjectUrls[index]);
      imageObjectUrls[index] = null;
    }
    imageFiles[index] = null;
    existingImageUrls[index] = null;
    showImagePreview(index, null);
  }

  // A newly picked file always replaces whatever was in that slot
  // (a fresh upload or an existing URL from edit mode).
  function pickImageFile(index, file) {
    if (imageObjectUrls[index]) URL.revokeObjectURL(imageObjectUrls[index]);
    imageFiles[index] = file;
    existingImageUrls[index] = null;
    const url = URL.createObjectURL(file);
    imageObjectUrls[index] = url;
    showImagePreview(index, url);
  }

  function showVideoPreview(name) {
    videoFileNameEl.textContent = name || "";
    videoSlot.classList.toggle("has-media", Boolean(name));
  }

  function clearVideo() {
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
      videoObjectUrl = null;
    }
    videoFile = null;
    existingVideoUrl = null;
    showVideoPreview(null);
  }

  function pickVideoFile(file) {
    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    videoFile = file;
    existingVideoUrl = null;
    videoObjectUrl = URL.createObjectURL(file);
    showVideoPreview(file.name);
  }

  function wireImageSlots() {
    imageSlots = Array.from(document.querySelectorAll("#ap-image-grid .media-upload-slot"));
    imageSlots.forEach((slot, index) => {
      const input = slot.querySelector(".media-upload-input");
      if (!input) return;
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (file) pickImageFile(index, file);
      });
    });
  }

  // Live comma-grouping as the vendor types a price (₦1,250,000 instead
  // of an undifferentiated 1250000) — priceInput is a plain text field,
  // not type="number" (which refuses commas outright), so this is the
  // only place digit-grouping can happen. Keeps digits only; nairaToKobo()
  // (api-client.js) strips the commas back out again on submit.
  function formatPriceDigits(digits) {
    return digits ? Number(digits).toLocaleString("en-NG") : "";
  }

  function wirePriceFormatting() {
    if (!priceInput) return;
    priceInput.addEventListener("input", () => {
      const digits = priceInput.value.replace(/[^\d]/g, "");
      priceInput.value = formatPriceDigits(digits);
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
      if (file) pickVideoFile(file);
    });

    if (videoRemoveBtn) {
      videoRemoveBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        videoInput.value = "";
        clearVideo();
      });
    }
  }

  function resetForm() {
    form.reset();
    for (let i = 0; i < MAX_IMAGES; i++) {
      const input = imageSlots[i] && imageSlots[i].querySelector(".media-upload-input");
      if (input) input.value = "";
      clearImageSlot(i);
    }
    if (videoInput) videoInput.value = "";
    clearVideo();
    editingProductId = null;
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.textContent = busy
      ? "Saving…"
      : editingProductId
        ? "Save Changes"
        : "Add Product";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const hasImage = imageFiles.some(Boolean) || existingImageUrls.some(Boolean);
    if (!hasImage) {
      const firstSlot = imageSlots[0];
      if (firstSlot) firstSlot.scrollIntoView({ behavior: "smooth", block: "center" });
      VendorUI.info({ title: "Photo required", bodyHtml: "Add at least one product photo before saving." });
      return;
    }

    setBusy(true);
    try {
      const images = [];
      for (let i = 0; i < MAX_IMAGES; i++) {
        if (imageFiles[i]) {
          images.push(await VetraAPI.uploadFile(imageFiles[i], { role: "vendor", folder: "products" }));
        } else if (existingImageUrls[i]) {
          images.push(existingImageUrls[i]);
        }
      }

      let videoUrl = existingVideoUrl || null;
      if (videoFile) {
        videoUrl = await VetraAPI.uploadFile(videoFile, { role: "vendor", folder: "products" });
      }

      // Vendor types keywords as one comma-separated field — split, trim,
      // drop empties, and cap at MAX_KEYWORDS client-side too (the
      // backend enforces the same cap independently — see
      // products.routes.js's normalizeKeywords()).
      const keywords = (keywordsInput?.value || "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, MAX_KEYWORDS);

      const payload = {
        name: nameInput.value.trim(),
        category: categoryInput.value,
        color: colorInput?.value.trim() || null,
        storage: storageInput?.value.trim() || null,
        price: nairaToKobo(priceInput.value),
        stockQuantity: Number(stockInput.value),
        description: descriptionInput.value.trim(),
        keywords,
        images,
        videoUrl,
      };

      if (editingProductId) {
        await VetraAPI.request(`/products/${editingProductId}`, { method: "PATCH", role: "vendor", body: payload });
      } else {
        await VetraAPI.request("/products", { method: "POST", role: "vendor", body: payload });
      }

      if (window.VetraVendorProducts) await window.VetraVendorProducts.reload();
      close();
    } catch (err) {
      VendorUI.info({ title: "Couldn't save product", bodyHtml: escapeHtml(err.message) });
    } finally {
      setBusy(false);
    }
  }

  // No product = Add mode (blank form). A real product row from
  // VetraVendorProducts.getProduct(id) = Edit mode (prefilled, PATCHes
  // on submit instead of POSTing).
  function open(product) {
    if (!modal) return;
    lastFocusedEl = document.activeElement;
    resetForm();

    if (product) {
      editingProductId = product.id;
      if (modalTitle) modalTitle.textContent = "Edit Product";
      nameInput.value = product.name || "";
      priceInput.value = product.price ? formatPriceDigits(String(Math.round(product.price / 100))) : "";
      stockInput.value = product.stock_quantity || 0;
      if (categoryInput) categoryInput.value = product.category || "";
      if (colorInput) colorInput.value = product.color || "";
      if (storageInput) storageInput.value = product.storage || "";
      if (descriptionInput) descriptionInput.value = product.description || "";
      if (keywordsInput) {
        keywordsInput.value = Array.isArray(product.keywords) ? product.keywords.join(", ") : "";
      }

      const images = Array.isArray(product.images) ? product.images : [];
      images.slice(0, MAX_IMAGES).forEach((url, i) => {
        existingImageUrls[i] = url;
        showImagePreview(i, url);
      });
      if (product.video_url) {
        existingVideoUrl = product.video_url;
        showVideoPreview("Current video");
      }
    } else if (modalTitle) {
      modalTitle.textContent = "Add Product";
    }
    setBusy(false);

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
    categoryInput = document.getElementById("ap-category");
    colorInput = document.getElementById("ap-color");
    storageInput = document.getElementById("ap-storage");
    descriptionInput = document.getElementById("ap-description");
    keywordsInput = document.getElementById("ap-keywords");
    submitBtn = form ? form.querySelector(".btn-save") : null;
    modalTitle = document.getElementById("add-product-title");

    wireImageSlots();
    wireVideoSlot();
    wireStockStepper();
    wirePriceFormatting();

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
