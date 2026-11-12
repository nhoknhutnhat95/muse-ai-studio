// Quota and login validity are independent. Never turn unknown quota into zero.
const percent=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null;
function remainingTokens(value){
  if(typeof value!=='string')return null;
  const match=/^\s*(\d+(?:\.\d+)?)\s*([KMBT])?\s*(?:tokens?)?\s*(?:left|remaining)?\s*$/i.exec(value);
  return match?Number(match[1])*({K:1e3,M:1e6,B:1e9,T:1e12}[match[2]?.toUpperCase()]||1):null;
}
export function quotaAvailability(quota,now=Date.now()/1000){
  const known=quota?.found===true,used=known?percent(quota.weekly_used_pct):null;
  const weeklyRemaining=used===null?null:Math.round((100-used)*100)/100;
  const tokens=known?remainingTokens(quota.extra_left):null,extraUsed=known?percent(quota.extra_used_pct):null;
  const expires=typeof quota?.extra_expires==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(quota.extra_expires)?Date.parse(quota.extra_expires)/1000:null;
  const extraExpired=Number.isFinite(expires)&&expires<=now;
  // Conflicting fields require a fresh query rather than a confident claim.
  const conflict=tokens!==null&&((tokens>0&&extraUsed===100)||(tokens===0&&extraUsed!==null&&extraUsed>0&&extraUsed<100));
  const extraState=!known?'unknown':extraExpired?'exhausted':conflict?'unknown':tokens!==null?(tokens>0?'available':'exhausted'):extraUsed===100?'exhausted':'unknown';
  const status=weeklyRemaining!==null&&weeklyRemaining>0?'available':weeklyRemaining===0?(extraState==='available'?'extra_only':extraState==='exhausted'?'exhausted':'weekly_exhausted'):'unknown';
  const checked=typeof quota?.checked_at==='number'&&Number.isFinite(quota.checked_at)&&quota.checked_at>0?quota.checked_at:null;
  const age=checked===null?null:Math.max(0,now-checked);
  return {status,weeklyRemainingPct:weeklyRemaining,extraState,extraRemainingTokens:tokens,extraExpired,conflict,checkedAt:checked,ageSeconds:age,stale:age===null||age>3600};
}
