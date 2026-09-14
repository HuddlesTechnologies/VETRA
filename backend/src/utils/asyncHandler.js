// Wraps an async route handler so a rejected promise reaches Express's
// error middleware instead of crashing the process — Express 4 doesn't
// do this automatically for async functions.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
