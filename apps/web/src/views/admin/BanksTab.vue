<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { BarChart3, Download, ExternalLink, Search, Trash2, Upload } from 'lucide-vue-next'
import { PERMS, QUESTION_TYPE_LABELS } from '@kaoshiya/shared'
import type { BankSummary, QuestionType } from '@kaoshiya/shared'
import ConfirmModal from '@/components/ConfirmModal.vue'
import EmptyState from '@/components/EmptyState.vue'
import Pager from '@/components/Pager.vue'
import { api, HttpError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useCan } from '@/composables/useCan'
import { useToastStore } from '@/stores/toast'

const PAGE_SIZE = 20
const auth = useAuthStore()
const toast = useToastStore()
const { can } = useCan()

const banks = ref<BankSummary[]>([])
const total = ref(0)
const page = ref(1)
const keyword = ref('')
const loading = ref(false)
const error = ref('')

const owners = ref<Record<string, string>>({})
const ownersFailed = ref(false)

const showTypes = ref(false)
const loadingTypes = ref(false)
const typeStats = ref<Record<string, string>>({})

const visBusy = ref('')
const exporting = ref(false)
const deleteTarget = ref<BankSummary | null>(null)
const deleting = ref(false)

const selfId = computed(() => auth.me?.user.id ?? '')

function errorText(err: unknown): string {
  return err instanceof HttpError ? err.message : '操作失败，请稍后再试'
}

function typeLabel(type: string): string {
  return QUESTION_TYPE_LABELS[type as QuestionType] ?? type
}

function ownerLabel(bank: BankSummary): string {
  if (bank.ownerId === selfId.value) return '我'
  return owners.value[bank.ownerId] ?? `账号 ${bank.ownerId.slice(-6)}`
}

async function loadOwners(): Promise<void> {
  if (!can(PERMS.USER_READ)) {
    ownersFailed.value = true
    return
  }
  try {
    const res = await api.users({ page: 1, pageSize: 200 })
    owners.value = Object.fromEntries(res.items.map((user) => [user.id, user.displayName || user.username]))
  } catch {
    ownersFailed.value = true
  }
}

async function loadTypeStats(): Promise<void> {
  if (loadingTypes.value || banks.value.length === 0) return
  loadingTypes.value = true
  try {
    const entries = await Promise.all(
      banks.value.map(async (bank) => {
        const detail = await api.bank(bank.id)
        const parts = Object.entries(detail.byType)
          .filter(([, count]) => count > 0)
          .map(([type, count]) => `${typeLabel(type)} ${count}`)
        return [bank.id, parts.length > 0 ? parts.join(' · ') : '暂无题目'] as const
      }),
    )
    typeStats.value = Object.fromEntries(entries)
  } catch (err) {
    toast.error(errorText(err))
  } finally {
    loadingTypes.value = false
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await api.banks({ keyword: keyword.value.trim() || undefined, page: page.value, pageSize: PAGE_SIZE })
    banks.value = res.items
    total.value = res.total
    if (showTypes.value) void loadTypeStats()
  } catch (err) {
    error.value = errorText(err)
  } finally {
    loading.value = false
  }
}

function search(): void {
  if (page.value !== 1) page.value = 1
  else void load()
}

function resetKeyword(): void {
  keyword.value = ''
  search()
}

watch(page, () => void load())
onMounted(() => {
  void load()
  void loadOwners()
})

async function toggleTypes(): Promise<void> {
  showTypes.value = !showTypes.value
  if (showTypes.value) await loadTypeStats()
}

async function changeVisibility(bank: BankSummary, event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  const next = select.value
  if (next !== 'public' && next !== 'private') return
  if (next === bank.visibility) return
  visBusy.value = bank.id
  try {
    const updated = await api.updateBank(bank.id, { visibility: next })
    banks.value = banks.value.map((item) => (item.id === updated.id ? { ...item, visibility: updated.visibility } : item))
    toast.ok(`「${bank.name}」已设为${next === 'public' ? '公开' : '私有'}`)
  } catch (err) {
    select.value = bank.visibility
    toast.error(errorText(err))
  } finally {
    visBusy.value = ''
  }
}

