import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/jwt'
import prisma from '../lib/prisma'

export interface AuthRequest extends Request {
  user?: {
    id: number
    role: string
    name: string
    subject?: string | null
    avatarText: string
    avatarColor: string
  }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증이 필요합니다' })
  }
  try {
    const { userId } = verifyToken(header.slice(7))
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user || !user.isActive) return res.status(401).json({ error: '유효하지 않은 토큰입니다' })
    req.user = { id: user.id, role: user.role, name: user.name, subject: user.subject, avatarText: user.avatarText, avatarColor: user.avatarColor }
    next()
  } catch {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다' })
  }
}

export function requireTeacher(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'teacher') {
    return res.status(403).json({ error: '선생님 권한이 필요합니다' })
  }
  next()
}