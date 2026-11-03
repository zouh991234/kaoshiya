<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { Component } from 'vue'
import { Ban, CheckCircle2, Copy, KeyRound, Pencil, Plus, Search, Trash2, UserCog } from 'lucide-vue-next'
import { PERMS } from '@kaoshiya/shared'
import type { Role, UserStatus, UserSummary } from '@kaoshiya/shared'
import ConfirmModal from '@/components/ConfirmModal.vue'
import EmptyState from '@/components/EmptyState.vue'
import Modal from '@/components/Modal.vue'
import Pager from '@/components/Pager.vue'
import { api, HttpError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useCan } from '@/composables/useCan'
import { useToastStore } from '@/stores/toast'

type ModalMode = 'create' | 'edit' | 'roles' | 'password'
interface RowAction {
  key: string
  label: string
  icon: Component
  disabled?: boolean
  danger?: boolean
  run: () => void
}

const PAGE_SIZE = 20
const auth = useAuthStore()
const toast = useToastStore()
const { can } = useCan()

const users = ref<UserSummary[]>([])
const total = ref(0)
const page = ref(1)
const keyword = ref('')
const roleFilter = ref('')
const statusFilter = ref<'' | UserStatus>('')
const loading = ref(false)
const error = ref('')

const roles = ref<Role[]>([])
const rolesError = ref('')

const modal = ref<ModalMode | null>(null)
const activeUser = ref<UserSummary | null>(null)
const form = reactive({ username: '', displayName: '', roleIds: [] as string[] })
const submitting = ref(false)
const formError = ref('')
const passwordInfo = ref<{ title: string; username: string; value: string } | null>(null)
const busyId = ref('')
const deleteTarget = ref<UserSummary | null>(null)
const deleting = ref(false)

const selfId = computed(() => auth.me?.user.id ?? '')
const modalTitle = computed(() => {
  if (modal.value === 'create') return '新建用户'
  if (modal.value === 'edit') return `编辑显示名 · ${activeUser.value?.username ?? ''}`
  if (modal.value === 'roles') return `分配角色 · ${activeUser.value?.username ?? ''}`
  return ''
})

function errorText(err: unknown): string {
  return err instanceof HttpError ? err.message : '操作失败，请稍后再试'
}

function formatTime(value: string | null): string {
  if (!value) return '从未登录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await api.users({
      keyword: keyword.value.trim() || undefined,
      roleId: roleFilter.value || undefined,
      status: statusFilter.value || undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    })
    users.value = res.items
    total.value = res.total
  } catch (err) {
    error.value = errorText(err)
  } finally {
    loading.value = false
  }
}

async function loadRoles(): Promise<void> {
  if (!can(PERMS.ROLE_READ)) {
    rolesError.value = '当前账号缺少「查看角色」权限，无法列出可分配角色'
    return
  }
  try {
    roles.value = (await api.roles()).items
    rolesError.value = ''
  } catch (err) {
    rolesError.value = errorText(err)
  }
}

function search(): void {
  if (page.value !== 1) page.value = 1
  else void load()
}

function resetFilters(): void {
  keyword.value = ''
  roleFilter.value = ''
  statusFilter.value = ''
  search()
}

watch(page, () => void load())
onMounted(() => {
  void loadRoles()
  void load()
})

function openCreate(): void {
  activeUser.value = null
  form.username = ''
  form.displayName = ''
  form.roleIds = []
  formError.value = ''
  modal.value = 'create'
}

function openEdit(user: UserSummary): void {
  activeUser.value = user
  form.displayName = user.displayName
  formError.value = ''
  modal.value = 'edit'
}

function openRoles(user: UserSummary): void {
  activeUser.value = user
  form.roleIds = user.roles.map((role) => role.id)
  formError.value = ''
  modal.value = 'roles'
}

function closeModal(): void {
  modal.value = null
  submitting.value = false
  formError.value = ''
}

async function submit(): Promise<void> {
  if (submitting.value) return
  formError.value = ''
  const mode = modal.value
  const target = activeUser.value
  if (mode === 'create') {
    const username = form.username.trim()
    if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
      formError.value = '用户名需为 3-32 位字母、数字或下划线'
      return
    }
    if (form.roleIds.length === 0) {
      formError.value = '请至少选择一个角色'
      return
    }
    submitting.value = true
    try {
      const res = await api.createUser({
        username,
        displayName: form.displayName.trim() || undefined,
        roleIds: form.roleIds,
      })
      closeModal()
      passwordInfo.value = { title: '初始密码', username: res.user.username, value: res.initialPassword }
      modal.value = 'password'
      toast.ok(`已创建用户 ${res.user.username}`)
      await load()
    } catch (err) {
      formError.value = errorText(err)
    } finally {
      submitting.value = false
    }
    return
  }
  if (!target) return
  if (mode === 'edit') {
    const displayName = form.displayName.trim()
    if (!displayName) {
      formError.value = '显示名不能为空'
      return
    }
    submitting.value = true
    try {
      await api.updateUser(target.id, { displayName })
      toast.ok('显示名已更新')
      closeModal()
      await load()
    } catch (err) {
      formError.value = errorText(err)
    } finally {
      submitting.value = false
    }
    return
  }
  if (mode === 'roles') {
    if (form.roleIds.length === 0) {
      formError.value = '请至少选择一个角色'
      return
    }
    submitting.value = true
    try {
      await api.setUserRoles(target.id, form.roleIds)
      toast.ok(`已更新 ${target.username} 的角色`)
      closeModal()
      await load()
    } catch (err) {
      formError.value = errorText(err)
    } finally {
      submitting.value = false
    }
  }
}

