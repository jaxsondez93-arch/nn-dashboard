const $=id=>document.getElementById(id);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const RANGES=[['live','Live (30 min)'],['run','Since last stop'],['1h','1 hour'],['6h','6 hours'],['24h','24 hours'],['7d','7 days'],['all','All']];
const PANELS=[['summary','This-period summary'],['trend','Trend table (least squares)'],['corr','Correlation matrix (Pearson)'],['scatter','Scatter plot'],['roll','Rolling correlation'],['reg','Variance explained (R² regression)'],['loss','Training loss'],['eval','Validation regret'],['rate','Training speed'],['temp','CPU temperature'],['bat','Battery'],['mem','Memory'],['gaps','Machine stops'],['cks','Checkpoints']];
const DEF={range:'run',refresh:15,smooth:0,unit:'C',baselines:true,compact:false,trend:true,bandtype:'conf',clevel:95,bmethod:'analytic',fitwin:'all',cmode:'raw',cx:'temp',cy:'spm',cshow:'r',rtarget:'spm',rpreds:['load','temp'],hidden:{}};
const FITS={};
let prefs=Object.assign({},DEF,{hidden:{}}),last=null,timer=null;
try{const p=JSON.parse(localStorage.getItem('nn-dash-prefs')||'null');if(p)prefs=Object.assign({},DEF,p,{hidden:Object.assign({},p.hidden||{})})}catch(e){}
const save=()=>{try{localStorage.setItem('nn-dash-prefs',JSON.stringify(prefs))}catch(e){}};
const fmtT=s=>new Date(s*1000).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const fmtH=s=>new Date(s*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const dur=s=>{if(s==null)return'–';s=Math.max(0,s);const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m ${Math.floor(s%60)}s`};
const n0=x=>x==null?'–':Math.round(x).toLocaleString();
const f2=x=>x==null?'–':(+x).toFixed(3);
const pct=x=>x==null?'–':Math.round(x*100)+'%';
const tc=c=>c==null?null:(prefs.unit==='F'?c*9/5+32:c);
const tu=()=>prefs.unit==='F'?'°F':'°C';
function nice(lo,hi,n){if(hi===lo){hi=lo+1}const r=(hi-lo)/n,p=Math.pow(10,Math.floor(Math.log10(r))),m=r/p,s=(m<1.5?1:m<3?2:m<7?5:10)*p;const a=Math.floor(lo/s)*s,t=[];for(let v=a;v<=hi+s*.5;v+=s)t.push(+v.toFixed(10));return t}
function smooth(pts,w){if(w<2)return pts;return pts.map((p,i)=>{const a=Math.max(0,i-w+1),sl=pts.slice(a,i+1);return[p[0],sl.reduce((t,q)=>t+q[1],0)/sl.length]})}
/* ---- least squares: y = yb + b (x - xb). Residual lag-1 autocorrelation r1 widens the interval (neighbouring training points are not independent). */
/* ---- confidence level, t quantile, and bands (analytic + moving-block bootstrap) ---- */
const ZT={80:1.2816,90:1.6449,95:1.96,99:2.5758};
const level=()=>+prefs.clevel||95,zq=()=>ZT[level()]||1.96;
function tq(df){                                   // two-sided t critical value at the chosen level (bisection on the exact t distribution)
  if(!(df>=1))return NaN;if(df>=300)return zq();const a=1-level()/100;let lo=0,hi=400;
  for(let i=0;i<70;i++){const m=(lo+hi)/2;if(ibeta(df/(df+m*m),df/2,.5)>a)lo=m;else hi=m}return(lo+hi)/2}
function bandAt(f,x,kind){                        // half-width at x. Autocorrelation widens the uncertainty of the LINE (infl^2); a new point's own noise (the "1") is not inflated.
  const h=1/f.n+(x-f.xb)*(x-f.xb)/f.sxx;return f.t*Math.sqrt(f.s2*((kind==='pred'?1:0)+f.infl*f.infl*h))}
function confAt(f,x){const m=f.yb+f.b*(x-f.xb);if(f.boot){const xs=f.boot.xs,N=xs.length-1;let i=Math.round((x-xs[0])/((xs[N]-xs[0])||1)*N);i=Math.max(0,Math.min(N,i));return[f.boot.lo[i],f.boot.hi[i]]}const h=bandAt(f,x,'conf');return[m-h,m+h]}
function mulberry(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function bootBand(pts,f,N,B){                      // moving-block bootstrap of the fitted line (blocks keep the autocorrelation); seeded so the display is stable
  const n=pts.length,r=Math.max(0,Math.min(.9,f.r1)),L=Math.max(2,Math.min(Math.floor(n/2),Math.round(Math.cbrt(n)*(1+r)/(1-r)))),rnd=mulberry(12345+n),runs=B||400;
  const xs=[];for(let i=0;i<=N;i++)xs.push(f.x0+(f.x1-f.x0)*i/N);
  const vals=xs.map(()=>[]),slopes=[];
  for(let b=0;b<runs;b++){const idx=[];while(idx.length<n){const st=Math.floor(rnd()*(n-L+1));for(let k=0;k<L&&idx.length<n;k++)idx.push(st+k)}
    let sx=0,sy=0;for(const i of idx){sx+=pts[i][0];sy+=pts[i][1]}const mx=sx/n,my=sy/n;let sxx=0,sxy=0;for(const i of idx){const dx=pts[i][0]-mx;sxx+=dx*dx;sxy+=dx*(pts[i][1]-my)}
    if(!(sxx>0))continue;const bb=sxy/sxx;slopes.push(bb);xs.forEach((x,g)=>vals[g].push(my+bb*(x-mx)))}
  const al=(1-level()/100)/2,q=(a,p)=>{const c=a.slice().sort((u,v)=>u-v);return c[Math.min(c.length-1,Math.max(0,Math.floor(p*(c.length-1))))]};
  return{xs,lo:vals.map(a=>q(a,al)),hi:vals.map(a=>q(a,1-al)),sl:[q(slopes,al),q(slopes,1-al)],L,B:slopes.length};
}
function bandLabel(){const bt=prefs.bandtype||'conf';if(bt==='off')return'';const m=prefs.bmethod==='bootstrap'?'block-bootstrap ':'';return ` · ${level()}% `+(bt==='pred'?'prediction band':bt==='both'?m+'confidence + prediction bands':m+'confidence band')}
function scBand(f,X,Y,a,b,y0,y1,cid){             // bands for the scatter-plot regression line (analytic)
  const bt=prefs.bandtype||'conf';if(bt==='off')return'';const N=24,cl=v=>Math.max(y0,Math.min(y1,v));
  const mk=(h,op)=>{let up='',lo=[];for(let i=0;i<=N;i++){const x=a+(b-a)*i/N,m=f.yb+f.b*(x-f.xb),w=h(x);up+=(i?'L':'M')+X(x).toFixed(1)+' '+Y(cl(m+w)).toFixed(1);lo.push('L'+X(x).toFixed(1)+' '+Y(cl(m-w)).toFixed(1))}return `<path clip-path="url(#${cid})" d="${up}${lo.reverse().join('')}Z" fill="${css('--ink')}" opacity="${op}" stroke="none"/>`};
  return(bt==='pred'||bt==='both'?mk(x=>bandAt(f,x,'pred'),.07):'')+(bt==='conf'||bt==='both'?mk(x=>bandAt(f,x,'conf'),.16):'');
}
function tcrit(df){const T=[0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,2.120,2.110,2.101,2.093,2.086,2.080,2.074,2.069,2.064,2.060,2.056,2.052,2.048,2.045,2.042];return df<1?NaN:df<=30?T[df]:df<=60?2.0:1.96}
function ols(pts){
  const n=pts.length;if(n<4)return null;
  let xs=0,ys=0;for(const p of pts){xs+=p[0];ys+=p[1]}
  const xb=xs/n,yb=ys/n;let sxx=0,sxy=0,syy=0;
  for(const p of pts){const dx=p[0]-xb,dy=p[1]-yb;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy}
  if(!(sxx>0))return null;
  const b=sxy/sxx;let sse=0,num=0,den=0,prev=null;
  for(const p of pts){const e=(p[1]-yb)-b*(p[0]-xb);sse+=e*e;den+=e*e;if(prev!==null)num+=e*prev;prev=e}
  const s2=sse/(n-2),seb=Math.sqrt(s2/sxx),r1=den>0?Math.max(-0.9,Math.min(0.95,num/den)):0,infl=r1>0?Math.sqrt((1+r1)/(1-r1)):1,t=tq(n-2),seadj=seb*infl;
  return{n,b,xb,yb,sxx,s2,r2:syy>0?1-sse/syy:0,seb,seadj,r1,infl,t,ci:[b-t*seadj,b+t*seadj],x0:pts[0][0],x1:pts[n-1][0]};
}
function fitPoints(pts,o){
  let p=pts.slice().sort((a,b)=>a[0]-b[0]);
  if(o.trend&&o.trend.segment&&o.breakGap){let k=p.length-1;while(k>0&&p[k][0]-p[k-1][0]<=o.breakGap)k--;p=p.slice(k)}   // time charts: latest continuous stretch only
  const frac=prefs.fitwin==='half'?.5:prefs.fitwin==='quarter'?.25:1;
  if(frac<1)p=p.slice(-Math.max(4,Math.ceil(p.length*frac)));
  const f=ols(p);
  if(f){f.pts=p;let inn=0;for(const q of p){if(Math.abs(q[1]-(f.yb+f.b*(q[0]-f.xb)))<=bandAt(f,q[0],'pred'))inn++}f.cov=inn/p.length;   // calibration: share of points inside the prediction band
    if(prefs.bmethod==='bootstrap')f.boot=bootBand(p,f,24)}
  return f;
}
function chart(id,o){
  const svg=$('ch-'+id),W=640,H=250,L=52,R=12,T=10,B=28,tip=$('tip-'+id);
  const all=o.series.flatMap(s=>s.pts);
  FITS[id]=null;
  const fit=(prefs.trend&&o.trend&&all.length)?fitPoints(o.fitPts||o.series[0].pts,o):null;FITS[id]=fit;
  if(!all.length){svg.innerHTML=`<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="${css('--mute')}" font-size="13">no data in this period</text>`;$('lg-'+id).innerHTML='';svg.onmousemove=null;return}
  let x0=Math.min(...all.map(p=>p[0])),x1=Math.max(...all.map(p=>p[0]));
  let y0=o.yMin??Math.min(...all.map(p=>p[1])),y1=o.yMax??Math.max(...all.map(p=>p[1]));
  (o.hlines||[]).forEach(h=>{y0=Math.min(y0,h.y);y1=Math.max(y1,h.y)});
  const pad=(y1-y0||1)*.06;if(o.yMin==null)y0-=pad;if(o.yMax==null)y1+=pad;
  const yt=nice(y0,y1,5);y0=Math.min(y0,yt[0]);y1=Math.max(y1,yt[yt.length-1]);if(x1===x0){x0-=30;x1+=30}
  const X=v=>L+(v-x0)/(x1-x0)*(W-L-R),Y=v=>T+(1-(v-y0)/(y1-y0))*(H-T-B);
  const short=(x1-x0)<2*86400,fx=v=>o.xKind==='time'?(short?fmtH(v):fmtT(v)):(v>=1e6?(v/1e6).toFixed(2)+'M':v>=1e3?Math.round(v/1e3)+'k':Math.round(v));
  let g='<g class="axis">';
  yt.forEach(v=>{g+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${css('--grid')}"/><text x="${L-6}" y="${Y(v)+3}" text-anchor="end">${(o.yFmt||(a=>+a.toPrecision(4)))(v)}</text>`});
  nice(x0,x1,5).filter(v=>v>=x0&&v<=x1).forEach(v=>{g+=`<text x="${X(v)}" y="${H-8}" text-anchor="middle">${fx(v)}</text>`});
  g+='</g>';
  (o.hlines||[]).forEach(h=>{g+=`<line x1="${L}" x2="${W-R}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color||css('--bad')}" stroke-dasharray="4 4" opacity=".8"/><text x="${W-R-2}" y="${Y(h.y)-3}" text-anchor="end" fill="${h.color||css('--bad')}" font-size="10.5">${h.label}</text>`});
  (o.bands||[]).forEach(bd=>{if(!bd.pts.length)return;let up='',lo=[];const cl=v=>Math.max(y0,Math.min(y1,v));
    bd.pts.forEach((p,i)=>{up+=(i?'L':'M')+X(p[0]).toFixed(1)+' '+Y(cl(p[2])).toFixed(1);lo.push('L'+X(p[0]).toFixed(1)+' '+Y(cl(p[1])).toFixed(1))});
    g+=`<path d="${up}${lo.reverse().join('')}Z" fill="${bd.color}" opacity="${bd.op||.15}" stroke="none"/>`});
  o.series.forEach(s=>{
    let d='',prev=null;
    s.pts.forEach(p=>{const brk=o.breakGap&&prev!==null&&p[0]-prev>o.breakGap;d+=(prev===null||brk?'M':'L')+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1);prev=p[0]});
    if(s.pts.length===1)d+=` m-2 0 h4`;
    g+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w||1.8}" ${s.dash?'stroke-dasharray="5 4"':''} stroke-linejoin="round"/>`;
    if(s.pts.length<=40)s.pts.forEach(p=>{g+=`<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.6" fill="${s.color}"/>`});
  });
  if(fit){
    const yy=x=>fit.yb+fit.b*(x-fit.xb),cl=v=>Math.max(y0,Math.min(y1,v));
    const bt=prefs.bandtype||'conf',N=24;
    const poly=(f,op)=>{let up='',lo=[];for(let i=0;i<=N;i++){const x=fit.x0+(fit.x1-fit.x0)*i/N,ab=f(x);up+=(i?'L':'M')+X(x).toFixed(1)+' '+Y(cl(ab[1])).toFixed(1);lo.push('L'+X(x).toFixed(1)+' '+Y(cl(ab[0])).toFixed(1))}return `<path d="${up}${lo.reverse().join('')}Z" fill="${css('--ink')}" opacity="${op}" stroke="none"/>`};
    if(bt==='pred'||bt==='both')g+=poly(x=>{const m=yy(x),h=bandAt(fit,x,'pred');return[m-h,m+h]},.07);
    if(bt==='conf'||bt==='both')g+=poly(x=>confAt(fit,x),.16);
    g+=`<line x1="${X(fit.x0).toFixed(1)}" y1="${Y(cl(yy(fit.x0))).toFixed(1)}" x2="${X(fit.x1).toFixed(1)}" y2="${Y(cl(yy(fit.x1))).toFixed(1)}" stroke="${css('--ink')}" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>`;
  }
  svg.innerHTML=g+`<line id="cur-${id}" y1="${T}" y2="${H-B}" stroke="${css('--mute')}" opacity="0"/>`;
  $('lg-'+id).innerHTML=o.series.map(s=>`<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')+(fit?`<span><i style="background:repeating-linear-gradient(90deg,${css('--ink')} 0 2px,transparent 2px 6px)"></i>least-squares trend${bandLabel()} · R² ${fit.r2.toFixed(2)}</span>`:'')+(o.note?`<span>· ${o.note}</span>`:'');
  const panel=svg.parentElement;
  svg.onmousemove=e=>{const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*W;const xv=x0+(px-L)/(W-L-R)*(x1-x0);
    let lines=[],bx=null;o.series.forEach(s=>{let best=null;s.pts.forEach(p=>{if(best===null||Math.abs(p[0]-xv)<Math.abs(best[0]-xv))best=p});if(best){bx=best[0];lines.push(`${s.name}: ${(o.yFmt||(a=>+a.toPrecision(5)))(best[1])}`)}});
    if(fit&&bx!==null&&bx>=fit.x0&&bx<=fit.x1){const fy=o.yFmt||(a=>+a.toPrecision(5)),m=fit.yb+fit.b*(bx-fit.xb),bt=prefs.bandtype||'conf';let t='trend: '+fy(m);
      if(bt==='conf'||bt==='both'){const c=confAt(fit,bx);t+=` · ${level()}% confidence ${fy(c[0])} to ${fy(c[1])}`}
      if(bt==='pred'||bt==='both'){const h=bandAt(fit,bx,'pred');t+=` · prediction ${fy(m-h)} to ${fy(m+h)}`}
      lines.push(t)}
    if(bx===null)return;const cur=$('cur-'+id);cur.setAttribute('x1',X(bx));cur.setAttribute('x2',X(bx));cur.setAttribute('opacity','.5');
    tip.style.display='block';tip.innerHTML=(o.xKind==='time'?fmtT(bx):'step '+n0(bx))+'<br>'+lines.join('<br>');
    const pr=panel.getBoundingClientRect();tip.style.left=Math.min(e.clientX-pr.left+12,pr.width-170)+'px';tip.style.top=(e.clientY-pr.top+12)+'px'};
  svg.onmouseleave=()=>{tip.style.display='none';const c=$('cur-'+id);if(c)c.setAttribute('opacity','0')};
}
const row=(a,b,cls)=>`<div class="row"><span>${a}</span><b${cls?` style="color:var(--${cls})"`:''}>${b}</b></div>`;
function renderControls(){
  $('ranges').innerHTML=RANGES.map(r=>`<button type="button" data-range="${r[0]}" aria-pressed="${prefs.range===r[0]}">${r[1]}</button>`).join('');
  const sel=(k,opts)=>`<select data-k="${k}">${opts.map(o=>`<option value="${o[0]}"${String(prefs[k])===String(o[0])?' selected':''}>${o[1]}</option>`).join('')}</select>`;
  $('custom').innerHTML=
   `<div class="grp">Display</div>
    <label>Auto-refresh ${sel('refresh',[[5,'5 s'],[15,'15 s'],[30,'30 s'],[60,'60 s'],[0,'off (manual)']])}</label>
    <label>Loss smoothing ${sel('smooth',[[0,'none'],[5,'5 points'],[15,'15 points'],[40,'40 points']])}</label>
    <label>Temperature ${sel('unit',[['C','°C'],['F','°F']])}</label>
    <label><input type="checkbox" data-k="baselines"${prefs.baselines?' checked':''}> Show baselines on validation chart</label>
    <label><input type="checkbox" data-k="compact"${prefs.compact?' checked':''}> Compact cards (headline numbers only)</label>
    <div class="grp">Trend lines (least squares)</div>
    <label><input type="checkbox" data-k="trend"${prefs.trend?' checked':''}> Show trend lines on charts</label>
    <label>Band type ${sel('bandtype',[['conf','confidence (where the true line lies)'],['pred','prediction (where new points should fall)'],['both','both'],['off','none']])}</label>
    <label>Confidence level ${sel('clevel',[[80,'80%'],[90,'90%'],[95,'95%'],[99,'99%']])}</label>
    <label>Band method ${sel('bmethod',[['analytic','analytic (t-distribution)'],['bootstrap','block bootstrap (no distribution assumed)']])}</label>
    <label>Fit on ${sel('fitwin',[['all','whole period'],['half','last half of the points'],['quarter','last quarter of the points']])}</label>
    <div class="grp">Correlation (Pearson)</div>
    <label>Compute on ${sel('cmode',[['raw','raw values'],['detrend','detrended (remove trends first)'],['diff','changes between time bins']])}</label>
    <label>Matrix shows ${sel('cshow',[['r','r (direction and strength)'],['r2','R² (share of variance explained)']])}</label>
    <div class="grp">Show these sections</div>`+
   PANELS.map(p=>`<label><input type="checkbox" data-panel="${p[0]}"${prefs.hidden[p[0]]?'':' checked'}> ${p[1]}</label>`).join('')+
   `<div class="grp">&nbsp;</div><label><button type="button" data-reset="1">Reset to defaults</button> <button type="button" data-refreshnow="1">Refresh now</button></label>`;
}
function applyLayout(){
  PANELS.forEach(p=>{const el=$('panel-'+p[0]);if(el&&el.style)el.style.display=prefs.hidden[p[0]]?'none':''});
  const w=$('wrap');if(w&&w.classList){if(prefs.compact)w.classList.add('compact');else w.classList.remove('compact')}
}
function onControl(e){
  const t=e.target,d=t.dataset||{};
  if(d.range){prefs.range=d.range}
  else if(d.reset){prefs=Object.assign({},DEF,{hidden:{}})}
  else if(d.refreshnow){}
  else if(d.panel){prefs.hidden[d.panel]=!t.checked}
  else if(d.rp){const set=new Set(prefs.rpreds||[]);if(t.checked)set.add(d.rp);else set.delete(d.rp);prefs.rpreds=[...set]}
  else if(d.k){const v=t.type==='checkbox'?t.checked:t.value;prefs[d.k]=(d.k==='refresh'||d.k==='smooth')?+v:v}
  else return;
  save();renderControls();applyLayout();
  if(d.range||d.reset||d.refreshnow)tick();else if(last)render(last);
}
function periodText(s){
  const label=(RANGES.find(r=>r[0]===s.range)||[0,'?'])[1];
  const span=s.range==='all'?'whole history':`${fmtT(s.since)} → now (${dur(s.now-s.since)})`;
  return `<b>${label}</b> · ${span}`+(s.range==='run'?' · the period since the last time the machine or trainer stopped':'');
}
function render(s){
  last=s;applyLayout();
  const tr=s.services.train,lb=s.services.label,h=s.host,tl=s.train_last,hbAge=s.heartbeat_age_s,sm=s.summary;
  $('upd').textContent='updated '+new Date(s.now*1000).toLocaleTimeString();
  $('period').innerHTML=periodText(s);
  let b='';
  if(hbAge!=null&&hbAge>180)b+=`<div class="banner bad"><b>No heartbeat for ${dur(hbAge)}.</b> The trainer or the whole machine has stopped (or is suspended).</div>`;
  if(tr.ActiveState!=='active')b+=`<div class="banner bad"><b>Trainer is ${tr.ActiveState||'unknown'}.</b></div>`;
  if(!s.config.rays_on)b+=`<div class="banner"><b>Ray features are off in this run:</b> no config.json with launch_xy in the data directory, so the model's geometric inputs are all zero. More training steps are not expected to help.</div>`;
  if(h.ac==='0')b+=`<div class="banner bad"><b>On battery (${h.bat_pct}%).</b> Plug in to keep training running.</div>`;
  if((h.pkg_temp_c||0)>=90)b+=`<div class="banner"><b>CPU at ${Math.round(tc(h.pkg_temp_c))} ${tu()}</b> and being throttled. Training runs slower than the clock suggests.</div>`;
  if(!b)b='<div class="banner ok">All checks normal.</div>';
  $('banners').innerHTML=b;
  const ck=s.checkpoints.length?s.checkpoints[s.checkpoints.length-1]:null;
  const spm=s.rate.length?s.rate[s.rate.length-1].spm:null;
  $('cards').innerHTML=[
   `<div class="card"><h3>Trainer (now)</h3><div class="big"><span class="dot ${tr.ActiveState==='active'?'ok':'bad'}"></span>${tr.ActiveState||'?'}</div>${row('step',n0(tl&&tl.step))}${row('loss',f2(tl&&tl.loss))}${row('steps / min',n0(spm))}${row('restarts',tr.NRestarts??'–')}</div>`,
   `<div class="card"><h3>Labeler</h3><div class="big"><span class="dot ${lb.ActiveState==='active'?'ok':'bad'}"></span>${lb.ActiveState||'?'}</div>${row('labels',n0(s.dataset.labels)+' / '+n0(s.dataset.boards))}${row('manifest',n0(s.dataset.manifest))}${row('note',s.dataset.labels===s.dataset.boards?'complete (idle)':'working')}</div>`,
   `<div class="card"><h3>Machine (now)</h3><div class="big">${h.pkg_temp_c==null?'–':Math.round(tc(h.pkg_temp_c))+' '+tu()}</div>${row('uptime',dur(h.uptime_s))}${row('power',(h.ac==='1'?'AC':'battery')+' · '+(h.bat_pct??'–')+'% '+(h.bat_status||''),h.ac==='1'?'':'bad')}${row('CPU clock',(h.cpu_mhz||'–')+' MHz')}${row('load',h.load1)}</div>`,
   `<div class="card"><h3>Memory &amp; disk</h3><div class="big">${n0(h.mem_avail_mb)} MB</div>${row('swap used',n0(h.swap_used_mb)+' MB')}${row('mem pressure',h.psi_memory60??'–')}${row('disk free',(h.disk_free_gb??'–')+' GB')}</div>`,
   `<div class="card"><h3>Latest checkpoint</h3><div class="big">${ck?dur(s.now-ck.mtime):'–'} ago</div>${row('file',ck?ck.name.replace('.npz',''):'–')}${row('best.npz',s.best?('val '+s.best.val_regret+' @ '+n0(s.best.step)):'–')}${row('stops ever seen',s.n_gaps)}</div>`,
  ].join('');
  const dl=sm.loss_first!=null&&sm.loss_last!=null?sm.loss_last-sm.loss_first:null;
  $('sum-sub').textContent='Numbers for the selected period only.';
  $('summary').innerHTML=[
   row('period length',dur(sm.period_s)),row('trainer running',dur(sm.running_s)+' ('+pct(sm.availability)+')'),
   row('steps trained',n0(sm.steps)),row('average speed',sm.spm==null?'–':n0(sm.spm)+' steps/min'),
   row('loss, first → last',sm.loss_first==null?'–':f2(sm.loss_first)+' → '+f2(sm.loss_last)+(dl==null?'':' ('+(dl>0?'+':'')+dl.toFixed(3)+')')),row('lowest loss',f2(sm.loss_min)),
   row('CPU min / avg / max',sm.temp_max==null?'–':Math.round(tc(sm.temp_min))+' / '+Math.round(tc(sm.temp_mean))+' / '+Math.round(tc(sm.temp_max))+' '+tu()),row('time at 90 °C or above',pct(sm.temp_hot_share)),
   row('stops in period',sm.stops+(sm.stops?' ('+dur(sm.stopped_s)+' down)':'')),
  ].join('');
  // charts
  chart('loss',{xKind:'step',trend:{},fitPts:s.train.filter(r=>r.loss!=null).map(r=>[r.step,r.loss]),series:[{name:'loss'+(prefs.smooth>1?` (smoothed ${prefs.smooth})`:''),color:css('--c1'),pts:smooth(s.train.filter(r=>r.loss!=null).map(r=>[r.step,r.loss]),prefs.smooth)}],yFmt:v=>v.toFixed(3)});
  const ev=s.eval.filter(e=>e.n_val>=50),keys=[['net','net (the model)','--c1',2.4,0],['random30','random 30','--c2',1.4,1],['stride26','stride 26','--c3',1.4,1],['heuristic','heuristic','--c4',1.4,1],['stride8','stride 8 (~98 aims)','--c5',1.4,1]].filter(k=>k[0]==='net'||prefs.baselines);
  chart('eval',{xKind:'step',trend:{},note:ev.length+' eval'+(ev.length===1?'':'s')+' in period',series:keys.map(k=>({name:k[1],color:css(k[2]),w:k[3],dash:k[4],pts:ev.map(e=>[e.step,e.hp[k[0]]]).filter(p=>p[1]!=null)})),yFmt:v=>v.toFixed(2)});
  chart('rate',{xKind:'time',breakGap:600,trend:{segment:true},series:[{name:'steps / min',color:css('--c3'),pts:s.rate.map(r=>[r.t,r.spm])}],yMin:0,yFmt:v=>Math.round(v)});
  chart('temp',{xKind:'time',breakGap:600,trend:{segment:true},series:[{name:'CPU '+tu(),color:css('--c5'),pts:s.hb.filter(r=>r.cpu_c!=null).map(r=>[r.t,tc(r.cpu_c)])}],hlines:[{y:tc(90),label:Math.round(tc(90))+' hot',color:css('--warn')},{y:tc(100),label:Math.round(tc(100))+' critical',color:css('--bad')}],yFmt:v=>Math.round(v)});
  chart('bat',{xKind:'time',breakGap:600,trend:{segment:true},series:[{name:'battery %',color:css('--c4'),pts:s.hb.filter(r=>r.bat!=null).map(r=>[r.t,+r.bat])}],yMin:0,yMax:100,yFmt:v=>Math.round(v)});
  chart('mem',{xKind:'time',breakGap:900,trend:{segment:true},series:[{name:'MB available',color:css('--c1'),pts:s.samples.map(r=>[r.t,+r.mem])}],yMin:0,yFmt:v=>Math.round(v)});
  renderTrend();
  renderCorr(s);
  renderReg(s);
  $('gaps').innerHTML=s.gaps.length?`<table><tr><th>stopped</th><th>resumed</th><th>length</th><th>battery before → after</th><th>CPU before</th></tr>${s.gaps.slice().reverse().map(g=>`<tr><td>${fmtT(g.start)}</td><td>${fmtT(g.end)}</td><td>${g.hours} h</td><td>${g.bat_before}% → ${g.bat_after}%</td><td>${g.temp_before==null?'–':Math.round(tc(g.temp_before))+' '+tu()}</td></tr>`).join('')}</table>`:'<span class="sub">no stops in this period</span>';
  $('cks').innerHTML=`<table><tr><th>file</th><th>size</th><th>age</th></tr>${s.checkpoints.slice().reverse().map(c=>`<tr><td>${c.name}</td><td>${(c.size/1048576).toFixed(2)} MB</td><td>${dur(s.now-c.mtime)}</td></tr>`).join('')}</table>`;
}
/* ---- Pearson correlation on a shared time grid (bins aligned by the server) ---- */
const CV=[['loss','Training loss','loss'],['gn','Gradient norm','grad'],['spm','Steps per minute','speed'],['temp','CPU temperature','temp'],['load','CPU load','load'],['thr','Throttle events per second','throttle'],['mhz','CPU clock (MHz)','MHz'],['mem','Memory available (MB)','memory']];
const cvName=k=>(CV.find(v=>v[0]===k)||[0,k])[1],cvShort=k=>(CV.find(v=>v[0]===k)||[0,0,k])[2];
let BIN=60,CORR=null;
function pearson(xs,ys){                      // xs, ys: equal-length arrays with no nulls
  const n=xs.length;if(n<4)return null;
  let mx=0,my=0;for(let i=0;i<n;i++){mx+=xs[i];my+=ys[i]}mx/=n;my/=n;
  let sxx=0,syy=0,sxy=0;for(let i=0;i<n;i++){const a=xs[i]-mx,b=ys[i]-my;sxx+=a*a;syy+=b*b;sxy+=a*b}
  if(!(sxx>0&&syy>0))return null;
  const r=sxy/Math.sqrt(sxx*syy);
  const lag=(v,m)=>{let nu=0,de=0;for(let i=0;i<n;i++){const d=v[i]-m;de+=d*d;if(i)nu+=d*(v[i-1]-m)}return de>0?nu/de:0};
  const rx=lag(xs,mx),ry=lag(ys,my),pr=rx*ry;                       // Bartlett: effective n shrinks when both series are autocorrelated
  const neff=Math.max(4,Math.min(n,n*(1-pr)/(1+pr)));
  let ci=null;if(neff>3.01){const z=Math.atanh(Math.max(-.9999,Math.min(.9999,r))),se=1/Math.sqrt(neff-3);ci=[Math.tanh(z-zq()*se),Math.tanh(z+zq()*se)]}
  return{n,r,r2:r*r,neff,ci,rx,ry,sig:!!ci&&(ci[0]>0||ci[1]<0)};
}
function cvSeries(al,mode){
  const out={};
  CV.forEach(([k])=>{
    const raw=al.map(r=>r[k]==null||!isFinite(r[k])?null:+r[k]);
    if(mode==='diff'){const o=raw.map(()=>null);let pi=-1;for(let i=0;i<raw.length;i++){if(raw[i]==null)continue;if(pi>=0&&al[i].t-al[pi].t<=1.5*BIN)o[i]=raw[i]-raw[pi];pi=i}out[k]=o;return}
    if(mode==='detrend'){const pts=[];raw.forEach((v,i)=>{if(v!=null)pts.push([al[i].t,v])});const f=ols(pts);out[k]=raw.map((v,i)=>v==null||!f?null:v-(f.yb+f.b*(al[i].t-f.xb)));return}
    out[k]=raw;
  });
  return out;
}
function pairArrays(al,S,a,b){const xs=[],ys=[],ts=[];for(let i=0;i<al.length;i++){const x=S[a][i],y=S[b][i];if(x!=null&&y!=null){xs.push(x);ys.push(y);ts.push(al[i].t)}}return{xs,ys,ts}}
const strength=r=>{const a=Math.abs(r);return a<.1?'negligible':a<.3?'weak':a<.5?'moderate':a<.7?'strong':'very strong'};
function corrMatrix(al,mode){
  const S=cvSeries(al,mode),M={};
  CV.forEach(([a],i)=>CV.forEach(([b],j)=>{if(j<i)return;if(i===j){M[a+'|'+b]={r:1,diag:true};return}const p=pairArrays(al,S,a,b),c=pearson(p.xs,p.ys);M[a+'|'+b]=c;M[b+'|'+a]=c}));
  return{S,M};
}
function scatterDraw(pts,xl,yl,svgId,diag,hw){
  const svg=$(svgId?'ch-'+svgId:'ch-scatter'),W=640,H=300,L=58,R=14,T=12,B=40;
  if(pts.length<2){svg.innerHTML=`<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="${css('--mute')}" font-size="13">no data in this period</text>`;return}
  let x0=Math.min(...pts.map(p=>p[0])),x1=Math.max(...pts.map(p=>p[0])),y0=Math.min(...pts.map(p=>p[1])),y1=Math.max(...pts.map(p=>p[1]));
  if(x1===x0){x0-=1;x1+=1}if(y1===y0){y0-=1;y1+=1}
  const px=(x1-x0)*.05,py=(y1-y0)*.05;x0-=px;x1+=px;y0-=py;y1+=py;
  const X=v=>L+(v-x0)/(x1-x0)*(W-L-R),Y=v=>T+(1-(v-y0)/(y1-y0))*(H-T-B);
  let g=`<defs><clipPath id="sclip${svgId||''}"><rect x="${L}" y="${T}" width="${W-L-R}" height="${H-T-B}"/></clipPath></defs><g class="axis">`;
  nice(y0,y1,5).filter(v=>v>=y0&&v<=y1).forEach(v=>{g+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${css('--grid')}"/><text x="${L-6}" y="${Y(v)+3}" text-anchor="end">${fnum(v)}</text>`});
  nice(x0,x1,6).filter(v=>v>=x0&&v<=x1).forEach(v=>{g+=`<line y1="${T}" y2="${H-B}" x1="${X(v)}" x2="${X(v)}" stroke="${css('--grid')}"/><text x="${X(v)}" y="${H-B+14}" text-anchor="middle">${fnum(v)}</text>`});
  g+=`<text x="${(L+W-R)/2}" y="${H-6}" text-anchor="middle">${xl}</text><text transform="translate(12 ${(T+H-B)/2}) rotate(-90)" text-anchor="middle">${yl}</text></g>`;
  const n=pts.length;
  pts.forEach((p,i)=>{g+=`<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3.2" fill="${css('--c1')}" opacity="${(.25+.7*i/Math.max(1,n-1)).toFixed(2)}"/>`});
  const f=ols(pts);                                  // time order, so the residual autocorrelation (and the band width) is meaningful
  const cid='sclip'+(svgId||'');
  if(diag){const m0=Math.min(x0,y0),m1=Math.max(x1,y1);if(hw&&(prefs.bandtype||'conf')!=='off')g+=`<path clip-path="url(#${cid})" d="M${X(m0)} ${Y(m0-hw)}L${X(m1)} ${Y(m1-hw)}L${X(m1)} ${Y(m1+hw)}L${X(m0)} ${Y(m0+hw)}Z" fill="${css('--ink')}" opacity=".08" stroke="none"/>`;g+=`<line clip-path="url(#${cid})" x1="${X(m0)}" y1="${Y(m0)}" x2="${X(m1)}" y2="${Y(m1)}" stroke="${css('--ink')}" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>`}
  else if(f){const yy=x=>f.yb+f.b*(x-f.xb);g+=scBand(f,X,Y,x0+px,x1-px,y0,y1,cid);g+=`<line clip-path="url(#${cid})" x1="${X(x0)}" y1="${Y(yy(x0))}" x2="${X(x1)}" y2="${Y(yy(x1))}" stroke="${css('--ink')}" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>`}
  svg.innerHTML=g+`<text x="${W-R}" y="${T+10}" text-anchor="end" font-size="10.5" fill="${css('--mute')}">${diag?'dashed = perfect prediction'+(hw&&(prefs.bandtype||'conf')!=='off'?`, shaded ≈ ±${fnum(hw)} (${level()}%)`:'')+' · ':''}darker = more recent</text>`;
}
function renderScatter(s,cur){
  const al=s.aligned||[],mode=prefs.cmode,sx=$('sstats');
  const sel=k=>`<select data-k="${k}">${CV.map(v=>`<option value="${v[0]}"${prefs[k]===v[0]?' selected':''}>${v[1]}</option>`).join('')}</select>`;
  $('pairsel').innerHTML=`<label>x ${sel('cx')}</label><label>y ${sel('cy')}</label>`;
  if(!cur||prefs.cx===prefs.cy){sx.innerHTML='<span class="sub">Pick two different metrics (or there is not enough data in this period).</span>';scatterDraw([],'','');chart('roll',{xKind:'time',series:[{name:'rolling r',color:css('--c1'),pts:[]}]});return}
  const S=cvSeries(al,mode),p=pairArrays(al,S,prefs.cx,prefs.cy),c=pearson(p.xs,p.ys);
  const sfx=mode==='detrend'?' (detrended)':mode==='diff'?' (change)':'';
  const pts=p.xs.map((x,i)=>[x,p.ys[i]]);
  scatterDraw(pts,cvName(prefs.cx)+sfx,cvName(prefs.cy)+sfx);
  if(!c)sx.innerHTML='<span class="sub">Not enough overlapping points for this pair (needs at least 4 time bins with both metrics).</span>';
  else{const f=ols(pts.slice().sort((a,b)=>a[0]-b[0]));
    sx.innerHTML=`<b>r = ${c.r.toFixed(3)}</b> (${strength(c.r)} ${c.r>0?'positive':'negative'}) · R² ${c.r2.toFixed(2)} (adjusted ${(1-(1-c.r2)*(c.n-1)/(c.n-2)).toFixed(2)}): ${Math.round(c.r2*100)}% of the variation in ${cvShort(prefs.cy)} is linearly explained by ${cvShort(prefs.cx)} · n ${c.n} (effective ${c.neff.toFixed(0)}) · ${level()}% CI ${c.ci?'['+c.ci[0].toFixed(2)+', '+c.ci[1].toFixed(2)+']':'n/a'} · ${c.sig?'<span style="color:var(--ok)">significant</span>':'<span style="color:var(--mute)">not significant</span>'}${f?` · least-squares slope <b>${fnum(f.b)}</b> ${cvShort(prefs.cy)} per ${cvShort(prefs.cx)}`:''}`}
  const w=Math.max(10,Math.floor(p.xs.length/4)),rp=[],bd=[];
  for(let i=w;i<=p.xs.length;i++){const q=pearson(p.xs.slice(i-w,i),p.ys.slice(i-w,i));if(q){rp.push([p.ts[i-1],q.r]);bd.push([p.ts[i-1],q.ci?q.ci[0]:q.r,q.ci?q.ci[1]:q.r])}}
  chart('roll',{xKind:'time',breakGap:BIN*3,yMin:-1,yMax:1,hlines:[{y:0,label:'0',color:css('--mute')}],bands:[{pts:bd,color:css('--c4'),op:.16}],note:`window ${w} bins · shaded = ${level()}% interval for r`,series:[{name:`rolling r (${cvShort(prefs.cx)} vs ${cvShort(prefs.cy)})`,color:css('--c4'),pts:rp}],yFmt:v=>v.toFixed(1)});
}
function renderCorr(s){
  BIN=s.bin_s||60;const al=s.aligned||[],box=$('cmatrix'),top=$('ctop'),note=$('cnote');
  const modeName={raw:'raw values',detrend:'detrended values (each metric\'s least-squares trend removed first)',diff:'changes between neighbouring time bins'}[prefs.cmode]||'raw values';
  if(al.length<8){box.innerHTML='<span class="sub">Not enough aligned data in this period (needs at least 8 time bins). Try a longer range.</span>';top.innerHTML='';note.textContent='';CORR=null;renderScatter(s,null);return}
  const cur=corrMatrix(al,prefs.cmode),raw=prefs.cmode==='raw'?cur:corrMatrix(al,'raw'),det=prefs.cmode==='detrend'?cur:corrMatrix(al,'detrend');
  CORR=cur;
  let h='<table class="cm"><tr><th></th>'+CV.map(v=>`<th>${v[2]}</th>`).join('')+'</tr>';
  CV.forEach(([a])=>{h+=`<tr><th class="rl">${cvShort(a)}</th>`;CV.forEach(([b])=>{
    if(a===b){h+='<td class="diag">1</td>';return}
    const c=cur.M[a+'|'+b];
    if(!c){h+=`<td class="dim" data-cx="${a}" data-cy="${b}" title="not enough overlapping points">–</td>`;return}
    const showR2=prefs.cshow==='r2',col=showR2?'--c3':(c.r>=0?'--c1':'--c5'),amt=Math.round(showR2?c.r2*90:Math.abs(c.r)*85),isSel=(prefs.cx===a&&prefs.cy===b)||(prefs.cx===b&&prefs.cy===a);
    h+=`<td class="${c.sig?'':'dim'}${isSel?' sel':''}" data-cx="${a}" data-cy="${b}" style="background:color-mix(in srgb,var(${col}) ${amt}%,transparent)" title="${cvName(a)} vs ${cvName(b)}: r = ${c.r.toFixed(3)} (R² ${c.r2.toFixed(3)}), n = ${c.n} (effective ${c.neff.toFixed(0)}), ${level()}% CI ${c.ci?'['+c.ci[0].toFixed(2)+', '+c.ci[1].toFixed(2)+']':'n/a'}${c.sig?'':' - not significant'}">${(showR2?c.r2:c.r).toFixed(2)}</td>`});
    h+='</tr>'});
  box.innerHTML=h+'</table>';
  const pairs=[];CV.forEach(([a],i)=>CV.forEach(([b],j)=>{if(j<=i)return;const c=cur.M[a+'|'+b];if(c&&c.sig&&c.n>=8)pairs.push([a,b,c])}));
  pairs.sort((p,q)=>Math.abs(q[2].r)-Math.abs(p[2].r));
  top.innerHTML=pairs.length?'<ul class="pairs">'+pairs.slice(0,7).map(([a,b,c])=>{
    const rr=raw.M[a+'|'+b],dd=det.M[a+'|'+b],td=rr&&dd&&Math.abs(rr.r)>=.5&&Math.abs(dd.r)<.3;
    return `<li><b>${cvName(a)}</b> and <b>${cvName(b)}</b>: r = <b>${c.r.toFixed(2)}</b> (${strength(c.r)} ${c.r>0?'positive':'negative'}), n=${c.n}, ${level()}% CI [${c.ci[0].toFixed(2)}, ${c.ci[1].toFixed(2)}]${td?'<span class="badge" title="Strong in raw values but weak once each metric\'s own time trend is removed: they probably both just drift over time rather than being directly linked.">trend-driven?</span>':''}</li>`}).join('')+'</ul>'
    :`<div class="sub" style="margin-top:8px">No statistically significant correlations in this period (using ${modeName}).</div>`;
  note.innerHTML=`Pearson r measures straight-line association only (−1 to +1; 0 = none). Computed on <b>${modeName}</b> over ${al.length} time bins of ${Math.max(1,Math.round(BIN/60))} min, using each pair's overlapping bins. The interval uses an <i>effective</i> sample size reduced for autocorrelation (Bartlett), then a Fisher-z ${level()}% interval; dim cells are not significant. Correlation is not causation, and two metrics that both drift over time correlate even if unrelated: switch to "detrended" or "changes" in Customize to check (pairs flagged <i>trend-driven?</i> are strong raw but weak once detrended). Click a cell to plot that pair.`;
  renderScatter(s,cur);
}
/* ---- coefficient of determination: multiple regression, adjusted + out-of-sample R², unique contributions, VIF ---- */
function lgam(x){const c=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];let y=x,t=x+5.5;t-=(x+.5)*Math.log(t);let s=1.000000000190015;for(let j=0;j<6;j++)s+=c[j]/++y;return -t+Math.log(2.5066282746310005*s/x)}
function betacf(a,b,x){const FP=1e-300;const qab=a+b,qap=a+1,qam=a-1;let c=1,d=1-qab*x/qap;if(Math.abs(d)<FP)d=FP;d=1/d;let h=d;
  for(let m=1;m<=300;m++){const m2=2*m;let aa=m*(b-m)*x/((qam+m2)*(a+m2));d=1+aa*d;if(Math.abs(d)<FP)d=FP;c=1+aa/c;if(Math.abs(c)<FP)c=FP;d=1/d;h*=d*c;
    aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));d=1+aa*d;if(Math.abs(d)<FP)d=FP;c=1+aa/c;if(Math.abs(c)<FP)c=FP;d=1/d;const del=d*c;h*=del;if(Math.abs(del-1)<3e-12)break}return h}
