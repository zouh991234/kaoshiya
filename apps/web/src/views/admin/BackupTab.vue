<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DatabaseBackup, RefreshCw, Trash2 } from 'lucide-vue-next'
import ConfirmModal from '@/components/ConfirmModal.vue'
import EmptyState from '@/components/EmptyState.vue'
import { api, HttpError } from '@/api/client'
import { useToastStore } from '@/stores/toast'
import { useCan } from '@/composables/useCan'

interface BackupItem {
  id: string
  createdAt: string
  counts: Record<string, number>
  mediaFiles: number
  databaseBytes: number
}

const toast = useToastStore()
const { can } = useCan()

const items = ref<BackupItem[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const confirmTarget = ref<BackupItem | null>(null)
const confirmOpen = ref(false)
const restoreTarget = ref<BackupItem | null>(null)
const restoreOpen = ref(false)
const canBackup = computed(() => can('data:backup'))

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function fmtTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await api.backups()
    items.value = result.items as BackupItem[]
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '读取备份列表失败'
  } finally {
    loading.value = false
  }
}

async function createBackup(): Promise<void> {
  busy.value = true
  try {
    await api.backup()
    toast.ok('备份已生成')
    await load()
  } catch (err) {
    toast.error(err instanceof HttpError ? err.message : '备份失败')
  } finally {
    busy.value = false
  }
}

function askDelete(item: BackupItem): void {
  confirmTarget.value = item
  confirmOpen.value = true
}

async function doDelete(): Promise<void> {
  const target = confirmTarget.value
  confirmOpen.value = false
  if (!target) return
  try {
    await api.deleteBackup(target.id)
    toast.ok('备份已删除')
    await load()
  } catch (err) {
    toast.error(err instanceof HttpError ? err.message : '删除失败')
  }
}

function askRestore(item: BackupItem): void {
  restoreTarget.value = item
  restoreOpen.value = true
}

async function doRestore(): Promise<void> {
  const target = restoreTarget.value
  if (!target) return
  restoreOpen.value = false
  try {
    await api.restoreBackup(target.id, target.id)
    toast.ok('已开始恢复，服务将自动重启，请稍后刷新页面')
  } catch (err) {
    toast.error(err instanceof HttpError ? err.message : '恢复失败')
  }
}

onMounted(load)
</script>

<template>
  <section class="wrap">
    <div class="head">
      <div>
        <h2 class="title">数据备份</h2>
        <p class="small muted">使用 SQLite 在线备份生成一致性快照，并归档媒体文件；自动保留最近 7 份，位于服务器的 data/backups 目录。</p>
      </div>
      <button v-if="canBackup" class="btn btn-primary" type="button" :disabled="busy" @click="createBackup">
        <DatabaseBackup :size="15" /> {{ busy ? '备份中…' : '立即备份' }}
      </button>
    </div>

    <p v-if="error" class="field-error">{{ error }}</p>

    <div class="row">
      <button class="btn btn-sm" type="button" @click="load"><RefreshCw :size="14" /> 刷新列表</button>
      <span class="small faint">共 {{ items.length }} 份</span>
    </div>

    <div v-if="loading" class="muted small">加载中…</div>

    <EmptyState v-else-if="items.length === 0" title="还没有备份" description="建议在批量导入、升级或清理数据前先备份一次。" />

    <div v-else class="card table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>备份 ID</th>
            <th>生成时间</th>
            <th class="num">数据库</th>
            <th class="num">媒体</th>
            <th class="num">用户 / 题库 / 题目</th>
            <th class="act">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td class="mono small">{{ item.id }}</td>
            <td class="small num">{{ fmtTime(item.createdAt) }}</td>
            <td class="num small">{{ fmtBytes(item.databaseBytes) }}</td>
            <td class="num small">{{ item.mediaFiles }} 个</td>
            <td class="num small">
              {{ item.counts.users ?? 0 }} / {{ item.counts.banks ?? 0 }} / {{ item.counts.questions ?? 0 }}
            </td>
            <td class="act">
              <button v-if="canBackup" class="btn btn-sm" type="button" @click="askRestore(item)">恢复</button>
              <button v-if="canBackup" class="btn btn-sm btn-danger" type="button" @click="askDelete(item)">
                <Trash2 :size="13" /> 删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card tip">
      <h3 class="small">恢复须知</h3>
      <ul class="small muted">
        <li>恢复会先用当前数据生成一份 pre-restore 快照，再把服务重启到备份状态。</li>
        <li>恢复前请停止刷题与导入操作，避免刚写入的数据被覆盖。</li>
        <li>恢复后请核对：账号、题库、配图、进度、收藏、笔记、考试记录。</li>
      </ul>
    </div>

    <ConfirmModal
      :open="confirmOpen"
      title="删除备份"
      :message="`确定删除备份 ${confirmTarget?.id ?? ''}？此操作不可撤销。`"
      confirm-text="删除"
      danger
      @close="confirmOpen = false"
      @confirm="doDelete"
    />

    <ConfirmModal
      :open="restoreOpen"
      title="从备份恢复"
      :message="`将把系统恢复到备份 ${restoreTarget?.id ?? ''} 的状态，当前数据会先另存为 pre-restore 快照，恢复完成后服务自动重启。`"
      :require-input="restoreTarget?.id ?? ''"
      confirm-text="确认恢复"
      danger
      @close="restoreOpen = false"
      @confirm="doRestore"
    />
  </section>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.title {
  font-size: var(--fs-body);
  font-weight: 600;
  margin-bottom: 2px;
}
.table-wrap {
  overflow-x: auto;
}
.act {
  text-align: right;
  white-space: nowrap;
}
.tip {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tip ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
</style>
