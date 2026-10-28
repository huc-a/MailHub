<script setup lang="ts">
import { onMounted, ref } from 'vue';
const status = ref<'loading' | 'ready' | 'error'>('loading');
onMounted(async () => {
  try {
    const response = await fetch('/api/v1/health');
    status.value = response.ok ? 'ready' : 'error';
  } catch { status.value = 'error'; }
});
</script>

<template>
  <main>
    <div class="brand">M<span>·</span></div>
    <p class="eyebrow">PRIVATE MAIL WORKSPACE</p>
    <h1>MailHub</h1>
    <p class="lead">你的私人邮箱工作台，正在准备就绪。</p>
    <div class="status"><i :class="status"></i>{{ status === 'loading' ? '正在连接服务' : status === 'ready' ? '服务已连接' : '服务暂不可用' }}</div>
    <p class="note">Cloudflare Worker · D1 · R2</p>
  </main>
</template>
