<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FolderPlus, Search, Upload } from 'lucide-vue-next'
import type { BankSummary } from '@kaoshiya/shared'
import { PERMS } from '@kaoshiya/shared'
import AppShell from '@/components/AppShell.vue'
import EmptyState from '@/components/EmptyState.vue'
import { api, HttpError } from '@/api/client'
import { useThemeStore } from '@/stores/theme'
import { useToastStore } from '@/stores/toast'
import { useCan } from '@/composables/useCan'

const theme = useThemeStore()
const toast = useToastStore()
const router = useRouter()
const { can } = useCan()

const banks = ref<BankSummary[]>([])
const loading = ref(true)
const error = ref('')
const keyword = ref('')
const creating = ref(false)
const newBankName = ref('')
const newBankSubject = ref('')
const showCreate = ref(false)

const isDiscreet = computed(() => theme.style === 'discreet')
const canCreate = computed(() => can(PERMS.BANK_CREATE))
const filtered = computed(() => {
  const term = keyword.value.trim().toLowerCase()
  if (!term) return banks.value
  return banks.value.filter(
    (bank) =>
      bank.name.toLowerCase().includes(term) ||
      bank.subject.toLowerCase().includes(term) ||
      bank.description.toLowerCase().includes(term),
  )
})

function progressOf(bank: BankSummary): number {
  if (bank.questionCount === 0) return 0
  return Math.round((bank.seenCount / bank.questionCount) * 100)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await api.banks({ pageSize: 200 })
    banks.value = result.items
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '加载题库失败'
  } finally {
    loading.value = false
  }
}

async function createBank(): Promise<void> {
  if (!newBankName.value.trim()) {
    toast.error('请填写题库名称')
    return
  }
  creating.value = true
  try {
    const bank = await api.createBank({
      name: newBankName.value.trim(),
      subject: newBankSubject.value.trim() || undefined,
      visibility: 'private',
    })
    showCreate.value = false
    newBankName.value = ''
    newBankSubject.value = ''
    toast.ok('题库已创建')
    await router.push(`/banks/${bank.id}`)
  } catch (err) {
    toast.error(err instanceof HttpError ? err.message : '创建失败')
  } finally {
    creating.value = false
  }
}

