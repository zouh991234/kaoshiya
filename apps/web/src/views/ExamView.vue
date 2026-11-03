<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, ArrowLeft, ArrowRight, Clock, Grid3x3, Send } from 'lucide-vue-next'
import type { Chapter, ExamConfigInput, Question } from '@kaoshiya/shared'
import { DEFAULT_EXAM_CONFIG, QUESTION_TYPES, QUESTION_TYPE_LABELS } from '@kaoshiya/shared'
import AppShell from '@/components/AppShell.vue'
import MarkdownText from '@/components/MarkdownText.vue'
import Modal from '@/components/Modal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { api, HttpError } from '@/api/client'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const bankId = computed(() => String(route.params.id))
const phase = ref<'config' | 'running'>('config')
const loading = ref(false)
const error = ref('')

const chapters = ref<Chapter[]>([])
const config = reactive<ExamConfigInput>({
  bankId: bankId.value,
  name: '模拟考试',
  chapterIds: [...DEFAULT_EXAM_CONFIG.chapterIds],
  counts: { ...DEFAULT_EXAM_CONFIG.counts },
  totalScore: DEFAULT_EXAM_CONFIG.totalScore,
  passScore: DEFAULT_EXAM_CONFIG.passScore,
  durationSec: DEFAULT_EXAM_CONFIG.durationSec,
  shuffle: DEFAULT_EXAM_CONFIG.shuffle,
})

const examId = ref('')
const questions = ref<Question[]>([])
const answers = reactive<Record<string, string[]>>({})
const essayGrades = reactive<Record<string, 'full' | 'partial' | 'none'>>({})
const index = ref(0)
const remaining = ref(0)
const cardOpen = ref(false)
const confirmOpen = ref(false)
const submitting = ref(false)
const startedAt = ref(0)
let timer: number | null = null

const current = computed<Question | null>(() => questions.value[index.value] ?? null)
const totalCount = computed(() => QUESTION_TYPES.reduce((sum, type) => sum + (config.counts[type] ?? 0), 0))
const answeredCount = computed(() => Object.keys(answers).filter((id) => (answers[id]?.length ?? 0) > 0).length)
const danger = computed(() => remaining.value <= 300)

function fmtClock(sec: number): string {
  const safe = Math.max(0, sec)
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

async function loadChapters(): Promise<void> {
  try {
    const data = await api.bank(bankId.value)
    chapters.value = data.chapters
    config.passScore = data.bank ? Math.min(config.totalScore, DEFAULT_EXAM_CONFIG.passScore) : 60
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '加载题库信息失败'
  }
}

function toggleChapter(id: string): void {
  const set = new Set(config.chapterIds)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  config.chapterIds = [...set]
}

async function start(): Promise<void> {
  if (totalCount.value === 0) {
    toast.error('请至少设置一种题型的抽题数量')
    return
  }
  loading.value = true
  error.value = ''
  try {
    const built = await api.startExam({ ...config, bankId: bankId.value })
    examId.value = built.examId
    questions.value = built.questions
    remaining.value = built.config.durationSec
    startedAt.value = Date.now()
    phase.value = 'running'
    for (const question of built.questions) answers[question.id] = []
    if (timer !== null) window.clearInterval(timer)
    timer = window.setInterval(() => {
      remaining.value -= 1
      if (remaining.value <= 0) {
        remaining.value = 0
        void doSubmit(true)
      }
    }, 1000)
    window.scrollTo({ top: 0 })
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '组卷失败'
  } finally {
    loading.value = false
  }
}

function pick(key: string): void {
  const question = current.value
  if (!question) return
  if (question.type === 'multiple') {
    const set = new Set(answers[question.id] ?? [])
    if (set.has(key)) set.delete(key)
    else set.add(key)
    answers[question.id] = [...set].sort()
    return
  }
  answers[question.id] = [key]
}

function setBlank(value: string): void {
  const question = current.value
  if (!question) return
  answers[question.id] = value ? [value] : []
}

function setEssay(value: string): void {
  const question = current.value
  if (!question) return
  answers[question.id] = value ? [value] : []
}

function go(delta: number): void {
  const next = index.value + delta
  if (next < 0 || next >= questions.value.length) return
  index.value = next
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function doSubmit(auto = false): Promise<void> {
  confirmOpen.value = false
  if (submitting.value) return
  submitting.value = true
  if (timer !== null) window.clearInterval(timer)
  try {
    await api.submitExam(examId.value, {
      usedSec: Math.floor((Date.now() - startedAt.value) / 1000),
      answers: questions.value.map((question) => ({
        questionId: question.id,
        answer: answers[question.id] ?? [],
        selfGrade: question.type === 'essay' ? essayGrades[question.id] ?? 'none' : null,
      })),
    })
    toast.ok(auto ? '时间到，已自动交卷' : '已交卷')
    await router.replace({ name: 'exam-result', params: { id: examId.value } })
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '交卷失败'
    submitting.value = false
  }
}

const answered = (id: string): boolean => (answers[id]?.length ?? 0) > 0

onMounted(loadChapters)
onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
})
</script>

