(()=>{
'use strict';
const DI_API='https://drone-italia-donazioni.turni-vigilanza-pdura.workers.dev';
const DI_KEY='di_website_donation_live_v1'; // Separato dai dati dell'app e da Sandbox.
const diModal=document.createElement('div');
diModal.id='di-donate-modal';
diModal.innerHTML=`<section class="di-donate-card" role="dialog" aria-modal="true" aria-labelledby="di-donate-title">
<button type="button" class="di-donate-x" id="di-donate-close" aria-label="Chiudi">×</button>
<h2 id="di-donate-title">Sostieni il progetto</h2>
<p class="di-support-intro">Scegli come far crescere Drone Italia.</p>
<div class="di-support-tabs" role="tablist" aria-label="Tipo di sostegno">
<button type="button" role="tab" id="di-tab-single" data-support-tab="single" aria-controls="di-support-single" aria-selected="true"><span aria-hidden="true">❤️</span>Donazione singola</button>
<button type="button" role="tab" id="di-tab-monthly" data-support-tab="monthly" aria-controls="di-support-monthly" aria-selected="false" tabindex="-1"><span aria-hidden="true">💛</span>Sostegno mensile</button>
</div>
<div class="di-support-panel" role="tabpanel" id="di-support-single" aria-labelledby="di-tab-single">
<h3>Donazione singola</h3><p>Un contributo libero, ogni volta che vuoi. Si completa su PayPal.</p>
<label for="di-donate-amount">Importo della donazione</label>
<select id="di-donate-amount"><option value="1">1 €</option><option value="2">2 €</option><option value="5" selected>5 €</option><option value="10">10 €</option><option value="20">20 €</option></select>
<button type="button" class="di-donate-pay" id="di-donate-start">Continua su PayPal ↗</button>
<button type="button" class="di-donate-secondary" id="di-donate-verify" hidden>Verifica pagamento</button>
<button type="button" class="di-donate-secondary" id="di-donate-reset" hidden>Abbandona ordine in sospeso</button>
<p id="di-donate-status" role="status" aria-live="polite"></p>
<small>Non inserire dati di pagamento su questo sito. Il pagamento viene autorizzato su PayPal.</small>
</div>
<div class="di-support-panel" role="tabpanel" id="di-support-monthly" aria-labelledby="di-tab-monthly" hidden>
<h3>Sostieni ogni mese</h3><p>Un aiuto costante al progetto, annullabile in qualsiasi momento su PayPal.</p>
<label for="di-monthly-amount">Importo mensile</label>
<select id="di-monthly-amount"><option value="1">1 € al mese</option><option value="3">3 € al mese</option><option value="5">5 € al mese</option></select>
<p id="di-monthly-renewal"></p>
<label class="di-monthly-consent" for="di-monthly-consent"><input type="checkbox" id="di-monthly-consent"><span>Autorizzo il rinnovo automatico mensile fino all’annullamento.</span></label>
<div id="di-monthly-buttons"></div><p id="di-monthly-status" role="status" aria-live="polite"></p>
<button type="button" class="di-donate-secondary" id="di-monthly-update" hidden>Aggiorna stato</button>
<a class="di-monthly-manage" href="https://www.paypal.com/myaccount/autopay/" target="_blank" rel="noopener noreferrer">Gestisci il sostegno su PayPal ↗</a>
</div>
<p class="di-support-free">Il sostegno è volontario. Tutte le funzioni restano gratuite.</p>
</section>`;
document.body.appendChild(diModal);
const diStyle=document.createElement('style');
diStyle.textContent=`
#di-donate-modal{display:none;position:fixed;inset:0;z-index:9999;background:rgba(2,12,25,.78);padding:18px;align-items:center;justify-content:center}
#di-donate-modal.open{display:flex}
.di-donate-card{position:relative;box-sizing:border-box;width:min(100%,410px);max-height:90vh;overflow:auto;border-radius:20px;background:#fff;color:#183a50;padding:24px;box-shadow:0 20px 60px #0007}
.di-donate-card h2{margin:0 35px 12px 0;font-size:23px}
.di-donate-card p{line-height:1.55;font-size:14px}
.di-donate-card label{display:block;font-weight:700;margin:18px 0 8px}
.di-donate-card select{box-sizing:border-box;width:100%;padding:12px;font-size:18px;border:1px solid #b5cce0;border-radius:10px;background:#fff;color:#183a50}
.di-donate-card button{cursor:pointer}
.di-donate-card button:disabled{opacity:.55;cursor:wait}
.di-donate-x{position:absolute;right:13px;top:12px;background:none;border:0;font-size:30px;color:#365c79}
.di-donate-pay{display:block;width:100%;background:#0877d9;color:white;border:0;border-radius:10px;padding:13px;margin:15px 0 8px;font-weight:750;font-size:15px}
.di-donate-secondary{display:block;width:100%;background:#e8f2fb;color:#18527e;border:1px solid #bdd4e6;border-radius:10px;padding:11px;margin-top:8px}
#di-donate-status{overflow-wrap:anywhere;color:#37566c}
.di-donate-card small{display:block;color:#60758a;line-height:1.5}
`;
document.head.appendChild(diStyle);
let diData;
try{diData=JSON.parse(localStorage.getItem(DI_KEY)||'{}')}catch(e){diData={}}
if(!/^[a-f0-9]{32,64}$/i.test(diData.donationId||'')){
 const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
 diData={donationId:Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')};
 localStorage.setItem(DI_KEY,JSON.stringify(diData));
}
const diSave=()=>localStorage.setItem(DI_KEY,JSON.stringify(diData));
const diStatus=document.getElementById('di-donate-status');
const diStart=document.getElementById('di-donate-start');
const diVerify=document.getElementById('di-donate-verify');
const diReset=document.getElementById('di-donate-reset');
let diBusy=false,diVerified=false;
function diRender(){
 diVerify.hidden=!diData.orderId||diVerified;
 diReset.hidden=!diData.orderId||diVerified;
 diStart.disabled=diBusy||(!!diData.orderId&&!diVerified);
 diVerify.disabled=diBusy;
 diReset.disabled=diBusy;
 diStart.textContent=diVerified?'Dona ancora con PayPal ↗':'Dona con PayPal ↗';
 if(diData.orderId&&!diVerified&&!diStatus.textContent)diStatus.textContent='Hai una donazione in attesa. Completa il pagamento su PayPal e poi verifica.';
}
async function diPost(path,body){
 const response=await fetch(DI_API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let data;try{data=await response.json()}catch(e){throw new Error('Risposta non valida dal servizio donazioni')}
 if(!response.ok)throw new Error(data.error||'Servizio temporaneamente non disponibile');
 return data;
}
async function diOpen(){diModal.classList.add('open');document.body.style.overflow='hidden';diRender();document.getElementById('di-tab-single').focus();document.dispatchEvent(new Event('di-support-open'));
 if(diData.orderId&&!diBusy){diBusy=true;diRender();try{const r=await diPost('/verify',{donationId:diData.donationId,orderId:diData.orderId});diVerified=r.verified===true;diStatus.textContent=diVerified?'Donazione verificata. Grazie per il sostegno!':'Pagamento non ancora confermato. Puoi verificarlo dopo aver completato PayPal.';}catch(_){diStatus.textContent='Verifica non disponibile. Ordine conservato.';}finally{diBusy=false;diRender();}}
}
function diClose(){if(diModal.dataset.standalone==='true')return;diModal.classList.remove('open');document.body.style.overflow='';document.getElementById('donate').focus()}
document.getElementById('donate').setAttribute('aria-label','Sostieni il progetto con PayPal');
document.getElementById('donate').title='Sostieni il progetto';
document.getElementById('donate').addEventListener('click',diOpen);
document.getElementById('di-donate-close').addEventListener('click',diClose);
diModal.addEventListener('click',e=>{if(e.target===diModal)diClose()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&diModal.classList.contains('open'))diClose()});
diStart.addEventListener('click',async()=>{
 if(diBusy||(diData.orderId&&!diVerified))return;
 if(diVerified){
  const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
  diData={previous:{orderId:diData.orderId,donationId:diData.donationId},donationId:Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')};
  diSave();diVerified=false;
 }
 diBusy=true;diRender();diStatus.textContent='Preparazione del pagamento sicuro…';
 try{
  const result=await diPost('/create-order',{donationId:diData.donationId,amount:Number(document.getElementById('di-donate-amount').value)});
  if(!result.orderId||!/^https:\/\//.test(result.approvalUrl||''))throw new Error('Risposta PayPal non valida');
  const approval=new URL(result.approvalUrl);
  if(approval.protocol!=='https:'||!['www.paypal.com','paypal.com'].includes(approval.hostname)||approval.username||approval.password||approval.port)throw new Error('Destinazione PayPal non valida');
  diData.orderId=result.orderId;diSave();
  diStatus.textContent='Completa il pagamento su PayPal. Al ritorno, premi “Verifica pagamento”.';
  window.location.assign(approval.href);
 }catch(e){
  diStatus.textContent='Impossibile avviare il pagamento: '+e.message+'. Controlla lo stato su PayPal prima di riprovare.';
 }finally{diBusy=false;diRender()}
});
diVerify.addEventListener('click',async()=>{
 if(diBusy||!diData.orderId)return;
 diBusy=true;diRender();diStatus.textContent='Verifica con PayPal in corso…';
 try{
  const result=await diPost('/capture-order',{donationId:diData.donationId,orderId:diData.orderId});
  if(result.verified===true){diVerified=true;diStatus.textContent='Donazione verificata da PayPal. Grazie!'}
  else diStatus.textContent='Pagamento non ancora confermato. Completa l’autorizzazione su PayPal e riprova.';
 }catch(e){diStatus.textContent='Verifica non disponibile: '+e.message+'. L’ordine resta memorizzato.'}
 finally{diBusy=false;diRender()}
});
diReset.addEventListener('click',async()=>{
 if(diBusy||!diData.orderId||!confirm('Abbandona questo ordine solo se NON hai autorizzato il pagamento. Non annulla un pagamento PayPal. Continuare?'))return;
 diBusy=true;diRender();
 try{
  const result=await diPost('/verify',{donationId:diData.donationId,orderId:diData.orderId});
  if(result.verified===true){diVerified=true;diStatus.textContent='Il pagamento risulta confermato. Ordine conservato.'}
  else{delete diData.orderId;diSave();diStatus.textContent='Ordine in sospeso rimosso dal sito. Nessun pagamento PayPal è stato annullato.'}
 }catch(e){diStatus.textContent='Non è stato possibile controllare lo stato: ordine conservato per sicurezza.'}
 finally{diBusy=false;diRender()}
});


})();
// Mensile Live: solo Client ID pubblico; nessun Secret nel browser.
(()=>{
 'use strict';
 const API='https://drone-italia-sostegno.turni-vigilanza-pdura.workers.dev';
 const KEY='di_website_monthly_live_v1';
 const CLIENT='BAApUifUIzyAxbq3iyqJje9IBSxlTDgh991qnVuofT3DFFmbwhSpBeYIfnVwEMq6oX-Sit9Oyo82IblkRk';
 const PLANS={1:'P-44F36042754487912NLQRDPQ',3:'P-1VJ80325W58794931NLQREEI',5:'P-0GG674568M680291XNLQREYQ'};
 const modal=document.getElementById('di-donate-modal'),single=document.getElementById('di-support-single'),monthly=document.getElementById('di-support-monthly');
 const amount=document.getElementById('di-monthly-amount'),consent=document.getElementById('di-monthly-consent'),status=document.getElementById('di-monthly-status');
 const hint=document.getElementById('di-monthly-renewal'),update=document.getElementById('di-monthly-update'),container=document.getElementById('di-monthly-buttons');
 const tabs=[...modal.querySelectorAll('[data-support-tab]')];
 let data={},sdkPromise,buttons,actions,starting=false,refreshing=false,confirmedStatus='';
 function token(){return Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join('');}
 try{data=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(_){data={};}
 if(!/^[a-f0-9]{48}$/i.test(data.donationId||''))data={donationId:token()};
 function save(){localStorage.setItem(KEY,JSON.stringify(data));}
 function message(text){status.textContent=text;}
 function approvalPending(){return !!data.subscriptionId&&!['CANCELLED','EXPIRED'].includes(confirmedStatus);}
 function render(){
  const pending=approvalPending();
  if(pending&&PLANS[data.amount])amount.value=String(data.amount);
  amount.disabled=pending||starting;
  hint.textContent=amount.value+' € ogni mese, con rinnovo automatico fino all’annullamento. Nessun costo iniziale aggiuntivo. Autorizzazione su PayPal.';
  update.hidden=!data.subscriptionId;update.disabled=refreshing||starting;
  const mayStart=consent.checked&&!starting&&!['ACTIVE','SUSPENDED'].includes(confirmedStatus);
  if(actions){if(mayStart)actions.enable();else actions.disable();}
 }
 async function api(path,body){
  const r=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  const value=await r.json();
  if(!r.ok)throw Error(value.error||'Verifica temporaneamente non disponibile');
  if(value.environment!=='live')throw Error('Ambiente di verifica non valido');
  return value;
 }
 async function refresh(){
  if(!data.subscriptionId||refreshing)return;
  refreshing=true;render();message('Verifica del sostegno su PayPal…');
  try{
   const result=await api('/subscription-status',{donationId:data.donationId,subscriptionId:data.subscriptionId});
   if(result.subscriptionId!==data.subscriptionId||result.currency!=='EUR'||!PLANS[result.amount])throw Error('Riferimenti della risposta non validi');
   confirmedStatus=result.status;data.amount=result.amount;save();
   const labels={ACTIVE:'Sostegno mensile attivo',APPROVAL_PENDING:'Autorizzazione PayPal da completare',APPROVED:'Autorizzazione ricevuta; attivazione da confermare',SUSPENDED:'Sostegno mensile sospeso',CANCELLED:'Rinnovi annullati',EXPIRED:'Procedura scaduta'};
   let text=(labels[result.status]||'Stato da controllare su PayPal')+' · '+result.amount+' € al mese.';
   if(result.lastPayment)text+=' Ultimo pagamento confermato.';
   else text+=' Nessun pagamento confermato da questa verifica.';
   if(result.status==='ACTIVE'&&result.nextBillingTime){const next=new Date(result.nextBillingTime);if(!Number.isNaN(next.getTime()))text+=' Prossimo addebito: '+next.toLocaleDateString('it-IT')+'.';}
   message(text);
  }catch(_){confirmedStatus='';message('Stato non verificabile ora. Riferimenti conservati: riprova con “Aggiorna stato” o controlla su PayPal.');}
  finally{refreshing=false;render();}
 }
 function loadSDK(){
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://www.paypal.com/sdk/js?client-id='+encodeURIComponent(CLIENT)+'&currency=EUR&components=buttons&vault=true&intent=subscription&locale=it_IT';
   script.dataset.namespace='diPayPalMonthly';
   script.onload=()=>window.diPayPalMonthly?.Buttons?resolve(window.diPayPalMonthly):reject(Error('PayPal non disponibile'));
   script.onerror=()=>{script.remove();sdkPromise=null;reject(Error('PayPal non disponibile'));};
   document.head.appendChild(script);
  });return sdkPromise;
 }
 async function prepareButtons(){
  if(buttons)return;
  try{
   message(data.subscriptionId?'Riferimento precedente conservato. Verifica lo stato prima di continuare.':'Seleziona l’importo e autorizza il rinnovo per continuare su PayPal.');
   const sdk=await loadSDK();
   if(buttons)return;
   buttons=sdk.Buttons({
    style:{shape:'rect',color:'gold',layout:'vertical',label:'subscribe',height:48},
    onInit(_data,a){actions=a;render();},
    onClick(_data,a){
     if(!consent.checked){message('Per continuare, autorizza il rinnovo automatico mensile.');return a.reject();}
     if(starting||['ACTIVE','SUSPENDED'].includes(confirmedStatus)){message('Gestisci il sostegno già presente dal tuo conto PayPal.');return a.reject();}
     return a.resolve();
    },
    async createSubscription(_data,a){
     if(!consent.checked||starting)throw Error('Consenso richiesto');
     starting=true;render();
     try{
      // Il riferimento viene salvato prima di aprire l’approvazione: i tentativi successivi riusano lo stesso abbonamento.
      save();
      if(data.subscriptionId){
       const result=await api('/subscription-status',{donationId:data.donationId,subscriptionId:data.subscriptionId});
       if(result.subscriptionId!==data.subscriptionId)throw Error('Riferimento non valido');
       confirmedStatus=result.status;
       if(result.status==='APPROVAL_PENDING')return data.subscriptionId;
       if(!['CANCELLED','EXPIRED'].includes(result.status))throw Error('Sostegno già presente: gestiscilo su PayPal');
       data.previous={subscriptionId:data.subscriptionId,amount:data.amount};delete data.subscriptionId;
      }
      const chosen=Number(amount.value);if(!PLANS[chosen])throw Error('Importo non valido');
      data.amount=chosen;save();
      const id=await a.subscription.create({plan_id:PLANS[chosen],custom_id:data.donationId,application_context:{brand_name:'Drone Italia',locale:'it-IT',shipping_preference:'NO_SHIPPING',user_action:'SUBSCRIBE_NOW'}});
      if(!/^I-[A-Z0-9]{6,30}$/.test(id))throw Error('Risposta PayPal non valida');
      data.subscriptionId=id;confirmedStatus='APPROVAL_PENDING';save();return id;
     }finally{starting=false;render();}
    },
    async onApprove(result){
     if(result.subscriptionID!==data.subscriptionId){message('Riferimenti non coincidenti. Controlla il sostegno nel tuo conto PayPal.');return;}
     consent.checked=false;message('Autorizzazione ricevuta. Verifica sul server in corso…');await refresh();
    },
    onCancel(){consent.checked=false;message('Procedura interrotta. Nessuna attivazione confermata dal sito; i riferimenti disponibili sono conservati.');render();},
    onError(){message('Operazione non completata. Riferimenti conservati. Aggiorna lo stato o controlla su PayPal prima di riprovare.');render();}
   });
   if(!buttons.isEligible()){buttons=null;throw Error('PayPal non disponibile');}
   await buttons.render('#di-monthly-buttons');
  }catch(_){buttons=null;message('Impossibile caricare PayPal. Controlla la connessione e riprova riaprendo la scheda “Sostegno mensile”.');}
 }
 function select(name){
  single.hidden=name!=='single';monthly.hidden=name!=='monthly';
  tabs.forEach(t=>{const active=t.dataset.supportTab===name;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;});
  if(name==='monthly'){render();void prepareButtons();if(data.subscriptionId)void refresh();}
 }
 tabs.forEach((t,i)=>{t.addEventListener('click',()=>select(t.dataset.supportTab));t.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;select(tabs[next].dataset.supportTab);tabs[next].focus();});});
 amount.addEventListener('change',()=>{consent.checked=false;render();});consent.addEventListener('change',render);update.addEventListener('click',refresh);
 document.addEventListener('di-support-open',()=>{consent.checked=false;render();if(!monthly.hidden&&data.subscriptionId)void refresh();});
 // Mantiene il focus nel riquadro, senza interferire con i popup PayPal.
 modal.addEventListener('keydown',e=>{if(modal.dataset.standalone==='true'||e.key!=='Tab')return;const nodes=[...modal.querySelectorAll('button,input,select,a[href],iframe')].filter(n=>!n.disabled&&n.tabIndex!==-1&&n.getClientRects().length);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}});
 window.addEventListener('focus',()=>{if(modal.classList.contains('open')&&!monthly.hidden&&data.subscriptionId&&!starting)void refresh();});
 select('single');
})();
