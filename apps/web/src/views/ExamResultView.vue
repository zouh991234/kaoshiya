<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CheckCircle2, Clock, RotateCcw, XCircle } from 'lucide-vue-next'
import type { ExamAnswerItem, ExamRecordDetail, Question } from '@kaoshiya/shared'
import { QUESTION_TYPE_LABELS } from '@kaoshiya/shared'
import AppShell from '@/components/AppShell.vue'
import MarkdownText from '@/components/MarkdownText.vue'
import { api, HttpError } from '@/api/client'

type Detail = ExamRecordDetail & { questions: Question[] }

const route = useRoute()
const router = useRouter()
const record = ref<Detail | null>(null)
const loading = ref(true)
const error = ref('')

const answerMap = computed(() => {
  const map = new Map<string, ExamAnswerItem>()
  for (const item of record.value?.answers ?? []) map.set(item.questionId, item)
  return map
})

const review = computed(() => {
  const detail = record.value
  if (!detail) return []
  return detail.questions.map((question) => {
    const answer = answerMap.value.get(question.id)
    const given = answer?.answer ?? []
    return {
      question,
      given,
      correct: answer?.correct ?? null,
      selfGrade: answer?.selfGrade ?? null,
    }
  })
})

const passRate = computed(() => {
  const detail = record.value
  if (!detail || !detail.totalScore) return 0
  return Math.round((detail.score / detail.totalScore) * 100)
})

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`
}

function displayAnswer(question: Question, list: string[]): string {
  if (list.length === 0) return '（未作答）'
  if (question.type === 'judge') return list[0] === 'T' ? '正确' : '错误'
  if (question.type === 'single' || question.type === 'multiple') return list.join(' ')
  return list.join(' / ')
}

async function load(): Promise<void> {
  loading.value = true
  try {
    record.value = await api.examRecord(String(route.params.id))
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '读取考试结果失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <AppShell>
    <button class="btn btn-ghost btn-sm" type="button" @click="router.back()"><ArrowLeft :size="14" /> 返回</button>
    <p v-if="error" class="field-error">{{ error }}</p>
    <div v-if="loading" class="muted small">加载中…</div>

    <template v-else-if="record">
      <section class="card summary">
        <div class="score-block">
          <div class="score num">{{ record.score }}<span class="score-total"> / {{ record.totalScore }}</span></div>
          <span class="badge" :class="record.passed ? 'badge-ok' : 'badge-err'">
            <component :is="record.passed ? CheckCircle2 : XCircle" :size="13" />
            {{ record.passed ? '及格' : '不及格' }}
          </span>
        </div>
        <dl class="meta">
          <div><dt>题库</dt><dd>{{ record.bankName }}</dd></div>
          <div><dt>用时</dt><dd class="num"><Clock :size="13" /> {{ fmtDuration(record.usedSec) }}</dd></div>
          <div><dt>得分率</dt><dd class="num">{{ passRate }}%</dd></div>
          <div><dt>交卷时间</dt><dd class="num">{{ record.finishedAt?.slice(0, 16).replace('T', ' ') ?? '—' }}</dd></div>
        </dl>
        <div class="row actions">
          <button class="btn btn-sm" type="button" @click="router.push(`/banks/${record.bankId}`)">
            <RotateCcw :size="14" /> 回到题库
          </button>
        </div>
      </section>

      <section class="review">
        <h2 class="section-title">逐题回顾</h2>
        <article v-for="(item, i) in review" :key="item.question.id" class="card qcard">
          <header class="qhead">
            <span class="qno num">{{ i + 1 }}</span>
            <span class="badge">{{ QUESTION_TYPE_LABELS[item.question.type] }}</span>
            <span
              v-if="item.question.type !== 'essay'"
              class="badge"
              :class="item.correct ? 'badge-ok' : 'badge-err'"
            >
              {{ item.correct ? '✓ 答对' : '× 答错' }}
            </span>
            <span v-else class="badge">自评 {{ item.selfGrade === 'full' ? '完全正确' : item.selfGrade === 'partial' ? '基本正确' : '错误' }}</span>
          </header>
          <div class="stem-text"><MarkdownText :source="item.question.stem" /></div>

          <ul v-if="item.question.options.length" class="opts">
            <li
              v-for="option in item.question.options"
              :key="option.key"
              class="opt"
              :class="{
                correct: item.question.answer.includes(option.key),
                wrong: item.given.includes(option.key) && !item.question.answer.includes(option.key),
              }"
            >
              <span class="opt-key mono">{{ option.key }}</span>
              <span class="option-text">{{ option.text }}</span>
            </li>
          </ul>

          <div class="answers-line small">
            <span class="muted">你的答案</span>
            <b class="num">{{ displayAnswer(item.question, item.given) }}</b>
            <span class="muted">正确答案</span>
            <b class="num">{{ displayAnswer(item.question, item.question.answer) }}</b>
          </div>

          <div v-if="item.question.explanation" class="explain">
            <div class="small muted">解析</div>
            <MarkdownText :source="item.question.explanation" />
          </div>
        </article>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
.summary {
  margin-top: 12px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.score-block {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.score {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.score-total {
  font-size: 18px;
  color: var(--text-faint);
  font-weight: 400;
}
.meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin: 0;
}
.meta div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta dt {
  font-size: 11.5px;
  color: var(--text-faint);
}
.meta dd {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-toolbar);
}
.actions {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.review {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-title {
  font-size: var(--fs-toolbar);
  color: var(--text-muted);
  font-weight: 600;
}
.qcard {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.qhead {
  display: flex;
  align-items: center;
  gap: 8px;
}
.qno {
  font-size: 12px;
  color: var(--text-faint);
}
.stem-text {
  font-size: 15px;
  line-height: 1.65;
  font-variant-ligatures: none;
}
.opts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.opt {
  display: flex;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-toolbar);
}
.opt.correct {
  border-color: var(--ok-border);
  background: var(--ok-bg);
}
.opt.wrong {
  border-color: var(--err-border);
  background: var(--err-bg);
}
.opt-key {
  color: var(--text-muted);
  font-size: 12px;
}
.option-text {
  font-variant-ligatures: none;
}
.answers-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
.explain {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
