document.addEventListener('DOMContentLoaded', () => {
 const $ = id => document.getElementById(id);
 const fields = {temperature:'Temperature', exaggeration:'Exaggeration', cfg_weight:'CFG weight', speed_factor:'Speed', seed:'Seed'};
 const ids = {temperature:'temperature',exaggeration:'exaggeration',cfg_weight:'cfg-weight',speed_factor:'speed-factor',seed:'seed'};
 async function api(url, body) {
  const r = await fetch(url, body ? {method:'POST',headers:{'Content-Type':'application/json','X-Voice-Management':'1'},body:JSON.stringify(body)} : {});
  const d = await r.json(); if (!r.ok) throw Error(typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail)); return d;
 }
 const url = v => '/api/voices/metadata?' + new URLSearchParams({kind:v.kind,filename:v.filename});
 function control(parent, label, tag='input') {
  const wrap = document.createElement('label'); wrap.textContent=label; wrap.style.display='block';
  const el=document.createElement(tag); el.className=tag==='select'?'form-select':'form-input'; wrap.append(el); parent.append(wrap); return el;
 }
 function button(parent,text,fn) {const b=document.createElement('button'); b.type='button'; b.className='btn secondary'; b.textContent=text;b.onclick=fn;parent.append(b);return b;}
 window.addEventListener('edit-voice', async ({detail:v}) => {
  let dialog;
  try {
   const result=await api(url(v)), m=result.metadata; let presets=structuredClone(m.presets||[]);
   dialog=document.createElement('dialog');dialog.style.cssText='max-width:650px;width:92%;max-height:90vh;overflow:auto;padding:24px;border-radius:12px';
   const form=document.createElement('form');dialog.append(form);
   const title=document.createElement('h2');title.textContent='Edit voice / presets';form.append(title);
   const note=document.createElement('p');note.textContent='Recording and API voice ID stay unchanged. Presets apply to browser generation; Turbo ignores exaggeration and CFG.';form.append(note);
   const name=control(form,'Voice name');name.value=m.display_name||v.name;name.required=true;name.maxLength=60;
   const recording=control(form,'Recording language','select'), language=control(form,'Default speech language','select');
   recording.add(new Option('Unknown','unknown'));language.add(new Option('Leave unchanged',''));
   for(const option of $('new-voice-default-language').options) {recording.add(new Option(option.text,option.value));language.add(new Option(option.text,option.value));}
   recording.value=m.recording_language||'unknown';language.value=m.default_language||'';
   const def=control(form,'Default preset (applied on voice selection)','select');
   const area=document.createElement('div');form.append(area);
   let defaultName=m.default_preset||'';
   function render() {
    area.replaceChildren();def.replaceChildren(new Option('None',''));presets.forEach(p=>def.add(new Option(p.name,p.name)));def.value=defaultName;
    presets.forEach((p,index)=>{
     const box=document.createElement('fieldset');area.append(box);
     const n=control(box,'Preset name');n.value=p.name;n.required=true;n.maxLength=60;
     n.onchange=()=>{if(defaultName===p.name)defaultName=n.value.trim();p.name=n.value.trim();render();};
     Object.entries(fields).forEach(([key,label])=>{const input=control(box,label);const source=$(ids[key]);input.type='number';input.required=true;input.min=source.min||'0';input.max=key==='seed'?'2147483647':source.max;input.step=source.step||'1';input.value=p[key];input.oninput=()=>p[key]=Number(input.value);});
     button(box,'Remove preset',()=>{if(defaultName===p.name)defaultName='';presets.splice(index,1);render();});
    });
   }
   def.onchange=()=>defaultName=def.value;render();
   button(form,'Add preset from current generation settings',()=>{if(presets.length>=20)return;let name='Preset '+(presets.length+1);while(presets.some(p=>p.name===name))name+=' new';const p={name};Object.keys(fields).forEach(k=>p[k]=Number($(ids[k]).value));presets.push(p);render();});
   const status=document.createElement('p');status.setAttribute('role','status');form.append(status);
   const save=document.createElement('button');save.type='submit';save.className='btn primary';save.textContent='Save voice';form.append(save);
   button(form,'Cancel',()=>dialog.close());
   form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api('/api/voices/metadata',{kind:v.kind,filename:v.filename,revision:result.revision,display_name:name.value,recording_language:recording.value,default_language:language.value,presets,default_preset:defaultName});$('predefined-voice-refresh-button').click();$('tab-voices').click();dialog.close();await loadSelected(false);}catch(err){status.textContent=err.message;}finally{save.disabled=false;}};
   dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
  }catch(err){if(dialog)dialog.remove();alert('Cannot edit voice: '+err.message);}
 });
 const group=document.createElement('div');group.className='form-group';
 const select=control(group,'Saved voice presets','select');
 const hint=document.createElement('p');hint.className='form-hint';group.append(hint);
 $('predefined-voice-options').after(group);
 let current={}, counter=0;
 function apply(p) {if(!p)return;Object.keys(fields).forEach(k=>{const el=$(ids[k]);el.value=p[k];el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});}
 select.onchange=()=>apply((current.presets||[]).find(p=>p.name===select.value));
 async function loadSelected(useDefault=true) {
  const tick=++counter;const kind=document.querySelector('input[name="voice_mode"]:checked')?.value==='clone'?'reference':'predefined';
  const filename=$(kind==='reference'?'clone-reference-select':'predefined-voice-select').value;
  current={};select.replaceChildren(new Option('No preset',''));hint.textContent='';
  if(!filename||filename==='none')return;
  try {const d=await api(url({kind,filename}));if(tick!==counter)return;current=d.metadata;
   (current.presets||[]).forEach(p=>select.add(new Option(p.name,p.name)));
   if(useDefault){
    if(current.default_language){const lang=$('language');if(![...lang.options].some(o=>o.value===current.default_language))lang.add(new Option(current.default_language,current.default_language));lang.value=current.default_language;lang.dispatchEvent(new Event('change',{bubbles:true}));}
    select.value=current.default_preset||'';apply((current.presets||[]).find(p=>p.name===select.value));
   }
   hint.textContent='Voice presets change generation controls, not your text. Non-English output needs Multilingual.';
  }catch(e){hint.textContent=e.message;}
 }
 ['predefined-voice-select','clone-reference-select'].forEach(id=>$(id).addEventListener('change',()=>loadSelected()));
 document.querySelectorAll('input[name="voice_mode"]').forEach(el=>el.addEventListener('change',()=>loadSelected()));
 const observer=new MutationObserver(()=>loadSelected());observer.observe($('predefined-voice-select'),{childList:true});observer.observe($('clone-reference-select'),{childList:true});
 loadSelected();
});
