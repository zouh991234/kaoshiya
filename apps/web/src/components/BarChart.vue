<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    items: { label: string; value: number; hint?: string }[]
    height?: number
    max?: number
    unit?: string
    color?: string
  }>(),
  { height: 132, max: 0, unit: '', color: 'var(--chart-1)' },
)

const maxValue = computed(() => {
  if (props.max > 0) return props.max
  const top = Math.max(...props.items.map((item) => item.value), 1)
  return top
})

const bars = computed(() =>
  props.items.map((item) => ({
    ...item,
    ratio: Math.max(0, Math.min(1, item.value / maxValue.value)),
  })),
)
</script>

<template>
  <div class="chart">
    <div class="chart-plot" :style="{ height: `${height}px` }">
      <div v-for="bar in bars" :key="bar.label" class="bar-col" :title="bar.hint ?? `${bar.label} ${bar.value}${unit}`">
        <span class="bar-value num">{{ bar.value }}</span>
        <span class="bar-track">
          <span class="bar-fill" :style="{ height: `${Math.max(bar.ratio * 100, bar.value > 0 ? 4 : 0)}%`, background: color }" />
        </span>
      </div>
    </div>
    <div class="chart-axis">
      <span v-for="bar in bars" :key="`${bar.label}-axis`" class="axis-label">{{ bar.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  width: 100%;
}
.chart-plot {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 2px;
}
.bar-col {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}
.bar-value {
  font-size: 10.5px;
  color: var(--text-faint);
  font-family: var(--font-mono);
}
.bar-track {
  width: 100%;
  max-width: 34px;
  flex: 1;
  display: flex;
  align-items: flex-end;
  background: var(--bg-subtle);
  border-radius: 3px;
  overflow: hidden;
}
.bar-fill {
  width: 100%;
  border-radius: 3px 3px 0 0;
  transition: height var(--dur-base) var(--ease);
}
.chart-axis {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.axis-label {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  font-size: 10.5px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
