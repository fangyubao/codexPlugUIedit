import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { newDocument,newNode,applyOperations } from '../src/model.mjs';

test('editor DOM events add, drag, resize and edit widgets through the revisioned API',async()=>{
  const html=(await fs.readFile(new URL('../web/editor.html',import.meta.url),'utf8')).replace('<script type="module">/* STUDIO_JS */</script>','');
  const dom=new JSDOM(html,{url:'http://127.0.0.1:9999/?session=test#token=sample',runScripts:'outside-only',pretendToBeVisual:true});
  const {window:w}=dom;w.structuredClone=structuredClone;w.setInterval=()=>0;w.setTimeout=()=>0;
  let state={id:'test',revision:0,projectPath:'test-project',document:newDocument(true),selectedIds:[],canUndo:false,canRedo:false};
  const calls=[];
  w.fetch=async(url,request)=>{
    const {action,args}=JSON.parse(request.body);calls.push({action,args});
    if(action==='select_ui_nodes')state.selectedIds=args.ids;
    if(action==='apply_ui_operations'){assert.equal(args.revision,state.revision);state={...state,revision:state.revision+1,document:applyOperations(state.document,args.operations),canUndo:true};}
    return{ok:true,json:async()=>structuredClone(state)};
  };
  let source=await fs.readFile(new URL('../web/editor.js',import.meta.url),'utf8');source=source.replace("import { App } from '@modelcontextprotocol/ext-apps';",'const App = null;');
  w.eval(source);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));await tick();
  const document=w.document;assert.equal(document.querySelectorAll('.widget').length,8);
  document.querySelector('.palette-item[data-type="button"]').click();await tick();
  assert.equal(state.document.nodes.length,9);const id=state.document.nodes.at(-1).id;
  assert.equal(state.selectedIds[0],id);
  document.getElementById('prop-text').value='真实属性修改';document.getElementById('prop-text').dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
  assert.equal(state.document.nodes.find(n=>n.id===id).text,'真实属性修改');
  // jsdom has no visual layout. UI zoom is .15 for a zero-sized viewport, so move 12 CSS px = 80 design px.
  const before=state.document.nodes.find(n=>n.id===id);
  document.querySelector(`.widget[data-id="${id}"]`).dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));
  w.dispatchEvent(new w.MouseEvent('pointermove',{clientX:32,clientY:26}));w.dispatchEvent(new w.MouseEvent('pointerup'));await tick();
  const moved=state.document.nodes.find(n=>n.id===id);assert.equal(moved.x,before.x+80);assert.equal(moved.y,before.y+40);
  document.querySelector(`.widget[data-id="${id}"] .handle.se`).dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));
  w.dispatchEvent(new w.MouseEvent('pointermove',{clientX:26,clientY:26}));w.dispatchEvent(new w.MouseEvent('pointerup'));await tick();
  assert.equal(state.document.nodes.find(n=>n.id===id).width,before.width+40);
  assert(calls.some(c=>c.action==='apply_ui_operations'));assert.equal(w.location.hash,'');
  dom.window.close();
});
test('unsupported project renders a report with no editable canvas and no phantom save',async()=>{
  const html=(await fs.readFile(new URL('../web/editor.html',import.meta.url),'utf8')).replace('<script type="module">/* STUDIO_JS */</script>','');
  const dom=new JSDOM(html,{url:'http://127.0.0.1:9999/?session=project_test#token=sample',runScripts:'outside-only',pretendToBeVisual:true});
  const {window:w}=dom;w.structuredClone=structuredClone;w.setInterval=()=>0;w.setTimeout=()=>0;
  const calls=[],report={id:'project_test',view:'project',projectPath:'mcu-project',inspection:{environment:{kind:'mcu'},languages:['C'],buildSystems:[{id:'keil-mdk'}],versions:[{package:'LVGL',major:8,version:'8.3.11'}],conflicts:[],truncated:false,warnings:[],qtUiFiles:[],frameworks:[{framework:'lvgl',importedProject:{import:'unsupported',preview:'unsupported',edit:'unsupported',writeBack:'unsupported'},previewPlan:'需要 MCU 显示端口适配',dependencies:['LVGL 8'],blockers:['源码编辑尚未实现'],evidence:[{file:'ui.c',description:'LVGL API'}]}]}};
  w.fetch=async(url,request)=>{calls.push(JSON.parse(request.body));return{ok:true,json:async()=>structuredClone(report)};};
  const source=(await fs.readFile(new URL('../web/editor.js',import.meta.url),'utf8')).replace("import { App } from '@modelcontextprotocol/ext-apps';",'const App=null;');w.eval(source);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.document.getElementById('project-report').hidden,false);assert(w.document.getElementById('project-report').textContent.includes('8.3.11'));
  assert.equal(w.document.getElementById('save-state').textContent,'尚未导入界面');assert.equal(w.document.getElementById('export').disabled,true);
  w.document.querySelector('.palette-item[data-type="button"]').click();w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));
  await new Promise(resolve=>setImmediate(resolve));assert(!calls.some(c=>c.action==='apply_ui_operations'||c.action==='select_ui_nodes'));dom.window.close();
});

