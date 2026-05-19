import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, requireTeacher, AuthRequest } from '../middleware/auth'

const router = Router()

function formatGrade(g: any) {
  return {
    id: g.id,
    subject: g.subject,
    score: g.score,
    prev_score: g.prevScore,
    rank: g.rank,
    total_students: g.totalStudents,
    semester: g.semester,
    teacher: g.teacher,
  }
}

// GET /api/grades  (내 성적)
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const grades = await prisma.grade.findMany({ where: { studentId: req.user!.id } })
    return res.json(grades.map(formatGrade))
  } catch (err) {
    next(err)
  }
})

// GET /api/grades/student/:id
router.get('/student/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = Number(req.params.id)
    if (req.user!.role !== 'teacher' && req.user!.id !== studentId) {
      return res.status(403).json({ error: '권한이 없습니다' })
    }
    const grades = await prisma.grade.findMany({ where: { studentId } })
    return res.json(grades.map(formatGrade))
  } catch (err) {
    next(err)
  }
})

// POST /api/grades/student/:id  (upsert, teacher only)
router.post('/student/:id', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      subject: z.string(),
      score: z.number().int(),
      prev_score: z.number().int().optional(),
      rank: z.number().int().optional(),
      teacher: z.string().optional(),
      semester: z.string().default('2024-2'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const data = parsed.data
    const studentId = Number(req.params.id)

    const grade = await prisma.grade.upsert({
      where: { studentId_subject_semester: { studentId, subject: data.subject, semester: data.semester } },
      update: { prevScore: data.prev_score, score: data.score, rank: data.rank, teacher: data.teacher },
      create: {
        studentId,
        subject: data.subject,
        score: data.score,
        prevScore: data.prev_score,
        rank: data.rank,
        teacher: data.teacher,
        semester: data.semester,
      },
    })
    return res.json(formatGrade(grade))
  } catch (err) {
    next(err)
  }
})

export default router
