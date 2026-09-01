import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import mongoose from 'mongoose';
import TreatmentRequest from '../src/models/pharmacy-treatment-request.model';
import History from '../src/models/pharmacy-treatment-request-history.model';
import pharmacyService from '../src/services/pharmacy.service';
import ActivityLogService from '../src/services/activity-log.service';
import { calculateQuotation, nextPharmacyRequestNumber, PharmacyTreatmentRequestService } from '../src/services/pharmacy-treatment-request.service';
import { PharmacyService } from '../src/services/pharmacy.service';
import User from '../src/models/users.model'; import Pharmacy from '../src/models/pharmacy.model';
import { formatPharmacyRequestForAvailable, formatPharmacyRequestForPatient } from '../src/services/pharmacy-treatment-request.formatter';
import { PharmacyDispatchStatusEnum as DS, PharmacyRequestStatusEnum as S } from '../src/interfaces/pharmacy-treatment-request.interface';
import { directPharmacyTransactionRunner } from '../src/services/pharmacy-transaction.service';
import Counter from '../src/models/pharmacy-treatment-request-counter.model';

afterEach(() => mock.restore());
const requestId='507f191e810c19729de86101', pharmacyA=new mongoose.Types.ObjectId('507f191e810c19729de86102'), pharmacyB=new mongoose.Types.ObjectId('507f191e810c19729de86103'), patientId=new mongoose.Types.ObjectId('507f191e810c19729de86104'), userA='507f191e810c19729de86105';
function query<T>(result:T){const q:any={exec:async()=>result};for(const method of ['populate','sort','skip','limit','select'])q[method]=()=>q;return q;}
function request(status:string, pharmacy:any=pharmacyA, version=1, quoteVersion=1){return {_id:new mongoose.Types.ObjectId(requestId),request_number:'RX-2026-000001',patient_id:patientId,status,workflowVersion:version,dispatch:{status:pharmacy?DS.CLAIMED:DS.OPEN,mode:'OPEN_POOL',pharmacy_id:pharmacy,version},quotation:quoteVersion?{version:quoteVersion,pharmacy_id:pharmacy,items:[],unavailable_items:[],medicines_subtotal:0,delivery_fee:0,discount:0,total_price:0,quoted_at:new Date()}:null,accepted_quotation:null,excluded_pharmacy_ids:[],toObject(){return this;}} as any;}
function quiet(){spyOn(History,'create').mockResolvedValue({} as never);spyOn(ActivityLogService,'logActivity').mockResolvedValue({} as never);}
const actor={user_id:userA,type:'PHARMACY' as const,endpoint:'/test'};

describe('Pharmacy quotation calculation', () => {
    test('calculates trusted line, subtotal, and total IQD values on the server', () => {
        const value=calculateQuotation({items:[{name:'A',quantity:2,unit_price:2500},{name:'B',quantity:1,unit_price:7000}],unavailable_items:[],delivery_fee:3000,discount:500});
        expect(value.items.map(item=>item.line_total)).toEqual([5000,7000]); expect(value.medicines_subtotal).toBe(12000); expect(value.total_price).toBe(14500);
    });
    test('rejects negative, empty, unsafe, and over-discounted quotes', () => {
        expect(()=>calculateQuotation({items:[{name:'A',quantity:1,unit_price:-1}],unavailable_items:[],delivery_fee:0,discount:0})).toThrow();
        expect(()=>calculateQuotation({items:[{name:'A',quantity:1,unit_price:1}],unavailable_items:[],delivery_fee:0,discount:2})).toThrow();
        expect(()=>calculateQuotation({items:[],unavailable_items:[],delivery_fee:0,discount:0})).toThrow();
    });
});

describe('Pharmacy request number allocation', () => {
    test('uses an atomic yearly key and resets formatting across year rollover', async () => {
        const update=spyOn(Counter,'findOneAndUpdate').mockReturnValueOnce(query({sequence:9}) as never).mockReturnValueOnce(query({sequence:1}) as never);
        expect(await nextPharmacyRequestNumber(new Date('2026-12-31T23:59:59Z'))).toBe('RX-2026-000009');
        expect(await nextPharmacyRequestNumber(new Date('2027-01-01T00:00:00Z'))).toBe('RX-2027-000001');
        expect((update.mock.calls[0] as any)[0]._id).toBe('pharmacy_request:2026'); expect((update.mock.calls[1] as any)[0]._id).toBe('pharmacy_request:2027');
        expect((update.mock.calls[0] as any)[1]).toEqual({$inc:{sequence:1}});
    });
});

