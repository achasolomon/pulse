import {createStaffWebApi} from '@pulse/api-client';
import {canUseLaboratoryCriticalResults,canUseImagingHandoffs} from './workspace-navigation.mjs';
const api=createStaffWebApi();
export async function loadCriticalCounts(privileges:string[],signal?:AbortSignal){
 const counts=await Promise.all([...(canUseLaboratoryCriticalResults(privileges)?[api.criticalCount(signal)]:[]),...(canUseImagingHandoffs(privileges)?[api.imagingHandoffCount(signal)]:[])]);
 return counts.reduce((sum,c)=>({pending:sum.pending+c.pending,overdue:sum.overdue+c.overdue}),{pending:0,overdue:0});
}
