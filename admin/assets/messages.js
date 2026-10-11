/* =========================================================
   VETRA: Admin messages (admin/messages.html).
   Messages visitors send from contact.html, from GET /api/admin/messages
   (backend/src/routes/admin.routes.js). Any admin can read them, reply
   (POST /messages/:id/reply emails the sender and marks it replied), or
   close / reopen one (PATCH /messages/:id).
   ========================================================= */

const esc = (value) => VetraAPI.escapeHtml(value == null ? "" : String(value));
const api = (path, opts = {}) => VetraAPI.request(path, { role: "admin", ...opts });

const STATUS_PILL = {
  new: ["New", "processing"],
  replied: ["Replied", "completed"],
  closed: ["Closed", "cancelled"],
};

let currentStatus = "new";
let messages = [];

document.addEventListener("DOMContentLoaded", async () => {
  const me = requireAdminSession();
  if (!me) return;
  wireTabs();
  wireActions();
  await load();
});

function wireTabs() {
  document.getElementById("message-filter-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;
    document.querySelectorAll("#message-filter-tabs .filter-tab").forEach((t) => t.classList.toggle("active", t === btn));
    currentStatus = btn.dataset.status;
    load();
  });
}

async function load() {
  const list = document.getElementById("message-list");
  list.innerHTML = `<p class="table-empty">Loading…</p>`;
  try {
    messages = await api(`/admin/messages${currentStatus ? `?status=${currentStatus}` : ""}`);
  } catch (err) {
    list.innerHTML = `<p class="table-empty">Couldn't load messages: ${esc(err.message)}</p>`;
    return;
  }
  if (!messages.length) {
    list.innerHTML = `<p class="table-empty">${currentStatus === "new" ? "No new messages. You're all caught up." : "Nothing here."}</p>`;
    return;
  }
  list.innerHTML = messages.map(card).join("");
}

function card(m) {
  const [label, cls] = STATUS_PILL[m.status] || [m.status, "pending"];
  const meta = [
    m.sender_type === "vendor" ? "Vendor" : "Buyer",
    m.business_name,
    m.order_ref ? `Order ${m.order_ref}` : null,
    VetraAdmin.formatDateWithRelative(m.created_at),
  ].filter(Boolean).map(esc).join(" · ");
  return `
    <article class="message-card" data-id="${esc(m.id)}">
      <header class="message-card-head">
        <div>
          <p class="cell-title">${esc(m.name)} <span class="cell-sub">&lt;${esc(m.email)}&gt;</span></p>
          <p class="cell-sub">${meta}</p>
        </div>
        <span class="status-pill ${cls}">${label}</span>
      </header>
      ${m.topic ? `<p class="message-topic">${esc(m.topic)}</p>` : ""}
      <p class="message-body">${esc(m.message)}</p>
      ${m.reply ? `
        <div class="message-reply">
          <p class="cell-sub">Replied by ${esc(m.replied_by_name || "an admin")} · ${esc(VetraAdmin.formatDateWithRelative(m.replied_at))}</p>
          <p class="message-body">${esc(m.reply)}</p>
        </div>` : ""}
      <form class="message-reply-form" hidden>
        <textarea class="form-textarea" rows="4" placeholder="Write your reply. It's emailed to ${esc(m.email)}." required></textarea>
        <div class="form-actions">
          <button type="button" class="btn btn-cancel" data-action="cancel-reply">Cancel</button>
          <button type="submit" class="btn btn-save">Send reply</button>
        </div>
      </form>
      <div class="message-actions">
        <button type="button" class="btn-view" data-action="reply">${m.reply ? "Reply again" : "Reply"}</button>
        ${m.status === "closed"
          ? `<button type="button" class="btn-view" data-action="reopen">Reopen</button>`
          : `<button type="button" class="btn-view" data-action="close">Close</button>`}
      </div>
    </article>`;
}

function wireActions() {
  const list = document.getElementById("message-list");
  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const article = btn.closest(".message-card");
    const id = article.dataset.id;
    const form = article.querySelector(".message-reply-form");
    if (btn.dataset.action === "reply") {
      form.hidden = false;
      form.querySelector("textarea").focus();
      return;
    }
    if (btn.dataset.action === "cancel-reply") {
      form.hidden = true;
      return;
    }
    const status = btn.dataset.action === "close" ? "closed" : "new";
    try {
      await api(`/admin/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
      await load();
    } catch (err) {
      AdminUI.info({ title: "Couldn't update the message", bodyHtml: esc(err.message) });
    }
  });
  list.addEventListener("submit", async (e) => {
    const form = e.target.closest(".message-reply-form");
    if (!form) return;
    e.preventDefault();
    const id = form.closest(".message-card").dataset.id;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api(`/admin/messages/${encodeURIComponent(id)}/reply`, { method: "POST", body: { reply: form.querySelector("textarea").value } });
      AdminUI.info({ title: "Reply sent", bodyHtml: "Your reply was emailed and the message is marked replied." });
      await load();
    } catch (err) {
      AdminUI.info({ title: "Couldn't send the reply", bodyHtml: esc(err.message) });
      button.disabled = false;
    }
  });
}
