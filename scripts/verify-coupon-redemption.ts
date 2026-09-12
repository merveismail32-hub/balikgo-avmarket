import assert from "node:assert/strict";
import { CouponDomainError, assertCampaignAccessCouponAvailable } from "../app/lib/coupon-domain";
const err=(c:string)=>(e:unknown)=>e instanceof CouponDomainError&&e.code===c;
const now=new Date("2026-09-12T12:00:00.000Z");
assert.doesNotThrow(()=>assertCampaignAccessCouponAvailable({accessMode:"CAMPAIGN_ACCESS",lifecycleStatus:"ACTIVE",active:true,validFrom:new Date("2026-09-12T11:00:00Z"),validUntil:new Date("2026-09-12T13:00:00Z"),usageLimit:1,usageCount:0},now));
assert.throws(()=>assertCampaignAccessCouponAvailable({accessMode:"CAMPAIGN_ACCESS",lifecycleStatus:"REVOKED",active:false,validFrom:null,validUntil:null,usageLimit:null,usageCount:0},now),err("COUPON_REVOKED"));
assert.throws(()=>assertCampaignAccessCouponAvailable({accessMode:"LEGACY_INLINE",lifecycleStatus:"ACTIVE",active:true,validFrom:null,validUntil:null,usageLimit:null,usageCount:0},now),err("COUPON_NOT_ELIGIBLE"));
console.log("PASS: coupon redemption domain lifecycle/error characterization");
