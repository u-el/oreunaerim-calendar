const el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;};
export function renderClubs(data,templates,state,redraw){
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
 const add=el('button','moily-button','동호회 추가');add.disabled=true;root.append(add,el('p','moily-caption','동호회 추가는 다음 개발 단계에서 연결됩니다.'));return root;
}
