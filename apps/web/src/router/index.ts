import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useBootStore } from '@/stores/boot'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
    perms?: string[]
    allowMustChange?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true, title: '登录' } },
  { path: '/setup', name: 'setup', component: () => import('@/views/SetupView.vue'), meta: { public: true, title: '初始化' } },
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { title: '题库' } },
  {
    path: '/banks/:id',
    name: 'bank',
    component: () => import('@/views/BankView.vue'),
    meta: { title: '题库详情', perms: ['bank:read'] },
  },
  {
    path: '/banks/:id/practice',
    name: 'practice',
    component: () => import('@/views/PracticeView.vue'),
    meta: { title: '刷题', perms: ['question:read', 'stats:self'] },
  },
  {
    path: '/banks/:id/exam',
    name: 'exam',
    component: () => import('@/views/ExamView.vue'),
    meta: { title: '模拟考试', perms: ['exam:take'] },
  },
  {
    path: '/exams/:id/result',
    name: 'exam-result',
    component: () => import('@/views/ExamResultView.vue'),
    meta: { title: '考试结果', perms: ['exam:take'] },
  },
  {
    path: '/banks/:id/import',
    name: 'import',
    component: () => import('@/views/import/ImportView.vue'),
    meta: { title: '导入题库', perms: ['question:import', 'bank:create'] },
  },
  { path: '/stats', name: 'stats', component: () => import('@/views/StatsView.vue'), meta: { title: '统计', perms: ['stats:self'] } },
  {
    path: '/me',
    name: 'me',
    component: () => import('@/views/ProfileView.vue'),
    meta: { title: '我的账号', allowMustChange: true },
  },
  {
    path: '/me/initial-password',
    name: 'change-initial-password',
    component: () => import('@/views/InitialPasswordView.vue'),
    meta: { title: '修改初始密码', allowMustChange: true },
  },
  {
    path: '/admin',
    component: () => import('@/views/admin/AdminView.vue'),
    meta: { title: '管理后台', perms: ['user:read', 'role:read', 'settings:write', 'audit:read', 'data:backup', 'stats:all'] },
    children: [
      { path: '', name: 'admin', redirect: { name: 'admin-overview' } },
      { path: 'overview', name: 'admin-overview', component: () => import('@/views/admin/OverviewTab.vue'), meta: { title: '概览', perms: ['stats:all'] } },
      { path: 'users', name: 'admin-users', component: () => import('@/views/admin/UsersTab.vue'), meta: { title: '用户管理', perms: ['user:read'] } },
      { path: 'roles', name: 'admin-roles', component: () => import('@/views/admin/RolesTab.vue'), meta: { title: '角色管理', perms: ['role:read'] } },
      { path: 'banks', name: 'admin-banks', component: () => import('@/views/admin/BanksTab.vue'), meta: { title: '题库管理', perms: ['bank:read'] } },
      { path: 'settings', name: 'admin-settings', component: () => import('@/views/admin/SettingsTab.vue'), meta: { title: '系统设置', perms: ['settings:write'] } },
      { path: 'backups', name: 'admin-backups', component: () => import('@/views/admin/BackupTab.vue'), meta: { title: '数据备份', perms: ['data:backup'] } },
      { path: 'audit', name: 'admin-audit', component: () => import('@/views/admin/AuditTab.vue'), meta: { title: '审计日志', perms: ['audit:read'] } },
    ],
  },
  { path: '/403', name: 'forbidden', component: () => import('@/views/ForbiddenView.vue'), meta: { title: '无权限' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue'), meta: { title: '页面不存在' } },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    if (to.path === from.path) return {}
    return { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const boot = useBootStore()
  const auth = useAuthStore()
  await boot.ensure()

  if (!boot.initialized) {
    return to.name === 'setup' ? true : { name: 'setup' }
  }
  if (to.name === 'setup') return { name: auth.isAuthenticated ? 'home' : 'login' }

  if (!auth.loaded) await auth.load()

  if (!auth.isAuthenticated) {
    return to.meta.public ? true : { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
  }
  if (auth.mustChangePassword && !to.meta.allowMustChange) return { name: 'change-initial-password' }
  if (to.name === 'login') return { name: 'home' }
  if (to.meta.perms && to.meta.perms.length > 0 && !auth.canAny(to.meta.perms)) return { name: 'forbidden' }
  return true
})

router.afterEach((to) => {
  const base = '考试鸭'
  document.title = to.meta.title ? `${to.meta.title} · ${base}` : base
})
