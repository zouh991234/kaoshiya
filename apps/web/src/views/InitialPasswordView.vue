<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { KeyRound } from 'lucide-vue-next'
import BrandMark from '@/components/BrandMark.vue'
import { api, HttpError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const password = ref('')
const confirm = ref('')
const loading = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  error.value = ''
  if (password.value.length < 8) {
    error.value = '密码至少 8 位'
    return
  }
  if (password.value !== confirm.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  loading.value = true
  try {
    const me = await api.finishInitialPassword({ newPassword: password.value })
    auth.refresh(me)
    await router.replace('/')
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '修改失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <form class="card box" @submit.prevent="submit">
      <div class="head">
        <BrandMark :size="26" />
        <div>
          <h1>请先修改初始密码</h1>
          <p class="small muted">首次登录必须设置自己的密码后才能继续使用。</p>
        </div>
      </div>
      <div class="field">
        <label class="field-label">新密码</label>
        <input v-model="password" class="input" type="password" autocomplete="new-password" />
      </div>
      <div class="field">
        <label class="field-label">确认新密码</label>
        <input v-model="confirm" class="input" type="password" autocomplete="new-password" />
      </div>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary btn-block" type="submit" :disabled="loading">
        <KeyRound :size="15" /> {{ loading ? '保存中…' : '保存并继续' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--bg);
}
.box {
  width: min(100%, 400px);
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
  font-size: 17px;
  margin-bottom: 4px;
}
</style>
