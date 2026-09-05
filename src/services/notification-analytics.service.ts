import mongoose from 'mongoose';
import Notification from '../models/notifications.model';
import NotificationRecipient from '../models/notification-recipient.model';
import NotificationRead, { INotificationReaderTypeEnum } from '../models/notification-read.model';
import { INotificationAudienceEnum } from '../interfaces/notification.interface';
import { DomainError } from './domain-error';

export type NotificationAnalyticsSummary = { notification_id:string; audience:'public'|'targeted'; targeted_count:number|null; read_count:number; authenticated_reader_count:number; guest_installation_reader_count:number; unread_count:number|null; read_rate:number|null; first_read_at:Date|null; last_read_at:Date|null };
class NotificationAnalyticsService {
  private async notification(id:string){if(!mongoose.Types.ObjectId.isValid(id))throw new DomainError('معرف الإشعار غير صالح',400);const notification=await Notification.findById(id).select('audience').lean().exec();if(!notification)throw new DomainError('الإشعار غير موجود',404);return notification}
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
  async readers(notificationId:string,{page=1,limit=20,reader_type,dateFrom,dateTo}:{page?:number;limit?:number;reader_type?:string;dateFrom?:Date;dateTo?:Date}={}){
    const notification=await this.notification(notificationId);const id=new mongoose.Types.ObjectId(notificationId),safeLimit=Math.min(100,Math.max(1,limit)),skip=(Math.max(1,page)-1)*safeLimit,match:any={notification_id:id};if(reader_type)match.reader_type=reader_type;if(dateFrom||dateTo)match.read_at={...(dateFrom?{$gte:dateFrom}:{}),...(dateTo?{$lte:dateTo}:{})};
    const base:any[]=[{$match:{...match,...(notification.audience===INotificationAudienceEnum.TARGETED?{reader_type:INotificationReaderTypeEnum.USER}:{})}}];
    if(notification.audience===INotificationAudienceEnum.TARGETED)base.push({$lookup:{from:NotificationRecipient.collection.name,let:{u:'$user_id'},pipeline:[{$match:{$expr:{$and:[{$eq:['$notification_id',id]},{$eq:['$user_id','$$u']}]}}},{$limit:1}],as:'recipient'}},{$match:{'recipient.0':{$exists:true}}});
    const [result]=await NotificationRead.aggregate([...base,{$sort:{read_at:-1,_id:-1}},{$facet:{data:[{$skip:skip},{$limit:safeLimit},{$lookup:{from:'users',localField:'user_id',foreignField:'_id',as:'user'}},{$project:{reader_type:1,read_at:1,user:{$cond:[{$eq:['$reader_type','user']},{$let:{vars:{u:{$arrayElemAt:['$user',0]}},in:{_id:'$$u._id',full_name:'$$u.full_name',phone:'$$u.phone'}}},null]}}}],count:[{$count:'total'}]}}]).exec();return{data:result?.data??[],total:result?.count?.[0]?.total??0}
  }
  async recipients(notificationId:string,{page=1,limit=20,unread=false}:{page?:number;limit?:number;unread?:boolean}={}){
    const notification=await this.notification(notificationId);if(notification.audience!==INotificationAudienceEnum.TARGETED)throw new DomainError('المستلمون غير المقروءين متاحون للإشعارات الموجهة فقط',409);const id=new mongoose.Types.ObjectId(notificationId),safeLimit=Math.min(100,Math.max(1,limit)),skip=(Math.max(1,page)-1)*safeLimit;
    const readLookup={$lookup:{from:NotificationRead.collection.name,let:{u:'$user_id'},pipeline:[{$match:{$expr:{$and:[{$eq:['$notification_id',id]},{$eq:['$reader_type',INotificationReaderTypeEnum.USER]},{$eq:['$user_id','$$u']}]}}},{$limit:1}],as:'read'}};
    const [result]=await NotificationRecipient.aggregate([{$match:{notification_id:id}},readLookup,...(unread?[{$match:{'read.0':{$exists:false}}}]:[]),{$sort:{createdAt:-1,_id:-1}},{$facet:{data:[{$skip:skip},{$limit:safeLimit},{$lookup:{from:'users',localField:'user_id',foreignField:'_id',as:'user'}},{$project:{targeted_at:'$createdAt',user:{$let:{vars:{u:{$arrayElemAt:['$user',0]}},in:{_id:'$$u._id',full_name:'$$u.full_name',phone:'$$u.phone'}}},is_read:{$gt:[{$size:'$read'},0]},read_at:{$ifNull:[{$arrayElemAt:['$read.read_at',0]},null]}}}],count:[{$count:'total'}]}}]).exec();return{data:result?.data??[],total:result?.count?.[0]?.total??0}
  }
}
export default new NotificationAnalyticsService();
