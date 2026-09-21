import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

loadEnv()

const envSchema = z.object({
  PORT: z.string().default('4000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  CLIENT_ORIGIN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

const parsed = envSchema.parse({
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN,
  NODE_ENV: process.env.NODE_ENV,
})

const config = {
  port: Number(parsed.PORT),
  databaseUrl: parsed.DATABASE_URL,
  jwtSecret: parsed.JWT_SECRET,
  clientOrigin: parsed.CLIENT_ORIGIN ?? 'http://localhost:5173',
  nodeEnv: parsed.NODE_ENV,
}

export const allowedOrigins = new Set([
  config.clientOrigin,
  ...(config.nodeEnv === 'development' ? ['http://localhost:5174'] : []),
])

export function isAllowedOrigin(origin: string | undefined) {
  return !origin || allowedOrigins.has(origin)
}

export default config
