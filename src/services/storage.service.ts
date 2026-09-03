import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getR2Config } from '../constants/r2.config';
import { getR2Client } from '../lib/r2.client';
import { DomainError } from './domain-error';

export interface StoredObjectInfo { contentType:string; contentLength:number }
const PREFIX_BYTES = 64 * 1024;
const MAX_PIXELS = 40_000_000;

function storageError(): DomainError { return new DomainError('خدمة التخزين غير متاحة مؤقتاً',503,'STORAGE_UNAVAILABLE'); }

export function inspectImage(bytes:Uint8Array, contentType:string):{width:number;height:number}|null {
    let width=0,height=0;
    if(contentType==='image/png'&&bytes.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)){
        width=(bytes[16]<<24)|(bytes[17]<<16)|(bytes[18]<<8)|bytes[19]; height=(bytes[20]<<24)|(bytes[21]<<16)|(bytes[22]<<8)|bytes[23];
    } else if(contentType==='image/webp'&&bytes.length>=30&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'){
        const kind=String.fromCharCode(...bytes.slice(12,16));
        if(kind==='VP8X'){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)}
        else if(kind==='VP8 '&&bytes.length>=30&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=(bytes[26]|bytes[27]<<8)&0x3fff;height=(bytes[28]|bytes[29]<<8)&0x3fff}
        else if(kind==='VP8L'&&bytes.length>=25&&bytes[20]===47){const bits=bytes[21]|bytes[22]<<8|bytes[23]<<16|bytes[24]<<24;width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1}
    } else if(contentType==='image/jpeg'&&bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8){
        let offset=2; while(offset+8<bytes.length){if(bytes[offset]!==0xff){offset++;continue} const marker=bytes[offset+1]; if(marker===0xd9||marker===0xda)break; const length=(bytes[offset+2]<<8)|bytes[offset+3]; if(length<2)break; if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=(bytes[offset+5]<<8)|bytes[offset+6];width=(bytes[offset+7]<<8)|bytes[offset+8];break} offset+=2+length }
    }
    if(width<=0||height<=0||width*height>MAX_PIXELS)return null;
    return {width,height};
}

class StorageService {
    public isConfigured():boolean { try{return getR2Config()!==null&&getR2Client()!==null}catch{return false} }
    private resources(){const config=getR2Config(),client=getR2Client();if(!config||!client)throw storageError();return{config,client}}
    private bucket(key:string,config:NonNullable<ReturnType<typeof getR2Config>>){return key.startsWith('public/')?config.bucketName:config.privateBucketName}
    public async createPresignedPut(key:string,contentType:string){
        const {config,client}=this.resources();
        try{const uploadUrl=await getSignedUrl(client,new PutObjectCommand({Bucket:this.bucket(key,config),Key:key,ContentType:contentType}),{expiresIn:config.presignExpiresIn,signableHeaders:new Set(['content-type'])});return{uploadUrl,expiresIn:config.presignExpiresIn}}
        catch{throw storageError()}
    }
    public async createPresignedGet(key:string){const{config,client}=this.resources();try{return{downloadUrl:await getSignedUrl(client,new GetObjectCommand({Bucket:this.bucket(key,config),Key:key}),{expiresIn:300}),expiresIn:300}}catch{throw storageError()}}
    public async headObject(key:string):Promise<StoredObjectInfo|null>{const{config,client}=this.resources();try{const x=await client.send(new HeadObjectCommand({Bucket:this.bucket(key,config),Key:key}));return{contentType:(x.ContentType??'').split(';')[0].trim().toLowerCase(),contentLength:x.ContentLength??-1}}catch(error:any){if(error?.$metadata?.httpStatusCode===404||error?.name==='NotFound'||error?.name==='NoSuchKey')return null;throw storageError()}}
    public async readObjectPrefix(key:string):Promise<Uint8Array>{const{config,client}=this.resources();try{const x=await client.send(new GetObjectCommand({Bucket:this.bucket(key,config),Key:key,Range:`bytes=0-${PREFIX_BYTES-1}`}));const body=x.Body as any;if(!body)return new Uint8Array();if(typeof body.transformToByteArray==='function')return await body.transformToByteArray();const chunks:Uint8Array[]=[];for await(const chunk of body)chunks.push(chunk instanceof Uint8Array?chunk:new Uint8Array(chunk));const size=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(size);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length}return out}catch{throw storageError()}}
    public async promoteObject(pendingKey:string,objectKey:string,contentType:string):Promise<void>{const{config,client}=this.resources();try{await client.send(new CopyObjectCommand({Bucket:this.bucket(objectKey,config),CopySource:`${this.bucket(pendingKey,config)}/${encodeURIComponent(pendingKey).replace(/%2F/g,'/')}`,Key:objectKey,ContentType:contentType,MetadataDirective:'REPLACE'}));await this.deleteObject(pendingKey)}catch(error){if(error instanceof DomainError)throw error;throw storageError()}}
    public async deleteObject(key:string):Promise<void>{const{config,client}=this.resources();try{await client.send(new DeleteObjectCommand({Bucket:this.bucket(key,config),Key:key}))}catch{throw storageError()}}
    public buildPublicUrl(key:string):string{const config=getR2Config();if(!config)throw storageError();return `${config.publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`}
}
export default new StorageService();
