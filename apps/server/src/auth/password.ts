import { Algorithm, hash, verify } from '@node-rs/argon2'

/** 生产可接受的 argon2id 参数：19 MiB / 2 轮 / 单并行，单次约 40-60ms。 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS)
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password)
  } catch {
    return false
  }
}

export interface PasswordCheck {
  ok: boolean
  reason?: string
}

/** 强度：≥ 8 位，且不能是纯数字或纯字母。 */
export function validatePasswordStrength(password: string): PasswordCheck {
  if (password.length < 8) return { ok: false, reason: '密码至少 8 位' }
  if (password.length > 128) return { ok: false, reason: '密码不能超过 128 位' }
  const isDigits = /^\d+$/.test(password)
  const isLetters = /^[A-Za-z]+$/.test(password)
  if (isDigits) return { ok: false, reason: '密码不能是纯数字' }
  if (isLetters) return { ok: false, reason: '密码不能是纯字母' }
  return { ok: true }
}
