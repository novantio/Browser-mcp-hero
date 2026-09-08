import { z } from 'zod';
import type { ToolContract } from './mcp-contracts';
const id=z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const text=z.string().min(1).max(2000);
export const fieldSchema=z.object({
 path:z.string().min(1).max(120).regex(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/).refine(s=>!s.split('.').some(p=>['__proto__','prototype','constructor'].includes(p))),
 selector:z.string().max(500).default(''),type:z.enum(['string','integer','number','datetime','url','boolean']).default('string'),
 attribute:z.enum(['href','src','datetime','title','aria-label']).optional(),required:z.boolean().default(false),
}).strict();
export const extractionSchema=z.object({rowSelector:text.default('article'),fields:z.array(fieldSchema).min(1).max(30),identityFields:z.array(z.string().min(1).max(120)).max(5).default([]),maxItems:z.number().int().min(1).max(200).default(100)}).strict();
export const stepSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('navigate'),url:text}).strict(),
 z.object({action:z.literal('click'),selector:text}).strict(),
 z.object({action:z.literal('type'),selector:text,text:z.string().max(2000)}).strict(),
 z.object({action:z.literal('scroll'),direction:z.enum(['up','down','top','bottom']).default('down'),amount:z.number().min(1).max(10000).default(700)}).strict(),
 z.object({action:z.literal('wait'),selector:text.optional(),ms:z.number().int().min(100).max(60000).optional()}).strict(),
 z.object({action:z.literal('extract')}).strict(),z.object({action:z.literal('human'),message:text}).strict(),
]);
export const jobInput=z.object({
 name:z.string().trim().min(1).max(80),profileId:id,targets:z.array(text).min(1).max(100),schema:extractionSchema,steps:z.array(stepSchema).max(100).default([]),
 intervalMinutes:z.number().int().min(1).max(525600).nullable().default(null),topic:z.string().max(120).default(''),sourceType:z.string().max(80).default('web'),captureScreenshot:z.boolean().default(false),
}).strict();
export type FieldSpec=z.infer<typeof fieldSchema>;
export type ExtractionSpec=z.infer<typeof extractionSchema>;
export type WorkflowStep=z.infer<typeof stepSchema>;
export type JobDefinition=z.infer<typeof jobInput>;
export type Json=string|number|boolean|null|Json[]|{[key:string]:Json};
export interface DataRecord {
 id:string;text:string;data:Record<string,Json>;hash:string;language:string;quality:number;pii:boolean;spam:boolean;
 source:{url:string;domain:string;sourceType:string;collectedAt:string;profileId:string;topic:string};
 provenance:{jobId:string;runId:string;snapshotId:string;extractorVersion:string};entityId?:string;
}
export interface Job extends JobDefinition {
 id:string;status:'idle'|'running'|'paused'|'waiting_human'|'completed'|'cancelled'|'failed';createdAt:number;nextRunAt:number|null;runId:string|null;taskId:string|null;cursor:number;step:number;records:number;error:string|null;
}
export interface Snapshot {id:string;jobId:string;runId:string;url:string;collectedAt:string;rows:Record<string,Json>[];html:string;screenshotPath?:string}
export interface Change {key:string;field:string;before:Json;after:Json;delta:number|null;percent:number|null}
export interface Recording {id:string;name:string;profileId:string;steps:WorkflowStep[];status:'recording'|'stopped';createdAt:number;omitted:number}
export interface Dataset {
  id:string;name:string;version:number;parentId:string|null;createdAt:string;
  rows:Array<{id:string;text:string;recordId:string;chunk:number;language:string;quality:number;source:DataRecord['source'];provenance:DataRecord['provenance']}>;
  metrics:{input:number;unique:number;duplicates:number;nearDuplicates:number;pii:number;short:number;spam:number;averageQuality:number;languages:Record<string,number>};
}
export interface NetworkRecord {
  id:string;requestId:string;url:string;method:string;status:number;mimeType:string;
  requestHeaders:Record<string,string>;responseHeaders:Record<string,string>;postData?:string;
  body?:string;jsonBody?:Json;timestamp:number;durationMs:number;lastAction?:string;
}
export interface NetworkRecipe {
  id:string;name:string;urlPattern:string;method:string;headers:Record<string,string>;
  postPayloadTemplate?:string;responseExtractionPath?:string;createdAt:string;
}
export interface HealedSelector {
  targetSelector:string;resolvedSelector:string;confidence:number;strategyUsed:string;
  candidates:Array<{selector:string;confidence:number;tag:string;sampleText:string}>;
}
export interface DriftReport {
  jobId:string;timestamp:string;hasDrift:boolean;
  fields:Array<{field:string;expectedType:string;driftType:'none'|'null_spike'|'distribution_shift'|'type_mismatch';confidence:number;previousStats:{mean?:number;nullPercentage:number;count:number};currentStats:{mean?:number;nullPercentage:number;count:number};message:string}>;
}
export interface ReviewItem {
  id:string;type:'schema_drift'|'low_confidence'|'ambiguous_duplicate'|'pii_flag';jobId?:string;recordId?:string;payload:Record<string,Json>;confidence:number;status:'pending'|'approved'|'rejected'|'merged'|'edited';createdAt:string;resolvedAt?:string;resolutionNotes?:string;
}
export interface FrontierItem {
  id:string;url:string;domain:string;depth:number;priority:number;status:'queued'|'visited'|'failed';retries:number;discoveredAt:string;lastAttemptAt?:string;error?:string;
}
export interface CopilotSynthesis {
  targetUrl:string;goalContract:Record<string,string>;recommendedStrategy:string;suggestedSchema:ExtractionSpec;discoveredEndpoints:Array<{url:string;method:string;relevanceScore:number}>;sampleRecords:Record<string,Json>[];testAccuracy:number;jobReady:boolean;
}
export const multiStrategySpec = z.object({
  taskId: id, schema: extractionSchema,
  strategy: z.enum(['auto', 'network', 'embedded_json', 'json_ld', 'dom', 'accessibility', 'visual']).default('auto'),
  minConfidence: z.number().min(0).max(1).default(0.5)
}).strict();
export const jobSchema=jobInput.extend({id,status:z.enum(['idle','running','paused','waiting_human','completed','cancelled','failed']),createdAt:z.number(),nextRunAt:z.number().nullable(),runId:id.nullable(),taskId:id.nullable(),cursor:z.number(),step:z.number(),records:z.number(),error:z.string().nullable()}).strict();
const jsonObject=z.record(z.string(),z.any());
const page=z.object({items:z.array(z.json()),total:z.number(),nextOffset:z.number().nullable()}).strict();
const define=(name:string,method:string,description:string,input:z.ZodObject,output:z.ZodType):ToolContract=>({name,method,description,input,output});
const obj=(shape:Record<string,z.ZodType>)=>z.object(shape).strict();
const jobId=obj({jobId:id});
const pagination={offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(50)};
export const dataContracts:ToolContract[]=[
  define('data_get_overview','data.overview','Ringkasan job, data, dataset dan recorder lokal.',obj({}),jsonObject),
  define('scrape_create_job','data.createJob','Buat job persisten. Tidak langsung berjalan.',jobInput,jobSchema),
  define('scrape_list_jobs','data.listJobs','Daftar job lokal.',obj({}),z.array(jobSchema)),
  ...['run','pause','resume','cancel'].map(action=>define('scrape_'+action+'_job','data.'+action+'Job',action+' job tanpa menghapus hasil atau sesi.',jobId,jobSchema)),
  define('scrape_get_status','data.getJob','Status dan checkpoint job.',jobId,jobSchema),
  define('scrape_get_results','data.results','Hasil dengan provenance.',obj({jobId:id.optional(),...pagination}),page),
  define('browser_extract_schema','data.extractSchema','Ekstraksi menurut pemetaan field pada tab task aktif.',obj({taskId:id,schema:extractionSchema}),z.array(jsonObject)),
  define('discovery_get_links','data.discover','Temukan tautan HTTP pada halaman task.',obj({taskId:id,keyword:z.string().max(200).default(''),limit:z.number().int().min(1).max(200).default(50)}),z.array(jsonObject)),
  define('recorder_start','data.recordStart','Rekam interaksi manual tab aktif. Input sensitif dilewati.',obj({name:z.string().min(1).max(80)}),jsonObject),
  define('recorder_stop','data.recordStop','Hentikan rekaman untuk ditinjau.',obj({}),jsonObject),
  define('recorder_list','data.recordList','Daftar rekaman.',obj({}),z.array(jsonObject)),
  define('recorder_update','data.recordUpdate','Koreksi langkah rekaman sebelum replay.',obj({recordingId:id,steps:z.array(stepSchema).max(100)}),jsonObject),
  define('recorder_create_job','data.recordConvert','Konversi rekaman yang telah ditinjau menjadi job.',obj({recordingId:id,schema:extractionSchema,name:z.string().min(1).max(80),intervalMinutes:z.number().int().min(1).max(525600).nullable().default(null)}),jobSchema),
  define('monitor_create','data.createJob','Buat pemantauan snapshot berkala.',jobInput,jobSchema),
  define('monitor_run','data.runJob','Ambil snapshot sekarang.',jobId,jobSchema),
  define('monitor_get_history','data.history','Riwayat snapshot.',obj({jobId:id,...pagination}),page),
  define('monitor_get_changes','data.changes','Perubahan dibanding snapshot sebelumnya.',obj({jobId:id,...pagination}),page),
  define('monitor_compare_snapshots','data.compare','Bandingkan snapshot dari job dan URL sama.',obj({beforeId:id,afterId:id}),z.array(jsonObject)),
  define('dataset_build','data.buildDataset','Buat versi dataset baru. Filter PII aktif; sumber tidak diubah.',obj({name:z.string().min(1).max(80),jobId:id.optional(),parentId:id.optional(),minQuality:z.number().min(0).max(1).default(0),language:z.enum(['all','id','en','unknown']).default('all'),chunkSize:z.number().int().min(100).max(8000).default(2000),nearDedup:z.boolean().default(true),removeBoilerplate:z.boolean().default(true)}),jsonObject),
  define('dataset_list','data.listDatasets','Daftar versi dataset.',obj({}),z.array(jsonObject)),
  define('dataset_get_quality','data.quality','Metrik kualitas heuristik.',obj({datasetId:id}),jsonObject),
  define('dataset_get_rows','data.datasetRows','Baris dataset dengan provenance.',obj({datasetId:id,...pagination}),page),
  define('dataset_export','data.exportDataset','Ekspor lokal tanpa menimpa file.',obj({datasetId:id,format:z.enum(['json','jsonl','csv','parquet'])}),obj({path:z.string(),rows:z.number()})),
  define('data_search','data.search','Pencarian full-text dengan filter bahasa, topik dan engagement.',obj({query:z.string().max(500).default(''),language:z.string().max(20).default(''),topic:z.string().max(120).default(''),minEngagement:z.number().min(0).default(0),...pagination}),page),
  define('entity_candidates','data.entityCandidates','Saran alias dengan bukti; tidak menggabungkan otomatis.',obj({alias:text}),z.array(jsonObject)),
  define('entity_link','data.entityLink','Simpan identitas kanonik setelah review manusia.',obj({name:text,aliases:z.array(text).min(1).max(30),recordIds:z.array(id).max(200).default([]),evidence:text,reviewed:z.literal(true)}),jsonObject),
  ...['get_activity_timeline','get_trends','detect_anomalies','compare_entities'].map(action=>define('analytics_'+action,'data.'+action,'Analisis lokal; skor bersifat heuristik.',obj({jobId:id.optional(),topic:z.string().max(120).default(''),entityIds:z.array(id).max(10).default([]),field:z.string().max(120).default(''),...pagination}),jsonObject)),
  define('analytics_get_graph','data.graph','Graf mention, hashtag dan tautan publik.',obj({jobId:id.optional(),topic:z.string().max(120).default('')}),jsonObject),
  define('search_set_embeddings','data.setEmbeddings','Indeks vektor dari agen dengan model dan dimensi konsisten.',obj({model:text,items:z.array(obj({recordId:id,vector:z.array(z.number().finite()).min(2).max(4096)})).min(1).max(200)}),obj({indexed:z.number()})),
  define('search_semantic','data.semantic','Cosine similarity dari embedding model yang sama.',obj({model:text,vector:z.array(z.number().finite()).min(2).max(4096),limit:z.number().int().min(1).max(100).default(20)}),z.array(jsonObject)),
  define('network_get_requests','data.networkRequests','Daftar request dan response API backend tersadap.',obj({taskId:id,filter:z.string().max(200).default(''),limit:z.number().int().min(1).max(200).default(50)}),z.array(jsonObject)),
  define('network_get_recipe','data.networkRecipe','Ekstrak resep network dari pertukaran API terakhir.',obj({taskId:id,requestId:z.string().max(100).optional()}),jsonObject),
  define('network_replay_recipe','data.networkReplay','Coba panggil ulang resep network untuk reproduktifitas.',obj({recipeId:id,params:z.record(z.string(),z.json()).optional()}),jsonObject),
  define('data_extract_multistrategy','data.extractMultiStrategy','Ekstraksi adaptif bertingkat (Network -> Embedded JSON -> DOM -> ARIA).',multiStrategySpec,z.array(jsonObject)),
  define('browser_collect','data.collect','Infinite scroll engine dengan in-flight deduplication.',obj({taskId:id,schema:extractionSchema,maxItems:z.number().int().min(1).max(2000).default(100),maxScrolls:z.number().int().min(1).max(500).default(20),timeoutMs:z.number().int().min(1000).max(300000).default(60000),terminationCondition:z.enum(['no_new_items','max_items','end_of_feed']).default('no_new_items')}),jsonObject),
  define('scraper_heal_selector','data.healSelector','Sembuhkan selector yang rusak berdasarkan kemiripan semantik dan ARIA.',obj({taskId:id,selector:text,previousTag:text.optional(),contextSnippet:text.optional()}),jsonObject),
  define('schema_check_drift','data.checkDrift','Pemeriksaan schema drift dan anomali distribusi data.',obj({jobId:id,schema:extractionSchema}),jsonObject),
  define('frontier_push_urls','data.frontierPush','Tambahkan URL ke crawl frontier berprioritas.',obj({urls:z.array(text).min(1).max(500),depth:z.number().int().min(0).max(10).default(0),priority:z.number().int().min(1).max(100).default(50)}),jsonObject),
  define('frontier_pop_batch','data.frontierPop','Ambil batch URL berikutnya dari crawl frontier.',obj({limit:z.number().int().min(1).max(100).default(10)}),z.array(jsonObject)),
  define('frontier_get_stats','data.frontierStats','Statistik antrean crawl frontier.',obj({}),jsonObject),
  define('review_list_items','data.reviewList','Daftar item pada antrean kurasi manusia (review queue).',obj({status:z.enum(['all','pending','approved','rejected','merged']).default('pending'),limit:z.number().int().min(1).max(200).default(50)}),z.array(jsonObject)),
  define('review_resolve_item','data.reviewResolve','Selesaikan item peninjauan (approve, reject, merge, edit).',obj({reviewId:id,resolution:z.enum(['approved','rejected','merged','edited']),editedData:jsonObject.optional()}),jsonObject),
  define('data_get_lineage','data.lineage','Telusuri silsilah data (data lineage) dari URL, request, ekstraktor, hingga dataset.',obj({recordId:id}),jsonObject),
  define('copilot_synthesize_job','data.copilotSynthesize','Scraper Copilot: sintesis otomatis skema, strategi, dan pengujian scraper.',obj({taskId:id,targetUrl:text,goalContract:jsonObject}),jsonObject),
];
export function dataContractFor(method: string): ToolContract | undefined { return dataContracts.find(tool => tool.method === method); }
