/* =========================================================
   /api/assistant/chat — the AI shopping assistant discussed
   alongside BACKEND_GUIDE.md's target architecture.

   Deliberately the simple version first: ground Claude's reply in
   a keyword search over `products` (reusing the same LIKE query
   /api/products already does) rather than a full embedding-based
   semantic search. This matches the earlier cost/build-order
   advice — start with cheap-model + simple grounding, add
   embedding-based search (the `description_embedding` column
   already sitting in the schema) once there's real usage to
   justify it.
   ========================================================= */

const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const pool = require("../db");
const { optionalAuth } = require("../middleware/auth");
const { assistantChatLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Very small stopword list — good enough to stop "a", "the", "for" etc.
// from dominating the LIKE search; not meant to be linguistically complete.
const STOPWORDS = new Set(["a", "an", "the", "for", "with", "and", "or", "of", "to", "me", "i", "want", "need"]);

async function findCandidateProducts(message) {
  const keywords = message
    .toLowerCase()
    .replace(/[^a-z0-9₦\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  if (!keywords.length) return [];

  const clauses = keywords.map(() => "(p.name LIKE ? OR p.description LIKE ? OR p.category LIKE ?)");
  const params = keywords.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]);

  const [rows] = await pool.query(
    `SELECT p.id, p.vendor_id, p.name, p.category, p.price, p.stock_quantity
     FROM products p JOIN users v ON v.id = p.vendor_id
     WHERE p.status = 'active' AND v.status = 'active' AND (${clauses.join(" OR ")})
     ORDER BY p.created_at DESC LIMIT 8`,
    params
  );
  return rows;
}

router.post(
  "/chat",
  assistantChatLimiter,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: "message is required." });

    const candidates = await findCandidateProducts(message);

    const catalogContext = candidates.length
      ? candidates
          .map((p) => `- ${p.name} (${p.category}) — ₦${(p.price / 100).toLocaleString("en-NG")}, product id ${p.id}`)
          .join("\n")
      : "(No obviously matching products found in the catalog for this message.)";

    const systemPrompt = `You are VETRA's shopping assistant, helping a buyer find products on a Nigerian marketplace.
Only recommend items from the CATALOG MATCHES list below — never invent products, prices, or vendors that aren't listed.
If nothing in the list actually fits what they're asking for, say so plainly and suggest they browse or refine their search, rather than forcing a weak match.
Keep replies short (2-4 sentences), friendly, and specific — name the product and price when you recommend one.

CATALOG MATCHES:
${catalogContext}`;

    const messages = [
      ...(Array.isArray(history) ? history : []),
      { role: "user", content: message },
    ];

    const completion = await anthropic.messages.create({
      model: process.env.ASSISTANT_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: systemPrompt,
      messages,
    });

    const reply = completion.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    res.json({ reply, matchedProducts: candidates });
  })
);

module.exports = router;
