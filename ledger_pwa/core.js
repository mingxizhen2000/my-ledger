/* Pure ledger logic: shared by the PWA and regression tests. */
(function(root){
'use strict';
const KEY='sage_ledger_pwa_v1';
const codes=['CNY','GBP','EUR','USD','JPY','HKD','KRW','SGD'];
const expense=['超市','餐饮','饮品','服饰','洗护','日用品','购物','交通','住房','医疗','旅行','学习','其他'];
const income=['工资','奖学金','兼职','退款','其他收入'];
const icons={'超市':'🛒','餐饮':'🍜','饮品':'☕','服饰':'👗','洗护':'🧴','日用品':'🧺','购物':'🛍️','交通':'🚇','住房':'🏠','医疗':'💊','旅行':'✈️','学习':'📚','其他':'📦','工资':'💼','奖学金':'🎓','兼职':'🧑‍💻','退款':'↩️','其他收入':'🌱'};
const defaults={entries:[],rates:{CNY:1,GBP:9.2,EUR:8,USD:7.2,JPY:.05,HKD:.92,KRW:.0053,SGD:5.4},categories:{expense,income}};
const positive=n=>Number.isFinite(Number(n))&&Number(n)>0;
const clone=v=>JSON.parse(JSON.stringify(v));
function localDay(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function validDay(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00');return !isNaN(d)&&localDay(d)===s;}
function migrate(raw){
 if(!raw||!Array.isArray(raw.entries)||!raw.categories||!raw.rates)throw Error('账本结构无法识别，已停止写入。请导出原始数据。');
 const db=clone(raw);db.schemaVersion=2;
 db.rates={...defaults.rates,...db.rates,CNY:1};
 for(const c of codes)if(!positive(db.rates[c]))throw Error('账本汇率无效：'+c);
 for(const t of ['expense','income']){
  if(!Array.isArray(db.categories[t])||db.categories[t].some(n=>typeof n!=='string'))throw Error('分类数据无效');
  db.categories[t]=[...new Set(db.categories[t])];
  if(raw.schemaVersion!==2)for(const n of (t==='expense'?expense:income))if(!db.categories[t].includes(n))db.categories[t].push(n);
  if(raw.schemaVersion!==2&&t==='expense')db.categories[t]=[...expense,...db.categories[t].filter(n=>!expense.includes(n))];
 }
 db.categoryMeta=db.categoryMeta||{expense:{},income:{}};
 for(const t of ['expense','income']){
  db.categoryMeta[t]=Object.fromEntries(Object.entries(db.categoryMeta[t]||{}));
  for(const n of db.categories[t])if(!Object.hasOwn(db.categoryMeta[t],n))Object.defineProperty(db.categoryMeta[t],n,{value:{icon:icons[n]||'📦',hidden:false},writable:true,enumerable:true,configurable:true});
 }
 db.displayRates=db.displayRates||clone(db.rates);
 for(const c of codes)if(!positive(db.displayRates[c]))throw Error('统计显示汇率无效');
 db.displayRates.CNY=1;db.displayRatesDate=db.displayRatesDate||localDay();
 db.statsCurrency=codes.includes(db.statsCurrency)?db.statsCurrency:'GBP';
 // Do not rewrite historic entries. Invalid data locks writes instead of discarding records.
 const ids=new Set();
 for(const e of db.entries){if(!e||!e.id||ids.has(e.id)||!['expense','income'].includes(e.type)||!positive(e.amount)||!codes.includes(e.currency)||!positive(e.rateToCNY)||!validDay(String(e.date).slice(0,10))||typeof e.category!=='string'||(e.amountCNY!=null&&!positive(e.amountCNY)))throw Error('存在无法安全读取的旧账目，已停止写入，请保留原始备份。');ids.add(e.id);}
 return db;
}
function baseAmount(e){return Number(e.amountCNY??Number(e.amount)*Number(e.rateToCNY));}
function totals(entries,currency,rates){const r=Number(rates[currency]);if(!positive(r))throw Error('显示汇率无效');let income=0,expense=0;const native={};for(const e of entries){const group=native[e.currency]||(native[e.currency]={income:0,expense:0});group[e.type]+=Number(e.amount);if(e.type==='income')income+=baseAmount(e)/r;else expense+=baseAmount(e)/r;}return {income,expense,balance:income-expense,native};}
function activeCategories(db,type,selected){return db.categories[type].filter(n=>!db.categoryMeta[type]?.[n]?.hidden||n===selected).concat(selected&&!db.categories[type].includes(selected)?[selected]:[]);}
function validateDraft(d,db){if(!d||!['expense','income'].includes(d.type)||!positive(d.amount)||Number(d.amount)>1e12||!codes.includes(d.currency)||!validDay(d.date)||typeof d.category!=='string'||!d.category.trim()||!activeCategories(db,d.type,d.category).includes(d.category)||!positive(db.rates[d.currency]))throw Error('请检查每笔账目的金额、日期、币种和分类。');return d;}
function smartDate(text,now=new Date()){
 const d=new Date(now);let warning='';
 const explicit=text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
 if(explicit){const date=`${explicit[1]}-${explicit[2].padStart(2,'0')}-${explicit[3].padStart(2,'0')}`;return {date:validDay(date)?date:'',warning:validDay(date)?'':'日期无效，请填写'};}
 if(text.includes('前天'))d.setDate(d.getDate()-2);
 else if(text.includes('昨天'))d.setDate(d.getDate()-1);
 else if(/今天|今日/.test(text)){}
 else if(/上周|上星期/.test(text)){const m=text.match(/(?:上周|上星期)([一二三四五六日天])/);if(m){const day='一二三四五六日'.indexOf(m[1]==='天'?'日':m[1])+1;d.setDate(d.getDate()-((d.getDay()+6)%7)-7+day-1);}else{d.setDate(d.getDate()-7);warning='上周未指定星期，日期为估计值';}}
 else warning='未说明日期，暂用今天';
 return {date:localDay(d),warning};
}
function parseLocal(text,db,now=new Date()){
 const results=[];const chunks=text.replace(/(\d),(?=\d{3}(?:[^\d]|$))/g,'$1').split(/[，,。；;\n]+/).map(s=>s.trim()).filter(Boolean);
 const currencyMap={'£':'GBP','镑':'GBP','磅':'GBP','英镑':'GBP','€':'EUR','欧元':'EUR','$':'USD','美元':'USD','¥':'CNY','￥':'CNY','人民币':'CNY','元':'CNY','块':'CNY','块钱':'CNY','港币':'HKD','日元':'JPY','韩元':'KRW','新加坡元':'SGD'};
 const amountRE=/(£|€|\$|¥|￥|GBP|CNY|EUR|USD|JPY|HKD|KRW|SGD)?\s*(\d+(?:\.\d+)?)\s*(英镑|人民币|美元|欧元|港币|日元|韩元|新加坡元|块钱|镑|磅|块|元|GBP|CNY|USD|EUR|HKD|JPY|KRW|SGD)?/gi;
 const rules=[['日用品',/垃圾袋|纸巾|收纳|洗洁精/],['洗护',/洗发水|护肤|化妆|沐浴|面霜/],['服饰',/衣服|外套|羽绒服|鞋|裤|衣|裙|包包/],['超市',/买菜|食材|食品|零食|超市/],['饮品',/咖啡|奶茶|饮料/],['餐饮',/吃饭|餐厅|外卖|早餐|午饭|晚饭|正餐/],['交通',/地铁|公交|打车|车票|火车|oyster/i],['住房',/房租|水电/],['医疗',/医院|看病|买药|药品|检查/],['旅行',/旅行|旅游|酒店|机票|景点/],['学习',/书籍|课程|学费|学习用品/],['购物',/买|购物|电子|配件/]];
 for(const part of chunks){
  const found=[...part.matchAll(amountRE)].filter(m=>{
   if(m[1]||m[3])return true;
   if(/^[-/年月日件个]/.test(part.slice(m.index+m[0].length)))return false;
   return /花了?|支出|收入|收到|工资|退款|买/.test(part.slice(Math.max(0,m.index-6),m.index));
  });
  let lastEnd=0;
  for(let i=0;i<found.length;i++){
   const m=found[i];const start=i===0?0:lastEnd;const end=i===found.length-1?part.length:m.index+m[0].length;
   const context=part.slice(start,end).trim();lastEnd=end;
   // Exclude calendar numbers and item counts without currency markers.
   if(!m[1]&&!m[3]&&/^[-/年月日件个]/.test(part.slice(m.index+m[0].length)))continue;
   const word=(m[3]||m[1]||'GBP').toUpperCase(),currency=currencyMap[word]||word;
   const type=/工资|收入|奖学金|收到|退款|报销|赚了|兼职到账/.test(context)?'income':'expense';
   const merch=context.match(/TikTok\s*Shop|Joybuy|SHEIN|Temu|Tesco|Lidl|ALDI|Sainsbury'?s|Oyster|淘宝|京东|拼多多|美团|星巴克/ig)?.[0]||context.match(/(?:在|从)\s*([\p{L}][\p{L}\d &'.-]{0,24}?)(?=买|花|消费|支付|付了|收到|退款)/u)?.[1]?.trim()||'';
   const available=activeCategories(db,type);
   let category=type==='income'?(['奖学金','工资','退款','兼职'].find(n=>context.includes(n))||(/报销/.test(context)?'退款':'其他收入')):rules.find(([n,re])=>re.test(context)&&available.includes(n))?.[0];
   if(!category&&/tesco|lidl|aldi|sainsbury/i.test(merch))category='超市';
   category=category&&available.includes(category)?category:available.includes(type==='expense'?'购物':'其他收入')?(type==='expense'?'购物':'其他收入'):available[0];
   const dt=smartDate(context,now);const warnings=[];if(dt.warning)warnings.push(dt.warning);if(!m[1]&&!m[3])warnings.push('未说明币种，暂用 GBP');if(m[1]==='$'||m[1]==='¥'||m[1]==='￥')warnings.push('货币符号可能有歧义，请确认');if(found.length>1)warnings.push('同一句有多个金额，请核对拆分');
   results.push({type,amount:Number(m[2]),currency:codes.includes(currency)?currency:'GBP',category,date:dt.date,merchant:merch,note:context,warnings,reviewed:false});
  }
 }
 return results.slice(0,50);
}
function validateAI(payload,db){if(!payload||!Array.isArray(payload.entries)||payload.entries.length>50||!payload.entries.length)throw Error('AI 返回的账目结构无效');return payload.entries.map(e=>{
 if(!e||typeof e!=='object'||(e.amount!==null&&typeof e.amount!=='number'))throw Error('AI 金额格式无效');
 const warnings=['AI 结果请逐项核对'];const d={type:['income','expense'].includes(e.type)?e.type:'expense',amount:e.amount,currency:codes.includes(e.currency)?e.currency:'GBP',date:validDay(e.date)?e.date:localDay(),category:typeof e.category==='string'?e.category:'',merchant:typeof e.merchant==='string'?e.merchant.slice(0,100):'',note:typeof e.note==='string'?e.note.slice(0,1000):'',warnings,reviewed:false};
 if(!positive(e.amount))warnings.push('金额不确定，请填写');if(!codes.includes(e.currency))warnings.push('币种不确定，暂用 GBP');if(!validDay(e.date))warnings.push('日期不确定，暂用今天');if(!['income','expense'].includes(e.type))warnings.push('收支类型不确定');
 if(!activeCategories(db,d.type).includes(d.category)){d.category=activeCategories(db,d.type)[0];warnings.push('分类不确定，请选择');}
 if(Array.isArray(e.uncertain))warnings.push(...e.uncertain.filter(v=>typeof v==='string').slice(0,8).map(v=>v.slice(0,100)));
 return d;
});}
const api={KEY,codes,expense,income,icons,defaults,clone,positive,localDay,validDay,migrate,baseAmount,totals,activeCategories,validateDraft,smartDate,parseLocal,validateAI};
if(typeof module!=='undefined')module.exports=api;else root.Ledger=api;
})(typeof window==='undefined'?globalThis:window);
