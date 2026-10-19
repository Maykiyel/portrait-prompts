import { createHash } from "node:crypto";

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rngFor(seed: number, salt: string): () => number {
  return mulberry32(salt ? hash32(`${salt}:${seed}`) : seed);
}

// Add new entries at the END of a pool. Reordering or inserting moves existing entries.
// Even an append changes what old seeds draw from that pool, because the draw is
// floor(random * length). Bump the version line in template.txt whenever a pool or
// the template changes. Pools are drawn in the order they appear here, then the
// optional details are drawn from the same random source.
export const pools: Record<string, string[]> = {
  age: ["21", "24", "27", "30", "33", "36", "39", "42", "45", "48", "52", "55", "58", "62", "65", "68", "72", "76"],
  gender: ["man", "woman", "person with an androgynous look"],
  ethnicity: [
    "Nigerian", "Filipino", "Brazilian", "Korean", "Norwegian", "Iranian", "Mexican", "Indian",
    "Ethiopian", "Japanese", "Egyptian", "Polish", "Vietnamese", "Colombian", "Turkish", "Kenyan",
    "Indonesian", "Peruvian", "Lebanese", "Irish", "Pakistani", "Ghanaian", "Thai", "Italian",
    "Chinese", "Greek", "Samoan", "Mongolian", "Moroccan", "Swedish",
    "Bangladeshi", "Sri Lankan", "Nepali", "Kazakh", "Uzbek", "Somali", "Zulu", "Cameroonian",
    "Jamaican", "Haitian", "Trinidadian", "Fijian", "Maori", "Native Hawaiian", "Navajo", "Quechua", "Cree",
  ],
  skin: [
    "deep brown", "dark espresso", "warm brown", "golden brown", "copper", "warm tan", "olive",
    "light olive", "medium beige", "light beige", "fair freckled", "pale", "rosy fair", "ruddy", "bronze",
  ],
  eyeColor: [
    "dark brown", "medium brown", "light brown", "amber", "hazel", "green", "gray", "blue", "blue-gray",
    "very dark brown", "gray-green", "light blue",
  ],
  eyeShape: [
    "almond-shaped", "round", "hooded", "deep-set", "downturned", "upturned", "wide-set", "close-set",
    "monolid", "narrow", "large",
  ],
  face: [
    "a round face", "an oval face", "a square-jawed face", "a heart-shaped face", "a high-cheekboned face",
    "a long narrow face", "a broad face", "a diamond-shaped face", "a soft full face", "a sharp-featured face",
    "a rectangular face", "a strong-chinned face", "a gaunt face", "a weathered face", "a petite-featured face",
    "a wide-jawed face",
  ],
  nose: [
    "a straight nose with a narrow tip", "a broad nose with a rounded tip", "a prominent nose bridge",
    "a short nose with a softly rounded tip", "a narrow nose with a defined bridge",
    "a gently curved nose bridge", "a broad nose bridge with defined nostrils", "a slightly crooked nose",
    "a long straight nose", "a slightly upturned nose", "a wide nose with softly flared nostrils",
    "a small button nose",
  ],
  lips: [
    "thin lips", "full lips", "lips with a pronounced cupid's bow", "lips with a fuller lower lip",
    "a narrow upper lip with a full lower lip", "naturally asymmetrical lips", "softly defined lips",
    "wide lips", "small lips", "lips with a slight downturn at the corners",
  ],
  eyebrows: [
    "thick straight eyebrows", "softly arched eyebrows", "highly arched eyebrows", "sparse fine eyebrows",
    "bushy textured eyebrows", "subtle low-set eyebrows", "heavy dark eyebrows", "thin pale eyebrows",
    "angular eyebrows with a defined tail", "thick slightly uneven eyebrows",
  ],
  hair: [
    "short black curls", "shoulder-length wavy auburn hair", "a gray buzz cut", "long braids",
    "slicked-back brown hair", "a tight black afro", "cropped silver hair", "a messy blond bob",
    "long straight black hair", "a shaved head", "short gray waves", "thick dark curls pulled back",
    "a low bun of chestnut hair", "short wavy salt-and-pepper hair", "a neat side part in dark brown hair",
    "red curly hair", "long wavy dark hair", "a short pixie cut in platinum blond", "box braids",
    "a high ponytail of black hair", "thinning gray hair combed back", "dark hair in twists",
    "a faded undercut with black hair on top", "wispy white hair",
  ],
  facialHair: [
    ", a trimmed beard", ", a light stubble", ", a gray mustache", ", a full dark beard",
    ", a salt-and-pepper goatee", ", a thin mustache", ", a short boxed beard",
    "", "", "", "", "", "",
  ],
  expression: [
    "a calm half smile", "a focused stare", "a wide laugh", "a quiet, thoughtful look",
    "a warm closed-mouth smile", "a skeptical raised eyebrow", "a relaxed neutral look", "a surprised look",
    "a tired but kind smile", "a confident smirk", "a serious, steady gaze",
    "a gentle smile with crinkled eyes", "a distracted glance to the side", "a proud look", "an amused look",
    "a worried frown",
  ],
  pose: [
    "turned slightly left", "turned slightly right", "facing the camera straight on", "in a quarter turn",
    "in a three-quarter turn to the left", "in a three-quarter turn to the right", "tilted slightly down",
    "held with the chin slightly raised", "tilted a little to one side", "looking just past the camera",
  ],
  photography: [],
  profession: [
    "a ceramics teacher", "an ER nurse", "a bus driver", "a software tester", "a fishing boat captain",
    "a pastry chef", "a high school chemistry teacher", "a wedding photographer", "a veterinarian",
    "an electrician", "a violin maker", "a city librarian", "a bike messenger", "a civil engineer",
    "a market vegetable seller", "a taxi driver", "a tattoo artist", "a retired pilot", "a farmer",
    "a radio host", "a barista", "a dentist", "a carpenter", "a museum guard", "a street musician",
    "a ship welder", "a pharmacist", "a tailor", "a physical therapist", "a flight attendant",
  ],
  wardrobe: [
    "a wool coat over a turtleneck", "a denim work shirt", "a linen blazer", "a plain gray hoodie",
    "a navy pea coat", "a crisp white collared shirt", "a mustard knit sweater",
    "a leather jacket over a t-shirt", "a green scrub top", "a flannel shirt", "a charcoal suit with no tie",
    "a floral blouse", "a black turtleneck", "a quilted vest over a shirt", "a red windbreaker",
    "a cream cardigan", "a high-visibility work jacket", "a patterned silk scarf and a dark jacket",
    "a plain navy cap and a gray tee", "a hand-knit wool sweater", "a rain jacket with the hood down",
    "a tailored olive overshirt", "a chef's white jacket",
  ],
  background: [
    "a cluttered pottery studio", "a rainy street at dusk", "a bright classroom", "a harbor at dawn",
    "a busy open-plan office", "a quiet library aisle", "a sunlit kitchen", "a train platform",
    "a greenhouse", "a hospital corridor", "a workshop with hanging tools", "a market stall row",
    "a seaside promenade", "a snowy park", "an old bookshop", "a plain gray studio backdrop",
    "a rooftop at golden hour", "a cafe with warm lights", "a construction site fence",
    "an apartment hallway", "a dusty barn",
  ],
  lighting: [
    "soft window light from the left", "warm golden hour backlight", "cool overcast daylight",
    "moody single-source key light", "bright even studio light", "soft window light from the right",
    "dramatic side light with deep shadows", "warm tungsten lamp light", "blue hour ambient light",
    "soft diffused light with a subtle rim light", "harsh midday sun with soft fill",
    "gentle overhead light",
  ],
};

