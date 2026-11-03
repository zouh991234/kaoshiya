<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { KeyRound, LogOut, UserRound } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import type { LoginRecordRow } from '@kaoshiya/shared'
import AppShell from '@/components/AppShell.vue'
import ThemeMenu from '@/components/ThemeMenu.vue'
import { api, HttpError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const auth = useAuthStore()
const toast = useToastStore()
const router = useRouter()

const displayName = ref(auth.me?.user.displayName ?? '')
const savingName = ref(false)
const password = reactive({ old: '', next: '', confirm: '' })
const savingPassword = ref(false)
const passwordError = ref('')
const logins = ref<LoginRecordRow[]>([])

async function saveName(): Promise<void> {
  if (!displayName.value.trim()) {
    toast.error('显示名称不能为空')
    return
  }
  savingName.value = true
  try {
    const me = await api.updateMe({ displayName: displayName.value.trim() })
    auth.refresh(me)
    toast.ok('资料已更新')
  } catch (err) {
    toast.error(err instanceof HttpError ? err.message : '保存失败')
  } finally {
    savingName.value = false
  }
}

async function savePassword(): Promise<void> {
  passwordError.value = ''
  if (password.next.length < 8) {
    passwordError.value = '新密码至少 8 位'
    return
  }
  if (password.next !== password.confirm) {
    passwordError.value = '两次输入的新密码不一致'
    return
  }
  savingPassword.value = true
  try {
    await api.changePassword({ oldPassword: password.old, newPassword: password.next })
    password.old = ''
    password.next = ''
    password.confirm = ''
    toast.ok('密码已修改，其他设备的登录已失效')
  } catch (err) {
    passwordError.value = err instanceof HttpError ? err.message : '修改失败'
  } finally {
    savingPassword.value = false
  }
}

async function logout(): Promise<void> {
  await auth.logout()
  await router.replace('/login')
}

function fmtTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

onMounted(async () => {
  try {
    const result = await api.loginRecords()
    logins.value = result.items
  } catch {
    logins.value = []
  }
})
</script>

<template>
  <AppShell>
    <h1 class="page-title">我的账号</h1>

    <div class="grid">
      <section class="card box">
        <h2 class="box-title"><UserRound :size="15" /> 资料</h2>
        <div class="row meta-line small muted">
          <span>用户名</span>
          <span class="mono">{{ auth.me?.user.username }}</span>
        </div>
        <div class="row meta-line small muted">
          <span>角色</span>
          <span>{{ auth.me?.roles.join(' · ') }}</span>
        </div>
        <label class="field">
          <span class="field-label">显示名称</span>
          <input v-model="displayName" class="input" type="text" maxlength="40" />
        </label>
        <div class="row">
          <button class="btn btn-primary" type="button" :disabled="savingName" @click="saveName">
            {{ savingName ? '保存中…' : '保存资料' }}
          </button>
        </div>
      </section>

      <section class="card box">
        <h2 class="box-title"><KeyRound :size="15" /> 修改密码</h2>
        <label class="field">
          <span class="field-label">当前密码</span>
          <input v-model="password.old" class="input" type="password" autocomplete="current-password" />
        </label>
        <label class="field">
          <span class="field-label">新密码</span>
          <input v-model="password.next" class="input" type="password" autocomplete="new-password" />
        </label>
        <label class="field">
          <span class="field-label">确认新密码</span>
          <input v-model="password.confirm" class="input" type="password" autocomplete="new-password" />
        </label>
        <p v-if="passwordError" class="field-error">{{ passwordError }}</p>
        <div class="row">
          <button class="btn btn-primary" type="button" :disabled="savingPassword" @click="savePassword">
            {{ savingPassword ? '提交中…' : '修改密码' }}
          </button>
        </div>
        <p class="small faint">密码至少 8 位，不能是纯数字或纯字母。修改后其他设备需重新登录。</p>
      </section>

      <section class="card box">
        <h2 class="box-title">最近登录</h2>
        <ul v-if="logins.length" class="logins small">
          <li v-for="(item, index) in logins" :key="index">
            <span class="num">{{ fmtTime(item.createdAt) }}</span>
            <span class="mono muted">{{ item.ip }}</span>
          </li>
        </ul>
        <p v-else class="small faint">暂无登录记录。</p>
      </section>

      <section class="card box">
        <h2 class="box-title">外观</h2>
        <p class="small muted">外观按当前浏览器记忆，不同设备互不影响。</p>
        <ThemeMenu />
      </section>

      <section class="card box">
        <h2 class="box-title">关于</h2>
        <p class="small muted">考试鸭 · 自建题库刷题与模拟考试。</p>
        <p class="small faint">
          等宽字体使用 Maple Mono（作者 subframe7536，SIL Open Font License 1.1），随本站同源提供，不依赖外部 CDN。
        </p>
        <div class="row">
          <button class="btn btn-sm" type="button" @click="logout"><LogOut :size="14" /> 退出登录</button>
        </div>
      </section>
    </div>
  </AppShell>
</template>

<style scoped>
.page-title {
  font-size: var(--fs-title);
  margin-bottom: 14px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
  align-items: start;
}
.box {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.box-title {
  font-size: var(--fs-toolbar);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.meta-line {
  justify-content: space-between;
}
.logins {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.logins li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
</style>
