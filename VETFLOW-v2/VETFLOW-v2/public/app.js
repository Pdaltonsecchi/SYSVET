(function(){
'use strict';

/* ============================================================
   Utilidades
   ============================================================ */
var $=function(s){return document.querySelector(s);};
var pad=function(n){return String(n).padStart(2,'0');};
var isoOf=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
var todayIso=function(){return isoOf(new Date());};
var parse=function(s){var a=s.split('-').map(Number);return new Date(a[0],a[1]-1,a[2]);};
var shiftDays=function(n,base){var d=base?parse(base):new Date();d.setDate(d.getDate()+n);return isoOf(d);};
var shiftMonths=function(n,base){var d=base?parse(base):new Date();d.setMonth(d.getMonth()+n);return isoOf(d);};
var diffDays=function(s){var t=new Date();t.setHours(0,0,0,0);return Math.round((parse(s)-t)/86400000);};
var fmtDate=function(s){if(!s)return '—';var a=String(s).slice(0,10).split('-');return a[2]+'/'+a[1]+'/'+a[0];};
// Los centavos se muestran solo cuando existen ($1.250 / $1.250,50).
var money=function(n){n=Number(n)||0;var d=Math.abs(n*100-Math.round(n*100/100)*100)<0.5?0:2;return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:d,maximumFractionDigits:2}).format(n);};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
// Texto sin tildes ni mayúsculas, para comparar y buscar ("Gómez" == "gomez").
var norm=function(s){return String(s==null?'':s).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();};
// Apellido del dueño (última palabra de su nombre), para distinguir pacientes homónimos.
var surname=function(o){var w=String(o||'').trim().split(/\s+/);return w[w.length-1]||'';};
var toMin=function(t){return Number(t.slice(0,2))*60+Number(t.slice(3,5));};
var fmtBytes=function(n){n=Number(n)||0;if(n>=1073741824)return (n/1073741824).toFixed(n>=10737418240?0:1).replace('.',',')+' GB';if(n>=1048576)return (n/1048576).toFixed(n>=10485760?0:1).replace('.',',')+' MB';return Math.max(1,Math.round(n/1024))+' KB';};
var plural=function(n,a,b){return n+' '+(n===1?a:b);};
var fmtTs=function(v){var d=new Date(v);if(isNaN(d.getTime()))return '';return d.toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});};
// v2: lunes de la semana que contiene "iso" (semana de lunes a domingo).
var mondayOf=function(iso){var d=parse(iso);var wd=d.getDay();wd=wd===0?7:wd;return shiftDays(-(wd-1),iso);};

// F1: teléfono con números, espacios, + , - y paréntesis (el servidor exige además 6 dígitos como mínimo).
var PHONE_PAT='[0-9 +\\(\\)\\-]{6,50}';
var PROD_CATS=['Medicamentos','Vacunas','Higiene','Pulguicidas','Antiparasitarios','Otros'];
var SERV_CATS=['Consultas','Vacunas','Cirugías','Otros'];
var CASH_IN_CATS=['Servicios','Venta de productos','Aporte de capital','Otros'];
var CASH_OUT_CATS=['Compra de stock','Alquiler y servicios','Sueldos','Retiro de caja','Impuestos','Otros'];
var ADJUST_REASONS=['Rotura','Vencimiento','Error de carga','Uso interno','Otro'];
var PAY=['Efectivo','Transferencia','Tarjeta de débito','Tarjeta de crédito'];
var VAC_SUGG=['Sextuple','Quíntuple','Antirrábica','Tos de las perreras','Triple felina','Leucemia felina','Desparasitación'];
// B4: especie habitual de cada vacuna sugerida (las que no figuran, o 'Ambos', se ofrecen siempre).
var VAC_SPECIES={'Sextuple':'Perro','Quíntuple':'Perro','Tos de las perreras':'Perro','Triple felina':'Gato','Leucemia felina':'Gato'};
var SPECIES_OPTS=[['','Sin definir (se ofrece siempre)'],['Perro','Perro'],['Gato','Gato'],['Ambos','Ambos']];
var speciesOk=function(sp,pat){return !sp||sp==='Ambos'||sp===pat;};
var prodById=function(id){return id?S.products.find(function(x){return x.id===id;})||null:null;};
// Especie de un servicio: la suya o, si no tiene, la del producto vinculado.
var svcSpecies=function(s){var pr=prodById(s.productId);return s.species||(pr&&pr.species)||'';};
var APPT_TYPES=[['consulta','Consulta'],['vacuna','Vacuna'],['cirugia','Cirugía'],['otro','Otro']];
var APPT_LABEL={consulta:'Consulta',vacuna:'Vacuna',cirugia:'Cirugía',otro:'Otro'};
var APPT_VIEWS=[['week','Semana'],['2weeks','2 semanas'],['3weeks','3 semanas'],['month','Mes']];

/* ============================================================
   Estado
   ============================================================ */
var S={attachments:false,clinic:'VETFLOW',user:null,patients:[],products:[],services:[],suppliers:[],summary:null};
var ui={view:'pacientes',sel:null,detail:null,filter:'all',q:'',tab:'stock',cat:'all',
  stq:'',cq:'',cashp:'month',cashf:'all',cashm:'all',cash:null,
  rep:'90',rmonthly:null,rservices:null,rproducts:null,backups:null,users:null,
  suppliers:null,sq:'',trash:null,cfrom:'',cto:'',rfrom:'',rto:'', // v2: proveedores y su búsqueda
  cal:{view:'week',anchor:todayIso()},appts:null}; // v2: calendario de turnos
var main=$('#main'),dlg=$('#dlg');
var isAdmin=function(){return !!S.user&&S.user.role==='admin';};

// El segundo parámetro (warn) pinta el aviso en rojo — se usa para alertas de stock insuficiente.
function toast(msg,warn){var t=$('#toast');t.textContent=msg;t.classList.toggle('warn',!!warn);t.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(function(){t.classList.remove('on');},3200);}

/* ============================================================
   Conexión con el servidor
   ============================================================ */
async function api(path,opts){
  opts=opts||{};
  var init={method:opts.method||'GET',credentials:'same-origin',headers:{'Accept':'application/json'}};
  if(opts.body!==undefined){init.method=opts.method||'POST';init.headers['Content-Type']='application/json';init.body=JSON.stringify(opts.body);}
  var res;
  try{res=await fetch('/api'+path,init);}
  catch(e){var ce=new Error('No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.');ce.status=0;throw ce;}
  if(opts.raw&&res.ok)return res;
  var data=null;
  try{data=await res.json();}catch(e){}
  if(!res.ok){
    var err=new Error((data&&data.error)||'Ocurrió un error inesperado ('+res.status+')');
    err.status=res.status;
    if(res.status===401&&path!=='/login'&&S.user){S.user=null;showLogin('Tu sesión venció. Volvé a ingresar.');}
    throw err;
  }
  return data;
}

function setState(s){document.body.dataset.state=s;}
function showLogin(msg){
  if(dlg.open)dlg.close();
  setState('login');
  $('#lerror').textContent=msg||'';
}
function applyBootstrap(d){
  S.clinic=d.clinic||'VETFLOW';S.attachments=!!d.attachments;S.user=d.user;S.patients=d.patients;S.products=d.products;S.services=d.services;S.suppliers=d.suppliers||[];S.summary=d.summary||null;
}
async function start(){
  var d=await api('/bootstrap');
  applyBootstrap(d);
  ui.view='pacientes';ui.sel=null;ui.detail=null;ui.filter='all';ui.q='';ui.tab='stock';
  setState('app');
  render();
}
async function boot(){
  try{await start();}
  catch(e){
    if(e.status===401){showLogin();return;}
    setState('loading');
    $('#boot-msg').textContent='No se pudo conectar con el sistema';
    $('#boot-sub').textContent=e.message;
    $('#boot-retry').hidden=false;
  }
}

/* Carga los datos de la pantalla actual. */
async function loadView(){
  if(ui.view==='pacientes'&&ui.sel){
    try{ui.detail=await api('/patients/'+ui.sel);}
    catch(e){if(e.status===404){ui.sel=null;ui.detail=null;}else throw e;}
  }else if(ui.view==='calendario'){
    await loadAppointments();
  }else if(ui.view==='farmacia'&&ui.tab==='caja'&&isAdmin()){
    await loadCash();
  }else if(ui.view==='proveedores'){
    ui.suppliers=(await api('/suppliers')).items;S.suppliers=ui.suppliers;
  }else if(ui.view==='reportes'&&isAdmin()){
    await loadReports();
  }else if(ui.view==='papelera'&&isAdmin()){
    ui.trash=await api('/trash');
  }else if(ui.view==='copias'&&isAdmin()){
    ui.backups=(await api('/backups')).items;
    ui.attUsage=await api('/attachments/usage').catch(function(){return null;});
  }else if(ui.view==='usuarios'&&isAdmin()){
    ui.users=(await api('/users')).items;
  }
}
// v2: rango de fechas visible del calendario según la vista elegida (semana/2/3 semanas o mes).
// En "mes" el rango se agranda hasta completar semanas enteras, para que la grilla no quede cortada.
function calRange(){
  var a=ui.cal.anchor;
  if(ui.cal.view==='week')return [mondayOf(a), shiftDays(6, mondayOf(a))];
  if(ui.cal.view==='2weeks')return [mondayOf(a), shiftDays(13, mondayOf(a))];
  if(ui.cal.view==='3weeks')return [mondayOf(a), shiftDays(20, mondayOf(a))];
  var first=a.slice(0,8)+'01';
  var y=Number(a.slice(0,4)),m=Number(a.slice(5,7));
  var lastDay=new Date(y,m,0).getDate();
  var last=a.slice(0,8)+pad(lastDay);
  var from=mondayOf(first);
  var wd=parse(last).getDay();wd=wd===0?7:wd;
  var to=shiftDays(7-wd,last);
  return [from,to];
}
async function loadAppointments(){
  var r=calRange();
  ui.appts=(await api('/appointments?from='+r[0]+'&to='+r[1])).items;
}
async function reloadCal(){
  try{await loadAppointments();}catch(e){toast(e.message);}
  render();
}
function calShift(dir){
  if(ui.cal.view==='month'){ui.cal.anchor=shiftMonths(dir,ui.cal.anchor);return;}
  var span=ui.cal.view==='week'?7:ui.cal.view==='2weeks'?14:21;
  ui.cal.anchor=shiftDays(dir*span,ui.cal.anchor);
}
function calTitle(){
  if(ui.cal.view==='month'){
    var t=parse(ui.cal.anchor).toLocaleDateString('es-AR',{month:'long',year:'numeric'});
    return t.charAt(0).toUpperCase()+t.slice(1);
  }
  var r=calRange();
  return fmtDate(r[0])+' – '+fmtDate(r[1]);
}
// Filtros de Caja como parámetros de la dirección (los usa la lista y la exportación a CSV).
function cashQuery(){
  var q=['period='+ui.cashp];
  if(ui.cashp==='range'){q.push('from='+ui.cfrom);q.push('to='+ui.cto);}
  if(ui.cashf!=='all')q.push('type='+ui.cashf);
  if(ui.cashm!=='all')q.push('group='+encodeURIComponent(ui.cashm));
  return q.join('&');
}
// G4: descarga un archivo del servidor (CSV).
async function downloadFile(path,name){
  var res=await api(path,{raw:true});
  var blob=await res.blob();
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);
}
// Rango "Desde – Hasta" (inputs de fecha): HTML común a Caja y Reportes.
var rangeHTML=function(idFrom,idTo,from,to){
  return '<span class="rng"><label>Desde <input type="date" id="'+idFrom+'" value="'+esc(from)+'" max="'+todayIso()+'" style="width:auto"></label> <label>Hasta <input type="date" id="'+idTo+'" value="'+esc(to)+'" style="width:auto"></label></span>';
};
async function loadCash(){
  var r=await Promise.all([api('/cash?'+cashQuery()),api('/cash/summary')]);
  ui.cash=r[0];S.summary=r[1];
}
async function loadReports(){
  var rq=ui.rfrom&&ui.rto?'from='+ui.rfrom+'&to='+ui.rto:'days='+ui.rep;
  var r=await Promise.all([api('/reports/monthly'),api('/reports/services?'+rq),api('/reports/products?'+rq)]);
  ui.rmonthly=r[0].months;ui.rservices=r[1].items;ui.rproducts=r[2].items;ui.rdays=r[2].days;
}
/* Después de guardar algo: vuelve a pedir los datos y redibuja. */
async function reload(){
  try{
    var d=await api('/bootstrap');
    applyBootstrap(d);
    await loadView();
  }catch(e){toast(e.message);}
  render();
}
async function go(view){
  ui.view=view;
  render();
  window.scrollTo(0,0);
  try{await loadView();}catch(e){toast(e.message);}
  render();
}

/* ============================================================
   Ventanas de formulario
   ============================================================ */
function fld(label,name,o){
  o=o||{};
  var value=o.value==null?'':o.value,ctl;
  if(o.opts){
    ctl='<select name="'+name+'"'+(o.req?' required':'')+'>'+o.opts.map(function(x){
      var v=Array.isArray(x)?x[0]:x,t=Array.isArray(x)?x[1]:x;
      return '<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(t)+'</option>';
    }).join('')+'</select>';
  }else if(o.type==='textarea'){
    ctl='<textarea name="'+name+'" rows="3" placeholder="'+esc(o.ph||'')+'">'+esc(value)+'</textarea>';
  }else if(o.type==='checkbox'){
    return '<label class="fld check'+(o.full?' full':'')+'"><input type="checkbox" name="'+name+'"'+(value?' checked':'')+'><span>'+label+'</span></label>';
  }else{
    ctl='<input name="'+name+'" type="'+(o.type||'text')+'" value="'+esc(value)+'"'+(o.req?' required':'')+' placeholder="'+esc(o.ph||'')+'"'+
      (o.step?' step="'+o.step+'"':'')+(o.minlength?' minlength="'+o.minlength+'"':'')+(o.pattern?' pattern="'+o.pattern+'" title="'+esc(o.title||'')+'"':'')+(o.min!=null?' min="'+o.min+'"':'')+(o.max!=null?' max="'+o.max+'"':'')+(o.list?' list="'+o.list+'"':'')+
      (o.auto?' autocomplete="'+o.auto+'"':' autocomplete="off"')+'>';
  }
  return '<label class="fld'+(o.full?' full':'')+'"><span>'+label+'</span>'+ctl+'</label>';
}
function openForm(o){
  dlg.innerHTML='<form class="dform"><h2>'+o.title+'</h2>'+o.body+'<p class="err" role="alert"></p>'+
    '<div class="actions"><button type="button" class="btn ghost" data-close>Cancelar</button>'+
    '<button type="submit" class="btn '+(o.danger?'danger':'primary')+'">'+(o.submit||'Guardar')+'</button></div></form>';
  var f=dlg.querySelector('form');
  f.addEventListener('submit',async function(e){
    e.preventDefault();
    if(f.dataset.busy)return; // F10: nunca se envía dos veces
    var btn=f.querySelector('[type="submit"]'),errEl=f.querySelector('.err'),data={},label=btn.innerHTML;
    new FormData(f).forEach(function(v,k){data[k]=v;});
    errEl.textContent='';f.dataset.busy='1';btn.disabled=true;btn.classList.add('busy');btn.textContent='Guardando…';
    try{var r=await o.onSubmit(data,f);if(r!==false)dlg.close();}
    catch(err){errEl.textContent=err.message||'Ocurrió un error';}
    delete f.dataset.busy;btn.disabled=false;btn.classList.remove('busy');btn.innerHTML=label;
  });
  dlg.querySelector('[data-close]').addEventListener('click',function(){dlg.close();});
  dlg.showModal();
  return f;
}
dlg.addEventListener('click',function(e){if(e.target===dlg)dlg.close();});
function confirmForm(title,text,submit,fn,danger){
  openForm({title:title,body:'<p>'+text+'</p>',submit:submit,danger:danger!==false,onSubmit:fn});
}
// Diálogo de decisión que devuelve una promesa con el "value" del botón elegido (o null si se cierra).
// Se arma aparte de #dlg para poder abrirlo encima de un formulario que está a medio guardar.
function choiceDialog(title,html,buttons){
  return new Promise(function(resolve){
    var d=document.createElement('dialog'),val=null;
    d.innerHTML='<form class="dform"><h2>'+title+'</h2>'+html+'<div class="actions">'+buttons.map(function(b,i){
      return '<button type="button" class="btn '+(b.cls||'ghost')+'" data-i="'+i+'">'+b.label+'</button>';
    }).join('')+'</div></form>';
    document.body.appendChild(d);
    d.addEventListener('click',function(e){
      var b=e.target.closest('[data-i]');
      if(b){val=buttons[Number(b.dataset.i)].value;d.close();}
    });
    d.addEventListener('close',function(){d.remove();resolve(val);});
    d.showModal();
  });
}
function segHTML(action,items,active){
  return '<div class="seg" role="group">'+items.map(function(i){
    return '<button class="segb" data-action="'+action+'" data-v="'+i[0]+'" aria-pressed="'+(String(i[0])===String(active))+'">'+i[1]+'</button>';
  }).join('')+'</div>';
}

/* ============================================================
   Navegación, avisos y usuario
   ============================================================ */
function navItems(){
  // v2: Calendario y Proveedores son visibles para admin y ayudante (agendar turnos y
  // consultar a quién comprarle es tarea del día a día, no solo del administrador).
  var a=[['pacientes','Pacientes'],['calendario','Calendario'],['farmacia','Farmacia y caja'],['proveedores','Proveedores']];
  if(isAdmin())a.push(['reportes','Reportes'],['papelera','Papelera'],['copias','Copias de seguridad'],['usuarios','Usuarios']);
  return a;
}
function renderNav(){
  $('#nav').innerHTML=navItems().map(function(i){
    return '<button class="navb" data-action="nav" data-v="'+i[0]+'" aria-current="'+(ui.view===i[0]?'page':'false')+'">'+i[1]+'</button>';
  }).join('');
}
function renderUserBox(){
  var u=S.user;
  $('#userbox').innerHTML='<div class="who"><b>'+esc(u.name)+'</b><small>'+(u.role==='admin'?'Administrador':'Ayudante')+'</small></div>'+
    '<button data-action="change-pass">Cambiar contraseña</button><button data-action="logout">Cerrar sesión</button>';
}
function lastExportDays(){
  try{
    var t=Number(localStorage.getItem('vet_last_export'));
    if(!t)return null;
    return Math.floor((Date.now()-t)/86400000);
  }catch(e){return null;}
}