describe('Pharmacy atomic dispatch and quotation CAS', () => {
    test('available pool requires an operational Pharmacy and excludes its rejected requests', async () => {
        const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner); spyOn(pharmacyService,'requireOperational').mockResolvedValue({_id:pharmacyA} as any);
        const find=spyOn(TreatmentRequest,'find').mockReturnValue(query([]) as never); spyOn(TreatmentRequest,'countDocuments').mockReturnValue(query(0) as never);
        await service.listAvailable(userA,{page:1,limit:10}); const filter=(find.mock.calls[0] as any)[0];
        expect(filter.status).toBe(S.OPEN); expect(filter.excluded_pharmacy_ids.$ne).toEqual(pharmacyA); expect(filter.$and).toBeDefined();
    });
    test('two claims share one conditional OPEN write and only one wins', async () => {
        const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner); spyOn(pharmacyService,'requireOperational').mockImplementation(async uid=>({_id:uid===userA?pharmacyA:pharmacyB} as any)); quiet(); let open=true; spyOn(TreatmentRequest,'findOne').mockReturnValue(query(request(S.OPEN,null,0,0)) as never);const claimed=request(S.UNDER_REVIEW,pharmacyA,1,0);claimed.prescription_images=['private-key'];claimed.treatment_details='sensitive treatment';claimed.delivery_address={address_text:'private address',lat:33,lng:44};claimed.delivery_phone='07700000000';claimed.notes='private note';
        const update=spyOn(TreatmentRequest,'findOneAndUpdate').mockImplementation(()=>query(open?(open=false,claimed):null) as never);
        const results=await Promise.allSettled([service.claim(userA,requestId,actor),service.claim('507f191e810c19729de86106',requestId,{...actor,user_id:'507f191e810c19729de86106'})]);
        expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1); expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
        const [filter,mutation]=update.mock.calls[0] as any; expect(filter.status).toBe(S.OPEN); expect(filter.excluded_pharmacy_ids.$ne).toBeDefined(); expect(mutation.$inc['dispatch.version']).toBe(1);expect(mutation.$inc.workflowVersion).toBe(1);const logged=(ActivityLogService.logActivity as any).mock.calls[0][0].new_data;for(const key of ['prescription_images','treatment_details','delivery_address','delivery_phone','notes'])expect(logged[key]).toBeUndefined();expect(logged.prescription_image_count).toBe(1);
    });
    test('quote revision CASes dispatch and quote versions and computes totals', async () => {
        const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner),current=request(S.WAITING_CUSTOMER_APPROVAL,pharmacyA,4,2),updated=request(S.WAITING_CUSTOMER_APPROVAL,pharmacyA,5,3);
        spyOn(pharmacyService,'requireOperational').mockResolvedValue({_id:pharmacyA} as any); spyOn(TreatmentRequest,'findOne').mockReturnValue(query(current) as never); const update=spyOn(TreatmentRequest,'findOneAndUpdate').mockReturnValue(query(updated) as never); quiet();
        await service.quote(userA,requestId,{items:[{name:'دواء',quantity:2,unit_price:1000}],unavailable_items:[],delivery_fee:500,discount:250},actor);
        const [filter,mutation]=update.mock.calls[0] as any; expect(filter['quotation.version']).toBe(2); expect(filter['dispatch.version']).toBe(4); expect(mutation.$set.quotation.version).toBe(3); expect(mutation.$set.quotation.total_price).toBe(2250);
    });
    test('stale patient decision loses and exact rejection reopens with an exclusion', async () => {
        const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner),current=request(S.WAITING_CUSTOMER_APPROVAL,pharmacyA,2,2); spyOn(TreatmentRequest,'findOne').mockReturnValue(query(current) as never); quiet();
        const update=spyOn(TreatmentRequest,'findOneAndUpdate').mockReturnValueOnce(query(null) as never).mockReturnValueOnce(query(request(S.OPEN,null,3,0)) as never);
        await expect(service.decide(patientId,requestId,1,true,undefined,{user_id:userA,type:'PATIENT',endpoint:'/test'})).rejects.toMatchObject({status:409});
        await service.decide(patientId,requestId,2,false,'السعر',{user_id:userA,type:'PATIENT',endpoint:'/test'});
        const [filter,mutation]=update.mock.calls[1] as any; expect(filter['quotation.version']).toBe(2); expect(filter.patient_id).toEqual(patientId); expect(mutation.$set.status).toBe(S.OPEN); expect(mutation.$set.quotation).toBeNull(); expect(String(mutation.$addToSet.excluded_pharmacy_ids)).toBe(String(pharmacyA));
    });
    test('acceptance writes an immutable snapshot of the exact active quotation', async () => {
        const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner),current=request(S.WAITING_CUSTOMER_APPROVAL,pharmacyA,5,3),updated=request(S.CONFIRMED,pharmacyA,6,3);
        current.quotation.items=[{name:'دواء',quantity:2,unit_price:1000,line_total:2000,note:null}]; current.quotation.medicines_subtotal=2000; current.quotation.delivery_fee=500; current.quotation.discount=100; current.quotation.total_price=2400;
        spyOn(TreatmentRequest,'findOne').mockReturnValue(query(current) as never); const update=spyOn(TreatmentRequest,'findOneAndUpdate').mockReturnValue(query(updated) as never); quiet();
        await service.decide(patientId,requestId,3,true,undefined,{user_id:userA,type:'PATIENT',endpoint:'/test'});
        const [filter,mutation]=update.mock.calls[0] as any; expect(filter.workflowVersion).toBe(5); expect(mutation.$inc.workflowVersion).toBe(1); expect(mutation.$set.accepted_quotation).toMatchObject({version:3,pharmacy_id:pharmacyA,total_price:2400}); expect(mutation.$set.accepted_quotation.accepted_at).toBeInstanceOf(Date);
    });
    test('critical history failure prevents the workflow operation from reporting success', async () => {
        const failing={create:async()=>{throw new Error('history unavailable')}}; const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner,failing);
        spyOn(pharmacyService,'requireOperational').mockResolvedValue({_id:pharmacyA} as any); spyOn(TreatmentRequest,'findOne').mockReturnValue(query(request(S.OPEN,null,0,0)) as never); spyOn(TreatmentRequest,'findOneAndUpdate').mockReturnValue(query(request(S.UNDER_REVIEW,pharmacyA,1,0)) as never);
        await expect(service.claim(userA,requestId,actor)).rejects.toThrow('history unavailable');
    });
    test('excluded Pharmacy requires both explicit Admin override and a reason',async()=>{
        const current=request(S.OPEN,null,4,0);current.excluded_pharmacy_ids=[pharmacyA];const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner);
        spyOn(pharmacyService,'requireAssignable').mockResolvedValue({_id:pharmacyA} as any);spyOn(TreatmentRequest,'findById').mockReturnValue(query(current) as never);
        await expect(service.adminAssign(requestId,String(pharmacyA),'سبب',{user_id:userA,type:'ADMIN',endpoint:'/test'},false)).rejects.toMatchObject({status:400,code:'PHARMACY_EXCLUDED'});
        await expect(service.adminAssign(requestId,String(pharmacyA),undefined,{user_id:userA,type:'ADMIN',endpoint:'/test'},true)).rejects.toMatchObject({status:400,code:'PHARMACY_EXCLUDED'});
    });
    test('lifecycle is scoped to the current Pharmacy and cannot silently skip', async () => {
        const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner); spyOn(pharmacyService,'requireOperational').mockResolvedValue({_id:pharmacyA} as any); quiet(); const update=spyOn(TreatmentRequest,'findOneAndUpdate');
        await expect(service.transition(userA,requestId,S.CONFIRMED,S.READY_FOR_DELIVERY,actor)).rejects.toMatchObject({status:409,code:'INVALID_STATE_TRANSITION'}); expect(update).not.toHaveBeenCalled();
    });
    test('fulfillment refuses malformed confirmed data without an accepted quotation', async () => {
        const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner),current=request(S.CONFIRMED,pharmacyA,6,3);spyOn(pharmacyService,'requireOperational').mockResolvedValue({_id:pharmacyA} as any);spyOn(TreatmentRequest,'findOne').mockReturnValue(query(current) as never);const update=spyOn(TreatmentRequest,'findOneAndUpdate');quiet();
        await expect(service.transition(userA,requestId,S.CONFIRMED,S.PREPARING,actor)).rejects.toMatchObject({status:409,code:'ACCEPTED_QUOTATION_REQUIRED'});expect(update).not.toHaveBeenCalled();
    });
});

