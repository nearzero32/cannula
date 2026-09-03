import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { extensionForContentType, getR2Config, isAllowedImageContentType, type AllowedImageContentType } from '../constants/r2.config';
import { UPLOAD_POLICIES, isUploadPurpose, type MediaTargetType, type UploadPurpose } from '../constants/upload-policy';
import { IUserRoleEnum, type IUserRole } from '../interfaces/user.interface';
import { MediaAssetStatusEnum } from '../interfaces/media-asset.interface';
import MediaAsset, { type MediaAssetDocument } from '../models/media-asset.model';
import Patient from '../models/patients.model'; import PatientChild from '../models/patient-child.model'; import Doctor from '../models/doctors.model'; import Nurse from '../models/nurse.model'; import Pharmacy from '../models/pharmacy.model'; import Clinic from '../models/clinics.model'; import Specialty from '../models/specialties.model'; import Ads from '../models/ads.model'; import AboutUs from '../models/about-us.model'; import HomeCareCategory from '../models/home-care-category.model'; import HomeCareService from '../models/home-care-service.model';
import { requireAdminPermission } from './admin-auth-permission.service';
import { IAdminPermissionEnum } from '../interfaces/admin.interface';
import { DomainError } from './domain-error';
import storageService, { inspectImage } from './storage.service';
import ActivityLogService from './activity-log.service';
import { IActivityLogActionEnum, IActivityLogSourceEnum } from '../interfaces/activity-log.interface';
import type { TokenAudience } from '../constants/jwt';
import PharmacyTreatmentRequest from '../models/pharmacy-treatment-request.model';
import securityRateLimitService from './security-rate-limit.service';

export interface UploadActor { userId:string; role:IUserRole; audience:TokenAudience }
const models:Record<MediaTargetType,any>={PATIENT:Patient,PATIENT_CHILD:PatientChild,DOCTOR:Doctor,NURSE:Nurse,PHARMACY:Pharmacy,CLINIC:Clinic,SPECIALTY:Specialty,AD:Ads,ABOUT_US:AboutUs,HOME_CARE_CATEGORY:HomeCareCategory,HOME_CARE_SERVICE:HomeCareService};
function objectId(value:string, code='UPLOAD_TARGET_NOT_FOUND'){if(!mongoose.Types.ObjectId.isValid(value))throw new DomainError('مورد الوسائط غير موجود',404,code);return new mongoose.Types.ObjectId(value)}
function safeReason(error:unknown){return error instanceof DomainError?error.code??'UPLOAD_VALIDATION_FAILED':'UPLOAD_VALIDATION_FAILED'}

