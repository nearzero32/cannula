import TreatmentRequest from '../models/pharmacy-treatment-request.model';
import { PharmacyRequestStatusEnum as S } from '../interfaces/pharmacy-treatment-request.interface';

const ACCEPTED_STATUSES=[S.CONFIRMED,S.PREPARING,S.READY_FOR_DELIVERY,S.OUT_FOR_DELIVERY,S.DELIVERED];
export async function backfillPharmacyWorkflow():Promise<{versions:number;acceptedSnapshots:number}>{
    const versions=(await TreatmentRequest.updateMany({workflowVersion:{$exists:false}},{$set:{workflowVersion:0}})).modifiedCount;
    const acceptedSnapshots=(await TreatmentRequest.updateMany(
        {status:{$in:ACCEPTED_STATUSES},quotation:{$ne:null},$or:[{accepted_quotation:null},{accepted_quotation:{$exists:false}}]},
        [{$set:{accepted_quotation:{$mergeObjects:['$quotation',{accepted_at:{$ifNull:['$quotation.accepted_at','$updatedAt']}}]}}}],
    )).modifiedCount;
    console.log(`[Migration] Pharmacy workflow backfill complete: ${versions} versions, ${acceptedSnapshots} accepted snapshots`);
    return{versions,acceptedSnapshots};
}
