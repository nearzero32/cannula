import mongoose, { Schema, model, models } from 'mongoose';
import type { ISuggestion } from '../interfaces/suggestion.interface';

export type SuggestionDocument = mongoose.Document & ISuggestion;

const suggestionSchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        suggestion: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000,
        },

        is_deleted: {
            type: Boolean,
            default: false,
        },

        deleted_at: {
            type: Date,
            default: null,
        },

        deleted_by: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

suggestionSchema.index({ user_id: 1, is_deleted: 1, createdAt: -1 });
suggestionSchema.index({ is_deleted: 1, createdAt: -1 });

export const Suggestion =
    (models.Suggestion as mongoose.Model<SuggestionDocument>) ||
    model<SuggestionDocument>('Suggestion', suggestionSchema);

export default Suggestion;
