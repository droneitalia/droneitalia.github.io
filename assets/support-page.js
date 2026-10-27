(()=>{
 'use strict';
 const modal=document.getElementById('di-donate-modal');
 if(!modal){document.getElementById('support-loading').textContent='Impossibile caricare le opzioni. Ricarica la pagina.';return;}
 modal.dataset.standalone='true';
 document.getElementById('support-content').appendChild(modal);
 const card=modal.querySelector('.di-donate-card');card.setAttribute('role','region');card.removeAttribute('aria-modal');card.setAttribute('aria-labelledby','support-page-title');
 document.getElementById('di-donate-title').hidden=true;
 document.getElementById('support-loading').hidden=true;
 document.getElementById('donate').click();document.body.style.overflow='';
})();
