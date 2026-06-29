import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { signToken } from '../lib/jwt'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

const AVATAR_COLORS = [
  '#22c55e', '#8b5cf6', '#3b82f6', '#f97316', '#ef4444',
  '#1a7a6e', '#6366f1', '#0ea5e9', '#d946ef', '#14b8a6',
]

const SignupSchema = z
  .object({
    username: z.string().min(2).max(50),
    password: z.string().min(4),
    name: z.string().min(1).max(50),
    role: z.enum(["student", "teacher"]).default("student"),
    grade: z.number().int().optional(),
    class_num: z.number().int().optional(),
    number: z.number().int().optional(),
    subject: z.string().optional(),
    homeroom_grade: z.number().int().optional(),
    homeroom_class_num: z.number().int().optional(),
    phone: z.string().optional(),
    email: z.string().email().min(1, "이메일은 필수입니다"),
    teacher_code: z.string().optional(),
  })
  .refine(
    (d) =>
      d.role !== "student" ||
      (d.grade != null && d.class_num != null && d.number != null),
    { message: "학생은 학년/반/번호가 모두 필요합니다" },
  )
  .refine(
    (d) => d.role !== "teacher" || (d.subject && d.subject.trim().length > 0),
    { message: "선생님은 담당 과목이 필요합니다" },
  )
  .refine(
    (d) =>
      d.role !== "teacher" ||
      (d.teacher_code && d.teacher_code.trim().length > 0),
    { message: "교사 인증 코드가 필요합니다" },
  )
  .refine(
    (d) => {
      // 담임 학년/반은 둘 다 있거나 둘 다 없거나
      const a = d.homeroom_grade != null;
      const b = d.homeroom_class_num != null;
      return a === b;
    },
    { message: "담임 학년과 반은 함께 입력해야 합니다" },
  );

const LoginSchema = z.object({
  username: z.string(),
  password: z.string(),
})

// POST /api/auth/signup
router.post(
  "/signup",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SignupSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
      const data = parsed.data;

      const existing = await prisma.user.findUnique({
        where: { username: data.username },
      });
      if (existing)
        return res.status(400).json({ error: "이미 사용 중인 아이디입니다" });

      // 교사 인증코드 검증
      if (data.role === "teacher") {
        const code = await prisma.teachercode.findUnique({
          where: { code: data.teacher_code! },
        });
        if (!code)
          return res
            .status(400)
            .json({ error: "유효하지 않은 인증 코드입니다" });
        if (code.isUsed)
          return res.status(400).json({ error: "이미 사용된 인증 코드입니다" });
      }

      const colorIdx = data.name.charCodeAt(0) % AVATAR_COLORS.length;
      const avatarColor = AVATAR_COLORS[colorIdx];
      const avatarText =
        data.role === "teacher" ? data.name[0] + "T" : data.name[0];

      const user = await prisma.user.create({
        data: {
          username: data.username,
          hashedPassword: await bcrypt.hash(data.password, 10),
          name: data.name,
          role: data.role,
          grade: data.grade,
          classNum: data.class_num,
          number: data.number,
          subject: data.subject,
          homeroomGrade: data.homeroom_grade,
          homeroomClassNum: data.homeroom_class_num,
          phone: data.phone,
          email: data.email,
          avatarText,
          avatarColor,
        },
      });

      // 사용된 코드 처리
      if (data.role === "teacher") {
        await prisma.teachercode.update({
          where: { code: data.teacher_code! },
          data: { isUsed: true, usedById: user.id },
        });
      }

      return res.status(201).json(formatUser(user));
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: '입력값을 확인해주세요' })

    const user = await prisma.user.findUnique({ where: { username: parsed.data.username } })
    if (!user) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' })

    const valid = await bcrypt.compare(parsed.data.password, user.hashedPassword)
    if (!valid) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' })

    const token = signToken({ userId: user.id })
    return res.json({ access_token: token, token_type: 'bearer' })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' })
    return res.json(formatUser(user))
  } catch (err) {
    next(err)
  }
})

export function formatUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    grade: user.grade,
    class_num: user.classNum,
    number: user.number,
    subject: user.subject,
    homeroom_grade: user.homeroomGrade,
    homeroom_class_num: user.homeroomClassNum,
    avatar_text: user.avatarText,
    avatar_color: user.avatarColor,
    bio: user.bio,
    phone: user.phone,
    email: user.email,
    profile_image: user.profileImage || null,
  };
}

export default router