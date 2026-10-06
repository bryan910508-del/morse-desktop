// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { createHash, pbkdf2, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'

// Two-step verification (contracts A13 §5, A13-2): the password is proved, never sent — SRP-6a over Telegram's 2048-bit
// prime with the KDF passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow, written on the platform's own
// primitives as tdesktop does (core/core_cloud_password.cpp:59-157) and as the server checks it (morse-srp.js):
//   SH(d, s) = SHA256(s | d | s);  x = SH(PBKDF2-HMAC-SHA512(SH(SH(pw, s1), s2), s1, 100000, 64), s2)
//   v = g^x;  k = H(p | g);  A = g^a;  u = H(A | B);  S = (B − k·v)^(a + u·x);  K = H(S)
//   M1 = H(H(p) xor H(g) | H(s1) | H(s2) | A | B | K)
// Every number that is hashed is big-endian, padded to 256 bytes. The password is the UTF-8 the person typed.
export const srpPrime = BigInt('0xC71CAEB9C6B1C9048E6C522F70F13F73980D40238E3E21C14934D037563D930F48198A0AA7C14058229493D22530F4DBFA336F6E0AC925139543AED44CCE7C3720FD51F69458705AC68CD4FE6B6B13ABDC9746512969328454F18FAF8C595F642477FE96BB2A941D5BCD1D4AC8CC49880708FA9B378E3C4F3A9060BEE67CF9A4A4A695811051907E162753B56B0F6B410DBA74D8A84B2A14B3144E0EF1284754FD17ED950D5965B4B9DD46582DB1178D169C6BC465B0D6FF9CA3928FEF5B9AE4E418FC15E83EBEA0F87FA9FF5EED70050DED2849F47BF959D956850CE929851F0D8115F635B105EE2E4E15D04B2454BF6F4FADF034B10403119CD8E3B92FCC5B')
export const srpGenerator = 3n
const bytes = 256
const iterations = 100000
const pbkdf2Async = promisify(pbkdf2)

const sha256 = (...parts: Buffer[]): Buffer => createHash('sha256').update(Buffer.concat(parts)).digest()
const sh = (data: Buffer, salt: Buffer): Buffer => sha256(salt, data, salt)
export function toBytes(n: bigint, length = bytes): Buffer {
  if (n < 0n) throw new RangeError('negative')
  let hex = n.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  const raw = Buffer.from(hex, 'hex')
  if (raw.length > length) throw new RangeError('does not fit')
  return Buffer.concat([Buffer.alloc(length - raw.length), raw])
}
export const fromBytes = (buffer: Buffer): bigint => buffer.length ? BigInt(`0x${buffer.toString('hex')}`) : 0n
const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m
export function modPow(base: bigint, exponent: bigint, m: bigint): bigint {
  let result = 1n, b = mod(base, m), e = exponent
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m
    b = (b * b) % m
    e >>= 1n
  }
  return result
}

// x for a password and its salts — PBKDF2 off the main thread's event loop (libuv's pool), as it takes a moment.
export async function passwordX(password: string, salt1: Buffer, salt2: Buffer): Promise<bigint> {
  const ph1 = sh(sh(Buffer.from(password, 'utf8'), salt1), salt2)
  return fromBytes(sh(await pbkdf2Async(ph1, salt1, iterations, 64, 'sha512'), salt2))
}

// tdesktop IsGoodModExpFirst (core_cloud_password.cpp): a value and p minus it both keep at least 2048−64 bits.
const minimum = 1n << BigInt(2048 - 64)
export function goodModExp(value: bigint, p = srpPrime): boolean {
  return value > 0n && value < p && value >= minimum && p - value >= minimum
}

export interface SrpProof { A: bigint; M1: Buffer }
// The proof for a password against the server's B and a client secret a — deterministic, for the shared test values.
export async function srpProofWith(password: string, salt1: Buffer, salt2: Buffer, B: bigint, a: bigint, p = srpPrime, g = srpGenerator): Promise<SrpProof & { x: bigint; K: Buffer }> {
  if (B <= 0n || B >= p) throw new RangeError('bad B')
  const x = await passwordX(password, salt1, salt2)
  const v = modPow(g, x, p), A = modPow(g, a, p)
  const u = fromBytes(sha256(toBytes(A), toBytes(B)))
  if (u === 0n) throw new RangeError('u is zero')
  const k = fromBytes(sha256(toBytes(p), toBytes(g)))
  const S = modPow(mod(B - k * v, p), a + u * x, p), K = sha256(toBytes(S))
  const hp = sha256(toBytes(p)), hg = sha256(toBytes(g)), xor = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) xor[i] = hp[i]! ^ hg[i]!
  return { x, K, A, M1: sha256(xor, sha256(salt1), sha256(salt2), toBytes(A), toBytes(B), K) }
}

// A login's proof: B must be good, and a fresh secret is drawn until A is (tdesktop ComputeCloudPasswordCheck).
export async function srpProof(password: string, salt1: Buffer, salt2: Buffer, B: bigint): Promise<SrpProof> {
  if (!goodModExp(B)) throw new RangeError('bad B')
  for (let tries = 0; tries < 32; tries++) {
    const a = fromBytes(randomBytes(bytes))
    if (!goodModExp(modPow(srpGenerator, a, srpPrime))) continue
    const proof = await srpProofWith(password, salt1, salt2, B, a)
    return { A: proof.A, M1: proof.M1 }
  }
  throw new RangeError('no good secret')
}

// A new password's settings from the salts the server issued (Telegram new_salt1 = issued ‖ 32 bytes of the client's).
export async function newPasswordSettings(password: string, issuedSalt1: Buffer, issuedSalt2: Buffer): Promise<{ salt1: Buffer; salt2: Buffer; v: bigint }> {
  const salt1 = Buffer.concat([issuedSalt1, randomBytes(32)]), salt2 = issuedSalt2
  return { salt1, salt2, v: modPow(srpGenerator, await passwordX(password, salt1, salt2), srpPrime) }
}