function ibeta(x,a,b){if(x<=0)return 0;if(x>=1)return 1;const bt=Math.exp(a*Math.log(x)+b*Math.log(1-x)+lgam(a+b)-lgam(a)-lgam(b));return x<(a+1)/(a+b+2)?bt*betacf(a,b,x)/a:1-bt*betacf(b,a,1-x)/b}
function fPval(F,d1,d2){return(!(F>0)||d1<1||d2<1)?null:ibeta(d2/(d2+d1*F),d2/2,d1/2)}      // upper tail of the F distribution
function solveSys(A,b){const p=b.length,M=A.map((r,i)=>r.concat([b[i]]));
  for(let c=0;c<p;c++){let piv=c;for(let r=c+1;r<p;r++)if(Math.abs(M[r][c])>Math.abs(M[piv][c]))piv=r;if(Math.abs(M[piv][c])<1e-8*Math.max(1,Math.abs(A[c][c])))return null;[M[c],M[piv]]=[M[piv],M[c]];
    for(let r=c+1;r<p;r++){const f=M[r][c]/M[c][c];for(let k=c;k<=p;k++)M[r][k]-=f*M[c][k]}}
  const x=new Array(p).fill(0);for(let i=p-1;i>=0;i--){let s=M[i][p];for(let k=i+1;k<p;k++)s-=M[i][k]*x[k];x[i]=s/M[i][i]}return x}
