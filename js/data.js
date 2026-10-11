/**
 * District reference data.
 *
 * Keys are the stable `properties.shapeName` values used by data/bangladesh.geojson.
 * Each entry carries the English display name and the Bengali display name.
 */
const BD_DISTRICTS = {
  "Bagerhat": { en: "Bagerhat", bn: "বাগেরহাট" },
  "Bandarban": { en: "Bandarban", bn: "বান্দরবান" },
  "Barguna": { en: "Barguna", bn: "বরগুনা" },
  "Barisal": { en: "Barishal", bn: "বরিশাল" },
  "Bhola": { en: "Bhola", bn: "ভোলা" },
  "Bogra": { en: "Bogura", bn: "বগুড়া" },
  "Brahamanbaria": { en: "Brahmanbaria", bn: "ব্রাহ্মণবাড়িয়া" },
  "Chandpur": { en: "Chandpur", bn: "চাঁদপুর" },
  "Chittagong": { en: "Chattogram", bn: "চট্টগ্রাম" },
  "Chuadanga": { en: "Chuadanga", bn: "চুয়াডাঙ্গা" },
  "Comilla": { en: "Cumilla", bn: "কুমিল্লা" },
  "Cox's Bazar": { en: "Cox's Bazar", bn: "কক্সবাজার" },
  "Dhaka": { en: "Dhaka", bn: "ঢাকা" },
  "Dinajpur": { en: "Dinajpur", bn: "দিনাজপুর" },
  "Faridpur": { en: "Faridpur", bn: "ফরিদপুর" },
  "Feni": { en: "Feni", bn: "ফেনী" },
  "Gaibandha": { en: "Gaibandha", bn: "গাইবান্ধা" },
  "Gazipur": { en: "Gazipur", bn: "গাজীপুর" },
  "Gopalganj": { en: "Gopalganj", bn: "গোপালগঞ্জ" },
  "Habiganj": { en: "Habiganj", bn: "হবিগঞ্জ" },
  "Jamalpur": { en: "Jamalpur", bn: "জামালপুর" },
  "Jessore": { en: "Jashore", bn: "যশোর" },
  "Jhalokati": { en: "Jhalakati", bn: "ঝালকাঠি" },
  "Jhenaidah": { en: "Jhenaidah", bn: "ঝিনাইদহ" },
  "Joypurhat": { en: "Joypurhat", bn: "জয়পুরহাট" },
  "Khagrachhari": { en: "Khagrachari", bn: "খাগড়াছড়ি" },
  "Khulna": { en: "Khulna", bn: "খুলনা" },
  "Kishoreganj": { en: "Kishoreganj", bn: "কিশোরগঞ্জ" },
  "Kurigram": { en: "Kurigram", bn: "কুড়িগ্রাম" },
  "Kushtia": { en: "Kushtia", bn: "কুষ্টিয়া" },
  "Lakshmipur": { en: "Lakshmipur", bn: "লক্ষ্মীপুর" },
  "Lalmonirhat": { en: "Lalmonirhat", bn: "লালমনিরহাট" },
  "Madaripur": { en: "Madaripur", bn: "মাদারীপুর" },
  "Magura": { en: "Magura", bn: "মাগুরা" },
  "Manikganj": { en: "Manikganj", bn: "মানিকগঞ্জ" },
  "Maulvibazar": { en: "Maulvibazar", bn: "মৌলভীবাজার" },
  "Meherpur": { en: "Meherpur", bn: "মেহেরপুর" },
  "Munshiganj": { en: "Munshiganj", bn: "মুন্সীগঞ্জ" },
  "Mymensingh": { en: "Mymensingh", bn: "ময়মনসিংহ" },
  "Naogaon": { en: "Naogaon", bn: "নওগাঁ" },
  "Narail": { en: "Narail", bn: "নাড়াইল" },
  "Narayanganj": { en: "Narayanganj", bn: "নারায়ণগঞ্জ" },
  "Narsingdi": { en: "Narsingdi", bn: "নরসিংদী" },
  "Natore": { en: "Natore", bn: "নাটোর" },
  "Nawabganj": { en: "Chapainawabganj", bn: "চাঁপাইনবাবগঞ্জ" },
  "Netrakona": { en: "Netrokona", bn: "নেত্রকোনা" },
  "Nilphamari": { en: "Nilphamari", bn: "নীলফামারী" },
  "Noakhali": { en: "Noakhali", bn: "নোয়াখালী" },
  "Pabna": { en: "Pabna", bn: "পাবনা" },
  "Panchagarh": { en: "Panchagarh", bn: "পঞ্চগড়" },
  "Patuakhali": { en: "Patuakhali", bn: "পটুয়াখালী" },
  "Pirojpur": { en: "Pirojpur", bn: "পিরোজপুর" },
  "Rajbari": { en: "Rajbari", bn: "রাজবাড়ী" },
  "Rajshahi": { en: "Rajshahi", bn: "রাজশাহী" },
  "Rangamati": { en: "Rangamati", bn: "রাঙ্গামাটি" },
  "Rangpur": { en: "Rangpur", bn: "রংপুর" },
  "Satkhira": { en: "Satkhira", bn: "সাতক্ষীরা" },
  "Shariatpur": { en: "Shariatpur", bn: "শরীয়তপুর" },
  "Sherpur": { en: "Sherpur", bn: "শেরপুর" },
  "Sirajganj": { en: "Sirajganj", bn: "সিরাজগঞ্জ" },
  "Sunamganj": { en: "Sunamganj", bn: "সুনামগঞ্জ" },
  "Sylhet": { en: "Sylhet", bn: "সিলেট" },
  "Tangail": { en: "Tangail", bn: "টাঙ্গাইল" },
  "Thakurgaon": { en: "Thakurgaon", bn: "ঠাকুরগাঁও" }
};

