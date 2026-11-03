<script setup lang="ts">
defineProps<{ size?: number; decorative?: boolean }>()
</script>

<template>
  <span class="brand-mark" :class="{ decorative: decorative !== false }" :style="{ width: `${size ?? 22}px`, height: `${size ?? 22}px` }" aria-hidden="true">
    <svg viewBox="0 0 32 32" width="100%" height="100%">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path d="M10 21.2c0-3.7 2.4-6.4 5.9-6.4 2.1 0 3.4.8 4.1 2l-2 1.4c-.5-.7-1.2-1.2-2.1-1.2-1.8 0-3 1.6-3 4.2s1.2 4.2 3.1 4.2c.9 0 1.6-.4 2.1-1.1l2 1.4c-.8 1.2-2.1 1.9-4.2 1.9-3.6 0-5.9-2.7-5.9-6.4z" fill="#2b2b2b" />
      <circle cx="21.8" cy="13.2" r="2" fill="#2b2b2b" />
    </svg>
  </span>
</template>

<style scoped>
.brand-mark {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--accent);
}
[data-style='discreet'] .brand-mark.decorative {
  display: none;
}
</style>
