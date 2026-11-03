<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Flame, Target, TrendingUp } from 'lucide-vue-next'
import type { StatsAll, StatsSelf } from '@kaoshiya/shared'
import AppShell from '@/components/AppShell.vue'
import BarChart from '@/components/BarChart.vue'
import RowBar from '@/components/RowBar.vue'
import EmptyState from '@/components/EmptyState.vue'
import { api, HttpError } from '@/api/client'
import { useCan } from '@/composables/useCan'

const { can } = useCan()
const tab = ref<'self' | 'all'>('self')
const self = ref<StatsSelf | null>(null)
const all = ref<StatsAll | null>(null)
const loading = ref(true)
const error = ref('')
const canAll = computed(() => can('stats:all'))

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    self.value = await api.statsMe()
    if (canAll.value) all.value = await api.statsAll()
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '加载统计失败'
  } finally {
    loading.value = false
  }
}

const dayBars = computed(() =>
  (self.value?.last7Days ?? []).map((row) => ({ label: row.date.slice(5), value: row.count, hint: `${row.date}：${row.count} 题` })),
)
const chapterBars = computed(() =>
  (self.value?.chapterAccuracy ?? []).filter((row) => row.total > 0).map((row) => ({ label: row.chapterName, value: row.accuracy, hint: `${row.accuracy}%` })),
)
const wrongBars = computed(() =>
  (self.value?.wrongByChapter ?? []).map((row) => ({ label: row.chapterName, value: row.count, hint: `${row.count} 题` })),
)
const allBars = computed(() =>
  (all.value?.dailyAnswers ?? []).map((row) => ({ label: row.date.slice(5), value: row.count, hint: `${row.date}：${row.count} 次作答` })),
)

onMounted(load)
</script>

<template>
  <AppShell>
    <header class="head">
      <div>
        <h1 class="page-title">统计</h1>
        <p class="small muted">{{ tab === 'self' ? '你的学习进度与薄弱环节。' : '全站活跃度与存储占用。' }}</p>
      </div>
      <div v-if="canAll" class="tabs">
        <button class="tab" type="button" :class="{ active: tab === 'self' }" @click="tab = 'self'">个人</button>
        <button class="tab" type="button" :class="{ active: tab === 'all' }" @click="tab = 'all'">全站</button>
      </div>
    </header>

    <p v-if="error" class="field-error">{{ error }}</p>
    <div v-if="loading" class="muted small">加载中…</div>

    <template v-else-if="tab === 'self' && self">
      <section class="kpis">
        <div class="card kpi"><span class="kpi-label">总题数</span><span class="kpi-value num">{{ self.totalQuestions }}</span></div>
        <div class="card kpi"><span class="kpi-label">已刷</span><span class="kpi-value num">{{ self.seenQuestions }}</span></div>
        <div class="card kpi"><span class="kpi-label">正确率</span><span class="kpi-value num">{{ self.accuracy }}%</span></div>
        <div class="card kpi"><span class="kpi-label">今日</span><span class="kpi-value num">{{ self.todayCount }}</span></div>
        <div class="card kpi"><span class="kpi-label"><Flame :size="13" /> 连续打卡</span><span class="kpi-value num">{{ self.streakDays }} 天</span></div>
      </section>

      <section class="card block">
        <h2 class="block-title"><TrendingUp :size="14" /> 近 7 日刷题量</h2>
        <BarChart :items="dayBars" unit="题" />
      </section>

      <div class="grid2">
        <section class="card block">
          <h2 class="block-title"><Target :size="14" /> 章节正确率</h2>
          <RowBar v-if="chapterBars.length" :items="chapterBars" />
          <EmptyState v-else title="还没有章节数据" description="导入带章节的题库并开始刷题后这里会有数据。" />
        </section>
        <section class="card block">
          <h2 class="block-title">错题章节分布</h2>
          <RowBar v-if="wrongBars.length" :items="wrongBars" :max="Math.max(...wrongBars.map((b) => b.value), 1)" unit=" 题" color="var(--chart-4)" />
          <EmptyState v-else title="暂时没有错题" description="继续保持。" />
        </section>
      </div>

      <section class="card block">
        <h2 class="block-title">主观题自评分布</h2>
        <div class="grade-row">
          <span class="badge">完全正确 {{ self.selfGradeDist.full }}</span>
          <span class="badge">基本正确 {{ self.selfGradeDist.partial }}</span>
          <span class="badge">错误 {{ self.selfGradeDist.none }}</span>
        </div>
        <p class="small faint">主观题单独统计，不混入客观题正确率。</p>
      </section>
    </template>

    <template v-else-if="tab === 'all' && all">
      <section class="kpis">
        <div class="card kpi"><span class="kpi-label">启用用户</span><span class="kpi-value num">{{ all.activeUsers }} / {{ all.totalUsers }}</span></div>
        <div class="card kpi"><span class="kpi-label">题库</span><span class="kpi-value num">{{ all.bankCount }}</span></div>
        <div class="card kpi"><span class="kpi-label">题目</span><span class="kpi-value num">{{ all.questionCount }}</span></div>
        <div class="card kpi"><span class="kpi-label">今日作答</span><span class="kpi-value num">{{ all.todayAnswers }}</span></div>
      </section>

      <section class="card block">
        <h2 class="block-title">近 14 日全站答题量</h2>
        <BarChart :items="allBars" unit="次" />
      </section>

      <section class="card block">
        <h2 class="block-title">服务器存储占用</h2>
        <ul class="storage small">
          <li><span>SQLite 数据库</span><b class="num">{{ fmtBytes(all.storage.sqliteBytes) }}</b></li>
          <li><span>媒体目录</span><b class="num">{{ fmtBytes(all.storage.mediaBytes) }} · {{ all.storage.mediaFiles }} 个文件</b></li>
          <li><span>备份目录</span><b class="num">{{ fmtBytes(all.storage.backupBytes) }}</b></li>
        </ul>
        <p class="small faint">以上均为服务器实际占用；浏览器本地草稿占用另计，不计入服务器空间。</p>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.page-title { font-size: var(--fs-title); margin-bottom: 2px; }
.tabs { display: flex; gap: 4px; }
.tab {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elev);
  font-size: var(--fs-toolbar);
  cursor: pointer;
  color: var(--text-muted);
}
.tab.active { border-color: var(--primary); background: var(--primary-soft); color: var(--text); font-weight: 600; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 12px; }
.kpi { padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.kpi-label { font-size: var(--fs-small); color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; }
.kpi-value { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.block { padding: 16px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }
.block-title { font-size: var(--fs-toolbar); color: var(--text-muted); display: flex; align-items: center; gap: 6px; font-weight: 600; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grade-row { display: flex; gap: 8px; flex-wrap: wrap; }
.storage { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.storage li { display: flex; justify-content: space-between; gap: 12px; }
@media (max-width: 767px) { .grid2 { grid-template-columns: 1fr; } }
</style>
