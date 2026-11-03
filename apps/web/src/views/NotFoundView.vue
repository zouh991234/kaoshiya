<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="page">
    <div class="code mono">404</div>
    <h1>页面不存在</h1>
    <p class="muted">地址可能输入有误，或内容已被移除。</p>
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
.code {
  font-size: 44px;
  font-weight: 700;
  color: var(--text-faint);
}
</style>
