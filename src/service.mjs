import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DocumentStore, assert, contained, atomicWrite, hash, StudioError } from './model.mjs';
import { inspectProject, importQt, generateFiles } from './adapters.mjs';
import { prepareRuntime, run } from '../scripts/prepare-runtime.mjs';
import { isWatchX,importWatchX,refreshWatchPreview,writeWatchSource,watchxSourceKey } from './watchx.mjs';

export const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
export const dataDir = process.env.UI_STUDIO_DATA || path.join(os.homedir(),'.codex','ui-studio');
const runtimeFile = path.join(dataDir,'service.json');
const sessionsFile = path.join(dataDir,'sessions.json');
const store = new DocumentStore();
store.beforeCommit=async(root,doc)=>{if(doc.source?.kind==='watchx-lvgl6')await refreshWatchPreview(root,doc);};
let sessionRecords = {}, runtime;
let openQueue = Promise.resolve();
const previewJobs=new Map();
const environmentJobs=new Map();
const projectReports=new Map();
function safeEqual(a,b) { const aa=Buffer.from(a || ''),bb=Buffer.from(b || ''); return aa.length === bb.length && timingSafeEqual(aa,bb); }
export async function dispatch(action,args={}) {
  if (action==='inspect_ui_project') return inspectProject(args.projectPath);
  if (action==='open_ui_editor') {
    const run = openQueue.catch(()=>{}).then(async()=>{
      assert(!args.mode || ['auto','new'].includes(args.mode),'未知打开模式');
      assert(!(args.sourceFile && (args.mode==='new' || args.demo)),'导入已有文件与新建设计不能同时选择');
      const root=await fs.realpath(args.projectPath);
      let sourceKey=args.sourceFile || '', inspection;
      if(args.page || (!sourceKey && args.mode!=='new' && !args.demo && await isWatchX(root))) {
        assert(args.mode!=='new'&&!args.demo&&!sourceKey,'WatchX 页面不能与其他导入选项同时使用');
        const page=args.page||'DialPlate',watchKey=watchxSourceKey(page);
        const initial=await importWatchX(root,page);
        const snapshot=await store.open(root,{sourceKey:watchKey,initial});
        sessionRecords[snapshot.id]={projectPath:root,sourceKey:watchKey,kind:'watchx',page};await atomicWrite(sessionsFile,JSON.stringify(sessionRecords,null,2));
        return {...snapshot,pages:['DialPlate','MainMenu','TimeCfg','Backlight','StopWatch','Altitude','About'],editorUrl:`${runtime.url}/?session=${snapshot.id}#token=${runtime.token}`};
      }
      if(!sourceKey && args.mode!=='new' && !args.demo && !(await store.hasSaved(root))) {
        inspection=await inspectProject(root);
        const onlyQt=inspection.frameworks.every(f=>['qt-widgets','qt-python'].includes(f.framework));
        if(inspection.qtUiFiles.length===1 && inspection.scan.complete && !inspection.conflicts.length && onlyQt && inspection.environment.kind!=='mixed')sourceKey=inspection.qtUiFiles[0];
        else {
          const id='project_'+hash(root).slice(0,20);
          const report={id,view:'project',projectPath:root,inspection,
            message:'已打开工程检查结果。尚未导入界面；请查看框架支持情况或选择具体 UI 文件。'};
          projectReports.set(id,report);sessionRecords[id]={projectPath:root,kind:'project'};
          await atomicWrite(sessionsFile,JSON.stringify(sessionRecords,null,2));
          return {...report,editorUrl:`${runtime.url}/?session=${id}#token=${runtime.token}`};
        }
      }
      const initial=sourceKey ? await importQt(args.projectPath,sourceKey) : null;
      const snapshot=await store.open(root,{demo:args.demo===true,sourceKey,initial});
      sessionRecords[snapshot.id]={projectPath:snapshot.projectPath,sourceKey};
      await atomicWrite(sessionsFile,JSON.stringify(sessionRecords,null,2));
      return {...snapshot, editorUrl:`${runtime.url}/?session=${snapshot.id}#token=${runtime.token}`};
    });
    openQueue=run; return run;
  }
  if (args.sessionId && !store.sessions.has(args.sessionId) && sessionRecords[args.sessionId]) {
    const record=sessionRecords[args.sessionId];
    if(record.kind==='project') {
      if(!projectReports.has(args.sessionId))projectReports.set(args.sessionId,{id:args.sessionId,view:'project',projectPath:record.projectPath,inspection:await inspectProject(record.projectPath),message:'工程检查结果；当前尚未导入界面。'});
    } else await store.open(record.projectPath,{sourceKey:record.sourceKey,initial:record.kind==='watchx'?await importWatchX(record.projectPath,record.page):null});
  }
  if(args.sessionId && projectReports.has(args.sessionId)) {
    assert(action==='get_ui_document','当前是工程检查结果，没有可编辑文档；请接入适配器或明确新建设计。',422);
    return projectReports.get(args.sessionId);
  }
  if(action==='get_ui_document') return store.snapshot(args.sessionId);
  if(action==='apply_ui_operations') return store.mutate(args.sessionId,args.revision,'edit',args.operations);
  if(action==='ui_history') return store.mutate(args.sessionId,args.revision,args.action);
  if(action==='select_ui_nodes') return store.selection(args.sessionId,args.ids);
  if(action==='save_ui_source'){
    const s=store.require(args.sessionId);const job=s.queue.catch(()=>{}).then(async()=>{
      assert(args.revision===s.revision,'设计已更新，请读取最新版本后保存',409);
      assert(s.document.source?.kind==='watchx-lvgl6','当前源文件写回只支持已接入 WatchX 的页面');
      const result=await writeWatchSource(s.root,s.document,s.revision);
      for(const doc of [...s.history,...s.future])if(doc.source?.kind==='watchx-lvgl6'){doc.source.fingerprints=structuredClone(s.document.source.fingerprints);doc.source.savedRevision=null;}
      await store.persist(s);return {...result,snapshot:store.snapshot(s.id)};
    });s.queue=job;return job;
  }
  if(action==='render_ui_preview') {
    const s=store.require(args.sessionId);await s.queue.catch(()=>{});
    assert(args.revision===s.revision,'设计已更新，请读取最新版本后预览',409);
    assert(!s.document.source,'此版本原生预览支持新建设计；导入 Qt 文件请在原工程中运行以保留资源和插件依赖');
    for(const job of previewJobs.values()) if(job.sessionId===s.id && job.state==='running') return {jobId:job.id,state:job.state,message:job.message,revision:job.revision};
    const doc=structuredClone(s.document),job={id:randomBytes(12).toString('hex'),sessionId:s.id,revision:s.revision,state:'running',message:'准备工程独立的 Qt 环境…'};
    previewJobs.set(job.id,job);
    (async()=>{
      try {
        let preparation=environmentJobs.get(s.root);
        if(!preparation){preparation=prepareRuntime(s.root,{log:message=>{job.message=message.slice(-1000);}});environmentJobs.set(s.root,preparation);}
        let env;try{env=await preparation;}finally{if(environmentJobs.get(s.root)===preparation)environmentJobs.delete(s.root);}
        const relative=`.ui-designer/previews/${job.id}`;
        const directory=await contained(s.root,relative,{existing:false});await fs.mkdir(directory,{recursive:true});
        const ui=await contained(s.root,relative+'/window.ui',{existing:false});
        job.path=await contained(s.root,relative+'/preview.png',{existing:false});
        await atomicWrite(ui,generateFiles(doc,'qt-ui').files['window.ui']);job.message='正在用 Qt 原生控件渲染…';
        await run(env.python,[path.join(pluginRoot,'scripts/native-preview.py'),ui,job.path],{cwd:directory,timeout:30000});
        job.state='complete';job.message='原生 Qt 预览已生成';job.qtVersion=env.version;
      } catch(e){job.state='failed';job.message=e.message;}
    })();
    return {jobId:job.id,state:job.state,message:job.message,revision:job.revision};
  }
  if(action==='get_ui_preview') {
    const job=previewJobs.get(args.jobId);assert(job,'找不到预览任务',404);
    const result={jobId:job.id,state:job.state,message:job.message,revision:job.revision,path:job.path,qtVersion:job.qtVersion};
    if(args.includeImage && job.state==='complete')result.imageDataUrl='data:image/png;base64,'+(await fs.readFile(job.path)).toString('base64');
    return result;
  }
  if(action==='export_ui_project') {
    const s=store.require(args.sessionId); await s.queue.catch(()=>{});
    assert(args.revision===s.revision,'设计已更新，请读取最新版本后再导出',409);
    // Snapshot before awaiting filesystem operations so export is internally consistent.
    const doc=structuredClone(s.document), revision=s.revision;
    assert(doc.source?.kind!=='watchx-lvgl6','WatchX 沿用 LVGL 6.1.2，请使用“保存回工程”，不能转为 LVGL 9 导出');
    if(doc.source) { const source=await contained(s.root,doc.source.file); assert(hash(await fs.readFile(source,'utf8'))===doc.source.hash,'原始 .ui 文件已改变，请导入其新副本后继续，避免导出过时内容。',409); }
    const target=args.target || doc.target, output=generateFiles(doc,target);
    const relative=`.ui-designer/exports/${s.id}/${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}-r${revision}-${target}-${randomBytes(3).toString('hex')}`;
    const destination=await contained(s.root,relative,{existing:false});
    await fs.mkdir(destination,{recursive:true});
    for(const [name,text] of Object.entries(output.files)) { const file=await contained(s.root,path.join(relative,name),{existing:false}); await atomicWrite(file,text); }
    await atomicWrite(await contained(s.root,path.join(relative,'EXPORT_NOTES.md'),{existing:false}),`# UI Studio export\n\nTarget: ${target}\nRevision: ${revision}\n\n${output.warnings.map(w=>'- '+w).join('\n')}\n\nEvent handlers and business logic are connected by the application.\n`);
    return {directory:destination,files:Object.keys(output.files),warnings:output.warnings,revision,target};
  }
  throw new StudioError('未知操作',404);
}
export async function startService() {
  await fs.mkdir(dataDir,{recursive:true});
  try { sessionRecords=JSON.parse(await fs.readFile(sessionsFile,'utf8')); } catch(e) { if(e.code!=='ENOENT') throw e; }
  const token=randomBytes(32).toString('hex');
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    try {
      assert(req.headers.host===new URL(runtime.url).host,'无效主机',403);
      const url=new URL(req.url,runtime.url);
      if(url.pathname==='/health') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({name:'ui-studio',version:'0.2.1'})); return; }
      if(url.pathname==='/api') {
        assert(req.method==='POST','仅支持 POST',405);
        assert(!req.headers.origin || req.headers.origin===runtime.url,'来源不被允许',403);
        assert(safeEqual(req.headers.authorization,`Bearer ${token}`),'未授权的编辑器连接',401);
        assert(req.headers['content-type']?.startsWith('application/json'),'需要 JSON',415);
        let body=''; for await (const chunk of req) { body+=chunk; assert(Buffer.byteLength(body)<2_000_000,'请求过大',413); }
        const request=JSON.parse(body); const data=await dispatch(request.action,request.args);
        res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(data)); return;
      }
      assert(req.method==='GET','仅支持 GET',405);
      const resources={'/':'dist/editor.html'}; const file=resources[url.pathname]; assert(file,'未找到页面',404);
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
      res.end(await fs.readFile(path.join(pluginRoot,file)));
    } catch(e) { res.statusCode=e.status || (e instanceof SyntaxError?400:500); res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify({error:e.message})); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  runtime={url:`http://127.0.0.1:${server.address().port}`,token,pid:process.pid,version:'0.2.1'};
  await atomicWrite(runtimeFile,JSON.stringify(runtime));
  await fs.chmod(runtimeFile,0o600).catch(()=>{});
  return {server,runtime};
}
async function readRuntime() {
  try {
    const metadata=JSON.parse(await fs.readFile(runtimeFile,'utf8'));
    const parsed=new URL(metadata.url); if(parsed.hostname!=='127.0.0.1') return null;
    const response=await fetch(metadata.url+'/health',{signal:AbortSignal.timeout(700)});
    const result=await response.json(); return result.name==='ui-studio' ? metadata : null;
  } catch { return null; }
}
export async function ensureService() {
  let metadata=await readRuntime(); if(metadata) return metadata;
  await fs.mkdir(dataDir,{recursive:true});
  const lockFile=path.join(dataDir,'launch.lock'); let lock;
  for(let i=0;i<100;i++) {
    metadata=await readRuntime(); if(metadata) return metadata;
    try { lock=await fs.open(lockFile,'wx'); break; }
    catch(e) { if(e.code!=='EEXIST') throw e; const stat=await fs.stat(lockFile).catch(()=>null); if(stat && Date.now()-stat.mtimeMs>30000) await fs.unlink(lockFile).catch(()=>{}); await new Promise(resolve=>setTimeout(resolve,100)); }
  }
  assert(lock,'编辑服务正在启动，请稍后重试',503);
  try {
    metadata=await readRuntime(); if(metadata) return metadata;
    const log=await fs.open(path.join(dataDir,'service.log'),'a');
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--serve'],{cwd:pluginRoot,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:process.env});
    let spawnError; child.on('error',e=>{spawnError=e;}); child.unref(); await log.close();
    for(let i=0;i<100;i++) { if(spawnError) throw spawnError; metadata=await readRuntime(); if(metadata) return metadata; await new Promise(resolve=>setTimeout(resolve,100)); }
    throw new StudioError('编辑服务启动失败，请查看本地 service.log',503);
  } finally { await lock.close(); await fs.unlink(lockFile).catch(()=>{}); }
}
export async function callService(action,args={}) {
  const meta=await ensureService();
  const response=await fetch(meta.url+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${meta.token}`},body:JSON.stringify({action,args}),signal:AbortSignal.timeout(30000)});
  const data=await response.json(); if(!response.ok) throw new StudioError(data.error,response.status); return data;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.includes('--serve')) { const {runtime:rt}=await startService(); console.log(`UI Studio listening on ${rt.url}`); }
  else { const meta=await ensureService(); console.log(`UI Studio service ready: ${meta.url}`); console.log('Use: node scripts/studio.mjs open <project-directory> [--demo]'); }
}
