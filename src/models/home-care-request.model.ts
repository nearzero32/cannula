import mongoose, { model, models, Schema } from 'mongoose';
import {
    IHomeCareRequestCancelledByTypeEnum,
    IHomeCareDispatchModeEnum,
    IHomeCareDispatchStatusEnum,
    IHomeCareRequestStatusEnum,
    type IHomeCareRequest,
} from '../interfaces/home-care-request.interface';

export type HomeCareRequestDocument = mongoose.Document & IHomeCareRequest;

const homeCareRequestSchema = new Schema(
    {
        request_number: { type: String, required: true, unique: true, trim: true },
        patient_id: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
        child_id: { type: Schema.Types.ObjectId, ref: 'PatientChild', default: null },
        category_id: { type: Schema.Types.ObjectId, ref: 'HomeCareCategory', required: true },
        service_id: { type: Schema.Types.ObjectId, ref: 'HomeCareService', required: true },
        service_name: { type: String, required: true, trim: true, maxlength: 160 },
        service_price: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
        service_duration_min: { type: Number, min: 0, default: null },
        service_duration_max: { type: Number, min: 0, default: null },
        requested_date: { type: Date, required: true },
        preferred_time: {
            type: String,
            required: true,
            match: /^([01]\d|2[0-3]):[0-5]\d$/,
        },
        address: {
            address_text: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
            lat: { type: Number, required: true, min: -90, max: 90 },
            lng: { type: Number, required: true, min: -180, max: 180 },
        },
        notes: { type: String, trim: true, maxlength: 2000, default: null },
        status: {
            type: String,
            enum: Object.values(IHomeCareRequestStatusEnum),
            default: IHomeCareRequestStatusEnum.PENDING,
        },
        dispatch: {
            status: { type: String, enum: Object.values(IHomeCareDispatchStatusEnum), default: IHomeCareDispatchStatusEnum.OPEN },
            mode: { type: String, enum: Object.values(IHomeCareDispatchModeEnum), default: IHomeCareDispatchModeEnum.OPEN_POOL },
            nurse_id: { type: Schema.Types.ObjectId, ref: 'Nurse', default: null },
            assigned_at: { type: Date, default: null },
            assigned_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            version: { type: Number, min: 0, default: 0 },
            _id: false,
        },
        internal_notes: { type: String, trim: true, maxlength: 3000, default: null },
        cancelled_at: { type: Date, default: null },
        cancelled_by: {
            id: { type: Schema.Types.ObjectId, default: null },
            type: {
                type: String,
                enum: Object.values(IHomeCareRequestCancelledByTypeEnum),
                default: null,
            },
            _id: false,
        },
        cancellation_reason: { type: String, trim: true, maxlength: 1000, default: null },
    },
    { timestamps: true, versionKey: false, collection: 'home_care_requests' }
);

homeCareRequestSchema.index({ patient_id: 1, createdAt: -1 });
homeCareRequestSchema.index({ status: 1, createdAt: -1 });
homeCareRequestSchema.index({ requested_date: 1, status: 1 });
homeCareRequestSchema.index({ service_id: 1, createdAt: -1 });
homeCareRequestSchema.index({ category_id: 1, createdAt: -1 });
homeCareRequestSchema.index({ 'dispatch.status': 1, status: 1, service_id: 1, requested_date: 1 });
homeCareRequestSchema.index({ 'dispatch.nurse_id': 1, status: 1, requested_date: -1 });

const HomeCareRequest =
    (models.HomeCareRequest as mongoose.Model<HomeCareRequestDocument>) ||
    model<HomeCareRequestDocument>('HomeCareRequest', homeCareRequestSchema);

export default HomeCareRequest;