/* Vacunas: solo cuenta la dosis más reciente de cada vacuna. */
function latestIds(p){
  var m={};
  p.vaccines.forEach(function(v){var k=v.name.trim().toLowerCase();if(!m[k]||v.date>m[k].date)m[k]=v;});
  var ids={};Object.keys(m).forEach(function(k){ids[m[k].id]=true;});
  return ids;
}
function vacStatus(v,latest){
  if(!latest)return {k:'none',t:'Reemplazada'};
  if(!v.next)return {k:'none',t:'Sin refuerzo'};
  var d=diffDays(v.next);
  if(d<0)return {k:'bad',t:'Vencida hace '+plural(-d,'día','días')};
  if(d===0)return {k:'warn',t:'Vence hoy'};
  if(d<=30)return {k:'warn',t:'Vence en '+plural(d,'día','días')};
  return {k:'ok',t:'Al día'};
}
function patientAlert(p){
  var L=latestIds(p),r=null;
  p.vaccines.forEach(function(v){
    if(!L[v.id]||!v.next)return;
    var d=diffDays(v.next);
    if(d<0)r='bad';else if(d<=30&&r!=='bad')r='warn';
  });
  return r;
}
var lowStock=function(x){return x.stock<=x.min;};

function renderAlerts(){
  var bad=S.patients.filter(function(p){return patientAlert(p)==='bad';}).length;
  var warn=S.patients.filter(function(p){return patientAlert(p)==='warn';}).length;
  var low=S.products.filter(lowStock).length;
  var h='';
  if(bad)h+='<button class="al" data-action="goto-vac"><span class="dot bad"></span><span>'+plural(bad,'paciente con vacuna vencida','pacientes con vacuna vencida')+'</span></button>';
  if(warn)h+='<button class="al" data-action="goto-vac"><span class="dot warn"></span><span>'+plural(warn,'paciente con vacuna por vencer','pacientes con vacuna por vencer')+'</span></button>';
  if(low)h+='<button class="al" data-action="goto-stock"><span class="dot warn"></span><span>'+plural(low,'producto con poco stock','productos con poco stock')+'</span></button>';
  if(isAdmin()){
    var d=lastExportDays();
    if(d===null||d>7)h+='<button class="al" data-action="goto-backups"><span class="dot warn"></span><span>'+(d===null?'Todavía no descargaste una copia de seguridad':'Hace '+plural(d,'día','días')+' que no descargás una copia de seguridad')+'</span></button>';
  }
  if(!h)h='<div class="al"><span class="dot ok"></span><span>Todo al día</span></div>';
  $('#alerts').innerHTML='<h3>Para revisar</h3>'+h;
}

/* ============================================================
   Pacientes
   ============================================================ */
var emo=function(p){return p.species==='Gato'?'🐱':'🐶';};

// F7: edad con la fecha de nacimiento: "5 años (10/05/2021)"; en menores de 2 años, años y meses.
function ageText(b){
  if(!b)return 'Edad sin datos';
  var a=b.split('-').map(Number),now=new Date();
  var months=(now.getFullYear()-a[0])*12+(now.getMonth()+1-a[1]);
  if(now.getDate()<a[2])months--;
  if(months<0)months=0;
  var t;
  if(months<1)t='menos de 1 mes';
  else if(months<12)t=plural(months,'mes','meses');
  else if(months<24){var m=months-12;t='1 año'+(m?' y '+plural(m,'mes','meses'):'');}
  else t=plural(Math.floor(months/12),'año','años');
  return t+' ('+fmtDate(b)+')';
}
function filteredPatients(){
  var q=norm(ui.q).trim(),qd=ui.q.replace(/\D/g,'');
  return S.patients.filter(function(p){
    if((ui.filter==='Perro'||ui.filter==='Gato')&&p.species!==ui.filter)return false;
    if(ui.filter==='alert'&&!patientAlert(p))return false;
    if(q){var hay=norm(p.name+' '+p.owner+' '+p.breed+' '+p.phone);if(hay.indexOf(q)<0&&!(qd.length>=3&&p.phone.replace(/\D/g,'').indexOf(qd)>=0))return false;}
    return true;
  });
}
function listHTML(){
  var L=filteredPatients();
  if(!L.length)return '<li class="empty">'+(S.patients.length?'No hay pacientes con ese filtro.':'Todavía no cargaste ningún paciente. Empezá con “Nuevo paciente”.')+'</li>';
  return L.map(function(p){
    var al=patientAlert(p);
    var chip=al==='bad'?'<span class="chip bad">Vacuna vencida</span>':al==='warn'?'<span class="chip warn">Vacuna por vencer</span>':'';
    return '<li><button class="pitem" data-action="select" data-id="'+p.id+'" aria-current="'+(p.id===ui.sel)+'">'+
      '<span class="avatar" aria-hidden="true">'+emo(p)+'</span>'+
      '<span class="pi-main"><b>'+esc(p.name)+'</b><small>'+esc(p.breed||p.species)+' · '+esc(p.owner)+'</small></span>'+chip+'</button></li>';
  }).join('');
}
var emptyPane=function(){return '<p class="empty">'+(S.patients.length?'Elegí un paciente de la lista para ver su historia clínica, o agregá uno nuevo.':'Cuando cargues el primer paciente vas a ver acá su historia clínica.')+'</p>';};
// F4: si el paciente seleccionado queda fuera del filtro, se limpia el panel de detalle.
function dropHiddenSelection(){
  if(ui.sel&&!filteredPatients().some(function(p){return p.id===ui.sel;})){ui.sel=null;ui.detail=null;return true;}
  return false;
}
function viewPacientes(){
  var p=ui.sel&&ui.detail&&ui.detail.id===ui.sel?ui.detail:null;
  var right;
  if(ui.sel)right=p?detailHTML(p):'<button class="btn back" data-action="back">Volver a la lista</button><p class="empty">Cargando…</p>';
  else right=emptyPane();
  return '<section class="pac '+(ui.sel?'show-detail':'')+'">'+
    '<div class="pac-list">'+
      '<div class="head"><h1>Pacientes</h1><button class="btn primary" data-action="new-patient">Nuevo paciente</button></div>'+
      '<input id="q" type="search" placeholder="Buscar por nombre, dueño, raza o teléfono" value="'+esc(ui.q)+'" aria-label="Buscar paciente">'+
      segHTML('filter',[['all','Todos'],['Perro','Perros'],['Gato','Gatos'],['alert','Vacunas a controlar']],ui.filter)+
      '<ul class="plist" id="plist">'+listHTML()+'</ul>'+
    '</div>'+
    '<div class="pac-detail">'+right+'</div></section>';
}
function sec(title,action,label,inner){
  return '<section class="sec"><div class="sec-head"><h3>'+title+'</h3><button class="btn" data-action="'+action+'">'+label+'</button></div>'+inner+'</section>';
}
// G3: mini gráfico de línea con la evolución del peso y el último valor.
var fmtKg=function(n){return String(n).replace('.',',')+' kg';};
function weightChart(ws){
  var W=360,H=110,pl=10,pr=10,pt=12,pb=22;
  var kgs=ws.map(function(x){return x.kg;}),lo=Math.min.apply(null,kgs),hi=Math.max.apply(null,kgs);
  if(hi===lo){hi+=1;lo=Math.max(lo-1,0);}
  var t0=parse(ws[0].date).getTime(),t1=parse(ws[ws.length-1].date).getTime();
  var X=function(w,i){return ws.length===1?W/2:pl+(t1===t0?i/(ws.length-1):(parse(w.date).getTime()-t0)/(t1-t0))*(W-pl-pr);};
  var Y=function(k){return pt+(1-(k-lo)/(hi-lo))*(H-pt-pb);};
  var pts=ws.map(function(w,i){return X(w,i).toFixed(1)+','+Y(w.kg).toFixed(1);}).join(' ');
  var dots=ws.map(function(w,i){return '<circle cx="'+X(w,i).toFixed(1)+'" cy="'+Y(w.kg).toFixed(1)+'" r="3.5" fill="var(--brand)"/>';}).join('');
  return '<svg class="wchart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Evolución del peso de '+fmtKg(kgs[0])+' a '+fmtKg(kgs[kgs.length-1])+'">'+
    (ws.length>1?'<polyline points="'+pts+'" fill="none" stroke="var(--brand)" stroke-width="2"/>':'')+dots+
    '<text x="'+pl+'" y="'+(H-6)+'" font-size="11" fill="var(--muted)">'+fmtDate(ws[0].date)+'</text>'+
    '<text x="'+(W-pr)+'" y="'+(H-6)+'" font-size="11" text-anchor="end" fill="var(--muted)">'+fmtDate(ws[ws.length-1].date)+'</text>'+
    '<text x="'+pl+'" y="10" font-size="11" fill="var(--muted)">'+fmtKg(Math.max.apply(null,kgs))+'</text></svg>';
}
function weightHTML(p){
  var ws=p.weights||[];
  if(!ws.length)return '<p class="empty">Todavía no hay pesos registrados.</p>';
  var last=ws[ws.length-1];
  var recent=ws.slice(-5).reverse().map(function(w){
    return '<div class="wrow"><span>'+fmtDate(w.date)+'</span><b>'+fmtKg(w.kg)+'</b><button class="link bad" data-action="del-weight" data-id="'+w.id+'">Quitar</button></div>';
  }).join('');
  return '<div class="wbox"><div class="wlast"><small>Último peso</small><b>'+fmtKg(last.kg)+'</b><small>'+fmtDate(last.date)+'</small></div>'+weightChart(ws)+'<div class="wlist">'+recent+'</div></div>';
}
/* ============================================================
   H · Adjuntos de estudios
   ============================================================ */
