const path = require("path");
// Explicit path rather than dotenv's process.cwd() default: cPanel's
// Passenger starts the app from its own working directory, which isn't
// guaranteed to be the app root where .env lives.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const app = require("./app");
const { verifyMailer } = require("./utils/mailer");
const { startInProcessSweep } = require("./utils/scheduledJobs");

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`VETRA API listening on port ${port}`);
  verifyMailer();
  startInProcessSweep();
});