async function toggleStatus(user: UserSummary): Promise<void> {
  if (busyId.value || user.id === selfId.value) return
  busyId.value = user.id
  const next: UserStatus = user.status === 'active' ? 'disabled' : 'active'
  try {
    const updated = await api.updateUser(user.id, { status: next })
    users.value = users.value.map((item) => (item.id === updated.id ? updated : item))
    toast.ok(next === 'disabled' ? `已禁用 ${user.username}` : `已启用 ${user.username}`)
  } catch (err) {
    toast.error(errorText(err))
  } finally {
    busyId.value = ''
  }
}

async function resetPassword(user: UserSummary): Promise<void> {
  if (busyId.value) return
  busyId.value = user.id
  try {
    const res = await api.resetUserPassword(user.id)
    passwordInfo.value = { title: '新一次性密码', username: user.username, value: res.initialPassword }
    modal.value = 'password'
  } catch (err) {
    toast.error(errorText(err))
  } finally {
    busyId.value = ''
  }
}

async function copyPassword(): Promise<void> {
  if (!passwordInfo.value) return
  try {
    await navigator.clipboard.writeText(passwordInfo.value.value)
    toast.ok('密码已复制到剪贴板')
  } catch {
    toast.error('复制失败，请手动选中密码后复制')
  }
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  try {
    await api.deleteUser(target.id)
    toast.ok(`已删除用户 ${target.username}`)
    deleteTarget.value = null
    if (users.value.length === 1 && page.value > 1) page.value -= 1
    else await load()
  } catch (err) {
    toast.error(errorText(err))
  } finally {
    deleting.value = false
  }
}

function actionsFor(user: UserSummary): RowAction[] {
  const self = user.id === selfId.value
  const busy = busyId.value === user.id
  const list: RowAction[] = []
  if (can(PERMS.USER_UPDATE)) {
    list.push({ key: 'edit', label: '编辑显示名', icon: Pencil, run: () => openEdit(user) })
    list.push({ key: 'roles', label: '分配角色', icon: UserCog, run: () => openRoles(user) })
    list.push({
      key: 'status',
      label: user.status === 'active' ? '禁用账号' : '启用账号',
      icon: user.status === 'active' ? Ban : CheckCircle2,
      disabled: self || busy,
      run: () => void toggleStatus(user),
    })
  }
  if (can(PERMS.USER_RESETPWD)) {
    list.push({ key: 'pwd', label: '重置密码', icon: KeyRound, disabled: busy, run: () => void resetPassword(user) })
  }
  if (can(PERMS.USER_DELETE)) {
    list.push({
      key: 'delete',
      label: '删除用户',
      icon: Trash2,
      disabled: self || busy,
      danger: true,
      run: () => {
        deleteTarget.value = user
      },
    })
  }
  return list
}

function actionTitle(action: RowAction, user: UserSummary): string {
  return action.disabled && user.id === selfId.value ? '不能对自己的账号执行此操作' : action.label
}
</script>