export const detailPools: Record<string, string[]> = {
  skinDetail: [
    "light freckles across the nose", "freckles across the cheeks", "subtle acne marks", "faint sun spots",
    "mild uneven pigmentation", "faint redness across the cheeks",
  ],
  distinctiveMark: [
    "a small mole on one cheek", "a faint healed scar near one eyebrow", "a subtle birthmark near the jaw",
    "a small mole above the lip", "a small healed scar on the chin",
  ],
  facialDetail: ["subtle dimples", "a cleft chin", "slight natural facial asymmetry", "a high forehead"],
  accessory: [
    "wire-rimmed glasses", "round tortoiseshell glasses", "small stud earrings", "small hoop earrings",
    "a subtle nose piercing", "thin rectangular glasses",
  ],
  ageDetail: ["faint crow's feet", "fine forehead lines", "visible laugh lines", "fine lines around the mouth"],
};

export const derivedPlaceholders = ["features"] as const;
export const MAX_DETAILS = 3;
export const MIX_RATE = 0.25;
export const NO_DETAILS = "no prominent additional marks or accessories";
const MIN_AGE_FOR_AGE_DETAIL = 30;
const MAX_AGE_FOR_ACNE = 45;

// Gender weights: judgment-based synthetic sampling controls, not measured statistics.
export const GENDER_WEIGHTS: Record<string, number> = {
  man: 48,
  woman: 48,
  "person with an androgynous look": 4,
};
export const genderWeights = GENDER_WEIGHTS;

