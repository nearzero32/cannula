import mongoose from 'mongoose';
import Notification from '../models/notifications.model';
import NotificationRecipient from '../models/notification-recipient.model';
import NotificationRead, { INotificationReaderTypeEnum } from '../models/notification-read.model';
import { INotificationAudienceEnum } from '../interfaces/notification.interface';
import { DomainError } from './domain-error';

export type NotificationAnalyticsSummary = { notification_id:string; audience:'public'|'targeted'; targeted_count:number|null; read_count:number; authenticated_reader_count:number; guest_installation_reader_count:number; unread_count:number|null; read_rate:number|null; first_read_at:Date|null; last_read_at:Date|null };
class NotificationAnalyticsService {
  async getSummary(notificationId:string):Promise<NotificationAnalyticsSummary>{
    if(!mongoose.Types.ObjectId.isValid(notificationId)) throw new DomainError('معرف الإشعار غير صالح',400);
    const id=new mongoose.Types.ObjectId(notificationId), notification=await Notification.findById(id).select('audience').lean().exec();
    if(!notification) throw new DomainError('الإشعار غير موجود',404);
    if(notification.audience===INotificationAudienceEnum.TARGETED){
      const [row]=await NotificationRecipient.aggregate([{ $match:{notification_id:id} },{$lookup:{from:NotificationRead.collection.name,let:{user:'$user_id'},pipeline:[{$match:{$expr:{$and:[{$eq:['$notification_id',id]},{$eq:['$reader_type',INotificationReaderTypeEnum.USER]},{$eq:['$user_id','$$user']}]}}},{$sort:{read_at:1,_id:1}},{$limit:1}],as:'read'}},{$group:{_id:null,targeted_count:{$sum:1},read_count:{$sum:{$cond:[{$gt:[{$size:'$read'},0]},1,0]}},first_read_at:{$min:{$arrayElemAt:['$read.read_at',0]}},last_read_at:{$max:{$arrayElemAt:['$read.read_at',0]}}}}]).exec();
      const targeted=row?.targeted_count??0, read=row?.read_count??0;
      return {notification_id:String(id),audience:'targeted',targeted_count:targeted,read_count:read,authenticated_reader_count:read,guest_installation_reader_count:0,unread_count:targeted-read,read_rate:targeted?Math.round(read/targeted*10000)/100:0,first_read_at:row?.first_read_at??null,last_read_at:row?.last_read_at??null};
    }
    const [row]=await NotificationRead.aggregate([{$match:{notification_id:id}},{$group:{_id:{type:'$reader_type',user:'$user_id',installation:'$installation_key_hash'},read_at:{$min:'$read_at'}}},{$group:{_id:null,authenticated_reader_count:{$sum:{$cond:[{$eq:['$_id.type',INotificationReaderTypeEnum.USER]},1,0]}},guest_installation_reader_count:{$sum:{$cond:[{$eq:['$_id.type',INotificationReaderTypeEnum.INSTALLATION]},1,0]}},first_read_at:{$min:'$read_at'},last_read_at:{$max:'$read_at'}}}]).exec();
    const users=row?.authenticated_reader_count??0, guests=row?.guest_installation_reader_count??0;
    return {notification_id:String(id),audience:'public',targeted_count:null,read_count:users+guests,authenticated_reader_count:users,guest_installation_reader_count:guests,unread_count:null,read_rate:null,first_read_at:row?.first_read_at??null,last_read_at:row?.last_read_at??null};
  }
}
export default new NotificationAnalyticsService();
