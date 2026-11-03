import type {
  AuditLogRow,
  Bank,
  BankSummary,
  Chapter,
  ExamConfigInput,
  ExamRecordDetail,
  ExamRecordSummary,
  ImportBatchRequest,
  ImportBatchResult,
  LoginRecordRow,
  MeResponse,
  ProgressOp,
  ProgressRow,
  PublicSettings,
  Question,
  QuestionType,
  Role,
  StatsAll,
  StatsSelf,
  UserSummary,
} from '@kaoshiya/shared'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  let payload: BodyInit | undefined
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    payload = body
    if (body instanceof Blob) headers['Content-Type'] = body.type || 'application/octet-stream'
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
    ...init,
  })
  if (response.status === 204) return undefined as T
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    const err = (data ?? {}) as { code?: string; message?: string; details?: unknown }
    throw new HttpError(response.status, err.code ?? 'HTTP_ERROR', err.message ?? `请求失败（${response.status}）`, err.details)
  }
  return data as T
}

const get = <T>(path: string): Promise<T> => request<T>('GET', path)
const post = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body)
const patch = <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body)
const put = <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body)
const del = <T>(path: string): Promise<T> => request<T>('DELETE', path)

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const api = {
  setupStatus: () => get<{ initialized: boolean }>('/setup/status'),
  setup: (body: { username: string; displayName?: string; password: string }) => post<MeResponse>('/setup', body),

  login: (body: { username: string; password: string; remember?: boolean }) => post<MeResponse>('/auth/login', body),
  logout: () => post<{ ok: true }>('/auth/logout'),
  me: () => get<MeResponse>('/me'),
  updateMe: (body: { displayName: string }) => patch<MeResponse>('/me', body),
  changePassword: (body: { oldPassword: string; newPassword: string }) => post<{ ok: true }>('/me/password', body),
  finishInitialPassword: (body: { newPassword: string }) => post<MeResponse>('/me/finish-initial-password', body),
  loginRecords: () => get<{ items: LoginRecordRow[] }>('/me/logins'),

  users: (query: { keyword?: string; roleId?: string; status?: string; page?: number; pageSize?: number } = {}) =>
    get<{ items: UserSummary[]; total: number }>(`/users${qs(query)}`),
  createUser: (body: { username: string; displayName?: string; roleIds: string[] }) =>
    post<{ user: UserSummary; initialPassword: string }>('/users', body),
  updateUser: (id: string, body: { displayName?: string; status?: 'active' | 'disabled'; username?: string }) =>
    patch<UserSummary>(`/users/${id}`, body),
  setUserRoles: (id: string, roleIds: string[]) => put<UserSummary>(`/users/${id}/roles`, { roleIds }),
  resetUserPassword: (id: string) => post<{ initialPassword: string }>(`/users/${id}/reset-password`),
  deleteUser: (id: string) => del<{ ok: true }>(`/users/${id}`),

  roles: () => get<{ items: Role[] }>('/roles'),
  permGroups: () => get<{ groups: { key: string; label: string; perms: { key: string; label: string }[] }[]; total: number }>('/perms'),
  createRole: (body: { name: string; description?: string; perms: string[] }) => post<Role>('/roles', body),
  updateRole: (id: string, body: { name?: string; description?: string; perms?: string[] }) => patch<Role>(`/roles/${id}`, body),
  duplicateRole: (id: string, name: string) => post<Role>(`/roles/${id}/duplicate`, { name }),
  deleteRole: (id: string) => del<{ ok: true }>(`/roles/${id}`),

  banks: (query: { keyword?: string; page?: number; pageSize?: number } = {}) =>
    get<{ items: BankSummary[]; total: number }>(`/banks${qs(query)}`),
  createBank: (body: { name: string; subject?: string; description?: string; visibility?: 'public' | 'private' }) =>
    post<Bank>('/banks', body),
  bank: (id: string) =>
    get<{
      bank: Bank
      chapters: Chapter[]
      byType: Record<QuestionType, number>
      total: number
      progressSummary: { seen: number; favorite: number; mastered: number }
      chapterProgress: Record<string, { seen: number; total: number }>
    }>(`/banks/${id}`),
  updateBank: (id: string, body: { name?: string; subject?: string; description?: string; visibility?: 'public' | 'private' }) =>
    patch<Bank>(`/banks/${id}`, body),
  deleteBank: (id: string) => del<{ ok: true }>(`/banks/${id}`),
  questions: (
    bankId: string,
    query: { chapterId?: string; type?: string; keyword?: string; page?: number; pageSize?: number } = {},
  ) => get<{ items: Question[]; total: number }>(`/banks/${bankId}/questions${qs(query)}`),
  practice: (
    bankId: string,
    query: { mode?: string; chapterId?: string; limit?: number } = {},
  ) =>
    get<{ questions: Question[]; progress: Record<string, ProgressRow>; chapters: Chapter[] }>(
      `/banks/${bankId}/practice${qs(query)}`,
    ),
  importBatch: (bankId: string, body: ImportBatchRequest) => post<ImportBatchResult>(`/banks/${bankId}/import`, body),
  clearBank: (bankId: string) => post<{ removed: number }>(`/banks/${bankId}/clear`),
  createQuestion: (bankId: string, body: Partial<Question> & { stem: string; type: QuestionType }) =>
    post<Question>(`/banks/${bankId}/questions`, body),
  updateQuestion: (id: string, body: Partial<Question> & { chapterName?: string | null }) =>
    patch<Question>(`/questions/${id}`, body),
  deleteQuestion: (id: string) => del<{ ok: true }>(`/questions/${id}`),
  uploadMedia: async (file: File) => {
    const buffer = await file.arrayBuffer()
    return request<{ hash: string; name: string; mime: string; size: number; url: string }>('POST', '/media', new Blob([buffer], { type: file.type }), {
      headers: { 'X-File-Name': encodeURIComponent(file.name) },
    })
  },

  progress: (bankId: string) => get<{ progress: Record<string, ProgressRow> }>(`/progress${qs({ bankId })}`),
  syncProgress: (ops: ProgressOp[]) =>
    put<{ applied: number; skipped: number; progress: Record<string, ProgressRow> }>('/progress/batch', { ops }),
  patchProgress: (questionId: string, patchBody: Partial<ProgressRow>) =>
    patch<ProgressRow>(`/progress/${questionId}`, patchBody),

  examConfigs: (bankId: string) => get<{ items: { id: string; name: string; config: ExamConfigInput }[] }>(`/exam-configs${qs({ bankId })}`),
  saveExamConfig: (body: ExamConfigInput) => post<{ id: string }>('/exam-configs', body),
  deleteExamConfig: (id: string) => del<{ ok: true }>(`/exam-configs/${id}`),
  startExam: (body: Omit<ExamConfigInput, 'id'>) =>
    post<{ examId: string; config: ExamConfigInput; questions: Question[]; startedAt: string }>('/exams', body),
  examRecords: (query: { userId?: string; bankId?: string; page?: number; pageSize?: number } = {}) =>
    get<{ items: ExamRecordSummary[]; total: number }>(`/exams${qs(query)}`),
  examRecord: (id: string) => get<ExamRecordDetail & { questions: Question[] }>(`/exams/${id}`),
  submitExam: (id: string, body: { usedSec: number; answers: { questionId: string; answer: string[]; selfGrade?: 'full' | 'partial' | 'none' | null }[] }) =>
    post<{ score: number; totalScore: number; passed: boolean; usedSec: number; rightCount: number; wrongCount: number; objectiveCount: number; subjectiveCount: number }>(
      `/exams/${id}/submit`,
      body,
    ),

  statsMe: () => get<StatsSelf>('/stats/me'),
  statsAll: () => get<StatsAll>('/stats/all'),

  overview: () => get<StatsAll & { roleCount: number; backups: number }>('/admin/overview'),
  audit: (query: { keyword?: string; userId?: string; targetType?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
    get<{ items: AuditLogRow[]; total: number }>(`/audit${qs(query)}`),
  settings: () => get<PublicSettings>('/settings'),
  saveSettings: (body: Partial<PublicSettings>) => put<PublicSettings>('/settings', body),
  backups: () => get<{ items: { id: string; createdAt: string; counts: Record<string, number>; mediaFiles: number; databaseBytes: number }[] }>('/backups'),
  backup: () => post<{ id: string; createdAt: string }>('/backup'),
  deleteBackup: (id: string) => del<{ ok: true }>(`/backups/${encodeURIComponent(id)}`),
  restoreBackup: (id: string, confirm: string) => post<{ ok: true; restarting: boolean }>('/backup/restore', { id, confirm }),
  exportData: () => get<Record<string, unknown>>('/data/export'),
  importData: (body: { bank: { name: string; subject?: string; description?: string }; questions: unknown[] }) =>
    post<{ bankId: string; imported: number }>('/data/import', body),
}

export type Api = typeof api
