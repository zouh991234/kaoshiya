<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FileText, Loader2, Upload } from 'lucide-vue-next'
import type { ExtractedDoc } from '@kaoshiya/shared/parsers'
import { extractFile } from '@kaoshiya/shared/parsers'
import type { QualityIssue, QuestionMedia, QuestionOption, QuestionType, SrcRef } from '@kaoshiya/shared'
import {
  BUILTIN_TEMPLATES,
  QUESTION_TYPE_LABELS,
  buildQualityReport,
  detectQuestionType,
  findDuplicateIndexes,
  normalizeOptions,
  normalizeStem,
  parseAnswer,
  questionIssues,
  type SplitTemplate,
  type TemplateRule,
} from '@kaoshiya/shared'
import AppShell from '@/components/AppShell.vue'
import Modal from '@/components/Modal.vue'
import QualityPanel from './QualityPanel.vue'
import Workbench from './Workbench.vue'
import type { EditableQuestion, ImportDraft } from './types'
import { api, HttpError } from '@/api/client'
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const bankId = computed(() => String(route.params.id))
const steps = ['选择文件', '抽取内容', '切题规则', '校对', '入库'] as const
const step = ref(0)

const file = ref<File | null>(null)
const doc = ref<ExtractedDoc | null>(null)
const extracting = ref(false)
const extractError = ref('')

const templates = ref<SplitTemplate[]>([...BUILTIN_TEMPLATES])
const templateId = ref<string>(BUILTIN_TEMPLATES[0]?.id ?? 'numbered')
const rule = reactive<TemplateRule>({
  questionNo: BUILTIN_TEMPLATES[0]?.questionNo ?? '',
  option: BUILTIN_TEMPLATES[0]?.option ?? '',
  answer: BUILTIN_TEMPLATES[0]?.answer ?? '',
  explanation: BUILTIN_TEMPLATES[0]?.explanation ?? '',
})
const templateNameOpen = ref(false)
const templateName = ref('')
const CUSTOM_TEMPLATE_KEY = 'kaoshiya:split-templates'
const answersSeparated = ref(false)
const answerSource = ref('')
const ruleError = ref('')

const questions = ref<EditableQuestion[]>([])
const selectedIndex = ref(0)
const history = ref<EditableQuestion[][]>([])
const draftFound = ref<ImportDraft | null>(null)

const submitting = ref(false)
const submittedBatches = ref(0)
const totalBatches = ref(0)
const submitError = ref('')
const importId = ref(crypto.randomUUID())

const report = computed(() => {
  const items = questions.value.map((question) => ({
    stem: question.stem,
    type: question.type,
    options: question.options,
    answer: question.answer,
    explanation: question.explanation,
    no: question.no,
  }))
  return buildQualityReport(items)
})

const byteSize = computed(() => new Blob([JSON.stringify(questions.value)]).size)

function syncRuleFromTemplate(): void {
  const template = templates.value.find((item) => item.id === templateId.value)
  if (!template) return
  rule.questionNo = template.questionNo
  rule.option = template.option
  rule.answer = template.answer
  rule.explanation = template.explanation
  resplit()
}

function loadCustomTemplates(): void {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATE_KEY)
    if (!raw) return
    const list = JSON.parse(raw) as SplitTemplate[]
    if (!Array.isArray(list)) return
    const builtinIds = new Set(templates.value.map((item) => item.id))
    const custom = list.filter((item) => item && item.id && !builtinIds.has(item.id))
    templates.value = [...templates.value, ...custom.map((item) => ({ ...item, builtin: false }))]
  } catch {
    // 本地模板损坏时忽略，不影响导入
  }
}

function saveAsTemplate(): void {
  const name = templateName.value.trim()
  if (!name) {
    toast.error('请填写模板名称')
    return
  }
  const template: SplitTemplate = {
    id: `custom-${Date.now()}`,
    name,
    builtin: false,
    description: '自定义模板（保存在当前浏览器）',
    questionNo: rule.questionNo,
    option: rule.option,
    answer: rule.answer,
    explanation: rule.explanation,
  }
  templates.value = [...templates.value, template]
  templateId.value = template.id
  try {
    const custom = templates.value.filter((item) => !item.builtin)
    localStorage.setItem(CUSTOM_TEMPLATE_KEY, JSON.stringify(custom))
  } catch {
    toast.error('当前浏览器不允许保存本地模板，仅本次有效')
  }
  templateNameOpen.value = false
  templateName.value = ''
  toast.ok(`已保存模板「${template.name}」`)
}

