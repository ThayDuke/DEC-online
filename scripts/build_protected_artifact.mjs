import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const output = resolve(process.argv[3] || 'dist');
const keyText = process.env.DEC_CONTENT_KEY_B64;

if (!keyText) throw new Error('DEC_CONTENT_KEY_B64 is required');
const key = Buffer.from(keyText, 'base64');
if (key.length !== 32) throw new Error('DEC_CONTENT_KEY_B64 must decode to exactly 32 bytes');

async function filesUnder(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({
    v: 1,
    alg: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: ciphertext.toString('base64url'),
  }) + '\n';
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// Reuse the established DMU dashboard as the online shell. The static lesson
// tree is hidden and replaced at runtime with the authorized catalog.
const dashboard = await readFile(join(root, 'index.html'), 'utf8');
const onlineStyle = `<style id="dec-online-guard">
#treeRoot{visibility:hidden}#dec-online-gate{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:rgba(9,18,32,.96);color:#fff;font-family:var(--font-body,system-ui);padding:24px}#dec-online-gate[hidden]{display:none}.dec-online-gate-card{max-width:520px;width:100%;padding:32px;border-radius:24px;background:#14243a;border:1px solid rgba(255,255,255,.16);box-shadow:0 24px 80px rgba(0,0,0,.35)}.dec-online-gate-card h2{margin-top:0}.dec-online-gate-card button{border:0;border-radius:12px;padding:12px 18px;background:#2da9a0;color:#fff;font-weight:700;cursor:pointer}.dec-online-student{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.dec-online-student button{background:#23486a}.dec-online-user{position:fixed;right:22px;top:18px;z-index:30;display:flex;gap:8px;align-items:center;font:600 13px system-ui;color:var(--text-main,#234)}.dec-online-user button{border:1px solid currentColor;border-radius:9px;background:transparent;padding:6px 10px;cursor:pointer}
</style>`;
const onlineScript = `<script id="dec-online-dashboard">(()=>{const $=s=>document.querySelector(s), gate=document.createElement('div');gate.id='dec-online-gate';gate.innerHTML='<div class="dec-online-gate-card"><h2>DEC Online</h2><p id="dec-online-gate-message">Đang kiểm tra đăng nhập...</p><div class="dec-online-student" id="dec-online-students"></div></div>';document.body.appendChild(gate);const user=document.createElement('div');user.className='dec-online-user';user.hidden=true;document.body.appendChild(user);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const folderSlug=v=>String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');function lessonIcon(type){return type==='quiz'?'fa-list-check':'fa-comment-dots'}function renderTree(entries){const root=$('#treeRoot');if(!root)return;root.innerHTML='';const tree={};for(const e of entries){const parts=e.public_path.replace(/^\/CONTENT\/levels\//,'').split('/');let node=tree;for(const part of parts.slice(0,-1)){node[node[part]||(node[part]={__items:[]})];node=node[part]}(node.__items||(node.__items=[])).push(e)}let id=0;const make=(node,depth=0)=>{const frag=document.createDocumentFragment();for(const [name,value] of Object.entries(node)){if(name==='__items')continue;const wrap=document.createElement('div');wrap.className='tree-node folder-container';wrap.dataset.name=name.toLowerCase();const key='dec-folder-'+(++id);const label=document.createElement('button');label.type='button';label.className='folder-label';label.setAttribute('aria-expanded','false');label.innerHTML='<span class="icon sway-icon folder-icon--default"><i class="fa-solid fa-folder"></i></span><span class="name"></span><span class="badge"></span><span class="chevron"><i class="fa-solid fa-chevron-right"></i></span>';label.querySelector('.name').textContent=name;label.querySelector('.badge').textContent=((value.__items||[]).length+Object.keys(value).filter(k=>k!=='__items').length)+' mục';const content=document.createElement('div');content.className='folder-content';content.id=key;label.setAttribute('aria-controls',key);label.onclick=()=>{const open=label.getAttribute('aria-expanded')==='true';label.setAttribute('aria-expanded',String(!open));label.classList.toggle('open',!open)};content.append(make(value,depth+1));for(const e of value.__items||[]){const row=document.createElement('div');row.className='lesson-item-row';row.dataset.name=e.title.toLowerCase();const a=document.createElement('a');a.className='file-link';a.target='_blank';a.rel='noopener noreferrer';a.href=e.public_path;a.innerHTML='<span class="icon sway-icon"><i class="fa-solid '+lessonIcon(e.type)+'"></i></span><span class="name"></span><span class="play-tag"></span>';a.querySelector('.name').textContent=e.title;a.querySelector('.play-tag').textContent=e.type==='quiz'?(e.result?.completed?'Đã làm':'Quiz'):'Luyện tập';row.append(a);content.append(row)}wrap.append(label,content);frag.append(wrap)}return frag};root.append(make(tree));root.style.visibility='visible'}async function json(url,opt){const r=await fetch(url,{credentials:'same-origin',...opt});if(!r.ok)throw new Error(String(r.status));return r.json()}async function boot(){try{const me=await json('/api/auth/me');gate.hidden=true;user.hidden=false;user.innerHTML='<span>'+esc(me.email)+'</span><button type="button">Đăng xuất</button>';user.querySelector('button').onclick=()=>location.href='/api/auth/logout';const catalog=await json('/api/catalog');renderTree(catalog.entries||[])}catch(e){gate.hidden=false;$('#dec-online-gate-message').textContent='Đăng nhập để mở thư viện bài học.';const b=document.createElement('button');b.textContent='Đăng nhập bằng Google';b.onclick=()=>location.href='/api/auth/start';$('#dec-online-students').replaceChildren(b)}}boot()})();</script>`;
const safeOnlineScript = onlineScript.replace("e.public_path.replace(/^/CONTENT/levels//,'')", "e.public_path.split('/').slice(3).join('/')");
const catalogErrorScript = safeOnlineScript.replace("catch(e){gate.hidden=false;$('#dec-online-gate-message').textContent='Đăng nhập để mở thư viện bài học.';const b=document.createElement('button');b.textContent='Đăng nhập bằng Google';b.onclick=()=>location.href='/api/auth/start';$('#dec-online-students').replaceChildren(b)}", "catch(e){console.error('DEC catalog bootstrap failed',e);gate.hidden=false;$('#dec-online-gate-message').textContent=user.hidden?'Đăng nhập để mở thư viện bài học.':'Không tải được thư viện. Vui lòng thử lại.';const b=document.createElement('button');b.textContent=user.hidden?'Đăng nhập bằng Google':'Thử lại';b.onclick=()=>user.hidden?location.href='/api/auth/start':location.reload();$('#dec-online-students').replaceChildren(b)}");
const shell = dashboard.replace('</head>', `${onlineStyle}</head>`).replace('</body>', `${catalogErrorScript}</body>`);
await writeFile(join(output, 'index.html'), shell);
try {
  const manifest = await readFile(join(root, 'manifest', 'lesson-manifest.json'));
  await mkdir(join(output, 'manifest'), { recursive: true });
  await writeFile(join(output, 'manifest', 'lesson-manifest.json'), manifest);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.warn('manifest/lesson-manifest.json is absent; protected routes remain fail-closed.');
}

const contentRoot = join(root, 'CONTENT');
const contentFiles = await filesUnder(contentRoot);
for (const source of contentFiles) {
  const relativeSource = relative(root, source);
  const target = join(output, `${relativeSource}.enc`);
  await mkdir(resolve(target, '..'), { recursive: true });
  const plaintext = await readFile(source);
  await writeFile(target, encrypt(plaintext), 'utf8');
}

const digest = createHash('sha256');
for (const source of contentFiles.sort()) digest.update(await readFile(source));
await writeFile(join(output, 'BUILD_CONTENT_SHA256'), `${digest.digest('hex')}\n`);
console.log(JSON.stringify({ content_files: contentFiles.length, output }, null, 2));
