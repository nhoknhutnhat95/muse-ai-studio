import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaAvailability} from '../server/account-quota.mjs';
const now=1800000000;
const quota=(values={})=>({found:true,checked_at:now,weekly_used_pct:100,extra_used_pct:100,extra_left:'0 tokens left',...values});
test('quota distinguishes remaining weekly quota, extra-only and fully exhausted',()=>{
  assert.equal(quotaAvailability(quota({weekly_used_pct:49}),now).weeklyRemainingPct,51);
  assert.equal(quotaAvailability(quota({weekly_used_pct:0}),now).status,'available');
  assert.equal(quotaAvailability(quota(),now).status,'exhausted');
  const extra=quotaAvailability(quota({extra_used_pct:11,extra_left:'892M tokens left'}),now);
  assert.equal(extra.status,'extra_only');assert.equal(extra.extraRemainingTokens,892000000);
  assert.equal(quotaAvailability(quota({extra_used_pct:2,extra_left:'1.9B tokens left'}),now).extraRemainingTokens,1900000000);
});
test('missing, invalid or contradictory quota never becomes exhausted by default',()=>{
  for(const value of [null,{},quota({found:false}),quota({weekly_used_pct:null}),quota({weekly_used_pct:-1}),quota({weekly_used_pct:101}),quota({weekly_used_pct:'100'})])assert.equal(quotaAvailability(value,now).status,'unknown');
  assert.equal(quotaAvailability(quota({extra_used_pct:null,extra_left:''}),now).status,'weekly_exhausted');
  assert.equal(quotaAvailability(quota({extra_used_pct:null,extra_left:'please inspect 50 left'}),now).status,'weekly_exhausted');
  const conflict=quotaAvailability(quota({extra_used_pct:100,extra_left:'1B tokens left'}),now);assert.equal(conflict.conflict,true);assert.equal(conflict.status,'weekly_exhausted');
});
test('freshness and extra expiry are independent of the last known weekly quota',()=>{
  assert.equal(quotaAvailability(quota({checked_at:now-3601}),now).stale,true);
  assert.equal(quotaAvailability(quota({checked_at:null}),now).stale,true);
  assert.equal(quotaAvailability(quota({checked_at:now-3600}),now).stale,false);
  const expired=quotaAvailability(quota({extra_used_pct:10,extra_left:'1B tokens left',extra_expires:'2020-01-01'}),now);assert.equal(expired.extraExpired,true);assert.equal(expired.status,'exhausted');
  assert.equal(quotaAvailability(quota({weekly_used_pct:50,extra_expires:'2020-01-01'}),now).status,'available');
});
