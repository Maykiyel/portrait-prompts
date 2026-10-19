// Portrait fixtures for the duplicate checks, built in process with sharp so the
// smoke suite stays offline. Nothing here is a flat vector drawing: a flat fill
// has almost no cell to cell gradient, so a hash that reads gradients looks
// perfectly stable on one and tells you nothing about a photograph. These carry
// what a Provider photograph carries at the scale the hash reads it, which is
// smooth shading over a soft light, mid frequency detail across skin, hair and
// cloth, hard little features with high contrast edges, and grain over all of
// it.
//
// A profile fixes the photography: the light, the background ramp, the
// framing. Two portraits from one profile are the same kind of picture, which
// is the hard case for a duplicate check. The seed is the identity, so a
// different seed is a different person wearing the same clothes in the same
// light.
import sharp from "sharp";

export const PORTRAIT_WIDTH = 512;
export const PORTRAIT_HEIGHT = 768;

type Rng = () => number;

/** A small deterministic generator, so every run measures the same pictures. */
const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Two independent uniform draws through the Box Muller transform. */
const gauss = (rng: Rng): number => {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smooth01 = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
type Rgb = [number, number, number];

export type PhotoProfile = {
  lightAngle: number;
  lightStrength: number;
  backgroundTop: Rgb;
  backgroundBottom: Rgb;
  cloth: Rgb;
  grainSigma: number;
};

/** The one profile every fixture in the duplicate checks is shot under. */
export const STUDIO_PROFILE: PhotoProfile = {
  lightAngle: -0.6,
  lightStrength: 30,
  backgroundTop: [72, 84, 96],
  backgroundBottom: [30, 36, 44],
  cloth: [40, 48, 58],
  grainSigma: 2.4,
};

/** A soft elliptical mask: one well inside, zero well outside, smooth across the rim. */
const mask = (
  x: number, y: number, cx: number, cy: number, rx: number, ry: number, feather: number,
): number => {
  const d = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
  return 1 - smooth01((d - (1 - feather)) / (2 * feather));
};

/** One portrait, as PNG bytes. The seed picks the person; the profile picks the light. */
export const portraitPng = async (
  seed: number,
  profile: PhotoProfile = STUDIO_PROFILE,
  width = PORTRAIT_WIDTH,
  height = PORTRAIT_HEIGHT,
): Promise<Buffer> => {
  const rng = mulberry32(seed * 7919 + 13);

  // Framing is shared by everybody in the profile. Identity is not.
  const headCx = width * (0.5 + (rng() - 0.5) * 0.03);
  const headCy = height * (0.355 + (rng() - 0.5) * 0.03);
  const headRx = width * (0.2 + rng() * 0.035);
  const headRy = headRx * (1.2 + rng() * 0.14);
  const hairRx = headRx * (1.12 + rng() * 0.14);
  const hairRy = headRy * (1.08 + rng() * 0.12);
  const shoulderCy = height * (0.74 + (rng() - 0.5) * 0.03);
  const shoulderRx = width * (0.4 + rng() * 0.06);
  const lightSigma = width * 0.34;

  const skin: Rgb = [142 + rng() * 80, 96 + rng() * 62, 76 + rng() * 54];
  const hair: Rgb = [16 + rng() * 44, 14 + rng() * 36, 16 + rng() * 40];
  const cloth: Rgb = [
    profile.cloth[0] + (rng() - 0.5) * 26,
    profile.cloth[1] + (rng() - 0.5) * 26,
    profile.cloth[2] + (rng() - 0.5) * 26,
  ];

  const eyeY = headCy - headRy * 0.12;
  const eyeDx = headRx * (0.33 + rng() * 0.06);
  const eyeW = headRx * (0.14 + rng() * 0.03);
  const eyeH = headRy * (0.04 + rng() * 0.012);
  const browY = eyeY - headRy * (0.12 + rng() * 0.02);
  const browW = headRx * (0.2 + rng() * 0.04);
  const browH = headRy * (0.018 + rng() * 0.008);
  const eyeShift = (rng() - 0.5) * headRx * 0.05;
  const mouthY = headCy + headRy * (0.4 + rng() * 0.04);
  const mouthW = headRx * (0.26 + rng() * 0.07);
  const mouthH = headRy * (0.024 + rng() * 0.01);

  const skinAmp = 0.03 * (0.7 + rng() * 0.6);
  const hairAmp = 0.1 * (0.7 + rng() * 0.6);
  const clothAmp = 0.028 * (0.7 + rng() * 0.6);
  const mottleAmp = 0.02 + rng() * 0.02;
  const mottleA = 0.004 + rng() * 0.006;
  const mottleB = 0.006 + rng() * 0.008;
  const mottlePhase = rng() * Math.PI * 2;
  const foldPhase = rng() * Math.PI * 2;
  const grainSigma = profile.grainSigma * (0.85 + rng() * 0.3);
  const chromaSigma = 0.8 + rng() * 1.2;

  const lx = headCx - Math.cos(profile.lightAngle) * width * 0.22;
  const ly = headCy - Math.sin(profile.lightAngle) * height * 0.16;
  const sx = headCx + (lx - headCx) * 0.28;
  const sy = headCy + (ly - headCy) * 0.28;

  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ramp = smooth01(clamp01(0.5 + 0.5 * (
        ((x / width) - 0.5) * Math.cos(profile.lightAngle) +
        ((y / height) - 0.5) * Math.sin(profile.lightAngle)) * 1.6));
      const light = Math.exp(-(
        ((x - lx) ** 2 + (y - ly) ** 2) / (2 * lightSigma * lightSigma))) * profile.lightStrength;
      const vignette = 1 - 0.45 * clamp01(((((x / width) - 0.5) ** 2) * 1.6 +
        (((y / height) - 0.5) ** 2) * 1.1) * 2.2);

      let r = lerp(profile.backgroundTop[0], profile.backgroundBottom[0], ramp) + light;
      let g = lerp(profile.backgroundTop[1], profile.backgroundBottom[1], ramp) + light;
      let b = lerp(profile.backgroundTop[2], profile.backgroundBottom[2], ramp) + light;

      const hairMask = mask(x, y, headCx, headCy - headRy * 0.06, hairRx, hairRy, 0.22);
      const headMask = mask(x, y, headCx, headCy, headRx, headRy, 0.14);
      const shoulderMask = mask(x, y, headCx, shoulderCy, shoulderRx, height * 0.46, 0.3);

      r = lerp(r, hair[0], hairMask * 0.95);
      g = lerp(g, hair[1], hairMask * 0.95);
      b = lerp(b, hair[2], hairMask * 0.95);

      const shade = 1 + 0.55 * (1 - clamp01(Math.sqrt(
        ((x - sx) / headRx) ** 2 + ((y - sy) / (headRy * 1.05)) ** 2)));
      const neckMask = mask(x, y, headCx, headCy + headRy * 0.95, headRx * 0.5, headRy * 0.4, 0.4);

      r = lerp(r, clamp01((skin[0] * shade) / 255) * 255, headMask * 0.97);
      g = lerp(g, clamp01((skin[1] * shade) / 255) * 255, headMask * 0.97);
      b = lerp(b, clamp01((skin[2] * shade) / 255) * 255, headMask * 0.97);

      r = lerp(r, skin[0] * 0.82, neckMask * 0.8);
      g = lerp(g, skin[1] * 0.82, neckMask * 0.8);
      b = lerp(b, skin[2] * 0.82, neckMask * 0.8);

      r = lerp(r, cloth[0], shoulderMask * 0.96);
      g = lerp(g, cloth[1], shoulderMask * 0.96);
      b = lerp(b, cloth[2], shoulderMask * 0.96);

      const fold = 0.5 + 0.5 * Math.sin((x / width) * 9 + (y / height) * 5 + foldPhase);
      const foldShade = 1 + shoulderMask * 0.16 * (fold - 0.5);
      r *= foldShade;
      g *= foldShade;
      b *= foldShade;

      const feature = Math.max(
        mask(x, y, headCx - eyeDx + eyeShift, eyeY, eyeW, eyeH, 0.5),
        mask(x, y, headCx + eyeDx + eyeShift, eyeY, eyeW, eyeH, 0.5),
        mask(x, y, headCx - eyeDx + eyeShift, browY, browW, browH, 0.5),
        mask(x, y, headCx + eyeDx + eyeShift, browY, browW, browH, 0.5),
      );
      const featureMask = clamp01(feature * 0.9 + mask(x, y, headCx, mouthY, mouthW, mouthH, 0.6) * 0.7)
        * headMask;
      r = lerp(r, 20, featureMask);
      g = lerp(g, 19, featureMask);
      b = lerp(b, 21, featureMask);

      // Mid frequency detail. A photograph is not a smooth ramp once it is
      // reduced to twenty samples across, so grain alone does not stand in for
      // what a real face carries at that scale.
      const detail = 1
        + headMask * skinAmp * (Math.sin(x * 0.21 + Math.sin(y * 0.13) * 2.1 + mottlePhase) *
          Math.cos(y * 0.17 - x * 0.05) + 0.7 * Math.sin(x * 0.09 - y * 0.11 + mottlePhase * 1.7) +
          0.5 * Math.cos(x * 0.31 + y * 0.27))
        + hairMask * hairAmp * (Math.sin(x * 0.55 + Math.sin(y * 0.09) * 3) * Math.sin(y * 0.11 + foldPhase))
        + shoulderMask * clothAmp * (Math.sin(x * 0.62) * Math.sin(y * 0.58));
      const mottle = 1 + mottleAmp * (Math.sin(x * mottleA + mottlePhase) * Math.sin(y * mottleB)
        + 0.6 * Math.sin((x + y) * mottleA * 0.7));
      const shadeAll = vignette * mottle * detail;

      r = r * shadeAll + gauss(rng) * grainSigma + gauss(rng) * chromaSigma;
      g = g * shadeAll + gauss(rng) * grainSigma + gauss(rng) * chromaSigma;
      b = b * shadeAll + gauss(rng) * grainSigma + gauss(rng) * chromaSigma;

      const at = (y * width + x) * 3;
      raw[at] = Math.max(0, Math.min(255, Math.round(r)));
      raw[at + 1] = Math.max(0, Math.min(255, Math.round(g)));
      raw[at + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
};

/** A very smooth ramp, for the damping checks that need a gradient of known size. */
export const flatRampPng = async (
  slope: number,
  width = PORTRAIT_WIDTH,
  height = PORTRAIT_HEIGHT,
): Promise<Buffer> => {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.max(0, Math.min(255, Math.round(120 + slope * (x / width))));
      const at = (y * width + x) * 3;
      raw[at] = value;
      raw[at + 1] = value;
      raw[at + 2] = value;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
};