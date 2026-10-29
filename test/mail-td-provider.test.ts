import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from 'hash-wasm';
import { isMailTdUnauthorized, mailTdCreate, mailTdDomains, mailTdLogin, mailTdMessage, mailTdMessages, MailTdPowChallenge } from '../src/providers/mail-td';
import { deriveMailTdAuthKey, randomMailTdLocalPart, randomMailTdPassword, solveMailTdPow } from '../src/providers/mail-td-client';

afterEach(()=>vi.unstubAllGlobals());

describe('mail.td provider adapter',()=>{
  it('derives the upstream Argon2id key using the address hash as salt',async()=>{
    const first=await deriveMailTdAuthKey('box@example.test','password');
    const normalized=await deriveMailTdAuthKey(' BOX@EXAMPLE.TEST ','password');
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(normalized).toBe(first);
  });

  it('generates random address credentials without logging or returning the password',()=>{
    expect(randomMailTdLocalPart()).toMatch(/^[a-z0-9]{10}$/);
    expect(randomMailTdPassword()).toMatch(/^[A-Za-z0-9!@#$%]{20}$/);
  });

  it('normalizes available domains and sends the provider headers',async()=>{
    let request:Request|undefined;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{request=new Request(input,init);return Response.json({domains:['Example.test',{name:'mail.example.test'},{domain:'invalid domain'}]});}));
    expect(await mailTdDomains()).toEqual(['example.test','mail.example.test']);
    expect(request?.url).toBe('https://mail.td/api/domains');
    expect(request?.headers.get('Origin')).toBe('https://mail.td');
  });

  it('solves the lowest-difficulty proof deterministically',async()=>{
    await expect(solveMailTdPow('box@example.test',1,0)).resolves.toBe('0');
    const nonce=await solveMailTdPow('box@example.test',1,8);
    expect(await sha256(`box@example.test1${nonce}`)).toMatch(/^00/);
    await expect(solveMailTdPow('box@example.test',1,25)).rejects.toThrow('PoW 难度过高');
  });

  it('creates an account and returns a server PoW challenge for browser retry',async()=>{
    const payloads:unknown[]=[];let calls=0;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const request=new Request(input,init);payloads.push(await request.clone().json());calls++;
      return calls===1?Response.json({status:'retry',required_difficulty:16,token:'pow-challenge'}):Response.json({id:'account-1',address:'box@example.test',token:'mailbox-session'});
    }));
    const initialPow={t:Math.floor(Date.now()/1000),n:'1',d:15};
    await expect(mailTdCreate('box@example.test','a'.repeat(64),initialPow)).rejects.toBeInstanceOf(MailTdPowChallenge);
    const result=await mailTdCreate('box@example.test','a'.repeat(64),{...initialPow,n:'3',d:16,token:'pow-challenge'});
    expect(calls).toBe(2);
    expect(payloads[0]).toMatchObject({address:'box@example.test',auth_key:'a'.repeat(64),pow:{d:15}});
    expect(payloads[1]).toMatchObject({pow:{d:16,token:'pow-challenge'}});
    expect(result).toMatchObject({address:'box@example.test',session:{accountId:'account-1',token:'mailbox-session',authKey:'a'.repeat(64)}});
  });

  it('logs in, lists messages and retrieves full message details with the bearer token',async()=>{
    const requests:Request[]=[];
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const request=new Request(input,init);requests.push(request);
      if(request.url.endsWith('/token'))return Response.json({id:'account-2',token:'renewed-token'});
      if(request.url.endsWith('/messages?page=1'))return Response.json({messages:[{_id:'message-1',subject:'One'}]});
      return Response.json({message:{id:'message-1',body_text:'Email body'}});
    }));
    const session=await mailTdLogin({accountId:'account-1',address:'box@example.test',token:'expired-token',authKey:'f'.repeat(64)});
    const messages=await mailTdMessages(session),detail=await mailTdMessage(session,messages[0].id);
    expect(session).toMatchObject({accountId:'account-2',token:'renewed-token'});
    expect(messages).toEqual([{_id:'message-1',subject:'One',id:'message-1'}]);
    expect(detail).toMatchObject({id:'message-1',body_text:'Email body'});
    expect(requests.at(-1)?.headers.get('Authorization')).toBe('Bearer renewed-token');
  });

  it('classifies expired auth without returning upstream response bodies',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'token_expired',token:'must-not-leak'},{status:401})));
    let failure:unknown;
    try{await mailTdMessages({accountId:'a',address:'box@example.test',token:'secret',authKey:'b'.repeat(64)});}catch(error){failure=error;}
    expect(isMailTdUnauthorized(failure)).toBe(true);
    expect(String(failure)).not.toContain('must-not-leak');
  });
});
