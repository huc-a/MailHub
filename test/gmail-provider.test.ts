import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRawGmailMessage, GmailApiError, listGmailHistory, listInboxMessages, refreshGmailAccessToken } from '../src/providers/gmail';

afterEach(()=>vi.unstubAllGlobals());
describe('Gmail readonly provider',()=>{
  it('limits listing to Inbox and the requested time window',async()=>{
    let called='';vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{called=String(input);return Response.json({messages:[{id:'m1',threadId:'t1'}],resultSizeEstimate:1});}));
    const result=await listInboxMessages('access',1790000000,300,'next');
    const url=new URL(called);expect(url.searchParams.get('labelIds')).toBe('INBOX');expect(url.searchParams.get('maxResults')).toBe('100');expect(url.searchParams.get('q')).toBe('after:1790000000');expect(result.messages?.[0].id).toBe('m1');
  });
  it('decodes Gmail base64url raw MIME',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'m1',threadId:'t1',raw:btoa('From: a@b.test\r\n\r\nHello').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')})));
    const result=await getRawGmailMessage('access','m1');expect(new TextDecoder().decode(result.bytes)).toContain('Hello');
  });
  it('returns bounded retry metadata for provider errors',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{status:'RESOURCE_EXHAUSTED'}}),{status:429,headers:{'Retry-After':'30'}})));
    await expect(listInboxMessages('access',0)).rejects.toMatchObject({status:429,retryAfter:'30'} satisfies Partial<GmailApiError>);
  });
  it('refreshes access using readonly grant credentials',async()=>{
    let body='';vi.stubGlobal('fetch',vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{body=String(init?.body);return Response.json({access_token:'new',expires_in:3600});}));
    await expect(refreshGmailAccessToken('refresh','client','secret')).resolves.toMatchObject({access_token:'new'});expect(body).toContain('grant_type=refresh_token');
  });
  it('requests history changes needed to mirror Inbox membership and deletions',async()=>{
    let called='';vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{called=String(input);return Response.json({historyId:'101',history:[]});}));
    await listGmailHistory('access','99');const url=new URL(called);
    expect(url.searchParams.getAll('historyTypes')).toEqual(['messageAdded','messageDeleted','labelAdded','labelRemoved']);
  });
});
