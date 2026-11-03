<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogIn } from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import ThemeMenu from '@/components/ThemeMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { HttpError } from '@/api/client'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const remember = ref(true)
const loading = ref(false)
const error = ref('')

const siteName = computed(() => auth.me?.settings.siteName ?? '考试鸭')
const redirect = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') ? value : '/'
})

async function submit(): Promise<void> {
  if (loading.value) return
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  try {
    const me = await auth.login(username.value.trim(), password.value, remember.value)
    if (me.user.mustChangePwd) await router.replace('/me/initial-password')
    else await router.replace(redirect.value)
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '登录失败，请稍后再试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="login-top">
      <ThemeMenu />
    </div>
    <form class="login-card card" @submit.prevent="submit">
      <div class="brand">
        <BrandMark :size="30" />
        <div class="brand-text">
          <strong>{{ siteName }}</strong>
          <span class="small faint">自建题库 · 刷题与模拟考试</span>
        </div>
      </div>

      <label class="field">
        <span class="field-label">用户名</span>
        <input v-model="username" class="input" type="text" autocomplete="username" autofocus />
      </label>
      <label class="field">
        <span class="field-label">密码</span>
        <input v-model="password" class="input" type="password" autocomplete="current-password" />
      </label>

      <label class="remember">
        <input v-model="remember" type="checkbox" />
        <span>记住我</span>
      </label>

      <p v-if="error" class="field-error" role="alert">{{ error }}</p>

      <button class="btn btn-primary btn-block" type="submit" :disabled="loading">
        <LogIn :size="15" />
        {{ loading ? '登录中…' : '登录' }}
      </button>
      <p class="hint faint small">账号由管理员创建，不开放自助注册。</p>
    </form>
    <footer class="foot small faint">个人学习资料</footer>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px 40px;
  background: var(--bg);
}
.login-top {
  position: fixed;
  top: 14px;
  right: 16px;
}
.login-card {
  width: min(100%, 380px);
  padding: 26px 24px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}
.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.brand-text strong {
  font-size: 18px;
  letter-spacing: -0.01em;
}
.remember {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-toolbar);
  color: var(--text-muted);
  cursor: pointer;
}
.hint {
  text-align: center;
  margin: 2px 0 0;
}
.foot {
  margin-top: 22px;
}
</style>
