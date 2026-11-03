import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ToastItem {
  id: number
  type: 'info' | 'ok' | 'error'
  message: string
}

let seq = 0

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([])

  function push(type: ToastItem['type'], message: string, duration = 3200): void {
    const id = ++seq
    items.value = [...items.value, { id, type, message }]
    window.setTimeout(() => {
      items.value = items.value.filter((item) => item.id !== id)
    }, duration)
  }

  return {
    items,
    info: (message: string) => push('info', message),
    ok: (message: string) => push('ok', message),
    error: (message: string) => push('error', message, 4200),
    dismiss: (id: number) => {
      items.value = items.value.filter((item) => item.id !== id)
    },
  }
})
