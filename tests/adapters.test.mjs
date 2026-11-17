import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { newDocument,applyOperations } from '../src/model.mjs';
import { importQt,qtXml,generateFiles,inspectProject } from '../src/adapters.mjs';
const fixture=fileURLToPath(new URL('../examples/qt-form/',import.meta.url));
test('Qt import edits geometry and escaped text while preserving connections and unrelated properties',async()=>{
  const doc=await importQt(fixture,'window.ui');assert.equal(doc.readOnly,false);
  const changed=applyOperations(doc,[{op:'update',id:'applyButton',changes:{x:96,width:200,text:'"确认" <&>'}}]);
  const output=qtXml(changed);const parsed=new DOMParser().parseFromString(output,'text/xml');
  assert(output.includes('<x>96</x>'));assert(output.includes('<width>200</width>'));
  assert(output.includes('这段未编辑的属性应保持不变'));assert(output.includes('<slot>close()</slot>'));
  const button=Array.from(parsed.getElementsByTagName('widget')).find(n=>n.getAttribute('name')==='applyButton');
  assert(Array.from(button.getElementsByTagName('string')).some(n=>n.textContent==='"确认" <&>'));
  const reimport=await fs.mkdtemp(path.join(os.tmpdir(),'ui-studio-roundtrip-'));await fs.writeFile(path.join(reimport,'output.ui'),output);
  const again=await importQt(reimport,'output.ui');assert.equal(again.nodes.find(n=>n.id==='applyButton').x,96);
  assert.equal((await fs.readFile(path.join(fixture,'window.ui'),'utf8')).includes('<x>96</x>'),false);
});
test('Qt layouts and unsupported custom widgets are read-only; XML entities are rejected',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ui-studio-import-'));
  await fs.writeFile(path.join(root,'layout.ui'),'<ui version="4.0"><class>X</class><widget class="QWidget" name="root"><layout class="QVBoxLayout" name="layout"><item><widget class="QLabel" name="label"/></item></layout></widget></ui>');
  const doc=await importQt(root,'layout.ui');assert.equal(doc.readOnly,true);assert.throws(()=>applyOperations(doc,[{op:'canvas',changes:{title:'unsafe'}}]),/仅可查看/);
  await fs.writeFile(path.join(root,'evil.ui'),'<!DOCTYPE ui [<!ENTITY x SYSTEM "file:///secret">]><ui>&x;</ui>');await assert.rejects(importQt(root,'evil.ui'),/实体/);
});
test('all export targets handle Unicode, quoted text and hierarchy; generated Python parses',()=>{
  const doc=applyOperations(newDocument(true),[{op:'update',id:'connect',changes:{text:'连接 "板子"\nC:\\设备'}}]);
  for(const target of ['qt-ui','pyside6','qt-cpp','tkinter','lvgl']){
    const {files}=generateFiles(doc,target);assert(Object.keys(files).length>0);
    if(files['main.py']){const result=spawnSync('python',['-X','utf8','-c','import ast, sys; ast.parse(sys.stdin.read())'],{input:files['main.py'],encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
    if(files['window.ui']){const xml=new DOMParser().parseFromString(files['window.ui'],'text/xml');assert.equal(xml.getElementsByTagName('widget').length,9);}
    if(target==='lvgl'){assert(files['ui_generated.c'].includes('lv_button_create(ui_settings)'));assert(files['ui_generated.c'].includes('lv_obj_set_style_pad_all(ui_settings, 0, 0)'));}
  }
});
test('widget identifiers cannot collide with generated auxiliary state',()=>{
  const doc=applyOperations(newDocument(),[
    {op:'add',node:{type:'checkbox',id:'option'}},
    {op:'add',node:{type:'frame',id:'option_value'}},
    {op:'add',node:{type:'button',id:'action'}},
    {op:'add',node:{type:'label',id:'action_text'}},
  ]);
  const tk=generateFiles(doc,'tkinter').files['main.py'];
  const result=spawnSync('python',['-X','utf8','-c','import ast, sys; m=ast.parse(sys.stdin.read()); names=[n.targets[0].id for n in ast.walk(m) if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)]; assert len(names)==len(set(names)), names'],{input:tk,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const c=generateFiles(doc,'lvgl').files['ui_generated.c'];assert(c.includes('lv_obj_t *ui_action_text = lv_label_create(parent)'));assert(!c.includes('lv_obj_t *ui_action_text = lv_label_create(ui_action)'));
});
test('project detection reads evidence without executing project code',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ui-studio-detect-'));
  await fs.writeFile(path.join(root,'app.py'),'import tkinter\nfrom PySide6 import QtWidgets\nraise RuntimeError("must never execute")');
  await fs.writeFile(path.join(root,'screen.c'),'#include "lvgl.h"\nvoid create() { lv_label_create(0); }');
  const result=await inspectProject(root);assert.deepEqual(result.frameworks.map(f=>f.framework).sort(),['lvgl','qt-python','tkinter']);
});