/**
 * Alternate spellings that appear in uploaded files / plaza master data.
 * Values must be a key of BD_DISTRICTS.
 */
const BD_DISTRICT_ALIASES = {
  "barishal": "Barisal",
  "barisal": "Barisal",
  "bogra": "Bogra",
  "bogura": "Bogra",
  "chapainawabganj": "Nawabganj",
  "chapainababganj": "Nawabganj",
  "nowabganj": "Nawabganj",
  "nawabganj": "Nawabganj",
  "chattogram": "Chittagong",
  "chittagong": "Chittagong",
  "cumilla": "Comilla",
  "comilla": "Comilla",
  "jashore": "Jessore",
  "jessore": "Jessore",
  "jhalakati": "Jhalokati",
  "jhalokati": "Jhalokati",
  "jhalokathi": "Jhalokati",
  "khagrachari": "Khagrachhari",
  "khagrachhari": "Khagrachhari",
  "maulvibazar": "Maulvibazar",
  "moulvibazar": "Maulvibazar",
  "moulavibazar": "Maulvibazar",
  "netrakona": "Netrakona",
  "netrokona": "Netrakona",
  "brahamanbaria": "Brahamanbaria",
  "brahmanbaria": "Brahamanbaria",
  "coxsbazar": "Cox's Bazar",
  "coxbazar": "Cox's Bazar",
  "coxsbazar2": "Cox's Bazar"
};

/** Lowercase, strip everything that is not a letter/digit (keeps Bengali codepoints). */
function bdNormalizeKey(value) {
  return String(value === null || value === undefined ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09FF]+/g, "");
}

const BD_LOOKUP = (() => {
  const index = {};
  Object.keys(BD_DISTRICTS).forEach(shape => {
    index[bdNormalizeKey(shape)] = shape;
    index[bdNormalizeKey(BD_DISTRICTS[shape].en)] = shape;
    index[bdNormalizeKey(BD_DISTRICTS[shape].bn)] = shape;
  });
  Object.keys(BD_DISTRICT_ALIASES).forEach(alias => {
    index[bdNormalizeKey(alias)] = BD_DISTRICT_ALIASES[alias];
  });
  return index;
})();

/** Resolve any district spelling to a geojson shapeName, or null when unknown. */
function bdResolveDistrict(name) {
  if (!name) return null;
  const key = bdNormalizeKey(name);
  if (BD_LOOKUP[key]) return BD_LOOKUP[key];
  // strip common suffixes such as "District" / "Zila"
  const stripped = key.replace(/(district|zila|jela)$/, "");
  return BD_LOOKUP[stripped] || null;
}

/** English + Bengali display names for a shapeName. */
function bdDistrictInfo(shape) {
  const entry = BD_DISTRICTS[shape];
  if (entry) return entry;
  return { en: shape || "—", bn: "" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BD_DISTRICTS,
    BD_DISTRICT_ALIASES,
    bdNormalizeKey,
    bdResolveDistrict,
    bdDistrictInfo
  };
}
