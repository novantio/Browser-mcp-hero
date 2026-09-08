import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DataRecord } from '../../shared/data-contracts';
import { RpcError } from '../../shared/rpc-error';
export class DataStore {
 readonly db:DatabaseSync;readonly directory:string;
 constructor(userDataDir:string){
  this.directory=path.join(userDataDir,'data-runtime');mkdirSync(this.directory,{recursive:true});
  this.db=new DatabaseSync(path.join(this.directory,'acquisition.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  this.db.exec('CREATE TABLE IF NOT EXISTS documents(kind TEXT NOT NULL,id TEXT NOT NULL,created INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS doc_kind_created ON documents(kind,created);');
  this.db.exec('CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,hash TEXT NOT NULL,language TEXT NOT NULL,topic TEXT NOT NULL,engagement REAL NOT NULL,json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS records_job ON records(job_id); CREATE INDEX IF NOT EXISTS records_hash ON records(hash); CREATE VIRTUAL TABLE IF NOT EXISTS record_search USING fts5(id UNINDEXED,text);');
 }
 put<T>(kind:string,id:string,value:T):void{this.db.prepare('INSERT INTO documents(kind,id,created,json) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind,id,Date.now(),JSON.stringify(value));}
 get<T>(kind:string,id:string):T{const row=this.db.prepare('SELECT json FROM documents WHERE kind=? AND id=?').get(kind,id);if(!row)throw new RpcError('DATA_NOT_FOUND','Data tidak ditemukan.');return JSON.parse(String(row.json)) as T;}
 list<T>(kind:string):T[]{return this.db.prepare('SELECT json FROM documents WHERE kind=? ORDER BY created DESC,rowid DESC').all(kind).map(r=>JSON.parse(String(r.json)) as T);}
 transaction<T>(work:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 addRecord(record:DataRecord):void{
  if(this.db.prepare('SELECT id FROM records WHERE id=?').get(record.id))return;
  const e=record.data.engagement;
  const total=e&&typeof e==='object'&&!Array.isArray(e)?Object.values(e).reduce<number>((sum,v)=>sum+(typeof v==='number'?v:0),0):0;
  this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?)').run(record.id,record.provenance.jobId,record.hash,record.language,record.source.topic,total,JSON.stringify(record));
  this.db.prepare('INSERT INTO record_search(id,text) VALUES(?,?)').run(record.id,record.text);
 }
 record(id:string):DataRecord{const row=this.db.prepare('SELECT json FROM records WHERE id=?').get(id);if(!row)throw new RpcError('DATA_NOT_FOUND','Record tidak ditemukan.');return JSON.parse(String(row.json));}
 updateRecord(record:DataRecord):void{this.db.prepare('UPDATE records SET json=? WHERE id=?').run(JSON.stringify(record),record.id);}
 records(options:{jobId?:string;query?:string;language?:string;topic?:string;minEngagement?:number;offset?:number;limit?:number}={}):{items:DataRecord[];total:number;nextOffset:number|null}{
  const where:string[]=[],args:Array<string|number>=[];
  if(options.jobId){where.push('r.job_id=?');args.push(options.jobId);}
  if(options.language){where.push('r.language=?');args.push(options.language);}
  if(options.topic){where.push('r.topic=?');args.push(options.topic);}
  if(options.minEngagement){where.push('r.engagement>=?');args.push(options.minEngagement);}
  if(options.query?.trim()){const tokens=options.query.match(/[\p{L}\p{N}_]+/gu)||[];if(tokens.length){where.push('r.id IN (SELECT id FROM record_search WHERE record_search MATCH ?)');args.push(tokens.map(t=>'"'+t+'"').join(' AND '));}}
  const clause=where.length?' WHERE '+where.join(' AND '):'';
  const total=Number(this.db.prepare('SELECT count(*) AS n FROM records r'+clause).get(...args)?.n??0);
  const limit=options.limit??50,offset=options.offset??0;
  const items=this.db.prepare('SELECT r.json FROM records r'+clause+' ORDER BY r.rowid DESC LIMIT ? OFFSET ?').all(...args,limit,offset).map(r=>JSON.parse(String(r.json)) as DataRecord);
  return {items,total,nextOffset:offset+items.length<total?offset+items.length:null};
 }
  getLineage(recordId: string): Record<string, unknown> {
    const rec = this.record(recordId);
    let job: unknown = null;
    try { job = this.get('job', rec.provenance.jobId); } catch {}
    let snapshot: unknown = null;
    try { snapshot = this.get('snapshot', rec.provenance.snapshotId); } catch {}
    const allDatasets = this.list<any>('dataset');
    const datasetsContaining = allDatasets
      .filter(ds => ds.rows && ds.rows.some((r: any) => r.recordId === recordId))
      .map(ds => ({ id: ds.id, name: ds.name, version: ds.version }));
    return {
      record: { id: rec.id, hash: rec.hash, language: rec.language, quality: rec.quality },
      source: rec.source,
      provenance: rec.provenance,
      job,
      snapshot,
      datasets: datasetsContaining,
    };
  }
 delete(kind:string,id:string):void{this.db.prepare('DELETE FROM documents WHERE kind=? AND id=?').run(kind,id);}
 close():void{this.db.close();}
}
