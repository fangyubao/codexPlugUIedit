import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import iconv from 'iconv-lite';
import {createSites,patchPageSource,firmwareHeader} from '../src/watchx-source.mjs';
import {applyOperations,hash} from '../src/model.mjs';
import {importWatchX,refreshWatchPreview,writeWatchSource} from '../src/watchx.mjs';
import {buildWatchX,watchPages} from '../scripts/build-watchx.mjs';
import {run} from '../scripts/prepare-runtime.mjs';

test('WatchX source integration ignores comments and strings and preserves legacy encoding',()=>{
  const text='// 中文 lv_label_create(0,0)\r\nstatic void Setup()\r\n{\r\n const char *example="lv_label_create(0,0)";\r\n for(int i=0;i<2;i++){ lv_obj_t *label = lv_label_create(parent, NULL); }\r\n}\r\n';
  assert.deepEqual(createSites(text).map(s=>[s.line,s.variable]),[[5,'label']]);
  const patched=patchPageSource(text,'DialPlate');
  assert(patched.includes('ui_studio_DialPlate::capture(lv_label_create(parent, NULL), 5)'));
  assert(patched.includes('ui_studio_DialPlate::reset();'));
  assert(patched.includes('ui_studio_DialPlate::apply();'));
  assert.equal(iconv.decode(iconv.encode(patched,'gbk'),'gbk'),patched);
  assert.throws(()=>patchPageSource(patched,'DialPlate'),/已接入/);
  const header=firmwareHeader('DialPlate',[{site:5,instance:1,changes:{text:'中文 😀 "\\\n',x:8,color:'#12abef'}}]);
  assert(header.includes('entries[2]'));assert(header.includes('lv_color_hex(0x12abef)'));
  assert(header.includes('\\344\\270\\255'));assert(!header.includes('😀'));
});

