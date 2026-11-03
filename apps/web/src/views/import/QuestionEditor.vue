<script setup lang="ts">
import { computed, ref } from 'vue'
import { ImagePlus, Plus, SplitSquareHorizontal, Trash2 } from 'lucide-vue-next'
import type { QuestionOption, QuestionType } from '@kaoshiya/shared'
import { QUESTION_TYPES, QUESTION_TYPE_LABELS } from '@kaoshiya/shared'
import type { EditableQuestion } from './types'

const props = defineProps<{ question: EditableQuestion; canMergeNext: boolean }>()
const emit = defineEmits<{
  update: [patch: Partial<EditableQuestion>]
  remove: []
  split: []
  merge: []
}>()

const uploading = ref(false)
const uploadError = ref('')

const answerText = computed({
  get: () => props.question.answer.join(' '),
  set: (value: string) => {
    const tokens = value
      .replace(/[，,、;；]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.toUpperCase())
    emit('update', { answer: tokens })
  },
})

function setType(type: QuestionType): void {
  const patch: Partial<EditableQuestion> = { type }
  if (type === 'judge') {
    patch.options = []
    if (!props.question.answer.every((a) => a === 'T' || a === 'F')) patch.answer = []
  }
  emit('update', patch)
}

function toggleAnswer(key: string): void {
  const set = new Set(props.question.answer)
  if (set.has(key)) set.delete(key)
  else set.add(key)
  emit('update', { answer: [...set].sort() })
}

function updateOption(index: number, patch: Partial<QuestionOption>): void {
  const options = props.question.options.map((option, i) => (i === index ? { ...option, ...patch } : option))
  emit('update', { options })
}

function addOption(): void {
  const nextKey = String.fromCharCode(65 + props.question.options.length)
  emit('update', { options: [...props.question.options, { key: nextKey, text: '' }] })
}

function removeOption(index: number): void {
  const removed = props.question.options[index]
  const options = props.question.options
    .filter((_, i) => i !== index)
    .map((option, i) => ({ ...option, key: String.fromCharCode(65 + i) }))
  const answer = removed ? props.question.answer.filter((a) => a !== removed.key) : props.question.answer
  emit('update', { options, answer })
}

async function onPickImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    uploadError.value = '图片不能超过 2 MB'
    return
  }
  uploading.value = true
  uploadError.value = ''
  try {
    const { api } = await import('@/api/client')
    const media = await api.uploadMedia(file)
    emit('update', { media: [...props.question.media, { hash: media.hash, name: media.name, mime: media.mime, size: media.size }] })
  } catch (err) {
    uploadError.value = err instanceof Error ? err.message : '上传失败'
  } finally {
    uploading.value = false
  }
}

function removeMedia(hash: string): void {
  emit('update', { media: props.question.media.filter((item) => item.hash !== hash) })
}
</script>

