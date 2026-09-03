import { isIP } from 'node:net';
import { trustedProxyCidrs } from '../config/trusted-proxy.config';

type RequestIpServer = { requestIP?: (request: Request) => { address?: string } | null } | null | undefined;

function normalize(value: string | undefined | null): string | null {
    let ip = value?.trim(); if (!ip) return null;
    if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
    if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
    return isIP(ip) ? ip.toLowerCase() : null;
}
function bytes(ip: string): { value: bigint; bits: number } | null {
    const normalized = normalize(ip); if (!normalized) return null;
    if (isIP(normalized) === 4) return { value: normalized.split('.').reduce((n, part) => (n << 8n) | BigInt(part), 0n), bits: 32 };
    const halves = normalized.split('::');
    const left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
    const expand = (part: string) => isIP(part) === 4 ? part.split('.').reduce<number[]>((a, n, i) => { if (i % 2 === 0) a.push(Number(n) << 8); else a[a.length - 1] |= Number(n); return a; }, []) : [parseInt(part || '0', 16)];
    const groups = [...left.flatMap(expand), ...Array(Math.max(0, 8 - left.flatMap(expand).length - right.flatMap(expand).length)).fill(0), ...right.flatMap(expand)];
    if (groups.length !== 8 || groups.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) return null;
    return { value: groups.reduce((n, part) => (n << 16n) | BigInt(part), 0n), bits: 128 };
}
function inCidr(ip: string, cidr: string): boolean {
    const [network, rawPrefix] = cidr.split('/'), candidate = bytes(ip), base = bytes(network); if (!candidate || !base || candidate.bits !== base.bits) return false;
    const prefix = rawPrefix === undefined ? base.bits : Number(rawPrefix), shift = BigInt(base.bits - prefix);
    return (candidate.value >> shift) === (base.value >> shift);
}
export function resolveClientIpFromPeer(peerInput: string | null | undefined, headers: Headers, cidrs = trustedProxyCidrs()): string {
    let current = normalize(peerInput); if (!current) return '';
    if (!cidrs.some(cidr => inCidr(current!, cidr))) return current;
    const rawForwarded=(headers.get('x-forwarded-for')??'').split(',').map(value=>value.trim()).filter(Boolean), parsedForwarded=rawForwarded.map(normalize);
    if(parsedForwarded.some(value=>!value))return current;
    const forwarded=parsedForwarded.filter((value):value is string=>Boolean(value));
    for (let index = forwarded.length - 1; index >= 0 && cidrs.some(cidr => inCidr(current!, cidr)); index--) current = forwarded[index];
    if (cidrs.some(cidr => inCidr(current!, cidr))) {
        const direct = normalize(headers.get('cf-connecting-ip')) ?? normalize(headers.get('x-real-ip'));
        if (direct) current = direct;
    }
    return current;
}
export function resolveClientIp(request: Request, server?: RequestIpServer): string {
    let peer = ''; try { peer = server?.requestIP?.(request)?.address ?? ''; } catch {}
    return resolveClientIpFromPeer(peer, request.headers);
}