var ATT_EXT=['pdf','jpg','jpeg','png','webp','heic','dcm'];
var ATT_MAX=10*1024*1024,ATT_MAX_FILES=5;
var isImg=function(m){return m&&m.indexOf('image/')===0&&m!=='image/heic';};
function attsHTML(st){
  var L=st.attachments||[];
  if(!L.length)return '';
  return '<div class="atts">'+L.map(function(a){
    var thumb=isImg(a.mime)&&S.attachments?'<img data-att="'+a.id+'" alt="" loading="lazy">':'<span class="aicon" aria-hidden="true">'+(a.mime==='application/pdf'?'📄':a.mime==='application/dicom'?'🩻':'🖼️')+'</span>';
    return '<span class="att"><button class="attb" data-action="att-open" data-id="'+a.id+'" data-mime="'+esc(a.mime)+'" title="'+(a.mime==='application/dicom'||a.mime==='image/heic'?'Descargar':'Ver')+' '+esc(a.name)+'">'+thumb+'<span class="aname">'+esc(a.name)+'</span></button>'+
      (isAdmin()?'<button class="link bad attx" data-action="att-del" data-id="'+a.id+'" aria-label="Quitar archivo '+esc(a.name)+'">✕</button>':'')+'</span>';
  }).join('')+'</div>';
}
// Miniaturas: se piden con una URL firmada (vence a los 10 minutos); se guarda para no repetir el pedido.
var thumbCache={};
function loadThumbs(){
  document.querySelectorAll('img[data-att]').forEach(function(img){
    if(img.getAttribute('src'))return;
    var id=img.dataset.att,c=thumbCache[id];
    if(c&&c.exp>Date.now()){img.src=c.url;return;}
    api('/attachments/'+id+'/url').then(function(r){thumbCache[id]={url:r.url,exp:Date.now()+(r.expiresIn-60)*1000};img.src=r.url;}).catch(function(){});
  });
}
// Convierte JPG/PNG a JPG de hasta 2000 px de lado y calidad 0,8, si así pesa menos.
function compressImage(file){
  return new Promise(function(resolve){
    if(!/^image\/(jpeg|png)$/.test(file.type)){resolve(file);return;}
    var img=new Image(),url=URL.createObjectURL(file);
    img.onload=function(){
      URL.revokeObjectURL(url);
      var w=img.naturalWidth,h=img.naturalHeight,k=Math.min(1,2000/Math.max(w,h));
      var cv=document.createElement('canvas');cv.width=Math.round(w*k);cv.height=Math.round(h*k);
      var cx=cv.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,cv.width,cv.height);cx.drawImage(img,0,0,cv.width,cv.height);
      cv.toBlob(function(b){resolve(b&&b.size<file.size?new File([b],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'}):file);},'image/jpeg',0.8);
    };
    img.onerror=function(){URL.revokeObjectURL(url);resolve(file);};
    img.src=url;
  });
}
// Sube los archivos con barra de progreso (XMLHttpRequest, porque fetch no informa el avance de la subida).
function uploadFiles(studyId,files,onProgress){
  return new Promise(function(resolve,reject){
    var fd=new FormData();files.forEach(function(f){fd.append('files',f,f.name);});
    var x=new XMLHttpRequest();x.open('POST','/api/studies/'+studyId+'/attachments');
    x.upload.onprogress=function(e){if(e.lengthComputable)onProgress(e.loaded/e.total);};
    x.onload=function(){
      var d=null;try{d=JSON.parse(x.responseText);}catch(_){}
      if(x.status>=200&&x.status<300)resolve(d);
      else reject(new Error((d&&d.error)||'No se pudieron subir los archivos ('+x.status+')'));
    };
    x.onerror=function(){reject(new Error('No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.'));};
    x.send(fd);
  });
}
function detailHTML(p){
  var L=latestIds(p);
  var vacHTML=p.vaccines.length?'<div class="rows">'+p.vaccines.map(function(v){
    var s=vacStatus(v,!!L[v.id]);
    return '<div class="row vac"><div class="vname"><b>'+esc(v.name)+'</b></div><div class="vap"><span class="k">Aplicada</span>'+fmtDate(v.date)+'</div><div class="vnext"><span class="k">Próxima dosis</span>'+fmtDate(v.next)+'</div><div class="chipcell"><span class="chip '+s.k+'">'+s.t+'</span></div><div class="racts"><button class="link" data-action="edit-vac" data-id="'+v.id+'">Editar</button><button class="link bad" data-action="del-vac" data-id="'+v.id+'">Quitar</button></div></div>';
  }).join('')+'</div>':'<p class="empty">Todavía no hay vacunas registradas.</p>';

  var dxHTML=p.diagnoses.length?'<div class="tl">'+p.diagnoses.map(function(d){
    return '<div class="tl-item"><span class="d">'+fmtDate(d.date)+'</span><div><b>'+esc(d.title)+'</b>'+(d.notes?'<p>'+esc(d.notes)+'</p>':'')+'</div><span class="racts"><button class="link" data-action="edit-dx" data-id="'+d.id+'">Editar</button><button class="link bad" data-action="del-dx" data-id="'+d.id+'">Quitar</button></span></div>';
  }).join('')+'</div>':'<p class="empty">Todavía no hay diagnósticos ni consultas registradas.</p>';

  // v2: estudios complementarios (ecografía, radiografía, análisis, etc.)
  var stHTML=(p.studies||[]).length?'<div class="tl">'+p.studies.map(function(st){
    return '<div class="tl-item"><span class="d">'+fmtDate(st.date)+'</span><div><b>'+esc(st.title)+'</b>'+(st.notes?'<p>'+esc(st.notes)+'</p>':'')+attsHTML(st)+'</div><span class="racts"><button class="link" data-action="edit-study" data-id="'+st.id+'">Editar</button><button class="link bad" data-action="del-study" data-id="'+st.id+'">Quitar</button></span></div>';
  }).join('')+'</div>':'<p class="empty">Todavía no hay estudios complementarios registrados.</p>';

  var mdHTML=p.meds.length?'<div class="tl">'+p.meds.map(function(m){
    var sub=[m.dose,m.duration].filter(Boolean).map(esc).join(' · ');
    return '<div class="tl-item"><span class="d">'+fmtDate(m.date)+'</span><div><b>'+esc(m.name)+'</b>'+(sub?'<p>'+sub+'</p>':'')+'</div><span class="racts"><button class="link" data-action="edit-med" data-id="'+m.id+'">Editar</button><button class="link bad" data-action="del-med" data-id="'+m.id+'">Quitar</button></span></div>';
  }).join('')+'</div>':'<p class="empty">Todavía no hay medicación registrada.</p>';

  var total=p.charges.reduce(function(s,c){return s+c.amount;},0);
  var chHTML=p.charges.length?'<div class="tl">'+p.charges.map(function(c){
    return '<div class="tl-item"><span class="d">'+fmtDate(c.date)+'</span><div><b>'+esc(c.concept)+'</b><p>'+money(c.amount)+(c.method?' · '+esc(c.method):'')+'</p></div>'+
      (isAdmin()?'<button class="link bad" data-action="del-chg" data-id="'+c.id+'">Quitar</button>':'<span></span>')+'</div>';
  }).join('')+'</div><div class="sum"><span>Total cobrado</span><span>'+money(total)+'</span></div>':'<p class="empty">Todavía no se cobró ningún servicio a este paciente.</p>';

  return '<button class="btn back" data-action="back">Volver a la lista</button>'+
    '<header class="phead"><div class="avatar big" aria-hidden="true">'+emo(p)+'</div>'+
    '<div class="info"><h2>'+esc(p.name)+'</h2>'+
    '<p class="meta">'+esc(p.species)+(p.breed?' '+esc(p.breed):'')+' · '+esc(p.sex)+(p.neutered?' (castrad'+(p.sex==='Hembra'?'a':'o')+')':'')+' · '+ageText(p.birth)+(p.weight!==''?' · '+esc(p.weight)+' kg':'')+'</p>'+
    '<p class="meta">Dueño: '+esc(p.owner)+(p.phone?' · '+esc(p.phone):'')+(p.email?' · '+esc(p.email):'')+'</p></div>'+
    '<div class="pactions"><button class="btn primary" data-action="charge">Cobrar servicio</button><button class="btn" data-action="edit-patient">Editar datos</button><button class="btn" data-action="print">Imprimir</button>'+
    (isAdmin()?'<button class="btn danger-o" data-action="del-patient">Eliminar</button>':'')+'</div></header>'+
    (p.notes?'<p class="note"><b>Notas:</b> '+esc(p.notes)+'</p>':'')+
    sec('Peso','add-weight','Registrar peso',weightHTML(p))+
    sec('Vacunas','add-vac','Agregar vacuna',vacHTML)+
    sec('Diagnósticos y consultas','add-dx','Agregar diagnóstico',dxHTML)+
    sec('Estudios complementarios','add-study','Agregar estudio',stHTML)+
    sec('Medicación','add-med','Agregar medicación',mdHTML)+
    sec('Servicios cobrados','charge','Cobrar servicio',chHTML);
}

/* ============================================================
   Farmacia y caja
   ============================================================ */
function viewFarmacia(){
  var tabs=[['stock','Stock']];
  if(isAdmin())tabs.push(['caja','Ingresos y egresos']);
  tabs.push(['precios','Lista de precios']);
  var summary='';
  if(isAdmin()&&S.summary){
    var m=S.summary.month,bal=m.in-m.out;
    var mes=new Date().toLocaleDateString('es-AR',{month:'long'});
    summary='<div class="summary"><div><small>Ingresos de '+mes+'</small><b>'+money(m.in)+'</b><small>Caja (efectivo) '+money(m.efe)+' · Transferencias '+money(m.tra)+' · Tarjetas '+money(m.tar)+'</small></div>'+
      '<div><small>Egresos de '+mes+'</small><b>'+money(m.out)+'</b></div>'+
      '<div><small>Balance</small><b class="'+(bal>=0?'pos':'neg')+'">'+money(bal)+'</b></div></div>';
  }
  var body=ui.tab==='stock'?stockHTML():ui.tab==='caja'?cajaHTML():preciosHTML();
  return '<section class="farm"><div class="head"><h1>Farmacia y caja</h1></div>'+summary+
    '<div class="tabs" role="tablist">'+tabs.map(function(x){
      return '<button class="tab" role="tab" data-action="tab" data-v="'+x[0]+'" aria-selected="'+(ui.tab===x[0])+'">'+x[1]+'</button>';}).join('')+'</div>'+body+'</section>';
}
function stockHTML(){
  var admin=isAdmin();
  var sq=norm(ui.stq).trim();
  var L=S.products.filter(function(x){return (ui.cat==='all'||x.category===ui.cat)&&(!sq||norm(x.name+' '+x.category).indexOf(sq)>=0);});
  var totCost=0,totSale=0;
  var rows=L.map(function(x){
    var chip=x.stock<=0?'<span class="chip bad">Sin stock</span>':lowStock(x)?'<span class="chip warn">Poco stock</span>':'';
    var stockCell=admin?'<span class="stk"><span>'+x.stock+'</span><button data-action="stock-add" data-id="'+x.id+'" aria-label="Agregar stock" title="Agregar stock (compra)">+</button></span>':'<b>'+x.stock+'</b>';
    var acts='<button class="link" data-action="sell" data-id="'+x.id+'">Vender</button>'+
      (admin?'<button class="link" data-action="stock-adjust" data-id="'+x.id+'">Ajustar</button><button class="link" data-action="stock-history" data-id="'+x.id+'">Historial</button><button class="link" data-action="edit-product" data-id="'+x.id+'">Editar</button><button class="link bad" data-action="del-product" data-id="'+x.id+'">Eliminar</button>':'');
    var units=Math.max(x.stock,0),val=x.cost!=null?units*x.cost:null;
    if(admin){totCost+=val||0;totSale+=units*x.price;}
    var margin=x.cost!=null&&x.price>0?Math.round((x.price-x.cost)/x.price*1000)/10:null;
    var mCell=margin==null?'—':'<span class="'+(x.price<x.cost?'negtxt':'')+'"'+(x.price<x.cost?' title="El precio de venta es menor que el costo"':'')+'>'+(x.price<x.cost?'⚠ ':'')+String(margin).replace('.',',')+'%</span>';
    var costCells=admin?'<td class="num">'+(x.cost!=null?money(x.cost):'—')+'</td><td class="num">'+mCell+'</td><td class="num">'+(val!=null?money(val):'—')+'</td>':'';
    return '<tr><td><b>'+esc(x.name)+'</b><br><small>'+esc(x.category)+'</small></td><td>'+stockCell+'</td><td class="num">'+x.min+'</td><td>'+chip+'</td><td class="num">'+money(x.price)+'</td>'+costCells+'<td class="act">'+acts+'</td></tr>';
  }).join('');
  var cols=admin?9:6;
  var empty=S.products.length?'No hay productos en esta categoría.':'Todavía no cargaste productos. '+(admin?'Empezá con “Nuevo producto”.':'Pedile al administrador que los cargue.');
  var foot=admin&&L.length?'<tfoot><tr><td colspan="'+cols+'"><b>Stock valorizado:</b> '+money(totCost)+' a costo / '+money(totSale)+' a precio de venta</td></tr></tfoot>':'';
  return '<div class="toolbar">'+segHTML('cat',[['all','Todos']].concat(PROD_CATS.map(function(c){return [c,c];})),ui.cat)+
    (admin?'<button class="btn primary" data-action="new-product">Nuevo producto</button>':'')+'</div>'+
    '<input id="stq" type="search" placeholder="Buscar producto" value="'+esc(ui.stq)+'" aria-label="Buscar producto" style="margin-bottom:1rem">'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th>Stock</th><th class="num">Mínimo</th><th>Estado</th><th class="num">Precio de venta</th>'+(admin?'<th class="num">Costo unit.</th><th class="num">Margen</th><th class="num">Valor en stock</th>':'')+'<th></th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="'+cols+'" class="empty">'+empty+'</td></tr>')+'</tbody>'+foot+'</table></div>';
}
function cajaHTML(){
  if(!ui.cash||!S.summary)return '<p class="empty">Cargando…</p>';
  var sm=S.summary;
  var cq=norm(ui.cq).trim();
  var rows=ui.cash.items.filter(function(c){return !cq||norm(c.concept+' '+c.category+' '+c.method).indexOf(cq)>=0;}).map(function(c){
    return '<tr><td>'+fmtDate(c.date)+'</td><td><b>'+esc(c.concept)+'</b></td><td>'+esc(c.category)+'</td><td>'+esc(c.method)+'</td><td class="num '+(c.type==='in'?'in':'out')+'">'+(c.type==='in'?'+ ':'− ')+money(c.amount)+'</td><td class="act"><button class="link bad" data-action="del-cash" data-id="'+c.id+'">Eliminar</button></td></tr>';
  }).join('');
  var mes=new Date().toLocaleDateString('es-AR',{month:'long'});
  var pm=PAY.map(function(m){return '<div class="bk"><span>'+m+'</span><b>'+money(sm.month.byMethod[m]||0)+'</b></div>';}).join('');
  return '<div class="cashbox"><div class="panel"><h3>Efectivo que debería haber en caja</h3><div class="big'+(sm.drawer<0?' neg':'')+'">'+(sm.drawer<0?'<span aria-hidden="true">⚠️ </span>':'')+money(sm.drawer)+'</div>'+(sm.drawer<0?'<p class="negnote">La caja da negativa: revisá si algún egreso en efectivo se pagó con otro fondo.</p>':'')+''+
    '<p>Ingresos menos egresos en efectivo, desde el primer registro. Hoy entró '+money(sm.todayCash.in)+' y salió '+money(sm.todayCash.out)+' en efectivo. Si sacás plata de la caja, registrala como egreso en efectivo (categoría “Retiro de caja”).</p></div>'+
    '<div class="panel"><h3>Ingresos de '+mes+' por forma de pago</h3><div class="bk-list">'+pm+'</div></div></div>'+
    '<div class="toolbar"><div class="filters">'+
      segHTML('cashp',[['today','Hoy'],['month','Este mes'],['prev','Mes anterior'],['all','Todo']],ui.cashp)+rangeHTML('cfrom','cto',ui.cfrom,ui.cto)+
      segHTML('cashf',[['all','Ingresos y egresos'],['in','Ingresos'],['out','Egresos']],ui.cashf)+
      segHTML('cashm',[['all','Todas las formas de pago'],['Efectivo','Efectivo'],['Transferencia','Transferencias'],['Tarjeta','Tarjetas']],ui.cashm)+
    '</div><span><button class="btn" data-action="cash-export">Exportar CSV</button> <button class="btn" data-action="cash-out">Registrar egreso</button> <button class="btn primary" data-action="cash-in">Registrar ingreso</button></span></div>'+
    '<input id="cq" type="search" placeholder="Buscar por concepto, categoría o forma de pago" value="'+esc(ui.cq)+'" aria-label="Buscar movimiento" style="margin-bottom:1rem">'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Forma de pago</th><th class="num">Monto</th><th></th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="6" class="empty">No hay movimientos en este período.</td></tr>')+'</tbody></table></div>'+
    (ui.cash.limited?'<p class="empty">Se muestran los últimos 500 movimientos. Elegí un período más corto para ver el resto.</p>':'');
}
function preciosHTML(){
  var admin=isAdmin();
  var g=SERV_CATS.map(function(cat){
    var L=S.services.filter(function(s){return s.category===cat;});
    if(!L.length)return '';
    return '<div class="grp"><h3>'+cat+'</h3><div class="tbl-wrap"><table class="tbl"><tbody>'+L.map(function(s){
      // v2: si esta vacuna está vinculada a un producto del stock, se muestra cuál.
      var linked=s.productId?S.products.find(function(x){return x.id===s.productId;}):null;
      // G5: si el precio del servicio es menor que el costo de lo que descuenta, se avisa (el costo solo lo ve el administrador).
      var costSum=0,costKnown=false;
      if(linked&&linked.cost!=null){costSum+=linked.cost;costKnown=true;}
      (s.items||[]).forEach(function(it){var pr=prodById(it.productId);if(pr&&pr.cost!=null){costSum+=pr.cost*it.qty;costKnown=true;}});
      var below=costKnown&&s.price<costSum;
      return '<tr><td><b>'+esc(s.name)+'</b>'+(below?'<br><small class="negtxt">⚠ El precio ('+money(s.price)+') es menor que el costo de los productos que descuenta ('+money(costSum)+')</small>':'')+(linked?'<br><small>Descuenta: '+esc(linked.name)+'</small>':'')+((s.items||[]).length?'<br><small>Descuenta al cobrar: '+s.items.map(function(it){var pr=prodById(it.productId);return (pr?esc(pr.name):'producto eliminado')+' ×'+it.qty;}).join(', ')+'</small>':'')+'</td><td class="num">'+money(s.price)+'</td><td class="act">'+
        (admin?'<button class="link" data-action="edit-service" data-id="'+s.id+'">Editar</button><button class="link bad" data-action="del-service" data-id="'+s.id+'">Eliminar</button>':'')+'</td></tr>';
    }).join('')+'</tbody></table></div></div>';
  }).join('');
  return '<div class="toolbar"><small>Estos precios se usan al cobrar un servicio a un paciente.</small>'+(admin?'<button class="btn primary" data-action="new-service">Nuevo precio</button>':'')+'</div>'+
    (g||'<p class="empty">Todavía no cargaste precios. '+(admin?'Empezá con “Nuevo precio” (consultas, vacunas, cirugías).':'Pedile al administrador que los cargue.')+'</p>');
}

/* ============================================================
   Reportes
   ============================================================ */
function monthLabel(ym){return new Date(Number(ym.slice(0,4)),Number(ym.slice(5,7))-1,1).toLocaleDateString('es-AR',{month:'short'}).replace('.','');}
function chartSVG(M){
  var W=640,H=230,pl=8,pb=28,pt=12,ch=H-pb-pt;
  var max=Math.max.apply(null,M.map(function(x){return Math.max(x.in,x.out);}).concat([1]));
  var gw=(W-pl*2)/M.length,bw=Math.min(34,gw/2-6),g='';
  M.forEach(function(x,i){
    var x0=pl+i*gw+gw/2,hi=Math.round(x.in/max*ch),he=Math.round(x.out/max*ch);
    g+='<rect x="'+(x0-bw-2)+'" y="'+(pt+ch-hi)+'" width="'+bw+'" height="'+hi+'" rx="3" fill="var(--brand)"/>';
    g+='<rect x="'+(x0+2)+'" y="'+(pt+ch-he)+'" width="'+bw+'" height="'+he+'" rx="3" fill="var(--muted)" opacity=".55"/>';
    g+='<text x="'+x0+'" y="'+(H-8)+'" text-anchor="middle" font-size="13" fill="var(--muted)">'+monthLabel(x.ym)+'</text>';
  });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Ingresos y egresos de los últimos 6 meses"><line x1="0" x2="'+W+'" y1="'+(pt+ch)+'" y2="'+(pt+ch)+'" stroke="var(--line)"/>'+g+'</svg>';
}
function viewReportes(){
  if(!ui.rmonthly||!ui.rservices||!ui.rproducts)return '<section class="farm"><div class="head"><h1>Reportes</h1></div><p class="empty">Cargando…</p></section>';
  var days=ui.rdays||Number(ui.rep);
  var mrows=ui.rmonthly.slice().reverse().map(function(x){
    var bal=x.in-x.out;
    return '<tr><td>'+monthLabel(x.ym)+' '+x.ym.slice(0,4)+'</td><td class="num">'+money(x.efe)+'</td><td class="num">'+money(x.tra)+'</td><td class="num">'+money(x.tar)+'</td><td class="num"><b>'+money(x.in)+'</b></td><td class="num">'+money(x.out)+'</td><td class="num '+(bal>=0?'in':'out')+'">'+money(bal)+'</td></tr>';
  }).join('');
  var maxN=ui.rservices.length?ui.rservices[0].n:1;
  var svRows=ui.rservices.map(function(x){
    return '<tr><td><b>'+esc(x.name)+'</b></td><td><div class="bars"><div class="bar" style="width:'+Math.max(4,Math.round(x.n/maxN*140))+'px"></div><span>'+x.n+'</span></div></td><td class="num">'+money(x.total)+'</td></tr>';
  }).join('');
  var maxU=ui.rproducts.length&&ui.rproducts[0].units?ui.rproducts[0].units:1;
  var prRows=ui.rproducts.map(function(x){
    var st,left=x.units>0?Math.round(x.stock/(x.units/days)):null;
    if(x.stock<=0)st='<span class="chip bad">Sin stock</span>';
    else if(x.units===0)st='<span class="chip none">Sin movimiento</span>';
    else if(left<=15)st='<span class="chip warn">Alcanza para '+plural(left,'día','días')+'</span>';
    else st='Alcanza para ~'+left+' días';
    return '<tr><td><b>'+esc(x.name)+'</b><br><small>'+esc(x.category)+'</small></td><td><div class="bars"><div class="bar" style="width:'+Math.max(4,Math.round(x.units/maxU*140))+'px"></div><span>'+x.units+'</span></div></td><td class="num">'+x.stock+'</td><td>'+st+'</td></tr>';
  }).join('');
  return '<section class="farm"><div class="head"><h1>Reportes</h1></div>'+
    '<div class="repsec"><h2>Ingresos por mes</h2><div class="legend"><span><i style="background:var(--brand)"></i>Ingresos</span><span><i style="background:var(--muted);opacity:.55"></i>Egresos</span></div>'+chartSVG(ui.rmonthly)+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mes</th><th class="num">Efectivo</th><th class="num">Transferencias</th><th class="num">Tarjetas</th><th class="num">Total ingresos</th><th class="num">Egresos</th><th class="num">Balance</th></tr></thead><tbody>'+mrows+'</tbody></table></div></div>'+
    '<div class="repsec"><div class="toolbar"><h2 style="margin:0">Servicios y productos</h2>'+segHTML('rep',[['30','Últimos 30 días'],['90','Últimos 3 meses'],['365','Último año']],ui.rfrom&&ui.rto?'':ui.rep)+rangeHTML('rfrom','rto',ui.rfrom,ui.rto)+'<button class="btn" data-action="rep-export">Exportar CSV de movimientos</button></div>'+
    '<div class="grp"><h3>Servicios más vendidos</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Servicio</th><th>Veces cobrado</th><th class="num">Total cobrado</th></tr></thead><tbody>'+(svRows||'<tr><td colspan="3" class="empty">No hay servicios cobrados en este período.</td></tr>')+'</tbody></table></div></div>'+
    '<div class="grp"><h3>Productos que más rotan</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th>Unidades vendidas o usadas</th><th class="num">Stock actual</th><th>Cuánto dura el stock</th></tr></thead><tbody>'+(prRows||'<tr><td colspan="4" class="empty">Todavía no cargaste productos.</td></tr>')+'</tbody></table></div></div></div></section>';
}

/* ============================================================
   G1 · Papelera
   ============================================================ */
var TRASH_KIND={patient:'Paciente',vaccine:'Vacuna',diagnosis:'Diagnóstico',study:'Estudio',medication:'Medicación',charge:'Cobro'};
function viewTrash(){
  if(!ui.trash)return '<section class="farm"><div class="head"><h1>Papelera</h1></div><p class="empty">Cargando…</p></section>';
  var t=ui.trash;
  var rows=t.items.map(function(x){
    var left=x.expired?'<span class="chip bad">Vencido</span>':'<span class="chip '+(x.daysLeft<=5?'warn':'none')+'">Quedan '+plural(x.daysLeft,'día','días')+'</span>';
    return '<tr><td>'+TRASH_KIND[x.kind]+'</td><td><b>'+esc(x.label)+'</b>'+(x.date?'<br><small>'+fmtDate(x.date)+'</small>':'')+'</td><td>'+esc(x.patient)+'</td><td>'+fmtTs(x.deletedAt)+'</td><td>'+left+'</td>'+
      '<td class="act">'+(x.expired?'':'<button class="link" data-action="trash-restore" data-kind="'+x.kind+'" data-id="'+x.id+'">Restaurar</button>')+
      '<button class="link bad" data-action="trash-purge" data-kind="'+x.kind+'" data-id="'+x.id+'">Eliminar definitivamente</button></td></tr>';
  }).join('');
  return '<section class="farm"><div class="head"><h1>Papelera</h1>'+(t.expiredCount?'<button class="btn danger-o" data-action="trash-purge-expired">Eliminar definitivamente los vencidos ('+t.expiredCount+')</button>':'')+'</div>'+
    '<p class="empty">Lo que se borra de la historia clínica queda acá '+t.days+' días y se puede restaurar. Pasado ese plazo solo se puede eliminar definitivamente. Si lo borrado había devuelto stock, al restaurarlo se vuelve a descontar (si no alcanza el stock, se restaura igual y te avisamos).</p>'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tipo</th><th>Elemento</th><th>Paciente</th><th>Borrado</th><th>Plazo</th><th></th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="6" class="empty">La papelera está vacía.</td></tr>')+'</tbody></table></div></section>';
}

/* ============================================================
   Copias de seguridad y usuarios
   ============================================================ */
// H: espacio que ocupan los adjuntos (plan gratuito de Supabase: 1 GB) y aclaración sobre las copias.
function attachmentsPanel(){
  var u=ui.attUsage;
  var meter='';
  if(u&&u.configured){
    var pct=Math.min(100,Math.round(u.bytes/u.limit*100));
    meter='<p><b>Adjuntos: '+fmtBytes(u.bytes)+' de '+fmtBytes(u.limit)+'</b> <small>('+plural(u.count,'archivo','archivos')+')</small></p>'+
      '<div class="meter'+(pct>=80?' hot':'')+'" role="img" aria-label="'+pct+'% del espacio usado"><i style="width:'+Math.max(pct,u.bytes?1:0)+'%"></i></div>'+
      (pct>=80?'<p class="warnbox">Queda poco espacio para adjuntos. Revisá los archivos pesados o ampliá el plan de Supabase.</p>':'');
  }else meter='<p class="empty" style="padding:0">Los adjuntos todavía no están activados en el servidor.</p>';
  return '<section class="sec"><h3>Archivos adjuntos de los estudios</h3>'+meter+
    '<p class="warnbox">Los archivos adjuntos <b>no se incluyen</b> en la copia que descargás (el JSON solo guarda sus datos: nombre, tamaño y a qué estudio pertenecen). Los archivos quedan en <b>Supabase Storage</b>, en el bucket privado de estudios.</p></section>';
}
function viewBackups(){
  if(!ui.backups)return '<section class="farm"><div class="head"><h1>Copias de seguridad</h1></div><p class="empty">Cargando…</p></section>';
  var d=lastExportDays();
  var lastAuto=ui.backups.filter(function(b){return b.auto;})[0];
  var rows=ui.backups.length?ui.backups.map(function(b){
    var c=b.counts||{};
    return '<div class="bk"><div><b>'+esc(b.label)+'</b><br><small>'+fmtTs(b.createdAt)+' · '+plural(c.patients||0,'paciente','pacientes')+' · '+plural(c.products||0,'producto','productos')+' · '+plural(c.cash_movements||0,'movimiento de caja','movimientos de caja')+'</small></div>'+
      '<div><button class="link" data-action="restore" data-id="'+b.id+'">Restaurar</button><button class="link bad" data-action="del-backup" data-id="'+b.id+'">Eliminar</button></div></div>';
  }).join(''):'<p class="empty">Todavía no hay copias guardadas.</p>';
  return '<section class="farm"><div class="head"><h1>Copias de seguridad</h1></div>'+
    '<p class="warnbox">La base de datos gratuita no incluye copias propias. Por eso el sistema guarda una copia por día dentro de la misma base (te sirve si borrás algo por error), pero <b>si se perdiera la base, esas copias también se pierden</b>. Descargá un archivo a tu computadora o a un pendrive, por lo menos una vez por semana.'+
    (d===null?' Todavía no descargaste ninguno desde esta computadora.':' La última descarga desde esta computadora fue hace '+plural(d,'día','días')+'.')+'</p>'+
    '<div class="cashbox" style="margin-top:1rem"><div class="panel"><h3>Copia automática diaria</h3><p>'+(lastAuto?'Última copia automática: '+fmtTs(lastAuto.createdAt)+'.':'Todavía no se hizo ninguna.')+' Se hace sola una vez por día y se conservan las últimas 14.</p></div>'+
    '<div class="panel"><h3>Archivo y copias manuales</h3><div class="filerow"><button class="btn primary" data-action="backup-download">Descargar copia a mi computadora</button><button class="btn" data-action="backup-now">Crear copia ahora</button><button class="btn" data-action="pick-file">Cargar desde archivo</button><input id="bfile" type="file" accept=".json,application/json" hidden></div></div></div>'+
    attachmentsPanel()+
    '<section class="sec"><h3>Copias guardadas en el sistema</h3><div class="bk-list">'+rows+'</div></section></section>';
}
function viewUsers(){
  if(!ui.users)return '<section class="farm"><div class="head"><h1>Usuarios</h1></div><p class="empty">Cargando…</p></section>';
  var rows=ui.users.map(function(u){
    return '<tr><td><b>'+esc(u.name)+'</b><br><small>'+esc(u.email)+'</small></td><td>'+(u.role==='admin'?'Administrador':'Ayudante')+'</td><td>'+(u.active?'<span class="chip ok">Activo</span>':'<span class="chip none">Desactivado</span>')+'</td><td class="act"><button class="link" data-action="edit-user" data-id="'+u.id+'">Editar</button></td></tr>';
  }).join('');
  return '<section class="farm"><div class="head"><h1>Usuarios</h1><button class="btn primary" data-action="new-user">Nuevo usuario</button></div>'+
    '<p class="empty">El administrador ve todo. El ayudante puede cargar y ver pacientes, cobrar servicios y vender productos, pero no ve la caja, los reportes ni las copias, y no puede borrar pacientes ni cambiar precios.</p>'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></section>';
}

/* ============================================================
   v2 · Proveedores
   ============================================================ */
function supplierRows(){
  var admin=isAdmin(),q=norm(ui.sq).trim(),qd=ui.sq.replace(/\D/g,'');
  var L=(ui.suppliers||[]).filter(function(s){
    if(!q)return true;
    return norm(s.name+' '+s.phone+' '+s.email+' '+s.description).indexOf(q)>=0||(qd.length>=3&&s.phone.replace(/\D/g,'').indexOf(qd)>=0);
  });
  var rows=L.map(function(s){
    var name=admin?'<button class="link namebtn" data-action="supplier-view" data-id="'+s.id+'">'+esc(s.name)+'</button>':'<b>'+esc(s.name)+'</b>';
    return '<tr><td>'+name+(s.description?'<br><small>'+esc(s.description)+'</small>':'')+'</td><td>'+esc(s.phone)+'</td><td>'+esc(s.email)+'</td>'+
      (admin?'<td class="act"><button class="link" data-action="edit-supplier" data-id="'+s.id+'">Editar</button><button class="link bad" data-action="del-supplier" data-id="'+s.id+'">Eliminar</button></td>':'')+'</tr>';
  }).join('');
  var empty=(ui.suppliers||[]).length?'No hay proveedores con esa búsqueda.':admin?'Todavía no cargaste proveedores. Empezá con “Agregar proveedor”.':'Todavía no hay proveedores cargados.';
  return rows||'<tr><td colspan="'+(admin?4:3)+'" class="empty">'+empty+'</td></tr>';
}
function viewProveedores(){
  if(!ui.suppliers)return '<section class="farm"><div class="head"><h1>Proveedores</h1></div><p class="empty">Cargando…</p></section>';
  var admin=isAdmin();
  return '<section class="farm"><div class="head"><h1>Proveedores</h1>'+(admin?'<button class="btn primary" data-action="new-supplier">Agregar proveedor</button>':'')+'</div>'+
    '<input id="sq" type="search" placeholder="Buscar por nombre, teléfono, email o descripción" value="'+esc(ui.sq)+'" aria-label="Buscar proveedor" style="margin-bottom:1rem">'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Proveedor</th><th>Teléfono</th><th>Email</th>'+(admin?'<th></th>':'')+'</tr></thead><tbody id="srows">'+supplierRows()+'</tbody></table></div></section>';
}

/* ============================================================
   v2 · Calendario de turnos
   ============================================================ */
var WEEKDAYS=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
// Texto de un turno en la grilla: "10:00 · Luna (Gómez)" (el apellido distingue pacientes homónimos).
var apptLabel=function(a){return a.time.slice(0,5)+' · '+esc(a.patientName)+' ('+esc(surname(a.patientOwner))+')';};
function dayAppts(iso){return (ui.appts||[]).filter(function(a){return a.date===iso;}).sort(function(a,b){return a.time.localeCompare(b.time);});}
function calDayColumn(iso){
  var list=dayAppts(iso);
  var d=parse(iso),isToday=iso===todayIso();
  // E3: en la vista Semana el alto del bloque refleja la duración del turno.
  var blocks=list.map(function(a){
    var h=ui.cal.view==='week'?' style="min-height:'+Math.round(Math.min(Math.max(38,a.duration*0.9),180))+'px"':'';
    return '<button class="appt '+a.type+'"'+h+' data-action="appt-view" data-id="'+a.id+'">'+apptLabel(a)+'<small>'+esc(a.title)+'</small></button>';
  }).join('');
  return '<div class="cal-day'+(isToday?' today':'')+'"><div class="cal-day-head"><span>'+WEEKDAYS[(d.getDay()+6)%7]+'</span><b>'+d.getDate()+'</b>'+
    '<button class="cal-add" data-action="cal-add-day" data-v="'+iso+'" aria-label="Agregar turno este día">+</button></div>'+blocks+'</div>';
}
function calMonthGrid(){
  var r=calRange(),curMonth=ui.cal.anchor.slice(0,7),cells='',d=r[0];
  while(d<=r[1]){
    var list=dayAppts(d);
    var out=d.slice(0,7)!==curMonth,isToday=d===todayIso();
    var shown=list.slice(0,3).map(function(a){
      return '<button class="cal-chip '+a.type+'" data-action="appt-view" data-id="'+a.id+'">'+apptLabel(a)+'</button>';
    }).join('');
    var more=list.length>3?'<button class="cal-more" data-action="cal-day-list" data-v="'+d+'">+'+(list.length-3)+' más</button>':'';
    cells+='<div class="cal-mday'+(out?' out':'')+(isToday?' today':'')+(list.length||isToday?' has':'')+'"><div class="mhead"><span>'+WEEKDAYS[(parse(d).getDay()+6)%7]+' '+Number(d.slice(8,10))+'</span>'+
      '<button class="cal-add" data-action="cal-add-day" data-v="'+d+'" aria-label="Agregar turno este día">+</button></div>'+shown+more+'</div>';
    d=shiftDays(1,d);
  }
  return '<div class="cal-month">'+cells+'</div>';
}
// E1: "+N más" abre un listado con todos los turnos de ese día.
function dayListDialog(iso){
  var list=dayAppts(iso);
  var rows=list.map(function(a){
    return '<button type="button" class="appt '+a.type+'" data-id="'+a.id+'">'+apptLabel(a)+'<small>'+esc(a.title)+' · hasta las '+a.endTime+'</small></button>';
  }).join('');
  dlg.innerHTML='<form class="dform"><h2>Turnos del '+fmtDate(iso)+'</h2><div class="daylist">'+(rows||'<p class="empty">No hay turnos este día.</p>')+'</div>'+
    '<div class="actions"><button type="button" class="btn ghost" data-close>Cerrar</button><button type="button" class="btn primary" data-x="add">Agregar turno</button></div></form>';
  dlg.querySelector('[data-close]').addEventListener('click',function(){dlg.close();});
  dlg.querySelector('[data-x="add"]').addEventListener('click',function(){dlg.close();appointmentForm(null,iso);});
  dlg.querySelectorAll('.daylist .appt').forEach(function(b){b.addEventListener('click',function(){
    var a=(ui.appts||[]).find(function(x){return String(x.id)===b.dataset.id;});if(a)appointmentDetails(a);
  });});
  dlg.showModal();
}
function viewCalendario(){
  if(!ui.appts)return '<section class="farm"><div class="head"><h1>Calendario</h1></div><p class="empty">Cargando…</p></section>';
  var body;
  if(ui.cal.view==='month')body=calMonthGrid();
  else{
    // E5: semana, 2 y 3 semanas se muestran como grilla de una fila por semana (7 columnas), sin scroll horizontal.
    var r=calRange(),cells='',d=r[0];
    while(d<=r[1]){cells+=calDayColumn(d);d=shiftDays(1,d);}
    body='<div class="cal-week">'+cells+'</div>';
  }
  return '<section class="farm"><div class="head"><h1>Calendario</h1><button class="btn primary" data-action="new-appt">Agregar turno</button></div>'+
    '<div class="cal-head"><div class="cal-nav"><button data-action="cal-prev" aria-label="Anterior">‹</button><button class="btn" data-action="cal-today">Hoy</button><button data-action="cal-next" aria-label="Siguiente">›</button></div>'+
    '<div class="cal-title">'+calTitle()+'</div>'+segHTML('cal-view',APPT_VIEWS,ui.cal.view)+'</div>'+
    '<div class="cal-legend"><span><i style="background:var(--appt-consulta)"></i>Consulta</span><span><i style="background:var(--appt-vacuna)"></i>Vacuna</span>'+
    '<span><i style="background:var(--appt-cirugia)"></i>Cirugía</span><span><i style="background:var(--appt-otro)"></i>Otro</span></div>'+body+'</section>';
}

function render(){
  if(!S.user)return;
  var adminOnly={reportes:1,copias:1,usuarios:1,papelera:1};
  if(adminOnly[ui.view]&&!isAdmin())ui.view='pacientes';
  if(ui.view==='farmacia'&&!isAdmin()&&ui.tab==='caja')ui.tab='stock';
  renderNav();renderAlerts();renderUserBox();
  var v=ui.view;
  main.innerHTML=v==='pacientes'?viewPacientes():v==='calendario'?viewCalendario():v==='farmacia'?viewFarmacia():v==='proveedores'?viewProveedores():
    v==='reportes'?viewReportes():v==='papelera'?viewTrash():v==='copias'?viewBackups():viewUsers();
  if(v==='pacientes')loadThumbs();
}

/* ============================================================
   Formularios
   ============================================================ */
function patientForm(p){
  var isNew=!p;p=p||{species:'Perro',sex:'Macho',neutered:false};
  openForm({title:isNew?'Nuevo paciente':'Editar datos de '+esc(p.name),
    body:'<div class="fields">'+
      fld('Nombre','name',{value:p.name,req:true})+
      fld('Especie','species',{opts:['Perro','Gato'],value:p.species})+
      fld('Raza','breed',{value:p.breed,ph:'Ej.: Labrador'})+
      fld('Sexo','sex',{opts:['Macho','Hembra'],value:p.sex})+
      fld('Fecha de nacimiento (aprox.)','birth',{type:'date',value:p.birth,max:todayIso()})+
      fld('Peso (kg)','weight',{type:'number',step:'0.01',min:0.01,max:150,value:p.weight})+
      fld('Dueño','owner',{value:p.owner,req:true})+
      fld('Teléfono','phone',{type:'tel',value:p.phone,pattern:PHONE_PAT,title:'Solo números, espacios, + , - y paréntesis (mínimo 6 dígitos)'})+
      fld('Email del dueño','email',{type:'email',value:p.email,full:true,ph:'nombre@correo.com'})+
      fld('Castrado/a','neutered',{type:'checkbox',value:p.neutered,full:true})+
      fld('Alergias o notas importantes','notes',{type:'textarea',value:p.notes,full:true,ph:'Ej.: alérgico a la penicilina'})+
    '</div>',
    submit:isNew?'Agregar paciente':'Guardar cambios',
    onSubmit:async function(d){
      var body={name:d.name,species:d.species,breed:d.breed,sex:d.sex,birth:d.birth,weight:d.weight,owner:d.owner,phone:d.phone,email:d.email,neutered:!!d.neutered,notes:d.notes};
      if(isNew){
        if(!(await confirmDuplicate(S.patients.some(function(x){return sameName(x.name,d.name)&&sameName(x.owner,d.owner);}))))return false;
        var r=await api('/patients',{body:body});ui.sel=r.id;ui.detail=null;ui.view='pacientes';await reload();toast('Paciente agregado');}
      else{await api('/patients/'+p.id,{method:'PUT',body:body});await reload();toast('Datos guardados');}
    }});
}
function vaccineForm(p,v){
  var isEdit=!!v;
  // Se ofrecen las vacunas de la especie del paciente (las que no tienen especie, siempre).
  var vacServices=S.services.filter(function(s){return s.category==='Vacunas'&&speciesOk(svcSpecies(s),p.species);});
  var vacProducts=S.products.filter(function(x){return x.category==='Vacunas'&&(speciesOk(x.species,p.species)||(isEdit&&x.id===v.productId));});
  var svcOpts=[['','No vincular (no descuenta stock)']].concat(vacServices.map(function(s){
    var pr=prodById(s.productId);
    return [s.id, s.name+(pr?' — stock: '+pr.stock:'')];
  }));
  var prodOpts=[['','Ninguno (no descuenta stock)']].concat(vacProducts.map(function(x){return [x.id,x.name+' (stock: '+x.stock+')'];}));
  var names=VAC_SUGG.filter(function(n){return speciesOk(VAC_SPECIES[n],p.species);});
  vacProducts.forEach(function(x){if(names.indexOf(x.name)<0)names.push(x.name);});
  var top=isEdit?(vacProducts.length?'<div class="fields">'+fld('Producto del stock que descuenta 1 unidad','product',{opts:prodOpts,value:v.productId,full:true})+'</div>':'')
    :(vacServices.length?'<div class="fields">'+fld('Vacuna de la lista de precios (opcional)','service',{opts:svcOpts,full:true})+'</div>':'');
  var chargeBox=isEdit?'':'<div class="fields" id="chgbox" hidden>'+fld('Cobrar ahora (registra el cobro y el ingreso en caja)','chargeNow',{type:'checkbox',value:true,full:true})+
    fld('Monto a cobrar','chargeAmount',{type:'number',min:0,step:'0.01'})+fld('Forma de pago','chargeMethod',{opts:PAY,value:'Efectivo'})+'</div>';
  var f=openForm({title:(isEdit?'Editar vacuna de ':'Agregar vacuna a ')+esc(p.name),
    body:top+
    '<datalist id="vaclist">'+names.map(function(n){return '<option value="'+esc(n)+'">';}).join('')+'</datalist>'+
    '<div class="fields">'+fld('Vacuna','name',{req:true,list:'vaclist',full:true,ph:'Ej.: Sextuple',value:isEdit?v.name:''})+
    fld('Fecha de aplicación','date',{type:'date',value:isEdit?v.date:todayIso(),max:todayIso(),req:true})+
    fld('Próxima dosis (vencimiento)','next',{type:'date',value:isEdit?v.next:''})+'</div>'+
    '<div class="quick"><span>Próxima dosis en:</span><button type="button" class="segb" data-q="d21">3 semanas</button><button type="button" class="segb" data-q="m6">6 meses</button><button type="button" class="segb" data-q="m12">1 año</button></div>'+chargeBox,
    submit:isEdit?'Guardar cambios':'Agregar vacuna',
    onSubmit:async function(d){
      if(isEdit){
        await api('/vaccines/'+v.id,{method:'PUT',body:{name:d.name,date:d.date,next:d.next,productId:d.product?Number(d.product):null}});
        await reload();toast('Vacuna guardada');return;
      }
      // Si el producto vinculado no tiene stock, se avisa antes de guardar. El servidor igual lo
      // rechaza si se intenta descontar sin stock: "Aplicar sin descontar" es la única salida.
      var skip=false;
      var svc=d.service?vacServices.find(function(x){return String(x.id)===String(d.service);}):null;
      var prod=svc?prodById(svc.productId):null;
      if(prod&&prod.stock<=0){
        var ch=await choiceDialog('Sin stock de '+esc(prod.name),'<p>No hay stock de <b>'+esc(prod.name)+'</b> (quedan 0). ¿Querés aplicar la vacuna igual, sin descontar nada del stock?</p>',
          [{label:'Cancelar',value:'cancel',cls:'ghost'},{label:'Aplicar sin descontar stock',value:'skip',cls:'primary'}]);
        if(ch!=='skip')return false;
        skip=true;
      }
      var body={name:d.name,date:d.date,next:d.next,serviceId:d.service||null,skipStock:skip};
      if(svc&&d.chargeNow)body.charge={amount:d.chargeAmount,method:d.chargeMethod};
      var r=await api('/patients/'+p.id+'/vaccines',{body:body});
      await reload();
      toast('Vacuna agregada'+(r.deducted?' · se descontó 1 del stock':'')+(r.charged?' · cobro registrado':''));
    }});
  f.querySelectorAll('[data-q]').forEach(function(b){b.addEventListener('click',function(){
    var base=f.querySelector('[name="date"]').value||todayIso(),q=b.dataset.q;
    f.querySelector('[name="next"]').value=q==='d21'?shiftDays(21,base):q==='m6'?shiftMonths(6,base):shiftMonths(12,base);
  });});
  var svcSel=f.querySelector('[name="service"]');
  if(svcSel){
    var lastAuto='';
    var box=f.querySelector('#chgbox'),chk=f.querySelector('[name="chargeNow"]');
    var sync=function(){var on=chk.checked;f.querySelector('[name="chargeAmount"]').disabled=!on;f.querySelector('[name="chargeMethod"]').disabled=!on;};
    chk.addEventListener('change',sync);
    svcSel.addEventListener('change',function(){
      var s=vacServices.find(function(x){return String(x.id)===svcSel.value;});
      var nm=f.querySelector('[name="name"]');
      box.hidden=!s;
      if(s){
        // B3: el nombre de la vacuna es el del producto vinculado ("Triple felina"), no el del servicio ("... (aplicación)"); sigue siendo editable.
        var pr=prodById(s.productId),auto=pr?pr.name:s.name;
        if(!nm.value||nm.value===lastAuto){nm.value=auto;lastAuto=auto;}
        f.querySelector('[name="chargeAmount"]').value=s.price;
        sync();
      }
    });
  }
}
function dxForm(p,d0){
  var e=!!d0;
  openForm({title:(e?'Editar diagnóstico de ':'Agregar diagnóstico a ')+esc(p.name),
    body:'<div class="fields">'+fld('Fecha','date',{type:'date',value:e?d0.date:todayIso(),max:todayIso(),req:true})+fld('Diagnóstico o motivo de consulta','title',{req:true,ph:'Ej.: Gastroenteritis',value:e?d0.title:''})+
    fld('Detalle y tratamiento indicado','notes',{type:'textarea',full:true,value:e?d0.notes:''})+'</div>',
    submit:e?'Guardar cambios':'Agregar diagnóstico',
    onSubmit:async function(d){
      var body={date:d.date,title:d.title,notes:d.notes};
      if(e)await api('/diagnoses/'+d0.id,{method:'PUT',body:body});else await api('/patients/'+p.id+'/diagnoses',{body:body});
      await reload();toast(e?'Diagnóstico guardado':'Diagnóstico agregado');
    }});
}
function medForm(p,m){
  var e=!!m;
  var opts=[['','Ninguno (no descontar)']].concat(S.products.filter(function(x){return x.category==='Medicamentos'||x.category==='Vacunas'||(e&&x.id===m.productId);}).map(function(x){return [x.id,x.name+' (stock: '+x.stock+')'];}));
  var f=openForm({title:(e?'Editar medicación de ':'Agregar medicación a ')+esc(p.name),
    body:'<div class="fields">'+fld('Producto del stock (descuenta unidades)','product',{opts:opts,full:true,value:e?m.productId:''})+
    fld('Cantidad a descontar del stock','qty',{type:'number',min:1,step:'1',value:e&&m.stockQty?m.stockQty:1})+
    fld('Medicamento','name',{req:true,full:true,value:e?m.name:''})+fld('Dosis','dose',{ph:'Ej.: 250 mg cada 12 h',value:e?m.dose:''})+fld('Duración','duration',{ph:'Ej.: 7 días',value:e?m.duration:''})+
    fld('Fecha','date',{type:'date',value:e?m.date:todayIso(),max:todayIso(),req:true})+'</div>',
    submit:e?'Guardar cambios':'Agregar medicación',
    onSubmit:async function(d){
      var body={date:d.date,name:d.name,dose:d.dose,duration:d.duration,productId:d.product?Number(d.product):null,qty:d.qty};
      if(e){await api('/medications/'+m.id,{method:'PUT',body:body});await reload();toast('Medicación guardada');return;}
      var r=await api('/patients/'+p.id+'/medications',{body:body});
      await reload();toast('Medicación agregada'+(r.deducted?' · se descontó '+r.qty+' del stock':''));
    }});
  var sel=f.querySelector('[name="product"]'),qty=f.querySelector('[name="qty"]'),nm=f.querySelector('[name="name"]');
  // La cantidad solo aparece con un producto elegido, y no puede pasar del stock disponible
  // (al editar, se cuenta también lo que esta medicación ya había descontado).
  var syncQty=function(){
    var pr=prodById(Number(sel.value));
    qty.closest('label').hidden=!pr;
    if(pr){var avail=pr.stock+(e&&m.productId===pr.id?m.stockQty:0);qty.max=Math.max(avail,1);}
  };
  sel.addEventListener('change',function(){
    var pr=prodById(Number(sel.value));
    if(pr&&!nm.value)nm.value=pr.name;
    syncQty();
  });
  syncQty();
}
function weightForm(p){
  var last=(p.weights||[]).slice(-1)[0];
  openForm({title:'Registrar peso de '+esc(p.name),
    body:'<div class="fields">'+fld('Peso (kg)','kg',{type:'number',step:'0.01',min:0.01,max:150,req:true,value:last?last.kg:''})+fld('Fecha','date',{type:'date',value:todayIso(),max:todayIso(),req:true})+'</div>',
    submit:'Registrar peso',
    onSubmit:async function(d){await api('/patients/'+p.id+'/weights',{body:{kg:d.kg,date:d.date}});await reload();toast('Peso registrado');}});
}
// G2: vista de impresión (se guarda como PDF desde el diálogo de impresión del navegador).
function printDoc(kind,p){
  var byDate=function(a,b){return a.date<b.date?-1:a.date>b.date?1:0;};
  var yes=function(x){return x?esc(x):'—';};
  var cert=kind==='cert';
  var table=function(head,rows,empty){
    return rows.length?'<table><thead><tr>'+head.map(function(h){return '<th>'+h+'</th>';}).join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>':'<p class="pe">'+empty+'</p>';
  };
  var html='<header class="ph"><div><h1>'+esc(S.clinic)+'</h1><p>'+(cert?'Certificado de vacunación':'Historia clínica')+'</p></div><p class="pd">Emitido el '+fmtDate(todayIso())+'</p></header>'+
    '<h2>Paciente</h2><table class="kv"><tbody>'+
    '<tr><th>Nombre</th><td>'+esc(p.name)+'</td><th>Especie / raza</th><td>'+esc(p.species)+(p.breed?' · '+esc(p.breed):'')+'</td></tr>'+
    '<tr><th>Sexo</th><td>'+esc(p.sex)+(p.neutered?' (castrad'+(p.sex==='Hembra'?'a':'o')+')':'')+'</td><th>Edad</th><td>'+esc(ageText(p.birth))+'</td></tr>'+
    '<tr><th>Peso</th><td>'+(p.weight!==''?fmtKg(p.weight):'—')+'</td><th>Dueño</th><td>'+esc(p.owner)+'</td></tr>'+
    '<tr><th>Teléfono</th><td>'+yes(p.phone)+'</td><th>Email</th><td>'+yes(p.email)+'</td></tr></tbody></table>';
  var vacs=p.vaccines.slice().sort(byDate).map(function(v){return '<tr><td>'+fmtDate(v.date)+'</td><td>'+esc(v.name)+'</td><td>'+(v.next?fmtDate(v.next):'—')+'</td></tr>';});
  if(cert){
    html+='<h2>Vacunas aplicadas</h2>'+table(['Fecha de aplicación','Vacuna','Próxima dosis'],vacs,'No hay vacunas registradas.')+
      '<p class="pe">Se certifica que las vacunas indicadas fueron aplicadas al paciente en las fechas consignadas.</p>'+
      '<div class="sign"><div><span></span>Firma del veterinario</div><div><span></span>Sello</div></div>';
  }else{
    if(p.notes)html+='<h2>Notas importantes</h2><p>'+esc(p.notes)+'</p>';
    html+='<h2>Vacunas</h2>'+table(['Fecha','Vacuna','Próxima dosis'],vacs,'Sin vacunas registradas.')+
      '<h2>Diagnósticos y consultas</h2>'+table(['Fecha','Diagnóstico','Detalle'],p.diagnoses.slice().sort(byDate).map(function(d){return '<tr><td>'+fmtDate(d.date)+'</td><td>'+esc(d.title)+'</td><td>'+esc(d.notes)+'</td></tr>';}),'Sin diagnósticos registrados.')+
      '<h2>Estudios complementarios</h2>'+table(['Fecha','Estudio','Notas'],(p.studies||[]).slice().sort(byDate).map(function(d){return '<tr><td>'+fmtDate(d.date)+'</td><td>'+esc(d.title)+'</td><td>'+esc(d.notes)+'</td></tr>';}),'Sin estudios registrados.')+
      '<h2>Medicación</h2>'+table(['Fecha','Medicamento','Dosis','Duración'],p.meds.slice().sort(byDate).map(function(m){return '<tr><td>'+fmtDate(m.date)+'</td><td>'+esc(m.name)+'</td><td>'+esc(m.dose)+'</td><td>'+esc(m.duration)+'</td></tr>';}),'Sin medicación registrada.');
  }
  var el=$('#print'),oldTitle=document.title;
  el.innerHTML=html;
  document.title=(cert?'Certificado de vacunación':'Historia clínica')+' - '+p.name;
  var done=function(){document.title=oldTitle;el.innerHTML='';window.removeEventListener('afterprint',done);};
  window.addEventListener('afterprint',done);
  window.print();
}
function chargeForm(p){
  var svcs=S.services,prods=S.products.filter(function(x){return x.stock>0;});
  if(!svcs.length&&!prods.length){toast(isAdmin()?'Primero cargá los precios en Farmacia y caja > Lista de precios':'Todavía no hay precios cargados. Pedile al administrador que los cargue.');return;}
  var itemOpts='<option value="">Elegí un servicio o producto…</option>'+
    (svcs.length?'<optgroup label="Servicios">'+svcs.map(function(x){return '<option value="s'+x.id+'">'+esc(x.name)+' — '+money(x.price)+'</option>';}).join('')+'</optgroup>':'')+
    (prods.length?'<optgroup label="Productos">'+prods.map(function(x){return '<option value="p'+x.id+'">'+esc(x.name)+' — '+money(x.price)+' (stock: '+x.stock+')</option>';}).join('')+'</optgroup>':'');
  var lineHTML='<div class="cline"><select class="l-item" aria-label="Servicio o producto">'+itemOpts+'</select>'+
    '<input class="l-qty" type="number" min="1" step="1" value="1" aria-label="Cantidad" disabled><input class="l-price" type="number" min="0" step="0.01" aria-label="Precio unitario">'+
    '<span class="l-sub num"></span><button type="button" class="link bad l-del" aria-label="Quitar línea">✕</button></div>';
  var f=openForm({title:'Cobrar a '+esc(p.name),
    body:'<div class="cline head"><span>Servicio o producto</span><span>Cant.</span><span>Precio</span><span>Subtotal</span><span></span></div><div id="lines"></div>'+
      '<button type="button" class="btn" id="addline">+ Agregar línea</button>'+
      '<div class="fields" style="margin-top:.8rem">'+fld('Descuento','dtype',{opts:[['none','Sin descuento'],['amount','Monto ($)'],['percent','Porcentaje (%)']],value:'none'})+fld('Valor del descuento','dvalue',{type:'number',min:0,step:'0.01'})+
      fld('Fecha','date',{type:'date',value:todayIso(),max:todayIso(),req:true})+fld('Forma de pago','method',{opts:PAY,value:'Efectivo'})+
      fld('Registrar como ingreso en caja','cash',{type:'checkbox',value:true,full:true})+'</div>'+
      '<div class="ctotals"><div><span>Subtotal</span><span id="c-sub"></span></div><div><span>Descuento</span><span id="c-disc"></span></div><div class="grand"><span>Total</span><span id="c-tot"></span></div></div>',
    submit:'Cobrar',
    onSubmit:async function(d){
      var items=[];
      f.querySelectorAll('.cline:not(.head)').forEach(function(r){
        var v=r.querySelector('.l-item').value;if(!v)return;
        items.push({type:v[0]==='s'?'service':'product',id:Number(v.slice(1)),qty:r.querySelector('.l-qty').value,price:r.querySelector('.l-price').value});
      });
      if(!items.length)throw new Error('Agregá al menos un servicio o producto');
      var r=await api('/patients/'+p.id+'/charges',{body:{items:items,date:d.date,method:d.method,cash:!!d.cash,discount:d.dtype!=='none'&&d.dvalue!==''?{type:d.dtype,value:d.dvalue}:null}});
      await reload();toast('Cobrado: '+money(r.total)+(items.length>1?' · '+items.length+' líneas':''));
    }});
  var linesEl=f.querySelector('#lines');
  var recalc=function(){
    var sub=0;
    linesEl.querySelectorAll('.cline').forEach(function(r){
      var ok=!!r.querySelector('.l-item').value,q=Number(r.querySelector('.l-qty').value)||0,pr=Number(r.querySelector('.l-price').value)||0;
      var t=ok?Math.round(q*pr*100)/100:0;sub+=t;r.querySelector('.l-sub').textContent=ok?money(t):'';
    });
    var dt=f.querySelector('[name="dtype"]').value,dv=Number(f.querySelector('[name="dvalue"]').value)||0;
    var disc=dt==='percent'?Math.round(sub*Math.min(dv,100))/100:dt==='amount'?Math.min(dv,sub):0;
    f.querySelector('#c-sub').textContent=money(sub);f.querySelector('#c-disc').textContent=disc?'− '+money(disc):'—';f.querySelector('#c-tot').textContent=money(Math.round((sub-disc)*100)/100);
    f.querySelector('[name="dvalue"]').disabled=dt==='none';
  };
  var addLine=function(){linesEl.insertAdjacentHTML('beforeend',lineHTML);recalc();};
  f.querySelector('#addline').addEventListener('click',addLine);
  f.addEventListener('input',recalc);
  f.addEventListener('change',function(e){
    if(e.target.classList.contains('l-item')){
      var r=e.target.closest('.cline'),v=e.target.value,q=r.querySelector('.l-qty');
      if(v[0]==='s'){var sv=S.services.find(function(x){return x.id===Number(v.slice(1));});r.querySelector('.l-price').value=sv.price;q.value=1;q.disabled=true;q.removeAttribute('max');}
      else if(v[0]==='p'){var pr=prodById(Number(v.slice(1)));r.querySelector('.l-price').value=pr.price;q.disabled=false;q.max=pr.stock;}
      else{r.querySelector('.l-price').value='';q.disabled=true;}
    }
    recalc();
  });
  f.addEventListener('click',function(e){
    var b=e.target.closest('.l-del');if(!b)return;
    b.closest('.cline').remove();if(!linesEl.children.length)addLine();recalc();
  });
  addLine();
}
// F5: aviso NO bloqueante si ya existe algo con ese nombre (se compara sin tildes ni mayúsculas).
async function confirmDuplicate(exists){
  if(!exists)return true;
  var ch=await choiceDialog('Posible duplicado','<p>Ya existe uno con ese nombre. ¿Crear igual?</p>',[{label:'Cancelar',value:'no',cls:'ghost'},{label:'Crear igual',value:'ok',cls:'primary'}]);
  return ch==='ok';
}
var sameName=function(a,b){return norm(a).trim()===norm(b).trim();};
var supplierOpts=function(){return [['','Sin proveedor']].concat((S.suppliers||[]).map(function(x){return [x.id,x.name];}));};
// C6: si un egreso en efectivo deja la caja en negativo, se avisa antes de guardar.
// Devuelve true para seguir o false si el usuario prefiere corregir (por ejemplo, cambiar la forma de pago).
async function confirmNegativeCash(amount,method){
  if(method!=='Efectivo'||!S.summary||!(amount>0))return true;
  var after=Math.round((S.summary.drawer-amount)*100)/100;
  if(after>=0)return true;
  var ch=await choiceDialog('La caja queda en negativo','<p>Con este egreso la caja queda en <b>-'+money(-after)+'</b>. ¿Lo pagaste con otro fondo?</p>',
    [{label:'Cambiar forma de pago',value:'change',cls:'ghost'},{label:'Continuar igual',value:'go',cls:'primary'}]);
  return ch==='go';
}
// C3: muestra en vivo "Total: 20 × $800 = $16.000" debajo de los campos de cantidad y precio unitario.
function bindTotalPreview(f,qtyName,priceName){
  var box=document.createElement('p');box.className='preview';
  f.querySelector('.fields').insertAdjacentElement('afterend',box);
  var q=f.querySelector('[name="'+qtyName+'"]'),u=f.querySelector('[name="'+priceName+'"]');
  var sync=function(){
    var n=Number(q.value),pr=Number(u.value);
    box.textContent=n>0&&pr>0?'Total: '+n+' × '+money(pr)+' = '+money(Math.round(n*pr*100)/100):'';
  };
  q.addEventListener('input',sync);u.addEventListener('input',sync);sync();
}
// El campo "Especie" solo tiene sentido en la categoría Vacunas: se oculta en las demás.
function bindSpecies(f){
  var cat=f.querySelector('[name="category"]'),sp=f.querySelector('[name="species"]').closest('label');
  var sync=function(){sp.hidden=cat.value!=='Vacunas';};
  cat.addEventListener('change',sync);sync();
}
function productForm(x){
  var isNew=!x;x=x||{category:'Medicamentos',min:5,price:0};
  var pf=openForm({title:isNew?'Nuevo producto':'Editar producto',
    body:'<div class="fields">'+fld('Nombre','name',{value:x.name,req:true,full:true})+fld('Categoría','category',{opts:PROD_CATS,value:x.category})+fld('Precio de venta','price',{type:'number',min:0,step:'0.01',value:x.price,req:true})+
    fld('Especie (solo vacunas, opcional)','species',{opts:SPECIES_OPTS,value:x.species,full:true})+
    fld('Proveedor habitual (opcional)','supplierId',{opts:supplierOpts(),value:x.supplierId,full:true})+
    fld('Stock mínimo (para avisar)','min',{type:'number',min:0,step:'1',value:x.min,req:true})+
    (isNew?fld('Stock inicial','stock',{type:'number',min:0,step:'1',value:0,req:true})+
      // v2: se carga precio unitario; el costo total (para la caja) se calcula solo.
      fld('Precio unitario que pagaste (opcional)','unitPrice',{type:'number',min:0.01,step:'0.01',ph:'Ej.: 800'})+
      fld('Forma de pago','method',{opts:PAY,value:'Transferencia'}):'')+'</div>'+
    (isNew?'':'<p>Para cambiar la cantidad usá el botón + (llegó mercadería) o “Ajustar” (corrección).</p>'),
    submit:isNew?'Agregar producto':'Guardar cambios',
    onSubmit:async function(d){
      if(isNew){
        if(!(await confirmDuplicate(S.products.some(function(x){return sameName(x.name,d.name);}))))return false;
        var cost=Number(d.stock)*Number(d.unitPrice);
        if(cost>0&&!(await confirmNegativeCash(cost,d.method)))return false;
        await api('/products',{body:{name:d.name,category:d.category,price:d.price,min:d.min,stock:d.stock,unitPrice:d.unitPrice,method:d.method,species:d.species,supplierId:d.supplierId||null}});await reload();toast('Producto agregado');}
      else{await api('/products/'+x.id,{method:'PUT',body:{name:d.name,category:d.category,price:d.price,min:d.min,species:d.species,supplierId:d.supplierId||null}});await reload();toast('Producto guardado');}
    }});
  bindSpecies(pf);
  if(isNew)bindTotalPreview(pf,'stock','unitPrice');
}
function buyForm(x){
  var f=openForm({title:'Agregar stock de '+esc(x.name),
    body:'<div class="fields">'+fld('Cantidad que llegó','qty',{type:'number',min:1,step:'1',value:1,req:true})+fld('Precio unitario que pagaste','unitPrice',{type:'number',min:0.01,step:'0.01',req:true})+
      fld('Forma de pago','method',{opts:PAY,value:'Transferencia'})+fld('Fecha','date',{type:'date',value:todayIso(),max:todayIso(),req:true})+
      fld('Proveedor (opcional)','supplierId',{opts:supplierOpts(),value:x.supplierId,full:true})+
      fld('Registrar como egreso en caja','cash',{type:'checkbox',value:true,full:true})+'</div><p>Stock actual: '+x.stock+'.</p>',
    submit:'Agregar stock',
    onSubmit:async function(d){
      var cost=Math.round(Number(d.qty)*Number(d.unitPrice)*100)/100;
      if(d.cash&&!(await confirmNegativeCash(cost,d.method)))return false;
      var r=await api('/products/'+x.id+'/purchase',{body:{qty:d.qty,unitPrice:d.unitPrice,method:d.method,date:d.date,cash:!!d.cash,supplierId:d.supplierId||null}});
      await reload();toast('Se agregaron '+d.qty+' al stock'+(d.cash&&r.cost>0?' · egreso de '+money(r.cost):''));
    }});
  bindTotalPreview(f,'qty','unitPrice');
}
// v2: ver el historial de compras/ventas/ajustes de un producto, con precio unitario y total.
function movementsDialog(x){
  dlg.innerHTML='<form class="dform"><h2>Historial de stock — '+esc(x.name)+'</h2><p class="empty">Cargando…</p>'+
    '<div class="actions"><button type="button" class="btn ghost" data-close>Cerrar</button></div></form>';
  dlg.querySelector('[data-close]').addEventListener('click',function(){dlg.close();});
  dlg.showModal();
  api('/products/'+x.id+'/movements').then(function(r){
    if(!dlg.open)return;
    var rows=r.items.map(function(m){
      var total=m.unitPrice>0?money(m.unitPrice*Math.abs(m.qty)):'—';
      return '<tr><td>'+fmtDate(m.date)+'</td><td>'+esc(m.reason)+(m.note?'<br><small>'+esc(m.note)+'</small>':'')+'</td><td class="num '+(m.qty<0?'out':'in')+'">'+(m.qty>0?'+':'')+m.qty+'</td>'+
        '<td class="num">'+(m.unitPrice>0?money(m.unitPrice):'—')+'</td><td class="num">'+total+'</td></tr>';
    }).join('');
    var p=dlg.querySelector('p');
    if(p)p.outerHTML='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Motivo</th><th class="num">Cantidad</th><th class="num">Precio unitario</th><th class="num">Total</th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="5" class="empty">Todavía no hay movimientos.</td></tr>')+'</tbody></table></div>';
  }).catch(function(e){if(dlg.open)toast(e.message);});
}
function adjustForm(x){
  openForm({title:'Ajustar stock de '+esc(x.name),
    body:'<div class="fields">'+fld('Cantidad a sumar o restar','delta',{type:'number',step:'1',req:true,ph:'Ej.: -2 para restar 2',full:true})+
      fld('Motivo','reason',{opts:ADJUST_REASONS,full:true})+fld('Nota (opcional)','note',{full:true,ph:'Ej.: se cayó el estante'})+'</div>'+
      '<p>Stock actual: '+x.stock+'. Sirve para corregir el stock (una pérdida, un error de carga). No modifica la caja.</p>',
    submit:'Ajustar stock',
    onSubmit:async function(d){await api('/products/'+x.id+'/adjust',{body:{delta:d.delta,reason:d.reason,note:d.note}});await reload();toast('Stock ajustado');}});
}
function sellForm(x){
  if(x.stock<1){toast('No queda stock de este producto');return;}
  var pats=[['','Sin paciente (venta de mostrador)']].concat(S.patients.slice().sort(function(a,b){return a.name.localeCompare(b.name,'es');}).map(function(p){return [p.id,p.name+' ('+p.owner+')'];}));
  openForm({title:'Vender '+esc(x.name),
    body:'<div class="fields">'+fld('Cantidad','qty',{type:'number',min:1,max:x.stock,step:'1',value:1,req:true})+fld('Forma de pago','method',{opts:PAY,value:'Efectivo'})+
      fld('Paciente (opcional)','patientId',{opts:pats,full:true})+'</div><p>Precio por unidad: '+money(x.price)+'. Quedan '+x.stock+' en stock.</p>',
    submit:'Registrar venta',
    onSubmit:async function(d){var r=await api('/products/'+x.id+'/sell',{body:{qty:d.qty,method:d.method,patientId:d.patientId?Number(d.patientId):null}});await reload();toast('Venta registrada: '+money(r.total));}});
}
function serviceForm(s){
  var isNew=!s;s=s||{category:'Consultas',price:0,items:[]};
  // Las vacunas vinculan UN producto (se descuenta al aplicarlas en la historia clínica). Los demás servicios
  // pueden vincular varios productos con cantidad, que se descuentan al cobrar el servicio.
  var vacProducts=S.products.filter(function(x){return x.category==='Vacunas';});
  var prodOpts=[['','Ninguno']].concat(vacProducts.map(function(x){return [x.id,x.name+' (stock: '+x.stock+')'];}));
  var allOpts=[['','Elegí un producto…']].concat(S.products.map(function(x){return [x.id,x.name+' (stock: '+x.stock+')'];}));
  var itemRow=function(it){
    return '<div class="sline"><select class="si-prod" aria-label="Producto">'+allOpts.map(function(o){return '<option value="'+o[0]+'"'+(String(o[0])===String(it.productId||'')?' selected':'')+'>'+esc(o[1])+'</option>';}).join('')+'</select>'+
      '<input class="si-qty" type="number" min="1" step="1" value="'+(it.qty||1)+'" aria-label="Cantidad"><button type="button" class="link bad si-del" aria-label="Quitar producto">✕</button></div>';
  };
  var sf=openForm({title:isNew?'Nuevo precio':'Editar precio',
    body:'<div class="fields">'+fld('Servicio','name',{value:s.name,req:true,full:true,ph:'Ej.: Consulta general'})+fld('Categoría','category',{opts:SERV_CATS,value:s.category})+fld('Precio','price',{type:'number',min:0,step:'0.01',value:s.price,req:true})+
    fld('Especie (solo vacunas, opcional)','species',{opts:SPECIES_OPTS,value:s.species,full:true})+
    fld('Vacuna del stock que descuenta (opcional)','productId',{opts:prodOpts,value:s.productId,full:true})+'</div>'+
    '<div id="sitems"><p><b>Productos que descuenta al cobrarlo</b> (opcional). Ej.: Castración → 1 collar isabelino + 1 meloxicam.</p><div id="sitemrows">'+(s.items||[]).map(itemRow).join('')+'</div>'+
    '<button type="button" class="btn" id="si-add">+ Agregar producto</button></div>'+
    '<p id="vacnote">Si es una vacuna, vinculala a su producto del stock: cada vez que se aplique elegida de la lista de precios, se descuenta 1 unidad sola.</p>',
    submit:isNew?'Agregar precio':'Guardar cambios',
    onSubmit:async function(d){
      var items=[];
      if(d.category!=='Vacunas')sf.querySelectorAll('.sline').forEach(function(r){
        var pid=r.querySelector('.si-prod').value;
        if(pid)items.push({productId:Number(pid),qty:r.querySelector('.si-qty').value});
      });
      var body={name:d.name,category:d.category,price:d.price,productId:d.productId||null,species:d.species,items:items};
      if(isNew&&!(await confirmDuplicate(S.services.some(function(x){return sameName(x.name,d.name);}))))return false;
      if(isNew)await api('/services',{body:body});else await api('/services/'+s.id,{method:'PUT',body:body});
      await reload();toast(isNew?'Precio agregado':'Precio guardado');
    }});
  bindSpecies(sf);
  var cat=sf.querySelector('[name="category"]');
  var syncCat=function(){
    var vac=cat.value==='Vacunas';
    sf.querySelector('#sitems').hidden=vac;sf.querySelector('#vacnote').hidden=!vac;
    sf.querySelector('[name="productId"]').closest('label').hidden=!vac;
  };
  cat.addEventListener('change',syncCat);syncCat();
  sf.querySelector('#si-add').addEventListener('click',function(){sf.querySelector('#sitemrows').insertAdjacentHTML('beforeend',itemRow({}));});
  sf.addEventListener('click',function(e){var b=e.target.closest('.si-del');if(b)b.closest('.sline').remove();});
}
// v2: estudios complementarios (mismo patrón que diagnósticos).
function studyForm(p,st){
  var e=!!st,pending=[],existing=e?(st.attachments||[]).slice():[];
  var zone=S.attachments?
    '<div class="attach"><div class="drop" id="drop"><p>Arrastrá archivos acá, o</p><div class="dropbtns"><button type="button" class="btn" id="pick">Adjuntar archivos</button><button type="button" class="btn" id="shoot">📷 Sacar foto</button></div>'+
    '<small>PDF, JPG, PNG, WEBP, HEIC o DICOM (.dcm) · hasta 10 MB cada uno · máximo 5 por estudio</small></div>'+
    '<input type="file" id="fin" multiple accept="image/*,application/pdf,.pdf,.dcm,.heic,.webp" hidden><input type="file" id="fcam" accept="image/*" capture="environment" hidden>'+
    '<ul class="flist" id="flist"></ul><div class="progress" id="prog" hidden><div></div><span></span></div></div>':
    '<p class="warnbox">Los adjuntos todavía no están activados en el servidor'+(isAdmin()?' (faltan las variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Render).':'. Pedile al administrador que los active.')+'</p>';
  var f=openForm({title:(e?'Editar estudio de ':'Agregar estudio complementario a ')+esc(p.name),
    body:'<div class="fields">'+fld('Fecha','date',{type:'date',value:e?st.date:todayIso(),max:todayIso(),req:true})+fld('Tipo de estudio','title',{req:true,full:true,ph:'Ej.: Ecografía abdominal, radiografía, análisis de sangre',value:e?st.title:''})+
    fld('Notas técnicas','notes',{type:'textarea',full:true,value:e?st.notes:''})+'</div><h3 class="attitle">Adjuntar archivos</h3>'+zone,
    submit:e?'Guardar cambios':'Agregar estudio',
    onSubmit:async function(d){
      var body={date:d.date,title:d.title,notes:d.notes},id;
      if(e){await api('/studies/'+st.id,{method:'PUT',body:body});id=st.id;}
      else id=(await api('/patients/'+p.id+'/studies',{body:body})).id;
      if(pending.length){
        var prog=f.querySelector('#prog'),bar=prog.querySelector('div'),txt=prog.querySelector('span');
        prog.hidden=false;txt.textContent='Subiendo…';
        try{
          await uploadFiles(id,pending,function(r){bar.style.width=Math.round(r*100)+'%';txt.textContent='Subiendo… '+Math.round(r*100)+'%';});
        }catch(err){
          await reload();
          toast('El estudio se guardó, pero no se pudieron subir los archivos: '+err.message+' Reintentá desde “Editar”.',true);
          return;
        }
      }
      await reload();toast((e?'Estudio guardado':'Estudio agregado')+(pending.length?' · '+plural(pending.length,'archivo subido','archivos subidos'):''));
    }});
  if(!S.attachments)return;
  var list=f.querySelector('#flist'),errEl=f.querySelector('.err');
  var draw=function(){
    list.innerHTML=existing.map(function(a){
      return '<li><span class="fname">'+esc(a.name)+'</span><small>'+fmtBytes(a.size)+'</small>'+(isAdmin()?'<button type="button" class="link bad" data-ex="'+a.id+'">Quitar</button>':'<span></span>')+'</li>';
    }).join('')+pending.map(function(x,i){
      return '<li class="new"><span class="fname">'+esc(x.name)+'</span><small>'+fmtBytes(x.size)+' · nuevo</small><button type="button" class="link bad" data-new="'+i+'" aria-label="Sacar '+esc(x.name)+' de la lista">✕</button></li>';
    }).join('');
  };
  var add=async function(fl){
    errEl.textContent='';
    for(var i=0;i<fl.length;i++){
      var file=fl[i],ext=(file.name.split('.').pop()||'').toLowerCase();
      if(ATT_EXT.indexOf(ext)<0){errEl.textContent='“'+file.name+'”: tipo de archivo no permitido. Solo PDF, JPG, PNG, WEBP, HEIC y DICOM (.dcm).';continue;}
      if(existing.length+pending.length>=ATT_MAX_FILES){errEl.textContent='Cada estudio admite hasta '+ATT_MAX_FILES+' archivos.';break;}
      var ready=await compressImage(file);
      if(ready.size>ATT_MAX){errEl.textContent='“'+file.name+'” pesa más de 10 MB.';continue;}
      pending.push(ready);
    }
    draw();
  };
  f.querySelector('#pick').addEventListener('click',function(){f.querySelector('#fin').click();});
  f.querySelector('#shoot').addEventListener('click',function(){f.querySelector('#fcam').click();});
  ['#fin','#fcam'].forEach(function(sel){f.querySelector(sel).addEventListener('change',function(ev){add(Array.prototype.slice.call(ev.target.files));ev.target.value='';});});
  var drop=f.querySelector('#drop');
  ['dragenter','dragover'].forEach(function(n){drop.addEventListener(n,function(ev){ev.preventDefault();drop.classList.add('over');});});
  ['dragleave','drop'].forEach(function(n){drop.addEventListener(n,function(ev){ev.preventDefault();drop.classList.remove('over');});});
  drop.addEventListener('drop',function(ev){add(Array.prototype.slice.call(ev.dataTransfer.files));});
  list.addEventListener('click',async function(ev){
    var bn=ev.target.closest('[data-new]'),bx=ev.target.closest('[data-ex]');
    if(bn){pending.splice(Number(bn.dataset.new),1);draw();}
    if(bx){
      var a=existing.find(function(y){return String(y.id)===bx.dataset.ex;});
      var ch=await choiceDialog('Quitar archivo','<p>¿Quitar el archivo “'+esc(a.name)+'”? Se borra también del almacenamiento. Esta acción no se puede deshacer.</p>',[{label:'Cancelar',value:null,cls:'ghost'},{label:'Quitar',value:'ok',cls:'danger'}]);
      if(ch!=='ok')return;
      try{await api('/attachments/'+a.id,{method:'DELETE'});existing=existing.filter(function(y){return y!==a;});draw();reload();}
      catch(err){errEl.textContent=err.message;}
    }
  });
  draw();
}

// v2: proveedores.
function supplierForm(s){
  var isNew=!s;s=s||{};
  openForm({title:isNew?'Nuevo proveedor':'Editar proveedor',
    body:'<div class="fields">'+fld('Nombre','name',{value:s.name,req:true,full:true})+fld('Teléfono','phone',{type:'tel',value:s.phone,pattern:PHONE_PAT,title:'Solo números, espacios, + , - y paréntesis (mínimo 6 dígitos)'})+fld('Email','email',{type:'email',value:s.email})+
    fld('Qué se le compra (opcional)','description',{type:'textarea',value:s.description,full:true,ph:'Ej.: vacunas y antiparasitarios'})+'</div>',
    submit:isNew?'Agregar proveedor':'Guardar cambios',
    onSubmit:async function(d){
      var body={name:d.name,phone:d.phone,email:d.email,description:d.description};
      if(isNew&&!(await confirmDuplicate(S.suppliers.some(function(x){return sameName(x.name,d.name);}))))return false;
      if(isNew)await api('/suppliers',{body:body});else await api('/suppliers/'+s.id,{method:'PUT',body:body});
      ui.suppliers=null;await refreshView();toast(isNew?'Proveedor agregado':'Proveedor guardado');
    }});
}

// D1: ficha del proveedor: productos que se le compran e historial de compras con el total gastado.
function supplierDetail(id){
  dlg.innerHTML='<form class="dform"><h2>Proveedor</h2><p class="empty">Cargando…</p><div class="actions"><button type="button" class="btn ghost" data-close>Cerrar</button></div></form>';
  dlg.querySelector('[data-close]').addEventListener('click',function(){dlg.close();});
  dlg.showModal();
  api('/suppliers/'+id+'/detail').then(function(r){
    if(!dlg.open)return;
    var sp=r.supplier;
    var prods=r.products.length?'<ul class="plainlist">'+r.products.map(function(p){return '<li><b>'+esc(p.name)+'</b> <small>'+esc(p.category)+' · stock: '+p.stock+'</small></li>';}).join('')+'</ul>':'<p class="empty">Todavía no hay productos con este proveedor habitual.</p>';
    var buys=r.purchases.length?'<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio unit.</th><th class="num">Total</th></tr></thead><tbody>'+r.purchases.map(function(x){
      return '<tr><td>'+fmtDate(x.date)+'</td><td>'+esc(x.concept)+'</td><td class="num">'+(x.qty==null?'—':x.qty)+'</td><td class="num">'+(x.unitPrice==null?'—':money(x.unitPrice))+'</td><td class="num">'+money(x.total)+'</td></tr>';
    }).join('')+'</tbody></table></div>':'<p class="empty">Todavía no hay compras registradas con este proveedor.</p>';
    dlg.querySelector('form').innerHTML='<h2>'+esc(sp.name)+'</h2>'+
      '<p>'+(sp.phone?esc(sp.phone):'')+(sp.phone&&sp.email?' · ':'')+(sp.email?esc(sp.email):'')+'</p>'+(sp.description?'<p><small>'+esc(sp.description)+'</small></p>':'')+
      '<h3>Productos</h3>'+prods+'<h3>Historial de compras</h3>'+buys+
      '<div class="sum"><span>Total gastado ('+plural(r.purchaseCount,'compra','compras')+')</span><span>'+money(r.totalSpent)+'</span></div>'+
      '<div class="actions"><button type="button" class="btn ghost" data-close>Cerrar</button></div>';
    dlg.querySelector('[data-close]').addEventListener('click',function(){dlg.close();});
  }).catch(function(e){if(dlg.open){dlg.close();toast(e.message);}});
}

// v2: turnos del calendario.
var APPT_DEFAULT_MIN={consulta:20,vacuna:10,cirugia:120,otro:30};
// E2: aviso NO bloqueante si el turno se pisa con otro del mismo día (se tiene en cuenta la duración).
async function confirmNoOverlap(body,selfId){
  var list=(await api('/appointments?from='+body.date+'&to='+body.date)).items.filter(function(a){return a.id!==selfId;});
  var s0=toMin(body.time),e0=s0+Number(body.duration);
  var hit=list.find(function(a){var as=toMin(a.time);return s0<as+a.duration&&as<e0;});
  if(!hit)return true;
  var ch=await choiceDialog('Turno superpuesto','<p>Ya hay un turno a esa hora: '+esc(hit.patientName)+' ('+esc(surname(hit.patientOwner))+') – '+esc(hit.title)+'. ¿Agendar igual?</p>',
    [{label:'Cambiar la hora',value:'no',cls:'ghost'},{label:'Agendar igual',value:'ok',cls:'primary'}]);
  return ch==='ok';
}
function appointmentForm(a,presetDate){
  var isNew=!a;a=a||{type:'consulta',date:presetDate||ui.cal.anchor||todayIso(),time:'09:00'};
  var patOpts=S.patients.slice().sort(function(x,y){return x.name.localeCompare(y.name,'es');}).map(function(p){return [p.id,p.name+' ('+p.owner+')'];});
  if(!patOpts.length){toast('Primero cargá un paciente en la sección Pacientes');return;}
  var f=openForm({title:isNew?'Nuevo turno':'Editar turno',
    body:'<div class="fields">'+
      fld('Paciente','patientId',{opts:patOpts,value:a.patientId,full:true})+
      fld('Tipo de turno','type',{opts:APPT_TYPES,value:a.type})+
      fld('Duración (minutos)','duration',{type:'number',min:5,max:720,step:'5',value:a.duration||APPT_DEFAULT_MIN[a.type],req:true})+
      fld('Fecha','date',{type:'date',value:a.date,req:true})+
      fld('Hora','time',{type:'time',value:a.time,req:true})+
      fld('Título','title',{value:a.title,req:true,full:true,ph:'Ej.: Consulta de control'})+
      fld('Descripción (opcional)','description',{type:'textarea',value:a.description,full:true})+
    '</div>',
    submit:isNew?'Agregar turno':'Guardar cambios',
    onSubmit:async function(d){
      var body={patientId:Number(d.patientId),title:d.title,description:d.description,date:d.date,time:d.time,type:d.type,duration:Number(d.duration)};
      if(!(await confirmNoOverlap(body,isNew?null:a.id)))return false;
      if(isNew)await api('/appointments',{body:body});else await api('/appointments/'+a.id,{method:'PUT',body:body});
      await reloadCal();toast(isNew?'Turno agregado':'Turno guardado');
    }});
  // E3: la duración sugerida sigue al tipo de turno hasta que se edite a mano.
  var dur=f.querySelector('[name="duration"]'),touched=!isNew;
  dur.addEventListener('input',function(){touched=true;});
  f.querySelector('[name="type"]').addEventListener('change',function(e){if(!touched)dur.value=APPT_DEFAULT_MIN[e.target.value];});
}
// Modal de detalle con acciones propias (Editar / Eliminar / Ver ficha), por eso arma el diálogo a
// mano en vez de usar openForm (pensado para un único botón de guardar).
function appointmentDetails(a){
  var tel=String(a.patientPhone||'').replace(/[^\d+]/g,'');
  var kind=[a.patientSpecies,a.patientBreed].filter(Boolean).map(esc).join(' · ');
  dlg.innerHTML='<form class="dform"><h2>'+esc(a.title)+'</h2>'+
    '<p><b>Paciente:</b> '+esc(a.patientName)+(kind?' <small>('+kind+')</small>':'')+'</p>'+
    '<p><b>Dueño:</b> '+esc(a.patientOwner)+(a.patientPhone?' · <a href="'+(tel?'tel:'+tel:'#')+'">'+esc(a.patientPhone)+'</a>':'')+'</p>'+
    '<p><b>Tipo:</b> '+esc(APPT_LABEL[a.type]||a.type)+'</p>'+
    '<p><b>Cuándo:</b> '+fmtDate(a.date)+' de '+a.time.slice(0,5)+' a '+a.endTime+' hs <small>('+a.duration+' min)</small></p>'+
    (a.description?'<p><b>Descripción:</b> '+esc(a.description)+'</p>':'')+
    '<div class="actions"><button type="button" class="btn danger-o" data-x="del">Eliminar turno</button><button type="button" class="btn" data-x="ficha">Ver ficha</button><button type="button" class="btn ghost" data-close>Cerrar</button><button type="button" class="btn primary" data-x="edit">Editar</button></div></form>';
  dlg.querySelector('[data-close]').addEventListener('click',function(){dlg.close();});
  dlg.querySelector('[data-x="edit"]').addEventListener('click',function(){dlg.close();appointmentForm(a);});
  dlg.querySelector('[data-x="ficha"]').addEventListener('click',function(){
    dlg.close();ui.sel=a.patientId;ui.detail=null;ui.filter='all';ui.q='';go('pacientes');
  });
  dlg.querySelector('[data-x="del"]').addEventListener('click',function(){
    confirmForm('Eliminar turno','Se elimina el turno de '+esc(a.patientName)+' ("'+esc(a.title)+'") del '+fmtDate(a.date)+'.','Eliminar',async function(){
      await api('/appointments/'+a.id,{method:'DELETE'});await reloadCal();toast('Turno eliminado');
    });
  });
  if(!dlg.open)dlg.showModal();
}

function cashForm(type){
  openForm({title:type==='in'?'Registrar ingreso':'Registrar egreso',
    body:'<div class="fields">'+fld('Fecha','date',{type:'date',value:todayIso(),req:true})+fld('Monto','amount',{type:'number',min:0.01,step:'0.01',req:true})+
    fld('Concepto','concept',{req:true,full:true,ph:type==='in'?'Ej.: Venta de alimento':'Ej.: Pago de luz'})+
    fld('Categoría','category',{opts:type==='in'?CASH_IN_CATS:CASH_OUT_CATS,value:type==='in'?'Servicios':'Compra de stock'})+fld('Forma de pago','method',{opts:PAY,value:'Efectivo'})+
    (type==='out'?fld('Proveedor (opcional)','supplierId',{opts:supplierOpts(),full:true}):'')+'</div>',
    submit:'Registrar',
    onSubmit:async function(d){
      // Los movimientos manuales pueden tener fecha futura, pero hay que confirmarlo.
      var future=d.date>todayIso();
      if(future){
        var ch=await choiceDialog('Fecha posterior a hoy','<p>La fecha es posterior a hoy, ¿es correcto?</p>',
          [{label:'Corregir la fecha',value:'no',cls:'ghost'},{label:'Sí, es correcta',value:'ok',cls:'primary'}]);
        if(ch!=='ok')return false;
      }
      if(type==='out'&&!future&&!(await confirmNegativeCash(Number(d.amount),d.method)))return false;
      await api('/cash',{body:{date:d.date,type:type,concept:d.concept,category:d.category,method:d.method,amount:d.amount,confirmFuture:future,supplierId:d.supplierId||null}});await reload();toast('Movimiento registrado');
    }});
}
function userForm(u){
  var isNew=!u;u=u||{role:'staff',active:true};
  openForm({title:isNew?'Nuevo usuario':'Editar usuario',
    body:'<div class="fields">'+fld('Nombre','name',{value:u.name,req:true,full:true})+
    (isNew?fld('Email (es el usuario para ingresar)','email',{type:'email',req:true,full:true,auto:'off'}):'<p class="full" style="grid-column:1/-1">'+esc(u.email)+'</p>')+
    fld('Rol','role',{opts:[['staff','Ayudante'],['admin','Administrador']],value:u.role})+
    fld(isNew?'Contraseña (mínimo 8 caracteres)':'Nueva contraseña (dejala vacía para no cambiarla)','password',{type:'password',req:isNew,minlength:8,auto:'new-password'})+
    (isNew?'':fld('Usuario activo','active',{type:'checkbox',value:u.active,full:true}))+'</div>',
    submit:isNew?'Crear usuario':'Guardar cambios',
    onSubmit:async function(d){
      if(isNew){await api('/users',{body:{name:d.name,email:d.email,role:d.role,password:d.password}});await reload();toast('Usuario creado');}
      else{await api('/users/'+u.id,{method:'PATCH',body:{name:d.name,role:d.role,active:!!d.active,password:d.password}});await reload();toast('Usuario guardado');}
    }});
}
function passwordForm(){
  openForm({title:'Cambiar contraseña',
    body:'<div class="fields">'+fld('Contraseña actual','current',{type:'password',req:true,full:true,auto:'current-password'})+
    fld('Contraseña nueva (mínimo 8 caracteres)','password',{type:'password',req:true,full:true,minlength:8,auto:'new-password'})+
    fld('Repetí la contraseña nueva','repeat',{type:'password',req:true,full:true,auto:'new-password'})+'</div>',
    submit:'Cambiar contraseña',
    onSubmit:async function(d){
      if(d.password!==d.repeat)throw new Error('Las contraseñas nuevas no coinciden');
      await api('/me/password',{body:{current:d.current,password:d.password}});
      toast('Contraseña cambiada');
    }});
}
async function downloadExport(){
  var res=await api('/backup/export',{raw:true});
  var blob=await res.blob();
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='copia-veterinaria-'+todayIso()+'.json';
  document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);
  try{localStorage.setItem('vet_last_export',String(Date.now()));}catch(e){}
  render();
  toast('Copia descargada. Guardala en un lugar seguro.');
}
var COUNT_LABELS=[['patients','paciente','pacientes'],['products','producto','productos'],['cash_movements','movimiento de caja','movimientos de caja'],['appointments','turno','turnos']];
var countsText=function(c){return COUNT_LABELS.map(function(l){return plural(c[l[0]]||0,l[1],l[2]);}).join(', ');};
var countsTotal=function(c){return Object.keys(c).reduce(function(n,k){return n+(Number(c[k])||0);},0);};
// Confirmación reforzada: muestra cuántos registros hay hoy y cuántos tiene la copia. Si la copia
// está vacía lo marca bien fuerte y pide tildar que se entiende que se borra todo.
function restoreConfirm(label,copyCounts,curCounts,doRestore){
  var empty=countsTotal(copyCounts)===0;
  openForm({title:'Restaurar copia',danger:empty,submit:'Restaurar',
    body:'<p>Vas a reemplazar los datos actuales ('+esc(countsText(curCounts))+') por esta copia ('+esc(countsText(copyCounts))+').</p>'+
      '<p><small>Copia: '+esc(label)+'. Antes se guarda una copia de los datos de ahora. Los usuarios no cambian.</small></p>'+
      (empty?'<p class="warnbox"><b>⚠️ Esta copia está vacía, restaurarla borra todo</b></p><label class="fld check"><input type="checkbox" name="understand" required><span>Entiendo que se borran todos los datos actuales</span></label>':''),
    onSubmit:function(){return doRestore(empty);}});
}
async function restoreFileForm(data,label){
  var cur=(await api('/backups/current')).counts;
  var cc={};Object.keys(data).forEach(function(k){if(Array.isArray(data[k]))cc[k]=data[k].length;});
  restoreConfirm(label,cc,cur,async function(empty){
    await api('/restore',{body:{data:data,confirmEmpty:empty}});ui.sel=null;ui.detail=null;await reload();toast('Copia restaurada');
  });
}

/* ============================================================
   Acciones (botones de la pantalla)
   ============================================================ */
async function refreshView(){
  render();
  try{await loadView();}catch(e){toast(e.message);}
  render();
}
function findRec(kind,id){return ((ui.detail&&ui.detail[kind])||[]).find(function(x){return String(x.id)===String(id);});}
var actions={
  nav:function(id,b){return go(b.dataset.v);},
  filter:function(id,b){ui.filter=b.dataset.v;dropHiddenSelection();render();},
  select:function(id){ui.sel=Number(id);ui.detail=null;window.scrollTo(0,0);return refreshView();},
  back:function(){ui.sel=null;ui.detail=null;render();},
  'goto-vac':function(){ui.view='pacientes';ui.filter='alert';ui.sel=null;ui.detail=null;render();},
  'goto-stock':function(){ui.view='farmacia';ui.tab='stock';render();},
  'goto-backups':function(){return go('copias');},
  'new-patient':function(){patientForm();},
  'edit-patient':function(){if(ui.detail)patientForm(ui.detail);},
  'del-patient':function(){
    var p=ui.detail;if(!p)return;
    confirmForm('Eliminar a '+esc(p.name),'Se borra el paciente con toda su historia clínica: vacunas, diagnósticos, estudios, medicación, cobros'+(p.appointmentCount?' y '+plural(p.appointmentCount,'turno programado','turnos programados'):'')+'. Los movimientos de caja ya registrados no se borran. Va a la Papelera: lo podés restaurar durante 30 días.','Eliminar paciente',async function(){
      await api('/patients/'+p.id,{method:'DELETE'});ui.sel=null;ui.detail=null;await reload();toast('Paciente enviado a la Papelera');
    });
  },
  print:async function(){
    var p=ui.detail;if(!p)return;
    var ch=await choiceDialog('Imprimir','<p>Se abre la vista de impresión: ahí podés imprimir o elegir “Guardar como PDF”.</p>',
      [{label:'Cancelar',value:null,cls:'ghost'},{label:'Certificado de vacunación',value:'cert',cls:''},{label:'Historia clínica completa',value:'full',cls:'primary'}]);
    if(ch)printDoc(ch,p);
  },
  'att-open':async function(id,b){
    var mime=b.dataset.mime,pdf=mime==='application/pdf',w=pdf?window.open('about:blank','_blank'):null;
    var r;
    try{r=await api('/attachments/'+id+'/url');}catch(err){if(w)w.close();throw err;}
    if(isImg(mime)){
      dlg.innerHTML='<form class="dform preview"><h2>'+esc(r.name)+'</h2><img class="bigimg" src="'+esc(r.url)+'" alt="'+esc(r.name)+'"><div class="actions"><a class="btn" href="'+esc(r.url)+'" target="_blank" rel="noopener">Abrir en otra pestaña</a><button type="button" class="btn primary" data-close>Cerrar</button></div></form>';
      dlg.querySelector('[data-close]').addEventListener('click',function(){dlg.close();});
      dlg.showModal();
    }else if(pdf){
      if(w)w.location.href=r.url;else window.open(r.url,'_blank');
    }else{
      // DICOM y HEIC no se pueden mostrar en el navegador: se descargan.
      var a=document.createElement('a');a.href=r.url;a.download=r.name;document.body.appendChild(a);a.click();a.remove();
    }
  },
  'att-del':function(id){
    var a=null;((ui.detail&&ui.detail.studies)||[]).forEach(function(st){(st.attachments||[]).forEach(function(x){if(String(x.id)===String(id))a=x;});});
    if(!a)return;
    confirmForm('Quitar archivo','¿Quitar el archivo “'+esc(a.name)+'”? Se borra también del almacenamiento. Esta acción no se puede deshacer.','Quitar',async function(){
      await api('/attachments/'+id,{method:'DELETE'});await reload();toast('Archivo quitado');
    });
  },
  'add-weight':function(){if(ui.detail)weightForm(ui.detail);},
  'del-weight':function(id){
    var w=((ui.detail&&ui.detail.weights)||[]).find(function(x){return String(x.id)===String(id);});if(!w)return;
    confirmForm('Quitar peso','¿Quitar el registro de '+fmtKg(w.kg)+' del '+fmtDate(w.date)+'? Esta acción no se puede deshacer.','Quitar',async function(){
      await api('/weights/'+id,{method:'DELETE'});await reload();toast('Peso quitado');
    });
  },
  'add-vac':function(){if(ui.detail)vaccineForm(ui.detail);},
  'add-dx':function(){if(ui.detail)dxForm(ui.detail);},
  'add-study':function(){if(ui.detail)studyForm(ui.detail);}, // v2
  'add-med':function(){if(ui.detail)medForm(ui.detail);},
  charge:function(){if(ui.detail)chargeForm(ui.detail);},
  'edit-vac':function(id){var v=findRec('vaccines',id);if(v)vaccineForm(ui.detail,v);},
  'edit-dx':function(id){var d=findRec('diagnoses',id);if(d)dxForm(ui.detail,d);},
  'edit-study':function(id){var d=findRec('studies',id);if(d)studyForm(ui.detail,d);},
  'edit-med':function(id){var d=findRec('meds',id);if(d)medForm(ui.detail,d);},
  // B1: todo "Quitar" pide confirmación con el mismo diálogo que Proveedores y Turnos.
  'del-vac':function(id){
    var v=findRec('vaccines',id);if(!v)return;
    var pr=prodById(v.productId),back=pr&&v.stockQty>0?' Se devuelve '+plural(v.stockQty,'unidad','unidades')+' de '+esc(pr.name)+' al stock.':'';
    confirmForm('Eliminar vacuna','¿Eliminar la vacuna “'+esc(v.name)+'” del '+fmtDate(v.date)+'?'+back+' Va a la Papelera: la podés restaurar durante 30 días.','Eliminar',async function(){
      var r=await api('/vaccines/'+id,{method:'DELETE'});await reload();toast('Vacuna quitada'+(r.restored?' · se devolvió '+r.restored+' al stock':''));
    });
  },
  'del-dx':function(id){
    var d=findRec('diagnoses',id);if(!d)return;
    confirmForm('Eliminar diagnóstico','¿Eliminar el diagnóstico “'+esc(d.title)+'” del '+fmtDate(d.date)+'? Va a la Papelera: la podés restaurar durante 30 días.','Eliminar',async function(){
      await api('/diagnoses/'+id,{method:'DELETE'});await reload();toast('Diagnóstico quitado');
    });
  },
  'del-study':function(id){
    var d=findRec('studies',id);if(!d)return;
    confirmForm('Eliminar estudio','¿Eliminar el estudio “'+esc(d.title)+'” del '+fmtDate(d.date)+'?'+((d.attachments||[]).length?' Sus '+plural(d.attachments.length,'archivo adjunto','archivos adjuntos')+' quedan guardados con él.':'')+' Va a la Papelera: la podés restaurar durante 30 días.','Eliminar',async function(){
      await api('/studies/'+id,{method:'DELETE'});await reload();toast('Estudio quitado');
    });
  },
  'del-med':function(id){
    var m=findRec('meds',id);if(!m)return;
    var pr=prodById(m.productId),back=pr&&m.stockQty>0?' Se devuelven '+plural(m.stockQty,'unidad','unidades')+' de '+esc(pr.name)+' al stock.':'';
    confirmForm('Eliminar medicación','¿Eliminar la medicación “'+esc(m.name)+'” del '+fmtDate(m.date)+'?'+back+' Va a la Papelera: la podés restaurar durante 30 días.','Eliminar',async function(){
      var r=await api('/medications/'+id,{method:'DELETE'});await reload();toast('Medicación quitada'+(r.restored?' · se devolvieron '+r.restored+' al stock':''));
    });
  },
  'del-chg':function(id){
    confirmForm('Quitar cobro','Se quita el cobro de la historia del paciente y también el ingreso que se registró en la caja (y se devuelve el stock de los productos). Va a la Papelera: lo podés restaurar durante 30 días.','Quitar cobro',async function(){
      await api('/charges/'+id,{method:'DELETE'});await reload();toast('Cobro quitado');
    });
  },
  tab:function(id,b){ui.tab=b.dataset.v;return refreshView();},
  cat:function(id,b){ui.cat=b.dataset.v;render();},
  cashp:function(id,b){ui.cashp=b.dataset.v;ui.cfrom='';ui.cto='';return refreshView();},
  'cash-export':function(){
    if(ui.cashp==='range'&&!(ui.cfrom&&ui.cto))throw new Error('Completá las dos fechas del rango');
    return downloadFile('/cash/export?'+cashQuery(),'movimientos-'+todayIso()+'.csv');
  },
  cashf:function(id,b){ui.cashf=b.dataset.v;return refreshView();},
  cashm:function(id,b){ui.cashm=b.dataset.v;return refreshView();},
  rep:function(id,b){ui.rep=b.dataset.v;ui.rfrom='';ui.rto='';return refreshView();},
  'rep-export':function(){
    var from=ui.rfrom&&ui.rto?ui.rfrom:shiftDays(-Number(ui.rep)),to=ui.rfrom&&ui.rto?ui.rto:todayIso();
    return downloadFile('/cash/export?period=range&from='+from+'&to='+to,'movimientos-'+from+'_a_'+to+'.csv');
  },
  'new-product':function(){productForm();},
  'edit-product':function(id){productForm(S.products.find(function(x){return String(x.id)===String(id);}));},
  'del-product':function(id){
    var x=S.products.find(function(y){return String(y.id)===String(id);});if(!x)return;
    confirmForm('Eliminar '+esc(x.name),'El producto se quita del stock. Su historial de movimientos queda en los reportes.','Eliminar',async function(){
      await api('/products/'+id,{method:'DELETE'});await reload();toast('Producto eliminado');
    });
  },
  'stock-add':function(id){buyForm(S.products.find(function(x){return String(x.id)===String(id);}));},
  'stock-adjust':function(id){adjustForm(S.products.find(function(x){return String(x.id)===String(id);}));},
  'stock-history':function(id){movementsDialog(S.products.find(function(x){return String(x.id)===String(id);}));}, // v2
  sell:function(id){sellForm(S.products.find(function(x){return String(x.id)===String(id);}));},
  'new-service':function(){serviceForm();},
  'edit-service':function(id){serviceForm(S.services.find(function(x){return String(x.id)===String(id);}));},
  'del-service':function(id){
    var s=S.services.find(function(y){return String(y.id)===String(id);});if(!s)return;
    confirmForm('Eliminar '+esc(s.name),'Se quita de la lista de precios. Los cobros ya registrados no cambian.','Eliminar',async function(){
      await api('/services/'+id,{method:'DELETE'});await reload();toast('Precio eliminado');
    });
  },
  'cash-in':function(){cashForm('in');},
  'cash-out':function(){cashForm('out');},
  'del-cash':function(id){
    var c=((ui.cash&&ui.cash.items)||[]).find(function(x){return String(x.id)===String(id);});
    var d=c?c.stockDelta:0;
    var extra=d>0?' También se devuelven '+plural(d,'unidad','unidades')+' al stock.':d<0?' También se restan '+plural(-d,'unidad','unidades')+' del stock.':'';
    confirmForm('Eliminar movimiento','Se borra este movimiento de la caja.'+extra+' Esta acción no se puede deshacer.','Eliminar',async function(){
      await api('/cash/'+id,{method:'DELETE'});await reload();toast('Movimiento eliminado'+(d>0?' · stock devuelto':d<0?' · stock descontado':''));
    });
  },
  'backup-download':function(){return downloadExport();},
  'backup-now':async function(){await api('/backups',{body:{}});await reload();toast('Copia creada');},
  'pick-file':function(){var f=$('#bfile');if(f)f.click();},
  restore:async function(id){
    var b=(ui.backups||[]).find(function(x){return String(x.id)===String(id);});if(!b)return;
    var cur=(await api('/backups/current')).counts;
    restoreConfirm('“'+b.label+'” del '+fmtTs(b.createdAt),b.counts||{},cur,async function(empty){
      await api('/backups/'+id+'/restore',{body:{confirmEmpty:empty}});ui.sel=null;ui.detail=null;await reload();toast('Copia restaurada');
    });
  },
  'del-backup':function(id){
    confirmForm('Eliminar copia','Se borra esta copia guardada en el sistema.','Eliminar',async function(){
      await api('/backups/'+id,{method:'DELETE'});await reload();toast('Copia eliminada');
    });
  },
  'trash-restore':async function(id,b){
    var r=await api('/trash/'+b.dataset.kind+'/'+id+'/restore',{body:{}});
    await reload();toast(r.warning||'Restaurado',!!r.warning);
  },
  'trash-purge':function(id,b){
    var x=(ui.trash?ui.trash.items:[]).find(function(y){return y.kind===b.dataset.kind&&String(y.id)===String(id);});if(!x)return;
    confirmForm('Eliminar definitivamente','¿Eliminar definitivamente '+esc(TRASH_KIND[x.kind].toLowerCase())+' “'+esc(x.label)+'”'+(x.kind==='patient'?' con toda su historia clínica y sus turnos':'')+'? Esta acción no se puede deshacer.','Eliminar definitivamente',async function(){
      await api('/trash/'+x.kind+'/'+x.id,{method:'DELETE'});await reload();toast('Eliminado definitivamente');
    });
  },
  'trash-purge-expired':function(){
    confirmForm('Eliminar los vencidos','Se eliminan definitivamente los '+ui.trash.expiredCount+' elementos que llevan más de '+ui.trash.days+' días en la Papelera. Esta acción no se puede deshacer.','Eliminar definitivamente',async function(){
      var r=await api('/trash/purge-expired',{body:{}});await reload();toast(plural(r.purged,'elemento eliminado','elementos eliminados'));
    });
  },
  'new-user':function(){userForm();},
  'edit-user':function(id){userForm((ui.users||[]).find(function(x){return String(x.id)===String(id);}));},
  'change-pass':function(){passwordForm();},

  // v2: proveedores
  'new-supplier':function(){supplierForm();},
  'edit-supplier':function(id){supplierForm((ui.suppliers||[]).find(function(x){return String(x.id)===String(id);}));},
  'del-supplier':function(id){
    var s=(ui.suppliers||[]).find(function(x){return String(x.id)===String(id);});if(!s)return;
    var warn=[];
    if(s.productCount)warn.push(plural(s.productCount,'producto vinculado','productos vinculados'));
    if(s.purchaseCount)warn.push(plural(s.purchaseCount,'compra registrada','compras registradas'));
    var extra=warn.length?' Tiene '+warn.join(' y ')+': no se borran, quedan sin proveedor.':'';
    confirmForm('Eliminar '+esc(s.name),'Se quita este proveedor de la lista.'+extra+' Esta acción no se puede deshacer.','Eliminar',async function(){
      await api('/suppliers/'+id,{method:'DELETE'});ui.suppliers=null;await refreshView();toast('Proveedor eliminado');
    });
  },
  'supplier-view':function(id){supplierDetail(id);},

  // v2: calendario de turnos
  'new-appt':function(){appointmentForm(null, ui.cal.anchor);},
  'cal-add-day':function(id,b){appointmentForm(null,b.dataset.v);},
  'appt-view':function(id){var a=(ui.appts||[]).find(function(x){return String(x.id)===String(id);});if(a)appointmentDetails(a);},
  'cal-prev':function(){calShift(-1);return reloadCal();},
  'cal-next':function(){calShift(1);return reloadCal();},
  'cal-today':function(){ui.cal.anchor=todayIso();return reloadCal();},
  // El día del "ancla" no se toca al cambiar de vista (semana ↔ mes): así, si estabas mirando
  // el 15 y pasás a "Mes" y volvés a "Semana", seguís viendo la semana del 15, no la del día 1.
  'cal-view':function(id,b){ui.cal.view=b.dataset.v;return reloadCal();},
  'cal-day-list':function(id,b){dayListDialog(b.dataset.v);},

  logout:async function(){
    try{await api('/logout',{body:{}});}catch(e){}
    S.user=null;ui.sel=null;ui.detail=null;ui.cash=null;ui.rmonthly=null;ui.backups=null;ui.users=null;
    ui.suppliers=null;ui.appts=null;ui.cal={view:'week',anchor:todayIso()}; // v2
    main.innerHTML='';
    showLogin();
  }
};

/* ============================================================
   Eventos y arranque
   ============================================================ */
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-action]');
  if(!b||dlg.contains(b))return;
  var fn=actions[b.dataset.action];
  if(!fn)return;
  if(b.dataset.busy)return; // F10: evita el doble clic mientras responde el servidor
  b.dataset.busy='1';
  Promise.resolve().then(function(){return fn(b.dataset.id,b);}).catch(function(err){toast(err.message||'Ocurrió un error');}).then(function(){delete b.dataset.busy;});
});
document.addEventListener('input',function(e){
  if(e.target.id==='q'){
    ui.q=e.target.value;
    if(dropHiddenSelection()){var pac=$('.pac');pac.classList.remove('show-detail');pac.querySelector('.pac-detail').innerHTML=emptyPane();}
    $('#plist').innerHTML=listHTML();
  }
  if(e.target.id==='stq'||e.target.id==='cq'){var id=e.target.id;ui[id]=e.target.value;render();var el=$('#'+id);if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}}
  if(e.target.id==='sq'){ui.sq=e.target.value;$('#srows').innerHTML=supplierRows();}
});
document.addEventListener('change',function(e){
  var rid=e.target.id;
  if(rid==='cfrom'||rid==='cto'||rid==='rfrom'||rid==='rto'){
    var isCash=rid[0]==='c';
    var k=isCash?['cfrom','cto']:['rfrom','rto'];
    ui[rid]=e.target.value;
    if(ui[k[0]]&&ui[k[1]]&&ui[k[1]]<ui[k[0]]){toast('"Hasta" no puede ser anterior a "Desde"');ui[rid]='';e.target.value='';return;}
    if(ui[k[0]]&&ui[k[1]]){if(isCash)ui.cashp='range';refreshView();}
    else if(isCash&&ui.cashp==='range'&&!(ui.cfrom&&ui.cto)){ui.cashp='month';refreshView();}
    return;
  }
  if(e.target.id==='bfile'&&e.target.files&&e.target.files[0]){
    var f=e.target.files[0],r=new FileReader();
    r.onload=function(){
      try{
        var j=JSON.parse(r.result),x=j.data||j;
        if(!x||!Array.isArray(x.patients)||!Array.isArray(x.products)||!Array.isArray(x.cash_movements))throw new Error('formato');
      }catch(err){toast('El archivo no es una copia válida');return;}
      restoreFileForm(x,'el archivo '+f.name).catch(function(err){toast(err.message);});
    };
    r.readAsText(f);
    e.target.value='';
  }
});
$('#loginform').addEventListener('submit',async function(e){
  e.preventDefault();
  var err=$('#lerror'),btn=$('#lbtn');
  if(btn.disabled)return;
  err.textContent='';btn.disabled=true;btn.textContent='Entrando…';
  try{
    await api('/login',{body:{email:$('#lemail').value,password:$('#lpass').value}});
    $('#lpass').value='';
    await start();
  }catch(ex){err.textContent=ex.message;}
  btn.disabled=false;btn.textContent='Entrar';
});
$('#boot-retry').addEventListener('click',function(){
  $('#boot-retry').hidden=true;
  $('#boot-msg').textContent='Iniciando el sistema…';
  $('#boot-sub').textContent='La primera vez del día puede tardar hasta un minuto.';
  boot();
});
boot();
})();
