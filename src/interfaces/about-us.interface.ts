import type { ITimestamps } from './common.interface';

export interface IAboutUs extends ITimestamps {
    name: string;
    logo: string;
    description: string | null;
    address: string | null;
    phone: string | null;
    website: string | null;
    facebook: string | null;
    instagram: string | null;
}
