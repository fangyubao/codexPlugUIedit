import { App } from '@modelcontextprotocol/ext-apps';

const $=id=>document.getElementById(id);
const specs={frame:['▢','容器',280,180],label:['T','文字',180,32],button:['▣','按钮',128,42],input:['▤','输入框',240,42],checkbox:['☑','复选框',160,32],slider:['☷','滑块',220,32],progress:['▰','进度条',220,24]};
let snapshot=null, selected=[], zoom=1, busy=false, dragging=null, polling=false, bridge=null, sessionId=new URLSearchParams(location.search).get('session');
let projectReport=null;
let token=new URLSearchParams(location.hash.slice(1)).get('token');
if(token){sessionStorage.setItem('ui-studio-token',token);history.replaceState(null,'',location.pathname+location.search);}else token=sessionStorage.getItem('ui-studio-token');
const viaHttp=location.hostname==='127.0.0.1' || location.hostname==='localhost';
let toastTimer;
function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?7000:4000);}
async function call(name,args){
  if(viaHttp){const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:name,args})});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}
  if(!bridge)throw new Error('等待 Codex 连接');
  const result=await bridge.callServerTool({name,arguments:args});if(result.isError)throw new Error(result.structuredContent?.error || result.content?.[0]?.text || '操作失败');return result.structuredContent;
}
function accept(next,{fit=false}={}){
  if(next?.view==='project'){showProjectReport(next);return;}
  if(!next?.document)return;snapshot=next;sessionId=next.id;selected=next.selectedIds || selected;selected=selected.filter(id=>next.document.nodes.some(n=>n.id===id));
  projectReport=null;$('app').classList.remove('report-open');$('project-report').hidden=true;
  const watchx=next.document.source?.kind==='watchx-lvgl6';$('app').classList.toggle('native-watchx',watchx);$('watchx-pages').hidden=!watchx;$('save-source').hidden=!watchx;$('export').hidden=watchx;$('native-preview').hidden=watchx;
  if(watchx)$('watchx-page').value=next.document.source.page;
  for(const button of document.querySelectorAll('.palette-item'))button.disabled=watchx;
  for(const button of document.querySelectorAll('.toolbar button'))button.disabled=false;
  $('welcome').hidden=true;$('export').disabled=next.document.readOnly;$('native-preview').disabled=!!next.document.source||next.document.readOnly;$('agent-request').disabled=false;
  $('project-title').textContent=next.document.title;$('save-state').textContent=(next.contentKind==='studio-design'?'独立设计 · ':'')+'已自动保存';
  if(watchx)$('save-state').textContent=next.document.source.savedRevision===next.revision?'已保存到工程':'设计已保存 · 待写回工程';
  $('connection').textContent=bridge?'Codex 已连接':'本地已连接';$('revision').textContent=`r${next.revision}`;
  $('warning').hidden=!next.document.warnings.length;$('warning').textContent=next.document.warnings.join(' ');
  $('duplicate').disabled=watchx;$('delete').disabled=watchx;
  $('undo').disabled=!next.canUndo;$('redo').disabled=!next.canRedo;
  if(fit)fitCanvas(false);render();
}
async function refresh(){if(!sessionId||projectReport||busy||dragging||polling||document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;polling=true;try{const next=await call('get_ui_document',{sessionId});if(!snapshot||next.revision!==snapshot.revision||next.document?.source?.savedRevision!==snapshot.document.source?.savedRevision||JSON.stringify(next.selectedIds)!==JSON.stringify(selected))accept(next);$('connection').textContent=bridge?'Codex 已连接':'本地已连接';}catch(e){$('connection').textContent='连接中断';}finally{polling=false;}}
async function commit(operations){if(!snapshot||busy)return;if(snapshot.document.readOnly){toast('当前导入表单仅可查看',true);return;}busy=true;$('save-state').textContent='正在保存…';try{accept(await call('apply_ui_operations',{sessionId,revision:snapshot.revision,operations}));}catch(e){toast(e.message,true);try{accept(await call('get_ui_document',{sessionId}));}catch{} }finally{busy=false;}}
function setSelection(ids){if(!snapshot)return;selected=[...new Set(ids)];render();if(sessionId)call('select_ui_nodes',{sessionId,ids:selected}).catch(e=>toast(e.message,true));if(bridge)bridge.updateModelContext({content:[{type:'text',text:JSON.stringify({sessionId,revision:snapshot?.revision,selectedIds:selected})}]}).catch(()=>{});}
function fitCanvas(renderAfter=true){const c=snapshot?.document.canvas;if(!c)return;zoom=Math.max(.15,Math.min(snapshot.document.source?.kind==='watchx-lvgl6'?3:1,($('workspace').clientWidth-60)/c.width,($('workspace').clientHeight-110)/c.height));if(renderAfter)render();}
function nodeById(id){return snapshot.document.nodes.find(n=>n.id===id);}
function absolute(node){let x=node.x,y=node.y,current=node;while(current.parentId){current=nodeById(current.parentId);if(!current)break;x+=current.x;y+=current.y;}return{x,y};}
function hasSelectedAncestor(node){let p=node.parentId;while(p){if(selected.includes(p))return true;p=nodeById(p)?.parentId;}return false;}
function elt(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
const frameworkNames={'qt-widgets':'Qt Widgets','qt-python':'PySide / PyQt','qt-quick':'Qt Quick / QML',lvgl:'LVGL',tkinter:'Tkinter',imgui:'Dear ImGui',osd:'OSD / 图层叠加','custom-lcd':'直接 LCD 绘图'};
function showProjectReport(report){
  projectReport=report;snapshot=null;selected=[];sessionId=report.id;
  $('app').classList.remove('native-watchx');$('watchx-pages').hidden=true;$('save-source').hidden=true;$('export').hidden=false;$('native-preview').hidden=false;
  $('app').classList.add('report-open');$('project-report').hidden=false;$('welcome').hidden=true;
  $('project-title').textContent='工程检查';$('save-state').textContent='尚未导入界面';$('revision').textContent='';$('warning').hidden=true;
  $('connection').textContent=bridge?'Codex 已连接':'本地已连接';
  for(const button of document.querySelectorAll('.toolbar button'))button.disabled=true;
  for(const id of ['export','native-preview','agent-request'])$(id).disabled=true;
  const area=$('project-report'),inspection=report.inspection;area.replaceChildren();
  area.append(elt('h1','report-title','先了解这个工程'),elt('p','report-path',report.projectPath),elt('p','report-lead','这里是工程检查结果，尚未载入原界面。框架识别、预览、编辑和写回源码的支持情况分别列在下方。'));
  const summary=elt('div','report-summary');
  for(const text of [`运行目标：${{mcu:'MCU',host:'宿主 / 桌面',mixed:'多个目标',unknown:'待确认'}[inspection.environment.kind]}`,`语言：${inspection.languages.join(' / ')||'待确认'}`,`构建：${inspection.buildSystems.map(b=>b.id).join(' / ')||'待确认'}`])summary.append(elt('span','report-badge',text));
  area.append(summary);
  if(inspection.versions.length)area.append(elt('p','report-lead','发现版本：'+inspection.versions.map(v=>`${v.package} ${v.version||v.major||'待确认'}`).join('、')));
  if(inspection.environment.targets?.length){const details=elt('details','report-card');details.append(elt('summary','','平台与硬件依据'));for(const target of inspection.environment.targets)for(const e of target.evidence)details.append(elt('p','',`${target.id} · ${e.description} — ${e.file}`));for(const fact of inspection.displayFacts||[])details.append(elt('p','',`${fact.key} = ${fact.value} — ${fact.file}`));area.append(details);}
  if(inspection.conflicts.length||inspection.truncated||inspection.warnings.length)area.append(elt('div','report-note',[...inspection.conflicts,...inspection.warnings,...(inspection.truncated?['扫描未覆盖全部文件：'+inspection.scan.omittedReasons.join('、')]:[])].join('\n')));
  for(const framework of inspection.frameworks){
    const card=elt('div','report-card');card.append(elt('h3','',frameworkNames[framework.framework]||framework.framework));
    const capabilities=elt('div','report-capabilities');
    for(const[key,label]of [['import','导入'],['preview','预览'],['edit','编辑'],['writeBack','写回']])capabilities.append(elt('span','',label+'：'+(framework.importedProject[key]==='conditional'?'需逐文件验证':'尚未实现')));
    card.append(capabilities,elt('p','',framework.previewPlan),elt('p','','依赖：'+framework.dependencies.join('；')));
    for(const blocker of framework.blockers)card.append(elt('p','','• '+blocker));
    const details=elt('details');details.append(elt('summary','','识别依据'));
    for(const evidence of framework.evidence)details.append(elt('div','',evidence.file+' — '+evidence.description));card.append(details);area.append(card);
  }
  if(!inspection.frameworks.length){const card=elt('div','report-card');card.append(elt('h3','','需要识别图形库'),elt('p','','暂未找到已知 UI 框架。这可能是其他图形库、生成代码或工程入口不在本目录，需要继续检查并接入适配器。'));area.append(card);}
  if(inspection.qtUiFiles.length){const card=elt('div','report-card');card.append(elt('h3','','可单独检查的 Qt 表单'),elt('p','','这些是候选文件。打开单个表单不代表整个工程已导入。'));
    for(const sourceFile of inspection.qtUiFiles){const button=elt('button','',sourceFile);button.onclick=async()=>{button.disabled=true;try{const next=await call('open_ui_editor',{projectPath:report.projectPath,sourceFile});accept(next,{fit:true});if(viaHttp)history.replaceState(null,'','/?session='+next.id);}catch(e){toast(e.message,true);}finally{button.disabled=false;}};card.append(button);}area.append(card);}
  const bottom=elt('div','report-bottom'),recheck=elt('button','','重新检查工程'),create=elt('button','','在此目录新建独立设计');
  recheck.onclick=async()=>{recheck.disabled=true;try{accept(await call('open_ui_editor',{projectPath:report.projectPath,mode:'auto'}));}catch(e){toast(e.message,true);}finally{recheck.disabled=false;}};
  create.onclick=()=>{openProjectDialog();$('project-mode').value='new';$('project-mode').dispatchEvent(new Event('change'));};
  bottom.append(recheck,create,elt('span','','新建设计会单独保存，不会转换原工程。'));area.append(bottom);
}
function render(){if(!snapshot)return;const doc=snapshot.document;const canvas=$('canvas');canvas.replaceChildren();canvas.style.width=doc.canvas.width+'px';canvas.style.height=doc.canvas.height+'px';canvas.style.background=doc.canvas.background;canvas.style.transform=`scale(${zoom})`;
  if(doc.nativePreview?.image){canvas.style.backgroundImage=`url("${doc.nativePreview.image}")`;canvas.style.backgroundSize='100% 100%';}else canvas.style.backgroundImage='none';
  $('workspace').querySelector('.workspace-hint').textContent=doc.source?.kind==='watchx-lvgl6'?'选择图层或画面对象后拖动；每次修改重新调用原 LVGL 渲染。完成后点击“保存回工程”。':'从左侧拖入控件，选择后拖动边框调整大小';
  $('canvas-wrap').style.width=doc.canvas.width*zoom+'px';$('canvas-wrap').style.height=doc.canvas.height*zoom+'px';$('canvas-name').textContent=doc.title;$('canvas-size').textContent=`${doc.canvas.width} × ${doc.canvas.height}`;$('zoom-fit').textContent=Math.round(zoom*100)+'%';
  const byParent=new Map();for(const n of doc.nodes){const key=n.parentId||'';if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(n);}
  function addNodes(parentEl,parentId){for(const n of byParent.get(parentId||'')||[]){const w=elt('div',`widget kind-${n.type}${selected.includes(n.id)?' selected':''}${n.locked?' locked':''}${!n.visible?' hidden-node':''}`);w.dataset.id=n.id;w.title=`${n.name} · ${n.id}`;
    Object.assign(w.style,{left:n.x+'px',top:n.y+'px',width:n.width+'px',height:n.height+'px',background:n.background,color:n.color,border:`${['label','checkbox','slider'].includes(n.type)?0:1}px solid ${n.border}`,borderRadius:n.radius+'px',fontSize:n.fontSize+'px'});
    if(doc.source?.kind==='watchx-lvgl6'){/* Native bitmap is drawn beneath transparent hit-test objects. */}
    else if(n.type==='checkbox'){w.append(elt('span','fake-check'+(n.checked?' checked':''),n.checked?'✓':''),elt('span','widget-text',n.text));}
    else if(n.type==='slider'){const track=elt('div','slider-track'),fill=elt('div','slider-fill'),thumb=elt('span','slider-thumb');fill.style.width=n.value+'%';thumb.style.left=n.value+'%';track.append(fill,thumb);w.append(track);}
    else if(n.type==='progress'){const fill=elt('div','progress-fill');fill.style.width=n.value+'%';w.append(fill);}
    else if(n.type!=='frame')w.append(elt('span','widget-text',n.text));
    if(selected.includes(n.id)&&selected.length===1&&!n.locked&&!doc.readOnly)for(const dir of ['nw','ne','sw','se']){const h=elt('span','handle '+dir);h.dataset.handle=dir;h.setAttribute('aria-label','调整'+dir+'角大小');w.append(h);}
    parentEl.append(w);addNodes(w,n.id);
  }}addNodes(canvas,null);renderLayers();renderInspector();
}
function renderLayers(){const container=$('layers');container.replaceChildren();$('layer-count').textContent=snapshot.document.nodes.length;function walk(parentId,depth){for(const n of snapshot.document.nodes.filter(n=>n.parentId===parentId)){const row=elt('div','layer-row'+(selected.includes(n.id)?' selected':''));row.style.paddingLeft=9+depth*12+'px';row.dataset.layerId=n.id;row.append(elt('span','',specs[n.type][0]),elt('span','layer-text',n.name),elt('span','layer-meta',n.locked?'🔒':!n.visible?'◌':''));row.addEventListener('click',e=>setSelection(e.shiftKey?[...selected,n.id]:[n.id]));container.append(row);walk(n.id,depth+1);}}walk(null,0);if(!snapshot.document.nodes.length)container.append(elt('div','empty-note','拖一个控件到画布吧'));}
function field(parent,label,value,key,opts={}){const wrap=elt('div','property-field');const id='prop-'+key;const lab=elt('label','prop-label',label);lab.htmlFor=id;const input=elt(opts.multiline?'textarea':'input');input.id=id;input.value=value??'';if(!opts.multiline)input.type=opts.numeric?'number':'text';if(opts.numeric)input.step='1';input.disabled=snapshot.document.readOnly || opts.disabled===true;input.addEventListener('change',()=>{const value=opts.numeric?Number(input.value):input.value;opts.onChange(value);});wrap.append(lab,input);parent.append(wrap);return input;}
function colorField(parent,label,value,key,onChange){const wrap=elt('div','property-field');wrap.append(elt('div','prop-label',label));const row=elt('div','property-color'),color=elt('input'),text=elt('input');color.type='color';color.value=value;text.value=value;text.setAttribute('aria-label',label);color.setAttribute('aria-label',label+'颜色');color.disabled=text.disabled=snapshot.document.readOnly;color.addEventListener('change',()=>onChange(color.value));text.addEventListener('change',()=>onChange(text.value));row.append(color,text);wrap.append(row);parent.append(wrap);}
function check(parent,label,value,onChange){const lab=elt('label','checkline'),input=elt('input');input.type='checkbox';input.checked=value;input.disabled=snapshot.document.readOnly;input.addEventListener('change',()=>onChange(input.checked));lab.append(input,document.createTextNode(label));parent.append(lab);}
function renderInspector(){const panel=$('inspector');panel.replaceChildren();$('selection-count').textContent=selected.length?`${selected.length} 个对象`:'画布';
  if(selected.length===0){const doc=snapshot.document,update=(key,value)=>commit([{op:'canvas',changes:{[key]:value}}]);if(doc.source?.kind==='watchx-lvgl6'){panel.append(elt('div','inspector-note','原屏幕 135 × 240。使用图层列表选择嵌套控件，可修改位置、尺寸、文本与颜色。字体保留工程资源；当前版本暂不支持新增或删除已有源码控件。'));return;}field(panel,'界面名称',doc.title,'title',{onChange:v=>update('title',v)});const grid=elt('div','property-grid');panel.append(grid);for(const [key,label]of [['width','宽度'],['height','高度']])field(grid,label,doc.canvas[key],'canvas-'+key,{numeric:true,onChange:v=>update(key,v)});colorField(panel,'画布颜色',doc.canvas.background,'canvas-color',v=>update('background',v));field(panel,'吸附网格 / px',doc.canvas.grid,'grid',{numeric:true,onChange:v=>update('grid',v)});panel.append(elt('div','inspector-note','选择控件后，可以在这里精确设置位置、尺寸和外观。'));return;}
  if(selected.length>1){panel.append(elt('div','inspector-note',`已选择 ${selected.length} 个控件。可拖动整体位置，或使用工具栏左对齐、顶对齐。`));return;}
  const n=nodeById(selected[0]);if(!n)return;const update=(key,value)=>commit([{op:'update',id:n.id,changes:{[key]:value}}]);
  field(panel,'图层名称',n.name,'name',{onChange:v=>update('name',v),disabled:n.locked});panel.append(elt('div','inspector-note',`${specs[n.type][1]} · ${n.id}`));
  const section=elt('div','inspector-section');section.append(elt('div','section-title','位置与尺寸'));const grid=elt('div','property-grid');section.append(grid);for(const key of ['x','y','width','height'])field(grid,{x:'X',y:'Y',width:'宽度',height:'高度'}[key],n[key],key,{numeric:true,onChange:v=>update(key,v),disabled:n.locked});panel.append(section);
  if(!['frame','slider','progress'].includes(n.type))field(panel,'显示文字',n.text,'text',{multiline:true,onChange:v=>update('text',v),disabled:n.locked});
  if(!snapshot.document.source&&['slider','progress'].includes(n.type))field(panel,'数值 / 0–100',n.value,'value',{numeric:true,onChange:v=>update('value',v),disabled:n.locked});
  const style=elt('div','inspector-section');style.append(elt('div','section-title','外观'));panel.append(style);for(const [key,label]of [['background','背景'],['color','文字'],['border','边框']])colorField(style,label,n[key],key,v=>update(key,v));
  const sizes=elt('div','property-grid');style.append(sizes);for(const [key,label]of [['radius','圆角'],['fontSize','字号']])field(sizes,label,n[key],key,{numeric:true,onChange:v=>update(key,v),disabled:n.locked||(key==='fontSize'&&snapshot.document.source?.kind==='watchx-lvgl6')});
  if(n.sourceRef?.line)panel.append(elt('div','inspector-note',`${n.nativeKind} · 源码第 ${n.sourceRef.line} 行 · 实例 ${n.sourceRef.instance}`));
  if(n.type==='checkbox')check(panel,'默认选中',n.checked,v=>update('checked',v));check(panel,'锁定位置和属性',n.locked,v=>update('locked',v));check(panel,'运行时显示',n.visible,v=>update('visible',v));
  if(!snapshot.document.source){const label=elt('label','prop-label','父容器'),select=elt('select');select.style.width='100%';select.setAttribute('aria-label','父容器');const options=[{id:'',name:'画布'},...snapshot.document.nodes.filter(x=>x.type==='frame'&&x.id!==n.id)];for(const p of options){const o=elt('option','',p.name);o.value=p.id;select.append(o);}select.value=n.parentId||'';select.disabled=n.locked;select.onchange=()=>{const abs=absolute(n),parent=select.value?absolute(nodeById(select.value)):{x:0,y:0};commit([{op:'update',id:n.id,changes:{parentId:select.value||null,x:abs.x-parent.x,y:abs.y-parent.y}}]);};panel.append(elt('div','inspector-section'),label,select);
    const front=elt('button','small-button','移到最上层');front.onclick=()=>commit([{op:'reorder',ids:[...snapshot.document.nodes.filter(x=>x.id!==n.id).map(x=>x.id),n.id]}]);panel.append(front);}
}
function snap(value){const grid=snapshot?.document.canvas.grid||8;return $('snap').checked?Math.round(value/grid)*grid:Math.round(value);}
function canvasPoint(e){const rect=$('canvas').getBoundingClientRect();return{x:(e.clientX-rect.left)/zoom,y:(e.clientY-rect.top)/zoom};}
async function addWidget(type,x,y,parentId=null){if(!snapshot)return;if(snapshot.document.source){toast('导入表单暂只支持修改已有控件',true);return;}const id='w_'+crypto.randomUUID().replaceAll('-','').slice(0,12);await commit([{op:'add',node:{id,type,x:snap(x),y:snap(y),parentId}}]);if(snapshot.document.nodes.some(n=>n.id===id))setSelection([id]);}
for(const [type,[icon,name,w,h]]of Object.entries(specs)){const button=elt('button','palette-item');button.type='button';button.draggable=true;button.dataset.type=type;button.title=`拖入${name}，或点击添加`;button.append(elt('span','palette-icon',icon),elt('span','',name));button.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-ui-studio',type);e.dataTransfer.effectAllowed='copy';});button.onclick=()=>addWidget(type,40+(snapshot?.document.nodes.length||0)%8*16,40+(snapshot?.document.nodes.length||0)%8*16);$('palette').append(button);}
$('canvas').addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';$('canvas').classList.add('drop-target');});$('canvas').addEventListener('dragleave',()=>$('canvas').classList.remove('drop-target'));
$('canvas').addEventListener('drop',e=>{e.preventDefault();$('canvas').classList.remove('drop-target');const type=e.dataTransfer.getData('application/x-ui-studio');if(!specs[type])return;const p=canvasPoint(e),target=e.target.closest('.kind-frame'),parent=target?nodeById(target.dataset.id):null,offset=parent?absolute(parent):{x:0,y:0};if(parent?.locked){toast('容器已锁定',true);return;}addWidget(type,p.x-offset.x,p.y-offset.y,parent?.id||null);});
$('canvas').addEventListener('pointerdown',e=>{if(e.button!==0||busy||!snapshot)return;const widget=e.target.closest('.widget'),handle=e.target.closest('.handle')?.dataset.handle,p=canvasPoint(e);
  if(!widget){if(!e.shiftKey)setSelection([]);dragging={mode:'marquee',start:p,base:selected.slice()};return;}
  e.preventDefault();const id=widget.dataset.id,n=nodeById(id);
  if(e.shiftKey){setSelection(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]);return;}
  if(!selected.includes(id))setSelection([id]);if(n.locked||snapshot.document.readOnly)return;
  const movable=selected.map(nodeById).filter(n=>n&&!n.locked&&!hasSelectedAncestor(n));
  dragging={mode:handle?'resize':'move',handle,start:p,nodes:structuredClone(handle?[n]:movable),revision:snapshot.revision};
});
window.addEventListener('pointermove',e=>{if(!dragging)return;const p=canvasPoint(e),dx=p.x-dragging.start.x,dy=p.y-dragging.start.y;
  if(dragging.mode==='marquee'){let box=$('canvas').querySelector('.selection-box');if(!box){box=elt('div','selection-box');$('canvas').append(box);}Object.assign(box.style,{left:Math.min(p.x,dragging.start.x)+'px',top:Math.min(p.y,dragging.start.y)+'px',width:Math.abs(dx)+'px',height:Math.abs(dy)+'px'});dragging.end=p;return;}
  dragging.changes=dragging.nodes.map(n=>{let changes;
    if(dragging.mode==='move')changes={x:snap(n.x+dx),y:snap(n.y+dy)};
    else{let x=n.x,y=n.y,width=n.width,height=n.height;const dir=dragging.handle;if(dir.includes('e'))width=Math.max(8,snap(n.width+dx));if(dir.includes('s'))height=Math.max(8,snap(n.height+dy));if(dir.includes('w')){x=Math.min(n.x+n.width-8,snap(n.x+dx));width=n.width+n.x-x;}if(dir.includes('n')){y=Math.min(n.y+n.height-8,snap(n.y+dy));height=n.height+n.y-y;}changes={x,y,width,height};}
    const el=$('canvas').querySelector(`[data-id="${n.id}"]`);if(el)for(const[k,v]of Object.entries(changes))el.style[{x:'left',y:'top',width:'width',height:'height'}[k]]=v+'px';return{op:'update',id:n.id,changes};});
});
window.addEventListener('pointerup',()=>{if(!dragging)return;const operation=dragging;dragging=null;
  if(operation.mode==='marquee'){if(operation.end){const a=operation.start,b=operation.end,left=Math.min(a.x,b.x),top=Math.min(a.y,b.y),right=Math.max(a.x,b.x),bottom=Math.max(a.y,b.y);const ids=snapshot.document.nodes.filter(n=>{const p=absolute(n);return p.x>=left&&p.y>=top&&p.x+n.width<=right&&p.y+n.height<=bottom;}).map(n=>n.id);setSelection([...operation.base,...ids]);}else render();return;}
  if(operation.changes?.some(op=>Object.entries(op.changes).some(([k,v])=>nodeById(op.id)[k]!==v)))commit(operation.changes);else render();
});
window.addEventListener('pointercancel',()=>{dragging=null;render();});window.addEventListener('blur',()=>{if(dragging){dragging=null;render();}});
async function historyAction(action){if(!snapshot||busy)return;busy=true;try{accept(await call('ui_history',{sessionId,revision:snapshot.revision,action}));}catch(e){toast(e.message,true);try{accept(await call('get_ui_document',{sessionId}));}catch{}}finally{busy=false;}}
$('undo').onclick=()=>historyAction('undo');$('redo').onclick=()=>historyAction('redo');
$('zoom-in').onclick=()=>{if(!snapshot)return;zoom=Math.min(snapshot.document.source?.kind==='watchx-lvgl6'?3:2,zoom+.1);render();};$('zoom-out').onclick=()=>{if(!snapshot)return;zoom=Math.max(.15,zoom-.1);render();};$('zoom-fit').onclick=()=>fitCanvas();
function align(axis){if(selected.length<2){toast('按住 Shift 选择至少两个控件');return;}const nodes=selected.map(nodeById).filter(n=>!n.locked&&!hasSelectedAncestor(n));if(!nodes.length)return;const goal=Math.min(...nodes.map(n=>absolute(n)[axis]));commit(nodes.map(n=>({op:'update',id:n.id,changes:{[axis]:n[axis]+goal-absolute(n)[axis]}})));}
$('align-left').onclick=()=>align('x');$('align-top').onclick=()=>align('y');
function removeSelected(){if(snapshot?.document.source)return;if(selected.length)commit([{op:'remove',ids:selected}]);}
async function duplicate(){if(!snapshot||snapshot.document.source||!selected.length)return;const all=new Set(selected);let change=true;while(change){change=false;for(const n of snapshot.document.nodes)if(all.has(n.parentId)&&!all.has(n.id)){all.add(n.id);change=true;}}const originals=snapshot.document.nodes.filter(n=>all.has(n.id));const ids=Object.fromEntries(originals.map(n=>[n.id,'w_'+crypto.randomUUID().replaceAll('-','').slice(0,12)]));const nodes=originals.map(n=>({...n,id:ids[n.id],name:n.name+' 副本',parentId:ids[n.parentId]||n.parentId,x:n.x+(ids[n.parentId]?0:16),y:n.y+(ids[n.parentId]?0:16),locked:false}));await commit(nodes.map(node=>({op:'add',node})));if(nodes.every(n=>nodeById(n.id)))setSelection(selected.map(id=>ids[id]));}
$('duplicate').onclick=duplicate;$('delete').onclick=removeSelected;
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.querySelector('dialog[open]'))return;const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();historyAction(e.shiftKey?'redo':'undo');}else if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();historyAction('redo');}else if(mod&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();}else if(mod&&e.key.toLowerCase()==='a'&&snapshot){e.preventDefault();setSelection(snapshot.document.nodes.map(n=>n.id));}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelected();}else if(e.key==='Escape')setSelection([]);else if(e.key.startsWith('Arrow')&&selected.length){e.preventDefault();const delta=e.shiftKey?10:1,dx=e.key==='ArrowRight'?delta:e.key==='ArrowLeft'?-delta:0,dy=e.key==='ArrowDown'?delta:e.key==='ArrowUp'?-delta:0;const ops=selected.map(nodeById).filter(n=>!n.locked&&!hasSelectedAncestor(n)).map(n=>({op:'update',id:n.id,changes:{x:n.x+dx,y:n.y+dy}}));if(ops.length)commit(ops);}});
$('tab-properties').onclick=()=>{$('app').classList.add('show-properties');$('tab-properties').classList.add('active');$('tab-components').classList.remove('active');};$('tab-components').onclick=()=>{$('app').classList.remove('show-properties');$('tab-components').classList.add('active');$('tab-properties').classList.remove('active');};
function openProjectDialog(){if(snapshot||projectReport)$('project-path').value=(snapshot||projectReport).projectPath;$('detection').hidden=true;$('project-dialog').showModal();}
$('open-project').onclick=openProjectDialog;$('welcome-open').onclick=openProjectDialog;for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
$('project-mode').onchange=()=>{const form=$('project-form'),create=$('project-mode').value==='new';form.elements.sourceFile.disabled=create;form.elements.demo.disabled=!create;if(create)form.elements.sourceFile.value='';else form.elements.demo.checked=false;};
$('inspect-project').onclick=async()=>{const projectPath=$('project-path').value.trim();if(!projectPath)return;try{$('detection').hidden=false;$('detection').textContent='正在识别…';const result=await call('inspect_ui_project',{projectPath});$('detection').textContent=`运行目标：${result.environment.kind}\n`+(result.frameworks.length?result.frameworks.map(f=>`${frameworkNames[f.framework]||f.framework}\n${f.editable}\n依赖：${f.dependencies.join('、')}`).join('\n\n'):'未发现已知 UI 框架，需要继续检查工程入口。')+(result.truncated?'\n扫描未覆盖全部文件。':'');}catch(e){$('detection').textContent=e.message;}};
$('project-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const fields=new FormData(e.target);busy=true;const button=e.submitter||e.target.querySelector('[type="submit"]');button.disabled=true;try{const next=await call('open_ui_editor',{projectPath:fields.get('projectPath').trim(),mode:fields.get('mode'),sourceFile:fields.get('sourceFile')?.trim()||undefined,demo:fields.get('demo')==='on'});selected=[];accept(next,{fit:true});if(viaHttp)history.replaceState(null,'','/?session='+next.id);$('project-dialog').close();}catch(e){toast(e.message,true);}finally{busy=false;button.disabled=false;}};
$('export').onclick=()=>{if(!snapshot)return;$('export-target').value=snapshot.document.target;$('export-result').hidden=true;$('export-dialog').showModal();};
$('perform-export').onclick=async()=>{if(!snapshot)return;const b=$('perform-export');b.disabled=true;try{const result=await call('export_ui_project',{sessionId,revision:snapshot.revision,target:$('export-target').value});$('export-result').hidden=false;$('export-result').textContent=`已生成 ${result.files.length} 个文件\n${result.directory}\n\n${result.files.join('\n')}${result.warnings.length?'\n\n'+result.warnings.join('\n'):''}`;toast('已导出到工程目录');}catch(e){toast(e.message,true);}finally{b.disabled=false;}};
$('save-source').onclick=async()=>{if(!snapshot||busy)return;busy=true;$('save-source').disabled=true;try{const result=await call('save_ui_source',{sessionId,revision:snapshot.revision});accept(result.snapshot);toast(`已保存回 ${result.page}，原文件已备份`);}catch(e){toast(e.message,true);}finally{busy=false;$('save-source').disabled=false;}};
$('watchx-page').onchange=async()=>{if(!snapshot||busy)return;busy=true;$('watchx-page').disabled=true;try{const next=await call('open_ui_editor',{projectPath:snapshot.projectPath,page:$('watchx-page').value});accept(next,{fit:true});if(viaHttp)history.replaceState(null,'','/?session='+next.id);}catch(e){toast(e.message,true);}finally{busy=false;$('watchx-page').disabled=false;}};
let activePreview=null;
$('native-preview').onclick=async()=>{if(!snapshot){toast('先打开工程');return;}if(busy){toast('请等待保存完成');return;}$('preview-image').hidden=true;$('preview-state').textContent='正在准备工程独立的 Qt 运行环境…';$('preview-dialog').showModal();try{const job=await call('render_ui_preview',{sessionId,revision:snapshot.revision});activePreview=job.jobId;pollPreview();}catch(e){$('preview-state').textContent=e.message;}};
async function pollPreview(){if(!activePreview||!$('preview-dialog').open)return;try{const result=await call('get_ui_preview',{jobId:activePreview,includeImage:true});$('preview-state').textContent=result.message;if(result.state==='complete'){$('preview-image').src=result.imageDataUrl;$('preview-image').hidden=false;$('preview-state').textContent=`Qt ${result.qtVersion} · 文档 r${result.revision} 的原生渲染`;activePreview=null;}else if(result.state==='failed')activePreview=null;else setTimeout(pollPreview,1500);}catch(e){$('preview-state').textContent=e.message;}}
$('agent-request').onclick=()=>{if(!snapshot){toast('先打开一个工程');return;}$('agent-context').textContent=selected.length?`选中：${selected.map(id=>nodeById(id).name).join('、')}。Codex 会读取最新设计再修改。`:'将对当前画布提出修改。';$('send-agent').textContent=bridge?'发送给 Codex':'复制到对话';$('agent-copy').hidden=true;$('agent-dialog').showModal();};
$('send-agent').onclick=async()=>{const request=$('agent-text').value.trim();if(!request){$('agent-text').focus();return;}const prompt=`请使用 UI Studio 修改当前界面。工程：${snapshot.projectPath}；sessionId：${sessionId}；选中控件：${selected.join(', ')||'画布'}。先读取 get_ui_document 的最新版本，再 apply_ui_operations。我的要求：${request}`;
  try{if(bridge){const result=await bridge.sendMessage({role:'user',content:[{type:'text',text:prompt}]});if(result.isError)throw new Error('Codex 未接受这条消息，请在当前对话中输入要求');$('agent-dialog').close();toast('已发送给 Codex');}else{try{await navigator.clipboard.writeText(prompt);toast('已复制，请粘贴到左侧 Codex 对话');}catch{$('agent-copy').value=prompt;$('agent-copy').hidden=false;$('agent-copy').focus();$('agent-copy').select();toast('请复制下面的文字到 Codex');}}}catch(e){toast(e.message,true);}};
async function init(){try{if(viaHttp){if(!token)throw new Error('缺少连接凭据，请用插件返回的编辑器链接打开');if(sessionId)accept(await call('get_ui_document',{sessionId}),{fit:true});else $('connection').textContent='本地已连接';}
  else{bridge=new App({name:'UI Studio',version:'0.2.1'},{},{autoResize:false});bridge.ontoolresult=result=>{if(result.structuredContent?.document||result.structuredContent?.view==='project')accept(result.structuredContent,{fit:!snapshot});};await bridge.connect();$('connection').textContent='Codex 已连接';}}
  catch(e){toast(e.message,true);$('connection').textContent='未连接';}setInterval(refresh,1200);}
init();
