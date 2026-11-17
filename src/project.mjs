import fs from 'node:fs/promises';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { assert, contained } from './model.mjs';
import { isWatchX } from './watchx.mjs';

const unsupported = { import:'unsupported', preview:'unsupported', edit:'unsupported', writeBack:'unsupported' };
// These are implementation capabilities, not promises based on language detection.
export const adapterRegistry = Object.freeze([
  { id:'watchx-lvgl6', name:'WatchX / LVGL 6.1.2 原生宿主', frameworks:['lvgl'], capabilities:{import:'conditional',preview:'conditional',edit:'conditional',writeBack:'conditional'},
    requiredWork:['仅支持已验证的 WatchX 目录与七个页面；不代表通用 LVGL 适配','原生静态预览与已有控件编辑、备份写回；不支持新增删除、游戏或硬件仿真'] },
  { id:'qt-ui', name:'Qt Designer 表单', frameworks:['qt-widgets','qt-python'], extensions:['.ui'],
    capabilities:{...unsupported,import:'conditional',preview:'conditional',edit:'conditional'},
    requiredWork:['按文件验证控件和布局；目前仅基础绝对定位表单可编辑','当前导出副本，原工程写回尚未实现'] },
  { id:'qt-widgets-source', name:'Qt C++ 控件', frameworks:['qt-widgets'], capabilities:{...unsupported},
    requiredWork:['C++ 控件与源码映射','布局和事件保留','对应 Qt 版本的运行桥接'] },
  { id:'qt-python-source', name:'PySide / PyQt', frameworks:['qt-python'], capabilities:{...unsupported},
    requiredWork:['Python 控件与源码映射','保留原 Python 绑定及版本','布局、信号和业务代码保留'] },
  { id:'qml-source', name:'Qt Quick / QML', frameworks:['qt-quick'], capabilities:{...unsupported},
    requiredWork:['QML 对象、绑定和锚点解析','状态和动画编辑','原生 Qt Quick 预览'] },
  { id:'lvgl-source', name:'LVGL（MCU / 桌面 / Linux）', frameworks:['lvgl'], capabilities:{...unsupported},
    requiredWork:['匹配原 LVGL 版本','控件、样式、布局与 C/C++ 源码映射','显示和输入端口','业务回调保留'] },
  { id:'tkinter-source', name:'Tkinter', frameworks:['tkinter'], capabilities:{...unsupported},
    requiredWork:['Tk 控件与 Python 源码映射','pack/grid/place 布局适配'] },
  { id:'imgui-source', name:'Dear ImGui', frameworks:['imgui'], capabilities:{...unsupported},
    requiredWork:['即时模式绘制命令与源码映射','原渲染后端接入'] },
  { id:'osd-source', name:'OSD / 芯片叠加层', frameworks:['osd'], capabilities:{...unsupported},
    requiredWork:['确认厂商 SDK 与具体 OSD API','区域、文字、位图和图层映射','目标平台预览后端'] },
  { id:'custom-draw', name:'直接 LCD 绘图', frameworks:['custom-lcd'], capabilities:{...unsupported},
    requiredWork:['具体绘图库适配','绘图命令与源码定位','显示尺寸和字体资源'] },
  { id:'unknown-source', name:'其他 UI 工程', frameworks:[], capabilities:{...unsupported},
    requiredWork:['识别 UI 入口和图形库','创建并验证相应适配器'] },
]);