// Ethnicity groups and weights.
export const ethnicityGroups: Record<string, string[]> = {
  europe: ["Norwegian", "Polish", "Irish", "Italian", "Greek", "Swedish"],
  east_asia: ["Korean", "Japanese", "Chinese", "Mongolian"],
  southeast_asia: ["Filipino", "Vietnamese", "Indonesian", "Thai"],
  south_asia: ["Indian", "Pakistani", "Bangladeshi", "Sri Lankan", "Nepali"],
  central_asia: ["Kazakh", "Uzbek"],
  west_asia_north_africa: ["Iranian", "Lebanese", "Turkish", "Egyptian", "Moroccan"],
  sub_saharan_africa: ["Nigerian", "Ethiopian", "Kenyan", "Ghanaian", "Somali", "Zulu", "Cameroonian"],
  latin_america: ["Brazilian", "Mexican", "Colombian", "Peruvian"],
  caribbean: ["Jamaican", "Haitian", "Trinidadian"],
  pacific: ["Samoan", "Fijian", "Maori", "Native Hawaiian"],
  indigenous_americas: ["Navajo", "Quechua", "Cree"],
};
export const GROUP_WEIGHTS: Record<string, number> = Object.fromEntries(Object.keys(ethnicityGroups).map((g) => [g, 1]));
export const groupWeights = GROUP_WEIGHTS;

export function groupOf(ethnicity: string): string {
  for (const [group, list] of Object.entries(ethnicityGroups)) if (list.includes(ethnicity)) return group;
  throw new Error(`Unknown ethnicity: ${ethnicity}`);
}

// Tone bands.
export const SKIN_BANDS: Record<string, string> = {
  "deep brown": "deep",
  "dark espresso": "deep",
  "warm brown": "medium_dark",
  "golden brown": "medium_dark",
  "copper": "medium_dark",
  "bronze": "medium_dark",
  "warm tan": "medium",
  "olive": "medium",
  "medium beige": "medium",
  "light olive": "light",
  "light beige": "light",
  "rosy fair": "light",
  "ruddy": "light",
  "fair freckled": "very_light",
  "pale": "very_light",
};
export const skinBands = SKIN_BANDS;

export const EYE_BANDS: Record<string, string> = {
  "very dark brown": "dark",
  "dark brown": "dark",
  "medium brown": "brown",
  "light brown": "brown",
  "amber": "hazel_amber",
  "hazel": "hazel_amber",
  "green": "light",
  "gray": "light",
  "blue": "light",
  "blue-gray": "light",
  "gray-green": "light",
  "light blue": "light",
};
export const eyeBands = EYE_BANDS;

export function skinBandOf(entry: string): string {
  const band = SKIN_BANDS[entry];
  if (!band) throw new Error(`Unknown skin entry: ${entry}`);
  return band;
}
export function eyeBandOf(entry: string): string {
  const band = EYE_BANDS[entry];
  if (!band) throw new Error(`Unknown eye color entry: ${entry}`);
  return band;
}

// Band weights per group. Judgment-based controls, tunable.
export const SKIN_BAND_WEIGHTS: Record<string, Record<string, number>> = {
  europe: { deep: 1, medium_dark: 2, medium: 15, light: 52, very_light: 30 },
  east_asia: { deep: 1, medium_dark: 5, medium: 40, light: 44, very_light: 10 },
  southeast_asia: { deep: 2, medium_dark: 28, medium: 48, light: 20, very_light: 2 },
  south_asia: { deep: 8, medium_dark: 42, medium: 38, light: 11, very_light: 1 },
  central_asia: { deep: 1, medium_dark: 8, medium: 38, light: 43, very_light: 10 },
  west_asia_north_africa: { deep: 2, medium_dark: 20, medium: 43, light: 32, very_light: 3 },
  sub_saharan_africa: { deep: 55, medium_dark: 39, medium: 4, light: 1, very_light: 1 },
  latin_america: { deep: 3, medium_dark: 22, medium: 35, light: 30, very_light: 10 },
  caribbean: { deep: 30, medium_dark: 40, medium: 20, light: 8, very_light: 2 },
  pacific: { deep: 5, medium_dark: 42, medium: 38, light: 14, very_light: 1 },
  indigenous_americas: { deep: 2, medium_dark: 40, medium: 43, light: 14, very_light: 1 },
};
export const skinBandWeights = SKIN_BAND_WEIGHTS;

export const EYE_BAND_WEIGHTS: Record<string, Record<string, number>> = {
  europe: { dark: 20, brown: 25, hazel_amber: 15, light: 40 },
  east_asia: { dark: 70, brown: 27, hazel_amber: 2, light: 1 },
  southeast_asia: { dark: 70, brown: 27, hazel_amber: 2, light: 1 },
  south_asia: { dark: 60, brown: 32, hazel_amber: 6, light: 2 },
  central_asia: { dark: 35, brown: 40, hazel_amber: 12, light: 13 },
  west_asia_north_africa: { dark: 40, brown: 35, hazel_amber: 13, light: 12 },
  sub_saharan_africa: { dark: 80, brown: 18, hazel_amber: 1, light: 1 },
  latin_america: { dark: 30, brown: 40, hazel_amber: 14, light: 16 },
  caribbean: { dark: 50, brown: 38, hazel_amber: 8, light: 4 },
  pacific: { dark: 60, brown: 35, hazel_amber: 4, light: 1 },
  indigenous_americas: { dark: 70, brown: 27, hazel_amber: 2, light: 1 },
};
export const eyeBandWeights = EYE_BAND_WEIGHTS;