class UploadPolicyService {
    private async audit(asset:MediaAssetDocument,event:string,reason?:string){try{await ActivityLogService.logActivity({user_id:asset.owner_user_id,user_name:`${asset.owner_role}_${asset.owner_user_id}`,user_type:asset.owner_role,method:'POST',endpoint:'/upload/intents',action:IActivityLogActionEnum.OTHER,collection_name:'media_assets',document_id:asset._id,new_data:{event,uploadId:asset.upload_id,purpose:asset.purpose,targetType:asset.target_type,targetId:asset.target_id??null,objectKey:asset.object_key,contentType:asset.expected_content_type,size:asset.actual_bytes??null,reason},request_body:{},source:asset.owner_role===IUserRoleEnum.PATIENT?IActivityLogSourceEnum.MOBILE:IActivityLogSourceEnum.DASHBOARD})}catch(error){console.error('[WARN] Upload audit write failed',error instanceof Error?error.name:'unknown')}}
    private async authorize(purpose:UploadPurpose,actor:UploadActor,targetId?:string){
        const policy=UPLOAD_POLICIES[purpose];
        if(!policy.roles.includes(actor.role)|| (policy.audience!=='EITHER'&&policy.audience!==actor.audience))throw new DomainError('غرض الرفع غير مسموح',403,'UPLOAD_PURPOSE_FORBIDDEN');
        if(actor.role===IUserRoleEnum.ADMIN){if(!policy.adminPermission)throw new DomainError('غرض الرفع غير مسموح',403,'UPLOAD_PURPOSE_FORBIDDEN');await requireAdminPermission(actor.role,actor.userId,policy.adminPermission)}
        if(policy.targetRequired&&!targetId)throw new DomainError('معرف مورد الوسائط مطلوب',422,'UPLOAD_TARGET_NOT_FOUND');
        let target:any=null;if(targetId){target=await models[policy.targetType].findById(objectId(targetId)).lean().exec();if(!target)throw new DomainError('مورد الوسائط غير موجود',404,'UPLOAD_TARGET_NOT_FOUND')}
        if(actor.role===IUserRoleEnum.PATIENT){const patient=await Patient.findOne({user_id:actor.userId}).select('_id').lean().exec();if(!patient)throw new DomainError('ملف المريض غير موجود',404,'UPLOAD_TARGET_NOT_FOUND');if(policy.targetType==='PATIENT'&&String(patient._id)!==targetId)throw new DomainError('لا تملك مورد الوسائط',403,'UPLOAD_TARGET_NOT_OWNED');if(policy.targetType==='PATIENT_CHILD'&&String(target?.patient_id)!==String(patient._id))throw new DomainError('لا تملك مورد الوسائط',403,'UPLOAD_TARGET_NOT_OWNED')}
        if(actor.role===IUserRoleEnum.DOCTOR){const doctor=await Doctor.findOne({user_id:actor.userId}).select('_id').lean().exec();if(!doctor||String(doctor._id)!==targetId)throw new DomainError('لا تملك مورد الوسائط',403,'UPLOAD_TARGET_NOT_OWNED')}
        return policy;
    }
    public async initiate(input:{purpose:string;targetId?:string;contentType:string},actor:UploadActor){
        if(!isUploadPurpose(input.purpose))throw new DomainError('غرض الرفع غير صالح',422,'UPLOAD_PURPOSE_FORBIDDEN');
        if(!isAllowedImageContentType(input.contentType))throw new DomainError('نوع الملف غير مدعوم',422,'UPLOAD_CONTENT_TYPE_UNSUPPORTED');
        const policy=await this.authorize(input.purpose,actor,input.targetId);if(!policy.contentTypes.includes(input.contentType))throw new DomainError('نوع الملف غير مدعوم لهذا الغرض',422,'UPLOAD_CONTENT_TYPE_UNSUPPORTED');
        let config;try{config=getR2Config()}catch{throw new DomainError('خدمة التخزين غير مهيأة',503,'STORAGE_UNAVAILABLE')}if(!config)throw new DomainError('خدمة التخزين غير مهيأة',503,'STORAGE_UNAVAILABLE');
        await securityRateLimitService.enforce('UPLOAD_USER',actor.userId,'UPLOAD_RATE_LIMITED');
        const pending=await MediaAsset.countDocuments({owner_user_id:actor.userId,status:{$in:[MediaAssetStatusEnum.PENDING,MediaAssetStatusEnum.VALIDATING]}});
        if(pending>=5)throw new DomainError('تم تجاوز حد طلبات الرفع',429,'UPLOAD_RATE_LIMITED');
        const uploadId=randomUUID(),ext=extensionForContentType(input.contentType),opaque=randomUUID();
        const maxBytes=Math.min(policy.maxBytes,config.maxUploadBytes),pendingKey=`pending/${uploadId}.${ext}`,objectKey=`${policy.visibility.toLowerCase()}/${policy.prefix}/${opaque}.${ext}`;
        const expiresAt=new Date(Date.now()+config.presignExpiresIn*1000);
        const asset=await MediaAsset.create({upload_id:uploadId,purpose:policy.purpose,owner_user_id:objectId(actor.userId),owner_role:actor.role,target_type:policy.targetType,target_id:input.targetId?objectId(input.targetId):null,pending_key:pendingKey,object_key:objectKey,expected_content_type:input.contentType,max_bytes:maxBytes,visibility:policy.visibility,status:MediaAssetStatusEnum.PENDING,pending_expires_at:expiresAt});
        try{const signed=await storageService.createPresignedPut(pendingKey,input.contentType);await this.audit(asset,'UPLOAD_INTENT_CREATED');return{uploadId,uploadUrl:signed.uploadUrl,expiresAt:expiresAt.toISOString(),expectedContentType:input.contentType,maxUploadBytes:maxBytes}}
        catch(error){await MediaAsset.deleteOne({_id:asset._id});throw error}
    }
    private response(asset:MediaAssetDocument){return{assetId:asset.upload_id,purpose:asset.purpose,contentType:asset.expected_content_type,size:asset.actual_bytes,visibility:asset.visibility,url:asset.visibility==='PUBLIC'?asset.public_url:null,reference:asset.visibility==='PUBLIC'?asset.public_url:asset.upload_id}}
    public async complete(uploadId:string,actor:UploadActor){
        let asset=await MediaAsset.findOne({upload_id:uploadId}).exec() as MediaAssetDocument|null;if(!asset)throw new DomainError('طلب الرفع غير موجود',404,'UPLOAD_NOT_FOUND');
        if(String(asset.owner_user_id)!==actor.userId||asset.owner_role!==actor.role)throw new DomainError('لا تملك طلب الرفع',403,'UPLOAD_TARGET_NOT_OWNED');
        if(asset.status===MediaAssetStatusEnum.READY)return this.response(asset);if(asset.status===MediaAssetStatusEnum.REJECTED)throw new DomainError('تم رفض طلب الرفع',409,'UPLOAD_ALREADY_REJECTED');
        if(!asset.pending_expires_at||asset.pending_expires_at.getTime()<=Date.now())throw new DomainError('انتهت صلاحية طلب الرفع',409,'UPLOAD_EXPIRED');
        await this.authorize(asset.purpose,actor,asset.target_id?String(asset.target_id):undefined);
        const claimed=await MediaAsset.findOneAndUpdate({_id:asset._id,status:MediaAssetStatusEnum.PENDING},{$set:{status:MediaAssetStatusEnum.VALIDATING}},{returnDocument:'after'}).exec() as MediaAssetDocument|null;
        if(!claimed)throw new DomainError('طلب الرفع قيد التحقق',409,'UPLOAD_VALIDATION_IN_PROGRESS');asset=claimed;
        try{
            const head=await storageService.headObject(asset.pending_key);if(!head)throw new DomainError('الملف المرفوع غير موجود',404,'UPLOAD_OBJECT_MISSING');
            if(head.contentLength<1||head.contentLength>asset.max_bytes)throw new DomainError('حجم الملف المرفوع غير صالح',422,'UPLOAD_TOO_LARGE');
            if(head.contentType!==asset.expected_content_type)throw new DomainError('نوع الملف الفعلي غير مطابق',422,'UPLOAD_CONTENT_MISMATCH');
            const dimensions=inspectImage(await storageService.readObjectPrefix(asset.pending_key),head.contentType);if(!dimensions)throw new DomainError('محتوى الصورة غير صالح',422,'UPLOAD_CONTENT_MISMATCH');
            await storageService.promoteObject(asset.pending_key,asset.object_key,asset.expected_content_type);const publicUrl=asset.visibility==='PUBLIC'?storageService.buildPublicUrl(asset.object_key):null;
            const completed=await MediaAsset.findByIdAndUpdate(asset._id,{$set:{status:MediaAssetStatusEnum.READY,actual_bytes:head.contentLength,public_url:publicUrl},$unset:{pending_expires_at:1}},{returnDocument:'after'}).exec() as MediaAssetDocument|null;
            if(!completed)throw new DomainError('فشل تثبيت الوسائط',503,'STORAGE_UNAVAILABLE');await this.audit(completed,'UPLOAD_COMPLETED');return this.response(completed);
        }catch(error){try{await storageService.deleteObject(asset.pending_key)}catch{console.error('[WARN] Rejected upload cleanup failed',{uploadId:asset.upload_id})}await MediaAsset.updateOne({_id:asset._id},{$set:{status:MediaAssetStatusEnum.REJECTED,rejection_reason:safeReason(error)},$unset:{pending_expires_at:1}});await this.audit(asset,'UPLOAD_REJECTED',safeReason(error));throw error instanceof DomainError?error:new DomainError('فشل التحقق من الملف',422,'UPLOAD_VALIDATION_FAILED')}
    }
    public async requireReadyReference(reference:string|null|undefined,purpose:UploadPurpose,targetType:MediaTargetType,targetId:string){
        if(reference==null)return null;const asset=await MediaAsset.findOne({$or:[{upload_id:reference},{public_url:reference}]}).exec();if(!asset||asset.status!==MediaAssetStatusEnum.READY)throw new DomainError('مرجع الوسائط غير مكتمل',422,'UPLOAD_NOT_READY');
        if(asset.purpose!==purpose||asset.target_type!==targetType)throw new DomainError('غرض الوسائط غير متوافق',422,'UPLOAD_PURPOSE_MISMATCH');
        if(asset.target_id&&String(asset.target_id)!==targetId)throw new DomainError('الوسائط مرتبطة بمورد آخر',403,'UPLOAD_TARGET_NOT_OWNED');
        if(asset.attached_target_id&&String(asset.attached_target_id)!==targetId)throw new DomainError('الوسائط مستخدمة لمورد آخر',409,'UPLOAD_ALREADY_ATTACHED');return asset;
    }
    public async markAttached(asset:MediaAssetDocument|null,targetId:string,field:string){if(asset)await MediaAsset.updateOne({_id:asset._id},{$set:{target_id:objectId(targetId),attached_target_id:objectId(targetId),attached_field:field}})}
    public async finalizeReplacement(asset:MediaAssetDocument|null,oldReference:string|null|undefined,targetId:string,field:string){
        await this.markAttached(asset,targetId,field);if(!oldReference||oldReference===asset?.public_url||oldReference===asset?.upload_id)return;
        const old=await MediaAsset.findOne({$or:[{upload_id:oldReference},{public_url:oldReference}],status:MediaAssetStatusEnum.READY,attached_target_id:objectId(targetId)}).exec();if(!old)return;
        try{await storageService.deleteObject(old.object_key);old.status=MediaAssetStatusEnum.DELETED;await old.save();await this.audit(old,'UPLOAD_DELETED')}catch{console.error('[WARN] Replaced upload cleanup failed',{uploadId:old.upload_id})}
    }
    public async privateAccess(uploadId:string,actor:UploadActor){const asset=await MediaAsset.findOne({upload_id:uploadId,status:MediaAssetStatusEnum.READY}).exec();if(!asset)throw new DomainError('الوسائط غير موجودة',404,'UPLOAD_NOT_FOUND');if(asset.visibility!=='PRIVATE')return{url:asset.public_url,expiresIn:null};
        let allowed=String(asset.owner_user_id)===actor.userId;
        if(actor.role===IUserRoleEnum.ADMIN){await requireAdminPermission(actor.role,actor.userId,IAdminPermissionEnum.MANAGE_PHARMACY_REQUESTS);allowed=true}
        if(actor.role===IUserRoleEnum.PHARMACY&&asset.attached_target_id){const[p,request]=await Promise.all([Pharmacy.findOne({user_id:actor.userId}).select('_id').lean().exec(),PharmacyTreatmentRequest.findById(asset.attached_target_id).select('dispatch.pharmacy_id').lean().exec()]);allowed=Boolean(p&&request&&String(request.dispatch?.pharmacy_id)===String(p._id))}
        if(!allowed)throw new DomainError('غير مصرح بالوصول إلى الوسائط',403,'UPLOAD_TARGET_NOT_OWNED');return storageService.createPresignedGet(asset.object_key)}
}
export default new UploadPolicyService();
