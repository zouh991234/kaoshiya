<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Palette, Check } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'
import type { ThemeMode, ThemeStyle } from '@/stores/theme'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const theme = useThemeStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

const styles: { value: ThemeStyle; label: string; hint: string }[] = [
  { value: 'standard', label: '常规', hint: '暖白 + 黄色点缀' },
  { value: 'discreet', label: '低调', hint: '黑白灰' },
]
const modes: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

function onClickOutside(event: MouseEvent): void {
  if (!root.value) return
  if (!root.value.contains(event.target as Node)) open.value = false
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="theme-menu">
    <button type="button" class="btn btn-ghost btn-sm" :aria-expanded="open" aria-haspopup="dialog" @click="open = !open">
      <Palette :size="15" />
      <span v-if="!compact">外观</span>
    </button>
    <div v-if="open" class="popover" role="dialog" aria-label="外观设置">
      <div class="group-label">风格</div>
      <button
        v-for="item in styles"
        :key="item.value"
        type="button"
        class="option"
        :aria-pressed="theme.style === item.value"
        @click="theme.setStyle(item.value)"
      >
        <span class="grow">
          <span class="option-title">{{ item.label }}</span>
          <span class="option-hint">{{ item.hint }}</span>
        </span>
        <Check v-if="theme.style === item.value" :size="15" />
      </button>
      <hr class="divider" />
      <div class="group-label">明暗</div>
      <button
        v-for="item in modes"
        :key="item.value"
        type="button"
        class="option"
        :aria-pressed="theme.mode === item.value"
        @click="theme.setMode(item.value)"
      >
        <span class="grow option-title">{{ item.label }}</span>
        <Check v-if="theme.mode === item.value" :size="15" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.theme-menu {
  position: relative;
}
.popover {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 208px;
  padding: 6px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  z-index: 1200;
}
.group-label {
  padding: 6px 8px 2px;
  font-size: 11px;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}
.option {
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
  color: var(--text);
}
.option:hover {
  background: var(--bg-hover);
}
.option[aria-pressed='true'] {
  background: var(--primary-soft);
}
.option-title {
  display: block;
  font-size: var(--fs-toolbar);
}
.option-hint {
  display: block;
  font-size: 11px;
  color: var(--text-faint);
}
.divider {
  margin: 6px 4px;
}
</style>
