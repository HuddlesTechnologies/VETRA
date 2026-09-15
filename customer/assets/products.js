/* =========================================================
   VETRA — SHARED PRODUCT CATALOG (customer app)
   Every product shown on dashboard.html, explore.html, and
   store.html now resolves to one entry here,
   keyed by a stable `id`. This is what makes three things
   possible that weren't before:
     1. product.html?id=<id> — a real product detail page with
        a description and reviews, since there's now a single
        place to look a product up by id instead of only ever
        having its name/price printed into a card's markup.
     2. A real cart (assets/cart-store.js) that stores {id, qty}
        pairs and re-looks-up name/price/image from here to
        render — instead of a cart item being whatever text
        happened to be sitting in the DOM.
     3. "Gaming Laptop" being the literal same product whether
        you see it in the dashboard's featured grid or on
        Godsfavour Laptops' store page (vendorId: 'gods-favour'),
        rather than two disconnected listings that happen to
        share a name.

   Still a static, hard-coded object — there's no backend, so this
   plays the same role customer/store.html's own VENDORS object
   already played for that one page, just shared across four.
   ========================================================= */

const PRODUCTS = {
  "oraimo-power-bank": {
    id: "oraimo-power-bank",
    name: "Oraimo Power Bank 25000mAh",
    price: 17489,
    image: "assets/images/product-1.jpg",
    category: "Electronics",
    location: "Asokoro, Abuja",
    vendorId: null,
    createdAt: "2026-06-10",
    salesCount: 85,
    description: "A 25000mAh fast-charging power bank with dual USB-A and one USB-C output — enough to charge a phone 4-5 times over. Includes a braided charging cable and a soft carry pouch.",
    reviews: [
      { name: "Tunde A.", rating: 5, date: "2026-05-03", text: "Charges my phone fast and still has juice left the next day. Solid buy." },
      { name: "Chidera N.", rating: 4, date: "2026-04-21", text: "Good capacity, a bit heavier than I expected but works exactly as described." },
    ],
  },
  "smart-led-tv": {
    id: "smart-led-tv",
    name: 'Smart LED TV 43"',
    price: 174500,
    image: "assets/images/product-2.jpg",
    category: "Electronics",
    location: "Ikeja, Lagos",
    vendorId: null,
    createdAt: "2026-09-05",
    salesCount: 12,
    description: "A 43-inch Full HD smart LED TV with built-in WiFi, three HDMI ports, and pre-loaded streaming apps. Wall-mount bracket sold separately.",
    reviews: [
      { name: "Bola S.", rating: 5, date: "2026-04-30", text: "Picture quality is great for the price and setup took less than 10 minutes." },
    ],
  },
  "noise-cancelling-headphones": {
    id: "noise-cancelling-headphones",
    name: "Noise Cancelling Headphones",
    price: 28900,
    image: "assets/images/product-3.jpg",
    category: "Electronics",
    location: "Victoria Island, Lagos",
    vendorId: null,
    createdAt: "2026-04-01",
    salesCount: 20,
    description: "Over-ear Bluetooth headphones with active noise cancellation, 30-hour battery life, and a foldable design for travel.",
    reviews: [
      { name: "Ifeoma K.", rating: 4, date: "2026-05-08", text: "Noise cancelling actually works well on the road. Ear cups could be softer though." },
    ],
  },
  "air-fryer-xl": {
    id: "air-fryer-xl",
    name: "Air Fryer XL",
    price: 42300,
    image: "assets/images/product-4.jpg",
    category: "Home & Office",
    location: "Gwarinpa, Abuja",
    vendorId: null,
    createdAt: "2026-03-15",
    salesCount: 18,
    description: "A 7-liter digital air fryer with 8 preset cooking modes and a non-stick, dishwasher-safe basket — enough capacity to cook for a family.",
    reviews: [],
  },
  "gaming-laptop": {
    id: "gaming-laptop",
    name: "Gaming Laptop",
    price: 285000,
    image: "assets/images/product-5.jpg",
    category: "Electronics",
    location: "Lekki, Lagos",
    vendorId: "gods-favour",
    createdAt: "2026-09-08",
    salesCount: 30,
    description: "A 15.6-inch gaming laptop with a dedicated graphics card, 16GB RAM, and a 512GB SSD — smooth for both everyday use and modern games.",
    reviews: [
      { name: "Segun A.", rating: 5, date: "2026-05-01", text: "Runs everything I throw at it without heating up too much. Great value." },
      { name: "Kelechi U.", rating: 4, date: "2026-04-15", text: "Solid laptop for the price, battery life is average under heavy load." },
    ],
  },
  "fitness-tracker-band": {
    id: "fitness-tracker-band",
    name: "Fitness Tracker Band",
    price: 9700,
    image: "assets/images/product-6.jpg",
    category: "Sports",
    location: "Yaba, Lagos",
    vendorId: null,
    createdAt: "2026-02-20",
    salesCount: 15,
    description: "A waterproof fitness band with heart-rate monitoring, step counting, and sleep tracking — syncs to a companion app over Bluetooth.",
    reviews: [],
  },

  "premium-laptop-stand": {
    id: "premium-laptop-stand",
    name: "Premium Laptop Stand",
    price: 17489,
    image: "assets/images/laptop-stand.jpg",
    category: "Computing",
    location: null,
    vendorId: null,
    createdAt: "2026-05-01",
    salesCount: 60,
    description: "An adjustable aluminum laptop stand that raises your screen to eye level and improves airflow underneath — folds flat for travel.",
    reviews: [],
  },
  "wireless-headset": {
    id: "wireless-headset",
    name: "Wireless Headset",
    price: 24999,
    image: "assets/images/product-3.jpg",
    category: "Electronics",
    location: null,
    vendorId: null,
    createdAt: "2026-05-10",
    salesCount: 22,
    description: "A lightweight wireless headset with a detachable boom mic — built for long calls and gaming sessions alike.",
    reviews: [],
  },
  "usb-c-cable": {
    id: "usb-c-cable",
    name: "USB-C Cable",
    price: 3500,
    image: "assets/images/usb-c-cable.jpg",
    category: "Computing",
    location: null,
    vendorId: null,
    createdAt: "2026-01-10",
    salesCount: 95,
    description: "A 1.5m braided USB-C cable rated for fast charging and full-speed data transfer.",
    reviews: [],
  },
  "phone-stand": {
    id: "phone-stand",
    name: "Phone Stand",
    price: 5999,
    image: "assets/images/phone-stand.jpg",
    category: "Phones & Tablets",
    location: null,
    vendorId: null,
    createdAt: "2026-06-01",
    salesCount: 18,
    description: "A foldable, adjustable-angle phone stand for your desk — works with or without a case on.",
    reviews: [],
  },
  "power-bank": {
    id: "power-bank",
    name: "Power Bank",
    price: 12999,
    image: "assets/images/product-1.jpg",
    category: "Electronics",
    location: null,
    vendorId: null,
    createdAt: "2026-04-20",
    salesCount: 70,
    description: "A compact 10000mAh power bank that fits easily in a pocket, with a single USB-A output and LED charge indicator.",
    reviews: [],
  },
  "screen-protector": {
    id: "screen-protector",
    name: "Screen Protector",
    price: 2499,
    image: "assets/images/screen-protector.jpg",
    category: "Phones & Tablets",
    location: null,
    vendorId: null,
    createdAt: "2026-01-15",
    salesCount: 110,
    description: "A tempered-glass screen protector with an edge-to-edge fit and an installation kit included.",
    reviews: [],
  },

  "gods-favour-wireless-mouse": {
    id: "gods-favour-wireless-mouse",
    name: "Wireless Mouse",
    price: 11300,
    image: "assets/images/store/mouse.jpg",
    category: "Computing",
    location: null,
    vendorId: "gods-favour",
    createdAt: "2026-07-01",
    salesCount: 25,
    description: "An ergonomic wireless mouse with a silent click switch and up to 12 months of battery life on two AA batteries.",
    reviews: [],
  },
  "gods-favour-laptop-backpack": {
    id: "gods-favour-laptop-backpack",
    name: "Laptop Backpack",
    price: 18500,
    image: "assets/images/store/laptop-bag.jpg",
    category: "Computing",
    location: null,
    vendorId: "gods-favour",
    createdAt: "2026-09-10",
    salesCount: 10,
    description: "A padded, water-resistant laptop backpack that fits up to a 15.6-inch laptop, with a separate compartment for accessories.",
    reviews: [],
  },
  "daniel-fresh-catfish": {
    id: "daniel-fresh-catfish",
    name: "Fresh Catfish (kg)",
    price: 4200,
    image: "assets/images/store/catfish.jpg",
    category: "Seafood",
    location: null,
    vendorId: "daniel-ice-fish",
    createdAt: "2026-08-01",
    salesCount: 35,
    description: "Fresh catfish, caught and sold same-day — priced per kilogram, cleaned on request.",
    reviews: [],
  },
  "daniel-jumbo-prawns": {
    id: "daniel-jumbo-prawns",
    name: "Jumbo Prawns (kg)",
    price: 8900,
    image: "assets/images/store/prawns.jpg",
    category: "Seafood",
    location: null,
    vendorId: "daniel-ice-fish",
    createdAt: "2026-07-15",
    salesCount: 45,
    description: "Jumbo-sized prawns, sold per kilogram, kept frozen until dispatch to preserve freshness.",
    reviews: [],
  },
  "daniel-dried-crayfish": {
    id: "daniel-dried-crayfish",
    name: "Dried Crayfish (kg)",
    price: 6500,
    image: "assets/images/store/crayfish.jpg",
    category: "Seafood",
    location: null,
    vendorId: "daniel-ice-fish",
    createdAt: "2026-06-20",
    salesCount: 20,
    description: "Sun-dried crayfish, sold per kilogram — a pantry staple for soups and stews.",
    reviews: [],
  },
  "jennet-denim-jacket": {
    id: "jennet-denim-jacket",
    name: "Denim Jacket",
    price: 14500,
    image: "assets/images/store/denim-jacket.jpg",
    category: "Fashion",
    location: null,
    vendorId: "jennet-jeans",
    createdAt: "2026-09-12",
    salesCount: 8,
    description: "A classic-fit denim jacket in mid-wash blue, available in sizes S-XL.",
    reviews: [],
  },
  "jennet-classic-jeans": {
    id: "jennet-classic-jeans",
    name: "Classic Jeans",
    price: 9800,
    image: "assets/images/store/jeans.jpg",
    category: "Fashion",
    location: null,
    vendorId: "jennet-jeans",
    createdAt: "2026-03-01",
    salesCount: 55,
    description: "Straight-fit denim jeans in a durable, everyday-wear fabric.",
    reviews: [],
  },
  "jennet-denim-skirt": {
    id: "jennet-denim-skirt",
    name: "Denim Skirt",
    price: 7200,
    image: "assets/images/store/denim-skirt.jpg",
    category: "Fashion",
    location: null,
    vendorId: "jennet-jeans",
    createdAt: "2026-05-15",
    salesCount: 15,
    description: "A knee-length denim skirt with a button-front closure.",
    reviews: [],
  },
  "chops-suya-skewers": {
    id: "chops-suya-skewers",
    name: "Suya Skewers",
    price: 1500,
    image: "imgs/vendor-4.jpg",
    category: "Local Food",
    location: null,
    vendorId: "me-n-u-chops",
    createdAt: "2026-02-01",
    salesCount: 130,
    description: "Grilled beef suya skewers, seasoned with traditional yaji spice — sold per portion.",
    reviews: [],
  },
  "chops-jollof-rice": {
    id: "chops-jollof-rice",
    name: "Jollof Rice & Chicken",
    price: 2800,
    image: "assets/images/store/jollof-rice.jpg",
    category: "Local Food",
    location: null,
    vendorId: "me-n-u-chops",
    createdAt: "2026-01-20",
    salesCount: 90,
    description: "A full plate of smoky party-style jollof rice with grilled chicken.",
    reviews: [],
  },
  "chops-grilled-chicken": {
    id: "chops-grilled-chicken",
    name: "Grilled Chicken Plate",
    price: 3500,
    image: "assets/images/store/grilled-chicken.jpg",
    category: "Local Food",
    location: null,
    vendorId: "me-n-u-chops",
    createdAt: "2026-08-25",
    salesCount: 33,
    description: "A grilled chicken plate served with a side of coleslaw and plantain.",
    reviews: [],
  },
};

