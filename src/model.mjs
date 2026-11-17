import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const TYPES = ['frame', 'label', 'button', 'input', 'checkbox', 'slider', 'progress'];
export const TARGETS = ['qt-ui', 'pyside6', 'qt-cpp', 'tkinter', 'lvgl'];
export class StudioError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function assert(value, message, status = 400) { if (!value) throw new StudioError(message, status); }
export const hash = text => createHash('sha256').update(text).digest('hex');
export const clone = obj => structuredClone(obj);
export const defaults = {
  frame: { name: '容器', width: 280, height: 180, text: '', background: '#ffffff', border: '#dce2ea', radius: 12 },
  label: { name: '文字', width: 180, height: 32, text: '文本标签', background: '#ffffff', border: '#ffffff', radius: 0 },
  button: { name: '按钮', width: 128, height: 42, text: '按钮', background: '#6654e8', color: '#ffffff', border: '#6654e8', radius: 8 },
  input: { name: '输入框', width: 240, height: 42, text: '请输入内容', background: '#ffffff', border: '#dce2ea', radius: 6 },
  checkbox: { name: '复选框', width: 160, height: 32, text: '选项', background: '#ffffff', border: '#ffffff', radius: 0 },
  slider: { name: '滑块', width: 220, height: 32, text: '', background: '#ffffff', border: '#ffffff', radius: 0 },
  progress: { name: '进度条', width: 220, height: 24, text: '', background: '#e8e5fb', border: '#e8e5fb', radius: 6 },
};
export function newNode(type, extra = {}) {
  assert(TYPES.includes(type), '未知控件类型');
  return { id: `w_${randomUUID().replaceAll('-', '').slice(0, 12)}`, type, x: 40, y: 40, width: 120, height: 40,
    text: '', name: type, color: '#253047', background: '#ffffff', border: '#dce2ea', radius: 6,
    fontSize: 14, value: 50, checked: false, locked: false, visible: true, parentId: null,
    ...defaults[type], ...extra };
}
export function newDocument(demo = false) {
  const document = { version: 1, title: demo ? '设备控制面板' : '未命名界面', target: 'pyside6',
    canvas: { width: 800, height: 480, background: '#f5f7fb', grid: 8 }, nodes: [], warnings: [], source: null, readOnly: false };
  if (demo) document.nodes = [
    newNode('label', { id: 'pageTitle', name: '页面标题', text: '设备控制台', x: 40, y: 30, width: 340, height: 46, fontSize: 28, background: '#f5f7fb' }),
    newNode('label', { id: 'subtitle', name: '说明文字', text: '连接你的设备，定义每一个细节。', x: 40, y: 84, width: 440, height: 28, color: '#788297', background: '#f5f7fb' }),
    newNode('frame', { id: 'settings', name: '设置卡片', x: 40, y: 140, width: 720, height: 242, radius: 14 }),
    newNode('label', { id: 'volumeTitle', name: '音量标签', text: '输出音量', x: 24, y: 24, width: 150, height: 28, fontSize: 16, parentId: 'settings' }),
    newNode('slider', { id: 'volume', name: '音量滑块', x: 24, y: 70, width: 440, height: 32, value: 64, parentId: 'settings' }),
    newNode('checkbox', { id: 'autoConnect', name: '自动连接', text: '启动时自动连接设备', x: 24, y: 134, width: 300, height: 34, checked: true, parentId: 'settings' }),
    newNode('button', { id: 'connect', name: '连接按钮', text: '连接设备', x: 568, y: 168, width: 128, height: 44, parentId: 'settings' }),
    newNode('label', { id: 'status', name: '连接状态', text: '●  等待连接', x: 40, y: 410, width: 240, height: 30, color: '#788297', background: '#f5f7fb' }),
  ];
  return document;
}
const numericKeys = ['x', 'y', 'width', 'height', 'fontSize', 'radius', 'value'];
const editableKeys = new Set(['name','text','x','y','width','height','color','background','border','radius','fontSize','value','checked','locked','visible','parentId']);
export function validateDocument(doc) {
  assert(doc && doc.version === 1 && Array.isArray(doc.nodes), '设计文档格式无效');
  assert(TARGETS.includes(doc.target), '未知导出目标');
  assert(typeof doc.title === 'string' && doc.title.length <= 200, '标题过长');
  for (const key of ['width', 'height']) assert(Number.isInteger(doc.canvas[key]) && doc.canvas[key] >= 64 && doc.canvas[key] <= 8192, '画布尺寸应为 64–8192');
  assert(/^#[0-9a-f]{6}$/i.test(doc.canvas.background), '无效画布颜色');
  assert(Number.isInteger(doc.canvas.grid) && doc.canvas.grid >= 1 && doc.canvas.grid <= 100, '网格尺寸应为 1–100');
  assert(doc.nodes.length <= 2000, '控件数量超出限制');
  const nodes = new Map();
  for (const node of doc.nodes) {
    assert(typeof node.id === 'string' && /^[A-Za-z_]\w{0,79}$/.test(node.id) && !nodes.has(node.id), '控件 ID 无效或重复');
    assert(typeof node.parentId === 'string' || node.parentId === null,'父控件 ID 无效');
    assert(TYPES.includes(node.type), '控件类型无效');
    for (const key of numericKeys) assert(Number.isFinite(node[key]), `${key} 必须为数值`);
    assert(Math.abs(node.x) <= 32768 && Math.abs(node.y) <= 32768, '控件坐标越界');
    const minimum=doc.source?.kind==='watchx-lvgl6'?1:8;
    assert(node.width >= minimum && node.height >= minimum && node.width <= 8192 && node.height <= 8192, '控件尺寸超出范围');
    assert(node.fontSize >= 6 && node.fontSize <= 200 && node.radius >= 0 && node.radius <= 500 && node.value >= 0 && node.value <= 100, '控件属性超出范围');
    for (const key of ['color','background','border']) assert(/^#[0-9a-f]{6}$/i.test(node[key]), `${key} 颜色无效`);
    assert(typeof node.name === 'string' && node.name.length <= 200 && typeof node.text === 'string' && node.text.length <= 10000, '控件文本无效');
    for (const key of ['locked','visible','checked']) assert(typeof node[key] === 'boolean', `${key} 必须为布尔值`);
    nodes.set(node.id, node);
  }
  for (const node of doc.nodes) {
    const visited = new Set([node.id]); let current = node;
    while (current.parentId) {
      assert(nodes.has(current.parentId) && nodes.get(current.parentId).type === 'frame', '父控件必须是容器');
      assert(!visited.has(current.parentId), '控件层级不能循环');
      visited.add(current.parentId); current = nodes.get(current.parentId);
    }
  }
  return doc;
}
export function applyOperations(original, operations) {
  assert(!original.readOnly, '此工程含暂不支持的布局或控件，仅可查看');
  assert(Array.isArray(operations) && operations.length > 0 && operations.length <= 500, '操作数量无效');
  const doc = clone(original);
  for (const op of operations) {
    if (op.op === 'add') { assert(!doc.source, '导入的 Qt 表单暂只支持修改已有控件；新增请从空白设计开始'); doc.nodes.push(newNode(op.node?.type, op.node)); }
    else if (op.op === 'update') {
      const node = doc.nodes.find(n => n.id === op.id); assert(node, '找不到控件');
      assert(op.changes && Object.keys(op.changes).every(key => editableKeys.has(key)), '包含不可修改的属性');
      assert(!node.locked || Object.keys(op.changes).every(k => k === 'locked'), '控件已锁定，请先解锁');
      if (doc.source) assert(!('parentId' in op.changes), '导入表单暂不支持改变层级');
      if(doc.source?.kind==='watchx-lvgl6'){
          assert(Object.keys(op.changes).every(k=>['name','locked','x','y','width','height','text','color','background','border','radius','visible','fontSize'].includes(k)),'WatchX 暂不支持该属性的原生编辑');
        assert(!('fontSize'in op.changes),'WatchX 字号由原字体资源决定，暂不支持替换字体');
        if('text'in op.changes)assert(node.nativeKind==='lv_label','只有文字控件支持修改文本');
        assert(node.sourceRef?.line,'该框架内部控件没有可编辑源码位置');
      }
      Object.assign(node, op.changes);
    } else if (op.op === 'remove') {
      assert(!doc.source, '导入表单暂不支持删除控件');
      assert(Array.isArray(op.ids) && op.ids.length > 0,'需要待删除的控件 ID');
      const ids = new Set(op.ids); assert([...ids].every(id => doc.nodes.some(n => n.id === id && !n.locked)), '控件不存在或已锁定');
      let changed = true;
      while (changed) { changed = false; for (const n of doc.nodes) if (ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); changed = true; } }
      assert(doc.nodes.filter(n => ids.has(n.id)).every(n => !n.locked), '容器包含锁定控件');
      doc.nodes = doc.nodes.filter(n => !ids.has(n.id));
    } else if (op.op === 'canvas') {
      assert(doc.source?.kind!=='watchx-lvgl6','WatchX 使用原屏幕尺寸与目标，不支持修改画布');
      assert(op.changes && Object.keys(op.changes).every(k => ['width','height','background','grid','title','target'].includes(k)), '画布属性无效');
      for (const [key,value] of Object.entries(op.changes)) { if (['title','target'].includes(key)) doc[key] = value; else doc.canvas[key] = value; }
    } else if (op.op === 'reorder') {
      assert(!doc.source, '导入表单暂不支持调整层级顺序');
      assert(Array.isArray(op.ids) && op.ids.length === doc.nodes.length && new Set(op.ids).size === doc.nodes.length, '需要所有控件 ID');
      doc.nodes = op.ids.map(id => { const node = doc.nodes.find(n => n.id === id); assert(node, '未知控件'); return node; });
    } else throw new StudioError('未知编辑操作');
  }
  return validateDocument(doc);
}
export async function atomicWrite(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, data, 'utf8'); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
export async function contained(root, relative, { existing = true } = {}) {
  assert(typeof relative === 'string' && relative.length && !path.isAbsolute(relative), '需要工程内的相对路径');
  const base = await fs.realpath(root);
  const candidate = path.resolve(base, relative);
  assert(candidate.startsWith(base + path.sep), '路径必须位于工程内');
  // Resolve the nearest existing ancestor, catching junction/symlink escapes for new files too.
  let current = candidate;
  for (;;) {
    try { const real = await fs.realpath(current); assert(real === base || real.startsWith(base + path.sep), '链接指向工程外部'); break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; const parent = path.dirname(current); assert(parent !== current, '路径无效'); current = parent; }
  }
  if (existing) await fs.access(candidate);
  return candidate;
}
export class DocumentStore {
  constructor() { this.sessions = new Map(); }
  async hasSaved(projectPath, sourceKey = '') {
    const root = await fs.realpath(projectPath), id = hash(root + '\n' + sourceKey).slice(0,24);
    if(this.sessions.has(id))return true;
    const file = await contained(root, `.ui-designer/designs/${id}.uidesign`, { existing: false });
    try { await fs.access(file); return true; } catch(e) { if(e.code==='ENOENT')return false; throw e; }
  }
  async open(projectPath, { demo = false, sourceKey = '', initial = null } = {}) {
    const root = await fs.realpath(projectPath);
    assert((await fs.stat(root)).isDirectory(), '工程路径必须是目录');
    const id = hash(root + '\n' + sourceKey).slice(0,24);
    if (this.sessions.has(id)) return this.snapshot(id);
    const file = await contained(root, `.ui-designer/designs/${id}.uidesign`, { existing: false });
    let state;
    try { state = JSON.parse(await fs.readFile(file, 'utf8')); validateDocument(state.document); }
    catch (e) { if (e.code !== 'ENOENT') throw e; state = { revision: 0, document: initial || newDocument(demo), history: [], future: [] }; }
    assert(Number.isInteger(state.revision) && state.revision >= 0 && Array.isArray(state.history) && Array.isArray(state.future), '保存的历史格式错误');
    const session = { ...state, id, root, file, selectedIds: [], queue: Promise.resolve() };
    this.sessions.set(id, session); await this.persist(session);
    return this.snapshot(id);
  }
  require(id) { const s = this.sessions.get(id); assert(s, '设计会话未打开，请先打开工程', 404); return s; }
  snapshot(id) {
    const s = this.require(id);
    const document = clone(s.document);
    if (document.source) document.source = { kind:document.source.kind, file:document.source.file, hash:document.source.hash, rootName:document.source.rootName,page:document.source.page,version:document.source.version,savedRevision:document.source.savedRevision };
    return clone({ id: s.id, view: 'editor', contentKind: document.source?.kind==='watchx-lvgl6'?'imported-watchx':document.source ? 'imported-form' : 'studio-design',
      projectPath: s.root, documentPath: s.file, revision: s.revision, document,
      selectedIds: s.selectedIds, canUndo: s.history.length > 0, canRedo: s.future.length > 0 });
  }
  async persist(s) {
    await contained(s.root, path.relative(s.root, s.file), { existing: false });
    await atomicWrite(s.file, JSON.stringify({ revision: s.revision, document: s.document, history: s.history, future: s.future }, null, 2));
  }
  async mutate(id, revision, action, operations) {
    const s = this.require(id);
    const run = s.queue.catch(() => {}).then(async () => {
      assert(revision === s.revision, '设计已更新，请读取最新版本后重试。未覆盖已有修改。', 409);
      const staged = { ...s, history: [...s.history], future: [...s.future], revision: s.revision + 1 };
      if (action === 'edit') { staged.document = applyOperations(s.document, operations); staged.history.push(clone(s.document)); staged.future = []; }
      else if (action === 'undo') { assert(staged.history.length, '没有可撤销的操作'); staged.future.push(clone(s.document)); staged.document = staged.history.pop(); }
      else if (action === 'redo') { assert(staged.future.length, '没有可重做的操作'); staged.history.push(clone(s.document)); staged.document = staged.future.pop(); }
      else throw new StudioError('未知历史操作');
      if(this.beforeCommit)await this.beforeCommit(s.root,staged.document);
      staged.history = staged.history.slice(-60); staged.future = staged.future.slice(-60);
      await this.persist(staged);
      Object.assign(s, { document: staged.document, history: staged.history, future: staged.future, revision: staged.revision });
      s.selectedIds = s.selectedIds.filter(id => s.document.nodes.some(n => n.id === id));
      return this.snapshot(id);
    });
    s.queue = run; return run;
  }
  selection(id, ids) { const s = this.require(id); assert(Array.isArray(ids), '选择格式错误'); s.selectedIds = [...new Set(ids)].filter(id => s.document.nodes.some(n => n.id === id)); return this.snapshot(id); }
}
