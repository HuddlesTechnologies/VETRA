/* =========================================================
   /api/reports — admin's moderation queue (admin/reports.html)
   plus the vendor-facing read-only mirror (vendor/orders.html's
   "Reports against your store" panel). A vendor can read their
   own reports and submit evidence; only an admin can resolve or
   dismiss one — see DOCUMENTATION.md §6's description of why
   that split exists.
   ========================================================= */

const express = require("express");
const pool = require("../db");
const { newId } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { logActivity } = require("../utils/activityLog");

const router = express.Router();

router.use(requireAuth);

// Admin: full queue, optional ?status= filter.
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const clauses = [];
    const params = [];
    if (status && status !== "all") {
      clauses.push("status = ?");
      params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await pool.query(
      `SELECT * FROM reports ${where} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  })
);

// Vendor: only reports filed against their own store.
router.get(
  "/mine",
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT r.*, GROUP_CONCAT(e.id) AS evidence_ids
       FROM reports r LEFT JOIN report_evidence e ON e.report_id = r.id
       WHERE r.type = 'vendor' AND r.target_id = ?
       GROUP BY r.id ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  })
);

router.patch(
  "/:id/status",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!["resolved", "dismissed"].includes(status)) {
      return res.status(400).json({ error: "status must be 'resolved' or 'dismissed'." });
    }

    await pool.query(
      `UPDATE reports SET status = ?, attended_by_user_id = ?, attended_at = NOW() WHERE id = ?`,
      [status, req.user.id, req.params.id]
    );

    await logActivity({
      type: "report",
      message: `Report <strong>#${req.params.id.slice(0, 8)}</strong> marked <strong>${status}</strong>.`,
      actorUserId: req.user.id,
      targetType: "report",
      targetId: req.params.id,
    });

    res.json({ ok: true });
  })
);

// Vendor: submit evidence on an open report against their store
// (vendor/assets/reports.js's "Submit evidence" modal).
router.post(
  "/:id/evidence",
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const { responseText, attachmentUrls } = req.body;
    if (!responseText) return res.status(400).json({ error: "responseText is required." });

    const [reports] = await pool.query(
      `SELECT id FROM reports WHERE id = ? AND type = 'vendor' AND target_id = ? LIMIT 1`,
      [req.params.id, req.user.id]
    );
    if (!reports[0]) return res.status(404).json({ error: "Report not found." });

    const id = newId();
    await pool.query(
      `INSERT INTO report_evidence (id, report_id, vendor_user_id, response_text, attachment_urls)
       VALUES (?, ?, ?, ?, ?)`,
      [id, req.params.id, req.user.id, responseText, JSON.stringify(attachmentUrls || [])]
    );
    res.status(201).json({ id });
  })
);

module.exports = router;
