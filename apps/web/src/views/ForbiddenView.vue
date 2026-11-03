<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ShieldAlert } from 'lucide-vue-next'

const router = useRouter()
</script>

<template>
  <div class="page">
    <ShieldAlert :size="34" class="ico" />
    <h1>403 · 没有访问权限</h1>
    <p class="muted">当前账号未被授予此页面的权限。如需访问，请联系管理员调整角色。</p>
    <div class="row">
      <button class="btn" type="button" @click="router.back()">返回上一页</button>
      <RouterLink to="/" class="btn btn-primary">回到题库</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px;
}
.ico {
  color: var(--text-faint);
}
h1 {
  font-size: var(--fs-title);
}
</style>
