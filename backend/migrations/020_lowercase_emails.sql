-- Emails are now stored lowercase (auth.routes.js normalizeEmail), so
-- sign-in matches no matter how the address was capitalised. Lowercase
-- the rows saved before that. IGNORE skips any row whose lowercase form
-- would collide with another account's (email, role); the case-insensitive
-- lookups in auth.routes.js still find those.

UPDATE IGNORE users SET email = LOWER(email) WHERE CAST(email AS BINARY) <> CAST(LOWER(email) AS BINARY);