// Age rules.
export const AGE_RULES: { pool: string; entry: string; minAge?: number; maxAge?: number }[] = [
  { pool: "face", entry: "a weathered face", minAge: 40 },
  { pool: "hair", entry: "short wavy salt-and-pepper hair", minAge: 42 },
  { pool: "hair", entry: "a gray buzz cut", minAge: 48 },
  { pool: "hair", entry: "cropped silver hair", minAge: 48 },
  { pool: "hair", entry: "short gray waves", minAge: 52 },
  { pool: "hair", entry: "thinning gray hair combed back", minAge: 55 },
  { pool: "hair", entry: "wispy white hair", minAge: 62 },
  { pool: "facialHair", entry: ", a salt-and-pepper goatee", minAge: 42 },
  { pool: "facialHair", entry: ", a gray mustache", minAge: 52 },
  { pool: "facialHair", entry: ", a full dark beard", maxAge: 62 },
  { pool: "profession", entry: "an ER nurse", minAge: 24 },
  { pool: "profession", entry: "a high school chemistry teacher", minAge: 24 },
  { pool: "profession", entry: "a civil engineer", minAge: 24 },
  { pool: "profession", entry: "a city librarian", minAge: 27 },
  { pool: "profession", entry: "a veterinarian", minAge: 27 },
  { pool: "profession", entry: "a dentist", minAge: 27 },
  { pool: "profession", entry: "a pharmacist", minAge: 27 },
  { pool: "profession", entry: "a physical therapist", minAge: 27 },
  { pool: "profession", entry: "a fishing boat captain", minAge: 30 },
  { pool: "profession", entry: "a retired pilot", minAge: 60 },
  { pool: "profession", entry: "a bike messenger", maxAge: 50 },
];
export const ageRules = AGE_RULES;

export const GRAY_HAIR: string[] = [
  "short wavy salt-and-pepper hair",
  "a gray buzz cut",
  "cropped silver hair",
  "short gray waves",
  "thinning gray hair combed back",
  "wispy white hair",
];

// Background settings and lighting allowed settings.
export const BACKGROUND_SETTINGS: Record<string, string> = {
  "a cluttered pottery studio": "indoor",
  "a bright classroom": "indoor",
  "a busy open-plan office": "indoor",
  "a quiet library aisle": "indoor",
  "a sunlit kitchen": "indoor",
  "a greenhouse": "indoor",
  "a hospital corridor": "indoor",
  "a workshop with hanging tools": "indoor",
  "an old bookshop": "indoor",
  "a cafe with warm lights": "indoor",
  "an apartment hallway": "indoor",
  "a dusty barn": "indoor",
  "a rainy street at dusk": "outdoor",
  "a harbor at dawn": "outdoor",
  "a train platform": "outdoor",
  "a market stall row": "outdoor",
  "a seaside promenade": "outdoor",
  "a snowy park": "outdoor",
  "a rooftop at golden hour": "outdoor",
  "a construction site fence": "outdoor",
  "a plain gray studio backdrop": "studio",
};
export const backgroundSettings = BACKGROUND_SETTINGS;

export const LIGHTING_ALLOWED_SETTINGS: Record<string, string[]> = {
  "soft window light from the left": ["indoor"],
  "soft window light from the right": ["indoor"],
  "warm golden hour backlight": ["outdoor"],
  "cool overcast daylight": ["outdoor"],
  "blue hour ambient light": ["outdoor"],
  "harsh midday sun with soft fill": ["outdoor"],
  "warm tungsten lamp light": ["indoor"],
  "moody single-source key light": ["indoor", "outdoor", "studio"],
  "dramatic side light with deep shadows": ["indoor", "outdoor", "studio"],
  "soft diffused light with a subtle rim light": ["indoor", "outdoor", "studio"],
  "bright even studio light": ["indoor", "studio"],
  "gentle overhead light": ["indoor", "studio"],
};
export const lightingAllowedSettings = LIGHTING_ALLOWED_SETTINGS;

export const BACKGROUND_LIGHTING_EXCLUSIONS: Record<string, string[]> = {
  "a rainy street at dusk": ["harsh midday sun with soft fill", "warm golden hour backlight"],
  "a harbor at dawn": ["harsh midday sun with soft fill"],
  "a rooftop at golden hour": ["harsh midday sun with soft fill", "blue hour ambient light", "cool overcast daylight"],
  "a sunlit kitchen": ["moody single-source key light", "warm tungsten lamp light"],
  "a cafe with warm lights": ["bright even studio light"],
};
export const backgroundLightingExclusions = BACKGROUND_LIGHTING_EXCLUSIONS;

// Light or red natural hair entries and group factors.
export const LIGHT_NATURAL_HAIR_ENTRIES: string[] = [
  "shoulder-length wavy auburn hair",
  "a messy blond bob",
  "red curly hair",
  "a short pixie cut in platinum blond",
];
export const lightNaturalHairEntries = LIGHT_NATURAL_HAIR_ENTRIES;

