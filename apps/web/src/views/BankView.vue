<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Clock, Play, Shuffle, SlidersHorizontal, Upload } from 'lucide-vue-next'
import type { Bank, Chapter, ProgressRow, QuestionType } from '@kaoshiya/shared'
import { QUESTION_TYPE_LABELS } from '@kaoshiya/shared'
import AppShell from '@/components/AppShell.vue'
import EmptyState from '@/components/EmptyState.vue'
import { api, HttpError } from '@/api/client'
import { useCan } from '@/composables/useCan'

const route = useRoute()
const router = useRouter()
const { can } = useCan()

const bankId = computed(() => String(route.params.id))
const bank = ref<Bank | null>(null)
const chapters = ref<Chapter[]>([])
const byType = ref<Record<QuestionType, number>>({ single: 0, multiple: 0, judge: 0, blank: 0, essay: 0 })
const total = ref(0)
const summary = ref({ seen: 0, favorite: 0, mastered: 0 })
const chapterProgressMap = ref<Record<string, { seen: number; total: number }>>({})
const progress = ref<Record<string, ProgressRow>>({})
const loading = ref(true)
const error = ref('')
const chapterFilter = ref('')

const canImport = computed(() => can('question:import') && can('bank:create'))
const canExam = computed(() => can('exam:take'))
const typeEntries = computed(() =>
  (Object.keys(byType.value) as QuestionType[])
    .filter((type) => byType.value[type] > 0)
    .map((type) => ({ type, label: QUESTION_TYPE_LABELS[type], count: byType.value[type] })),
)

function chapterProgress(chapter: Chapter): number {
  const row = chapterProgressMap.value[chapter.id]
  if (!row || row.total === 0) return 0
  return Math.round((row.seen / row.total) * 100)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const detail = await api.bank(bankId.value)
    bank.value = detail.bank
    chapters.value = detail.chapters
    byType.value = detail.byType
    total.value = detail.total
    summary.value = detail.progressSummary
    chapterProgressMap.value = detail.chapterProgress
    const prog = await api.progress(bankId.value)
    progress.value = prog.progress
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '加载题库失败'
  } finally {
    loading.value = false
  }
}

function start(mode: string, chapterId?: string): void {
  const query: Record<string, string> = { mode }
  if (chapterId) query.chapterId = chapterId
  void router.push({ name: 'practice', params: { id: bankId.value }, query })
}

async function startExam(): Promise<void> {
  void router.push({ name: 'exam', params: { id: bankId.value } })
}

const modes = computed(() => [
  { key: 'continue', label: '继续上次', hint: '只刷还没做过的题', disabled: total.value === 0 },
  { key: 'sequential', label: '顺序练习', hint: '按题号从头到尾' },
  { key: 'random', label: '随机练习', hint: '打乱顺序' },
  { key: 'wrong', label: '只刷错题', hint: '错题本里的题' },
  { key: 'favorite', label: '只刷收藏', hint: '已收藏的题' },
  { key: 'unmastered', label: '只刷未掌握', hint: '掌握度未达标记的题' },
])

onMounted(load)
</script>

