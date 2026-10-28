function base64Url(bytes: Uint8Array): string {
  let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function randomSecret(size=32): string { return base64Url(crypto.getRandomValues(new Uint8Array(size))); }
export async function sha256Hex(value: string): Promise<string> {
  const bytes=new TextEncoder().encode(value); const copy=new Uint8Array(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',copy.buffer as ArrayBuffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function keyBytes(encoded: string): Uint8Array {
  const binary=atob(encoded); const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(bytes.byteLength!==32) throw new Error('TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
  return bytes;
}
export async function encryptSecret(value: string, encodedKey: string, aad: string): Promise<string> {
  const key=await crypto.subtle.importKey('raw',keyBytes(encodedKey).buffer as ArrayBuffer,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv.buffer as ArrayBuffer,additionalData:new TextEncoder().encode(aad).buffer as ArrayBuffer},key,new TextEncoder().encode(value).buffer as ArrayBuffer);
  return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}
export async function decryptSecret(value: string, encodedKey: string, aad: string): Promise<string> {
  const [ivPart,dataPart]=value.split('.');
  if(!ivPart||!dataPart) throw new Error('Encrypted secret is malformed');
  const decode=(part:string)=>Uint8Array.from(atob(part.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-part.length%4)%4)),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',keyBytes(encodedKey).buffer as ArrayBuffer,'AES-GCM',false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(ivPart).buffer as ArrayBuffer,additionalData:new TextEncoder().encode(aad).buffer as ArrayBuffer},key,decode(dataPart).buffer as ArrayBuffer);
  return new TextDecoder().decode(plain);
}
