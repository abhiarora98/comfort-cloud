"use client";
import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from "react";
import { useUser, useClerk } from "@clerk/nextjs";

import RAW from "./raw-orders.json";
import ALL_PARTIES from "./all-parties.json";
import INV_MAP from "./inv-map.json";
import REORDER from "./reorder.json";
import MONTHLY from "./monthly.json";
import ANALYTICS from "./analytics.json";
import STOCK from "./stock.json";
import VELOCITY from "./velocity.json";

/* ═══════════════ THEME ═══════════════ */
const AC="#0c1222",AC2="#d97706",MN="'DM Mono',monospace",SN="'Instrument Sans',sans-serif",PG=25;
const CC={
  "Loop Rolls":{c:"#059669",b:"#ecfdf5",l:"Rolls"},
  "TEFNO":     {c:"#7c3aed",b:"#f5f3ff",l:"TEFNO"},
  "Car Set":   {c:"#ea580c",b:"#fff7ed",l:"Car Set"},
  "Foot Mat":  {c:"#2563eb",b:"#eff6ff",l:"Foot Mat"},
  "Turf":      {c:"#0d9488",b:"#f0fdfa",l:"Turf"},
  "Wire":      {c:"#dc2626",b:"#fef2f2",l:"Wire"},
  "Grass":     {c:"#16a34a",b:"#f0fdf4",l:"Grass"},
  "Monograss": {c:"#84cc16",b:"#f7fee7",l:"Monograss"},
  "Welcome Mat":{c:"#0284c7",b:"#f0f9ff",l:"Welcome"},
  "Printing":  {c:"#6b7280",b:"#f3f4f6",l:"Printing"},
  "Heavy Duty":{c:"#b91c1c",b:"#fef2f2",l:"Heavy Duty"},
  "Other":     {c:"#78716c",b:"#f5f5f4",l:"Other"},
};
const ALL_CATS=["Loop Rolls","TEFNO","Car Set","Foot Mat","Turf","Wire","Grass","Monograss","Welcome Mat","Printing","Heavy Duty"];
const CAT_UNIT={"Car Set":"sets","Foot Mat":"pcs","Printing":"pcs"};
const POC_COLORS={AR:"#2563eb",SPM:"#7c3aed",VS:"#d97706",AA:"#059669",YA:"#dc2626",SK:"#0891b2",DM:"#78716c"};

/* ═══════ STOCK & VELOCITY DATA ═══════ */

const W_MAP={"2ft":0.61,"4ft":1.22,"1.05mtr":1.05,"3ft":0.9};
const W_REV={0.61:"2ft",1.22:"4ft",0.6:"2ft",1.05:"3.5ft",0.9:"3ft",1.0:"3.3ft",1.2:"4ft"};
const CAT_MAP={"Loop Rolls":"LOOP","TEFNO":"TEFNO","Turf":"TURF","Wire":"WIRE MAT","Heavy Duty":"LOOP"};
const CAT_REV={"LOOP":"Loop Rolls","TEFNO":"TEFNO","TURF":"Turf","WIRE MAT":"Wire"};
const ROLL_CATS=["Loop Rolls","TEFNO","Turf","Wire","Heavy Duty"];
function normColor(c){return(c||"").toUpperCase().trim();}
function normWidth(w){if(!w)return 0;const s=String(w).toLowerCase().trim();if(W_MAP[s]!=null)return W_MAP[s];const m=s.match(/([\d.]+)/);if(m){const n=parseFloat(m[1]);if(n<5)return n;if(n<70)return n/100;}return 0;}
function getVelocity(model,color){return VELOCITY[(model||"").toUpperCase()+"|"+(color||"").toUpperCase()]||null;}
function daysOfStock(qty,vel){if(!vel||vel.r<=0)return null;return Math.round(qty/(vel.r/30));}
function buildStockDemand(orders){
  var demand={};
  orders.forEach(function(o){o.lines.forEach(function(l){
    if(ROLL_CATS.indexOf(l.category)<0)return;
    var sCat=CAT_MAP[l.category];if(!sCat)return;
    var model=normColor(l.model),color=normColor(l.colour||l.color||""),w=normWidth(l.width);
    var key=sCat+"|"+model+"|"+color+"|"+w;
    if(!demand[key])demand[key]={cat:sCat,model:l.model,color:l.colour||l.color||"",backing:l.backing||"",w:w,qty:0,orders:[]};
    demand[key].qty+=l.qty;
    demand[key].orders.push({party:o.party,qty:l.qty,date:o.piDate});
  });});
  var results=[],usedStock={};
  Object.keys(demand).forEach(function(k){
    var d=demand[k];
    var sMatch=STOCK.find(function(s){return s.cat===d.cat&&normColor(s.model)===normColor(d.model)&&normColor(s.color)===normColor(d.color)&&Math.abs(s.w-d.w)<0.05;});
    var wh=sMatch?sMatch.qty:0,committed=d.qty,avail=Math.max(0,wh-committed),deficit=committed-wh;
    var vel=getVelocity(d.model,d.color),dos=daysOfStock(avail,vel);
    if(sMatch)usedStock[sMatch.cat+"|"+normColor(sMatch.model)+"|"+normColor(sMatch.color)+"|"+sMatch.w]=true;
    results.push(Object.assign({},d,{warehouseQty:wh,committed:committed,available:avail,stockQty:wh,deficit:deficit,wLabel:W_REV[d.w]||d.w+"m",matched:!!sMatch,vel:vel,dos:dos,bk:sMatch?sMatch.bk:d.backing||""}));
  });
  STOCK.forEach(function(s){
    var sk=s.cat+"|"+normColor(s.model)+"|"+normColor(s.color)+"|"+s.w;
    if(!usedStock[sk]){
      var vel=getVelocity(s.model,s.color);
      results.push({cat:s.cat,model:s.model,color:s.color,bk:s.bk||"",w:s.w,qty:0,warehouseQty:s.qty,committed:0,available:s.qty,stockQty:s.qty,deficit:-s.qty,wLabel:W_REV[s.w]||s.w+"m",matched:true,orders:[],vel:vel,dos:daysOfStock(s.qty,vel)});
    }
  });
  return results.sort(function(a,b){return b.deficit-a.deficit;});
}

/* ═══════════════ HELPERS ═══════════════ */
function pd(d){try{const p=d.split("/");return new Date(+p[2],+p[1]-1,+p[0]);}catch{return new Date(2099,0,1);}}
function daysSince(d){return Math.floor((new Date()-pd(d))/(1000*60*60*24));}
function fmtVal(v){
  if(!v||v<=0) return "₹0";
  if(v>=10000000) return "₹"+(v/10000000).toFixed(2)+"Cr";
  if(v>=100000)   return "₹"+(v/100000).toFixed(1)+"L";
  return "₹"+Math.round(v).toLocaleString("en-IN");
}
function payStatus(approved){
  if(approved) return {label:"Approved",color:"#059669",bg:"#ecfdf5",border:"#86efac"};
  return {label:"Not Approved",color:"#ea580c",bg:"#fff7ed",border:"#fed7aa"};
}
function buildInsight(filtered,readyToDispatch,pendingApproval,rtdOverdue,allLines,cat){
  const totalVal=filtered.reduce((s,o)=>s+o.totalValue,0);
  const rtdVal=readyToDispatch.reduce((s,o)=>s+o.totalValue,0);
  const odVal=rtdOverdue.reduce((s,o)=>s+o.totalValue,0);
  const pendVal=pendingApproval.reduce((s,o)=>s+o.totalValue,0);
  const readyPct=filtered.length>0?Math.round(readyToDispatch.length/filtered.length*100):0;
  const pendPct=filtered.length>0?Math.round(pendingApproval.length/filtered.length*100):0;
  const topCat=Object.entries(allLines.reduce((m,l)=>{m[l.category]=(m[l.category]||0)+l.qty;return m;},{})).sort((a,b)=>b[1]-a[1]);
  const topPOC=Object.entries(filtered.reduce((m,o)=>{const p=o.salesPOC||"?";m[p]=(m[p]||0)+1;return m;},{})).sort((a,b)=>b[1]-a[1]);

  // --- Step 1: Detect all insights ---
  const insights=[];
  const S={H:"high",M:"medium",L:"low"};
  const totalQty=allLines.reduce((s,l)=>s+l.qty,0);

  // --- Detect insights with sharp, specific copy ---

  if(rtdOverdue.length>0){
    insights.push({type:"overdue",cat:"problem",impact:rtdOverdue.length>=3?S.H:S.M,urgency:S.H,actionability:S.H,
      headline:fmtVal(odVal)+" is blocked in "+rtdOverdue.length+" overdue order"+(rtdOverdue.length>1?"s":""),
      body:"Approved but not shipped for over 7 days — delays are increasing cancellation risk.",
      cta:"Review overdue orders",tone:"urgent",
      orders:rtdOverdue.sort((a,b)=>b.totalValue-a.totalValue),
      issue:o=>daysSince(o.approvalDate)+"d since approval"});
  }

  if(pendPct>=65&&pendingApproval.length>=5){
    insights.push({type:"bottleneck",cat:"problem",impact:S.H,urgency:S.H,actionability:S.H,
      headline:fmtVal(pendVal)+" blocked in "+pendingApproval.length+" unapproved orders",
      body:Math.round(pendPct)+"% of pipeline is stalled — nothing ships until approvals clear.",
      cta:"Review pending orders",tone:"warning",
      orders:pendingApproval.sort((a,b)=>b.totalValue-a.totalValue).slice(0,10),
      issue:o=>daysSince(o.piDate)+"d waiting"});
  } else if(pendingApproval.length>readyToDispatch.length*2&&pendingApproval.length>=4){
    insights.push({type:"bottleneck",cat:"problem",impact:S.M,urgency:S.M,actionability:S.H,
      headline:"Approval backlog: "+pendingApproval.length+" pending vs "+readyToDispatch.length+" ready",
      body:"Dispatch capacity is underutilised — approvals are the constraint.",
      cta:"Review pending orders",tone:"warning",
      orders:pendingApproval.sort((a,b)=>b.totalValue-a.totalValue).slice(0,10),
      issue:o=>daysSince(o.piDate)+"d waiting"});
  }

  if(readyToDispatch.length>=5&&readyPct>=40&&rtdOverdue.length===0){
    insights.push({type:"ready_batch",cat:"opportunity",impact:S.M,urgency:S.M,actionability:S.H,
      headline:fmtVal(rtdVal)+" in "+readyToDispatch.length+" orders ready to ship",
      body:"No overdue items — clear window to dispatch a large batch.",
      cta:"Review ready orders",tone:"positive",
      orders:readyToDispatch.sort((a,b)=>b.totalValue-a.totalValue).slice(0,10),
      issue:o=>"Ready since "+o.approvalDate});
  }

  // --- Strong but blocked (skip if overdue or bottleneck already covers it) ---
  if(totalVal>0&&(rtdOverdue.length>0||pendPct>=40)&&readyToDispatch.length>=3&&!insights.some(i=>i.type==="overdue")&&!insights.some(i=>i.type==="bottleneck")){
    const blockedVal=odVal+pendVal;
    insights.push({type:"strong_blocked",cat:"problem",impact:S.M,urgency:S.M,actionability:S.H,
      headline:fmtVal(blockedVal)+" at risk — stuck in overdue and unapproved orders",
      body:"Pipeline is "+fmtVal(totalVal)+" but execution is blocked. Revenue won't convert until these clear.",
      cta:"Review blocked orders",tone:"warning",
      orders:[...rtdOverdue,...pendingApproval].sort((a,b)=>b.totalValue-a.totalValue).slice(0,10),
      issue:o=>o.approvalDate&&daysSince(o.approvalDate)>7?"Overdue "+daysSince(o.approvalDate)+"d":"Pending "+daysSince(o.piDate)+"d"});
  }

  // --- Aging (skip if bottleneck already selected, similar message) ---
  const aged=pendingApproval.filter(o=>daysSince(o.piDate)>30);
  if(aged.length>=2&&!insights.some(i=>i.type==="bottleneck")){
    const agedVal=aged.reduce((s,o)=>s+o.totalValue,0);
    insights.push({type:"aging",cat:"risk",impact:aged.length>=5?S.H:S.M,urgency:S.M,actionability:S.H,
      headline:fmtVal(agedVal)+" at risk in "+aged.length+" stale orders",
      body:"Unapproved for 30+ days — orders this old rarely convert.",
      cta:"Review stale orders",tone:"warning",
      orders:aged.sort((a,b)=>b.totalValue-a.totalValue),
      issue:o=>daysSince(o.piDate)+"d old"});
  }

  // --- High-value stuck ---
  const avgVal=filtered.length>0?totalVal/filtered.length:0;
  const highValStuck=pendingApproval.filter(o=>o.totalValue>=avgVal*3&&daysSince(o.piDate)>7).sort((a,b)=>b.totalValue-a.totalValue);
  if(highValStuck.length>0){
    const hv=highValStuck[0];const hvPct=Math.round(hv.totalValue/totalVal*100);
    insights.push({type:"high_value_stuck",cat:"risk",impact:S.M,urgency:S.M,actionability:S.H,
      headline:fmtVal(hv.totalValue)+" order from "+hv.party+" delayed "+daysSince(hv.piDate)+" days",
      body:hvPct+"% of total pipeline in a single unapproved order.",
      cta:"Review this order",tone:"warning",
      orders:highValStuck.slice(0,5),
      issue:o=>daysSince(o.piDate)+"d, "+fmtVal(o.totalValue)});
  }

  // --- Context insights (lower priority, never primary) ---
  if(topPOC.length>0&&topPOC[0][1]>=filtered.length*0.5&&filtered.length>=6){
    const pocPct=Math.round(topPOC[0][1]/filtered.length*100);
    insights.push({type:"poc_concentration",cat:"context",impact:S.L,urgency:S.L,actionability:S.M,
      headline:pocPct+"% of orders depend on "+topPOC[0][0],
      body:"High concentration — any delay on their end impacts most of dispatch.",
      cta:"",tone:"neutral",orders:[],issue:()=>""});
  }

  if(topCat.length>0&&topCat[0][1]>=totalQty*0.5&&totalQty>=10){
    const catName=(CC[topCat[0][0]]||CC.Other).l||topCat[0][0];
    const catPct=Math.round(topCat[0][1]/totalQty*100);
    insights.push({type:"category_dominance",cat:"context",impact:S.L,urgency:S.L,actionability:S.L,
      headline:catName+" drives "+catPct+"% of current demand",
      body:"Ensure stock availability to avoid missed dispatch.",
      cta:"",tone:"neutral",orders:[],issue:()=>""});
  }

  if(filtered.length===0){
    return [{headline:"No pending orders",body:"All orders dispatched or no matches for current filters.",cta:"",tone:"neutral",orders:[],issue:()=>"",cat:"context"}];
  }

  // --- Step 2: Rank by impact > urgency > actionability ---
  const rank={high:3,medium:2,low:1};
  insights.sort((a,b)=>{
    const sa=rank[a.impact]*4+rank[a.urgency]*2+rank[a.actionability];
    const sb=rank[b.impact]*4+rank[b.urgency]*2+rank[b.actionability];
    return sb-sa;
  });

  // --- Step 3: State-aware selection — always 1 primary + 1-2 secondary ---
  const hasCritical=insights.some(i=>rank[i.impact]>=3&&rank[i.urgency]>=3);
  const hasModerate=insights.some(i=>rank[i.impact]>=2||rank[i.urgency]>=2);

  // Generate "healthy" and "watch" fallback insights
  const healthyPrimary={headline:"Operations running smoothly",
    body:readyToDispatch.length>0
      ?readyToDispatch.length+" orders worth "+fmtVal(rtdVal)+" ready to ship, no blockers in the pipeline."
      :filtered.length+" orders in pipeline worth "+fmtVal(totalVal)+". No critical issues detected.",
    cta:readyToDispatch.length>0?"Review ready orders":"",tone:"positive",cat:"opportunity",
    orders:readyToDispatch.sort((a,b)=>b.totalValue-a.totalValue).slice(0,8),issue:o=>o.approvalDate?"Ready since "+o.approvalDate:"Pending"};

  const healthySecondary=[];
  // Always generate a pipeline summary as a secondary
  if(filtered.length>0)healthySecondary.push({headline:fmtVal(totalVal)+" across "+filtered.length+" active orders",
    body:readyToDispatch.length+" ready, "+pendingApproval.length+" pending approval.",
    cta:"",tone:"neutral",cat:"context",orders:[],issue:()=>""});
  // Add a velocity note if there's dispatch data
  if(readyToDispatch.length>0&&pendingApproval.length>0){
    const ratio=Math.round(readyToDispatch.length/(readyToDispatch.length+pendingApproval.length)*100);
    healthySecondary.push({headline:ratio+"% of orders are dispatch-ready",
      body:ratio>=50?"Healthy conversion rate — keep clearing approvals.":"Approval rate is below 50% — room to improve.",
      cta:"",tone:ratio>=50?"positive":"neutral",cat:"context",orders:[],issue:()=>""});
  }

  let result=[];

  if(insights.length===0){
    // --- Healthy state: no detected issues ---
    result=[healthyPrimary,...healthySecondary.slice(0,2)];
  } else if(!hasCritical&&!hasModerate){
    // --- Healthy with low-priority context available ---
    result=[healthyPrimary,...insights.slice(0,2)];
  } else if(!hasCritical&&hasModerate){
    // --- Watch state: no critical, but moderate concerns ---
    // Promote the top moderate concern to primary, add context as secondary
    result=[insights[0]];
    const seen=new Set([insights[0].type]);
    for(let i=1;i<insights.length&&result.length<3;i++){
      if(!seen.has(insights[i].type)){seen.add(insights[i].type);result.push(insights[i]);}
    }
    // If we only got 1, backfill with healthy context
    if(result.length<2)result.push(...healthySecondary.slice(0,3-result.length));
  } else {
    // --- Critical state: urgent issues exist ---
    result=[insights[0]];
    const seen=new Set([insights[0].type]);
    for(let i=1;i<insights.length&&result.length<3;i++){
      if(!seen.has(insights[i].type)){seen.add(insights[i].type);result.push(insights[i]);}
    }
    // If we only got 1, backfill from context insights
    if(result.length<2)result.push(...healthySecondary.slice(0,3-result.length));
  }

  // Guarantee at least 1 primary + 1 secondary (never leave section looking empty)
  if(result.length<2)result.push(...healthySecondary.slice(0,2-result.length));

  return result;
}
function useW(){const[w,setW]=useState(typeof window!=='undefined'?window.innerWidth:1200);useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h);},[]);return w;}