export const LIGHT_NATURAL_HAIR_FACTORS: Record<string, number> = {
  europe: 1,
  latin_america: 0.5,
  west_asia_north_africa: 0.4,
  central_asia: 0.4,
  caribbean: 0.2,
  pacific: 0.2,
  south_asia: 0.15,
  east_asia: 0.15,
  southeast_asia: 0.15,
  sub_saharan_africa: 0.15,
  indigenous_americas: 0.15,
};
export const lightNaturalHairFactors = LIGHT_NATURAL_HAIR_FACTORS;

// Photography profiles.
export type PhotographyProfile = {
  id: string;
  prompt: string;
  description: string;
  weight: number;
  allowedSettings: string[];
  allowedLighting?: string[];
  excludedLighting?: string[];
};

export const PHOTOGRAPHY_PROFILES: Record<string, PhotographyProfile> = {
  professional_headshot: {
    id: "professional_headshot",
    prompt: "a controlled professional portrait with conventional camera distance, intentional composition, and shallow to moderate depth of field",
    description: "a controlled professional portrait with conventional camera distance, intentional composition, and shallow to moderate depth of field",
    weight: 1,
    allowedSettings: ["indoor", "outdoor", "studio"],
  },
  casual_smartphone: {
    id: "casual_smartphone",
    prompt: "a casual handheld smartphone perspective with natural framing, modest perspective distortion, and realistic background detail",
    description: "a casual handheld smartphone perspective with natural framing, modest perspective distortion, and realistic background detail",
    weight: 1,
    allowedSettings: ["indoor", "outdoor"],
  },
  webcam_portrait: {
    id: "webcam_portrait",
    prompt: "a straight-on webcam-height head-and-shoulders portrait with flat perspective and visible room context",
    description: "a straight-on webcam-height head-and-shoulders portrait with flat perspective and visible room context",
    weight: 1,
    allowedSettings: ["indoor"],
  },
  environmental_portrait: {
    id: "environmental_portrait",
    prompt: "a wider portrait with more of the subject's surroundings visible and a deeper depth of field",
    description: "a wider portrait with more of the subject's surroundings visible and a deeper depth of field",
    weight: 1,
    allowedSettings: ["indoor", "outdoor"],
  },
  candid_available_light: {
    id: "candid_available_light",
    prompt: "a slightly off-center candid frame with natural camera distance and an ambient-light feel",
    description: "a slightly off-center candid frame with natural camera distance and an ambient-light feel",
    weight: 1,
    allowedSettings: ["indoor", "outdoor"],
  },
  low_light_portrait: {
    id: "low_light_portrait",
    prompt: "a dim but usable low-light portrait with visible shadows and modest sensor noise while facial features remain visible",
    description: "a dim but usable low-light portrait with visible shadows and modest sensor noise while facial features remain visible",
    weight: 1,
    allowedSettings: ["indoor", "outdoor", "studio"],
    allowedLighting: ["moody single-source key light", "dramatic side light with deep shadows", "soft diffused light with a subtle rim light", "gentle overhead light", "warm tungsten lamp light", "blue hour ambient light"],
    excludedLighting: ["harsh midday sun with soft fill", "bright even studio light", "warm golden hour backlight"],
  },
};
export const photographyProfiles = PHOTOGRAPHY_PROFILES;

pools.photography = Object.keys(PHOTOGRAPHY_PROFILES);

// Backward-friendly aliases.
export const photographyProfilesList = Object.values(PHOTOGRAPHY_PROFILES);

// Weighted picker.
export function weightedPick<T>(r: () => number, xs: T[], weight: (x: T) => number): T {
  if (xs.length === 0) throw new Error("weightedPick: empty candidate list");
  let total = 0;
  for (const x of xs) total += weight(x);
  if (!(total > 0)) throw new Error("weightedPick: non-positive total weight");
  let target = r() * total;
  let acc = 0;
  for (const x of xs) {
    acc += weight(x);
    if (target < acc) return x;
  }
  return xs[xs.length - 1];
}
export const weightedPicker = weightedPick;

// Skin detail weights.
const SKIN_DETAIL_WEIGHTS: Record<string, Record<string, number>> = {
  "light freckles across the nose": { deep: 0.2, medium_dark: 0.4 },
  "freckles across the cheeks": { deep: 0.2, medium_dark: 0.4 },
  "faint sun spots": { deep: 0.2, medium_dark: 0.4 },
  "faint redness across the cheeks": { deep: 0.3 },
};
export const SKIN_DETAIL_WEIGHTS_EXPORT = SKIN_DETAIL_WEIGHTS;
export const skinDetailWeights = SKIN_DETAIL_WEIGHTS;

function skinDetailWeight(entry: string, band: string): number {
  const w = SKIN_DETAIL_WEIGHTS[entry];
  if (!w) return 1;
  if (band === "deep") return w.deep ?? 1;
  if (band === "medium_dark") return w.medium_dark ?? 1;
  return 1;
}


