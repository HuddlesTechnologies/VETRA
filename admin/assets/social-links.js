/* =========================================================
   VETRA: Admin > Settings > Social Media card.
   GET/PUT /api/social-links (backend/src/routes/social-links.routes.js).
   Super Admins edit the rows in place (name + profile link), add,
   remove and reorder them, then save the whole list at once. Other
   admins see the current links read-only. The public footer
   (script.js) renders whatever is saved here.
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
  const list = document.getElementById("social-link-list");
  const actions = document.getElementById("social-link-actions");
  const addBtn = document.getElementById("add-social-link-btn");
  const saveBtn = document.getElementById("save-social-links-btn");
  const errorEl = document.getElementById("social-link-error");
  if (!list) return;

  const esc = VetraAPI.escapeHtml;
  const canEdit = typeof can === "function" && can("site.social_links");
  const MAX = 12;
  let links = [];
  let dirty = false;

  function showError(msg) {
    errorEl.textContent = msg || "";
    errorEl.hidden = !msg;
  }

  function setDirty(value) {
    dirty = value;
    saveBtn.disabled = !dirty;
    saveBtn.textContent = dirty ? "Save changes" : "Saved";
  }

  // Reads the current inputs back into `links` so re-rendering (after a
  // move or remove) never throws away something typed but not saved.
  function syncFromInputs() {
    list.querySelectorAll(".social-link-row").forEach((row, i) => {
      if (!links[i]) return;
      links[i].label = row.querySelector("[data-field=label]").value;
      links[i].url = row.querySelector("[data-field=url]").value;
    });
  }

  function render() {
    if (!links.length) {
      list.innerHTML = `<p class="table-empty">${
        canEdit ? "No social media links yet, add one below." : "No social media links set."
      }</p>`;
    } else if (!canEdit) {
      list.innerHTML = links
        .map((l) => `<div class="social-link-readonly"><strong>${esc(l.label)}</strong><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></div>`)
        .join("");
    } else {
      list.innerHTML = links
        .map(
          (l, i) => `
          <div class="social-link-row">
            <input class="form-input" data-field="label" list="social-network-names" maxlength="40"
              placeholder="Network (e.g. Instagram)" aria-label="Network name ${i + 1}" value="${esc(l.label)}" />
            <input class="form-input" data-field="url" type="url" inputmode="url" maxlength="500"
              placeholder="https://instagram.com/vetrahq" aria-label="Profile link ${i + 1}" value="${esc(l.url)}" />
            <div class="social-link-row-actions">
              <button type="button" class="site-banner-move-btn" data-action="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
              <button type="button" class="site-banner-move-btn" data-action="down" ${i === links.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
              <button type="button" class="danger-btn" data-action="remove">Remove</button>
            </div>
          </div>`
        )
        .join("");
    }
    if (addBtn) addBtn.disabled = links.length >= MAX;
  }

  async function load() {
    try {
      links = (await VetraAPI.request("/social-links")).map((l) => ({ label: l.label, url: l.url }));
    } catch (err) {
      list.innerHTML = `<p class="table-empty">Couldn't load social links: ${esc(err.message)}</p>`;
      return;
    }
    render();
    if (canEdit) {
      actions.hidden = false;
      setDirty(false);
    }
  }

  if (canEdit) {
    list.addEventListener("input", () => {
      showError("");
      setDirty(true);
    });

    list.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      syncFromInputs();
      const i = Array.from(list.querySelectorAll(".social-link-row")).indexOf(btn.closest(".social-link-row"));
      if (i < 0) return;
      const action = btn.dataset.action;
      if (action === "remove") links.splice(i, 1);
      if (action === "up" && i > 0) [links[i - 1], links[i]] = [links[i], links[i - 1]];
      if (action === "down" && i < links.length - 1) [links[i + 1], links[i]] = [links[i], links[i + 1]];
      render();
      setDirty(true);
    });

    addBtn.addEventListener("click", () => {
      syncFromInputs();
      if (links.length >= MAX) return;
      links.push({ label: "", url: "" });
      render();
      setDirty(true);
      list.querySelector(".social-link-row:last-child [data-field=label]")?.focus();
    });

    saveBtn.addEventListener("click", async () => {
      syncFromInputs();
      // Fully blank rows are just dropped rather than rejected.
      const payload = links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label || l.url);
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      showError("");
      try {
        const saved = await VetraAPI.request("/social-links", { method: "PUT", role: "admin", body: { links: payload } });
        links = saved.map((l) => ({ label: l.label, url: l.url }));
        render();
        setDirty(false);
      } catch (err) {
        showError(err.message);
        setDirty(true);
      }
    });

    window.addEventListener("beforeunload", (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  await load();
});
