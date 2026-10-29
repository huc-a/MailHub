export type ImapFolder = { name:string; flags:string[] };
type ImapResponse = { lines:string[]; literals:Uint8Array[] };
type ImapSocket = { readable:ReadableStream<Uint8Array>;writable:WritableStream<Uint8Array>;close():Promise<void>;opened?:Promise<unknown> };
type SocketFactory = (hostname:string,port:number)=>ImapSocket;

function concat(parts:Uint8Array[],size:number){const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.byteLength;}return result;}
function quote(value:string){return `"${value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;}
function decodeModifiedUtf7(value:string){return value.replace(/&([A-Za-z0-9+,]+)-/g,(_match,encoded:string)=>{try{const base64=encoded.replace(/,/g,'/').replace(/\+/g,'+');const bytes=Uint8Array.from(atob(base64+'='.repeat((4-base64.length%4)%4)),char=>char.charCodeAt(0));return new TextDecoder('utf-16be').decode(bytes);}catch{return `&${encoded}-`;}}).replace(/&-/g,'&');}
function encodeModifiedUtf7(value:string){let output='',pending='';const flush=()=>{if(!pending)return;const bytes:number[]=[];for(const char of pending){const code=char.codePointAt(0)!;if(code<=0xffff)bytes.push(code>>8,code&0xff);else{const point=code-0x10000,high=0xd800+(point>>10),low=0xdc00+(point&0x3ff);bytes.push(high>>8,high&0xff,low>>8,low&0xff);}}const binary=String.fromCharCode(...bytes);output+=`&${btoa(binary).replace(/\//g,',').replace(/=+$/,'')}-`;pending='';};for(const char of value){const code=char.codePointAt(0)!;if(code>=0x20&&code<=0x7e){flush();output+=char==='&'?'&-':char;}else pending+=char;}flush();return output;}

class ImapReader {
  private reader:ReadableStreamDefaultReader<Uint8Array>;
  private buffered:Uint8Array=new Uint8Array();
  constructor(stream:ReadableStream<Uint8Array>){this.reader=stream.getReader();}
  async line():Promise<Uint8Array>{
    while(true){for(let i=0;i<this.buffered.length-1;i++)if(this.buffered[i]===13&&this.buffered[i+1]===10){const line=this.buffered.slice(0,i);this.buffered=this.buffered.slice(i+2);return line;}const next=await this.reader.read();if(next.done)throw new Error('IMAP_CONNECTION_CLOSED');this.buffered=concat([this.buffered,next.value],this.buffered.length+next.value.length);if(this.buffered.length>64*1024)throw new Error('IMAP_RESPONSE_LINE_TOO_LARGE');}
  }
  async exact(length:number):Promise<Uint8Array>{const parts:Uint8Array[]=[];let size=0;if(this.buffered.length){const take=Math.min(length,this.buffered.length);parts.push(this.buffered.slice(0,take));size=take;this.buffered=this.buffered.slice(take);}while(size<length){const next=await this.reader.read();if(next.done)throw new Error('IMAP_CONNECTION_CLOSED');const take=Math.min(length-size,next.value.length);parts.push(next.value.slice(0,take));size+=take;if(take<next.value.length){this.buffered=concat([this.buffered,next.value.slice(take)],this.buffered.length+next.value.length-take);}}return concat(parts,length);}
  async response(tag:string):Promise<ImapResponse>{const lines:string[]=[],literals:Uint8Array[]=[];for(let count=0;count<1000;count++){const lineBytes=await this.line(),line=new TextDecoder().decode(lineBytes);lines.push(line);const literal=line.match(/\{(\d+)\+?\}$/);if(literal){const length=Number(literal[1]);if(!Number.isSafeInteger(length)||length>25*1024*1024)throw new Error('IMAP_MESSAGE_TOO_LARGE');literals.push(await this.exact(length));const ending=await this.exact(2);if(ending[0]!==13||ending[1]!==10)throw new Error('IMAP_INVALID_LITERAL');continue;}if(line.startsWith(`${tag} `)){if(!new RegExp(`^${tag} OK\\b`,'i').test(line))throw new Error(`IMAP_COMMAND_FAILED:${line.slice(tag.length+1,tag.length+80)}`);return{lines,literals};}}throw new Error('IMAP_RESPONSE_LIMIT');}
}

export class ImapClient {
  private socket:ImapSocket;
  private reader:ImapReader;
  private writer:WritableStreamDefaultWriter<Uint8Array>;
  private tag=0;
  private selected=false;
  private constructor(socket:ImapSocket){this.socket=socket;this.reader=new ImapReader(socket.readable);this.writer=socket.writable.getWriter();}
  static async open(host:string,port:number,email:string,password:string,factory?:SocketFactory){
    if(!['imap.qq.com','imap.gmail.com'].includes(host))throw new Error('IMAP_HOST_NOT_SUPPORTED');
    if(port!==993)throw new Error('IMAP_PORT_NOT_SUPPORTED');
    if(!factory){const {connect}=await import(/* @vite-ignore */ 'cloudflare:sockets');factory=(hostname,p)=>connect({hostname,port:p},{secureTransport:'on',allowHalfOpen:false}) as ImapSocket;}
    const client=new ImapClient(factory(host,port));try{await client.socket.opened;await client.reader.line();await client.command(`LOGIN ${quote(email)} ${quote(password)}`);return client;}catch(e){await client.close();throw e;}
  }
  private async command(command:string):Promise<ImapResponse>{const tag=`A${String(++this.tag).padStart(4,'0')}`;await this.writer.write(new TextEncoder().encode(`${tag} ${command}\r\n`));return this.reader.response(tag);}
  async folders():Promise<ImapFolder[]>{const response=await this.command('LIST "" "*"'),folders:ImapFolder[]=[];for(const line of response.lines){const match=line.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (?:"((?:[^"\\]|\\.)*)"|([^\s]+))/i);if(match){const name=(match[2]??match[3]??'').replace(/\\(["\\])/g,'$1');folders.push({name:decodeModifiedUtf7(name),flags:match[1].split(/\s+/).filter(Boolean)});}}return folders;}
  async fetchSince(folder:string,cursor:number|null,limit=50,expectedUidValidity?:string|null):Promise<{messages:Array<{uid:number;raw:Uint8Array}>;maxUid:number;uidValidity:string|null}>{
    const selected=await this.command(`SELECT ${quote(encodeModifiedUtf7(folder))}`);const uidValidity=selected.lines.join('\n').match(/\* OK \[UIDVALIDITY (\d+)\]/i)?.[1]??null;this.selected=true;
    const effectiveCursor=expectedUidValidity!==undefined&&expectedUidValidity!==uidValidity?null:cursor;
    const search=effectiveCursor===null?'UID SEARCH ALL':`UID SEARCH UID ${effectiveCursor+1}:*`,result=await this.command(search);const uids=(result.lines.find(line=>line.startsWith('* SEARCH'))??'').replace(/^\* SEARCH\s*/,'').trim().split(/\s+/).filter(Boolean).map(Number).filter(uid=>Number.isSafeInteger(uid)&&uid>0).sort((a,b)=>a-b);
    const pending=(effectiveCursor===null?uids.slice(-Math.min(limit,100)):uids.filter(uid=>uid>effectiveCursor).slice(0,limit));const messages:Array<{uid:number;raw:Uint8Array}>=[];
    for(const uid of pending){const response=await this.command(`UID FETCH ${uid} (UID BODY.PEEK[])`);const responseText=response.lines.join('\n');const found=responseText.match(/\bUID (\d+)\b/i);if(response.literals[0]&&found)messages.push({uid:Number(found[1]),raw:response.literals[0]});}
    const maxUid=messages.reduce((max,item)=>Math.max(max,item.uid),effectiveCursor??0);return{messages,maxUid,uidValidity};
  }
  async close(){try{if(this.selected)await this.command('LOGOUT');}catch{/* Ignore logout failures during cleanup. */}try{this.writer.releaseLock();}catch{}try{await this.socket.close();}catch{}}
}

export async function testImapConnection(host:string,port:number,email:string,password:string,factory?:SocketFactory){const client=await ImapClient.open(host,port,email,password,factory);try{return await client.folders();}finally{await client.close();}}