function typeSummary(bank: BankSummary): string {
  const labels: { key: keyof BankSummary['byType']; label: string }[] = [
    { key: 'single', label: '单' },
    { key: 'multiple', label: '多' },
    { key: 'judge', label: '判' },
    { key: 'blank', label: '填' },
    { key: 'essay', label: '主' },
  ]
  const parts = labels.filter((item) => (bank.byType?.[item.key] ?? 0) > 0).map((item) => `${item.label}${bank.byType[item.key]}`)
  return parts.length ? parts.join(' ') : '—'
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

onMounted(load)
</script>

<template>
  <AppShell>
    <section class="head">
      <div>
        <h1 class="page-title">题库</h1>
        <p class="small muted">
          共 {{ banks.length }} 个题库
          <template v-if="!isDiscreet"> · 今天也来几道吧</template>
        </p>
      </div>
      <div class="head-actions">
        <label class="search">
          <Search :size="15" />
          <input v-model="keyword" class="search-input" type="search" placeholder="搜索题库" aria-label="搜索题库" />
        </label>
        <template v-if="canCreate">
          <button class="btn" type="button" @click="showCreate = true">
            <FolderPlus :size="15" /> 新建题库
          </button>
        </template>
      </div>
    </section>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>

    <div v-if="loading" class="skeletons">
      <div v-for="i in 3" :key="i" class="skeleton card" />
    </div>

    <EmptyState
      v-else-if="filtered.length === 0"
      :title="banks.length === 0 ? '还没有题库' : '没有匹配的题库'"
      :description="banks.length === 0 ? '由具备「导入题库」权限的账号从 Word / PDF / Excel / CSV / TXT / Markdown / JSON 导入，或手动新建空题库。' : '换个关键词试试。'"
    >
      <button v-if="canCreate && banks.length === 0" class="btn btn-primary" type="button" @click="showCreate = true">
        <FolderPlus :size="15" /> 新建题库
      </button>
    </EmptyState>

    <!-- 常规主题：卡片 -->
    <div v-else-if="!isDiscreet" class="cards">
      <article v-for="bank in filtered" :key="bank.id" class="card bank-card">
        <header class="bank-head">
          <RouterLink :to="`/banks/${bank.id}`" class="bank-name truncate">{{ bank.name }}</RouterLink>
          <span v-if="bank.visibility === 'private'" class="badge">私有</span>
        </header>
        <p class="bank-sub small muted truncate">{{ bank.subject || '未填写科目' }}</p>
        <div class="meta small">
          <span class="num">{{ bank.questionCount }} 题</span>
          <span class="dot">·</span>
          <span class="num">{{ bank.chapterCount }} 章</span>
          <span class="dot">·</span>
          <span class="num">{{ bank.favoriteCount }} 收藏</span>
        </div>
        <div class="progress-row">
          <span class="progress"><span :style="{ width: `${progressOf(bank)}%` }" /></span>
          <span class="small num muted">{{ progressOf(bank) }}%</span>
        </div>
        <div class="bank-foot">
          <span class="small faint">最近 {{ fmtDate(bank.lastStudiedAt) }}</span>
          <div class="row">
            <RouterLink :to="`/banks/${bank.id}`" class="btn btn-sm">进入</RouterLink>
            <RouterLink v-if="bank.seenCount > 0" :to="`/banks/${bank.id}/practice?mode=continue`" class="btn btn-sm btn-primary">
              继续
            </RouterLink>
            <RouterLink v-else :to="`/banks/${bank.id}/practice`" class="btn btn-sm btn-primary">开始</RouterLink>
          </div>
        </div>
      </article>
    </div>

    <!-- 低调主题：紧凑表格 -->
    <div v-else class="card table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>题型</th>
            <th class="col-num">题数</th>
            <th class="col-num">进度</th>
            <th class="col-num">最近</th>
            <th class="col-act">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="bank in filtered" :key="bank.id">
            <td>
              <RouterLink :to="`/banks/${bank.id}`" class="name-link">{{ bank.name }}</RouterLink>
              <span class="small faint">{{ bank.subject }}</span>
            </td>
            <td class="small muted">{{ typeSummary(bank) }}</td>
            <td class="col-num num">{{ bank.questionCount }}</td>
            <td class="col-num">
              <span class="mini-progress"><span :style="{ width: `${progressOf(bank)}%` }" /></span>
              <span class="num small">{{ progressOf(bank) }}%</span>
            </td>
            <td class="col-num small muted num">{{ fmtDate(bank.lastStudiedAt) }}</td>
            <td class="col-act">
              <RouterLink :to="`/banks/${bank.id}`" class="btn btn-sm">进入</RouterLink>
              <RouterLink :to="`/banks/${bank.id}/practice`" class="btn btn-sm">刷题</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="canCreate && banks.length > 0" class="import-hint small muted">
      <Upload :size="14" />
      通过题库详情页的「导入题库」上传文档，解析与校对在你自己的浏览器里完成。
    </div>

    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <div class="card modal-box">
        <h3>新建题库</h3>
        <div class="field">
          <label class="field-label">题库名称</label>
          <input v-model="newBankName" class="input" type="text" placeholder="例如：低压电工证 · 理论" />
        </div>
        <div class="field">
          <label class="field-label">科目（可选）</label>
          <input v-model="newBankSubject" class="input" type="text" placeholder="例如：电工基础" />
        </div>
        <div class="row" style="justify-content: flex-end">
          <button class="btn" type="button" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" type="button" :disabled="creating" @click="createBank">
            {{ creating ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.page-title {
  font-size: var(--fs-title);
  margin-bottom: 2px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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
  width: 160px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 12px;
}
.bank-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 168px;
}
.bank-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bank-name {
  font-weight: 600;
  font-size: 15px;
}
.bank-name:hover {
  color: var(--accent-text);
}
.bank-sub {
  min-height: 18px;
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.progress-row .progress {
  flex: 1;
}
.bank-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 6px;
}
.table-wrap {
  overflow-x: auto;
}
.col-num {
  text-align: right;
  white-space: nowrap;
}
.col-act {
  text-align: right;
  white-space: nowrap;
}
.name-link {
  font-weight: 500;
  margin-right: 8px;
}
.mini-progress {
  display: inline-block;
  width: 56px;
  height: 5px;
  border-radius: 999px;
  background: var(--bg-subtle);
  overflow: hidden;
  margin-right: 8px;
  vertical-align: middle;
}
.mini-progress > span {
  display: block;
  height: 100%;
  background: var(--text-muted);
}
.import-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
}
.skeletons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 12px;
}
.skeleton {
  height: 168px;
  background: var(--bg-subtle);
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.55;
  }
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 38%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  padding: 16px;
}
.modal-box {
  width: min(100%, 420px);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
@media (max-width: 767px) {
  .head {
    align-items: stretch;
  }
  .head-actions {
    width: 100%;
  }
  .search {
    flex: 1;
  }
  .search-input {
    width: 100%;
  }
  .cards {
    grid-template-columns: 1fr;
  }
}
</style>
