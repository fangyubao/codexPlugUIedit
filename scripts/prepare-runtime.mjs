import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contained, assert } from '../src/model.mjs';

export function run(command,args,{cwd,timeout=180000,onOutput=()=>{}}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,windowsHide:true,shell:false,env:{...process.env,PYTHONUTF8:'1'}});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('运行超时：'+command));},timeout);
    const collect=chunk=>{output=(output+chunk.toString()).slice(-24000);onOutput(chunk.toString());};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(output);else reject(new Error(`${command} exited ${code}: ${output.slice(-4000)}`));});
  });
}
export async function prepareRuntime(projectPath,{log=()=>{}}={}){
  const root=await fs.realpath(projectPath);
  const envRoot=await contained(root,'.ui-designer/runtime/pyside6',{existing:false});
  const python=path.join(envRoot,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  try{await fs.access(python);}catch{
    log('正在创建工程独立的 Python 环境…');
    await fs.mkdir(path.dirname(envRoot),{recursive:true});
    await run(process.platform==='win32'?'python':'python3',['-m','venv',envRoot],{cwd:root,onOutput:log});
  }
  await contained(root,path.relative(root,python));
  try{await run(python,['-c','from PySide6.QtWidgets import QApplication; from PySide6.QtUiTools import QUiLoader'],{cwd:root});log('Qt 运行环境已就绪。');}
  catch{log('正在从 Python 包仓库安装 PySide6（首次需要下载 Qt 运行库）…');await run(python,['-m','pip','install','--disable-pip-version-check','PySide6>=6.8,<7'],{cwd:root,timeout:600000,onOutput:log});}
  const version=(await run(python,['-c','import PySide6; print(PySide6.__version__)'],{cwd:root})).trim();
  return {python,version,environment:envRoot};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{assert(process.argv[2],'Usage: node scripts/prepare-runtime.mjs <project-directory>');const result=await prepareRuntime(process.argv[2],{log:text=>process.stderr.write(text+'\n')});console.log(JSON.stringify(result,null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
