<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { ROLE_OWNER } from '@kaoshiya/shared'
import type { Role } from '@kaoshiya/shared'
import ConfirmModal from '@/components/ConfirmModal.vue'
import EmptyState from '@/components/EmptyState.vue'
import Modal from '@/components/Modal.vue'
import { api, HttpError } from '@/api/client'
import { useToastStore } from '@/stores/toast'

interface PermGroupItem {
  key: string
  label: string
  perms: { key: string; label: string }[]
}

type ModalMode = 'create' | 'edit' | 'duplicate'

const toast = useToastStore()
const roles = ref<Role[]>([])
const groups = ref<PermGroupItem[]>([])
const totalPerms = ref(0)
const loading = ref(false)
const error = ref('')
const notice = ref('')

const modal = ref<ModalMode | null>(null)
const activeRole = ref<Role | null>(null)
const form = reactive({ name: '', description: '', perms: [] as string[] })
const submitting = ref(false)
const formError = ref('')
const deleteTarget = ref<Role | null>(null)
const deleting = ref(false)

const modalTitle = computed(() => {
  if (modal.value === 'create') return '新建角色'
  if (modal.value === 'edit') return `编辑角色 · ${activeRole.value?.name ?? ''}`
  if (modal.value === 'duplicate') return `复制角色 · ${activeRole.value?.name ?? ''}`
  return ''
})

function errorText(err: unknown): string {
  return err instanceof HttpError ? err.message : '操作失败，请稍后再试'
}

function isOwnerRole(role: Role): boolean {
  return role.name === ROLE_OWNER
}

function ownerReason(role: Role): string {
  return isOwnerRole(role) ? 'owner 角色的权限恒为全集，不可编辑或删除' : ''
}

function selectedIn(group: PermGroupItem): number {
  return group.perms.filter((perm) => form.perms.includes(perm.key)).length
}

function allSelected(group: PermGroupItem): boolean {
  return group.perms.length > 0 && group.perms.every((perm) => form.perms.includes(perm.key))
}

