<script setup lang="ts">
withDefaults(
  defineProps<{
    items: { label: string; value: number; hint?: string }[]
    max?: number
    unit?: string
    color?: string
  }>(),
  { max: 100, unit: '%', color: 'var(--chart-1)' },
)
</script>

<template>
  <ul class="rows">
    <li v-for="item in items" :key="item.label" class="row-item">
      <span class="row-label truncate" :title="item.label">{{ item.label }}</span>
      <span class="row-track">
        <span
          class="row-fill"
          :style="{ width: `${Math.max(0, Math.min(100, (item.value / (max || 100)) * 100))}%`, background: color }"
        />
      </span>
      <span class="row-value num">{{ item.hint ?? `${item.value}${unit}` }}</span>
    </li>
  </ul>
</template>

<style scoped>
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.row-item {
  display: grid;
  grid-template-columns: minmax(64px, 30%) 1fr 48px;
  align-items: center;
  gap: 10px;
}
.row-label {
  font-size: var(--fs-toolbar);
  color: var(--text-muted);
}
.row-track {
  height: 7px;
  background: var(--bg-subtle);
  border-radius: 999px;
  overflow: hidden;
}
.row-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
}
.row-value {
  text-align: right;
  font-size: var(--fs-small);
  color: var(--text-muted);
}
</style>
