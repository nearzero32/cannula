import mongoose,{type ClientSession} from 'mongoose';
import Notification from '../models/notifications.model';
import NotificationRecipient from '../models/notification-recipient.model';
import notificationDeliveryService from './notification-delivery.service';
import {INotificationAudienceEnum,INotificationRecipientModelEnum,INotificationStatusEnum,type INotification} from '../interfaces/notification.interface';

type Input={userIds:readonly (mongoose.Types.ObjectId|string)[];dedupeKey:string;session?:ClientSession;payload:Partial<INotification>};
class DomainNotificationService { async targeted({userIds,dedupeKey,session,payload}:Input){const ids=[...new Set(userIds.map(String))].map(id=>new mongoose.Types.ObjectId(id));if(!ids.length)return null;try{const created=await Notification.create([{...payload,audience:INotificationAudienceEnum.TARGETED,recipient_ids:[],recipient_model:INotificationRecipientModelEnum.USER,dedupe_key:dedupeKey,status:INotificationStatusEnum.PENDING,is_read:false,visible_at:payload.visible_at??new Date(),expires_at:payload.expires_at??new Date(Date.now()+7776000000)}],session?{session}:undefined);const notification=created[0]!;await NotificationRecipient.insertMany(ids.map(user_id=>({notification_id:notification._id,user_id,expires_at:notification.expires_at})),session?{session,ordered:true}:{ordered:true});await notificationDeliveryService.enqueueForNotification(notification,session);return notification;}catch(error:any){if(error?.code!==11000)throw error;return Notification.findOne({dedupe_key:dedupeKey}).session(session??null).exec();}}}
export default new DomainNotificationService();
