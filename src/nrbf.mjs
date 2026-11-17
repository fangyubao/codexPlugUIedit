// Read MS-NRBF as data only. Never instantiate named .NET types or invoke delegates.
// Reference: Microsoft MS-NRBF record/type specifications.
import {assert} from './model.mjs';

export function parseNrbf(input,{trace=()=>{},allowTrailing=false}={}){
  const b=Buffer.from(input);assert(b.length<=16*1024*1024,'NRBF 文件过大');
  let p=0,records=0,depth=0,ended=false,rootId;
  const objects=new Map(),schemas=new Map(),libraries=new Map();
  function need(n){assert(Number.isInteger(n)&&n>=0&&p+n<=b.length,`NRBF 数据截断 @${p}`);}
  function u8(){need(1);return b[p++];}
  function i32(){need(4);const v=b.readInt32LE(p);p+=4;return v;}
  function size(n){assert(Number.isInteger(n)&&n>=0&&n<=100000,'NRBF 集合长度越界');return n;}
  function str(){let n=0,shift=0,part;do{assert(shift<35,'NRBF 字符串长度无效');part=u8();n+=(part&127)*2**shift;shift+=7;}while(part&128);need(n);assert(n<=2*1024*1024,'NRBF 字符串过大');const v=b.toString('utf8',p,p+n);p+=n;return v;}
  function primitive(type){
    const formats={1:['readUInt8',1],2:['readUInt8',1],6:['readDoubleLE',8],7:['readInt16LE',2],8:['readInt32LE',4],9:['readBigInt64LE',8],10:['readInt8',1],11:['readFloatLE',4],12:['readBigInt64LE',8],13:['readBigInt64LE',8],14:['readUInt16LE',2],15:['readUInt32LE',4],16:['readBigUInt64LE',8]};
    if(type===17)return null;if(type===5||type===18)return str();
    if(type===3){const start=p,first=u8(),n=first<128?1:first<224?2:first<240?3:4;need(n-1);p+=n-1;return b.toString('utf8',start,p);}
    const f=formats[type];assert(f,`不支持 NRBF 基元 ${type}`);need(f[1]);let v=b[f[0]](p);p+=f[1];if(type===1)v=!!v;return typeof v==='bigint'?v.toString():v;
  }
  function typeInfo(type){if(type===0||type===7)return u8();if(type===3)return str();if(type===4)return{name:str(),libraryId:i32()};assert([1,2,5,6].includes(type),'不支持 NRBF 类型');return null;}
  function put(id,obj){assert(!objects.has(id),'重复 NRBF ObjectId');objects.set(id,obj);return obj;}
  function values(n,type=2,info=null){const out=[];while(out.length<n){const v=type===0?primitive(info):record();if(v?.$nulls!==undefined){assert(v.$nulls>0&&out.length+v.$nulls<=n,'无效空值计数');out.push(...Array(v.$nulls).fill(null));}else out.push(v);}return out;}
  function classValue(id,schema,offset){const out=put(id,{$id:id,$type:schema.name,$offset:offset,fields:Object.create(null),spans:Object.create(null)});for(let i=0;i<schema.members.length;i++){const start=p;out.fields[schema.members[i]]=schema.types[i]===0?primitive(schema.infos[i]):record();out.spans[schema.members[i]]={offset:start,length:p-start,binaryType:schema.types[i],primitiveType:schema.types[i]===0?schema.infos[i]:null};trace({class:schema.name,id,field:schema.members[i],start,end:p,type:schema.types[i],info:schema.infos[i],value:out.fields[schema.members[i]]});}return out;}
  function record(){
    assert(++records<=200000,'NRBF 记录过多');assert(++depth<=128,'NRBF 嵌套过深');const start=p;
    try{
      let type=u8();while(type===12){const id=i32();libraries.set(id,str());type=u8();}trace({record:type,start,depth});
      if(type===0){assert(start===0,'NRBF 头位置无效');rootId=i32();const header=i32(),major=i32(),minor=i32();assert(major===1&&minor===0,'NRBF 版本不支持');return{$header:true,rootId,header};}
      if(type===1){const id=i32(),metadata=i32(),schema=schemas.get(metadata);assert(schema,`NRBF 元数据 ${metadata} 不存在`);return classValue(id,schema,start);}
      if(type===4||type===5){const id=i32(),name=str(),n=size(i32()),members=Array.from({length:n},str),types=Array.from({length:n},u8),infos=types.map(typeInfo),libraryId=type===5?i32():null;const schema={name,members,types,infos,libraryId};schemas.set(id,schema);return classValue(id,schema,start);}
      if(type===6){const id=i32();return put(id,str());}
      if(type===7){const id=i32(),arrayType=u8(),rank=size(i32());assert(rank>0&&rank<=8,'NRBF 数组维数无效');const dimensions=Array.from({length:rank},()=>size(i32())),bounds=arrayType>=3?Array.from({length:rank},i32):null,itemType=u8(),info=typeInfo(itemType),n=size(dimensions.reduce((a,v)=>a*v,1));const out=put(id,{$id:id,$array:[],dimensions,bounds});out.$array=values(n,itemType,info);return out;}
      if(type===8)return primitive(u8());
      if(type===9)return{$ref:i32()};
      if(type===10)return null;
      if(type===11){ended=true;return{$end:true};}
      if(type===13)return{$nulls:u8()};
      if(type===14)return{$nulls:size(i32())};
      if(type===15||type===16||type===17){const id=i32(),n=size(i32()),primitiveType=type===15?u8():null,out=put(id,{$id:id,$array:[]});out.$array=values(n,type===15?0:2,primitiveType);return out;}
      throw new Error(`不支持 NRBF record ${type} @${start}`);
    }finally{depth--;}
  }
  const header=record();assert(header.$header,'缺少 NRBF 头');while(p<b.length&&!ended)record();assert(ended&&(allowTrailing||p===b.length),`NRBF 结束或尾部数据异常 @${p}/${b.length}`);
  function deref(value){let n=0;while(value&&typeof value==='object'&&'$ref'in value){assert(++n<100,'NRBF 引用循环');assert(objects.has(value.$ref),'NRBF 引用缺失');value=objects.get(value.$ref);}return value;}
  const field=(obj,name)=>deref(deref(obj)?.fields?.[name]);
  const array=obj=>{obj=deref(obj);return (obj?.$array||[]).map(deref);};
  function plain(obj,seen=new Set(),level=0){obj=deref(obj);if(obj===null||typeof obj!=='object')return obj;if(seen.has(obj)||level>=12)return{$ref:obj.$id};const next=new Set(seen);next.add(obj);if(obj.$array)return obj.$array.map(v=>plain(v,next,level+1));const out={$type:obj.$type,$id:obj.$id};for(const[k,v]of Object.entries(obj.fields||{}))out[k]=plain(v,next,level+1);return out;}
  for(const obj of objects.values())if(obj&&typeof obj==='object')for(const value of Object.values(obj.fields||obj.$array||{}))deref(value);
  return{root:deref(objects.get(rootId)),objects,schemas,libraries,deref,field,array,plain,bytesRead:p,trailingBytes:b.length-p,recordCount:records};
}
