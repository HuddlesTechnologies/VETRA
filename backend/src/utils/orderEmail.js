/* =========================================================
   Shared body for every customer-facing order email: checkout
   confirmation, every status update in orders.routes.js, and every
   delivery update in utils/delivery.js. Lists what the buyer bought,
   who from, how it's being delivered, and the total, not just a
   bare status line.

   Vendor store name and item names are vendor-controlled free text,
   and buyerName is user-typed (signup name or guest checkout name),
   so all of them are escaped before going anywhere near an HTML
   email client.
   ========================================================= */

const { escapeHtml } = require("./escapeHtml");

function nairaLabel(kobo) {
  return `₦${(kobo / 100).toLocaleString("en-NG")}`;
}

// Where a refund lands, from the Paystack channel the buyer paid with
// (payments.channel). Paystack refunds a card payment to the card and
// anything paid by bank transfer, USSD or bank to the paying account, so
// "refunded to your card" is only true for card payments. Unknown or
// missing channel (older payments) gets the wording that covers both.
function refundDestination(channel) {
  const c = String(channel || "").toLowerCase();
  if (c === "card" || c === "apple_pay") return "your card";
  if (["bank", "bank_transfer", "ussd", "eft", "dedicated_nuban"].includes(c)) return "the bank account you paid from";
  if (c === "mobile_money" || c === "qr") return "the account you paid from";
  return "the card or account you paid with";
}

function buildOrderEmailHtml({
  greetingName, introHtml, ref, trackingCode, vendorStoreName, items,
  deliveryMethod, deliveryAddress, total, deliveryFee = 0, deliveryCode = null,
  carrier, trackingNumber,
}) {
  // Only ever lists what the buyer is actually being charged for. An
  // item a vendor has since marked unavailable (order_items.status)
  // drops out of every email from this point on, same as it already
  // dropped out of `total`. PATCH /:id/items/:itemId/unavailable's own
  // email is the one place that still names the removed item, and it
  // builds that line separately, not via this item list.
  const fulfilledItems = (items || []).filter((i) => i.status !== "unavailable");
  const itemRows = fulfilledItems
    .map((i) => {
      const lineTotal = nairaLabel((i.priceAtPurchase || 0) * (i.quantity || 1));
      return `<tr>
        <td style="padding:6px 8px 6px 0; font-size:13px; color:#111;">${escapeHtml(i.name || "Item")}${i.quantity > 1 ? ` &times; ${i.quantity}` : ""}</td>
        <td style="padding:6px 0; font-size:13px; color:#111; text-align:right; white-space:nowrap;">${lineTotal}</td>
      </tr>`;
    })
    .join("");

  const deliveryLine = deliveryMethod === "pickup"
    ? "Pickup from the vendor's store, no delivery address needed."
    : `Delivery${deliveryAddress ? ` to: ${escapeHtml(deliveryAddress)}` : ""}.`;

  const carrierLine = carrier || trackingNumber
    ? `<p style="margin:0 0 12px; font-size:13px; color:#333;">${escapeHtml([carrier, trackingNumber].filter(Boolean).join(" · "))}</p>`
    : "";

  const feeRow = deliveryFee > 0
    ? `<tr><td style="padding:6px 8px 0 0; font-size:13px; color:#666;">Delivery</td><td style="padding:6px 0 0; font-size:13px; color:#666; text-align:right;">${nairaLabel(deliveryFee)}</td></tr>`
    : "";

  // The proof-of-receipt code only ever goes to the buyer's own inbox.
  // Vendor-facing emails never pass deliveryCode.
  const codeBlock = deliveryCode
    ? `<p style="margin:0 0 14px; padding:10px 12px; background:#f4f4f6; border-radius:8px; font-size:13px; color:#111;">
        Your ${deliveryMethod === "pickup" ? "pickup" : "delivery"} code is <strong style="font-size:16px; letter-spacing:2px;">${deliveryCode}</strong>.
        Only give it to the ${deliveryMethod === "pickup" ? "vendor" : "rider"} once you have the package in hand.
      </p>`
    : "";

  return `
    <p>Hi ${escapeHtml(greetingName)},</p>
    <p>${introHtml}</p>
    ${codeBlock}
    <table style="border-collapse:collapse; margin:4px 0 14px; font-size:13px; color:#333;">
      <tr><td style="padding:2px 12px 2px 0; color:#666;">Order ID</td><td style="padding:2px 0; font-weight:700;">${trackingCode || ref}</td></tr>
      <tr><td style="padding:2px 12px 2px 0; color:#666;">Sold by</td><td style="padding:2px 0;">${escapeHtml(vendorStoreName || "—")}</td></tr>
    </table>
    <table style="width:100%; max-width:480px; border-collapse:collapse; margin:0 0 14px;">
      ${itemRows}
      ${feeRow}
      <tr><td style="padding:8px 8px 0 0; font-size:13px; font-weight:700; border-top:1px solid #e5e5e5;">Total</td><td style="padding:8px 0 0; font-size:13px; font-weight:700; text-align:right; border-top:1px solid #e5e5e5;">${nairaLabel(total + deliveryFee)}</td></tr>
    </table>
    <p style="margin:0 0 12px; font-size:13px; color:#333;">${deliveryLine}</p>
    ${carrierLine}
  `;
}

module.exports = { nairaLabel, refundDestination, buildOrderEmailHtml };
