import { LOGIN_ACCOUNT_LIMIT, LOGIN_IP_LIMIT } from '@kaoshiya/shared'

/**
 * 登录保护（内存实现，单进程足够）：
 * - 同 IP 每分钟 5 次失败
 * - 同账号每小时 10 次失败 → 锁定 10 分钟
 * 公网必然遭遇爆破扫描，这层不能省。
 */

interface IpState {
  hits: number[]
}

interface AccountState {
  hits: number[]
  lockedUntil: number
}

const ipStates = new Map<string, IpState>()
const accountStates = new Map<string, AccountState>()

function trim(list: number[], windowMs: number, now: number): number[] {
  return list.filter((ts) => now - ts < windowMs)
}

export interface LoginGateResult {
  allowed: boolean
  reason?: string
}

export function checkLoginAllowed(ip: string, username: string): LoginGateResult {
  const now = Date.now()
  const account = accountStates.get(username)
  if (account && account.lockedUntil > now) {
    const minutes = Math.ceil((account.lockedUntil - now) / 60_000)
    return { allowed: false, reason: `登录失败次数过多，请 ${minutes} 分钟后再试` }
  }
  const ipState = ipStates.get(ip)
  const ipHits = ipState ? trim(ipState.hits, LOGIN_IP_LIMIT.windowMs, now) : []
  if (ipHits.length >= LOGIN_IP_LIMIT.count) {
    return { allowed: false, reason: '当前网络登录尝试过于频繁，请稍后再试' }
  }
  return { allowed: true }
}

export function recordLoginFailure(ip: string, username: string): void {
  const now = Date.now()
  const ipState = ipStates.get(ip) ?? { hits: [] }
  ipState.hits = trim(ipState.hits, LOGIN_IP_LIMIT.windowMs, now)
  ipState.hits.push(now)
  ipStates.set(ip, ipState)

  const account = accountStates.get(username) ?? { hits: [], lockedUntil: 0 }
  account.hits = trim(account.hits, LOGIN_ACCOUNT_LIMIT.windowMs, now)
  account.hits.push(now)
  if (account.hits.length >= LOGIN_ACCOUNT_LIMIT.count) {
    account.lockedUntil = now + LOGIN_ACCOUNT_LIMIT.lockMs
    account.hits = []
  }
  accountStates.set(username, account)
}

export function recordLoginSuccess(username: string): void {
  accountStates.delete(username)
}

/** 测试用：清空内存态。 */
export function resetLoginGuard(): void {
  ipStates.clear()
  accountStates.clear()
}

/** 定期清理，避免 Map 无限增长。 */
export function sweepLoginGuard(): void {
  const now = Date.now()
  for (const [ip, state] of ipStates) {
    state.hits = trim(state.hits, LOGIN_IP_LIMIT.windowMs, now)
    if (state.hits.length === 0) ipStates.delete(ip)
  }
  for (const [key, state] of accountStates) {
    state.hits = trim(state.hits, LOGIN_ACCOUNT_LIMIT.windowMs, now)
    if (state.hits.length === 0 && state.lockedUntil <= now) accountStates.delete(key)
  }
}
