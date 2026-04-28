import type mongoose from 'mongoose';

export interface ITimestamps {
    createdAt: Date;
    updatedAt: Date;
}

export interface IBaseDocument extends ITimestamps {
    _id: string;
}

export interface IWithNotesInternal {
    notes_internal?: string | null;
}

export interface IWithCreatedBy {
    created_by?: mongoose.Types.ObjectId | null;
}
