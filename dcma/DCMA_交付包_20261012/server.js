import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MySQLLite } from './mysql-lite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const PORT = Number(process.env.PORT || 3000);
const DB = { host: process.env.DB_HOST || '10.108.12.164', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' };
const SOURCES = new Set(['real_data', 'real_data_01', 'real_data_02', 'real_data_03', 'real_data_04']);
let db;
let dbPromise;
function getDb() {
  if (!dbPromise) dbPromise = (async () => {
    db = new MySQLLite(DB); await db.connect();
    // The lightweight protocol client uses one socket. Serialize queries so
    // dashboard refreshes and analysis requests cannot interleave packets.
    let queue = Promise.resolve(); const query = db.query.bind(db);
    db.query = (sql) => { const run = queue.then(() => query(sql)); queue = run.catch(() => {}); return run; };
    return db;
  })().catch(e => { dbPromise = null; throw e; });
  return dbPromise;
}
function sourceName(value) { return SOURCES.has(value) ? value : 'real_data_01'; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function normalize(row, source) {
  return {
    id: row.id,
    source,
    deviceName: row.device_name || source,
    inverterName: row.inverter_name || row.device_name || source,
    timestamp: row.timestamp || row.create_time,
    createTime: row.create_time,
    status: row.status,
    faultCode: row.fault_code || '0',
    alarmCode: row.alarm_code || '0',
    speedSetpoint: num(row.speed_setpoint), speedActual: num(row.speed_actual),
    current: num(row.current_actual), torqueSetpoint: num(row.torque_setpoint), torqueActual: num(row.torque_actual),
    dcVoltage: num(row.dc_voltage), motorTemp: num(row.motor_temp), inverterTemp: num(row.inverter_temp),
    airTemp: num(row.air_intake_temp), actualPower: num(row.actual_power), motorPower: num(row.motor_power),
    inverterLoadRate: num(row.inverter_load_rate), motorLoadRate: num(row.motor_load_rate),
    systemRunTime: row.system_run_time || '0'
  };
}
async function latest(source) {
  const d = await getDb();
  const result = await d.query(`SELECT * FROM dcma.${source} ORDER BY id DESC LIMIT 1`);
  return normalize(result.rows[0] || {}, source);
}
async function history(source, limit = 60) {
  const d = await getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 300);
  const result = await d.query(`SELECT * FROM dcma.${source} ORDER BY id DESC LIMIT ${safeLimit}`);
  return result.rows.reverse().map(row => normalize(row, source));
}
async function devices() {
  const all = [];
  for (const source of SOURCES) { try { const row = await latest(source); if (row.id) all.push(row); } catch {} }
  return all;
}
async function alarms(source) {
  const d = await getDb();
  // Read a recent window and filter after normalization. This keeps the
  // event feed reliable across MySQL versions where the mixed OR predicate
  // can be evaluated differently for numeric and string code columns.
  const result = await d.query(`SELECT * FROM dcma.${source} ORDER BY id DESC LIMIT 200`);
  return result.rows.map(row => normalize(row, source)).filter(row => {
    const fault = String(row.faultCode ?? '').trim();
    const alarm = String(row.alarmCode ?? '').trim();
    return fault && fault !== '0' || alarm && alarm !== '0';
  }).slice(0, 30);
}
const solutionReady = new Map();
function sqlText(value) { return String(value ?? '').replaceAll('\\', '\\\\').replaceAll("'", "''"); }
async function ensureSolutionColumn(source) {
  if (!solutionReady.has(source)) solutionReady.set(source, (async () => {
    const d = await getDb();
    try { await d.query(`SELECT actual_solution FROM dcma.${source} LIMIT 1`); }
    catch { await d.query(`ALTER TABLE dcma.${source} ADD COLUMN actual_solution TEXT NULL`); }
  })().catch(() => {}));
  return solutionReady.get(source);
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function eventTime(value) { const d = new Date(String(value || '').replace(' ', 'T')); return Number.isNaN(d.getTime()) ? NaN : d.getTime(); }
function isEventCode(value) { const code = String(value ?? '').trim(); return Boolean(code && code !== '0' && code.toLowerCase() !== 'none'); }
async function faultAnalysis(source, options = {}) {
  await ensureSolutionColumn(source);
  const d = await getDb();
  const from = validDate(options.from) ? options.from : '';
  const to = validDate(options.to) ? options.to : '';
  const dateClause = `${from ? ` AND create_time >= '${from} 00:00:00'` : ''}${to ? ` AND create_time <= '${to} 23:59:59'` : ''}`;
  const codeClause = options.code && options.code !== 'ALL' ? ` AND (fault_code = '${sqlText(options.code)}' OR alarm_code = '${sqlText(options.code)}')` : '';
  let result;
  try {
    result = await d.query(`SELECT id,device_name,inverter_name,status,fault_code,alarm_code,create_time,timestamp,actual_solution FROM dcma.${source} WHERE ((fault_code IS NOT NULL AND fault_code <> '' AND fault_code <> '0') OR (alarm_code IS NOT NULL AND alarm_code <> '0'))${dateClause}${codeClause} ORDER BY create_time ASC LIMIT 100000`);
  } catch {
    result = await d.query(`SELECT id,device_name,inverter_name,status,fault_code,alarm_code,create_time,timestamp FROM dcma.${source} ORDER BY create_time ASC LIMIT 100000`);
  }
  const samples = [];
  result.rows.forEach(row => {
    const timestamp = row.create_time || row.timestamp; const time = eventTime(timestamp); if (!Number.isFinite(time)) return;
    const base = {id:row.id, timestamp, deviceName:row.device_name || source, inverterName:row.inverter_name || '变频器', value:row.status ?? '0', solution:row.actual_solution || ''};
    if (isEventCode(row.fault_code)) samples.push({...base, code:String(row.fault_code).trim(), type:'故障', time});
    if (isEventCode(row.alarm_code)) samples.push({...base, code:String(row.alarm_code).trim(), type:'报警', time});
  });
  samples.sort((a,b)=>a.time-b.time);
  const groups=[]; const grouped=new Map();
  samples.forEach(sample=>{
    const key=`${sample.type}:${sample.code}`; const list=grouped.get(key) || [];
    const previous=list.at(-1); if (!previous || sample.time-previous.time > 30000) { const group={...sample, startTime:sample.timestamp, endTime:sample.timestamp, samples:[sample]}; list.push(group); groups.push(group); } else { previous.samples.push(sample); previous.endTime=sample.timestamp; previous.solution=previous.solution || sample.solution; }
    grouped.set(key,list);
  });
  const records=groups.map(group=>({id:group.id,source,deviceName:group.deviceName,inverterName:group.inverterName,eventType:group.type,code:group.code,value:String(group.value ?? '0'),occurTime:group.startTime,disappearTime:group.endTime,durationMinutes:Number(Math.max(0,(group.endTime && eventTime(group.endTime)-eventTime(group.startTime))/60000).toFixed(2)),solution:group.solution || ''})).sort((a,b)=>eventTime(b.occurTime)-eventTime(a.occurTime));
  const aggregate=new Map(); records.forEach(record=>{const item=aggregate.get(record.code)||{code:record.code,count:0,durationMinutes:0}; item.count++; item.durationMinutes+=record.durationMinutes; aggregate.set(record.code,item);});
  const stats=[...aggregate.values()].map(item=>({...item,durationMinutes:Number(item.durationMinutes.toFixed(2))})).sort((a,b)=>b.count-a.count);
  const trend=records.slice().reverse().map(record=>({code:record.code,time:record.occurTime,durationMinutes:record.durationMinutes}));
  const page=Math.max(1,Number(options.page)||1), pageSize=Math.min(100,Math.max(1,Number(options.pageSize)||20));
  return {stats,trend,codes:stats.map(item=>item.code),records:records.slice((page-1)*pageSize,page*pageSize),total:records.length,page,pageSize};
}
async function saveFaultSolution(source, id, solution) {
  await ensureSolutionColumn(source); const d=await getDb(); const safeId=Number(id); if(!Number.isInteger(safeId)||safeId<1) throw new Error('无效的故障记录');
  await d.query(`UPDATE dcma.${source} SET actual_solution='${sqlText(String(solution ?? '').slice(0,2000))}' WHERE id=${safeId}`);
  return {ok:true,id:safeId,solution:String(solution ?? '').slice(0,2000)};
}
async function communicationConfig() {
  const d=await getDb();
  const tables=await d.query("SHOW TABLES FROM dcma LIKE 'communication_config'");
  if(!tables.rows.length)return {available:false,config:null,message:'数据库中没有 communication_config 配置表'};
  const columns=await d.query('SHOW COLUMNS FROM dcma.communication_config');
  const names=new Set(columns.rows.map(row=>row.Field||row.field));
  const fields=['protocol','protocol_enabled','send_interval','send_unit','server_ip','server_port','username','password','record_topic','realtime_topic'];
  const selected=fields.filter(field=>names.has(field));
  if(!selected.length)return {available:false,config:null,message:'communication_config 表中没有可识别的通信配置字段'};
  const result=await d.query(`SELECT ${selected.join(',')} FROM dcma.communication_config LIMIT 1`);
  const row=result.rows[0]; if(!row)return {available:false,config:null,message:'communication_config 表中尚无配置记录'};
  return {available:true,config:{protocol:row.protocol||'',protocolEnabled:String(row.protocol_enabled||'0')==='1'||String(row.protocol_enabled||'').toLowerCase()==='true',sendInterval:row.send_interval||'',sendUnit:row.send_unit||'',serverIp:row.server_ip||'',serverPort:row.server_port||'',username:row.username||'',password:row.password||'',recordTopic:row.record_topic||'',realtimeTopic:row.realtime_topic||''}};
}
function readBody(req) { return new Promise((resolve,reject)=>{let body=''; req.on('data',chunk=>{body+=chunk; if(body.length>100000) req.destroy();}); req.on('end',()=>resolve(body)); req.on('error',reject);}); }
function json(res, status, data) { const body = JSON.stringify(data); res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}); res.end(body); }
function serveStatic(req, res) {
  const publicDir = path.join(__dirname, 'public'); let file = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (file === '/') file = '/index.html'; const target = path.normalize(path.join(publicDir, file));
  if (!target.startsWith(publicDir)) return json(res, 403, {error:'forbidden'});
  fs.readFile(target, (err, data) => { if (err) return json(res, 404, {error:'not found'}); const ext = path.extname(target); const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}; res.writeHead(200, {'content-type':types[ext] || 'application/octet-stream','cache-control':'no-store'}); res.end(data); });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`); const p = url.pathname;
    if (p === '/api/health') return json(res, 200, {ok:true, database:'dcma', host:DB.host, now:new Date().toISOString()});
    if (p === '/api/devices') return json(res, 200, {devices: await devices()});
    if (p === '/api/latest') return json(res, 200, await latest(sourceName(url.searchParams.get('source'))));
    if (p === '/api/history') return json(res, 200, {items: await history(sourceName(url.searchParams.get('source')), url.searchParams.get('limit'))});
    if (p === '/api/alarms') return json(res, 200, {items: await alarms(sourceName(url.searchParams.get('source')))});
    if (p === '/api/fault-analysis') return json(res, 200, await faultAnalysis(sourceName(url.searchParams.get('source')), {from:url.searchParams.get('from'),to:url.searchParams.get('to'),code:url.searchParams.get('code'),page:url.searchParams.get('page'),pageSize:url.searchParams.get('pageSize')}));
    if (p === '/api/communication-config') return json(res, 200, await communicationConfig());
    if (p === '/api/fault-solution' && req.method === 'POST') {
      const body=JSON.parse(await readBody(req));
      return json(res, 200, await saveFaultSolution(sourceName(body.source), body.id, body.solution));
    }
    if (p === '/api/realtime') {
      res.writeHead(200, {'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache','connection':'keep-alive','access-control-allow-origin':'*'});
      const source = sourceName(url.searchParams.get('source')); let closed = false; let timer; res.on('close', () => { closed = true; if (timer) clearInterval(timer); });
      const send = async () => { if (closed) return; try { const value = await latest(source); res.write(`data: ${JSON.stringify(value)}\n\n`); } catch (e) { res.write(`event: error\ndata: ${JSON.stringify({message:e.message})}\n\n`); } };
      await send(); timer = setInterval(send, 2000); return;
    }
    return serveStatic(req, res);
  } catch (e) { json(res, 500, {error:e.message}); }
});
server.listen(PORT, () => console.log(`DCMA dashboard running at http://localhost:${PORT}`));

