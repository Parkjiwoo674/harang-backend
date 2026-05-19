import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

const VALID_DAYS = ["월", "화", "수", "목", "금"];

// 담임 권한 체크 헬퍼
async function requireHomeroom(
  userId: number,
  grade: number,
  classNum: number,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user)
    return { ok: false, status: 404, msg: "사용자를 찾을 수 없습니다" };
  if (user.role !== "teacher")
    return {
      ok: false,
      status: 403,
      msg: "선생님만 시간표를 수정할 수 있습니다",
    };
  if (user.homeroomGrade !== grade || user.homeroomClassNum !== classNum)
    return {
      ok: false,
      status: 403,
      msg: "본인 담임 학급의 시간표만 수정할 수 있습니다",
    };
  return { ok: true };
}

// GET /api/schedule/timetable?grade=&class_num=
router.get(
  "/timetable",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      let grade = Number(req.query.grade) || undefined;
      let classNum = Number(req.query.class_num) || undefined;

      // 학생이면 본인 학급 자동 사용 (쿼리 무시)
      if (req.user!.role === "student") {
        const user = await prisma.user.findUnique({
          where: { id: req.user!.id },
        });
        grade = user?.grade ?? undefined;
        classNum = user?.classNum ?? undefined;
      }
      // 교사인데 쿼리 없으면 본인 담임 학급 기본값
      else if (!grade || !classNum) {
        const user = await prisma.user.findUnique({
          where: { id: req.user!.id },
        });
        grade = grade ?? user?.homeroomGrade ?? undefined;
        classNum = classNum ?? user?.homeroomClassNum ?? undefined;
      }

      if (!grade || !classNum) return res.json([]);

      const items = await prisma.schedule.findMany({
        where: { grade, classNum },
        orderBy: [{ day: "asc" }, { period: "asc" }],
      });
      return res.json(
        items.map((s: any) => ({
          id: s.id,
          grade: s.grade,
          class_num: s.classNum,
          day: s.day,
          period: s.period,
          subject: s.subject,
          teacher: s.teacher,
          room: s.room,
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/schedule/timetable  (담임 교사 전용)
const UpsertSchema = z.object({
  grade: z.number().int(),
  class_num: z.number().int(),
  day: z.enum(["월", "화", "수", "목", "금"]),
  period: z.number().int().min(1).max(10),
  subject: z.string().min(1),
  teacher: z.string().optional(),
  room: z.string().optional(),
});

router.post(
  "/timetable",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = UpsertSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
      const d = parsed.data;

      const auth = await requireHomeroom(req.user!.id, d.grade, d.class_num);
      if (!auth.ok) return res.status(auth.status!).json({ error: auth.msg });

      // 같은 (grade, classNum, day, period) 있으면 덮어쓰기
      const existing = await prisma.schedule.findFirst({
        where: {
          grade: d.grade,
          classNum: d.class_num,
          day: d.day,
          period: d.period,
        },
      });
      const saved = existing
        ? await prisma.schedule.update({
            where: { id: existing.id },
            data: { subject: d.subject, teacher: d.teacher, room: d.room },
          })
        : await prisma.schedule.create({
            data: {
              grade: d.grade,
              classNum: d.class_num,
              day: d.day,
              period: d.period,
              subject: d.subject,
              teacher: d.teacher,
              room: d.room,
            },
          });

      return res.status(existing ? 200 : 201).json({
        id: saved.id,
        grade: saved.grade,
        class_num: saved.classNum,
        day: saved.day,
        period: saved.period,
        subject: saved.subject,
        teacher: saved.teacher,
        room: saved.room,
      });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/schedule/timetable/:id  (담임 교사 전용)
router.delete(
  "/timetable/:id",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "잘못된 ID입니다" });

      const item = await prisma.schedule.findUnique({ where: { id } });
      if (!item)
        return res
          .status(404)
          .json({ error: "시간표 항목을 찾을 수 없습니다" });

      const auth = await requireHomeroom(
        req.user!.id,
        item.grade,
        item.classNum,
      );
      if (!auth.ok) return res.status(auth.status!).json({ error: auth.msg });

      await prisma.schedule.delete({ where: { id } });
      return res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/schedule/events
router.get(
  "/events",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const events = await prisma.schoolEvent.findMany({
        orderBy: { eventDate: "asc" },
      });
      return res.json(
        events.map((e: any) => ({
          id: e.id,
          title: e.title,
          event_type: e.eventType,
          event_date: e.eventDate,
          description: e.description,
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
