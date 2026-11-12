import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, fingerprint, normalize, referencesOf } from './schema.mjs';

export class Store {
  constructor(dir) {
    mkdirSync(dir,{recursive:true}); this.dir=dir;
    this.db = new DatabaseSync(path.join(dir,'studio.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, fingerprint TEXT, document TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 1, created TEXT, updated TEXT);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, project_id TEXT, scene_id TEXT, state TEXT, task_id TEXT, result TEXT, error TEXT, attempt INTEGER DEFAULT 1, created TEXT, updated TEXT, UNIQUE(project_id,scene_id));
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, message TEXT, time TEXT);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, name TEXT, mime TEXT, file TEXT);
      CREATE TABLE IF NOT EXISTS scene_reviews(job_id TEXT PRIMARY KEY,state TEXT,note TEXT,time TEXT);
      CREATE TABLE IF NOT EXISTS image_qc(job_id TEXT PRIMARY KEY,report TEXT,time TEXT);
      CREATE TABLE IF NOT EXISTS job_attempts(job_id TEXT,attempt INTEGER,snapshot TEXT,created TEXT,PRIMARY KEY(job_id,attempt));
    `);
    this.db.prepare("UPDATE jobs SET state='unknown',error='Máy chủ dừng khi đang gửi. Kiểm tra Tiến độ Muse trước khi gửi lại.' WHERE state='submitting'").run();
  }
  event(id,message) {this.db.prepare('INSERT INTO events(project_id,message,time) VALUES(?,?,?)').run(id,message,new Date().toISOString());}
  create(document, force=false) {
    const hash=fingerprint(document);
    const old = !force && (this.db.prepare('SELECT id FROM projects WHERE fingerprint=?').get(hash)||this.list().find(p=>fingerprint(normalize(p))===hash));
    if(old) return {...this.get(old.id),reused:true};
    const id=randomUUID(), now=new Date().toISOString();
    this.db.prepare('INSERT INTO projects VALUES(?,?,?,1,?,?)').run(id,hash,JSON.stringify(document),now,now);
    this.event(id,`Nhập kịch bản: ${document.scenes.length} cảnh. Chưa gửi tạo nội dung.`);
    return this.get(id);
  }
  get(id) {
    const p=this.db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if(!p) throw new AppError('Không tìm thấy dự án.',404,'NOT_FOUND');
    const jobs=this.db.prepare('SELECT * FROM jobs WHERE project_id=? ORDER BY created').all(id).map(j=>{const qc=this.db.prepare('SELECT report FROM image_qc WHERE job_id=?').get(j.id);return {...j,result:j.result?JSON.parse(j.result):null,review:this.db.prepare('SELECT state,note,time FROM scene_reviews WHERE job_id=?').get(j.id)||null,qc:qc?JSON.parse(qc.report):null,history:this.db.prepare('SELECT snapshot FROM job_attempts WHERE job_id=? ORDER BY attempt').all(j.id).map(r=>JSON.parse(r.snapshot))};});
    return {id,...JSON.parse(p.document),paused:!!p.paused,created:p.created,updated:p.updated,jobs};
  }
  list() {return this.db.prepare('SELECT id FROM projects ORDER BY created DESC').all().map(p=>this.get(p.id));}
  update(id,document) {
    const p=this.get(id);const canonical=normalize(p);
    for(const j of p.jobs) {
      const before=canonical.scenes.find(s=>s.id===j.scene_id), after=document.scenes.find(s=>s.id===j.scene_id);
      if(fingerprint(before)!==fingerprint(after)) throw new AppError(`Cảnh ${j.scene_id} đã có tác vụ. Hãy tạo bản sao dự án để sửa cảnh này.`,409,'SCENE_LOCKED');
    }
    this.db.prepare('UPDATE projects SET document=?,fingerprint=?,updated=? WHERE id=?').run(JSON.stringify(document),fingerprint(document),new Date().toISOString(),id);
    return this.get(id);
  }
  pause(id,paused) {this.get(id);this.db.prepare('UPDATE projects SET paused=?,updated=? WHERE id=?').run(paused?1:0,new Date().toISOString(),id);this.event(id,paused?'Tạm dừng gửi cảnh mới. Tác vụ đã gửi vẫn được theo dõi.':'Cho phép gửi các cảnh trong hàng đợi.');return this.get(id);}
  enqueue(id, sceneIds) {
    const p=this.get(id);
    if(sceneIds!==undefined&&(!Array.isArray(sceneIds)||sceneIds.some(s=>typeof s!=='string')))throw new AppError('scenes phải là danh sách ID cảnh.');
    const ids=[...(sceneIds?.length?sceneIds:p.scenes.map(s=>s.id))];
    for(const sid of ids) if(!p.scenes.some(s=>s.id===sid)) throw new AppError(`Không có cảnh ${sid}.`);
    for(let i=0;i<ids.length;i++){const s=p.scenes.find(s=>s.id===ids[i]);for(const ref of referencesOf(s))if(ref.startsWith('scene:')&&!ids.includes(ref.slice(6)))ids.push(ref.slice(6));}
    const add=this.db.prepare('INSERT OR IGNORE INTO jobs(id,project_id,scene_id,state,created,updated) VALUES(?,?,?,\'queued\',?,?)');
    const now=new Date().toISOString();
    this.db.exec('BEGIN');
    try {for(const sid of ids)add.run(randomUUID(),id,sid,now,now);this.db.exec('COMMIT');} catch(e){this.db.exec('ROLLBACK');throw e;}
    return this.pause(id,false);
  }
  job(id) {const j=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);if(!j)throw new AppError('Không có tác vụ.',404);return {...j,result:j.result?JSON.parse(j.result):null};}
  setJob(id,fields) {
    const allowed=['state','task_id','result','error','attempt'];
    const entries=Object.entries(fields).filter(([k])=>allowed.includes(k));
    this.db.prepare(`UPDATE jobs SET ${entries.map(([k])=>`${k}=?`).join(',')},updated=? WHERE id=?`).run(...entries.map(([k,v])=>k==='result'&&v!==null?JSON.stringify(v):v),new Date().toISOString(),id);
    return this.job(id);
  }
  review(id,{state,note=''}){const j=this.job(id),p=this.get(j.project_id),s=p.scenes.find(s=>s.id===j.scene_id);if(s.kind!=='image'||j.state!=='completed')throw new AppError('Chỉ duyệt được ảnh đã hoàn tất.',409);if(!['approved','rejected','pending'].includes(state)||typeof note!=='string'||note.length>2000)throw new AppError('Trạng thái hoặc ghi chú duyệt không hợp lệ.');this.db.prepare('INSERT OR REPLACE INTO scene_reviews VALUES(?,?,?,?)').run(id,state,note,new Date().toISOString());this.event(p.id,`${s.title}: ${state==='approved'?'đã duyệt ảnh':state==='pending'?'chờ duyệt ảnh thủ công':'yêu cầu tạo lại ảnh'}.`);return this.get(p.id);}
  retry(id) {const j=this.job(id),review=this.db.prepare('SELECT state FROM scene_reviews WHERE job_id=?').get(id);if(!['failed','cancelled','blocked'].includes(j.state)&&!(j.state==='completed'&&review?.state==='rejected'))throw new AppError('Chỉ thử lại tác vụ lỗi, bị hủy hoặc ảnh đã bị từ chối. Tác vụ chưa rõ kết quả cần đối chiếu Muse trước.',409);this.db.prepare('INSERT OR IGNORE INTO job_attempts VALUES(?,?,?,?)').run(id,j.attempt,JSON.stringify({...j,review}),new Date().toISOString());this.db.prepare('DELETE FROM scene_reviews WHERE job_id=?').run(id);this.db.prepare('DELETE FROM image_qc WHERE job_id=?').run(id);this.setJob(id,{state:'queued',task_id:null,result:null,error:null,attempt:j.attempt+1});this.pause(j.project_id,false);return this.job(id);}
  events(id) {return this.db.prepare('SELECT * FROM events WHERE project_id=? ORDER BY id DESC LIMIT 60').all(id);}
  close() {this.db.close();}
}
