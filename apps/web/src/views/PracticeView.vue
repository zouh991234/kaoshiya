<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Check,
  Copy,
  Eye,
  EyeOff,
  Grid3x3,
  Keyboard,
  Save,
} from 'lucide-vue-next'
import type { Chapter, ProgressOp, ProgressRow, Question } from '@kaoshiya/shared'
import { QUESTION_TYPE_LABELS, judgeAnswer, MASTERY } from '@kaoshiya/shared'
import AppShell from '@/components/AppShell.vue'
import MarkdownText from '@/components/MarkdownText.vue'
import Modal from '@/components/Modal.vue'
import { api, HttpError } from '@/api/client'
import { useToastStore } from '@/stores/toast'

type SyncState = 'idle' | 'saving' | 'saved' | 'pending' | 'failed'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const bankId = computed(() => String(route.params.id))
const questions = ref<Question[]>([])
const chapters = ref<Chapter[]>([])
const progress = ref<Record<string, ProgressRow>>({})
const index = ref(0)
const loading = ref(true)
const error = ref('')
const answers = reactive<Record<string, string[]>>({})
const revealed = reactive<Record<string, boolean>>({})
const blankInput = reactive<Record<string, string>>({})
const essayInput = reactive<Record<string, string>>({})
const noteOpen = ref(false)
const noteDraft = ref('')
const cardOpen = ref(false)
const helpOpen = ref(false)
const syncState = ref<SyncState>('idle')
const startedAt = ref(Date.now())
const elapsed = ref(0)
const streak = ref(0)
const touchStart = ref<{ x: number; y: number } | null>(null)

const pending: ProgressOp[] = []
let flushTimer: number | null = null
let elapsedTimer: number | null = null
let noteTimer: number | null = null

const mode = computed(() => String(route.query.mode ?? 'sequential'))
const chapterId = computed(() => (route.query.chapterId ? String(route.query.chapterId) : ''))
const current = computed<Question | null>(() => questions.value[index.value] ?? null)
const currentProgress = computed<ProgressRow | null>(() => (current.value ? progress.value[current.value.id] ?? null : null))
const answeredCount = computed(() => Object.values(progress.value).filter((row) => row.seen > 0).length)
const rightCount = computed(() => Object.values(progress.value).filter((row) => row.lastResult === 'right').length)
const accuracy = computed(() => {
  const settled = Object.values(progress.value).filter((row) => row.lastResult)
  if (settled.length === 0) return 0
  return Math.round((rightCount.value / settled.length) * 100)
})
const chosen = computed(() => (current.value ? answers[current.value.id] ?? [] : []))
const isRevealed = computed(() => (current.value ? Boolean(revealed[current.value.id]) : false))
const judged = computed(() => currentProgress.value?.lastResult ?? null)

const statusOf = (questionId: string): 'none' | 'right' | 'wrong' | 'fav' => {
  const row = progress.value[questionId]
  if (!row) return 'none'
  if (row.favorite) return 'fav'
  if (row.lastResult === 'right') return 'right'
  if (row.lastResult === 'wrong') return 'wrong'
  return 'none'
}

const modeLabel = computed(() => {
  const map: Record<string, string> = {
    sequential: '顺序练习',
    random: '随机练习',
    chapter: '章节练习',
    wrong: '只刷错题',
    favorite: '只刷收藏',
    unmastered: '只刷未掌握',
    continue: '继续上次',
  }
  return map[mode.value] ?? '练习'
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await api.practice(bankId.value, { mode: mode.value, chapterId: chapterId.value || undefined, limit: 2000 })
    questions.value = data.questions
    progress.value = data.progress
    chapters.value = data.chapters
    for (const question of data.questions) {
      if (question.type === 'blank' && question.answer.length > 0) blankInput[question.id] = ''
    }
    startedAt.value = Date.now()
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '加载练习失败'
  } finally {
    loading.value = false
  }
}

function enqueue(op: ProgressOp): void {
  pending.push(op)
  syncState.value = 'pending'
  if (flushTimer !== null) window.clearTimeout(flushTimer)
  flushTimer = window.setTimeout(() => void flush(), 700)
  if (pending.length >= 40) void flush()
}

