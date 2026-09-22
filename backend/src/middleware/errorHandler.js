/* Centralized error handler, every route's thrown/rejected error ends
   up here via asyncHandler. Keeps error shape consistent across the API
   and stops a raw stack trace from ever reaching a client response. */
module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);

  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ error: "That already exists." });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? "Something went wrong." : err.message });
};
