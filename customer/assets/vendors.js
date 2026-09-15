/* =========================================================
   VETRA — SHARED VENDOR DIRECTORY (customer app)
   Extracted from store.html's own inline VENDORS object (previously
   defined only there) so a second page — vendors.html — can list every
   vendor without duplicating this data a third time. This is still the
   same, separate vendor list documented in DOCUMENTATION.md §8 as never
   having been unified with admin/assets/data.js's own vendor records —
   extracting it to a shared file doesn't change that, it just stops
   customer-app pages from disagreeing with each other about it.
   ========================================================= */

const VENDORS = {
  'gods-favour': {
    name: 'Godsfavour Laptops',
    avatar: 'imgs/vendor-1.jpg',
    cover: 'assets/images/cat-computing.jpg',
    category: 'Electronics & Laptops',
    status: 'verified',
    rating: '4.8',
    orders: '312',
    responseTime: '~10 min',
    location: 'Computer Village, Ikeja, Lagos',
    memberSince: 'Mar 2026',
    bio: 'Trusted reseller of new and UK-used laptops, with a warranty on every unit and same-week delivery across Lagos.',
    products: [
      { id: 'gaming-laptop', name: 'Gaming Laptop', price: '₦285,000', image: 'assets/images/product-5.jpg' },
      { id: 'gods-favour-wireless-mouse', name: 'Wireless Mouse', price: '₦11,300', image: 'assets/images/store/mouse.jpg' },
      { id: 'gods-favour-laptop-backpack', name: 'Laptop Backpack', price: '₦18,500', image: 'assets/images/store/laptop-bag.jpg' }
    ],
    reviews: [
      { name: 'Tunde A.', rating: 5, date: '2026-05-02', text: 'Laptop arrived exactly as described, and delivery was faster than the estimate. Would buy again.' },
      { name: 'Chidera N.', rating: 5, date: '2026-04-20', text: 'Great communication throughout and the warranty paperwork was included in the box.' },
      { name: 'Kelechi U.', rating: 4, date: '2026-03-14', text: 'Solid laptop for the price. Minor scuff on the lid that wasn’t in the photos, otherwise happy.' }
    ]
  },
  'daniel-ice-fish': {
    name: 'Daniel Ice Fish',
    avatar: 'imgs/vendor-2.jpg',
    cover: null,
    coverGradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    category: 'Fresh & Frozen Seafood',
    status: 'verified',
    rating: '4.6',
    orders: '540',
    responseTime: '~30 min',
    location: 'Mile 12 Market, Lagos',
    memberSince: 'Jan 2022',
    bio: 'Daily fresh catch and frozen seafood, sourced every morning and delivered same-day across the city.',
    products: [
      { id: 'daniel-fresh-catfish', name: 'Fresh Catfish (kg)', price: '₦4,200', image: 'assets/images/store/catfish.jpg' },
      { id: 'daniel-jumbo-prawns', name: 'Jumbo Prawns (kg)', price: '₦8,900', image: 'assets/images/store/prawns.jpg' },
      { id: 'daniel-dried-crayfish', name: 'Dried Crayfish (kg)', price: '₦6,500', image: 'assets/images/store/crayfish.jpg' }
    ],
    reviews: [
      { name: 'Amaka O.', rating: 5, date: '2026-05-10', text: 'Fish was properly fresh, not frozen-then-thawed like some other sellers. Fast Mile 12 pickup too.' },
      { name: 'Ifeoma K.', rating: 4, date: '2026-04-30', text: 'Good quality prawns, slightly smaller than expected but still worth it.' }
    ]
  },
  'jennet-jeans': {
    name: 'Jennet Jeans',
    avatar: 'imgs/vendor-3.jpg',
    cover: 'assets/images/cat-fashion.jpg',
    category: 'Fashion & Denim',
    status: 'pending',
    rating: '4.5',
    orders: '87',
    responseTime: '~1 hr',
    location: 'Balogun Market, Lagos Island',
    memberSince: 'Aug 2026',
    bio: 'Quality denim and casual wear at wholesale-friendly prices, with new stock arriving every week.',
    products: [
      { id: 'jennet-denim-jacket', name: 'Denim Jacket', price: '₦14,500', image: 'assets/images/store/denim-jacket.jpg' },
      { id: 'jennet-classic-jeans', name: 'Classic Jeans', price: '₦9,800', image: 'assets/images/store/jeans.jpg' },
      { id: 'jennet-denim-skirt', name: 'Denim Skirt', price: '₦7,200', image: 'assets/images/store/denim-skirt.jpg' }
    ],
    reviews: [
      { name: 'Bola S.', rating: 4, date: '2026-05-11', text: 'Denim quality is better than the price suggests. Sizing ran slightly small.' },
      { name: 'Zainab M.', rating: 5, date: '2026-04-18', text: 'New stock every week just like advertised, love that I can always find something different.' }
    ]
  },
  'me-n-u-chops': {
    name: 'Me n U Chops',
    avatar: 'imgs/vendor-4.jpg',
    cover: null,
    coverGradient: 'linear-gradient(135deg, #10b981, #3f5fe0)',
    category: 'Local Food & Grills',
    status: 'pending',
    rating: '4.9',
    orders: '203',
    responseTime: '~15 min',
    location: 'Yaba, Lagos',
    memberSince: 'Jun 2026',
    bio: 'Home-style Nigerian meals and grills, made fresh to order for pickup or delivery.',
    products: [
      { id: 'chops-suya-skewers', name: 'Suya Skewers', price: '₦1,500', image: 'imgs/vendor-4.jpg' },
      { id: 'chops-jollof-rice', name: 'Jollof Rice & Chicken', price: '₦2,800', image: 'assets/images/store/jollof-rice.jpg' },
      { id: 'chops-grilled-chicken', name: 'Grilled Chicken Plate', price: '₦3,500', image: 'assets/images/store/grilled-chicken.jpg' }
    ],
    reviews: [
      { name: 'Segun A.', rating: 5, date: '2026-05-09', text: 'Tastes homemade, arrived hot, and the portion size is generous.' },
      { name: 'Grace E.', rating: 5, date: '2026-04-25', text: 'My go-to for lunch orders now. Never disappoints.' },
      { name: 'Femi O.', rating: 4, date: '2026-04-02', text: 'Really good jollof, delivery took a bit longer than the estimate though.' }
    ]
  }
};

function getVendor(id) {
  return VENDORS[id] || null;
}

function getAllVendors() {
  return Object.keys(VENDORS).map((id) => ({ id, ...VENDORS[id] }));
}
