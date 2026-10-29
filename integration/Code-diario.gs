// Drone Italia: servizio email server-to-server.
// Aggiornare la distribuzione esistente, conservando URL e DRONE_ITALIA_SECRET.
function doPost(e) {
 try {
  var cfg=PropertiesService.getScriptProperties(),secret=cfg.getProperty('DRONE_ITALIA_SECRET');
  if(!secret||!e||!e.postData||e.postData.contents.length>3000)return risposta({ok:false,error:'Richiesta non valida'});
  var data=JSON.parse(e.postData.contents);
  if(typeof data.secret!=='string'||data.secret!==secret)return risposta({ok:false,error:'Non autorizzato'});
  var type=data.type||'magic_link';
  var email=String(type==='journal_review'?cfg.getProperty('ADMIN_EMAIL')||'':data.email||'').trim().toLowerCase();
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))return risposta({ok:false,error:'Email non valida'});
  var eventKey=null,subject,body;
  if(type==='magic_link') {
   var link=String(data.link||'').trim();
   if(!/^https:\/\/drone-italia-commenti\.turni-vigilanza-pdura\.workers\.dev\/auth\/verify\?token=[a-f0-9]{64}$/.test(link))return risposta({ok:false,error:'Link non valido'});
   subject='Drone Italia - Verifica la tua email';
   body='Benvenuto su Drone Italia!\n\nPer verificare la tua email apri questo link:\n'+link+
    '\n\nScade dopo 15 minuti e si usa una sola volta.\nSe non lo hai richiesto, ignora il messaggio.';
  }else if(type==='journal_review') {
   var flightId=String(data.flightId||'');
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(flightId)||typeof data.eventId!=='string'||!/^journal:[a-f0-9-]{36}$/i.test(data.eventId))return risposta({ok:false,error:'Evento Diario non valido'});
   var reviewUrl='https://droneitalia.github.io/diario-admin.html#'+flightId;
   if(data.reviewUrl!==reviewUrl)return risposta({ok:false,error:'Collegamento revisione non valido'});
   var title=String(data.title||'').trim(),author=String(data.author||'').trim(),reviewReason=String(data.reason||'').trim();
   if(title.length<3||title.length>100||author.length<2||author.length>40||reviewReason.length<3||reviewReason.length>300)return risposta({ok:false,error:'Dati racconto non validi'});
   var journalHash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,data.eventId);
   eventKey='DI_EVENT_'+Utilities.base64EncodeWebSafe(journalHash);
   subject='Drone Italia - Racconto del Diario da approvare';
   body='Un racconto del Diario di volo richiede la tua approvazione.\n\nTitolo: '+title+'\nAutore: '+author+'\nMotivo: '+reviewReason+'\n\nApri il pannello amministratore:\n'+reviewUrl+'\n\nAccedi con la tua chiave amministrativa. Il collegamento non contiene credenziali e non approva automaticamente il contenuto.\nDrone Italia';
  }else {
   if(['moderated','temporary_ban','permanent_ban'].indexOf(type)<0||typeof data.eventId!=='string'||!/^[a-zA-Z0-9:.-]{1,160}$/.test(data.eventId))return risposta({ok:false,error:'Evento non valido'});
   var reason=String(data.reason||'').trim();if(reason.length<3||reason.length>300)return risposta({ok:false,error:'Motivazione non valida'});
   var hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,data.eventId);
   eventKey='DI_EVENT_'+Utilities.base64EncodeWebSafe(hash);
   if(type==='moderated') {
    subject='Drone Italia - Messaggio moderato';
    body='Un tuo messaggio nella community è stato rimosso dopo la verifica dell’amministratore.\n\nMotivo: '+reason+
     '\n\nDopo cinque violazioni confermate viene applicato un ban di 7 giorni. Altre cinque nuove violazioni dopo la scadenza comportano un ban permanente.';
   }else if(type==='temporary_ban') {
    var expiration=new Date(data.expiresAt);
    if(!data.expiresAt||isNaN(expiration.getTime()))return risposta({ok:false,error:'Scadenza non valida'});
    subject='Drone Italia - Ban temporaneo';
    body='Il tuo account è stato sospeso dalla community fino al '+Utilities.formatDate(expiration,'Europe/Rome','dd/MM/yyyy HH:mm')+' (ora italiana).\n\nMotivo: '+reason;
   }else {
    subject='Drone Italia - Ban permanente';
    body='Il tuo account è stato bloccato nella community senza una scadenza automatica.\n\nMotivo: '+reason;
   }
   body+='\n\nPer chiedere una verifica puoi rispondere a questa email.\nDrone Italia';
  }
  var lock=LockService.getScriptLock();if(!lock.tryLock(10000))return risposta({ok:false,error:'Servizio occupato'});
  try {
   // Doppio controllo sotto lock: le ripetizioni della coda non reinviano lo stesso avviso.
   if(eventKey&&cfg.getProperty(eventKey)){
    var previous=cfg.getProperty(eventKey);
    if(type==='journal_review'&&/^(SENDING|UNCERTAIN):/.test(previous))return risposta({ok:false,uncertain:true,error:'Esito email da verificare nel pannello Google'});
    return risposta({ok:true,duplicate:true});
   }
   var today=Utilities.formatDate(new Date(),'UTC','yyyyMMdd'),countKey='DI_SENT_'+today;
   var count=Number(cfg.getProperty(countKey)||'0');
   if(count>=30||MailApp.getRemainingDailyQuota()<1)return risposta({ok:false,error:'Limite giornaliero raggiunto'});
   var cache=CacheService.getScriptCache(),cacheKey;
   if(type==='magic_link') {
    cacheKey='DI_EMAIL_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,email));
    if(cache.get(cacheKey))return risposta({ok:false,error:'Attendi prima di richiedere un altro link'});
   }
   if(type==='journal_review')cfg.setProperty(eventKey,'SENDING:'+new Date().toISOString());
   try{MailApp.sendEmail({to:email,subject:subject,body:body});}
   catch(error){if(type==='journal_review'){cfg.setProperty(eventKey,'UNCERTAIN:'+new Date().toISOString());return risposta({ok:false,uncertain:true,error:'Esito invio da verificare'});}throw error;}
   cfg.setProperty(countKey,String(count+1));
   if(eventKey)cfg.setProperty(eventKey,new Date().toISOString());
   if(cacheKey)cache.put(cacheKey,'1',300);
   // Mantiene solo i riferimenti di deduplicazione recenti, senza indirizzi email.
   var props=cfg.getProperties(),cutoff=Date.now()-90*86400000;
   Object.keys(props).forEach(function(k){if(k.indexOf('DI_EVENT_')===0&&Date.parse(String(props[k]).replace(/^(SENDING|UNCERTAIN):/,''))<cutoff)cfg.deleteProperty(k);});
   return risposta({ok:true});
  }finally{lock.releaseLock();}
 }catch(_){return risposta({ok:false,error:'Invio non riuscito'});}
}
function risposta(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
