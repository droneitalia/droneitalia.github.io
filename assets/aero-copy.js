(()=>{
 'use strict';
 const menu=document.getElementById('menu'),section=document.querySelector('.section');
 const copy=section?.querySelector('.copy'),phone=document.getElementById('phone');
 if(!menu||!copy||!phone)return;
 let frame;
 function align(){
  frame=null;
  if(window.innerWidth<=1100){copy.style.removeProperty('--di-copy-inset');copy.style.removeProperty('--di-copy-span');return;}
  const first=menu.querySelector('button[data-id]');
  if(!first||!copy.getClientRects().length||!phone.getClientRects().length)return;
  const m=first.getBoundingClientRect(),c=copy.getBoundingClientRect(),p=phone.getBoundingClientRect();
  if(!m.width||!p.width||p.left<=c.left)return;
  const inset=Math.max(0,m.left-c.left),span=p.left-c.left-24;
  if(span-inset<240)return;
  copy.style.setProperty('--di-copy-inset',inset.toFixed(2)+'px');
  copy.style.setProperty('--di-copy-span',span.toFixed(2)+'px');
 }
 function schedule(){if(frame==null)frame=requestAnimationFrame(align);}
 if('ResizeObserver' in window){const observer=new ResizeObserver(schedule);[menu,section,phone].forEach(el=>observer.observe(el));}
 window.addEventListener('resize',schedule,{passive:true});window.addEventListener('hashchange',schedule);
 document.fonts?.ready.then(schedule);schedule();
})();
