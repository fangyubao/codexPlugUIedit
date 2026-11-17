import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseNrbf} from '../src/nrbf.mjs';
import {inspectDwin,dwinInspectorHtml} from '../scripts/inspect-dwin.mjs';
import {JSDOM} from 'jsdom';

test('NRBF reader reads strings as inert data and rejects malformed or trailing bytes by default',()=>{
  const header=Buffer.from('0001000000ffffffff0100000000000000','hex');
  const string=Buffer.concat([Buffer.from('0601000000','hex'),Buffer.from([5]),Buffer.from('hello')]);
  const data=Buffer.concat([header,string,Buffer.from([11])]);
  const result=parseNrbf(data);assert.equal(result.root,'hello');assert.equal(result.trailingBytes,0);
  assert.throws(()=>parseNrbf(data.subarray(0,data.length-2)),/截断/);
  assert.throws(()=>parseNrbf(Buffer.concat([data,Buffer.from([0])])),/尾部/);
  assert.equal(parseNrbf(Buffer.concat([data,Buffer.from([0])]),{allowTrailing:true}).trailingBytes,1);
  assert.throws(()=>parseNrbf(Buffer.alloc(0)),/截断/);
});

test('actual DWIN project yields pages, controls, VP and page jumps without writing source',{skip:!process.env.DWIN_TEST_PROJECT},async()=>{
  const report=await inspectDwin(process.env.DWIN_TEST_PROJECT);assert.equal(report.width,854);assert.equal(report.height,480);assert.equal(report.pageCount,16);assert.equal(report.controlCount,132);assert.equal(report.pagesWithControls,10);assert.deepEqual(report.missing,[]);
  assert.equal(report.controlTypes.KeyCodeReturn,98);
  const main=report.pages.find(p=>p.index===1);assert.equal(main.objectCount,17);assert.equal(main.trailingBytes,321);
  const concentration=main.objects.find(n=>n.vp==='0x1010');assert.deepEqual(concentration.geometry,{x:26,y:161,width:428,height:128});
  assert(main.objects.some(n=>n.nextPage===3&&n.vp==='0x1000'));
  assert.equal(report.capabilities.sourceWriteBack,'not-implemented');
  const html=await dwinInspectorHtml(report),dom=new JSDOM(html,{runScripts:'dangerously'});
  try{const d=dom.window.document;assert.equal(d.getElementById('page').options.length,16);assert.equal(d.querySelectorAll('.region').length,17);
    d.querySelector('.region').click();assert(d.getElementById('properties').textContent.includes('0x1170'));
    const select=d.getElementById('page');select.value='15';select.dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelectorAll('.region').length,43);
    select.value='02';select.value='2';select.dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelectorAll('.region').length,0);
  }finally{dom.window.close();}
});
