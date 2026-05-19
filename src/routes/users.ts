import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { formatUser } from './auth'

const router = Router()

// GET /api/users
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({ where: { isActive: true } })
    return res.json(users.map(formatUser))
  } catch (err) {
    next(err)
  }
})

// GET /api/users/:id
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } })
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' })
    return res.json(formatUser(user))
  } catch (err) {
    next(err)
  }
})

// PATCH /api/users/me
router.patch('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      phone: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      bio: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: parsed.data,
    })
    return res.json(formatUser(user))
  } catch (err) {
    next(err)
  }
})

export default router