test('WatchX native import, edit, undo, source save, reopen and patched page compile', {skip:!process.env.WATCHX_TEST_PROJECT,timeout:240000},async(t)=>{
  const source=await fs.realpath(process.env.WATCHX_TEST_PROJECT);
  const output=path.resolve('test-results');await fs.mkdir(output,{recursive:true});
  const root=await fs.mkdtemp(path.join(output,'watchx-'));
  for(const relative of ['WatchX/Libraries/lvgl','WatchX/Libraries/PageManager','WatchX/WatchX/GUI','WatchX/WatchX/Basic'])await fs.cp(path.join(source,relative),path.join(root,relative),{recursive:true});
  await fs.copyFile(path.join(source,'WatchX/Libraries/lv_conf.h'),path.join(root,'WatchX/Libraries/lv_conf.h'));
  process.env.UI_STUDIO_DATA=path.join(root,'runtime');
  const {startService}=await import('../src/service.mjs');const{server,runtime}=await startService();
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  async function api(action,args){const response=await fetch(runtime.url+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+runtime.token},body:JSON.stringify({action,args})});const result=await response.json();return{status:response.status,...result};}
  const before=await fs.readFile(path.join(root,'WatchX/WatchX/GUI/Page/Page_DialPlate.cpp'));
  let session;
  for(const page of Object.keys(watchPages)){const opened=await api('open_ui_editor',{projectPath:root,page});assert.equal(opened.status,200,JSON.stringify(opened));assert.equal(opened.contentKind,'imported-watchx');assert(opened.document.nodes.length>=5);assert(opened.document.nativePreview.image.startsWith('data:image/png;base64,'));if(page==='DialPlate')session=opened;}
  const node=session.document.nodes.find(n=>n.name==='labelStepCnt');assert(node);
  let edited=await api('apply_ui_operations',{sessionId:session.id,revision:0,operations:[{op:'update',id:node.id,changes:{x:node.x-6,y:node.y-7,text:'777',color:'#00ff00'}}]});
  assert.equal(edited.status,200,JSON.stringify(edited));assert.equal(edited.revision,1);
  const actual=edited.document.nodes.find(n=>n.id===node.id);assert.equal(actual.x,node.x-6);assert.equal(actual.y,node.y-7);assert.equal(actual.text,'777');
  assert.notEqual(edited.document.nativePreview.image,session.document.nativePreview.image);
  const png=await fs.readFile(edited.document.nativePreview.path);assert.equal(png.readUInt32BE(16),135);assert.equal(png.readUInt32BE(20),240);
  const undo=await api('ui_history',{sessionId:session.id,revision:1,action:'undo'});assert.equal(undo.status,200);assert.equal(undo.document.nativePreview.image,session.document.nativePreview.image);
  edited=await api('ui_history',{sessionId:session.id,revision:2,action:'redo'});assert.equal(edited.status,200);
  const bad=await api('apply_ui_operations',{sessionId:session.id,revision:3,operations:[{op:'canvas',changes:{width:300}}]});assert.equal(bad.status,400);
  const save=await api('save_ui_source',{sessionId:session.id,revision:3});assert.equal(save.status,200,JSON.stringify(save));
  assert.equal(save.snapshot.document.source.savedRevision,3);assert.deepEqual(await fs.readFile(path.join(save.backupDirectory,'Page_DialPlate.cpp')),before);
  const patched=iconv.decode(await fs.readFile(save.files[0]),'gbk');assert(patched.includes('UI_STUDIO_DialPlate_BEGIN'));assert(patched.includes('中文')||patched.includes('时间'));
  const reopened=await importWatchX(root,'DialPlate'),savedNode=reopened.nodes.find(n=>n.id===node.id);assert.equal(savedNode.text,'777');assert.equal(savedNode.x,actual.x);assert.equal(savedNode.y,actual.y);
  // Compile the generated firmware header with the legacy language level independently of the host shims.
  const include=path.join(root,'.ui-designer/watchx-host/include'),libraries=path.join(root,'WatchX/Libraries'),app=path.join(root,'WatchX/WatchX');
  await run('g++',['-std=c++98','-fsyntax-only','-x','c++','-DLV_CONF_INCLUDE_SIMPLE=1','-I'+include,'-I'+libraries,save.files[1]]);
  const decoded=path.join(root,'patched-dial.cpp');await fs.writeFile(decoded,patched.replace('../UIStudioGenerated/DialPlate.h',save.files[1].replaceAll('\\','/')));
  await run('g++',['-std=c++20','-fsyntax-only','-fpermissive','-w','-DLV_CONF_INCLUDE_SIMPLE=1','-I'+include,'-I'+libraries,'-I'+app,decoded]);
  // Link the patched source into the real LVGL host and check the saved geometry and text after setup.
  const host=path.join(root,'.ui-designer/watchx-host');await fs.copyFile(decoded,path.join(host,'pages/Page_DialPlate.cpp'));
  await run('cmake',['--build',path.join(host,'build'),'-j','8']);
  const savedTree=path.join(root,'saved-tree.json'),savedBmp=path.join(root,'saved.bmp');
  await run(path.join(host,'build/watchx_host.exe'),['DialPlate',savedTree,savedBmp,'unused']);
  const savedObject=JSON.parse(await fs.readFile(savedTree,'utf8')).find(n=>n.id===node.id);
  assert.equal(savedObject.x,actual.x);assert.equal(savedObject.y,actual.y);assert.equal(savedObject.text,'777');assert.equal(savedObject.color,'#00ff00');
  // Rebuilding after writeback must use the baseline and avoid nested instrumentation.
  await buildWatchX(root);const postBuild=await importWatchX(root,'DialPlate');assert.equal(postBuild.nodes.find(n=>n.id===node.id).text,'777');
  const repeated=await api('save_ui_source',{sessionId:session.id,revision:3});assert.equal(repeated.status,200);
  const headerBefore=await fs.readFile(save.files[1]);await fs.appendFile(save.files[0],'\r\n// external change\r\n');
  const refused=await api('save_ui_source',{sessionId:session.id,revision:3});assert.equal(refused.status,409);assert.deepEqual(await fs.readFile(save.files[1]),headerBefore);
  const doc=applyOperations(postBuild,[{op:'update',id:node.id,changes:{x:actual.x+2}}]);await assert.rejects(refreshWatchPreview(root,doc),/源文件已改变/);
  assert.equal(hash(await fs.readFile(path.join(source,'WatchX/WatchX/GUI/Page/Page_DialPlate.cpp'))),hash(before));
  console.log('WatchX isolated validation artifacts: '+root);
});
