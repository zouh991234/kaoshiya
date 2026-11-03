<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{ open: boolean; title?: string; width?: number; closable?: boolean }>(),
  { title: '', width: 520, closable: true },
)
const emit = defineEmits<{ close: [] }>()
const dialogRef = ref<HTMLElement | null>(null)

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open && props.closable) emit('close')
}

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) requestAnimationFrame(() => dialogRef.value?.focus())
  },
)

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mask" @click.self="closable && emit('close')">
      <div ref="dialogRef" class="dialog" role="dialog" aria-modal="true" tabindex="-1" :style="{ width: `${width}px` }">
        <header v-if="title || closable" class="dialog-head">
          <h3 class="grow truncate">{{ title }}</h3>
          <button v-if="closable" class="icon-btn" type="button" aria-label="关闭" @click="emit('close')">
            <X :size="16" />
          </button>
        </header>
        <div class="dialog-body"><slot /></div>
        <footer v-if="$slots.footer" class="dialog-foot"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 38%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1500;
  animation: fade var(--dur-fast) var(--ease);
}
.dialog {
  max-width: 100%;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  outline: none;
}
[data-style='discreet'] .dialog {
  box-shadow: 0 2px 12px rgb(0 0 0 / 12%);
}
.dialog-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.dialog-head h3 {
  font-size: var(--fs-body);
  font-weight: 600;
}
.dialog-body {
  padding: 16px;
  overflow: auto;
}
.dialog-foot {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
</style>
