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
    author_name: a.author?.name ?? '',
    avatar_text: a.author?.avatarText ?? '?',
    avatar_color: a.author?.avatarColor ?? '#22c55e',
    is_accepted: a.isAccepted,
    created_at: a.createdAt,
  }
}

function formatPost(p: any) {
  return {
    id: p.id,
    title: p.title,
    content: p.content,
    subject: p.subject,
    author_id: p.authorId,
    author_name: p.author?.name ?? '',
    likes: p.likes,
    is_answered: p.isAnswered,
    created_at: p.createdAt,
    answer_count: p.answers?.length ?? 0,
    answers: (p.answers ?? []).map(formatAnswer),
  }
}

const postInclude = {
  author: true,
  answers: { include: { author: true }, orderBy: { createdAt: 'asc' as const } },
}

// GET /api/qna
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const subject = req.query.subject as string | undefined
    const posts = await prisma.qnAPost.findMany({
      where: subject ? { subject } : undefined,
      include: postInclude,
      orderBy: { createdAt: 'desc' },
    })
    return res.json(posts.map(formatPost))
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

    const post = await prisma.qnAPost.create({
      data: { ...parsed.data, authorId: req.user!.id },
      include: postInclude,
    })
    return res.status(201).json(formatPost(post))
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
      prisma.qnAAnswer.create({
        data: { postId, content: parsed.data.content, authorId: req.user!.id },
        include: { author: true },
      }),
      prisma.qnAPost.update({ where: { id: postId }, data: { isAnswered: true } }),
    ])
    return res.status(201).json(formatAnswer(answer))
  } catch (err) {
    next(err)
  }
})

// POST /api/qna/:id/like  — increment으로 동시성 안전하게 처리
router.post('/:id/like', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const post = await prisma.qnAPost.update({
      where: { id: Number(req.params.id) },
      data: { likes: { increment: 1 } },
    })
    return res.json({ likes: post.likes })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/qna/answers/:id/accept
router.patch('/answers/:id/accept', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const answer = await prisma.qnAAnswer.findUnique({
      where: { id: Number(req.params.id) },
      include: { post: true },
    })
    if (!answer) return res.status(404).json({ error: '답변을 찾을 수 없습니다' })
    if (answer.post.authorId !== req.user!.id && req.user!.role !== 'teacher') {
      return res.status(403).json({ error: '권한이 없습니다' })
    }
    await prisma.qnAAnswer.update({ where: { id: answer.id }, data: { isAccepted: true } })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
