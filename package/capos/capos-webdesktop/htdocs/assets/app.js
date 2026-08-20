const API="/cgi-bin/cap/api";
const STORE_URL="https://snap.capos.top/embed";
const STORE_ORIGIN=new URL(STORE_URL).origin;
const $=(id)=>document.getElementById(id);
const state={session:null,installed:[],endpoints:new Map(),selected:null,installing:new Map()};

function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function toast(message,error=false){const el=document.createElement("div");el.className=`toast${error?" error":""}`;el.textContent=message;$("toasts").append(el);setTimeout(()=>el.remove(),4200);}
async function request(path,options={}){const r=await fetch(API+path,{credentials:"same-origin",...options});let data;try{data=await r.json();}catch{throw new Error(`HTTP ${r.status}`)}if(!r.ok||data?.type==="error"||data?.ok===false)throw new Error(data?.message||data?.result?.message||`HTTP ${r.status}`);return data;}
function snapResult(data){return data?.result??[];}
function setDrawer(open){$("drawer").classList.toggle("open",open);}
function setTab(tab){document.querySelectorAll(".tab[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));$("installedPane").classList.toggle("active",tab==="installed");}

async function loadSession(){const data=await request("/session");if(!data.authenticated)return false;state.session=data.session;$("userBadge").textContent=`${state.session.username}${state.session.is_sudo?" · sudo":""}`;$("luciLink").style.display=state.session.is_sudo?"inline-flex":"none";return true;}
function showApp(){$("loginView").classList.add("hidden");$("appShell").classList.add("ready");}
function showLogin(){$("loginView").classList.remove("hidden");$("appShell").classList.remove("ready");}

async function login(e){e.preventDefault();try{await request("/login",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({username:$("username").value,password:$("password").value})});$("password").value="";await boot();}catch(e){toast(e.message,true)}}
async function logout(){try{await request("/logout",{method:"POST"})}finally{state.session=null;showLogin();}}

async function endpointFor(name,force=false){if(!force&&state.endpoints.has(name))return state.endpoints.get(name);try{const data=await request(`/snapd/snaps/${encodeURIComponent(name)}/endpoints`);state.endpoints.set(name,data.endpoints||[]);return data.endpoints||[];}catch{state.endpoints.set(name,[]);return[]}}
async function hydrateEndpoints(){const candidates=state.installed.slice(0,20);await Promise.all(candidates.map(s=>endpointFor(s.name)));renderInstalled();}
function primaryEndpoint(name){return (state.endpoints.get(name)||[]).find(e=>e.primary)||null;}

function installedCard(snap){const ep=primaryEndpoint(snap.name);const opened=state.selected===snap.name;const summary=snap.summary||snap.description||"已安装 Snap";const channel=snap["tracking-channel"]||snap.channel||"";const management=state.session?.is_sudo?`<button class="secondary" data-act="start" data-name="${esc(snap.name)}">启动服务</button><button class="secondary" data-act="stop" data-name="${esc(snap.name)}">停止服务</button><button class="secondary" data-act="refresh" data-name="${esc(snap.name)}">更新</button><button class="danger" data-act="remove" data-name="${esc(snap.name)}">卸载</button>`:"";return `<article class="app-card ${opened?"opened":""}"><div class="app-card-head"><div><h3>${esc(snap.name)}</h3><p>${esc(summary)}</p></div><span class="publisher">${esc(snap.version||"")}</span></div><div class="meta"><span class="chip">${esc(channel||"installed")}</span>${ep?`<span class="chip web">${esc(ep.protocol)}:${ep.port} · 自动发现</span>`:`<span class="chip">未发现 Web 入口</span>`}</div><div class="actions">${ep?`<button class="primary" data-act="open" data-name="${esc(snap.name)}">打开</button>`:`<button class="secondary" data-act="detect" data-name="${esc(snap.name)}">重新检测</button>`}${management}</div></article>`}
function renderInstalled(){const q=$("installedSearch").value.trim().toLowerCase();const items=state.installed.filter(s=>!q||`${s.name} ${s.summary||""} ${s.version||""}`.toLowerCase().includes(q));$("installedCount").textContent=`${state.installed.length} 个`;$("installedList").innerHTML=items.length?items.map(installedCard).join(""):`<div class="empty">没有匹配的已安装 Snap。</div>`;}
async function loadInstalled(){const data=await request("/snapd/snaps");state.installed=Array.isArray(snapResult(data))?snapResult(data):[];renderInstalled();postStoreState();void hydrateEndpoints();}

function changeProgress(result){if(result?.ready||result?.status==="Done")return 100;const tasks=Array.isArray(result?.tasks)?result.tasks:[];if(!tasks.length)return 3;let completed=0;let partial=0;for(const task of tasks){if(task?.status==="Done"){completed+=1;continue}const done=Number(task?.progress?.done);const total=Number(task?.progress?.total);if(Number.isFinite(done)&&Number.isFinite(total)&&total>0)partial+=Math.max(0,Math.min(1,done/total));else if(task?.status==="Doing")partial+=0.15;}return Math.max(2,Math.min(99,Math.round((completed+partial)/tasks.length*100)));}
async function waitChange(data,label,onProgress){const id=data?.change;if(!id){onProgress?.(100);toast(`${label}请求已提交`);return}toast(`${label}已提交 · change ${id}`);onProgress?.(2);for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,1000));const c=await request(`/snapd/changes/${encodeURIComponent(id)}`);const result=c.result||{};onProgress?.(changeProgress(result));if(result.ready||result.status==="Done"||result.status==="Error"){if(result.status==="Error")throw new Error(result.err||`${label}失败`);onProgress?.(100);toast(`${label}完成`);return}}throw new Error(`${label}仍在进行，请稍后刷新`)}
async function snapAction(name,action,label,body="",onProgress){const data=await request(`/snapd/snaps/${encodeURIComponent(name)}/${action}`,{method:"POST",headers:body?{"Content-Type":"application/x-www-form-urlencoded"}:{},body});await waitChange(data,label,onProgress);state.endpoints.delete(name);await loadInstalled();}
async function serviceAction(name,action){const data=await request(`/snapd/snaps/${encodeURIComponent(name)}/service/${action}`,{method:"POST"});await waitChange(data,`${action} ${name}`);state.endpoints.delete(name);setTimeout(async()=>{await endpointFor(name,true);renderInstalled()},800)}

