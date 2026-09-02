export class OtpDeliveryService {
    async send(phone: string, otp: string): Promise<void> {
        const endpoint = process.env.OTP_DELIVERY_WEBHOOK_URL;
        if (!endpoint) {
            if (process.env.NODE_ENV === 'production') throw new Error('OTP provider is not configured');
            return;
        }
        const response = await fetch(endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ phone, otp }),
        });
        if (!response.ok) throw new Error('OTP delivery failed');
    }
}
export default new OtpDeliveryService();
