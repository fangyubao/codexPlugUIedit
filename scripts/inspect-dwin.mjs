import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import iconv from 'iconv-lite';
import {parseNrbf} from '../src/nrbf.mjs';
import {contained,assert,hash} from '../src/model.mjs';

const labels={KeyCodeReturn:'触摸 / 键码返回',VarInput:'数值输入',GBKInput:'中文输入',PopMenu:'弹出菜单',TextShow:'文本显示',DataTextShow:'数值显示',RtcTextShow:'RTC 时间',IconShow:'变量图标',DW_ProcessBar:'进度条'};
export async function inspectDwin(projectPath){
  const root=await fs.realpath(projectPath),projectFile=await contained(root,'DWprj.hmi');
  const ini=iconv.decode(await fs.readFile(projectFile),'gbk'),sections={};let current;
  for(const line of ini.split(/\r?\n/)){const section=/^\[(.+)\]$/.exec(line);if(section){current=sections[section[1]]={};continue;}const i=line.indexOf('=');if(current&&i>0)current[line.slice(0,i)]=line.slice(i+1);}
  const match=/^(\d+)X(\d+)$/i.exec(sections.INIT?.SCREENDSIZE||'');assert(match,'缺少有效屏幕尺寸');
  const pages=[],types={},warnings=[],missing=[];
  for(const[index,image]of Object.entries(sections.IMG||{})){
    assert(!/[\\/]/.test(image),'图片名称不能包含目录');
    const sourceFile='TFT/'+image+'.tft',source=await fs.readFile(await contained(root,sourceFile));
    const p=parseNrbf(source,{allowTrailing:true}),items=p.field(p.root,'Items'),count=p.field(items,'List`1+_size');
    const all=p.array(p.field(items,'List`1+_items'));assert(Number.isInteger(count)&&count>=0&&count<=all.length,'控件数量无效');
    const objects=all.slice(0,count).map((item,order)=>{
      assert(item?.$type==='BizDraw.Objects.DrawRectangle','未知图形对象');
      const r=p.field(item,'Rectangle'),config=p.field(item,'ConfigVar'),kind=config?.$type?.split('.').at(-1)||'Unknown';types[kind]=(types[kind]||0)+1;
      const geometry=Object.fromEntries(['x','y','width','height'].map(k=>[k,p.field(r,k)]));
      assert(Object.values(geometry).every(Number.isFinite),'控件坐标无效');
      const vp=p.field(config,'Var_Point')??p.field(config,'VarPoint'),target=p.field(config,'Pic_Next');
      const point=obj=>obj?{x:p.field(obj,'X'),y:p.field(obj,'Y')}:null;
      const result={id:`page${index}_obj${item.$id}`,sourceObjectId:item.$id,order,type:kind,label:labels[kind]||kind,geometry,
        vp:vp===undefined?null:'0x'+vp.toString(16).toUpperCase().padStart(4,'0'),nextPage:typeof target==='number'&&target>=0?target:null,
        keyCode:p.field(config,'Key_Code')??null,text:p.field(config,'DataConfig')??null,
        fontSize:p.field(config,'FontSize')??p.field(config,'FontY_Dot')??null,
        touchStart:point(p.field(config,'AreaStart')),touchEnd:point(p.field(config,'AreaEnd')),
        serializableProperties:p.plain(config),geometryOffsets:r.spans,
        sourceFile,locked:!!p.field(item,'bLocked')};
      if(geometry.x<0||geometry.y<0||geometry.x+geometry.width>Number(match[1])||geometry.y+geometry.height>Number(match[2]))warnings.push(`${image} 第 ${order+1} 个控件超出声明屏幕边界`);
      return result;
    });
    if(p.trailingBytes)warnings.push(`${sourceFile}：首个 NRBF MessageEnd 后仍有 ${p.trailingBytes} 字节；当前仅解析有效对象图，尾部另行保留，未判断用途。`);
    let imageFile;try{imageFile=await contained(root,'DWIN_SET/'+image);}catch{missing.push('DWIN_SET/'+image);}
    pages.push({index:Number(index),image,sourceFile,sourceHash:hash(source),width:p.field(p.root,'Width'),height:p.field(p.root,'Height'),imageIndex:p.field(p.root,'ImageIndex'),objects,objectCount:objects.length,sourceBytes:source.length,parsedBytes:p.bytesRead,trailingBytes:p.trailingBytes,imageFile,
      libraries:[...p.libraries.values()]});
  }
  const resources=[];for(const e of await fs.readdir(await contained(root,'DWIN_SET'),{withFileTypes:true}))if(e.isFile()){const file=await contained(root,'DWIN_SET/'+e.name);resources.push({name:e.name,bytes:(await fs.stat(file)).size});}
  pages.sort((a,b)=>a.index-b.index);
  const report={schemaVersion:1,framework:'DWIN DGUS / T5L (project evidence)',projectPath:root,projectFile:'DWprj.hmi',projectSettings:sections.INIT,
    width:Number(match[1]),height:Number(match[2]),pageCount:pages.length,controlCount:pages.reduce((n,p)=>n+p.objectCount,0),pagesWithControls:pages.filter(p=>p.objectCount).length,controlTypes:types,pages,resources,missing,warnings,
    capabilities:{projectRead:'parsed',pageImages:'available',controlTree:'parsed',variableAddresses:'parsed',pageLinks:'parsed',preview:'background-with-control-regions',dragEdit:'not-implemented',sourceWriteBack:'not-implemented',compiledFileRegeneration:'not-implemented',hardwareValidation:'not-performed'},
    limitations:['本视图只读：显示原背景图片和真实解析控件范围，不代表完整 DGUS 运行模拟。','背景 JPG 中的按钮、标题和装饰并非独立控件，不能仅移动触摸区就改变背景外观。','控件默认值、字库、图标组合、动态变量、键盘及串口行为尚未做逐项原生还原。','尚未用官方 DGUS 软件验证编辑后重开、13/14 配置生成或设备下载；本次没有修改工程文件。','原工程包含来自其他电脑的绝对资源路径；尚未改写，需在往返适配阶段处理。']};
  return report;
}