function mreg(y,X){                              // y: n values; X: p predictor arrays of n values. Ordinary least squares with intercept.
  const n=y.length,p=X.length;if(n<p+3)return null;
  const my=y.reduce((a,b)=>a+b,0)/n,mx=X.map(c=>c.reduce((a,b)=>a+b,0)/n),sd=X.map((c,j)=>Math.sqrt(c.reduce((a,v)=>a+(v-mx[j])**2,0)/n));
  if(sd.some(s=>!(s>0)))return null;
  const Z=X.map((c,j)=>c.map(v=>(v-mx[j])/sd[j]));
  const A=Z.map(a=>Z.map(b=>{let s=0;for(let i=0;i<n;i++)s+=a[i]*b[i];return s})),bv=Z.map(a=>{let s=0;for(let i=0;i<n;i++)s+=a[i]*(y[i]-my);return s});
  const bz=solveSys(A,bv);if(!bz)return null;
  let sse=0,sst=0;const yh=[];for(let i=0;i<n;i++){let f=my;for(let j=0;j<p;j++)f+=bz[j]*Z[j][i];yh.push(f);sse+=(y[i]-f)**2;sst+=(y[i]-my)**2}
  if(!(sst>0))return null;
  const r2=1-sse/sst,coef=bz.map((b,j)=>b/sd[j]),icpt=my-coef.reduce((a,c,j)=>a+c*mx[j],0);
  return{n,p,r2,adj:1-(1-r2)*(n-1)/(n-p-1),sse,sst,yh,bz,coef,icpt,sdy:Math.sqrt(sst/n),predict:row=>icpt+row.reduce((a,v,j)=>a+coef[j]*v,0)};
}
function cvR2(y,X,k){                            // blocked (contiguous-in-time) k-fold out-of-sample R^2; can be negative
  const n=y.length;if(n<20)return null;const folds=Math.min(k,Math.floor(n/4));let sse=0,sst=0;
  for(let f=0;f<folds;f++){const a=Math.floor(f*n/folds),b=Math.floor((f+1)*n/folds),tr=[],te=[];for(let i=0;i<n;i++)(i>=a&&i<b?te:tr).push(i);
    const m=mreg(tr.map(i=>y[i]),X.map(c=>tr.map(i=>c[i])));if(!m)return null;const ym=tr.reduce((s,i)=>s+y[i],0)/tr.length;
    te.forEach(i=>{const pr=m.predict(X.map(c=>c[i]));sse+=(y[i]-pr)**2;sst+=(y[i]-ym)**2})}
  return sst>0?1-sse/sst:null;
}
function quadFit(pts){const n=pts.length;if(n<8)return null;const xs=pts.map(p=>p[0]),m=xs.reduce((a,b)=>a+b,0)/n,s=Math.sqrt(xs.reduce((a,v)=>a+(v-m)**2,0)/n);if(!(s>0))return null;const z=xs.map(v=>(v-m)/s);return mreg(pts.map(p=>p[1]),[z,z.map(v=>v*v)])}
function renderReg(s){
  const al=s.aligned||[],T=prefs.rtarget,P=(prefs.rpreds||[]).filter(k=>k!==T&&CV.some(v=>v[0]===k));
  $('regsel').innerHTML=`<div class="pairsel"><label>Explain <select data-k="rtarget">${CV.map(v=>`<option value="${v[0]}"${T===v[0]?' selected':''}>${v[1]}</option>`).join('')}</select></label><span class="sub">using</span>${CV.filter(v=>v[0]!==T).map(v=>`<label><input type="checkbox" data-rp="${v[0]}"${P.includes(v[0])?' checked':''}> ${v[2]}</label>`).join(' ')}</div>`;
  const out=m=>{$('regstats').innerHTML=m;$('regtab').innerHTML='';$('regbars').innerHTML='';$('regnote').textContent='';scatterDraw([],'','','regpred',true)};
  if(!P.length){out('<span class="sub">Tick at least one metric to explain it with.</span>');return}
  const S=cvSeries(al,prefs.cmode),rows=[];
  for(let i=0;i<al.length;i++){const y=S[T][i];if(y==null)continue;const xs=P.map(k=>S[k][i]);if(xs.some(v=>v==null))continue;rows.push([y,xs])}
  const n=rows.length,p=P.length,need=Math.max(12,p+8);
  if(n<need){out(`<span class="sub">Only ${n} time bins have every selected metric (need at least ${need}). Throttle, clock and memory come from the 5-minute sampler, so using them leaves far fewer bins; try fewer metrics or a longer range.</span>`);return}
  const y=rows.map(r=>r[0]),X=P.map((_,j)=>rows.map(r=>r[1][j])),fit=mreg(y,X);
  if(!fit){out('<span class="sub">The selected metrics are perfectly collinear (or one is constant). Remove one.</span>');return}
  const e=y.map((v,i)=>v-fit.yh[i]);let nu=0,de=0;e.forEach((v,i)=>{de+=v*v;if(i)nu+=v*e[i-1]});
  const rho=de>0?Math.max(-.9,Math.min(.95,nu/de)):0,neff=Math.max(p+4,Math.min(n,rho>0?n*(1-rho)/(1+rho):n));
  const F=(fit.r2/p)/((1-fit.r2)/(n-p-1)),pn=fPval(F,p,n-p-1),Fa=(fit.r2/p)/((1-fit.r2)/(neff-p-1)),pa=neff-p-1>=1?fPval(Fa,p,neff-p-1):null;
  const cv=cvR2(y,X,5),ids=P.map((_,k)=>k);
  const un=P.map((_,j)=>{const idx=ids.filter(k=>k!==j),red=idx.length?mreg(y,idx.map(k=>X[k])):null;return fit.r2-(red?red.r2:0)});
  const vif=P.map((_,j)=>{if(p<2)return 1;const m=mreg(X[j],ids.filter(k=>k!==j).map(k=>X[k]));return m&&m.r2<.99999?1/(1-m.r2):Infinity});
  const fp=v=>v==null?'n/a':v<0.001?'< 0.001':v.toFixed(3),sfx=prefs.cmode==='detrend'?' (detrended)':prefs.cmode==='diff'?' (changes)':'';
  const vcv=cv==null?'':cv<0?' <span style="color:var(--bad)">Negative: the model predicts held-out time blocks worse than just using the average, so it does not generalize.</span>':cv<fit.r2-.2?' <span style="color:var(--warn)">Far below the in-sample R²: the fit is optimistic.</span>':'';
  $('regstats').innerHTML=`${P.map(cvShort).join(' + ')} together explain <b>${Math.round(fit.r2*100)}%</b> of the variation in ${cvName(T)}${sfx}: <b>R² ${fit.r2.toFixed(2)}</b> (adjusted ${fit.adj.toFixed(2)}) · out-of-sample R² <b>${cv==null?'n/a':cv.toFixed(2)}</b> (blocked 5-fold)${vcv}<br><span class="sub">n ${n} (effective ${neff.toFixed(0)}) · F(${p}, ${n-p-1}) = ${F.toFixed(1)}, p ${fp(pn)}; autocorrelation-adjusted p ${fp(pa)} · RMSE ${fnum(Math.sqrt(fit.sse/n))}</span>`;
  const cols=['--c1','--c2','--c3','--c4','--c5'];
  $('regtab').innerHTML=`<table class="trendtab"><tr><th>metric</th><th>standardized β</th><th>coefficient</th><th>unique R²</th><th>VIF</th></tr>${P.map((k,j)=>`<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(${cols[j%5]});margin-right:6px"></i>${cvName(k)}</td><td>${(fit.bz[j]/fit.sdy).toFixed(2)}</td><td>${fnum(fit.coef[j])} <small>${cvShort(T)} per ${cvShort(k)}</small></td><td>${(un[j]*100).toFixed(1)}%</td><td class="${vif[j]>5?'v-bad':'v-mute'}">${isFinite(vif[j])?vif[j].toFixed(1):'∞'}${vif[j]>5?' <small>overlaps others</small>':''}</td></tr>`).join('')}</table>`;
  const shared=Math.max(0,fit.r2-un.reduce((a,b)=>a+Math.max(0,b),0)),unexp=Math.max(0,1-fit.r2);
  $('regbars').innerHTML=`<div style="display:flex;height:22px;border-radius:6px;overflow:hidden;border:1px solid var(--line)">${P.map((k,j)=>`<div style="width:${Math.max(0,un[j])*100}%;background:var(${cols[j%5]})" title="${cvName(k)} alone: ${(un[j]*100).toFixed(1)}%"></div>`).join('')}<div style="width:${shared*100}%;background:repeating-linear-gradient(45deg,var(--mute) 0 3px,transparent 3px 7px)" title="explained jointly: ${(shared*100).toFixed(1)}%"></div><div style="width:${unexp*100}%;background:var(--grid)" title="unexplained: ${(unexp*100).toFixed(1)}%"></div></div><div class="fine">Colour = variance only that metric explains · hatched = explained jointly by several · grey = unexplained (${(unexp*100).toFixed(0)}%).</div>`;
  scatterDraw(fit.yh.map((v,i)=>[v,y[i]]),'Predicted '+cvName(T)+sfx,'Actual '+cvName(T)+sfx,'regpred',true,tq(n-p-1)*Math.sqrt(fit.sse/(n-p-1)));
  $('regnote').innerHTML='R² is the share of the variation in the explained metric that the selected metrics account for (0 = none, 1 = all). Adjusted R² penalises extra metrics. Out-of-sample R² trains on contiguous blocks of time and predicts the held-out block, so it is the honest number, and it can be negative. Unique R² is how much R² would drop if that metric were removed. A VIF above 5 means a metric largely duplicates the others, so its coefficient is unstable. Neighbouring time bins are correlated, so ordinary p-values are optimistic (the adjusted one is closer). R² describes association, not cause; the load metric includes the trainer\'s own CPU use. Use Customize → Correlation → detrended to see R² beyond shared time trends.';
}
function cellClick(e){let t=e.target;while(t&&!(t.dataset&&t.dataset.cx))t=t.parentElement;if(!t)return;prefs.cx=t.dataset.cx;prefs.cy=t.dataset.cy;save();if(last)render(last)}
const fnum=v=>v==null||!isFinite(v)?'–':(Math.abs(v)>=100?Math.round(v).toLocaleString():Math.abs(v)>=1?v.toFixed(2):Math.abs(v)===0?'0':v.toPrecision(2));
function renderTrend(){
  const box=$('trend');
  if(!prefs.trend){box.innerHTML='<span class="sub">Trend lines are switched off in Customize.</span>';return}
  const defs=[['loss','Training loss','per 1M steps',1e6,'lower','proj'],['eval','Validation regret (net)','per 1M steps',1e6,'lower','proj'],
   ['rate','Training speed','steps/min per hour',3600,'higher',''],['temp','CPU temperature',tu()+' per hour',3600,'lower',''],
   ['bat','Battery','% per hour',3600,'info','empty'],['mem','Memory available','MB per hour',3600,'info','empty']];
  const xs=(id,v)=>['loss','eval'].includes(id)?'step '+n0(v):fmtT(v);
  const rows=defs.map(d=>{
    const f=FITS[d[0]];
    if(!f)return `<tr><td>${d[1]}</td><td colspan="8" class="v-mute">not enough points in this period (needs at least 4)</td></tr>`;
    const ci=f.boot?f.boot.sl:f.ci,sig=ci[0]>0||ci[1]<0,up=f.b>0;
    let verdict,cls='v-mute';
    if(!sig)verdict='no detectable trend';
    else if(d[4]==='lower'){verdict=up?'worsening':'improving';cls=up?'v-bad':'v-ok'}
    else if(d[4]==='higher'){verdict=up?'improving':'worsening';cls=up?'v-ok':'v-bad'}
    else verdict=up?'rising':'falling';
    let proj='';
    const last=f.yb+f.b*(f.x1-f.xb);
    if(d[5]==='proj')proj=`${fnum(last+f.b*1e6)} <small>at +1M steps</small>`;
    else if(d[5]==='empty'&&sig&&f.b<0&&last>0)proj=`<small>empty in</small> ${dur(last/(-f.b*3600)*3600)}`;
    let curv='<small>n/a</small>';
    {const q=quadFit(f.pts||[]);if(q){const adjL=1-(1-f.r2)*(f.n-1)/(f.n-2),dR=q.r2-f.r2,dA=q.adj-adjL;curv=`${q.r2.toFixed(2)} <small>(${dR>=0?'+':''}${dR.toFixed(2)}) ${dA>=.05?'<b>curved: a line misses structure</b>':'line is enough'}</small>`}}
    const sc=d[3];
    return `<tr><td>${d[1]}</td><td><small>${xs(d[0],f.x0)} → ${xs(d[0],f.x1)}</small></td><td>${f.n} <small>· ${Math.round(f.cov*100)}% inside the ${level()}% prediction band</small></td>
      <td><b>${fnum(f.b*sc)}</b> <small>${d[2]}</small></td><td><small>[${fnum(ci[0]*sc)}, ${fnum(ci[1]*sc)}]</small></td>
      <td>${f.r2.toFixed(2)} <small>(adj ${(1-(1-f.r2)*(f.n-1)/(f.n-2)).toFixed(2)}) · ρ ${f.r1.toFixed(2)}</small></td><td>${curv}</td><td class="${cls}">${verdict}</td><td>${proj}</td></tr>`}).join('');
  box.innerHTML=`<div class="trendwrap"><table class="trendtab"><tr><th>metric</th><th>fitted over</th><th>points · calibration</th><th>slope</th><th>${level()}% interval${prefs.bmethod==='bootstrap'?' (block bootstrap)':''}</th><th>R² (adjusted) · ρ</th><th>quadratic R² · is a straight line enough?</th><th>verdict</th><th>projection</th></tr>${rows}</table></div>
   <div class="fine">Ordinary least squares on the plotted points. The interval is widened by the lag-1 residual autocorrelation ρ, because neighbouring training points are strongly correlated; a naive interval would be too tight. "Detectable" means the interval excludes zero. Time charts are fitted on the latest continuous stretch (after the last stop). Validation uses 4 games, so its trend is only a rough guide. A projection extends the straight line and is not a forecast. <b>Bands:</b> the confidence band shows where the true line plausibly lies; the wider prediction band shows where individual new points should fall. "Calibration" is the share of the plotted points that actually fall inside the prediction band: far below the chosen level means the band is too narrow for this data. The block bootstrap resamples chunks of consecutive points, so it keeps the autocorrelation without assuming a distribution (the prediction band stays analytic).</div>`;
}
let failed=false;
async function tick(){
  clearTimeout(timer);failed=false;
  try{const r=await fetch(window.NN_STATIC?('data/'+encodeURIComponent(prefs.range)+'.json'):('/api/stats?range='+encodeURIComponent(prefs.range)),{cache:'no-store'});if(!r.ok)throw new Error(r.status);render(await r.json())}
  catch(e){failed=true;$('upd').textContent='cannot reach the dashboard server ('+e.message+') — retrying every 5 s';$('banners').innerHTML='<div class="banner bad"><b>Dashboard server unreachable.</b> The page will keep retrying automatically.</div>'}
  /* always keep polling: every 5 s while disconnected; the chosen interval otherwise (a manual-only setting still self-heals after a disconnect) */
  if(failed)timer=setTimeout(tick,5000);else if(prefs.refresh>0)timer=setTimeout(tick,prefs.refresh*1000);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
window.addEventListener('online',()=>tick());
window.addEventListener('focus',()=>tick());
$('theme').onclick=()=>{const r=document.documentElement,cur=r.dataset.theme||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');r.dataset.theme=cur==='dark'?'light':'dark';try{localStorage.setItem('nn-theme',r.dataset.theme)}catch(e){};if(last)render(last)};
try{const t=localStorage.getItem('nn-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}
$('pairsel').onchange=onControl;$('regsel').onchange=onControl;$('cmatrix').onclick=cellClick;
$('ranges').onclick=onControl;$('custom').onchange=onControl;$('custom').onclick=e=>{if(e.target.tagName==='BUTTON')onControl(e)};
renderControls();applyLayout();tick();
