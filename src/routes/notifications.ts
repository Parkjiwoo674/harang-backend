import { Router, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

function fmt(n: any) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    sender: n.sender,
    tag: n.tag,
    is_read: n.isRead,
    created_at: n.createdAt,
  }
}

// GET /api/notifications
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const notifs = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    })
    return res.json(notifs.map(fmt))
  } catch (err) {
    next(err)
  }
})

// POST /api/notifications/read-all  — 이 라우트를 /:id/read 보다 먼저 등록해야 함
router.post('/read-all', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id },
      data: { isRead: true },
    })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/notifications/:id/read
router.post('/:id/read', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.notification.updateMany({
      where: { id: Number(req.params.id), userId: req.user!.id },
      data: { isRead: true },
    })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