async function flush(): Promise<void> {
  if (pending.length === 0) {
    if (syncState.value === 'pending') syncState.value = 'saved'
    return
  }
  const batch = pending.splice(0, pending.length)
  syncState.value = 'saving'
  try {
    const result = await api.syncProgress(batch)
    progress.value = { ...progress.value, ...result.progress }
    syncState.value = pending.length > 0 ? 'pending' : 'saved'
  } catch {
    // 失败时放回队列，等待重试；不能假装已保存
    pending.unshift(...batch)
    syncState.value = 'failed'
  }
}

function applyMeta(questionId: string, patch: Partial<ProgressRow>): void {
  const prev = progress.value[questionId] ?? {
    questionId,
    seen: 0,
    right: 0,
    wrong: 0,
    lastResult: null,
    lastAt: null,
    favorite: false,
    mastery: 0,
    note: '',
    selfGrade: null,
  }
  progress.value = { ...progress.value, [questionId]: { ...prev, ...patch } }
}

function recordResult(questionId: string, result: 'right' | 'wrong'): void {
  const row = progress.value[questionId]
  applyMeta(questionId, {
    lastResult: result,
    seen: (row?.seen ?? 0) + 1,
    right: (row?.right ?? 0) + (result === 'right' ? 1 : 0),
    wrong: (row?.wrong ?? 0) + (result === 'wrong' ? 1 : 0),
    lastAt: new Date().toISOString(),
  })
  streak.value = result === 'right' ? streak.value + 1 : 0
  enqueue({ questionId, result, at: new Date().toISOString() })
  revealed[questionId] = true
}

function pick(key: string): void {
  const question = current.value
  if (!question) return
  if (question.type === 'single' || question.type === 'judge') {
    answers[question.id] = [key]
    const correct = question.answer.map((a) => a.toUpperCase())
    recordResult(question.id, correct.includes(key.toUpperCase()) ? 'right' : 'wrong')
    return
  }
  const list = new Set(chosen.value)
  if (list.has(key)) list.delete(key)
  else list.add(key)
  answers[question.id] = [...list].sort()
}

function confirmMultiple(): void {
  const question = current.value
  if (!question || chosen.value.length === 0) {
    toast.error('请先选择答案')
    return
  }
  recordResult(question.id, judgeAnswer('multiple', question.answer, chosen.value) ? 'right' : 'wrong')
}

function confirmBlank(): void {
  const question = current.value
  if (!question) return
  const value = (blankInput[question.id] ?? '').trim()
  if (!value) {
    toast.error('请先填写答案')
    return
  }
  answers[question.id] = [value]
  recordResult(question.id, judgeAnswer('blank', question.answer, [value]) ? 'right' : 'wrong')
}

function gradeEssay(grade: 'full' | 'partial' | 'none'): void {
  const question = current.value
  if (!question) return
  answers[question.id] = [essayInput[question.id] ?? '']
  applyMeta(question.id, { selfGrade: grade, lastResult: grade === 'full' ? 'right' : 'wrong', seen: (progress.value[question.id]?.seen ?? 0) + 1, lastAt: new Date().toISOString() })
  enqueue({ questionId: question.id, selfGrade: grade, result: grade === 'full' ? 'right' : 'wrong', at: new Date().toISOString() })
  revealed[question.id] = true
}

function toggleFavorite(): void {
  const question = current.value
  if (!question) return
  const next = !currentProgress.value?.favorite
  applyMeta(question.id, { favorite: next })
  enqueue({ questionId: question.id, favorite: next, at: new Date().toISOString() })
}

function markMastery(value: 0 | 1 | 2): void {
  const question = current.value
  if (!question) return
  applyMeta(question.id, { mastery: value })
  enqueue({ questionId: question.id, mastery: value, at: new Date().toISOString() })
}

function openNote(): void {
  if (!current.value) return
  noteDraft.value = currentProgress.value?.note ?? ''
  noteOpen.value = true
}