test('WatchX editor uses native image, drags mapped objects, switches pages and saves source',async()=>{
  const html=(await fs.readFile(new URL('../web/editor.html',import.meta.url),'utf8')).replace('<script type="module">/* STUDIO_JS */</script>','');
  const dom=new JSDOM(html,{url:'http://127.0.0.1:9999/?session=watch#token=sample',runScripts:'outside-only',pretendToBeVisual:true});
  const{window:w}=dom;w.structuredClone=structuredClone;w.setInterval=()=>0;w.setTimeout=()=>0;
  const doc=newDocument();doc.canvas={width:135,height:240,background:'#000000',grid:1};doc.source={kind:'watchx-lvgl6',page:'DialPlate',savedRevision:null};doc.nativePreview={image:'data:image/png;base64,iVBORw0KGgo='};
  doc.nodes=[newNode('label',{id:'root_1',name:'steps',text:'1255',x:10,y:20,width:50,height:26,nativeKind:'lv_label',sourceRef:{line:55,instance:0}})];
  let state={id:'watch',revision:0,projectPath:'WatchX',contentKind:'imported-watchx',document:doc,selectedIds:[],canUndo:false,canRedo:false};const calls=[];
  w.fetch=async(url,request)=>{const{action,args}=JSON.parse(request.body);calls.push({action,args});if(action==='select_ui_nodes')state.selectedIds=args.ids;if(action==='apply_ui_operations')state={...state,revision:state.revision+1,document:applyOperations(state.document,args.operations)};if(action==='open_ui_editor')state={...state,document:{...state.document,source:{...state.document.source,page:args.page}}};if(action==='save_ui_source'){state.document.source.savedRevision=state.revision;return{ok:true,json:async()=>({page:'DialPlate',snapshot:structuredClone(state)})};}return{ok:true,json:async()=>structuredClone(state)};};
  w.eval((await fs.readFile(new URL('../web/editor.js',import.meta.url),'utf8')).replace("import { App } from '@modelcontextprotocol/ext-apps';",'const App=null;'));
  const tick=()=>new Promise(resolve=>setImmediate(resolve));await tick();const d=w.document;
  assert(d.getElementById('app').classList.contains('native-watchx'));assert(d.getElementById('canvas').style.backgroundImage.includes('data:image/png'));
  assert.equal(d.querySelector('.palette-item').disabled,true);assert.equal(d.getElementById('delete').disabled,true);assert.equal(d.getElementById('save-source').hidden,false);
  d.querySelector('.layer-row').click();await tick();assert.equal(d.getElementById('prop-fontSize').disabled,true);
  d.querySelector('.widget').dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));w.dispatchEvent(new w.MouseEvent('pointermove',{clientX:23,clientY:26}));w.dispatchEvent(new w.MouseEvent('pointerup'));await tick();
  assert.equal(state.document.nodes[0].x,30);assert.equal(state.document.nodes[0].y,60);
  d.getElementById('save-source').click();await tick();assert.equal(d.getElementById('save-state').textContent,'已保存到工程');
  d.getElementById('watchx-page').value='MainMenu';d.getElementById('watchx-page').dispatchEvent(new w.Event('change'));await tick();assert(calls.some(c=>c.action==='open_ui_editor'&&c.args.page==='MainMenu'));
  assert(calls.some(c=>c.action==='save_ui_source'&&c.args.revision===1));dom.window.close();
});
