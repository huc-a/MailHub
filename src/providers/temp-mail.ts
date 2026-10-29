const API_BASE='https://api.internal.temp-mail.io/api';
const APP_VERSION='4.0.0';
const USER_AGENT='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

export type TempMailSession={token:string;cookie:string};
export type TempMailConfig={name?:string;domain?:string;minNameLength?:number;maxNameLength?:number};
export type TempMailMessage=Record<string,unknown>&{id:string};
export class TempMailApiError extends Error{constructor(public status:number,public code:string){super(`TEMP_MAIL_${code}`);this.name='TempMailApiError';}}

function responseCookies(response:Response){
  const headers=response.headers as Headers&{getSetCookie?:()=>string[]};
  const values=headers.getSetCookie?.()??(response.headers.get('set-cookie')?[response.headers.get('set-cookie')!]:[]);
  return values.map(value=>value.split(';',1)[0]).filter(value=>/^[^=;,\s]+=[^;\r\n]*$/.test(value)).join('; ').slice(0,4096);
}
function errorCode(body:unknown){
  if(body&&typeof body==='object'&&'code'in body){const code=String((body as {code:unknown}).code);if(code==='101')return 'MAILBOX_EXPIRED';if(/^[A-Z0-9_-]{1,40}$/i.test(code))return code.toUpperCase();}
  return 'UPSTREAM_ERROR';
}
async function request(path:string,init:RequestInit={},cookie=''){
  const headers=new Headers(init.headers);
  headers.set('Content-Type','application/json');headers.set('Application-Name','web');headers.set('Application-Version',APP_VERSION);headers.set('X-CORS-Header','1');headers.set('Origin','https://temp-mail.io');headers.set('Referer','https://temp-mail.io/');headers.set('User-Agent',USER_AGENT);
  if(cookie)headers.set('Cookie',cookie);
  let response:Response|undefined;
  for(let attempt=0;attempt<4;attempt++){
    try{response=await fetch(`${API_BASE}${path}`,{...init,headers,redirect:'error'});break;}catch{if(attempt===3)throw new TempMailApiError(502,'NETWORK_ERROR');await new Promise(resolve=>setTimeout(resolve,750*(attempt+1)));}
  }
  if(!response)throw new TempMailApiError(502,'NETWORK_ERROR');
  const setCookie=responseCookies(response);let body:unknown=null;const text=await response.text();if(text){try{body=JSON.parse(text);}catch{body=null;}}
  const nextCookie=setCookie||cookie;
  if(!response.ok)throw Object.assign(new TempMailApiError(response.status,errorCode(body)),{cookie:nextCookie,body});
  return{body,cookie:nextCookie};
}

export async function tempMailDomains(){
  const {body}=await request('/v4/domains');
  if(!body||typeof body!=='object'||!Array.isArray((body as {domains?:unknown}).domains))throw new TempMailApiError(502,'INVALID_DOMAINS_RESPONSE');
  return (body as {domains:Array<{name?:unknown;type?:unknown}>}).domains.filter(item=>item.type==='public'&&typeof item.name==='string'&&/^[a-z0-9.-]{1,253}$/i.test(item.name)).map(item=>String(item.name).toLowerCase());
}

export async function tempMailCreate(config:TempMailConfig={},cookie=''){
  const custom=Boolean(config.name&&config.domain),payload=custom?{name:config.name,domain:config.domain}:{min_name_length:config.minNameLength??10,max_name_length:config.maxNameLength??10};
  const {body,cookie:nextCookie}=await request('/v3/email/new',{method:'POST',body:JSON.stringify(payload)},cookie);
  if(!body||typeof body!=='object')throw new TempMailApiError(502,'INVALID_CREATE_RESPONSE');
  const value=body as {email?:unknown;token?:unknown};
  if(typeof value.email!=='string'||!/^\S+@\S+\.\S+$/.test(value.email)||typeof value.token!=='string'||!value.token)throw new TempMailApiError(502,'INVALID_CREATE_RESPONSE');
  return{email:value.email.toLowerCase(),session:{token:value.token,cookie:nextCookie}};
}

export async function tempMailMessages(email:string,session:TempMailSession,retries=3,retryDelayMs=1500){
  for(let attempt=0;attempt<retries;attempt++){
    try{
      const {body,cookie}=await request(`/v3/email/${encodeURIComponent(email)}/messages`,{},session.cookie);
      const messages=Array.isArray(body)?body:body&&typeof body==='object'&&Array.isArray((body as {messages?:unknown}).messages)?(body as {messages:unknown[]}).messages:[];
      return{messages:messages.filter((value):value is TempMailMessage=>Boolean(value&&typeof value==='object'&&typeof ((value as Record<string,unknown>).id??(value as Record<string,unknown>)._id)==='string')).map(value=>({...value,id:String(value.id??value._id)})),session:{...session,cookie}};
    }catch(failure){if(!isTempMailExpired(failure)||attempt===retries-1)throw failure;await new Promise(resolve=>setTimeout(resolve,retryDelayMs));}
  }
  throw new TempMailApiError(502,'UPSTREAM_ERROR');
}

export async function tempMailMessage(id:string,session:TempMailSession){
  const {body,cookie}=await request(`/v3/message/${encodeURIComponent(id)}`,{},session.cookie);
  return{message:body&&typeof body==='object'?body as Record<string,unknown>:{},session:{...session,cookie}};
}

export function isTempMailExpired(failure:unknown){return failure instanceof TempMailApiError&&failure.code==='MAILBOX_EXPIRED';}