export async function dwinInspectorHtml(report){
  const view=structuredClone(report);
  view.projectName=path.basename(report.projectPath);
  for(const page of view.pages)if(page.imageFile)page.imageData='data:image/jpeg;base64,'+(await fs.readFile(page.imageFile)).toString('base64');
  const data=JSON.stringify(view).replaceAll('<','\\u003c');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DWIN 串口屏工程解析</title>
<style>*{box-sizing:border-box}body{margin:0;font:14px "Segoe UI","Microsoft YaHei",sans-serif;color:#263349;background:#f4f6fa}header{padding:18px 22px;background:#fff;border-bottom:1px solid #e3e7ef}h1{font-size:20px;margin:0 0 9px}header p{margin:5px 0;color:#64748b;font-size:12px;line-height:1.7}.notice{background:#fff5d9;padding:11px 22px;color:#785b1a;font-size:12px;line-height:1.7}nav{padding:12px 22px;background:#fff;display:flex;gap:14px;align-items:center;flex-wrap:wrap}select,button{font:inherit;padding:7px;border:1px solid #ccd4e1;border-radius:6px;background:white}main{display:grid;grid-template-columns:minmax(180px,1fr) 300px;gap:18px;padding:20px}.preview{min-width:0}.stage{position:relative;width:100%;box-shadow:0 5px 25px #24324922;background:white;aspect-ratio:854/480}.stage img{width:100%;height:100%;position:absolute;inset:0}.region{position:absolute;border:1px dashed #6558e8;background:#6558e812;padding:0;border-radius:0;cursor:pointer}.region:hover,.region.selected{border:2px solid #ff6a00;background:#ff6a0028;z-index:2}.stage.no-regions .region{border-color:transparent;background:transparent}.stage.no-regions .region.selected{border-color:#ff6a00;background:#ff6a0028}.note{font-size:12px;color:#64748b;line-height:1.8;margin-top:15px}aside{background:#fff;border:1px solid #e3e7ef;border-radius:8px;overflow:hidden}h2{font-size:14px;margin:0;padding:14px;border-bottom:1px solid #edf0f5}#list{max-height:260px;overflow:auto}#list button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #edf0f5;border-radius:0;padding:9px 13px;font-size:12px}#list button.selected{color:#5d4bd8;background:#f0edff}#properties{padding:14px;font-size:12px;line-height:1.9;overflow-wrap:anywhere}dl{margin:0}dt{color:#8691a4}dd{margin:0 0 8px}pre{white-space:pre-wrap;font-size:11px;line-height:1.6}details{padding:15px 22px;background:#fff;margin-top:5px}summary{cursor:pointer;font-size:12px;color:#66758b}#warnings{font-size:12px;line-height:1.8;white-space:pre-wrap}#count{color:#64748b;font-size:12px}label{font-size:12px;color:#64748b}@media(max-width:800px){main{grid-template-columns:1fr;padding:14px}#list{max-height:170px}header,nav{padding:13px}h1{font-size:17px}}</style>
<header><h1 id="project-title">DWIN 串口屏工程解析</h1><p id="summary"></p><p>只读解析视图 · 选中框来自工程真实控件坐标</p></header><div class="notice">当前可切换页面、查看控件范围、变量地址和跳页关系；尚未接入拖拽、写回、下载文件生成或串口运行。</div>
<nav><select id="page" aria-label="页面"></select><label><input id="regions" type="checkbox" checked> 显示控件范围</label><span id="count"></span></nav>
<main><section class="preview"><div class="stage" id="stage"></div><p class="note">点选画面中的控件框或右侧列表可查看属性。背景里的文字与按钮可能是 JPG 的一部分；本页没有把图片内容假装成独立可编辑控件。</p></section><aside><h2>控件与属性</h2><div id="list"></div><div id="properties">请选择控件。</div></aside></main><details><summary>解析记录与未验证项目</summary><div id="warnings"></div></details>
<script>const report=${data};const $=id=>document.getElementById(id);let current,selected;
function add(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
$('project-title').textContent=report.projectName+' · DWIN 串口屏工程解析';document.title=$('project-title').textContent;
$('summary').textContent=report.width+' × '+report.height+' · '+report.pageCount+' 个页面图像 · '+report.pagesWithControls+' 页含控件 · '+report.controlCount+' 个控件';
for(const p of report.pages){const o=add('option',String(p.index).padStart(2,'0')+' · '+p.image.replace(/\\.jpg$/i,'')+'（'+p.objectCount+'）');o.value=p.index;$('page').append(o);}
function select(id){selected=id;for(const e of document.querySelectorAll('[data-object]'))e.classList.toggle('selected',e.dataset.object===id);const n=current.objects.find(n=>n.id===id);if(!n)return;const d=add('dl');for(const[k,v]of Object.entries({'控件类型':n.label,'坐标与尺寸':JSON.stringify(n.geometry),'VP 地址':n.vp??'未定义','目标页面':n.nextPage??'不跳页','返回键码':n.keyCode??'未定义','设计默认数据':n.text??'无','源文件':n.sourceFile,'对象 ID':n.sourceObjectId})){d.append(add('dt',k),add('dd',String(v)));}$('properties').replaceChildren(d);if(n.nextPage!==null&&report.pages.some(p=>p.index===n.nextPage)){const b=add('button','查看目标页面 '+n.nextPage);b.onclick=()=>openPage(n.nextPage);$('properties').append(b);}const more=add('details'),summary=add('summary','原始控件属性'),pre=add('pre',JSON.stringify(n.serializableProperties,null,2));more.append(summary,pre);$('properties').append(more);}
function openPage(index){current=report.pages.find(p=>p.index===Number(index));$('page').value=current.index;$('stage').replaceChildren();$('list').replaceChildren();$('properties').textContent='请选择控件。';const img=add('img');img.alt=current.image;img.src=current.imageData||'';$('stage').append(img);$('count').textContent=current.objectCount+' 个控件';for(const n of current.objects){const region=add('button');region.className='region';region.dataset.object=n.id;region.title=n.label+' · '+(n.vp||'无 VP');region.setAttribute('aria-label',region.title);Object.assign(region.style,{left:n.geometry.x/report.width*100+'%',top:n.geometry.y/report.height*100+'%',width:n.geometry.width/report.width*100+'%',height:n.geometry.height/report.height*100+'%'});region.onclick=()=>select(n.id);$('stage').append(region);const row=add('button',(n.order+1)+'. '+n.label+' · '+(n.vp||'无 VP'));row.dataset.object=n.id;row.onclick=()=>select(n.id);$('list').append(row);}}
$('page').onchange=()=>openPage($('page').value);$('regions').onchange=()=>$('stage').classList.toggle('no-regions',!$('regions').checked);$('warnings').textContent=[...report.warnings,...report.limitations].join('\\n\\n');openPage(report.pages.some(p=>p.index===1)?1:report.pages[0].index);</script></html>`;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await inspectDwin(process.argv[2]),out=path.resolve(process.argv[3]||'test-results/dwin-inspection');await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(out,'inspector.html'),await dwinInspectorHtml(report));
  console.log(JSON.stringify({output:out,pageCount:report.pageCount,pagesWithControls:report.pagesWithControls,controlCount:report.controlCount,types:report.controlTypes,warnings:report.warnings,missing:report.missing},null,2));
}