function saveNote(): void {
  const question = current.value
  if (!question) return
  applyMeta(question.id, { note: noteDraft.value })
  enqueue({ questionId: question.id, note: noteDraft.value, at: new Date().toISOString() })
  noteOpen.value = false
}

watch(noteDraft, (value) => {
  const question = current.value
  if (!question || !noteOpen.value) return
  if (noteTimer !== null) window.clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => {
    applyMeta(question.id, { note: value })
    enqueue({ questionId: question.id, note: value, at: new Date().toISOString() })
  }, 900)
})

function go(delta: number): void {
  const next = index.value + delta
  if (next < 0 || next >= questions.value.length) return
  index.value = next
  void nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

function jump(to: number): void {
  if (to < 0 || to >= questions.value.length) return
  index.value = to
  cardOpen.value = false
}

function toggleReveal(): void {
  const question = current.value
  if (!question) return
  revealed[question.id] = !revealed[question.id]
}

function copyStem(): void {
  const question = current.value
  if (!question) return
  const text = `${question.stem}\n${question.options.map((o) => `${o.key}. ${o.text}`).join('\n')}`
  if (navigator.clipboard && window.isSecureContext) {
    void navigator.clipboard.writeText(text).then(
      () => toast.ok('题干已复制'),
      () => toast.error('复制失败，请手动选择文本'),
    )
    return
  }
  toast.info('当前环境不支持自动复制，请手动选择题干文本')
}

function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
  if (noteOpen.value || cardOpen.value || helpOpen.value) return
  const question = current.value
  if (!question) return
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault()
      go(-1)
      break
    case 'ArrowRight':
      event.preventDefault()
      go(1)
      break
    case 'Enter':
      event.preventDefault()
      go(1)
      break
    case ' ':
      event.preventDefault()
      toggleReveal()
      break
    case 'f':
    case 'F':
      event.preventDefault()
      toggleFavorite()
      break
    case 'm':
    case 'M':
      event.preventDefault()
      markMastery(MASTERY.MASTERED)
      break
    case 'n':
    case 'N':
      event.preventDefault()
      openNote()
      break
    case '?':
      event.preventDefault()
      helpOpen.value = true
      break
    default: {
      const key = event.key.toUpperCase()
      if (/^[1-4]$/.test(key)) {
        event.preventDefault()
        pick(String.fromCharCode(64 + Number(key)))
      } else if (/^[A-D]$/.test(key)) {
        event.preventDefault()
        pick(key)
      }
    }
  }
}

function onTouchStart(event: TouchEvent): void {
  const touch = event.changedTouches[0]
  if (!touch) return
  touchStart.value = { x: touch.clientX, y: touch.clientY }
}
function onTouchEnd(event: TouchEvent): void {
  const start = touchStart.value
  const touch = event.changedTouches[0]
  touchStart.value = null
  if (!start || !touch) return
  const dx = touch.clientX - start.x
  const dy = touch.clientY - start.y
  if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.7) return
  go(dx < 0 ? 1 : -1)
}

function onOnline(): void {
  if (pending.length > 0) void flush()
}

onMounted(async () => {
  await load()
  window.addEventListener('keydown', onKey)
  window.addEventListener('online', onOnline)
  elapsedTimer = window.setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startedAt.value) / 1000)
  }, 1000)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('online', onOnline)
  if (elapsedTimer !== null) window.clearInterval(elapsedTimer)
  if (flushTimer !== null) window.clearTimeout(flushTimer)
  if (noteTimer !== null) window.clearTimeout(noteTimer)
  void flush()
})

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const syncLabel = computed(() => {
  switch (syncState.value) {
    case 'saving':
      return '保存中…'
    case 'saved':
      return '已保存'
    case 'pending':
      return '待同步'
    case 'failed':
      return '保存失败，将自动重试'
    default:
      return ''
  }
})
</script>

