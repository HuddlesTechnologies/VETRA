/* =========================================================
   VETRA — ADMIN MOCK DATA LAYER
   VETRA has no backend yet, so this file stands in for the
   admin API: it seeds a realistic dataset (customers, vendors,
   reports, activity log, admin team) and persists it to
   localStorage so actions taken in the admin console (suspend,
   approve, resolve a report, reset a password, invite an
   admin...) survive a page reload and are reflected across
   every admin page. Every write also appends an entry to the
   activity log, so activity.html doubles as an audit trail of
   what admins have done in this browser session.

   "Who's logged in" is simulated too, since there's no real
   session/auth: admin/login.html looks up the email typed
   against `team` and calls setCurrentAdminByEmail() so the rest
   of the console knows which admin is acting — that's who gets
   credited as the actor on every log entry, and whose avatar
   shows in the header.

   Swap this file for real API calls when a backend exists —
   every admin page only talks to the VetraAdmin.* functions
   below, never to localStorage directly.
   ========================================================= */

const VetraAdmin = (() => {
  const LS_KEY = "vetra_admin_state_v1";

  const SEED = {
    currentAdminId: "t1",
    customers: [
      { id: "c1", name: "Amaka Obi", email: "amaka.obi@gmail.com", phone: "+234 803 555 0192", address: "12 Aso Drive, Asokoro, Abuja", joined: "2026-01-12", lastLogin: "2026-05-11T08:12:00Z", signupMethod: "Email", orders: 18, spent: 312400, status: "active" },
      { id: "c2", name: "Tunde Adebayo", email: "tunde.a@yahoo.com", phone: "+234 802 341 7765", address: "4 Marina Road, Lagos Island, Lagos", joined: "2026-02-03", lastLogin: "2026-05-10T19:44:00Z", signupMethod: "Google", orders: 6, spent: 84200, status: "active" },
      { id: "c3", name: "Chidera Nnamdi", email: "chidera.n@outlook.com", phone: "+234 810 220 9981", address: "9 Independence Layout, Enugu", joined: "2026-02-19", lastLogin: "2026-05-09T14:05:00Z", signupMethod: "Email", orders: 2, spent: 19750, status: "active" },
      { id: "c4", name: "Bola Sanni", email: "bola.sanni@gmail.com", phone: "+234 705 118 4420", address: "27 Ahmadu Bello Way, Kaduna", joined: "2026-03-05", lastLogin: "2026-05-08T16:30:00Z", signupMethod: "Email", orders: 11, spent: 145600, status: "suspended" },
      { id: "c5", name: "Ifeoma Kalu", email: "ifeoma.kalu@gmail.com", phone: "+234 813 774 2201", address: "18 Ikwerre Road, Port Harcourt", joined: "2026-03-22", lastLogin: "2026-05-11T06:50:00Z", signupMethod: "Google", orders: 4, spent: 51200, status: "active" },
      { id: "c6", name: "Emeka Okafor", email: "emeka.okafor@gmail.com", phone: "+234 706 992 1130", address: "3 Zik Avenue, Awka", joined: "2026-04-10", lastLogin: "2026-04-29T09:15:00Z", signupMethod: "Email", orders: 0, spent: 0, status: "active" },
      { id: "c7", name: "Zainab Musa", email: "zainab.musa@gmail.com", phone: "+234 809 447 3392", address: "15 Ibrahim Taiwo Road, Kano", joined: "2026-04-28", lastLogin: "2026-05-10T11:20:00Z", signupMethod: "Email", orders: 9, spent: 98300, status: "active" },
      { id: "c8", name: "Segun Alabi", email: "segun.alabi@gmail.com", phone: "+234 812 663 5567", address: "6 Ring Road, Ibadan", joined: "2026-05-14", lastLogin: "2026-05-16T07:05:00Z", signupMethod: "Google", orders: 3, spent: 27500, status: "suspended" },
    ],
    vendors: [
      { id: "v1", store: "Faster Gadgets Store", owner: "Amaka Obi", email: "amaka@fastergadgets.ng", phone: "+234 803 555 0192", address: "Asokoro, Abuja, Nigeria", category: "Electronics", joined: "2026-01-14", lastLogin: "2026-05-11T07:40:00Z", description: "Quality phones, power banks, and accessories with fast delivery across Abuja.", products: 24, orders: 58, revenue: 1284300, status: "active", kyc: { status: "verified", cacNumber: "RC1928374", idDocumentName: "amaka-obi-nin.jpg", idDocumentUrl: "assets/images/kyc-samples/id-document-sample.jpg", cacDocumentUrl: "assets/images/kyc-samples/cac-certificate-sample.jpg", cacDocumentName: "faster-gadgets-cac.pdf", submittedAt: "2026-01-15T09:00:00Z", reviewedAt: "2026-01-16T11:00:00Z" } },
      { id: "v2", store: "Chidera's Beauty Hub", owner: "Chidera Nnamdi", email: "chidera@beautyhub.ng", phone: "+234 810 220 9981", address: "Independence Layout, Enugu, Nigeria", category: "Health & Beauty", joined: "2026-01-30", lastLogin: "2026-05-11T08:40:00Z", description: "Skincare, cosmetics, and haircare products sourced from verified distributors.", products: 41, orders: 132, revenue: 2310500, status: "active", kyc: { status: "verified", cacNumber: "RC2031455", idDocumentName: "chidera-nnamdi-passport.jpg", idDocumentUrl: "assets/images/kyc-samples/id-document-sample.jpg", cacDocumentUrl: "assets/images/kyc-samples/cac-certificate-sample.jpg", cacDocumentName: "beauty-hub-cac.pdf", submittedAt: "2026-01-31T10:15:00Z", reviewedAt: "2026-02-01T09:30:00Z" } },
      { id: "v3", store: "Naija Home Essentials", owner: "Tunde Adebayo", email: "tunde@naijahome.ng", phone: "+234 802 341 7765", address: "Marina Road, Lagos Island, Lagos", category: "Home & Office", joined: "2026-04-30", lastLogin: "2026-05-08T13:00:00Z", description: "Kitchenware, storage, and home organization products.", products: 17, orders: 22, revenue: 318900, status: "pending", kyc: { status: "pending", cacNumber: "RC3157820", idDocumentName: "tunde-adebayo-license.jpg", idDocumentUrl: "assets/images/kyc-samples/id-document-sample.jpg", cacDocumentUrl: "assets/images/kyc-samples/cac-certificate-sample.jpg", cacDocumentName: "naija-home-cac.pdf", submittedAt: "2026-05-01T08:20:00Z", reviewedAt: null } },
      { id: "v4", store: "TechZone Abuja", owner: "Bola Sanni", email: "bola@techzoneabj.ng", phone: "+234 705 118 4420", address: "Ahmadu Bello Way, Kaduna, Nigeria", category: "Computing", joined: "2026-01-02", lastLogin: "2026-05-11T09:00:00Z", description: "Laptops, desktops, and computing accessories for business and gaming.", products: 63, orders: 201, revenue: 4520000, status: "suspended", kyc: { status: "verified", cacNumber: "RC0987654", idDocumentName: "bola-sanni-nin.jpg", idDocumentUrl: "assets/images/kyc-samples/id-document-sample.jpg", cacDocumentUrl: "assets/images/kyc-samples/cac-certificate-sample.jpg", cacDocumentName: "techzone-cac.pdf", submittedAt: "2026-01-03T09:00:00Z", reviewedAt: "2026-01-04T10:00:00Z" } },
      { id: "v5", store: "Glow Cosmetics NG", owner: "Ifeoma Kalu", email: "ifeoma@glowcosmetics.ng", phone: "+234 813 774 2201", address: "Ikwerre Road, Port Harcourt, Nigeria", category: "Health & Beauty", joined: "2026-02-11", lastLogin: "2026-05-10T17:22:00Z", description: "Locally made and imported cosmetics for every skin tone.", products: 29, orders: 76, revenue: 985200, status: "active", kyc: { status: "verified", cacNumber: "RC4471029", idDocumentName: "ifeoma-kalu-passport.jpg", idDocumentUrl: "assets/images/kyc-samples/id-document-sample.jpg", cacDocumentUrl: "assets/images/kyc-samples/cac-certificate-sample.jpg", cacDocumentName: "glow-cosmetics-cac.pdf", submittedAt: "2026-02-12T08:00:00Z", reviewedAt: "2026-02-13T09:00:00Z" } },
      { id: "v6", store: "Urban Fashion Lane", owner: "Zainab Musa", email: "zainab@urbanfashionlane.ng", phone: "+234 809 447 3392", address: "Ibrahim Taiwo Road, Kano, Nigeria", category: "Fashion", joined: "2026-05-01", lastLogin: "2026-05-09T10:10:00Z", description: "Streetwear and everyday fashion for young professionals.", products: 55, orders: 3, revenue: 42000, status: "pending", kyc: { status: "not_submitted", cacNumber: null, idDocumentName: null, cacDocumentName: null, submittedAt: null, reviewedAt: null } },
      { id: "v7", store: "GameHub Nigeria", owner: "Segun Alabi", email: "segun@gamehubng.ng", phone: "+234 812 663 5567", address: "Ring Road, Ibadan, Nigeria", category: "Gaming", joined: "2026-01-08", lastLogin: "2026-05-07T20:15:00Z", description: "Consoles, games, and gaming accessories.", products: 12, orders: 9, revenue: 156700, status: "active", kyc: { status: "verified", cacNumber: "RC5563218", idDocumentName: "segun-alabi-nin.jpg", idDocumentUrl: "assets/images/kyc-samples/id-document-sample.jpg", cacDocumentUrl: "assets/images/kyc-samples/cac-certificate-sample.jpg", cacDocumentName: "gamehub-cac.pdf", submittedAt: "2026-01-09T08:00:00Z", reviewedAt: "2026-01-10T09:00:00Z" } },
    ],
    // Sample order history — lets an admin actually see what a customer
    // bought or what a vendor shipped, not just the lifetime "Orders" /
    // "Total Spent" / "Revenue" counts on their stat cards (this is a
    // recent-orders sample, not the full history those larger counts
    // imply — a real backend's orders table would back both from the
    // same rows). Every customer/vendor pair here is deliberately never
    // a store owner ordering from their own store.
    orders: [
      { id: "o1", customerId: "c1", vendorId: "v5", item: "Vitamin C Serum Set", amount: 8500, status: "completed", carrier: "GIG Logistics", trackingNumber: "GIG-2948213NG", placedAt: "2026-05-06T10:24:00Z" },
      { id: "o2", customerId: "c1", vendorId: "v7", item: "Wireless Controller", amount: 24000, status: "shipped", carrier: "Speedaf", trackingNumber: "SPD-118820NG", placedAt: "2026-05-10T09:15:00Z" },
      { id: "o3", customerId: "c2", vendorId: "v4", item: "Wireless Mouse", amount: 11300, status: "out-for-delivery", carrier: "GIG Logistics", trackingNumber: "GIG-771029NG", placedAt: "2026-05-09T14:02:00Z" },
      { id: "o4", customerId: "c2", vendorId: "v1", item: "Oraimo Power Bank 25000mAh", amount: 17489, status: "completed", carrier: "GIG Logistics", trackingNumber: "GIG-660154NG", placedAt: "2026-04-28T11:40:00Z" },
      { id: "o5", customerId: "c2", vendorId: "v7", item: "Retro Console", amount: 45000, status: "out-for-delivery", carrier: "GIG Logistics", trackingNumber: "GIG-334521NG", placedAt: "2026-05-11T08:00:00Z" },
      { id: "o6", customerId: "c3", vendorId: "v3", item: "Non-stick Cookware Set", amount: 22000, status: "processing", carrier: null, trackingNumber: null, placedAt: "2026-05-11T16:20:00Z" },
      { id: "o7", customerId: "c3", vendorId: "v1", item: "Bluetooth Speaker", amount: 14900, status: "pending", carrier: null, trackingNumber: null, placedAt: "2026-05-12T09:05:00Z" },
      { id: "o8", customerId: "c4", vendorId: "v7", item: "PS5 Controller", amount: 38000, status: "completed", carrier: "Speedaf", trackingNumber: "SPD-402198NG", placedAt: "2026-04-20T12:30:00Z" },
      { id: "o9", customerId: "c5", vendorId: "v1", item: "USB-C Fast Charger", amount: 6200, status: "cancelled", carrier: null, trackingNumber: null, placedAt: "2026-05-01T17:10:00Z" },
      { id: "o10", customerId: "c5", vendorId: "v6", item: "Denim Jacket", amount: 14500, status: "pending", carrier: null, trackingNumber: null, placedAt: "2026-05-12T13:45:00Z" },
      { id: "o11", customerId: "c6", vendorId: "v2", item: "Shea Butter Body Cream", amount: 5200, status: "completed", carrier: "GIG Logistics", trackingNumber: "GIG-118843NG", placedAt: "2026-04-25T10:00:00Z" },
      { id: "o12", customerId: "c7", vendorId: "v5", item: "Face Cream Set", amount: 12900, status: "shipped", carrier: "Speedaf", trackingNumber: "SPD-882310NG", placedAt: "2026-05-10T15:30:00Z" },
      { id: "o13", customerId: "c8", vendorId: "v4", item: "Gaming Headset", amount: 19800, status: "completed", carrier: "GIG Logistics", trackingNumber: "GIG-227765NG", placedAt: "2026-04-22T08:50:00Z" },
    ],
    reports: [
      {
        id: "r1",
        type: "vendor",
        targetId: "v4",
        targetName: "TechZone Abuja",
        reporter: "Bola Sanni",
        reason: "Item received did not match the listing description — ordered a 20000mAh power bank, received a 5000mAh unit with no box.",
        date: "2026-05-02",
        status: "open",
        attendedBy: null,
        attendedAt: null,
      },
      {
        id: "r2",
        type: "customer",
        targetId: "c8",
        targetName: "Segun Alabi",
        reporter: "GameHub Nigeria",
        reason: "Buyer opened a chargeback after confirming delivery on camera; requesting review before refund is processed.",
        date: "2026-05-06",
        status: "open",
        attendedBy: null,
        attendedAt: null,
      },
      {
        id: "r3",
        type: "vendor",
        targetId: "v6",
        targetName: "Urban Fashion Lane",
        reporter: "Zainab Musa's customer",
        reason: "Listing photos appear to be taken from a competitor's store page.",
        date: "2026-05-09",
        status: "resolved",
        attendedBy: "Huddles Technologies",
        attendedAt: "2026-05-09T15:00:00Z",
      },
      {
        id: "r4",
        type: "product",
        targetId: "v2",
        targetName: "Chidera's Beauty Hub — 'Skin Whitening Cream'",
        reporter: "Platform auto-flag",
        reason: "Listing keywords match the restricted-ingredients filter and need manual review before staying live.",
        date: "2026-05-11",
        status: "dismissed",
        attendedBy: "Huddles Technologies",
        attendedAt: "2026-05-11T08:40:00Z",
      },
    ],
    activity: [
      { id: "a1", type: "account", message: "Suspended vendor <strong>TechZone Abuja</strong> pending review of a product-quality report.", time: "2026-05-11T09:20:00Z", targetType: "vendor", targetId: "v4", actorId: "t1", actorName: "Huddles Technologies" },
      { id: "a2", type: "vendor", message: "Approved new vendor application from <strong>Faster Gadgets Store</strong>.", time: "2026-05-10T14:05:00Z", targetType: "vendor", targetId: "v1", actorId: "t1", actorName: "Huddles Technologies" },
      { id: "a3", type: "report", message: "Dismissed report on <strong>Chidera's Beauty Hub</strong> listing — false positive on keyword filter.", time: "2026-05-11T08:40:00Z", targetType: "vendor", targetId: "v2", actorId: "t1", actorName: "Huddles Technologies" },
      { id: "a4", type: "order", message: "Order <strong>#VE-10432</strong> placed by <strong>Amaka Obi</strong> flagged for delayed delivery (3 days past estimate).", time: "2026-05-09T11:15:00Z", targetType: "customer", targetId: "c1", actorId: null, actorName: null },
      { id: "a5", type: "account", message: "Suspended customer <strong>Bola Sanni</strong> after repeated chargeback disputes.", time: "2026-05-08T16:32:00Z", targetType: "customer", targetId: "c4", actorId: "t1", actorName: "Huddles Technologies" },
      { id: "a6", type: "login", message: "Admin <strong>hudletech6@gmail.com</strong> signed in to the admin console.", time: "2026-05-11T07:58:00Z", targetType: null, targetId: null, actorId: "t1", actorName: "Huddles Technologies" },
      { id: "a7", type: "account", message: "Customer <strong>Ifeoma Kalu</strong> updated her delivery address.", time: "2026-05-07T12:10:00Z", targetType: "customer", targetId: "c5", actorId: null, actorName: null },
      { id: "a8", type: "vendor", message: "Vendor <strong>Glow Cosmetics NG</strong> added 3 new product listings.", time: "2026-05-06T15:30:00Z", targetType: "vendor", targetId: "v5", actorId: null, actorName: null },
      { id: "a9", type: "login", message: "Customer <strong>Segun Alabi</strong> signed in from a new device.", time: "2026-05-16T07:04:00Z", targetType: "customer", targetId: "c8", actorId: null, actorName: null },
      { id: "a10", type: "order", message: "Vendor <strong>TechZone Abuja</strong> fulfilled order <strong>#VE-10401</strong>.", time: "2026-05-01T10:00:00Z", targetType: "vendor", targetId: "v4", actorId: null, actorName: null },
    ],
    team: [
      { id: "t1", name: "Huddles Technologies", email: "hudletech6@gmail.com", role: "Super Admin", avatarDataUrl: null },
      { id: "t2", name: "Adaeze Umeh", email: "adaeze.umeh@vetra.ng", role: "Moderator", avatarDataUrl: null },
      { id: "t3", name: "Kelechi Eze", email: "kelechi.eze@vetra.ng", role: "Support", avatarDataUrl: null },
    ],
    pendingInvites: [],
    // Powers the site-wide banner carousel on both customer/dashboard.html
    // and customer/explore.html — see Settings > Site Banners. imageUrl is
    // either a relative path (the two seeded ones below) or a base64 data
    // URL for an admin-uploaded image (same convention as admin avatar
    // uploads). Order in this array is carousel order.
    siteBanners: [
      { id: "b1", imageUrl: "../assets/banners/banner-1.jpg", alt: "VETRA — welcome back" },
      { id: "b2", imageUrl: "../assets/banners/banner-2.jpg", alt: "VETRA — this week's picks" },
    ],
  };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Fill in fields added after some browsers may have already saved
        // an older shape of this state (e.g. before pendingInvites existed).
        if (!parsed.pendingInvites) parsed.pendingInvites = [];
        if (!parsed.currentAdminId) parsed.currentAdminId = "t1";
        if (!parsed.orders) parsed.orders = [];
        if (!parsed.siteBanners) parsed.siteBanners = clone(SEED.siteBanners);
        (parsed.vendors || []).forEach((v) => {
          if (!v.kyc) v.kyc = { status: "not_submitted", cacNumber: null, idDocumentName: null, cacDocumentName: null, submittedAt: null, reviewedAt: null };
        });
        return parsed;
      }
    } catch (e) {
      /* localStorage unavailable (private mode, etc.) — fall back to seed */
    }
    const seeded = clone(SEED);
    persist(seeded);
    return seeded;
  }

  function persist(nextState) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(nextState));
    } catch (e) {
      /* ignore write failures — state still works for this page view */
    }
  }

  let state = load();

  function save() {
    persist(state);
  }

  // ---------------- Current admin (simulated session) ----------------
  function getCurrentAdmin() {
    return state.team.find((m) => m.id === state.currentAdminId) || state.team[0] || null;
  }

  function setCurrentAdminByEmail(email) {
    const match = state.team.find((m) => m.email.toLowerCase() === String(email || "").toLowerCase());
    if (!match) return null;
    state.currentAdminId = match.id;
    save();
    return match;
  }

  function isSuperAdmin() {
    return getCurrentAdmin()?.role === "Super Admin";
  }

  // ---------------- Activity ----------------
  // `opts.systemEvent` skips attributing the entry to "whichever admin is
  // currently logged in" — needed for events with no admin actor at all,
  // like a buyer filing a report (see addReport() below). Without this,
  // a report filed from a customer's browser (where no admin has ever
  // signed in) would fall back to crediting the first seeded admin, which
  // is wrong — nobody on staff did anything yet.
  function logActivity(type, message, target, opts) {
    const actor = opts && opts.systemEvent ? null : getCurrentAdmin();
    state.activity.unshift({
      id: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type,
      message,
      time: new Date().toISOString(),
      targetType: target?.type || null,
      targetId: target?.id || null,
      actorId: actor ? actor.id : null,
      actorName: actor ? actor.name : null,
    });
    save();
  }

  function getActivity() {
    return state.activity;
  }

  function getActivityForTarget(type, id) {
    return state.activity.filter((a) => a.targetType === type && a.targetId === id);
  }

  /** Visibility rule: Super Admins see every admin's activity; everyone else
   *  sees only platform events (no actor) plus their own actions. This is
   *  enforced client-side only, same limitation as every other role check
   *  in this prototype — see DOCUMENTATION.md §9. */
  function getVisibleActivity() {
    const me = getCurrentAdmin();
    if (!me || me.role === "Super Admin") return state.activity;
    return state.activity.filter((a) => !a.actorId || a.actorId === me.id);
  }

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
  }

  function formatNaira(n) {
    return "₦" + Number(n || 0).toLocaleString("en-NG");
  }

  // Shared "Jan 1, 2026"-style date formatter — used by timeAgo() above once
  // something is more than 30 days old, by the customer/vendor detail pages
  // for joined/lastLogin, and by customers.js/reports.js for listed dates.
  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
  }

  // Pairs formatDate() with timeAgo() for a "10 May 2026 (3d ago)"-style
  // display — but skips the "(...)" part once timeAgo() itself has fallen
  // back to the same formatted date (>30 days old), which otherwise
  // rendered as a doubled date, e.g. "10 May 2026 (10 May 2026)". Used by
  // customer-detail.js/vendor-detail.js for "Last Login".
  function formatDateWithRelative(iso) {
    if (!iso) return "—";
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days >= 30) return formatDate(iso);
    return `${formatDate(iso)} (${timeAgo(iso)})`;
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  function generateTempPassword() {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let pwd = "";
    for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd;
  }

  function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  // ---------------- Customers ----------------
  function getCustomers() {
    return state.customers;
  }

  function getCustomer(id) {
    return state.customers.find((c) => c.id === id);
  }

  function setCustomerStatus(id, status, reason) {
    const c = getCustomer(id);
    if (!c) return;
    c.status = status;
    save();
    const verb = status === "suspended" ? "Suspended" : "Reactivated";
    logActivity(
      "account",
      `${verb} customer <strong>${c.name}</strong>${reason ? " — " + reason : ""}.`,
      { type: "customer", id }
    );
  }

  function resetCustomerPassword(id) {
    const c = getCustomer(id);
    if (!c) return null;
    const tempPassword = generateTempPassword();
    logActivity(
      "account",
      `Reset password for customer <strong>${c.name}</strong>. A temporary password was issued.`,
      { type: "customer", id }
    );
    return tempPassword;
  }

  // ---------------- Vendors ----------------
  function getVendors() {
    return state.vendors;
  }

  function getVendor(id) {
    return state.vendors.find((v) => v.id === id);
  }

  function setVendorStatus(id, status, reason) {
    const v = getVendor(id);
    if (!v) return;
    const prevStatus = v.status;
    v.status = status;
    save();
    let verb = "Updated";
    if (status === "suspended") verb = "Suspended";
    else if (status === "active" && prevStatus === "pending") verb = "Approved";
    else if (status === "active") verb = "Reactivated";
    else if (status === "rejected") verb = "Rejected";
    logActivity(
      "vendor",
      `${verb} vendor <strong>${v.store}</strong>${reason ? " — " + reason : ""}.`,
      { type: "vendor", id }
    );
  }

  // KYC review — a vendor's uploaded ID + CAC certificate/number (see
  // vendor/profile.html's Business Verification form, which is its own
  // page-local mock with no shared storage, so this seed data + these
  // functions are the "admin already reviewed it" half of the story, not
  // something the vendor-side submission actually writes to.
  function setVendorKycStatus(id, status, reason) {
    const v = getVendor(id);
    if (!v || !v.kyc) return;
    v.kyc.status = status;
    v.kyc.reviewedAt = new Date().toISOString();
    save();
    const verb = status === "verified" ? "Verified" : "Rejected";
    logActivity(
      "vendor",
      `${verb} KYC documents for <strong>${v.store}</strong>${reason ? " — " + reason : ""}.`,
      { type: "vendor", id }
    );
  }

  function resetVendorPassword(id) {
    const v = getVendor(id);
    if (!v) return null;
    const tempPassword = generateTempPassword();
    logActivity(
      "vendor",
      `Reset password for vendor <strong>${v.store}</strong> (owner: ${v.owner}). A temporary password was issued.`,
      { type: "vendor", id }
    );
    return tempPassword;
  }

  // ---------------- Orders ----------------
  // Read-only from the admin console's side — an admin can see what a
  // customer ordered or what a vendor shipped, but placing/updating an
  // order stays the customer/vendor apps' own job (customer/orders.html,
  // vendor/orders.html), same division as everywhere else in this file.
  function getOrders() {
    return state.orders;
  }

  function getOrdersForCustomer(customerId) {
    return state.orders.filter((o) => o.customerId === customerId);
  }

  function getOrdersForVendor(vendorId) {
    return state.orders.filter((o) => o.vendorId === vendorId);
  }

  // ---------------- Reports ----------------
  // The one function in this file meant to be called from OUTSIDE the
  // admin console — customer/assets/report-issue.js loads this module
  // directly (../admin/assets/data.js) so a buyer's filed report lands
  // in the same localStorage the admin console reads, instead of being
  // another disconnected mock. See DOCUMENTATION.md §8 for why this is a
  // deliberate exception to "customer/vendor pages never touch admin's
  // localStorage."
  function addReport({ type, targetId, targetName, reporter, reason }) {
    const report = {
      id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type,
      targetId,
      targetName,
      reporter,
      reason,
      date: new Date().toISOString().slice(0, 10),
      status: "open",
      attendedBy: null,
      attendedAt: null,
    };
    state.reports.unshift(report);
    save();
    logActivity(
      "report",
      `New report filed against <strong>${targetName}</strong> by ${reporter}.`,
      { type, id: targetId },
      { systemEvent: true }
    );
    return report;
  }

  function getReports() {
    return state.reports;
  }

  function getReport(id) {
    return state.reports.find((r) => r.id === id);
  }

  function setReportStatus(id, status) {
    const r = getReport(id);
    if (!r) return;
    r.status = status;
    const actor = getCurrentAdmin();
    r.attendedBy = actor ? actor.name : null;
    r.attendedAt = new Date().toISOString();
    save();
    logActivity(
      "report",
      `Report on <strong>${r.targetName}</strong> marked <strong>${status}</strong>.`,
      r.type === "customer" || r.type === "vendor" ? { type: r.type, id: r.targetId } : null
    );
  }

  function getReportsForTarget(type, id) {
    return state.reports.filter((r) => r.type === type && r.targetId === id);
  }

  // ---------------- Team ----------------
  function getTeam() {
    return state.team;
  }

  function getTeamMember(id) {
    return state.team.find((m) => m.id === id);
  }

  function setTeamMemberAvatar(id, dataUrl) {
    const member = getTeamMember(id);
    if (!member) return;
    member.avatarDataUrl = dataUrl;
    save();
  }

  function removeTeamMember(id) {
    const member = getTeamMember(id);
    if (!member) return { ok: false, error: "not-found" };

    const remainingSuperAdmins = state.team.filter(
      (m) => m.role === "Super Admin" && m.id !== id
    ).length;
    if (member.role === "Super Admin" && remainingSuperAdmins === 0) {
      return { ok: false, error: "last-super-admin" };
    }

    state.team = state.team.filter((m) => m.id !== id);
    save();
    logActivity("account", `Removed <strong>${member.name}</strong> from the admin team.`);
    return { ok: true };
  }

  // ---- Invite + email verification flow (no real mail server, so the
  // "email" is a verification code the inviting admin reads back to the
  // person they're adding — see admin/assets/settings.js) ----
  function getPendingInvites() {
    return state.pendingInvites;
  }

  function getPendingInvite(id) {
    return state.pendingInvites.find((i) => i.id === id);
  }

  function inviteTeamMember({ name, email, role }) {
    const invite = {
      id: "inv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      email,
      role: role || "Support",
      code: generateVerificationCode(),
      createdAt: new Date().toISOString(),
    };
    state.pendingInvites.push(invite);
    save();
    logActivity(
      "account",
      `Invited <strong>${invite.name}</strong> (${invite.email}) to join the admin team as <strong>${invite.role}</strong> — pending email verification.`
    );
    return invite;
  }

  function cancelInvite(inviteId) {
    const invite = getPendingInvite(inviteId);
    if (!invite) return { ok: false, error: "not-found" };
    state.pendingInvites = state.pendingInvites.filter((i) => i.id !== inviteId);
    save();
    logActivity("account", `Cancelled the pending admin invitation for <strong>${invite.email}</strong>.`);
    return { ok: true };
  }

  function verifyTeamInvite(inviteId, codeEntered) {
    const invite = getPendingInvite(inviteId);
    if (!invite) return { ok: false, error: "not-found" };
    // Simulated verification only — this prototype has no real mail server
    // to actually deliver a code, so any non-empty entry passes. Swap this
    // for a real code comparison once invites are sent by a real backend.
    if (!String(codeEntered).trim()) return { ok: false, error: "empty-code" };

    const member = {
      id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: invite.name,
      email: invite.email,
      role: invite.role,
      avatarDataUrl: null,
    };
    state.team.push(member);
    state.pendingInvites = state.pendingInvites.filter((i) => i.id !== inviteId);
    save();
    logActivity(
      "account",
      `Verified <strong>${member.email}</strong> and added <strong>${member.name}</strong> to the admin team as <strong>${member.role}</strong>.`
    );
    return { ok: true, member };
  }

  // ---------------- Site banners (customer/dashboard.html carousel) ----------------
  function getSiteBanners() {
    return state.siteBanners;
  }

  function addSiteBanner(imageUrl, alt) {
    const banner = {
      id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      imageUrl,
      alt: alt || "",
    };
    state.siteBanners.push(banner);
    save();
    logActivity("account", "Added a new image to the site-wide dashboard banner.");
    return banner;
  }

  function removeSiteBanner(id) {
    const before = state.siteBanners.length;
    state.siteBanners = state.siteBanners.filter((b) => b.id !== id);
    if (state.siteBanners.length === before) return { ok: false, error: "not-found" };
    save();
    logActivity("account", "Removed an image from the site-wide dashboard banner.");
    return { ok: true };
  }

  function moveSiteBanner(id, direction) {
    const banners = state.siteBanners;
    const index = banners.findIndex((b) => b.id === id);
    if (index === -1) return { ok: false, error: "not-found" };
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= banners.length) return { ok: false, error: "at-edge" };
    [banners[index], banners[swapWith]] = [banners[swapWith], banners[index]];
    save();
    return { ok: true };
  }

  // ---------------- Derived stats (dashboard) ----------------
  function getStats() {
    const customers = state.customers;
    const vendors = state.vendors;
    return {
      totalCustomers: customers.length,
      totalVendors: vendors.length,
      activeCustomers: customers.filter((c) => c.status === "active").length,
      suspendedCustomers: customers.filter((c) => c.status === "suspended").length,
      activeVendors: vendors.filter((v) => v.status === "active").length,
      pendingVendors: vendors.filter((v) => v.status === "pending").length,
      suspendedVendors: vendors.filter((v) => v.status === "suspended").length,
      totalOrders: vendors.reduce((sum, v) => sum + v.orders, 0),
      totalRevenue: vendors.reduce((sum, v) => sum + v.revenue, 0),
      openReports: state.reports.filter((r) => r.status === "open").length,
    };
  }

  function resetDemoData() {
    state = clone(SEED);
    save();
  }

  return {
    getCurrentAdmin,
    setCurrentAdminByEmail,
    isSuperAdmin,
    getCustomers,
    getCustomer,
    setCustomerStatus,
    resetCustomerPassword,
    getVendors,
    getVendor,
    setVendorStatus,
    setVendorKycStatus,
    resetVendorPassword,
    getOrders,
    getOrdersForCustomer,
    getOrdersForVendor,
    addReport,
    getReports,
    getReport,
    setReportStatus,
    getReportsForTarget,
    getActivity,
    getVisibleActivity,
    getActivityForTarget,
    getTeam,
    getTeamMember,
    setTeamMemberAvatar,
    removeTeamMember,
    getPendingInvites,
    getPendingInvite,
    inviteTeamMember,
    cancelInvite,
    verifyTeamInvite,
    getStats,
    getSiteBanners,
    addSiteBanner,
    removeSiteBanner,
    moveSiteBanner,
    logActivity,
    resetDemoData,
    timeAgo,
    formatNaira,
    formatDate,
    formatDateWithRelative,
    initials,
  };
})();
