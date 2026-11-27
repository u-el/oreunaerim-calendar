const el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;};
export function renderClubs(data,templates,state,redraw,create){
 if(state.creating)return renderCreate(templates,state,redraw,create);
 const root=el('section','moily-clubs-view');root.append(el('h2','moily-heading','내 동호회'));
 const filters=el('div','clubs-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','동호회 필터');
 for(const [key,label] of [['all','전체'],['favorite','즐겨찾기'],['archived','보관함']]){const b=el('button','moily-button',label);b.type='button';b.setAttribute('aria-pressed',String((state.filter||'all')===key));b.onclick=()=>{state.filter=key;redraw();};filters.append(b);}root.append(filters);
 if(data.errors?.clubs||!Array.isArray(data.clubs)){root.append(el('p','moily-caption',data.errors?.clubs?'동호회 조회 실패. 새로고침해 주세요.':'동호회 확인 중…'));return root;}
 const filter=state.filter||'all',clubs=data.clubs.filter(c=>!c.deletedAt&&(filter==='archived'?c.status==='archived':c.status==='active'&&(filter!=='favorite'||c.isFavorite))).sort((a,b)=>Number(!!b.isPrimary)-Number(!!a.isPrimary)||(a.sortOrder??0)-(b.sortOrder??0)||a.id.localeCompare(b.id));
 const count=(key,predicate)=>data.errors?.[key]||!Array.isArray(data[key])?'—':data[key].filter(x=>!x.deletedAt&&predicate(x)).length;
 if(!clubs.length)root.append(el('p','moily-panel',filter==='archived'?'보관한 동호회가 없어요.':filter==='favorite'?'즐겨찾기한 동호회가 없어요.':'아직 등록한 동호회가 없어요.'));
 for(const c of clubs){const primary=c.isPrimary&&filter!=='archived',card=el('article','moily-panel clubs-card'+(primary?' clubs-primary':''));const type=Object.hasOwn(templates,c.category)?templates[c.category].label:'기타';card.append(el('p','moily-caption',type+(primary?' · 대표 동호회':'')+(c.isFavorite?' · 즐겨찾기':'')),el('h3','moily-card-title',c.name));const planned=count('schedules',s=>s.clubId===c.id&&s.status==='planned');card.append(el('p',primary?'':'moily-caption','예정 '+planned+(primary?' · 활동 '+count('activities',s=>s.clubId===c.id)+' · 목표 '+count('goals',s=>s.clubId===c.id):'')));root.append(card);}
 const ids=new Set(clubs.map(c=>c.id)),upcoming=(data.errors?.schedules?[]:data.schedules||[]).filter(s=>!s.deletedAt&&s.status==='planned'&&ids.has(s.clubId)&&typeof s.startDate==='string'&&s.startDate>=new Date().toLocaleDateString('sv-SE')).sort((a,b)=>a.startDate.localeCompare(b.startDate))[0];
 if(upcoming&&filter!=='archived'){const card=el('article','moily-panel');card.append(el('p','moily-caption',upcoming.startDate),el('h3','moily-card-title',upcoming.title),el('p','moily-caption',clubs.find(c=>c.id===upcoming.clubId)?.name||''),el('p','moily-caption','예정'));root.append(card);}
 const add=el('button','moily-button','동호회 추가');add.onclick=()=>{state.creating=true;redraw();};root.append(add);return root;
}

function renderCreate(templates,state,redraw,create){
 const root=el('section','moily-clubs-view'),form=el('form','clubs-create'),fields=el('fieldset','clubs-create-fields');
 const draft=state.draft??={id:crypto.randomUUID(),category:'hiking',name:'',description:'',color:templates.hiking.color,icon:templates.hiking.icon,activities:templates.hiking.activities.join(', ')};
 const back=el('button','moily-button','목록으로');back.type='button';back.disabled=!!state.busy;back.onclick=()=>{state.creating=false;state.draft=null;state.error='';redraw();};
 root.append(el('h2','moily-heading','새 동호회'),back);
 const hero=el('div','moily-panel clubs-primary');hero.append(el('h3','moily-card-title','우리의 첫 모임.'),el('p','','관심 활동을 선택하세요.'));root.append(hero);
 const panel=el('div','moily-panel'),choices=el('div','clubs-filters');panel.append(el('h3','moily-card-title','활동 템플릿'),choices);
 for(const [key,t] of Object.entries(templates)){const b=el('button','moily-button',t.label);b.type='button';b.setAttribute('aria-pressed',String(draft.category===key));b.onclick=()=>{Object.assign(draft,{category:key,color:t.color,icon:t.icon,activities:t.activities.join(', ')});redraw();};choices.append(b);}fields.append(panel);
 const identity=el('div','moily-panel');
 function field(parent,label,key,tag='input',type='text'){const l=el('label','clubs-field'),n=el(tag,'moily-input');l.append(el('span','moily-caption',label),n);if(tag==='input')n.type=type;n.value=draft[key];n.oninput=()=>{draft[key]=n.value;};parent.append(l);return n;}
 const name=field(identity,'동호회 이름 (필수)','name');name.required=true;name.maxLength=60;name.placeholder='우리 모임 이름';
 const desc=field(identity,'소개','description','textarea');desc.maxLength=300;desc.placeholder='함께하는 활동을 소개해 주세요';
 const color=field(identity,'대표 컬러','color','input','color');color.className='clubs-color';fields.append(identity);
 const detail=el('div','moily-panel');detail.append(el('h3','moily-card-title','활동 유형 및 아이콘 설정'));
 const types=field(detail,'활동 유형 (쉼표로 구분)','activities','textarea');types.required=true;
 const label=el('label','clubs-field'),icons=el('select','moily-input');label.append(el('span','moily-caption','아이콘'),icons);for(const t of Object.values(templates)){const o=el('option','',t.label);o.value=t.icon;icons.append(o);}icons.value=draft.icon;icons.onchange=()=>{draft.icon=icons.value;};detail.append(label);fields.append(detail);
 const submit=el('button','moily-button',state.busy?'저장 중…':'동호회 만들기');submit.type='submit';fields.append(submit);fields.disabled=!!state.busy;form.append(fields);
 const msg=el('p','moily-caption',state.error||'');msg.setAttribute('role','status');form.append(msg);
 form.onsubmit=async e=>{e.preventDefault();if(state.busy)return;const activities=draft.activities.split(',').map(x=>x.trim()).filter(Boolean);if(!draft.name.trim()||!activities.length||activities.length>20||activities.some(x=>x.length>40)||new Set(activities).size!==activities.length){msg.textContent='이름과 활동 유형을 확인해 주세요. 활동 유형은 중복 없이 1~20개, 각 40자 이하입니다.';return;}state.busy=true;state.error='';redraw();try{await create({...draft,activities});state.creating=false;state.draft=null;state.filter='all';}catch{state.error='저장하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';}finally{state.busy=false;redraw();}};
 root.append(form);return root;
}
