import mongoose, { model, models, Schema } from 'mongoose';
import { PharmacyDispatchModeEnum, PharmacyDispatchStatusEnum, PharmacyPaymentMethodEnum, PharmacyRequestStatusEnum, type IPharmacyTreatmentRequest } from '../interfaces/pharmacy-treatment-request.interface';

export type PharmacyTreatmentRequestDocument = mongoose.Document & IPharmacyTreatmentRequest;
const quotationItemSchema = new Schema({
    name:{type:String,required:true,trim:true,maxlength:200}, quantity:{type:Number,required:true,min:1},
    unit_price:{type:Number,required:true,min:0}, line_total:{type:Number,required:true,min:0}, note:{type:String,trim:true,maxlength:500,default:null},
}, {_id:false});
const unavailableItemSchema = new Schema({ name:{type:String,required:true,trim:true,maxlength:200}, note:{type:String,trim:true,maxlength:500,default:null} }, {_id:false});
const quotationFields = {
    version:{type:Number,required:true,min:1}, pharmacy_id:{type:Schema.Types.ObjectId,ref:'Pharmacy',required:true},
    items:{type:[quotationItemSchema],required:true}, unavailable_items:{type:[unavailableItemSchema],default:[]},
    medicines_subtotal:{type:Number,required:true,min:0}, delivery_fee:{type:Number,required:true,min:0}, discount:{type:Number,required:true,min:0}, total_price:{type:Number,required:true,min:0},
    pharmacy_note:{type:String,trim:true,maxlength:2000,default:null}, quoted_at:{type:Date,required:true}, accepted_at:{type:Date,default:null},
};
const quotationSchema = new Schema(quotationFields, {_id:false});
const acceptedQuotationSchema = new Schema({...quotationFields, accepted_at:{type:Date,required:true}}, {_id:false});
const schema = new Schema({
    request_number:{type:String,required:true,unique:true,trim:true}, patient_id:{type:Schema.Types.ObjectId,ref:'Patient',required:true}, child_id:{type:Schema.Types.ObjectId,ref:'PatientChild',default:null},
    prescription_images:[{type:String,trim:true,maxlength:1000}], treatment_details:{type:String,trim:true,maxlength:3000,default:null},
    delivery_address:{address_text:{type:String,required:true,trim:true,minlength:5,maxlength:500},lat:{type:Number,required:true,min:-90,max:90},lng:{type:Number,required:true,min:-180,max:180},_id:false},
    delivery_phone:{type:String,required:true,trim:true,minlength:7,maxlength:30}, notes:{type:String,trim:true,maxlength:2000,default:null},
    preferred_payment_method:{type:String,enum:Object.values(PharmacyPaymentMethodEnum),required:true}, status:{type:String,enum:Object.values(PharmacyRequestStatusEnum),default:PharmacyRequestStatusEnum.OPEN},
    workflowVersion:{type:Number,required:true,min:0,default:0},
    dispatch:{status:{type:String,enum:Object.values(PharmacyDispatchStatusEnum),default:PharmacyDispatchStatusEnum.OPEN},mode:{type:String,enum:Object.values(PharmacyDispatchModeEnum),default:PharmacyDispatchModeEnum.OPEN_POOL},pharmacy_id:{type:Schema.Types.ObjectId,ref:'Pharmacy',default:null},assigned_at:{type:Date,default:null},assigned_by_user_id:{type:Schema.Types.ObjectId,ref:'User',default:null},version:{type:Number,min:0,default:0},_id:false},
    quotation:{type:quotationSchema,default:null}, accepted_quotation:{type:acceptedQuotationSchema,default:null},
    excluded_pharmacy_ids:[{type:Schema.Types.ObjectId,ref:'Pharmacy'}], cancelled_at:{type:Date,default:null},
    cancelled_by_user_id:{type:Schema.Types.ObjectId,ref:'User',default:null}, cancellation_actor_type:{type:String,enum:['PATIENT','ADMIN',null],default:null}, cancellation_reason:{type:String,trim:true,maxlength:1000,default:null},
}, {timestamps:true,versionKey:false,collection:'pharmacy_treatment_requests'});
schema.index({patient_id:1,createdAt:-1});
schema.index({'dispatch.status':1,status:1,createdAt:1});
schema.index({'dispatch.pharmacy_id':1,status:1,createdAt:-1});
schema.index({status:1,createdAt:-1});
export default (models.PharmacyTreatmentRequest as mongoose.Model<PharmacyTreatmentRequestDocument>) || model<PharmacyTreatmentRequestDocument>('PharmacyTreatmentRequest',schema);