<template>
  <AppShell>
    <div class="practice-head">
      <button class="btn btn-ghost btn-sm" type="button" @click="router.push(`/banks/${bankId}`)">
        <ArrowLeft :size="14" /> 返回题库
      </button>
      <span class="badge">{{ modeLabel }}</span>
      <div class="head-metrics small">
        <span>进度 <b class="num">{{ answeredCount }}/{{ questions.length }}</b></span>
        <span>正确率 <b class="num">{{ accuracy }}%</b></span>
        <span>用时 <b class="num">{{ fmtDuration(elapsed) }}</b></span>
        <span v-if="streak >= 2" class="streak">连续答对 {{ streak }}</span>
        <span class="sync" :class="`sync-${syncState}`">{{ syncLabel }}</span>
      </div>
      <div class="row head-tools">
        <button class="icon-btn" type="button" title="答题卡" aria-label="答题卡" @click="cardOpen = true">
          <Grid3x3 :size="17" />
        </button>
        <button class="icon-btn desktop-only" type="button" title="快捷键" aria-label="快捷键" @click="helpOpen = true">
          <Keyboard :size="17" />
        </button>
      </div>
    </div>

    <p v-if="error" class="field-error">{{ error }}</p>

    <div v-if="loading" class="card loading-box">加载中…</div>
    <div v-else-if="questions.length === 0" class="card loading-box">当前模式下没有题目，换个模式试试。</div>

    <div v-else class="layout">
      <aside class="qlist card">
        <div class="qlist-head small muted">题目列表</div>
        <ul>
          <li v-for="(question, i) in questions" :key="question.id">
            <button
              class="qitem"
              type="button"
              :class="{ active: i === index }"
              :data-status="statusOf(question.id)"
              @click="jump(i)"
            >
              <span class="qitem-no num">{{ i + 1 }}</span>
              <span class="qitem-stem truncate">{{ question.stem }}</span>
              <span class="qitem-dot" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </aside>

      <section
        v-if="current"
        class="content card"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      >
        <header class="qhead">
          <div class="qhead-top">
            <span class="qno num">{{ index + 1 }}<span class="qno-total"> / {{ questions.length }}</span></span>
            <span class="badge">{{ QUESTION_TYPE_LABELS[current.type] }}</span>
            <span class="badge">难度 {{ current.difficulty }}</span>
            <span class="grow" />
            <button
              class="icon-btn"
              type="button"
              :aria-pressed="currentProgress?.favorite ?? false"
              :title="currentProgress?.favorite ? '取消收藏' : '收藏'"
              @click="toggleFavorite"
            >
              <BookmarkCheck v-if="currentProgress?.favorite" :size="17" />
              <Bookmark v-else :size="17" />
            </button>
            <button class="icon-btn" type="button" title="标记已掌握" aria-label="标记已掌握" @click="markMastery(MASTERY.MASTERED)">
              <Check :size="17" />
            </button>
            <button class="icon-btn" type="button" title="笔记" aria-label="笔记" @click="openNote">
              <Save :size="17" />
            </button>
            <button class="icon-btn" type="button" title="复制题干" aria-label="复制题干" @click="copyStem">
              <Copy :size="17" />
            </button>
          </div>
          <div class="stem-text">
            <MarkdownText :source="current.stem" />
          </div>
          <div v-if="current.tags.length" class="tags">
            <span v-for="tag in current.tags" :key="tag" class="badge">{{ tag }}</span>
          </div>
          <div v-if="current.media.length" class="media">
            <img
              v-for="item in current.media"
              :key="item.hash"
              :src="`/media/${item.hash}.${item.mime === 'image/jpeg' ? 'jpg' : item.mime.split('/')[1]}`"
              :alt="item.name"
              loading="lazy"
            />
          </div>
        </header>

        <!-- 单选 / 判断 -->
        <div v-if="current.type === 'single' || current.type === 'judge'" class="options">
          <button
            v-for="option in current.type === 'judge'
              ? [{ key: 'T', text: '正确' }, { key: 'F', text: '错误' }]
              : current.options"
            :key="option.key"
            class="option"
            type="button"
            :class="{
              chosen: chosen.includes(option.key),
              correct: isRevealed && current.answer.includes(option.key),
              wrong: isRevealed && chosen.includes(option.key) && !current.answer.includes(option.key),
              judging: current.type === 'judge',
            }"
            :disabled="judged !== null"
            @click="pick(option.key)"
          >
            <span class="option-key mono">{{ current.type === 'judge' ? (option.key === 'T' ? '✓' : '✕') : option.key }}</span>
            <span class="option-text">{{ option.text }}</span>
          </button>
        </div>

        <!-- 多选 -->
        <div v-else-if="current.type === 'multiple'" class="options">
          <button
            v-for="option in current.options"
            :key="option.key"
            class="option"
            type="button"
            :class="{
              chosen: chosen.includes(option.key),
              correct: isRevealed && current.answer.includes(option.key),
              wrong: isRevealed && chosen.includes(option.key) && !current.answer.includes(option.key),
            }"
            :disabled="judged !== null"
            @click="pick(option.key)"
          >
            <span class="option-key mono">{{ option.key }}</span>
            <span class="option-text">{{ option.text }}</span>
          </button>
          <button v-if="judged === null" class="btn btn-primary confirm-btn" type="button" @click="confirmMultiple">
            确认答案
          </button>
        </div>

        <!-- 填空 -->
        <div v-else-if="current.type === 'blank'" class="blank-area">
          <input
            v-model="blankInput[current.id]"
            class="input"
            type="text"
            placeholder="填写答案"
            :disabled="judged !== null"
            @keydown.enter.prevent="judged === null && confirmBlank()"
          />
          <button v-if="judged === null" class="btn btn-primary" type="button" @click="confirmBlank">确认答案</button>
        </div>

        <!-- 主观题 -->
        <div v-else class="essay-area">
          <textarea
            v-model="essayInput[current.id]"
            class="textarea"
            rows="5"
            placeholder="写出你的答案，再展开参考答案自评"
            :disabled="judged !== null"
          />
          <div v-if="judged === null" class="row">
            <button class="btn btn-primary" type="button" @click="toggleReveal">
              <Eye :size="14" /> 展开参考答案
            </button>
          </div>
          <div v-else class="self-grade">
            <span class="small muted">自评：</span>
            <button class="btn btn-sm" :class="{ 'btn-primary': currentProgress?.selfGrade === 'full' }" type="button" @click="gradeEssay('full')">完全正确</button>
            <button class="btn btn-sm" :class="{ 'btn-primary': currentProgress?.selfGrade === 'partial' }" type="button" @click="gradeEssay('partial')">基本正确</button>
            <button class="btn btn-sm" :class="{ 'btn-primary': currentProgress?.selfGrade === 'none' }" type="button" @click="gradeEssay('none')">错误</button>
          </div>
        </div>

        <!-- 答案与解析（默认折叠） -->
        <div class="answer-block">
          <button class="answer-toggle" type="button" @click="toggleReveal">
            <component :is="isRevealed ? EyeOff : Eye" :size="15" />
            {{ isRevealed ? '隐藏答案' : '显示答案与解析' }}
          </button>
          <Transition name="fade">
            <div v-if="isRevealed" class="answer-body">
              <div class="answer-line">
                <span class="small muted">正确答案</span>
                <span class="answer-value mono">{{ current.answer.join(' ') || '（无）' }}</span>
                <span
                  v-if="judged"
                  class="badge"
                  :class="judged === 'right' ? 'badge-ok' : 'badge-err'"
                >
                  {{ judged === 'right' ? '✓ 答对' : '× 答错' }}
                </span>
              </div>
              <div class="explain">
                <div class="small muted">解析</div>
                <MarkdownText v-if="current.explanation" :source="current.explanation" />
                <p v-else class="small faint">这道题暂无解析。</p>
              </div>
            </div>
          </Transition>
        </div>

        <footer class="content-foot">
          <button class="btn" type="button" :disabled="index === 0" @click="go(-1)">
            <ArrowLeft :size="14" /> 上一题
          </button>
          <span class="small faint">{{ index + 1 }} / {{ questions.length }}</span>
          <button class="btn btn-primary" type="button" :disabled="index >= questions.length - 1" @click="go(1)">
            下一题 <ArrowRight :size="14" />
          </button>
        </footer>
      </section>
    </div>

    <!-- 移动端底部操作条 -->
    <div class="mobile-bar">
      <button class="btn btn-sm" type="button" :disabled="index === 0" @click="go(-1)">上一题</button>
      <button class="btn btn-sm" type="button" @click="toggleReveal">
        <component :is="isRevealed ? EyeOff : Eye" :size="14" /> 答案
      </button>
      <button class="btn btn-sm" type="button" @click="cardOpen = true"><Grid3x3 :size="14" /> 答题卡</button>
      <button class="btn btn-primary btn-sm" type="button" :disabled="index >= questions.length - 1" @click="go(1)">下一题</button>
    </div>

    <Modal :open="cardOpen" title="答题卡" :width="520" @close="cardOpen = false">
      <div class="card-grid">
        <button
          v-for="(question, i) in questions"
          :key="question.id"
          class="card-cell"
          type="button"
          :class="{ current: i === index }"
          :data-status="statusOf(question.id)"
          @click="jump(i)"
        >
          <span class="num">{{ i + 1 }}</span>
          <span class="cell-mark" aria-hidden="true">
            {{ statusOf(question.id) === 'right' ? '✓' : statusOf(question.id) === 'wrong' ? '×' : statusOf(question.id) === 'fav' ? '★' : '○' }}
          </span>
        </button>
      </div>
      <div class="legend small">
        <span><i class="lg lg-right" /> 已答对</span>
        <span><i class="lg lg-wrong" /> 已答错</span>
        <span><i class="lg lg-fav" /> 已收藏</span>
        <span><i class="lg lg-none" /> 未做</span>
      </div>
    </Modal>

    <Modal :open="noteOpen" title="我的笔记" :width="460" @close="noteOpen = false">
      <textarea v-model="noteDraft" class="textarea" rows="6" placeholder="记录这道题的易错点、记忆方法…" />
      <template #footer>
        <button class="btn" type="button" @click="noteOpen = false">关闭</button>
        <button class="btn btn-primary" type="button" @click="saveNote">保存笔记</button>
      </template>
    </Modal>

    <Modal :open="helpOpen" title="快捷键" :width="420" @close="helpOpen = false">
      <ul class="shortcuts">
        <li><kbd>←</kbd><kbd>→</kbd><span>上一题 / 下一题</span></li>
        <li><kbd>1</kbd>–<kbd>4</kbd> / <kbd>A</kbd>–<kbd>D</kbd><span>选择答案</span></li>
        <li><kbd>Enter</kbd><span>下一题</span></li>
        <li><kbd>Space</kbd><span>显示 / 隐藏答案</span></li>
        <li><kbd>F</kbd><span>收藏</span></li>
        <li><kbd>M</kbd><span>标记已掌握</span></li>
        <li><kbd>N</kbd><span>笔记</span></li>
        <li><kbd>?</kbd><span>打开快捷键帮助</span></li>
      </ul>
      <p class="small faint">输入框聚焦时快捷键不生效。</p>
    </Modal>
  </AppShell>
