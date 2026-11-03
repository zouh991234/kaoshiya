import type { ExamConfigInput, PublicSettings } from './types.js'

export const DEFAULT_SETTINGS: PublicSettings = {
  siteName: '考试鸭',
  defaultPassScore: 60,
  guestEnabled: false,
}

/**
 * 默认组卷规则：各题型抽题数、总分、及格线、时长。
 * 按当地考试改这里即可（或在前端组卷页直接改，不影响历史记录）。
 */
export const DEFAULT_EXAM_CONFIG: Omit<ExamConfigInput, 'bankId' | 'name' | 'id'> = {
  chapterIds: [],
  counts: { single: 30, multiple: 10, judge: 10, blank: 0, essay: 0 },
  totalScore: 100,
  passScore: 60,
  durationSec: 60 * 60,
  shuffle: true,
}

export const SETTINGS_KEYS = {
  SITE_NAME: 'siteName',
  DEFAULT_PASS_SCORE: 'defaultPassScore',
  GUEST_ENABLED: 'guestEnabled',
} as const

/** 分页默认值，前端表格与后端接口共用。 */
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 200

/** 导入分批：每批 100 题、gzip 后单请求 ≤ 2 MB。 */
export const IMPORT_BATCH_SIZE = 100
export const IMPORT_MAX_REQUEST_BYTES = 2 * 1024 * 1024

/** 媒体上传限制。 */
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024
export const MEDIA_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const

/** 会话滑动过期 7 天。 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 登录保护阈值。 */
export const LOGIN_IP_LIMIT = { count: 5, windowMs: 60_000 }
export const LOGIN_ACCOUNT_LIMIT = { count: 10, windowMs: 60 * 60_000, lockMs: 10 * 60_000 }

export const SESSION_COOKIE = 'kaoshiya_session'
