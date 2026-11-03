<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@/lib/markdown'

const props = defineProps<{ source: string }>()
const html = computed(() => renderMarkdown(props.source))
</script>

<template>
  <!-- 内容已由 DOMPurify 消毒，标签白名单受限 -->
  <div class="markdown" v-html="html" />
</template>

<style scoped>
.markdown :deep(p) {
  margin: 0 0 0.55em;
}
.markdown :deep(p:last-child) {
  margin-bottom: 0;
}
.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0 0 0.55em;
  padding-left: 1.35em;
}
.markdown :deep(code) {
  background: var(--code-bg);
  padding: 1px 4px;
  border-radius: 4px;
  font-variant-ligatures: contextual;
}
.markdown :deep(pre) {
  margin: 0.5em 0;
  font-variant-ligatures: contextual;
}
.markdown :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: var(--fs-toolbar);
}
.markdown :deep(th),
.markdown :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 8px;
}
.markdown :deep(img) {
  max-width: 100%;
  border-radius: var(--radius-sm);
}
</style>
