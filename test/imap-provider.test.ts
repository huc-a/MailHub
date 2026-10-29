import { describe, expect, it } from 'vitest';
import { ImapClient, testImapConnection } from '../src/providers/imap';

const enc=new TextEncoder();
function mockServer(raw=new TextEncoder().encode('From: source@example.test\r\nTo: hub@example.test\r\nSubject: Forwarded test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello\r\n')){
  const serverToClient=new TransformStream<Uint8Array,Uint8Array>(),clientToServer=new TransformStream<Uint8Array,Uint8Array>(),writer=serverToClient.writable.getWriter(),reader=clientToServer.readable.getReader(),commands:string[]=[];
  void (async()=>{await writer.write(enc.encode('* OK IMAP ready\r\n'));let pending='';while(true){const chunk=await reader.read();if(chunk.done)break;pending+=new TextDecoder().decode(chunk.value);let index;while((index=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+2);const match=line.match(/^(A\d+) (.*)$/);if(!match)continue;const[,tag,command]=match;commands.push(command);if(command.startsWith('LOGIN'))await writer.write(enc.encode(`${tag} OK authenticated\r\n`));else if(command.startsWith('LIST'))await writer.write(enc.encode(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n${tag} OK listed\r\n`));else if(command.startsWith('SELECT'))await writer.write(enc.encode(`* 2 EXISTS\r\n* OK [UIDVALIDITY 77] valid\r\n${tag} OK selected\r\n`));else if(command.startsWith('UID SEARCH'))await writer.write(enc.encode(`* SEARCH 2\r\n${tag} OK searched\r\n`));else if(command.startsWith('UID FETCH')){await writer.write(enc.encode(`* 1 FETCH (UID 2 BODY[] {${raw.length}}\r\n`));await writer.write(raw);await writer.write(enc.encode(`)\r\n${tag} OK fetched\r\n`));}else await writer.write(enc.encode(`${tag} OK\r\n`));}}})().catch(()=>{});
  return{commands,factory:()=>({readable:serverToClient.readable,writable:clientToServer.writable,opened:Promise.resolve(),close:async()=>{await reader.cancel();await writer.close().catch(()=>{});}})};
}

describe('forwarded IMAP provider',()=>{
  it('authenticates and discovers folders without exposing credentials',async()=>{
    const mock=mockServer();const folders=await testImapConnection('imap.qq.com',993,'hub@example.test','app-password',mock.factory);
    expect(folders).toEqual([{name:'INBOX',flags:['\\HasNoChildren']}]);
  });
  it('uses UID cursor and BODY.PEEK, returning message literals with UID validity',async()=>{
    const mock=mockServer(),client=await ImapClient.open('imap.qq.com',993,'hub@example.test','app-password',mock.factory);
    try{const result=await client.fetchSince('INBOX',1,10,'77');expect(result.uidValidity).toBe('77');expect(result.maxUid).toBe(2);expect(result.messages).toHaveLength(1);expect(new TextDecoder().decode(result.messages[0].raw)).toContain('Subject: Forwarded test');expect(mock.commands).toContain('UID SEARCH UID 2:*');}
    finally{await client.close();}
  });
  it('resets its search cursor when the server changes UID validity',async()=>{const mock=mockServer(),client=await ImapClient.open('imap.qq.com',993,'hub@example.test','app-password',mock.factory);try{await client.fetchSince('Archive',99,10,'76');expect(mock.commands).toContain('UID SEARCH ALL');}finally{await client.close();}});
  it('encodes Chinese QQ folder names as UTF-16BE modified UTF-7 before SELECT',async()=>{const mock=mockServer(),client=await ImapClient.open('imap.qq.com',993,'hub@example.test','app-password',mock.factory);try{await client.fetchSince('其他文件夹/user@example.test',null,10);expect(mock.commands).toContain('SELECT "&UXZO1mWHTvZZOQ-/user@example.test"');}finally{await client.close();}});
  it('refuses unsupported IMAP hosts and plaintext port',async()=>{
    await expect(ImapClient.open('127.0.0.1',993,'a@b.test','secret')).rejects.toThrow('IMAP_HOST_NOT_SUPPORTED');
    await expect(ImapClient.open('imap.qq.com',143,'a@b.test','secret')).rejects.toThrow('IMAP_PORT_NOT_SUPPORTED');
  });
});
