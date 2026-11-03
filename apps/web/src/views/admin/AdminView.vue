<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import { useRoute } from 'vue-router'
import { BarChart3, BookOpen, DatabaseBackup, ScrollText, Settings2, ShieldCheck, Users } from 'lucide-vue-next'
import { PERMS } from '@kaoshiya/shared'
import AppShell from '@/components/AppShell.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useCan } from '@/composables/useCan'

interface AdminTab {
  name: string
  label: string
  icon: Component
  perms: string[]
}

const tabs: AdminTab[] = [
  { name: 'admin-users', label: '用户管理', icon: Users, perms: [PERMS.USER_READ] },
  { name: 'admin-roles', label: '角色管理', icon: ShieldCheck, perms: [PERMS.ROLE_READ] },
  { name: 'admin-banks', label: '题库管理', icon: BookOpen, perms: [PERMS.BANK_READ] },
  { name: 'admin-settings', label: '系统设置', icon: Settings2, perms: [PERMS.SETTINGS_WRITE] },
  { name: 'admin-backups', label: '数据备份', icon: DatabaseBackup, perms: [PERMS.DATA_BACKUP] },
  { name: 'admin-audit', label: '审计日志', icon: ScrollText, perms: [PERMS.AUDIT_READ] },
  { name: 'admin-overview', label: '概览', icon: BarChart3, perms: [PERMS.STATS_ALL] },
]

const route = useRoute()
const { canAny } = useCan()
const visibleTabs = computed(() => tabs.filter((tab) => canAny(tab.perms)))
</script>

<template>
  <AppShell>
    <div class="admin">
      <header class="admin-head">
        <h1>管理后台</h1>
        <p class="muted small">账号与权限、题库归属、系统设置与数据安全，都在这里集中处理。</p>
      </header>

      <nav class="tabs" aria-label="管理模块">
        <RouterLink
          v-for="tab in visibleTabs"
          :key="tab.name"
          :to="{ name: tab.name }"
          class="tab"
          :class="{ active: route.name === tab.name }"
        >
          <component :is="tab.icon" :size="15" />
          <span>{{ tab.label }}</span>
        </RouterLink>
      </nav>

      <section class="admin-body">
        <RouterView v-if="visibleTabs.length > 0" />
        <EmptyState v-else title="没有可用的管理模块" description="当前账号没有后台管理权限，请联系管理员分配角色。" />
      </section>
    </div>
  </AppShell>
</template>

<style scoped>
.admin {
  max-width: var(--layout-max);
  margin: 0 auto;
  padding: 22px 18px 48px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.admin-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--border);
  scrollbar-width: thin;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 11px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: var(--fs-toolbar);
  white-space: nowrap;
  flex: 0 0 auto;
}
.tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.tab.active {
  color: var(--text);
  border-bottom-color: var(--primary);
  background: var(--bg-subtle);
  font-weight: 600;
}
.admin-body {
  min-height: 240px;
}
@media (max-width: 767px) {
  .admin {
    padding: 16px 12px 40px;
  }
}
</style>