async function openSnap(name){let ep=primaryEndpoint(name);if(!ep){await endpointFor(name,true);ep=primaryEndpoint(name)}if(!ep){toast("没有检测到 HTTP/HTTPS Web 入口",true);return}state.selected=name;$("activeApp").textContent=`${name} · ${ep.protocol}:${ep.port}`;$("welcome").classList.add("hidden");$("desktopFrame").classList.add("active");$("desktopFrame").src=`/cgi-bin/cap/app/${encodeURIComponent(name)}/`;setDrawer(false);renderInstalled();}
function openStore(){state.selected="@store";$("activeApp").textContent="CapOS App Store";$("welcome").classList.add("hidden");const frame=$("desktopFrame");frame.classList.add("active");frame.src=STORE_URL;setDrawer(false);}
function ask(title,text){return new Promise(resolve=>{$("confirmTitle").textContent=title;$("confirmText").textContent=text;const d=$("confirmDialog");const handler=()=>{d.removeEventListener("close",handler);resolve(d.returnValue==="ok")};d.addEventListener("close",handler);d.showModal()})}

function storeFrame(){return state.selected==="@store"?$("desktopFrame"):null;}
function postStore(message){const frame=storeFrame();if(frame?.contentWindow)frame.contentWindow.postMessage(message,STORE_ORIGIN);}
function postStoreState(){postStore({type:"capos-webdesktop:state",version:1,installed:state.installed.map(s=>s.name),installing:Object.fromEntries(state.installing),canInstall:state.session?.is_sudo===true});}
function validSnapName(name){return typeof name==="string"&&name.length<=64&&/^(?=.*[a-z])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name);}
async function installFromStore(name,channel){if(!state.session?.is_sudo)throw new Error("安装 Snap 需要 sudo 权限");if(state.installed.some(s=>s.name===name)){postStoreState();return}if(state.installing.has(name))return;state.installing.set(name,1);postStore({type:"capos-webdesktop:progress",version:1,name,progress:1});try{const body=new URLSearchParams({channel:channel||"stable"}).toString();await snapAction(name,"install",`安装 ${name}`,body,progress=>{state.installing.set(name,progress);postStore({type:"capos-webdesktop:progress",version:1,name,progress});});state.installing.delete(name);postStoreState();}catch(error){state.installing.delete(name);postStoreState();const message=error instanceof Error?error.message:String(error);postStore({type:"capos-webdesktop:error",version:1,name,message});toast(message,true);}}
function onStoreMessage(event){const frame=storeFrame();if(!frame||event.origin!==STORE_ORIGIN||event.source!==frame.contentWindow||!event.data||typeof event.data!=="object")return;const message=event.data;if(message.type==="capos-store:hello"){postStoreState();return}if(message.type==="capos-store:install"){if(!validSnapName(message.name)){postStore({type:"capos-webdesktop:error",version:1,message:"无效的 Snap 名称"});return}void installFromStore(message.name,typeof message.channel==="string"?message.channel:"stable");return}if(message.type==="capos-store:open"){if(!validSnapName(message.name)||!state.installed.some(s=>s.name===message.name)){postStore({type:"capos-webdesktop:error",version:1,name:message.name,message:"该 Snap 尚未安装"});return}void openSnap(message.name);}}

async function onInstalledClick(e){const b=e.target.closest("button[data-act]");if(!b)return;const {act,name}=b.dataset;try{if(act==="open")return openSnap(name);if(act==="detect"){await endpointFor(name,true);renderInstalled();return}if(act==="start"||act==="stop")return serviceAction(name,act);if(act==="refresh")return snapAction(name,"refresh",`更新 ${name}`);if(act==="remove"){if(await ask("卸载 Snap",`确认卸载 ${name}？`))await snapAction(name,"remove",`卸载 ${name}`)}}catch(e){toast(e.message,true)}}

async function boot(){try{if(!await loadSession()){showLogin();return}showApp();await loadInstalled();}catch(e){showLogin();toast(e.message,true)}}

document.addEventListener("DOMContentLoaded",()=>{
  $("loginForm").addEventListener("submit",login);
  $("logoutBtn").addEventListener("click",logout);
  $("toggleDrawerBtn").addEventListener("click",()=>setDrawer(!$("drawer").classList.contains("open")));
  $("closeDrawerBtn").addEventListener("click",()=>setDrawer(false));
  $("welcomeAppsBtn").addEventListener("click",()=>setDrawer(true));
  $("refreshBtn").addEventListener("click",loadInstalled);
  $("installedSearch").addEventListener("input",renderInstalled);
  $("installedList").addEventListener("click",onInstalledClick);
  $("storeTab").addEventListener("click",openStore);
  document.querySelectorAll(".tab[data-tab]").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
  window.addEventListener("message",onStoreMessage);
  boot();
});
