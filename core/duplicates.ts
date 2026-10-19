import sharp from "sharp";

/**
 * The name of the perceptual hash this module makes, stamped beside every hash it
 * produces.
 *
 * Two hashes are only ever compared when they carry the same name. The archive
 * from the previous phase stored an 8x8 average hash under a different name, and
 * comparing that against a hash made here would produce a number that means
 * nothing at all: the two do not have bits in common. So the name travels with
 * the hash, and a reader that finds a different one knows the stored hash has to
 * be recomputed from the pixels rather than compared.
 */
export const PHASH_ALGO = "gradient-16x16-damped";

/** How many bits the hash carries. A 16x16 grid of cells gives one bit per cell. */
export const PHASH_BITS = 256;

/** How many characters of hex that is, four bits to a character. */
export const PHASH_HEX_LENGTH = PHASH_BITS / 4;

/**
 * The bit distance at which two perceptual hashes are called near duplicates.
 *
 * This is the default the pipeline records and the starting point a run or an
 * import can override. It has not been calibrated on real frames, and the
 * measurement behind the damped sign below was taken on drawn portraits, which
 * sit in the opposite direction from a Provider's photographs: they are smoother
 * at the scale the hash reads, so a real set is expected to separate further than
 * the numbers in that comment. Calibrating it on real frames is the measurement
 * still to be done, and it belongs to whoever has a generated archive.
 */
export const PHASH_THRESHOLD = 12;

/**
 * The width of the dead band around zero, in levels of an 8 bit greyscale sample.
 *
 * Where it comes from, and why it is a band with a reading inside it rather than
 * a threshold:
 *
 * A re-encode moves each greyscale sample by about half a level on average, and a
 * little over two levels at the ninetieth percentile, with a tail to fifty levels
 * where a hard little feature rings. The cell to cell gradient is a difference of
 * three samples, so it moves by about one level at the median. Where the gradient
 * is smaller than that, the bit is decided by rounding rather than by the picture
 * and a re-encode flips it at close to random. Measured on the drawn portraits in
 * `test/measure-duplicates.ts`, at one sample per cell the parked sign gave copies
 * of one picture 21 to 32 bits from that picture, while genuinely different people
 * in the same studio lighting started at 18. Ten or eleven of sixteen copies fell
 * outside the threshold of twelve. The populations overlapped, so no constant
 * separated them.
 *
 * The obvious repair, one threshold at a positive number instead of at zero, was
 * measured and does not work. It moves the boundary rather than removing it: the
 * bit now flips wherever the gradient sits near the new threshold instead of near
 * zero, and the gradient field is densest near the middle of its range. Measured
 * across the same portraits, moving the threshold to one, two, three, four, five,
 * six, eight and ten levels left the copies between six and sixteen bits. It was
 * no better at any of them.
 *
 * What is here instead is a band with a reading inside it. Outside the band the
 * near gradient decides, so a cell with a real slope keeps the fine reading that
 * tells two people apart. Inside the band the near gradient cannot decide, and the
 * same question is asked again over a wider baseline: the four cells to the right
 * and the four below instead of the one. A wider baseline multiplies the signal by
 * four and leaves the noise where it was, so the cells that could not be decided
 * locally are decided by a reading that has four times the margin.
 *
 * Six levels is what the measurement chose. It sits above the ninety ninth
 * percentile of the near gradient change under every transform measured, so most
 * of the cells that used to flip on rounding alone never reach a decision boundary
 * at all, and it leaves the cells with a genuine slope to the fine reading. Bands
 * of four, five, six, seven and eight were measured over two independent sets of
 * sixteen portraits, and the results were flat to within one bit: every band in
 * that range left at most one of sixteen copies outside the threshold and at most
 * one different pair inside it. Six is the middle of the range that works, not a
 * value with an argument for its own.
 *
 * The honest limit of this measurement: on one set of sixteen portraits the
 * furthest copy came in at ten bits and the closest different pair at thirteen,
 * which is a clear gap. On a second, independent set the furthest copy came in at
 * fourteen and the closest different pair at thirteen, so the two populations
 * touched rather than separated. The dead band is a large improvement on the
 * parked sign, which missed two thirds of its copies, and it is not a proof of
 * separation. Two portraits of different people shot the same way can genuinely
 * share a coarse layout, and the minimum over a large archive is lower than the
 * minimum over sixteen portraits. A perceptual candidate is a warning and never
 * rejects anything, so that cost is a look at a frame rather than a lost one.
 *
 * Known blind spots, stated here rather than fixed, because neither is a defect
 * this hash can be made to have:
 *
 * A palette change of the same drawing is invisible to it. The hash reads greyscale
 * only, so redrawing one picture in another colour set produces the same 256 bits.
 * Two Frames that differ in nothing but palette will never be reported as a pair,
 * and no threshold changes that.
 *
 * A re-crop drifts much further than twelve bits. A crop moves every edge in the
 * frame, and the hash reads where the edges are. The parked branch measured a
 * re-crop at 26 to 39 bits, which no threshold in any plausible band could call a
 * duplicate. A re-cropped near-duplicate is not caught by this check at all.
 */