<template>
  <AppShell>
    <button class="btn btn-ghost btn-sm back" type="button" @click="router.back()">
      <ArrowLeft :size="14" /> 返回
    </button>

    <p v-if="error" class="field-error">{{ error }}</p>

    <div v-if="bank" class="layout">
      <section class="main card">
        <header class="bank-head">
          <div class="grow">
            <h1 class="title">{{ bank.name }}</h1>
            <p class="small muted">{{ bank.subject || '未填写科目' }} · {{ total }} 题 · {{ chapters.length }} 章</p>
          </div>
          <div class="row">
            <RouterLink v-if="canImport" :to="{ name: 'import', params: { id: bank.id } }" class="btn btn-sm">
              <Upload :size="14" /> 导入题库
            </RouterLink>
          </div>
        </header>

        <div class="type-row">
          <span v-for="item in typeEntries" :key="item.type" class="badge">{{ item.label }} {{ item.count }}</span>
          <span v-if="typeEntries.length === 0" class="small faint">题库暂无题目</span>
        </div>

        <EmptyState
          v-if="total === 0"
          title="这个题库还没有题目"
          :description="canImport ? '导入文档后即可开始刷题。' : '请联系具备导入权限的账号添加题目。'"
        >
          <RouterLink v-if="canImport" :to="{ name: 'import', params: { id: bank.id } }" class="btn btn-primary">
            去导入
          </RouterLink>
        </EmptyState>

        <template v-else>
          <h2 class="section-title">开始练习</h2>
          <div class="modes">
            <button
              v-for="mode in modes"
              :key="mode.key"
              class="mode"
              type="button"
              :disabled="mode.disabled"
              @click="start(mode.key)"
            >
              <span class="mode-label">
                <Play v-if="mode.key === 'sequential'" :size="14" />
                <Clock v-else-if="mode.key === 'continue'" :size="14" />
                <Shuffle v-else-if="mode.key === 'random'" :size="14" />
                <SlidersHorizontal v-else :size="14" />
                {{ mode.label }}
              </span>
              <span class="mode-hint small">{{ mode.hint }}</span>
            </button>
          </div>

          <h2 class="section-title">按章节</h2>
          <div class="chapter-filter">
            <select v-model="chapterFilter" class="select" aria-label="选择章节">
              <option value="">全部章节（{{ total }} 题）</option>
              <option v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">
                {{ chapter.name }}（{{ chapter.questionCount }} 题）
              </option>
            </select>
            <button class="btn btn-primary" type="button" @click="start('chapter', chapterFilter || chapters[0]?.id)">
              开始本章
            </button>
          </div>
          <ul class="chapter-list">
            <li v-for="chapter in chapters" :key="chapter.id" class="chapter-item">
              <button class="chapter-btn" type="button" @click="start('chapter', chapter.id)">
                <span class="grow truncate">{{ chapter.name }}</span>
                <span class="small num muted">{{ chapter.questionCount }} 题</span>
                <span class="chapter-bar"><span :style="{ width: `${chapterProgress(chapter)}%` }" /></span>
              </button>
            </li>
            <li v-if="chapters.length === 0" class="small faint">该题库还没有章节</li>
          </ul>
        </template>
      </section>

      <aside class="side">
        <div class="card side-card">
          <h2 class="section-title">学习概览</h2>
          <dl class="stats">
            <div><dt>已刷</dt><dd class="num">{{ summary.seen }} / {{ total }}</dd></div>
            <div><dt>收藏</dt><dd class="num">{{ summary.favorite }}</dd></div>
            <div><dt>已掌握</dt><dd class="num">{{ summary.mastered }}</dd></div>
          </dl>
          <span class="progress"><span :style="{ width: `${total ? Math.round((summary.seen / total) * 100) : 0}%` }" /></span>
        </div>

        <div class="card side-card">
          <h2 class="section-title">模拟考试</h2>
          <p class="small muted">按题型数量组卷，限时作答，交卷后给出得分与逐题回顾。</p>
          <button class="btn btn-primary btn-block" type="button" :disabled="!canExam || total === 0" @click="startExam">
            开始组卷
          </button>
          <p v-if="!canExam" class="small faint">当前账号没有参加考试的权限。</p>
        </div>
      </aside>
    </div>

    <div v-else-if="loading" class="card loading-box">加载中…</div>
  </AppShell>
</template>

<style scoped>
.back {
  margin-bottom: 10px;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}
.main {
  padding: 18px;
}
.bank-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}
.title {
  font-size: var(--fs-title);
  margin-bottom: 2px;
}
.type-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.section-title {
  font-size: var(--fs-toolbar);
  color: var(--text-muted);
  font-weight: 600;
  margin: 18px 0 8px;
}
.modes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}
.mode {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
}
.mode:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.mode:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.mode-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-toolbar);
  font-weight: 600;
}
.mode-hint {
  color: var(--text-faint);
}
.chapter-filter {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.chapter-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.chapter-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.chapter-btn:hover {
  background: var(--bg-hover);
}
.chapter-bar {
  width: 72px;
  height: 5px;
  background: var(--bg-subtle);
  border-radius: 999px;
  overflow: hidden;
}
.chapter-bar > span {
  display: block;
  height: 100%;
  background: var(--primary);
}
[data-style='discreet'] .chapter-bar > span {
  background: var(--text-muted);
}
.side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.side-card {
  padding: 14px 16px;
}
.stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 10px;
}
.stats div {
  display: flex;
  justify-content: space-between;
}
.stats dt {
  color: var(--text-muted);
  font-size: var(--fs-toolbar);
}
.stats dd {
  margin: 0;
  font-family: var(--font-mono);
}
.loading-box {
  padding: 40px;
  text-align: center;
  color: var(--text-muted);
}
@media (max-width: 1023px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
