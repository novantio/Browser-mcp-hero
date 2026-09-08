import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Dataset, DataRecord, Json, Snapshot, Job } from '../../shared/data-contracts';
import { DataStore } from './store';
import { assess, clean, privateText, hash, similarity, getPath, differences } from './processing';
import { RpcError } from '../../shared/rpc-error';

export function paginate<T>(items:T[],offset=0,limit=50):{items:T[];total:number;nextOffset:number|null}{
 return {items:items.slice(offset,offset+limit),total:items.length,nextOffset:offset+limit<items.length?offset+limit:null};
}
export class DataAnalysis {
 constructor(readonly store:DataStore){}
 build(p:{name:string;jobId?:string;parentId?:string;minQuality:number;language:string;chunkSize:number;nearDedup:boolean;removeBoilerplate:boolean}):Omit<Dataset,'rows'>{
  const parent=p.parentId?this.store.get<Dataset>('dataset',p.parentId):null;
  const source=parent?[...new Set(parent.rows.map(r=>r.recordId))].map(id=>this.store.record(id)):this.store.records({jobId:p.jobId,limit:10001}).items;
  if(source.length>10000)throw new RpcError('DATASET_LIMIT','Batasi sumber hingga 10.000 record per versi dataset.');
  const dataset:Dataset={id:randomUUID(),name:p.name,version:parent?parent.version+1:1,parentId:parent?.id??null,createdAt:new Date().toISOString(),rows:[],metrics:{input:source.length,unique:0,duplicates:0,nearDuplicates:0,pii:0,short:0,spam:0,averageQuality:0,languages:{}}};
  const lineCounts=new Map<string,number>();
  for(const r of source)for(const line of new Set(r.text.split('\n').map(clean).filter(l=>l.length>10)))lineCounts.set(line,(lineCounts.get(line)||0)+1);
  const seen=new Set<string>(),buckets=new Map<string,string[]>();
  for(const record of source){
   let text=clean(record.text);
   if(p.removeBoilerplate&&source.length>=5)text=text.split('\n').filter(l=>(lineCounts.get(clean(l))||0)<source.length*0.8).join('\n');
   const safe=privateText(text);text=clean(safe.text);const info=assess(text);
   if(safe.pii||record.pii)dataset.metrics.pii++;if(text.length<40)dataset.metrics.short++;if(info.spam)dataset.metrics.spam++;
   const key=hash(text.toLowerCase());if(seen.has(key)){dataset.metrics.duplicates++;continue;}seen.add(key);
   const bucket=text.toLowerCase().split(/\s+/).slice(0,3).join(' '),candidates=buckets.get(bucket)||[];
   if(p.nearDedup&&candidates.some(t=>similarity(t,text)>=0.9)){dataset.metrics.nearDuplicates++;continue;}
   candidates.push(text);buckets.set(bucket,candidates.slice(-100));
   if(!text||info.quality<p.minQuality||(p.language!=='all'&&info.language!==p.language))continue;
   dataset.metrics.unique++;dataset.metrics.averageQuality+=info.quality;
   dataset.metrics.languages[info.language]=(dataset.metrics.languages[info.language]||0)+1;
   let start=0,chunk=0;
   while(start<text.length){
    let end=Math.min(start+p.chunkSize,text.length);
    if(end<text.length){const boundary=text.lastIndexOf(' ',end);if(boundary>start+p.chunkSize/2)end=boundary;}
    dataset.rows.push({id:randomUUID(),text:text.slice(start,end).trim(),recordId:record.id,chunk:chunk++,language:info.language,quality:info.quality,source:record.source,provenance:record.provenance});
    start=end;while(text[start]===' ')start++;
   }
  }
  dataset.metrics.averageQuality=dataset.metrics.unique?dataset.metrics.averageQuality/dataset.metrics.unique:0;
  this.store.put('dataset',dataset.id,dataset);return this.summary(dataset);
 }
 summary(dataset:Dataset):Omit<Dataset,'rows'>&{rowCount:number}{const {rows,...rest}=dataset;return {...rest,rowCount:rows.length};}
 async export(id:string,format:'json'|'jsonl'|'csv'|'parquet'):Promise<{path:string;rows:number}>{
  const dataset=this.store.get<Dataset>('dataset',id);
  const dir=path.join(this.store.directory,'exports');mkdirSync(dir,{recursive:true});
  const filename=path.join(dir,dataset.id+'-'+randomUUID()+'.'+format);
  const rows=dataset.rows.map(r=>({...r,source:JSON.stringify(r.source),provenance:JSON.stringify(r.provenance)}));
  if(format==='parquet'){
   const {parquetWriteBuffer}=await import('hyparquet-writer');
   const buffer=parquetWriteBuffer({columnData:[
    ...['id','text','recordId','language','source','provenance'].map(name=>({name,type:'STRING' as const,data:rows.map(r=>String(r[name as keyof typeof r]))})),
    {name:'quality',type:'DOUBLE',data:rows.map(r=>r.quality)},{name:'chunk',type:'INT32',data:rows.map(r=>r.chunk)},
   ]});writeFileSync(filename,Buffer.from(buffer),{flag:'wx'});
  }else{
   let output='';
   if(format==='json')output=JSON.stringify(dataset.rows,null,2);
   if(format==='jsonl')output=dataset.rows.map(r=>JSON.stringify(r)).join('\n')+(rows.length?'\n':'');
   if(format==='csv'){
    const cols=['id','text','recordId','chunk','language','quality','source','provenance'] as const;
    const cell=(value:unknown)=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
    output=cols.join(',')+'\r\n'+rows.map(r=>cols.map(k=>cell(r[k])).join(',')).join('\r\n');
   }
   writeFileSync(filename,output,{encoding:'utf8',flag:'wx'});
  }
  return {path:filename,rows:rows.length};
 }
 compare(beforeId:string,afterId:string):unknown[]{
  const before=this.store.get<Snapshot>('snapshot',beforeId),after=this.store.get<Snapshot>('snapshot',afterId);
  if(before.jobId!==after.jobId||before.url!==after.url)throw new RpcError('SNAPSHOT_MISMATCH','Pilih snapshot dari job dan URL yang sama.');
  const job=this.store.get<Job>('job',before.jobId);return differences(before.rows,after.rows,job.schema.identityFields);
 }
 candidates(alias:string):unknown[]{
  const normalized=(s:string)=>s.toLowerCase().replace(/^@/,'').replace(/[._\s-]/g,'');
  return this.store.list<{id:string;name:string;aliases:string[];evidence:string}>('entity').flatMap(e=>{
   const exact=e.aliases.some(a=>a.toLowerCase()===alias.toLowerCase()),similar=e.aliases.some(a=>normalized(a)===normalized(alias));
   return exact||similar?[{...e,confidence:exact?0.95:0.5,evidenceType:exact?'reviewed_alias':'name_similarity_only',requiresReview:!exact}]:[];
  });
 }
 link(p:{name:string;aliases:string[];recordIds:string[];evidence:string;reviewed:true}):unknown{
  const entity={id:randomUUID(),name:p.name,aliases:[...new Set(p.aliases)],evidence:p.evidence,reviewedAt:new Date().toISOString()};
  const records=p.recordIds.map(id=>this.store.record(id));
  this.store.transaction(()=>{this.store.put('entity',entity.id,entity);for(const r of records)this.store.updateRecord({...r,entityId:entity.id});});return entity;
 }
 analytics(p:{jobId?:string;topic?:string;field?:string;entityIds?:string[];offset?:number;limit?:number}):unknown{
  const all=this.store.records({jobId:p.jobId,topic:p.topic,limit:10000});
  const records=all.items.filter(r=>!p.entityIds?.length||p.entityIds.includes(r.entityId||''));
  const buckets=new Map<string,number>();
  for(const r of records){const key=r.source.collectedAt.slice(0,13)+':00:00Z';buckets.set(key,(buckets.get(key)||0)+1);}
  const trends=[...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([time,value])=>({time,value}));
  const series=p.field?this.store.list<Snapshot>('snapshot').filter(s=>!p.jobId||s.jobId===p.jobId).sort((a,b)=>a.collectedAt.localeCompare(b.collectedAt)).flatMap(s=>s.rows.map(row=>({time:s.collectedAt,value:getPath(row,p.field!)})).filter((v):v is {time:string;value:number}=>typeof v.value==='number')):trends;
  const anomalies=series.flatMap((point,i)=>{
   const prior=series.slice(Math.max(0,i-20),i).map(x=>x.value);if(prior.length<5)return [];
   const mean=prior.reduce((a,b)=>a+b,0)/prior.length,std=Math.sqrt(prior.reduce((a,b)=>a+(b-mean)**2,0)/prior.length);
   const z=Math.abs(point.value-mean)/Math.max(std,1);return z>=3?[{...point,baseline:mean,zScore:z,score:Math.min(1,z/6)}]:[];
  });
  const entities=(p.entityIds||[]).map(id=>({id,records:records.filter(r=>r.entityId===id).length}));
  const sentiment=records.map(r=>{const w=r.text.toLowerCase().split(/\W+/);const positive=w.filter(x=>['bagus','baik','suka','good','great','love'].includes(x)).length;const negative=w.filter(x=>['buruk','benci','jelek','bad','hate','poor'].includes(x)).length;return {recordId:r.id,sentiment:positive>negative?'positive':negative>positive?'negative':'neutral'};});
  return {method:'local_heuristics_v1',sampled:all.total>10000,total:records.length,timeline:paginate(records,p.offset,p.limit),trends,series,anomalies,entities,sentiment:sentiment.slice(0,200)};
 }
 graph(p:{jobId?:string;topic?:string}):unknown{
  const records=this.store.records({...p,limit:10000});const edges=new Map<string,{source:string;target:string;kind:string;weight:number}>();
  for(const r of records.items){
   const source=r.entityId||String(r.data.username||r.data.author||r.source.domain);
   for(const [kind,matches] of [['mentions',r.text.match(/@[\w.]+/g)||[]],['hashtag',r.text.match(/#[\p{L}\p{N}_]+/gu)||[]],['link',r.text.match(/https?:\/\/[^\s<>"]+/g)||[]]] as Array<[string,string[]]>){
    for(const target of matches){const key=source+'\0'+kind+'\0'+target;const edge=edges.get(key)||{source,target,kind,weight:0};edge.weight++;edges.set(key,edge);}
   }
  }
  const list=[...edges.values()].slice(0,1000);return {nodes:[...new Set(list.flatMap(e=>[e.source,e.target]))],edges:list,sampled:records.total>10000};
 }
 embeddings(model:string,items:Array<{recordId:string;vector:number[]}>):{indexed:number}{
  const existing=this.store.list<{model:string;vector:number[]}>('embedding').find(e=>e.model===model);
  const dim=existing?.vector.length??items[0]!.vector.length;
  for(const item of items){this.store.record(item.recordId);if(item.vector.length!==dim||!item.vector.some(v=>v!==0))throw new RpcError('VECTOR_DIMENSION','Dimensi vektor harus konsisten dan tidak nol.');}
  this.store.transaction(()=>{for(const item of items)this.store.put('embedding',hash([model,item.recordId]),{model,...item});});return {indexed:items.length};
 }
 semantic(model:string,vector:number[],limit:number):unknown[]{
  const entries=this.store.list<{model:string;recordId:string;vector:number[]}>('embedding').filter(e=>e.model===model);
  if(!entries.length)throw new RpcError('EMBEDDINGS_MISSING','Tambahkan embedding dengan model yang sama terlebih dahulu.');
  if(entries.some(e=>e.vector.length!==vector.length)||!vector.some(v=>v!==0))throw new RpcError('VECTOR_DIMENSION','Dimensi query tidak sesuai indeks.');
  const norm=(v:number[])=>Math.sqrt(v.reduce((s,n)=>s+n*n,0));
  return entries.map(e=>({record:this.store.record(e.recordId),score:e.vector.reduce((s,n,i)=>s+n*vector[i]!,0)/(norm(e.vector)*norm(vector))})).sort((a,b)=>b.score-a.score).slice(0,limit);
 }
}