function uid(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}`
}

function pushHistory(): void {
  history.value = [...history.value.slice(-19), questions.value.map((question) => ({ ...question }))]
}

/** 归一化 + 题型识别，绝不改写题干原文。 */
function toEditable(block: {
  index: number
  no: number | null
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
}): EditableQuestion {
  const stem = normalizeStem(block.stem)
  const options = normalizeOptions(block.options)
  const answer = block.answer.length > 0 ? block.answer : parseAnswer('')
  const type: QuestionType =
    options.length > 0
      ? answer.length > 1
        ? 'multiple'
        : 'single'
      : detectQuestionType({ stem, options, answer })
  const question: EditableQuestion = {
    uid: uid(),
    no: block.no,
    type,
    stem,
    options,
    answer,
    explanation: block.explanation.trim(),
    difficulty: 3,
    tags: [],
    chapterName: '',
    media: [] as QuestionMedia[],
    srcRef: { file: doc.value?.fileName } as SrcRef,
    issues: [] as QualityIssue[],
  }
  question.issues = questionIssues(question)
  return question
}

function resplit(silent = false): void {
  ruleError.value = ''
  if (!doc.value) return
  try {
    // 延迟引入避免首屏加载解析器
    import('@kaoshiya/shared').then(({ splitAndParse, applyAnswerMap, parseAnswerSection }) => {
      const blocks = splitAndParse(doc.value?.text ?? '', rule)
      if (blocks.length === 0) {
        ruleError.value = '当前规则没有切出任何题目，请调整题号正则'
        return
      }
      if (answersSeparated.value && answerSource.value.trim()) {
        const map = parseAnswerSection(answerSource.value)
        const merged = applyAnswerMap(blocks, map)
        questions.value = merged.map(toEditable)
      } else {
        questions.value = blocks.map(toEditable)
      }
      markDuplicates()
      selectedIndex.value = 0
      if (!silent) toast.info(`按当前规则切出 ${questions.value.length} 题`)
    })
  } catch (err) {
    ruleError.value = err instanceof Error ? err.message : '切题失败'
  }
}

function markDuplicates(): void {
  const { stems, nos } = findDuplicateIndexes(
    questions.value.map((question) => ({
      stem: question.stem,
      type: question.type,
      options: question.options,
      answer: question.answer,
      explanation: question.explanation,
      no: question.no,
    })),
  )
  questions.value = questions.value.map((question, index) => {
    const extra: QualityIssue[] = []
    if (stems.has(index)) extra.push({ code: 'duplicate-stem', label: '题干重复', severity: 'warn' })
    if (nos.has(index)) extra.push({ code: 'duplicate-no', label: '题号重复', severity: 'warn' })
    const base = questionIssues(question)
    return { ...question, issues: [...base, ...extra] }
  })
}

async function onPickFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  if (!picked) return
  file.value = picked
  extracting.value = true
  extractError.value = ''
  doc.value = null
  try {
    const extracted = await extractFile(picked)
    doc.value = extracted
    if (extracted.scanned) {
      extractError.value =
        extracted.warnings.find((warning) => warning.code === 'scanned-pdf')?.message ??
        '这份 PDF 几乎没有文本层，可能是扫描件。请先做 OCR 转换，或改为手动录题。'
      step.value = 1
      return
    }
    if (extracted.direct && extracted.direct.length > 0) {
      questions.value = extracted.direct.map((item) =>
        toEditable({
          index: 0,
          no: item.no,
          stem: item.stem,
          options: item.options,
          answer: item.answer,
          explanation: item.explanation,
        }),
      )
      markDuplicates()
      step.value = 3
      return
    }
    step.value = 1
    resplit(true)
  } catch (err) {
    extractError.value = err instanceof Error ? err.message : '抽取失败'
  } finally {
    extracting.value = false
  }
}

function updateQuestion(targetUid: string, patch: Partial<EditableQuestion>): void {
  pushHistory()
  questions.value = questions.value.map((question) => {
    if (question.uid !== targetUid) return question
    const next = { ...question, ...patch }
    next.issues = questionIssues(next)
    return next
  })
}

function removeQuestion(index: number): void {
  pushHistory()
  questions.value = questions.value.filter((_, i) => i !== index)
  selectedIndex.value = Math.max(0, Math.min(index, questions.value.length - 1))
}

function splitQuestion(index: number): void {
  const source = questions.value[index]
  if (!source) return
  pushHistory()
  const marker = source.stem.indexOf('\n')
  const cut = marker === -1 ? Math.ceil(source.stem.length / 2) : marker
  const first: EditableQuestion = {
    ...source,
    uid: uid(),
    stem: source.stem.slice(0, cut).trim(),
    options: source.options,
    answer: [],
    issues: [],
  }
  const second: EditableQuestion = {
    ...source,
    uid: uid(),
    no: source.no === null ? null : source.no + 1,
    stem: source.stem.slice(cut).trim(),
    options: [],
    issues: [],
  }
  const next = [...questions.value]
  next.splice(index, 1, first, second)
  questions.value = next
  markDuplicates()
}

function mergeQuestion(index: number): void {
  const current = questions.value[index]
  const next = questions.value[index + 1]
  if (!current || !next) return
  pushHistory()
  const merged: EditableQuestion = {
    ...current,
    uid: uid(),
    stem: `${current.stem}\n${next.stem}`.trim(),
    explanation: [current.explanation, next.explanation].filter(Boolean).join('\n'),
    issues: [],
  }
  const list = [...questions.value]
  list.splice(index, 2, merged)
  questions.value = list
  markDuplicates()
}

function batchChapter(name: string): void {
  pushHistory()
  questions.value = questions.value.map((question) => ({ ...question, chapterName: name }))
  toast.ok(`已把 ${questions.value.length} 道题设到章节「${name}」`)
}

function batchType(type: QuestionType): void {
  pushHistory()
  questions.value = questions.value.map((question) => ({ ...question, type }))
  toast.ok(`已把 ${questions.value.length} 道题设为${QUESTION_TYPE_LABELS[type]}`)
}

function undo(): void {
  const previous = history.value[history.value.length - 1]
  if (!previous) return
  questions.value = previous
  history.value = history.value.slice(0, -1)
}

function chunkQuestions(): EditableQuestion[][] {
  const chunks: EditableQuestion[][] = []
  let current: EditableQuestion[] = []
  let bytes = 0
  const limit = 100
  const maxBytes = 1_900_000
  for (const question of questions.value) {
    const size = new Blob([JSON.stringify(question)]).size
    if (current.length > 0 && (current.length >= limit || bytes + size > maxBytes)) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(question)
    bytes += size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

async function submit(): Promise<void> {
  if (questions.value.length === 0) {
    toast.error('没有可入库的题目')
    return
  }
  const blocking = questions.value.filter((question) =>
    question.issues.some((issue) => issue.severity === 'error'),
  )
  if (blocking.length > 0) {
    toast.error(`还有 ${blocking.length} 道题存在必须修复的问题（缺答案 / 选项异常 / 答案越界）`)
    return
  }
  const chunks = chunkQuestions()
  submitting.value = true
  submitError.value = ''
  submittedBatches.value = 0
  totalBatches.value = chunks.length
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] ?? []
      await api.importBatch(bankId.value, {
        importId: importId.value,
        batchIndex: index,
        batchCount: chunks.length,
        chapters: [...new Set(chunk.map((q) => q.chapterName).filter(Boolean))],
        questions: chunk.map((question) => ({
          chapterName: question.chapterName || undefined,
          type: question.type,
          no: question.no,
          stem: question.stem,
          options: question.options,
          answer: question.answer,
          explanation: question.explanation,
          difficulty: question.difficulty,
          tags: question.tags,
          media: question.media,
          srcRef: question.srcRef,
        })),
      })
      submittedBatches.value = index + 1
    }
    await clearDraft(`import:${bankId.value}`)
    toast.ok(`已入库 ${questions.value.length} 题`)
    await router.push(`/banks/${bankId.value}`)
  } catch (err) {
    submitError.value = err instanceof HttpError ? err.message : '入库失败，已完成的批次可以重试，不会重复写入'
  } finally {
    submitting.value = false
  }
}

const saveTimer = ref<number | null>(null)
watch(
  questions,
  (value) => {
    if (saveTimer.value !== null) window.clearTimeout(saveTimer.value)
    saveTimer.value = window.setTimeout(() => {
      if (value.length === 0) return
      void saveDraft<ImportDraft>(`import:${bankId.value}`, {
        bankId: bankId.value,
        fileName: doc.value?.fileName ?? file.value?.name ?? '',
        text: doc.value?.text ?? '',
        pageTexts: doc.value?.pageTexts ?? [],
        questions: value,
        templateId: templateId.value,
        updatedAt: new Date().toISOString(),
      })
    }, 1200)
  },
  { deep: true },
)

function resumeDraft(): void {
  const draft = draftFound.value
  if (!draft) return
  questions.value = draft.questions
  templateId.value = draft.templateId
  doc.value = {
    kind: 'txt',
    fileName: draft.fileName,
    text: draft.text,
    pageTexts: draft.pageTexts.length ? draft.pageTexts : [draft.text],
    tables: [],
    headings: [],
    warnings: [],
    scanned: false,
    stats: { chars: draft.text.length, pages: draft.pageTexts.length, sheets: 0 },
    direct: null,
  }
  step.value = 3
  draftFound.value = null
  toast.info('已恢复上次的校对草稿')
}

async function discardDraft(): Promise<void> {
  await clearDraft(`import:${bankId.value}`)
  draftFound.value = null
}

onMounted(async () => {
  loadCustomTemplates()
  const payload = await loadDraft<ImportDraft>(`import:${bankId.value}`)
  if (payload && payload.data.questions.length > 0) draftFound.value = payload.data
})
</script>

<template>
  <AppShell>
    <div class="import-head">
      <button class="btn btn-ghost btn-sm" type="button" @click="router.push(`/banks/${bankId}`)">
        <ArrowLeft :size="14" /> 返回题库
      </button>
      <h1 class="title">导入题库</h1>
      <span class="small faint">文档只在你当前浏览器里解析，服务端只接收校对后的结构化题目</span>
    </div>

    <ol class="steps">
      <li v-for="(label, index) in steps" :key="label" class="step" :class="{ active: index === step, done: index < step }">
        <span class="step-no mono">{{ index + 1 }}</span>
        <span class="step-label">{{ label }}</span>
      </li>
    </ol>

    <div v-if="draftFound" class="card draft-bar">
      <span class="grow small">检测到上次未完成的校对草稿（{{ draftFound.questions.length }} 题，{{ draftFound.updatedAt.slice(0, 16).replace('T', ' ') }}）</span>
      <button class="btn btn-sm" type="button" @click="discardDraft">丢弃</button>
      <button class="btn btn-sm btn-primary" type="button" @click="resumeDraft">继续校对</button>
    </div>

    <!-- 1 选择文件 -->
    <section v-if="step === 0" class="card panel">
      <h2 class="panel-title">选择文件</h2>
      <p class="small muted">支持 Word（.docx）、PDF、Excel（.xlsx）、CSV、TXT、Markdown、JSON。旧版 .doc 请先另存为 .docx。</p>
      <label class="dropzone">
        <Upload :size="22" />
        <span>{{ extracting ? '正在抽取…' : file ? file.name : '点击选择文件' }}</span>
        <span class="small faint">文件不会上传，解析全程在本地浏览器完成</span>
        <input class="sr-only" type="file" accept=".docx,.pdf,.xlsx,.xls,.csv,.txt,.md,.json" @change="onPickFile" />
      </label>
      <p v-if="extractError" class="field-error"><AlertTriangle :size="14" /> {{ extractError }}</p>
      <div class="row">
        <button class="btn" type="button" :disabled="!doc || extracting" @click="step = 1">
          下一步 <ArrowRight :size="14" />
        </button>
      </div>
    </section>

    <!-- 2 抽取 -->
    <section v-else-if="step === 1" class="card panel">
      <h2 class="panel-title">抽取内容</h2>
      <div v-if="doc" class="extract-meta">
        <span class="badge">{{ doc.fileName }}</span>
        <span class="badge">字符 {{ doc.stats.chars }}</span>
        <span v-if="doc.stats.pages" class="badge">页数 {{ doc.stats.pages }}</span>
        <span v-if="doc.stats.sheets" class="badge">工作表 {{ doc.stats.sheets }}</span>
      </div>
      <ul v-if="doc?.warnings.length" class="warnings">
        <li v-for="warning in doc.warnings" :key="warning.code" class="small">
          <AlertTriangle :size="13" /> {{ warning.message }}
        </li>
      </ul>
      <pre class="preview">{{ doc?.text?.slice(0, 4000) || '没有抽取到文本' }}</pre>
      <div class="row">
        <button class="btn" type="button" @click="step = 0">上一步</button>
        <button class="btn btn-primary" type="button" :disabled="!doc" @click="step = 2; resplit(true)">
          下一步 <ArrowRight :size="14" />
        </button>
      </div>
    </section>

    <!-- 3 切题规则 -->
    <section v-else-if="step === 2" class="card panel">
      <h2 class="panel-title">切题规则</h2>
      <div class="templates">
        <button
          v-for="template in templates"
          :key="template.id"
          class="template"
          type="button"
          :class="{ active: templateId === template.id }"
          @click="templateId = template.id; syncRuleFromTemplate()"
        >
          <span class="template-name">{{ template.name }}</span>
          <span class="small faint">{{ template.description }}</span>
        </button>
      </div>

      <div class="rules">
        <label class="field">
          <span class="field-label">题号正则</span>
          <input v-model="rule.questionNo" class="input mono" @change="resplit(true)" />
        </label>
        <label class="field">
          <span class="field-label">选项正则</span>
          <input v-model="rule.option" class="input mono" @change="resplit(true)" />
        </label>
        <label class="field">
          <span class="field-label">答案正则</span>
          <input v-model="rule.answer" class="input mono" @change="resplit(true)" />
        </label>
        <label class="field">
          <span class="field-label">解析正则</span>
          <input v-model="rule.explanation" class="input mono" @change="resplit(true)" />
        </label>
      </div>
      <p v-if="ruleError" class="field-error">{{ ruleError }}</p>
      <div class="row">
        <button class="btn btn-sm" type="button" @click="templateNameOpen = true">另存为模板</button>
        <span class="small faint">自定义模板保存在当前浏览器，仅管理员本机可见</span>
      </div>

      <label class="switch-row">
        <input v-model="answersSeparated" type="checkbox" />
        <span class="grow">
          <span class="field-label">答案分离式</span>
          <span class="field-hint">答案集中在卷末或另一个文件时，把答案粘贴到下方，按题号自动回溯匹配（支持 1-10 ABCDA、1.A 2.B、√/×、对/错）</span>
        </span>
      </label>
      <textarea v-if="answersSeparated" v-model="answerSource" class="textarea mono" rows="4" placeholder="答案：1-5 ABCDA&#10;6.B 7.√" @change="resplit(true)" />

      <div class="preview-head row-between">
        <span class="small muted">预览：已切出 <b class="num">{{ questions.length }}</b> 题</span>
        <button class="btn btn-sm" type="button" @click="resplit()">立即重切</button>
      </div>
      <div class="mini-cards">
        <div v-for="question in questions.slice(0, 6)" :key="question.uid" class="mini-card">
          <span class="mini-no mono">{{ question.no ?? '—' }}</span>
          <span class="mini-stem truncate">{{ question.stem }}</span>
          <span class="badge">{{ QUESTION_TYPE_LABELS[question.type] }}</span>
        </div>
      </div>

      <div class="row">
        <button class="btn" type="button" @click="step = 1">上一步</button>
        <button class="btn btn-primary" type="button" :disabled="questions.length === 0" @click="step = 3">
          进入校对 <ArrowRight :size="14" />
        </button>
      </div>
    </section>

    <!-- 4 校对 -->
    <section v-else-if="step === 3">
      <QualityPanel :report="report" :questions="questions" />
      <Workbench
        :questions="questions"
        :page-texts="doc?.pageTexts ?? []"
        :selected-index="selectedIndex"
        :can-undo="history.length > 0"
        @select="(index) => (selectedIndex = index)"
        @update="updateQuestion"
        @remove="removeQuestion"
        @split="splitQuestion"
        @merge="mergeQuestion"
        @batch-chapter="batchChapter"
        @batch-type="batchType"
        @undo="undo"
        @rerun="resplit()"
      />
      <div class="foot-bar card">
        <span class="small muted grow">
          共 <b class="num">{{ questions.length }}</b> 题 · 约 {{ (byteSize / 1024).toFixed(0) }} KB · 分批 {{ Math.ceil(questions.length / 100) }} 次提交
        </span>
        <button class="btn" type="button" @click="step = 2">上一步</button>
        <button class="btn btn-primary" type="button" :disabled="submitting" @click="step = 4">
          去入库 <ArrowRight :size="14" />
        </button>
      </div>
    </section>

    <!-- 5 入库 -->
    <section v-else class="card panel">
      <h2 class="panel-title">确认入库</h2>
      <ul class="summary small">
        <li><FileText :size="14" /> 来源文件：{{ doc?.fileName || '—' }}</li>
        <li>题目数量：<b class="num">{{ questions.length }}</b></li>
        <li>缺失答案：<b class="num">{{ report.missingAnswer }}</b>（必须为 0 才能入库）</li>
        <li>分批数量：<b class="num">{{ Math.max(1, Math.ceil(questions.length / 100)) }}</b></li>
      </ul>

      <div v-if="submitting" class="progress-wrap">
        <div class="progress"><span :style="{ width: `${totalBatches ? (submittedBatches / totalBatches) * 100 : 0}%` }" /></div>
        <span class="small muted"><Loader2 :size="13" class="spin" /> 正在提交 {{ submittedBatches }} / {{ totalBatches }} 批</span>
      </div>
      <p v-if="submitError" class="field-error">{{ submitError }}</p>

      <div class="row">
        <button class="btn" type="button" :disabled="submitting" @click="step = 3">上一步</button>
        <button class="btn btn-primary" type="button" :disabled="submitting || questions.length === 0" @click="submit">
          <CheckCircle2 :size="15" /> {{ submitting ? '入库中…' : submitError ? '重试提交' : '确认入库' }}
        </button>
      </div>
      <p class="small faint">提交失败时已完成批次会被跳过，重试不会重复写入。</p>
    </section>
    <Modal :open="templateNameOpen" title="另存为切题模板" :width="420" @close="templateNameOpen = false">
      <label class="field">
        <span class="field-label">模板名称</span>
        <input v-model="templateName" class="input" type="text" placeholder="例如：XX 考试编号式" />
      </label>
      <template #footer>
        <button class="btn" type="button" @click="templateNameOpen = false">取消</button>
        <button class="btn btn-primary" type="button" @click="saveAsTemplate">保存</button>
      </template>
    </Modal>

  </AppShell>
</template>

<style scoped>
.import-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.title {
  font-size: var(--fs-title);
}
.steps {
  display: flex;
  gap: 6px;
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  flex-wrap: wrap;
}
.step {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: var(--fs-small);
  color: var(--text-faint);
  background: var(--bg-elev);
}
.step.done,
.step.active {
  color: var(--text);
}
.step.active {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.step-no {
  font-size: 11px;
}
.panel {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.panel-title {
  font-size: var(--fs-body);
  font-weight: 600;
}
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 32px 16px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-muted);
  text-align: center;
}
.dropzone:hover {
  border-color: var(--primary);
  background: var(--bg-hover);
}
.extract-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.warnings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.warnings li {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--warn);
}
.preview {
  max-height: 260px;
  overflow: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.7;
}
.templates {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.template {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
  text-align: left;
  cursor: pointer;
}
.template.active {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.template-name {
  font-size: var(--fs-toolbar);
  font-weight: 600;
}
.rules {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.switch-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.switch-row .field-label {
  display: block;
}
.switch-row .field-hint {
  display: block;
}
.preview-head {
  margin-top: 4px;
}
.mini-cards {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
}
.mini-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.mini-no {
  font-size: 11px;
  color: var(--text-faint);
  width: 22px;
}
.mini-stem {
  flex: 1;
  font-size: 12.5px;
  color: var(--text-muted);
}
.foot-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  margin-top: 10px;
  position: sticky;
  bottom: 0;
}
.summary {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.summary li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.progress-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.draft-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.spin {
  animation: spin 1s linear infinite;
  vertical-align: -2px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 767px) {
  .rules {
    grid-template-columns: 1fr;
  }
}
</style>
