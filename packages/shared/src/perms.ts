/**
 * 权限点唯一定义源。前后端共用，任何地方都不得再出现字符串字面量。
 * 注意：这里只做定义与纯函数计算，不含任何 IO。
 */

export const PERMS = {
  BANK_READ: 'bank:read',
  BANK_CREATE: 'bank:create',
  BANK_UPDATE: 'bank:update',
  BANK_DELETE: 'bank:delete',

  QUESTION_READ: 'question:read',
  QUESTION_IMPORT: 'question:import',
  QUESTION_UPDATE: 'question:update',
  QUESTION_DELETE: 'question:delete',
  QUESTION_REVIEW: 'question:review',

  EXAM_TAKE: 'exam:take',
  EXAM_CONFIG: 'exam:config',
  EXAM_VIEW_OTHERS: 'exam:view_others',

  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_RESETPWD: 'user:resetpwd',

  ROLE_READ: 'role:read',
  ROLE_WRITE: 'role:write',

  STATS_SELF: 'stats:self',
  STATS_ALL: 'stats:all',

  DATA_EXPORT: 'data:export',
  DATA_IMPORT: 'data:import',
  DATA_BACKUP: 'data:backup',

  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  AUDIT_READ: 'audit:read',
} as const

export type Perm = (typeof PERMS)[keyof typeof PERMS]

export const ALL_PERMS: readonly Perm[] = Object.values(PERMS)

export interface PermItem {
  key: Perm
  label: string
}

export interface PermGroup {
  key: string
  label: string
  perms: PermItem[]
}

/** 按模块分组的权限点，供前端勾选树渲染。 */
export const PERM_GROUPS: readonly PermGroup[] = [
  {
    key: 'bank',
    label: '题库',
    perms: [
      { key: PERMS.BANK_READ, label: '查看题库' },
      { key: PERMS.BANK_CREATE, label: '创建题库 / 导入题库' },
      { key: PERMS.BANK_UPDATE, label: '编辑题库' },
      { key: PERMS.BANK_DELETE, label: '删除题库' },
    ],
  },
  {
    key: 'question',
    label: '题目',
    perms: [
      { key: PERMS.QUESTION_READ, label: '查看题目' },
      { key: PERMS.QUESTION_IMPORT, label: '导入题目' },
      { key: PERMS.QUESTION_UPDATE, label: '编辑题目' },
      { key: PERMS.QUESTION_DELETE, label: '删除题目' },
      { key: PERMS.QUESTION_REVIEW, label: '校对 / 审核题目' },
    ],
  },
  {
    key: 'exam',
    label: '考试',
    perms: [
      { key: PERMS.EXAM_TAKE, label: '参加模拟考试' },
      { key: PERMS.EXAM_CONFIG, label: '配置组卷规则' },
      { key: PERMS.EXAM_VIEW_OTHERS, label: '查看他人成绩' },
    ],
  },
  {
    key: 'user',
    label: '用户',
    perms: [
      { key: PERMS.USER_READ, label: '查看用户' },
      { key: PERMS.USER_CREATE, label: '创建用户' },
      { key: PERMS.USER_UPDATE, label: '编辑用户 / 分配角色' },
      { key: PERMS.USER_DELETE, label: '删除用户' },
      { key: PERMS.USER_RESETPWD, label: '重置密码' },
    ],
  },
  {
    key: 'role',
    label: '角色',
    perms: [
      { key: PERMS.ROLE_READ, label: '查看角色' },
      { key: PERMS.ROLE_WRITE, label: '管理角色与权限' },
    ],
  },
  {
    key: 'stats',
    label: '统计',
    perms: [
      { key: PERMS.STATS_SELF, label: '查看个人统计' },
      { key: PERMS.STATS_ALL, label: '查看全局统计' },
    ],
  },
  {
    key: 'data',
    label: '数据',
    perms: [
      { key: PERMS.DATA_EXPORT, label: '导出数据' },
      { key: PERMS.DATA_IMPORT, label: '导入数据' },
      { key: PERMS.DATA_BACKUP, label: '备份与恢复' },
    ],
  },
  {
    key: 'system',
    label: '系统',
    perms: [
      { key: PERMS.SETTINGS_READ, label: '查看系统设置' },
      { key: PERMS.SETTINGS_WRITE, label: '修改系统设置' },
      { key: PERMS.AUDIT_READ, label: '查看审计日志' },
    ],
  },
]

/** 权限点中文名，用于审计与提示。 */
export const PERM_LABELS: Readonly<Record<Perm, string>> = (() => {
  const map = {} as Record<Perm, string>
  for (const group of PERM_GROUPS) {
    for (const item of group.perms) map[item.key] = item.label
  }
  return map
})()

export function isPerm(value: string): value is Perm {
  return (ALL_PERMS as readonly string[]).includes(value)
}

/** 过滤掉未知权限点，保持顺序稳定。 */
export function normalizePerms(input: readonly string[]): Perm[] {
  const set = new Set<Perm>()
  for (const raw of input) if (isPerm(raw)) set.add(raw)
  return ALL_PERMS.filter((p) => set.has(p))
}

export function hasPerm(held: readonly string[], required: Perm): boolean {
  return held.includes(required)
}

export function hasAllPerms(held: readonly string[], required: readonly string[]): boolean {
  return required.every((p) => held.includes(p))
}

/** 授予时做子集校验：不能授予自己没有的权限。 */
export function missingPerms(grantor: readonly string[], target: readonly string[]): Perm[] {
  return normalizePerms(target).filter((p) => !grantor.includes(p))
}

export const ROLE_OWNER = 'owner'
export const ROLE_ADMIN = 'admin'
export const ROLE_EDITOR = 'editor'
export const ROLE_MEMBER = 'member'
export const ROLE_GUEST = 'guest'

export interface BuiltinRoleDef {
  name: string
  description: string
  perms: readonly Perm[]
}

const READ_ONLY: Perm[] = [PERMS.BANK_READ, PERMS.QUESTION_READ, PERMS.SETTINGS_READ]

/** 5 个内置角色，与需求文档权限矩阵逐格一致。 */
export const BUILTIN_ROLES: readonly BuiltinRoleDef[] = [
  {
    name: ROLE_OWNER,
    description: '站长，拥有全部权限，不可删除、降级或禁用',
    perms: ALL_PERMS,
  },
  {
    name: ROLE_ADMIN,
    description: '管理员，拥有全部权限，但不能修改 owner',
    perms: ALL_PERMS,
  },
  {
    name: ROLE_EDITOR,
    description: '编辑，可维护题库与题目，可参加考试',
    perms: [
      PERMS.BANK_READ,
      PERMS.QUESTION_READ,
      PERMS.BANK_UPDATE,
      PERMS.QUESTION_UPDATE,
      PERMS.QUESTION_REVIEW,
      PERMS.EXAM_TAKE,
      PERMS.STATS_SELF,
      PERMS.SETTINGS_READ,
    ],
  },
  {
    name: ROLE_MEMBER,
    description: '成员，可浏览题库、刷题与考试',
    perms: [PERMS.BANK_READ, PERMS.QUESTION_READ, PERMS.EXAM_TAKE, PERMS.STATS_SELF, PERMS.SETTINGS_READ],
  },
  {
    name: ROLE_GUEST,
    description: '访客，仅能浏览公开题库',
    perms: [...READ_ONLY],
  },
]

/** 判断一组权限是否构成"角色管理 + 用户管理"的最小治理能力。 */
export const GOVERNANCE_PERMS: readonly Perm[] = [PERMS.ROLE_WRITE, PERMS.USER_UPDATE]