<template>
  <div class="editor">
    <div class="row-between">
      <h3 class="title">单题编辑</h3>
      <div class="row">
        <button class="btn btn-sm" type="button" :disabled="!canMergeNext" title="与下一题合并" @click="emit('merge')">
          <SplitSquareHorizontal :size="14" /> 合并
        </button>
        <button class="btn btn-sm" type="button" title="拆分为两题" @click="emit('split')">
          <SplitSquareHorizontal :size="14" /> 拆分
        </button>
        <button class="btn btn-sm btn-danger" type="button" @click="emit('remove')"><Trash2 :size="14" /> 删除</button>
      </div>
    </div>

    <div class="grid2">
      <label class="field">
        <span class="field-label">题号</span>
        <input
          class="input num"
          type="number"
          :value="question.no ?? ''"
          @input="emit('update', { no: ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null })"
        />
      </label>
      <label class="field">
        <span class="field-label">题型</span>
        <select class="select" :value="question.type" @change="setType(($event.target as HTMLSelectElement).value as QuestionType)">
          <option v-for="type in QUESTION_TYPES" :key="type" :value="type">{{ QUESTION_TYPE_LABELS[type] }}</option>
        </select>
      </label>
    </div>

    <label class="field">
      <span class="field-label">题干</span>
      <textarea class="textarea" rows="5" :value="question.stem" @input="emit('update', { stem: ($event.target as HTMLTextAreaElement).value })" />
    </label>

    <div v-if="question.type === 'single' || question.type === 'multiple'" class="field">
      <span class="field-label">选项（点击左侧字母设为答案）</span>
      <div class="options">
        <div v-for="(option, i) in question.options" :key="i" class="option-row">
          <button
            class="opt-key mono"
            type="button"
            :class="{ active: question.answer.includes(option.key) }"
            :title="question.answer.includes(option.key) ? '取消正确答案' : '设为正确答案'"
            @click="toggleAnswer(option.key)"
          >
            {{ option.key }}
          </button>
          <input class="input" type="text" :value="option.text" @input="updateOption(i, { text: ($event.target as HTMLInputElement).value })" />
          <button class="icon-btn" type="button" aria-label="删除选项" @click="removeOption(i)"><Trash2 :size="14" /></button>
        </div>
        <button class="btn btn-sm" type="button" @click="addOption"><Plus :size="14" /> 添加选项</button>
      </div>
    </div>

    <div v-if="question.type === 'judge'" class="field">
      <span class="field-label">答案</span>
      <div class="row">
        <button class="btn btn-sm" :class="{ 'btn-primary': question.answer[0] === 'T' }" type="button" @click="emit('update', { answer: ['T'] })">正确 ✓</button>
        <button class="btn btn-sm" :class="{ 'btn-primary': question.answer[0] === 'F' }" type="button" @click="emit('update', { answer: ['F'] })">错误 ✕</button>
      </div>
    </div>

    <label v-else class="field">
      <span class="field-label">答案（多个用空格分隔）</span>
      <input v-model="answerText" class="input" type="text" />
    </label>

    <label class="field">
      <span class="field-label">解析</span>
      <textarea class="textarea" rows="4" :value="question.explanation" @input="emit('update', { explanation: ($event.target as HTMLTextAreaElement).value })" />
    </label>

    <div class="grid2">
      <label class="field">
        <span class="field-label">章节</span>
        <input class="input" type="text" :value="question.chapterName" @input="emit('update', { chapterName: ($event.target as HTMLInputElement).value })" />
      </label>
      <label class="field">
        <span class="field-label">难度 {{ question.difficulty }}</span>
        <input
          class="range"
          type="range"
          min="1"
          max="5"
          :value="question.difficulty"
          @input="emit('update', { difficulty: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>
    </div>

    <label class="field">
      <span class="field-label">标签（逗号分隔）</span>
      <input
        class="input"
        type="text"
        :value="question.tags.join(', ')"
        @input="emit('update', { tags: ($event.target as HTMLInputElement).value.split(/[,，]/).map((t) => t.trim()).filter(Boolean) })"
      />
    </label>

    <div class="field">
      <span class="field-label">配图</span>
      <div class="media-row">
        <div v-for="item in question.media" :key="item.hash" class="media-item">
          <img :src="`/media/${item.hash}.${item.mime === 'image/jpeg' ? 'jpg' : item.mime.split('/')[1]}`" :alt="item.name" />
          <button class="icon-btn" type="button" aria-label="移除图片" @click="removeMedia(item.hash)"><Trash2 :size="13" /></button>
        </div>
        <label class="btn btn-sm">
          <ImagePlus :size="14" /> {{ uploading ? '上传中…' : '添加图片' }}
          <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" @change="onPickImage" />
        </label>
      </div>
      <p v-if="uploadError" class="field-error">{{ uploadError }}</p>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.title {
  font-size: var(--fs-toolbar);
  color: var(--text-muted);
  text-transform: none;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.option-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.opt-key {
  flex: 0 0 auto;
  width: 26px;
  height: 30px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  cursor: pointer;
  font-size: 12px;
}
.opt-key.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-text);
  font-weight: 700;
}
.range {
  width: 100%;
}
.media-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.media-item {
  position: relative;
  display: inline-flex;
}
.media-item img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.media-item .icon-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 50%;
}
</style>
