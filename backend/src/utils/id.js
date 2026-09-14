// Node's built-in crypto.randomUUID() covers this — no need for the
// external `uuid` package just to generate an id.
const { randomUUID } = require("crypto");

module.exports = { newId: randomUUID };
