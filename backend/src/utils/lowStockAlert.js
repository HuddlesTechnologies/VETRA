const { notify } = require("./notify");
const { sendEmail } = require("./mailer");

const LOW_STOCK_THRESHOLD = Math.max(0, Number(process.env.LOW_STOCK_THRESHOLD || 5));

async function alertIfLowStock({ vendorId, vendorEmail, productId, productName, previousStock, currentStock, source }) {
  const enteredLowStock = currentStock <= LOW_STOCK_THRESHOLD
    && (previousStock === undefined || previousStock > LOW_STOCK_THRESHOLD);
  if (!enteredLowStock) return;

  const stockLabel = currentStock === 0 ? "out of stock" : `${currentStock} unit${currentStock === 1 ? "" : "s"} remaining`;
  const sourceLabel = source === "checkout" ? "after a customer order" : "after your product was saved";
  const message = `Your product "${productName}" is ${stockLabel} ${sourceLabel}.`;
  const link = `products.html?product=${encodeURIComponent(productId)}`;

  try {
    await notify({
      userId: vendorId,
      type: "low_stock",
      title: currentStock === 0 ? "Product is out of stock" : "Low stock alert",
      message,
      link,
    });
  } catch (error) {
    console.error(`[low-stock:notification-failed] product=${productId}:`, error.message);
  }

  await sendEmail({
    to: vendorEmail,
    subject: currentStock === 0 ? `Out of stock: ${productName}` : `Low stock alert: ${productName}`,
    html: `<p>Hi,</p><p>${message}</p><p>Open your Products page to update the listing or add more inventory.</p>`,
    logFallback: `low-stock alert for ${vendorEmail}: ${productName} (${currentStock} remaining)`,
  });
}

module.exports = { LOW_STOCK_THRESHOLD, alertIfLowStock };
