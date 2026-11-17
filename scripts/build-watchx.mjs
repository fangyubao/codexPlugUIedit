import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './prepare-runtime.mjs';
import { contained,assert,hash } from '../src/model.mjs';
import { instrumentCreates } from '../src/watchx-source.mjs';
const pluginRoot=fileURLToPath(new URL('../',import.meta.url));
export const watchPages={DialPlate:'Page_DialPlate.cpp',MainMenu:'Page_MainMenu.cpp',TimeCfg:'Page_TimeCfg.cpp',Backlight:'Page_BacklightCfg.cpp',StopWatch:'Page_StopWatch.cpp',Altitude:'Page_Altitude.cpp',About:'Page_About.cpp'};
export async function watchBuildFingerprint(root){
  let integration={pages:{}};try{integration=JSON.parse(await fs.readFile(path.join(root,'.ui-designer/watchx-integration.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const inputs=[];
  async function scan(dir){for(const e of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,e.name);if(e.isDirectory())await scan(file);else if(/\.(c|cpp|h|hpp)$/.test(e.name))inputs.push([path.relative(root,file),hash(await fs.readFile(file))]);}}
  for(const relative of ['WatchX/Libraries/lvgl','WatchX/Libraries/PageManager','WatchX/WatchX/GUI/Font','WatchX/WatchX/GUI/IMG'])await scan(await contained(root,relative));
  for(const relative of ['WatchX/Libraries/lv_conf.h','WatchX/WatchX/GUI/lv_ext_func.cpp'])inputs.push([relative,hash(await fs.readFile(await contained(root,relative)))]);
  for(const [page,file]of Object.entries(watchPages)){const bytes=integration.pages[page]?Buffer.from(integration.pages[page].originalBase64,'base64'):await fs.readFile(await contained(root,'WatchX/WatchX/GUI/Page/'+file));inputs.push([page,hash(bytes)]);}
  for(const file of ['native/watchx/host.cpp','native/watchx/host.hpp','scripts/build-watchx.mjs','src/watchx-source.mjs'])inputs.push([file,hash(await fs.readFile(path.join(pluginRoot,file)))]);
  return hash(JSON.stringify(inputs));
}
export async function buildWatchX(root,{log=()=>{}}={}){
  root=await fs.realpath(root);
  const app=await contained(root,'WatchX/WatchX'),libraries=await contained(root,'WatchX/Libraries');
  const version=await fs.readFile(await contained(root,'WatchX/Libraries/lvgl/src/lv_version.h'),'utf8');assert(/LVGL_VERSION_MAJOR\s+6/.test(version),'该适配器只适用于 WatchX / LVGL 6');
  const dir=await contained(root,'.ui-designer/watchx-host',{existing:false});await fs.mkdir(dir,{recursive:true});
  const include=path.join(dir,'include');for(const sub of ['GUI','BSP','Time'])await fs.mkdir(path.join(include,sub),{recursive:true});
  await fs.copyFile(path.join(pluginRoot,'native/watchx/host.hpp'),path.join(include,'host.hpp'));
  for(const stub of ['GUI/DisplayPrivate.h','DisplayPrivate.h','BSP/BSP.h','Time/Time.h'])await fs.writeFile(path.join(include,stub),'#include "host.hpp"\n');
  let conf=await fs.readFile(path.join(libraries,'lv_conf.h'),'utf8');conf=conf.replace(/#define LV_TICK_CUSTOM\s+1/,'#define LV_TICK_CUSTOM 0').replace(/#\s*define LV_MEM_SIZE[^\r\n]*/,'# define LV_MEM_SIZE (1024U * 1024U)');
  await fs.writeFile(path.join(include,'lv_conf.h'),conf);
  const sources=[];
  async function collect(folder){for(const e of await fs.readdir(folder,{withFileTypes:true})){if(e.isDirectory())await collect(path.join(folder,e.name));else if(e.name.endsWith('.c'))sources.push(path.join(folder,e.name));}}
  await collect(path.join(libraries,'lvgl/src'));await collect(path.join(app,'GUI/Font'));await collect(path.join(app,'GUI/IMG'));
  const cppDir=path.join(dir,'pages');await fs.mkdir(cppDir,{recursive:true});
  let integration={pages:{}};try{integration=JSON.parse(await fs.readFile(path.join(root,'.ui-designer/watchx-integration.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const file of [...Object.values(watchPages),'../lv_ext_func.cpp']){
    const original=file.startsWith('../')?path.join(app,'GUI/lv_ext_func.cpp'):path.join(app,'GUI/Page',file);
    const page=Object.keys(watchPages).find(p=>watchPages[p]===file),saved=integration.pages[page];
    let text=new TextDecoder('gbk').decode(saved?Buffer.from(saved.originalBase64,'base64'):await fs.readFile(original));
    // Resolve quoted local DisplayPrivate against the host shim, not the MCU header.
    text=text.replace(/#include "DisplayPrivate.h"/g,'#include "GUI/DisplayPrivate.h"');
    if(!file.startsWith('../'))text=instrumentCreates(text,path.basename(file));
    const dest=path.join(cppDir,path.basename(file));await fs.writeFile(dest,text);sources.push(dest);
  }
  sources.push(path.join(libraries,'PageManager/PageManager.cpp'),path.join(pluginRoot,'native/watchx/host.cpp'));
  const cmake=`cmake_minimum_required(VERSION 3.20)\nproject(WatchXHost C CXX)\nset(CMAKE_C_STANDARD 99)\nset(CMAKE_CXX_STANDARD 20)\nadd_executable(watchx_host\n${sources.map(s=>'"'+s.replaceAll('\\','/')+'"').join('\n')}\n)\ntarget_include_directories(watchx_host BEFORE PRIVATE "${include.replaceAll('\\','/')}" "${libraries.replaceAll('\\','/')}" "${app.replaceAll('\\','/')}")\ntarget_compile_definitions(watchx_host PRIVATE LV_CONF_INCLUDE_SIMPLE=1)\ntarget_compile_options(watchx_host PRIVATE -O1 -w -fpermissive)\ntarget_link_options(watchx_host PRIVATE -static)\n`;
  await fs.writeFile(path.join(dir,'CMakeLists.txt'),cmake);
  log('配置原 LVGL 6.1.2 宿主构建');await run('cmake',['-S',dir,'-B',path.join(dir,'build'),'-G','Ninja','-DCMAKE_C_COMPILER=gcc','-DCMAKE_CXX_COMPILER=g++'],{timeout:60000,onOutput:log});
  log('编译 LVGL、原字体图片与 WatchX 页面');await run('cmake',['--build',path.join(dir,'build'),'-j','8'],{timeout:180000,onOutput:log});
  await fs.writeFile(path.join(dir,'fingerprint'),await watchBuildFingerprint(root));
  return {directory:dir,executable:path.join(dir,'build','watchx_host.exe')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{console.log(JSON.stringify(await buildWatchX(process.argv[2],{log:s=>process.stdout.write(s+'\n')})));}catch(e){console.error(e.message);process.exitCode=1;}