export const PHASH_DEAD_BAND = 6;

/** The side of the grid the hash is read from. */
const GRID = 16;

/** How far the second gradient reaches, in cells. Its sample grid is this much wider. */
const WIDE = 4;
const SAMPLE = GRID + WIDE;

/** Bytes as they arrive from a Provider, an import file, or a Frame on disk. */
export type ImageBytes = Buffer | Uint8Array | ArrayBuffer;

/** A hash as it is stored: the algorithm that made it beside the value itself. */
export type StoredPerceptualHash = { algo: string; hex: string };

const HEX = "0123456789abcdef";

/**
 * The popcount of every byte value there is, built once.
 *
 * The distance between two hashes is a count of differing bits, and counting them
 * by a loop over the bits is the slow way to ask a question about bytes. One table
 * of 256 entries answers it for any pair of bytes in a single index, which is what
 * makes the distance cheap enough to run over a whole archive rather than only over
 * the pairs a person thought to look at.
 */
const BIT_COUNTS = ((): Uint8Array => {
  const table = new Uint8Array(256);
  for (let value = 0; value < 256; value++) {
    let count = 0;
    for (let bit = 0; bit < 8; bit++) if (value & (1 << bit)) count++;
    table[value] = count;
  }
  return table;
})();

/** Whether a string is a hash this module wrote, judged by its shape alone. */
export function isPhashHex(hex: string): boolean {
  if (typeof hex !== "string" || hex.length !== PHASH_HEX_LENGTH) return false;
  for (const character of hex) if (!HEX.includes(character.toLowerCase())) return false;
  return true;
}

/**
 * The bytes behind a hash. Hex is a convenience for storage and for reading a
 * Manifest row, so it is decoded here rather than compared a character at a time.
 */