// Vendor display names, kept in one place so product.html doesn't need to
// duplicate customer/store.html's own VENDORS object just to print a
// "Sold by" name — this is intentionally a small, separate lookup, not a
// merge of the two catalogs (see DOCUMENTATION.md §8 on the two vendor
// lists not being unified).
const PRODUCT_VENDOR_NAMES = {
  "gods-favour": "Godsfavour Laptops",
  "daniel-ice-fish": "Daniel Ice Fish",
  "jennet-jeans": "Jennet Jeans",
  "me-n-u-chops": "Me n U Chops",
};

function getProduct(id) {
  return PRODUCTS[id] || null;
}

function getAllProducts() {
  return Object.values(PRODUCTS);
}

/* =========================================================
   PRODUCT BADGES ("New" / "Hot")
   Real logic, not decoration: every product's `createdAt` and
   `salesCount` above drives this. A card shows at most one badge —
   "New" takes priority over "Hot" if a product happens to qualify
   for both (a brand-new product that's already selling well still
   reads as "New" first).

   For a real backend: `createdAt` is just the product's row-creation
   timestamp and `salesCount` is `COUNT(order_items)` (or SUM of
   quantity) for that product across completed orders — see
   BACKEND_GUIDE.md's "Product badges" note for the exact query this
   should become. Nothing here needs to change when that swap
   happens; only where `createdAt`/`salesCount` come from does.
   ========================================================= */
const BADGE_NEW_WINDOW_DAYS = 21;
const BADGE_HOT_SALES_THRESHOLD = 50;

function getProductBadge(product) {
  if (!product) return null;

  if (product.createdAt) {
    const ageMs = Date.now() - new Date(product.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays >= 0 && ageDays <= BADGE_NEW_WINDOW_DAYS) {
      return { type: "new", label: "New" };
    }
  }

  if (typeof product.salesCount === "number" && product.salesCount >= BADGE_HOT_SALES_THRESHOLD) {
    return { type: "hot", label: "Hot" };
  }

  return null;
}
