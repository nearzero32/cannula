import type mongoose from 'mongoose';
import type { IBaseDocument } from './common.interface';

export interface ISuggestion extends IBaseDocument {
    user_id: mongoose.Types.ObjectId;
    suggestion: string;
}
