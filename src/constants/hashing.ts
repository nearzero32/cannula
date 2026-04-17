/** Returns SHA-512 hash (hex) of the input. Used for account_password storage. */
export function generateSHA512(input: string): string {
    return new Bun.CryptoHasher('sha512').update(input).digest('hex');
}
