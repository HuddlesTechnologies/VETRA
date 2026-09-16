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

const router = express.Router();

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
    const clauses = ["p.status = 'active'"];
    const params = [];

    if (vendor) {
      clauses.push("p.vendor_id = ?");
      params.push(vendor);
    } else {
      clauses.push("v.status = 'active'");
    }
    if (category) {
      clauses.push("p.category = ?");
      params.push(category);
    }
    if (q) {
      clauses.push("(p.name LIKE ? OR p.description LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }

    // description/video_url included even for the list view (not just the
    // single-product GET) — vendor/assets/products-data.js caches this same
    // response for the Edit modal's prefill, and a missing description
    // silently blocks every edit save (ap-description is a required field).
    // sales_count powers the "Hot" badge (customer/assets/products.js);
    // it's a real aggregate, not a stored counter, since order volume is
    // still low enough that this is cheap.
    const [rows] = await pool.query(
      `SELECT p.id, p.vendor_id, v.store_name AS vendor_name, p.name, p.category, p.price,
              p.stock_quantity, p.description, p.images, p.video_url, p.status, p.created_at,
              (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 WHERE oi.product_id = p.id AND o.status = 'completed') AS sales_count
       FROM products p JOIN users v ON v.id = p.vendor_id
       WHERE ${clauses.join(" AND ")} ORDER BY p.created_at DESC`,
      params
    );
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.*, v.store_name AS vendor_name, v.status AS vendor_status
       FROM products p JOIN users v ON v.id = p.vendor_id
       WHERE p.id = ?`,
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
    const { name, category, price, stockQuantity, description, images, videoUrl } = req.body;
    if (!name || !category || !price) {
      return res.status(400).json({ error: "name, category, and price are required." });
    }

    const id = newId();
    await pool.query(
      `INSERT INTO products (id, vendor_id, name, category, price, stock_quantity, description, images, video_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user.id,
        name,
        category,
        price,
        stockQuantity || 0,
        description || null,
        JSON.stringify(images || []),
        videoUrl || null,
      ]
    );
    res.status(201).json({ id });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const [owned] = await pool.query(`SELECT vendor_id FROM products WHERE id = ?`, [req.params.id]);
    if (!owned[0]) return res.status(404).json({ error: "Product not found." });
    if (owned[0].vendor_id !== req.user.id) {
      return res.status(403).json({ error: "You don't own this product." });
    }

    const fields = ["name", "category", "price", "stock_quantity", "description", "status", "video_url"];
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
    if (!updates.length) return res.status(400).json({ error: "No fields to update." });

    params.push(req.params.id);
    await pool.query(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`, params);
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
