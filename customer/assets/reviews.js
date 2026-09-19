const CustomerReviews = (() => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderSummary(data, summaryId, emptyMessage) {
    const summaryEl = document.getElementById(summaryId);
    if (!summaryEl) return;
    if (!data.reviews.length) {
      summaryEl.innerHTML = `<p style="margin:0; font-size:13px; color:var(--muted);">${escapeHtml(emptyMessage)}</p>`;
      return;
    }
    const average = data.average || 0;
    const fullStars = Math.round(average);
    summaryEl.innerHTML = `
      <span class="review-summary-score">${average.toFixed(1)}</span>
      <div>
        <div class="review-summary-stars">${"★".repeat(fullStars)}${"☆".repeat(5 - fullStars)}</div>
        <p class="review-summary-meta">${data.count} review${data.count === 1 ? "" : "s"} &middot; verified orders only</p>
      </div>
    `;
  }

  function renderList(data, listId) {
    const listEl = document.getElementById(listId);
    if (!listEl) return;
    listEl.innerHTML = data.reviews.map((review) => `
      <div class="review-card">
        <div class="review-card-head">
          <span class="review-card-name">${escapeHtml(review.buyer_name)}</span>
          <span class="review-card-date">${escapeHtml(new Date(review.created_at).toISOString().slice(0, 10))}</span>
        </div>
        <div class="review-card-stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</div>
        <p class="review-card-text">${escapeHtml(review.review_text)}</p>
        <span class="verified-tag" style="margin-top:8px; display:inline-block;">Verified purchase</span>
      </div>
    `).join("");
  }

  return { renderSummary, renderList };
})();
