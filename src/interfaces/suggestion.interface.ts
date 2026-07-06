import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export interface ISuggestion extends IBaseDocument {
    user_id: mongoose.Types.ObjectId;
    suggestion: string;
    is_deleted: boolean;
    deleted_at?: Date | null;
    deleted_by?: mongoose.Types.ObjectId | null;
}
