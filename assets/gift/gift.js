'use strict';
const $ = id => document.getElementById(id);
const state = { to:'Для тебя',message:'',from:'' };
const POLICY_VERSION='2026-11-17';
const localDemo=['127.0.0.1','localhost'].includes(location.hostname);
const API=localDemo?`${location.origin}/api`:'https://api.emotional-harbor.ru';
let paymentBusy=false,claimBusy=false;
let mode='editor', variant='letter', owner=null, recipientGift='', verifyToken='', readyUrl='', draftId='';
const getStored=k=>{try{return JSON.parse(sessionStorage.getItem(k)||'null');}catch{return null;}};
const setStored=(k,v)=>{try{sessionStorage.setItem(k,JSON.stringify(v));}catch{/* подарок восстановим из письма */}};
const fields=()=>({to:$('to').value.trim().slice(0,45),message:$('message').value.trim().slice(0,280),from:$('from').value.trim().slice(0,45)});
function restoreWords(w){if(!w || typeof w!=='object')return;for(const [id,max] of [['to',45],['message',280],['from',45]])$(id).value=typeof w[id]==='string'?w[id].slice(0,max):'';}
function encodeWords(){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(fields())))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decodeWords(raw){try{if(!raw||raw.length>3000||!/^[a-zA-Z0-9_-]+$/.test(raw))return null;const bytes=Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));return JSON.parse(new TextDecoder().decode(bytes));}catch{return null;}}
function currentGiftLink(){if(!readyUrl)return '';const u=new URL(readyUrl);const fragment=new URLSearchParams(u.hash.slice(1));fragment.set('words',encodeWords());u.hash=fragment.toString();return u.href;}
function update(){const w=fields();state.to=w.to||'Для тебя';state.message=w.message;state.from=w.from;
  document.querySelectorAll('[data-to]').forEach(e=>e.textContent=state.to);
  document.querySelectorAll('[data-message]').forEach(e=>{e.textContent=state.message;e.hidden=!state.message;});
  document.querySelectorAll('[data-from]').forEach(e=>{e.textContent=state.from;e.hidden=!state.from;});
  const title=$('letterTitle');title.replaceChildren();const first=document.createElement('span');first.textContent=w.to?w.to+',':'Эта Гавань —';first.style.color=w.to?'var(--pink)':'var(--ink)';title.append(first,document.createElement('br'));const rest=document.createElement('span');rest.textContent=w.to?'это твоя Гавань.':'для тебя.';rest.style.color=w.to?'var(--ink)':'var(--pink)';title.append(rest);
  if(mode!=='recipient'&&mode!=='verify'){setStored('harborGiftDraft',{...w,requestId:draftId});if(owner)setStored('harborGiftOrder:'+owner.order_id,{...owner,words:w});}
  if(readyUrl)$('giftLink').value=currentGiftLink();
  requestAnimationFrame(()=>{if(window.renderGiftCard)window.renderGiftCard();});
}
function select(name){variant=name;for(const n of ['letter','card']){$(n+'Panel').hidden=n!==name;$(n+'Tab').setAttribute('aria-selected',String(n===name));$(n+'Tab').tabIndex=n===name?0:-1;}$('variantExplanation').textContent=name==='letter'?'Получатель откроет личное поздравление и сможет принять подарок.':'Открытку можно отправить вместе с личной ссылкой на подарок.';if(window.renderGiftCard)requestAnimationFrame(()=>window.renderGiftCard());}
function notice(id,text,error=false){const e=$(id);e.textContent=text;e.hidden=!text;e.classList.toggle('error',error);}
async function api(route,body){const r=await fetch(API+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',signal:AbortSignal.timeout(26000)});let data;try{data=await r.json();}catch{throw Error('Не удалось получить ответ. Попробуйте ещё раз.');}if(!r.ok){const e=Error(data.error||'Сервис временно недоступен. Попробуйте ещё раз.');e.code=data.code;throw e;}return data;}
function consents(prefix){return {consent_offer:$(prefix+'Offer').checked,consent_pd:$(prefix+'Pd').checked,consent_marketing:$(prefix+'Marketing')?.checked===true,policy_version:POLICY_VERSION};}
function setOwner(o){owner=o;mode='manager';$('checkout').hidden=true;$('manageActions').hidden=false;$('pageTitle').textContent='Ваш подарок';$('pageIntro').textContent='Добавьте свои слова и вручите подарок сами.';}
async function pollPayment(){if(!owner)return;notice('manageStatus','Проверяю оплату…');$('retryStatus').hidden=true;
  try{const data=await api('/gifts/status',owner);if(data.status==='pending'){notice('manageStatus','Оплата ещё подтверждается. Подождите немного и проверьте ещё раз.');$('retryStatus').hidden=false;return;}
    readyUrl=data.gift_url;$('pageTitle').textContent=data.status==='claimed'?'Подарок уже принят':'Подарок готов';
    notice('manageStatus',data.status==='claimed'?'Подарок уже принят получателем. Поздравление можно открыть снова.':'Всё готово. Скопируйте личную ссылку и отправьте её человеку в удобный момент.');
    $('copyGift').hidden=data.status==='claimed';$('newGift').hidden=false;$('giftCaption').textContent='Тебе подарили Эмоциональную Гавань';update();
  }catch(e){notice('manageStatus',e.message,true);$('retryStatus').hidden=false;}
}
function syncFormButtons(){ $('payGift').disabled=paymentBusy||!$('buyerEmail').validity.valid||!$('buyerOffer').checked||!$('buyerPd').checked;$('claimSubmit').disabled=claimBusy||!$('claimEmail').validity.valid||!$('claimOffer').checked||!$('claimPd').checked;}
function openDialog(id){$(id).showModal();document.body.style.overflow='hidden';}
async function startPayment(e){e.preventDefault();if(!$('paymentForm').reportValidity())return;const button=$('payGift');paymentBusy=true;button.disabled=true;button.textContent='Открываю оплату…';notice('paymentError','');update();
  try{const data=await api('/gifts/create-payment',{email:$('buyerEmail').value.trim(),request_id:draftId,...consents('buyer')});
    owner={order_id:data.order_id,manage_token:data.manage_token};setStored('harborGiftOrder:'+owner.order_id,{...owner,words:fields()});
    if(data.paid){$('paymentDialog').close();setOwner(owner);await pollPayment();return;}
    const u=new URL(data.payment_url);if(u.protocol!=='https:' && !(localDemo&&u.origin===location.origin))throw Error('Не удалось открыть безопасную страницу оплаты.');
    location.assign(u.href);
  }catch(e){notice('paymentError',e.message,true);if(e.code==='payment_canceled'){draftId=crypto.randomUUID();update();}paymentBusy=false;syncFormButtons();button.textContent='Подарить за 3 333 ₽';}
}
async function requestClaim(e){e.preventDefault();if(!$('claimForm').reportValidity())return;const button=$('claimSubmit');claimBusy=true;button.disabled=true;button.textContent='Отправляю письмо…';notice('claimStatus','');try{const data=await api('/gifts/claim/request',{gift:recipientGift,email:$('claimEmail').value.trim(),...consents('claim')});notice('claimStatus',data.message);button.textContent='Отправить письмо ещё раз';}catch(e){notice('claimStatus',e.message,true);button.textContent='Получить письмо';}finally{claimBusy=false;syncFormButtons();}}
async function confirmGift(){const button=$('verifyGift');button.disabled=true;button.textContent='Принимаю подарок…';notice('verifyError','');try{const data=await api('/gifts/claim/confirm',{token:verifyToken});const u=new URL(data.access_url);if(u.origin!=='https://welcome.emotional-harbor.ru')throw Error('Не удалось открыть Гавань. Напишите Елене.');$('verifyPanel').querySelector('h1').textContent='Теперь у Вас есть Гавань';$('verifyText').textContent=data.access_email_sent?'Подарок принят. Письмо со ссылкой для входа уже на Вашей почте. Можно заглянуть к Есении и начать свою историю.':'Подарок принят. Письмо пока не отправилось. Сохраните ссылку на вход или напишите Елене, если понадобится помощь.';button.hidden=true;$('accessLink').href=u.href;$('accessLink').hidden=false;setStored('harborGiftAccess',{url:u.href,at:Date.now()});history.replaceState(null,'',location.pathname+'#accepted');}catch(e){notice('verifyError',e.message,true);button.disabled=false;button.textContent='Подтвердить и принять';}}
async function copyGift(){const url=currentGiftLink();if(!url)return;try{await navigator.clipboard.writeText(url);notice('manageStatus','Ссылка скопирована. В ней уже есть Ваше поздравление.');}catch{$('giftLink').hidden=false;$('giftLink').value=url;$('giftLink').select();notice('manageStatus','Скопируйте ссылку из поля ниже — вместе с поздравлением.');}}
function previewRecipient(){document.body.classList.add('recipient-mode');$('previewBack').hidden=false;$('accept').hidden=true;window.scrollTo({top:0,behavior:'instant'});$('returnEditor').focus();}
function closePreview(){document.body.classList.remove('recipient-mode');$('previewBack').hidden=true;$('recipientView').focus();}
async function saveCard(){const button=$('download');button.disabled=true;button.textContent='Сохраняю…';try{await window.renderGiftCard();const c=$('cardCanvas');const blob=await new Promise(r=>c.toBlob(r,'image/png'));if(!blob)throw Error();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Гавань-в-подарок.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notice('status','Открытка готова. Отправьте её вместе с личной ссылкой на подарок.');}catch{notice('status','Не удалось сохранить картинку. Дождитесь загрузки иллюстрации и попробуйте снова.',true);}finally{button.disabled=false;button.textContent='Сохранить открытку';}}
function init(){const fragment=new URLSearchParams(location.hash.slice(1));const query=new URLSearchParams(location.search);
  if(query.has('new')){try{sessionStorage.removeItem('harborGiftDraft');}catch{}history.replaceState(null,'',location.pathname);}
  if(fragment.has('accepted')){mode='verify';document.body.classList.add('verify-mode');$('verifyPanel').hidden=false;$('verifyGift').hidden=true;$('verifyPanel').querySelector('h1').textContent='Подарок принят';const saved=getStored('harborGiftAccess');if(saved&&Date.now()-saved.at<7*86400000){const u=new URL(saved.url);if(u.origin==='https://welcome.emotional-harbor.ru'||(localDemo&&u.origin===location.origin)){$('accessLink').href=u.href;$('accessLink').hidden=false;}}$('verifyText').textContent='Ссылка для входа также отправляется на подтверждённую почту. Если письмо не нашлось, напишите Елене.';}
  else if(fragment.has('verify')){mode='verify';verifyToken=fragment.get('verify');document.body.classList.add('verify-mode');$('verifyPanel').hidden=false;}
  else if(fragment.has('gift')){mode='recipient';recipientGift=fragment.get('gift');document.body.classList.add('recipient-mode');restoreWords(decodeWords(fragment.get('words')));$('accept').hidden=false;$('giftCaption').textContent='Тебе подарили Эмоциональную Гавань';}
  else if(fragment.has('manage')){const [id,secret]=fragment.get('manage').split('.');setOwner({order_id:id,manage_token:secret});restoreWords(getStored('harborGiftOrder:'+id)?.words);}
  else if(query.has('order_id')){const saved=getStored('harborGiftOrder:'+query.get('order_id'));if(saved){setOwner({order_id:query.get('order_id'),manage_token:saved.manage_token});restoreWords(saved.words);}else{mode='verify';document.body.classList.add('verify-mode');$('verifyPanel').hidden=false;$('verifyPanel').querySelector('h1').textContent='Ваш подарок не потерялся';$('verifyText').textContent='Откройте письмо «Ваш подарок · Эмоциональная Гавань» на почте, указанной при оплате. В нём есть личная ссылка для оформления и вручения.';$('verifyGift').hidden=true;}}
  else{const draft=getStored('harborGiftDraft');restoreWords(draft);draftId=draft?.requestId||crypto.randomUUID();}
  for(const n of ['letter','card'])$(n+'Tab').addEventListener('click',()=>select(n));
  document.querySelector('.switch').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();select(e.key==='Home'?'letter':e.key==='End'?'card':variant==='letter'?'card':'letter');$(variant+'Tab').focus();}});
  for(const id of ['to','message','from'])$(id).addEventListener('input',update);
  $('paymentForm').addEventListener('submit',startPayment);$('claimForm').addEventListener('submit',requestClaim);$('verifyGift').addEventListener('click',confirmGift);$('copyGift').addEventListener('click',copyGift);$('retryStatus').addEventListener('click',pollPayment);$('recipientView').addEventListener('click',previewRecipient);$('returnEditor').addEventListener('click',closePreview);$('download').addEventListener('click',saveCard);
  $('accept').addEventListener('click',()=>{openDialog('claimDialog');$('claimEmail').focus();});$('closeActivation').addEventListener('click',()=>$('claimDialog').close());$('openPayment').addEventListener('click',()=>{openDialog('paymentDialog');$('buyerEmail').focus();});$('closePayment').addEventListener('click',()=>$('paymentDialog').close());for(const id of ['paymentDialog','claimDialog'])$(id).addEventListener('close',()=>{document.body.style.overflow='';});for(const id of ['buyerEmail','buyerOffer','buyerPd','claimEmail','claimOffer','claimPd']){ $(id).addEventListener('input',syncFormButtons);$(id).addEventListener('change',syncFormButtons);}syncFormButtons();
  update();if(owner)pollPayment();
}
init();
