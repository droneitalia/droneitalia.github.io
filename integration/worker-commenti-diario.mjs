// Drone Italia - Worker Magic Link e commenti.
// Redirect alla community v65; HMAC SHA-256 verificato.
const enc = new TextEncoder();
const json = (obj, status=200, headers={}) => new Response(JSON.stringify(obj), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const now = () => new Date().toISOString();
const validEmail = e => typeof e==='string' && e.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const badLinks = t => /(https?:\/\/|www\.|(?:\b(?:t\.me|bit\.ly|tinyurl\.com)\b))/i.test(t);
const blockedWords = t => /\b(?:truffa\s+garantita|guadagn[ai]\s+facil[ie]|casino\s+online|viagra|pornografia)\b/i.test(t);
async function hmac(value, secret) {
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,enc.encode(value));
 return Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,'0')).join('');
}
async function sha256(value) {
 const d=await crypto.subtle.digest('SHA-256',enc.encode(value));
 return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,'0')).join('');
}
function randomToken() { const a=new Uint8Array(32);crypto.getRandomValues(a);return Array.from(a,b=>b.toString(16).padStart(2,'0')).join(''); }
async function verifyTurnstile(token,ip,env) {
 const data=new FormData();data.append('secret',env.TURNSTILE_SECRET);data.append('response',token);if(ip)data.append('remoteip',ip);
 const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:data});
 const x=await r.json();return x.success===true&&(!env.TURNSTILE_HOSTNAME||x.hostname===env.TURNSTILE_HOSTNAME);
}
async function adminAllowed(req,env) {
 const supplied=req.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
 if(!supplied||!env.ADMIN_TOKEN||supplied.length!==env.ADMIN_TOKEN.length)return false;
 return await hmac(supplied,env.HASH_SECRET)===await hmac(env.ADMIN_TOKEN,env.HASH_SECRET);
}
async function currentSession(req,env) {
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 return await env.DB.prepare('SELECT email_hash FROM di_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await sha256(token),now()).first();
}
async function banned(ipHash,env){return !!await env.DB.prepare('SELECT id FROM bans WHERE ip_hash=? AND (expires_at IS NULL OR expires_at>?) LIMIT 1').bind(ipHash,now()).first();}
async function rateLimit(key,limit,windowSeconds,env) {
 // Atomic SQLite upsert: only increments inside the allowed window or after reset.
 const current=now(),start=new Date(Date.now()-windowSeconds*1000).toISOString();
 const result=await env.DB.prepare(`INSERT INTO di_magic_rate(rate_key,count,window_start) VALUES(?,1,?)
 ON CONFLICT(rate_key) DO UPDATE SET
 count=CASE WHEN window_start<? THEN 1 ELSE count+1 END,
 window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END
 WHERE window_start<? OR count<? RETURNING count`).bind(key,current,start,start,start,limit).first();
 return !!result;
}
// Incorporato nel Worker: nessun endpoint email pubblico, nessun indirizzo in chiaro in D1.
const moderationEnabled = env => env.MODERATION_ENABLED === 'true';
const hexBytes = value => Uint8Array.from(value.match(/../g), x => parseInt(x,16));
const hexString = value => Array.from(new Uint8Array(value),x=>x.toString(16).padStart(2,'0')).join('');
async function contactKey(env) {
 const digest=await crypto.subtle.digest('SHA-256',enc.encode('DroneItalia/email/AES-GCM/v1:'+env.HASH_SECRET));
 return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function encryptContact(email,emailHash,env) {
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(emailHash)},await contactKey(env),enc.encode(email));
 return 'v1:'+hexString(iv)+':'+hexString(cipher);
}
async function decryptContact(value,emailHash,env) {
 if(!/^v1:[a-f0-9]{24}:[a-f0-9]{32,1024}$/.test(value))throw Error('Invalid contact');
 const [,iv,cipher]=value.split(':');
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:hexBytes(iv),additionalData:enc.encode(emailHash)},await contactKey(env),hexBytes(cipher)));
}
function normalizeIP(value) {
 if(typeof value!=='string'||value.length>45||!value||value!==value.trim())return null;
 if(/^\d+\.\d+\.\d+\.\d+$/.test(value))return value.split('.').every(x=>/^(0|[1-9]\d{0,2})$/.test(x)&&+x<=255)?value:null;
 if(!/^[a-fA-F0-9:]+$/.test(value)||!value.includes(':'))return null;
 try{return new URL('http://['+value+']/').hostname.slice(1,-1);}catch{return null;}
}
async function moderationBan(emailHash,ipHash,env) {
 if(!moderationEnabled(env))return null;
 return env.DB.prepare(`SELECT id,expires_at FROM di_moderation_bans WHERE revoked_at IS NULL
 AND (expires_at IS NULL OR expires_at>?) AND ((email_hash IS NOT NULL AND email_hash=?) OR (ip_hash IS NOT NULL AND ip_hash=?))
 ORDER BY expires_at IS NULL DESC,expires_at DESC LIMIT 1`).bind(now(),emailHash||'',ipHash||'').first();
}
function banResponse(ban,respond) {
 return respond({error:ban.expires_at?'Account o indirizzo IP sospeso fino al '+ban.expires_at:'Account o indirizzo IP bloccato in modo permanente',banned:true,expires_at:ban.expires_at},403);
}
async function rememberLinkContact(tokenHash,email,emailHash,expires,env) {
 if(!moderationEnabled(env))return;
 await env.DB.batch([
  env.DB.prepare('DELETE FROM di_link_contacts WHERE expires_at<=?').bind(now()),
  env.DB.prepare('DELETE FROM di_verified_contacts WHERE expires_at<=?').bind(now()),
  env.DB.prepare('INSERT INTO di_link_contacts(token_hash,email_cipher,expires_at) VALUES(?,?,?)').bind(tokenHash,await encryptContact(email,emailHash,env),expires)
 ]);
}
async function verifyContact(tokenHash,emailHash,env) {
 if(!moderationEnabled(env))return;
 const record=await env.DB.prepare('SELECT email_cipher FROM di_link_contacts WHERE token_hash=? AND expires_at>?').bind(tokenHash,now()).first();
 if(!record)return; // Vecchi link: l'utente deve richiedere un nuovo Magic Link per ricevere avvisi.
 const expires=new Date(Date.now()+90*86400000).toISOString();
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO di_verified_contacts(email_hash,email_cipher,verified_at,expires_at) VALUES(?,?,?,?)
  ON CONFLICT(email_hash) DO UPDATE SET email_cipher=excluded.email_cipher,verified_at=excluded.verified_at,expires_at=excluded.expires_at`).bind(emailHash,record.email_cipher,now(),expires),
  env.DB.prepare('DELETE FROM di_link_contacts WHERE token_hash=?').bind(tokenHash),
  env.DB.prepare(`UPDATE di_mail_outbox SET state='pending',next_attempt_at=?,attempts=0,last_error=NULL WHERE email_hash=? AND state='unavailable'`).bind(now(),emailHash)
 ]);
}
async function sendQueuedMail(env,limit=5) {
 if(!moderationEnabled(env))return;
 await env.DB.batch([env.DB.prepare('DELETE FROM di_link_contacts WHERE expires_at<=?').bind(now()),env.DB.prepare('DELETE FROM di_verified_contacts WHERE expires_at<=?').bind(now())]);
 for(let i=0;i<limit;i++) {
  const stamp=now(),lease=crypto.randomUUID();
  const row=await env.DB.prepare(`UPDATE di_mail_outbox SET state='sending',attempts=attempts+1,lease_token=?,lease_until=?
   WHERE id=(SELECT id FROM di_mail_outbox WHERE
   (state='pending' AND next_attempt_at<=?) OR (state='sending' AND lease_until<=?)
   ORDER BY created_at,id LIMIT 1) RETURNING *`).bind(lease,new Date(Date.now()+120000).toISOString(),stamp,stamp).first();
  if(!row)return;
  const finish=(state,error=null)=>env.DB.prepare(`UPDATE di_mail_outbox SET state=?,last_error=?,lease_until=NULL,lease_token=NULL,
   sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE id=? AND lease_token=?`).bind(state,error,state,now(),row.id,lease).run();
  try {
   if(row.kind==='temporary_ban'&&row.expires_at&&row.expires_at<=now()){await finish('cancelled','Ban temporaneo già scaduto');continue;}
   const contact=await env.DB.prepare('SELECT email_cipher FROM di_verified_contacts WHERE email_hash=? AND expires_at>?').bind(row.email_hash,now()).first();
   if(!contact){await finish('unavailable','Email verificata non disponibile: serve un nuovo accesso');continue;}
   const email=await decryptContact(contact.email_cipher,row.email_hash,env);
   const res=await fetch(env.GAS_WEB_APP_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},redirect:'follow',
    signal:AbortSignal.timeout(10000),body:JSON.stringify({secret:env.DRONE_ITALIA_SECRET,type:row.kind,eventId:row.id,email,reason:row.reason,expiresAt:row.expires_at})});
   const outcome=await res.json();
   if(!res.ok||outcome.ok!==true)throw Error('Email provider unavailable');
   await finish('sent');
  }catch(_) {
   // Non registra email, token o risposta del provider.
   const failed=row.attempts>=12;
   await env.DB.prepare(`UPDATE di_mail_outbox SET state=?,last_error='Servizio email non disponibile',next_attempt_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?`)
    .bind(failed?'failed':'pending',new Date(Date.now()+Math.min(21600000,60000*2**Math.min(row.attempts,8))).toISOString(),row.id,lease).run();
  }
 }
}
function queueMail(env,ctx) {
 const task=sendQueuedMail(env).catch(()=>console.error('Drone Italia: invio avvisi rinviato'));
 if(ctx?.waitUntil)ctx.waitUntil(task);
 return task;
}
async function moderationSummary(env) {
 const rows=await env.DB.prepare('SELECT state,COUNT(*) AS n FROM di_mail_outbox GROUP BY state').all();
 return Object.fromEntries((rows.results||[]).map(r=>[r.state,r.n]));
}
async function moderationAdmin(req,env,path,respond,ctx) {
 if(!moderationEnabled(env))return null;
 if(req.method==='GET'&&path==='/admin/moderation')return respond({version:1,temporaryDays:7,firstThreshold:5,repeatThreshold:5,notifications:await moderationSummary(env)});
 if(req.method==='GET'&&path==='/admin/notifications') {
  const rows=await env.DB.prepare('SELECT id,kind,state,attempts,created_at,sent_at,last_error FROM di_mail_outbox ORDER BY created_at DESC LIMIT 100').all();
  return respond({notifications:rows.results||[]});
 }
 if(req.method==='POST'&&path==='/admin/notifications/retry') {
  await env.DB.prepare(`UPDATE di_mail_outbox SET state='pending',attempts=0,next_attempt_at=?,last_error=NULL WHERE state='failed'`).bind(now()).run();
  await queueMail(env,ctx);return respond({ok:true,notifications:await moderationSummary(env)});
 }
 if(req.method==='GET'&&path==='/admin/bans') {
  const rows=await env.DB.prepare(`SELECT id,email_hash,ip_hash,reason,source,created_at,expires_at,revoked_at,'moderation' AS system FROM di_moderation_bans
  UNION ALL SELECT CAST(id AS TEXT),NULL,ip_hash,'Blocco IP storico','manual',created_at,expires_at,NULL,'legacy' FROM bans ORDER BY created_at DESC LIMIT 100`).all();
  return respond({bans:rows.results||[]});
 }
 if(req.method==='POST'&&path==='/admin/bans') {
  const d=await req.json();
  if(!['temporary','permanent'].includes(d.type)||!['account','ip','both'].includes(d.scope))return respond({error:'Tipo di ban non valido'},400);
  const days=d.type==='temporary'?Number(d.days):0;
  if(d.type==='temporary'&&![1,7,30].includes(days))return respond({error:'Durata non valida'},400);
  const reason=String(d.reason||'').trim();if(reason.length<3||reason.length>300)return respond({error:'Inserisci una motivazione da 3 a 300 caratteri'},400);
  let emailHash=null,ipHash=null,notifyHash=null;
  if(d.kind&&Number.isSafeInteger(d.itemId)&&d.itemId>0&&['comments','replies'].includes(d.kind)) {
   const table=d.kind==='comments'?'comments':'di_replies';
   const entry=await env.DB.prepare(`SELECT email_hash,ip_hash FROM ${table} WHERE id=?`).bind(d.itemId).first();
   if(!entry)return respond({error:'Messaggio non trovato'},404);
   notifyHash=entry.email_hash;
   if(d.scope!=='ip')emailHash=entry.email_hash;
   if(d.scope!=='account')ipHash=entry.ip_hash;
  }else {
   if(d.scope!=='ip')return respond({error:'Seleziona un messaggio per bloccare un account'},400);
   const ip=normalizeIP(d.ip);if(!ip)return respond({error:'Indirizzo IPv4 o IPv6 non valido'},400);
   ipHash=await hmac(ip,env.HASH_SECRET);
  }
  const id=crypto.randomUUID(),expires=days?new Date(Date.now()+days*86400000).toISOString():null;
  await env.DB.prepare('INSERT INTO di_moderation_bans(id,email_hash,ip_hash,notify_email_hash,reason,source,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(id,emailHash,ipHash,notifyHash,reason,'manual',now(),expires).run();
  await queueMail(env,ctx);
  return respond({ok:true,id,notification:notifyHash?'queued':'not_applicable'});
 }
 const revoke=path.match(/^\/admin\/bans\/([^/]+)\/revoke$/);
 if(req.method==='POST'&&revoke) {
  let banId;try{banId=decodeURIComponent(revoke[1]);}catch{return respond({error:'ID non valido'},400);}
  if(!/^[a-zA-Z0-9:-]{1,180}$/.test(banId))return respond({error:'ID non valido'},400);
  const d=await req.json();
  if(d.system==='legacy') {
   if(!/^\d+$/.test(banId))return respond({error:'ID non valido'},400);
   await env.DB.prepare('DELETE FROM bans WHERE id=?').bind(Number(banId)).run();
  }else await env.DB.batch([
   env.DB.prepare('UPDATE di_moderation_bans SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(now(),banId),
   env.DB.prepare(`UPDATE di_mail_outbox SET state='cancelled',last_error='Ban revocato prima della notifica' WHERE id=? AND state IN ('pending','unavailable')`).bind('ban:'+banId)
  ]);
  return respond({ok:true});
 }
 const violation=path.match(/^\/admin\/(comments|replies)\/(\d+)\/moderate$/);
 if(req.method==='POST'&&violation) {
  const [,kind,idStr]=violation,id=Number(idStr);if(!Number.isSafeInteger(id)||id<1)return respond({error:'ID non valido'},400);
  const d=await req.json(),reason=String(d.reason||'').trim();
  if(reason.length<3||reason.length>300)return respond({error:'Inserisci una motivazione da 3 a 300 caratteri'},400);
  const table=kind==='comments'?'comments':'di_replies';
  const entry=await env.DB.prepare(`SELECT id,email_hash,ip_hash,created_at FROM ${table} WHERE id=?`).bind(id).first();
  if(!entry)return respond({error:'Messaggio non trovato'},404);
  await env.DB.batch([
   env.DB.prepare(`INSERT OR IGNORE INTO di_violations(id,kind,item_id,email_hash,ip_hash,message_created_at,reason,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),kind,id,entry.email_hash,entry.ip_hash,entry.created_at,reason,now()),
   env.DB.prepare(`UPDATE ${table} SET status='deleted' WHERE id=?`).bind(id)
  ]);
  const user=await env.DB.prepare('SELECT strikes,post_ban_strikes,stage,temp_until FROM di_moderation_users WHERE email_hash=?').bind(entry.email_hash).first();
  await queueMail(env,ctx);return respond({ok:true,moderation:user});
 }
 if(req.method==='POST'&&/\/ban$/.test(path))return respond({error:'Usa i nuovi comandi ban temporaneo o permanente'},410);
 return null;
}

