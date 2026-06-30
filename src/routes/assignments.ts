import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import prisma from '../lib/prisma'
import { requireAuth, requireTeacher, AuthRequest } from '../middleware/auth'
import { BadRequestError, NotFoundError } from '../lib/errors'

const router = Router()

// ── 업로드 디렉토리 준비 ─────────────────────────────────────────────────────
const assignmentUploadDir = path.join(process.cwd(), 'uploads', 'assignments')
const submissionUploadDir = path.join(process.cwd(), 'uploads', 'submissions')
if (!fs.existsSync(assignmentUploadDir)) fs.mkdirSync(assignmentUploadDir, { recursive: true })
if (!fs.existsSync(submissionUploadDir)) fs.mkdirSync(submissionUploadDir, { recursive: true })

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.hwp', '.hwpx', '.txt', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.webp']

function makeUpload(dir: string, prefix: string) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname)
      cb(null, `${prefix}_${(req as AuthRequest).user!.id}_${Date.now()}${ext}`)
    },
  })
  return multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase()
      if (ALLOWED_EXT.includes(ext)) cb(null, true)
      else cb(new BadRequestError('지원하지 않는 파일 형식입니다'))
    },
  })
}

const uploadAssignmentFile = makeUpload(assignmentUploadDir, 'assignment')
const uploadSubmissionFile = makeUpload(submissionUploadDir, 'submission')

function formatAssignment(a: any, submittedMap: Map<number, number>) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    subject: a.subject,
    file_name: a.fileName ?? null,
    file_url: a.fileUrl ?? null,
    teacher_id: a.teacherId,
    teacher_name: a.teacher?.name ?? '',
    due_date: a.dueDate,
    max_score: a.maxScore,
    target_grade: a.targetGrade,
    target_class: a.targetClass,
    created_at: a.createdAt,
    is_submitted: submittedMap.has(a.id),
    submission_id: submittedMap.get(a.id) ?? null,
  }
}

// GET /api/assignments — 학생은 본인 학년/반 과제만, 교사는 본인이 등록한 과제만 조회
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const where: any = {}
    if (req.user!.role === 'student') {
      const student = await prisma.user.findUnique({ where: { id: req.user!.id } })
      if (!student?.grade || !student?.classNum) {
        return res.json([]) // 학년/반 정보 없으면 빈 목록
      }
      where.targetGrade = student.grade
      where.targetClass = student.classNum
    } else {
      // 교사는 본인이 등록한 과제만 관리
      where.teacherId = req.user!.id
    }

    const assignments = await prisma.assignment.findMany({
      where,
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

// POST /api/assignments — 담당 과목 교사가 특정 학년/반을 대상으로 과제 등록 (첨부파일 선택)
router.post('/', requireAuth, requireTeacher, uploadAssignmentFile.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // 과제 과목은 클라이언트가 정하는 게 아니라, 로그인한 교사 본인의 담당 과목으로 고정한다.
    const teacherSubject = req.user!.subject
    if (!teacherSubject) {
      return next(new BadRequestError('담당 과목이 설정되어 있지 않습니다. 프로필에서 과목을 먼저 등록해주세요'))
    }

    const schema = z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      due_date: z.string().datetime(),
      max_score: z.coerce.number().int().default(100),
      target_grade: z.coerce.number().int().min(1).max(3),
      target_class: z.coerce.number().int().min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const data = parsed.data

    const assignment = await prisma.assignment.create({
      data: {
        title: data.title,
        description: data.description,
        subject: teacherSubject,
        fileName: req.file?.originalname,
        fileUrl: req.file ? `/uploads/assignments/${req.file.filename}` : undefined,
        teacherId: req.user!.id,
        dueDate: new Date(data.due_date),
        maxScore: data.max_score,
        targetGrade: data.target_grade,
        targetClass: data.target_class,
      },
      include: { teacher: true, submissions: true },
    })

    // 해당 학년/반 학생에게만 알림
    const students = await prisma.user.findMany({
      where: { role: 'student', isActive: true, grade: data.target_grade, classNum: data.target_class },
    })
    if (students.length > 0) {
      await prisma.notification.createMany({
        data: students.map((s: { id: number }) => ({
          userId: s.id,
          type: 'assign',
          title: `[${teacherSubject}] ${data.title}`,
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

// POST /api/assignments/:id/submit — 학생 과제 제출 (첨부파일 선택)
router.post('/:id/submit', requireAuth, uploadSubmissionFile.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: '학생만 과제를 제출할 수 있습니다' })
    }
    const schema = z.object({
      content: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    if (!parsed.data.content && !req.file) {
      return res.status(400).json({ error: '제출 내용이나 파일을 입력해주세요' })
    }

    try {
      const sub = await prisma.submission.create({
        data: {
          assignmentId: Number(req.params.id),
          studentId: req.user!.id,
          content: parsed.data.content,
          fileName: req.file?.originalname,
          fileUrl: req.file ? `/uploads/submissions/${req.file.filename}` : undefined,
        },
      })
      return res.status(201).json({
        id: sub.id,
        assignment_id: sub.assignmentId,
        student_id: sub.studentId,
        content: sub.content,
        file_name: sub.fileName,
        file_url: sub.fileUrl,
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
      file_url: s.fileUrl,
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
    if (!sub) return next(new NotFoundError('제출물을 찾을 수 없습니다'))

    await prisma.submission.update({ where: { id: sub.id }, data: { score: parsed.data.score } })
    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router