<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import BarChart from '@/components/BarChart.vue'
import RowBar from '@/components/RowBar.vue'
import { api, HttpError } from '@/api/client'

type Overview = Awaited<ReturnType<typeof api.overview>>

const data = ref<Overview | null>(null)
const loading = ref(false)
const error = ref('')

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${index === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

const formatNum = (value: number): string => value.toLocaleString('zh-CN')

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    data.value = await api.overview()
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '概览数据加载失败，请稍后再试'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const cards = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    { label: '用户总数', value: formatNum(d.totalUsers), hint: '全部账号' },
    { label: '启用账号', value: formatNum(d.activeUsers), hint: '状态为启用的账号' },
    { label: '题库数', value: formatNum(d.bankCount), hint: '含公开与私有' },
    { label: '题目数', value: formatNum(d.questionCount), hint: '全部题库合计' },
    { label: '今日答题', value: formatNum(d.todayAnswers), hint: '今日有作答记录的题目数' },
    { label: '角色数', value: formatNum(d.roleCount), hint: '内置与自建角色' },
    { label: '备份数', value: formatNum(d.backups), hint: 'data/backups 下现有备份' },
    { label: '媒体文件', value: formatNum(d.storage.mediaFiles), hint: '题目图片等附件' },
  ]
})

const daily = computed(() =>
  (data.value?.dailyAnswers ?? []).slice(-14).map((item) => ({
    label: item.date.slice(5),
    value: item.count,
    hint: `${item.date} 答题 ${item.count} 次`,
  })),
)

const storageMax = computed(() => {
  const s = data.value?.storage
  if (!s) return 1
  return Math.max(s.sqliteBytes, s.mediaBytes, s.backupBytes, 1)
})

const storageRows = computed(() => {
  const s = data.value?.storage
  if (!s) return []
  return [
    { label: 'SQLite 数据库', value: s.sqliteBytes, hint: formatBytes(s.sqliteBytes) },
    { label: '媒体文件', value: s.mediaBytes, hint: formatBytes(s.mediaBytes) },
    { label: '备份目录', value: s.backupBytes, hint: formatBytes(s.backupBytes) },
  ]
})

const storageTotal = computed(() => {
  const s = data.value?.storage
  if (!s) return '0 B'
  return formatBytes(s.sqliteBytes + s.mediaBytes + s.backupBytes)
})
</script>

<template>
  <div class="stack">
    <div class="row-between">
      <div>
        <h2>概览</h2>
        <p class="faint small">站点规模、近 14 日答题量与磁盘占用。</p>
      </div>
      <button class="btn btn-sm" type="button" :disabled="loading" @click="load">
        <RefreshCw :size="14" :class="{ spin: loading }" />
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>

    <div v-if="!data && loading" class="card pad muted small">正在加载概览数据…</div>

    <template v-if="data">
      <div class="cards">
        <div v-for="card in cards" :key="card.label" class="card stat">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value num">{{ card.value }}</strong>
          <span class="stat-hint faint">{{ card.hint }}</span>
        </div>
      </div>

      <div class="split">
        <section class="card pad">
          <div class="row-between">
            <h3>近 14 日答题量</h3>
            <span class="faint small num">今日 {{ data.todayAnswers }} 次</span>
          </div>
          <BarChart :items="daily" :height="150" unit=" 次" />
        </section>

        <section class="card pad">
          <div class="row-between">
            <h3>存储占用</h3>
            <span class="faint small num">合计 {{ storageTotal }}</span>
          </div>
          <RowBar :items="storageRows" :max="storageMax" unit="" />
          <p class="faint small note">
            数据库、媒体与备份目录的实时大小，备份占用会随保留策略自动回落。
          </p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
}
.stat-label {
  font-size: var(--fs-small);
  color: var(--text-muted);
}
.stat-value {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.stat-hint {
  font-size: 11.5px;
  line-height: 1.4;
}
.split {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 12px;
}
.pad {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.note {
  margin-top: auto;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 860px) {
  .split {
    grid-template-columns: 1fr;
  }
}
</style>