<template>
  <div class="stack">
    <div class="row-between">
      <div>
        <h2>用户管理</h2>
        <p class="faint small">创建账号、分配角色、重置密码。新账号的初始密码只显示一次。</p>
      </div>
      <button v-if="can(PERMS.USER_CREATE)" class="btn btn-primary btn-sm" type="button" @click="openCreate">
        <Plus :size="14" /> 新建用户
      </button>
    </div>

    <form class="filters" @submit.prevent="search">
      <input v-model="keyword" class="input grow" type="search" placeholder="搜索用户名或显示名" maxlength="64" />
      <select v-model="roleFilter" class="select filter-select" aria-label="按角色筛选">
        <option value="">全部角色</option>
        <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
      </select>
      <select v-model="statusFilter" class="select filter-select" aria-label="按状态筛选">
        <option value="">全部状态</option>
        <option value="active">启用</option>
        <option value="disabled">禁用</option>
      </select>
      <button class="btn btn-sm" type="submit"><Search :size="14" /> 搜索</button>
      <button class="btn btn-sm btn-ghost" type="button" @click="resetFilters">重置</button>
    </form>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted small">正在加载用户…</p>

    <div v-if="users.length > 0" class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>显示名</th>
            <th>角色</th>
            <th>状态</th>
            <th>最近登录</th>
            <th class="right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>
              <span class="mono">{{ user.username }}</span>
              <span v-if="user.mustChangePwd" class="badge badge-warn">待改密</span>
            </td>
            <td>{{ user.displayName }}</td>
            <td>
              <div class="badges">
                <span v-for="role in user.roles" :key="role.id" class="badge">{{ role.name }}</span>
                <span v-if="user.roles.length === 0" class="faint">—</span>
              </div>
            </td>
            <td>
              <span class="badge" :class="user.status === 'active' ? 'badge-ok' : 'badge-err'">
                {{ user.status === 'active' ? '启用' : '禁用' }}
              </span>
            </td>
            <td class="small muted">{{ formatTime(user.lastLoginAt) }}</td>
            <td>
              <div class="acts">
                <button
                  v-for="action in actionsFor(user)"
                  :key="action.key"
                  class="icon-btn"
                  :class="{ danger: action.danger }"
                  type="button"
                  :title="actionTitle(action, user)"
                  :aria-label="actionTitle(action, user)"
                  :disabled="action.disabled"
                  @click="action.run"
                >
                  <component :is="action.icon" :size="15" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <EmptyState
      v-if="!loading && users.length === 0 && !error"
      title="没有匹配的用户"
      description="换个关键字或筛选条件试试，也可以直接新建用户。"
    />

    <Pager :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="page = $event" />

    <Modal :open="modal !== null && modal !== 'password'" :title="modalTitle" :width="500" @close="closeModal">
      <div class="stack">
        <label v-if="modal === 'create'" class="field">
          <span class="field-label">用户名</span>
          <input v-model="form.username" class="input" type="text" maxlength="32" placeholder="3-32 位字母、数字或下划线" />
        </label>
        <label v-if="modal === 'create' || modal === 'edit'" class="field">
          <span class="field-label">显示名</span>
          <input v-model="form.displayName" class="input" type="text" maxlength="40" placeholder="留空则与用户名相同" />
        </label>
        <div v-if="modal === 'create' || modal === 'roles'" class="field">
          <span class="field-label">角色（可多选）</span>
          <p v-if="rolesError" class="field-error">{{ rolesError }}</p>
          <div class="role-pick">
            <label v-for="role in roles" :key="role.id" class="check">
              <input v-model="form.roleIds" type="checkbox" :value="role.id" />
              <span>{{ role.name }}</span>
              <span class="faint small truncate">{{ role.description }}</span>
            </label>
            <span v-if="roles.length === 0 && !rolesError" class="faint small">暂无可分配角色</span>
          </div>
        </div>
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="closeModal">取消</button>
        <button class="btn btn-primary" type="button" :disabled="submitting" @click="submit">
          {{ submitting ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>

    <Modal :open="modal === 'password'" title="一次性密码" :width="460" @close="closeModal">
      <div v-if="passwordInfo" class="stack">
        <div class="onetime">
          <p class="small muted">
            用户 <strong>{{ passwordInfo.username }}</strong> 的{{ passwordInfo.title }}，仅显示这一次，请立即复制并交给本人。
          </p>
          <code class="onetime-value mono">{{ passwordInfo.value }}</code>
          <button class="btn btn-sm" type="button" @click="copyPassword"><Copy :size="14" /> 复制密码</button>
        </div>
        <p class="field-hint">首次登录后系统会要求该用户立即修改密码。</p>
      </div>
      <template #footer>
        <button class="btn btn-primary" type="button" @click="closeModal">我已保存</button>
      </template>
    </Modal>

    <ConfirmModal
      :open="deleteTarget !== null"
      title="删除用户"
      :message="deleteTarget ? `将永久删除用户「${deleteTarget.username}（${deleteTarget.displayName}）」及其角色关联，此操作不可撤销。` : ''"
      confirm-text="删除"
      danger
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.filter-select {
  width: auto;
  min-width: 128px;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
}
.table {
  min-width: 720px;
}
.table .right {
  text-align: right;
}
.badges,
.acts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.acts {
  justify-content: flex-end;
  gap: 2px;
  flex-wrap: nowrap;
}
.icon-btn.danger:hover:not(:disabled) {
  color: var(--err);
  background: var(--err-bg);
}
.role-pick {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 240px;
  overflow: auto;
  padding: 2px;
}
.check {
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-size: var(--fs-toolbar);
  cursor: pointer;
}
.onetime {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--primary-soft);
}
.onetime-value {
  display: block;
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  color: var(--text);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-align: center;
  word-break: break-all;
}
.onetime .btn {
  align-self: flex-start;
}
</style>
