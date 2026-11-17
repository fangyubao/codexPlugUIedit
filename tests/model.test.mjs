import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore, newDocument, newNode, applyOperations, contained } from '../src/model.mjs';

test('manual and agent revisions reject stale writes; shared undo/redo survives reopening',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ui-studio-store-'));
  const store=new DocumentStore();const first=await store.open(root,{demo:true});
  const manual=await store.mutate(first.id,0,'edit',[{op:'update',id:'connect',changes:{x:520,text:'连接开发板'}}]);
  assert.equal(manual.document.nodes.find(n=>n.id==='connect').x,520);
  await assert.rejects(store.mutate(first.id,0,'edit',[{op:'update',id:'connect',changes:{x:100}}]),e=>e.status===409);
  const results=await Promise.allSettled([store.mutate(first.id,1,'edit',[{op:'update',id:'connect',changes:{width:160}}]),store.mutate(first.id,1,'edit',[{op:'update',id:'connect',changes:{width:200}}])]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const undone=await store.mutate(first.id,2,'undo');assert.equal(undone.document.nodes.find(n=>n.id==='connect').width,128);
  const redone=await store.mutate(first.id,3,'redo');assert.equal(redone.document.nodes.find(n=>n.id==='connect').width,160);
  const reopened=await new DocumentStore().open(root);assert.equal(reopened.revision,4);assert.equal(reopened.document.nodes.find(n=>n.id==='connect').text,'连接开发板');
});
test('operations are atomic and reject cyclic hierarchy or locked mutations',()=>{
  const doc=newDocument(true);
  assert.throws(()=>applyOperations(doc,[{op:'update',id:'connect',changes:{text:'edited'}},{op:'update',id:'settings',changes:{parentId:'settings'}}]),/循环/);
  assert.equal(doc.nodes.find(n=>n.id==='connect').text,'连接设备');
  const locked=applyOperations(doc,[{op:'update',id:'connect',changes:{locked:true}}]);
  assert.throws(()=>applyOperations(locked,[{op:'remove',ids:['settings']}]),/锁定/);
  assert.throws(()=>applyOperations(locked,[{op:'update',id:'connect',changes:{text:'overwrite'}}]),/锁定/);
  const removed=applyOperations(doc,[{op:'remove',ids:['settings']}]);assert(!removed.nodes.some(n=>n.parentId==='settings'));
});
test('generated identifiers and values cannot inject source code',()=>{
  const doc=newDocument();assert.throws(()=>applyOperations(doc,[{op:'add',node:{type:'label',id:'bad);system("hi")'}}]),/ID/);
  assert.throws(()=>applyOperations(doc,[{op:'add',node:{type:'label',fontSize:Infinity}}]),/数值/);
  assert.throws(()=>applyOperations(doc,[{op:'canvas',changes:{width:-1}}]),/尺寸/);
});
test('file paths reject traversal and junction escapes for existing and new files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ui-studio-path-'));
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'ui-studio-outside-'));
  await assert.rejects(contained(root,'../secret.txt',{existing:false}),/工程内/);
  await fs.symlink(outside,path.join(root,'escaped'),'junction');
  await assert.rejects(contained(root,'escaped/new/file.txt',{existing:false}),/工程外部/);
  const good=await contained(root,'new/file.txt',{existing:false});assert.equal(good,path.join(root,'new','file.txt'));
});
