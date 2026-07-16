import "server-only";
import sharp from "sharp";

// 9x8 grid — one more column than rows lets each row produce 8 left-to-right gradient
// comparisons, giving a 64-bit hash (8 rows * 8 bits). Small on purpose: this only needs to
// survive recompression/minor resizing (the tampering a lazy repeat-submission would involve),
// not be a general-purpose image fingerprint.
const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

/// Difference-hash (dHash) of an image: for each row, compares each pixel's brightness to the
/// next one — 1 if it gets brighter, 0 if not — encoded as a hex string. Two images of the same
/// scene (even re-saved by a different app, resized, or lightly cropped) land a small Hamming
/// distance apart; genuinely different images land far apart. See CLAUDE.md's proof-verification
/// architecture note — this is a deterministic backstop check, not the AI judgment layer.
export async function computeImageHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let col = 0; col < HASH_WIDTH - 1; col++) {
      const left = data[row * HASH_WIDTH + col];
      const right = data[row * HASH_WIDTH + col + 1];
      bits += left > right ? "1" : "0";
    }
  }

  // Hex-encode the 64-bit string for compact storage/comparison.
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/// Number of differing bits between two hex-encoded hashes of the same length — 0 means
/// identical, a handful means near-identical (the duplicate-detection range), large means
/// unrelated images.
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (diff > 0) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

// Empirically, dHash Hamming distances for genuinely different photos cluster well above 20 (of
// 64 bits); near-duplicates from recompression/resize/minor cropping land under ~10. Kept
// conservative (favors missing a cheat over flagging two real, different photos as duplicates).
export const DUPLICATE_HASH_THRESHOLD = 10;
