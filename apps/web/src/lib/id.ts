/**
 * 生成客户端唯一 ID。
 * 注意：crypto.randomUUID 只在安全上下文（HTTPS / localhost）可用，
 * 本服务允许以 http://IP:端口 直连访问，因此必须有降级路径。
 */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 剪贴板是否可用（HTTP 直连时不可用）。 */
export function canUseClipboard(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard) && window.isSecureContext
}