/* ═══════════════ MICRO COMPONENTS ═══════════════ */
const S={
  card:{background:"#fff",borderRadius:12,border:"1px solid #e2e8f0",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"},
  glass:{background:"rgba(255,255,255,0.7)",backdropFilter:"blur(12px)",borderRadius:12,border:"1px solid rgba(255,255,255,0.3)"},
  pill:{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,fontFamily:MN},
  input:{padding:"8px 14px",border:"1px solid #e2e8f0",borderRadius:8,background:"#fff",fontSize:13,fontFamily:SN,outline:"none",color:"#1e293b",transition:"border 0.2s"},
  select:{padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,background:"#fff",fontSize:13,fontFamily:SN,outline:"none",color:"#1e293b",cursor:"pointer"},
  section:{fontFamily:MN,fontSize:11,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:"#94a3b8"},
};

function Badge({cat}){const x=CC[cat]||CC["Other"];return <span style={{...S.pill,background:x.b,color:x.c,border:"1px solid "+x.c+"40",boxShadow:"0 1px 3px "+x.c+"22"}}><span style={{width:6,height:6,borderRadius:"50%",border:"1.5px solid "+x.c,background:x.c+"33",flexShrink:0}}/>{x.l}</span>;}
function Dot({c,s=6}){return <span style={{width:s,height:s,borderRadius:"50%",background:c,display:"inline-block",flexShrink:0}}/>;}

function StatCard({icon,l,v,sub,sub2,accent,breakdown,unit,span2}){
  const ac=accent||"#2563eb";
  return(
    <div style={{background:"#fff",borderRadius:12,border:"1px solid #e5e7eb",padding:"14px 16px",...(span2?{gridColumn:"span 2"}:{})}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
        {accent&&<span style={{width:6,height:6,borderRadius:"50%",background:ac,flexShrink:0}}/>}
        <div style={{fontSize:10,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:"#94a3b8"}}>{l}</div>
      </div>
      <div style={{display:"flex",alignItems:"baseline",gap:4}}>
        <div style={{fontFamily:MN,fontSize:22,fontWeight:700,color:"#0f172a",lineHeight:1}}>{v}</div>
        {unit&&<div style={{fontFamily:MN,fontSize:10,color:"#94a3b8",fontWeight:600}}>{unit}</div>}
      </div>
      {sub&&<div style={{fontSize:11,color:"#64748b",fontWeight:500,marginTop:4,fontFamily:MN}}>{sub}</div>}
      {sub2&&<div style={{fontSize:10,color:"#94a3b8",marginTop:2,fontFamily:MN}}>{sub2}</div>}
      {breakdown&&<div style={{marginTop:8,paddingTop:6,borderTop:"1px solid #f1f5f9",display:"flex",gap:4,flexWrap:"wrap"}}>
        {breakdown.filter(([,q])=>q>0).map(([lbl,qty])=>(
          <div key={lbl} style={{display:"flex",alignItems:"center",gap:3,background:"#f8fafc",border:"1px solid #e5e7eb",padding:"2px 7px",borderRadius:6}}>
            <span style={{fontFamily:MN,fontSize:9,color:"#94a3b8"}}>{lbl}</span>
            <span style={{fontFamily:MN,fontSize:11,fontWeight:700,color:"#0f172a"}}>{qty}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

function MonthlyBar({name}){
  const pdata=MONTHLY.data[name];if(!pdata)return null;
  const last6=MONTHLY.months.slice(-6);const last6v=last6.map(m=>pdata[m]||0);const mx=Math.max(...last6v,1);const last6l=MONTHLY.labels.slice(-6);
  return(<div style={{marginTop:6}}>
    <div style={{display:"flex",alignItems:"flex-end",gap:3,height:28}}>
      {last6v.map((v,i)=><div key={i} title={last6l[i]+": "+fmtVal(v)} style={{flex:1,height:v>0?Math.max(4,Math.round(24*v/mx)):2,background:v>0?"#d97706":"#e2e8f0",borderRadius:2,transition:"height 0.3s"}}/>)}
    </div>
    <div style={{display:"flex",gap:3,marginTop:2}}>
      {last6l.map((l,i)=><div key={i} style={{flex:1,textAlign:"center",fontSize:8,fontFamily:MN,color:"#94a3b8"}}>{l.slice(0,3)}</div>)}
    </div>
  </div>);
}

function ReorderBadge({name}){
  const r=REORDER[name];if(!r)return null;
  const overdue=r.du<-(r.mg/2),soon=!overdue&&r.du<=14;
  const color=overdue?"#dc2626":soon?"#ea580c":"#059669";
  const bg=overdue?"#fef2f2":soon?"#fff7ed":"#ecfdf5";
  const label=overdue?("⚡ "+Math.abs(r.du)+"d overdue"):soon?("⏱ in "+r.du+"d"):("→ "+r.pn);
  return <div style={{marginTop:6,padding:"4px 10px",borderRadius:6,background:bg,display:"inline-flex",alignItems:"center",gap:6}}>
    <span style={{fontSize:10,fontWeight:700,color,fontFamily:MN}}>{label}</span>
    <span style={{fontSize:9,color:"#94a3b8",fontFamily:MN}}>{r.cf}%</span>
  </div>;
}

/* ═══════════════ INVOICE EXPAND ═══════════════ */
function InvoiceExpand({invs}){
  if(!invs.length)return <div style={{padding:20,textAlign:"center",color:"#94a3b8",fontFamily:MN,fontSize:12}}>No invoices found</div>;
  return <div style={{background:"#faf5ff",borderTop:"2px solid #8b5cf6"}}>
    <table style={{width:"100%",borderCollapse:"collapse"}}>
      <thead><tr>{["Invoice","Date","Items","Value"].map(h=><th key={h} style={{padding:"8px 16px",fontSize:10,fontFamily:MN,letterSpacing:"0.06em",textTransform:"uppercase",color:"#7c3aed",background:"#f3e8ff",textAlign:h==="Items"||h==="Value"?"right":"left"}}>{h}</th>)}</tr></thead>
      <tbody>
        {invs.map(inv=><tr key={inv.i} style={{borderBottom:"1px solid #ede9fe"}}>
          <td style={{padding:"8px 16px",fontFamily:MN,fontSize:12,fontWeight:600,color:"#7c3aed"}}>#{inv.i}</td>
          <td style={{padding:"8px 16px",fontFamily:MN,fontSize:11,color:"#64748b"}}>{inv.d}</td>
          <td style={{padding:"8px 16px",fontFamily:MN,fontSize:11,color:"#94a3b8",textAlign:"right"}}>{inv.n}</td>
          <td style={{padding:"8px 16px",fontFamily:MN,fontSize:12,fontWeight:600,textAlign:"right"}}>{fmtVal(inv.t)}</td>
        </tr>)}
        <tr style={{background:"#f3e8ff"}}><td colSpan={3} style={{padding:"8px 16px",fontFamily:MN,fontSize:11,fontWeight:700,color:"#7c3aed"}}>Total ({invs.length})</td><td style={{padding:"8px 16px",fontFamily:MN,fontSize:13,fontWeight:700,color:"#7c3aed",textAlign:"right"}}>{fmtVal(invs.reduce((s,i)=>s+i.t,0))}</td></tr>
      </tbody>
    </table>
  </div>;
}

/* ═══════════════ CALL SCHEDULE ═══════════════ */
function CallSchedule({mob}){
  const[cs,setCs]=useState("");const[cp,setCp]=useState("all");const[ex,setEx]=useState(null);
  const pm=useMemo(()=>Object.fromEntries(ALL_PARTIES.map(p=>[p.name,p.poc])),[]);
  const pocs=[...new Set(ALL_PARTIES.map(p=>p.poc).filter(Boolean))].sort();
  const all=Object.entries(REORDER).map(([n,r])=>({...r,name:n,poc:pm[n]||""})).sort((a,b)=>{if(a.status==="inactive"&&b.status!=="inactive")return 1;if(a.status!=="inactive"&&b.status==="inactive")return-1;return a.du-b.du;});
  const fl=all.filter(r=>{if(cp!=="all"&&r.poc!==cp)return false;if(cs&&!r.name.toLowerCase().includes(cs.toLowerCase()))return false;return true;});
  const act=fl.filter(r=>r.status==="active"),inact=fl.filter(r=>r.status==="inactive");
  const ov=act.filter(r=>r.du<-(r.mg/2)),sn=act.filter(r=>r.du>=-(r.mg/2)&&r.du<=14),ok=act.filter(r=>r.du>14);
  const dt=ALL_PARTIES.reduce((m,p)=>{m[p.name]=p.dispatchedTotal;return m;},{});

  const Row=({r,bg})=>{
    const invs=INV_MAP[r.name]||[];const open=ex===r.name;
    return <div>
      <div onClick={()=>setEx(open?null:r.name)} style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 100px 90px 100px 70px 50px 50px",padding:mob?"12px 16px":"10px 16px",borderBottom:open?"none":"1px solid #f1f5f9",background:open?"#f8fafc":bg||"#fff",cursor:"pointer",gap:8,alignItems:"center"}}>
        {mob?<div>
          <div style={{fontWeight:600,fontSize:13,marginBottom:3,display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:9,color:"#94a3b8",transform:open?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>{r.name}</div>
          <div style={{display:"flex",gap:10,fontSize:10,fontFamily:MN,color:"#64748b",flexWrap:"wrap"}}>
            <span style={{color:"#059669",fontWeight:600}}>{fmtVal(dt[r.name]||0)}</span>
            <span>Last: {r.ld}</span>
            <span style={{fontWeight:600,color:r.du<0?"#dc2626":r.du<=14?"#ea580c":"#059669"}}>{r.status==="inactive"?"—":r.du<0?Math.abs(r.du)+"d ago":"in "+r.du+"d"}</span>
          </div>
        </div>:<>
          <div style={{fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            <span style={{fontSize:9,color:"#94a3b8",transition:"transform 0.15s",transform:open?"rotate(90deg)":"none"}}>▶</span>{r.name}
          </div>
          <div style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#059669"}}>{fmtVal(dt[r.name]||0)}</div>
          <div style={{fontFamily:MN,fontSize:11,color:"#64748b"}}>{r.ld}</div>
          <div style={{fontFamily:MN,fontSize:11,color:"#64748b"}}>{r.pn}</div>
          <div style={{fontFamily:MN,fontSize:11,fontWeight:600,color:r.status==="inactive"?"#94a3b8":r.du<0?"#dc2626":r.du<=14?"#ea580c":"#059669"}}>{r.status==="inactive"?"—":r.du<0?Math.abs(r.du)+"d ago":"in "+r.du+"d"}</div>
          <div style={{fontFamily:MN,fontSize:10,color:"#64748b"}}>{r.mg>0?r.mg+"d":"—"}</div>
          <div style={{fontFamily:MN,fontSize:10,color:"#94a3b8"}}>{r.cf>0?r.cf+"%":"—"}</div>
        </>}
      </div>
      {open&&<InvoiceExpand invs={invs}/>}
    </div>;
  };
  const SH=({label,count,color,emoji})=><div style={{padding:"8px 16px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",gap:8}}>
    <span style={{fontSize:13}}>{emoji}</span><span style={{fontFamily:MN,fontSize:11,fontWeight:700,color}}>{label}</span><span style={{fontFamily:MN,fontSize:10,color:"#94a3b8"}}>{count}</span>
  </div>;

  return <div style={{...S.card,overflow:"hidden"}}>
    <div style={{padding:"14px 16px",background:"#0f172a",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <input value={cs} onChange={e=>setCs(e.target.value)} placeholder="Search party..." style={{flex:1,minWidth:160,maxWidth:300,padding:"8px 12px",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,background:"rgba(255,255,255,0.08)",color:"#fff",fontFamily:SN,fontSize:12,outline:"none"}}/>
      <select value={cp} onChange={e=>setCp(e.target.value)} style={{padding:"8px 12px",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,background:"rgba(255,255,255,0.08)",color:"#fff",fontFamily:SN,fontSize:12,outline:"none",cursor:"pointer"}}>
        <option value="all">All POC</option>{pocs.map(p=><option key={p} value={p}>{p}</option>)}
      </select>
      <div style={{display:"flex",gap:14,fontSize:11,fontFamily:MN}}>
        <span style={{color:"#f87171",fontWeight:700}}>{ov.length} overdue</span>
        <span style={{color:"#fbbf24",fontWeight:700}}>{sn.length} soon</span>
        <span style={{color:"#4ade80",fontWeight:700}}>{ok.length} ok</span>
      </div>
    </div>
    {!mob&&<div style={{display:"grid",gridTemplateColumns:"1fr 100px 90px 100px 70px 50px 50px",padding:"8px 16px",background:"#1e293b",gap:8}}>{["Party","Dispatched","Last","Predicted","Due","Gap","Conf"].map(h=><div key={h} style={{...S.section,fontSize:9,color:"#64748b"}}>{h}</div>)}</div>}
    {ov.length>0&&<><SH label="Call Now" count={ov.length} color="#dc2626" emoji="🔴"/>{ov.map(r=><Row key={r.name} r={r} bg="#fef2f2"/>)}</>}
    {sn.length>0&&<><SH label="Call Soon" count={sn.length} color="#ea580c" emoji="🟡"/>{sn.map(r=><Row key={r.name} r={r} bg="#fff7ed"/>)}</>}
    {ok.length>0&&<><SH label="On Track" count={ok.length} color="#059669" emoji="🟢"/>{ok.map(r=><Row key={r.name} r={r}/>)}</>}
    {inact.length>0&&<><SH label="Insufficient Data" count={inact.length} color="#94a3b8" emoji="⚪"/>{inact.slice(0,40).map(r=><Row key={r.name} r={r}/>)}</>}
  </div>;
}

/* ═══════════════ PARTY DETAIL ═══════════════ */
function PartyDetail({party,pcf,setPcf,showHist,setShowHist,mob,onBack}){
  if(!party)return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#94a3b8",gap:12,padding:60,textAlign:"center",flex:1}}>
    <div style={{fontSize:40,opacity:0.3}}>👈</div><div style={{fontFamily:MN,fontSize:13}}>Select a party</div>
  </div>;
  const lines=party.orders.flatMap(o=>o.lines);const cats=[...new Set(lines.map(l=>l.category))];
  const shown=pcf==="all"?lines:lines.filter(l=>l.category===pcf);
  const byCat={};shown.forEach(l=>{if(!byCat[l.category])byCat[l.category]=[];byCat[l.category].push(l);});
  const tv=party.pendingValue||party.orders.reduce((s,o)=>s+o.totalValue,0);
  const approved=party.orders.some(o=>!!o.approvalDate);const ps=payStatus(approved);
  const invs=INV_MAP[party.name]||[];const r=REORDER[party.name];const pdata=MONTHLY.data[party.name];

  return <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
    <div style={{background:"linear-gradient(135deg,#0c1222 0%,#1a2744 60%,#2a1f0e 100%)",color:"#fff",padding:"18px 22px",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
        {mob&&<button onClick={onBack} style={{background:"rgba(255,255,255,0.12)",border:"none",color:"#fff",padding:"5px 12px",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:MN}}>←</button>}
        <div style={{fontSize:18,fontWeight:700,letterSpacing:"-0.01em"}}>{party.name}</div>
      </div>
      <div style={{fontFamily:MN,fontSize:11,opacity:0.5,marginBottom:14}}>POC: {party.poc} · Since {party.earliest.toLocaleDateString("en-IN",{month:"short",year:"2-digit"})}</div>

      {r&&<div style={{background:"rgba(255,255,255,0.06)",borderRadius:10,padding:"12px 14px",marginBottom:12,border:"1px solid rgba(255,255,255,0.08)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontSize:10,opacity:0.5,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>Reorder Prediction</div>
            <div style={{fontFamily:MN,fontSize:13,fontWeight:700,color:r.du<-(r.mg/2)?"#f87171":r.du<=14?"#fbbf24":"#4ade80"}}>
              {r.du<-(r.mg/2)?"⚡ "+Math.abs(r.du)+"d overdue — call now":r.du<=14?"⏱ Due in "+r.du+"d ("+r.pn+")":"✓ Next ~"+r.pn+" ("+r.du+"d)"}
            </div>
          </div>
          <div style={{display:"flex",gap:16}}>
            {[["Gap",r.mg+"d"],["Conf",r.cf+"%"],["Orders",r.ic]].map(([l,v])=><div key={l}><div style={{fontSize:9,opacity:0.4,textTransform:"uppercase"}}>{l}</div><div style={{fontFamily:MN,fontSize:12,fontWeight:700}}>{v}</div></div>)}
          </div>
        </div>
      </div>}

      {pdata&&<div style={{background:"rgba(255,255,255,0.06)",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
        <div style={{fontSize:10,opacity:0.5,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Monthly Dispatch</div>
        <div style={{display:"flex",gap:4,overflowX:"auto"}}>
          {MONTHLY.months.map((m,i)=>{const v=pdata[m]||0;const allV=MONTHLY.months.map(mm=>pdata[mm]||0);const mx=Math.max(...allV,1);
            return <div key={m} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:mob?30:36}}>
              <div style={{fontFamily:MN,fontSize:9,fontWeight:v>0?600:400,color:v>0?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.2)"}}>{v>0?fmtVal(v):"—"}</div>
              <div style={{width:"100%",height:32,display:"flex",alignItems:"flex-end"}}>
                <div style={{width:"100%",height:v>0?Math.max(4,Math.round(28*v/mx)):2,background:v>0?"rgba(217,119,6,0.8)":"rgba(255,255,255,0.08)",borderRadius:2}}/>
              </div>
              <div style={{fontFamily:MN,fontSize:8,color:"rgba(255,255,255,0.4)"}}>{MONTHLY.labels[i]}</div>
            </div>;})}
        </div>
      </div>}

      {tv>0&&<div style={{background:"rgba(255,255,255,0.06)",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:10}}>
          {[["Pending",fmtVal(tv),"#fff"],["Dispatched",fmtVal(party.dispatchedTotal||0),"#4ade80"]].map(([l,v,c])=><div key={l}>
            <div style={{fontSize:9,opacity:0.4,textTransform:"uppercase"}}>{l}</div>
            <div style={{fontFamily:MN,fontSize:16,fontWeight:700,color:c}}>{v}</div>
          </div>)}
        </div>
        {ps&&<span style={{fontFamily:MN,fontSize:12,fontWeight:700,padding:"6px 16px",borderRadius:6,background:approved?"rgba(5,150,105,0.25)":"rgba(234,88,12,0.25)",color:approved?"#4ade80":"#fb923c"}}>{ps.label}</span>}
      </div>}

      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {[["Orders",party.orders.length],["Lines",lines.length],["Qty",lines.reduce((s,l)=>s+l.qty,0)],["Cats",cats.length]].map(([l,v])=><div key={l} style={{background:"rgba(255,255,255,0.08)",borderRadius:8,padding:"8px 12px",minWidth:60}}>
          <div style={{fontFamily:MN,fontSize:18,fontWeight:700}}>{v}</div>
          <div style={{fontSize:9,opacity:0.4,textTransform:"uppercase",marginTop:1}}>{l}</div>
        </div>)}
      </div>
    </div>

    <div style={{padding:"10px 16px",borderBottom:"1px solid #e2e8f0",display:"flex",gap:6,flexWrap:"wrap",background:"#f8fafc",flexShrink:0,alignItems:"center"}}>
      {[{v:"all",l:"All",n:lines.length},...cats.map(c=>({v:c,l:(CC[c]||CC.Other).l,n:lines.filter(l=>l.category===c).length}))].map(({v,l,n})=>
        <button key={v} onClick={()=>setPcf(v)} style={{padding:"5px 12px",borderRadius:20,border:"none",background:pcf===v?"#0f172a":"#e2e8f0",color:pcf===v?"#fff":"#475569",fontSize:11,fontFamily:MN,cursor:"pointer",fontWeight:600}}>{l} <span style={{opacity:0.6}}>{n}</span></button>
      )}
      <button onClick={()=>setShowHist(h=>!h)} style={{marginLeft:"auto",padding:"5px 14px",borderRadius:20,border:"none",background:showHist?"#7c3aed":"#e2e8f0",color:showHist?"#fff":"#475569",fontSize:11,fontFamily:MN,cursor:"pointer",fontWeight:600}}>
        {showHist?"Hide":"📋 Invoices"}
      </button>
    </div>

    <div style={{flex:1,overflowY:"auto"}}>
      {showHist&&<div style={{borderBottom:"2px solid #7c3aed",background:"#faf5ff"}}>
        <div style={{padding:"10px 16px",background:"#f3e8ff",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontFamily:MN,fontSize:12,fontWeight:700,color:"#7c3aed"}}>{invs.length} Invoices</span>
          <span style={{fontFamily:MN,fontSize:11,color:"#94a3b8"}}>Total: {fmtVal(party.dispatchedTotal||0)}</span>
        </div>
        {invs.length===0?<div style={{padding:24,textAlign:"center",color:"#94a3b8",fontFamily:MN,fontSize:12}}>No history</div>:
        invs.map(inv=><div key={inv.i} style={{borderBottom:"1px solid #ede9fe"}}>
          <div style={{padding:"8px 16px",background:"#f3e8ff",display:"flex",alignItems:"center",gap:14}}>
            <span style={{fontFamily:MN,fontSize:11,fontWeight:700,color:"#7c3aed"}}>Invoice #{inv.i}</span>
            <span style={{fontFamily:MN,fontSize:10,color:"#94a3b8"}}>{inv.d}</span>
            <span style={{fontFamily:MN,fontSize:12,fontWeight:700,marginLeft:"auto"}}>{fmtVal(inv.t)}</span>
          </div>
          {inv.l&&inv.l.length>0&&(mob?inv.l.map((l,li)=><div key={li} style={{padding:"7px 16px",borderBottom:"1px solid #f3e8ff",fontSize:11}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontFamily:MN,fontWeight:600}}>{l.mo}</span><span style={{fontFamily:MN,fontWeight:700}}>{l.qt} qty</span></div>
            <div style={{display:"flex",gap:8,fontSize:10,color:"#64748b",fontFamily:MN}}><span>{l.co}</span><span>{l.wi}×{l.le}</span><span>{l.ra||"—"}</span><span style={{fontWeight:600}}>{fmtVal(l.va)}</span></div>
          </div>):
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Model","Backing","Colour","Width","Length","Qty","Rate","Value"].map(h=>
              <th key={h} style={{background:"#ede9fe",padding:"6px 14px",textAlign:["Qty","Rate","Value"].includes(h)?"right":"left",fontSize:9,fontFamily:MN,letterSpacing:"0.08em",textTransform:"uppercase",color:"#7c3aed",borderBottom:"1px solid #e9d5ff"}}>{h}</th>
            )}</tr></thead>
            <tbody>{inv.l.map((l,li)=>
              <tr key={li}>
                <td style={{padding:"7px 14px",borderBottom:"1px solid #f3e8ff",fontSize:11,fontFamily:MN}}>{l.mo}</td>
                <td style={{padding:"7px 14px",borderBottom:"1px solid #f3e8ff",fontSize:11,color:"#64748b"}}>{l.bk||"—"}</td>
                <td style={{padding:"7px 14px",borderBottom:"1px solid #f3e8ff",fontSize:12}}>{l.co}</td>
                <td style={{padding:"7px 14px",borderBottom:"1px solid #f3e8ff",fontSize:11,fontFamily:MN}}>{l.wi}</td>
                <td style={{padding:"7px 14px",borderBottom:"1px solid #f3e8ff",fontSize:11,fontFamily:MN,color:"#94a3b8"}}>{l.le}</td>
                <td style={{padding:"7px 14px",borderBottom:"1px solid #f3e8ff",fontSize:11,fontFamily:MN,fontWeight:600,textAlign:"right"}}>{l.qt}</td>
                <td style={{padding:"7px 14px",borderBottom:"1px solid #f3e8ff",fontSize:11,fontFamily:MN,textAlign:"right",color:"#64748b"}}>{l.ra||"—"}</td>
                <td style={{padding:"7px 14px",borderBottom:"1px solid #f3e8ff",fontSize:11,fontFamily:MN,textAlign:"right",fontWeight:600}}>{fmtVal(l.va)}</td>
              </tr>
            )}</tbody>
          </table>)}
        </div>)}
      </div>}

      {Object.entries(byCat).map(([c,ls])=>{const x=CC[c]||CC.Other;const cq=ls.reduce((s,l)=>s+l.qty,0);const cv=ls.reduce((s,l)=>s+(l.value||0),0);
        return <div key={c} style={{borderBottom:"1px solid #e2e8f0"}}>
          <div style={{padding:"10px 16px",background:"#f8fafc",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Dot c={x.c}/><span style={{fontFamily:MN,fontSize:12,fontWeight:700,color:x.c}}>{x.l}</span><span style={{fontSize:11,color:"#94a3b8"}}>{ls.length} items</span></div>
            <div style={{display:"flex",gap:12}}><span style={{fontFamily:MN,fontSize:11,color:"#94a3b8"}}>{cq} qty</span><span style={{fontFamily:MN,fontSize:12,fontWeight:700}}>{fmtVal(cv)}</span></div>
          </div>
          {mob?ls.map(l=><div key={l.no} style={{padding:"8px 16px",borderBottom:"1px solid #f1f5f9",fontSize:11}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontFamily:MN,fontWeight:600}}>{l.model}</span><span style={{fontFamily:MN,fontWeight:700}}>{l.qty} qty</span></div>
            <div style={{display:"flex",gap:8,fontSize:10,color:"#64748b",fontFamily:MN}}><span>{l.colour}</span><span>{l.width}×{l.length}</span><span>{fmtVal(l.value||0)}</span></div>
          </div>):
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Date","Model","Colour","Size","Qty","Rate","Value"].map(h=><th key={h} style={{padding:"7px 16px",textAlign:["Qty","Rate","Value"].includes(h)?"right":"left",...S.section,fontSize:9,background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>{h}</th>)}</tr></thead>
            <tbody>{ls.map((l,i)=><tr key={l.no} style={{background:i%2?"#fafafa":"#fff"}}>
              <td style={{padding:"9px 16px",borderBottom:"1px solid #f1f5f9",fontSize:11,fontFamily:MN,color:"#64748b"}}>{l.piDate}</td>
              <td style={{padding:"9px 16px",borderBottom:"1px solid #f1f5f9",fontSize:12,fontWeight:600}}>{l.model}</td>
              <td style={{padding:"9px 16px",borderBottom:"1px solid #f1f5f9",fontSize:12}}>{l.colour}</td>
              <td style={{padding:"9px 16px",borderBottom:"1px solid #f1f5f9",fontSize:11,fontFamily:MN,color:"#64748b"}}>{l.width}×{l.length}</td>
              <td style={{padding:"9px 16px",borderBottom:"1px solid #f1f5f9",fontSize:14,fontFamily:MN,fontWeight:700,textAlign:"right"}}>{l.qty}</td>
              <td style={{padding:"9px 16px",borderBottom:"1px solid #f1f5f9",fontSize:11,fontFamily:MN,textAlign:"right",color:"#64748b"}}>{l.actualRate||"—"}</td>
              <td style={{padding:"9px 16px",borderBottom:"1px solid #f1f5f9",fontSize:12,fontFamily:MN,fontWeight:600,textAlign:"right"}}>{fmtVal(l.value||0)}</td>
            </tr>)}</tbody>
          </table>}
        </div>;})}
    </div>
  </div>;
}

/* ═══════════════ ANALYTICS ═══════════════ */

/* ═══════ STOCK & PRODUCTION TAB ═══════ */
function StockProduction({mob}){
  const [view,setView]=useState("demand");
  const [sCat,setSCat]=useState("all");
  const [sSrch,setSSrch]=useState("");
  const [sSort,setSSort]=useState("deficit_desc");
  const [selModel,setSelModel]=useState(null);
  const sdData=useMemo(()=>buildStockDemand(RAW),[]);
  const stockByCat=useMemo(()=>{const m={};STOCK.forEach(s=>{const cat=CAT_REV[s.cat]||s.cat;if(!m[cat])m[cat]={qty:0,skus:0};m[cat].qty+=s.qty;m[cat].skus++;});return m;},[]);
  const totalStock=STOCK.reduce((s,i)=>s+i.qty,0);
  const totalCommitted=sdData.filter(d=>d.committed).reduce((s,d)=>s+d.committed,0);
  const totalAvailable=sdData.reduce((s,d)=>s+(d.available||0),0);
  const totalDeficit=sdData.filter(d=>d.deficit>0).reduce((s,d)=>s+d.deficit,0);
  const matchedCount=sdData.filter(d=>d.qty>0&&d.matched).length;
  const unmatchedCount=sdData.filter(d=>d.qty>0&&!d.matched).length;
  const modelGroups=useMemo(()=>{
    const mg={};
    sdData.forEach(d=>{
      const mk=normColor(d.model);if(!mk)return;
      if(!mg[mk])mg[mk]={model:d.model,cat:d.cat,colours:[],totalWH:0,totalComm:0,totalAvail:0,totalDeficit:0};
      mg[mk].colours.push(d);mg[mk].totalWH+=d.warehouseQty||0;mg[mk].totalComm+=d.committed||0;
      mg[mk].totalAvail+=d.available||0;if(d.deficit>0)mg[mk].totalDeficit+=d.deficit;
    });
    return Object.values(mg).sort((a,b)=>b.totalDeficit-a.totalDeficit);
  },[sdData]);
  const colourGroups=useMemo(()=>{
    const cg={};
    sdData.forEach(d=>{
      const ck=normColor(d.color);if(!ck)return;
      if(!cg[ck])cg[ck]={color:d.color,models:[],totalWH:0,totalComm:0,totalAvail:0,totalDeficit:0,minDos:null};
      cg[ck].models.push(d);cg[ck].totalWH+=d.warehouseQty||0;cg[ck].totalComm+=d.committed||0;
      cg[ck].totalAvail+=d.available||0;if(d.deficit>0)cg[ck].totalDeficit+=d.deficit;
      if(d.dos!=null&&(cg[ck].minDos==null||d.dos<cg[ck].minDos))cg[ck].minDos=d.dos;
    });
    return Object.values(cg).sort((a,b)=>{
      if(a.totalDeficit>0&&b.totalDeficit<=0)return -1;
      if(a.totalDeficit<=0&&b.totalDeficit>0)return 1;
      var aDos=a.minDos==null?9999:a.minDos;var bDos=b.minDos==null?9999:b.minDos;
      return aDos-bDos;
    });
  },[sdData]);
  const allModels=modelGroups.map(m=>m.model);
  const selMG=selModel?modelGroups.find(m=>normColor(m.model)===normColor(selModel)):null;
  const [selColour,setSelColour]=useState(null);
  const [cpCat,setCpCat]=useState("all");
  const filteredCG=useMemo(()=>{
    if(cpCat==="all")return colourGroups;
    const sCat=CAT_MAP[cpCat];
    return colourGroups.map(cg=>{
      const fm=cg.models.filter(d=>d.cat===sCat);
      if(fm.length===0)return null;
      return {color:cg.color,models:fm,totalWH:fm.reduce((s,d)=>s+(d.warehouseQty||0),0),totalComm:fm.reduce((s,d)=>s+(d.committed||0),0),totalAvail:fm.reduce((s,d)=>s+(d.available||0),0),totalDeficit:fm.filter(d=>d.deficit>0).reduce((s,d)=>s+d.deficit,0),minDos:fm.reduce((m,d)=>d.dos!=null&&(m==null||d.dos<m)?d.dos:m,null)};
    }).filter(Boolean).sort((a,b)=>{
      if(a.totalDeficit>0&&b.totalDeficit<=0)return -1;
      if(a.totalDeficit<=0&&b.totalDeficit>0)return 1;
      var ad=a.minDos==null?9999:a.minDos;var bd=b.minDos==null?9999:b.minDos;return ad-bd;
    });
  },[colourGroups,cpCat]);
  const selCG=selColour?filteredCG.find(c=>normColor(c.color)===normColor(selColour)):null;
  const filtered=useMemo(()=>{
    let items=sdData;
    if(view==="demand")items=items.filter(d=>d.qty>0);
    else if(view==="inventory")items=items.filter(d=>d.stockQty>0);
    else if(view==="production")items=items.filter(d=>d.deficit>0);
    if(sCat!=="all")items=items.filter(d=>(CAT_REV[d.cat]||d.cat)===sCat);
    if(sSrch){const q=sSrch.toLowerCase();items=items.filter(d=>(d.model+d.color).toLowerCase().includes(q));}
    if(sSort==="deficit_desc")items=[...items].sort((a,b)=>b.deficit-a.deficit);
    else if(sSort==="dos_asc")items=[...items].sort((a,b)=>(a.dos===null?9999:a.dos)-(b.dos===null?9999:b.dos));
    else if(sSort==="velocity_desc")items=[...items].sort((a,b)=>(b.vel?b.vel.r:0)-(a.vel?a.vel.r:0));
    else if(sSort==="stock_desc")items=[...items].sort((a,b)=>b.stockQty-a.stockQty);
    return items;
  },[sdData,view,sCat,sSrch,sSort]);
  const headers=view==="production"
    ?["Category","Model","Colour","Width","Velocity","Committed","Warehouse","Available","Days Left","Produce","Priority"]
    :["Category","Model","Colour","Width","Avg/mo","Trend","Committed","Warehouse","Available","Days Left","Shortfall"];
  const rightCols=["Avg/mo","Committed","Warehouse","Available","Days Left","Shortfall","Velocity","Produce","Priority"];
  return <div>
    <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":"repeat(auto-fill,minmax(155px,1fr))",gap:12,marginBottom:20}}>
      {[["Warehouse",totalStock,"#64748b"],["Committed",totalCommitted,"#ea580c"],["Available",totalAvailable,"#059669"],["Shortfall",totalDeficit,"#dc2626"],["Matched",matchedCount+"/"+sdData.filter(d=>d.qty>0).length,"#2563eb"]].map(([l,v,c])=>
        <div key={l} style={{...S.card,padding:"14px 16px",borderLeft:"4px solid "+c}}>
          <div style={{...S.section,fontSize:9,marginBottom:4}}>{l}</div>
          <div style={{fontFamily:MN,fontSize:20,fontWeight:700,color:c}}>{v}</div>
        </div>
      )}
    </div>
    <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"repeat(4,1fr)",gap:12,marginBottom:20}}>
      {Object.entries(stockByCat).map(([cat,s])=>{const x=CC[cat]||CC.Other;const comm=sdData.filter(d=>(CAT_REV[d.cat]||d.cat)===cat&&d.qty>0).reduce((ss,d)=>ss+d.committed,0);const avail=sdData.filter(d=>(CAT_REV[d.cat]||d.cat)===cat).reduce((ss,d)=>ss+(d.available||0),0);const pct=s.qty>0?Math.round(avail/s.qty*100):0;
        return <div key={cat} style={{...S.card,padding:14}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><Dot c={x.c} s={7}/><span style={{fontFamily:MN,fontSize:11,fontWeight:700,color:x.c}}>{x.l||cat}</span></div>
          <div style={{display:"flex",gap:12,marginBottom:8}}>{[["WH",s.qty,"#64748b"],["Comm",comm,"#ea580c"],["Avail",avail,"#059669"]].map(([ll,vv,cc])=><div key={ll}><div style={{fontSize:8,color:"#94a3b8",fontFamily:MN,textTransform:"uppercase"}}>{ll}</div><div style={{fontFamily:MN,fontSize:15,fontWeight:700,color:cc}}>{vv}</div></div>)}</div>
          <div style={{height:5,background:"#f1f5f9",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:Math.max(pct,0)+"%",background:pct>=60?"#22c55e":pct>=30?"#eab308":"#ef4444",borderRadius:3}}/></div>
        </div>;
      })}
    </div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",gap:4}}>{[["demand","Demand vs Stock"],["production","Production Plan"],["colours","Colour Planner"],["inventory","Full Inventory"]].map(([id,l])=>
        <div key={id} onClick={()=>{setView(id);if(id==="colours"&&!selColour&&filteredCG.length)setSelColour(filteredCG[0].color);}} style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:view===id?700:400,color:view===id?"#0f172a":"#94a3b8",background:view===id?"#fff":"transparent",border:view===id?"1px solid #e2e8f0":"1px solid transparent",cursor:"pointer"}}>{l}</div>
      )}</div>
      <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
        <input value={sSrch} onChange={e=>setSSrch(e.target.value)} placeholder="Search..." style={{...S.input,width:180,fontSize:12}}/>
        <select value={sCat} onChange={e=>setSCat(e.target.value)} style={{...S.select,fontSize:12}}><option value="all">All</option>{["Loop Rolls","TEFNO","Turf","Wire"].map(c=><option key={c} value={c}>{c}</option>)}</select>
        <select value={sSort} onChange={e=>setSSort(e.target.value)} style={{...S.select,fontSize:12}}><option value="deficit_desc">Highest Shortfall</option><option value="dos_asc">Lowest Days Left</option><option value="velocity_desc">Fastest Moving</option><option value="stock_desc">Most Stock</option></select>
        <span style={{fontFamily:MN,fontSize:11,color:"#94a3b8"}}>{filtered.length}</span>
      </div>
    </div>
    {view!=="colours"&&<div style={{...S.card,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{headers.map(h=><th key={h} style={{padding:"10px 12px",background:"#0f172a",color:"#fff",fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",textAlign:rightCols.indexOf(h)>=0?"right":"left"}}>{h}</th>)}</tr></thead>
        <tbody>{filtered.slice(0,80).map((d,i)=>{
          const cl=(CC[CAT_REV[d.cat]]||CC.Other);const v=d.vel;const dos=d.dos;
          const dosC=dos==null?"#94a3b8":dos<=7?"#dc2626":dos<=21?"#ea580c":dos<=45?"#eab308":"#059669";
          const tI=v?v.t==="u"?"↑":v.t==="d"?"↓":"→":"—";
          const tC=v?v.t==="u"?"#dc2626":v.t==="d"?"#059669":"#64748b":"#94a3b8";
          const avC=(d.available||0)>0?"#059669":"#ea580c";
          const pri=dos!=null&&dos<=7?"🔴 Critical":dos!=null&&dos<=14?"🟠 High":d.deficit>0?"🟡 Short":dos!=null&&dos<=30?"🟡 Low":"✅ OK";
          return <tr key={i} style={{background:i%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9"}}>
            <td style={{padding:"8px 12px"}}><span style={{...S.pill,background:cl.b,color:cl.c,fontSize:10}}><Dot c={cl.c} s={5}/>{cl.l}</span></td>
            <td style={{padding:"8px 12px",fontFamily:MN,fontSize:12,fontWeight:600}}>{d.model}</td>
            <td style={{padding:"8px 12px",fontSize:12}}>{d.color}</td>
            <td style={{padding:"8px 12px",fontFamily:MN,fontSize:11,color:"#64748b"}}>{d.wLabel}</td>
            {view==="production"?<>
              <td style={{padding:"8px 12px",fontFamily:MN,fontSize:11,textAlign:"right",color:"#64748b"}}>{v?v.r+"/mo":"—"}</td>
              <td style={{padding:"8px 12px",fontFamily:MN,fontSize:12,fontWeight:600,textAlign:"right",color:"#ea580c"}}>{d.committed||"—"}</td>
              <td style={{padding:"8px 12px",fontFamily:MN,fontSize:12,textAlign:"right",color:"#64748b"}}>{d.warehouseQty||0}</td>
              <td style={{padding:"8px 12px",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right",color:avC}}>{d.available||0}</td>
              <td style={{padding:"8px 12px",textAlign:"right"}}><span style={{fontFamily:MN,fontSize:11,fontWeight:700,color:dosC,padding:"3px 8px",borderRadius:6,background:dosC+"14"}}>{dos!=null?dos+"d":"—"}</span></td>
              <td style={{padding:"8px 12px",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right",color:"#dc2626"}}>{d.deficit>0?d.deficit:"—"}</td>
              <td style={{padding:"8px 12px",textAlign:"right",fontFamily:MN,fontSize:10,fontWeight:600}}>{pri}</td>
            </>:<>
              <td style={{padding:"8px 12px",fontFamily:MN,fontSize:11,textAlign:"right",color:"#64748b"}}>{v?v.a.toFixed(0):"—"}</td>
              <td style={{padding:"8px 12px",textAlign:"right"}}><span style={{fontFamily:MN,fontSize:11,fontWeight:700,color:tC}}>{tI}</span></td>
              <td style={{padding:"8px 12px",fontFamily:MN,fontSize:12,fontWeight:600,textAlign:"right",color:"#ea580c"}}>{d.committed||"—"}</td>
              <td style={{padding:"8px 12px",fontFamily:MN,fontSize:12,textAlign:"right",color:"#64748b"}}>{d.warehouseQty||0}</td>
              <td style={{padding:"8px 12px",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right",color:avC}}>{d.available||0}</td>
              <td style={{padding:"8px 12px",textAlign:"right"}}><span style={{fontFamily:MN,fontSize:11,fontWeight:700,color:dosC,padding:"3px 8px",borderRadius:6,background:dosC+"14"}}>{dos!=null?dos+"d":"—"}</span></td>
              <td style={{padding:"8px 12px",textAlign:"right"}}><span style={{fontFamily:MN,fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:6,background:d.deficit>0?"#fef2f2":"#f0fdf4",color:d.deficit>0?"#dc2626":"#059669"}}>{d.deficit>0?"-"+d.deficit:"+"+Math.abs(d.deficit)}</span></td>
            </>}
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {view==="colours"&&<div>
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
        {["all","Loop Rolls","TEFNO","Turf","Wire"].map(c=>{
          const x=c==="all"?{c:"#0f172a",b:"#f1f5f9",l:"All Categories"}:(CC[c]||CC.Other);
          const cnt=c==="all"?colourGroups.filter(cg=>cg.totalWH>0||cg.totalComm>0).length:colourGroups.filter(cg=>{const sCat=CAT_MAP[c];return cg.models.some(m=>m.cat===sCat)&&(cg.totalWH>0||cg.totalComm>0);}).length;
          return <div key={c} onClick={()=>{setCpCat(c);setSelColour(null);}} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:cpCat===c?700:500,color:cpCat===c?"#fff":x.c,background:cpCat===c?x.c:x.b,cursor:"pointer",border:cpCat===c?"none":"1px solid #e2e8f0",display:"flex",alignItems:"center",gap:6}}>
            {c!=="all"&&<Dot c={cpCat===c?"#fff":x.c} s={6}/>}{x.l||c}<span style={{fontFamily:MN,fontSize:10,opacity:0.7,marginLeft:4}}>{cnt}</span>
          </div>;
        })}
      </div>
      <div style={{display:"flex",gap:12,flexWrap:mob?"wrap":"nowrap"}}>
        <div style={{...S.card,flex:"0 0 240px",maxHeight:520,overflow:"hidden",display:"flex",flexDirection:"column",width:mob?"100%":"auto"}}>
          <div style={{padding:"12px 14px",background:"#0f172a",color:"#fff",fontFamily:MN,fontSize:10,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>
            {cpCat==="all"?"All Colours":(CC[cpCat]||CC.Other).l+" Colours"} · {filteredCG.filter(c=>c.totalWH>0||c.totalComm>0).length}
          </div>
          <div style={{overflowY:"auto",flex:1}}>
            {filteredCG.filter(c=>c.totalWH>0||c.totalComm>0).map(c=>{
              const sel=selColour&&normColor(selColour)===normColor(c.color);
              const dosC=c.minDos==null?"#94a3b8":c.minDos<=7?"#dc2626":c.minDos<=14?"#ea580c":c.minDos<=30?"#eab308":"#059669";
              return <div key={c.color} onClick={()=>setSelColour(c.color)} style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",cursor:"pointer",background:sel?"#eff6ff":"#fff",borderLeft:sel?"3px solid #2563eb":"3px solid transparent"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:13,fontWeight:700}}>{c.color}</span>
                  {c.minDos!=null&&<span style={{fontFamily:MN,fontSize:10,fontWeight:700,color:dosC,padding:"2px 6px",borderRadius:4,background:dosC+"14"}}>{c.minDos}d</span>}
                </div>
                <div style={{display:"flex",gap:8,fontSize:10,fontFamily:MN,color:"#64748b"}}>
                  <span>{c.totalWH} wh</span><span style={{color:"#ea580c"}}>{c.totalComm} comm</span><span style={{color:"#059669"}}>{c.totalAvail} avail</span>
                </div>
                {c.totalDeficit>0&&<div style={{marginTop:3,fontFamily:MN,fontSize:10,fontWeight:700,color:"#dc2626"}}>Short {c.totalDeficit} rolls</div>}
              </div>;
            })}
          </div>
        </div>
        <div style={{flex:1,minWidth:0}}>
          {selCG?<div>
            <div style={{marginBottom:16,padding:"18px 22px",background:"linear-gradient(135deg,#0c1222,#1a2744)",borderRadius:12,color:"#fff"}}>
              <div style={{fontSize:22,fontWeight:700,marginBottom:8}}>{selCG.color}</div>
              <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
                {[["Warehouse",selCG.totalWH,"#94a3b8"],["Committed",selCG.totalComm,"#fbbf24"],["Available",selCG.totalAvail,"#4ade80"],["Shortfall",selCG.totalDeficit>0?selCG.totalDeficit:0,"#f87171"]].map(([l,v,c])=>
                  <div key={l}><div style={{fontSize:9,fontFamily:MN,opacity:0.5,textTransform:"uppercase",marginBottom:2}}>{l}</div><div style={{fontFamily:MN,fontSize:22,fontWeight:700,color:c}}>{v}</div></div>
                )}
                {selCG.minDos!=null&&<div><div style={{fontSize:9,fontFamily:MN,opacity:0.5,textTransform:"uppercase",marginBottom:2}}>Lowest Days Left</div><div style={{fontFamily:MN,fontSize:22,fontWeight:700,color:selCG.minDos<=7?"#f87171":selCG.minDos<=14?"#fbbf24":"#4ade80"}}>{selCG.minDos}d</div></div>}
              </div>
              {selCG.totalDeficit>0&&<div style={{marginTop:12,padding:"8px 14px",background:"rgba(248,113,113,0.15)",borderRadius:8,fontFamily:MN,fontSize:12,fontWeight:600}}>⚠ Produce {selCG.totalDeficit} more rolls of {selCG.color} to cover orders</div>}
            </div>
            <div style={{fontFamily:MN,fontSize:11,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:"#94a3b8",marginBottom:8}}>Breakdown by Backing · Model · Width</div>
            <div style={{...S.card,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr>{["Backing","Model","Width","Warehouse","Committed","Available","Velocity","Days Left","Shortfall","Action"].map(h=><th key={h} style={{padding:"10px 12px",background:"#0f172a",color:"#fff",fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",textAlign:["Warehouse","Committed","Available","Velocity","Days Left","Shortfall"].indexOf(h)>=0?"right":"left"}}>{h}</th>)}</tr></thead>
                <tbody>{(()=>{
                  const grp={};
                  selCG.models.forEach(d=>{
                    const bk=d.backing||d.bk||"—";
                    const key=bk+"|"+(d.model||"")+"|"+(d.wLabel||"");
                    if(!grp[key])grp[key]={bk:bk,model:d.model||"",wLabel:d.wLabel||"",wh:0,comm:0,avail:0,deficit:0,velSum:0,velCount:0,minDos:null};
                    const g=grp[key];
                    g.wh+=d.warehouseQty||0;g.comm+=d.committed||0;g.avail+=d.available||0;
                    if(d.deficit>0)g.deficit+=d.deficit;
                    if(d.vel){g.velSum+=d.vel.r;g.velCount++;}
                    if(d.dos!=null&&(g.minDos==null||d.dos<g.minDos))g.minDos=d.dos;
                  });
                  return Object.values(grp).sort((a,b)=>{
                    if(a.deficit>0&&b.deficit<=0)return -1;if(a.deficit<=0&&b.deficit>0)return 1;
                    var ad=a.minDos==null?9999:a.minDos;var bd=b.minDos==null?9999:b.minDos;return ad-bd;
                  }).map((g,i)=>{
                    const dosC=g.minDos==null?"#94a3b8":g.minDos<=7?"#dc2626":g.minDos<=21?"#ea580c":g.minDos<=45?"#eab308":"#059669";
                    const avC=g.avail>0?"#059669":"#ea580c";
                    const velAvg=g.velCount>0?Math.round(g.velSum/g.velCount):0;
                    const action=g.minDos!=null&&g.minDos<=7?"🔴 Produce NOW":g.minDos!=null&&g.minDos<=14?"🟠 Produce soon":g.deficit>0?"🟡 Short":"✅ OK";
                    return <tr key={i} style={{background:i%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9"}}>
                      <td style={{padding:"10px 12px",fontFamily:MN,fontSize:13,fontWeight:700}}>{g.bk}</td>
                      <td style={{padding:"10px 12px",fontFamily:MN,fontSize:12}}>{g.model}</td>
                      <td style={{padding:"10px 12px",fontFamily:MN,fontSize:13,fontWeight:600}}>{g.wLabel}</td>
                      <td style={{padding:"10px 12px",fontFamily:MN,fontSize:14,textAlign:"right",color:"#64748b"}}>{g.wh}</td>
                      <td style={{padding:"10px 12px",fontFamily:MN,fontSize:14,fontWeight:600,textAlign:"right",color:"#ea580c"}}>{g.comm||"—"}</td>
                      <td style={{padding:"10px 12px",fontFamily:MN,fontSize:15,fontWeight:700,textAlign:"right",color:avC}}>{g.avail}</td>
                      <td style={{padding:"10px 12px",fontFamily:MN,fontSize:12,textAlign:"right",color:"#64748b"}}>{velAvg>0?velAvg+"/mo":"—"}</td>
                      <td style={{padding:"10px 12px",textAlign:"right"}}><span style={{fontFamily:MN,fontSize:12,fontWeight:700,color:dosC,padding:"3px 8px",borderRadius:6,background:dosC+"14"}}>{g.minDos!=null?g.minDos+"d":"—"}</span></td>
                      <td style={{padding:"10px 12px",textAlign:"right"}}><span style={{fontFamily:MN,fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:6,background:g.deficit>0?"#fef2f2":"#f0fdf4",color:g.deficit>0?"#dc2626":"#059669"}}>{g.deficit>0?"-"+g.deficit:"+"+Math.abs(g.deficit)}</span></td>
                      <td style={{padding:"10px 12px",fontFamily:MN,fontSize:11,fontWeight:600}}>{action}</td>
                    </tr>;
                  });
                })()}</tbody>
              </table>
            </div>
          </div>:<div style={{padding:40,textAlign:"center",color:"#94a3b8",fontFamily:MN}}>Select a colour from the list</div>}
        </div>
      </div>
    </div>}
    <div style={{marginTop:16,padding:"12px 16px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,display:"flex",gap:20,flexWrap:"wrap",fontSize:10,fontFamily:MN,color:"#64748b"}}>
      <span>Stock: {STOCK.length} SKUs · {totalStock} rolls</span>
      <span>Velocity: {Object.keys(VELOCITY).length} model+colour combos from dispatch history</span>
      <span>Demand: {RAW.length} orders · {RAW.reduce((s,o)=>s+o.lineCount,0)} items</span>
      <span>Match: {matchedCount} matched · {unmatchedCount} unmatched</span>
    </div>
  </div>;
}

/* ═══════ DISPATCH TAB ═══════ */
function DispatchTab({mob}){
  const A=ANALYTICS;
  const [dView,setDView]=useState("monthly");
  const [dSrch,setDSrch]=useState("");
  const [dCat,setDCat]=useState("all");
  const [dExpCat,setDExpCat]=useState(null);
  const [dMonth,setDMonth]=useState("all");
  const months=A.months;const labels=A.labels;
  const maxM=Math.max(...Object.values(A.overallMonthly));

  // Parse INV_MAP for product, party, and category drill-down
  const invData=useMemo(()=>{
    var parties=Object.keys(INV_MAP);
    var allInvs=[];var productMap={};var catDrillByMonth={};
    parties.forEach(function(pname){
      (INV_MAP[pname]||[]).forEach(function(inv){
        var dt=inv.d||"";var month="";
        try{var ps=dt.split("/");month=ps[2]+"-"+(ps[1].length<2?"0"+ps[1]:ps[1]);}catch(e){}
        allInvs.push({party:pname,inv:inv.i,date:dt,month:month,total:inv.t||0,lines:inv.l||[]});
        (inv.l||[]).forEach(function(l){
          var mk=(l.mo||"").toUpperCase()+"|"+(l.co||"").toUpperCase();
          if(!productMap[mk])productMap[mk]={model:l.mo||"",color:l.co||"",totalQty:0,totalVal:0,months:{}};
          var p=productMap[mk];p.totalQty+=l.qt||0;p.totalVal+=l.va||0;
          if(month){p.months[month]=(p.months[month]||0)+(l.va||0);}
          // Determine category purely from width + model
          var catName="Other";
          var mo=(l.mo||"").toUpperCase();
          var wi=(l.wi||"").toLowerCase();
          var bk=(l.bk||"").toLowerCase();
          var LOOP_MODELS=["NIMBO","ALTO","CIRRO","STRATO","HEAVY-DUTY","HEAVY DUTY","METO"];
          if(wi==="3pc"||wi==="5pc")catName="Car Set";
          else if(wi.indexOf("cm")>=0||wi.indexOf("in")>=0)catName="Foot Mat";
          else if(bk==="welcome"||bk==="bathroom mats"||bk==="printing"||bk==="fibre")catName="Foot Mat";
          else if(wi.indexOf("ft")>=0||wi.indexOf("mtr")>=0){
            if(mo.indexOf("TEFNO")>=0)catName="TEFNO";
            else if(mo.indexOf("KAPPA")>=0||mo.indexOf("COSMO")>=0)catName="Turf";
            else if(mo==="25MM"||mo==="35MM"||mo==="20MM")catName="Grass";
            else if(mo==="WIRE")catName="Wire";
            else if(mo==="MONOGRASS")catName="Monograss";
            else if(LOOP_MODELS.indexOf(mo)>=0)catName="Loop Rolls";
            else if(bk==="grass"||bk==="single backing"||bk==="double backing")catName="Grass";
            else catName="Other";
          }
          else if(bk==="grass"||bk==="single backing"||bk==="double backing")catName="Grass";
          else catName="Other";
          // Store per month bucket and "all" bucket
          var buckets=["all"];
          if(month)buckets.push(month);
          buckets.forEach(function(bkt){
            if(!catDrillByMonth[bkt])catDrillByMonth[bkt]={};
            if(!catDrillByMonth[bkt][catName])catDrillByMonth[bkt][catName]={};
            var mbKey=(l.mo||"")+" · "+(l.bk||"—");
            if(!catDrillByMonth[bkt][catName][mbKey])catDrillByMonth[bkt][catName][mbKey]={model:l.mo||"",backing:l.bk||"—",totalQty:0,totalVal:0,widths:{}};
            var mb=catDrillByMonth[bkt][catName][mbKey];
            mb.totalQty+=l.qt||0;mb.totalVal+=l.va||0;
            var wiKey=catName==="Foot Mat"?(l.wi||"")+"×"+(l.le||""):(l.wi||"Other");
            if(!mb.widths[wiKey])mb.widths[wiKey]={qty:0,val:0};
            mb.widths[wiKey].qty+=l.qt||0;mb.widths[wiKey].val+=l.va||0;
          });
        });
      });
    });
    var products=Object.values(productMap).sort(function(a,b){return b.totalVal-a.totalVal;});
    return {allInvs:allInvs,products:products,catDrillByMonth:catDrillByMonth};
  },[]);

  // Filter products by category and search
  var filteredProducts=invData.products;
  if(dSrch){var q=dSrch.toLowerCase();filteredProducts=filteredProducts.filter(function(p){return (p.model+p.color).toLowerCase().indexOf(q)>=0;});}

  // Filter invoices by search
  var filteredInvs=invData.allInvs;
  if(dSrch){var q2=dSrch.toLowerCase();filteredInvs=filteredInvs.filter(function(inv){return inv.party.toLowerCase().indexOf(q2)>=0||inv.lines.some(function(l){return (l.mo||"").toLowerCase().indexOf(q2)>=0;});});}

  return <div>
    {/* Summary */}
    <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":"repeat(5,1fr)",gap:12,marginBottom:20}}>
      {[["Total Dispatched",fmtVal(A.totalDispatched),"#059669"],["Invoices",A.dispatchedCount,"#2563eb"],["Parties Served",A.totalParties,"#7c3aed"],["Avg Invoice",fmtVal(Math.round(A.totalDispatched/Math.max(A.dispatchedCount,1))),"#d97706"],["This Month",fmtVal(A.overallMonthly[months[months.length-1]]||0),"#ea580c"]].map(([l,v,c])=>
        <div key={l} style={{...S.card,padding:"16px",borderLeft:"4px solid "+c}}>
          <div style={{...S.section,fontSize:9,marginBottom:4}}>{l}</div>
          <div style={{fontFamily:MN,fontSize:20,fontWeight:700,color:c}}>{v}</div>
        </div>
      )}
    </div>

    {/* View Toggle */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",gap:4}}>
        {[["monthly","Monthly Comparison"],["products","Product Breakdown"],["parties","Party Dispatch"]].map(([id,l])=>
          <div key={id} onClick={()=>setDView(id)} style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:dView===id?700:400,color:dView===id?"#0f172a":"#94a3b8",background:dView===id?"#fff":"transparent",border:dView===id?"1px solid #e2e8f0":"1px solid transparent",cursor:"pointer"}}>{l}</div>
        )}
      </div>
      {dView!=="monthly"&&<input value={dSrch} onChange={e=>setDSrch(e.target.value)} placeholder={dView==="products"?"Search model, colour...":"Search party..."} style={{...S.input,width:220,fontSize:12}}/>}
    </div>

    {/* 1. Monthly Comparison */}
    {dView==="monthly"&&<div>
      <div style={{...S.card,padding:24,marginBottom:20}}>
        <div style={{...S.section,marginBottom:16}}>Monthly Dispatch Revenue</div>
        <div style={{display:"flex",alignItems:"flex-end",gap:mob?4:8,height:180}}>
          {months.map((m,i)=>{var v=A.overallMonthly[m]||0;var h=v>0?Math.max(12,Math.round(160*v/maxM)):4;
            var prev=i>0?(A.overallMonthly[months[i-1]]||0):0;
            var change=prev>0?Math.round((v-prev)/prev*100):0;
            return <div key={m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div style={{fontFamily:MN,fontSize:mob?7:10,fontWeight:600,color:v>0?"#1e293b":"#cbd5e1",whiteSpace:"nowrap"}}>{v>0?fmtVal(v):"—"}</div>
              {prev>0&&v>0&&<div style={{fontFamily:MN,fontSize:8,color:change>=0?"#059669":"#dc2626",fontWeight:700}}>{change>=0?"+":""}{change}%</div>}
              <div style={{width:"100%",height:h,background:v>0?"linear-gradient(180deg,#d97706,#b45309)":"#f1f5f9",borderRadius:4}}/>
              <div style={{fontFamily:MN,fontSize:mob?7:10,color:"#94a3b8",whiteSpace:"nowrap"}}>{labels[i]}</div>
            </div>;})}
        </div>
      </div>
      <div style={{...S.card,padding:24}}>
        <div style={{...S.section,marginBottom:16}}>Category Breakdown by Month</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
            <thead><tr>
              <th style={{padding:"10px 12px",textAlign:"left",...S.section,fontSize:10,borderBottom:"2px solid #e2e8f0",position:"sticky",left:0,background:"#fff",zIndex:1}}>Category</th>
              {months.map((m,i)=><th key={m} style={{padding:"10px 6px",textAlign:"right",...S.section,fontSize:9,borderBottom:"2px solid #e2e8f0"}}>{labels[i]}</th>)}
              <th style={{padding:"10px 12px",textAlign:"right",...S.section,fontSize:10,borderBottom:"2px solid #e2e8f0",color:"#1e293b"}}>Total</th>
            </tr></thead>
            <tbody>
              {Object.entries(A.catTrends).sort((a,b)=>{var ta=months.reduce((s,m)=>s+(a[1][m]||0),0);var tb=months.reduce((s,m)=>s+(b[1][m]||0),0);return tb-ta;}).map(([cat,vals])=>{
                var x=CC[cat]||CC.Other;var total=months.reduce((s,m)=>s+(vals[m]||0),0);var maxV=Math.max(...months.map(m=>vals[m]||0),1);
                return <tr key={cat}>
                  <td style={{padding:"10px 12px",fontSize:12,fontFamily:MN,fontWeight:600,color:x.c,borderBottom:"1px solid #f1f5f9",position:"sticky",left:0,background:"#fff",zIndex:1,whiteSpace:"nowrap"}}>
                    <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Dot c={x.c} s={5}/>{x.l}</span>
                  </td>
                  {months.map(m=>{var v=vals[m]||0;var int=maxV>0?v/maxV:0;
                    return <td key={m} style={{padding:"10px 6px",textAlign:"right",fontSize:11,fontFamily:MN,borderBottom:"1px solid #f1f5f9",background:v>0?"rgba(217,119,6,"+(0.04+int*0.12)+")":"transparent",color:v>0?"#1e293b":"#d1d5db"}}>{v>0?fmtVal(v):"—"}</td>;})}
                  <td style={{padding:"10px 12px",textAlign:"right",fontSize:12,fontFamily:MN,fontWeight:700,borderBottom:"1px solid #f1f5f9"}}>{fmtVal(total)}</td>
                </tr>;})}
              <tr style={{background:"#f8fafc"}}><td style={{padding:"10px 12px",fontFamily:MN,fontSize:12,fontWeight:700,position:"sticky",left:0,background:"#f8fafc",zIndex:1}}>TOTAL</td>
                {months.map(m=><td key={m} style={{padding:"10px 6px",textAlign:"right",fontFamily:MN,fontSize:11,fontWeight:700}}>{fmtVal(A.overallMonthly[m]||0)}</td>)}
                <td style={{padding:"10px 12px",textAlign:"right",fontFamily:MN,fontSize:13,fontWeight:700,color:AC2}}>{fmtVal(A.totalDispatched)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Category Drill-Down */}
      <div style={{...S.card,padding:24,marginTop:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
          <div style={{...S.section}}>Category Drill-Down · Model · Backing · Width</div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            <div onClick={()=>setDMonth("all")} style={{padding:"5px 12px",borderRadius:6,fontSize:11,fontFamily:MN,fontWeight:dMonth==="all"?700:400,color:dMonth==="all"?"#fff":"#64748b",background:dMonth==="all"?"#0f172a":"#f1f5f9",cursor:"pointer",border:dMonth==="all"?"none":"1px solid #e2e8f0"}}>All Time</div>
            {months.map((m,i)=>
              <div key={m} onClick={()=>setDMonth(m)} style={{padding:"5px 10px",borderRadius:6,fontSize:10,fontFamily:MN,fontWeight:dMonth===m?700:400,color:dMonth===m?"#fff":"#64748b",background:dMonth===m?"#d97706":"#f1f5f9",cursor:"pointer",border:dMonth===m?"none":"1px solid #e2e8f0"}}>{labels[i]}</div>
            )}
          </div>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
          {Object.keys(A.catTrends).sort((a,b)=>{var ta=months.reduce((s,m)=>s+(A.catTrends[a][m]||0),0);var tb=months.reduce((s,m)=>s+(A.catTrends[b][m]||0),0);return tb-ta;}).map(c=>{
            var x=CC[c]||CC.Other;var total=dMonth==="all"?months.reduce((s,m)=>s+((A.catTrends[c]||{})[m]||0),0):((A.catTrends[c]||{})[dMonth]||0);
            return <div key={c} onClick={()=>setDExpCat(dExpCat===c?null:c)} style={{padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:dExpCat===c?700:500,color:dExpCat===c?"#fff":x.c,background:dExpCat===c?x.c:x.b,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
              <Dot c={dExpCat===c?"#fff":x.c} s={6}/>{x.l||c}<span style={{fontFamily:MN,fontSize:10,opacity:0.7,marginLeft:4}}>{fmtVal(total)}</span>
            </div>;
          })}
        </div>
        {dExpCat&&(invData.catDrillByMonth[dMonth]||{})[dExpCat]?<div>
          <div style={{marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <div style={{fontFamily:MN,fontSize:13,fontWeight:700,color:(CC[dExpCat]||CC.Other).c}}>
              {(CC[dExpCat]||CC.Other).l||dExpCat} {dMonth!=="all"?" — "+labels[months.indexOf(dMonth)]:""}
            </div>
            <div style={{fontFamily:MN,fontSize:12,color:"#64748b"}}>
              {Object.values((invData.catDrillByMonth[dMonth]||{})[dExpCat]||{}).reduce((s,mb)=>s+mb.totalQty,0).toLocaleString()} qty · {fmtVal(Object.values((invData.catDrillByMonth[dMonth]||{})[dExpCat]||{}).reduce((s,mb)=>s+mb.totalVal,0))}
            </div>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Model · Backing","Total Qty","Total Value","Width Breakdown"].map(h=><th key={h} style={{padding:"10px 12px",background:"#0f172a",color:"#fff",fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",textAlign:h==="Total Qty"||h==="Total Value"?"right":"left"}}>{h}</th>)}</tr></thead>
            <tbody>{Object.values((invData.catDrillByMonth[dMonth]||{})[dExpCat]||{}).sort((a,b)=>b.totalVal-a.totalVal).map((mb,i)=>{
              var widthEntries=Object.entries(mb.widths).sort((a,b)=>b[1].qty-a[1].qty);
              return <tr key={i} style={{background:i%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9",verticalAlign:"top"}}>
                <td style={{padding:"10px 12px"}}>
                  <div style={{fontFamily:MN,fontSize:12,fontWeight:700}}>{mb.model}</div>
                  <div style={{fontFamily:MN,fontSize:10,color:"#64748b",marginTop:2}}>{mb.backing}</div>
                </td>
                <td style={{padding:"10px 12px",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right"}}>{mb.totalQty.toLocaleString()}</td>
                <td style={{padding:"10px 12px",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right",color:"#059669"}}>{fmtVal(mb.totalVal)}</td>
                <td style={{padding:"10px 12px"}}>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {widthEntries.map(([w,d])=>
                      <div key={w} style={{padding:"4px 10px",borderRadius:6,background:"#f1f5f9",border:"1px solid #e2e8f0"}}>
                        <div style={{fontFamily:MN,fontSize:11,fontWeight:700}}>{w}</div>
                        <div style={{fontFamily:MN,fontSize:10,color:"#64748b"}}>{d.qty} {w.indexOf("pc")>=0?"sets":w.indexOf("×")>=0?"pcs":"rolls"} · {fmtVal(d.val)}</div>
                      </div>
                    )}
                  </div>
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>:<div style={{padding:20,textAlign:"center",color:"#94a3b8",fontFamily:MN,fontSize:12}}>{dExpCat?"No data for this month":"Click a category above to see breakdown"}</div>}
      </div>
    </div>}
    {dView==="products"&&<div style={{...S.card,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["Model","Colour","Total Qty","Total Value","Avg Rate","Top Months"].map(h=><th key={h} style={{padding:"10px 12px",background:"#0f172a",color:"#fff",fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",textAlign:["Total Qty","Total Value","Avg Rate"].indexOf(h)>=0?"right":"left"}}>{h}</th>)}</tr></thead>
        <tbody>{filteredProducts.slice(0,60).map((p,i)=>{
          var avgRate=p.totalQty>0?Math.round(p.totalVal/p.totalQty):0;
          var sortedMonths=Object.entries(p.months).sort((a,b)=>b[1]-a[1]).slice(0,3);
          return <tr key={i} style={{background:i%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9"}}>
            <td style={{padding:"10px 12px",fontFamily:MN,fontSize:12,fontWeight:600}}>{p.model}</td>
            <td style={{padding:"10px 12px",fontSize:12}}>{p.color}</td>
            <td style={{padding:"10px 12px",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right"}}>{p.totalQty.toLocaleString()}</td>
            <td style={{padding:"10px 12px",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right",color:"#059669"}}>{fmtVal(p.totalVal)}</td>
            <td style={{padding:"10px 12px",fontFamily:MN,fontSize:11,textAlign:"right",color:"#64748b"}}>{avgRate>0?("₹"+avgRate):"—"}</td>
            <td style={{padding:"10px 12px",fontSize:10,fontFamily:MN,color:"#64748b"}}>{sortedMonths.map(([m,v])=>{var lbl=labels[months.indexOf(m)]||m;return lbl+": "+fmtVal(v);}).join(" · ")}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}

    {/* 3. Party Dispatch */}
    {dView==="parties"&&<div style={{...S.card,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["Party","Invoice #","Date","Items","Value"].map(h=><th key={h} style={{padding:"10px 12px",background:"#0f172a",color:"#fff",fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",textAlign:["Items","Value"].indexOf(h)>=0?"right":"left"}}>{h}</th>)}</tr></thead>
        <tbody>{filteredInvs.sort((a,b)=>b.total-a.total).slice(0,80).map((inv,i)=>
          <tr key={i} style={{background:i%2===0?"#fff":"#f8fafc",borderBottom:"1px solid #f1f5f9"}}>
            <td style={{padding:"10px 12px",fontSize:12,fontWeight:600,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{inv.party}</td>
            <td style={{padding:"10px 12px",fontFamily:MN,fontSize:11,color:"#7c3aed",fontWeight:600}}>#{inv.inv}</td>
            <td style={{padding:"10px 12px",fontFamily:MN,fontSize:11,color:"#64748b"}}>{inv.date}</td>
            <td style={{padding:"10px 12px",fontFamily:MN,fontSize:11,textAlign:"right",color:"#94a3b8"}}>{inv.lines.length}</td>
            <td style={{padding:"10px 12px",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right",color:"#059669"}}>{fmtVal(inv.total)}</td>
          </tr>
        )}</tbody>
      </table>
    </div>}
  </div>;
}

function AnalyticsTab({mob}){
  const A=ANALYTICS;
  const pocs=Object.entries(A.poc).filter(([k])=>!['Vs','RR','SS','DM'].includes(k)).sort((a,b)=>b[1].dispatched-a[1].dispatched);
  const cats=Object.entries(A.catTrends).sort((a,b)=>{const ta=A.months.reduce((s,m)=>s+(a[1][m]||0),0);const tb=A.months.reduce((s,m)=>s+(b[1][m]||0),0);return tb-ta;});
  const maxM=Math.max(...Object.values(A.overallMonthly));
  const agE=Object.entries(A.aging);const maxA=Math.max(...agE.map(([,v])=>v),1);
  const agC={"0-7":"#22c55e","8-14":"#eab308","15-30":"#f97316","31-60":"#ef4444","60+":"#991b1b"};

  return <div>
    <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":"repeat(5,1fr)",gap:12,marginBottom:24}}>
      {[["Total Dispatched",fmtVal(A.totalDispatched),"#059669","📦"],["Pending Orders",A.pendingCount,"#ea580c","⏳"],["Pending Value",fmtVal(A.totalPending),"#2563eb","💰"],["Cancelled",fmtVal(A.totalCancelled),"#dc2626","✕"],["Parties",A.totalParties,"#7c3aed","👥"]].map(([l,v,c,ico])=>
        <div key={l} style={{...S.card,padding:"18px 16px",borderLeft:"4px solid "+c}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div><div style={{...S.section,fontSize:10,marginBottom:6}}>{l}</div><div style={{fontFamily:MN,fontSize:22,fontWeight:700,color:c}}>{v}</div></div>
            <div style={{fontSize:24,opacity:0.15}}>{ico}</div>
          </div>
        </div>
      )}
    </div>

    <div style={{...S.card,padding:24,marginBottom:24}}>
      <div style={{...S.section,marginBottom:20}}>Monthly Dispatch Revenue</div>
      <div style={{display:"flex",alignItems:"flex-end",gap:mob?6:10,height:160}}>
        {A.months.map((m,i)=>{const v=A.overallMonthly[m]||0;const h=v>0?Math.max(10,Math.round(140*v/maxM)):4;
          return <div key={m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
            <div style={{fontFamily:MN,fontSize:mob?8:10,fontWeight:600,color:v>0?"#1e293b":"#cbd5e1",whiteSpace:"nowrap"}}>{v>0?fmtVal(v):"—"}</div>
            <div style={{width:"100%",height:h,background:v>0?"linear-gradient(180deg,#d97706,#b45309)":"#f1f5f9",borderRadius:4,transition:"height 0.4s ease"}}/>
            <div style={{fontFamily:MN,fontSize:mob?8:10,color:"#94a3b8",whiteSpace:"nowrap"}}>{A.labels[i]}</div>
          </div>;})}
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr",gap:20,marginBottom:24}}>
      <div style={{...S.card,padding:24}}>
        <div style={{...S.section,marginBottom:20}}>Sales POC Performance</div>
        {pocs.map(([poc,s])=>{const tot=s.dispatched+s.pending;const pct=tot>0?Math.round(s.dispatched/tot*100):0;const clr=POC_COLORS[poc]||"#64748b";
          return <div key={poc} style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:28,height:28,borderRadius:8,background:clr+"18",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:MN,fontSize:11,fontWeight:700,color:clr}}>{poc}</div>
                <span style={{fontFamily:MN,fontSize:10,color:"#94a3b8"}}>{s.parties} parties</span>
              </div>
              <span style={{fontFamily:MN,fontSize:13,fontWeight:700}}>{fmtVal(s.dispatched)}</span>
            </div>
            <div style={{height:6,background:"#f1f5f9",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:pct+"%",background:`linear-gradient(90deg,${clr},${clr}aa)`,borderRadius:3}}/></div>
            <div style={{display:"flex",gap:12,fontSize:10,fontFamily:MN,color:"#94a3b8",marginTop:4}}>
              <span>Dispatched: {fmtVal(s.dispatched)}</span><span>Pending: {fmtVal(s.pending)}</span><span style={{color:"#ef4444"}}>Cancelled: {fmtVal(s.cancelled)}</span>
            </div>
          </div>;})}
      </div>

      <div style={{...S.card,padding:24}}>
        <div style={{...S.section,marginBottom:20}}>Pending Aging Distribution</div>
        {agE.map(([label,count])=>{const pct=maxA>0?Math.round(count/maxA*100):0;const c=agC[label];
          return <div key={label} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontFamily:MN,fontSize:12,fontWeight:600,color:c}}>{label} days</span>
              <span style={{fontFamily:MN,fontSize:16,fontWeight:700,color:c}}>{count}</span>
            </div>
            <div style={{height:28,background:"#f8fafc",borderRadius:6,overflow:"hidden"}}>
              <div style={{height:"100%",width:Math.max(pct,3)+"%",background:c,borderRadius:6,opacity:0.8}}/>
            </div>
          </div>;})}
        <div style={{marginTop:18,padding:"14px",background:"linear-gradient(135deg,#fff7ed,#fef2f2)",borderRadius:10}}>
          <div style={{...S.section,fontSize:10,marginBottom:4}}>Total Pending</div>
          <div style={{fontFamily:MN,fontSize:28,fontWeight:700,color:"#ea580c"}}>{A.pendingCount}</div>
        </div>
      </div>
    </div>

    <div style={{...S.card,padding:24}}>
      <div style={{...S.section,marginBottom:16}}>Category Trends (Monthly)</div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
          <thead><tr>
            <th style={{padding:"10px 12px",textAlign:"left",...S.section,fontSize:10,borderBottom:"2px solid #e2e8f0",position:"sticky",left:0,background:"#fff",zIndex:1}}>Category</th>
            {A.months.map((m,i)=><th key={m} style={{padding:"10px 6px",textAlign:"right",...S.section,fontSize:9,borderBottom:"2px solid #e2e8f0"}}>{A.labels[i]}</th>)}
            <th style={{padding:"10px 12px",textAlign:"right",...S.section,fontSize:10,borderBottom:"2px solid #e2e8f0",color:"#1e293b"}}>Total</th>
          </tr></thead>
          <tbody>
            {cats.map(([cat,vals])=>{const x=CC[cat]||CC.Other;const total=A.months.reduce((s,m)=>s+(vals[m]||0),0);const maxV=Math.max(...A.months.map(m=>vals[m]||0),1);
              return <tr key={cat}>
                <td style={{padding:"10px 12px",fontSize:12,fontFamily:MN,fontWeight:600,color:x.c,borderBottom:"1px solid #f1f5f9",position:"sticky",left:0,background:"#fff",zIndex:1,whiteSpace:"nowrap"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:6}}><Dot c={x.c} s={5}/>{x.l}</span>
                </td>
                {A.months.map(m=>{const v=vals[m]||0;const int=maxV>0?v/maxV:0;
                  return <td key={m} style={{padding:"10px 6px",textAlign:"right",fontSize:11,fontFamily:MN,borderBottom:"1px solid #f1f5f9",background:v>0?`rgba(217,119,6,${0.04+int*0.12})`:"transparent",color:v>0?"#1e293b":"#d1d5db"}}>{v>0?fmtVal(v):"—"}</td>;})}
                <td style={{padding:"10px 12px",textAlign:"right",fontSize:12,fontFamily:MN,fontWeight:700,borderBottom:"1px solid #f1f5f9"}}>{fmtVal(total)}</td>
              </tr>;})}
            <tr style={{background:"#f8fafc"}}><td style={{padding:"10px 12px",fontFamily:MN,fontSize:12,fontWeight:700,position:"sticky",left:0,background:"#f8fafc",zIndex:1}}>TOTAL</td>
              {A.months.map(m=><td key={m} style={{padding:"10px 6px",textAlign:"right",fontFamily:MN,fontSize:11,fontWeight:700}}>{fmtVal(A.overallMonthly[m]||0)}</td>)}
              <td style={{padding:"10px 12px",textAlign:"right",fontFamily:MN,fontSize:13,fontWeight:700,color:AC2}}>{fmtVal(A.totalDispatched)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}

/* ═══════ PRODUCTION TAB ═══════ */
const MIXING_ALL=["PVC","SCRAP","CALCIUM","DOP","CPW","ADIL","EPOXY","STERIC ACID","FINOWAX","TITANIUM","HEAT STB."];
const MIXING_GLUE=["PVC PASTE","DOP","CPW","MTO","DBP","D80"];
const MIXING_SHEET=["SCRAP","CALCIUM","DOP","STERIC ACID","CPW"];
const MIX_SECTIONS=[{id:"all",label:"Mixing",materials:MIXING_ALL},{id:"glue",label:"Mixing (Glue)",materials:MIXING_GLUE},{id:"sheet",label:"Mixing (Sheet)",materials:MIXING_SHEET}];
const PROD_COLORS=["P.GREEN","RED","BLUE","GREY","BROWN","MAROON","BEIGE","BLACK","BEIGE-BROWN","LIGHT GREY","DARK GREY","GREEN-BLACK","RED-BLACK","BLUE-BLACK","GREEN-BLUE","RED-BLUE","TAN-BLACK","WHITE","YELLOW"];
const PROD_LINES=["LINE - 1","LINE - 2","LINE - 3"];
const GLUE_LINES=["Line (Glue)"];
const SHEET_LINES=["Sheet Mch."];
const PROD_PRODUCTS=["LOOP","S-MAT","TURF"];
const SHEET_PRODUCTS=["Sheet"];
const SHEET_MODEL_BACKING=["Alto Diamond","Alto Spike","Nimbo Diamond","Nimbo Spike","Cirro Spike","Strato Spike"];
const PROD_SHIFTS=["Day (8 AM - 8 PM)","Night (8 PM - 8 AM)"];
function istHour(){return parseInt(new Date().toLocaleString("en-GB",{hour:"2-digit",hour12:false,timeZone:"Asia/Kolkata"}),10);}
function istToday(){const p=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"});return p;}
function istDateIN(){return new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Asia/Kolkata"});}
function detectShift(){const h=istHour();return (h>=8&&h<20)?PROD_SHIFTS[0]:PROD_SHIFTS[1];}

function ProductionTab({mob,user,role}){
  const isAdmin=role==="admin";
  const[entries,setEntries]=useState([]);const[loading,setLoading]=useState(true);
  const[formOpen,setFormOpen]=useState(false);const[saving,setSaving]=useState(false);
  const[formSection,setFormSection]=useState("");const[formData,setFormData]=useState({});
  const[editIdx,setEditIdx]=useState(null);const[editQty,setEditQty]=useState("");const[deleting,setDeleting]=useState(null);
  const[period,setPeriod]=useState("today");const[saveMsg,setSaveMsg]=useState("");
  const[filterDate,setFilterDate]=useState(istToday());
  const[formColor,setFormColor]=useState("");const[colorFilter,setColorFilter]=useState("all");
  const[formLine,setFormLine]=useState("");const[formProduct,setFormProduct]=useState("");
  const[formShift,setFormShift]=useState(detectShift());
  const[formDate,setFormDate]=useState(istToday());
  const[lineFilter,setLineFilter]=useState("all");const[productFilter,setProductFilter]=useState("all");const[shiftFilter,setShiftFilter]=useState("all");
  const[lots,setLots]=useState(1);const[lotSize,setLotSize]=useState("50");
  const[sheetColor,setSheetColor]=useState("");const[formModelBacking,setFormModelBacking]=useState("");

  // Fetch entries
  useEffect(()=>{
    fetch("/api/production").then(r=>r.json()).then(d=>{setEntries(d.entries||[]);setLoading(false);}).catch(()=>setLoading(false));
  },[]);

  // Filter entries by period
  const filtered=useMemo(()=>{
    const now=new Date();const todayStr=istDateIN();
    let r=entries;
    if(colorFilter!=="all")r=r.filter(e=>e.color===colorFilter);
    if(lineFilter!=="all")r=r.filter(e=>e.line===lineFilter);
    if(productFilter!=="all")r=r.filter(e=>e.product===productFilter);
    if(shiftFilter!=="all")r=r.filter(e=>e.shift===shiftFilter);
    if(period==="today")return r.filter(e=>e.date===todayStr);
    if(period==="date"){const[y,m,d]=filterDate.split("-");const ds=d+"/"+m+"/"+y;return r.filter(e=>e.date===ds);}
    if(period==="7d"){const d7=new Date(now-7*86400000);return r.filter(e=>{try{const p=e.date.split("/");const d=new Date(+p[2],+p[1]-1,+p[0]);return d>=d7;}catch{return false;}});}
    if(period==="30d"){const d30=new Date(now-30*86400000);return r.filter(e=>{try{const p=e.date.split("/");const d=new Date(+p[2],+p[1]-1,+p[0]);return d>=d30;}catch{return false;}});}
    return r;
  },[entries,period,filterDate,colorFilter,lineFilter,productFilter,shiftFilter]);

  // Consumption totals by material
  const consumption=useMemo(()=>{
    const m={};filtered.forEach(e=>{m[e.material]=(m[e.material]||0)+e.qty;});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  },[filtered]);

  // By section
  const bySection=useMemo(()=>{
    const m={};filtered.forEach(e=>{if(!m[e.section])m[e.section]=0;m[e.section]+=e.qty;});
    return m;
  },[filtered]);

  // Today's total
  const todayTotal=useMemo(()=>filtered.reduce((s,e)=>s+e.qty,0),[filtered]);

  // Update form quantity
  const setQty=(section,material,val)=>{
    setFormData(d=>({...d,[section+"|"+material]:val}));
  };
  const getQty=(section,material)=>formData[section+"|"+material]||"";

  // Save
  const handleSave=async()=>{
    if(!formSection){setSaveMsg("Please select a section first");return;}
    if(!formLine){setSaveMsg("Please select a line first");return;}
    if(!formProduct){setSaveMsg("Please select a product first");return;}
    const needsColor=formSection!=="glue";
    const pickedColor=formSection==="sheet"?sheetColor:formColor;
    if(needsColor&&!pickedColor){setSaveMsg("Please select a colour first");return;}
    if(formSection==="sheet"&&!formModelBacking){setSaveMsg("Please select model & backing");return;}
    setSaving(true);setSaveMsg("");
    const ents=[];
    const sec=MIX_SECTIONS.find(s=>s.id===formSection);
    if(!sec){setSaving(false);return;}
    const colorVal=formSection==="sheet"?(sheetColor||formColor):formColor;
    if(formSection==="all"){
      // Mixing — multiplied by lots
      sec.materials.forEach(mat=>{
        const q=parseFloat(getQty(sec.id,mat));
        if(q>0)ents.push({section:sec.label,material:mat,qty:q*lots,color:colorVal,line:formLine,product:formProduct,shift:formShift,lots:lots,lotSize:lotSize});
      });
      const pigQty=parseFloat(getQty("pigment",formColor));
      if(pigQty>0)ents.push({section:"Mixing",material:"PIGMENT",qty:pigQty*lots,color:colorVal,line:formLine,product:formProduct,shift:formShift,lots:lots,lotSize:lotSize});
    } else if(formSection==="glue"){
      // Glue — multiplied by lots (no lot size)
      sec.materials.forEach(mat=>{
        const q=parseFloat(getQty(sec.id,mat));
        if(q>0)ents.push({section:sec.label,material:mat,qty:q*lots,color:"",line:formLine,product:formProduct,shift:formShift,lots:lots});
      });
    } else if(formSection==="sheet"){
      // Sheet — uses sheetColor
      const sc=sheetColor||formColor;
      sec.materials.forEach(mat=>{
        const q=parseFloat(getQty("sheet",mat));
        if(q>0)ents.push({section:sec.label,material:mat,qty:q,color:sc,line:formLine,product:formProduct,shift:formShift,modelBacking:formModelBacking});
      });
      const sheetColQty=parseFloat(getQty("sheetcolour",sc));
      if(sheetColQty>0)ents.push({section:"Mixing (Sheet)",material:"COLOUR",qty:sheetColQty,color:sc,line:formLine,product:formProduct,shift:formShift,modelBacking:formModelBacking});
    }
    if(ents.length===0){setSaving(false);setSaveMsg("No quantities entered");return;}
    try{
      const res=await fetch("/api/production",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entries:ents,user:user?.firstName||user?.emailAddresses?.[0]?.emailAddress||"unknown",date:formDate})});
      const data=await res.json();
      if(data.ok){const wasBackdated=formDate!==istToday();setSaveMsg(data.saved+" entries saved"+(wasBackdated?" ("+formDate+")":""));if(wasBackdated)setPeriod("30d");setFormData({});setFormColor("");setFormLine("");setFormProduct("");setLots(1);setLotSize("50");setSheetColor("");setFormModelBacking("");setFormShift(detectShift());setFormDate(istToday());setFormSection("");
        const r2=await fetch("/api/production");const d2=await r2.json();setEntries(d2.entries||[]);
      }else{setSaveMsg(data.error||"Failed to save");}
    }catch{setSaveMsg("Error saving");}
    finally{setSaving(false);}
  };

  return <div>
    {/* Header */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
      <div>
        <div style={{fontSize:18,fontWeight:600,color:"#0F172A",marginBottom:4}}>Production — Raw Material</div>
        <div style={{fontFamily:MN,fontSize:11,color:"#94A3B8"}}>Mixing department consumption tracking</div>
      </div>
      <button onClick={()=>setFormOpen(o=>!o)} className="hv-btn" style={{fontFamily:MN,fontSize:11,fontWeight:600,color:formOpen?"#475569":"#fff",background:formOpen?"#F1F5F9":"#0F172A",border:formOpen?"1px solid #E5E7EB":"none",borderRadius:8,padding:"8px 18px",cursor:"pointer"}}>{formOpen?"Close":"+ Add Entry"}</button>
    </div>

    {/* Entry Form */}
    {formOpen&&<div style={{background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",marginBottom:24,overflow:"hidden"}}>
      <div style={{padding:"16px 20px",borderBottom:"1px solid #E5E7EB"}}>
        <div style={{fontFamily:MN,fontSize:12,fontWeight:600,color:"#0F172A"}}>Enter raw material usage</div>
        <div style={{fontFamily:MN,fontSize:10,color:"#94A3B8",marginTop:2}}>Select section, then fill in details.</div>
      </div>

      {/* Date */}
      <div style={{padding:"12px 20px",borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#16A34A"}}>Date ·</span>
        <input type="date" value={formDate} onChange={e=>setFormDate(e.target.value)} style={{padding:"8px 12px",border:"1px solid #16A34A",borderRadius:8,background:"#fff",fontSize:13,fontFamily:MN,fontWeight:600,color:"#0F172A",outline:"none",cursor:"pointer"}}/>
        {formDate!==istToday()&&<span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#D97706",background:"#FEF3C7",padding:"2px 8px",borderRadius:4}}>Backdated entry</span>}
      </div>

      {/* Section selector */}
      <div style={{padding:"14px 20px",borderBottom:"1px solid #E5E7EB"}}>
        <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:formSection?"#16A34A":"#D97706",marginBottom:8}}>Section {formSection?"·":"(required)"}</div>
        <div style={{display:"flex",gap:8}}>
          {MIX_SECTIONS.map(sec=>
            <div key={sec.id} className={formSection!==sec.id?"hv-pill":""} onClick={()=>{setFormSection(sec.id);setFormData({});setFormColor("");setSheetColor("");setLots(1);setLotSize("50");setFormLine(sec.id==="glue"?"Line (Glue)":sec.id==="sheet"?"Sheet Mch.":"");setFormProduct(sec.id==="sheet"?"Sheet":"");setFormModelBacking("");}} style={{flex:1,padding:"12px",borderRadius:8,border:formSection===sec.id?"2px solid #2563EB":"1px solid #E5E7EB",background:formSection===sec.id?"#EFF6FF":"#F8FAFC",color:formSection===sec.id?"#2563EB":"#475569",fontSize:12,fontFamily:MN,fontWeight:formSection===sec.id?700:500,cursor:"pointer",textAlign:"center"}}>{sec.label}</div>
          )}
        </div>
      </div>

      {/* Line + Product + Shift + Colour (shown after section selected) */}
      {formSection&&<div style={{padding:"14px 20px",borderBottom:"1px solid #E5E7EB",background:(formLine&&formProduct&&(formSection==="glue"||formColor||(formSection==="sheet"&&sheetColor)))?"#F0FDF4":"#FFFBEB"}}>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr 1fr":"repeat("+(formSection==="glue"?3:formSection==="sheet"?5:4)+",1fr)",gap:12}}>
          <div>
            <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:formLine?"#16A34A":"#D97706",marginBottom:5}}>Line</div>
            <select value={formLine} onChange={e=>setFormLine(e.target.value)} style={{width:"100%",padding:"8px 12px",border:"1px solid "+(formLine?"#16A34A":"#D97706"),borderRadius:8,background:"#fff",fontSize:13,fontFamily:MN,fontWeight:600,color:formLine?"#0F172A":"#94A3B8",outline:"none",cursor:"pointer"}}>
              <option value="">Select...</option>
              {(formSection==="glue"?GLUE_LINES:formSection==="sheet"?SHEET_LINES:PROD_LINES).map(l=><option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:formProduct?"#16A34A":"#D97706",marginBottom:5}}>Product</div>
            <select value={formProduct} onChange={e=>setFormProduct(e.target.value)} style={{width:"100%",padding:"8px 12px",border:"1px solid "+(formProduct?"#16A34A":"#D97706"),borderRadius:8,background:"#fff",fontSize:13,fontFamily:MN,fontWeight:600,color:formProduct?"#0F172A":"#94A3B8",outline:"none",cursor:"pointer"}}>
              <option value="">Select...</option>
              {(formSection==="sheet"?SHEET_PRODUCTS:PROD_PRODUCTS).map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#16A34A",marginBottom:5}}>Shift</div>
            <select value={formShift} onChange={e=>setFormShift(e.target.value)} style={{width:"100%",padding:"8px 12px",border:"1px solid #16A34A",borderRadius:8,background:"#fff",fontSize:13,fontFamily:MN,fontWeight:600,color:"#0F172A",outline:"none",cursor:"pointer"}}>
              {PROD_SHIFTS.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {formSection!=="glue"&&<div>
            <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:formColor?"#16A34A":"#D97706",marginBottom:5}}>Colour</div>
            <select value={formSection==="sheet"?sheetColor:formColor} onChange={e=>formSection==="sheet"?setSheetColor(e.target.value):setFormColor(e.target.value)} style={{width:"100%",padding:"8px 12px",border:"1px solid "+(((formSection==="sheet"?sheetColor:formColor))?"#16A34A":"#D97706"),borderRadius:8,background:"#fff",fontSize:13,fontFamily:MN,fontWeight:600,color:((formSection==="sheet"?sheetColor:formColor))?"#0F172A":"#94A3B8",outline:"none",cursor:"pointer"}}>
              <option value="">Select...</option>
              {PROD_COLORS.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>}
          {formSection==="sheet"&&<div>
            <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:formModelBacking?"#16A34A":"#D97706",marginBottom:5}}>Model & Backing</div>
            <select value={formModelBacking} onChange={e=>setFormModelBacking(e.target.value)} style={{width:"100%",padding:"8px 12px",border:"1px solid "+(formModelBacking?"#16A34A":"#D97706"),borderRadius:8,background:"#fff",fontSize:13,fontFamily:MN,fontWeight:600,color:formModelBacking?"#0F172A":"#94A3B8",outline:"none",cursor:"pointer"}}>
              <option value="">Select...</option>
              {SHEET_MODEL_BACKING.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>}
        </div>
      </div>}

      {/* Materials — shown when all required fields are filled */}
      {formSection&&formLine&&formProduct&&(formSection==="glue"||formColor||(formSection==="sheet"&&sheetColor))&&<div style={{padding:"12px 20px 16px",background:"#F8FAFC"}}>
        <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"repeat(2,1fr)",gap:8}}>
          {(MIX_SECTIONS.find(s=>s.id===formSection)||{materials:[]}).materials.map(mat=>
            <div key={mat} style={{display:"flex",alignItems:"center",gap:10,background:"#fff",borderRadius:8,border:"1px solid #E5E7EB",padding:"8px 14px"}}>
              <span style={{flex:1,fontSize:12,fontWeight:500,color:"#475569"}}>{mat}</span>
              <input type="number" min="0" step="0.1" value={getQty(formSection==="sheet"?"sheet":formSection,mat)} onChange={e=>setQty(formSection==="sheet"?"sheet":formSection,mat,e.target.value)} placeholder="kg" style={{width:80,padding:"6px 10px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,fontFamily:MN,textAlign:"right",outline:"none",color:"#0F172A"}}/>
            </div>
          )}
        </div>

        {/* Pigment — only for Mixing */}
        {formSection==="all"&&formColor&&<div style={{marginTop:14,borderTop:"1px solid #E5E7EB",paddingTop:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",borderRadius:8,border:"1px solid "+(parseFloat(getQty("pigment",formColor))>0?"#7C3AED40":"#E5E7EB"),padding:"10px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontFamily:MN,fontSize:10,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#7C3AED"}}>Pigment</span>
              <span style={{fontSize:12,fontWeight:500,color:"#475569"}}>{formColor}</span>
            </div>
            <input type="number" min="0" step="0.001" value={getQty("pigment",formColor)} onChange={e=>setQty("pigment",formColor,e.target.value)} placeholder="kg" style={{width:90,padding:"6px 10px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,fontFamily:MN,textAlign:"right",outline:"none",color:"#0F172A"}}/>
          </div>
        </div>}


        {/* Lot Size + Lots — Mixing has both, Mixing (Glue) has only Lots */}
        {(formSection==="all"||formSection==="glue")&&<div style={{marginTop:14,borderTop:"1px solid #E5E7EB",paddingTop:14}}>
          <div style={{display:"grid",gridTemplateColumns:formSection==="glue"?"1fr":"1fr 1fr",gap:16}}>
            {formSection==="all"&&<div>
              <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#475569",marginBottom:8}}>Lot Size</div>
              <div style={{display:"flex",gap:6}}>
                {["50","100"].map(s=>
                  <div key={s} onClick={()=>setLotSize(s)} style={{flex:1,padding:"10px",borderRadius:8,border:lotSize===s?"2px solid #2563EB":"1px solid #E5E7EB",background:lotSize===s?"#EFF6FF":"#F8FAFC",color:lotSize===s?"#2563EB":"#475569",fontSize:13,fontFamily:MN,fontWeight:lotSize===s?700:500,cursor:"pointer",textAlign:"center"}}>{s} kg</div>
                )}
              </div>
            </div>}
            <div>
              <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#475569",marginBottom:8}}>Number of Lots</div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <button onClick={()=>setLots(l=>Math.max(1,l-1))} style={{width:30,height:30,borderRadius:6,border:"1px solid #E5E7EB",background:"#fff",color:"#0F172A",fontFamily:MN,fontSize:14,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                <span style={{fontFamily:MN,fontSize:18,fontWeight:700,color:"#0F172A",minWidth:36,textAlign:"center"}}>{lots}</span>
                <button onClick={()=>setLots(l=>Math.min(20,l+1))} style={{width:30,height:30,borderRadius:6,border:"1px solid #E5E7EB",background:"#fff",color:"#0F172A",fontFamily:MN,fontSize:14,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
              </div>
            </div>
          </div>
          {formSection==="all"&&<div style={{fontFamily:MN,fontSize:10,color:"#94A3B8",marginTop:8}}>Total: {lots} × {lotSize} kg = {lots*parseInt(lotSize)} kg</div>}
          {lots>1&&(()=>{
            const sec=MIX_SECTIONS.find(s=>s.id===formSection);
            const matTotals=sec.materials.map(mat=>{const q=parseFloat(getQty(formSection,mat))||0;return q>0?[mat,q,q*lots]:null;}).filter(Boolean);
            const pigQ=formSection==="all"?(parseFloat(getQty("pigment",formColor))||0):0;
            if(matTotals.length===0&&pigQ===0)return null;
            const grandTotal=matTotals.reduce((s,m)=>s+m[2],0);
            return <div style={{marginTop:12,background:"#0F172A",borderRadius:8,padding:"12px 16px"}}>
              <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:10}}>Total after {lots} lots{formSection==="all"?` × ${lotSize} kg`:""}</div>
              <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"repeat(3,1fr)",gap:6}}>
                {matTotals.map(([mat,per,total])=>
                  <div key={mat} style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}>
                    <span style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>{mat}</span>
                    <span style={{fontFamily:MN,fontSize:11,fontWeight:700,color:"#fff"}}>{total.toFixed(1)} kg</span>
                  </div>
                )}
                {pigQ>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}>
                  <span style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>PIGMENT</span>
                  <span style={{fontFamily:MN,fontSize:11,fontWeight:700,color:"#fff"}}>{(pigQ*lots).toFixed(3)} kg</span>
                </div>}
              </div>
              <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.1)",display:"flex",justifyContent:"space-between"}}>
                <span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.5)"}}>Grand Total</span>
                <span style={{fontFamily:MN,fontSize:14,fontWeight:700,color:"#4ade80"}}>{(grandTotal+(pigQ*lots)).toFixed(1)} kg</span>
              </div>
            </div>;
          })()}
        </div>}

        {/* Colour — only for Sheet */}
        {formSection==="sheet"&&sheetColor&&<div style={{marginTop:14,borderTop:"1px solid #E5E7EB",paddingTop:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",borderRadius:8,border:"1px solid "+(parseFloat(getQty("sheetcolour",sheetColor))>0?"#7C3AED40":"#E5E7EB"),padding:"10px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontFamily:MN,fontSize:10,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#7C3AED"}}>Colour</span>
              <span style={{fontSize:12,fontWeight:500,color:"#475569"}}>{sheetColor}</span>
            </div>
            <input type="number" min="0" step="0.001" value={getQty("sheetcolour",sheetColor)} onChange={e=>setQty("sheetcolour",sheetColor,e.target.value)} placeholder="kg" style={{width:90,padding:"6px 10px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,fontFamily:MN,textAlign:"right",outline:"none",color:"#0F172A"}}/>
          </div>
        </div>}
      </div>}

      {/* Save */}
      <div style={{padding:"14px 20px",borderTop:"1px solid #E5E7EB",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>{saveMsg&&<span style={{fontFamily:MN,fontSize:11,color:saveMsg.includes("saved")?"#16A34A":"#DC2626"}}>{saveMsg}</span>}</div>
        <button onClick={handleSave} disabled={saving} className="hv-btn" style={{fontFamily:MN,fontSize:12,fontWeight:600,color:"#fff",background:saving?"#94A3B8":"#0F172A",border:"none",borderRadius:8,padding:"10px 24px",cursor:saving?"default":"pointer"}}>{saving?"Saving...":"Save Entry"}</button>
      </div>
    </div>}


    {/* Consumption Insights */}
    {loading?<div style={{padding:40,textAlign:"center",fontFamily:MN,fontSize:12,color:"#94A3B8"}}>Loading production data...</div>:<div>

      {/* Period + Line + Product + Colour Filter */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {[["today","Today"],["date","Pick date"],["7d","7 Days"],["30d","30 Days"],["all","All Time"]].map(([v,l])=>
            <div key={v} className={period!==v?"hv-pill":""} onClick={()=>setPeriod(v)} style={{padding:"6px 14px",borderRadius:6,border:period===v?"1px solid #2563EB":"1px solid #E5E7EB",background:period===v?"#EFF6FF":"#F1F5F9",color:period===v?"#2563EB":"#334155",fontSize:11,fontFamily:MN,cursor:"pointer",fontWeight:period===v?600:500}}>{l}</div>
          )}
          {period==="date"&&<input type="date" value={filterDate} onChange={e=>{setFilterDate(e.target.value);}} style={{padding:"5px 10px",border:"1px solid #2563EB",borderRadius:6,background:"#EFF6FF",fontSize:11,fontFamily:MN,fontWeight:600,color:"#2563EB",outline:"none",cursor:"pointer"}}/>}
        </div>
        {(()=>{const availLines=[...new Set(entries.map(e=>e.line).filter(Boolean))].sort();
          return availLines.length>0&&<select value={lineFilter} onChange={e=>setLineFilter(e.target.value)} style={{padding:"6px 12px",border:"1px solid "+(lineFilter!=="all"?"#2563EB":"#E5E7EB"),borderRadius:6,background:lineFilter!=="all"?"#EFF6FF":"#F1F5F9",color:lineFilter!=="all"?"#2563EB":"#334155",fontSize:11,fontFamily:MN,fontWeight:lineFilter!=="all"?600:500,cursor:"pointer",outline:"none"}}><option value="all">All lines</option>{availLines.map(l=><option key={l} value={l}>{l}</option>)}</select>;
        })()}
        {(()=>{const availProducts=[...new Set(entries.map(e=>e.product).filter(Boolean))].sort();
          return availProducts.length>0&&<select value={productFilter} onChange={e=>setProductFilter(e.target.value)} style={{padding:"6px 12px",border:"1px solid "+(productFilter!=="all"?"#2563EB":"#E5E7EB"),borderRadius:6,background:productFilter!=="all"?"#EFF6FF":"#F1F5F9",color:productFilter!=="all"?"#2563EB":"#334155",fontSize:11,fontFamily:MN,fontWeight:productFilter!=="all"?600:500,cursor:"pointer",outline:"none"}}><option value="all">All products</option>{availProducts.map(p=><option key={p} value={p}>{p}</option>)}</select>;
        })()}
        {(()=>{const availShifts=[...new Set(entries.map(e=>e.shift).filter(Boolean))].sort();
          return availShifts.length>0&&<select value={shiftFilter} onChange={e=>setShiftFilter(e.target.value)} style={{padding:"6px 12px",border:"1px solid "+(shiftFilter!=="all"?"#2563EB":"#E5E7EB"),borderRadius:6,background:shiftFilter!=="all"?"#EFF6FF":"#F1F5F9",color:shiftFilter!=="all"?"#2563EB":"#334155",fontSize:11,fontFamily:MN,fontWeight:shiftFilter!=="all"?600:500,cursor:"pointer",outline:"none"}}><option value="all">All shifts</option>{availShifts.map(s=><option key={s} value={s}>{s.split(" ")[0]}</option>)}</select>;
        })()}
        {(()=>{const availColors=[...new Set(entries.map(e=>e.color).filter(Boolean))].sort();
          return availColors.length>0&&<select value={colorFilter} onChange={e=>setColorFilter(e.target.value)} style={{padding:"6px 12px",border:"1px solid "+(colorFilter!=="all"?"#2563EB":"#E5E7EB"),borderRadius:6,background:colorFilter!=="all"?"#EFF6FF":"#F1F5F9",color:colorFilter!=="all"?"#2563EB":"#334155",fontSize:11,fontFamily:MN,fontWeight:colorFilter!=="all"?600:500,cursor:"pointer",outline:"none"}}><option value="all">All colours</option>{availColors.map(c=><option key={c} value={c}>{c}</option>)}</select>;
        })()}
      </div>

      {/* Summary Cards */}
      <div style={{display:"grid",gridTemplateColumns:mob?"repeat(2,1fr)":"repeat(4,1fr)",gap:14,marginBottom:28}}>
        <div className="hv-card" style={{background:"#fff",borderRadius:10,border:"1px solid #E5E7EB",padding:"16px 18px"}}>
          <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#94A3B8",marginBottom:6}}>Total Used</div>
          <div style={{fontFamily:MN,fontSize:22,fontWeight:700,color:"#0F172A",lineHeight:1}}>{Math.round(todayTotal).toLocaleString("en-IN")} kg</div>
          <div style={{fontFamily:MN,fontSize:10,color:"#94A3B8",marginTop:4}}>{filtered.length} entries</div>
        </div>
        <div className="hv-card" style={{background:"#fff",borderRadius:10,border:"1px solid #E5E7EB",padding:"16px 18px"}}>
          <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#94A3B8",marginBottom:6}}>Materials</div>
          <div style={{fontFamily:MN,fontSize:22,fontWeight:700,color:"#2563EB",lineHeight:1}}>{consumption.length}</div>
          <div style={{fontFamily:MN,fontSize:10,color:"#94A3B8",marginTop:4}}>types used</div>
        </div>
        <div className="hv-card" style={{background:"#fff",borderRadius:10,border:"1px solid #E5E7EB",padding:"16px 18px"}}>
          <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#94A3B8",marginBottom:6}}>Top Material</div>
          <div style={{fontFamily:MN,fontSize:16,fontWeight:700,color:"#0F172A",lineHeight:1.2}}>{consumption[0]?consumption[0][0]:"—"}</div>
          <div style={{fontFamily:MN,fontSize:10,color:"#94A3B8",marginTop:4}}>{consumption[0]?Math.round(consumption[0][1]).toLocaleString("en-IN")+" kg":"No data"}</div>
        </div>
        <div className="hv-card" style={{background:"#fff",borderRadius:10,border:"1px solid #E5E7EB",padding:"16px 18px"}}>
          <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#94A3B8",marginBottom:6}}>Sections</div>
          <div style={{fontFamily:MN,fontSize:22,fontWeight:700,color:"#D97706",lineHeight:1}}>{Object.keys(bySection).length}</div>
          <div style={{fontFamily:MN,fontSize:10,color:"#94A3B8",marginTop:4}}>active</div>
        </div>
      </div>

      {/* Lots by Product & Colour */}
      {(()=>{
      // Product totals
      const lotsByProduct={};const seenP=new Set();
      filtered.filter(e=>e.lots&&e.lots>0&&e.section==="Mixing").forEach(e=>{
        const k=e.date+"|"+e.time+"|"+e.product;if(seenP.has(k))return;seenP.add(k);
        lotsByProduct[e.product||"?"]=(lotsByProduct[e.product||"?"]||0)+e.lots;
      });
      const prodData=Object.entries(lotsByProduct).sort((a,b)=>b[1]-a[1]);
      // Colour totals with lot size breakdown
      const lotsByColor={};const seen=new Set();
      filtered.filter(e=>e.lots&&e.lots>0&&e.section==="Mixing").forEach(e=>{
        const batchKey=e.date+"|"+e.time+"|"+e.color;
        if(seen.has(batchKey))return;seen.add(batchKey);
        if(!lotsByColor[e.color])lotsByColor[e.color]={total:0,s50:0,s100:0};
        lotsByColor[e.color].total+=e.lots;
        if(e.lotSize==="100")lotsByColor[e.color].s100+=e.lots;
        else lotsByColor[e.color].s50+=e.lots;
      });
      const lotData=Object.entries(lotsByColor).sort((a,b)=>b[1].total-a[1].total);
      const totalLots=lotData.reduce((s,d)=>s+d[1].total,0);
      return (prodData.length>0||lotData.length>0)&&<div style={{background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",marginBottom:24,overflow:"hidden"}}>
        <div style={{padding:"14px 20px",borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontFamily:MN,fontSize:10,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"#475569"}}>Lots Summary</span>
          <span style={{fontFamily:MN,fontSize:12,fontWeight:700,color:"#0F172A"}}>{totalLots} total lots</span>
        </div>
        {/* Product capsules */}
        {prodData.length>0&&<div style={{padding:"12px 20px",borderBottom:"1px solid #F1F5F9",display:"flex",gap:8,flexWrap:"wrap"}}>
          {prodData.map(([prod,total])=>
            <span key={prod} style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#D97706",background:"#FEF3C7",padding:"4px 12px",borderRadius:20}}>{prod} · {total} lots</span>
          )}
        </div>}
        {/* Colour breakdown */}
        {lotData.map(([color,d],i)=>{const maxL=lotData[0][1].total;const pct=maxL>0?d.total/maxL:0;
          return <div key={color} className="hv-row" style={{padding:"10px 20px",borderBottom:i<lotData.length-1?"1px solid #F1F5F9":"none",display:"flex",alignItems:"center",gap:12}}>
            <span style={{width:100,fontSize:13,fontWeight:500,color:"#0F172A",flexShrink:0}}>{color}</span>
            <div style={{flex:1,height:6,background:"#F1F5F9",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:Math.max(pct*100,2)+"%",background:i===0?"#0F172A":i<3?"#475569":"#94A3B8",borderRadius:3}}/>
            </div>
            <span style={{fontFamily:MN,fontSize:13,fontWeight:700,color:"#0F172A",minWidth:50,textAlign:"right"}}>{d.total}</span>
            <div style={{display:"flex",gap:4,flexShrink:0}}>
              {d.s50>0&&<span style={{fontFamily:MN,fontSize:9,fontWeight:600,color:"#2563EB",background:"#EFF6FF",padding:"2px 6px",borderRadius:4}}>50kg×{d.s50}</span>}
              {d.s100>0&&<span style={{fontFamily:MN,fontSize:9,fontWeight:600,color:"#7C3AED",background:"#F3E8FF",padding:"2px 6px",borderRadius:4}}>100kg×{d.s100}</span>}
            </div>
          </div>;
        })}
      </div>;})()}

      {/* Consumption by Material */}
      {consumption.length>0&&<div style={{background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",marginBottom:24,overflow:"hidden"}}>
        <div style={{padding:"14px 20px",borderBottom:"1px solid #E5E7EB"}}>
          <span style={{fontFamily:MN,fontSize:10,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"#475569"}}>Consumption by Material</span>
        </div>
        {consumption.map(([mat,qty],i)=>{
          const maxQty=consumption[0][1];const pct=maxQty>0?qty/maxQty:0;
          return <div key={mat} className="hv-row" style={{padding:"12px 20px",borderBottom:i<consumption.length-1?"1px solid #F1F5F9":"none",display:"flex",alignItems:"center",gap:12}}>
            <span style={{width:120,fontSize:13,fontWeight:500,color:"#0F172A",flexShrink:0}}>{mat}</span>
            <div style={{flex:1,height:6,background:"#F1F5F9",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:Math.max(pct*100,2)+"%",background:i===0?"#0F172A":i<3?"#475569":"#94A3B8",borderRadius:3,transition:"width 0.5s"}}/>
            </div>
            <span style={{fontFamily:MN,fontSize:13,fontWeight:700,color:"#0F172A",minWidth:80,textAlign:"right"}}>{Math.round(qty).toLocaleString("en-IN")} kg</span>
          </div>;
        })}
      </div>}

      {/* By Section */}
      {Object.keys(bySection).length>0&&<div style={{display:"grid",gridTemplateColumns:mob?"1fr":"repeat(3,1fr)",gap:14,marginBottom:24}}>
        {MIX_SECTIONS.map(sec=>{
          const secEntries=filtered.filter(e=>e.section===sec.label);
          const secTotal=secEntries.reduce((s,e)=>s+e.qty,0);
          if(secTotal===0)return null;
          const secMats={};secEntries.forEach(e=>{secMats[e.material]=(secMats[e.material]||0)+e.qty;});
          const isSheet=sec.id==="sheet";
          const byColor={};const byModel={};
          if(isSheet){
            secEntries.forEach(e=>{
              if(e.color)byColor[e.color]=(byColor[e.color]||0)+e.qty;
              if(e.modelBacking)byModel[e.modelBacking]=(byModel[e.modelBacking]||0)+e.qty;
            });
          }
          return <div key={sec.id} style={{background:"#fff",borderRadius:10,border:"1px solid #E5E7EB",padding:"16px 18px"}}>
            <div style={{fontFamily:MN,fontSize:10,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:"#94A3B8",marginBottom:8}}>{sec.label}</div>
            <div style={{fontFamily:MN,fontSize:20,fontWeight:700,color:"#0F172A",marginBottom:10}}>{Math.round(secTotal).toLocaleString("en-IN")} kg</div>
            {Object.entries(secMats).sort((a,b)=>b[1]-a[1]).map(([m,q])=>
              <div key={m} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #F8FAFC"}}>
                <span style={{fontSize:12,color:"#475569"}}>{m}</span>
                <span style={{fontFamily:MN,fontSize:12,fontWeight:600,color:"#0F172A"}}>{Math.round(q)} kg</span>
              </div>
            )}
            {isSheet&&Object.keys(byColor).length>0&&<div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #F1F5F9"}}>
              <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:"#94A3B8",marginBottom:6}}>By Colour</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {Object.entries(byColor).sort((a,b)=>b[1]-a[1]).map(([c,q])=>
                  <span key={c} style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#2563EB",background:"#EFF6FF",padding:"3px 8px",borderRadius:12}}>{c} · {Math.round(q)} kg</span>
                )}
              </div>
            </div>}
            {isSheet&&Object.keys(byModel).length>0&&<div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #F1F5F9"}}>
              <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:"#94A3B8",marginBottom:6}}>By Model & Backing</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {Object.entries(byModel).sort((a,b)=>b[1]-a[1]).map(([m,q])=>
                  <span key={m} style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#0D9488",background:"#F0FDFA",padding:"3px 8px",borderRadius:12}}>{m} · {Math.round(q)} kg</span>
                )}
              </div>
            </div>}
          </div>;
        })}
      </div>}

      {/* Recent Entries */}
      {filtered.length>0&&<div style={{background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",overflow:"hidden"}}>
        <div style={{padding:"14px 20px",borderBottom:"1px solid #E5E7EB"}}>
          <span style={{fontFamily:MN,fontSize:10,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"#475569"}}>Recent Entries</span>
        </div>
        <div style={{maxHeight:300,overflowY:"auto"}}>
          {filtered.slice(0,30).map((e,i)=>{
            const globalIdx=entries.indexOf(e);const isEditing=editIdx===globalIdx;
            return <div key={i}>
              <div className="hv-row" style={{padding:"10px 20px",borderBottom:(i<Math.min(filtered.length,30)-1&&!isEditing)?"1px solid #F1F5F9":"none",display:"flex",alignItems:"center",gap:8,flexWrap:mob?"wrap":"nowrap"}}>
                <span style={{fontFamily:MN,fontSize:11,color:"#94A3B8",minWidth:70}}>{e.date}</span>
                <span style={{fontFamily:MN,fontSize:11,color:"#94A3B8",minWidth:45}}>{e.time}</span>
                {e.line&&<span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#7C3AED",background:"#F3E8FF",padding:"2px 6px",borderRadius:4}}>{e.line}</span>}
                {e.product&&<span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#D97706",background:"#FEF3C7",padding:"2px 6px",borderRadius:4}}>{e.product}</span>}
                {e.shift&&<span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:e.shift.startsWith("Day")?"#B45309":"#1E40AF",background:e.shift.startsWith("Day")?"#FEF3C7":"#DBEAFE",padding:"2px 6px",borderRadius:4}}>{e.shift.startsWith("Day")?"☀ Day":"🌙 Night"}</span>}
                {e.color&&<span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#2563EB",background:"#EFF6FF",padding:"2px 6px",borderRadius:4}}>{e.color}</span>}
                {e.modelBacking&&<span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#0D9488",background:"#F0FDFA",padding:"2px 6px",borderRadius:4}}>{e.modelBacking}</span>}
                <span style={{fontSize:11,fontWeight:500,color:"#475569",minWidth:80}}>{e.section}</span>
                <span style={{fontSize:12,fontWeight:600,color:"#0F172A",flex:1,minWidth:80}}>{e.material}</span>
                <span style={{fontFamily:MN,fontSize:13,fontWeight:700,color:"#0F172A"}}>{e.qty} kg</span>
                <span style={{fontFamily:MN,fontSize:10,color:"#94A3B8"}}>{e.user}</span>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button onClick={()=>{setEditIdx(globalIdx);setEditQty(String(e.qty));}} style={{fontFamily:MN,fontSize:9,color:"#2563EB",background:"none",border:"1px solid #E5E7EB",borderRadius:4,padding:"3px 8px",cursor:"pointer"}}>Edit</button>
                  <button onClick={async()=>{if(!window.confirm("Delete this entry?"))return;setDeleting(globalIdx);try{await fetch("/api/production",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({section:e.section,rowData:{date:e.date,time:e.time,material:e.material,qty:e.qty}})});const r=await fetch("/api/production");const d=await r.json();setEntries(d.entries||[]);}catch{}setDeleting(null);}} disabled={deleting===globalIdx} style={{fontFamily:MN,fontSize:9,color:"#DC2626",background:"none",border:"1px solid #E5E7EB",borderRadius:4,padding:"3px 8px",cursor:deleting===globalIdx?"default":"pointer",opacity:deleting===globalIdx?0.5:1}}>Del</button>
                </div>
              </div>
              {isEditing&&<div style={{padding:"8px 20px 12px",background:"#F8FAFC",borderBottom:"1px solid #F1F5F9",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontFamily:MN,fontSize:11,color:"#475569"}}>New qty:</span>
                <input type="number" value={editQty} onChange={ev=>setEditQty(ev.target.value)} style={{width:90,padding:"6px 10px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,fontFamily:MN,textAlign:"right",outline:"none"}}/>
                <span style={{fontFamily:MN,fontSize:11,color:"#94A3B8"}}>kg</span>
                <button onClick={async()=>{const newQ=parseFloat(editQty);if(!newQ||newQ<=0)return;try{await fetch("/api/production",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({section:e.section,rowData:{date:e.date,time:e.time,material:e.material,qty:e.qty},newQty:newQ})});const r=await fetch("/api/production");const d=await r.json();setEntries(d.entries||[]);}catch{}setEditIdx(null);}} style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#fff",background:"#0F172A",border:"none",borderRadius:4,padding:"5px 12px",cursor:"pointer"}}>Save</button>
                <button onClick={()=>setEditIdx(null)} style={{fontFamily:MN,fontSize:10,color:"#94A3B8",background:"none",border:"1px solid #E5E7EB",borderRadius:4,padding:"5px 12px",cursor:"pointer"}}>Cancel</button>
              </div>}
            </div>;})}
        </div>
      </div>}

      {filtered.length===0&&!loading&&<div style={{background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",padding:40,textAlign:"center"}}>
        <div style={{fontSize:14,color:"#94A3B8",marginBottom:8}}>No entries for this period</div>
        <div style={{fontSize:12,color:"#94A3B8"}}>Click "+ Add Entry" to log raw material usage</div>
      </div>}
    </div>}
  </div>;
}

/* ═══════════════ MAIN APP ═══════════════ */
/* ═══════ LIVE DATA FETCH ═══════ */
const SHEET_URL="https://docs.google.com/spreadsheets/d/1CQS5w9VLTjHcZ9Gzw3P6wGgZ0K6YDKuL1Ux42LQeRSQ/gviz/tq?tqx=out:csv&sheet=APP_DATA";
const REFRESH_MS=3*60*1000;
function parseCSV(csv){
  var lines=csv.trim().split("\n");if(lines.length<2)return[];
  var orders=[];
  lines.slice(1).forEach(function(line){
    var cols=[],cur="",inQ=false;
    for(var i=0;i<line.length;i++){var c=line[i];if(c==='"')inQ=!inQ;else if(c===','&&!inQ){cols.push(cur.trim());cur="";}else cur+=c;}
    cols.push(cur.trim());if(cols.length<10)return;
    var party=(cols[2]||"").replace(/^"|"$/g,"").trim();if(!party||party==="PARTY NAME")return;
    try{var rawCat=cols[6]||"Other";var CAT_FIX={"Rolls":"Loop Rolls","S-Mat":"TEFNO","WIRE":"Wire","WIRE MAT":"Wire","Wire Mat":"Wire","wire mat":"Wire","wire":"Wire"};var rcu=rawCat.toUpperCase().trim();var fixedCat=CAT_FIX[rawCat]||(rcu.includes("WIRE")?"Wire":rawCat);orders.push({no:cols[0]||"",partyCode:cols[1]||"",party:party,salesPOC:cols[3]||"",piDate:cols[4]||"",qty:parseInt(cols[5])||0,category:fixedCat,model:cols[7]||"",backing:cols[8]||"",colour:cols[9]||"",width:cols[10]||"",length:cols[11]||"",actualRate:cols[12]||"",value:parseFloat((cols[13]||"0").replace(/[₹,]/g,""))||0,approvalDate:(cols[14]||"").replace(/^"|"$/g,"").trim(),dispatchStatus:(cols[16]||"").replace(/^"|"$/g,"").trim().toLowerCase()});}catch(e){}
  });
  return orders;
}
function groupOrders(rawOrders){
  var groups={};
  rawOrders.forEach(function(o){
    var key=o.party+"||"+o.piDate;
    if(!groups[key])groups[key]={id:o.no,party:o.party,salesPOC:o.salesPOC,piDate:o.piDate,totalQty:0,totalValue:0,lineCount:0,categories:[],lines:[],approvalDate:"",dispatchedCount:0};
    var g=groups[key];g.totalQty+=o.qty;g.totalValue+=o.value;g.lineCount++;if(o.approvalDate&&!g.approvalDate)g.approvalDate=o.approvalDate;if(o.dispatchStatus==="dispatched")g.dispatchedCount++;
    if(g.categories.indexOf(o.category)<0)g.categories.push(o.category);g.lines.push(o);
  });
  return Object.values(groups).sort(function(a,b){return pd(a.piDate)-pd(b.piDate);});
}

export default function Dashboard(){
  const w=useW();const mob=w<768;
  const {user}=useUser();const {signOut}=useClerk();
  const[tab,setTab]=useState("pending");const[menuOpen,setMenuOpen]=useState(false);
  const[cat,setCat]=useState("all");const[srch,setSrch]=useState("");const[srt,setSrt]=useState("da");const[poc,setPoc]=useState("");
  const[pg,setPg]=useState(1);const[exp,setExp]=useState(null);const[expParties,setExpParties]=useState({});
  const[selP,setSelP]=useState(null);const[pcf,setPcf]=useState("all");const[psrch,setPsrch]=useState("");
  const[showHist,setShowHist]=useState(false);const[payF,setPayF]=useState("all");const[mpv,setMpv]=useState(false);const[showCats,setShowCats]=useState(false);const[insIdx,setInsIdx]=useState(0);const[actionOpen,setActionOpen]=useState(false);const[doneIds,setDoneIds]=useState(new Set());const[showAllRtd,setShowAllRtd]=useState(false);const[showAllPend,setShowAllPend]=useState(false);const[insPaused,setInsPaused]=useState(false);const insCount=useRef(1);
  const[liveOrders,setLiveOrders]=useState(null);
  const[lastUpdated,setLastUpdated]=useState(null);
  const[fetchStatus,setFetchStatus]=useState("idle");
  const[agoText,setAgoText]=useState("");const[dataVer,setDataVer]=useState(0);
  const[newOrderIds,setNewOrderIds]=useState(new Set());
  const[showNewOnly,setShowNewOnly]=useState(false);
  const[activityFeed,setActivityFeed]=useState([]);
  const[insightOpen,setInsightOpen]=useState(false);const[feedExp,setFeedExp]=useState(null);
  const prevOrderIds=useRef(null);
  const prevSnap=useRef(null);

  useEffect(()=>{
    var doFetch=function(){
      setFetchStatus("loading");
      fetch(SHEET_URL).then(function(r){if(!r.ok)throw new Error();return r.text();})
      .then(function(csv){
        var raw=parseCSV(csv);if(raw.length===0)throw new Error("Empty");
        var grouped=groupOrders(raw);
        var active=grouped.filter(function(o){return!(o.lineCount>0&&o.dispatchedCount>=o.lineCount);});
        // Track new orders
        var currentIds=new Set(grouped.map(function(o){return o.party+"||"+o.piDate;}));
        if(prevOrderIds.current){
          var added=new Set();
          currentIds.forEach(function(id){if(!prevOrderIds.current.has(id))added.add(id);});
          if(added.size>0)setNewOrderIds(added);
        }
        prevOrderIds.current=currentIds;

        // --- Activity feed ---
        try{
        var now=new Date();
        var ts=now.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Kolkata"});
        var dateStr=istToday();
        var rtdA=active.filter(function(o){return o.approvalDate&&o.dispatchedCount<o.lineCount;});
        var pendA=active.filter(function(o){return!o.approvalDate;});
        var odA=rtdA.filter(function(o){return daysSince(o.approvalDate)>7;});
        var totalValA=active.reduce(function(s,o){return s+o.totalValue;},0);
        var todayStr=now.getDate()+"/"+(now.getMonth()+1<10?"0":"")+(now.getMonth()+1)+"/"+now.getFullYear();
        var todayAlt=(now.getDate()<10?"0":"")+now.getDate()+"/"+(now.getMonth()+1<10?"0":"")+(now.getMonth()+1)+"/"+now.getFullYear();
        function isToday(d){var s=(d||"").trim();return s===todayStr||s===todayAlt;}

        var liveDiffs=[];
        if(prevSnap.current){
          var ps=prevSnap.current;
          var prevIds2=new Set(ps.orders.map(function(o){return o.id;}));
          active.forEach(function(o){if(!prevIds2.has(o.id))liveDiffs.push({type:"new_order",text:"New order from "+o.party+" — "+fmtVal(o.totalValue),time:ts,date:dateStr,icon:"+",live:true,oid:o.id,detail:{party:o.party,id:o.id,value:o.totalValue,qty:o.totalQty,poc:o.salesPOC,cats:o.categories,piDate:o.piDate}});});
          var prevPendIds2=new Set(ps.orders.filter(function(o){return!o.approvalDate;}).map(function(o){return o.id;}));
          active.forEach(function(o){if(o.approvalDate&&prevPendIds2.has(o.id))liveDiffs.push({type:"approved",text:o.party+" approved — "+fmtVal(o.totalValue)+" ready to ship",time:ts,date:dateStr,icon:"✓",live:true,oid:o.id,detail:{party:o.party,id:o.id,value:o.totalValue,qty:o.totalQty,poc:o.salesPOC,cats:o.categories,piDate:o.piDate,approvalDate:o.approvalDate}});});
          var curIds2=new Set(active.map(function(o){return o.id;}));
          ps.orders.forEach(function(o){if(!curIds2.has(o.id))liveDiffs.push({type:"dispatched",text:o.party+" dispatched — "+fmtVal(o.totalValue),time:ts,date:dateStr,icon:"→",live:true,oid:o.id,detail:{party:o.party,id:o.id,value:o.totalValue,qty:o.totalQty,poc:o.salesPOC,cats:o.categories}});});
          var prevOD2=ps.orders.filter(function(o){return o.approvalDate&&daysSince(o.approvalDate)>7;}).length;
          if(odA.length>prevOD2)liveDiffs.push({type:"overdue",text:(odA.length-prevOD2)+" more order"+(odA.length-prevOD2>1?"s":"")+" now overdue",time:ts,date:dateStr,icon:"!",live:true});
          var prevVal2=ps.orders.reduce(function(s,o){return s+o.totalValue;},0);
          var diffV=totalValA-prevVal2;
          if(Math.abs(diffV)>10000)liveDiffs.push({type:diffV>0?"value_up":"value_down",text:"Pipeline "+(diffV>0?"up":"down")+" "+fmtVal(Math.abs(diffV))+" to "+fmtVal(totalValA),time:ts,date:dateStr,icon:diffV>0?"↑":"↓",live:true});
        }

        // Full day scan + merge
        setActivityFeed(function(existing){
          var knownOids=new Set(existing.filter(function(a){return a.oid;}).map(function(a){return a.oid+"|"+a.type;}));
          liveDiffs.forEach(function(d){if(d.oid)knownOids.add(d.oid+"|"+d.type);});
          var dayItems=[];
          rtdA.forEach(function(o){if(!knownOids.has(o.id+"|approved")&&isToday(o.approvalDate)){knownOids.add(o.id+"|approved");dayItems.push({type:"approved",text:o.party+" approved — "+fmtVal(o.totalValue)+" ready to ship",time:"—",date:dateStr,icon:"✓",oid:o.id,detail:{party:o.party,id:o.id,value:o.totalValue,qty:o.totalQty,poc:o.salesPOC,cats:o.categories,piDate:o.piDate,approvalDate:o.approvalDate}});}});
          active.forEach(function(o){if(!knownOids.has(o.id+"|new_order")&&isToday(o.piDate)){knownOids.add(o.id+"|new_order");dayItems.push({type:"new_order",text:"New order from "+o.party+" — "+fmtVal(o.totalValue),time:"—",date:dateStr,icon:"+",oid:o.id,detail:{party:o.party,id:o.id,value:o.totalValue,qty:o.totalQty,poc:o.salesPOC,cats:o.categories,piDate:o.piDate,approvalDate:o.approvalDate||""}});}});

          var pocSum={};active.forEach(function(o){var p=o.salesPOC||"?";if(!pocSum[p])pocSum[p]={count:0,value:0,rtd:0,pend:0};pocSum[p].count++;pocSum[p].value+=o.totalValue;if(o.approvalDate)pocSum[p].rtd++;else pocSum[p].pend++;});
          var summaryItems=[{type:"summary",text:active.length+" active orders · "+fmtVal(totalValA),time:ts,date:dateStr,icon:"◆"}];
          Object.entries(pocSum).sort(function(a,b){return b[1].value-a[1].value;}).forEach(function(e){summaryItems.push({type:"poc_summary",text:e[0]+" — "+e[1].count+" orders · "+fmtVal(e[1].value)+" · "+e[1].rtd+" ready, "+e[1].pend+" pending",time:ts,date:dateStr,icon:"●",poc:e[0]});});
          if(odA.length>0)summaryItems.push({type:"overdue",text:odA.length+" orders overdue for shipping",time:ts,date:dateStr,icon:"!"});

          var events=existing.filter(function(a){return a.type!=="summary"&&a.type!=="poc_summary"&&!(a.type==="overdue"&&!a.live);});
          var merged=liveDiffs.concat(events,dayItems,summaryItems).slice(0,60);
          return merged;
        });

        prevSnap.current={orders:active};
        }catch(e){console.error("Activity feed error:",e);}
        setLiveOrders(grouped);setLastUpdated(new Date());setFetchStatus("ok");setDataVer(v=>v+1);
      }).catch(function(){setFetchStatus(liveOrders?"error_cached":"error");});
    };
    doFetch();
    var iv=setInterval(doFetch,REFRESH_MS);
    return function(){clearInterval(iv);};
  },[]);

  // Live "updated X ago" ticker
  useEffect(()=>{
    const tick=()=>{
      if(!lastUpdated){setAgoText("");return;}
      const sec=Math.floor((Date.now()-lastUpdated.getTime())/1000);
      if(sec<10)setAgoText("just now");
      else if(sec<60)setAgoText(sec+"s ago");
      else{const m=Math.floor(sec/60);setAgoText(m+"m ago");}
    };
    tick();
    const iv=setInterval(tick,10000);
    return()=>clearInterval(iv);
  },[lastUpdated]);

  const ORDERS=(liveOrders||RAW).filter(o=>{const p=(o.party||"").trim().toLowerCase();return p&&p!=="test";});
  const PARTIES=useMemo(()=>{const ob={};ORDERS.forEach(o=>{if(!ob[o.party])ob[o.party]=[];ob[o.party].push(o);});
    return ALL_PARTIES.map(p=>({...p,earliest:pd(p.firstDate||"01/01/2025"),orders:ob[p.name]||[],pendingValue:p.pendingValue||(ob[p.name]||[]).reduce((s,o)=>s+o.totalValue,0),cats:Object.fromEntries((p.cats||[]).map(c=>[c,1]))}));},[ORDERS]);
  const pocs=useMemo(()=>[...new Set(ORDERS.map(o=>o.salesPOC))].sort(),[ORDERS]);

  // Auto-rotate insight carousel every 7s, pause on hover/interaction
  useEffect(()=>{
    if(insPaused||tab!=="pending"||insCount.current<=1)return;
    const iv=setInterval(()=>{setInsIdx(i=>(i+1)%insCount.current);},7000);
    return()=>clearInterval(iv);
  },[insPaused,tab]);
  const pauseCarousel=useCallback(()=>setInsPaused(true),[]);
  const resumeCarousel=useCallback(()=>setInsPaused(false),[]);

  const isNewOrder=useCallback((o)=>newOrderIds.has(o.party+"||"+o.piDate),[newOrderIds]);

  // (report functions defined after base data below)
  const filtered=useMemo(()=>{
    let r=ORDERS.filter(o=>{
      if(o.lineCount>0&&o.dispatchedCount>=o.lineCount)return false;
      if(showNewOnly&&!newOrderIds.has(o.party+"||"+o.piDate))return false;
      if(cat!=="all"&&!o.categories.includes(cat))return false;
      if(poc&&o.salesPOC!==poc)return false;
      if(payF!=="all"){const appr=!!o.approvalDate;if(payF==="approved"&&!appr)return false;if(payF==="not_approved"&&appr)return false;}
      if(srch){const q=srch.toLowerCase();if(![o.party,...o.lines.map(l=>l.model),...o.lines.map(l=>l.colour)].some(v=>v.toLowerCase().includes(q)))return false;}
      return true;
    });
    if(srt==="da")r.sort((a,b)=>pd(a.piDate)-pd(b.piDate));
    else if(srt==="dd")r.sort((a,b)=>pd(b.piDate)-pd(a.piDate));
    else if(srt==="pa")r.sort((a,b)=>a.party.localeCompare(b.party));
    else if(srt==="qd"){const cq=o=>cat==="all"?o.totalQty:o.lines.filter(l=>l.category===cat).reduce((s,l)=>s+l.qty,0);r.sort((a,b)=>cq(b)-cq(a));}
    else if(srt==="vd")r.sort((a,b)=>b.totalValue-a.totalValue);
    return r;
  },[cat,poc,srch,srt,payF,ORDERS,showNewOnly,newOrderIds]);

  // Stable orders for insights & metrics — not affected by search
  const baseOrders=useMemo(()=>ORDERS.filter(o=>!(o.lineCount>0&&o.dispatchedCount>=o.lineCount)&&(!poc||o.salesPOC===poc)),[ORDERS,poc]);
  const baseRtd=useMemo(()=>baseOrders.filter(o=>o.approvalDate&&o.dispatchedCount<o.lineCount),[baseOrders]);
  const basePend=useMemo(()=>baseOrders.filter(o=>!o.approvalDate),[baseOrders]);
  const baseOverdue=useMemo(()=>baseRtd.filter(o=>daysSince(o.approvalDate)>7),[baseRtd]);
  const baseLines=useMemo(()=>baseOrders.flatMap(o=>o.lines),[baseOrders]);

  const readyToDispatch=filtered.filter(o=>o.approvalDate&&o.dispatchedCount<o.lineCount);const pendingApproval=filtered.filter(o=>!o.approvalDate);const page=filtered.slice((pg-1)*PG,pg*PG);const pages=Math.max(1,Math.ceil(pendingApproval.length/PG));
  const rtdSorted=(()=>{const r=[...readyToDispatch];if(srt==="dd")r.sort((a,b)=>pd(b.approvalDate)-pd(a.approvalDate));else if(srt==="pa")r.sort((a,b)=>a.party.localeCompare(b.party));else if(srt==="qd"){const cq=o=>cat==="all"?o.totalQty:o.lines.filter(l=>l.category===cat).reduce((s,l)=>s+l.qty,0);r.sort((a,b)=>cq(b)-cq(a));}else if(srt==="vd")r.sort((a,b)=>b.totalValue-a.totalValue);else r.sort((a,b)=>pd(a.approvalDate)-pd(b.approvalDate));return r;})();const rtdOverdue=rtdSorted.filter(o=>daysSince(o.approvalDate)>7);const rtdOnTime=rtdSorted.filter(o=>daysSince(o.approvalDate)<=7);const rtdDetailTbl=(o)=>(<tr key={o.id+"x"}><td colSpan={9} style={{padding:0,borderBottom:"1px solid #86efac"}}><div style={{background:"#f8fafc",padding:"8px 16px 4px 36px",borderBottom:"1px solid #e2e8f0",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}><span style={{...S.section,fontSize:10}}>{o.lineCount} line items</span><span style={{fontFamily:MN,fontSize:11,color:"#64748b"}}>· {fmtVal(o.totalValue)}</span><span style={{fontFamily:MN,fontSize:10,color:"#94a3b8"}}>PI</span><span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#475569"}}>{o.id}</span><span style={{fontFamily:MN,fontSize:10,color:"#94a3b8"}}>PI Date</span><span style={{fontFamily:MN,fontSize:11,color:"#475569"}}>{o.piDate}</span></div><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["#","Code","Model","Backing","Colour","Width","Length","Qty","Rate","Value"].map(h=><th key={h} style={{padding:"8px 14px",...S.section,fontSize:9,background:"#f1f5f9",borderBottom:"1px solid #e2e8f0",textAlign:["Qty","Rate","Value"].includes(h)?"right":"left"}}>{h}</th>)}</tr></thead><tbody>{o.lines.map((l,i)=><tr key={l.no||i} style={{background:i%2?"#fafafa":"#fff"}}><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:10,fontFamily:MN,color:"#94a3b8"}}>{i+1}</td><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:10,fontFamily:MN,fontWeight:600,color:"#64748b"}}>{l.partyCode||"—"}</td><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:12,fontWeight:600}}>{l.model}</td><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:11,color:"#64748b"}}>{l.backing}</td><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:12}}>{l.colour}</td><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:11,fontFamily:MN}}>{l.width}</td><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:11,fontFamily:MN,color:"#94a3b8"}}>{l.length}</td><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:14,fontFamily:MN,fontWeight:700,textAlign:"right"}}>{l.qty}</td><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:11,fontFamily:MN,textAlign:"right",color:"#64748b"}}>{l.actualRate||"—"}</td><td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:12,fontFamily:MN,fontWeight:600,textAlign:"right"}}>{fmtVal(l.value||0)}</td></tr>)}</tbody></table></td></tr>);
  const rtdRows=[];
  if(readyToDispatch.length>0){
    const pushOrders=(ords,off=0)=>{ords.forEach((o,oi)=>{const ep=exp===o.id;const ri=off+oi;const dy=daysSince(o.approvalDate);const dC=dy>7?"#DC2626":dy>3?"#D97706":"#16A34A";const ps=payStatus(!!o.approvalDate);const isOD=dy>7;
      rtdRows.push(<tr className="hv-row" key={o.id} onClick={()=>setExp(ep?null:o.id)} style={{cursor:"pointer",background:"#fff",borderLeft:ep?"3px solid #16A34A":"3px solid transparent"}}><td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB",fontFamily:MN,fontSize:10,color:isOD?"#94a3b8":"#059669"}}>{ep?"▾":"▸"}</td><td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB",fontFamily:MN,fontSize:11,whiteSpace:"nowrap",color:"#64748b"}}>{o.approvalDate}</td><td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB"}}><span style={{fontFamily:MN,fontSize:12,fontWeight:700,color:dC,background:dC+"12",padding:"2px 8px",borderRadius:12}}>{dy}d</span></td><td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB",fontWeight:700,maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.party}</td><td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB"}}><div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{o.categories.map(c=><Badge key={c} cat={c}/>)}</div></td><td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right"}}>{cat==="all"?o.totalQty:o.lines.filter(l=>l.category===cat).reduce((s,l)=>s+l.qty,0)}</td><td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB"}}><span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:POC_COLORS[o.salesPOC]||"#64748b",background:(POC_COLORS[o.salesPOC]||"#64748b")+"15",padding:"2px 8px",borderRadius:12}}>{o.salesPOC}</span></td><td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB",fontFamily:MN,fontSize:12,fontWeight:700,textAlign:"right",color:isOD?"#0f172a":"#059669"}}>{fmtVal(o.totalValue)}</td><td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB"}}>{ps?<span style={{fontFamily:MN,fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:20,background:ps.bg,color:ps.color}}>{ps.label}</span>:<span style={{fontFamily:MN,fontSize:10,color:"#cbd5e1"}}>—</span>}</td></tr>);
      if(ep)rtdRows.push(rtdDetailTbl(o));
    });};
    if(rtdOverdue.length>0)rtdRows.push(<tr key="rtd_od_h"><td colSpan={9} style={{padding:"8px 14px 8px 20px",background:"#F8FAFC",borderBottom:"1px solid #E5E7EB",borderLeft:"3px solid #DC2626"}}><span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#DC2626"}}>Overdue · {rtdOverdue.length} order{rtdOverdue.length!==1?"s":""} · {fmtVal(rtdOverdue.reduce((s,o)=>s+o.totalValue,0))}</span></td></tr>);
    pushOrders(rtdOverdue);
    if(rtdOnTime.length>0&&rtdOverdue.length>0)rtdRows.push(<tr key="rtd_ot_h"><td colSpan={9} style={{padding:"8px 14px 8px 20px",background:"#F8FAFC",borderBottom:"1px solid #E5E7EB",borderLeft:"3px solid #16A34A"}}><span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#16A34A"}}>On Time · {rtdOnTime.length} order{rtdOnTime.length!==1?"s":""}</span></td></tr>);
    pushOrders(rtdOnTime,rtdOverdue.length);
  }
  const catCounts=useMemo(()=>{const c={};ORDERS.filter(o=>(!poc||o.salesPOC===poc)&&!(o.lineCount>0&&o.dispatchedCount>=o.lineCount)).forEach(o=>o.categories.forEach(cc=>c[cc]=(c[cc]||0)+1));return c;},[poc,ORDERS]);
  const allLines=useMemo(()=>filtered.flatMap(o=>o.lines),[filtered]);
  const pendQty=useMemo(()=>ORDERS.filter(o=>!(o.lineCount>0&&o.dispatchedCount>=o.lineCount)).reduce((s,o)=>{const ls=cat==="all"?o.lines:o.lines.filter(l=>l.category===cat);return s+ls.reduce((ss,l)=>ss+l.qty,0);},0),[cat,ORDERS]);
  const pFilt=PARTIES.filter(p=>!psrch||p.name.toLowerCase().includes(psrch.toLowerCase()));
  const sPObj=selP?PARTIES.find(p=>p.name===selP):null;

  const role=user?.publicMetadata?.role||user?.unsafeMetadata?.role||(user?"sales":"admin");
  console.log("USER ROLE DEBUG:",{role,publicMetadata:user?.publicMetadata,unsafeMetadata:user?.unsafeMetadata,email:user?.emailAddresses?.[0]?.emailAddress});
  const ROLE_TABS={admin:["pending","party","stock","dispatch","analytics","calls","production"],management:["pending","party","analytics"],ops:["pending","stock","dispatch","production"],production:["production"],sales:["pending","party"]};
  const allowedTabs=ROLE_TABS[role]||ROLE_TABS["sales"];
  const allTabs=[{id:"pending",l:"Orders",n:filtered.length},{id:"party",l:"Parties",n:pFilt.length},{id:"stock",l:"Stock",n:""},{id:"dispatch",l:"Dispatch",n:""},{id:"analytics",l:"Analytics",n:""},{id:"calls",l:"Calls",n:Object.keys(REORDER).length},{id:"production",l:"Production",n:""}];
  const tabs=allTabs.filter(t=>allowedTabs.includes(t.id));
  // Auto-switch to first allowed tab if current tab isn't accessible
  useEffect(()=>{if(!allowedTabs.includes(tab)&&allowedTabs.length>0)setTab(allowedTabs[0]);},[role]);

  return <div style={{fontFamily:SN,background:"#F8FAFC",minHeight:"100vh",fontSize:13,color:"#0F172A"}}>
    
    {/* Fonts loaded in layout.js */}
    <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}@keyframes flash{0%{background:#E0F2FE}100%{background:#fff}}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}*{box-sizing:border-box}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}::-webkit-scrollbar-thumb:hover{background:#94a3b8}input:focus,select:focus{border-color:#2563eb!important;box-shadow:0 0 0 3px rgba(37,99,235,0.08)}::selection{background:#2563eb22}.hv-row{transition:background 0.2s}.hv-row:hover{background:#F8FAFC!important}.hv-card{transition:box-shadow 0.2s,border-color 0.2s}.hv-card:hover{box-shadow:0 1px 4px rgba(0,0,0,0.04);border-color:#d1d5db}.hv-pill{transition:background 0.2s,border-color 0.2s}.hv-pill:hover{background:#E5E7EB!important}.hv-btn{transition:background 0.2s,opacity 0.2s}.hv-btn:hover{opacity:0.85}.hv-insight{transition:box-shadow 0.2s}.hv-insight:hover{box-shadow:0 2px 8px rgba(0,0,0,0.04)}.hv-insight-s{transition:background 0.2s}.hv-insight-s:hover{background:#F1F5F9!important}.hv-dark{transition:background 0.2s}.hv-dark:hover{background:rgba(255,255,255,0.04)!important}select{transition:border-color 0.2s}select:hover{border-color:#cbd5e1}`}</style>

    {/* Header */}
    <div style={{background:"#0f172a",color:"#fff",padding:mob?"0 16px":"0 28px",height:56,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:200,borderBottom:"1px solid #1e293b"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{background:"#fff",borderRadius:6,padding:"3px 8px",display:"flex",alignItems:"center",justifyContent:"center"}}><img src="/logo.png" alt="Comfort Mats" style={{height:28,width:"auto"}}/></div>
        <div><div style={{fontFamily:MN,fontSize:16,fontWeight:700,letterSpacing:"0.12em",wordSpacing:"-0.08em",textTransform:"uppercase"}}>Comfort Cloud</div>{!mob&&<div style={{fontSize:10,opacity:0.4,fontFamily:MN,marginTop:-1,letterSpacing:"0.06em"}}>Dashboard</div>}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",padding:"6px 14px",borderRadius:8,fontSize:11,fontFamily:MN}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:fetchStatus==="ok"?"#4ade80":fetchStatus==="loading"?"#fbbf24":"#94a3b8",boxShadow:fetchStatus==="ok"?"0 0 6px #4ade8060":"none"}}/>
          {!mob&&<>{baseOrders.length} orders · {fmtVal(baseOrders.reduce((s,o)=>s+o.totalValue,0))}</>}
          {fetchStatus==="ok"&&agoText&&<span style={{opacity:0.5,marginLeft:2}}> · {agoText}</span>}
          {fetchStatus==="loading"&&<span style={{opacity:0.6,marginLeft:4}}>Syncing…</span>}
          {fetchStatus==="error"&&<span style={{opacity:0.6,marginLeft:4}}>Offline</span>}
        </div>
        {user&&<div style={{position:"relative"}}>
          <button onClick={()=>setMenuOpen(o=>!o)} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.7)",width:34,height:34,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:4,padding:0}}>
            <span style={{width:14,height:1.5,background:"currentColor",borderRadius:2}}/>
            <span style={{width:14,height:1.5,background:"currentColor",borderRadius:2}}/>
            <span style={{width:14,height:1.5,background:"currentColor",borderRadius:2}}/>
          </button>
          {menuOpen&&<div style={{position:"absolute",top:42,right:0,background:"#1e293b",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,minWidth:160,boxShadow:"0 8px 24px rgba(0,0,0,0.4)",zIndex:999,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
              <div style={{fontFamily:MN,fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:2}}>Signed in as</div>
              <div style={{fontFamily:MN,fontSize:12,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.firstName||user?.emailAddresses?.[0]?.emailAddress||"Guest"}</div>
            </div>
            {(user?.firstName==="Abhi"&&user?.lastName==="Arora")&&<a href="/purchases" onClick={()=>setMenuOpen(false)} style={{display:"block",width:"100%",padding:"10px 14px",background:"none",border:"none",color:"rgba(255,255,255,0.7)",fontFamily:MN,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left",textDecoration:"none",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>Purchases</a>}
            <button onClick={()=>{setMenuOpen(false);signOut();}} style={{width:"100%",padding:"10px 14px",background:"none",border:"none",color:"#f87171",fontFamily:MN,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left"}}>Sign out</button>
          </div>}
        </div>}
      </div>
    </div>

    {/* Tabs */}
    <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",display:"flex",padding:mob?"0 12px":"0 28px",position:"sticky",top:56,zIndex:99,overflowX:"auto",gap:2}}>
      {tabs.map(t=><div key={t.id} onClick={()=>{setTab(t.id);if(t.id==="party")setMpv(false);}} style={{padding:mob?"12px 14px":"14px 22px",fontSize:13,fontWeight:tab===t.id?600:400,color:tab===t.id?"#0f172a":"#94a3b8",cursor:"pointer",borderBottom:tab===t.id?"2px solid #2563eb":"2px solid transparent",whiteSpace:"nowrap",transition:"all 0.2s"}}>
        {t.l}{t.n!==""&&<span style={{display:"inline-block",background:tab===t.id?"#eff6ff":"#f8fafc",borderRadius:10,padding:"1px 8px",fontFamily:MN,fontSize:10,marginLeft:6,color:tab===t.id?"#2563eb":"#94a3b8",fontWeight:600}}>{t.n}</span>}
      </div>)}
      {role==="admin"&&<a href="/purchases" style={{padding:mob?"12px 14px":"14px 22px",fontSize:13,fontWeight:500,color:"#94a3b8",cursor:"pointer",borderBottom:"3px solid transparent",whiteSpace:"nowrap",transition:"all 0.2s",textDecoration:"none",display:"flex",alignItems:"center",gap:6}}>Purchases</a>}
    </div>

    <div style={{padding:mob?"16px":"24px 28px",maxWidth:1500,margin:"0 auto"}}>

      {/* ═══ PENDING ═══ */}
      {tab==="pending"&&<div>
        {/* Activity Feed — Premium Glass */}
        <div style={{background:"linear-gradient(135deg,#0c1222 0%,#162036 50%,#0f1a2e 100%)",borderRadius:16,marginBottom:24,overflow:"hidden",boxShadow:"0 4px 24px rgba(0,0,0,0.12)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{padding:mob?"16px 18px":"18px 28px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:"#4ade80",boxShadow:"0 0 10px #4ade8060",animation:"pulse 3s ease-in-out infinite"}}/>
              <span style={{fontFamily:MN,fontSize:10,fontWeight:600,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.5)"}}>Live</span>
              <span style={{fontFamily:MN,fontSize:10,color:"rgba(255,255,255,0.25)"}}>{new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short",timeZone:"Asia/Kolkata"})}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontFamily:MN,fontSize:10,color:"rgba(255,255,255,0.25)"}}>{activityFeed.length} events</span>
              {agoText&&<span style={{fontFamily:MN,fontSize:10,color:"rgba(255,255,255,0.2)"}}>· {agoText}</span>}
            </div>
          </div>
          <div style={{maxHeight:mob?260:240,overflowY:"auto"}}>
            {activityFeed.length===0?<div style={{padding:"32px",textAlign:"center",fontFamily:MN,fontSize:12,color:"rgba(255,255,255,0.3)"}}>Waiting for first sync...</div>:
            activityFeed.map((a,i)=>{
              const colors={new_order:"#60a5fa",approved:"#4ade80",dispatched:"#4ade80",overdue:"#f87171",value_up:"#4ade80",value_down:"#f87171",summary:"rgba(255,255,255,0.6)",ready:"#4ade80",pending:"#fbbf24",poc_summary:"rgba(255,255,255,0.5)"};
              const c=a.poc?(POC_COLORS[a.poc]||"#94a3b8"):colors[a.type]||"rgba(255,255,255,0.5)";
              const hasDetail=!!a.detail;const isExp=feedExp===i;
              return <div key={i}>
                <div className={hasDetail?"hv-dark":""} onClick={()=>hasDetail&&setFeedExp(isExp?null:i)} style={{padding:mob?"11px 18px":"11px 28px",borderBottom:(!isExp&&i<activityFeed.length-1)?"1px solid rgba(255,255,255,0.04)":"none",display:"flex",alignItems:"center",gap:12,cursor:hasDetail?"pointer":"default",background:isExp?"rgba(255,255,255,0.06)":"transparent"}}>
                  <span style={{width:22,height:22,borderRadius:8,background:isExp?c+"30":c+"18",border:"1px solid "+(isExp?c+"40":c+"20"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:isExp?"#fff":c,fontFamily:MN,fontWeight:700,flexShrink:0}}>{a.icon}</span>
                  <span style={{flex:1,fontSize:13,color:isExp?"#fff":"rgba(255,255,255,0.85)",lineHeight:1.4,fontWeight:isExp?600:a.type==="summary"?600:400}}>{a.text}</span>
                  <span style={{fontFamily:MN,fontSize:10,color:"rgba(255,255,255,0.2)",flexShrink:0}}>{a.time}</span>
                </div>
                {isExp&&a.detail&&<div style={{padding:mob?"8px 18px 12px 52px":"8px 28px 12px 68px",borderBottom:"1px solid rgba(255,255,255,0.04)",background:"rgba(255,255,255,0.02)"}}>
                  <div style={{display:"flex",gap:mob?8:16,flexWrap:"wrap",fontFamily:MN,fontSize:11}}>
                    <span style={{color:"rgba(255,255,255,0.3)"}}>#{a.detail.id}</span>
                    <span style={{fontWeight:700,color:"#fff"}}>{fmtVal(a.detail.value)}</span>
                    <span style={{color:"rgba(255,255,255,0.5)"}}>{a.detail.qty} qty</span>
                    {a.detail.poc&&<span style={{fontWeight:600,color:POC_COLORS[a.detail.poc]||"rgba(255,255,255,0.5)"}}>{a.detail.poc}</span>}
                    {a.detail.cats&&a.detail.cats.map(function(ct){return <span key={ct} style={{color:"rgba(255,255,255,0.3)"}}>{(CC[ct]||CC.Other).l||ct}</span>;})}
                    {a.detail.piDate&&<span style={{color:"rgba(255,255,255,0.25)"}}>PI: {a.detail.piDate}</span>}
                    {a.detail.approvalDate&&<span style={{color:"#4ade80"}}>Approved: {a.detail.approvalDate}</span>}
                  </div>
                </div>}
              </div>;
            })}
          </div>
        </div>

        {/* Insight Badge — Compact, expandable */}
        {(()=>{const allInsights=buildInsight(baseOrders,baseRtd,basePend,baseOverdue,baseLines,cat);
          const toneStyles={urgent:{accent:"#DC2626",label:"Critical",glow:"#DC262630"},warning:{accent:"#D97706",label:"Attention",glow:"#D9770630"},positive:{accent:"#16A34A",label:"On Track",glow:"#16A34A30"},neutral:{accent:"#2563EB",label:"Info",glow:"#2563EB30"}};
          const primary=allInsights[0];const secondary=allInsights.slice(1,3);
          const pts=toneStyles[primary.tone]||toneStyles.neutral;
          return <div style={{marginBottom:24}}>
            {/* Badge */}
            <div onClick={()=>setInsightOpen(o=>!o)} className="hv-row" style={{background:"#fff",borderRadius:10,border:"1px solid #E5E7EB",padding:mob?"12px 16px":"14px 20px",cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:pts.accent,boxShadow:"0 0 8px "+pts.glow,flexShrink:0,animation:"pulse 2s ease-in-out infinite"}}/>
              <div style={{flex:1}}>
                <span style={{fontFamily:MN,fontSize:10,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:pts.accent,marginRight:8}}>{pts.label}</span>
                <span style={{fontSize:13,fontWeight:600,color:"#0F172A"}}>{primary.headline}</span>
              </div>
              <span style={{fontFamily:MN,fontSize:12,color:"#94A3B8",transition:"transform 0.2s",transform:insightOpen?"rotate(180deg)":"none"}}>▾</span>
            </div>

            {/* Expanded insight content */}
            {insightOpen&&<div style={{marginTop:8}}>
              <div style={{background:"#fff",borderRadius:10,border:"1px solid #E5E7EB",borderLeft:"3px solid "+pts.accent,padding:mob?"20px 20px":"24px 28px",marginBottom:secondary.length>0?12:0}}>
                <div style={{fontSize:mob?13:14,color:"#475569",lineHeight:1.65,maxWidth:580,marginBottom:primary.cta?20:0}}>{primary.body}</div>
                {primary.cta&&<button className="hv-btn" onClick={(e)=>{e.stopPropagation();setActionOpen(o=>!o);}} style={{fontFamily:MN,fontSize:11,fontWeight:600,color:actionOpen?pts.accent:"#fff",background:actionOpen?"transparent":pts.accent,border:actionOpen?"1px solid "+pts.accent:"none",borderRadius:6,padding:"7px 16px",cursor:"pointer",boxShadow:actionOpen?"none":"0 1px 3px rgba(0,0,0,0.1)"}}>{actionOpen?"Close":primary.cta}</button>}
              </div>
              {secondary.length>0&&<div style={{display:"grid",gridTemplateColumns:mob?"1fr":"repeat("+Math.min(secondary.length,2)+",1fr)",gap:10}}>
                {secondary.map((ins,si)=>{const sts=toneStyles[ins.tone]||toneStyles.neutral;
                  return <div key={si} className="hv-insight-s" style={{background:"#fff",borderRadius:8,border:"1px solid #E5E7EB",borderLeft:"2px solid "+sts.accent,padding:mob?"14px 16px":"16px 20px"}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#0F172A",lineHeight:1.4,marginBottom:4}}>{ins.headline}</div>
                    <div style={{fontSize:12,color:"#475569",lineHeight:1.5}}>{ins.body}</div>
                  </div>;
                })}
              </div>}

              {/* Priority Orders inline */}
              {actionOpen&&primary.orders&&primary.orders.length>0&&<div style={{background:"#fff",borderRadius:10,border:"1px solid #E5E7EB",marginTop:12,overflow:"hidden"}}>
                <div style={{padding:"12px 20px",borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",color:"#475569"}}>Priority Orders</span>
                  <span style={{fontFamily:MN,fontSize:10,color:"#94A3B8"}}>{primary.orders.length}</span>
                </div>
                {primary.orders.slice(0,5).map((o,oi)=>{
                  const issueText=typeof primary.issue==="function"?primary.issue(o):"";
                  return <div key={o.id} className="hv-row" style={{padding:mob?"10px 16px":"10px 20px",borderBottom:oi<Math.min(primary.orders.length,5)-1?"1px solid #F1F5F9":"none",display:"flex",alignItems:"center",gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                        <span style={{fontSize:12,fontWeight:600,color:"#0F172A"}}>{o.party}</span>
                        <span style={{fontFamily:MN,fontSize:10,color:"#94A3B8"}}>#{o.id}</span>
                      </div>
                      <div style={{display:"flex",gap:8,fontSize:11,fontFamily:MN,color:"#94A3B8"}}>
                        <span style={{fontWeight:700,color:"#0F172A"}}>{fmtVal(o.totalValue)}</span>
                        {issueText&&<span>{issueText}</span>}
                      </div>
                    </div>
                  </div>;
                })}
              </div>}
            </div>}
          </div>;
        })()}

        {/* Supporting Metrics */}
        <div style={{display:"grid",gridTemplateColumns:mob?"repeat(2,1fr)":"repeat(4,1fr)",gap:mob?12:14,marginBottom:32}}>
          {[["Pipeline",fmtVal(baseOrders.reduce((s,o)=>s+o.totalValue,0)),baseOrders.length+" orders","#0F172A"],["Ready",baseRtd.length,fmtVal(baseRtd.reduce((s,o)=>s+o.totalValue,0)),"#16A34A"],["Pending",basePend.length,fmtVal(basePend.reduce((s,o)=>s+o.totalValue,0)),"#D97706"],["Overdue",baseOverdue.length,baseOverdue.length>0?fmtVal(baseOverdue.reduce((s,o)=>s+o.totalValue,0)):"None","#DC2626"]].map(([label,value,sub,color])=>
            <div key={label+dataVer} className="hv-card" style={{background:"#fff",borderRadius:10,border:"1px solid #E5E7EB",padding:"16px 18px",cursor:"default",animation:dataVer>1?"flash 1.5s ease":"none"}}>
              <div style={{fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:"#94A3B8",marginBottom:6}}>{label}</div>
              <div style={{fontFamily:MN,fontSize:22,fontWeight:700,color:label==="Overdue"&&baseOverdue.length===0?"#94A3B8":color,lineHeight:1,marginBottom:4,transition:"color 0.5s"}}>{value}</div>
              <div style={{fontFamily:MN,fontSize:10,color:"#94A3B8"}}>{sub}</div>
            </div>
          )}
        </div>

        {/* Category Breakdown - Collapsible */}
        <div style={{marginBottom:40}}>
          <div onClick={()=>setShowCats(c=>!c)} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"8px 0",marginBottom:showCats?12:0,userSelect:"none"}}>
            <span style={{fontFamily:MN,fontSize:10,color:"#94a3b8",transition:"transform 0.15s",transform:showCats?"rotate(90deg)":"none",display:"inline-block"}}>▶</span>
            <span style={{...S.section}}>Category Breakdown</span>
          </div>
          {showCats&&<div style={{display:"grid",gridTemplateColumns:mob?"repeat(2,1fr)":"repeat(auto-fill,minmax(160px,1fr))",gap:10}}>
          {(()=>{
            const ROLL_CATS=["Loop Rolls","TEFNO","Turf","Grass","Wire","Monograss"];
            const rollLines=allLines.filter(l=>ROLL_CATS.includes(l.category));
            const rollQty=rollLines.reduce((s,l)=>s+l.qty,0);
            const rollVal=fmtVal(rollLines.reduce((s,l)=>s+(l.value||0),0));
            const rollBd=ROLL_CATS.filter(c=>allLines.some(l=>l.category===c)).map(c=>[c,allLines.filter(l=>l.category===c).reduce((s,l)=>s+l.qty,0)]);
            const carLines=allLines.filter(l=>l.category==="Car Set");
            const carQty=carLines.reduce((s,l)=>s+l.qty,0);
            const carVal=fmtVal(carLines.reduce((s,l)=>s+(l.value||0),0));
            const carBd=[["3pc",carLines.filter(l=>l.width==="3pc").reduce((s,l)=>s+l.qty,0)],["5pc",carLines.filter(l=>l.width==="5pc").reduce((s,l)=>s+l.qty,0)]];
            const fmLines=allLines.filter(l=>l.category==="Foot Mat");
            const fmQty=fmLines.reduce((s,l)=>s+l.qty,0);
            const fmVal=fmtVal(fmLines.reduce((s,l)=>s+(l.value||0),0));
            const fmBw={};fmLines.forEach(l=>{const k=(l.width&&l.length)?l.width+" x "+l.length:l.width||l.length||"?";fmBw[k]=(fmBw[k]||0)+l.qty;});
            const fmBd=Object.entries(fmBw).sort((a,b)=>b[1]-a[1]);
            return(<>
              {rollQty>0&&<StatCard l="All Rolls" v={rollQty} sub={rollVal} unit="rolls" breakdown={rollBd} accent="#d97706"/>}
              {ROLL_CATS.filter(c=>allLines.some(l=>l.category===c)).map(c=>{
                const cl=allLines.filter(l=>l.category===c);const val=fmtVal(cl.reduce((s,l)=>s+(l.value||0),0));const qty=cl.reduce((s,l)=>s+l.qty,0);
                let bd=null;
                if(["Loop Rolls","TEFNO","Turf"].includes(c))bd=[["2ft",cl.filter(l=>l.width==="2ft").reduce((s,l)=>s+l.qty,0)],["4ft",cl.filter(l=>l.width==="4ft").reduce((s,l)=>s+l.qty,0)]];
                else if(c==="Wire")bd=[["2ft",cl.filter(l=>l.width==="2ft").reduce((s,l)=>s+l.qty,0)],["4ft",cl.filter(l=>l.width==="4ft").reduce((s,l)=>s+l.qty,0)]];
                else if(c==="Grass"){const bm={};cl.forEach(l=>{const m=l.model||"Other";bm[m]=(bm[m]||0)+l.qty;});bd=Object.entries(bm).sort((a,b)=>b[1]-a[1]).slice(0,3);}
                return <StatCard key={c} l={c} v={qty} sub={val} unit="rolls" breakdown={bd} accent={(CC[c]||CC.Other).c}/>;
              })}
              {carQty>0&&<StatCard l="Car Set" v={carQty} sub={carVal} unit="sets" breakdown={carBd} accent={(CC["Car Set"]||CC.Other).c}/>}
              {fmQty>0&&<StatCard l="Foot Mat" v={fmQty} sub={fmVal} unit="pcs" breakdown={fmBd} accent={(CC["Foot Mat"]||CC.Other).c} span2/>}
            </>);
          })()}
          </div>}
        </div>

        {/* Search & Filters */}
        {/* New orders banner */}
        {showNewOnly&&<div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"10px 16px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontFamily:MN,fontSize:12,fontWeight:600,color:"#2563eb"}}>Showing {newOrderIds.size} new order{newOrderIds.size!==1?"s":""}</span>
          <button onClick={()=>{setShowNewOnly(false);setNewOrderIds(new Set());}} style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#64748b",background:"#fff",border:"1px solid #e2e8f0",borderRadius:6,padding:"4px 12px",cursor:"pointer"}}>Back to all</button>
        </div>}

        {/* Search & Filters */}
        <div style={{marginBottom:28}}>
          <div style={{display:"flex",alignItems:"center",gap:mob?8:12,flexWrap:"wrap",marginBottom:14}}>
            <div style={{position:"relative",flex:1,minWidth:mob?140:220,maxWidth:320}}>
              <input value={srch} onChange={e=>{setSrch(e.target.value);setPg(1);setShowAllRtd(false);setShowAllPend(false);}} placeholder="Search by party name, model, or colour..." style={{...S.input,width:"100%",paddingRight:srch?60:14}}/>
              {srch&&<span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontFamily:MN,fontSize:10,fontWeight:600,color:"#2563eb",background:"#eff6ff",padding:"2px 6px",borderRadius:4}}>{filtered.length} found</span>}
            </div>
            <select value={srt} onChange={e=>setSrt(e.target.value)} style={S.select}><option value="da">Oldest</option><option value="dd">Newest</option><option value="pa">A→Z</option><option value="qd">Qty ↓</option><option value="vd">Value ↓</option></select>
            <select value={poc} onChange={e=>{setPoc(e.target.value);setPg(1);}} style={S.select}><option value="">All POC</option>{pocs.map(p=><option key={p}>{p}</option>)}</select>
            {newOrderIds.size>0&&!showNewOnly&&<button onClick={()=>{setShowNewOnly(true);setShowAllRtd(false);setShowAllPend(false);}} style={{fontFamily:MN,fontSize:11,fontWeight:700,color:"#2563eb",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:6,padding:"5px 12px",cursor:"pointer",whiteSpace:"nowrap",animation:"pulse 2s ease-in-out infinite"}}>+{newOrderIds.size} new</button>}
            {(srch||cat!=="all"||poc||showNewOnly)&&<button onClick={()=>{setSrch("");setCat("all");setPoc("");setShowNewOnly(false);setNewOrderIds(new Set());setPg(1);setShowAllRtd(false);setShowAllPend(false);}} style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#94a3b8",background:"none",border:"1px solid #e2e8f0",borderRadius:6,padding:"5px 12px",cursor:"pointer",whiteSpace:"nowrap"}}>Clear all</button>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[["all","All orders",filtered.length,null],...Object.entries(catCounts).sort((a,b)=>b[1]-a[1]).map(([c,n])=>[c,(CC[c]||CC.Other).l,n,(CC[c]||CC.Other).c])].map(([val,lbl,n,dotC])=>{
              const isActive=cat===val;
              return <div key={val} className={!isActive?"hv-pill":""} onClick={()=>{setCat(val);setPg(1);setShowAllRtd(false);setShowAllPend(false);}} style={{padding:"6px 14px",borderRadius:6,border:isActive?"1px solid #2563EB":"1px solid #E5E7EB",background:isActive?"#EFF6FF":"#F1F5F9",color:isActive?"#2563EB":"#334155",fontSize:11,fontFamily:MN,cursor:"pointer",fontWeight:isActive?600:500,display:"flex",alignItems:"center",gap:5}}>
                {val!=="all"&&<Dot c={isActive?"#2563EB":(dotC||"#94A3B8")} s={4}/>}
                {lbl}
                <span style={{fontFamily:MN,fontSize:10,color:isActive?"#2563EB":"#94A3B8"}}>{n}</span>
              </div>;
            })}
          </div>
        </div>

        {mob?<div style={{display:"flex",flexDirection:"column",gap:24}}>
          {!pendingApproval.length&&!readyToDispatch.length&&<div style={{...S.card,padding:48,textAlign:"center",color:"#94a3b8",fontFamily:MN}}>No orders found</div>}
          {readyToDispatch.length>0&&<div style={{...S.card,overflow:"hidden",borderLeft:"3px solid #16A34A"}}>
            <div style={{padding:"14px 16px",background:"#fff",borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",gap:10}}>
              <div style={{flex:1}}>
                <div style={{fontFamily:MN,fontSize:12,fontWeight:600,color:"#0F172A"}}>Ready to Dispatch <span style={{color:"#94A3B8",fontWeight:500}}>({readyToDispatch.length}) · {fmtVal(readyToDispatch.reduce((s,o)=>s+o.totalValue,0))}</span></div>
              </div>
            </div>
            {(showAllRtd?rtdSorted:rtdSorted.slice(0,5)).map((o,oi)=>{const ep=exp===o.id;const dy=daysSince(o.approvalDate);const isOD=dy>7;
              return <div key={o.id} style={{borderBottom:"1px solid #E5E7EB"}}>
                <div className="hv-row" onClick={()=>setExp(ep?null:o.id)} style={{padding:"12px 14px",cursor:"pointer",background:"#fff",borderLeft:ep?"3px solid #16A34A":"3px solid transparent"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontWeight:600,fontSize:13,display:"flex",alignItems:"center",gap:6,color:"#0F172A"}}>{o.party}{isNewOrder(o)&&<span style={{fontFamily:MN,fontSize:9,fontWeight:600,color:"#2563EB",background:"#EFF6FF",padding:"1px 6px",borderRadius:4}}>New</span>}</span>
                    <span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:isOD?"#DC2626":dy>3?"#D97706":"#16A34A"}}>{dy}d</span>
                  </div>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:4}}>{o.categories.map(c=><Badge key={c} cat={c}/>)}</div>
                  <div style={{display:"flex",gap:10,fontSize:10,fontFamily:MN,color:"#64748b",flexWrap:"wrap"}}>
                    <span>{o.approvalDate}</span>
                    <span style={{fontWeight:600}}>{cat==="all"?o.totalQty:o.lines.filter(l=>l.category===cat).reduce((s,l)=>s+l.qty,0)} qty</span>
                    <span style={{fontWeight:700,color:"#059669"}}>{fmtVal(o.totalValue)}</span>
                    <span style={{color:POC_COLORS[o.salesPOC]||"#64748b",fontWeight:600}}>{o.salesPOC}</span>
                  </div>
                </div>
                {ep&&<div style={{background:"#f8fafc",borderTop:"1px solid #d1fae5"}}>
                  <div style={{padding:"6px 14px 5px",borderBottom:"1px solid #e2e8f0",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    <span style={{fontFamily:MN,fontSize:9,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#94a3b8"}}>{o.lineCount} items · {fmtVal(o.totalValue)}</span>
                    <span style={{fontFamily:MN,fontSize:9,color:"#94a3b8"}}>PI: {o.id}</span>
                  </div>
                  {o.lines.map((l,i)=><div key={l.no||i} style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",background:i%2?"#fafafa":"#fff"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                      <span style={{fontFamily:MN,fontWeight:700,fontSize:12}}>{l.model}</span>
                      <span style={{fontFamily:MN,fontWeight:700,fontSize:13}}>{l.qty}</span>
                    </div>
                    <div style={{display:"flex",gap:8,fontSize:10,color:"#64748b",fontFamily:MN,marginTop:2,flexWrap:"wrap"}}>
                      <span>{l.colour}</span>
                      {l.width&&<span>{l.width}{l.length?"×"+l.length:""}</span>}
                      {l.backing&&<span>{l.backing}</span>}
                      <span style={{fontWeight:600,marginLeft:"auto"}}>{fmtVal(l.value||0)}</span>
                    </div>
                  </div>)}
                </div>}
              </div>;
            })}
            {!showAllRtd&&rtdSorted.length>5&&<div onClick={()=>setShowAllRtd(true)} style={{padding:"12px 16px",textAlign:"center",cursor:"pointer",borderTop:"1px solid #f1f5f9"}}>
              <span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#059669"}}>View all {rtdSorted.length} orders</span>
            </div>}
            {showAllRtd&&rtdSorted.length>5&&<div onClick={()=>setShowAllRtd(false)} style={{padding:"12px 16px",textAlign:"center",cursor:"pointer",borderTop:"1px solid #f1f5f9"}}>
              <span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#94a3b8"}}>Show less</span>
            </div>}
          </div>}
          {pendingApproval.length>0&&<div style={{...S.card,overflow:"hidden",borderLeft:"3px solid #D97706"}}>
            <div style={{padding:"14px 16px",background:"#fff",borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",gap:10}}>
              <div style={{flex:1}}>
                <div style={{fontFamily:MN,fontSize:12,fontWeight:600,color:"#0F172A"}}>Pending Approval <span style={{color:"#94A3B8",fontWeight:500}}>({pendingApproval.length}) · {fmtVal(pendingApproval.reduce((s,o)=>s+o.totalValue,0))}</span></div>
              </div>
            </div>
            {(showAllPend?pendingApproval:pendingApproval.slice(0,5)).map((o,oi)=>{const ep=exp===o.id;const days=daysSince(o.piDate);const ps=payStatus(!!o.approvalDate);
              return <div key={o.id} style={{borderBottom:"1px solid #E5E7EB"}}>
                <div className="hv-row" onClick={()=>setExp(ep?null:o.id)} style={{padding:"12px 14px",cursor:"pointer",background:"#fff",borderLeft:ep?"3px solid #D97706":"3px solid transparent"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontWeight:600,fontSize:13,display:"flex",alignItems:"center",gap:6,color:"#0F172A"}}>{o.party}{isNewOrder(o)&&<span style={{fontFamily:MN,fontSize:9,fontWeight:600,color:"#2563EB",background:"#EFF6FF",padding:"1px 6px",borderRadius:4}}>New</span>}</span>
                    <span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:days>30?"#DC2626":days>14?"#D97706":"#16A34A"}}>{days}d</span>
                  </div>
                  <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:4}}>{o.categories.map(c=><Badge key={c} cat={c}/>)}</div>
                  <div style={{display:"flex",gap:10,fontSize:10,fontFamily:MN,color:"#64748b",flexWrap:"wrap",alignItems:"center"}}>
                    <span>{o.piDate}</span>
                    <span style={{fontWeight:600}}>{cat==="all"?o.totalQty:o.lines.filter(l=>l.category===cat).reduce((s,l)=>s+l.qty,0)} qty</span>
                    <span style={{fontWeight:700,color:"#1e293b"}}>{fmtVal(o.totalValue)}</span>
                    {ps&&<span style={{fontFamily:MN,fontSize:9,fontWeight:600,padding:"1px 7px",borderRadius:10,background:ps.bg,color:ps.color}}>{ps.label}</span>}
                    <span style={{color:POC_COLORS[o.salesPOC]||"#64748b",fontWeight:600}}>{o.salesPOC}</span>
                  </div>
                </div>
                {ep&&<div style={{background:"#f8fafc",borderTop:"1px solid #fed7aa"}}>
                  <div style={{padding:"6px 14px 5px",borderBottom:"1px solid #e2e8f0",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    <span style={{fontFamily:MN,fontSize:9,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#94a3b8"}}>{o.lineCount} items · {fmtVal(o.totalValue)}</span>
                    <span style={{fontFamily:MN,fontSize:9,color:"#94a3b8"}}>PI: {o.id}</span>
                  </div>
                  {o.lines.map((l,i)=><div key={l.no||i} style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",background:i%2?"#fafafa":"#fff"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                      <span style={{fontFamily:MN,fontWeight:700,fontSize:12}}>{l.model}</span>
                      <span style={{fontFamily:MN,fontWeight:700,fontSize:13}}>{l.qty}</span>
                    </div>
                    <div style={{display:"flex",gap:8,fontSize:10,color:"#64748b",fontFamily:MN,marginTop:2,flexWrap:"wrap"}}>
                      <span>{l.colour}</span>
                      {l.width&&<span>{l.width}{l.length?"×"+l.length:""}</span>}
                      {l.backing&&<span>{l.backing}</span>}
                      <span style={{fontWeight:600,marginLeft:"auto"}}>{fmtVal(l.value||0)}</span>
                    </div>
                  </div>)}
                </div>}
              </div>;
            })}
            {!showAllPend&&pendingApproval.length>5&&<div onClick={()=>setShowAllPend(true)} style={{padding:"12px 16px",textAlign:"center",cursor:"pointer",borderTop:"1px solid #f1f5f9"}}>
              <span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#ea580c"}}>View all {pendingApproval.length} orders</span>
            </div>}
            {showAllPend&&pendingApproval.length>5&&<div onClick={()=>setShowAllPend(false)} style={{padding:"12px 16px",textAlign:"center",cursor:"pointer",borderTop:"1px solid #f1f5f9"}}>
              <span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#94a3b8"}}>Show less</span>
            </div>}
          </div>}
        </div>:
        <div style={{display:"flex",flexDirection:"column",gap:32}}>
          {!pendingApproval.length&&!readyToDispatch.length&&<div style={{...S.card,padding:48,textAlign:"center",color:"#94a3b8",fontFamily:MN}}>No orders found</div>}
          {readyToDispatch.length>0&&<div style={{...S.card,overflow:"hidden",borderLeft:"3px solid #16A34A"}}>
            <div style={{padding:"14px 22px",background:"#fff",borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontFamily:MN,fontSize:12,fontWeight:600,color:"#0F172A"}}>Ready to Dispatch <span style={{color:"#94A3B8",fontWeight:500}}>({readyToDispatch.length}) · {fmtVal(readyToDispatch.reduce((s,o)=>s+o.totalValue,0))}</span></div>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>
                <th style={{width:22,background:"#F8FAFC",borderBottom:"1px solid #E5E7EB"}}/>
                {[["Date ↕",null],["Days",null],["Party",null],["Categories",null],["Qty",null],["POC",null],["Value",null],["Status",null]].map(([h])=>
                  <th key={h} style={{background:"#F8FAFC",color:"#94A3B8",fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",padding:"10px 14px",textAlign:["Qty","Value"].includes(h)?"right":"left",borderBottom:"1px solid #E5E7EB"}}>{h}</th>
                )}
              </tr></thead>
              <tbody>{showAllRtd?rtdRows:rtdRows.slice(0,10)}</tbody>
            </table>
            {!showAllRtd&&rtdRows.length>10&&<div onClick={()=>setShowAllRtd(true)} style={{padding:"12px 20px",textAlign:"center",cursor:"pointer",borderTop:"1px solid #f1f5f9"}}>
              <span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#059669"}}>View all {readyToDispatch.length} orders</span>
            </div>}
            {showAllRtd&&rtdRows.length>10&&<div onClick={()=>setShowAllRtd(false)} style={{padding:"12px 20px",textAlign:"center",cursor:"pointer",borderTop:"1px solid #f1f5f9"}}>
              <span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#94a3b8"}}>Show less</span>
            </div>}
          </div>}
          {pendingApproval.length>0&&<div style={{...S.card,overflow:"hidden",borderLeft:"3px solid #D97706"}}>
            <div style={{padding:"14px 22px",background:"#fff",borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontFamily:MN,fontSize:12,fontWeight:600,color:"#0F172A"}}>Pending Approval <span style={{color:"#94A3B8",fontWeight:500}}>({pendingApproval.length}) · {fmtVal(pendingApproval.reduce((s,o)=>s+o.totalValue,0))}</span></div>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>
                <th style={{width:22,background:"#F8FAFC",borderBottom:"1px solid #E5E7EB"}}/>
                {[["Date ↕",null],["Days",null],["Party",null],["Categories",null],["Qty",null],["POC",null],["Value",null],["Status",null]].map(([h])=>
                  <th key={h} style={{background:"#F8FAFC",color:"#94A3B8",fontFamily:MN,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",padding:"10px 14px",textAlign:["Qty","Value"].includes(h)?"right":"left",borderBottom:"1px solid #E5E7EB"}}>{h}</th>
                )}
              </tr></thead>
              <tbody>
              {(showAllPend?pendingApproval:pendingApproval.slice(0,5)).map((o,oi)=>{const ep=exp===o.id;const days=daysSince(o.piDate);const dc=days>30?"#DC2626":days>14?"#D97706":"#16A34A";const ps=payStatus(!!o.approvalDate);
                return[
                  <tr className="hv-row" key={o.id} onClick={()=>setExp(ep?null:o.id)} style={{cursor:"pointer",background:"#fff",borderLeft:ep?"3px solid #D97706":"3px solid transparent"}}>
                    <td style={{padding:"13px 14px",borderBottom:"1px solid #f1f5f9",fontFamily:MN,fontSize:10,color:"#94a3b8"}}>{ep?"▾":"▸"}</td>
                    <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",fontFamily:MN,fontSize:11,whiteSpace:"nowrap"}}>{o.piDate}</td>
                    <td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB"}}><span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:dc}}>{days}d</span></td>
                    <td style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB",fontWeight:600,maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.party}</td>
                    <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9"}}><div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{o.categories.map(c=><Badge key={c} cat={c}/>)}</div></td>
                    
                    <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",fontFamily:MN,fontSize:13,fontWeight:700,textAlign:"right"}}>{cat==="all"?o.totalQty:o.lines.filter(l=>l.category===cat).reduce((s,l)=>s+l.qty,0)}</td>
                    <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9"}}><span style={{fontFamily:MN,fontSize:10,fontWeight:600,color:POC_COLORS[o.salesPOC]||"#64748b",background:(POC_COLORS[o.salesPOC]||"#64748b")+"15",padding:"2px 8px",borderRadius:12}}>{o.salesPOC}</span></td>
                    <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",fontFamily:MN,fontSize:12,fontWeight:600,textAlign:"right"}}>{fmtVal(o.totalValue)}</td>
                    <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9"}}>{ps?<span style={{fontFamily:MN,fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:20,background:ps.bg,color:ps.color}}>{ps.label}</span>:<span style={{fontFamily:MN,fontSize:10,color:"#cbd5e1"}}>—</span>}</td>
                  </tr>,
                  ep&&<tr key={o.id+"x"}><td colSpan={9} style={{padding:0,borderBottom:"2px solid #d97706"}}>
                    <div style={{background:"#f8fafc",padding:"8px 16px 4px 28px",borderBottom:"1px solid #e2e8f0",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{...S.section,fontSize:10}}>{o.lineCount} line items</span><span style={{fontFamily:MN,fontSize:11,color:"#64748b"}}>· {fmtVal(o.totalValue)}</span>
                      <span style={{fontFamily:MN,fontSize:10,color:"#94a3b8"}}>PI</span><span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#475569"}}>{o.id}</span>
                    </div>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>{["#","Code","Model","Backing","Colour","Width","Length","Qty","Rate","Value"].map(h=><th key={h} style={{padding:"8px 14px",...S.section,fontSize:9,background:"#f1f5f9",borderBottom:"1px solid #e2e8f0",textAlign:["Qty","Rate","Value"].includes(h)?"right":"left"}}>{h}</th>)}</tr></thead>
                      <tbody>{o.lines.map((l,i)=><tr key={l.no} style={{background:i%2?"#fafafa":"#fff"}}>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:10,fontFamily:MN,color:"#94a3b8"}}>{i+1}</td>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:10,fontFamily:MN,fontWeight:600,color:"#64748b"}}>{l.partyCode||"—"}</td>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:12,fontWeight:600}}>{l.model}</td>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:11,color:"#64748b"}}>{l.backing}</td>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:12}}>{l.colour}</td>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:11,fontFamily:MN}}>{l.width}</td>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:11,fontFamily:MN,color:"#94a3b8"}}>{l.length}</td>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:14,fontFamily:MN,fontWeight:700,textAlign:"right"}}>{l.qty}</td>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:11,fontFamily:MN,textAlign:"right",color:"#64748b"}}>{l.actualRate||"—"}</td>
                        <td style={{padding:"8px 14px",borderBottom:"1px solid #f1f5f9",fontSize:12,fontFamily:MN,fontWeight:600,textAlign:"right"}}>{fmtVal(l.value||0)}</td>
                      </tr>)}</tbody>
                    </table>
                  </td></tr>
                ];
              })}
              </tbody>
            </table>
            {!showAllPend&&pendingApproval.length>5&&<div onClick={()=>setShowAllPend(true)} style={{padding:"12px 20px",textAlign:"center",cursor:"pointer",borderTop:"1px solid #f1f5f9"}}>
              <span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#ea580c"}}>View all {pendingApproval.length} orders</span>
            </div>}
            {showAllPend&&pendingApproval.length>5&&<div onClick={()=>setShowAllPend(false)} style={{padding:"12px 20px",textAlign:"center",cursor:"pointer",borderTop:"1px solid #f1f5f9"}}>
              <span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#94a3b8"}}>Show less</span>
            </div>}
          </div>}
        </div>
      }
    </div>}

      {/* ═══ PARTY ═══ */}
      {tab==="party"&&<div>
        {mob&&!mpv?<div>
          <input value={psrch} onChange={e=>setPsrch(e.target.value)} placeholder="Search party..." style={{...S.input,width:"100%",marginBottom:14}}/>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {pFilt.slice(0,50).map(p=>{const tv=p.pendingValue||0;
              return <div key={p.name} onClick={()=>{setSelP(p.name);setPcf("all");setShowHist(false);setMpv(true);}} style={{...S.card,padding:"14px 16px",cursor:"pointer"}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{p.name}</div>
                <div style={{display:"flex",gap:8,fontSize:10,fontFamily:MN,color:"#94a3b8",marginBottom:6}}><span>{p.poc}</span><span>·</span><span>{p.invoiceCount} inv</span></div>
                <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:6}}>
                  <span style={{fontFamily:MN,fontSize:12,fontWeight:700,color:"#059669"}}>{fmtVal(p.dispatchedTotal||0)}</span>
                  {tv>0&&<span style={{fontFamily:MN,fontSize:11,fontWeight:600,color:"#ea580c"}}>{fmtVal(tv)} pending</span>}
                </div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{Object.keys(p.cats).map(c=><Badge key={c} cat={c}/>)}</div>
              </div>;})}
          </div>
        </div>:mob&&mpv?
          <PartyDetail party={sPObj} pcf={pcf} setPcf={setPcf} showHist={showHist} setShowHist={setShowHist} mob onBack={()=>setMpv(false)}/>
        :<div style={{display:"grid",gridTemplateColumns:"300px 1fr",...S.card,overflow:"hidden",minHeight:650}}>
          <div style={{borderRight:"1px solid #e2e8f0",display:"flex",flexDirection:"column"}}>
            <div style={{background:"#0f172a",color:"#fff",padding:"14px 16px",flexShrink:0}}>
              <div style={{...S.section,fontSize:10,color:"#64748b",marginBottom:8}}>All Parties · {pFilt.length}</div>
              <input value={psrch} onChange={e=>setPsrch(e.target.value)} placeholder="Search..." style={{width:"100%",padding:"8px 12px",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,background:"rgba(255,255,255,0.06)",color:"#fff",fontSize:12,fontFamily:SN,outline:"none"}}/>
            </div>
            <div style={{overflowY:"auto",flex:1}}>
              {pFilt.map(p=>{const tv=p.pendingValue||0;const hasApproval=p.orders.some(o=>!!o.approvalDate);const ps=payStatus(hasApproval);
                return <div key={p.name} onClick={()=>{setSelP(p.name);setPcf("all");setShowHist(false);}} style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9",cursor:"pointer",background:selP===p.name?"#fffbeb":"#fff",borderLeft:selP===p.name?"3px solid #d97706":"3px solid transparent",transition:"all 0.15s"}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>{p.name}</div>
                  <div style={{fontFamily:MN,fontSize:10,color:"#94a3b8",marginBottom:4}}>{p.poc} · {p.invoiceCount||0} inv</div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontFamily:MN,fontSize:11,fontWeight:700,color:"#059669"}}>{fmtVal(p.dispatchedTotal||0)}</span>
                    {ps&&<span style={{fontFamily:MN,fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:12,background:ps.bg,color:ps.color}}>{ps.label}</span>}
                  </div>
                  {tv>0&&<div style={{fontFamily:MN,fontSize:10,fontWeight:600,color:"#ea580c",marginBottom:4}}>{fmtVal(tv)} pending</div>}
                  <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:4}}>{Object.keys(p.cats).map(c=><Badge key={c} cat={c}/>)}</div>
                  <ReorderBadge name={p.name}/>
                  <MonthlyBar name={p.name}/>
                </div>;})}
            </div>
          </div>
          <PartyDetail party={sPObj} pcf={pcf} setPcf={setPcf} showHist={showHist} setShowHist={setShowHist} mob={false}/>
        </div>}
      </div>}

      {tab==="stock"&&<StockProduction mob={mob}/>}
      {tab==="dispatch"&&<DispatchTab mob={mob}/>}
      {tab==="analytics"&&<AnalyticsTab mob={mob}/>}
      {tab==="calls"&&<CallSchedule mob={mob}/>}
      {tab==="production"&&<ProductionTab mob={mob} user={user} role={role}/>}
    </div>
  </div>;
}
