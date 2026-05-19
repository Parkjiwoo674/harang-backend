import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, requireTeacher, AuthRequest } from '../middleware/auth'

const router = Router()

function formatAnn(ann: any, readIds: Set<number>) {
  return {
    id: ann.id,
    title: ann.title,
    content: ann.content,
    category: ann.category,
    is_pinned: ann.isPinned,
    is_urgent: ann.isUrgent,
    author_id: ann.authorId,
    author_name: ann.author?.name ?? '',
    views: ann.views,
    created_at: ann.createdAt,
    is_read: readIds.has(ann.id),
  }
}

// GET /api/announcements
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [announcements, reads] = await Promise.all([
      prisma.announcement.findMany({
        include: { author: true, reads: true },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.announcementRead.findMany({ where: { userId: req.user!.id } }),
    ])
    const readIds = new Set<number>(reads.map((r: { announcementId: number }) => r.announcementId))
    return res.json(announcements.map((a: any) => formatAnn(a, readIds)))
  } catch (err) {
    next(err)
  }
})

// POST /api/announcements
router.post('/', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      title: z.string().min(1),
      content: z.string().min(1),
      category: z.string().default('공지'),
      is_pinned: z.boolean().default(false),
      is_urgent: z.boolean().default(false),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const data = parsed.data

    const ann = await prisma.announcement.create({
      data: {
        title: data.title,
        content: data.content,
        category: data.category,
        isPinned: data.is_pinned,
        isUrgent: data.is_urgent,
        authorId: req.user!.id,
      },
      include: { author: true, reads: true },
    })

    // 학생 전체 알림
    const students = await prisma.user.findMany({ where: { role: 'student', isActive: true } })
    if (students.length > 0) {
      await prisma.notification.createMany({
        data: students.map((s: { id: number }) => ({
          userId: s.id,
          type: 'notice',
          title: data.title,
          sender: req.user!.name,
          tag: data.category !== '공지' ? data.category : null,
        })),
      })
    }

    return res.status(201).json(formatAnn(ann, new Set()))
  } catch (err) {
    next(err)
  }
})

// POST /api/announcements/:id/read
router.post('/:id/read', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const annId = Number(req.params.id)
    await prisma.announcementRead.create({
      data: { announcementId: annId, userId: req.user!.id },
    }).catch(() => {
      // 이미 읽음 처리된 경우 unique constraint → 무시
    })
    await prisma.announcement.update({
      where: { id: annId },
      data: { views: { increment: 1 } },
    })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/announcements/:id
router.delete('/:id', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ann = await prisma.announcement.findUnique({ where: { id: Number(req.params.id) } })
    if (!ann) return res.status(404).json({ error: '공지를 찾을 수 없습니다' })
    await prisma.announcement.delete({ where: { id: ann.id } })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
