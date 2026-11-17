import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';
import {JSDOM} from 'jsdom';
import {run} from '../scripts/prepare-runtime.mjs';
import {newDocument,newNode} from '../src/model.mjs';

test('production HTML bundle parses and initializes a native WatchX editor',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  await run(process.execPath,[path.join(root,'scripts/build.mjs')],{cwd:root});
  const html=await fs.readFile(path.join(root,'dist/editor.html'),'utf8');
  assert.equal((html.match(/<!doctype html>/gi)||[]).length,1);
  assert(!html.includes('/* STUDIO_JS */'));
  const dom=new JSDOM(html,{url:'http://127.0.0.1:9999/?session=watch#token=sample',runScripts:'outside-only',pretendToBeVisual:true});
  try{
    const {window:w}=dom;assert.equal(w.document.scripts.length,1);
    const script=w.document.scripts[0].textContent;
    await transform(script,{loader:'js'});
    w.structuredClone=structuredClone;w.setInterval=()=>0;w.setTimeout=()=>0;
    const doc=newDocument();doc.source={kind:'watchx-lvgl6',page:'DialPlate',savedRevision:null};doc.canvas={width:135,height:240,background:'#000000',grid:1};
    doc.nativePreview={image:'data:image/png;base64,iVBORw0KGgo='};
    doc.nodes=[newNode('label',{id:'root_1',text:'1255',nativeKind:'lv_label',sourceRef:{line:10,instance:0}})];
    const calls=[];w.fetch=async(url,request)=>{const requestData=JSON.parse(request.body);calls.push(requestData);return{ok:true,json:async()=>({id:'watch',revision:0,document:doc,contentKind:'imported-watchx',selectedIds:[],canUndo:false,canRedo:false})};};
    w.eval(script);await new Promise(resolve=>setImmediate(resolve));
    assert(calls.some(c=>c.action==='get_ui_document'));
    assert.equal(w.document.getElementById('welcome').hidden,true);
    assert.equal(w.document.getElementById('connection').textContent,'本地已连接');
    assert.equal(w.document.querySelectorAll('.widget').length,1);
    assert(w.document.getElementById('canvas').style.backgroundImage.includes('data:image/png'));
    assert.equal(w.document.getElementById('watchx-pages').hidden,false);
  }finally{dom.window.close();}
});
