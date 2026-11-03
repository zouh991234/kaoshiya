<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{ page: number; pageSize: number; total: number }>()
const emit = defineEmits<{ 'update:page': [page: number] }>()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const to = computed(() => Math.min(props.total, props.page * props.pageSize))
</script>

<template>
  <div class="pager">
    <span class="pager-info num">{{ from }}–{{ to }} / {{ total }}</span>
    <div class="row">
      <button class="btn btn-sm" type="button" :disabled="page <= 1" @click="emit('update:page', page - 1)">
        <ChevronLeft :size="14" />
      </button>
      <span class="pager-page num">{{ page }} / {{ pageCount }}</span>
      <button class="btn btn-sm" type="button" :disabled="page >= pageCount" @click="emit('update:page', page + 1)">
        <ChevronRight :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 2px;
}
.pager-info,
.pager-page {
  font-size: var(--fs-small);
  color: var(--text-muted);
  font-family: var(--font-mono);
}
</style>
