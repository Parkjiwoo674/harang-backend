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
    exam_name: g.examName || g.examType,
    teacher: g.teacher,
  }
}

// 학년 전체 기준 석차 재계산 헬퍼
// 저장 후 호출 → 해당 학년+과목+학기+시험종류 전체 성적 기준으로 석차+총인원 일괄 업데이트
async function recalcRankForGrade(gradeNum: number, subject: string, semester: string, examName: string) {
  const gradeStudents = await prisma.user.findMany({
    where: { grade: gradeNum, role: 'student', isActive: true },
    select: { id: true },
  })
  const studentIds = gradeStudents.map(s => s.id)

  const allGrades = await prisma.grade.findMany({
    where: {
      subject,
      semester,
      examName,
      studentId: { in: studentIds },
    },
  })

  if (allGrades.length === 0) return

  const totalStudents = allGrades.length

  // 내림차순 정렬, 동점자는 같은 석차
  const sorted = [...allGrades].sort((a, b) => b.score - a.score)
  const rankMap = new Map<number, number>()
  sorted.forEach((g, i) => {
    if (i > 0 && sorted[i - 1].score === g.score) {
      rankMap.set(g.id, rankMap.get(sorted[i - 1].id)!)
    } else {
      rankMap.set(g.id, i + 1)
    }
  })

  await Promise.all(
    allGrades.map(g =>
      prisma.grade.update({
        where: { id: g.id },
        data: { rank: rankMap.get(g.id), totalStudents },
      })
    )
  )
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

    if (req.user!.id !== studentId) {
      const student = await prisma.user.findUnique({ where: { id: studentId } })
      if (!student) return res.status(404).json({ error: '학생을 찾을 수 없습니다' })

      const ok = await isHomeroom(req.user!.id, student.grade ?? 0, student.classNum ?? 0)
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

    const semester = (req.query.semester as string) || '1-1'
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
      exam_name: z.string().optional(),
      semester: z.string().default('1-1'),
      scores: z.array(z.object({
        student_id: z.number().int(),
        score: z.number().int().min(0).max(100),
      })),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const { subject, exam_type, exam_name, semester, scores } = parsed.data
    const examName = exam_name || exam_type

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

    // 점수 upsert (석차는 recalc에서 처리)
    const results = []
    for (const s of scores) {
      if (!validIds.has(s.student_id)) continue

      const existing = await prisma.grade.findUnique({
        where: {
          studentId_subject_semester_examName: {
            studentId: s.student_id,
            subject,
            semester,
            examName,
          },
        },
      })

      const grade = await prisma.grade.upsert({
        where: {
          studentId_subject_semester_examName: {
            studentId: s.student_id,
            subject,
            semester,
            examName,
          },
        },
        update: {
          prevScore: existing?.score ?? null,
          score: s.score,
          examType: exam_type,
          teacher: teacher.name,
        },
        create: {
          studentId: s.student_id,
          subject,
          score: s.score,
          semester,
          examType: exam_type,
          examName,
          teacher: teacher.name,
        },
      })
      results.push(formatGrade(grade))
    }

    await recalcRankForGrade(teacher.homeroomGrade, subject, semester, examName)

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
      exam_name: z.string().optional(),
      rank: z.number().int().optional(),
      teacher: z.string().optional(),
      semester: z.string().default('1-1'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const data = parsed.data
    const examName = data.exam_name || data.exam_type

    const existing = await prisma.grade.findUnique({
      where: {
        studentId_subject_semester_examName: {
          studentId,
          subject: data.subject,
          semester: data.semester,
          examName,
        },
      },
    })

    const grade = await prisma.grade.upsert({
      where: {
        studentId_subject_semester_examName: {
          studentId,
          subject: data.subject,
          semester: data.semester,
          examName,
        },
      },
      update: {
        prevScore: existing?.score ?? null,
        score: data.score,
        examType: data.exam_type,
        teacher: data.teacher,
      },
      create: {
        studentId,
        subject: data.subject,
        score: data.score,
        examType: data.exam_type,
        examName,
        teacher: data.teacher,
        semester: data.semester,
      },
    })

    // 학년 전체 석차 재계산
    if (student.grade) {
      await recalcRankForGrade(student.grade, data.subject, data.semester, examName)
    }

    return res.json(formatGrade(grade))
  } catch (err) {
    next(err)
  }
})