const excluded = new Set(['node_modules','.git','.svn','.hg','.venv','venv','build','dist','__pycache__','.ui-designer','.local-marketplace','.pio']);
const vendorNames = new Set(['drivers','middlewares','vendor','third_party','third-party','external','lib','libs','components','lvgl']);
const buildNames = new Map([['cmakelists.txt','cmake'],['cmakepresets.json','cmake'],['platformio.ini','platformio'],['makefile','make'],['meson.build','meson'],['sconstruct','scons'],['.cproject','eclipse-cdt']]);
const sourceExt = /\.(?:c|cc|cpp|cxx|h|hh|hpp|py|qml|ui|pro|pri|cmake|ini|toml|json|txt|ioc|uvprojx|ewp|mk|conf|cfg|lock|yml|yaml)$/i;
function priority(relative, directory=false) {
  const parts=relative.toLowerCase().split(/[\\/]/), name=parts.at(-1);
  const rank=parts.some(x=>vendorNames.has(x)||/^stm32cube_fw_/.test(x))?30:0;
  if(directory)return rank;
  if(buildNames.has(name)||/^(lv_version\.h|lv_conf\.h|requirements.*\.txt|pyproject\.toml|sdkconfig.*)$/.test(name))return rank-10;
  if(/\.(ioc|uvprojx|ewp|ui|qml|pro|py)$/.test(name))return rank-6;
  return rank;
}
function qtForm(text) {
  if(/<!DOCTYPE|<!ENTITY/i.test(text))return false;
  const errors=[];
  const xml=new DOMParser({errorHandler:{warning:m=>errors.push(m),error:m=>errors.push(m),fatalError:m=>errors.push(m)}}).parseFromString(text,'text/xml');
  return !errors.length && xml.documentElement?.tagName==='ui' && xml.getElementsByTagName('widget').length>0;
}
function plan(framework,versions,environment) {
  const matches=versions.filter(v=>framework==='qt-python'?/^(PySide|PyQt)/.test(v.package):framework==='lvgl'?v.package==='LVGL':v.package==='Qt');
  const labels=[...new Set(matches.map(v=>`${v.package}${v.major!==null?' '+v.major:''}${v.version?' ('+v.version+')':''}`))];
  if(framework==='lvgl') {
    const mcu=environment.targets.some(t=>t.kind==='mcu'),host=environment.targets.some(t=>t.kind==='host');
    return {dependencies:[labels.length?'沿用工程版本：'+labels.join('、'):'LVGL 版本待确认；不能默认迁移到 v9',mcu?'原 MCU 工具链与 BSP（原工程验证）':'工程指定宿主编译器','原字体、图片、lv_conf.h 和显示尺寸'],
      previewPlan:mcu?'按原 LVGL 版本提取 UI 层并建立宿主显示/输入端口；硬件调用需替身或真机连接。桌面预览不代表仿真整块 MCU。':host?'沿用工程 SDL / Linux 显示后端建立运行桥接。':'先确认 MCU、SDL、Linux framebuffer/DRM 等目标平台。',
      blockers:['已有 LVGL 工程导入、编辑和写回尚未实现',...(labels.length?[]:['LVGL 版本未确认']),...(mcu?['需验证 UI 与硬件依赖的隔离']:[])]};
  }
  if(framework==='qt-python')return {dependencies:[labels.length?'沿用工程绑定：'+labels.join('、'):'先确认 PySide/PyQt 及版本','独立 Python 环境','原资源与依赖清单'],previewPlan:'按原绑定与 Qt 版本运行；存在 .ui 时逐文件检查。',blockers:['Python 创建控件的导入与写回尚未实现，不能转换成 PySide6 替代原绑定']};
  if(['qt-widgets','qt-quick'].includes(framework))return {dependencies:[labels.length?'沿用工程版本：'+labels.join('、'):'Qt 版本待确认',framework==='qt-quick'?'Qt Quick / QML 模块':'Qt Widgets / UiTools','匹配的编译器、构建配置与资源'],previewPlan:framework==='qt-quick'?'接入 QML 对象、绑定及原生预览。':'逐文件检查 .ui；动态 C++ 控件需要运行时与源码桥接。',blockers:[framework==='qt-quick'?'QML 编辑适配器尚未实现':'仅基础绝对定位 .ui 已有导入实现；布局、动态 C++ 控件和写回尚未实现']};
  const descriptions={tkinter:['Python tkinter','需要 Python 控件和布局源码映射'],imgui:['原 ImGui 和渲染后端','需要即时绘制命令映射'],osd:['原厂 OSD SDK、字库与像素格式','OSD 是显示方式，需按实际厂商 API 建立适配器'],'custom-lcd':['原 LCD 驱动、字库与显示参数','需要直接绘图 API 与源码映射']};
  return {dependencies:[descriptions[framework][0]],previewPlan:descriptions[framework][1],blockers:['已有工程导入、编辑和写回尚未实现']};
}