async function exportAll(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  try {
    const data = await api.exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `kaoshiya-export-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    toast.ok('已导出全站数据 JSON')
  } catch (err) {
    toast.error(errorText(err))
  } finally {
    exporting.value = false
  }
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  try {
    await api.deleteBank(target.id)
    toast.ok(`已删除题库「${target.name}」`)
    deleteTarget.value = null
    if (banks.value.length === 1 && page.value > 1) page.value -= 1
    else await load()
  } catch (err) {
    toast.error(errorText(err))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="stack">
    <div class="row-between">
      <div>
        <h2>题库管理</h2>
        <p class="faint small">查看全部题库、调整可见性、进入题库维护或导入题目。</p>
      </div>
      <div v-if="can(PERMS.DATA_EXPORT)" class="row">
        <button class="btn btn-sm" type="button" :disabled="exporting" @click="exportAll">
          <Download :size="14" /> {{ exporting ? '导出中…' : '导出 JSON' }}
        </button>
      </div>
    </div>

    <form class="filters" @submit.prevent="search">
      <input v-model="keyword" class="input grow" type="search" placeholder="搜索题库名称、科目或描述" maxlength="80" />
      <button class="btn btn-sm" type="submit"><Search :size="14" /> 搜索</button>
      <button class="btn btn-sm btn-ghost" type="button" @click="resetKeyword">重置</button>
      <button class="btn btn-sm btn-ghost" type="button" :disabled="loadingTypes || banks.length === 0" @click="toggleTypes">
        <BarChart3 :size="14" /> {{ showTypes ? '隐藏题型统计' : '统计题型' }}
      </button>
    </form>

    <p class="faint small">
      导出为全站数据 JSON：当前版本没有单题库导出接口，导入请进入对应题库的导入页。
    </p>
    <p v-if="ownersFailed" class="faint small">无法读取用户列表，归属列以账号 ID 显示。</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted small">正在加载题库…</p>

    <div v-if="banks.length > 0" class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>题库</th>
            <th>章节</th>
            <th>题数</th>
            <th>题型</th>
            <th>可见性</th>
            <th>归属</th>
            <th class="right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="bank in banks" :key="bank.id">
            <td>
              <div class="bank-name truncate" :title="bank.name">{{ bank.name }}</div>
              <div class="faint small truncate" :title="bank.subject || bank.description">{{ bank.subject || bank.description || '未填写科目' }}</div>
            </td>
            <td class="num">{{ bank.chapterCount }}</td>
            <td class="num">{{ bank.questionCount }}</td>
            <td class="type-cell small muted">
              <span v-if="showTypes">{{ loadingTypes ? '统计中…' : (typeStats[bank.id] ?? '—') }}</span>
              <span v-else class="faint" title="点击上方「统计题型」加载">—</span>
            </td>
            <td>
              <select
                class="select vis-select"
                :value="bank.visibility"
                :disabled="!can(PERMS.BANK_UPDATE) || visBusy === bank.id"
                :aria-label="`${bank.name} 可见性`"
                @change="changeVisibility(bank, $event)"
              >
                <option value="public">公开</option>
                <option value="private">私有</option>
              </select>
            </td>
            <td class="small muted">{{ ownerLabel(bank) }}</td>
            <td>
              <div class="acts">
                <RouterLink class="btn btn-sm" :to="`/banks/${bank.id}`" title="进入题库"><ExternalLink :size="14" /> 进入</RouterLink>
                <RouterLink
                  v-if="can(PERMS.QUESTION_IMPORT)"
                  class="btn btn-sm"
                  :to="`/banks/${bank.id}/import`"
                  title="导入题目"
                >
                  <Upload :size="14" /> 导入
                </RouterLink>
                <button
                  v-if="can(PERMS.BANK_DELETE)"
                  class="icon-btn danger"
                  type="button"
                  title="删除题库"
                  aria-label="删除题库"
                  @click="deleteTarget = bank"
                >
                  <Trash2 :size="15" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <EmptyState
      v-if="!loading && banks.length === 0 && !error"
      title="没有匹配的题库"
      description="换个关键字试试，或者在题库页新建一个题库。"
    />

    <Pager :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="page = $event" />

    <ConfirmModal
      :open="deleteTarget !== null"
      title="删除题库"
      :message="deleteTarget ? `将永久删除题库「${deleteTarget.name}」及其全部题目、章节与学习进度，此操作不可撤销。` : ''"
      :require-input="deleteTarget?.name ?? ''"
      confirm-text="删除"
      danger
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
}
.table {
  min-width: 900px;
}
.table .right {
  text-align: right;
}
.bank-name {
  font-weight: 600;
  max-width: 220px;
}
.type-cell {
  max-width: 200px;
}
.vis-select {
  width: auto;
  min-width: 88px;
}
.acts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.icon-btn.danger:hover:not(:disabled) {
  color: var(--err);
  background: var(--err-bg);
}
</style>