<template>
  <AppShell>
    <button class="btn btn-ghost btn-sm" type="button" @click="router.push(`/banks/${bankId}`)">
      <ArrowLeft :size="14" /> 返回题库
    </button>

    <p v-if="error" class="field-error">{{ error }}</p>

    <!-- 组卷配置 -->
    <section v-if="phase === 'config'" class="card panel">
      <h1 class="title">模拟考试 · 组卷</h1>
      <p class="small muted">按题型抽取题目，限时作答；交卷后给出得分、是否及格与逐题回顾。默认值可在组卷页直接修改。</p>

      <div class="grid">
        <label v-for="type in QUESTION_TYPES" :key="type" class="field">
          <span class="field-label">{{ QUESTION_TYPE_LABELS[type] }} 抽题数</span>
          <input v-model.number="config.counts[type]" class="input num" type="number" min="0" max="200" />
        </label>
      </div>

      <div class="grid">
        <label class="field">
          <span class="field-label">总分</span>
          <input v-model.number="config.totalScore" class="input num" type="number" min="1" max="1000" />
        </label>
        <label class="field">
          <span class="field-label">及格线</span>
          <input v-model.number="config.passScore" class="input num" type="number" min="0" max="1000" />
        </label>
        <label class="field">
          <span class="field-label">时长（分钟）</span>
          <input
            :value="Math.round(config.durationSec / 60)"
            class="input num"
            type="number"
            min="1"
            max="1440"
            @input="config.durationSec = Number(($event.target as HTMLInputElement).value) * 60"
          />
        </label>
      </div>

      <div v-if="chapters.length" class="field">
        <span class="field-label">抽题范围（不选则为整个题库）</span>
        <div class="chapters">
          <button
            v-for="chapter in chapters"
            :key="chapter.id"
            class="chip"
            type="button"
            :class="{ active: config.chapterIds.includes(chapter.id) }"
            @click="toggleChapter(chapter.id)"
          >
            {{ chapter.name }}
          </button>
        </div>
      </div>

      <div class="row">
        <span class="small muted">本次共 <b class="num">{{ totalCount }}</b> 题</span>
        <span class="grow" />
        <button class="btn btn-primary" type="button" :disabled="loading" @click="start">
          {{ loading ? '组卷中…' : '开始考试' }}
        </button>
      </div>
    </section>

    <!-- 考试中 -->
    <section v-else class="exam">
      <header class="timer-bar" :class="{ danger }">
        <span class="timer-label">
          <Clock :size="15" /> 剩余时间
        </span>
        <span class="timer-value num">{{ fmtClock(remaining) }}</span>
        <span v-if="danger" class="timer-warn small"><AlertTriangle :size="13" /> 最后 5 分钟</span>
        <span class="grow" />
        <span class="small muted">已答 {{ answeredCount }} / {{ questions.length }}</span>
        <button class="btn btn-sm" type="button" @click="cardOpen = true"><Grid3x3 :size="14" /> 答题卡</button>
        <button class="btn btn-sm btn-primary" type="button" :disabled="submitting" @click="confirmOpen = true">
          <Send :size="14" /> 交卷
        </button>
      </header>

      <div v-if="current" class="card qbox">
        <div class="qhead">
          <span class="qno num">{{ index + 1 }} / {{ questions.length }}</span>
          <span class="badge">{{ QUESTION_TYPE_LABELS[current.type] }}</span>
        </div>
        <div class="stem-text"><MarkdownText :source="current.stem" /></div>

        <div v-if="current.type === 'single' || current.type === 'judge'" class="options">
          <button
            v-for="option in current.type === 'judge'
              ? [{ key: 'T', text: '正确' }, { key: 'F', text: '错误' }]
              : current.options"
            :key="option.key"
            class="option"
            type="button"
            :class="{ chosen: (answers[current.id] ?? []).includes(option.key) }"
            @click="pick(option.key)"
          >
            <span class="option-key mono">{{ current.type === 'judge' ? (option.key === 'T' ? '✓' : '✕') : option.key }}</span>
            <span class="option-text">{{ option.text }}</span>
          </button>
        </div>

        <div v-else-if="current.type === 'multiple'" class="options">
          <button
            v-for="option in current.options"
            :key="option.key"
            class="option"
            type="button"
            :class="{ chosen: (answers[current.id] ?? []).includes(option.key) }"
            @click="pick(option.key)"
          >
            <span class="option-key mono">{{ option.key }}</span>
            <span class="option-text">{{ option.text }}</span>
          </button>
        </div>

        <div v-else-if="current.type === 'blank'" class="field">
          <span class="field-label">填写答案</span>
          <input class="input" type="text" :value="answers[current.id]?.[0] ?? ''" @input="setBlank(($event.target as HTMLInputElement).value)" />
        </div>

        <div v-else class="field">
          <span class="field-label">简答</span>
          <textarea class="textarea" rows="6" :value="answers[current.id]?.[0] ?? ''" @input="setEssay(($event.target as HTMLTextAreaElement).value)" />
          <span class="field-hint">交卷后按参考答案自评，主观题单独统计，不混入客观题正确率。</span>
        </div>

        <div class="row foot">
          <button class="btn" type="button" :disabled="index === 0" @click="go(-1)"><ArrowLeft :size="14" /> 上一题</button>
          <span class="grow" />
          <button class="btn btn-primary" type="button" :disabled="index >= questions.length - 1" @click="go(1)">下一题 <ArrowRight :size="14" /></button>
        </div>
      </div>

      <Modal :open="cardOpen" title="答题卡" :width="520" @close="cardOpen = false">
        <div class="card-grid">
          <button
            v-for="(question, i) in questions"
            :key="question.id"
            class="cell"
            type="button"
            :class="{ answered: answered(question.id), current: i === index }"
            @click="index = i; cardOpen = false"
          >
            {{ i + 1 }}
          </button>
        </div>
        <p class="small faint">灰色为未作答，实心为已作答。</p>
      </Modal>

      <ConfirmModal
        :open="confirmOpen"
        title="确认交卷"
        :message="`还有 ${questions.length - answeredCount} 题未作答，交卷后不能修改。`"
        confirm-text="交卷"
        @close="confirmOpen = false"
        @confirm="doSubmit(false)"
      />
    </section>
  </AppShell>
