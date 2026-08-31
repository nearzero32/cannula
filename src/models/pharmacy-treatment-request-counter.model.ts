import mongoose,{model,models,Schema} from 'mongoose'; const schema=new Schema({_id:{type:String},sequence:{type:Number,default:0}},{versionKey:false});
export default (models.PharmacyTreatmentRequestCounter as mongoose.Model<{_id:string;sequence:number}>)||model('PharmacyTreatmentRequestCounter',schema);
