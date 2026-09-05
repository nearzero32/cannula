import type mongoose from 'mongoose';
export const INotificationDeliveryChannelEnum={PUSH:'push'} as const;
export const INotificationDeliveryRecipientTypeEnum={USER:'user',PUBLIC_BROADCAST:'public_broadcast'} as const;
export const INotificationDeliveryStatusEnum={PENDING:'pending',PROCESSING:'processing',DELIVERED:'delivered',FAILED:'failed',DEAD:'dead',CANCELLED:'cancelled'} as const;
export interface INotificationDelivery {notification_id:mongoose.Types.ObjectId;channel:'push';recipient_type:'user'|'public_broadcast';user_id:mongoose.Types.ObjectId|null;status:'pending'|'processing'|'delivered'|'failed'|'dead'|'cancelled';attempt_count:number;next_attempt_at:Date;last_attempt_at:Date|null;processing_started_at:Date|null;lease_expires_at:Date|null;claim_token:string|null;delivered_at:Date|null;provider:'onesignal';provider_message_id:string|null;last_error_code:string|null;last_error_message:string|null}
