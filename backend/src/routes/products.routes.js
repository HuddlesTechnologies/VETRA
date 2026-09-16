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
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { vendor, category, q } = req.query;
    const clauses = ["status = 'active'"];
    const params = [];

    if (vendor) {
      clauses.push("vendor_id = ?");
      params.push(vendor);
    }
    if (category) {
      clauses.push("category = ?");
      params.push(category);
    }
    if (q) {
      clauses.push("(name LIKE ? OR description LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }

    const [rows] = await pool.query(
      `SELECT id, vendor_id, name, category, price, stock_quantity, images, status, created_at
       FROM products WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM products WHERE id = ?`, [req.params.id]);
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