export function formatDetails(details: string[]): string {
  if (details.length === 0) return NO_DETAILS;
  if (details.length === 1) return details[0];
  if (details.length === 2) return `${details[0]} and ${details[1]}`;
  return `${details.slice(0, -1).join(", ")}, and ${details[details.length - 1]}`;
}

function fits(category: string, detail: string, v: Record<string, string>): boolean {
  const age = Number(v.age);
  if (category === "ageDetail" && age < MIN_AGE_FOR_AGE_DETAIL) return false;
  if (/acne/.test(detail) && age > MAX_AGE_FOR_ACNE) return false;
  if (/freckles/.test(detail) && /freckled/.test(v.skin)) return false;
  if (/asymmetry/.test(detail) && /asymmetrical/.test(v.lips)) return false;
  return true;
}

function pickDetails(r: () => number, v: Record<string, string>): { category: string; text: string }[] {
  const count = Math.floor(r() * (MAX_DETAILS + 1));
  const skinBand = skinBandOf(v.skin);
  const open = Object.keys(detailPools).filter((k) => detailPools[k].some((d) => fits(k, d, v)));
  for (let i = 0; i < Math.min(count, open.length); i++) {
    const j = i + Math.floor(r() * (open.length - i));
    [open[i], open[j]] = [open[j], open[i]];
  }
  const chosen = new Set(open.slice(0, Math.min(count, open.length)));
  return Object.keys(detailPools)
    .filter((k) => chosen.has(k))
    .map((k) => {
      const candidates = detailPools[k].filter((d) => fits(k, d, v));
      const text = weightedPick(r, candidates, (d) => (k === "skinDetail" ? skinDetailWeight(d, skinBand) : 1));
      return { category: k, text };
    });
}

