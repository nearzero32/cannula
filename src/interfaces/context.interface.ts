import { t, Static } from 'elysia';
import { IUserRoleEnum } from './user.interface';

export const TokenPayloadSchema = t.Object({
    _id: t.String({ pattern: '^[0-9a-fA-F]{24}$' }),
    role: t.Enum(IUserRoleEnum),
});

export type TokenPayload = Static<typeof TokenPayloadSchema>;

export interface AuthContext {
    phrase: TokenPayload;
}
