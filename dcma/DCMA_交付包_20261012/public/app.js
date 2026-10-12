const $ = (s) => document.querySelector(s);
const state = { source: 'real_data_01', latest: null, history: [], alarms: [], timer: null, chartNow: Date.now(), fault: {page:1,pageSize:10,code:'ALL',from:'',to:'',data:null,editingId:null} };
const labels = {speedActual:['实际转速','rpm'], current:['电机电流','A'], torqueActual:['实际转矩','Nm'], dcVoltage:['直流母线电压','V'], motorTemp:['电机温度','°C'], inverterTemp:['变频器温度','°C'], actualPower:['实际功率','kW'], inverterLoadRate:['变频器负载率','%']};
const trendSeries = [
  {key:'speedSetpoint', name:'速度给定值', unit:'rpm', color:'#f36f31', min:0, max:1, step:.2, scale:1000},
  {key:'speedActual', name:'速度实际值', unit:'rpm', color:'#e8e500', min:0, max:1, step:.2, scale:1000},
  {key:'torqueSetpoint', name:'转矩给定值', unit:'Nm', color:'#00ad00', min:0, max:1, step:.2},
  {key:'torqueActual', name:'转矩实际值', unit:'Nm', color:'#0b74e0', min:0, max:1, step:.2},
  {key:'current', name:'实际电流', unit:'A', color:'#5ca8a7', min:0, max:1, step:.2},
  {key:'actualPower', name:'实际功率', unit:'kW', color:'#c4a21b', min:0, max:1, step:.2},
  {key:'dcVoltage', name:'直流母线电压', unit:'V', color:'#ed080b', min:0, max:600, step:100},
  {key:'status', name:'变频器状态', unit:'', color:'#e100d5', min:0, max:50, step:10}
];
const fmt = (v, digits=1) => Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '--';
const escapeHtml = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const mappingTabs=['数据记录','逆变器数据','ALM数据','SLM数据','BLM数据'];
const mappingLabelOverrides={1:'记录日期',2:'正向速度最大值',3:'正向速度最小值',4:'反向速度最大值',5:'反向速度最小值',6:'速度平均值',7:'速度设定值',8:'速度实际值',9:'速度偏差',10:'电流最大值',11:'电流最小值',12:'电流平均值',13:'电流实际值',14:'电流设定值',15:'电流有效值',16:'电机电压',17:'电机功率',18:'制动转矩最大值',19:'制动转矩平均值',20:'制动转矩最小值',21:'输出转矩最大值',22:'输出转矩平均值',23:'输出转矩最小值',24:'转矩设定值',25:'转矩实际值',26:'直流母线电压最大值',27:'直流母线电压最小值',28:'直流母线电压平均值',29:'直流母线电压',30:'输入电压',31:'输出电压',32:'电机温度平均值',33:'电机温度最小值',34:'电机温度',35:'电机温度最大值',36:'变频器温度平均值',37:'变频器温度最小值',38:'变频器温度最大值',39:'变频器温度',40:'环境温度',41:'散热器温度',42:'功率模块温度',43:'电机运行状态',44:'变频器运行状态',45:'设备状态字',46:'控制字',47:'运行模式',48:'运行方向',49:'启动次数',50:'停止次数',51:'故障次数',52:'报警次数',53:'累计运行时间',54:'累计停机时间',55:'变频器综合健康度',56:'电机综合健康度',57:'负载率最大值',58:'负载率平均值',59:'变频器负荷率',60:'电机负荷率',61:'有功功率最大值',62:'有功功率平均值',63:'无功功率',64:'视在功率',65:'功率因数',66:'频率最大值',67:'频率最小值',68:'输出频率',69:'累积总的电动能量',70:'累积总的回馈能量',71:'当日电动能量',72:'当日回馈能量',73:'总耗电量',74:'总发电量',75:'脉冲频率',76:'励磁电流',77:'转矩电流',78:'电机电流有效值',79:'直流电流',80:'通信状态',81:'数据更新时间',82:'数据质量状态',83:'电流超限次数',84:'温度超限次数'};
const configState={tab:'数据记录',parameters:Object.fromEntries(mappingTabs.map(tab=>[tab,Array.from({length:84},(_,index)=>({id:index+1,label:mappingLabelOverrides[index+1]||`数据项 ${String(index+1).padStart(2,'0')}`,paramName:'',checked:false}))]))};
const timeText = (v) => { if (!v) return '--'; const d = new Date(String(v).replace(' ','T')); return Number.isNaN(d.getTime()) ? String(v).slice(-8) : d.toLocaleTimeString('zh-CN',{hour12:false}); };
function setPage(name) { document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page')); $(`#${name}Page`)?.classList.add('active-page'); document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name)); const titles={overview:'设备总览',realtime:'实时数据',health:'健康评估',kpi:'运行 KPI',alarms:'故障信息',config:'系统配置'}; $('#pageTitle').textContent=titles[name] || '设备总览'; if(name==='alarms'){renderAlarms();loadFaultAnalysis();} if(name==='config') renderConfig(); }
function metricCard(key, data) { const [label,unit]=labels[key] || [key,'']; const val = data?.[key]; return `<div class="metric-card"><div class="metric-label">${label}<span>⌁</span></div><div class="metric-value">${fmt(val)}</div><div class="metric-unit">${unit}</div><div class="metric-trend"><i></i></div></div>`; }
const instrumentSpecs=[
  {key:'speedActual',label:'电机转速',unit:'rpm',min:-1500,max:1500,digits:1},
  {key:'current',label:'电机电流',unit:'A',min:0,max:3.3,digits:2},
  {key:'motorLoadRate',label:'转矩利用率',unit:'%',min:0,max:100,digits:1},
  {key:'dcVoltage',label:'直流母线电压',unit:'V',min:0,max:1200,digits:1},
  {key:'inverterTemp',label:'变频器温度',unit:'°C',min:0,max:150,digits:1},
  {key:'motorTemp',label:'电机温度',unit:'°C',min:0,max:150,digits:1}
];
function instrumentCard(spec,data){
  const raw=Number(data?.[spec.key]), valid=Number.isFinite(raw), value=valid?Math.max(spec.min,Math.min(spec.max,raw)):spec.min;
  const pct=valid?Math.max(0,Math.min(100,(value-spec.min)/(spec.max-spec.min)*100)):0;
  const angle=Math.PI*(1-pct/100), cx=110,cy=96,r=70, nx=cx+Math.cos(angle)*(r-12),ny=cy-Math.sin(angle)*(r-12);
  const point=(radius,a)=>`${(cx+Math.cos(a)*radius).toFixed(2)},${(cy-Math.sin(a)*radius).toFixed(2)}`;
  const ticks=Array.from({length:51},(_,i)=>{const a=Math.PI*(1-i/50),major=i%10===0,inner=major?r-12:r-7,outer=r-1;return `<line x1="${point(inner,a).split(',')[0]}" y1="${point(inner,a).split(',')[1]}" x2="${point(outer,a).split(',')[0]}" y2="${point(outer,a).split(',')[1]}" class="gauge-tick ${major?'major':''}"/>${major?`<text x="${(cx+Math.cos(a)*(r-23)).toFixed(2)}" y="${(cy-Math.sin(a)*(r-23)+3).toFixed(2)}" class="gauge-scale">${i*2}</text>`:''}`;}).join('');
  const number=valid?fmt(raw,spec.digits):'--';
  return `<article class="instrument-card"><svg class="instrument-gauge" viewBox="0 0 220 112" role="img" aria-label="${spec.label} ${number} ${spec.unit}"><defs><linearGradient id="gauge-gradient-${spec.key}" x1="0" x2="1"><stop offset="0%" stop-color="#2584ef"/><stop offset="100%" stop-color="#7848dc"/></linearGradient></defs><path class="gauge-track" d="M 40 96 A 70 70 0 0 1 180 96"/><path class="gauge-progress" stroke="url(#gauge-gradient-${spec.key})" d="M 40 96 A 70 70 0 0 1 180 96" pathLength="100" style="stroke-dasharray:${pct} 100"/><path class="gauge-rest" d="M 40 96 A 70 70 0 0 1 180 96" pathLength="100" style="stroke-dasharray:${100-pct} 100;stroke-dashoffset:${-pct}"/>${ticks}<line class="gauge-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}"/><circle class="gauge-hub" cx="${cx}" cy="${cy}" r="6"/></svg><div class="instrument-reading">${number}<span>${spec.unit}</span></div><div class="instrument-label">${spec.label}</div><div class="instrument-range">量程 ${spec.min} – ${spec.max} ${spec.unit}</div></article>`;
}
function formatHours(value){
  const raw=String(value ?? '').trim();
  const clock=raw.match(/^(\d+):(\d{2}):(\d{2})$/);
  if(clock){ const hours=Number(clock[1])+Number(clock[2])/60+Number(clock[3])/3600; return `${hours.toFixed(2)} h`; }
  const n=Number(raw.replace(/\s*h\s*$/i,''));
  return Number.isFinite(n)?`${n.toFixed(2)} h`:`${raw || '0'} h`;
}
function statusCode(value){ const text=String(value ?? '').trim(); return !text || text==='0' || text.toLowerCase()==='none' ? '无' : text; }
function dateText(value){ const raw=String(value ?? ''); const d=new Date(raw.replace(' ','T')); if(Number.isNaN(d.getTime())) return raw.slice(0,10) || '--'; return d.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}); }
function renderEventList(){
  const body=$('#eventTable'); if(!body)return;
  const events=[];
  state.alarms.forEach(row=>{
    const timestamp=row.createTime || row.timestamp;
    const fault=statusCode(row.faultCode), alarm=statusCode(row.alarmCode);
    if(fault!=='无') events.push({timestamp,event:'故障代码',value:fault});
    if(alarm!=='无') events.push({timestamp,event:'报警代码',value:alarm});
  });
  body.innerHTML=events.length?events.map(item=>`<tr><td>${dateText(item.timestamp)}</td><td>${timeText(item.timestamp)}</td><td>${item.event}</td><td><span class="event-value">${item.value}</span></td></tr>`).join(''):'<tr><td colspan="4" class="event-empty">暂无故障或报警事件</td></tr>';
}
function renderRealtimeStatus(data){
  const items=[
    ['变频器负荷率',fmt(data.inverterLoadRate,1),'%','normal'],
    ['电机负荷率',fmt(data.motorLoadRate,1),'%','normal'],
    ['实际运行时间',formatHours(data.systemRunTime),'','normal'],
    ['环境温度',fmt(data.airTemp,1),'°C','normal']
  ];
  const fault=statusCode(data.faultCode), alarm=statusCode(data.alarmCode);
  items.push(['故障代码',fault,'',fault==='无'?'ok':'fault'],['报警代码',alarm,'',alarm==='无'?'ok':'alarm']);
  $('#realtimeStatusGrid').innerHTML=items.map(([label,value,unit,kind])=>`<article class="realtime-status-card ${kind}"><div class="realtime-status-label">${label}</div><div class="realtime-status-value">${value}<span>${unit}</span></div></article>`).join('');
}
function renderLatest(data) { if (!data) return; state.latest=data; $('#lastTime').textContent=timeText(data.createTime || data.timestamp); $('#connectionText').textContent=`${data.deviceName || '设备'} · 已同步`; const keys=['speedActual','current','torqueActual','dcVoltage','motorTemp','inverterTemp','actualPower','inverterLoadRate']; $('#metricGrid').innerHTML=keys.map(k=>metricCard(k,data)).join(''); $('#metricGridLarge').innerHTML=instrumentSpecs.map(spec=>instrumentCard(spec,data)).join(''); renderRealtimeStatus(data); renderHealth(data); renderKpi(data); }
function renderDevices(list) { const devices=list.length ? list : []; $('#deviceGrid').innerHTML=devices.map((d,i)=>`<div class="device-card ${d.source===state.source?'selected':''}" data-source="${d.source}"><div class="device-top"><div class="device-icon">⚙</div><span class="status"><i></i>在线</span></div><div class="device-name">${d.deviceName || d.source}</div><div class="device-sub">${d.inverterName || '变频器'} · ${d.source}</div><div class="device-value"><b>${fmt(d.speedActual,0)}</b> rpm</div></div>`).join(''); document.querySelectorAll('.device-card').forEach(c=>c.onclick=()=>{state.source=c.dataset.source; $('#sourceSelect').value=state.source; refresh();}); }
function renderAlarms() { const rows=state.alarms; const list=$('#alarmList'); if(list) list.innerHTML=rows.length?rows.slice(0,5).map(a=>`<div class="alarm-row"><i class="alarm-dot"></i><div><strong>${a.faultCode!=='0'?`故障 ${a.faultCode}`:`报警 ${a.alarmCode}`}</strong><span>${a.deviceName} · ${timeText(a.createTime)}</span></div><span>${fmt(a.motorTemp)} °C</span></div>`).join(''):`<div class="alarm-row"><i class="alarm-dot" style="background:#27bd91"></i><div><strong>当前无故障记录</strong><span>设备运行状态正常</span></div><span>—</span></div>`; const table=$('#alarmTable'); if(table) table.innerHTML=rows.length?rows.map(a=>`<tr><td>${timeText(a.createTime)}</td><td>${a.deviceName}</td><td>${a.status || '—'}</td><td><span class="code-badge">${a.faultCode || '0'}</span></td><td>${a.alarmCode || '0'}</td><td>${fmt(a.speedActual,0)} rpm</td><td>${fmt(a.motorTemp)} °C</td></tr>`).join(''):`<tr><td colspan="7" style="text-align:center;color:#9aa5b6;padding:34px">当前数据源无故障或报警记录</td></tr>`; renderEventList(); }
function faultDateTime(value){ if(!value)return '--'; const d=new Date(String(value).replace(' ','T')); return Number.isNaN(d.getTime())?String(value):d.toLocaleString('zh-CN',{hour12:false}); }
function faultEmpty(message='暂无故障或报警数据'){ return `<div class="fault-empty">${message}</div>`; }
function renderFaultScatter(stats){
  const el=$('#faultScatter'); if(!el)return; if(!stats?.length){el.innerHTML=faultEmpty();return;}
  const width=640,height=300,left=56,right=22,top=22,bottom=48,plotW=width-left-right,plotH=height-top-bottom,maxX=Math.max(1,...stats.map(x=>Number(x.count)||0)),maxY=Math.max(1,...stats.map(x=>Number(x.durationMinutes)||0));
  const x=v=>left+(v/maxX)*plotW,y=v=>(height-bottom)-(v/maxY)*plotH; let svg=`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="fault-svg"><g class="fault-grid">`;
  for(let i=0;i<=4;i++){const yy=top+plotH*i/4;svg+=`<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text x="${left-8}" y="${yy+4}" text-anchor="end">${(maxY*(4-i)/4).toFixed(maxY<10?1:0)}</text>`;} svg+=`</g><line class="fault-axis" x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}"/><line class="fault-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height-bottom}"/>`;
  stats.forEach((item,i)=>{const px=x(Number(item.count)||0),py=y(Number(item.durationMinutes)||0),color=['#5b48d6','#2088e8','#16a078','#e58b2c','#df5361'][i%5];svg+=`<circle cx="${px}" cy="${py}" r="6" fill="${color}"/><text class="fault-point-label" x="${px+9}" y="${py-8}">${escapeHtml(item.code)}</text>`;}); svg+=`<text class="fault-axis-label" x="${left+plotW/2}" y="${height-10}" text-anchor="middle">故障/报警发生次数</text><text class="fault-axis-label" transform="translate(14 ${top+plotH/2}) rotate(-90)" text-anchor="middle">故障/报警总时长（分）</text></svg>`; el.innerHTML=svg;
}
function renderFaultBars(stats, target, field, unit){
  const el=$(target); if(!el)return; if(!stats?.length){el.innerHTML=faultEmpty();return;} const max=Math.max(1,...stats.map(x=>Number(x[field])||0));
  if(field==='durationMinutes'&&stats.every(x=>Number(x[field])<=0)){el.innerHTML=faultEmpty('当前故障持续时长为 0 分，暂无柱体');return;}
  el.innerHTML=stats.slice(0,8).map(item=>{const value=Number(item[field])||0;return `<div class="fault-bar-row"><span>${escapeHtml(item.code)}</span><div class="fault-bar-track"><i style="width:${Math.max(0,value/max*100)}%"></i></div><b>${value.toFixed(field==='durationMinutes'?2:0)}${unit}</b></div>`;}).join('');
}
function renderFaultTrend(points){
  const el=$('#faultTrend'); if(!el)return; if(!points?.length){el.innerHTML=faultEmpty();return;} const groups={}; points.forEach(p=>(groups[p.code] ||= []).push(p)); const allTimes=points.map(p=>new Date(String(p.time).replace(' ','T')).getTime()).filter(Number.isFinite),minT=Math.min(...allTimes),maxT=Math.max(...allTimes),maxY=Math.max(1,...points.map(p=>Number(p.durationMinutes)||0)),width=640,height=300,left=48,right=16,top=30,bottom=44,plotW=width-left-right,plotH=height-top-bottom,x=t=>left+(maxT===minT ? 0.5 : (t-minT)/(maxT-minT))*plotW,y=v=>height-bottom-(v/maxY)*plotH,colors=['#5b48d6','#2088e8','#16a078','#e58b2c','#df5361','#b24acb']; let svg=`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="fault-svg"><g class="fault-grid">`;
  for(let i=0;i<=4;i++){const yy=top+plotH*i/4;svg+=`<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text x="${left-7}" y="${yy+4}" text-anchor="end">${(maxY*(4-i)/4).toFixed(maxY<10?1:0)}</text>`;} svg+='</g>';
  Object.entries(groups).forEach(([code,list],i)=>{const color=colors[i%colors.length], coords=list.map(p=>{const t=new Date(String(p.time).replace(' ','T')).getTime();return [x(t),y(Number(p.durationMinutes)||0)];}); const d=coords.map((pt,j)=>`${j?'L':'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ');svg+=`<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>${coords.map(pt=>`<circle cx="${pt[0]}" cy="${pt[1]}" r="2.5" fill="${color}"/>`).join('')}<text x="${left+i*92}" y="15" fill="${color}" font-size="11">● ${escapeHtml(code)}</text>`;}); svg+=`<text class="fault-axis-label" x="${left+plotW/2}" y="${height-9}" text-anchor="middle">时间</text><text class="fault-axis-label" transform="translate(12 ${top+plotH/2}) rotate(-90)" text-anchor="middle">故障/报警时长（分）</text></svg>`; el.innerHTML=svg;
}
function renderFaultRecords(data){
  const body=$('#faultRecordTable'); if(!body)return; const rows=data?.records||[];
  body.innerHTML=rows.length?rows.map(row=>`<tr><td>DCMA / ${escapeHtml(state.source)}</td><td>${escapeHtml(row.deviceName)}</td><td>${escapeHtml(row.inverterName||'变频器')}</td><td><span class="code-badge">${escapeHtml(row.eventType)} ${escapeHtml(row.code)}</span></td><td>${escapeHtml(row.value)}</td><td>${faultDateTime(row.occurTime)}</td><td>${faultDateTime(row.disappearTime)}</td><td>${Number(row.durationMinutes||0).toFixed(2)}</td><td><div class="solution-cell"><span>${escapeHtml(row.solution||'未记录')}</span><button class="text-btn solution-edit" data-id="${row.id}">编辑</button></div></td></tr>`).join(''):`<tr><td colspan="9" class="fault-empty-cell">暂无符合条件的故障/报警记录</td></tr>`;
  $('#faultPageInfo').textContent=`第 ${data?.page||1} 页 / 共 ${Math.max(1,Math.ceil((data?.total||0)/(data?.pageSize||10)))} 页`; $('#faultPrev').disabled=(data?.page||1)<=1; $('#faultNext').disabled=(data?.page||1)>=Math.ceil((data?.total||0)/(data?.pageSize||10));
  body.querySelectorAll('.solution-edit').forEach(btn=>btn.onclick=()=>openSolution(Number(btn.dataset.id)));
}
function populateFaultCodes(codes){const select=$('#faultCodeFilter');if(!select)return;const selected=state.fault.code;select.innerHTML='<option value="ALL">All</option>'+(codes||[]).map(code=>`<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`).join('');select.value=(codes||[]).includes(selected)?selected:'ALL';state.fault.code=select.value;}
async function loadFaultAnalysis(){
  const params=new URLSearchParams({source:state.source,page:state.fault.page,pageSize:state.fault.pageSize}); if(state.fault.code!=='ALL')params.set('code',state.fault.code); if(state.fault.from)params.set('from',state.fault.from); if(state.fault.to)params.set('to',state.fault.to);
  try{const data=await getJson(`/api/fault-analysis?${params}`);state.fault.data=data;populateFaultCodes(data.codes);renderFaultScatter(data.stats);renderFaultBars(data.stats,'#faultCountBars','count','');renderFaultBars(data.stats,'#faultDurationBars','durationMinutes',' 分');renderFaultTrend(data.trend);renderFaultRecords(data);}catch(e){console.error(e);['#faultScatter','#faultCountBars','#faultDurationBars','#faultTrend'].forEach(sel=>{const el=$(sel);if(el)el.innerHTML=faultEmpty('故障分析数据暂时不可用');});}
}
function openSolution(id){const row=state.fault.data?.records?.find(item=>Number(item.id)===Number(id));state.fault.editingId=id;$('#solutionText').value=row?.solution||'';$('#solutionRecordHint').textContent=row?`${row.eventType} ${row.code} · ${faultDateTime(row.occurTime)}`:'故障记录';$('#solutionModal').hidden=false;setTimeout(()=>$('#solutionText').focus(),0);}
function closeSolution(){$('#solutionModal').hidden=true;state.fault.editingId=null;}
async function saveSolution(){const id=state.fault.editingId;if(!id)return;const button=$('#solutionSave');button.disabled=true;try{const response=await fetch('/api/fault-solution',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:state.source,id,solution:$('#solutionText').value})});if(!response.ok)throw new Error(await response.text());const result=await response.json();const row=state.fault.data?.records?.find(item=>Number(item.id)===Number(id));if(row)row.solution=result.solution;closeSolution();renderFaultRecords(state.fault.data);}catch(e){alert(`保存失败：${e.message}`);}finally{button.disabled=false;}}
function renderHealth(d) { const score = Math.max(0, Math.min(100, Math.round(100 - Math.max(0,d.motorTemp-70)*1.4 - Math.max(0,d.inverterTemp-65)*1.2 - Math.min(30,Math.abs(d.torqueActual)*8)))); $('#healthScore').textContent=score; $('#healthDesc').textContent=score>85?'设备运行稳定，暂无明显异常':score>65?'设备运行正常，建议关注温度变化':'检测到需要关注的运行指标'; const vals=[['温度状态',Math.max(0,100-Math.max(0,d.motorTemp-40)*1.5)],['负载状态',Math.max(0,100-Math.abs(d.motorLoadRate-50)*.8)],['电气状态',Math.max(0,100-Math.abs(d.dcVoltage-560)*2)],['数据新鲜度',100]]; $('#healthBars').innerHTML=vals.map(([n,v])=>`<div class="health-line"><div><span>${n}</span><b>${Math.round(v)}%</b></div><div class="bar"><i style="width:${Math.round(v)}%;background:${v>75?'#3c78ef':v>55?'#ecae42':'#e45d68'}"></i></div></div>`).join(''); }
function renderKpi(d) { const items=[['设备利用率',`${fmt(d.motorLoadRate,1)}%`,'基于当前负载率'],['变频器负载',`${fmt(d.inverterLoadRate,1)}%`,'实时负载'],['当前功率',`${fmt(d.actualPower,3)} kW`,'实时功率'],['运行时间',d.systemRunTime || '0','累计运行']]; $('#kpiGrid').innerHTML=items.map(x=>`<div class="kpi-card"><label>${x[0]}</label><strong>${x[1]}</strong><small>↑ ${x[2]}</small></div>`).join(''); $('#kpiSummary').innerHTML=[['设备名称',d.deviceName],['最后采集',timeText(d.createTime)],['状态码',d.status || '—'],['直流电压',`${fmt(d.dcVoltage)} V`],['电机温度',`${fmt(d.motorTemp)} °C`],['反馈功率',`${fmt(d.motorPower,3)} kW`]].map(x=>`<div class="summary-item">${x[0]}<b>${x[1]}</b></div>`).join(''); }
function parsePointTime(point) { const raw=point.createTime || point.timestamp; if(!raw)return NaN; const d=new Date(String(raw).replace(' ','T')); return d.getTime(); }
function renderOverviewChart(points) { const el=$('#chart'); if(!el)return; const w=el.clientWidth||600,h=el.clientHeight||275,pad=30; const series=[['speedActual','#e5e500',1000],['current','#58a2a3',1],['dcVoltage','#ed111b',600]]; let svg=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><g stroke="#263d52" stroke-width="1">`; for(let i=0;i<5;i++){const y=pad+i*(h-pad*2)/4;svg+=`<line x1="${pad}" y1="${y}" x2="${w-pad}" y2="${y}"/>`;} svg+='</g>'; series.forEach(([key,color,scale])=>{const vals=points.map(p=>Number(p[key]||0)/scale); const path=vals.map((v,i)=>`${i?'L':'M'} ${pad+i*(w-pad*2)/Math.max(1,vals.length-1)} ${h-pad-Math.max(0,Math.min(1,v))*(h-pad*2)}`).join(' '); svg+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`;}); svg+=`<text x="${pad}" y="${h-6}" fill="#9aa5b6" font-size="10">${points.length?timeText(points[0].createTime):''}</text><text x="${w-pad-70}" y="${h-6}" fill="#9aa5b6" font-size="10">${points.length?timeText(points.at(-1).createTime):''}</text></svg>`; el.innerHTML=svg; }
function renderMultiAxisChart(points) {
  const el=$('#chartLarge'); if(!el)return;
  let canvas=el.querySelector('canvas'); if(!canvas){el.replaceChildren(); canvas=document.createElement('canvas'); el.append(canvas);}
  const rect=el.getBoundingClientRect(), dpr=window.devicePixelRatio||1, w=Math.max(300,rect.width), h=Math.max(300,rect.height);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  canvas.style.width=`${w}px`; canvas.style.height=`${h}px`;
  const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,w,h);
  const col=39, plotLeft=12+trendSeries.length*col, plotRight=w-16, plotTop=112, plotBottom=h-34, plotH=plotBottom-plotTop, windowMs=60000, now=state.chartNow;
  const start=now-windowMs;
  const visible=points.filter(p=>{const t=parsePointTime(p);return Number.isFinite(t)&&t>=start&&t<=now+1000;});
  // Keep the last sample before the viewport as a carry-in point. The clip
  // draws its connecting segment up to the left edge instead of making the
  // trace appear to vanish as soon as its previous sample crosses the edge.
  const prior=points.filter(p=>{const t=parsePointTime(p);return Number.isFinite(t)&&t<start;}).at(-1);
  const linePoints=prior?[prior,...visible]:visible;
  ctx.font='11px "Microsoft YaHei", sans-serif';
  let lx=plotLeft+4, ly=22;
  trendSeries.forEach(s=>{const text=s.unit?`${s.name}(${s.unit})`:s.name; const width=ctx.measureText(text).width+28; if(lx+width>plotRight){lx=plotLeft+4;ly+=19;} ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(lx+4,ly-4,4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#344256';ctx.fillText(text,lx+12,ly);lx+=width;});
  ctx.font='10px "Microsoft YaHei", sans-serif'; ctx.fillStyle='#7c8798'; ctx.fillText('速度轴：0–1 对应 0–1000 rpm',plotLeft+4,ly+20);
  for(let tick=0;tick<=5;tick++){
    const y=plotBottom-tick*plotH/5;
    ctx.strokeStyle=tick===0?'#c39b27':'#e6eaf0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(plotLeft,y);ctx.lineTo(plotRight,y);ctx.stroke();
    trendSeries.forEach((s,i)=>{const x=12+(i+1)*col;const value=s.min+(s.max-s.min)*tick/5;ctx.strokeStyle=s.color;ctx.beginPath();ctx.moveTo(x-3,y);ctx.lineTo(x+3,y);ctx.stroke();ctx.fillStyle=s.color;ctx.textAlign='right';ctx.fillText(Number(value.toFixed(1)).toString(),x-5,y+3);});
  }
  ctx.textAlign='left';
  trendSeries.forEach((s,i)=>{
    const x=12+(i+1)*col;ctx.strokeStyle=s.color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,plotTop);ctx.lineTo(x,plotBottom);ctx.stroke();
    ctx.save();ctx.translate(x-2,plotTop-7);ctx.rotate(-Math.PI/2);ctx.fillStyle=s.color;ctx.font='10px "Microsoft YaHei", sans-serif';ctx.textAlign='left';ctx.fillText(s.unit?`${s.name} (${s.unit})`:s.name,0,0);ctx.restore();
  });
  ctx.strokeStyle='#e1a71e';ctx.beginPath();ctx.moveTo(plotLeft,plotBottom);ctx.lineTo(plotRight,plotBottom);ctx.stroke();
  ctx.font='10px "Microsoft YaHei", sans-serif';ctx.textAlign='center';
  for(let sec=0;sec<=60;sec++){
    if(sec%5!==0)continue;
    const x=plotLeft+(plotRight-plotLeft)*sec/60;ctx.strokeStyle='#d9dfe8';ctx.beginPath();ctx.moveTo(x,plotBottom);ctx.lineTo(x,plotBottom+4);ctx.stroke();
    const tickTime=new Date(start+sec*1000);ctx.fillStyle='#536174';ctx.fillText(tickTime.toLocaleTimeString('zh-CN',{hour12:false}),x,plotBottom+17);
  }
  ctx.textAlign='left';
  const plotClip=()=>{ctx.beginPath();ctx.rect(plotLeft,plotTop,plotRight-plotLeft,plotH);ctx.clip();};
  trendSeries.forEach(s=>{
    ctx.save();plotClip();ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();let started=false;
    linePoints.forEach(p=>{const t=parsePointTime(p), raw=Number(p[s.key]||0), value=raw/(s.scale||1), x=plotLeft+(t-start)/windowMs*(plotRight-plotLeft), y=plotBottom-(value-s.min)/(s.max-s.min)*plotH;if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);});if(started)ctx.stroke();
    if(visible.length){const p=visible.at(-1),t=parsePointTime(p),value=Number(p[s.key]||0)/(s.scale||1),x=plotLeft+(t-start)/windowMs*(plotRight-plotLeft),y=plotBottom-(value-s.min)/(s.max-s.min)*plotH;if(x>=plotLeft&&x<=plotRight){ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(x,y,2.7,0,Math.PI*2);ctx.fill();}}
    ctx.restore();
  });
  canvas.title=visible.length?trendSeries.map(s=>`${s.name}: ${fmt(visible.at(-1)[s.key],2)} ${s.unit}`).join('\n'):'当前 60 秒窗口内暂无采样点';
  $('#chartStatus').textContent=visible.length?`最近 60 秒 ${visible.length} 个采样点 · 最新采集 ${timeText(visible.at(-1).createTime)}`:'当前窗口暂无新采样，等待数据库写入';
}
function renderChart(target, points) { if(target==='#chartLarge') renderMultiAxisChart(points); else renderOverviewChart(points); }
async function getJson(url){ const r=await fetch(url); if(!r.ok)throw new Error(await r.text()); return r.json(); }
async function refresh() { try { const [latest, hist, alarms, devices] = await Promise.all([getJson(`/api/latest?source=${state.source}`),getJson(`/api/history?source=${state.source}&limit=60`),getJson(`/api/alarms?source=${state.source}`),getJson('/api/devices')]); renderLatest(latest); state.history=hist.items; state.lastTrendId=latest.id; state.alarms=alarms.items; renderDevices(devices.devices); renderAlarms(); renderChart('#chart',state.history); renderChart('#chartLarge',state.history); if($('#alarmsPage')?.classList.contains('active-page')) loadFaultAnalysis(); } catch(e) { $('#connectionText').textContent='数据连接异常'; console.error(e); } }
let trendPollBusy=false;
async function pollTrend(){if(trendPollBusy)return;trendPollBusy=true;try{const point=await getJson(`/api/latest?source=${state.source}`);if(point.id&&point.id!==state.lastTrendId){state.lastTrendId=point.id;state.history.push(point);if(state.history.length>300)state.history.splice(0,state.history.length-300);renderLatest(point);renderChart('#chart',state.history);renderChart('#chartLarge',state.history);}}catch(e){$('#chartStatus').textContent='实时数据暂时不可用';}finally{trendPollBusy=false;}}
function renderMappingList(){
  const list=configState.parameters[configState.tab]; const grid=$('#mappingGrid'); if(!grid)return;
  const entry=item=>`<div class="mapping-entry" data-id="${item.id}"><span class="mapping-index">${String(item.id).padStart(2,'0')}</span><input type="checkbox" aria-label="启用${escapeHtml(item.label)}" ${item.checked?'checked':''}><span class="mapping-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span><input class="mapping-param" type="text" value="${escapeHtml(item.paramName)}" placeholder="请输入参数名" aria-label="${escapeHtml(item.label)}参数名"></div>`;
  const pairs=[]; for(let i=0;i<list.length;i+=2)pairs.push(`<div class="mapping-pair">${entry(list[i])}${list[i+1]?entry(list[i+1]):''}</div>`); grid.innerHTML=pairs.join('');
  grid.querySelectorAll('.mapping-entry').forEach(el=>{const item=list[Number(el.dataset.id)-1];el.querySelector('input[type=checkbox]').onchange=e=>{item.checked=e.target.checked;updateMappingCount();};el.querySelector('.mapping-param').oninput=e=>{item.paramName=e.target.value;};}); updateMappingCount();
}
function updateMappingCount(){const list=configState.parameters[configState.tab]||[];$('#mappingCount').textContent=`${list.filter(item=>item.checked).length} / 84 已启用`;}
function selectMappingTab(tab){configState.tab=tab;document.querySelectorAll('.mapping-tab').forEach(button=>{const active=button.dataset.mappingTab===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});renderMappingList();}
function selectConfigSubpage(name){document.querySelectorAll('.config-subnav-item').forEach(button=>{const active=button.textContent.trim()===name;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});const isCommunication=name==='通信配置';$('#communicationConfig').hidden=!isCommunication;const placeholder=$('#configSubpagePlaceholder');placeholder.hidden=isCommunication;if(!isCommunication)placeholder.innerHTML=`<div><h3>${escapeHtml(name)}</h3><p>此配置页面已预留，当前先完成通信配置与数据点参数映射。</p></div>`;}
function saveConfig(){const form=document.querySelector('#communicationForm');const fields=Object.fromEntries(new FormData(form).entries());fields.protocolEnabled=form.elements.protocolEnabled.checked;const payload={communication:fields,mappings:Object.fromEntries(mappingTabs.map(tab=>[tab,configState.parameters[tab].map(item=>({...item}))]))};console.log('系统配置提交数据',payload);$('#configSaveStatus').textContent=`已在控制台生成配置数据 · ${new Date().toLocaleTimeString('zh-CN',{hour12:false})}`;}
async function loadCommunicationConfig(){
  const status=$('#communicationConfigStatus');
  try{
    const result=await getJson('/api/communication-config');
    if(!result.available){status.textContent=`未找到数据库通信配置：${result.message}。当前数据库仅包含实时数据表，表单暂保留空值。`;status.classList.add('unavailable');return;}
    const form=$('#communicationForm'),config=result.config||{};
    for(const [key,value] of Object.entries(config)){const field=form.elements[key];if(!field)continue;if(field.type==='checkbox')field.checked=Boolean(value);else field.value=value??'';}
    status.textContent='通信配置已从数据库加载';status.classList.remove('unavailable');
  }catch(error){status.textContent=`无法读取数据库通信配置：${error.message}`;status.classList.add('unavailable');}
}
function renderConfig(){renderMappingList();loadCommunicationConfig();}
function downloadChart(){const canvas=$('#chartLarge canvas');if(!canvas)return;const link=document.createElement('a');link.download=`${state.source}-多指标趋势-${new Date().toISOString().replace(/[:.]/g,'-')}.png`;link.href=canvas.toDataURL('image/png');link.click();}
function saveChartData(){const cols=[['timestamp','采集时间'],['speedSetpoint','速度给定值(rpm)'],['speedActual','速度实际值(rpm)'],['torqueSetpoint','转矩给定值(Nm)'],['torqueActual','转矩实际值(Nm)'],['current','实际电流(A)'],['actualPower','实际功率(kW)'],['dcVoltage','直流母线电压(V)'],['status','变频器状态']];const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;const lines=[cols.map(c=>esc(c[1])).join(',')];state.history.forEach(p=>lines.push(cols.map(([key])=>esc(key==='timestamp'?(p.createTime||p.timestamp):p[key])).join(',')));const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${state.source}-实时数据-${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(link.href);}
$('#downloadChart').onclick=downloadChart;$('#saveChartData').onclick=saveChartData;$('#copyChart').onclick=async()=>{const canvas=$('#chartLarge canvas');if(!canvas)return;try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);$('#chartStatus').textContent='图表图片已复制到剪贴板';}catch{downloadChart();$('#chartStatus').textContent='浏览器不支持复制图片，已改为下载 PNG';}};
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>setPage(b.dataset.page)); document.querySelectorAll('[data-page-target]').forEach(b=>b.onclick=()=>setPage(b.dataset.pageTarget)); $('#sourceSelect').onchange=e=>{state.source=e.target.value;state.history=[];state.lastTrendId=null;state.fault={...state.fault,page:1,code:'ALL',data:null};refresh()}; $('#refreshBtn').onclick=refresh; $('#alarmRefresh')?.addEventListener('click',refresh); $('#faultQueryBtn')?.addEventListener('click',()=>{state.fault.page=1;state.fault.code=$('#faultCodeFilter').value;state.fault.from=$('#faultFrom').value;state.fault.to=$('#faultTo').value;loadFaultAnalysis();}); $('#faultPrev')?.addEventListener('click',()=>{if(state.fault.page>1){state.fault.page--;loadFaultAnalysis();}}); $('#faultNext')?.addEventListener('click',()=>{const data=state.fault.data;if(data&&state.fault.page<Math.ceil(data.total/data.pageSize)){state.fault.page++;loadFaultAnalysis();}}); $('#solutionCancel')?.addEventListener('click',closeSolution); $('#solutionCancelBottom')?.addEventListener('click',closeSolution); $('#solutionSave')?.addEventListener('click',saveSolution); $('#solutionModal')?.addEventListener('click',e=>{if(e.target.id==='solutionModal')closeSolution();}); document.querySelectorAll('.config-subnav-item').forEach(button=>button.addEventListener('click',()=>selectConfigSubpage(button.textContent.trim())));document.querySelectorAll('.mapping-tab').forEach(button=>button.addEventListener('click',()=>selectMappingTab(button.dataset.mappingTab)));$('#saveConfigBtn')?.addEventListener('click',saveConfig); window.addEventListener('resize',()=>{renderChart('#chart',state.history);renderChart('#chartLarge',state.history)}); setInterval(()=>$('#clock').textContent=new Date().toLocaleString('zh-CN',{hour12:false}),1000); refresh(); setInterval(refresh,30000);setInterval(pollTrend,1000);setInterval(()=>{state.chartNow=Date.now();renderChart('#chartLarge',state.history)},1000);
