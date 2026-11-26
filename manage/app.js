
window.startRota=function(BOOT){
"use strict";
var TITLE="Roots Rota & Labour";
var LOGO='../logo.png';
var state=BOOT.state, stateVersion=BOOT.version, sb=BOOT.sb, me=BOOT.me;
var artifactApi=null, readOnly=false, dirty=false, viewStart=null;
var DOW=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function uid(){return Math.random().toString(36).slice(2,10);}
function num(v){var n=parseFloat(v);return isFinite(n)?n:0;}
function money(n){return '£'+n.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});}
function money0(n){return '£'+Math.round(n).toLocaleString('en-GB');}
function hm(h){var t=Math.round(h*60);return Math.floor(t/60)+'h '+(t%60)+'m';}
function parseD(s){var p=s.split('-').map(Number);return new Date(p[0],p[1]-1,p[2],12);}
function fmtD(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function addDays(s,n){var d=parseD(s);d.setDate(d.getDate()+n);return fmtD(d);}
function weekStartFor(s){var d=parseD(s);var diff=(d.getDay()-(+state.settings.weekStartDay)+7)%7;d.setDate(d.getDate()-diff);return fmtD(d);}
function weekDays(){var a=[];for(var i=0;i<7;i++)a.push(addDays(viewStart,i));return a;}
function toMin(t){var p=String(t||'0:0').split(':').map(Number);return p[0]*60+(p[1]||0);}
function shiftHours(s){if(s.type==='leave')return 0;var d=toMin(s.end)-toMin(s.start);if(d<=0)d+=1440;d-=num(s.breakMin);return Math.max(0,d)/60;}
function person(id){for(var i=0;i<state.staff.length;i++)if(state.staff[i].id===id)return state.staff[i];return null;}
function role(id){for(var i=0;i<state.roles.length;i++)if(state.roles[i].id===id)return state.roles[i];return {id:id,name:id||'—',color:'#999'};}
function openHours(dow){var h=(state.settings.hours||{})[dow];return h&&h.open&&h.close?h:null;}
function openHoursDate(d){var o=(state.settings.hoursOverride||{})[d];if(o)return o.open&&o.close?o:null;return openHours(parseD(d).getDay());}
function awayOn(p,d){var a=p&&p.away||[];for(var i=0;i<a.length;i++){if(a[i].from&&d>=a[i].from&&d<=(a[i].to||a[i].from))return a[i];}return null;}
function onCost(){return 1+num(state.settings.onCostPct)/100;}
function isWeekly(p){return !!p&&num(p.weekly)>0;}
function weekShiftCount(p,date){var ws=weekStartFor(date),we=addDays(ws,6),n=0;state.shifts.forEach(function(x){if(x.staffId===p.id&&x.type!=='leave'&&x.date>=ws&&x.date<=we)n++;});return n;}
function perShift(p,date){var n=weekShiftCount(p,date);return num(p.weekly)/(n||1);}
function payTxt(p,date){return isWeekly(p)?money(num(p.weekly))+'/wk ('+money(perShift(p,date))+'/shift)':money(num(p.rate))+'/h';}
function shiftCost(s){if(!s.staffId||s.type==='leave')return 0;var p=person(s.staffId);if(!p)return 0;if(isWeekly(p))return perShift(p,s.date)*onCost();return shiftHours(s)*num(p.rate)*onCost();}
function initials(n){return String(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(function(w){return w[0].toUpperCase();}).join('');}

/* ---------- clock in / timesheets ---------- */
var view='rota', db=null, downloadsApi=null, dbState='wait', dbSlow=false;
var TS={}, tsSubs={}, tsLoaded={}, tsOrder=[], tsTimer=null, writeChains={}, pendingRender=false;
var KIOSK_KEY='roots-kiosk';
var pinFails=0, pinLockUntil=0, kioskIdleT=null;

function ensureClock(){var c=state.settings.clock||{};
  state.settings.clock={payFromShiftStart:c.payFromShiftStart!==false,capAtShiftEnd:!!c.capAtShiftEnd,useRotaBreak:c.useRotaBreak!==false,
    lateGrace:c.lateGrace==null||c.lateGrace===''?5:num(c.lateGrace),managerPin:c.managerPin||'',startDate:c.startDate||''};}
function clk(){if(!state.settings.clock)ensureClock();return state.settings.clock;}
function todayS(){return fmtD(new Date());}
function mondayKey(s){var d=parseD(s);return addDays(s,-((d.getDay()+6)%7));}
function dtOf(date,t){var p=date.split('-').map(Number),q=String(t||'0:0').split(':').map(Number);return new Date(p[0],p[1]-1,p[2],q[0],q[1]||0,0,0);}
function tOf(iso){if(!iso)return '';var d=new Date(iso);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function minsTxt(m){m=Math.round(m);return m>=60?Math.floor(m/60)+'h '+(m%60?m%60+'m':''):m+'m';}
function newPin(except){var used={};state.staff.forEach(function(p){if(p.pin)used[p.pin]=1;});if(except)used[except]=0;var bad={'0000':1,'1234':1,'1111':1,'4321':1};
  for(var i=0;i<500;i++){var c=String(Math.floor(1000+Math.random()*9000));if(!used[c]&&!bad[c])return c;}return String(Math.floor(1000+Math.random()*9000));}

/* subscriptions: one store document per Monday-starting week: timesheets/YYYY-MM-DD */
function neededWeeks(){var t=todayS(),k=[mondayKey(t)];
  if(view!=='clock'){for(var i=0;i<7;i++){var m=mondayKey(addDays(viewStart,i));if(k.indexOf(m)<0)k.push(m);}}
  return k;}
function syncWatch(){
  if(!db)return;var keys=neededWeeks();
  keys.forEach(function(k){var i=tsOrder.indexOf(k);if(i>-1)tsOrder.splice(i,1);tsOrder.push(k);});
  while(tsOrder.length>10){var old=tsOrder[0];if(keys.indexOf(old)>-1)break;tsOrder.shift();if(tsSubs[old]){tsSubs[old]();delete tsSubs[old];}delete TS[old];delete tsLoaded[old];}
  var added=false;
  keys.forEach(function(k){if(tsSubs[k])return;added=true;
    try{tsSubs[k]=db.doc('timesheets/'+k).onSnapshot(function(snap){
        var d=snap.exists?snap.data():null;TS[k]=(d&&d.entries)||{};
        if(!snap.metadata||!snap.metadata.fromCache){tsLoaded[k]=true;dbSlow=false;}
        dbState='ok';scheduleRender();},
      function(err){delete tsSubs[k];tsLoaded[k]=true;var c=err&&err.code;dbState=(c==='revoked'||c==='not_granted'||c==='capability_disabled'||c==='capability_removed')?'off':'err';scheduleRender();});
    }catch(e){dbState='err';}
  });
  if(added){clearTimeout(tsTimer);tsTimer=setTimeout(function(){if(neededWeeks().some(function(k){return !tsLoaded[k];})){dbSlow=true;scheduleRender();}},10000);}
}
function scheduleRender(){if(pendingRender)return;pendingRender=true;
  (window.requestAnimationFrame||setTimeout)(function(){pendingRender=false;
    var a=document.activeElement;if(a&&a.closest&&a.closest('#root')&&/INPUT|SELECT|TEXTAREA/.test(a.tagName)){a.addEventListener('blur',function(){scheduleRender();},{once:true});return;}
    render();});}
function weekReady(date){return !!tsLoaded[mondayKey(date)];}

function allEntries(){var out=[];Object.keys(TS).forEach(function(k){var m=TS[k]||{};Object.keys(m).forEach(function(id){var e=m[id];if(e&&e.staffId&&!e.deleted&&mondayKey(e.date)===k)out.push(e);});});return out;}
function entriesOn(date,staffId){return allEntries().filter(function(e){return e.date===date&&(staffId===undefined||e.staffId===staffId);}).sort(function(a,b){return a.inAt<b.inAt?-1:1;});}
function openEntry(staffId){var t=todayS();return allEntries().filter(function(e){return e.staffId===staffId&&!e.outAt&&e.date===t;})[0]||null;}
function workShifts(date,staffId){return shiftsOn(date,staffId).filter(function(s){return s.type!=='leave';});}
function shiftTimes(sh){var a=dtOf(sh.date,sh.start),b=dtOf(sh.date,sh.end);if(b<=a)b=new Date(b.getTime()+864e5);return [a,b];}
function closestShift(list,t){var best=null,bd=Infinity;list.forEach(function(s){var d=Math.abs(shiftTimes(s)[0]-t);if(d<bd){bd=d;best=s;}});return best;}
function matchShift(e){var list=workShifts(e.date,e.staffId);if(!list.length)return null;
  if(e.shiftId)for(var i=0;i<list.length;i++)if(list[i].id===e.shiftId)return list[i];
  return closestShift(list,new Date(e.inAt));}

function entryCalc(e){
  function mf(x){return new Date(Math.floor(new Date(x).getTime()/6e4)*6e4);}
  var C=clk(),now=mf(Date.now()),sh=matchShift(e),inT=mf(e.inAt),outT=e.outAt?mf(e.outAt):null,today=todayS();
  var live=!outT&&e.date===today,endT=outT||(live?now:inT);
  var s1=inT,s2=endT,ss=null,se=null;
  if(sh){var tt=shiftTimes(sh);ss=tt[0];se=tt[1];if(C.payFromShiftStart&&s1<ss)s1=ss;if(C.capAtShiftEnd&&outT&&s2>se)s2=se;}
  var brk=0,onBreak=false,src='clocked';
  (e.breaks||[]).forEach(function(b){if(!b||!b.s)return;var bs=mf(b.s),be=b.e?mf(b.e):(outT||now);if(!b.e&&!outT)onBreak=true;brk+=Math.max(0,(be-bs)/6e4);});
  if(e.breakMin!=null&&e.breakMin!==''){brk=num(e.breakMin);src='set';}
  else if(brk<1&&C.useRotaBreak&&sh&&num(sh.breakMin)&&outT){brk=num(sh.breakMin);src='rota';}
  var mins=Math.max(0,(s2-s1)/6e4-brk),p=person(e.staffId),hours=mins/60;
  var flags=[],g=num(C.lateGrace)*6e4;
  if(!sh)flags.push('Not on rota');
  else{if(inT-ss>g)flags.push('Late '+minsTxt((inT-ss)/6e4));
    if(outT&&se-outT>g)flags.push('Left '+minsTxt((se-outT)/6e4)+' early');}
  if(!outT&&!live)flags.push('No clock-out');
  return {shift:sh,hours:hours,cost:p?(isWeekly(p)?(hours>0?perShift(p,e.date)*onCost():0):hours*num(p.rate)*onCost()):0,breakMin:brk,breakSrc:src,onBreak:onBreak,live:live,missingOut:!outT&&!live,flags:flags};
}
function staffStatus(staffId){var o=openEntry(staffId);if(o){var c=entryCalc(o);return {st:c.onBreak?'break':'in',e:o};}
  var done=entriesOn(todayS(),staffId).filter(function(e){return e.outAt;});return done.length?{st:'done',e:done[done.length-1]}:{st:'out',e:null};}
function dayWorked(date){var h=0,c=0,n=0;entriesOn(date).forEach(function(e){var x=entryCalc(e);h+=x.hours;c+=x.cost;n++;});return {hours:h,cost:c,count:n};}
function missedShifts(date,staffId){if(clk().startDate&&date<clk().startDate)return [];var now=new Date(),g=Math.max(15,num(clk().lateGrace))*6e4,ents=entriesOn(date,staffId);
  return workShifts(date,staffId).filter(function(s){var st=shiftTimes(s)[0];if(now-st<g)return false;
    return !ents.some(function(e){return matchShift(e)===s;});});}

/* writes: grouped per week document, one at a time per document */
function putEntries(list){
  if(!db)return Promise.reject({code:'off'});
  var groups={};list.forEach(function(e){var k=mondayKey(e.date);(groups[k]=groups[k]||{})[e.id]=e;});
  return Promise.all(Object.keys(groups).map(function(k){
    var ref=db.doc('timesheets/'+k),obj=groups[k];
    function attempt(){return ref.get().then(function(s){var stamp=new Date().toISOString();
      if(s.exists)return ref.update({entries:obj,updatedAt:stamp});
      return ref.set({week:k,entries:obj,updatedAt:stamp});});}
    var p=(writeChains[k]||Promise.resolve()).catch(function(){}).then(function(){
      return attempt().catch(function(err){if(err&&err.code==='unavailable')return new Promise(function(r){setTimeout(r,600+Math.random()*900);}).then(attempt);throw err;});});
    writeChains[k]=p;return p;}));
}
function clone(o){return JSON.parse(JSON.stringify(o));}
function writeErr(err){var c=err&&err.code;
  if(c==='off')return 'Timesheets aren’t connected on this device';
  if(c==='invalid_argument')return 'This account can view timesheets but not change them';
  if(c==='quota_exceeded')return 'Timesheet storage is full';
  return 'Couldn’t save – check the connection and try again';}

/* ---------- timesheet storage (Supabase rota_clock, one row per entry) ---------- */
function makeDb(sb){
  var subs={};
  function fetchWeek(week){return sb.from('rota_clock').select('id,data').eq('week',week).then(function(res){
    if(res.error)throw {code:(res.error.status===401||res.error.status===403)?'not_granted':'unavailable',message:res.error.message};
    var entries={};(res.data||[]).forEach(function(r){entries[r.id]=r.data;});return entries;});}
  function snapOf(entries){var has=Object.keys(entries).length>0;return {exists:has,data:function(){return {entries:entries};},metadata:{fromCache:false}};}
  function poke(week){(subs[week]||[]).forEach(function(s){s.load();});}
  function write(week,obj){var rows=Object.keys(obj).map(function(id){return {id:id,week:week,data:obj[id],updated_at:new Date().toISOString()};});
    if(!rows.length)return Promise.resolve();
    return sb.from('rota_clock').upsert(rows).then(function(res){if(res.error)throw {code:'unavailable',message:res.error.message};poke(week);});}
  return {doc:function(path){var week=path.split('/')[1];
    return {
      get:function(){return fetchWeek(week).then(snapOf);},
      set:function(o){return write(week,o.entries||{});},
      update:function(o){return write(week,o.entries||{});},
      onSnapshot:function(cb,errCb){var alive=true,t=null;
        var sub={load:function(){if(!alive)return;clearTimeout(t);fetchWeek(week).then(function(e){if(alive)cb(snapOf(e));}).catch(function(err){if(alive&&errCb&&err.code==='not_granted')errCb(err);}).then(function(){if(alive)t=setTimeout(sub.load,document.hidden?60000:15000);});}};
        (subs[week]=subs[week]||[]).push(sub);sub.load();
        return function(){alive=false;clearTimeout(t);subs[week]=(subs[week]||[]).filter(function(x){return x!==sub;});};}
    };}};
}

/* ---------- shared header ---------- */
function headerHtml(){
  return '<header class="top"><div class="brand"><img src="'+LOGO+'" alt="'+esc(state.settings.venue||"Roots")+'"><span class="sub">Rota &amp; Labour</span></div>'+
    '<nav class="tabs"><button data-act="view-rota" class="'+(view==='rota'?'on':'')+'">Rota</button><button data-act="view-times" class="'+(view==='times'?'on':'')+'">Timesheets</button><button data-act="view-staff" class="'+(view==='staff'?'on':'')+'">Staff</button><button data-act="view-clock">Clock-in screen ↗</button></nav>'+
    '<div class="spacer"></div><span id="status" class="status"></span>'+
    '<button id="savebtn" class="btn primary" data-act="save">Save changes</button>'+
    '<details class="menu acct"><summary class="btn">'+esc(me.name||'Account')+' ▾</summary><div class="pop"><button data-act="signout">Sign out<span class="sub">'+esc(me.email||'')+'</span></button></div></details></header>';
}
function rangeTxt(days){var a=parseD(days[0]),b=parseD(days[6]);return a.getDate()+(a.getMonth()!==b.getMonth()?' '+MON[a.getMonth()]:'')+' – '+b.getDate()+' '+MON[b.getMonth()]+' '+b.getFullYear();}
function dbNotice(){
  if(dbState==='off')return '<div class="notice bad">Timesheets aren’t available with this login. Clock-ins can’t be saved or shown.</div>';
  if(dbState==='err')return '<div class="notice bad">Lost the connection to timesheets. Reload the page to reconnect.</div>';
  if(dbSlow)return '<div class="notice">Still connecting to timesheets… figures may be out of date.</div>';
  return '';
}

/* ---------- timesheets view ---------- */
function renderTimes(){
  var days=weekDays(),today=todayS(),T=num(state.settings.targetPct);
  function tcls(d){return d===today?' today':'';}
  function varBadge(v){if(v==null)return '';var over=v>0.005;return '<span class="var '+(over?'over':'under')+'">'+(over?'↑ +':'↓ −')+money(Math.abs(v))+'</span>';}
  var wk=days.map(dayWorked),rs=days.map(dayStats);
  var tot={wh:0,wc:0,rh:0,rc:0,used:0,usedCost:0};
  days.forEach(function(d,i){tot.wh+=wk[i].hours;tot.wc+=wk[i].cost;tot.rh+=rs[i].hours;tot.rc+=rs[i].cost;if(rs[i].used>0&&wk[i].count){tot.used+=rs[i].used;tot.usedCost+=wk[i].cost;}});
  var ready=days.every(weekReady);
  var weekEntries=allEntries().filter(function(e){return days.indexOf(e.date)>-1;});
  var toApprove=weekEntries.filter(function(e){return e.outAt&&!e.approved;}).length;
  var issues=0;
  var h=headerHtml();
  h+='<div class="toolbar"><div class="weeknav"><button data-act="prev" title="Previous week">‹</button><div class="range">'+rangeTxt(days)+'</div><button data-act="next" title="Next week">›</button></div>'+
    '<button class="btn" data-act="today">This week</button><div class="spacer"></div>'+
    '<button class="btn" data-act="tadd" data-date="'+(days.indexOf(today)>-1?today:days[0])+'" data-staff="">+ Add time</button>'+
    '<button class="btn" data-act="approveweek"'+(toApprove?'':' disabled')+'>✓ Approve week'+(toApprove?' ('+toApprove+')':'')+'</button>'+
    '<button class="btn" data-act="exportcsv">Export CSV</button>'+
    '<button class="btn" data-act="clocksettings">⚙ PINs &amp; clock rules</button></div>';
  h+=dbNotice();
  var ins=state.staff.map(function(p){var s=staffStatus(p.id);return s.st==='in'||s.st==='break'?{p:p,s:s}:null;}).filter(Boolean);
  h+='<div class="whosin"><b>In now</b>'+(ins.length?ins.map(function(x){return '<span class="chip '+x.s.st+'">'+esc(x.p.name)+' · '+(x.s.st==='break'?'on break':'since '+tOf(x.s.e.inAt))+'</span>';}).join(''):'<span class="muted">Nobody is clocked in</span>')+'</div>';
  h+='<div class="gridwrap"><div class="grid">';
  h+='<div class="c first headcell"><span class="big">Timesheets</span><div class="lbl" style="margin-top:4px">Target labour '+T+'%</div></div>';
  days.forEach(function(d){var dt=parseD(d);h+='<div class="c headcell'+tcls(d)+'"><div class="dayhead"><b>'+dt.getDate()+'</b>'+DOW[dt.getDay()]+'</div></div>';});
  var wPct=tot.used>0?tot.usedCost/tot.used*100:null;
  h+='<div class="c first"><div class="lbl">Actual labour % (worked)</div><div class="row-l"><span class="big">'+(wPct==null?'–':wPct.toFixed(2)+'%')+'</span>'+varBadge(wPct==null?null:tot.usedCost-tot.used*T/100)+'</div><div class="used">Days with clock-ins and takings</div></div>';
  days.forEach(function(d,i){var r=rs[i],w=wk[i];var pct=r.used>0&&w.count?w.cost/r.used*100:null;
    h+='<div class="c'+tcls(d)+'"><div class="row-l"><span class="big">'+(pct==null?'–':pct.toFixed(2)+'%')+'</span>'+varBadge(pct==null?null:w.cost-r.used*T/100)+'</div>'+
      (r.used>0?'<div class="used">'+money(r.used)+' '+(r.usedActual?'actual':'forecast')+' takings</div>':'<div class="used">No takings entered</div>')+'</div>';});
  h+='<div class="c first hc"><div class="lbl">Worked hours / cost</div><span class="big">'+hm(tot.wh)+'</span><span class="big">'+money(tot.wc)+'</span></div>';
  days.forEach(function(d,i){h+='<div class="c hc'+tcls(d)+'"><span class="big">'+hm(wk[i].hours)+'</span><span class="big">'+money(wk[i].cost)+'</span></div>';});
  h+='<div class="c first hc muted2"><div class="lbl">Rota hours / cost</div><span>'+hm(tot.rh)+' · '+money(tot.rc)+'</span><div class="used">'+(tot.wh-tot.rh>=0?'+':'−')+hm(Math.abs(tot.wh-tot.rh))+' vs rota</div></div>';
  days.forEach(function(d,i){var df=wk[i].hours-rs[i].hours;h+='<div class="c hc muted2'+tcls(d)+'"><span>'+hm(rs[i].hours)+' · '+money(rs[i].cost)+'</span>'+(wk[i].count?'<div class="used">'+(df>=0?'+':'−')+hm(Math.abs(df))+' vs rota</div>':'')+'</div>';});
  state.staff.forEach(function(p){
    var wh=0,wc=0,rh=0,n=0,flagged=0;
    days.forEach(function(d){entriesOn(d,p.id).forEach(function(e){var x=entryCalc(e);wh+=x.hours;wc+=x.cost;n++;if(x.flags.length)flagged++;});workShifts(d,p.id).forEach(function(s){rh+=shiftHours(s);});flagged+=ready?missedShifts(d,p.id).length:0;});
    issues+=flagged;
    h+='<div class="c first"><div class="staffcell"><div class="av" style="box-shadow:inset 0 0 0 2px '+esc(role(p.role).color)+'">'+esc(initials(p.name))+'</div><div>'+
      '<div class="big" style="font-size:15px">'+esc(p.name)+'</div>'+
      '<div class="smeta"><b>'+hm(wh)+'</b> worked of '+hm(rh)+' rota’d</div>'+
      '<div class="smeta">'+money(wc)+' · '+payTxt(p,days[0])+'</div>'+
      (flagged?'<div class="smeta warn">⚠ '+flagged+' to check</div>':'')+'</div></div></div>';
    days.forEach(function(d){h+=tsCellHtml(d,p,ready);});
  });
  h+='</div></div>';
  h+='<div class="legend"><span><i style="background:#1f7a3f"></i>Approved</span><span><i style="background:#c0362c"></i>Needs checking</span><span><i style="background:#3b82f6"></i>Clocked in now</span>'+
    '<span>Paid time '+(clk().payFromShiftStart?'starts at the rota start time if someone clocks in early':'starts when someone clocks in')+(clk().capAtShiftEnd?' and stops at the rota finish time':'')+'. Late after '+num(clk().lateGrace)+' min. Click any day to add or fix a time.</span></div>';
  document.getElementById('root').innerHTML=h;
  setStatus();
}
function tsCellHtml(d,p,ready){
  var ents=entriesOn(d,p.id),shifts=workShifts(d,p.id),miss=ready?missedShifts(d,p.id):[];
  var leave=shiftsOn(d,p.id).some(function(s){return s.type==='leave';});
  var h='<div class="c daycell tcell'+(d===todayS()?' today':'')+'" data-act="tadd" data-date="'+d+'" data-staff="'+p.id+'">';
  shifts.forEach(function(s){h+='<div class="rotaline">Rota '+esc(s.start)+'–'+esc(s.end)+'</div>';});
  if(leave&&!shifts.length)h+='<div class="rotaline">✈ Leave</div>';
  ents.forEach(function(e){var x=entryCalc(e);var cls=x.live?'live':(x.flags.length?'warn':(e.approved?'ok':''));
    h+='<div class="card tcard '+cls+'" data-act="tedit" data-id="'+esc(e.id)+'" data-date="'+esc(e.date)+'">'+
      '<div class="t">'+tOf(e.inAt)+' – '+(e.outAt?tOf(e.outAt):(x.live?(x.onBreak?'on break':'in now'):'??'))+(e.approved?' <span class="tick">✓</span>':'')+'</div>'+
      '<div class="r">'+hm(x.hours)+' paid'+(x.breakMin>=1?' · '+minsTxt(x.breakMin)+' break'+(x.breakSrc==='rota'?' (rota)':''):'')+(e.edited?' · edited':'')+'</div>'+
      (x.flags.length?'<div class="w">⚠ '+esc(x.flags.join(', '))+'</div>':'')+'</div>';});
  miss.forEach(function(s){h+='<div class="card tcard warn miss" data-act="tadd" data-date="'+d+'" data-staff="'+p.id+'" data-shift="'+esc(s.id)+'"><div class="w">⚠ Didn’t clock in</div><div class="r">Rota’d '+esc(s.start)+'–'+esc(s.end)+' · add time</div></div>';});
  if(!readOnly)h+='<span class="plus">+</span>';
  return h+'</div>';
}

function findEntry(id,date){var m=TS[mondayKey(date)]||{};var e=m[id];return e&&!e.deleted?e:null;}
function entryModal(existing,defaults){
  var isNew=!existing,e=existing?clone(existing):null;
  var staffId=e?e.staffId:(defaults.staffId||(state.staff[0]||{}).id),date=e?e.date:defaults.date;
  var sh=defaults&&defaults.shiftId?state.shifts.filter(function(s){return s.id===defaults.shiftId;})[0]:null;
  if(!sh&&isNew)sh=workShifts(date,staffId)[0]||null;
  var inV=e?tOf(e.inAt):(sh?sh.start:''),outV=e?tOf(e.outAt):(sh?sh.end:'');
  var x=e?entryCalc(e):null;
  var staffOpts=state.staff.map(function(p){return '<option value="'+p.id+'"'+(p.id===staffId?' selected':'')+'>'+esc(p.name)+'</option>';}).join('');
  var orig='';if(e){var oi=e.origIn||e.inAt,oo=e.origOut!==undefined?e.origOut:e.outAt;orig=e.src==='manager'&&!e.origIn?'Added by a manager':'Clocked on the screen: '+tOf(oi)+' – '+(oo?tOf(oo):'no clock-out')+((e.breaks||[]).length?' · '+(e.breaks||[]).length+' break'+((e.breaks||[]).length>1?'s':''):'');}
  openModal('<h3>'+(isNew?'Add time':'Edit time')+'</h3>'+
    (orig?'<div class="hint" style="margin:0 0 12px">'+esc(orig)+'</div>':'<div class="hint" style="margin:0 0 12px">For someone who forgot to clock in, or worked without the screen.</div>')+
    '<div class="f2"><div class="f"><label>Staff</label><select name="staffId">'+staffOpts+'</select></div><div class="f"><label>Date</label><input type="date" name="date" value="'+esc(date)+'"></div></div>'+
    '<div class="f2"><div class="f"><label>Clocked in</label><input type="time" name="in" value="'+esc(inV)+'"></div><div class="f"><label>Clocked out</label><input type="time" name="out" value="'+esc(outV)+'"></div></div>'+
    '<div class="f"><label>Unpaid break (mins)</label><input type="number" min="0" step="5" name="breakMin" value="'+(e&&e.breakMin!=null&&e.breakMin!==''?esc(e.breakMin):'')+'" placeholder="'+(x?'blank = '+(x.breakSrc==='set'?'clocked breaks':(x.breakSrc==='rota'?'rota break ('+Math.round(x.breakMin)+'m)':'clocked breaks ('+Math.round(x.breakMin)+'m)')):'blank = rota break')+'"></div>'+
    '<div class="f"><label>Note</label><input name="note" value="'+esc(e&&e.note||'')+'" placeholder="e.g. stayed late for a delivery"></div>'+
    '<label class="chk"><input type="checkbox" name="approved"'+(e&&e.approved?' checked':'')+'> Approved</label>'+
    '<div class="hint" id="tcalc"></div>'+
    '<div class="acts">'+(isNew?'':'<button class="btn danger left" data-m="del">Delete</button>')+'<button class="btn" data-m="rota">Use rota times</button><button class="btn" data-m="cancel">Cancel</button><button class="btn primary" data-m="ok">'+(isNew?'Add':'Save')+'</button></div>',
  function(b){
    function val(n){return b.querySelector('[name='+n+']').value;}
    function build(){var d=val('date'),i=val('in'),o=val('out');if(!d||!i)return null;
      var n=e?clone(e):{id:uid()+uid(),breaks:[],shiftId:'',src:'manager'};
      if(e&&!e.edited&&e.src!=='manager'){n.origIn=e.inAt;n.origOut=e.outAt||null;}
      n.staffId=val('staffId');n.date=d;var a=dtOf(d,i);n.inAt=a.toISOString();
      if(o){var z=dtOf(d,o);if(z<=a)z=new Date(z.getTime()+864e5);n.outAt=z.toISOString();(n.breaks||[]).forEach(function(bk){if(!bk.e)bk.e=n.outAt;});}else n.outAt=null;
      var bm=val('breakMin');n.breakMin=bm===''?null:num(bm);n.note=val('note');n.approved=b.querySelector('[name=approved]').checked;
      if(!e||e.staffId!==n.staffId||e.date!==n.date)n.shiftId='';
      n.edited=!isNew;n.editedAt=new Date().toISOString();return n;}
    function upd(){var n=build(),el=b.querySelector('#tcalc');if(!n){el.textContent='';return;}var c=entryCalc(n);
      el.textContent=hm(c.hours)+' paid · '+money(c.cost)+(c.shift?' · rota '+c.shift.start+'–'+c.shift.end:' · not on the rota')+(c.flags.length?' · '+c.flags.join(', '):'');}
    b.addEventListener('input',upd);b.addEventListener('change',upd);upd();
    b.querySelector('[data-m=cancel]').onclick=closeModal;
    b.querySelector('[data-m=rota]').onclick=function(){var s=workShifts(val('date'),val('staffId'))[0];if(!s){toast('No rota shift that day');return;}
      b.querySelector('[name=in]').value=s.start;b.querySelector('[name=out]').value=s.end;upd();};
    b.querySelector('[data-m=ok]').onclick=function(){var n=build();if(!n){toast('Add a date and clock-in time');return;}
      var list=[n];if(e&&mondayKey(e.date)!==mondayKey(n.date)){var gone=clone(e);gone.deleted=true;list.push(gone);}
      var btn=this;btn.disabled=true;btn.textContent='Saving…';
      putEntries(list).then(function(){closeModal();toast(isNew?'Time added':'Time updated');}).catch(function(err){btn.disabled=false;btn.textContent='Save';toast(writeErr(err));});};
    var del=b.querySelector('[data-m=del]');if(del)del.onclick=function(){confirmBox('Delete this time?','It will no longer count towards hours or pay.','Delete',function(){var gone=clone(e);gone.deleted=true;
      putEntries([gone]).then(function(){toast('Time deleted');}).catch(function(err){toast(writeErr(err));});});};
  });
}

function approveWeek(){var days=weekDays();var list=allEntries().filter(function(e){return days.indexOf(e.date)>-1&&e.outAt&&!e.approved;});
  if(!list.length){toast('Nothing to approve');return;}
  var flagged=list.filter(function(e){return entryCalc(e).flags.length;}).length;
  confirmBox('Approve '+list.length+' time'+(list.length===1?'':'s')+'?',(flagged?flagged+' of them have a warning (late, not on the rota and so on). ':'')+'Approved times show a green tick. Anyone still clocked in, or missing a clock-out, is left for you to fix.','Approve',function(){
    putEntries(list.map(function(e){var n=clone(e);n.approved=true;return n;})).then(function(){toast('Week approved');}).catch(function(err){toast(writeErr(err));});});}

function csvCell(v){v=String(v==null?'':v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
function exportCsv(){var days=weekDays();
  var rows=[['Staff','Date','Day','Rota start','Rota finish','Clocked in','Clocked out','Unpaid break (mins)','Paid hours','Hourly rate','Pay','Warnings','Approved','Edited','Note']];
  var totals={};
  days.forEach(function(d){state.staff.forEach(function(p){entriesOn(d,p.id).forEach(function(e){var x=entryCalc(e);
    rows.push([p.name,d,DOW[parseD(d).getDay()],x.shift?x.shift.start:'',x.shift?x.shift.end:'',tOf(e.inAt),tOf(e.outAt),Math.round(x.breakMin),x.hours.toFixed(2),(isWeekly(p)?perShift(p,d):num(p.rate)).toFixed(2),x.cost.toFixed(2),x.flags.join('; '),e.approved?'Yes':'No',e.edited?'Yes':'No',e.note||'']);
    var t=totals[p.id]=totals[p.id]||{h:0,c:0};t.h+=x.hours;t.c+=x.cost;});
    missedShifts(d,p.id).forEach(function(s){rows.push([p.name,d,DOW[parseD(d).getDay()],s.start,s.end,'','',0,'0.00',(isWeekly(p)?perShift(p,d):num(p.rate)).toFixed(2),'0.00','Didn’t clock in','No','No','']);});});});
  rows.push([]);rows.push(['Weekly totals','','','','','','','','Paid hours','','Pay','Rota hours']);
  state.staff.forEach(function(p){var t=totals[p.id]||{h:0,c:0},rh=0;days.forEach(function(d){workShifts(d,p.id).forEach(function(s){rh+=shiftHours(s);});});
    if(t.h||rh)rows.push([p.name,'','','','','','','',t.h.toFixed(2),'',t.c.toFixed(2),rh.toFixed(2)]);});
  var csv=rows.map(function(r){return r.map(csvCell).join(',');}).join('\r\n');
  var name="Roots-timesheets-"+days[0]+".csv";
  if(downloadsApi){downloadsApi.save({filename:name,data:csv}).then(function(){toast('Timesheet exported');}).catch(function(err){if(err&&err.code==='declined')return;showCsv(csv);});}
  else showCsv(csv);
}
function showCsv(csv){openModal('<h3>Timesheet CSV</h3><div class="hint" style="margin:0 0 10px">Copy this and paste it into Excel or Google Sheets.</div><textarea class="csvbox" readonly>'+esc(csv)+'</textarea><div class="acts"><button class="btn" data-m="copy">Copy</button><button class="btn primary" data-m="cancel">Done</button></div>',
  function(b){b.querySelector('[data-m=cancel]').onclick=closeModal;b.querySelector('[data-m=copy]').onclick=function(){var t=b.querySelector('textarea');t.select();
    try{(navigator.clipboard?navigator.clipboard.writeText(t.value):Promise.reject()).then(function(){toast('Copied');},function(){document.execCommand('copy');toast('Copied');});}catch(_){toast('Select the text and copy it');}};});}

function clockSettingsModal(){
  if(readOnly){toast('You can view this page but not change it');return;}
  var C=clk(),pins={};state.staff.forEach(function(p){pins[p.id]=p.pin||'';});
  function pinRows(){return state.staff.map(function(p){return '<div class="rolerow"><span style="flex:1">'+esc(p.name)+'</span><input class="pinin" inputmode="numeric" maxlength="4" data-pin="'+p.id+'" value="'+esc(pins[p.id])+'"><button class="btn ghost" data-new="'+p.id+'" title="New random PIN">↻</button></div>';}).join('');}
  openModal('<h3>Clock-in rules &amp; PINs</h3>'+
    '<div class="f2"><div class="f"><label>Manager PIN (to leave the clock-in screen)</label><input class="pinin" inputmode="numeric" maxlength="6" name="managerPin" value="'+esc(C.managerPin)+'" placeholder="not set"></div>'+
    '<div class="f"><label>Count as late after (mins)</label><input type="number" min="0" step="1" name="lateGrace" value="'+esc(C.lateGrace)+'"></div></div>'+
    '<div class="f"><label>Flag missed clock-ins from</label><input type="date" name="startDate" value="'+esc(C.startDate)+'"></div>'+
    '<label class="chk"><input type="checkbox" name="payFromShiftStart"'+(C.payFromShiftStart?' checked':'')+'> Don’t pay before the rota start time (clocking in early)</label>'+
    '<label class="chk"><input type="checkbox" name="capAtShiftEnd"'+(C.capAtShiftEnd?' checked':'')+'> Don’t pay after the rota finish time (you add overtime by editing)</label>'+
    '<label class="chk"><input type="checkbox" name="useRotaBreak"'+(C.useRotaBreak?' checked':'')+'> If no break is clocked, take off the rota’d unpaid break</label>'+
    '<div class="f" style="margin-top:12px"><label>Staff PINs (4 digits, each different)</label><div id="pins">'+pinRows()+'</div></div>'+
    '<div class="hint">Changes are saved straight away so the clock-in screen picks them up.</div>'+
    '<div class="acts"><button class="btn" data-m="cancel">Cancel</button><button class="btn primary" data-m="ok">Save</button></div>',
  function(b){
    var box=b.querySelector('#pins');
    box.addEventListener('input',function(e){var id=e.target.dataset.pin;if(id){e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);pins[id]=e.target.value;}});
    box.addEventListener('click',function(e){var n=e.target.closest('[data-new]');if(!n)return;var id=n.dataset.new;var used={};Object.keys(pins).forEach(function(k){if(k!==id&&pins[k])used[pins[k]]=1;});
      var c;do{c=String(Math.floor(1000+Math.random()*9000));}while(used[c]);pins[id]=c;box.querySelector('[data-pin="'+id+'"]').value=c;});
    b.querySelector('[data-m=cancel]').onclick=closeModal;
    b.querySelector('[data-m=ok]').onclick=function(){
      var seen={},bad='';state.staff.forEach(function(p){var v=pins[p.id];if(!/^\d{4}$/.test(v))bad=bad||p.name+'’s PIN must be 4 digits';else if(seen[v])bad=bad||p.name+' and '+seen[v]+' have the same PIN';else seen[v]=p.name;});
      var mp=b.querySelector('[name=managerPin]').value.replace(/\D/g,'');if(mp&&mp.length<4)bad=bad||'Manager PIN must be at least 4 digits';
      if(mp&&seen[mp])bad=bad||'Manager PIN is the same as '+seen[mp]+'’s';
      if(bad){toast(bad);return;}
      state.staff.forEach(function(p){p.pin=pins[p.id];});
      C.managerPin=mp;C.lateGrace=num(b.querySelector('[name=lateGrace]').value);C.startDate=b.querySelector('[name=startDate]').value;
      C.payFromShiftStart=b.querySelector('[name=payFromShiftStart]').checked;C.capAtShiftEnd=b.querySelector('[name=capAtShiftEnd]').checked;C.useRotaBreak=b.querySelector('[name=useRotaBreak]').checked;
      closeModal();markDirty();render();save();};
  });
}

/* ---------- clock-in screen (kiosk) ---------- */
function renderKiosk(){
  var t=todayS(),ready=weekReady(t)&&dbState==='ok';
  var on=[],others=[];
  state.staff.forEach(function(p){var s=workShifts(t,p.id);if(s.length||staffStatus(p.id).st!=='out')on.push({p:p,s:s});else others.push({p:p,s:s});});
  on.sort(function(a,b){var x=a.s[0]?toMin(a.s[0].start):9999,y=b.s[0]?toMin(b.s[0].start):9999;return x-y||a.p.name.localeCompare(b.p.name);});
  others.sort(function(a,b){return a.p.name.localeCompare(b.p.name);});
  function tile(o){var st=staffStatus(o.p.id),pill='';
    if(st.st==='in')pill='In since '+tOf(st.e.inAt);else if(st.st==='break')pill='On break';else if(st.st==='done')pill='Clocked out '+tOf(st.e.outAt);
    return '<button class="ktile st-'+st.st+'" data-act="ktile" data-id="'+o.p.id+'"'+(ready?'':' disabled')+'><span class="kav">'+esc(initials(o.p.name))+'</span><span class="kn">'+esc(o.p.name)+'</span>'+
      '<span class="ks">'+(o.s.length?o.s.map(function(s){return esc(s.start)+'–'+esc(s.end);}).join(', '):'&nbsp;')+'</span>'+(pill?'<span class="kpill">'+pill+'</span>':'')+'</button>';}
  var now=new Date();
  var h='<div class="kiosk"><div class="khead"><img src="'+LOGO+'" alt=""><div class="kclock"><b id="kc-time">'+tOf(now.toISOString())+'</b><span>'+DOW[now.getDay()]+' '+now.getDate()+' '+MON[now.getMonth()]+'</span></div></div>';
  if(dbState==='off'||dbState==='err')h+='<div class="kwarn">Clock-in isn’t working on this device. Please tell a manager.</div>';
  else if(!ready)h+='<div class="kwarn soft">Connecting…</div>';
  else h+='<div class="kmsg">Tap your name to clock in or out</div>';
  h+='<h4 class="ksec">On today</h4><div class="ktiles">'+(on.length?on.map(tile).join(''):'<div class="kempty">Nobody is on the rota today</div>')+'</div>';
  if(others.length)h+='<h4 class="ksec">Everyone else</h4><div class="ktiles small">'+others.map(tile).join('')+'</div>';
  h+='<button class="kman" data-act="kmanager">Manager</button></div>';
  document.getElementById('root').innerHTML=h;
}
function kioskIdle(){clearTimeout(kioskIdleT);if(view!=='clock')return;kioskIdleT=setTimeout(function(){if(view==='clock')closeModal();},30000);}
function pinPad(title,sub,check){
  var entered='';
  openModal('<div class="pp"><h3>'+esc(title)+'</h3><div class="pp-sub">'+sub+'</div><div class="dots"></div><div class="pp-err"></div>'+
    '<div class="keys">'+[1,2,3,4,5,6,7,8,9].map(function(n){return '<button data-k="'+n+'">'+n+'</button>';}).join('')+'<button data-k="c" class="kx">Cancel</button><button data-k="0">0</button><button data-k="b" class="kx">⌫</button></div></div>',
  function(b){b.classList.add('kbox');var dots=b.querySelector('.dots'),err=b.querySelector('.pp-err'),len=check.len||4;
    function draw(){var s='';for(var i=0;i<len;i++)s+='<i class="'+(i<entered.length?'on':'')+'"></i>';dots.innerHTML=s;}draw();
    function press(k){kioskIdle();if(k==='c'){closeModal();return;}
      if(Date.now()<pinLockUntil){err.textContent='Too many tries. Wait '+Math.ceil((pinLockUntil-Date.now())/1000)+'s';return;}
      if(k==='b'){entered=entered.slice(0,-1);err.textContent='';draw();return;}
      if(entered.length>=len)return;entered+=k;draw();
      if(entered.length===len){var ok=check.fn(entered);
        if(ok){pinFails=0;}else{pinFails++;if(pinFails>=5){pinLockUntil=Date.now()+30000;pinFails=0;}
          err.textContent='Wrong PIN, try again';b.querySelector('.dots').classList.add('shake');setTimeout(function(){entered='';draw();var d=b.querySelector('.dots');if(d)d.classList.remove('shake');},450);}}}
    b.addEventListener('click',function(e){var k=e.target.closest('[data-k]');if(k)press(k.dataset.k);});
    b._key=function(e){if(/^\d$/.test(e.key))press(e.key);else if(e.key==='Backspace')press('b');};
    document.addEventListener('keydown',b._key);
    var mo=new MutationObserver(function(){if(!document.body.contains(b)){document.removeEventListener('keydown',b._key);mo.disconnect();}});mo.observe(document.getElementById('modal'),{childList:true});
  });kioskIdle();
}
function kioskTap(id){var p=person(id);if(!p)return;
  if(!p.pin){openModal('<div class="pp"><h3>'+esc(p.name)+'</h3><p class="pp-sub">You don’t have a PIN yet. Ask a manager to set one.</p><div class="acts"><button class="btn primary" data-m="cancel">OK</button></div></div>',function(b){b.classList.add('kbox');b.querySelector('[data-m=cancel]').onclick=closeModal;});kioskIdle();return;}
  pinPad('Hi '+p.name,'Enter your 4-digit PIN',{len:4,fn:function(v){if(v!==p.pin)return false;setTimeout(function(){kioskActions(p);},120);return true;}});}
function kioskActions(p){
  var st=staffStatus(p.id),t=todayS(),shifts=workShifts(t,p.id),now=new Date();
  var shiftTxt=shifts.length?'Today: '+shifts.map(function(s){return s.start+'–'+s.end;}).join(', '):'You’re not on the rota today';
  var btns='';
  if(st.st==='in')btns='<button class="kbig brk" data-k="break">Start break</button><button class="kbig out" data-k="out">Clock out</button>';
  else if(st.st==='break')btns='<button class="kbig brk" data-k="endbreak">End break</button><button class="kbig out" data-k="out">Clock out</button>';
  else btns='<button class="kbig in" data-k="in">Clock in</button>';
  var info=st.st==='in'?'Clocked in at '+tOf(st.e.inAt)+' ('+hm((now-new Date(st.e.inAt))/36e5)+' ago)':st.st==='break'?'On break since '+tOf((st.e.breaks||[]).slice(-1)[0].s):st.st==='done'?'You clocked out at '+tOf(st.e.outAt)+'. Clock in again only if you’re starting another shift.':'';
  openModal('<div class="pp"><h3>'+esc(p.name)+'</h3><div class="pp-sub">'+esc(shiftTxt)+(info?'<br>'+esc(info):'')+'</div><div class="kbtns">'+btns+'</div><div class="pp-err"></div><button class="btn kcancel" data-k="cancel">Cancel</button></div>',
  function(b){b.classList.add('kbox');var err=b.querySelector('.pp-err');
    b.addEventListener('click',function(e){var k=e.target.closest('[data-k]');if(!k)return;var a=k.dataset.k;kioskIdle();if(a==='cancel'){closeModal();return;}
      b.querySelectorAll('.kbig').forEach(function(x){x.disabled=true;});err.textContent='Saving…';
      var n,now=new Date(),iso=now.toISOString(),msg;
      if(a==='in'){var sh=closestShift(workShifts(t,p.id),now);n={id:uid()+uid(),staffId:p.id,date:t,inAt:iso,outAt:null,breaks:[],shiftId:sh?sh.id:'',breakMin:null,approved:false,edited:false,src:'kiosk'};msg='Clocked in at '+tOf(iso);}
      else{n=clone(st.e);
        if(a==='break'){n.breaks=(n.breaks||[]).concat([{s:iso,e:null}]);msg='Break started at '+tOf(iso);}
        else if(a==='endbreak'){var lb=n.breaks[n.breaks.length-1];if(lb&&!lb.e)lb.e=iso;msg='Break ended at '+tOf(iso);}
        else{(n.breaks||[]).forEach(function(bk){if(!bk.e)bk.e=iso;});n.outAt=iso;var x=entryCalc(n);msg='Clocked out at '+tOf(iso)+' · '+hm(x.hours)+' paid today';}}
      putEntries([n]).then(function(){kioskDone(p,msg,a);}).catch(function(e2){err.textContent=writeErr(e2)+'. Please tell a manager.';b.querySelectorAll('.kbig').forEach(function(x){x.disabled=false;});});});
  });kioskIdle();
}
function kioskDone(p,msg,a){
  var bye=a==='in'?'Have a good shift!':a==='out'?'Thanks, see you next time!':a==='break'?'Enjoy your break':'Welcome back';
  openModal('<div class="pp done"><div class="bigtick">✓</div><h3>'+esc(msg)+'</h3><div class="pp-sub">'+esc(bye)+', '+esc(p.name)+'</div></div>',function(b){b.classList.add('kbox');b.addEventListener('click',closeModal);});
  setTimeout(function(){var m=document.querySelector('#modal .pp.done');if(m)closeModal();},3500);
}
function kioskManager(){var mp=clk().managerPin;
  function leave(){closeModal();try{localStorage.removeItem(KIOSK_KEY);}catch(_){}view='times';nav();}
  if(!mp){leave();toast('Tip: set a manager PIN so staff can’t leave the clock-in screen');return;}
  pinPad('Manager','Enter the manager PIN to leave the clock-in screen',{len:mp.length,fn:function(v){if(v!==mp)return false;setTimeout(leave,100);return true;}});}
function enterKiosk(){try{localStorage.setItem(KIOSK_KEY,'1');}catch(_){}view='clock';nav();
  try{var el=document.documentElement;if(el.requestFullscreen)el.requestFullscreen().catch(function(){});}catch(_){}}

function nav(){syncWatch();setHash();render();}
function render(){
  document.body.className=view==='clock'?'kiosk-mode':'';
  if(view==='clock')return renderKiosk();
  if(view==='times')return renderTimes();
  if(view==='staff')return renderStaff();
  return renderRota();
}
setInterval(function(){
  var el=document.getElementById('kc-time');if(el)el.textContent=tOf(new Date().toISOString());
  var k=mondayKey(todayS());if(db&&!tsSubs[k])syncWatch();
  if(render._day!==todayS()){render._day=todayS();scheduleRender();return;}
  var now=Date.now();if(!render._last||now-render._last>60000){render._last=now;if(view!=='rota'&&!document.querySelector('#modal .box'))scheduleRender();}
},5000);

function shiftsOn(date,staffId){return state.shifts.filter(function(s){return s.date===date&&(staffId===undefined||s.staffId===staffId);}).sort(function(a,b){return toMin(a.start)-toMin(b.start);});}

function dayStats(date){
  var ws=state.shifts.filter(function(s){return s.date===date&&s.staffId&&s.type!=='leave';});
  var hours=0,cost=0;ws.forEach(function(s){hours+=shiftHours(s);cost+=shiftCost(s);});
  var r=state.revenue[date]||{};var actual=num(r.actual),forecast=num(r.forecast);
  var used=actual>0?actual:forecast;var T=num(state.settings.targetPct)/100;
  return {hours:hours,cost:cost,actual:actual,forecast:forecast,used:used,usedActual:actual>0,
    pct:used>0?cost/used*100:null,variance:used>0?cost-used*T:null};
}

function staffWeek(p,days){
  var hours=0,cost=0,count=0,issues={};
  days.forEach(function(d){
    var list=shiftsOn(d,p.id);var work=list.filter(function(s){return s.type!=='leave';});
    var leave=list.some(function(s){return s.type==='leave';});
    var dow=parseD(d).getDay();
    work.forEach(function(s,i){
      hours+=shiftHours(s);cost+=shiftCost(s);count++;
      var w=[];
      if((p.unavailable||[]).indexOf(dow)>-1)w.push('Unavailable '+DOW[dow]);
      if(leave)w.push('On leave');
      var aw=awayOn(p,d);if(aw)w.push('Away'+(aw.note?': '+aw.note:''));
      for(var j=0;j<work.length;j++){if(j===i)continue;var o=work[j];
        var a1=toMin(s.start),a2=a1+shiftHours(s)*60+num(s.breakMin),b1=toMin(o.start),b2=b1+shiftHours(o)*60+num(o.breakMin);
        if(a1<b2&&b1<a2){w.push('Overlaps another shift');break;}}
      if(w.length)issues[s.id]=w;
    });
  });
  var daysWorked=0,onLeave=0;
  days.forEach(function(d){var l=shiftsOn(d,p.id);if(l.some(function(s){return s.type!=='leave';}))daysWorked++;else if(l.some(function(s){return s.type==='leave';}))onLeave++;
    if(p.latestFinish)l.forEach(function(s){if(s.type==='leave')return;var e=toMin(s.end);if(e<=toMin(s.start)||e>toMin(p.latestFinish)){(issues[s.id]=issues[s.id]||[]).push('Must finish by '+p.latestFinish);}});});
  var warn=[];
  if(p.maxH!==''&&p.maxH!=null&&hours>num(p.maxH)+1e-6)warn.push('Over max '+num(p.maxH)+'h');
  if(p.minH!==''&&p.minH!=null&&num(p.minH)>0&&hours<num(p.minH)-1e-6&&!onLeave)warn.push('Under min '+num(p.minH)+'h');
  if(p.maxDays!==''&&p.maxDays!=null&&daysWorked>num(p.maxDays))warn.push(daysWorked+' days (max '+num(p.maxDays)+')');
  if(p.minDays!==''&&p.minDays!=null&&num(p.minDays)>0&&daysWorked<num(p.minDays)&&!onLeave)warn.push(daysWorked+' day'+(daysWorked===1?'':'s')+' (wants '+num(p.minDays)+'+)');
  return {hours:hours,cost:cost,count:count,issues:issues,warn:warn,daysWorked:daysWorked};
}

function markDirty(){dirty=true;setStatus();}
function setStatus(msg){
  var el=document.getElementById('status');var btn=document.getElementById('savebtn');
  if(!el)return;
  if(msg){el.textContent=msg;}
  else if(readOnly){el.textContent='View only';}
  else if(dirty){el.textContent='Unsaved changes';}
  else{el.textContent=state.savedAt?'Saved '+new Date(state.savedAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'All changes saved';}
  el.className='status'+(dirty?' dirty':'');
  if(btn)btn.disabled=!dirty||readOnly;
}
function toast(m){var t=document.getElementById('toast');t.textContent=m;t.className='on';clearTimeout(toast._t);toast._t=setTimeout(function(){t.className='';},2600);}

function renderRota(){
  var days=weekDays(),today=fmtD(new Date()),T=num(state.settings.targetPct);
  var st=days.map(dayStats);
  var tot={hours:0,cost:0,actual:0,forecast:0,used:0};
  st.forEach(function(s){tot.hours+=s.hours;tot.cost+=s.cost;tot.actual+=s.actual;tot.forecast+=s.forecast;tot.used+=s.used;});
  var revCost=0,revDays=0;st.forEach(function(s){if(s.used>0){revCost+=s.cost;revDays++;}});
  var wPct=tot.used>0?revCost/tot.used*100:null,wVar=tot.used>0?revCost-tot.used*T/100:null;
  var a=parseD(days[0]),b=parseD(days[6]);
  var range=a.getDate()+(a.getMonth()!==b.getMonth()?' '+MON[a.getMonth()]:'')+' – '+b.getDate()+' '+MON[b.getMonth()]+' '+b.getFullYear();
  function tcls(d){return d===today?' today':'';}
  function varBadge(v){if(v==null)return '';var over=v>0.005;return '<span class="var '+(over?'over':'under')+'">'+(over?'↑ +':'↓ −')+money(Math.abs(v))+'</span>';}

  var h=headerHtml();
  h+='<div class="toolbar"><div class="weeknav"><button data-act="prev" title="Previous week">‹</button><div class="range">'+range+'</div><button data-act="next" title="Next week">›</button></div>'+
    '<button class="btn" data-act="today">This week</button><div class="spacer"></div>'+
    '<button class="btn" data-act="addstaff">+ Add staff</button>'+
    '<details class="menu"><summary class="btn">Week tools ▾</summary><div class="pop">'+
      '<button data-act="applyideal">Apply ideal week<span class="sub">'+(state.template?'Replace this week with your saved ideal rota':'No ideal week saved yet')+'</span></button>'+
      '<button data-act="saveideal">Save this week as ideal week<span class="sub">Use it as the template for future weeks</span></button>'+
      '<button data-act="copylast">Copy last week<span class="sub">Replace this week with last week’s shifts</span></button>'+
      '<button data-act="clearweek">Clear this week<span class="sub">Remove all shifts this week</span></button>'+
    '</div></details>'+
    '<button class="btn" data-act="settings">⚙ Settings</button></div>';

  h+='<div class="gridwrap"><div class="grid">';
  // header
  h+='<div class="c first headcell"><span class="big">Week summary</span><div class="lbl" style="margin-top:4px">Target labour '+T+'%</div></div>';
  days.forEach(function(d){var dt=parseD(d);var oh=openHoursDate(d);var ov=(state.settings.hoursOverride||{})[d];h+='<div class="c headcell'+tcls(d)+'"><div class="dayhead"><b>'+dt.getDate()+'</b>'+DOW[dt.getDay()]+'</div><button class="lbl" data-act="dayhours" data-date="'+d+'" title="Change opening hours for this day" style="margin-top:3px;border:0;background:none;padding:0;cursor:pointer;'+(ov?'color:#b7791f;font-weight:700':'')+'">'+(oh?'Open '+oh.open+'\u2013'+oh.close:'Closed')+' \u270e</button></div>';});
  // labour %
  h+='<div class="c first"><div class="lbl">Labour % of takings</div><div class="row-l"><span class="big">'+(wPct==null?'–':wPct.toFixed(2)+'%')+'</span>'+varBadge(wVar)+'</div>'+
    (revDays>0&&revDays<7?'<div class="used">Based on the '+revDays+' day'+(revDays===1?'':'s')+' with takings</div>':'')+'</div>';
  st.forEach(function(s,i){h+='<div class="c'+tcls(days[i])+'"><div class="row-l"><span class="big">'+(s.pct==null?'–':s.pct.toFixed(2)+'%')+'</span>'+varBadge(s.variance)+'</div></div>';});
  // staff cost (hours + cost)
  h+='<div class="c first hc"><div class="lbl">Staff cost for the day</div><span class="big">'+hm(tot.hours)+'</span><span class="big">'+money(tot.cost)+'</span><div class="used">Whole week'+(tot.used>0?' \u00b7 target '+money(tot.used*T/100):'')+'</div></div>';
  st.forEach(function(s,i){var w=dayWorked(days[i]);h+='<div class="c hc'+tcls(days[i])+'"><span class="big">'+hm(s.hours)+'</span><span class="big">'+money(s.cost)+'</span>'+(s.used>0?'<div class="used">Target '+money(s.used*T/100)+' at '+T+'%</div>':'')+(w.count?'<button class="workedln" data-act="view-times" title="Open timesheets">Worked '+hm(w.hours)+' \u00b7 '+money(w.cost)+'</button>':'')+'</div>';});
  // revenue
  h+='<div class="c first"><div class="lbl">Takings</div><div style="margin-top:6px">Actual <b>'+money(tot.actual)+'</b></div><div style="margin-top:4px">Forecast <b>'+money(tot.forecast)+'</b></div></div>';
  st.forEach(function(s,i){var d=days[i];h+='<div class="c rev'+tcls(d)+'">'+
    '<label><span>Actual</span><input class="act" inputmode="decimal" data-rev="actual" data-date="'+d+'" value="'+(s.actual||'')+'" placeholder="£ from till"'+(readOnly?' disabled':'')+'></label>'+
    '<label><span>Forecast</span><input inputmode="decimal" data-rev="forecast" data-date="'+d+'" value="'+(s.forecast||'')+'" placeholder="£"'+(readOnly?' disabled':'')+'></label>'+
    (s.used>0?'<div class="used">Using '+(s.usedActual?'actual':'forecast')+'</div>':'')+'</div>';});
  // staff
  state.staff.forEach(function(p){
    var w=staffWeek(p,days);
    var limits=[];if(p.minH!==''&&p.minH!=null&&num(p.minH)>0)limits.push('min '+num(p.minH)+'h');if(p.maxH!==''&&p.maxH!=null)limits.push('max '+num(p.maxH)+'h');
    if(p.minDays!==''&&p.minDays!=null&&num(p.minDays)>0)limits.push(num(p.minDays)+(p.maxDays!==''&&p.maxDays!=null&&num(p.maxDays)!==num(p.minDays)?'–'+num(p.maxDays):'')+' days');
    else if(p.maxDays!==''&&p.maxDays!=null)limits.push('max '+num(p.maxDays)+' days');
    if(p.latestFinish)limits.push('finish by '+p.latestFinish);
    h+='<div class="c first"><div class="staffcell"><div class="av" style="box-shadow:inset 0 0 0 2px '+esc(role(p.role).color)+'">'+esc(initials(p.name))+'</div><div>'+
      '<button class="sname" data-act="editstaff" data-id="'+p.id+'">'+esc(p.name)+'</button>'+
      '<div class="smeta'+(w.warn.length?' warn':'')+'">'+hm(w.hours)+(limits.length?' <span style="font-weight:400;color:#6b7785">('+limits.join(', ')+')</span>':'')+(w.warn.length?'<br>⚠ '+esc(w.warn.join(' · ')):'')+'</div>'+
      '<div class="smeta">'+w.count+' shift'+(w.count===1?'':'s')+' ('+money(w.cost)+') · '+payTxt(p,days[0])+'</div>'+
      (p.notes?'<div class="smeta" style="color:#8a95a1">'+esc(p.notes)+'</div>':'')+'</div></div></div>';
    days.forEach(function(d){h+=cellHtml(d,p.id,w.issues,(p.unavailable||[]).indexOf(parseD(d).getDay())>-1,awayOn(p,d));});
  });
  h+='<div class="c first addrow"><button class="btn" data-act="addstaff">+ Add staff member</button></div>';
  for(var i=0;i<7;i++)h+='<div class="c"></div>';
  h+='</div></div>';
  h+='<div class="legend">'+state.roles.map(function(r){return '<span><i style="background:'+esc(r.color)+'"></i>'+esc(r.name)+'</span>';}).join('')+
     '<span>Labour cost = paid hours × hourly rate'+(num(state.settings.onCostPct)?' + '+num(state.settings.onCostPct)+'% on-costs':'')+'. Labour % uses actual takings when entered, otherwise forecast.</span></div>';
  document.getElementById('root').innerHTML=h;
  setStatus();
}

function cellHtml(d,staffId,issues,unavail,away){
  var list=shiftsOn(d,staffId);
  var h='<div class="c daycell'+(d===fmtD(new Date())?' today':'')+(unavail||away?' unavail':'')+'" data-act="add" data-date="'+d+'" data-staff="'+staffId+'">';
  list.forEach(function(s){
    if(s.type==='leave'){h+='<div class="card leave" data-act="edit" data-id="'+s.id+'">✈ Leave</div>';return;}
    var r=role(s.role),iss=issues[s.id];
    h+='<div class="card'+(iss?' warn':'')+'" style="--rc:'+esc(r.color)+'" data-act="edit" data-id="'+s.id+'"><div class="t">'+esc(s.start)+' - '+esc(s.end)+'</div><div class="r">'+esc(r.name)+(num(s.breakMin)?' · '+num(s.breakMin)+'m break':'')+'</div>'+
      (iss?'<div class="w">⚠ '+esc(iss.join(', '))+'</div>':'')+'</div>';
  });
  if(away)h+='<span class="unavtag" style="color:#b7791f;font-weight:700">Away'+(away.note?' \u2013 '+esc(away.note):'')+'</span>';
  else if(unavail&&!list.length)h+='<span class="unavtag">Unavailable</span>';
  if(!readOnly)h+='<span class="plus">+</span>';
  return h+'</div>';
}

/* ---------- staff directory ---------- */
function renderStaff(){
  var t=todayS(),order=[1,2,3,4,5,6,0];
  var list=state.staff.slice().sort(function(a,b){return a.name.localeCompare(b.name);});
  var h=headerHtml()+'<div class="toolbar"><b style="font-size:16px">Staff ('+list.length+')</b><div class="spacer"></div><input id="sfind" class="sfind" placeholder="Search staff" value="'+esc(renderStaff.q||'')+'"><button class="btn primary" data-act="addstaff"'+(readOnly?' disabled':'')+'>+ Add staff</button></div><div class="sdir">';
  var q=(renderStaff.q||'').toLowerCase();
  list.filter(function(p){return !q||(p.name+' '+(p.notes||'')+' '+role(p.role).name).toLowerCase().indexOf(q)>-1;}).forEach(function(p){
    var r=role(p.role),away=(p.away||[]).filter(function(a){return (a.to||a.from)>=t;}).sort(function(a,b){return a.from<b.from?-1:1;});
    var cant=(p.unavailable||[]).slice().sort(function(a,b){return order.indexOf(a)-order.indexOf(b);}).map(function(d){return DOW[d].slice(0,3);});
    var lim=[];if(p.minH!==''&&p.minH!=null&&num(p.minH)>0)lim.push('min '+num(p.minH)+'h');if(p.maxH!==''&&p.maxH!=null)lim.push('max '+num(p.maxH)+'h');if(p.maxDays!==''&&p.maxDays!=null)lim.push('max '+num(p.maxDays)+' days');if(p.latestFinish)lim.push('finish by '+p.latestFinish);
    h+='<div class="scard" data-act="editstaff" data-id="'+esc(p.id)+'"><div class="shd"><div class="av" style="box-shadow:inset 0 0 0 2px '+esc(r.color)+'">'+esc(initials(p.name))+'</div><div><div class="snm">'+esc(p.name)+'</div><div class="smeta">'+esc(r.name)+(p.contract?' · '+esc(p.contract):'')+' · '+payTxt(p,t)+'</div></div></div>'+
      '<dl>'+
      (p.phone?'<dt>Mobile</dt><dd><a href="tel:'+esc(p.phone.replace(/\s/g,''))+'" data-stop="1">'+esc(p.phone)+'</a></dd>':'')+
      (p.email?'<dt>Email</dt><dd>'+esc(p.email)+'</dd>':'')+
      (p.emName||p.emPhone?'<dt>Emergency</dt><dd>'+esc([p.emName,p.emPhone].filter(Boolean).join(' · '))+'</dd>':'')+
      (p.startDate?'<dt>Started</dt><dd>'+esc(parseD(p.startDate).getDate()+' '+MON[parseD(p.startDate).getMonth()]+' '+parseD(p.startDate).getFullYear())+'</dd>':'')+
      '<dt>Availability</dt><dd>'+(cant.length?'Can’t work '+esc(cant.join(', ')):'Any day')+(lim.length?' · '+esc(lim.join(', ')):'')+'</dd>'+
      (away.length?'<dt>Away</dt><dd>'+away.slice(0,3).map(function(a){var f=parseD(a.from),e=parseD(a.to||a.from);return esc(f.getDate()+' '+MON[f.getMonth()]+(a.to&&a.to!==a.from?' – '+e.getDate()+' '+MON[e.getMonth()]:'')+(a.note?' ('+a.note+')':''));}).join('<br>')+'</dd>':'')+
      (p.notes?'<dt>Notes</dt><dd class="nt">'+esc(p.notes)+'</dd>':'')+
      '</dl></div>';});
  h+='</div>';
  document.getElementById('root').innerHTML=h;setStatus();
  var f=document.getElementById('sfind');f.addEventListener('input',function(){renderStaff.q=f.value;var pos=f.value.length;renderStaff();var n=document.getElementById('sfind');n.focus();n.setSelectionRange(pos,pos);});
}

/* ---------- modals ---------- */
function openModal(html,onMount){var m=document.getElementById('modal');m.innerHTML='<div class="back"><div class="box">'+html+'</div></div>';
  m.querySelector('.back').addEventListener('mousedown',function(e){if(e.target===e.currentTarget)closeModal();});
  if(onMount)onMount(m.querySelector('.box'));var f=m.querySelector('input,select');if(f)f.focus();}
function closeModal(){document.getElementById('modal').innerHTML='';}
function confirmBox(title,text,ok,fn){openModal('<h3>'+esc(title)+'</h3><p>'+esc(text)+'</p><div class="acts"><button class="btn" data-m="cancel">Cancel</button><button class="btn primary" data-m="ok">'+esc(ok)+'</button></div>',
  function(b){b.querySelector('[data-m=cancel]').onclick=closeModal;b.querySelector('[data-m=ok]').onclick=function(){closeModal();fn();};});}
function roleOptions(sel){return state.roles.map(function(r){return '<option value="'+esc(r.id)+'"'+(r.id===sel?' selected':'')+'>'+esc(r.name)+'</option>';}).join('');}

function shiftModal(existing,defaults){
  if(readOnly)return;
  var isNew=!existing;var p=defaults&&defaults.staffId?person(defaults.staffId):null;
  var s=existing?JSON.parse(JSON.stringify(existing)):{id:uid(),staffId:defaults.staffId||'',date:defaults.date,start:'09:00',end:'17:00',role:p?p.role:(state.roles[0]||{}).id,breakMin:0,type:'shift'};
  var days=weekDays();if(days.indexOf(s.date)<0)days=[s.date].concat(days);
  var staffOpts=(s.staffId?'':'<option value="" selected>Pick someone\u2026</option>')+state.staff.map(function(x){return '<option value="'+x.id+'"'+(x.id===s.staffId?' selected':'')+'>'+esc(x.name)+'</option>';}).join('');
  var dayOpts=days.map(function(d){var dt=parseD(d);return '<option value="'+d+'"'+(d===s.date?' selected':'')+'>'+DOW[dt.getDay()]+' '+dt.getDate()+' '+MON[dt.getMonth()]+'</option>';}).join('');
  openModal('<h3>'+(isNew?'Add shift':'Edit shift')+'</h3>'+
    '<div class="seg"><label><input type="radio" name="type" value="shift"'+(s.type!=='leave'?' checked':'')+'><span>Shift</span></label><label><input type="radio" name="type" value="leave"'+(s.type==='leave'?' checked':'')+'><span>✈ Leave / holiday</span></label></div>'+
    '<div class="f2"><div class="f"><label>Staff</label><select name="staffId">'+staffOpts+'</select></div><div class="f"><label>Day</label><select name="date">'+dayOpts+'</select></div></div>'+
    '<div class="shiftonly"><div class="f2"><div class="f"><label>Start</label><input type="time" step="900" name="start" value="'+esc(s.start)+'"></div><div class="f"><label>Finish</label><input type="time" step="900" name="end" value="'+esc(s.end)+'"></div></div>'+
    '<div class="f2"><div class="f"><label>Role</label><select name="role">'+roleOptions(s.role)+'</select></div><div class="f"><label>Unpaid break (mins)</label><input type="number" min="0" step="5" name="breakMin" value="'+num(s.breakMin)+'"></div></div>'+
    '<div class="hint" id="calc"></div><div style="display:flex;gap:6px;margin:-4px 0 12px"><button class="btn" data-m="atopen">Start at opening</button><button class="btn" data-m="atclose">Finish at close</button></div></div>'+
    '<div class="acts">'+(isNew?'':'<button class="btn danger left" data-m="del">Delete</button>')+(isNew?'':'<button class="btn" data-m="dup">Duplicate to next day</button>')+'<button class="btn" data-m="cancel">Cancel</button><button class="btn primary" data-m="ok">'+(isNew?'Add':'Save')+'</button></div>',
  function(b){
    function read(){var o={};b.querySelectorAll('[name]').forEach(function(el){if(el.type==='radio'){if(el.checked)o[el.name]=el.value;}else o[el.name]=el.value;});return o;}
    function upd(){var o=read();b.querySelector('.shiftonly').style.display=o.type==='leave'?'none':'';
      var tmp={start:o.start,end:o.end,breakMin:o.breakMin,type:o.type,staffId:o.staffId};var hrs=shiftHours(tmp);var pp=person(o.staffId);
      b.querySelector('#calc').textContent=hm(hrs)+' paid'+(pp?' · '+(isWeekly(pp)?payTxt(pp,o.date||viewStart):money(hrs*num(pp.rate)*onCost())):'')+(toMin(o.end)<=toMin(o.start)?' · finishes after midnight':'');}
    b.addEventListener('input',upd);b.addEventListener('change',function(e){if(e.target.name==='staffId'){var pp=person(e.target.value);if(pp&&isNew)b.querySelector('[name=role]').value=pp.role;}upd();});upd();
    function setOH(k){var o=read();var oh=openHoursDate(o.date);if(!oh){toast('No opening hours set for that day (Settings)');return;}b.querySelector(k==='open'?'[name=start]':'[name=end]').value=oh[k];upd();}
    b.querySelector('[data-m=atopen]').onclick=function(){setOH('open');};
    b.querySelector('[data-m=atclose]').onclick=function(){setOH('close');};
    b.querySelector('[data-m=cancel]').onclick=closeModal;
    b.querySelector('[data-m=ok]').onclick=function(){var o=read();
      if(o.type!=='leave'&&!o.start){toast('Add a start time');return;}
      if(!o.staffId){toast('Pick who is working this shift');return;}
      s.staffId=o.staffId;s.date=o.date;s.type=o.type;s.start=o.start||'00:00';s.end=o.end||'00:00';s.role=o.role;s.breakMin=num(o.breakMin);
      if(isNew)state.shifts.push(s);else{for(var i=0;i<state.shifts.length;i++)if(state.shifts[i].id===s.id)state.shifts[i]=s;}
      closeModal();markDirty();render();};
    var del=b.querySelector('[data-m=del]');if(del)del.onclick=function(){state.shifts=state.shifts.filter(function(x){return x.id!==s.id;});closeModal();markDirty();render();};
    var dup=b.querySelector('[data-m=dup]');if(dup)dup.onclick=function(){var c=JSON.parse(JSON.stringify(existing));c.id=uid();c.date=addDays(existing.date,1);state.shifts.push(c);closeModal();markDirty();render();toast('Copied to '+DOW[parseD(c.date).getDay()]);};
  });
}

function staffModal(p){
  if(readOnly)return;
  var isNew=!p;p=p?JSON.parse(JSON.stringify(p)):{id:uid(),name:'',role:(state.roles[0]||{}).id,rate:12.71,minH:'',maxH:'',unavailable:[],notes:''};
  var order=[1,2,3,4,5,6,0];
  openModal('<h3>'+(isNew?'Add staff member':'Edit '+esc(p.name))+'</h3>'+
    '<div class="f"><label>Name</label><input name="name" value="'+esc(p.name)+'"></div>'+
    '<div class="f2"><div class="f"><label>Main role</label><select name="role">'+roleOptions(p.role)+'</select></div><div class="f"><label>Hourly rate (£)</label><input type="number" step="0.01" min="0" name="rate" value="'+esc(p.rate)+'"></div></div>'+
     '<div class="f"><label>Weekly pay (£, salaried)</label><input type="number" step="0.01" min="0" name="weekly" value="'+esc(p.weekly||'')+'"></div><div class="hint">If set, this replaces the hourly rate: the week’s pay is split evenly across their shifts that week.</div>'+
    '<div class="f"><label>Clock-in PIN (4 digits)</label><input class="pinin" inputmode="numeric" maxlength="4" name="pin" value="'+esc(p.pin||newPin())+'"></div>'+
    '<div class="f2"><div class="f"><label>Min hours / week</label><input type="number" min="0" step="0.5" name="minH" value="'+esc(p.minH)+'" placeholder="none"></div><div class="f"><label>Max hours / week</label><input type="number" min="0" step="0.5" name="maxH" value="'+esc(p.maxH)+'" placeholder="none"></div></div>'+
    '<div class="f2"><div class="f"><label>Min days / week</label><input type="number" min="0" max="7" name="minDays" value="'+esc(p.minDays)+'" placeholder="none"></div><div class="f"><label>Max days / week</label><input type="number" min="0" max="7" name="maxDays" value="'+esc(p.maxDays)+'" placeholder="none"></div></div>'+
    '<div class="f"><label>Must finish by (optional)</label><input type="time" step="900" name="latestFinish" value="'+esc(p.latestFinish||'')+'"></div>'+
    '<div class="f"><label>Can’t work on</label><div class="days">'+order.map(function(d){return '<label><input type="checkbox" value="'+d+'"'+((p.unavailable||[]).indexOf(d)>-1?' checked':'')+'>'+DOW[d].slice(0,3)+'</label>';}).join('')+'</div></div>'+
    '<div class="f"><label>Away / can\u2019t work these dates</label><div id="away"></div><button class="btn" data-m="addaway" style="align-self:flex-start">+ Add dates</button></div>'+
    '<h4 class="sec">Contact &amp; employment</h4>'+
    '<div class="f2"><div class="f"><label>Mobile</label><input type="tel" name="phone" value="'+esc(p.phone||'')+'"></div><div class="f"><label>Email</label><input type="email" name="email" value="'+esc(p.email||'')+'"></div></div>'+
    '<div class="f2"><div class="f"><label>Emergency contact</label><input name="emName" placeholder="Name and relationship" value="'+esc(p.emName||'')+'"></div><div class="f"><label>Emergency number</label><input type="tel" name="emPhone" value="'+esc(p.emPhone||'')+'"></div></div>'+
    '<div class="f2"><div class="f"><label>Start date</label><input type="date" name="startDate" value="'+esc(p.startDate||'')+'"></div><div class="f"><label>Contract</label><select name="contract">'+['','Zero hours','Part time','Full time','Salaried','Casual'].map(function(c){return '<option value="'+esc(c)+'"'+((p.contract||'')===c?' selected':'')+'>'+(c||'—')+'</option>';}).join('')+'</select></div></div>'+
    '<div class="f"><label>Notes (e.g. student, only evenings, under 18, right-to-work checked)</label><textarea name="notes" rows="3">'+esc(p.notes)+'</textarea></div>'+
    '<div class="acts">'+(isNew?'':'<button class="btn danger left" data-m="del">Remove</button>')+'<button class="btn" data-m="cancel">Cancel</button><button class="btn primary" data-m="ok">'+(isNew?'Add':'Save')+'</button></div>',
  function(b){
    var away=(p.away||[]).map(function(a){return {from:a.from,to:a.to,note:a.note};});var ab=b.querySelector('#away');
    function drawAway(){ab.innerHTML=away.map(function(a,i){return '<div class="rolerow"><input type="date" data-ai="'+i+'" data-k="from" value="'+esc(a.from)+'"><span>to</span><input type="date" data-ai="'+i+'" data-k="to" value="'+esc(a.to)+'"><input type="text" placeholder="reason" data-ai="'+i+'" data-k="note" value="'+esc(a.note)+'"><button class="btn ghost" data-ar="'+i+'">\u2715</button></div>';}).join('');}
    drawAway();
    ab.addEventListener('input',function(e){var i=e.target.dataset.ai;if(i!=null)away[i][e.target.dataset.k]=e.target.value;});
    ab.addEventListener('click',function(e){var r=e.target.closest('[data-ar]');if(r){away.splice(+r.dataset.ar,1);drawAway();}});
    b.querySelector('[data-m=addaway]').onclick=function(){away.push({from:'',to:'',note:''});drawAway();};
    b.querySelector('[data-m=cancel]').onclick=closeModal;
    b.querySelector('[data-m=ok]').onclick=function(){
      p.away=away.filter(function(a){return a.from;}).map(function(a){if(!a.to||a.to<a.from)a.to=a.from;return a;});
      var name=b.querySelector('[name=name]').value.trim();if(!name){toast('Add a name');return;}
      var pin=b.querySelector('[name=pin]').value.replace(/\D/g,'');if(!/^\d{4}$/.test(pin)){toast('PIN must be 4 digits');return;}
      var clash=state.staff.filter(function(x){return x.id!==p.id&&x.pin===pin;})[0];if(clash){toast(clash.name+' already has that PIN');return;}
      p.pin=pin;p.name=name;p.role=b.querySelector('[name=role]').value;p.rate=num(b.querySelector('[name=rate]').value);var wkv=b.querySelector('[name=weekly]').value;p.weekly=wkv===''?'':num(wkv);
      p.minH=b.querySelector('[name=minH]').value;p.maxH=b.querySelector('[name=maxH]').value;p.notes=b.querySelector('[name=notes]').value;
      ['phone','email','emName','emPhone','startDate','contract'].forEach(function(k){p[k]=b.querySelector('[name='+k+']').value.trim();});
      p.minDays=b.querySelector('[name=minDays]').value;p.maxDays=b.querySelector('[name=maxDays]').value;p.latestFinish=b.querySelector('[name=latestFinish]').value;
      p.unavailable=[].slice.call(b.querySelectorAll('.days input:checked')).map(function(x){return +x.value;});
      if(isNew)state.staff.push(p);else state.staff=state.staff.map(function(x){return x.id===p.id?p:x;});
      closeModal();markDirty();render();};
    var del=b.querySelector('[data-m=del]');if(del)del.onclick=function(){
      confirmBox('Remove '+p.name+'?','Their shifts and leave are removed from every week of the rota. Past timesheets are kept.','Remove',function(){
        state.staff=state.staff.filter(function(x){return x.id!==p.id;});
        state.shifts=state.shifts.filter(function(s){return s.staffId!==p.id;});
        markDirty();render();});};
  });
}

function settingsModal(){
  if(readOnly)return;
  var S=state.settings;var roles=JSON.parse(JSON.stringify(state.roles));
  function rolesHtml(){return roles.map(function(r,i){return '<div class="rolerow"><input type="color" data-i="'+i+'" data-k="color" value="'+esc(r.color)+'"><input type="text" data-i="'+i+'" data-k="name" value="'+esc(r.name)+'"><button class="btn ghost" data-rm="'+i+'" title="Remove role">✕</button></div>';}).join('');}
  openModal('<h3>Settings</h3>'+
    '<div class="f"><label>Venue name</label><input name="venue" value="'+esc(S.venue)+'"></div>'+
    '<div class="f2"><div class="f"><label>Labour target (% of takings)</label><input type="number" step="0.5" min="0" name="targetPct" value="'+esc(S.targetPct)+'"></div>'+
    '<div class="f"><label>Employer on-costs (%)</label><input type="number" step="0.5" min="0" name="onCostPct" value="'+esc(S.onCostPct)+'"></div></div>'+
    '<div class="hint">On-costs add employer NI, pension and holiday accrual on top of hourly pay. Leave at 0 to match RotaCloud’s gross-pay figures.</div>'+
    '<div class="f"><label>Week starts on</label><select name="weekStartDay">'+[1,2,3,4,5,6,0].map(function(d){return '<option value="'+d+'"'+(+S.weekStartDay===d?' selected':'')+'>'+DOW[d]+'</option>';}).join('')+'</select></div>'+
    '<div class="f"><label>Opening hours (leave blank if closed)</label>'+[1,2,3,4,5,6,0].map(function(d){var oh=(S.hours||{})[d]||{};return '<div class="rolerow"><span style="width:90px">'+DOW[d]+'</span><input type="time" step="900" data-oh="'+d+'" data-k="open" value="'+esc(oh.open||'')+'"><span>to</span><input type="time" step="900" data-oh="'+d+'" data-k="close" value="'+esc(oh.close||'')+'"></div>';}).join('')+'</div>'+
    '<div class="f"><label>Roles</label><div id="roles">'+rolesHtml()+'</div><button class="btn" data-m="addrole" style="align-self:flex-start">+ Add role</button></div>'+
    '<div class="acts"><button class="btn" data-m="cancel">Cancel</button><button class="btn primary" data-m="ok">Save</button></div>',
  function(b){
    var box=b.querySelector('#roles');
    box.addEventListener('input',function(e){var i=e.target.dataset.i;if(i!=null)roles[i][e.target.dataset.k]=e.target.value;});
    box.addEventListener('click',function(e){var rm=e.target.closest('[data-rm]');if(!rm)return;var r=roles[+rm.dataset.rm];
      if(state.shifts.some(function(s){return s.role===r.id;})||state.staff.some(function(p){return p.role===r.id;})){toast(r.name+' is in use – rename it instead');return;}
      roles.splice(+rm.dataset.rm,1);box.innerHTML=rolesHtml();});
    b.querySelector('[data-m=addrole]').onclick=function(){roles.push({id:uid(),name:'New role',color:'#6b7785'});box.innerHTML=rolesHtml();};
    b.querySelector('[data-m=cancel]').onclick=closeModal;
    b.querySelector('[data-m=ok]').onclick=function(){
      S.venue=b.querySelector('[name=venue]').value.trim()||"Roots";S.targetPct=num(b.querySelector('[name=targetPct]').value);
      S.onCostPct=num(b.querySelector('[name=onCostPct]').value);S.weekStartDay=+b.querySelector('[name=weekStartDay]').value;
      var hrs={};b.querySelectorAll('[data-oh]').forEach(function(el){var d=el.dataset.oh;hrs[d]=hrs[d]||{};hrs[d][el.dataset.k]=el.value;});S.hours=hrs;
      state.roles=roles;viewStart=weekStartFor(viewStart);closeModal();markDirty();render();};
  });
}

function dayHoursModal(d){
  if(readOnly)return;var dt=parseD(d);var cur=openHoursDate(d)||{open:'',close:''};var has=!!(state.settings.hoursOverride||{})[d];
  openModal('<h3>Opening hours \u2013 '+DOW[dt.getDay()]+' '+dt.getDate()+' '+MON[dt.getMonth()]+'</h3><div class="hint" style="margin:0 0 12px">Just this date, e.g. a late opening or bank holiday. Usual '+DOW[dt.getDay()]+' hours are in Settings.</div>'+
    '<div class="f2"><div class="f"><label>Open</label><input type="time" step="900" name="open" value="'+esc(cur.open)+'"></div><div class="f"><label>Close</label><input type="time" step="900" name="close" value="'+esc(cur.close)+'"></div></div>'+
    '<div class="acts">'+(has?'<button class="btn left" data-m="reset">Back to usual hours</button>':'')+'<button class="btn" data-m="closed">Closed this day</button><button class="btn" data-m="cancel">Cancel</button><button class="btn primary" data-m="ok">Save</button></div>',
  function(b){var O=state.settings.hoursOverride=state.settings.hoursOverride||{};
    b.querySelector('[data-m=cancel]').onclick=closeModal;
    b.querySelector('[data-m=closed]').onclick=function(){O[d]={open:'',close:''};closeModal();markDirty();render();};
    var r=b.querySelector('[data-m=reset]');if(r)r.onclick=function(){delete O[d];closeModal();markDirty();render();};
    b.querySelector('[data-m=ok]').onclick=function(){O[d]={open:b.querySelector('[name=open]').value,close:b.querySelector('[name=close]').value};closeModal();markDirty();render();};});
}

/* ---------- week tools ---------- */
function weekShifts(start){var end=addDays(start,6);return state.shifts.filter(function(s){return s.date>=start&&s.date<=end;});}
function replaceWeek(newShifts){var days=weekDays();state.shifts=state.shifts.filter(function(s){return days.indexOf(s.date)<0;}).concat(newShifts);markDirty();render();}
function saveIdeal(){var days=weekDays();
  var go=function(){state.template={savedFrom:viewStart,shifts:weekShifts(viewStart).map(function(s){return {staffId:s.staffId,dayIdx:days.indexOf(s.date),start:s.start,end:s.end,role:s.role,breakMin:s.breakMin,type:s.type};}),
    forecast:days.map(function(d){return num((state.revenue[d]||{}).forecast);})};markDirty();render();toast('Ideal week saved – remember to Save changes');};
  if(state.template)confirmBox('Replace ideal week?','This overwrites the ideal week you saved before with this week’s rota and forecasts.','Replace',go);else go();}
function applyIdeal(){if(!state.template){toast('Save an ideal week first');return;}var days=weekDays();
  confirmBox('Apply ideal week?','All shifts this week are replaced with the ideal rota. Forecasts are filled in where blank. Actual takings are kept.','Apply',function(){
    (state.template.forecast||[]).forEach(function(f,i){var r=state.revenue[days[i]]=state.revenue[days[i]]||{};if(!num(r.forecast)&&f)r.forecast=f;});
    replaceWeek(state.template.shifts.map(function(t){return {id:uid(),staffId:person(t.staffId)?t.staffId:'',date:days[t.dayIdx],start:t.start,end:t.end,role:t.role,breakMin:t.breakMin,type:t.type||'shift'};}).filter(function(s){return s.date&&s.staffId;}));});}
function copyLast(){var prev=addDays(viewStart,-7);var src=weekShifts(prev);if(!src.length){toast('Last week has no shifts');return;}
  confirmBox('Copy last week?','All shifts this week are replaced with last week’s '+src.length+' shifts.','Copy',function(){
    replaceWeek(src.map(function(s){var c=JSON.parse(JSON.stringify(s));c.id=uid();c.date=addDays(s.date,7);return c;}));});}
function clearWeek(){confirmBox('Clear this week?','Every shift and leave entry this week is removed.','Clear',function(){replaceWeek([]);});}

/* ---------- saving ---------- */
function save(){
  if(!dirty||readOnly||save._busy)return;
  var prevSaved=state.savedAt;state.savedAt=new Date().toISOString();
  save._busy=true;setStatus('Saving…');
  sb.rpc('rota_save',{p_state:state,p_version:stateVersion}).then(function(res){save._busy=false;
    var r=res.data;
    if(res.error||!r){state.savedAt=prevSaved;setStatus('Save failed – check the connection and try again');return;}
    if(r.ok){stateVersion=r.version;dirty=false;setStatus();toast('Saved. The staff app is updated too.');return;}
    state.savedAt=prevSaved;
    if(r.error==='conflict'){setStatus('Not saved');
      confirmBox('Someone else saved first',(r.updated_by||'Another manager')+' saved the rota since you opened it. Load their version? Your unsaved changes here will be lost, so note them down first.','Load latest',function(){reloadState(true);});return;}
    if(r.error==='not_manager'){readOnly=true;setStatus();render();toast('Your login can view but not change the rota');return;}
    setStatus('Save failed – try again');
  });
}
function reloadState(force){
  return sb.rpc('rota_load').then(function(res){var r=res.data;if(!r||!r.ok)return;
    if(dirty&&!force)return;
    state=r.state;stateVersion=r.version;dirty=false;ensureClock();closeModal();render();setStatus();
    if(r.updated_by)toast('Showing the latest rota (saved by '+r.updated_by+')');});
}
setInterval(function(){
  if(document.hidden)return;
  sb.rpc('rota_version').then(function(res){var v=res.data;if(!v||v.version<=stateVersion)return;
    if(!dirty&&!document.querySelector('#modal .box'))reloadState(false);
    else setStatus((v.updated_by||'Another manager')+' saved changes – save to see them');});
},30000);

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  if(e.target.closest('a[data-stop]'))return;
  var t=e.target.closest('[data-act]');if(!t)return;
  var menu=e.target.closest('details.menu');var act=t.dataset.act;
  if(menu&&act!=='add'){menu.removeAttribute('open');}
  switch(act){
    case 'prev':viewStart=addDays(viewStart,-7);nav();break;
    case 'next':viewStart=addDays(viewStart,7);nav();break;
    case 'today':viewStart=weekStartFor(fmtD(new Date()));nav();break;
    case 'view-rota':view='rota';nav();break;
    case 'view-times':view='times';nav();break;
    case 'view-staff':view='staff';nav();break;
    case 'signout':if(dirty&&!confirm0())break;sb.auth.signOut().then(function(){try{localStorage.removeItem(KIOSK_KEY);}catch(_){}location.replace(location.pathname);});break;
    case 'view-clock':if(dirty){toast('Save your changes first');break;}enterKiosk();break;
    case 'tadd':if(readOnly)break;entryModal(null,{date:t.dataset.date,staffId:t.dataset.staff,shiftId:t.dataset.shift});break;
    case 'tedit':e.stopPropagation();var en=findEntry(t.dataset.id,t.dataset.date);if(en&&!readOnly)entryModal(en);break;
    case 'approveweek':if(!readOnly)approveWeek();break;
    case 'exportcsv':exportCsv();break;
    case 'clocksettings':clockSettingsModal();break;
    case 'ktile':kioskTap(t.dataset.id);break;
    case 'kmanager':kioskManager();break;
    case 'save':save();break;
    case 'addstaff':staffModal(null);break;
    case 'editstaff':staffModal(person(t.dataset.id));break;
    case 'settings':settingsModal();break;
    case 'dayhours':dayHoursModal(t.dataset.date);break;
    case 'saveideal':if(!readOnly)saveIdeal();break;
    case 'applyideal':if(!readOnly)applyIdeal();break;
    case 'copylast':if(!readOnly)copyLast();break;
    case 'clearweek':if(!readOnly)clearWeek();break;
    case 'edit':e.stopPropagation();var s=state.shifts.filter(function(x){return x.id===t.dataset.id;})[0];if(s)shiftModal(s);break;
    case 'add':shiftModal(null,{date:t.dataset.date,staffId:t.dataset.staff});break;
  }
});
document.addEventListener('click',function(e){document.querySelectorAll('details.menu[open]').forEach(function(d){if(!d.contains(e.target))d.removeAttribute('open');});});
document.addEventListener('change',function(e){var el=e.target;if(!el.dataset||!el.dataset.rev)return;
  var d=el.dataset.date;var r=state.revenue[d]=state.revenue[d]||{};var v=el.value.replace(/[£,\s]/g,'');r[el.dataset.rev]=v===''?'':num(v);markDirty();render();});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&view!=='clock')closeModal();
  if(e.key==='Enter'&&e.target.dataset&&e.target.dataset.rev){e.target.blur();}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();}
});
window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue='';}});
function confirm0(){toast('Save your changes first');return false;}
function hashFor(){return view==='clock'?'#clock':view==='staff'?'#staff':(view==='times'?'#t':'#w')+viewStart.replace(/-/g,'');}
function setHash(){var hsh=hashFor();if(location.hash===hsh)return;try{history.replaceState(null,'',hsh);}catch(e){try{location.hash=hsh;}catch(_){}}}
function hashWeek(){var m=/^#[wt](\d{4})(\d{2})(\d{2})$/.exec(location.hash||'');return m?weekStartFor(m[1]+'-'+m[2]+'-'+m[3]):null;}
function hashView(){var x=location.hash||'';return x==='#staff'?'staff':x==='#clock'?'clock':/^#t\d{8}$/.test(x)?'times':/^#w\d{8}$/.test(x)?'rota':null;}

/* ---------- boot ---------- */
ensureClock();
var kioskFlag=false;try{kioskFlag=localStorage.getItem(KIOSK_KEY)==='1';}catch(_){}
view=hashView()||(kioskFlag?'clock':'rota');
viewStart=hashWeek()||weekStartFor(fmtD(new Date()));
if(!hashWeek()&&!weekShifts(viewStart).length&&weekShifts(addDays(viewStart,7)).length)viewStart=addDays(viewStart,7);
render._day=todayS();render();
window.addEventListener('hashchange',function(){var v=hashView(),w=hashWeek();var ch=false;
  if(v&&v!==view){if(view==='clock'&&kioskLocked())return setHash();view=v;ch=true;}
  if(w&&w!==viewStart){viewStart=w;ch=true;}if(ch){syncWatch();render();}});
function kioskLocked(){var f=false;try{f=localStorage.getItem(KIOSK_KEY)==='1';}catch(_){}return f&&!!clk().managerPin;}
['pointerdown','keydown'].forEach(function(ev){document.addEventListener(ev,kioskIdle,true);});
db=makeDb(sb);dbState='wait';syncWatch();render();setStatus();
downloadsApi={save:function(o){try{var blob=new Blob([o.data],{type:'text/csv'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=o.filename;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1000);return Promise.resolve();}catch(e){return Promise.reject(e);}}};
};