export function samplePortrait(seed: number, salt: string, r: () => number = rngFor(seed, salt)) {
  const values: Record<string, string> = {};
  let groups: string[] = [];
  let ethnicities: string[] = [];
  let skinBand = "";
  let eyeBand = "";
  let photographyProfileId = "";
  let primaryGroup = "";
  let primaryEthnicity = "";

  const ageRulesMap: Record<string, Record<string, { minAge?: number; maxAge?: number }>> = {};
  for (const rule of AGE_RULES) {
    ageRulesMap[rule.pool] ??= {};
    ageRulesMap[rule.pool][rule.entry] = { minAge: rule.minAge, maxAge: rule.maxAge };
  }

  for (const [k, xs] of Object.entries(pools)) {
    if (k === "ethnicity") {
      // Six draws regardless of mixed status.
      const allGroups = Object.keys(ethnicityGroups);
      primaryGroup = weightedPick(r, allGroups, (g) => GROUP_WEIGHTS[g] ?? 1);
      const primaryList = ethnicityGroups[primaryGroup];
      primaryEthnicity = primaryList[Math.floor(r() * primaryList.length)];
      const mixed = r() < MIX_RATE;
      const secondGroup = weightedPick(r, allGroups, (g) => GROUP_WEIGHTS[g] ?? 1);
      let secondCandidates = ethnicityGroups[secondGroup].filter((e) => e !== primaryEthnicity);
      if (secondCandidates.length === 0) secondCandidates = pools.ethnicity.filter((e) => e !== primaryEthnicity);
      const secondEthnicity = secondCandidates[Math.floor(r() * secondCandidates.length)];
      const orderCoin = r();
      if (!mixed) {
        ethnicities = [primaryEthnicity];
        groups = [primaryGroup];
      } else if (orderCoin < 0.5) {
        ethnicities = [primaryEthnicity, secondEthnicity];
        groups = [primaryGroup, groupOf(secondEthnicity)];
      } else {
        ethnicities = [secondEthnicity, primaryEthnicity];
        groups = [groupOf(secondEthnicity), primaryGroup];
      }

  // Ensure capture is available in returned object.
      values.ethnicity = ethnicities.join(" and ");
      continue;
    }

    if (k === "gender") {
      values.gender = weightedPick(r, xs, (entry) => GENDER_WEIGHTS[entry] ?? 1);
      continue;
    }

    if (k === "skin") {
      const blendGroups = groups.length ? groups : [groups[0]];
      // blend group list may contain duplicates? groupOf twice same; keep.
      const blendedGroups = blendGroups.length === 1 ? blendGroups : blendGroups;
      const skinBlend = blendWeights(blendedGroups, SKIN_BAND_WEIGHTS, Object.keys(SKIN_BAND_WEIGHTS[blendGroups[0]]));
      const bands = Object.keys(skinBlend);
      const entriesInBand: Record<string, number> = {};
      for (const band of bands) entriesInBand[band] = xs.filter((e) => SKIN_BANDS[e] === band).length || 1;
      values.skin = weightedPick(r, xs, (entry) => {
        const band = SKIN_BANDS[entry];
        const bw = skinBlend[band] ?? 1;
        return bw / entriesInBand[band];
      });
      skinBand = SKIN_BANDS[values.skin];
      continue;
    }

    if (k === "eyeColor") {
      const blendGroups = groups.length ? groups : [groups[0]];
      const eyeBlend = blendWeights(blendGroups, EYE_BAND_WEIGHTS, Object.keys(EYE_BAND_WEIGHTS[blendGroups[0]]));
      const bands = Object.keys(eyeBlend);
      const entriesInBand: Record<string, number> = {};
      for (const band of bands) entriesInBand[band] = xs.filter((e) => EYE_BANDS[e] === band).length || 1;
      values.eyeColor = weightedPick(r, xs, (entry) => {
        const band = EYE_BANDS[entry];
        const bw = eyeBlend[band] ?? 1;
        return bw / entriesInBand[band];
      });
      eyeBand = EYE_BANDS[values.eyeColor];
      continue;
    }

    if (k === "hair") {
      const blendGroups = groups.length ? groups : [groups[0]];
      const factorMean = (entry: string) => {
        if (!LIGHT_NATURAL_HAIR_ENTRIES.includes(entry)) return 1;
        const factors = blendGroups.map((g) => LIGHT_NATURAL_HAIR_FACTORS[g] ?? 1);
        return factors.reduce((a, b) => a + b, 0) / factors.length;
      };
      // Age rules first.
      const age = Number(values.age);
      const allowed = xs.filter((entry) => {
        const rule = ageRulesMap.hair?.[entry];
        if (rule) {
          if (rule.minAge !== undefined && age < rule.minAge) return false;
          if (rule.maxAge !== undefined && age > rule.maxAge) return false;
        }
        return true;
      });
      if (allowed.length === 0) throw new Error(`No allowed entries for pool hair (age ${age})`);
      values.hair = weightedPick(r, allowed, (entry) => factorMean(entry));
      continue;
    }

    if (k === "facialHair") {
      const age = Number(values.age);
      const hair = values.hair;
      const gray = GRAY_HAIR.includes(hair);
      const allowed = xs.filter((entry) => {
        const rule = ageRulesMap.facialHair?.[entry];
        if (rule) {
          if (rule.minAge !== undefined && age < rule.minAge) return false;
          if (rule.maxAge !== undefined && age > rule.maxAge) return false;
        }
        if (gray && entry === ", a full dark beard") return false;
        return true;
      });
      if (allowed.length === 0) throw new Error(`No allowed entries for pool facialHair (age ${age})`);
      values.facialHair = weightedPick(r, allowed, () => 1);
      continue;
    }

    if (k === "face") {
      const age = Number(values.age);
      const allowed = xs.filter((entry) => {
        const rule = ageRulesMap.face?.[entry];
        if (rule) {
          if (rule.minAge !== undefined && age < rule.minAge) return false;
          if (rule.maxAge !== undefined && age > rule.maxAge) return false;
        }
        return true;
      });
      if (allowed.length === 0) throw new Error(`No allowed entries for pool face (age ${age})`);
      values.face = weightedPick(r, allowed, () => 1);
      continue;
    }

    if (k === "profession") {
      const age = Number(values.age);
      const allowed = xs.filter((entry) => {
        const rule = ageRulesMap.profession?.[entry];
        if (rule) {
          if (rule.minAge !== undefined && age < rule.minAge) return false;
          if (rule.maxAge !== undefined && age > rule.maxAge) return false;
        }
        return true;
      });
      if (allowed.length === 0) throw new Error(`No allowed entries for pool profession (age ${age})`);
      values.profession = weightedPick(r, allowed, () => 1);
      continue;
    }

    if (k === "eyebrows") {
      const allowed = xs.filter((entry) => {
        if (entry === "thin pale eyebrows" && skinBand !== "light" && skinBand !== "very_light") return false;
        return true;
      });
      if (allowed.length === 0) throw new Error("No allowed entries for pool eyebrows");
      values.eyebrows = weightedPick(r, allowed, () => 1);
      continue;
    }

    if (k === "photography") {
      const profileIds = xs;
      const selected = weightedPick(r, profileIds, (id) => PHOTOGRAPHY_PROFILES[id]?.weight ?? 1);
      photographyProfileId = selected;
      values.photography = PHOTOGRAPHY_PROFILES[selected]?.prompt ?? selected;
      continue;
    }

    if (k === "background") {
      const profile = PHOTOGRAPHY_PROFILES[photographyProfileId];
      const allowed = xs.filter((entry) => {
        const setting = BACKGROUND_SETTINGS[entry];
        return profile.allowedSettings.includes(setting);
      });
      if (allowed.length === 0) throw new Error("No allowed entries for pool background");
      values.background = weightedPick(r, allowed, () => 1);
      continue;
    }

    if (k === "lighting") {
      const background = values.background;
      const bgSetting = BACKGROUND_SETTINGS[background];
      const excluded = BACKGROUND_LIGHTING_EXCLUSIONS[background] ?? [];
      const profile = PHOTOGRAPHY_PROFILES[photographyProfileId];
      const allowed = xs.filter((entry) => {
        const settings = LIGHTING_ALLOWED_SETTINGS[entry] ?? [];
        if (!settings.includes(bgSetting)) return false;
        if (excluded.includes(entry)) return false;
        if (profile.allowedLighting && !profile.allowedLighting.includes(entry)) return false;
        if (profile.excludedLighting && profile.excludedLighting.includes(entry)) return false;
        return true;
      });
      if (allowed.length === 0) throw new Error("No allowed entries for pool lighting");
      values.lighting = weightedPick(r, allowed, () => 1);
      continue;
    }

    // Default generic pool.
    values[k] = weightedPick(r, xs, () => 1);
  }

  if (values.gender !== "man") values.facialHair = "";
  const details = pickDetails(r, values);
  values.features = formatDetails(details.map((d) => d.text));

  // Non-mixed already set above. Ensure values.ethnicity text.
  values.ethnicity = ethnicities.join(" and ");

  return {
    values,
    details,
    ethnicities,
    groups,
    primaryGroup,
    primaryEthnicity,
    bands: { skin: skinBand, eye: eyeBand },
    photographyProfile: {
      id: photographyProfileId,
      description: PHOTOGRAPHY_PROFILES[photographyProfileId]?.description ?? photographyProfileId,
      prompt: PHOTOGRAPHY_PROFILES[photographyProfileId]?.prompt ?? photographyProfileId,
    },
  };
}