function decodeHex(hex: string, name: string): Uint8Array {
  if (!isPhashHex(hex)) {
    throw new TypeError(
      `${name} is not a ${PHASH_ALGO} hash: it has ${String(hex).length} characters, not ${PHASH_HEX_LENGTH} hex ones`,
    );
  }
  const bytes = new Uint8Array(PHASH_HEX_LENGTH / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * The one bit of one cell, from the gradient that is nearest and, where that is
 * too small to decide, from the gradient that reaches wider.
 *
 * The near gradient is the answer wherever its magnitude reaches the dead band.
 * Inside the band the near reading is noise, so the wide reading answers instead,
 * and a change to the near gradient alone cannot move the bit. It is exported
 * because this rule is the hash: it is what makes a damped sign a damped sign, and
 * a reader who wants to know what the band does has to be able to ask.
 */
export function dampedBit(near: number, wide: number): 0 | 1 {
  if (Math.abs(near) >= PHASH_DEAD_BAND) return near > 0 ? 1 : 0;
  return wide > 0 ? 1 : 0;
}

/**
 * The 16x16 damped gradient perceptual hash, as hex.
 *
 * The image is reduced to a single grid of greyscale samples, one wider than the
 * cells on each side so that the second gradient has somewhere to reach, and each
 * of the 16x16 cells contributes one bit. The near gradient asks whether the cell
 * is brighter along the way into it from the one sample above and the one to the
 * left than it is at its own centre. The wide gradient asks the same question of
 * the four samples over. `dampedBit` combines the two, and the dead band between
 * them is where the re-encode noise lives.
 *
 * Taking a sign at all is what makes the hash survive a change of brightness or of
 * contrast: both move every gradient in the picture by the same amount and flip
 * none of them, while a change of shape moves some of them by more than that and
 * flips those. One bit per cell is why the grid is 16x16 and not 15x15, so the
 * sample grid is a whole number and the hash stays 256 bits.
 *
 * This is not well conditioned on a picture that is very smooth anywhere. The
 * dead band is what keeps such a region from deciding itself on rounding, but a
 * region that is flat at every scale has nothing to read and no margin to read it
 * with. A Frame from a Provider is a photograph and has grain and detail at every
 * scale, so the number to watch on real data is the spread of the distances across
 * an archive, not any single one.
 */
export async function perceptualHash(bytes: ImageBytes): Promise<string> {
  const grid = await sharp(bytes)
    .greyscale()
    .resize(SAMPLE, SAMPLE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // The bit layout is a row-major walk of the 16x16 cells, packed most significant
  // bit first, so the hex reads the way the picture does: left to right, top to
  // bottom. It is fixed by this function and by nothing else.
  const packed = new Uint8Array(PHASH_BITS / 8);
  let index = 0;
  for (let row = 0; row < GRID; row++) {
    for (let column = 0; column < GRID; column++) {
      const centre = grid.data[row * SAMPLE + column];
      const near = (grid.data[row * SAMPLE + column + 1] - centre) +
        (grid.data[(row + 1) * SAMPLE + column] - centre);
      const wide = (grid.data[row * SAMPLE + column + WIDE] - centre) +
        (grid.data[(row + WIDE) * SAMPLE + column] - centre);
      if (dampedBit(near, wide)) packed[index >> 3] |= 0x80 >> (index & 7);
      index++;
    }
  }

  let hex = "";
  for (const byte of packed) hex += HEX[byte >> 4] + HEX[byte & 0x0f];
  return hex;
}

/**
 * How many bits differ between two hashes, counted a byte at a time through the
 * popcount table.
 *
 * Both arguments are the hex a Manifest row stores. Anything that is not a hash of
 * this algorithm is refused here rather than counted, because a distance between
 * two hashes that were made different ways is a number with no meaning behind it.
 */
export function hammingBits(a: string, b: string): number {
  const left = decodeHex(a, "the first hash");
  const right = decodeHex(b, "the second hash");
  let distance = 0;
  for (let i = 0; i < left.length; i++) distance += BIT_COUNTS[left[i] ^ right[i]];
  return distance;
}

/**
 * The distance between two stored hashes, or `null` when they cannot be compared.
 *
 * The null is the answer, not a failure. Two hashes are comparable only when they
 * were made by the same algorithm and are both well formed, and an artifact that
 * fails either test belongs in the check's uncomparable list rather than being
 * reported as a near duplicate of something. A caller that has to handle this is
 * the one that owns the uncomparable list; this module only says which case it is.
 */
export function distanceBits(a: StoredPerceptualHash, b: StoredPerceptualHash): number | null {
  if (a.algo !== PHASH_ALGO || b.algo !== PHASH_ALGO) return null;
  if (!isPhashHex(a.hex) || !isPhashHex(b.hex)) return null;
  return hammingBits(a.hex, b.hex);
}