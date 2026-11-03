<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, ChevronDown, ChevronRight, Download } from 'lucide-vue-next'
import { QUESTION_TYPES, QUESTION_TYPE_LABELS } from '@kaoshiya/shared'
import type { QualityReport } from '@kaoshiya/shared'
import type { EditableQuestion } from './types'

const props = defineProps<{ report: QualityReport; questions: EditableQuestion[] }>()

const open = ref(true)

const rows = computed(() => [
  { label: '总题数', value: props.report.total, tone: 'neutral' },
  { label: '缺答案', value: props.report.missingAnswer, tone: props.report.missingAnswer > 0 ? 'error' : 'neutral' },
  { label: '缺解析', value: props.report.missingExplanation, tone: props.report.missingExplanation > 0 ? 'warn' : 'neutral' },
  { label: '选项数量异常', value: props.report.optionCountIssues, tone: props.report.optionCountIssues > 0 ? 'error' : 'neutral' },
  { label: '答案越界', value: props.report.answerOutOfRange, tone: props.report.answerOutOfRange > 0 ? 'error' : 'neutral' },
  { label: '重复题干', value: props.report.duplicateStem, tone: props.report.duplicateStem > 0 ? 'warn' : 'neutral' },
  { label: '重复题号', value: props.report.duplicateNo, tone: props.report.duplicateNo > 0 ? 'warn' : 'neutral' },
  { label: '疑似乱码', value: props.report.garbled, tone: props.report.garbled > 0 ? 'warn' : 'neutral' },
])

const typeRows = computed(() =>
  QUESTION_TYPES.map((type) => ({ type, label: QUESTION_TYPE_LABELS[type], count: props.report.byType[type] ?? 0 })).filter(
    (row) => row.count > 0,
  ),
)

const issueCount = computed(() =>
  rows.value.filter((row) => row.label !== '总题数').reduce((sum, row) => sum + row.value, 0),
)

function exportCsv(): void {
  const header = ['题号', '题型', '题干', '选项', '答案', '解析', '问题']
  const lines = [header.join(',')]
  for (const question of props.questions) {
    const cells = [
      question.no ?? '',
      QUESTION_TYPE_LABELS[question.type],
      question.stem,
      question.options.map((option) => `${option.key}.${option.text}`).join(' | '),
      question.answer.join(''),
      question.explanation,
      question.issues.map((issue) => issue.label).join(' / '),
    ]
    lines.push(
      cells
        .map((cell) => {
          const text = String(cell).replace(/"/g, '""')
          return /[",\n]/.test(text) ? `"${text}"` : text
        })
        .join(','),
    )
  }
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `kaoshiya-quality-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="panel">
    <button class="panel-head" type="button" :aria-expanded="open" @click="open = !open">
      <component :is="open ? ChevronDown : ChevronRight" :size="15" />
      <span class="grow">质量报告</span>
      <span v-if="issueCount > 0" class="badge badge-warn"><AlertTriangle :size="12" /> {{ issueCount }} 处待处理</span>
      <span v-else class="badge badge-ok">未发现明显问题</span>
    </button>

    <div v-if="open" class="panel-body">
      <ul class="metrics">
        <li v-for="row in rows" :key="row.label" class="metric" :data-tone="row.tone">
          <span class="metric-label">{{ row.label }}</span>
          <span class="metric-value num">{{ row.value }}</span>
        </li>
      </ul>
      <div v-if="typeRows.length" class="types">
        <span v-for="row in typeRows" :key="row.type" class="badge">{{ row.label }} {{ row.count }}</span>
      </div>
      <button class="btn btn-sm" type="button" @click="exportCsv"><Download :size="14" /> 导出 CSV</button>
    </div>
  </div>
</template>

<style scoped>
.panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: var(--fs-toolbar);
  color: var(--text);
  text-align: left;
}
.panel-body {
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.metrics {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(126px, 1fr));
  gap: 6px;
}
.metric {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-small);
}
.metric[data-tone='error'] {
  border-color: var(--err-border);
  background: var(--err-bg);
}
.metric[data-tone='warn'] {
  border-color: var(--warn-border);
  background: var(--warn-bg);
}
.metric-label {
  color: var(--text-muted);
}
.metric-value {
  font-weight: 700;
}
.types {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
