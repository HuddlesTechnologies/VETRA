/* =========================================================
   /api/products — public browse/search, plus vendor-owned CRUD.
   Backs customer/explore.html, category.html, store.html, and
   vendor/products.html's Add Product modal + Edit/Remove actions.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { newId } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");
const { escapeHtml } = require("../utils/escapeHtml");
const { alertIfLowStock } = require("../utils/lowStockAlert");

const router = express.Router();

const MAX_KEYWORDS = 5;

// Validates and normalizes the vendor-supplied search keywords (add/edit
// product form) — trimmed, empties dropped, capped at MAX_KEYWORDS so a
// vendor can't quietly turn this into an unbounded description field.
// Returns null (undefined body field, "leave keywords alone") or an
// array; throws a plain Error with a user-facing message on an actual
// over-the-cap submission, which the caller turns into a 400.
function normalizeKeywords(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error("keywords must be an array of strings.");
  const cleaned = input.map((k) => String(k).trim()).filter(Boolean);
  if (cleaned.length > MAX_KEYWORDS) throw new Error(`You can add up to ${MAX_KEYWORDS} keywords.`);
  return cleaned;
}

// "Auto-flag suspicious listings" (admin/settings.html) — a short,
// conservative list of unambiguous restricted-item terms, not a broad
// content filter that would false-positive on ordinary products (e.g.
// "weed" is deliberately excluded — too likely to hit gardening tools).
const RESTRICTED_LISTING_KEYWORDS = [
  "firearm", "gun", "pistol", "rifle", "ammunition", "ammo",
  "explosive", "grenade",
  "cocaine", "heroin", "methamphetamine", "crystal meth",
  "counterfeit", "fake currency", "stolen",
];

async function autoFlagIfRestricted(productId, vendorId, name, description) {
  const [settingsRows] = await pool.query(`SELECT auto_flag_listings FROM platform_settings WHERE id = 1`);
  if (!settingsRows[0]?.auto_flag_listings) return;

  const haystack = `${name || ""} ${description || ""}`.toLowerCase();
  const matched = RESTRICTED_LISTING_KEYWORDS.find((kw) => haystack.includes(kw));
  if (!matched) return;

  // Same shape a buyer's own report uses (type='vendor', order_id
  // null since this isn't tied to an order) — admin/reports.html
  // already knows how to render and act on this, no new UI needed.
  // `name` is the vendor's own product name — escaped before it goes
  // anywhere near a stored HTML-rendered field, same reasoning as
  // reports.routes.js's escaping of a buyer's report reason.
  const safeName = escapeHtml(name);
  await pool.query(
    `INSERT INTO reports (id, type, target_id, reporter, reason)
     VALUES (?, 'vendor', ?, 'VETRA (auto-flag)', ?)`,
    [newId(), vendorId, `Auto-flagged: listing "${safeName}" (product ${productId.slice(0, 8)}) contains a restricted term ("${matched}") — review before it stays live.`]
  );
  // No actorUserId — a system event, not an admin or the vendor acting,
  // same reasoning as a buyer-filed report (see POST /api/reports).
  await logActivity({
    type: "report",
    message: `Auto-flagged listing <strong>${safeName}</strong> for a restricted term.`,
    targetType: "vendor",
    targetId: vendorId,
  });
}

// Public: browse/search. ?vendor=<id>, ?category=<name>, ?q=<text> are
// all optional filters — omit all three to get the full active catalog.
//
// ?vendor=<id> is also how a vendor's own products.html/dashboard.html
// list their own listings — that case intentionally skips the "vendor
// must be approved" check below, so a still-pending vendor can manage
// their own catalog. General/public browsing (no ?vendor=) requires an
// approved (status='active') vendor, matching GET /api/vendors' own
// directory — without this, an unapproved vendor's products were
// publicly visible/purchasable despite never appearing in the vendor
// directory itself.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { vendor, category, q } = req.query;
    const baseClauses = ["p.status = 'active'"];
    const baseParams = [];

    if (vendor) {
      baseClauses.push("p.vendor_id = ?");
      baseParams.push(vendor);
    } else {
      baseClauses.push("(v.status = 'active' OR (vk.status = 'verified' AND vk.id_document_url IS NOT NULL AND vk.cac_document_url IS NOT NULL))");
    }
    if (category) {
      baseClauses.push("p.category = ?");
      baseParams.push(category);
    }

    // description/video_url included even for the list view (not just the
    // single-product GET) — vendor/assets/products-data.js caches this same
    // response for the Edit modal's prefill, and a missing description
    // silently blocks every edit save (ap-description is a required field).
    // sales_count powers the "Hot" badge (customer/assets/products.js);
    // it's a real aggregate, not a stored counter, since order volume is
    // still low enough that this is cheap.
    const selectSql = `SELECT p.id, p.vendor_id, v.store_name AS vendor_name, p.name, p.category, p.color, p.storage, p.price,
              p.stock_quantity, p.description, p.keywords, p.images, p.video_url, p.status, p.created_at,
            COALESCE(vk.status = 'verified', 0) AS vendor_kyc_verified,
              (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 WHERE oi.product_id = p.id AND o.status = 'completed') AS sales_count
       FROM products p JOIN users v ON v.id = p.vendor_id
       LEFT JOIN vendor_kyc vk ON vk.vendor_id = v.id`;

    // Safety-net LIMIT (not real pagination) on every branch below — see
    // the note on this route's history for why every list route in this
    // backend caps at 200 rather than returning an unbounded result set.
    async function runQuery(extraClause, extraParams) {
      const clauses = extraClause ? [...baseClauses, extraClause] : baseClauses;
      const params = extraClause ? [...baseParams, ...extraParams] : baseParams;
      const [rows] = await pool.query(
        `${selectSql} WHERE ${clauses.join(" AND ")} ORDER BY p.created_at DESC LIMIT 200`,
        params
      );
      return rows;
    }

    if (q) {
      // Real FULLTEXT search (idx_products_search, migrations/001_init.sql)
      // instead of the old `name LIKE '%text%' OR description LIKE '%text%'`
      // — a leading wildcard can never use an index, guaranteeing a full
      // scan regardless of what else exists. Each word 3+ characters
      // becomes a required prefix match (BOOLEAN MODE's `+word*`); MySQL's
      // innodb_ft_min_token_size (3 here, read-only on this managed
      // database — can't be lowered without a server restart we don't
      // have) means anything shorter was never indexed in the first
      // place, so those words are dropped from the fulltext attempt
      // rather than silently never matching.
      // Keyword match (JSON_SEARCH's 'one' mode scans the array for an
      // element matching the pattern — % / _ work as SQL LIKE wildcards
      // in the search string, same as any other LIKE here) rides along
      // with both the fulltext attempt and its LIKE fallback below, so
      // a vendor-supplied keyword surfaces a listing even when the word
      // never appears in the name/description at all.
      const ftTerms = q.trim().split(/\s+/).filter((w) => w.length >= 3).map((w) => `+${w}*`);
      if (ftTerms.length) {
        const rows = await runQuery(
          "(MATCH(p.name, p.description) AGAINST(? IN BOOLEAN MODE) OR JSON_SEARCH(p.keywords, 'one', ?) IS NOT NULL)",
          [ftTerms.join(" "), `%${q}%`]
        );
        if (rows.length) return res.json(rows);
      }
      // Fallback — either every word was too short to be indexed at all
      // (e.g. "TV", "AC"), or the fulltext search genuinely found
      // nothing. Same LIMIT 200 cap keeps even this bounded.
      return res.json(await runQuery(
        "(p.name LIKE ? OR p.description LIKE ? OR JSON_SEARCH(p.keywords, 'one', ?) IS NOT NULL)",
        [`%${q}%`, `%${q}%`, `%${q}%`]
      ));
    }

    const rows = await runQuery();
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    // vendor_kyc_verified: same real KYC outcome (vendor_kyc.status =
    // 'verified') the storefront badge uses (vendors.routes.js's GET /:id) —
    // product.html shows its own verified tick next to "Sold by" without a
    // second request, so it needs to ride along with the product row.
    const [rows] = await pool.query(
      `SELECT p.*, v.store_name AS vendor_name, v.status AS vendor_status,
              COALESCE(vk.status = 'verified', 0) AS vendor_kyc_verified
       FROM products p JOIN users v ON v.id = p.vendor_id
       LEFT JOIN vendor_kyc vk ON vk.vendor_id = v.id
      WHERE p.id = ? AND p.status = 'active' AND (v.status = 'active' OR (vk.status = 'verified' AND vk.id_document_url IS NOT NULL AND vk.cac_document_url IS NOT NULL))`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Product not found." });
    res.json(rows[0]);
  })
);

// Vendor-owned from here down.
router.use(requireAuth, requireRole("vendor"));

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, category, color, storage, price, stockQuantity, description, keywords, images, videoUrl } = req.body;
    if (!name || !category || !Number.isInteger(Number(price)) || Number(price) <= 0) {
      return res.status(400).json({ error: "name, category, and price are required." });
    }
    if (!Number.isInteger(Number(stockQuantity || 0)) || Number(stockQuantity || 0) < 0) {
      return res.status(400).json({ error: "stockQuantity must be a non-negative whole number." });
    }
    const [[kyc]] = await pool.query(`SELECT status FROM vendor_kyc WHERE vendor_id = ?`, [req.user.id]);
    if (kyc?.status !== "verified") {
      return res.status(403).json({ error: "Complete and pass KYC verification before listing products." });
    }

    let normalizedKeywords;
    try {
      normalizedKeywords = normalizeKeywords(keywords) || [];
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const id = newId();
    await pool.query(
      `INSERT INTO products (id, vendor_id, name, category, color, storage, price, stock_quantity, description, keywords, images, video_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user.id,
        name,
        category,
        color || null,
        storage || null,
        Number(price),
        Number(stockQuantity || 0),
        description || null,
        JSON.stringify(normalizedKeywords),
        JSON.stringify(images || []),
        videoUrl || null,
      ]
    );
    await autoFlagIfRestricted(id, req.user.id, name, description);
    const [[vendor]] = await pool.query(`SELECT email FROM users WHERE id = ?`, [req.user.id]);
    await alertIfLowStock({
      vendorId: req.user.id,
      vendorEmail: vendor.email,
      productId: id,
      productName: name,
      currentStock: Number(stockQuantity || 0),
      source: "product_edit",
    });
    res.status(201).json({ id });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const [owned] = await pool.query(
      `SELECT p.vendor_id, p.stock_quantity, p.name, p.status, u.email AS vendor_email
       FROM products p JOIN users u ON u.id = p.vendor_id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!owned[0]) return res.status(404).json({ error: "Product not found." });
    if (owned[0].vendor_id !== req.user.id) {
      return res.status(403).json({ error: "You don't own this product." });
    }

    if (owned[0].status === "removed") {
      return res.status(403).json({ error: "This listing was removed by an administrator." });
    }

    if (req.body.price !== undefined && (!Number.isInteger(Number(req.body.price)) || Number(req.body.price) <= 0)) {
      return res.status(400).json({ error: "price must be a positive whole number in kobo." });
    }
    if (req.body.stockQuantity !== undefined && (!Number.isInteger(Number(req.body.stockQuantity)) || Number(req.body.stockQuantity) < 0)) {
      return res.status(400).json({ error: "stockQuantity must be a non-negative whole number." });
    }

    const fields = ["name", "category", "color", "storage", "price", "stock_quantity", "description", "video_url"];
    const updates = [];
    const params = [];
    for (const f of fields) {
      const bodyKey = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); // stock_quantity -> stockQuantity
      if (req.body[bodyKey] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(req.body[bodyKey]);
      }
    }
    if (req.body.images !== undefined) {
      updates.push("images = ?");
      params.push(JSON.stringify(req.body.images));
    }
    if (req.body.keywords !== undefined) {
      let normalizedKeywords;
      try {
        normalizedKeywords = normalizeKeywords(req.body.keywords);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      updates.push("keywords = ?");
      params.push(JSON.stringify(normalizedKeywords));
    }
    if (!updates.length) return res.status(400).json({ error: "No fields to update." });

    params.push(req.params.id);
    await pool.query(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`, params);

    // Re-check on any edit, not just when name/description themselves
    // changed — simpler than tracking which fields actually moved, and
    // cheap enough for a one-row lookup plus a substring scan.
    const [updated] = await pool.query(`SELECT name, description FROM products WHERE id = ?`, [req.params.id]);
    await autoFlagIfRestricted(req.params.id, owned[0].vendor_id, updated[0].name, updated[0].description);
    const currentStock = req.body.stockQuantity !== undefined
      ? Number(req.body.stockQuantity)
      : Number(owned[0].stock_quantity);
    await alertIfLowStock({
      vendorId: owned[0].vendor_id,
      vendorEmail: owned[0].vendor_email,
      productId: req.params.id,
      productName: updated[0].name,
      previousStock: Number(owned[0].stock_quantity),
      currentStock,
      source: "product_edit",
    });

    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [owned] = await pool.query(`SELECT vendor_id FROM products WHERE id = ?`, [req.params.id]);
    if (!owned[0]) return res.status(404).json({ error: "Product not found." });
    if (owned[0].vendor_id !== req.user.id) {
      return res.status(403).json({ error: "You don't own this product." });
    }
    // Soft delete — keeps order_items' foreign key intact for past orders.
    await pool.query(`UPDATE products SET status = 'removed' WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