describe('Pharmacy account and privacy boundaries', () => {
    test('request creation ActivityLog excludes prescription and delivery contents', async () => {
        const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner),created={...request(S.OPEN,null,0,0),prescription_images:['private-key'],treatment_details:'sensitive treatment',delivery_address:{address_text:'private address',lat:33,lng:44},delivery_phone:'07700000000',notes:'private note'} as any;
        spyOn(Counter,'findOneAndUpdate').mockReturnValue(query({sequence:1}) as never);spyOn(TreatmentRequest,'create').mockResolvedValue([created] as never);spyOn(TreatmentRequest,'findOne').mockReturnValue(query(created) as never);spyOn(History,'create').mockResolvedValue({} as never);const audit=spyOn(ActivityLogService,'logActivity').mockResolvedValue({} as never);
        await service.create(patientId,{prescription_images:['private-key'],treatment_details:'sensitive treatment',delivery_address:{address_text:'private address',lat:33,lng:44},delivery_phone:'07700000000',notes:'private note',preferred_payment_method:'cash_on_delivery'},{user_id:userA,type:'PATIENT',endpoint:'/test'});
        const entry=(audit.mock.calls[0] as any)[0];for(const target of [entry.new_data,entry.request_body])for(const key of ['prescription_images','treatment_details','delivery_address','delivery_phone','notes'])expect(target[key]).toBeUndefined();expect(entry.new_data.prescription_image_count).toBe(1);
    });
    test('inactive, suspended, and non-accepting profiles cannot operate', async () => {
        spyOn(User,'findOne').mockReturnValue(query({_id:new mongoose.Types.ObjectId(userA)}) as never);
        for (const profile of [{status:'inactive',accepts_prescription_requests:true},{status:'suspended',accepts_prescription_requests:true},{status:'active',accepts_prescription_requests:false}]) {
            const service=new PharmacyService(); spyOn(service,'getByUserId').mockResolvedValue(profile as any);
            await expect(service.requireOperational(userA)).rejects.toMatchObject({status:403});
        }
    });
    test('Admin account creation hashes the password and never logs or stores its raw value', async () => {
        const service=new PharmacyService(), pharmacy={_id:pharmacyA,user_id:new mongoose.Types.ObjectId(userA),name:'صيدلية',display_name:'صيدلية',phone:'07700000000',license_verified:false,address:{address_text:'بغداد'},accepts_prescription_requests:true,status:'active',toObject(){return this}} as any;
        spyOn(User,'findOne').mockReturnValue(query(null) as never); const createUser=spyOn(User,'create').mockResolvedValue({_id:new mongoose.Types.ObjectId(userA)} as never); spyOn(Pharmacy,'create').mockResolvedValue(pharmacy as never); const audit=spyOn(ActivityLogService,'logActivity').mockResolvedValue({} as never);
        await service.createAccount({name:'صيدلية',phone:'07700000000',password:'very-secret',address:{address_text:'بغداد'}},'507f191e810c19729de86109');
        const userInput=(createUser.mock.calls[0] as any)[0]; expect(userInput.role).toBe('pharmacy'); expect(userInput.password_hash).not.toContain('very-secret'); expect(userInput.password_show).toBe('[redacted]');
        expect((audit.mock.calls[0] as any)[0].request_body.password).toBeUndefined();
    });
    test('available formatter withholds prescription URLs while the owner formatter includes them', () => {
        const value={...request(S.OPEN,null,0,0),child_id:null,prescription_images:['private-r2-key'],treatment_details:'دواء',delivery_address:{address_text:'بغداد',lat:33,lng:44},delivery_phone:'07700000000',notes:null,preferred_payment_method:'cash_on_delivery',createdAt:new Date(),updatedAt:new Date(),cancelled_at:null} as any;
        const available=formatPharmacyRequestForAvailable(value), patient=formatPharmacyRequestForPatient(value);
        expect(available.has_prescription_images).toBe(true); expect('prescription_images' in available).toBe(false); expect(patient.prescription_images).toEqual(['private-r2-key']); expect('notes_internal' in patient).toBe(false);
    });
    test('creation rejects empty content before persistence', async () => {
        const service=new PharmacyTreatmentRequestService(directPharmacyTransactionRunner); const create=spyOn(TreatmentRequest,'create');
        await expect(service.create(patientId,{prescription_images:[],treatment_details:' ',delivery_address:{address_text:'بغداد',lat:33,lng:44},delivery_phone:'07700000000',preferred_payment_method:'cash_on_delivery'},{user_id:userA,type:'PATIENT',endpoint:'/test'})).rejects.toMatchObject({status:422}); expect(create).not.toHaveBeenCalled();
    });
});
