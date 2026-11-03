import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { MeResponse } from '@kaoshiya/shared'
import { api, HttpError } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  const me = ref<MeResponse | null>(null)
  const loading = ref(false)
  const loaded = ref(false)

  const isAuthenticated = computed(() => me.value !== null)
  const perms = computed(() => me.value?.perms ?? [])
  const isOwner = computed(() => me.value?.isOwner ?? false)
  const mustChangePassword = computed(() => me.value?.user.mustChangePwd ?? false)

  function can(perm: string): boolean {
    return perms.value.includes(perm)
  }
  function canAny(list: readonly string[]): boolean {
    return list.some((perm) => can(perm))
  }

  async function load(): Promise<MeResponse | null> {
    loading.value = true
    try {
      me.value = await api.me()
    } catch (err) {
      // 401 表示未登录；限流（429）或网络抖动时也保持「未登录态」继续渲染，
      // 避免首屏变成空白页，用户刷新即可重试。
      if (err instanceof HttpError && err.status !== 401) {
        console.warn('加载当前账号失败：', err.message)
      }
      me.value = null
    } finally {
      loading.value = false
      loaded.value = true
    }
    return me.value
  }

  async function login(username: string, password: string, remember: boolean): Promise<MeResponse> {
    me.value = await api.login({ username, password, remember })
    loaded.value = true
    return me.value
  }

  async function logout(): Promise<void> {
    try {
      await api.logout()
    } finally {
      me.value = null
    }
  }

  function refresh(next: MeResponse): void {
    me.value = next
  }

  return { me, loading, loaded, isAuthenticated, perms, isOwner, mustChangePassword, can, canAny, load, login, logout, refresh }
})
