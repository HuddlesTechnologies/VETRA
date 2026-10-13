/* =========================================================
   VETRA: category illustrations.
   One flat illustration per store category (same list as
   explore.html's filters and vendor/products.html's dropdown), drawn
   as inline SVG so they stay crisp at any size, cost no extra
   requests, and share one palette and style. Each is a 96x80 tile:
   a soft two-tone background, a ground shadow, and the object.

   VetraCategoryArt.svg(name) returns the markup; an unknown name gets
   the "Other" illustration.
   ========================================================= */

const VetraCategoryArt = (() => {
  const CATEGORIES = [
    "Electronics", "Phones & Tablets", "Computing", "Gaming", "Appliances",
    "Home & Office", "Fashion", "Health & Beauty", "Food", "Sports",
    "Books & Stationery", "Baby & Kids", "Automotive & Tools", "Livestock", "Other",
  ];

  const shadow = (w = 30) => `<ellipse cx="48" cy="70" rx="${w}" ry="4" fill="#0b1b3a" opacity=".12"/>`;

  const ART = {
    Electronics: {
      bg: ["#e0ecff", "#c7dbff"],
      body: `${shadow(26)}
        <path d="M27 44a21 21 0 0 1 42 0" fill="none" stroke="#24304a" stroke-width="5" stroke-linecap="round"/>
        <rect x="20" y="40" width="14" height="22" rx="6" fill="#3b6cf6"/>
        <rect x="62" y="40" width="14" height="22" rx="6" fill="#3b6cf6"/>
        <rect x="24" y="44" width="6" height="14" rx="3" fill="#8fb0ff"/>
        <rect x="66" y="44" width="6" height="14" rx="3" fill="#8fb0ff"/>
        <circle cx="48" cy="58" r="3" fill="#24304a"/>`,
    },
    "Phones & Tablets": {
      bg: ["#e6e3ff", "#cfc8ff"],
      body: `${shadow(28)}
        <rect x="22" y="16" width="40" height="52" rx="6" fill="#2b2d42"/>
        <rect x="26" y="21" width="32" height="42" rx="3" fill="#7c6cf2"/>
        <rect x="26" y="21" width="32" height="14" rx="3" fill="#a69bff"/>
        <rect x="52" y="30" width="22" height="40" rx="5" fill="#1d1f33"/>
        <rect x="55" y="34" width="16" height="30" rx="2" fill="#5ad1c4"/>
        <circle cx="63" cy="66.5" r="1.5" fill="#8a8fb3"/>
        <rect x="58" y="38" width="10" height="3" rx="1.5" fill="#fff" opacity=".7"/>`,
    },
    Computing: {
      bg: ["#dff4ff", "#bfe6fb"],
      body: `${shadow(34)}
        <rect x="24" y="20" width="48" height="34" rx="4" fill="#2a3346"/>
        <rect x="28" y="24" width="40" height="26" rx="2" fill="#3fa9f5"/>
        <path d="M28 24h40v10H28z" fill="#79c6ff"/>
        <path d="M16 56h64l-4 8H20z" fill="#9aa7bd"/>
        <rect x="42" y="56" width="12" height="2.5" rx="1.25" fill="#6b778d"/>
        <rect x="33" y="38" width="16" height="3" rx="1.5" fill="#fff" opacity=".8"/>
        <rect x="33" y="43" width="24" height="3" rx="1.5" fill="#fff" opacity=".5"/>`,
    },
    Gaming: {
      bg: ["#ffe4ef", "#ffc9dd"],
      body: `${shadow(30)}
        <path d="M30 30h36c8 0 12 6 13 14l2 12c1 6-5 9-9 5l-7-7H31l-7 7c-4 4-10 1-9-5l2-12c1-8 5-14 13-14z" fill="#2c2440"/>
        <rect x="26" y="40" width="12" height="4" rx="2" fill="#ff5c93"/>
        <rect x="30" y="36" width="4" height="12" rx="2" fill="#ff5c93"/>
        <circle cx="62" cy="38" r="3" fill="#ffd166"/>
        <circle cx="69" cy="43" r="3" fill="#5ad1c4"/>
        <circle cx="55" cy="43" r="3" fill="#7c6cf2"/>
        <circle cx="62" cy="48" r="3" fill="#ff5c93"/>
        <rect x="44" y="36" width="8" height="3" rx="1.5" fill="#6d6488"/>`,
    },
    Appliances: {
      bg: ["#e2f7f1", "#c3ecdf"],
      body: `${shadow(22)}
        <rect x="28" y="12" width="40" height="56" rx="5" fill="#f7fafc"/>
        <rect x="28" y="12" width="40" height="56" rx="5" fill="none" stroke="#c9d6df" stroke-width="2"/>
        <rect x="28" y="12" width="40" height="11" rx="5" fill="#d9e4ea"/>
        <circle cx="35" cy="17.5" r="2" fill="#2bb39a"/>
        <rect x="52" y="16" width="12" height="3" rx="1.5" fill="#9fb2bf"/>
        <circle cx="48" cy="45" r="15" fill="#5f7280"/>
        <circle cx="48" cy="45" r="11" fill="#8fe0d0"/>
        <path d="M37.5 47c4-4 7 2 11-1s7-2 10 0v1a11 11 0 0 1-21 0z" fill="#2bb39a"/>
        <circle cx="43" cy="40" r="2.5" fill="#fff" opacity=".7"/>`,
    },
    "Home & Office": {
      bg: ["#fff1dc", "#ffe0b5"],
      body: `${shadow(32)}
        <rect x="18" y="52" width="60" height="5" rx="2" fill="#a0673a"/>
        <rect x="22" y="57" width="4" height="12" fill="#8a5630"/>
        <rect x="70" y="57" width="4" height="12" fill="#8a5630"/>
        <path d="M30 52l-2-14h14l-2 14z" fill="#e46f4b"/>
        <path d="M35 38c-6-8-2-16 0-18 1 6 4 10 0 18zM35 38c2-9 9-12 12-12-2 6-6 10-12 12zM35 38c-5-4-10-4-13-3 4 4 8 5 13 3z" fill="#3e9a5d"/>
        <path d="M66 52v-18" stroke="#2f3b4c" stroke-width="3" stroke-linecap="round"/>
        <path d="M66 34l-10-12" stroke="#2f3b4c" stroke-width="3" stroke-linecap="round"/>
        <path d="M50 22l12-6 4 10-12 6z" fill="#ffb627"/>
        <rect x="60" y="50" width="12" height="3" rx="1.5" fill="#2f3b4c"/>`,
    },
    Fashion: {
      bg: ["#ffe7e0", "#ffcdbf"],
      body: `${shadow(30)}
        <path d="M48 12l-4 6h8z" fill="none" stroke="#5b4636" stroke-width="2"/>
        <path d="M30 22l12-4c2 4 10 4 12 0l12 4 8 14-9 5-4-6v32H35V37l-4 6-9-5z" fill="#f2545b"/>
        <path d="M42 18c2 4 10 4 12 0" fill="none" stroke="#c63c43" stroke-width="2"/>
        <path d="M35 46h26" stroke="#ffd2d4" stroke-width="3"/>
        <rect x="58" y="48" width="20" height="18" rx="3" fill="#ffb627"/>
        <path d="M62 48v-3a6 6 0 0 1 12 0v3" fill="none" stroke="#a5671b" stroke-width="2.5"/>
        <rect x="58" y="53" width="20" height="3" fill="#e89a1a"/>`,
    },
    "Health & Beauty": {
      bg: ["#fde4f3", "#f8c7e4"],
      body: `${shadow(26)}
        <rect x="26" y="40" width="12" height="26" rx="2" fill="#2d2a3e"/>
        <rect x="27" y="30" width="10" height="12" rx="1" fill="#d4a24c"/>
        <path d="M28 30v-8c0-3 4-6 8-8v16z" fill="#e0336f"/>
        <rect x="44" y="28" width="22" height="38" rx="8" fill="#ffffff"/>
        <rect x="44" y="28" width="22" height="38" rx="8" fill="none" stroke="#efb6d3" stroke-width="2"/>
        <rect x="49" y="20" width="12" height="9" rx="2" fill="#b56bd6"/>
        <rect x="48" y="40" width="14" height="12" rx="3" fill="#f6a6c9"/>
        <path d="M70 28l2-5 2 5 5 2-5 2-2 5-2-5-5-2z" fill="#ffd166"/>`,
    },
    Food: {
      bg: ["#fff3d6", "#ffe2a3"],
      body: `${shadow(32)}
        <path d="M38 22c-3-4 3-6 0-10M48 22c-3-4 3-6 0-10M58 22c-3-4 3-6 0-10" fill="none" stroke="#e3a35a" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M20 40h56a28 28 0 0 1-56 0z" fill="#ffffff"/>
        <path d="M20 40h56a28 28 0 0 1-56 0z" fill="none" stroke="#f0d4a8" stroke-width="2"/>
        <path d="M24 40c2-9 11-13 24-13s22 4 24 13z" fill="#e8562a"/>
        <circle cx="36" cy="34" r="2" fill="#ffb627"/>
        <circle cx="46" cy="31" r="2" fill="#ffb627"/>
        <circle cx="58" cy="33" r="2" fill="#ffb627"/>
        <path d="M54 30c4-3 9-2 10 2-4 1-8 1-10-2z" fill="#3e9a5d"/>
        <circle cx="40" cy="37" r="3" fill="#8b3a1e"/>
        <circle cx="62" cy="37" r="3" fill="#8b3a1e"/>`,
    },
    Sports: {
      bg: ["#e3f6dc", "#c6ebb8"],
      body: `${shadow(28)}
        <circle cx="40" cy="42" r="22" fill="#ffffff"/>
        <circle cx="40" cy="42" r="22" fill="none" stroke="#2d3a2e" stroke-width="2"/>
        <path d="M40 33l8 6-3 9h-10l-3-9z" fill="#2d3a2e"/>
        <path d="M40 33v-11M48 39l10-4M45 48l6 9M35 48l-6 9M32 39l-10-4" stroke="#2d3a2e" stroke-width="2"/>
        <path d="M56 58c0-4 3-6 6-6l6-4 6 2 4 8v6H56z" fill="#3e8bf5"/>
        <path d="M56 64h22v3H56z" fill="#e9eef5"/>
        <path d="M64 52l2 4M68 50l2 4" stroke="#fff" stroke-width="1.5"/>`,
    },
    "Books & Stationery": {
      bg: ["#e5ecff", "#cbd8ff"],
      body: `${shadow(30)}
        <rect x="20" y="54" width="44" height="10" rx="2" fill="#f2545b"/>
        <rect x="20" y="54" width="6" height="10" fill="#c63c43"/>
        <rect x="24" y="44" width="40" height="10" rx="2" fill="#3b6cf6"/>
        <rect x="24" y="44" width="6" height="10" fill="#2950c4"/>
        <rect x="22" y="34" width="38" height="10" rx="2" fill="#ffb627"/>
        <rect x="22" y="34" width="6" height="10" fill="#d99515"/>
        <rect x="36" y="38" width="16" height="2" rx="1" fill="#fff" opacity=".7"/>
        <path d="M70 20l6 3-10 40-4 3-1-5z" fill="#ffd166"/>
        <path d="M66 63l-4 3-1-5z" fill="#2d2a3e"/>
        <path d="M70 20l6 3-1 4-6-3z" fill="#f2545b"/>`,
    },
    "Baby & Kids": {
      bg: ["#e0f4ff", "#ffe3ef"],
      body: `${shadow(28)}
        <circle cx="30" cy="26" r="7" fill="#c98b52"/>
        <circle cx="58" cy="26" r="7" fill="#c98b52"/>
        <circle cx="30" cy="26" r="3.5" fill="#f1c29a"/>
        <circle cx="58" cy="26" r="3.5" fill="#f1c29a"/>
        <circle cx="44" cy="42" r="18" fill="#d9a066"/>
        <ellipse cx="44" cy="48" rx="9" ry="7" fill="#f1c29a"/>
        <circle cx="37" cy="38" r="2.2" fill="#2d2a3e"/>
        <circle cx="51" cy="38" r="2.2" fill="#2d2a3e"/>
        <ellipse cx="44" cy="45" rx="3" ry="2.2" fill="#2d2a3e"/>
        <path d="M41 50c2 2 4 2 6 0" fill="none" stroke="#2d2a3e" stroke-width="1.5" stroke-linecap="round"/>
        <rect x="66" y="36" width="12" height="30" rx="5" fill="#ffffff" stroke="#9ccff0" stroke-width="2"/>
        <rect x="68" y="30" width="8" height="7" rx="2" fill="#ff8fb8"/>
        <path d="M70 30c0-5 4-5 4 0" fill="#ffd166"/>
        <rect x="66" y="52" width="12" height="13" rx="4" fill="#bfe6fb"/>`,
    },
    "Automotive & Tools": {
      bg: ["#ffe9d6", "#ffd0a8"],
      body: `${shadow(34)}
        <path d="M18 52l4-12c1-3 3-5 6-5h28c3 0 5 1 7 4l7 9 6 2c2 1 3 2 3 4v6H18z" fill="#e8562a"/>
        <path d="M30 38h12v10H25zM46 38h10l6 10H46z" fill="#bfe6fb"/>
        <rect x="18" y="56" width="62" height="4" fill="#c2431b"/>
        <circle cx="30" cy="62" r="7" fill="#2d2a3e"/>
        <circle cx="68" cy="62" r="7" fill="#2d2a3e"/>
        <circle cx="30" cy="62" r="3" fill="#b8c2cc"/>
        <circle cx="68" cy="62" r="3" fill="#b8c2cc"/>
        <rect x="74" y="50" width="5" height="3" rx="1" fill="#ffd166"/>
        <path d="M66 12a7 7 0 0 0-6 10l-12 12 4 4 12-12a7 7 0 0 0 10-6l-4 2-3-3 2-4a7 7 0 0 0-3-3z" fill="#6b778d"/>`,
    },
    Livestock: {
      bg: ["#eef7d9", "#d9eeb0"],
      body: `${shadow(26)}
        <path d="M30 46c0-12 8-20 20-20 6 0 10 3 12 7l8 2-6 4c1 3 1 5 1 7 0 12-9 20-19 20s-16-8-16-20z" fill="#ffffff"/>
        <path d="M30 46c0-12 8-20 20-20 6 0 10 3 12 7l8 2-6 4c1 3 1 5 1 7 0 12-9 20-19 20s-16-8-16-20z" fill="none" stroke="#d6dcc4" stroke-width="2"/>
        <path d="M54 24c0-5 3-8 5-8 0 3 2 3 3 1 2 2 1 6-2 8z" fill="#e2333b"/>
        <path d="M66 35l8 1-7 4z" fill="#ffb627"/>
        <circle cx="60" cy="33" r="2" fill="#2d2a3e"/>
        <path d="M64 40c1 4-1 6-3 6 0-3 1-5 3-6z" fill="#e2333b"/>
        <path d="M30 44c-6-2-10 2-10 6 4-1 6 0 10 2z" fill="#c9d3ae"/>
        <path d="M36 48c4 6 12 8 18 4" fill="none" stroke="#d6dcc4" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M44 66v5M52 66v5" stroke="#ffb627" stroke-width="3" stroke-linecap="round"/>`,
    },
    Other: {
      bg: ["#ece8ff", "#d8d0ff"],
      body: `${shadow(24)}
        <path d="M28 30h40l-3 36H31z" fill="#7c6cf2"/>
        <path d="M28 30h40l-1 8H29z" fill="#6656e0"/>
        <path d="M38 34v-6a10 10 0 0 1 20 0v6" fill="none" stroke="#2d2a3e" stroke-width="3" stroke-linecap="round"/>
        <circle cx="38" cy="34" r="2" fill="#2d2a3e"/>
        <circle cx="58" cy="34" r="2" fill="#2d2a3e"/>
        <path d="M48 46l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" fill="#ffd166"/>
        <path d="M74 18l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5zM20 22l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="#ffb627"/>`,
    },
  };

  function svg(name) {
    const art = ART[name] || ART.Other;
    const id = `cat-bg-${String(name).toLowerCase().replace(/[^a-z]+/g, "-")}`;
    return `<svg class="cat-art" viewBox="0 0 96 80" role="img" aria-label="${name.replace(/&/g, "&amp;")}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${art.bg[0]}"/><stop offset="1" stop-color="${art.bg[1]}"/></linearGradient></defs>
      <rect width="96" height="80" fill="url(#${id})"/>
      <circle cx="82" cy="10" r="16" fill="#ffffff" opacity=".35"/>
      ${art.body}
    </svg>`;
  }

  return { CATEGORIES, svg };
})();
