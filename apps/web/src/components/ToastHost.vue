<script setup lang="ts">
import { useToastStore } from '@/stores/toast'
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-vue-next'

const toast = useToastStore()
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="item in toast.items" :key="item.id" class="toast" :class="`toast-${item.type}`">
        <CheckCircle2 v-if="item.type === 'ok'" :size="16" />
        <AlertTriangle v-else-if="item.type === 'error'" :size="16" />
        <Info v-else :size="16" />
        <span class="toast-text">{{ item.message }}</span>
        <button class="toast-close" type="button" aria-label="关闭" @click="toast.dismiss(item.id)">
          <X :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 2000;
  pointer-events: none;
  max-width: min(92vw, 520px);
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--bg-elev);
  box-shadow: var(--shadow-md);
  font-size: var(--fs-toolbar);
  pointer-events: auto;
}
.toast-ok {
  border-color: var(--ok-border);
  color: var(--text);
}
.toast-error {
  border-color: var(--err-border);
  color: var(--text);
}
.toast-text {
  flex: 1;
}
.toast-close {
  border: 0;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  display: inline-flex;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--dur-base) var(--ease), transform var(--dur-base) var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
@media (max-width: 767px) {
  .toast-host {
    bottom: 76px;
  }
}
</style>
