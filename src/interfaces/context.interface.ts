import { t, Static } from 'elysia';
import { IUserRoleEnum } from './user.interface';
import { TokenAudienceEnum } from '../constants/jwt';

export const TokenPayloadSchema = t.Object({
    _id: t.String({ pattern: '^[0-9a-fA-F]{24}$' }),
    role: t.Enum(IUserRoleEnum),
    sid: t.String({ minLength: 20 }),
    audience: t.Enum(TokenAudienceEnum),
    mustChangePin: t.Boolean(),
});

export type TokenPayload = Static<typeof TokenPayloadSchema>;

export interface AuthContext {
    phrase: TokenPayload;
}
