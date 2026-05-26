import { Router, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, requireTeacher, AuthRequest } from '../middleware/auth'

const router = Router()

const EXAM_TYPES = ['중간고사', '기말고사', '수행평가'] as const

function formatGrade(g: any) {
  return {
    id: g.id,
    subject: g.subject,
    score: g.score,
    prev_score: g.prevScore,
    rank: g.rank,
    total_students: g.totalStudents,
    semester: g.semester,
    exam_type: g.examType,
    teacher: g.teacher,
  }
}

// 담임 권한 체크 헬퍼
async function isHomeroom(userId: number, grade: number, classNum: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  return user?.role === 'teacher' &&
    user.homeroomGrade === grade &&
    user.homeroomClassNum === classNum
}

// GET /api/grades — 내 성적 (학생용)
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== 'student') {
      return res.status(403).json({ error: '학생만 접근 가능합니다' })
    }
    const grades = await prisma.grade.findMany({
      where: { studentId: req.user!.id },
      orderBy: [{ semester: 'desc' }, { subject: 'asc' }, { examType: 'asc' }],
    })
    return res.json(grades.map(formatGrade))
  } catch (err) {
    next(err)
  }
})

// GET /api/grades/student/:id — 특정 학생 성적 (담임교사 또는 본인)
router.get('/student/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = Number(req.params.id)

    // 본인이거나 담임교사인 경우만 허용
    if (req.user!.id !== studentId) {
      const student = await prisma.user.findUnique({ where: { id: studentId } })
      if (!student) return res.status(404).json({ error: '학생을 찾을 수 없습니다' })

      const ok = await isHomeroom(
        req.user!.id,
        student.grade ?? 0,
        student.classNum ?? 0
      )
      if (!ok) return res.status(403).json({ error: '담임 학급 학생의 성적만 조회할 수 있습니다' })
    }

    const grades = await prisma.grade.findMany({
      where: { studentId },
      orderBy: [{ semester: 'desc' }, { subject: 'asc' }, { examType: 'asc' }],
    })
    return res.json(grades.map(formatGrade))
  } catch (err) {
    next(err)
  }
})

// GET /api/grades/class — 담임 반 학생 목록 + 성적 (담임교사용)
router.get('/class', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const teacher = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!teacher?.homeroomGrade || !teacher?.homeroomClassNum) {
      return res.status(403).json({ error: '담임 학급이 지정되지 않았습니다' })
    }

    const students = await prisma.user.findMany({
      where: {
        role: 'student',
        grade: teacher.homeroomGrade,
        classNum: teacher.homeroomClassNum,
        isActive: true,
      },
      orderBy: { number: 'asc' },
    })

    const semester = (req.query.semester as string) || '2024-2'
    const grades = await prisma.grade.findMany({
      where: {
        studentId: { in: students.map(s => s.id) },
        semester,
      },
    })

    return res.json({
      grade: teacher.homeroomGrade,
      class_num: teacher.homeroomClassNum,
      semester,
      students: students.map(s => ({
        id: s.id,
        name: s.name,
        number: s.number,
        grades: grades.filter(g => g.studentId === s.id).map(formatGrade),
      })),
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/grades/class/batch — 반 전체 성적 일괄 입력 (담임교사 전용)
router.post('/class/batch', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const teacher = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!teacher?.homeroomGrade || !teacher?.homeroomClassNum) {
      return res.status(403).json({ error: '담임 학급이 지정되지 않았습니다' })
    }

    const schema = z.object({
      subject: z.string().min(1),
      exam_type: z.enum(EXAM_TYPES),
      semester: z.string().default('2024-2'),
      scores: z.array(z.object({
        student_id: z.number().int(),
        score: z.number().int().min(0).max(100),
      })),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const { subject, exam_type, semester, scores } = parsed.data

    // 담임 반 학생인지 검증
    const validStudents = await prisma.user.findMany({
      where: {
        id: { in: scores.map(s => s.student_id) },
        role: 'student',
        grade: teacher.homeroomGrade,
        classNum: teacher.homeroomClassNum,
      },
    })
    const validIds = new Set(validStudents.map(s => s.id))

    // 전체 학생 수 (순위 계산용)
    const totalStudents = await prisma.user.count({
      where: {
        role: 'student',
        grade: teacher.homeroomGrade,
        classNum: teacher.homeroomClassNum,
        isActive: true,
      },
    })

    // 점수 내림차순 정렬 → 순위 계산
    const sorted = [...scores]
      .filter(s => validIds.has(s.student_id))
      .sort((a, b) => b.score - a.score)

    const rankMap = new Map<number, number>()
    sorted.forEach((s, i) => rankMap.set(s.student_id, i + 1))

    // upsert
    const results = []
    for (const s of scores) {
      if (!validIds.has(s.student_id)) continue

      // 이전 점수 가져오기
      const existing = await prisma.grade.findUnique({
        where: {
          studentId_subject_semester_examType: {
            studentId: s.student_id,
            subject,
            semester,
            examType: exam_type,
          },
        },
      })

      const grade = await prisma.grade.upsert({
        where: {
          studentId_subject_semester_examType: {
            studentId: s.student_id,
            subject,
            semester,
            examType: exam_type,
          },
        },
        update: {
          prevScore: existing?.score ?? null,
          score: s.score,
          rank: rankMap.get(s.student_id),
          totalStudents,
          teacher: teacher.name,
        },
        create: {
          studentId: s.student_id,
          subject,
          score: s.score,
          rank: rankMap.get(s.student_id),
          totalStudents,
          semester,
          examType: exam_type,
          teacher: teacher.name,
        },
      })
      results.push(formatGrade(grade))
    }

    return res.json({ ok: true, updated: results.length })
  } catch (err) {
    next(err)
  }
})

// POST /api/grades/student/:id — 개별 학생 단일 성적 upsert (담임교사)
router.post('/student/:id', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const studentId = Number(req.params.id)
    const student = await prisma.user.findUnique({ where: { id: studentId } })
    if (!student) return res.status(404).json({ error: '학생을 찾을 수 없습니다' })

    const ok = await isHomeroom(req.user!.id, student.grade ?? 0, student.classNum ?? 0)
    if (!ok) return res.status(403).json({ error: '담임 학급 학생만 성적을 입력할 수 있습니다' })

    const schema = z.object({
      subject: z.string(),
      score: z.number().int().min(0).max(100),
      exam_type: z.enum(EXAM_TYPES).default('중간고사'),
      rank: z.number().int().optional(),
      teacher: z.string().optional(),
      semester: z.string().default('2024-2'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const data = parsed.data

    const existing = await prisma.grade.findUnique({
      where: {
        studentId_subject_semester_examType: {
          studentId,
          subject: data.subject,
          semester: data.semester,
          examType: data.exam_type,
        },
      },
    })

    const grade = await prisma.grade.upsert({
      where: {
        studentId_subject_semester_examType: {
          studentId,
          subject: data.subject,
          semester: data.semester,
          examType: data.exam_type,
        },
      },
      update: {
        prevScore: existing?.score ?? null,
        score: data.score,
        rank: data.rank,
        teacher: data.teacher,
      },
      create: {
        studentId,
        subject: data.subject,
        score: data.score,
        examType: data.exam_type,
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