<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Save } from 'lucide-vue-next'
import type { PublicSettings } from '@kaoshiya/shared'
import { api, HttpError } from '@/api/client'
import { useToastStore } from '@/stores/toast'
import { useCan } from '@/composables/useCan'

const toast = useToastStore()
const { can } = useCan()

const form = reactive<PublicSettings>({ siteName: '考试鸭', defaultPassScore: 60, guestEnabled: false })
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const canWrite = can('settings:write')

async function load(): Promise<void> {
  loading.value = true
  try {
    const settings = await api.settings()
    form.siteName = settings.siteName
    form.defaultPassScore = settings.defaultPassScore
    form.guestEnabled = settings.guestEnabled
  } catch (err) {
    error.value = err instanceof HttpError ? err.message : '加载设置失败'
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (!form.siteName.trim()) {
    toast.error('站点名称不能为空')
    return
  }
  saving.value = true
  try {
    const next = await api.saveSettings({
      siteName: form.siteName.trim(),
      defaultPassScore: Number(form.defaultPassScore),
      guestEnabled: form.guestEnabled,
    })
    form.siteName = next.siteName
    form.defaultPassScore = next.defaultPassScore
    form.guestEnabled = next.guestEnabled
    toast.ok('设置已保存')
  } catch (err) {
    toast.error(err instanceof HttpError ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="wrap">
    <p v-if="error" class="field-error">{{ error }}</p>
    <div v-if="loading" class="muted small">加载中…</div>

    <form v-else class="card box" @submit.prevent="save">
      <h2 class="title">站点设置</h2>
      <p class="small muted">这里的配置对所有用户生效。个人外观（常规 / 低调、浅色 / 深色）属于每个浏览器本机的设置，在顶栏「外观」里切换，不在此处配置。</p>

      <label class="field">
        <span class="field-label">站点名称</span>
        <input v-model="form.siteName" class="input" type="text" maxlength="40" :disabled="!canWrite" />
        <span class="field-hint">显示在顶栏与登录页。</span>
      </label>

      <label class="field">
        <span class="field-label">默认及格线</span>
        <input v-model.number="form.defaultPassScore" class="input num" type="number" min="0" max="1000" :disabled="!canWrite" />
        <span class="field-hint">组卷时作为默认及格分数，可按场次单独调整。</span>
      </label>

      <label class="switch-row">
        <span class="grow">
          <span class="field-label">启用 guest 角色</span>
          <span class="field-hint">关闭后，新建用户时不再默认提供「访客」角色选项（已有访客账号不受影响）。</span>
        </span>
        <input v-model="form.guestEnabled" type="checkbox" :disabled="!canWrite" />
      </label>

      <div class="row" style="justify-content: flex-end">
        <button class="btn btn-primary" type="submit" :disabled="saving || !canWrite">
          <Save :size="15" /> {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>
      <p v-if="!canWrite" class="small faint">当前账号只有查看权限。</p>
    </form>
  </section>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.box {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 620px;
}
.title {
  font-size: var(--fs-body);
  font-weight: 600;
}
.switch-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}
.switch-row .field-label {
  display: block;
}
.switch-row .field-hint {
  display: block;
  margin-top: 2px;
}
</style>
