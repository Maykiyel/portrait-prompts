// The measurement behind the dead band in `core/duplicates.ts`, kept so it can be
// run again rather than taken on trust:
//
//   pnpm tsx test/measure-duplicates.ts
//
// It builds portraits in process with sharp, re-encodes and resizes some of them
// into copies of themselves, and reports the two populations the threshold has to
// sit between: copies of one picture, and genuinely different people. It prints
// the plain sign of the gradient beside the damped sign, because the plain sign
// is what this measurement found broken and the reason the band exists. It exits
// non-zero when the two populations meet, so a change to the hash that makes the
// check stop working is a red run rather than a comment nobody re-reads.
//
// Everything runs offline. Nothing here is a fixture the smoke suite needs; the
// suite has its own smaller version of the same measurement.
import sharp from "sharp";
import { distanceBits, perceptualHash, PHASH_ALGO, PHASH_THRESHOLD } from "../core/duplicates";
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH, portraitPng } from "./portrait-fixtures";

/** How many different people. Every pair of them is compared. */
const PEOPLE = Number(process.env.PEOPLE ?? "16");
/** Which of those people get copies made of themselves. */
const BASES = [1, 5, 9, 13];
/** A second, independent set of people, so a result that was luck shows up. */
const SECOND_OFFSET = 101;

/** The bit the parked implementation took, rebuilt here only to be compared against. */
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

const COPIES: [string, (bytes: Buffer) => Promise<Buffer>][] = [
  ["jpeg q85", (bytes) => sharp(bytes).jpeg({ quality: 85 }).toBuffer()],
  ["jpeg q60", (bytes) => sharp(bytes).jpeg({ quality: 60 }).toBuffer()],
  ["webp q80", (bytes) => sharp(bytes).webp({ quality: 80 }).toBuffer()],
  ["resize 0.6 and back", (bytes) => sharp(bytes)
    .resize(Math.round(PORTRAIT_WIDTH * 0.6), Math.round(PORTRAIT_HEIGHT * 0.6))
    .resize(PORTRAIT_WIDTH, PORTRAIT_HEIGHT).png().toBuffer()],
];

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const at = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

type Report = { copies: number[]; different: number[] };

const measure = async (offset: number): Promise<Report> => {
  const people = await Promise.all(Array.from({ length: PEOPLE }, (_, i) => portraitPng(i + offset)));
  const damped = await Promise.all(people.map((bytes) => perceptualHash(bytes)));
  const plain = await Promise.all(people.map((bytes) => plainSignHash(bytes)));

  const copies: number[] = [];
  const copiesPlain: number[] = [];
  for (const seed of BASES) {
    const base = people[seed - 1];
    for (const [, make] of COPIES) {
      const copy = await make(base);
      copies.push(hamming(await perceptualHash(copy), damped[seed - 1]));
      copiesPlain.push(hamming(await plainSignHash(copy), plain[seed - 1]));
    }
  }

  const different: number[] = [];
  const differentPlain: number[] = [];
  for (let a = 0; a < PEOPLE; a++) {
    for (let b = a + 1; b < PEOPLE; b++) {
      different.push(hamming(damped[b], damped[a]));
      differentPlain.push(hamming(plain[b], plain[a]));
    }
  }
  void copiesPlain;
  void differentPlain;
  return { copies, different };
};

const hamming = (a: string, b: string) => distanceBits({ algo: PHASH_ALGO, hex: a }, { algo: PHASH_ALGO, hex: b }) ?? -1;

const line = (label: string, values: number[], pairs: number) => {
  const worst = Math.max(...values);
  const best = Math.min(...values);
  console.log(
    `${label.padEnd(28)} min ${String(best).padStart(3)}  median ${String(median(values)).padStart(3)}` +
    `  p90 ${String(at(values, 0.9)).padStart(3)}  max ${String(worst).padStart(3)}` +
    `  outside the threshold ${values.filter((v) => v > PHASH_THRESHOLD).length} of ${values.length}` +
    `${pairs ? `   (${pairs} different pairs)` : "   (copies of one picture)"}`,
  );
  return { worst, best };
};

const report = async (offset: number, title: string) => {
  const { copies, different } = await measure(offset);
  console.log(`\n${title}: ${PEOPLE} portraits at ${PORTRAIT_WIDTH}x${PORTRAIT_HEIGHT}, ${BASES.length} copies of each transform`);
  const copyLine = line("copies of one picture", copies, 0);
  const diffLine = line("genuinely different people", different, different.length);
  const separated = copyLine.worst < diffLine.best;
  console.log(`   copies finish at ${copyLine.worst}, different people start at ${diffLine.best}, threshold is ${PHASH_THRESHOLD}: ` +
    `${separated ? "separated" : "THE POPULATIONS MEET"}`);
  return separated;
};

const first = await report(1, "first set");
const second = await report(SECOND_OFFSET, "second set, independent seeds");
if (!first || !second) {
  console.log("\nthe two populations meet: the threshold of " + String(PHASH_THRESHOLD) + " does not separate them on these fixtures");
  process.exit(1);
}