'use strict';
const L=Ledger,$=id=>document.getElementById(id),codes=L.codes;
const names={CNY:'人民币',GBP:'英镑',EUR:'欧元',USD:'美元',JPY:'日元',HKD:'港币',KRW:'韩元',SGD:'新加坡元'};
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>L.localDay(),dateKey=s=>String(s||'').slice(0,10);
const money=(n,c='CNY')=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:c,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
let db,storageLocked=false,categoryType='expense',editingCategory=null,smartDrafts=[],aiBusy=false,smartRevision=0;
let rawAtLoad=null,lastSaved=null;
try{
 rawAtLoad=localStorage.getItem(L.KEY);lastSaved=rawAtLoad;
 db=L.migrate(rawAtLoad===null?L.clone(L.defaults):JSON.parse(rawAtLoad));
 // A byte-for-byte local safety copy, created before the first v2 write.
 if(rawAtLoad!==null&&!localStorage.getItem(L.KEY+'_before_v2'))localStorage.setItem(L.KEY+'_before_v2',rawAtLoad);
}catch(e){storageLocked=true;db=L.migrate(L.clone(L.defaults));$('storageNotice').classList.remove('hide');$('storageNotice').textContent='账本读取或保护备份失败，已停止写入：'+e.message;const b=document.createElement('button');b.className='btn alt';b.textContent='导出原始存储';b.onclick=()=>download('原始账本-'+today()+'.txt',rawAtLoad??'无法读取，请不要清除网站数据','text/plain');$('storageNotice').appendChild(b);}
function commit(next){
 if(storageLocked){alert('账本处于保护模式，请先导出原始数据。');return false;}
 try{
  if(localStorage.getItem(L.KEY)!==lastSaved)throw Error('另一页面已更新账本，请先关闭其他页面并重新打开本页');
  const serialized=JSON.stringify(next);localStorage.setItem(L.KEY,serialized);lastSaved=serialized;db=next;return true;
 }catch(e){alert('保存失败：'+e.message+'。本次操作未生效，请导出备份。');return false;}
}
function mutate(fn){const next=L.clone(db);fn(next);return commit(next);}
function categoryIcon(t,n){return db.categoryMeta[t]?.[n]?.icon||L.icons[n]||'📦';}
function optionCodes(selected){return codes.map(c=>`<option value="${c}" ${selected===c?'selected':''}>${c} · ${names[c]}</option>`).join('');}
function tab(name){for(const n of ['home','stats','rates','settings','smart'])$(n).classList.toggle('hide',n!==name);for(const n of ['home','stats','rates','settings'])$('tab-'+n).classList.toggle('active',n===name);$('title').textContent=({home:'记账',stats:'统计',rates:'汇率',settings:'设置',smart:'智能记账'})[name];render();}
function render(){renderHome();renderStats();renderRates();renderSettings();}
function renderHome(){
 const t=L.totals(db.entries,'CNY',db.displayRates);$('incomeAll').textContent=money(t.income);$('expenseAll').textContent=money(t.expense);$('balanceAll').textContent=money(t.balance);
 const list=$('entryList');list.replaceChildren();
 if(!db.entries.length){list.innerHTML='<p class="muted">从今天的一笔开始 🌿<br>点击「记一笔」，慢慢记录自己的生活。</p>';return;}
 for(const e of [...db.entries].sort((a,b)=>String(b.date).localeCompare(String(a.date)))){
  const b=document.createElement('button');b.className='line entry-button';b.onclick=()=>openEditor(e.id);
  b.innerHTML=`<div><strong>${escapeHTML(categoryIcon(e.type,e.category))} ${escapeHTML(e.category)}</strong><div class="small">${escapeHTML(dateKey(e.date))}${e.merchant?' · '+escapeHTML(e.merchant):''}${e.note?' · '+escapeHTML(e.note):''}</div></div><div class="right"><strong>${e.type==='expense'?'−':'+'}${money(e.amount,e.currency)}</strong><div class="small">≈ ${money(L.baseAmount(e))}</div></div>`;list.appendChild(b);
 }
}
function categoryPicker(root,type,selected,onpick){
 root.replaceChildren();for(const n of L.activeCategories(db,type,selected)){
  const b=document.createElement('button');b.type='button';b.className='cat-choice';b.setAttribute('aria-pressed',String(n===selected));b.innerHTML=`<span>${escapeHTML(categoryIcon(type,n))}</span>${escapeHTML(n)}`;b.onclick=()=>onpick(n);root.appendChild(b);
 }
}
function updateCategorySelect(selected){const t=$('type').value;const value=selected||L.activeCategories(db,t)[0];$('category').value=value;categoryPicker($('categoryPicker'),t,value,n=>updateCategorySelect(n));}
function editorRate(){const old=db.entries.find(e=>e.id===$('editId').value);const c=$('currency').value;if(old?.currency===c)return Number(old.rateToCNY);return Number(db.rates[c]);}
function updateConverted(){const a=Number($('amount').value)||0;const old=db.entries.find(e=>e.id===$('editId').value);const unchanged=old&&old.currency===$('currency').value&&Number(old.amount)===a;$('converted').textContent='约 '+money(unchanged?L.baseAmount(old):a*editorRate())+(old&&old.currency===$('currency').value?' · 保留原记账汇率':' · 使用当前记账汇率');}
function openEditor(id){
 const e=db.entries.find(x=>x.id===id);$('editId').value=e?.id||'';$('editorTitle').textContent=e?'编辑账目':'记一笔';$('type').value=e?.type||'expense';$('currency').innerHTML=optionCodes(e?.currency||'GBP');$('amount').value=e?.amount??'';$('date').value=dateKey(e?.date)||today();$('note').value=e?.note||'';$('merchant').value=e?.merchant||'';
 $('merchants').innerHTML=[...new Set(db.entries.map(x=>x.merchant).filter(Boolean))].sort().map(m=>`<option value="${escapeHTML(m)}"></option>`).join('');updateCategorySelect(e?.category);updateConverted();$('deleteBtn').style.display=e?'inline-block':'none';$('editor').showModal();
}
function saveEntry(ev){
 ev.preventDefault();const id=$('editId').value,old=db.entries.find(x=>x.id===id);
 const e={...old,id:old?.id||crypto.randomUUID(),type:$('type').value,amount:Number($('amount').value),currency:$('currency').value,category:$('category').value,date:$('date').value,note:$('note').value,merchant:$('merchant').value.trim(),rateToCNY:editorRate()};
 try{L.validateDraft(e,db);}catch(err){alert(err.message);return;}
 e.amountCNY=old&&old.currency===e.currency&&Number(old.amount)===e.amount?L.baseAmount(old):e.amount*e.rateToCNY;
 if(mutate(next=>{const i=next.entries.findIndex(x=>x.id===id);if(i>=0)next.entries[i]=e;else next.entries.push(e);})){ $('editor').close();render(); }
}
function deleteEntry(){const id=$('editId').value;if(confirm('确定删除这笔账目？')&&mutate(next=>{next.entries=next.entries.filter(e=>e.id!==id);})){ $('editor').close();render(); }}
function setStatCurrency(c){if(codes.includes(c)&&mutate(n=>{n.statsCurrency=c;}))renderStats();}
function refreshDisplayRates(){if(!confirm('将按当前汇率重新估值所有统计合计。历史账目中的人民币金额和原币金额不会改变。继续吗？'))return;if(mutate(n=>{n.displayRates=L.clone(n.rates);n.displayRatesDate=today();}))renderStats();}
function renderStats(){
 const start=$('start').value,end=$('end').value;if(!start||!end)return;
 const c=db.statsCurrency,rates=db.displayRates,list=start<=end?db.entries.filter(e=>dateKey(e.date)>=start&&dateKey(e.date)<=end):[],t=L.totals(list,c,rates);
 $('statCurrency').innerHTML=optionCodes(c);$('statIncome').textContent=money(t.income,c);$('statExpense').textContent=money(t.expense,c);$('statBalance').textContent=money(t.balance,c);$('statCount').textContent=start>end?'开始日期不能晚于结束日期':`共 ${list.length} 笔账目`;
 $('statRateNote').textContent=`先采用每笔保存的人民币金额，再按显示汇率快照折算：1 ${c} = ${Number(rates[c]).toFixed(6)} CNY（快照 ${db.displayRatesDate}）。这不是交易日的 ${c} 金额；更新汇率页不会自动改变此合计。`;
 $('nativeTotals').innerHTML=Object.keys(t.native).length?'<div class="native-row small"><span>原始货币</span><span>收入</span><span>支出</span></div>'+Object.entries(t.native).map(([cc,v])=>`<div class="native-row"><span>${cc}</span><strong class="green">${money(v.income,cc)}</strong><strong>${money(v.expense,cc)}</strong></div>`).join(''):'<p class="muted">当前范围没有账目。</p>';
 const monthData=[],anchor=new Date(end+'T12:00:00');for(let i=5;i>=0;i--){const d=new Date(anchor.getFullYear(),anchor.getMonth()-i,1),k=L.localDay(d).slice(0,7),m=list.filter(x=>dateKey(x.date).startsWith(k)),mt=L.totals(m,c,rates);monthData.push({label:(d.getMonth()+1)+'月',inc:mt.income,exp:mt.expense});}
 $('trendLegend').textContent=`绿色：收入　橙色：支出（${c}，仅含所选范围）`;
 const max=Math.max(1,...monthData.flatMap(x=>[x.inc,x.exp]));$('monthChart').innerHTML=monthData.map(m=>`<div class="monthcol"><div class="pair"><i class="inc" style="height:${m.inc/max*145}px" title="收入 ${money(m.inc,c)}"></i><i class="exp" style="height:${m.exp/max*145}px" title="支出 ${money(m.exp,c)}"></i></div><span>${m.label}</span></div>`).join('');
 const groups=new Map();for(const x of list.filter(e=>e.type==='expense'))groups.set(x.category,(groups.get(x.category)||0)+L.baseAmount(x)/rates[c]);const sorted=[...groups].sort((a,b)=>b[1]-a[1]),total=t.expense;
 $('categoryChart').innerHTML=sorted.length?sorted.map(([n,v],i)=>`<div style="margin:14px 0"><div class="line" style="padding:4px 0"><span>${i+1}. ${escapeHTML(categoryIcon('expense',n))} ${escapeHTML(n)}</span><strong>${money(v,c)}</strong></div><div class="bar"><span style="width:${v/total*100}%"></span></div><div class="small right">${(v/total*100).toFixed(1)}%</div></div>`).join(''):'<p class="muted">当前时间范围内暂无支出</p>';
}
function renderRates(){ $('rateList').innerHTML=codes.map(c=>`<div class="line"><div><strong>${names[c]}</strong><div class="small">${c}</div></div><div style="width:145px"><input aria-label="${c} 汇率" type="number" inputmode="decimal" step="any" min="0.000001" ${c==='CNY'?'disabled':''} value="${Number(db.rates[c])}" onchange="setRate('${c}',this.value)"></div></div>`).join(''); }
function setRate(c,v){if(c==='CNY')return;if(!L.positive(v)){alert('汇率必须大于零');renderRates();return;}if(mutate(n=>{n.rates[c]=Number(v);}))renderRates();}
async function updateRates(){try{const r=await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('网络请求失败');const j=await r.json();if(codes.some(c=>!L.positive(j.cny?.[c.toLowerCase()])))throw Error('汇率数据不完整');if(mutate(n=>{for(const c of codes)n.rates[c]=c==='CNY'?1:1/Number(j.cny[c.toLowerCase()]);n.ratesDate=j.date||today();})){renderRates();alert('汇率已更新，日期：'+j.date+'。历史账目和统计显示快照保持原值。');}}catch(e){alert('更新失败：'+e.message+'。可以继续手动设置。');}}
function renderSettings(){
 const root=$('categoryList');root.replaceChildren();db.categories[categoryType].forEach((n,i)=>{
  const row=document.createElement('div');row.className='cat-row';const label=document.createElement('div');label.className='name';label.textContent=`${categoryIcon(categoryType,n)} ${n}${db.categoryMeta[categoryType]?.[n]?.hidden?' · 已隐藏':''}`;row.appendChild(label);
  const tools=document.createElement('div');tools.className='cat-tools';
  for(const [text,title,fn,disabled] of [['↑','上移',()=>moveCategory(i,-1),i===0],['↓','下移',()=>moveCategory(i,1),i===db.categories[categoryType].length-1],['编辑','编辑分类',()=>openCategory(n),false],[db.categoryMeta[categoryType]?.[n]?.hidden?'显示':'隐藏','切换显示',()=>toggleCategory(n),false],['删除','删除分类',()=>removeCategory(n),false]]){const b=document.createElement('button');b.textContent=text;b.setAttribute('aria-label',title+' '+n);b.onclick=fn;b.disabled=disabled;tools.appendChild(b);}row.appendChild(tools);root.appendChild(row);
 });
}
function openCategory(n){editingCategory=n??null;$('catName').value=n||'';$('catIcon').value=n?categoryIcon(categoryType,n):'📦';$('categoryEditor').showModal();}
function saveCategory(ev){ev.preventDefault();const name=$('catName').value.trim(),icon=$('catIcon').value.trim();if(!name||!icon)return;if(db.categories[categoryType].includes(name)&&name!==editingCategory){alert('已有同名分类');return;}if(mutate(n=>{const t=categoryType;if(editingCategory===null)n.categories[t].push(name);else n.categories[t][n.categories[t].indexOf(editingCategory)]=name;Object.defineProperty(n.categoryMeta[t],name,{value:{...(n.categoryMeta[t][editingCategory]||{}),icon,hidden:false},enumerable:true,configurable:true,writable:true});})){ $('categoryEditor').close();renderSettings(); }}
function toggleCategory(name){const meta=db.categoryMeta[categoryType][name];if(!meta.hidden&&L.activeCategories(db,categoryType).length<=1){alert('至少保留一个可用分类');return;}if(mutate(n=>{n.categoryMeta[categoryType][name].hidden=!meta.hidden;}))renderSettings();}
function removeCategory(name){if(L.activeCategories(db,categoryType).length<=1&&!db.categoryMeta[categoryType][name].hidden){alert('至少保留一个可用分类');return;}if(!confirm('删除分类「'+name+'」？历史账目保留原名称和图标。'))return;if(mutate(n=>{n.categories[categoryType]=n.categories[categoryType].filter(x=>x!==name);n.categoryMeta[categoryType][name].hidden=true;}))renderSettings();}
function moveCategory(i,delta){if(mutate(n=>{const a=n.categories[categoryType];[a[i],a[i+delta]]=[a[i+delta],a[i]];}))renderSettings();}
function download(name,content,mime){const url=URL.createObjectURL(new Blob([content],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function exportJSON(){if(storageLocked){download('原始账本-'+today()+'.txt',rawAtLoad??'无法读取','text/plain');return;}download('记账备份-'+today()+'.json',JSON.stringify({...db,version:2,createdAt:new Date().toISOString(),expenseCategories:db.categories.expense,incomeCategories:db.categories.income},null,2),'application/json');}
function exportCSV(){const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[['类型','金额','货币','人民币汇率','人民币金额','分类','日期','商家 / 平台','备注'],...db.entries.map(e=>[e.type,e.amount,e.currency,e.rateToCNY,L.baseAmount(e),e.category,dateKey(e.date),e.merchant,e.note])];download('记账明细-'+today()+'.csv','\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');}
function parseImported(data){
 if(!data||!Array.isArray(data.entries))throw Error('没有找到 entries 账目数组');
 const next=L.clone(db);next.entries=data.entries.map(e=>{
  const type=String(e.type).toLowerCase().includes('income')?'income':'expense',amount=Number(e.amount),currency=String(e.currency||'CNY').toUpperCase();
  const rate=Number(e.rateToCNY??e.exchangeRate??(L.positive(e.amountCNY)&&L.positive(amount)?Number(e.amountCNY)/amount:undefined)??data.rates?.[currency]??db.rates[currency]);
  if(!L.positive(amount)||!L.positive(rate)||!codes.includes(currency)||!L.validDay(dateKey(e.date)))throw Error('有账目金额、日期、币种或汇率不合法');
  return {...e,id:String(e.id||crypto.randomUUID()),type,amount,currency,rateToCNY:rate,amountCNY:e.amountCNY==null?amount*rate:Number(e.amountCNY),category:String(e.category||'其他'),date:dateKey(e.date),merchant:String(e.merchant||''),note:String(e.note||'')};
 });
 if(data.rates)for(const c of codes)if(L.positive(data.rates[c]))next.rates[c]=Number(data.rates[c]);
 for(const t of ['expense','income']){
  let arr=Array.isArray(data.categories)?data.categories.filter(c=>String(c.type).toLowerCase().includes(t)):data.categories?.[t]||data[t+'Categories'];
  if(arr!==undefined){if(!Array.isArray(arr))throw Error('分类数据格式错误');arr=arr.map(x=>typeof x==='string'?x:x?.name);if(arr.some(x=>typeof x!=='string'||!x.trim()))throw Error('分类名称无效');next.categories[t]=arr;}
 }
 next.categoryMeta=data.categoryMeta||{expense:{},income:{}};
 next.displayRates=data.displayRates||L.clone(next.rates);next.displayRatesDate=data.displayRatesDate||today();next.statsCurrency=data.statsCurrency||db.statsCurrency;
 return L.migrate(next);
}
async function importJSON(ev){const f=ev.target.files?.[0];if(!f)return;try{if(f.size>25*1024*1024)throw Error('文件超过 25MB');const next=parseImported(JSON.parse(await f.text()));if(!confirm(`将用导入的 ${next.entries.length} 笔账目替换当前 ${db.entries.length} 笔。请先导出 JSON 备份。继续吗？`))return;if(commit(next)){render();alert('导入完成');}}catch(e){alert('导入失败：'+e.message+'。原有数据未更改。');}finally{ev.target.value='';}}
function showSmart(){tab('smart');renderDrafts();}
function parseSmart(){smartRevision++;smartDrafts=L.parseLocal($('smartText').value,db);$('smartStatus').textContent=smartDrafts.length?`离线识别出 ${smartDrafts.length} 笔，请核对；复杂表达可能遗漏或拆分不准。`:'未识别出账目，请写明金额和货币。';renderDrafts();}
function smartChange(i,key,value){const d=smartDrafts[i];if(!d)return;smartRevision++;if(key==='reviewed')d.reviewed=value;else{d[key]=key==='amount'?Number(value):value;d.reviewed=false;if(key==='type')d.category=L.activeCategories(db,value)[0];}if(key==='type')renderDrafts();else{const ck=$('review'+i);if(ck)ck.checked=d.reviewed;}}
function smartRemove(i){smartRevision++;smartDrafts.splice(i,1);renderDrafts();}
function renderDrafts(){
 const root=$('smartResults');root.innerHTML=smartDrafts.map((d,i)=>`<div class="card"><div class="draft-head"><h2>第 ${i+1} 笔</h2><button class="link" onclick="smartRemove(${i})">移除草稿</button></div>${d.warnings.length?'<p class="warning">'+d.warnings.map(escapeHTML).join('；')+'</p>':''}<div class="grid2"><div><label>类型</label><select aria-label="第${i+1}笔类型" onchange="smartChange(${i},'type',this.value)"><option value="expense" ${d.type==='expense'?'selected':''}>支出</option><option value="income" ${d.type==='income'?'selected':''}>收入</option></select></div><div><label>货币</label><select aria-label="第${i+1}笔货币" onchange="smartChange(${i},'currency',this.value)">${optionCodes(d.currency)}</select></div></div><label>金额</label><input aria-label="第${i+1}笔金额" type="number" inputmode="decimal" step="any" min="0.01" value="${escapeHTML(d.amount)}" oninput="smartChange(${i},'amount',this.value)"><label>分类</label><div class="category-picker" id="draftCategory${i}"></div><label>日期</label><input aria-label="第${i+1}笔日期" type="date" value="${escapeHTML(d.date)}" onchange="smartChange(${i},'date',this.value)"><label>商家 / 平台</label><input aria-label="第${i+1}笔商家" value="${escapeHTML(d.merchant)}" maxlength="100" oninput="smartChange(${i},'merchant',this.value)"><label>备注</label><input aria-label="第${i+1}笔备注" value="${escapeHTML(d.note)}" oninput="smartChange(${i},'note',this.value)"><label class="check"><input id="review${i}" type="checkbox" ${d.reviewed?'checked':''} onchange="smartChange(${i},'reviewed',this.checked)">我已核对这笔账目的金额、币种和日期</label></div>`).join('')+(smartDrafts.length?`<button class="btn full" onclick="saveSmart()">确认保存全部 ${smartDrafts.length} 笔</button>`:'');
 smartDrafts.forEach((d,i)=>categoryPicker($('draftCategory'+i),d.type,d.category,n=>{smartChange(i,'category',n);renderDrafts();}));
}
function saveSmart(){
 if(!smartDrafts.length)return;try{smartDrafts.forEach(d=>{L.validateDraft(d,db);if(d.warnings.length&&!d.reviewed)throw Error('请先核对带提示的草稿，并勾选确认。');});}catch(e){alert(e.message);return;}
 const count=smartDrafts.length;if(!confirm('确认将这 '+count+' 笔草稿保存到账本？'))return;
 if(mutate(n=>{for(const d of smartDrafts){const {warnings,reviewed,...fields}=d;const rate=Number(n.rates[d.currency]);n.entries.push({...fields,id:crypto.randomUUID(),rateToCNY:rate,amountCNY:d.amount*rate});}})){smartRevision++;smartDrafts=[];renderDrafts();$('smartText').value='';tab('home');alert('已保存 '+count+' 笔账目');}
}
function saveAIConfig(){const url=$('aiURL').value.trim();try{if(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error();}localStorage.setItem('sage_ledger_ai_url',url);alert('代理地址已保存。访问口令仅用于本次打开，不写入备份。');}catch{alert('请填写不带参数的 HTTPS 代理地址。');}}
async function parseWithAI(){
 if(aiBusy)return;const text=$('smartText').value.trim(),url=$('aiURL').value.trim(),token=$('aiToken').value.trim();
 if(!text||text.length>4000){alert('请输入 1–4000 字的消费文字。');return;}if(!url||!token){alert('请先在设置中配置安全代理地址和个人访问口令，也可直接使用离线识别。');return;}
 try{if(new URL(url).protocol!=='https:')throw Error();}catch{alert('代理地址必须为 HTTPS。');return;}
 if(!confirm('将把输入框中的消费文字发送给你配置的代理和智谱 AI。不会上传历史账本。继续吗？'))return;
 aiBusy=true;$('aiButton').disabled=true;$('smartStatus').textContent='AI 正在识别…';const revision=++smartRevision;
 try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({text,today:today()}),signal:AbortSignal.timeout(35000)});if(!response.ok)throw Error(response.status===429?'达到请求限额':response.status===401||response.status===403?'访问口令或来源验证失败':'代理暂时不可用');const payload=await response.json();if(revision!==smartRevision||$('smartText').value.trim()!==text){$('smartStatus').textContent='输入或草稿已更新，已忽略较早的 AI 结果。';return;}smartDrafts=L.validateAI(payload,db);renderDrafts();$('smartStatus').textContent=`AI 识别出 ${smartDrafts.length} 笔，请逐项核对。`;}
 catch(e){$('smartStatus').textContent='AI 识别失败：'+e.message+'。可点击「离线识别」继续，现有草稿已保留。';}
 finally{aiBusy=false;$('aiButton').disabled=false;}
}
(function init(){const now=new Date();$('end').value=today();$('start').value=L.localDay(new Date(now.getFullYear(),now.getMonth(),1));try{$('aiURL').value=localStorage.getItem('sage_ledger_ai_url')||'';}catch{}render();if('serviceWorker'in navigator){if(navigator.onLine)navigator.serviceWorker.register('./sw.js').then(reg=>{reg.update().catch(()=>{});}).catch(()=>{});navigator.serviceWorker.addEventListener('controllerchange',()=>{const notice=$('storageNotice');if(!storageLocked){notice.classList.remove('hide');notice.textContent='新版离线资源已就绪。完成当前编辑后重新打开 App，即可使用最新版本。';}});}})();
