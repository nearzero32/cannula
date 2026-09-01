import {afterEach,describe,expect,mock,spyOn,test} from 'bun:test';
import TreatmentRequest from '../src/models/pharmacy-treatment-request.model';
import {backfillPharmacyWorkflow} from '../src/migrations/backfill-pharmacy-workflow.migration';
afterEach(()=>mock.restore());
describe('Pharmacy workflow backfill',()=>{
    test('backfills missing workflow versions and immutable accepted snapshots idempotently',async()=>{
        const update=spyOn(TreatmentRequest,'updateMany').mockResolvedValueOnce({modifiedCount:3} as never).mockResolvedValueOnce({modifiedCount:2} as never);
        expect(await backfillPharmacyWorkflow()).toEqual({versions:3,acceptedSnapshots:2});
        expect((update.mock.calls[0] as any)[0]).toEqual({workflowVersion:{$exists:false}});
        const acceptedFilter=(update.mock.calls[1] as any)[0];expect(acceptedFilter.status.$in).toContain('confirmed');expect(acceptedFilter.status.$in).toContain('delivered');expect(acceptedFilter.quotation).toEqual({$ne:null});
    });
});
