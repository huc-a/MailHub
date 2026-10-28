export type GmailMessageRef = {id:string;threadId:string};
export type GmailRawMessage = {id:string;threadId:string;historyId?:string;internalDate?:string;raw:string};
export class GmailApiError extends Error {
  constructor(public status:number,public retryAfter:string|null,public reason:string){super(`Gmail API ${status}: ${reason}`);}
}
async function googleJson<T>(url:string,accessToken:string):Promise<T>{
  const response=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}});
  if(!response.ok){const retryAfter=response.headers.get('Retry-After');let reason='request_failed';try{const body=await response.json() as {error?:{status?:string;message?:string}};reason=body.error?.status??body.error?.message??reason;}catch{}throw new GmailApiError(response.status,retryAfter,reason);}
  return await response.json() as T;
}
export async function refreshGmailAccessToken(refreshToken:string,clientId:string,clientSecret:string){
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  if(!response.ok){const body=await response.json().catch(()=>({})) as {error?:string};throw new GmailApiError(response.status,response.headers.get('Retry-After'),body.error??'token_refresh_failed');}
  return await response.json() as {access_token:string;expires_in:number;scope?:string};
}
export async function gmailProfile(accessToken:string){return googleJson<{emailAddress:string;messagesTotal:number;threadsTotal:number;historyId:string}>('https://gmail.googleapis.com/gmail/v1/users/me/profile',accessToken);}
export async function listInboxMessages(accessToken:string,afterEpochSeconds:number,maxResults=100,pageToken?:string){
  const url=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');url.searchParams.set('labelIds','INBOX');url.searchParams.set('maxResults',String(Math.min(100,Math.max(1,maxResults))));url.searchParams.set('q',`after:${Math.max(0,Math.floor(afterEpochSeconds))}`);if(pageToken)url.searchParams.set('pageToken',pageToken);
  return googleJson<{messages?:GmailMessageRef[];nextPageToken?:string;resultSizeEstimate:number}>(url.toString(),accessToken);
}
export async function getRawGmailMessage(accessToken:string,id:string){
  const result=await googleJson<GmailRawMessage>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=raw`,accessToken);
  const normalized=result.raw.replace(/-/g,'+').replace(/_/g,'/');const binary=atob(normalized+'='.repeat((4-normalized.length%4)%4));return {...result,bytes:Uint8Array.from(binary,c=>c.charCodeAt(0))};
}
