import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, requireTeacher, AuthRequest } from '../middleware/auth'

const router = Router()

function formatAssignment(a: any, submittedMap: Map<number, number>) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    subject: a.subject,
    teacher_id: a.teacherId,
    teacher_name: a.teacher?.name ?? '',
    due_date: a.dueDate,
    max_score: a.maxScore,
    created_at: a.createdAt,
    is_submitted: submittedMap.has(a.id),
    submission_id: submittedMap.get(a.id) ?? null,
  }
}

// GET /api/assignments
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const assignments = await prisma.assignment.findMany({
      include: { teacher: true, submissions: true },
      orderBy: { dueDate: 'asc' },
    })

    const submittedMap = new Map<number, number>()
    if (req.user!.role === 'student') {
      const subs = await prisma.submission.findMany({ where: { studentId: req.user!.id } })
      subs.forEach((s: { assignmentId: number; id: number }) => submittedMap.set(s.assignmentId, s.id))
    }

    return res.json(assignments.map((a: any) => formatAssignment(a, submittedMap)))
  } catch (err) {
    next(err)
  }
})

// POST /api/assignments
router.post('/', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      subject: z.string().min(1),
      due_date: z.string().datetime(),
      max_score: z.number().int().default(100),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const data = parsed.data

    const assignment = await prisma.assignment.create({
      data: {
        title: data.title,
        description: data.description,
        subject: data.subject,
        teacherId: req.user!.id,
        dueDate: new Date(data.due_date),
        maxScore: data.max_score,
      },
      include: { teacher: true, submissions: true },
    })

    // 학생 알림
    const students = await prisma.user.findMany({ where: { role: 'student', isActive: true } })
    if (students.length > 0) {
      await prisma.notification.createMany({
        data: students.map((s: { id: number }) => ({
          userId: s.id,
          type: 'assign',
          title: `[${data.subject}] ${data.title}`,
          sender: req.user!.name,
          tag: '과제',
        })),
      })
    }

    return res.status(201).json(formatAssignment(assignment, new Map()))
  } catch (err) {
    next(err)
  }
})

// POST /api/assignments/:id/submit
router.post('/:id/submit', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: '학생만 과제를 제출할 수 있습니다' })
    }
    const schema = z.object({
      content: z.string().optional(),
      file_name: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    try {
      const sub = await prisma.submission.create({
        data: {
          assignmentId: Number(req.params.id),
          studentId: req.user!.id,
          content: parsed.data.content,
          fileName: parsed.data.file_name,
        },
      })
      return res.status(201).json({
        id: sub.id,
        assignment_id: sub.assignmentId,
        student_id: sub.studentId,
        content: sub.content,
        file_name: sub.fileName,
        score: sub.score,
        submitted_at: sub.submittedAt,
      })
    } catch {
      return res.status(400).json({ error: '이미 제출한 과제입니다' })
    }
  } catch (err) {
    next(err)
  }
})

// GET /api/assignments/:id/submissions  (teacher only)
router.get('/:id/submissions', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const subs = await prisma.submission.findMany({
      where: { assignmentId: Number(req.params.id) },
      include: { student: true },
    })
    return res.json(subs.map((s: any) => ({
      id: s.id,
      assignment_id: s.assignmentId,
      student_id: s.studentId,
      student_name: s.student.name,
      content: s.content,
      file_name: s.fileName,
      score: s.score,
      submitted_at: s.submittedAt,
    })))
  } catch (err) {
    next(err)
  }
})

// PATCH /api/assignments/submissions/:id/grade  (teacher only)
router.patch('/submissions/:id/grade', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ score: z.number().int().min(0) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: '점수를 입력해주세요' })

    const sub = await prisma.submission.findUnique({ where: { id: Number(req.params.id) } })
    if (!sub) return res.status(404).json({ error: '제출물을 찾을 수 없습니다' })

    await prisma.submission.update({ where: { id: sub.id }, data: { score: parsed.data.score } })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
