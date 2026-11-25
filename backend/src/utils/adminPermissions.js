/* =========================================================
   Admin permissions: what each admin can do in the console.

   Every gated admin route asks for one permission key from PERMISSIONS
   below (middleware/auth.js's requirePermission). An admin's effective
   permissions are:

     the permissions of their role (admin_roles.permissions)
     + anything granted to them personally   (admin_permission_overrides, effect 'grant')
     - anything taken away from them personally (effect 'deny')

   "Super Admin" is a fixed system role: it always has every
   permission, can't be edited, renamed, deleted or have permissions
   denied, so the console can never be locked out. Managing the admin
   team and roles (TEAM_PERMISSION) is a Super Admin power only; it is
   not in the catalog a Super Admin can hand out, because whoever holds
   it could grant themselves everything else.
   ========================================================= */

const pool = require("../db");

const SUPER_ADMIN = "Super Admin";
const TEAM_PERMISSION = "team.manage";

// group: the heading it's listed under in admin/settings.html.
const PERMISSIONS = [
  { key: "customers.status", group: "Customers", label: "Suspend and reactivate customers" },
  { key: "customers.contact", group: "Customers", label: "Change a customer's email or phone" },
  { key: "customers.delete", group: "Customers", label: "Delete customer accounts" },

  { key: "vendors.status", group: "Vendors", label: "Approve, suspend and reactivate vendors" },
  { key: "vendors.kyc", group: "Vendors", label: "Review vendor identity (KYC)" },
  { key: "vendors.contact", group: "Vendors", label: "Change a vendor's email, phone or legal name" },
  { key: "vendors.payout_account", group: "Vendors", label: "See vendor payout accounts" },
  { key: "vendors.delete", group: "Vendors", label: "Delete vendor accounts" },
  { key: "products.remove", group: "Vendors", label: "Remove vendor products" },

  { key: "users.ban", group: "Bans", label: "Ban accounts and devices" },
  { key: "users.unban", group: "Bans", label: "Lift account bans" },
  { key: "devices.unban", group: "Bans", label: "Lift device bans" },

  { key: "reports.resolve", group: "Reports", label: "Resolve reports" },

  { key: "deliveries.dispatch", group: "Deliveries", label: "Assign, cancel and return deliveries" },
  { key: "riders.manage", group: "Deliveries", label: "Add and edit riders" },
  { key: "riders.delete", group: "Deliveries", label: "Remove riders" },
  { key: "riders.payouts", group: "Deliveries", label: "Pay riders" },
  { key: "deliveries.settings", group: "Deliveries", label: "Change delivery rates and settings" },

  { key: "payments.view", group: "Payments", label: "See payments, payouts, refunds and balance" },
  { key: "payments.manage", group: "Payments", label: "Retry or cancel payouts and refunds, issue refunds, change payment settings" },

  { key: "activity.view_all", group: "Activity", label: "See every admin's activity" },
  { key: "activity.delete", group: "Activity", label: "Delete activity log entries" },

  { key: "settings.platform", group: "Site", label: "Change platform settings" },
  { key: "site.banners", group: "Site", label: "Manage homepage banners" },
  { key: "site.social_links", group: "Site", label: "Manage social media links" },
];
const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));
const ALL_PERMISSIONS = [...PERMISSION_KEYS, TEAM_PERMISSION];

function parseList(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Only known, grantable keys, de-duplicated, in catalog order. */
function cleanPermissionList(list) {
  const wanted = new Set((Array.isArray(list) ? list : []).map(String));
  return PERMISSIONS.map((p) => p.key).filter((k) => wanted.has(k));
}

/** Effective permission keys for one admin account. */
async function permissionsFor(userId, roleName, conn = pool) {
  if (roleName === SUPER_ADMIN) return [...ALL_PERMISSIONS];
  const [[roleRows], [overrideRows]] = await Promise.all([
    conn.query(`SELECT permissions FROM admin_roles WHERE name = ? LIMIT 1`, [roleName || ""]),
    conn.query(`SELECT permission, effect FROM admin_permission_overrides WHERE user_id = ?`, [userId]),
  ]);
  const set = new Set(cleanPermissionList(parseList(roleRows[0]?.permissions)));
  for (const o of overrideRows) {
    if (!PERMISSION_KEYS.has(o.permission)) continue;
    if (o.effect === "grant") set.add(o.permission);
    else set.delete(o.permission);
  }
  return [...set];
}

async function roleExists(name, conn = pool) {
  const [rows] = await conn.query(`SELECT name FROM admin_roles WHERE name = ? LIMIT 1`, [name || ""]);
  return Boolean(rows[0]);
}

module.exports = {
  SUPER_ADMIN,
  TEAM_PERMISSION,
  PERMISSIONS,
  PERMISSION_KEYS,
  parseList,
  cleanPermissionList,
  permissionsFor,
  roleExists,
};
