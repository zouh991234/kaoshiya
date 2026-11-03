<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ShieldCheck } from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import ThemeMenu from '@/components/ThemeMenu.vue'
import { api, HttpError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useBootStore } from '@/stores/boot'

const router = useRouter()
const auth = useAuthStore()
const boot = useBootStore()

const username = ref('')
const displayName = ref('')
const password = ref('')
const confirm = ref('')
const loading = ref(false)
const error = ref('')

const valid = computed(() => username.value.trim().length >= 3 && password.value.length >= 8 && password.value === confirm.value)

async function submit(): Promise<void> {
  if (loading.value) return
  error.value = ''
  if (!valid.value) {
    error.value = password.value !== confirm.value ? '两次输入的密码不一致' : '请检查用户名与密码（密码至少 8 位）'
    return
  }
  loading.value = true
  try {
    const me = await api.setup({ username: username.value.trim(), displayName: displayName.value.trim() || undefined, password: password.value })
    auth.refresh(me)
    boot.markInitialized(true)
    await router.replace('/')
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '初始化失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="setup">
    <div class="login-top"><ThemeMenu /></div>
    <form class="card box" @submit.prevent="submit">
      <div class="head">
        <BrandMark :size="28" />
        <div>
          <h1>初始化站长账号</h1>
          <p class="small muted">这是系统的唯一 owner 账号，拥有全部权限，不可删除或降级。</p>
        </div>
      </div>
      <div class="field">
        <label class="field-label">用户名</label>
        <input v-model="username" class="input" autocomplete="username" placeholder="3-32 位字母、数字或下划线" />
      </div>
      <div class="field">
        <label class="field-label">显示名称</label>
        <input v-model="displayName" class="input" placeholder="留空则使用用户名" />
      </div>
      <div class="field">
        <label class="field-label">密码</label>
        <input v-model="password" class="input" type="password" autocomplete="new-password" placeholder="至少 8 位，不能是纯数字或纯字母" />
      </div>
      <div class="field">
        <label class="field-label">确认密码</label>
        <input v-model="confirm" class="input" type="password" autocomplete="new-password" />
      </div>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary btn-block" type="submit" :disabled="loading || !valid">
        <ShieldCheck :size="15" /> {{ loading ? '创建中…' : '创建并进入' }}
      </button>
      <p class="faint small">初始化只能执行一次，完成后 /setup 将永久关闭。</p>
    </form>
  </div>
</template>

<style scoped>
.setup {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--bg);
}
.login-top {
  position: fixed;
  top: 14px;
  right: 16px;
}
.box {
  width: min(100%, 420px);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
h1 {
  font-size: 18px;
  margin-bottom: 4px;
}
</style>
