import { argon2id, sha256 } from 'hash-wasm';

const encoder=new TextEncoder();
export async function deriveMailTdAuthKey(address:string,password:string){
  const normalized=address.toLowerCase().trim(),salt=await crypto.subtle.digest('SHA-256',encoder.encode(normalized));
  return await argon2id({password,salt:new Uint8Array(salt),parallelism:1,iterations:3,memorySize:16384,hashLength:32,outputType:'hex'}) as string;
}
export function randomMailTdPassword(length=20){
  const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  const values=crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values,value=>alphabet[value%alphabet.length]).join('');
}
export function randomMailTdLocalPart(length=10){
  const alphabet='abcdefghijklmnopqrstuvwxyz0123456789',values=crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values,value=>alphabet[value%alphabet.length]).join('');
}
function meetsMailTdDifficulty(hash:string,difficulty:number){
  const wholeZeroBytes=Math.floor(difficulty/8);
  if(!/^0*$/.test(hash.slice(0,wholeZeroBytes*2)))return false;
  const remaining=difficulty%8;
  return remaining===0||((Number.parseInt(hash.slice(wholeZeroBytes*2,wholeZeroBytes*2+2),16)>>(8-remaining))===0);
}
export async function solveMailTdPow(address:string,timestamp:number,difficulty:number){
  if(!Number.isSafeInteger(difficulty)||difficulty<0||difficulty>24)throw new Error('mail.td 要求的 PoW 难度过高');
  for(let nonce=0;nonce<Number.MAX_SAFE_INTEGER;nonce++){
    if(meetsMailTdDifficulty(await sha256(`${address}${timestamp}${nonce}`),difficulty))return String(nonce);
  }
  throw new Error('mail.td 工作量证明计算失败');
}
