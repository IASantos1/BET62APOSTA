
export class PasswordService {
    async hash(password: string): Promise<string> {
        try {
            const encoder = new TextEncoder();
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const keyMaterial = await crypto.subtle.importKey(
                "raw",
                encoder.encode(password),
                { name: "PBKDF2" },
                false,
                ["deriveBits"]
            );
            const derivedBits = await crypto.subtle.deriveBits(
                {
                    name: "PBKDF2",
                    salt,
                    iterations: 100000,
                    hash: "SHA-256"
                },
                keyMaterial,
                256
            );
            
            const hashBuffer = new Uint8Array(derivedBits);
            const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
            const hashHex = Array.from(hashBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
            
            return `${saltHex}:${hashHex}`;
        } catch (e) {
            console.error('Password hash error:', e);
            throw new Error('Failed to hash password');
        }
    }

    async verify(storedHash: string, password: string): Promise<boolean> {
        try {
            if (!storedHash || !password) return false;
            const parts = storedHash.split(':');
            if (parts.length !== 2) return false;
            
            const [saltHex, originalHashHex] = parts;
            
            const matchResult = saltHex.match(/.{1,2}/g);
            if (!matchResult) return false;
            
            const salt = new Uint8Array(matchResult.map(byte => parseInt(byte, 16)));
            const encoder = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey(
                "raw",
                encoder.encode(password),
                { name: "PBKDF2" },
                false,
                ["deriveBits"]
            );
            const derivedBits = await crypto.subtle.deriveBits(
                {
                    name: "PBKDF2",
                    salt,
                    iterations: 100000,
                    hash: "SHA-256"
                },
                keyMaterial,
                256
            );

            const hashBuffer = new Uint8Array(derivedBits);
            const hashHex = Array.from(hashBuffer).map(b => b.toString(16).padStart(2, '0')).join('');

            return hashHex === originalHashHex;
        } catch (e) {
            console.error('Password verification error:', e);
            return false;
        }
    }
}
