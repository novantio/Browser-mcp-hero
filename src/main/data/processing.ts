import { createHash } from 'node:crypto';
import type { Change, FieldSpec, Json } from '../../shared/data-contracts';
import { RpcError } from '../../shared/rpc-error';
import { redactText } from '../../shared/redaction';
export const hash=(value:unknown):string=>createHash('sha256').update(stable(value)).digest('hex');
export function stable(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';
 return JSON.stringify(value)??'null';
}
export const clean=(v:string):string=>v.normalize('NFKC').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
export function privateText(value:string):{text:string;pii:boolean} {
 const text=redactText(value).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[EMAIL]')
 .replace(/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g,m=>m.replace(/\D/g,'').length>=9?'[PHONE_OR_ID]':m)
 .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi,'[TOKEN]');
 return {text,pii:text!==value};
}
export function sanitizeData(value:Json):Json {
 if(typeof value==='string')return privateText(value).text;
 if(Array.isArray(value))return value.map(sanitizeData);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/password|secret|cookie|token|authorization/i.test(k)?'[REDACTED]':sanitizeData(v)]));
 return value;
}
export function getPath(value:Record<string,Json>,path:string):Json {
 let current:Json=value;for(const part of path.split('.')){if(!current||typeof current!=='object'||Array.isArray(current))return null;current=current[part]??null;}return current;
}
export function setPath(value:Record<string,Json>,path:string,item:Json):void {
 const parts=path.split('.');if(parts.some(p=>['__proto__','prototype','constructor'].includes(p)))throw new RpcError('INVALID_FIELD','Nama field tidak valid.');
 let current=value;for(const part of parts.slice(0,-1)){current[part]??={};current=current[part] as Record<string,Json>;}current[parts.at(-1)!]=item;
}
export function convert(raw:string|null,field:FieldSpec,base:string):Json {
 if(!raw?.trim()){if(field.required)throw new RpcError('EXTRACTION_MISSING','Field wajib tidak ditemukan: '+field.path);return null;}
 const value=clean(raw);let parsed:Json=null;
 if(field.type==='string')parsed=value;
 if(field.type==='url'){try{const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol))throw Error();u.username='';u.password='';u.hash='';u.search='';parsed=u.href;}catch{}}
 if(field.type==='boolean'){if(/^(true|yes|ya|1)$/i.test(value))parsed=true;else if(/^(false|no|tidak|0)$/i.test(value))parsed=false;}
 if(field.type==='datetime'){const t=Date.parse(value);if(Number.isFinite(t))parsed=new Date(t).toISOString();}
 if(field.type==='integer'||field.type==='number'){
  const suffix=value.toLowerCase().match(/([kmbr])(?:\b|$)/)?.[1];let n=value.replace(/[^\d.,+-]/g,'');
  if(suffix)n=n.replace(',','.');else if(/^\d{1,3}([.,]\d{3})+$/.test(n))n=n.replace(/[.,]/g,'');else n=n.replace(',','.');
  const result=Number(n)*(suffix==='k'||suffix==='r'?1000:suffix==='m'?1000000:suffix==='b'?1000000000:1);
  if(n&&Number.isFinite(result)&&(field.type!=='integer'||Number.isInteger(result)))parsed=result;
 }
 if(parsed===null&&field.required)throw new RpcError('EXTRACTION_TYPE','Format field tidak sesuai: '+field.path);
 return parsed;
}
export function assess(text:string):{language:string;quality:number;spam:boolean} {
 const words=text.toLowerCase().match(/\p{L}+/gu)||[];
 const id=words.filter(w=>['yang','dan','untuk','dengan','ini','dari','adalah','pada','tidak','kami','saya'].includes(w)).length;
 const en=words.filter(w=>['the','and','for','with','this','from','is','are','not','we','our'].includes(w)).length;
 const diversity=new Set(words).size/Math.max(1,words.length),spam=words.length>10&&diversity<0.25||(text.match(/https?:\/\//g)||[]).length>10;
 return {language:id>en&&id>0?'id':en>id&&en>0?'en':'unknown',quality:Math.round(Math.max(0,Math.min(1,Math.min(words.length/80,1)*0.5+diversity*0.5-(spam?0.4:0)))*100)/100,spam};
}
export function similarity(a:string,b:string):number {
 const tokens=(s:string)=>new Set(s.toLowerCase().match(/\p{L}+/gu)||[]);const x=tokens(a),y=tokens(b);
 return [...x].filter(w=>y.has(w)).length/Math.max(1,new Set([...x,...y]).size);
}
export function differences(before:Record<string,Json>[],after:Record<string,Json>[],identityFields:string[]):Change[] {
 const index=(rows:Record<string,Json>[])=>{
  const map=new Map<string,Record<string,Json>>();
  for(const row of rows){const identity=identityFields.length?identityFields.map(f=>getPath(row,f)):null;
   if(identity?.some(v=>v===null))throw new RpcError('MISSING_IDENTITY','Field identitas tidak ditemukan.');
   const key=identity?stable(identity):hash(row);if(map.has(key)&&identityFields.length)throw new RpcError('DUPLICATE_IDENTITY','Identitas harus unik dalam snapshot.');map.set(key,row);
  }return map;
 };
 const a=index(before),b=index(after),changes:Change[]=[];
 const walk=(key:string,left:Json,right:Json,field:string)=>{
  if(stable(left)===stable(right))return;
  if(left&&right&&typeof left==='object'&&typeof right==='object'&&!Array.isArray(left)&&!Array.isArray(right)){
   for(const name of new Set([...Object.keys(left),...Object.keys(right)]))walk(key,left[name]??null,right[name]??null,field?field+'.'+name:name);
  }else{const delta=typeof left==='number'&&typeof right==='number'?right-left:null;changes.push({key,field:field||'$record',before:left,after:right,delta,percent:delta!==null&&typeof left==='number'&&left!==0?delta/Math.abs(left)*100:null});}
 };
 for(const key of new Set([...a.keys(),...b.keys()]))walk(key,a.get(key)??null,b.get(key)??null,'');return changes;
}
export function safeUrl(value:string):string {
 const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new RpcError('INVALID_URL','Gunakan alamat HTTP atau HTTPS tanpa kredensial.');
 u.hash='';for(const key of [...u.searchParams.keys()])if(/token|code|secret|auth|key|session/i.test(key))u.searchParams.delete(key);return u.href;
}
