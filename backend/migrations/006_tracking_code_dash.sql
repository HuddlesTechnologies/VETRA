-- =========================================================
-- VETRA — dashed VTA/VTR reference format
--
-- newTrackingCode() and formatRef() (src/utils/id.js) now emit
-- "VTA-XXXXXXXX" / "VTR-XXXXXXXX" (with a dash) instead of the old
-- undashed "VTAXXXXXXXX". orders.tracking_code was sized CHAR(11) for
-- the undashed value ("VTA" + 8 chars); widen it by one character so
-- the dash isn't truncated. Existing rows keep their old undashed
-- codes untouched — this only affects new inserts.
-- =========================================================

ALTER TABLE orders
  MODIFY COLUMN tracking_code CHAR(12) NULL;
