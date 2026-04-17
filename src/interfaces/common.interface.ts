import type mongoose from 'mongoose';

export interface ITimestamps {
    createdAt: Date;
    updatedAt: Date;
}

export interface IBaseDocument extends ITimestamps {
    _id: string;
}

export interface IWithNotesInternal {
    notesInternal?: string | null;
}

export interface IWithCreatedBy {
    createdBy?: mongoose.Types.ObjectId | null;
}
