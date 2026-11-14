/**
 * Keccak-f[1600] sponge, enough for EIP-55 address checksums.
 *
 * Node's OpenSSL build has SHA3-256 but not the original Keccak-256 that
 * Ethereum uses (they differ only in the padding byte), and one small function
 * is cheaper to carry than a new dependency in two lockfiles. The unit tests
 * check the SHA3 variant of this code against Node's own `sha3-256` and the
 * Keccak variant against the published test vectors.
 */

const MASK = (1n << 64n) - 1n;

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rotation offsets, indexed x + 5y. */
const ROTATIONS = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

function rotl(x: bigint, n: number): bigint {
  if (n === 0) return x;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;
}

function permute(a: bigint[]) {
  const c = new Array<bigint>(5);
  const b = new Array<bigint>(25);
  for (const rc of ROUND_CONSTANTS) {
    // θ
    for (let x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) a[x + y] ^= d;
    }
    // ρ and π
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y], ROTATIONS[x + 5 * y]);
      }
    }
    // χ
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) a[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK & b[((x + 2) % 5) + y]);
    }
    // ι
    a[0] ^= rc;
  }
}

/**
 * A 256-bit digest from the Keccak sponge (rate 136 bytes). `suffix` is the
 * domain byte: 0x01 for Keccak-256 (Ethereum), 0x06 for SHA3-256.
 */
export function sponge256(input: Uint8Array, suffix: 0x01 | 0x06): Buffer {
  const rate = 136;
  const padded = new Uint8Array(Math.floor(input.length / rate) * rate + rate);
  padded.set(input);
  padded[input.length] ^= suffix;
  padded[padded.length - 1] ^= 0x80;

  const state = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let k = 7; k >= 0; k--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + k]);
      state[i] ^= lane;
    }
    permute(state);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    let lane = state[i];
    for (let k = 0; k < 8; k++) {
      out[i * 8 + k] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

/** Ethereum's Keccak-256. */
export function keccak256(input: Uint8Array | string): Buffer {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return sponge256(bytes, 0x01);
}