function blendWeights(groups: string[], table: Record<string, Record<string, number>>, bandKeys: string[]): Record<string, number> {
  const result: Record<string, number> = Object.fromEntries(bandKeys.map((b) => [b, 0]));
  for (const g of groups) {
    const row = table[g];
    if (!row) continue;
    for (const b of bandKeys) result[b] += row[b] ?? 0;
  }
  const n = groups.length || 1;
  for (const b of bandKeys) result[b] = Math.max(1, result[b] / n);
  return result;
}

/** Same template, seed and salt always give the same prompt. The salt is required: there is no ambient one to fall back on. */
export function buildPrompt(template: string, seed: number, salt: string): string {
  const { values } = samplePortrait(seed, salt);
  return template.replace(/\{(\w+)\}/g, (_, k) => values[k]);
}

/** The complete text sent to Gemini; the caller supplies the salt and cached Prompt template. */
export function composePrompt(template: string, negative: string, seed: number, salt: string, useNegative = false): string {
  const prompt = `Generate an image. ${buildPrompt(template, seed, salt).trim()}`;
  return useNegative ? `${prompt}\n\nAvoid: ${negative}.` : prompt;
}
export const SAMPLER_TABLES = {
  pools,
  detailPools,
  derivedPlaceholders,
  MAX_DETAILS,
  MIX_RATE,
  NO_DETAILS,
  genderWeights: GENDER_WEIGHTS,
  GENDER_WEIGHTS,
  ethnicityGroups,
  groupWeights: GROUP_WEIGHTS,
  GROUP_WEIGHTS,
  skinBands: SKIN_BANDS,
  SKIN_BANDS,
  eyeBands: EYE_BANDS,
  EYE_BANDS,
  skinBandWeights: SKIN_BAND_WEIGHTS,
  SKIN_BAND_WEIGHTS,
  eyeBandWeights: EYE_BAND_WEIGHTS,
  EYE_BAND_WEIGHTS,
  ageRules: AGE_RULES,
  AGE_RULES,
  GRAY_HAIR,
  backgroundSettings: BACKGROUND_SETTINGS,
  BACKGROUND_SETTINGS,
  lightingAllowedSettings: LIGHTING_ALLOWED_SETTINGS,
  LIGHTING_ALLOWED_SETTINGS,
  backgroundLightingExclusions: BACKGROUND_LIGHTING_EXCLUSIONS,
  BACKGROUND_LIGHTING_EXCLUSIONS,
  lightNaturalHairEntries: LIGHT_NATURAL_HAIR_ENTRIES,
  LIGHT_NATURAL_HAIR_ENTRIES,
  lightNaturalHairFactors: LIGHT_NATURAL_HAIR_FACTORS,
  LIGHT_NATURAL_HAIR_FACTORS,
  photographyProfiles: PHOTOGRAPHY_PROFILES,
  PHOTOGRAPHY_PROFILES,
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function samplerHash(tables: unknown = SAMPLER_TABLES): string {
  return sha256Hex(canonicalJson(tables)).slice(0, 12);
}
export const computeSamplerHash = samplerHash;

export function templateHash(text: string): string {
  return sha256Hex(text).slice(0, 12);
}
export const computeTemplateHash = templateHash;
export const TEMPLATE_HASH = templateHash;
