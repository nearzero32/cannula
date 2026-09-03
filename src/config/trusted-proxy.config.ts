import { isIP } from 'node:net';

export class TrustedProxyConfigurationError extends Error {
    constructor(public readonly value: string) { super('TRUSTED_PROXY_CIDRS contains an invalid CIDR'); this.name = 'TrustedProxyConfigurationError'; }
}

export function trustedProxyCidrs(env: NodeJS.ProcessEnv = process.env): string[] {
    const values = (env.TRUSTED_PROXY_CIDRS ?? '').split(',').map(value => value.trim()).filter(Boolean);
    for (const value of values) {
        const [address, prefix, extra] = value.split('/');
        const family = isIP(address);
        const bits = family === 4 ? 32 : family === 6 ? 128 : 0;
        const parsed = prefix === undefined ? bits : Number(prefix);
        if (extra !== undefined || !bits || !Number.isInteger(parsed) || parsed < 0 || parsed > bits) throw new TrustedProxyConfigurationError(value);
    }
    return values;
}

export function assertTrustedProxyConfiguration(env: NodeJS.ProcessEnv = process.env): void { trustedProxyCidrs(env); }
