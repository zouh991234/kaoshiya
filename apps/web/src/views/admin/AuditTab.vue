<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Search } from 'lucide-vue-next'
import type { AuditLogRow } from '@kaoshiya/shared'
import Pager from '@/components/Pager.vue'
import EmptyState from '@/components/EmptyState.vue'
import { api, HttpError } from '@/api/client'

const items = ref<AuditLogRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 50
const loading = ref(true)
const error = ref('')
const keyword = ref('')
const targetType = ref('')
const from = ref('')
const to = ref('')
const expanded = ref<Set<string>>(new Set())

const targetTypes = [
  { value: '', label: '全部对象' },
  { value: 'user', label: '用户' },
  { value: 'role', label: '角色' },
  { value: 'bank', label: '题库' },
  { value: 'question', label: '题目' },
  { value: 'settings', label: '设置' },
  { value: 'backup', label: '备份' },
  { value: 'data', label: '数据' },
  { value: 'exam', label: '考试' },
]

const hasFilter = computed(() => Boolean(keyword.value || targetType.value || from.value || to.value))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await api.audit({
      keyword: keyword.value.trim() || undefined,
      targetType: targetType.value || undefined,
      from: from.value ? `${from.value}T00:00:00.000Z` : undefined,
      to: to.value ? `${to.value}T23:59:59.999Z` : undefined,
      page: page.value,
      pageSize,
    })
    items.value = result.items
    total.value = result.total
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '读取审计日志失败'
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void load()
}

function reset(): void {
  keyword.value = ''
  targetType.value = ''
  from.value = ''
  to.value = ''
  page.value = 1
  void load()
}

function setPage(next: number): void {
  page.value = next
  void load()
}

function fmtTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function toggle(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function pretty(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2)
  } catch {
    return detail
  }
}

onMounted(load)
</script>

<template>
  <section class="wrap">
    <div class="head">
      <div>
        <h2 class="title">审计日志</h2>
        <p class="small muted">角色、权限、用户角色与数据类操作的全部变更记录，按时间倒序。</p>
      </div>
      <button class="btn btn-sm" type="button" :disabled="loading" @click="load"><RefreshCw :size="14" /> 刷新</button>
    </div>

    <form class="filters" @submit.prevent="search">
      <label class="search">
        <Search :size="15" />
        <input v-model="keyword" class="search-input" type="search" placeholder="搜索动作或详情" />
      </label>
      <select v-model="targetType" class="select" aria-label="对象类型">
        <option v-for="item in targetTypes" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
      <input v-model="from" class="input date" type="date" aria-label="起始日期" />
      <input v-model="to" class="input date" type="date" aria-label="结束日期" />
      <button class="btn btn-primary btn-sm" type="submit">筛选</button>
      <button v-if="hasFilter" class="btn btn-sm" type="button" @click="reset">重置</button>
    </form>

    <p v-if="error" class="field-error">{{ error }}</p>

    <div v-if="loading" class="muted small">加载中…</div>
    <EmptyState v-else-if="items.length === 0" title="没有匹配的记录" description="换一组筛选条件试试。" />

    <div v-else class="card table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>用户</th>
            <th>动作</th>
            <th>对象</th>
            <th>IP</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="String(row.id)">
            <td class="small num nowrap">{{ fmtTime(row.at) }}</td>
            <td class="small">{{ row.userName ?? '系统' }}</td>
            <td class="small"><span class="badge">{{ row.action }}</span></td>
            <td class="small mono">{{ row.targetType }}<template v-if="row.targetId"> · {{ row.targetId }}</template></td>
            <td class="small mono">{{ row.ip || '—' }}</td>
            <td class="small">
              <button class="detail-btn" type="button" @click="toggle(String(row.id))">
                {{ expanded.has(String(row.id)) ? '收起' : '查看' }}
              </button>
              <pre v-if="expanded.has(String(row.id))" class="detail">{{ pretty(row.detail) }}</pre>
            </td>
          </tr>
        </tbody>
      </table>
      <Pager :page="page" :page-size="pageSize" :total="total" @update:page="setPage" />
    </div>
  </section>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.title {
  font-size: var(--fs-body);
  font-weight: 600;
  margin-bottom: 2px;
}
.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: var(--tap);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-faint);
}
.search-input {
  border: 0;
  background: transparent;
  outline: none;
  width: 190px;
}
.select {
  width: auto;
}
.date {
  width: 150px;
}
.table-wrap {
  overflow-x: auto;
}
.nowrap {
  white-space: nowrap;
}
.detail-btn {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  font-size: var(--fs-small);
}
.detail {
  margin: 6px 0 0;
  max-width: 420px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
