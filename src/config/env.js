import 'dotenv/config';

const REQUIRED_VARS = ['DATABASE_URL', 'JWT_SECRET', 'PORT'];

for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
        throw new Error(`Missing required environment variable: ${varName}`);
    }
}

export const DATABASE_URL = process.env.DATABASE_URL;
export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
export const PORT = parseInt(process.env.PORT, 10);
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
