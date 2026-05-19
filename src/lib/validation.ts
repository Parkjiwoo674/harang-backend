import { z } from 'zod'

// ── 인증 관련 ──────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email('올바른 이메일 형식이 아닙니다.'),
  password: z.string().min(1, '비밀번호를 입력해주세요.')
})

export const signupSchema = z.object({
  email: z.string().email('올바른 이메일 형식이 아닙니다.'),
  password: z.string().min(6, '비밀번호는 최소 6자 이상이어야 합니다.'),
  name: z.string().min(2, '이름은 최소 2자 이상이어야 합니다.'),
  role: z.enum(['STUDENT', 'TEACHER', 'PARENT'], {
    errorMap: () => ({ message: '역할은 STUDENT, TEACHER, PARENT 중 하나여야 합니다.' })
  }),
  teacherCode: z.string().optional(),
  grade: z.number().int().min(1).max(6).optional(),
  classNumber: z.number().int().min(1).max(20).optional()
})

// ── 공지사항 관련 ──────────────────────────────────────────
export const createAnnouncementSchema = z.object({
  title: z.string().min(1, '제목을 입력해주세요.').max(200, '제목은 200자 이하여야 합니다.'),
  content: z.string().min(1, '내용을 입력해주세요.'),
  targetGrade: z.number().int().min(1).max(6).optional(),
  targetClass: z.number().int().min(1).max(20).optional()
})

export const updateAnnouncementSchema = createAnnouncementSchema.partial()

// ── 과제 관련 ──────────────────────────────────────────────
export const createAssignmentSchema = z.object({
  title: z.string().min(1, '제목을 입력해주세요.').max(200),
  description: z.string().min(1, '설명을 입력해주세요.'),
  dueDate: z.string().datetime('올바른 날짜 형식이 아닙니다.'),
  targetGrade: z.number().int().min(1).max(6),
  targetClass: z.number().int().min(1).max(20)
})

export const updateAssignmentSchema = createAssignmentSchema.partial()

export const submitAssignmentSchema = z.object({
  content: z.string().min(1, '제출 내용을 입력해주세요.'),
  fileUrl: z.string().url('올바른 URL 형식이 아닙니다.').optional()
})

// ── 성적 관련 ──────────────────────────────────────────────
export const createGradeSchema = z.object({
  studentId: z.string().uuid('올바른 학생 ID가 아닙니다.'),
  subject: z.string().min(1, '과목을 입력해주세요.'),
  score: z.number().min(0).max(100, '점수는 0~100 사이여야 합니다.'),
  semester: z.enum(['1학기', '2학기']),
  examType: z.enum(['중간고사', '기말고사', '수행평가'])
})

export const updateGradeSchema = createGradeSchema.partial().omit({ studentId: true })

// ── 시간표 관련 ────────────────────────────────────────────
export const createScheduleSchema = z.object({
  grade: z.number().int().min(1).max(6),
  classNumber: z.number().int().min(1).max(20),
  dayOfWeek: z.enum(['월', '화', '수', '목', '금']),
  period: z.number().int().min(1).max(7),
  subject: z.string().min(1, '과목을 입력해주세요.'),
  teacherId: z.string().uuid('올바른 교사 ID가 아닙니다.')
})

export const updateScheduleSchema = createScheduleSchema.partial()

// ── Q&A 관련 ───────────────────────────────────────────────
export const createQuestionSchema = z.object({
  title: z.string().min(1, '제목을 입력해주세요.').max(200),
  content: z.string().min(1, '내용을 입력해주세요.'),
  category: z.enum(['학습', '생활', '진로', '기타']).optional()
})

export const createAnswerSchema = z.object({
  content: z.string().min(1, '답변 내용을 입력해주세요.')
})

// ── 채팅 관련 ──────────────────────────────────────────────
export const sendMessageSchema = z.object({
  content: z.string().min(1, '메시지를 입력해주세요.').max(1000, '메시지는 1000자 이하여야 합니다.'),
  receiverId: z.string().uuid('올바른 수신자 ID가 아닙니다.')
})

// ── 사용자 관련 ────────────────────────────────────────────
export const updateProfileSchema = z.object({
  name: z.string().min(2, '이름은 최소 2자 이상이어야 합니다.').optional(),
  email: z.string().email('올바른 이메일 형식이 아닙니다.').optional(),
  phone: z.string().regex(/^010-\d{4}-\d{4}$/, '올바른 전화번호 형식이 아닙니다. (예: 010-1234-5678)').optional()
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '현재 비밀번호를 입력해주세요.'),
  newPassword: z.string().min(6, '새 비밀번호는 최소 6자 이상이어야 합니다.')
})
