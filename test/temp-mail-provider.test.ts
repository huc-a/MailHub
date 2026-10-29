import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTempMailExpired, tempMailCreate, tempMailDomains, tempMailMessages, TempMailApiError } from '../src/providers/temp-mail';

afterEach(()=>vi.unstubAllGlobals());

describe('temp-mail.io provider adapter',()=>{
  it('returns only public, valid domains and sends the site API headers',async()=>{
    let request:Request|undefined;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{request=new Request(input,init);return Response.json({domains:[{name:'example.test',type:'public'},{name:'private.test',type:'private'},{name:'bad domain',type:'public'}]});}));
    expect(await tempMailDomains()).toEqual(['example.test']);
    expect(request?.headers.get('Application-Version')).toBe('4.0.0');
    expect(request?.headers.get('Accept')).toBe('application/json');
    expect(request?.redirect).toBe('follow');
    expect(request?.url).toBe('https://api.internal.temp-mail.io/api/v4/domains');
  });
  it('creates random and custom addresses and keeps the upstream cookie session',async()=>{
    let payload:unknown,request:Request|undefined;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{request=new Request(input,init);payload=await request.clone().json();return Response.json({email:'abc@example.test',token:'mailbox-token'},{headers:{'Set-Cookie':'sid=session-value; Path=/; HttpOnly'}});}));
    const created=await tempMailCreate({name:'my-box',domain:'example.test'});
    expect(payload).toEqual({name:'my-box',domain:'example.test'});
    expect(created).toEqual({email:'abc@example.test',session:{token:'mailbox-token',cookie:'sid=session-value'}});
    expect(request?.headers.get('Origin')).toBe('https://temp-mail.io');
  });
  it('passes the mailbox cookie when polling messages and identifies upstream expiry code 101',async()=>{
    let request:Request|undefined;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{request=new Request(input,init);return Response.json([{id:'msg-1',subject:'Code'}]);}));
    const result=await tempMailMessages('abc@example.test',{token:'token',cookie:'sid=session-value'});
    expect(request?.headers.get('Cookie')).toBe('sid=session-value');
    expect(result.messages).toEqual([{id:'msg-1',subject:'Code'}]);
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({code:101},{status:400})));
    await expect(tempMailMessages('abc@example.test',{token:'token',cookie:''},1)).rejects.toMatchObject({code:'MAILBOX_EXPIRED'} satisfies Partial<TempMailApiError>);
    expect(isTempMailExpired(new TempMailApiError(400,'MAILBOX_EXPIRED'))).toBe(true);
  });
});
