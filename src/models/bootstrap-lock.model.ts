import { Schema, model, models } from 'mongoose';

const bootstrapLockSchema = new Schema(
    {
        _id: { type: String, required: true },
        created_at: { type: Date, required: true },
    },
    { versionKey: false, collection: 'security_bootstrap_locks' }
);

const BootstrapLock = models.BootstrapLock || model('BootstrapLock', bootstrapLockSchema);
export default BootstrapLock;
