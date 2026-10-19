// The duplicate hash checks, in their own file because they change for their own
// reason: what a perceptual hash is made of, how two of them are counted apart,
// and what the hash does to a picture that has been re-encoded. Everything runs
// offline on portraits drawn in process with sharp. The file is standalone for
// now and a later ticket wires it into pnpm smoke.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import {
  dampedBit, distanceBits, hammingBits, isPhashHex, perceptualHash, PHASH_ALGO, PHASH_BITS, PHASH_DEAD_BAND,
  PHASH_HEX_LENGTH, PHASH_THRESHOLD,
} from "../core/duplicates";
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH, portraitPng } from "./portrait-fixtures";
import { check, results } from "./smoke-harness";

/** Every fixture used by the population measurement below. */
const PEOPLE = 8;
const BASES = [1, 5];

const jpegQ85 = (bytes: Buffer) => sharp(bytes).jpeg({ quality: 85 }).toBuffer();
const jpegQ60 = (bytes: Buffer) => sharp(bytes).jpeg({ quality: 60 }).toBuffer();
const webpQ80 = (bytes: Buffer) => sharp(bytes).webp({ quality: 80 }).toBuffer();
const resizeDownAndBack = (bytes: Buffer) =>
  sharp(bytes).resize(Math.round(PORTRAIT_WIDTH * 0.6), Math.round(PORTRAIT_HEIGHT * 0.6))
    .resize(PORTRAIT_WIDTH, PORTRAIT_HEIGHT).png().toBuffer();

/**
 * The bit the parked implementation took: the plain sign of the same gradient,
 * with no dead band and no wider reading. It is rebuilt here from the pixels so
 * the two readings can be put side by side on one fixture. This is not the code
 * under test, it is the thing the dead band replaced, and it is here only as the
 * other half of a comparison.
 */
const plainSignHash = async (bytes: Buffer): Promise<string> => {
  const grid = await sharp(bytes).greyscale().resize(17, 17, { fit: "fill" }).raw().toBuffer();
  const bits = new Uint8Array(32);
  let index = 0;
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      const centre = grid[row * 17 + column];
      const near = (grid[row * 17 + column + 1] - centre) + (grid[(row + 1) * 17 + column] - centre);
      if (near > 0) bits[index >> 3] |= 0x80 >> (index & 7);
      index++;
    }
  }
  let packed = "";
  for (const byte of bits) packed += byte.toString(16).padStart(2, "0");
  return packed;
};