// POST /api/grades/subject — 담당 과목 학생들 성적 일괄 입력 (과목 담당교사)
router.post('/subject', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const teacher = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!teacher?.subject) {
      return res.status(403).json({ error: '담당 과목이 지정되지 않았습니다' })
    }

    const schema = z.object({
      grade: z.number().int().min(1).max(3),
      class_num: z.number().int().min(1),
      exam_type: z.enum(EXAM_TYPES),
      exam_name: z.string().optional(),
      semester: z.string().default('1-1'),
      scores: z.array(z.object({
        student_id: z.number().int(),
        score: z.number().int().min(0).max(100),
      })),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
    const { grade, class_num, exam_type, exam_name, semester, scores } = parsed.data
    const examName = exam_name || exam_type

    // 해당 학급 학생 확인
    const validStudents = await prisma.user.findMany({
      where: {
        id: { in: scores.map(s => s.student_id) },
        role: 'student',
        grade,
        classNum: class_num,
      },
    })
    const validIds = new Set(validStudents.map(s => s.id))

    // 점수 upsert (석차는 recalc에서 처리)
    const results = []
    for (const s of scores) {
      if (!validIds.has(s.student_id)) continue

      const existing = await prisma.grade.findUnique({
        where: {
          studentId_subject_semester_examName: {
            studentId: s.student_id,
            subject: teacher.subject,
            semester,
            examName,
          },
        },
      })

      const gradeRecord = await prisma.grade.upsert({
        where: {
          studentId_subject_semester_examName: {
            studentId: s.student_id,
            subject: teacher.subject,
            semester,
            examName,
          },
        },
        update: {
          prevScore: existing?.score ?? null,
          score: s.score,
          examType: exam_type,
          teacher: teacher.name,
        },
        create: {
          studentId: s.student_id,
          subject: teacher.subject,
          score: s.score,
          semester,
          examType: exam_type,
          examName,
          teacher: teacher.name,
        },
      })
      results.push(formatGrade(gradeRecord))
    }

    await recalcRankForGrade(grade, teacher.subject, semester, examName)

    return res.json({ ok: true, updated: results.length, subject: teacher.subject })
  } catch (err) {
    next(err)
  }
})

// GET /api/grades/subject/:grade/:classNum — 담당 과목의 특정 반 학생 목록 + 성적 (과목 담당교사)
router.get('/subject/:grade/:classNum', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const teacher = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!teacher?.subject) {
      return res.status(403).json({ error: '담당 과목이 지정되지 않았습니다' })
    }

    const grade = Number(req.params.grade)
    const classNum = Number(req.params.classNum)

    const students = await prisma.user.findMany({
      where: {
        role: 'student',
        grade,
        classNum,
        isActive: true,
      },
      orderBy: { number: 'asc' },
    })

    const semester = (req.query.semester as string) || '1-1'
    const grades = await prisma.grade.findMany({
      where: {
        studentId: { in: students.map(s => s.id) },
        subject: teacher.subject,
        semester,
      },
    })

    return res.json({
      grade,
      class_num: classNum,
      subject: teacher.subject,
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

// GET /api/grades/view — 교사용 성적 조회 (담임 여부 무관, 학년+반+학기 기준)
router.get('/view', requireAuth, requireTeacher, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const gradeNum = Number(req.query.grade)
    const classNum = Number(req.query.class_num)
    const semester = (req.query.semester as string) || '1-1'
    const subject = req.query.subject as string | undefined
    const examType = req.query.exam_type as string | undefined

    if (!gradeNum || !classNum) {
      return res.status(400).json({ error: '학년과 반을 입력해주세요' })
    }

    const students = await prisma.user.findMany({
      where: { role: 'student', grade: gradeNum, classNum, isActive: true },
      orderBy: { number: 'asc' },
    })

    const where: any = {
      studentId: { in: students.map(s => s.id) },
      semester,
    }
    if (subject) where.subject = subject
    if (examType) where.examType = examType

    const grades = await prisma.grade.findMany({ where })

    return res.json({
      grade: gradeNum,
      class_num: classNum,
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

export default router