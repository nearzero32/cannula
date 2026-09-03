import { TokenAudienceEnum, type TokenAudience } from './jwt';
import { IAdminPermissionEnum, type IAdminPermission } from '../interfaces/admin.interface';
import { IUserRoleEnum, type IUserRole } from '../interfaces/user.interface';
import type { AllowedImageContentType } from './r2.config';

export const UploadPurposeEnum = {
    PATIENT_PROFILE_PHOTO: 'PATIENT_PROFILE_PHOTO', PATIENT_CHILD_PHOTO: 'PATIENT_CHILD_PHOTO', PRESCRIPTION_IMAGE: 'PRESCRIPTION_IMAGE',
    DOCTOR_PROFILE_PHOTO: 'DOCTOR_PROFILE_PHOTO', NURSE_PROFILE_PHOTO: 'NURSE_PROFILE_PHOTO', PHARMACY_LOGO: 'PHARMACY_LOGO',
    CLINIC_ICON: 'CLINIC_ICON', SPECIALTY_ICON: 'SPECIALTY_ICON', AD_IMAGE: 'AD_IMAGE', ABOUT_US_LOGO: 'ABOUT_US_LOGO',
    HOME_CARE_CATEGORY_ICON: 'HOME_CARE_CATEGORY_ICON', HOME_CARE_CATEGORY_IMAGE: 'HOME_CARE_CATEGORY_IMAGE', HOME_CARE_SERVICE_IMAGE: 'HOME_CARE_SERVICE_IMAGE',
} as const;
export type UploadPurpose = (typeof UploadPurposeEnum)[keyof typeof UploadPurposeEnum];
export type MediaTargetType = 'PATIENT'|'PATIENT_CHILD'|'DOCTOR'|'NURSE'|'PHARMACY'|'CLINIC'|'SPECIALTY'|'AD'|'ABOUT_US'|'HOME_CARE_CATEGORY'|'HOME_CARE_SERVICE';
export type MediaVisibility = 'PUBLIC'|'PRIVATE';
export interface UploadPolicy { purpose:UploadPurpose; prefix:string; roles:readonly IUserRole[]; audience:TokenAudience|'EITHER'; contentTypes:readonly AllowedImageContentType[]; maxBytes:number; targetType:MediaTargetType; targetRequired:boolean; adminPermission?:IAdminPermission; visibility:MediaVisibility }
const images = ['image/jpeg','image/png','image/webp'] as const, patient=[IUserRoleEnum.PATIENT] as const, admin=[IUserRoleEnum.ADMIN] as const, MB=1024*1024;
export const UPLOAD_POLICIES: Record<UploadPurpose, UploadPolicy> = {
    PATIENT_PROFILE_PHOTO:{purpose:'PATIENT_PROFILE_PHOTO',prefix:'patients/profile',roles:[IUserRoleEnum.PATIENT,IUserRoleEnum.ADMIN],audience:'EITHER',contentTypes:images,maxBytes:5*MB,targetType:'PATIENT',targetRequired:true,adminPermission:IAdminPermissionEnum.MANAGE_PATIENTS,visibility:'PUBLIC'},
    PATIENT_CHILD_PHOTO:{purpose:'PATIENT_CHILD_PHOTO',prefix:'patients/children',roles:patient,audience:TokenAudienceEnum.MOBILE,contentTypes:images,maxBytes:5*MB,targetType:'PATIENT_CHILD',targetRequired:true,visibility:'PUBLIC'},
    PRESCRIPTION_IMAGE:{purpose:'PRESCRIPTION_IMAGE',prefix:'prescriptions',roles:patient,audience:TokenAudienceEnum.MOBILE,contentTypes:images,maxBytes:8*MB,targetType:'PATIENT',targetRequired:true,visibility:'PRIVATE'},
    DOCTOR_PROFILE_PHOTO:{purpose:'DOCTOR_PROFILE_PHOTO',prefix:'doctors/profile',roles:[IUserRoleEnum.DOCTOR,IUserRoleEnum.ADMIN],audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:5*MB,targetType:'DOCTOR',targetRequired:true,adminPermission:IAdminPermissionEnum.MANAGE_DOCTORS,visibility:'PUBLIC'},
    NURSE_PROFILE_PHOTO:{purpose:'NURSE_PROFILE_PHOTO',prefix:'nurses/profile',roles:admin,audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:5*MB,targetType:'NURSE',targetRequired:true,adminPermission:IAdminPermissionEnum.MANAGE_USERS,visibility:'PUBLIC'},
    PHARMACY_LOGO:{purpose:'PHARMACY_LOGO',prefix:'pharmacies/logo',roles:admin,audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:5*MB,targetType:'PHARMACY',targetRequired:true,adminPermission:IAdminPermissionEnum.MANAGE_USERS,visibility:'PUBLIC'},
    CLINIC_ICON:{purpose:'CLINIC_ICON',prefix:'clinics/icon',roles:admin,audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:3*MB,targetType:'CLINIC',targetRequired:false,adminPermission:IAdminPermissionEnum.MANAGE_CLINICS,visibility:'PUBLIC'},
    SPECIALTY_ICON:{purpose:'SPECIALTY_ICON',prefix:'specialties/icon',roles:admin,audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:3*MB,targetType:'SPECIALTY',targetRequired:false,adminPermission:IAdminPermissionEnum.MANAGE_SPECIALTIES,visibility:'PUBLIC'},
    AD_IMAGE:{purpose:'AD_IMAGE',prefix:'ads',roles:admin,audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:8*MB,targetType:'AD',targetRequired:false,adminPermission:IAdminPermissionEnum.MANAGE_SETTINGS,visibility:'PUBLIC'},
    ABOUT_US_LOGO:{purpose:'ABOUT_US_LOGO',prefix:'about-us/logo',roles:admin,audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:3*MB,targetType:'ABOUT_US',targetRequired:false,adminPermission:IAdminPermissionEnum.MANAGE_SETTINGS,visibility:'PUBLIC'},
    HOME_CARE_CATEGORY_ICON:{purpose:'HOME_CARE_CATEGORY_ICON',prefix:'home-care/categories/icon',roles:admin,audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:3*MB,targetType:'HOME_CARE_CATEGORY',targetRequired:false,adminPermission:IAdminPermissionEnum.MANAGE_HOME_CARE,visibility:'PUBLIC'},
    HOME_CARE_CATEGORY_IMAGE:{purpose:'HOME_CARE_CATEGORY_IMAGE',prefix:'home-care/categories/image',roles:admin,audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:5*MB,targetType:'HOME_CARE_CATEGORY',targetRequired:false,adminPermission:IAdminPermissionEnum.MANAGE_HOME_CARE,visibility:'PUBLIC'},
    HOME_CARE_SERVICE_IMAGE:{purpose:'HOME_CARE_SERVICE_IMAGE',prefix:'home-care/services/image',roles:admin,audience:TokenAudienceEnum.DASHBOARD,contentTypes:images,maxBytes:5*MB,targetType:'HOME_CARE_SERVICE',targetRequired:false,adminPermission:IAdminPermissionEnum.MANAGE_HOME_CARE,visibility:'PUBLIC'},
};
export function isUploadPurpose(value:string):value is UploadPurpose{return Object.prototype.hasOwnProperty.call(UPLOAD_POLICIES,value)}