export async function inspectProject(projectPath,options={}) {
  const root=await fs.realpath(projectPath);assert((await fs.stat(root)).isDirectory(),'请选择工程目录');
  const limits={entries:16000,sourceFiles:900,depth:16,fileBytes:512000,totalBytes:24000000,...options.limits};
  for(const v of Object.values(limits))assert(Number.isInteger(v)&&v>0,'扫描上限无效');
  const signals=new Map(),targets=new Map(),builds=new Map(),versions=[],languages=new Set(),displayFacts=[];
  const files=[],qtUiFiles=[],warnings=[],omitted=new Set(),stack=[{relative:'',depth:0}];
  let entriesVisited=0,sourceFilesRead=0,totalBytesRead=0;
  function evidence(map,key,file,description,extra={}) {if(!map.has(key))map.set(key,{...extra,evidence:[]});const list=map.get(key).evidence;if(list.length<8&&!list.some(x=>x.file===file&&x.description===description))list.push({file,description});}
  const signal=(key,file,description)=>evidence(signals,key,file,description);
  const target=(key,kind,file,description)=>evidence(targets,key,file,description,{id:key,kind});
  const build=(key,file,description)=>evidence(builds,key,file,description,{id:key});
  function version(pkg,major,value,file){if(!versions.some(v=>v.package===pkg&&v.major===major&&v.version===value))versions.push({package:pkg,major,version:value,file});}
  while(stack.length&&entriesVisited<limits.entries) {
    stack.sort((a,b)=>priority(b.relative,true)-priority(a.relative,true)||b.depth-a.depth||b.relative.localeCompare(a.relative));
    const dir=stack.pop();let entries;
    try{entries=await fs.readdir(dir.relative?await contained(root,dir.relative):root,{withFileTypes:true});}
    catch(e){warnings.push(`未扫描 ${dir.relative||'.'}：${e.code||e.message}`);omitted.add('unreadable-path');continue;}
    entries.sort((a,b)=>priority(a.name,a.isDirectory())-priority(b.name,b.isDirectory())||a.name.localeCompare(b.name));
    for(const entry of entries) {
      if(entriesVisited>=limits.entries){omitted.add('entry-limit');break;}entriesVisited++;
      const relative=path.join(dir.relative,entry.name),name=entry.name.toLowerCase();
      if(entry.isSymbolicLink()){omitted.add('symlink');continue;}
      if(entry.isDirectory()) {if(excluded.has(name))continue;if(dir.depth+1>limits.depth){omitted.add('depth-limit');continue;}stack.push({relative,depth:dir.depth+1});}
      else if(entry.isFile()&&(sourceExt.test(name)||buildNames.has(name)||name.startsWith('sdkconfig')||name==='pipfile'))files.push(relative);
    }
  }
  if(stack.length)omitted.add('entry-limit');
  files.sort((a,b)=>priority(a)-priority(b)||a.localeCompare(b));
  for(const relative of files) {
    if(sourceFilesRead>=limits.sourceFiles){omitted.add('source-limit');break;}
    const name=path.basename(relative).toLowerCase(),ext=path.extname(name);let text,size;
    try {const file=await contained(root,relative);size=(await fs.stat(file)).size;if(size>limits.fileBytes){omitted.add('file-size-limit');continue;}if(totalBytesRead+size>limits.totalBytes){omitted.add('byte-limit');continue;}text=await fs.readFile(file,'utf8');}
    catch(e){warnings.push(`未读取 ${relative}：${e.code||e.message}`);omitted.add('unreadable-path');continue;}
    sourceFilesRead++;totalBytesRead+=size;
    if(ext==='.py')languages.add('Python');if(['.c','.h'].includes(ext))languages.add('C');if(['.cc','.cpp','.cxx','.hpp'].includes(ext))languages.add('C++');if(ext==='.qml')languages.add('QML');
    if(buildNames.has(name))build(buildNames.get(name),relative,name);
    for(const [suffix,key]of [['.pro','qmake'],['.uvprojx','keil-mdk'],['.ewp','iar']])if(ext===suffix)build(key,relative,key+' 工程');
    if(ext==='.ioc'&&/(?:Mcu\.(?:Name|Family|CPN)|STM32)/i.test(text))target('stm32','mcu',relative,'STM32 CubeMX 配置');
    if(ext==='.ioc')for(const match of text.matchAll(/^Mcu\.(?:Name|CPN)=(.+)$/gm))target('stm32','mcu',relative,'MCU 型号：'+match[1].trim());
    if(ext==='.uvprojx'||ext==='.ewp')for(const match of text.matchAll(/<(?:Device|name)>\s*((?:STM32|ESP32|NRF|RP2040)[\w.-]*)\s*<\//gi))target(/^STM32/i.test(match[1])?'stm32':'configured-mcu','mcu',relative,'MCU 型号：'+match[1]);
    if(/\b(?:STM32[A-Z0-9_]*|stm32\w*_hal\.h|rgblcd_show_string)\b/.test(text)||/stm32/i.test(name))target('stm32','mcu',relative,'STM32 目标 / HAL');
    if(/\b(?:ESP_PLATFORM|esp_lcd|esp32|ESP32|IDF_TARGET)\b/.test(text)||/platform\s*=\s*espressif32/i.test(text))target('esp32','mcu',relative,'ESP32 / ESP-IDF');
    if(/\b(?:arm-none-eabi|cortex-m[0-9]+)\b/i.test(text))target('arm-cortex-m','mcu',relative,'Arm 裸机工具链 / Cortex-M');
    if(/\b(?:CONFIG_SOC_SERIES_[A-Z0-9_]+|BOARD_NRF\w*|PICO_BOARD|NRF52840_XXAA)\b/.test(text))target('other-mcu','mcu',relative,'MCU 板型配置');
    if(/#\s*include\s*[<"](?:[^">]*\/)?SDL(?:2|3)?(?:\.h|\/)|\bSDL_(?:Init|CreateWindow)\s*\(|find_package\s*\(\s*SDL[23]/.test(text))target('sdl','host',relative,'SDL 宿主显示后端');
    if(/\b(?:lv_linux_fbdev_create|lv_linux_drm_create|fbdev_init)\s*\(|\/dev\/fb[0-9]/.test(text))target('linux-display','host',relative,'Linux framebuffer / DRM');
    if(/\b(?:WinMain|QApplication|QGuiApplication)\s*\(|\bQtWidgets\b/.test(text))target('native-desktop','host',relative,'桌面窗口入口（仍需核对构建目标）');
    if(ext==='.ui'){if(qtForm(text)){signal('qt-widgets',relative,'Qt Designer 表单');qtUiFiles.push(relative);}else warnings.push(`${relative} 不是已验证的 Qt Designer XML，未列为 Qt 导入候选。`);}
    if(ext==='.qml')signal('qt-quick',relative,'QML 文档');
    const isCode=['.py','.c','.cc','.cpp','.cxx','.h','.hh','.hpp','.qml'].includes(ext);
    const isManifest=/^(?:requirements.*\.txt|pyproject\.toml|pipfile|poetry\.lock|pdm\.lock|uv\.lock|setup\.cfg|environment\.ya?ml|cmakelists\.txt|platformio\.ini|library\.json|idf_component\.yml)$/.test(name)||['.pro','.pri','.cmake'].includes(ext);
    if(ext==='.py'||isManifest)for(const match of text.matchAll(/\b(PySide[26]|PyQt[56])\b(?:\s*(?:==|>=|~=|=)\s*["']?([0-9]+(?:\.[0-9]+){0,3}))?/g)) {
      if(ext==='.py'&&!new RegExp(`(?:^|\\n)\\s*(?:from\\s+${match[1]}(?:\\.|\\s)|import\\s+${match[1]}\\b)`).test(text))continue;
      signal('qt-python',relative,match[1]+' 绑定');version(match[1],['PySide2','PyQt5'].includes(match[1])?5:6,match[2]||null,relative);
    }
    if((isCode&&/#\s*include\s*[<"](?:QtWidgets\/|QtGui\/)?Q[A-Z]|\bQ(?:PushButton|Widget|Application)\b/.test(text))||(isManifest&&/find_package\s*\(\s*Qt[56]|QT\s*\+?=\s*[^\n]*widgets/.test(text)))signal('qt-widgets',relative,'Qt Widgets API / 构建依赖');
    if(isManifest)for(const match of text.matchAll(/\b(?:Qt([56])(?:::(?:Widgets|Quick))?|QT_VERSION_MAJOR\s+([56]))\b/g))version('Qt',Number(match[1]||match[2]),null,relative);
    if(isManifest&&/Qt[56]::Quick|find_package\s*\(\s*Qt[56][^)]*\bQuick\b|QT\s*\+?=\s*[^\n]*\bquick\b/.test(text))signal('qt-quick',relative,'Qt Quick 构建依赖');
    if(ext==='.py'&&/(?:^|\n)\s*(?:from\s+tkinter\b|import\s+tkinter\b)/.test(text))signal('tkinter',relative,'tkinter 导入');
    if((isCode&&/#\s*include\s*[<"](?:[^">]*\/)?lvgl\.h|\blv_(?:obj|label|button|btn|screen)_create\s*\(/.test(text))||(isManifest&&/\blvgl\b/i.test(text))||name==='lv_version.h')signal('lvgl',relative,'LVGL API / 声明依赖');
    const major=text.match(/^\s*#\s*define\s+(?:LVGL|LV)_VERSION_MAJOR\s+(\d+)/m);
    if(isCode&&major){const minor=text.match(/^\s*#\s*define\s+(?:LVGL|LV)_VERSION_MINOR\s+(\d+)/m),patch=text.match(/^\s*#\s*define\s+(?:LVGL|LV)_VERSION_PATCH\s+(\d+)/m);version('LVGL',Number(major[1]),minor&&patch?`${major[1]}.${minor[1]}.${patch[1]}`:null,relative);signal('lvgl',relative,'LVGL 版本宏');}
    if(isCode)for(const match of text.matchAll(/^\s*#\s*define\s+(LV_(?:HOR_RES_MAX|VER_RES_MAX|COLOR_DEPTH))\s+(\d+)/gm))if(displayFacts.length<30)displayFacts.push({key:match[1],value:Number(match[2]),file:relative});
    if(isManifest)for(const match of text.matchAll(/(?:lvgl\/lvgl|["']?lvgl["']?)\s*(?:@|:|=)\s*["']?[~^>=\s]*v?(\d+)\.(\d+)(?:\.(\d+))?/gi))version('LVGL',Number(match[1]),[match[1],match[2],match[3]].filter(Boolean).join('.'),relative);
    if(isCode&&/\bImGui::|#\s*include\s*"imgui\.h"/.test(text))signal('imgui',relative,'Dear ImGui API');
    if(isCode&&/\b(?:LCD_ShowString|lcd_show_string|LCD_Fill|lcd_fill|rgblcd_show_string|rgblcd_fill)\s*\(/.test(text))signal('custom-lcd',relative,'直接 LCD 绘图 API');
    if(isCode&&/\b(?:HI_MPI_RGN_|RK_MPI_RGN_|MI_RGN_|IMP_OSD_|osd_(?:draw|create|set|init|render)|OSD_(?:Draw|Create|Set|Init|Render))\w*\s*\(/.test(text))signal('osd',relative,'OSD / RGN 图层 API');
  }
  const targetList=[...targets.values()],mcu=targetList.some(t=>t.kind==='mcu'),host=targetList.some(t=>t.kind==='host');
  const environment={kind:mcu&&host?'mixed':mcu?'mcu':host?'host':'unknown',targets:targetList,note:'多目标工程保留所有证据；宿主预览不代表硬件仿真。'};
  const conflicts=[];
  for(const pkg of ['LVGL','Qt']){const majors=[...new Set(versions.filter(v=>v.package===pkg).map(v=>v.major))];if(majors.length>1)conflicts.push(`${pkg} 出现多个主版本 ${majors.join(' / ')}，需确认实际构建目标。`);}
  const bindings=[...new Set(versions.filter(v=>/^(PySide|PyQt)/.test(v.package)).map(v=>v.package))];if(bindings.length>1)conflicts.push(`多个 Python Qt 绑定 ${bindings.join(' / ')}，需按入口选择，不能混装。`);
  const frameworks=[...signals].map(([framework,value])=>{const adapters=adapterRegistry.filter(a=>a.frameworks.includes(framework)),hasUi=qtUiFiles.length>0&&adapters.some(a=>a.id==='qt-ui');return {framework,evidence:value.evidence,adapterIds:adapters.map(a=>a.id),...plan(framework,versions,environment),editable:hasUi?'有 Qt .ui 候选，需逐文件验证；不代表整个工程可编辑':'已有工程编辑适配器尚未实现',importedProject:{...unsupported,...(hasUi?{import:'conditional',preview:'conditional',edit:'conditional'}:{})}};});
  const adapters=adapterRegistry.filter(a=>frameworks.some(f=>a.frameworks.includes(f.framework)));if(!adapters.length)adapters.push(adapterRegistry.find(a=>a.id==='unknown-source'));
  const watchx=await isWatchX(root);
  if(watchx){for(const f of frameworks)if(f.framework==='lvgl'){f.editable='WatchX 七页已接入：原 LVGL 6.1.2 静态渲染、已有控件编辑、备份写回';f.importedProject={import:'supported',preview:'static-native',edit:'existing-widgets',writeBack:'generated-overrides'};f.previewPlan='编译工程自带 LVGL、字体图片与页面，硬件接口使用预览替身。';}}
  else{const index=adapters.findIndex(a=>a.id==='watchx-lvgl6');if(index>=0)adapters.splice(index,1);for(const f of frameworks)f.adapterIds=f.adapterIds.filter(id=>id!=='watchx-lvgl6');}
  return {schemaVersion:2,projectPath:root,frameworks,environment,buildSystems:[...builds.values()],languages:[...languages].sort(),versions,displayFacts,conflicts,adapters,qtUiFiles:qtUiFiles.sort(),entriesVisited,sourceFilesRead,
    scan:{limits,totalBytesRead,omittedReasons:[...omitted],complete:omitted.size===0},truncated:omitted.size>0,warnings,
    intake:{status:watchx?'supported-watchx':qtUiFiles.length>1?'choose-source':qtUiFiles.length===1?'candidate':'needs-adapter',message:watchx?'可打开 WatchX 原生编辑器，默认表盘，提供七页切换。':qtUiFiles.length?'找到 Qt 表单候选，仍需验证其可编辑范围。':'工程已检查；已有导入适配器未覆盖此工程，不会用空白画布代替原界面。'},
    note:'仅读取文件。框架识别、运行预览、编辑和写回分别报告；扫描不是通用转换承诺。'};
}
