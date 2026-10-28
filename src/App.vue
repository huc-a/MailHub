<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

type Mailbox = { id:string; address:string; status:'active'|'expired'|'deleting'; createdAt:number; expiresAt:number };
type Email = { id:string; mailboxId:string|null; from:string; subject:string; snippet:string; receivedAt:number; localIsRead:number; source:string };
type Detail = Email & { text:string; otpCandidates:string[]; bodyTruncated:boolean; hasHtml:boolean; attachments:Array<{id:string;filename:string;size:number;skippedReason:string|null}> };
type Account = { id:string;provider:string;emailAddress:string;authStatus:string;syncStatus:string };
const mailboxes=ref<Mailbox[]>([]), emails=ref<Email[]>([]), selectedMailbox=ref(''), selectedEmail=ref<Detail|null>(null);
const accounts=ref<Account[]>([]);
const busy=ref(false), loading=ref(true), error=ref(''), notice=ref(''), health=ref('checking');
const visibleEmails=computed(()=>selectedMailbox.value?emails.value.filter(e=>e.mailboxId===selectedMailbox.value):emails.value);
let refreshTimer:number|undefined;
async function api<T>(path:string, init:RequestInit={}):Promise<T>{
  const headers=new Headers(init.headers); if(init.body)headers.set('Content-Type','application/json');
  const response=await fetch(path,{...init,headers}); const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.error?.message??`请求失败 (${response.status})`); return data as T;
}
async function reload(){
  error.value='';
  try { const [m,e,a]=await Promise.all([api<{mailboxes:Mailbox[]}>('/api/v1/mailboxes'),api<{emails:Email[]}>('/api/v1/emails?limit=100'),api<{accounts:Account[]}>('/api/v1/accounts')]); mailboxes.value=m.mailboxes; emails.value=e.emails;accounts.value=a.accounts; health.value='ready'; }
  catch(e){health.value='error';error.value=e instanceof Error?e.message:'无法连接服务';}
  finally{loading.value=false;}
}
async function createMailbox(){busy.value=true;error.value='';notice.value='';try{const result=await api<{mailbox:Mailbox}>('/api/v1/mailboxes',{method:'POST',headers:{Origin:location.origin,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({ttlMinutes:60})});await reload();selectedMailbox.value=result.mailbox.id;notice.value='临时邮箱已创建';}catch(e){error.value=e instanceof Error?e.message:'创建失败';}finally{busy.value=false;}}
async function connectGmail(){busy.value=true;error.value='';try{const result=await api<{authorizationUrl:string}>('/api/v1/accounts/gmail/connect',{method:'POST',headers:{Origin:location.origin},body:'{}'});location.assign(result.authorizationUrl);}catch(e){error.value=e instanceof Error?e.message:'无法连接 Gmail';busy.value=false;}}
async function syncGmail(account:Account){busy.value=true;error.value='';try{const result=await api<{status:string}>(`/api/v1/accounts/${account.id}/sync`,{method:'POST',headers:{Origin:location.origin}});notice.value=result.status==='running'?'Gmail 同步正在运行':'Gmail 同步任务已排队';await reload();}catch(e){error.value=e instanceof Error?e.message:'无法启动同步';}finally{busy.value=false;}}
async function renewMailbox(box:Mailbox){busy.value=true;error.value='';try{await api(`/api/v1/mailboxes/${box.id}/renew`,{method:'POST',headers:{Origin:location.origin},body:JSON.stringify({ttlMinutes:60})});await reload();notice.value='邮箱有效期已延长';}catch(e){error.value=e instanceof Error?e.message:'续期失败';}finally{busy.value=false;}}
async function deleteMailbox(box:Mailbox){busy.value=true;error.value='';try{await api(`/api/v1/mailboxes/${box.id}`,{method:'DELETE',headers:{Origin:location.origin}});selectedMailbox.value='';selectedEmail.value=null;await reload();notice.value='邮箱已停用，清理任务已排队';}catch(e){error.value=e instanceof Error?e.message:'删除失败';}finally{busy.value=false;}}
async function openEmail(item:Email){error.value='';try{const result=await api<{email:Detail}>(`/api/v1/emails/${item.id}`);selectedEmail.value=result.email;if(!item.localIsRead){await api(`/api/v1/emails/${item.id}`,{method:'PATCH',headers:{Origin:location.origin},body:JSON.stringify({localIsRead:true})});item.localIsRead=1;}}catch(e){error.value=e instanceof Error?e.message:'无法打开邮件';}}
function copyAddress(value:string){navigator.clipboard.writeText(value).then(()=>notice.value='邮箱地址已复制').catch(()=>error.value='复制失败，请手动复制');}
function expiry(value:number){const delta=Math.max(0,value-Date.now());if(delta===0)return'已过期';const mins=Math.ceil(delta/60000);return mins<60?`${mins} 分钟后过期`:`${Math.floor(mins/60)} 小时 ${mins%60} 分钟后过期`;}
function date(value:number){return new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
onMounted(async()=>{const result=new URLSearchParams(location.search).get('gmail');if(result){notice.value=result==='connected'?'Gmail 已连接；当前版本尚未开始同步。':result==='cancelled'?'已取消 Gmail 授权。':'Gmail 授权未完成。';history.replaceState({},'',location.pathname);}await reload();refreshTimer=window.setInterval(reload,20000);});onUnmounted(()=>{if(refreshTimer)clearInterval(refreshTimer);});
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-icon">M<span>·</span></span><span class="brand-name">MailHub</span></div>
      <div class="section-label">工作区</div>
      <button class="nav-item active"><span>▤</span> 收件箱 <span class="nav-count">{{ visibleEmails.length }}</span></button>
      <div class="section-label mailbox-heading"><span>临时邮箱</span><button class="icon-button" :disabled="busy" title="创建邮箱" @click="createMailbox">＋</button></div>
      <button v-for="box in mailboxes" :key="box.id" class="mailbox-nav" :class="{selected:selectedMailbox===box.id}" @click="selectedMailbox=box.id;selectedEmail=null">
        <span class="mail-dot" :class="box.status"></span><span class="mail-address">{{ box.address.split('@')[0] }}</span><span class="mail-time">{{ box.status==='active'?'•':'' }}</span>
      </button>
      <div v-if="!mailboxes.length&&!loading" class="empty-side">还没有临时邮箱</div>
      <div class="sidebar-bottom"><div class="service-line"><i :class="health"></i>{{ health==='ready'?'服务已连接':health==='error'?'连接异常':'正在检查' }}</div><span>私有邮箱工作台</span></div>
    </aside>

    <main class="workspace">
      <header class="topbar"><div><span class="crumb">MailHub</span><span class="slash">/</span><span class="crumb current">{{ selectedEmail?'邮件详情':'收件箱' }}</span></div><div class="top-actions"><span class="secure"><span>◈</span> 私有空间</span><button class="refresh" :disabled="loading" @click="reload">↻ <span>刷新</span></button></div></header>
      <div v-if="error" class="banner error-banner"><span>{{ error }}</span><button @click="error=''">×</button></div><div v-if="notice" class="banner notice-banner"><span>{{ notice }}</span><button @click="notice=''">×</button></div>
      <template v-if="selectedEmail">
        <section class="detail-page"><button class="back-button" @click="selectedEmail=null">← 返回收件箱</button><article class="detail-card"><div class="detail-top"><div class="source-tag">{{ selectedEmail.source==='temporary'?'临时邮箱':'Gmail' }}</div><time>{{ date(selectedEmail.receivedAt) }}</time></div><h1>{{ selectedEmail.subject||'（无主题）' }}</h1><div class="sender-row"><div class="avatar">{{ (selectedEmail.from||'?').slice(0,1).toUpperCase() }}</div><div><strong>{{ selectedEmail.from||'未知发件人' }}</strong><small>收件时间 {{ date(selectedEmail.receivedAt) }}</small></div></div>
          <div v-if="selectedEmail.otpCandidates.length" class="otp-box"><div><span class="otp-label">识别到的验证码</span><span class="otp-hint">候选值，请核对原文</span></div><button v-for="otp in selectedEmail.otpCandidates" :key="otp" class="otp-code" @click="copyAddress(otp)">{{ otp }} <span>复制</span></button></div>
          <p v-if="selectedEmail.bodyTruncated" class="truncated">正文超过显示上限，已截断。</p><div class="mail-body">{{ selectedEmail.text||selectedEmail.snippet||'此邮件没有纯文本正文。' }}</div>
          <iframe v-if="selectedEmail.hasHtml" class="html-frame" :src="`/api/v1/emails/${selectedEmail.id}/html`" sandbox="" referrerpolicy="no-referrer" title="经过净化的邮件 HTML"></iframe>
          <div v-if="selectedEmail.attachments.length" class="attachment-list"><h3>附件</h3><template v-for="item in selectedEmail.attachments" :key="item.id"><a v-if="!item.skippedReason" :href="`/api/v1/emails/${selectedEmail.id}/attachments/${item.id}`" class="attachment">↧ {{ item.filename }} <small>{{ Math.ceil(item.size/1024) }} KB</small></a><div v-else class="attachment skipped">{{ item.filename }} <small>未保存：{{ item.skippedReason }}</small></div></template><p class="caution">附件未经过病毒扫描，请谨慎打开。</p></div>
        </article></section>
      </template>
      <template v-else>
        <section v-if="accounts.length===0" class="connect-card"><div class="connect-mark">G</div><div class="connect-copy"><strong>连接 Gmail</strong><span>只读同步 Inbox。首次同步最近 7 天、最多 200 封；后续通过 History API 更新。</span></div><button class="secondary" :disabled="busy" @click="connectGmail">连接账号</button></section>
        <section v-for="account in accounts" :key="account.id" class="connect-card"><div class="connect-mark">G</div><div class="connect-copy"><strong>{{ account.emailAddress }}</strong><span>Gmail · {{ account.authStatus==='connected'?'已授权只读访问':account.authStatus }}</span></div><span class="source-tag">{{ account.syncStatus==='idle'?'等待同步':'同步 '+account.syncStatus }}</span><button class="secondary" :disabled="busy||account.authStatus!=='connected'" @click="syncGmail(account)">立即同步</button></section>
        <section class="page-heading"><div><p class="eyebrow">MAIL WORKSPACE</p><h1>收件箱</h1><p>管理临时地址，集中查看收到的邮件。</p></div><button class="primary" :disabled="busy" @click="createMailbox"><span>＋</span> 创建临时邮箱</button></section>
        <template v-if="selectedMailbox"><section v-for="box in mailboxes.filter(b=>b.id===selectedMailbox)" :key="box.id" class="mailbox-card"><div class="box-icon">✉</div><div class="box-main"><span class="box-caption">当前临时邮箱</span><div class="box-address">{{ box.address }} <button class="copy-btn" @click="copyAddress(box.address)">复制</button></div><span class="box-expiry" :class="box.status">{{ expiry(box.expiresAt) }}</span></div><div class="box-actions"><button class="secondary" :disabled="busy||box.status!=='active'" @click="renewMailbox(box)">延长 60 分钟</button><button class="danger-quiet" :disabled="busy" @click="deleteMailbox(box)">删除</button></div></section></template>
        <section class="inbox-card"><div class="list-heading"><div><h2>邮件</h2><span>{{ visibleEmails.length }} 封</span></div><button class="text-action" @click="selectedMailbox=''">{{ selectedMailbox?'查看全部':'' }}</button></div>
          <div v-if="loading" class="empty-state">正在读取邮件…</div><div v-else-if="!visibleEmails.length" class="empty-state"><div class="empty-icon">✉</div><strong>还没有邮件</strong><span>创建临时邮箱并将地址提供给发件人。</span></div>
          <button v-for="item in visibleEmails" :key="item.id" class="email-row" :class="{unread:!item.localIsRead}" @click="openEmail(item)"><span class="unread-dot"></span><div class="email-content"><div class="email-meta"><strong>{{ item.from||'未知发件人' }}</strong><time>{{ date(item.receivedAt) }}</time></div><div class="email-subject">{{ item.subject||'（无主题）' }}</div><div class="email-snippet">{{ item.snippet }}</div></div><span class="row-arrow">›</span></button>
        </section>
        <footer>邮件内容仅保存在你的 Cloudflare 账户中 <span>·</span> 临时邮箱到期后立即停止访问</footer>
      </template>
    </main>
  </div>
</template>
