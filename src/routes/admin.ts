import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

// admin 권한 체크 미들웨어
function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다' })
  }
  next()
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// ── 교사 인증 코드 ─────────────────────────────────────────

// GET /api/admin/teacher-codes
router.get('/teacher-codes', requireAuth, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const codes = await prisma.teachercode.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, username: true } } },
    })
    return res.json(codes.map((c: any) => ({
      id: c.id,
      code: c.code,
      is_used: c.isUsed,
      used_by: c.user ? { id: c.usedBy.id, name: c.usedBy.name, username: c.usedBy.username } : null,
      created_at: c.createdAt,
    })))
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/teacher-codes — 코드 생성
router.post('/teacher-codes', requireAuth, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ count: z.number().int().min(1).max(50).default(1) })
    const { count } = schema.parse(req.body)

    const created = []
    for (let i = 0; i < count; i++) {
      let code = generateCode()
      // 중복 방지
      while (await prisma.teachercode.findUnique({ where: { code } })) {
        code = generateCode()
      }
      const c = await prisma.teachercode.create({ data: { code } })
      created.push({ id: c.id, code: c.code, is_used: c.isUsed, created_at: c.createdAt })
    }
    return res.status(201).json(created)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/admin/teacher-codes/:id — 미사용 코드 삭제
router.delete('/teacher-codes/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const code = await prisma.teachercode.findUnique({ where: { id: Number(req.params.id) } })
    if (!code) return res.status(404).json({ error: '코드를 찾을 수 없습니다' })
    if (code.isUsed) return res.status(400).json({ error: '이미 사용된 코드는 삭제할 수 없습니다' })
    await prisma.teachercode.delete({ where: { id: code.id } })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── 유저 관리 ──────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', requireAuth, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, username: true, name: true, role: true,
        grade: true, classNum: true, number: true, subject: true,
        isActive: true, createdAt: true, email: true,
      },
    })
    return res.json(users.map((u: any) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      grade: u.grade,
      class_num: u.classNum,
      number: u.number,
      subject: u.subject,
      is_active: u.isActive,
      created_at: u.createdAt,
      email: u.email,
    })))
  } catch (err) {
    next(err)
  }
})

// PATCH /api/admin/users/:id/deactivate — 계정 비활성화/활성화 토글
router.patch('/users/:id/deactivate', requireAuth, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } })
    if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다' })
    if (user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 비활성화할 수 없습니다' })

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: !user.isActive },
    })
    return res.json({ id: updated.id, is_active: updated.isActive })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/admin/users/:id — 계정 삭제
router.delete('/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } })
    if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다' })
    if (user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 삭제할 수 없습니다' })
    await prisma.user.delete({ where: { id: user.id } })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router