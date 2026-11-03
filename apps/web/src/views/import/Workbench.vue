<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, RotateCcw, Search } from 'lucide-vue-next'
import type { QuestionType } from '@kaoshiya/shared'
import { QUESTION_TYPES, QUESTION_TYPE_LABELS } from '@kaoshiya/shared'
import QuestionEditor from './QuestionEditor.vue'
import type { EditableQuestion } from './types'

const props = defineProps<{
  questions: EditableQuestion[]
  pageTexts: string[]
  selectedIndex: number
  canUndo: boolean
}>()

const emit = defineEmits<{
  select: [index: number]
  update: [uid: string, patch: Partial<EditableQuestion>]
  remove: [index: number]
  split: [index: number]
  merge: [index: number]
  batchChapter: [name: string]
  batchType: [type: QuestionType]
  undo: []
  rerun: []
}>()

const page = ref(0)
const batchChapterValue = ref('')
const batchTypeValue = ref<QuestionType>('single')
const onlyIssues = ref(false)

const selected = computed<EditableQuestion | null>(() => props.questions[props.selectedIndex] ?? null)
const pageText = computed(() => props.pageTexts[page.value] ?? '')
const visible = computed(() => {
  if (!onlyIssues.value) return props.questions.map((question, index) => ({ question, index }))
  return props.questions
    .map((question, index) => ({ question, index }))
    .filter((item) => item.question.issues.length > 0)
})
const issueTotal = computed(() => props.questions.filter((question) => question.issues.length > 0).length)

function prevPage(): void {
  if (page.value > 0) page.value -= 1
}
function nextPage(): void {
  if (page.value < props.pageTexts.length - 1) page.value += 1
}
</script>

<template>
  <div class="workbench">
    <!-- 左：原文预览 -->
    <section class="col raw">
      <header class="col-head">
        <span class="col-title">原文预览</span>
        <div class="row">
          <button class="icon-btn" type="button" :disabled="page <= 0" aria-label="上一页" @click="prevPage">
            <ChevronLeft :size="14" />
          </button>
          <span class="small num muted">{{ pageTexts.length ? page + 1 : 0 }} / {{ pageTexts.length }}</span>
          <button class="icon-btn" type="button" :disabled="page >= pageTexts.length - 1" aria-label="下一页" @click="nextPage">
            <ChevronRight :size="14" />
          </button>
        </div>
      </header>
      <pre class="raw-text">{{ pageText || '没有可预览的原文' }}</pre>
    </section>

    <!-- 中：题卡流 -->
    <section class="col list">
      <header class="col-head">
        <span class="col-title">题卡 <span class="num">{{ questions.length }}</span></span>
        <div class="row">
          <label class="toggle small" :class="{ active: onlyIssues }">
            <input v-model="onlyIssues" type="checkbox" class="sr-only" />
            <Search :size="13" /> 仅看问题 {{ issueTotal }}
          </label>
        </div>
      </header>

      <div class="batch">
        <div class="batch-row">
          <input v-model="batchChapterValue" class="input input-sm" type="text" placeholder="批量章节名" />
          <button class="btn btn-sm" type="button" :disabled="!batchChapterValue.trim()" @click="emit('batchChapter', batchChapterValue.trim())">
            应用
          </button>
        </div>
        <div class="batch-row">
          <select v-model="batchTypeValue" class="select input-sm" aria-label="批量题型">
            <option v-for="type in QUESTION_TYPES" :key="type" :value="type">{{ QUESTION_TYPE_LABELS[type] }}</option>
          </select>
          <button class="btn btn-sm" type="button" @click="emit('batchType', batchTypeValue)">应用题型</button>
        </div>
        <div class="batch-row">
          <button class="btn btn-sm" type="button" :disabled="!canUndo" @click="emit('undo')">
            <RotateCcw :size="13" /> 撤销
          </button>
          <button class="btn btn-sm" type="button" @click="emit('rerun')">重跑模板</button>
        </div>
      </div>

      <div class="cards">
        <button
          v-for="item in visible"
          :key="item.question.uid"
          class="qcard"
          :class="{ active: item.index === selectedIndex, issue: item.question.issues.length > 0 }"
          type="button"
          @click="emit('select', item.index)"
        >
          <div class="qcard-top">
            <span class="qcard-no num">{{ item.question.no ?? '—' }}</span>
            <span class="badge">{{ QUESTION_TYPE_LABELS[item.question.type] }}</span>
            <span v-if="item.question.issues.length" class="issue-tag">! {{ item.question.issues[0]?.label }}</span>
          </div>
          <div class="qcard-stem truncate">{{ item.question.stem || '（空题干）' }}</div>
          <div class="qcard-opts small faint">{{ item.question.options.map((o) => o.key).join(' ') || '无选项' }}</div>
        </button>
        <p v-if="visible.length === 0" class="small faint center">没有符合条件的题目</p>
      </div>
    </section>

    <!-- 右：单题编辑器 -->
    <section class="col editor-col">
      <QuestionEditor
        v-if="selected"
        :question="selected"
        :can-merge-next="selectedIndex < questions.length - 1"
        @update="(patch) => emit('update', selected!.uid, patch)"
        @remove="emit('remove', selectedIndex)"
        @split="emit('split', selectedIndex)"
        @merge="emit('merge', selectedIndex)"
      />
      <p v-else class="small faint center">从中间列表选择一道题开始校对</p>
    </section>
  </div>
</template>

<style scoped>
.workbench {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 380px) minmax(0, 420px);
  gap: 10px;
  align-items: start;
}
.col {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
  min-height: 420px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.col-title {
  font-size: var(--fs-toolbar);
  font-weight: 600;
}
.raw-text {
  margin: 0;
  padding: 10px 12px;
  flex: 1;
  max-height: 62vh;
  overflow: auto;
  white-space: pre-wrap;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
  background: var(--bg);
}
.batch {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.batch-row {
  display: flex;
  gap: 6px;
}
.input-sm {
  height: 28px;
  min-height: 28px;
  padding: 2px 8px;
  font-size: var(--fs-small);
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  cursor: pointer;
}
.toggle.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--text);
}
.cards {
  flex: 1;
  overflow: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 62vh;
}
.qcard {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--text);
}
.qcard:hover {
  background: var(--bg-hover);
}
.qcard.active {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.qcard.issue {
  border-left: 3px solid var(--err);
}
.qcard-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.qcard-no {
  font-size: 11.5px;
  color: var(--text-faint);
}
.qcard-stem {
  font-size: 12.5px;
  color: var(--text-muted);
}
.issue-tag {
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--err);
}
.editor-col {
  padding: 12px;
  max-height: 72vh;
  overflow: auto;
}
.center {
  text-align: center;
  padding: 24px 12px;
}
@media (max-width: 1279px) {
  .workbench {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .col.raw {
    display: none;
  }
}
@media (max-width: 899px) {
  .workbench {
    grid-template-columns: 1fr;
  }
  .cards {
    max-height: 40vh;
  }
  .editor-col {
    max-height: none;
  }
}
</style>
