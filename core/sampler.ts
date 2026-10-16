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

// Add new entries at the END of a pool. Reordering or inserting moves existing entries.
// Even an append changes what old seeds draw from that pool, because the draw is
// floor(random * length). Bump the version line in template.txt whenever a pool or the
// template changes. Pools are drawn in the order they appear here, then the optional
// details are drawn from the same random source.
export const pools: Record<string, string[]> = {
  age: ["21", "24", "27", "30", "33", "36", "39", "42", "45", "48", "52", "55", "58", "62", "65", "68", "72", "76"],
  gender: ["man", "woman", "person with an androgynous look"],
  ethnicity: [
    "Nigerian", "Filipino", "Brazilian", "Korean", "Norwegian", "Iranian", "Mexican", "Indian",
    "Ethiopian", "Japanese", "Egyptian", "Polish", "Vietnamese", "Colombian", "Turkish", "Kenyan",
    "Indonesian", "Peruvian", "Lebanese", "Irish", "Pakistani", "Ghanaian", "Thai", "Italian",
    "Chinese", "Greek", "Samoan", "Mongolian", "Moroccan", "Swedish",
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
  // Used for men only. Empty entries keep about half of them clean-shaven.
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

/**
 * Optional details. Each portrait draws zero to three of these categories and at most one
 * entry per category. They are not placeholders. They fill {features} together.
 */
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

/** Placeholders the template may use that come from the sampler rather than from a pool. */
export const derivedPlaceholders = ["features"] as const;

export const MAX_DETAILS = 3;
export const NO_DETAILS = "no prominent additional marks or accessories";
const MIN_AGE_FOR_AGE_DETAIL = 30;
const MAX_AGE_FOR_ACNE = 45;

const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];

/** Keeps a detail from contradicting or repeating what the base pools already chose. */
function fits(category: string, detail: string, v: Record<string, string>): boolean {
  const age = Number(v.age);
  if (category === "ageDetail" && age < MIN_AGE_FOR_AGE_DETAIL) return false;
  if (/acne/.test(detail) && age > MAX_AGE_FOR_ACNE) return false;
  if (/freckles/.test(detail) && /freckled/.test(v.skin)) return false;
  if (/asymmetry/.test(detail) && /asymmetrical/.test(v.lips)) return false;
  return true;
}

/** Reads as plain English: "a", "a and b", "a, b, and c". An empty list gives the fallback. */
export function formatDetails(details: string[]): string {
  if (details.length === 0) return NO_DETAILS;
  if (details.length === 1) return details[0];
  if (details.length === 2) return `${details[0]} and ${details[1]}`;
  return `${details.slice(0, -1).join(", ")}, and ${details[details.length - 1]}`;
}

function pickDetails(r: () => number, v: Record<string, string>): { category: string; text: string }[] {
  const count = Math.floor(r() * (MAX_DETAILS + 1));
  const open = Object.keys(detailPools).filter((k) => detailPools[k].some((d) => fits(k, d, v)));
  // Partial Fisher-Yates over the categories: no category is chosen twice.
  for (let i = 0; i < Math.min(count, open.length); i++) {
    const j = i + Math.floor(r() * (open.length - i));
    [open[i], open[j]] = [open[j], open[i]];
  }
  const chosen = new Set(open.slice(0, Math.min(count, open.length)));
  // Pool order, not draw order, so the sentence reads the same way for every seed.
  return Object.keys(detailPools)
    .filter((k) => chosen.has(k))
    .map((k) => ({ category: k, text: pick(r, detailPools[k].filter((d) => fits(k, d, v))) }));
}

/** Everything one seed and salt decide: the filled placeholders and the optional details behind {features}. */
export function samplePortrait(seed: number, salt: string) {
  const r = mulberry32(salt ? hash32(`${salt}:${seed}`) : seed);
  const values: Record<string, string> = {};
  for (const [k, xs] of Object.entries(pools)) values[k] = pick(r, xs);
  if (values.gender !== "man") values.facialHair = "";
  const details = pickDetails(r, values);
  values.features = formatDetails(details.map((d) => d.text));
  return { values, details };
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