</template>

<style scoped>
.panel {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}
.title {
  font-size: var(--fs-title);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.chapters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elev);
  font-size: var(--fs-small);
  cursor: pointer;
  color: var(--text-muted);
}
.chip.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--text);
}
.exam {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}
.timer-bar {
  position: sticky;
  top: 54px;
  z-index: 500;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  flex-wrap: wrap;
}
.timer-bar.danger {
  border-color: var(--err-border);
  background: var(--err-bg);
}
.timer-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-small);
  color: var(--text-muted);
}
.timer-value {
  font-size: 17px;
  font-weight: 700;
}
.timer-bar.danger .timer-value {
  color: var(--err);
  font-weight: 700;
}
.timer-warn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--err);
  font-weight: 700;
}
.qbox {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.qhead {
  display: flex;
  align-items: center;
  gap: 8px;
}
.qno {
  font-size: var(--fs-small);
  color: var(--text-faint);
}
.stem-text {
  font-size: var(--fs-stem);
  line-height: 1.65;
  font-variant-ligatures: none;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
  text-align: left;
  cursor: pointer;
}
.option:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.option.chosen {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.option-key {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  font-size: 12px;
  color: var(--text-muted);
}
.option-text {
  flex: 1;
  line-height: 1.6;
  font-variant-ligatures: none;
}
.foot {
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
}
.cell {
  padding: 7px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
}
.cell.answered {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-text);
  font-weight: 700;
}
.cell.current {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
@media (max-width: 767px) {
  .timer-bar {
    top: 50px;
  }
}
</style>
