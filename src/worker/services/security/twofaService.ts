import { authenticator } from "otplib";
import QRCode from "qrcode";

export class TwoFAService {
    generateSecret() {
        return authenticator.generateSecret();
    }

    verify(secret: string, token: string) {
        return authenticator.verify({ token, secret });
    }

    async generateQRCode(secret: string, email: string) {
        const otpauth = authenticator.keyuri(email, "Bet62", secret);
        return await QRCode.toDataURL(otpauth);
    }
}
