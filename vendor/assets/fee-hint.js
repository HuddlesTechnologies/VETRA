/* =========================================================
   VETRA: commission estimate under the Add/Edit Product price field
   (vendor/products.html and vendor/dashboard.html). Reads the live
   rate from GET /api/payments/commission and shows what the vendor
   receives per unit sold, linking to ../commission-and-fees.html for
   the full policy. If the rate can't be loaded, the generic hint and
   the link stay as they are.
   ========================================================= */

(function () {
  document.addEventListener("DOMContentLoaded", async () => {
    const priceInput = document.getElementById("ap-price");
    const estimate = document.querySelector("#ap-price-fee [data-fee-estimate]");
    if (!priceInput || !estimate) return;

    let pct = null;
    try {
      const data = await VetraAPI.request("/payments/commission");
      const n = Number(data && data.commissionPercent);
      if (Number.isFinite(n) && n >= 0) pct = n;
    } catch (e) {
      return;
    }
    const pctLabel = `${pct % 1 ? pct.toFixed(2).replace(/0$/, "") : pct}%`;
    const naira = (n) => `₦${n.toLocaleString("en-NG")}`;

    function update() {
      const price = Number(priceInput.value.replace(/[^\d]/g, ""));
      if (pct === 0) {
        estimate.textContent = "No commission is currently charged on sales.";
      } else if (!price) {
        estimate.textContent = `VETRA deducts a ${pctLabel} commission from each completed sale.`;
      } else {
        const cut = Math.round((price * pct) / 100);
        estimate.textContent = `You receive about ${naira(price - cut)} per unit after the ${pctLabel} commission (${naira(cut)}).`;
      }
    }
    priceInput.addEventListener("input", update);
    update();
  });
})();
