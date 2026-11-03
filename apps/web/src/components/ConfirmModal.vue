<script setup lang="ts">
import { ref, watch } from 'vue'
import Modal from './Modal.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    message?: string
    confirmText?: string
    danger?: boolean
    requireInput?: string
  }>(),
  { message: '', confirmText: '确认', danger: false, requireInput: '' },
)
const emit = defineEmits<{ confirm: []; close: [] }>()
const typed = ref('')
const canConfirm = ref(true)

watch(
  () => props.open,
  () => {
    typed.value = ''
    canConfirm.value = !props.requireInput
  },
)
watch(typed, (value) => {
  canConfirm.value = !props.requireInput || value.trim() === props.requireInput
})
</script>

<template>
  <Modal :open="open" :title="title" :width="440" @close="emit('close')">
    <p v-if="message" class="msg">{{ message }}</p>
    <div v-if="requireInput" class="field" style="margin-top: 10px">
      <label class="field-label">请输入「{{ requireInput }}」以确认</label>
      <input v-model="typed" class="input" type="text" autocomplete="off" />
    </div>
    <template #footer>
      <button class="btn" type="button" @click="emit('close')">取消</button>
      <button class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" type="button" :disabled="!canConfirm" @click="emit('confirm')">
        {{ confirmText }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.msg {
  color: var(--text-muted);
  font-size: var(--fs-toolbar);
  line-height: 1.65;
}
</style>
