<script setup lang="ts">
withDefaults(defineProps<{ title: string; description?: string }>(), { description: '' })
</script>

<template>
  <div class="empty">
    <div class="empty-title">{{ title }}</div>
    <p v-if="description" class="empty-desc">{{ description }}</p>
    <div v-if="$slots.default" class="empty-actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 16px;
  text-align: center;
  color: var(--text-muted);
}
.empty-title {
  font-weight: 600;
  color: var(--text);
}
.empty-desc {
  font-size: var(--fs-toolbar);
  max-width: 46ch;
}
.empty-actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
</style>
