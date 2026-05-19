import jwt from 'jsonwebtoken'
import { env } from './env'

const SECRET = env.JWT_SECRET
const EXPIRES_IN = env.JWT_EXPIRES_IN

export function signToken(payload: { userId: number }): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN } as jwt.SignOptions)
}

export function verifyToken(token: string): { userId: number } {
  return jwt.verify(token, SECRET) as { userId: number }
}
