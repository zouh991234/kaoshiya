import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type ThemeStyle = 'standard' | 'discreet'
export type ThemeMode = 'light' | 'dark' | 'system'

const STYLE_KEY = 'kaoshiya:style'
const MODE_KEY = 'kaoshiya:mode'

function readStyle(): ThemeStyle {
  const value = document.documentElement.dataset.style
  return value === 'discreet' ? 'discreet' : 'standard'
}

function readMode(): ThemeMode {
  try {
    const value = localStorage.getItem(MODE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    /* 不可用时按跟随系统 */
  }
  return 'system'
}

const media = window.matchMedia?.('(prefers-color-scheme: dark)')

export const useThemeStore = defineStore('theme', () => {
  const style = ref<ThemeStyle>(readStyle())
  const mode = ref<ThemeMode>(readMode())
  const systemDark = ref(media?.matches ?? false)

  const resolvedMode = computed<'light' | 'dark'>(() =>
    mode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : mode.value,
  )

  function apply(): void {
    const root = document.documentElement
    root.dataset.style = style.value
    root.dataset.mode = resolvedMode.value
    root.style.colorScheme = resolvedMode.value
  }

  function setStyle(next: ThemeStyle): void {
    style.value = next
    try {
      localStorage.setItem(STYLE_KEY, next)
    } catch {
      /* 不可写时仅本页生效 */
    }
    apply()
  }

  function setMode(next: ThemeMode): void {
    mode.value = next
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      /* 不可写时仅本页生效 */
    }
    apply()
  }

  function toggleMode(): void {
    setMode(resolvedMode.value === 'dark' ? 'light' : 'dark')
  }

  if (media) {
    const onChange = (event: MediaQueryListEvent): void => {
      systemDark.value = event.matches
      if (mode.value === 'system') apply()
    }
    media.addEventListener('change', onChange)
  }

  apply()

  return { style, mode, resolvedMode, setStyle, setMode, toggleMode }
})
