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

// Add new entries at the END of a pool. Reordering or inserting changes old seeds.
// Bump the version line in template.txt whenever a pool or the template changes.
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
  eyes: [
    "dark brown eyes", "hazel eyes", "green eyes", "gray eyes", "light brown eyes", "amber eyes",
    "blue eyes", "deep-set dark eyes", "almond-shaped brown eyes", "wide-set hazel eyes",
    "hooded brown eyes", "round dark eyes", "narrow gray-green eyes", "blue-gray eyes",
  ],
  face: [
    "a round face", "an oval face", "a square-jawed face", "a heart-shaped face", "a high-cheekboned face",
    "a long narrow face", "a broad face", "a diamond-shaped face", "a soft, full face", "a sharp-featured face",
    "a rectangular face", "a strong-chinned face", "a gaunt face", "a weathered face", "a petite-featured face",
    "a wide-jawed face",
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
  feature: [
    "light freckles across the nose", "deep laugh lines", "a faint scar through the left eyebrow",
    "a slightly crooked nose", "a small mole on the cheek", "dimples", "heavy dark eyebrows",
    "wire-rimmed glasses", "round tortoiseshell glasses", "a clear, unmarked complexion",
    "thin pale eyebrows", "a small stud earring", "crow's feet at the eyes", "a high forehead",
    "a cleft chin", "a strong nose bridge",
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

const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];

/** Same template, seed and salt always give the same prompt. The salt is required: there is no ambient one to fall back on. */
export function buildPrompt(template: string, seed: number, salt: string): string {
  const r = mulberry32(salt ? hash32(`${salt}:${seed}`) : seed);
  const v: Record<string, string> = {};
  for (const [k, xs] of Object.entries(pools)) v[k] = pick(r, xs);
  if (v.gender !== "man") v.facialHair = "";
  return template.replace(/\{(\w+)\}/g, (_, k) => v[k]);
}

/** The complete text sent to Gemini; the caller supplies the salt and cached Prompt template. */
export function composePrompt(template: string, negative: string, seed: number, salt: string, useNegative = false): string {
  const prompt = `Generate an image. ${buildPrompt(template, seed, salt).trim()}`;
  return useNegative ? `${prompt}\n\nAvoid: ${negative}.` : prompt;
}
