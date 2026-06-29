import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

function formatAnswer(a: any) {
  return {
    id: a.id,
    content: a.content,
    author_id: a.authorId,
    author_name: a.user?.name ?? '',
    avatar_text: a.user?.avatarText ?? '?',
    avatar_color: a.user?.avatarColor ?? '#22c55e',
    is_accepted: a.isAccepted,
    created_at: a.createdAt,
  }
}

function formatPost(p: any, myId?: number) {
  return {
    id: p.id,
    title: p.title,
    content: p.content,
    subject: p.subject,
    author_id: p.authorId,
    author_name: p.user?.name ?? '',
    likes: p.likes,
    is_answered: p.isAnswered,
    created_at: p.createdAt,
    answer_count: p.qnaanswer?.length ?? 0,
    answers: (p.qnaanswer ?? []).map(formatAnswer),
    // 현재 유저가 이미 좋아요 눌렀는지 여부
    is_liked: myId ? (p.qnalike ?? []).some((l: any) => l.userId === myId) : false,
  }
}

const postInclude = {
  user: true,
  qnaanswer: { include: { user: true }, orderBy: { createdAt: 'asc' as const } },
  qnalike: true,
}

// GET /api/qna
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const subject = req.query.subject as string | undefined
    const posts = await prisma.qnapost.findMany({
      where: subject ? { subject } : undefined,
      include: postInclude,
      orderBy: { createdAt: 'desc' },
    })
    return res.json(posts.map((p: any) => formatPost(p, req.user!.id)))
  } catch (err) {
    next(err)
  }
})

// POST /api/qna
router.post('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      title: z.string().min(1),
      content: z.string().min(1),
      subject: z.string().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    const post = await prisma.qnapost.create({
      data: { ...parsed.data, authorId: req.user!.id },
      include: postInclude,
    })
    return res.status(201).json(formatPost(post, req.user!.id))
  } catch (err) {
    next(err)
  }
})

// POST /api/qna/:id/answers
router.post('/:id/answers', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ content: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: '내용을 입력해주세요' })

    const postId = Number(req.params.id)
    const [answer] = await prisma.$transaction([
      prisma.qnaanswer.create({
        data: { postId, content: parsed.data.content, authorId: req.user!.id },
        include: { user: true },
      }),
      prisma.qnapost.update({ where: { id: postId }, data: { isAnswered: true } }),
    ])
    return res.status(201).json(formatAnswer(answer))
  } catch (err) {
    next(err)
  }
})

// POST /api/qna/:id/like — 토글 방식 (중복 방지)
router.post('/:id/like', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const postId = Number(req.params.id)
    const userId = req.user!.id

    const existing = await prisma.qnalike.findUnique({
      where: { postId_userId: { postId, userId } },
    })

    let post
    if (existing) {
      // 이미 좋아요 → 취소
      await prisma.qnalike.delete({ where: { id: existing.id } })
      post = await prisma.qnapost.update({
        where: { id: postId },
        data: { likes: { decrement: 1 } },
      })
      return res.json({ likes: post.likes, is_liked: false })
    } else {
      // 좋아요 추가
      await prisma.qnalike.create({ data: { postId, userId } })
      post = await prisma.qnapost.update({
        where: { id: postId },
        data: { likes: { increment: 1 } },
      })
      return res.json({ likes: post.likes, is_liked: true })
    }
  } catch (err) {
    next(err)
  }
})

// PATCH /api/qna/answers/:id/accept
router.patch('/answers/:id/accept', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const answer = await prisma.qnaanswer.findUnique({
      where: { id: Number(req.params.id) },
      include: { qnapost: true },
    })
    if (!answer) return res.status(404).json({ error: '답변을 찾을 수 없습니다' })
    if (answer.qnapost.authorId !== req.user!.id && req.user!.role !== 'teacher') {
      return res.status(403).json({ error: '권한이 없습니다' })
    }
    await prisma.qnaanswer.update({ where: { id: answer.id }, data: { isAccepted: true } })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router