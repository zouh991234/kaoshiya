<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BarChart3, BookOpen, LayoutDashboard, LogOut, Menu, Settings, UserRound, X } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import ThemeMenu from './ThemeMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { useCan } from '@/composables/useCan'
import { PERMS } from '@kaoshiya/shared'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { can } = useCan()

const userMenuOpen = ref(false)
const mobileOpen = ref(false)
const userRoot = ref<HTMLElement | null>(null)

const siteName = computed(() => auth.me?.settings.siteName ?? '考试鸭')
const displayName = computed(() => auth.me?.user.displayName ?? '')
const showAdmin = computed(() => can(PERMS.USER_READ) || can(PERMS.ROLE_READ) || can(PERMS.SETTINGS_WRITE) || can(PERMS.AUDIT_READ) || can(PERMS.DATA_BACKUP))
const showStats = computed(() => can(PERMS.STATS_SELF))

const navItems = computed(() => {
  const items: { to: string; label: string; icon: typeof BookOpen }[] = [{ to: '/', label: '题库', icon: BookOpen }]
  if (showStats.value) items.push({ to: '/stats', label: '统计', icon: BarChart3 })
  if (showAdmin.value) items.push({ to: '/admin', label: '管理后台', icon: LayoutDashboard })
  return items
})

function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}

async function logout(): Promise<void> {
  userMenuOpen.value = false
  mobileOpen.value = false
  await auth.logout()
  await router.replace('/login')
}

function onClickOutside(event: MouseEvent): void {
  if (userRoot.value && !userRoot.value.contains(event.target as Node)) userMenuOpen.value = false
}
onMounted(() => document.addEventListener('click', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="topbar-inner">
        <RouterLink to="/" class="brand" aria-label="返回首页">
          <BrandMark :size="22" />
          <span class="brand-name">{{ siteName }}</span>
        </RouterLink>

        <nav class="nav" aria-label="主导航">
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="nav-link"
            :class="{ active: isActive(item.to) }"
          >
            <component :is="item.icon" :size="15" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>

        <div class="topbar-right">
          <ThemeMenu class="desktop-only" />
          <div ref="userRoot" class="user-wrap">
            <button class="user-btn" type="button" :aria-expanded="userMenuOpen" @click.stop="userMenuOpen = !userMenuOpen">
              <span class="avatar">{{ (displayName || '鸭').slice(0, 1) }}</span>
              <span class="user-name truncate">{{ displayName }}</span>
            </button>
            <div v-if="userMenuOpen" class="user-menu" role="menu">
              <div class="user-meta">
                <div class="user-meta-name">{{ displayName }}</div>
                <div class="user-meta-roles">{{ auth.me?.roles.join(' · ') }}</div>
              </div>
              <hr class="divider" />
              <RouterLink to="/me" class="menu-item" role="menuitem" @click="userMenuOpen = false">
                <UserRound :size="15" /> 我的账号
              </RouterLink>
              <RouterLink v-if="showAdmin" to="/admin" class="menu-item" role="menuitem" @click="userMenuOpen = false">
                <Settings :size="15" /> 管理后台
              </RouterLink>
              <button class="menu-item danger" type="button" role="menuitem" @click="logout">
                <LogOut :size="15" /> 退出登录
              </button>
            </div>
          </div>
          <button class="icon-btn mobile-only" type="button" aria-label="更多" @click="mobileOpen = true">
            <Menu :size="18" />
          </button>
        </div>
      </div>
    </header>

    <main class="shell-main"><slot /></main>

    <Teleport to="body">
      <div v-if="mobileOpen" class="sheet-mask" @click.self="mobileOpen = false">
        <div class="sheet" role="dialog" aria-label="更多菜单">
          <div class="sheet-head">
            <span class="sheet-title">菜单</span>
            <button class="icon-btn" type="button" aria-label="关闭" @click="mobileOpen = false"><X :size="16" /></button>
          </div>
          <RouterLink v-for="item in navItems" :key="item.to" :to="item.to" class="sheet-item" @click="mobileOpen = false">
            <component :is="item.icon" :size="16" /> {{ item.label }}
          </RouterLink>
          <RouterLink to="/me" class="sheet-item" @click="mobileOpen = false"><UserRound :size="16" /> 我的账号</RouterLink>
          <div class="sheet-section">
            <div class="sheet-section-title">外观</div>
            <ThemeMenu />
          </div>
          <button class="sheet-item danger" type="button" @click="logout"><LogOut :size="16" /> 退出登录</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 900;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}
.topbar-inner {
  max-width: var(--layout-max);
  margin: 0 auto;
  height: 54px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  gap: 18px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
}
[data-style='discreet'] .brand-name {
  font-weight: 500;
  font-size: 14px;
  color: var(--text-muted);
}
.nav {
  display: flex;
  gap: 2px;
  flex: 1;
}
.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--fs-toolbar);
}
.nav-link:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.nav-link.active {
  color: var(--text);
  background: var(--bg-subtle);
  font-weight: 600;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.user-wrap {
  position: relative;
}
.user-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 8px 0 4px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}
.user-btn:hover {
  background: var(--bg-hover);
}
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--primary);
  color: var(--primary-text);
  font-size: 12px;
  font-weight: 600;
}
.user-name {
  max-width: 96px;
  font-size: var(--fs-toolbar);
}
.user-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 200px;
  padding: 6px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 1200;
}
.user-meta {
  padding: 6px 8px;
}
.user-meta-name {
  font-size: var(--fs-toolbar);
  font-weight: 600;
}
.user-meta-roles {
  font-size: 11px;
  color: var(--text-faint);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-toolbar);
  text-align: left;
  cursor: pointer;
}
.menu-item:hover {
  background: var(--bg-hover);
}
.menu-item.danger {
  color: var(--err);
}
.shell-main {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: var(--layout-max);
  margin: 0 auto;
  padding: 20px 18px 40px;
}
.mobile-only {
  display: none;
}
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 35%);
  z-index: 1400;
  display: flex;
  justify-content: flex-end;
}
.sheet {
  width: min(82vw, 320px);
  height: 100%;
  background: var(--bg-elev);
  border-left: 1px solid var(--border);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 8px;
}
.sheet-title {
  font-weight: 600;
}
.sheet-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-body);
  text-align: left;
  cursor: pointer;
}
.sheet-item:hover {
  background: var(--bg-hover);
}
.sheet-item.danger {
  color: var(--err);
}
.sheet-section {
  padding: 10px 4px;
  border-top: 1px solid var(--border);
  margin-top: 6px;
}
.sheet-section-title {
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 6px;
}
@media (max-width: 767px) {
  .topbar-inner {
    height: 50px;
    padding: 0 12px;
    gap: 8px;
  }
  .nav {
    display: none;
  }
  .desktop-only {
    display: none;
  }
  .mobile-only {
    display: inline-flex;
  }
  .user-name {
    display: none;
  }
  .shell-main {
    padding: 14px 12px 88px;
  }
}
</style>