function toggleGroup(group: PermGroupItem): void {
  const keys = group.perms.map((perm) => perm.key)
  if (allSelected(group)) form.perms = form.perms.filter((key) => !keys.includes(key))
  else form.perms = [...new Set([...form.perms, ...keys])]
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [roleRes, permRes] = await Promise.all([api.roles(), api.permGroups()])
    roles.value = roleRes.items
    groups.value = permRes.groups
    totalPerms.value = permRes.total
  } catch (err) {
    error.value = errorText(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function openCreate(): void {
  activeRole.value = null
  form.name = ''
  form.description = ''
  form.perms = []
  formError.value = ''
  modal.value = 'create'
}

function openEdit(role: Role): void {
  if (isOwnerRole(role)) return
  activeRole.value = role
  form.name = role.name
  form.description = role.description
  form.perms = [...role.perms]
  formError.value = ''
  modal.value = 'edit'
}

function openDuplicate(role: Role): void {
  activeRole.value = role
  const base = role.name.slice(0, 19)
  form.name = `${base}-copy`
  formError.value = ''
  modal.value = 'duplicate'
}

function closeModal(): void {
  modal.value = null
  submitting.value = false
  formError.value = ''
}

async function submit(): Promise<void> {
  if (submitting.value) return
  formError.value = ''
  const name = form.name.trim()
  const target = activeRole.value
  if (!/^[\w\u4e00-\u9fa5-]{2,24}$/.test(name)) {
    formError.value = '角色名需为 2-24 位中文、字母、数字、下划线或短横线'
    return
  }
  if (!target && modal.value !== 'create') return

  if (modal.value === 'duplicate' && target) {
    submitting.value = true
    try {
      const role = await api.duplicateRole(target.id, name)
      toast.ok(`已复制出角色 ${role.name}`)
      closeModal()
      await load()
    } catch (err) {
      formError.value = errorText(err)
    } finally {
      submitting.value = false
    }
    return
  }

  if (form.perms.length === 0) {
    formError.value = '角色至少需要一个权限点'
    return
  }
  submitting.value = true
  try {
    const description = form.description.trim()
    if (modal.value === 'create') {
      const role = await api.createRole({ name, description, perms: form.perms })
      toast.ok(`已创建角色 ${role.name}`)
    } else if (modal.value === 'edit' && target) {
      await api.updateRole(target.id, {
        description,
        perms: form.perms,
        ...(target.builtin ? {} : { name }),
      })
      toast.ok('角色已更新')
    }
    closeModal()
    await load()
  } catch (err) {
    formError.value = errorText(err)
  } finally {
    submitting.value = false
  }
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  notice.value = ''
  try {
    await api.deleteRole(target.id)
    toast.ok(`已删除角色 ${target.name}`)
    deleteTarget.value = null
    await load()
  } catch (err) {
    notice.value = errorText(err)
    deleteTarget.value = null
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="stack">
    <div class="row-between">
      <div>
        <h2>角色管理</h2>
        <p class="faint small">权限点按模块分组，角色的权限决定成员能看到哪些页面与操作。</p>
      </div>
      <button class="btn btn-primary btn-sm" type="button" @click="openCreate"><Plus :size="14" /> 新建角色</button>
    </div>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div v-if="notice" class="alert" role="alert">
      <span class="grow">{{ notice }}</span>
      <button class="btn btn-sm btn-ghost" type="button" @click="notice = ''">知道了</button>
    </div>
    <p v-if="loading" class="muted small">正在加载角色…</p>

    <div v-if="roles.length > 0" class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>描述</th>
            <th>用户数</th>
            <th>类型</th>
            <th class="right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="role in roles" :key="role.id">
            <td>
              <span class="mono">{{ role.name }}</span>
              <span v-if="isOwnerRole(role)" class="badge badge-accent">owner</span>
            </td>
            <td class="muted">{{ role.description }}</td>
            <td class="num">{{ role.userCount ?? 0 }}</td>
            <td>
              <span class="badge">{{ role.builtin ? '内置' : '自定义' }}</span>
            </td>
            <td>
              <div class="acts">
                <button
                  class="icon-btn"
                  type="button"
                  :title="ownerReason(role) || '编辑角色权限'"
                  :aria-label="ownerReason(role) || '编辑角色权限'"
                  :disabled="isOwnerRole(role)"
                  @click="openEdit(role)"
                >
                  <Pencil :size="15" />
                </button>
                <button class="icon-btn" type="button" title="复制角色" aria-label="复制角色" @click="openDuplicate(role)">
                  <Copy :size="15" />
                </button>
                <button
                  class="icon-btn danger"
                  type="button"
                  :title="ownerReason(role) || '删除角色'"
                  :aria-label="ownerReason(role) || '删除角色'"
                  :disabled="isOwnerRole(role)"
                  @click="deleteTarget = role"
                >
                  <Trash2 :size="15" />
                </button>
                <span v-if="isOwnerRole(role)" class="faint small">权限恒为全集，不可编辑或删除</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <EmptyState v-if="!loading && roles.length === 0 && !error" title="还没有角色" description="新建一个角色并勾选权限点吧。" />

    <Modal :open="modal !== null" :title="modalTitle" :width="640" @close="closeModal">
      <div class="stack">
        <label v-if="modal !== 'duplicate'" class="field">
          <span class="field-label">角色名</span>
          <input v-model="form.name" class="input" type="text" maxlength="24" :disabled="modal === 'edit' && activeRole?.builtin" />
          <span v-if="modal === 'edit' && activeRole?.builtin" class="field-hint">内置角色不可改名，只能调整描述与权限</span>
        </label>
        <label v-else class="field">
          <span class="field-label">新角色名</span>
          <input v-model="form.name" class="input" type="text" maxlength="24" />
        </label>
        <label v-if="modal !== 'duplicate'" class="field">
          <span class="field-label">描述</span>
          <input v-model="form.description" class="input" type="text" maxlength="200" />
        </label>

        <div v-if="modal !== 'duplicate'" class="perms">
          <div class="row-between">
            <span class="field-label">权限点</span>
            <span class="faint small num">已选 {{ form.perms.length }} / 共 {{ totalPerms }} 项</span>
          </div>
          <div v-for="group in groups" :key="group.key" class="perm-group">
            <div class="row-between">
              <span class="group-name">{{ group.label }}</span>
              <span class="row">
                <span class="faint small num">已选 {{ selectedIn(group) }} / 共 {{ group.perms.length }} 项</span>
                <button class="btn btn-sm btn-ghost" type="button" @click="toggleGroup(group)">
                  {{ allSelected(group) ? '取消全选' : '全选本组' }}
                </button>
              </span>
            </div>
            <div class="perm-items">
              <label v-for="perm in group.perms" :key="perm.key" class="check">
                <input v-model="form.perms" type="checkbox" :value="perm.key" />
                <span>{{ perm.label }}</span>
              </label>
            </div>
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

    <ConfirmModal
      :open="deleteTarget !== null"
      title="删除角色"
      :message="deleteTarget ? `将删除角色「${deleteTarget.name}」。若仍有用户占用，服务端会拒绝并返回冲突原因。` : ''"
      confirm-text="删除"
      danger
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elev);
}
.table {
  min-width: 640px;
}
.table .right {
  text-align: right;
}
.acts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.icon-btn.danger:hover:not(:disabled) {
  color: var(--err);
  background: var(--err-bg);
}
.alert {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--err-border);
  border-radius: var(--radius-sm);
  background: var(--err-bg);
  color: var(--err);
  font-size: var(--fs-toolbar);
}
.perms {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 380px;
  overflow: auto;
  padding: 2px;
}
.perm-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}
.group-name {
  font-size: var(--fs-toolbar);
  font-weight: 600;
}
.perm-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-toolbar);
  cursor: pointer;
}
</style>