export default {
 async scheduled(event,env,ctx) { ctx.waitUntil(sendQueuedMail(env,10)); },
 async fetch(req,env,ctx) {
  const origin=req.headers.get('Origin')||'';
  const allowed=!!origin&&(origin===env.ALLOWED_ORIGIN||origin==='https://droneitalia.github.io');
  const cors=allowed?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}:{};
  if(req.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers:cors});
  const respond=(o,s=200)=>json(o,s,cors);
  const url=new URL(req.url),path=url.pathname;
  let diagnosticStep='START';
  if(!env.DB||!env.HASH_SECRET||!env.ALLOWED_ORIGIN||!env.TURNSTILE_SECRET)return respond({error:'Configurazione server incompleta'},503);
  if(origin&&!allowed)return respond({error:'Origine non autorizzata'},403);
  try {
   if(req.method==='GET'&&path==='/health')return respond({ok:true});
   if(req.method==='GET'&&path==='/comments') {
    const cursor=Number(url.searchParams.get('cursor')||0);
    if(!Number.isSafeInteger(cursor)||cursor<0)return respond({error:'Cursor non valido'},400);
    const rows=await env.DB.prepare('SELECT id,nickname,body,created_at FROM comments WHERE status=? AND id<? ORDER BY id DESC LIMIT 21').bind('published',cursor||Number.MAX_SAFE_INTEGER).all();
    const list=rows.results||[];
    return respond({comments:list.slice(0,20),nextCursor:list.length>20?list[19].id:null});
   }
   if(req.method==='POST'&&path==='/auth/request') {
    if(!allowed)return respond({error:'Origine non autorizzata'},403);
    if(!env.GAS_WEB_APP_URL||!env.DRONE_ITALIA_SECRET||!env.WORKER_PUBLIC_URL)return respond({error:'Invio email non configurato'},503);
    if(Number(req.headers.get('content-length')||0)>2500)return respond({error:'Richiesta troppo grande'},413);
    diagnosticStep='REQUEST_JSON';
    const d=await req.json(),email=String(d.email||'').trim().toLowerCase(),ip=req.headers.get('CF-Connecting-IP');
    if(!validEmail(email)||!ip)return respond({error:'Dati non validi'},400);
    diagnosticStep='TURNSTILE';
    if(!d.turnstileToken||!await verifyTurnstile(String(d.turnstileToken),ip,env))return respond({error:'Verifica antispam non superata'},403);
    diagnosticStep='HASH';
    const emailHash=await hmac(email,env.HASH_SECRET),ipHash=await hmac(ip,env.HASH_SECRET);
    diagnosticStep='BAN_CHECK';
    if(await banned(ipHash,env))return respond({error:'Richiesta non consentita'},403);
    const activeBan=await moderationBan(emailHash,ipHash,env);if(activeBan)return banResponse(activeBan,respond);
    diagnosticStep='RATE_EMAIL';
    const emailAllowed=await rateLimit('email:'+emailHash,1,300,env);
    if(!emailAllowed)return respond({error:'Troppe richieste, riprova più tardi'},429);
    diagnosticStep='RATE_IP';
    const ipAllowed=await rateLimit('ip:'+ipHash,5,3600,env);
    if(!ipAllowed)return respond({error:'Troppe richieste, riprova più tardi'},429);
    diagnosticStep='RATE_GLOBAL';
    const globalAllowed=await rateLimit('global',30,3600,env);
    if(!globalAllowed)return respond({error:'Troppe richieste, riprova più tardi'},429);
    const token=randomToken(),tokenHash=await sha256(token),created=now(),expires=new Date(Date.now()+15*60000).toISOString();
    diagnosticStep='MAGIC_INSERT';
    await env.DB.prepare('INSERT INTO di_magic_links(token_hash,email_hash,expires_at,created_at,consumed_at) VALUES(?,?,?,?,NULL)').bind(tokenHash,emailHash,expires,created).run();
    await rememberLinkContact(tokenHash,email,emailHash,expires,env);
    diagnosticStep='LINK_BUILD';
    const link=new URL('/auth/verify',env.WORKER_PUBLIC_URL);link.searchParams.set('token',token);
    // Google Apps Script redirects can be handled by fetch redirect follow; verify in staging.
    diagnosticStep='GAS_FETCH';
    const mail=await fetch(env.GAS_WEB_APP_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({secret:env.DRONE_ITALIA_SECRET,email,link:link.toString()}),redirect:'follow'});
    if(!mail.ok) return respond({error:'Servizio email temporaneamente non disponibile'},502);
    diagnosticStep='GAS_JSON';
    let outcome;try{outcome=await mail.json();}catch{return respond({error:'Risposta servizio email non valida'},502);}
    if(outcome.ok!==true)return respond({error:'Invio email non riuscito'},502);
    return respond({ok:true});
   }
   if(req.method==='GET'&&path==='/auth/verify') {
    const token=url.searchParams.get('token')||'';
    if(!/^[a-f0-9]{64}$/.test(token))return respond({error:'Link non valido'},400);
    // Atomic consumption prevents replay.
    const record=await env.DB.prepare('UPDATE di_magic_links SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING email_hash').bind(now(),await sha256(token),now()).first();
    if(!record)return respond({error:'Link scaduto o già utilizzato'},400);
    const activeBan=await moderationBan(record.email_hash,null,env);if(activeBan)return banResponse(activeBan,respond);
    await verifyContact(await sha256(token),record.email_hash,env);
    const session=randomToken();
    await env.DB.prepare('INSERT INTO di_sessions(token_hash,email_hash,expires_at,created_at,revoked_at) VALUES(?,?,?,?,NULL)').bind(await sha256(session),record.email_hash,new Date(Date.now()+90*86400000).toISOString(),now()).run();
    // Fragment is not sent in HTTP requests; frontend must explicitly consume and remove it.
    const destination=new URL('https://droneitalia.github.io/');destination.hash='di_session='+session;
    return Response.redirect(destination.toString(),303);
   }
   if(req.method==='GET'&&path==='/auth/me') {
    if(!allowed)return respond({error:'Origine non autorizzata'},403);
    const session=await currentSession(req,env);
    if(!session)return respond({authenticated:false,canPost:false});
    // Stable, domain-separated pseudonym: never return the email or session token.
    const activeBan=await moderationBan(session.email_hash,null,env);
    const accountId=await hmac('DroneItalia/journal/account/v1:'+session.email_hash,env.HASH_SECRET);
    return respond({authenticated:true,accountId,canPost:!activeBan,banned:!!activeBan});
   }
   if(req.method==='POST'&&path==='/auth/logout') {
    if(!allowed)return respond({error:'Origine non autorizzata'},403);
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    if(/^[a-f0-9]{64}$/.test(token))await env.DB.prepare('UPDATE di_sessions SET revoked_at=? WHERE token_hash=?').bind(now(),await sha256(token)).run();
    return respond({ok:true});
   }
   if(req.method==='POST'&&path==='/comments') {
    if(!allowed)return respond({error:'Apri il sito pubblicato per commentare'},403);
    const session=await currentSession(req,env);if(!session)return respond({error:'Verifica prima la tua email'},401);
    if(Number(req.headers.get('content-length')||0)>6000)return respond({error:'Messaggio troppo lungo'},413);
    const d=await req.json(),nickname=String(d.nickname||'').trim(),body=String(d.body||'').trim();
    if(nickname.length<2||nickname.length>50||body.length<5||body.length>1200||d.consent!==true)return respond({error:'Controlla i campi e il consenso privacy'},400);
    const ip=req.headers.get('CF-Connecting-IP');if(!ip)return respond({error:'IP non disponibile'},403);
    if(!d.turnstileToken||!await verifyTurnstile(String(d.turnstileToken),ip,env))return respond({error:'Verifica antispam non superata'},403);
    const ipHash=await hmac(ip,env.HASH_SECRET);if(await banned(ipHash,env))return respond({error:'Invio non consentito'},403);
    const activeBan=await moderationBan(session.email_hash,ipHash,env);if(activeBan)return banResponse(activeBan,respond);
    const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE ip_hash=? AND created_at>datetime('now','-1 hour')").bind(ipHash).first();
    if((recent?.n||0)>=3)return respond({error:'Troppi commenti: riprova tra un’ora'},429);
    const status=badLinks(body)||blockedWords(body)||/(.)\1{12,}/u.test(body)?'pending':'published';
    const inserted=await env.DB.prepare('INSERT INTO comments(nickname,email_hash,body,ip_hash,status,created_at) VALUES(?,?,?,?,?,?)').bind(nickname,session.email_hash,body,ipHash,status,now()).run();
    await env.DB.prepare('INSERT INTO di_comment_owners(comment_id,email_hash) VALUES(?,?)').bind(inserted.meta.last_row_id,session.email_hash).run();
    return respond({status},201);
   }
   if(req.method==='GET'&&/^\/comments\/\d+\/replies$/.test(path)) {
    const id=Number(path.split('/')[2]);if(!Number.isSafeInteger(id)||id<1)return respond({error:'ID non valido'},400);
    const rows=await env.DB.prepare("SELECT id,comment_id,nickname,body,created_at FROM di_replies WHERE comment_id=? AND status='published' ORDER BY id ASC LIMIT 100").bind(id).all();
    return respond({replies:rows.results||[],moderation_version:moderationEnabled(env)?1:0});
   }
   if(req.method==='POST'&&/^\/comments\/\d+\/replies$/.test(path)) {
    if(!allowed)return respond({error:'Origine non autorizzata'},403);
    const session=await currentSession(req,env);if(!session)return respond({error:'Verifica prima la tua email'},401);
    const id=Number(path.split('/')[2]);if(!Number.isSafeInteger(id)||id<1)return respond({error:'ID non valido'},400);
    if(Number(req.headers.get('content-length')||0)>6000)return respond({error:'Messaggio troppo lungo'},413);
    const d=await req.json(),nickname=String(d.nickname||'').trim(),body=String(d.body||'').trim();
    if(nickname.length<2||nickname.length>50||body.length<5||body.length>1200||d.consent!==true)return respond({error:'Controlla i campi e il consenso privacy'},400);
    const parent=await env.DB.prepare("SELECT id,email_hash FROM comments WHERE id=? AND status='published'").bind(id).first();
    if(!parent)return respond({error:'Commento non trovato'},404);
    const owner=await env.DB.prepare('SELECT email_hash FROM di_comment_owners WHERE comment_id=?').bind(id).first();
    // Old comments without verified ownership cannot accept replies.
    if(!owner)return respond({error:'Risposte non disponibili per questo commento storico'},403);
    if(owner.email_hash===session.email_hash)return respond({error:'Non puoi rispondere al tuo commento'},403);
    const ip=req.headers.get('CF-Connecting-IP');if(!ip)return respond({error:'IP non disponibile'},403);
    if(!d.turnstileToken||!await verifyTurnstile(String(d.turnstileToken),ip,env))return respond({error:'Verifica antispam non superata'},403);
    const ipHash=await hmac(ip,env.HASH_SECRET);if(await banned(ipHash,env))return respond({error:'Invio non consentito'},403);
    const activeBan=await moderationBan(session.email_hash,ipHash,env);if(activeBan)return banResponse(activeBan,respond);
    const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM di_replies WHERE ip_hash=? AND created_at>datetime('now','-1 hour')").bind(ipHash).first();
    if((recent?.n||0)>=3)return respond({error:'Troppe risposte: riprova tra un’ora'},429);
    const status=badLinks(body)||blockedWords(body)||/(.)\1{12,}/u.test(body)?'pending':'published';
    await env.DB.prepare('INSERT INTO di_replies(comment_id,nickname,body,email_hash,ip_hash,status,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,nickname,body,session.email_hash,ipHash,status,now()).run();
    return respond({status},201);
   }
   if(path.startsWith('/admin/')) {
    if(!await adminAllowed(req,env))return respond({error:'Non autorizzato'},401);
    const moderationResult=await moderationAdmin(req,env,path,respond,ctx);if(moderationResult)return moderationResult;
    if(req.method==='GET'&&path==='/admin/comments'&&moderationEnabled(env)) {
     const rows=await env.DB.prepare("SELECT c.*,v.id AS violation_id,COALESCE(u.strikes,0) AS strikes,COALESCE(u.post_ban_strikes,0) AS post_ban_strikes,CASE WHEN vc.expires_at>? THEN 1 ELSE 0 END AS contact_available FROM comments c LEFT JOIN di_violations v ON v.kind='comments' AND v.item_id=c.id LEFT JOIN di_moderation_users u ON u.email_hash=c.email_hash LEFT JOIN di_verified_contacts vc ON vc.email_hash=c.email_hash ORDER BY c.id DESC LIMIT 100").bind(now()).all();
     return respond({comments:rows.results||[],moderation_version:1});
    }
    if(req.method==='GET'&&path==='/admin/comments') {
     const rows=await env.DB.prepare('SELECT id,nickname,body,status,ip_hash,created_at FROM comments ORDER BY id DESC LIMIT 100').all();return respond({comments:rows.results||[],moderation_version:moderationEnabled(env)?1:0});
    }
    if(req.method==='GET'&&path==='/admin/replies'&&moderationEnabled(env)) {
     const rows=await env.DB.prepare("SELECT c.*,v.id AS violation_id,COALESCE(u.strikes,0) AS strikes,COALESCE(u.post_ban_strikes,0) AS post_ban_strikes,CASE WHEN vc.expires_at>? THEN 1 ELSE 0 END AS contact_available FROM di_replies c LEFT JOIN di_violations v ON v.kind='replies' AND v.item_id=c.id LEFT JOIN di_moderation_users u ON u.email_hash=c.email_hash LEFT JOIN di_verified_contacts vc ON vc.email_hash=c.email_hash ORDER BY c.id DESC LIMIT 100").bind(now()).all();
     return respond({replies:rows.results||[],moderation_version:1});
    }
    if(req.method==='GET'&&path==='/admin/replies') {
     const rows=await env.DB.prepare('SELECT id,comment_id,nickname,body,status,ip_hash,created_at FROM di_replies ORDER BY id DESC LIMIT 100').all();return respond({replies:rows.results||[],moderation_version:moderationEnabled(env)?1:0});
    }
    if(req.method==='GET'&&path==='/admin/bans') {
     const rows=await env.DB.prepare('SELECT id,ip_hash,created_at,expires_at FROM bans ORDER BY id DESC LIMIT 100').all();return respond({bans:rows.results||[]});
    }
    if(req.method==='POST'&&/^\/admin\/(comments|replies)\/\d+\/(delete|approve|ban)$/.test(path)) {
     const [, ,kind,idStr,action]=path.split('/'),id=Number(idStr),table=kind==='comments'?'comments':'di_replies';
     const entry=await env.DB.prepare(`SELECT id,ip_hash FROM ${table} WHERE id=?`).bind(id).first();
     if(!entry)return respond({error:'Elemento non trovato'},404);
     if(action==='approve')await env.DB.prepare(`UPDATE ${table} SET status='published' WHERE id=?`).bind(id).run();
     if(action==='delete')await env.DB.prepare(`UPDATE ${table} SET status='deleted' WHERE id=?`).bind(id).run();
     if(action==='ban') {
      const d=await req.json(),days=Number(d.days);if(![1,7,30,0].includes(days))return respond({error:'Durata non valida'},400);
      const expires=days?new Date(Date.now()+days*86400000).toISOString():null;
      await env.DB.prepare('INSERT INTO bans(ip_hash,created_at,expires_at) VALUES(?,?,?)').bind(entry.ip_hash,now(),expires).run();
      await env.DB.prepare("UPDATE comments SET status='deleted' WHERE ip_hash=?").bind(entry.ip_hash).run();
      await env.DB.prepare("UPDATE di_replies SET status='deleted' WHERE ip_hash=?").bind(entry.ip_hash).run();
     }
     return respond({ok:true});
    }
    if(req.method==='POST'&&/^\/admin\/bans\/\d+\/revoke$/.test(path)) {
     await env.DB.prepare('DELETE FROM bans WHERE id=?').bind(Number(path.split('/')[3])).run();return respond({ok:true});
    }
   }
   return respond({error:'Non trovato'},404);
  } catch(e) {
   console.error('Drone Italia Worker:', e);
   if(req.method==='POST'&&path==='/auth/request'&&allowed)
    return respond({error:'Errore del servizio',fase:diagnosticStep},500);
   return respond({error:'Errore del servizio'},500);
  }
 }
};

