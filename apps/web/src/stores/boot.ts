import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export const useBootStore = defineStore('boot', () => {
  const initialized = ref<boolean | null>(null)

  async function ensure(): Promise<boolean> {
    if (initialized.value === null) {
      try {
        const status = await api.setupStatus()
        initialized.value = status.initialized
      } catch {
        initialized.value = true
      }
    }
    return initialized.value
  }

  function markInitialized(value: boolean): void {
    initialized.value = value
  }

  return { initialized, ensure, markInitialized }
})