export async function runDuplicateChecks(): Promise<void> {
  // ---- The shape of a hash ----------------------------------------------------
  const portrait = await portraitPng(1);
  const hex = await perceptualHash(portrait);

  results.push(check(
    "a perceptual hash is 64 hex characters, which is 256 bits",
    hex.length === PHASH_HEX_LENGTH && PHASH_BITS === 256 && /^[0-9a-f]{64}$/.test(hex),
  ));
  results.push(check(
    "the same bytes hashed twice give the same hash",
    hex === await perceptualHash(portrait),
  ));
  results.push(check(
    "a hash of a different picture is a different hash",
    hex !== await perceptualHash(await portraitPng(2)),
  ));
  results.push(check(
    "an image that is re-encoded and written again hashes to the same value, because the pixels are read",
    hex === await perceptualHash(Buffer.from(portrait)),
  ));

  // ---- Counting two hashes apart ----------------------------------------------
  results.push(check(
    "a hash is zero bits from itself",
    hammingBits(hex, hex) === 0 && distanceBits({ algo: PHASH_ALGO, hex }, { algo: PHASH_ALGO, hex }) === 0,
  ));

  // One character changed to another that differs in exactly one bit must read as
  // exactly one bit, which is what proves the distance is counted over bytes and
  // not over characters. Every hex character has a neighbour one bit away: xor it
  // with one and the result is still a hex character, because the low bit of a
  // hex character is the low bit of its value.
  const nibbleAt = 17;
  const original = hex[nibbleAt];
  const flipped = (parseInt(original, 16) ^ 1).toString(16);
  const oneBit = hex.slice(0, nibbleAt) + flipped + hex.slice(nibbleAt + 1);
  results.push(check(
    "one flipped nibble reads as exactly one bit",
    oneBit.length === PHASH_HEX_LENGTH && flipped !== original &&
      hammingBits(hex, oneBit) === 1 && hammingBits(oneBit, hex) === 1,
  ));

  const other = await perceptualHash(await portraitPng(3));
  results.push(check(
    "the distance between two hashes reads the same either way round",
    hammingBits(hex, other) === hammingBits(other, hex),
  ));

  const zeros = "0".repeat(PHASH_HEX_LENGTH);
  const ones = "f".repeat(PHASH_HEX_LENGTH);
  results.push(check(
    "two hashes with nothing in common are 256 bits apart, which is the most they can be",
    hammingBits(zeros, ones) === PHASH_BITS && hammingBits(ones, zeros) === PHASH_BITS,
  ));

  // ---- What is not a hash -----------------------------------------------------
  results.push(check(
    "a string that is not a hash is refused rather than counted",
    !isPhashHex("") && !isPhashHex(hex.slice(1)) && !isPhashHex(`${hex}g`) &&
      !isPhashHex(`${hex.slice(0, 63)} `) && isPhashHex(hex) && isPhashHex(hex.toUpperCase()),
  ));
  const refused = (bad: string) => {
    try {
      hammingBits(hex, bad);
      return false;
    } catch {
      return true;
    }
  };
  results.push(check(
    "a malformed hash throws when a distance is demanded of it outright",
    refused(hex.slice(1)) && refused(`${hex}g`) && refused("") && refused("zzzz"),
  ));
  results.push(check(
    "a malformed hash is uncomparable rather than a distance",
    distanceBits({ algo: PHASH_ALGO, hex }, { algo: PHASH_ALGO, hex: `${hex}g` }) === null &&
      distanceBits({ algo: PHASH_ALGO, hex: hex.slice(1) }, { algo: PHASH_ALGO, hex }) === null,
  ));
  results.push(check(
    "two hashes made by different algorithms are never compared, and the answer is null",
    distanceBits({ algo: PHASH_ALGO, hex }, { algo: "ahash-8x8-grayscale", hex }) === null &&
      distanceBits({ algo: "ahash-8x8-grayscale", hex }, { algo: PHASH_ALGO, hex }) === null &&
      distanceBits({ algo: "ahash-8x8-grayscale", hex }, { algo: "ahash-8x8-grayscale", hex }) === null,
  ));

  // ---- The damped sign --------------------------------------------------------
  // A gradient whose magnitude is at or beyond the dead band decides the bit on
  // its own, and the wide reading beside it changes nothing.
  const confident = 40;
  results.push(check(
    "a gradient at or beyond the dead band decides its own bit and ignores the wide reading",
    dampedBit(PHASH_DEAD_BAND, -confident) === 1 &&
      dampedBit(-PHASH_DEAD_BAND, confident) === 0 &&
      dampedBit(confident, -confident) === 1 && dampedBit(-confident, confident) === 0,
  ));
  // Inside the band the wide reading decides, and it decides on its own sign.
  const inside = PHASH_DEAD_BAND - 1;
  results.push(check(
    "a gradient inside the dead band cannot decide the bit, so the wide reading does",
    dampedBit(inside, 5) === 1 && dampedBit(-inside, 5) === 1 &&
      dampedBit(inside, -5) === 0 && dampedBit(-inside, -5) === 0,
  ));
  results.push(check(
    "a gradient inside the dead band that the wide reading cannot settle reads as zero, and never as an error",
    dampedBit(0, 0) === 0 && dampedBit(1, 0) === 0 && dampedBit(-1, 0) === 0,
  ));
  results.push(check(
    "the dead band is a dead band: nothing inside it can flip the bit by changing the near gradient alone",
    dampedBit(0, 6) === dampedBit(PHASH_DEAD_BAND - 1, 6) && dampedBit(0, 6) === dampedBit(-(PHASH_DEAD_BAND - 1), 6),
  ));

  // The dead band on a whole picture. The bit that the parked implementation took,
  // the plain sign of the same gradient, is rebuilt here from the same pixels so
  // that the two can be compared on the same fixture. It is the defect this band
  // was added for, so the fix is proved by showing the old reading losing a copy
  // that the new one keeps.
  const base = await portraitPng(9);
  const recompressed = await jpegQ60(base);
  const plain = await plainSignHash(base);
  const plainOfCopy = await plainSignHash(recompressed);
  const damped = hammingBits(await perceptualHash(base), await perceptualHash(recompressed));
  const plainDistance = hammingBits(plain, plainOfCopy);
  console.log(`      a jpeg q60 copy of one portrait: ${plainDistance} bits by the plain sign of the gradient, ${damped} by the damped sign`);
  results.push(check(
    "the plain sign of the gradient loses a re-encode that the damped sign keeps inside the threshold",
    plainDistance > PHASH_THRESHOLD && damped <= PHASH_THRESHOLD,
  ));

  // ---- The two populations ----------------------------------------------------
  const people = await Promise.all(Array.from({ length: PEOPLE }, (_, i) => portraitPng(i + 1)));
  const copies: [string, Buffer][] = [];
  for (const seed of BASES) {
    const person = people[seed - 1];
    copies.push([`person ${seed} as jpeg q85`, await jpegQ85(person)]);
    copies.push([`person ${seed} as jpeg q60`, await jpegQ60(person)]);
    copies.push([`person ${seed} as webp q80`, await webpQ80(person)]);
    copies.push([`person ${seed} resized to 0.6 and back`, await resizeDownAndBack(person)]);
  }
  const baseHashes = await Promise.all(BASES.map((seed) => perceptualHash(people[seed - 1])));
  const copyDistances: { label: string; bits: number }[] = [];
  for (const [index, [label, bytes]] of copies.entries()) {
    const hash = await perceptualHash(bytes);
    copyDistances.push({ label, bits: distanceBits({ algo: PHASH_ALGO, hex: baseHashes[Math.floor(index / 4)] }, { algo: PHASH_ALGO, hex: hash }) ?? -1 });
  }
  const personHashes = await Promise.all(people.map((bytes) => perceptualHash(bytes)));
  const differentDistances: number[] = [];
  for (let a = 0; a < PEOPLE; a++) {
    for (let b = a + 1; b < PEOPLE; b++) {
      const bits = distanceBits({ algo: PHASH_ALGO, hex: personHashes[a] }, { algo: PHASH_ALGO, hex: personHashes[b] });
      if (bits !== null) differentDistances.push(bits);
    }
  }
  const worstCopy = Math.max(...copyDistances.map((c) => c.bits));
  const closestDifferent = Math.min(...differentDistances);
  console.log(`      copies: ${copyDistances.map((c) => `${c.label} ${c.bits}`).join(", ")}`);
  console.log(`      copies furthest ${worstCopy}, different portraits closest ${closestDifferent}, over ${differentDistances.length} pairs`);

  results.push(check(
    "every copy of a picture lands inside the default threshold, the worst of them by more than nothing",
    copyDistances.every((c) => c.bits >= 0 && c.bits <= PHASH_THRESHOLD),
  ));
  results.push(check(
    "every genuinely different portrait lands outside the default threshold",
    differentDistances.every((bits) => bits > PHASH_THRESHOLD),
  ));
  results.push(check(
    "the two populations do not meet: the copies finish below the closest different portrait",
    worstCopy < closestDifferent,
  ));
}

// Standalone until a later ticket wires this file into pnpm smoke. Run on its own
// it reports the same way the suite does and leaves the same verdict behind it.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runDuplicateChecks();
  const pass = results.every(Boolean);
  console.log(pass ? "\nduplicate smoke checks passed" : "\nduplicate smoke checks FAILED");
  process.exit(pass ? 0 : 1);
}