</template>

<style scoped>
.practice-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.head-metrics {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--text-muted);
  margin-left: auto;
  font-family: var(--font-sans);
}
.head-metrics b {
  color: var(--text);
  font-family: var(--font-mono);
}
.streak {
  color: var(--accent-text);
  font-weight: 600;
}
[data-style='discreet'] .streak {
  display: none;
}
.sync {
  font-size: 11.5px;
  color: var(--text-faint);
}
.sync-failed {
  color: var(--err);
  font-weight: 600;
}
.sync-saved {
  color: var(--ok);
}
.layout {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.qlist {
  position: sticky;
  top: 70px;
  max-height: calc(100vh - 100px);
  overflow: auto;
  padding: 8px;
}
.qlist-head {
  padding: 4px 6px 8px;
}
.qlist ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.qitem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--text-muted);
}
.qitem:hover {
  background: var(--bg-hover);
}
.qitem.active {
  background: var(--bg-subtle);
  color: var(--text);
}
.qitem-no {
  width: 20px;
  flex: 0 0 auto;
  font-size: 11.5px;
  color: var(--text-faint);
}
.qitem-stem {
  flex: 1;
  font-size: 12.5px;
}
.qitem-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid var(--border-strong);
}
.qitem[data-status='right'] .qitem-dot {
  background: var(--ok);
  border-color: var(--ok);
}
.qitem[data-status='wrong'] .qitem-dot {
  background: var(--err);
  border-color: var(--err);
}
.qitem[data-status='fav'] .qitem-dot {
  background: var(--accent);
  border-color: var(--accent);
}
.content {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.qhead-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.qno {
  font-size: 15px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text);
}
.qno-total {
  font-weight: 400;
  color: var(--text-faint);
  font-size: 12px;
}
.stem-text {
  font-size: var(--fs-stem);
  line-height: 1.65;
  font-variant-ligatures: none;
}
.tags {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.media img {
  max-width: 100%;
  margin-top: 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
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
  cursor: pointer;
  text-align: left;
  transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
}
.option:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.option:disabled {
  cursor: default;
}
.option.chosen {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.option.correct {
  border-color: var(--ok-border);
  background: var(--ok-bg);
}
.option.wrong {
  border-color: var(--err-border);
  background: var(--err-bg);
}
.option.judging {
  justify-content: center;
  padding: 16px;
  font-size: calc(var(--fs-body) + 1px);
}
.option-key {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  font-size: 12px;
  color: var(--text-muted);
}
.option.chosen .option-key {
  border-color: var(--primary);
  color: var(--accent-text);
}
.option-text {
  flex: 1;
  line-height: 1.6;
  font-variant-ligatures: none;
}
.confirm-btn {
  align-self: flex-start;
  margin-top: 4px;
}
.blank-area {
  display: flex;
  gap: 8px;
}
.essay-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.self-grade {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.answer-block {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.answer-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--fs-toolbar);
  cursor: pointer;
  padding: 4px 0;
}
.answer-toggle:hover {
  color: var(--text);
}
.answer-body {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.answer-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.answer-value {
  font-weight: 700;
}
.explain {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.content-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.mobile-bar {
  display: none;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
}
.card-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
}
.card-cell.current {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}
.card-cell[data-status='right'] {
  background: var(--ok-bg);
  color: var(--ok);
}
.card-cell[data-status='wrong'] {
  background: var(--err-bg);
  color: var(--err);
}
.card-cell[data-status='fav'] {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.cell-mark {
  font-size: 10px;
  line-height: 1;
}
.legend {
  display: flex;
  gap: 14px;
  margin-top: 12px;
  color: var(--text-muted);
  flex-wrap: wrap;
}
.lg {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  margin-right: 4px;
}
.lg-right {
  background: var(--ok);
}
.lg-wrong {
  background: var(--err);
}
.lg-fav {
  background: var(--accent);
}
.lg-none {
  background: var(--bg-subtle);
  border: 1px solid var(--border-strong);
}
.shortcuts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.shortcuts li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-toolbar);
  color: var(--text-muted);
}
.shortcuts span {
  margin-left: auto;
  color: var(--text);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-fast) var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.loading-box {
  padding: 48px;
  text-align: center;
  color: var(--text-muted);
}
@media (max-width: 1023px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .qlist {
    display: none;
  }
}
@media (max-width: 767px) {
  .desktop-only {
    display: none;
  }
  .content {
    padding: 14px 12px;
    border: 0;
    background: transparent;
  }
  .mobile-bar {
    display: flex;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    gap: 6px;
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
    background: var(--bg-elev);
    border-top: 1px solid var(--border);
    z-index: 800;
  }
  .mobile-bar .btn {
    flex: 1;
  }
  .head-metrics {
    width: 100%;
    margin-left: 0;
    gap: 12px;
  }
  .content-foot {
    display: none;
  }
}
</style>
