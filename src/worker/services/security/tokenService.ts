import { SignJWT, jwtVerify } from "jose";

export class TokenService {
    private secret: Uint8Array;

    constructor(secret: string) {
        this.secret = new TextEncoder().encode(secret);
    }

    async createAccessToken(userId: string): Promise<string> {
        return await new SignJWT({ sub: userId, type: "access" })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt()
            .setExpirationTime("15m") // Short lived
            .sign(this.secret);
    }

    async createRefreshToken(): Promise<string> {
        return crypto.randomUUID();
    }

    async verifyAccessToken(token: string): Promise<{ sub: string } | null> {
        try {
            const { payload } = await jwtVerify(token, this.secret);
            if (payload.type !== "access") return null;
            return payload as { sub: string };
        } catch (e) {
            return null;
        }
    }
}
