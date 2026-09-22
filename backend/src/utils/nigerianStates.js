/* The fixed set of valid values for users.state, Nigeria's 36 states
   plus the FCT. Used to validate `state` server-side on every signup
   path (password signup and Google's "complete your profile" step);
   the frontend dropdown (signup.html, google-signin.js) offers exactly
   this list, nothing free-typed, so a mismatch here would mean the two
   have drifted apart. */
const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
  "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT (Abuja)",
];

module.exports = { NIGERIAN_STATES };
