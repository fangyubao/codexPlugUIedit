import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import iconv from 'iconv-lite';
import { buildWatchX,watchPages,watchBuildFingerprint } from '../scripts/build-watchx.mjs';
import { run } from '../scripts/prepare-runtime.mjs';
import { assert,contained,atomicWrite,hash,newDocument,newNode,validateDocument } from './model.mjs';
import { createSites,patchPageSource,firmwareHeader } from './watchx-source.mjs';

export const watchxSourceKey=page=>'watchx:'+page;
const builds=new Map();
const sourcePath=page=>'WatchX/WatchX/GUI/Page/'+watchPages[page];
const manifestPath='.ui-designer/watchx-integration.json';
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(buffer){let c=0xffffffff;for(const b of buffer)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function pngChunk(type,data){const t=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([size,t,data,checksum]);}
export function bmpToPng(bmp){
  assert(bmp.toString('ascii',0,2)==='BM','预览不是 BMP');const width=bmp.readInt32LE(18),height=bmp.readInt32LE(22),offset=bmp.readUInt32LE(10);assert(width===135&&height===240&&bmp.readUInt16LE(28)===32,'预览像素格式不匹配');
  const raw=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++){const row=y*(width*4+1);raw[row]=0;for(let x=0;x<width;x++){const s=offset+((height-1-y)*width+x)*4,d=row+1+x*4;raw[d]=bmp[s+2];raw[d+1]=bmp[s+1];raw[d+2]=bmp[s];raw[d+3]=255;}}
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',zlib.deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
}
export async function isWatchX(root){try{const conf=await fs.readFile(await contained(root,'WatchX/Libraries/lvgl/src/lv_version.h'),'utf8');await contained(root,sourcePath('DialPlate'));return /LVGL_VERSION_MAJOR\s+6/.test(conf)&&/LVGL_VERSION_MINOR\s+1/.test(conf);}catch{return false;}}
export async function readIntegration(root){try{return JSON.parse(await fs.readFile(await contained(root,manifestPath),'utf8'));}catch(e){if(e.code==='ENOENT')return {pages:{}};throw e;}}
export async function ensureWatchXBuild(root){
  if(builds.has(root))return builds.get(root);
  const promise=(async()=>{const exe=await contained(root,'.ui-designer/watchx-host/build/watchx_host.exe',{existing:false});try{await fs.access(exe);const saved=await fs.readFile(path.join(root,'.ui-designer/watchx-host/fingerprint'),'utf8');if(saved===await watchBuildFingerprint(root))return {executable:exe};}catch(e){if(e.code!=='ENOENT')throw e;}return buildWatchX(root);})();
  builds.set(root,promise);try{return await promise;}finally{builds.delete(root);}
}
async function render(root,page,lines=''){
  const {executable}=await ensureWatchXBuild(root),relative='.ui-designer/watchx-renders/'+randomBytes(10).toString('hex');
  const dir=await contained(root,relative,{existing:false});await fs.mkdir(dir,{recursive:true});
  const changes=path.join(dir,'changes.tsv'),treePath=path.join(dir,'tree.json'),bmpPath=path.join(dir,'frame.bmp');await fs.writeFile(changes,lines);
  await run(executable,[page,treePath,bmpPath,'unused',changes],{cwd:dir,timeout:15000});
  const tree=JSON.parse(await fs.readFile(treePath,'utf8')),png=bmpToPng(await fs.readFile(bmpPath));
  await fs.writeFile(path.join(dir,'preview.png'),png);
  return {tree,image:'data:image/png;base64,'+png.toString('base64'),previewPath:path.join(dir,'preview.png')};
}
export function watchEdits(doc){
  const edits=[];
  for(const node of doc.nodes){const original=doc.source.originalNodes.find(n=>n.id===node.id);if(!original)continue;const changes={};
    for(const key of ['x','y','width','height','text','color','background','border','radius','visible'])if(node[key]!==original[key])changes[key]=node[key];
    if(Object.keys(changes).length){assert(node.sourceRef?.line,'该内部控件没有可写回的源码位置');edits.push({id:node.id,site:node.sourceRef.line,instance:node.sourceRef.instance,changes});}
  }return edits;
}
function editLines(edits){const lines=[];for(const edit of edits)for(const key of ['text','width','height','x','y','color','background','border','radius','visible']){if(!(key in edit.changes))continue;const value=edit.changes[key],encoded=key==='text'?Buffer.from(value,'utf8').toString('hex'):['color','background','border'].includes(key)?value.slice(1):typeof value==='boolean'?(value?1:0):Math.round(value);lines.push(`${edit.id}\t${key}\t${encoded}`);}return lines.join('\n');}
export async function checkWatchSources(root,doc){for(const[file,fingerprint]of Object.entries(doc.source.fingerprints)){assert(hash(await fs.readFile(await contained(root,file)))===fingerprint,`源文件已改变：${file}。请先处理外部修改，未覆盖文件。`,409);}}
export async function importWatchX(root,page='DialPlate'){
  assert(watchPages[page],'未知 WatchX 页面');assert(await isWatchX(root),'不是支持的 WatchX / LVGL 6.1 工程');
  const integration=await readIntegration(root),integrated=integration.pages[page];
  const file=sourcePath(page),bytes=await fs.readFile(await contained(root,file));
  if(integrated)assert(hash(bytes)===integrated.sourceHash,'WatchX 页面在接入后被外部修改，请先合并后再导入',409);
  const baseline=integrated?Buffer.from(integrated.originalBase64,'base64'):bytes;
  const text=iconv.decode(baseline,'gbk'),sites=createSites(text);
  const originalRender=await render(root,page),nodes=originalRender.tree.filter(n=>n.id!=='root').map(n=>{
    const site=sites.find(s=>s.line===n.sourceLine);
    const type=n.kind==='lv_label'?'label':n.kind==='lv_slider'?'slider':n.kind==='lv_bar'?'progress':n.kind==='lv_btn'?'button':'frame';
    return newNode(type,{id:n.id,name:site?site.variable+(n.instance?' ['+n.instance+']':''):n.kind,x:n.x,y:n.y,width:n.width,height:n.height,
      parentId:n.parent==='root'?null:n.parent,text:n.text,color:n.color,background:n.background,border:n.border,radius:Math.max(0,Math.min(n.radius,500)),fontSize:n.fontSize,visible:n.visible,
      nativeKind:n.kind,sourceRef:{file,line:n.sourceLine,instance:n.instance},locked:!site});
  });
  const doc=newDocument();doc.title='WatchX · '+page;doc.target='lvgl';doc.canvas={width:135,height:240,background:'#000000',grid:1};doc.nodes=nodes;
  doc.source={kind:'watchx-lvgl6',file,page,version:'6.1.2',originalBase64:baseline.toString('base64'),originalNodes:structuredClone(nodes),fingerprints:{[file]:hash(bytes)},savedRevision:null};
  doc.nativePreview={image:originalRender.image,path:originalRender.previewPath};
  doc.warnings=['原生 LVGL 6.1.2 · 编辑静态快照；时钟、电量、气压使用预览数据。游戏页及 MCU 硬件行为未模拟。暂不支持增删控件和替换字体图片。写回在 Setup 末尾应用配置；动态回调、动画和布局可能覆盖所改属性。'];
  if(integrated)for(const edit of integrated.edits){const node=doc.nodes.find(n=>n.sourceRef.line===edit.site&&n.sourceRef.instance===edit.instance);if(node)Object.assign(node,edit.changes);}
  if(integrated)await refreshWatchPreview(root,doc);
  return validateDocument(doc);
}
export async function refreshWatchPreview(root,doc){
  await checkWatchSources(root,doc);const result=await render(root,doc.source.page,editLines(watchEdits(doc)));
  for(const node of doc.nodes){const actual=result.tree.find(n=>n.id===node.id);if(actual)for(const key of ['x','y','width','height'])node[key]=actual[key];}
  doc.nativePreview={image:result.image,path:result.previewPath};return doc;
}
export async function writeWatchSource(root,doc,revision){
  await checkWatchSources(root,doc);
  const page=doc.source.page,relative=doc.source.file,original=Buffer.from(doc.source.originalBase64,'base64');
  const integration=await readIntegration(root),previous=integration.pages[page];
  if(previous)assert(previous.sourceHash===doc.source.fingerprints[relative],'接入记录与当前设计不一致',409);
  const edits=watchEdits(doc),headerRelative=`WatchX/WatchX/GUI/UIStudioGenerated/${page}.h`;
  const header=firmwareHeader(page,edits);
  const patched=iconv.encode(patchPageSource(iconv.decode(original,'gbk'),page),'gbk');
  const source=await contained(root,relative),headerFile=await contained(root,headerRelative,{existing:false});
  if(previous){assert(hash(await fs.readFile(headerFile))===previous.headerHash,'生成配置被外部修改，拒绝覆盖',409);}
  else {try{await fs.access(headerFile);assert(false,'同名配置已存在，拒绝覆盖',409);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const backupRelative=`.ui-designer/source-backups/${page}-${Date.now()}`;
  const backupDir=await contained(root,backupRelative,{existing:false});await fs.mkdir(backupDir,{recursive:true});
  await fs.copyFile(source,path.join(backupDir,watchPages[page]));if(previous)await fs.copyFile(headerFile,path.join(backupDir,page+'.h'));
  const sourceHash=hash(patched);integration.pages[page]={originalBase64:original.toString('base64'),sourceHash,headerHash:hash(header),headerRelative,edits,savedRevision:revision,backupDirectory:backupDir};
  try{
    await atomicWrite(headerFile,header);
    await atomicWrite(source,patched);
    await atomicWrite(await contained(root,manifestPath,{existing:false}),JSON.stringify(integration,null,2));
  }catch(e){
    await fs.copyFile(path.join(backupDir,watchPages[page]),source);
    if(previous)await fs.copyFile(path.join(backupDir,page+'.h'),headerFile);else await fs.unlink(headerFile).catch(()=>{});
    throw e;
  }
  doc.source.fingerprints[relative]=sourceHash;doc.source.savedRevision=revision;
  return {page,files:[source,headerFile],backupDirectory:backupDir,editedObjects:edits.length,revision,note:'已写回 WatchX 页面和 LVGL 6 覆盖配置。原生宿主预览已验证；未执行 Keil 固件构建或实板烧录。'};
}
