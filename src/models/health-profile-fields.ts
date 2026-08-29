import { Schema } from 'mongoose';
import { BloodTypeEnum } from '../interfaces/health-profile.interface';

export const MEDICAL_NOTES_MAX_LENGTH = 4000;

export const healthProfileFields = {
    blood_type: {
        type: String,
        enum: Object.values(BloodTypeEnum),
        default: null,
    },
    weight: {
        type: Number,
        min: 0.000001,
        default: null,
    },
    height: {
        type: Number,
        min: 0.000001,
        default: null,
    },
    allergies: {
        type: [String],
        default: [],
    },
    chronic_condition_ids: {
        type: [Schema.Types.ObjectId],
        ref: 'ChronicCondition',
        default: [],
    },
    current_medications: {
        type: [String],
        default: [],
    },
    medical_notes: {
        type: String,
        trim: true,
        maxlength: MEDICAL_NOTES_MAX_LENGTH,
        default: null,
    },
} as const;
