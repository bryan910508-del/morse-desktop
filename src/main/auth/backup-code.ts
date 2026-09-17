import { randomInt } from 'node:crypto'

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
// Same format as iOS generateBackupCode: CODE- and three groups of four.
export function generateBackupCode(): string {
  const group = (): string => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('')
  return `CODE-${group()}-${group()}-${group()}`
}
