const API_BASE='https://mail.td/api';
const USER_AGENT='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type MailTdSession={accountId:string;address:string;token:string;authKey:string};
export type MailTdMessage=Record<string,unknown>&{id:string};
export type MailTdPow={t:number;n:string;d:number;token?:string};
export class MailTdApiError extends Error{
  constructor(public status:number,public code:string){super(`MAIL_TD_${code}`);this.name='MailTdApiError';}
}
export class MailTdPowChallenge extends MailTdApiError{
  constructor(public requiredDifficulty:number,public challengeToken:string){super(428,'POW_RETRY');this.name='MailTdPowChallenge';}
}

async function request(path:string,init:RequestInit={},token?:string){
  const headers=new Headers(init.headers);
  headers.set('Accept','application/json');headers.set('Content-Type','application/json');
  headers.set('Origin','https://mail.td');headers.set('Referer','https://mail.td/');headers.set('User-Agent',USER_AGENT);
  if(token)headers.set('Authorization',`Bearer ${token}`);
  let response:Response;
  try{response=await fetch(`${API_BASE}${path}`,{...init,headers,redirect:'follow'});}
  catch{throw new MailTdApiError(502,'NETWORK_ERROR');}
  const text=await response.text();let body:unknown=null;
  if(text){try{body=JSON.parse(text);}catch{throw new MailTdApiError(502,'INVALID_RESPONSE');}}
  if(!response.ok){
    const upstreamCode=body&&typeof body==='object'&&'error'in body?String((body as {error:unknown}).error):'REQUEST_FAILED';
    const code=/^[a-z0-9_-]{1,48}$/i.test(upstreamCode)?upstreamCode.toUpperCase():'REQUEST_FAILED';
    throw new MailTdApiError(response.status,code);
  }
  return body;
}

export async function mailTdDomains(){
  const body=await request('/domains');
  const values=Array.isArray(body)?body:body&&typeof body==='object'&&Array.isArray((body as {domains?:unknown}).domains)?(body as {domains:unknown[]}).domains:[];
  return [...new Set(values.map(value=>{
    if(typeof value==='string')return value;
    if(value&&typeof value==='object')return String((value as {domain?:unknown;name?:unknown}).domain??(value as {name?:unknown}).name??'');
    return '';
  }).map(value=>value.trim().toLowerCase()).filter(value=>/^[a-z0-9.-]{1,253}$/i.test(value)&&value.includes('.')))];
}

export async function mailTdCreate(address:string,authKey:string,pow:MailTdPow){
  if(!/^\S+@\S+\.\S+$/.test(address)||!/^[a-f0-9]{64}$/i.test(authKey))throw new MailTdApiError(400,'INVALID_CREATE_REQUEST');
  if(!Number.isSafeInteger(pow.t)||Math.abs(Math.floor(Date.now()/1000)-pow.t)>600||!/^\d{1,20}$/.test(pow.n)||!Number.isInteger(pow.d)||pow.d<0||pow.d>24||(pow.token!==undefined&&(typeof pow.token!=='string'||pow.token.length>500)))throw new MailTdApiError(400,'INVALID_POW');
  const body=await request('/accounts',{method:'POST',body:JSON.stringify({address,auth_key:authKey,pow})});
  if(body&&typeof body==='object'&&(body as {status?:unknown}).status==='retry'){
    const response=body as {required_difficulty?:unknown;token?:unknown};
    if(!Number.isInteger(response.required_difficulty)||Number(response.required_difficulty)<1||Number(response.required_difficulty)>24||typeof response.token!=='string'||response.token.length>500)throw new MailTdApiError(502,'INVALID_POW_CHALLENGE');
    throw new MailTdPowChallenge(Number(response.required_difficulty),response.token);
  }
  if(!body||typeof body!=='object')throw new MailTdApiError(502,'INVALID_CREATE_RESPONSE');
  const value=body as {id?:unknown;address?:unknown;token?:unknown};
  if(typeof value.id!=='string'||!value.id||typeof value.address!=='string'||value.address.toLowerCase()!==address.toLowerCase()||typeof value.token!=='string'||!value.token)throw new MailTdApiError(502,'INVALID_CREATE_RESPONSE');
  return{address:value.address.toLowerCase(),session:{accountId:value.id,address:value.address.toLowerCase(),token:value.token,authKey} satisfies MailTdSession};
}

export async function mailTdLogin(session:MailTdSession){
  const body=await request('/token',{method:'POST',body:JSON.stringify({address:session.address,auth_key:session.authKey})});
  if(!body||typeof body!=='object')throw new MailTdApiError(502,'INVALID_TOKEN_RESPONSE');
  const value=body as {id?:unknown;token?:unknown};
  if(typeof value.id!=='string'||typeof value.token!=='string')throw new MailTdApiError(502,'INVALID_TOKEN_RESPONSE');
  return{...session,accountId:value.id,token:value.token};
}

export async function mailTdMessages(session:MailTdSession){
  const body=await request(`/accounts/${encodeURIComponent(session.accountId)}/messages?page=1`,{},session.token);
  const values=Array.isArray(body)?body:body&&typeof body==='object'&&Array.isArray((body as {messages?:unknown}).messages)?(body as {messages:unknown[]}).messages:[];
  return values.filter((value):value is Record<string,unknown>=>Boolean(value&&typeof value==='object')).map(value=>{
    const id=value.id??value._id;
    return (typeof id==='string'&&id)||(typeof id==='number'&&Number.isSafeInteger(id))?{...value,id:String(id)}:null;
  }).filter((value):value is MailTdMessage=>value!==null);
}

export async function mailTdMessage(session:MailTdSession,id:string){
  const body=await request(`/accounts/${encodeURIComponent(session.accountId)}/messages/${encodeURIComponent(id)}`,{},session.token);
  const value=body&&typeof body==='object'&&'message'in body?(body as {message:unknown}).message:body;
  if(!value||typeof value!=='object')throw new MailTdApiError(502,'INVALID_MESSAGE_RESPONSE');
  return value as Record<string,unknown>;
}

export function isMailTdUnauthorized(failure:unknown){return failure instanceof MailTdApiError&&(failure.status===401||failure.status===403);}
