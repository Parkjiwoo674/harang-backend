import nodemailer from 'nodemailer'

if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
  console.warn('[mailer] ⚠️  MAIL_USER 또는 MAIL_PASS 환경변수가 설정되지 않았습니다.')
}

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
})

export async function sendPasswordResetEmail(to: string, code: string, name: string) {
  await transporter.sendMail({
    from: `"Harang 학교 소통 플랫폼" <${process.env.MAIL_USER}>`,
    to,
    subject: '[Harang] 비밀번호 재설정 인증코드',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8e6; border-radius: 12px;">
        <h2 style="color: #1a7a6e; margin-bottom: 8px;">비밀번호 재설정</h2>
        <p style="color: #3d5a56; margin-bottom: 24px;">안녕하세요, <strong>${name}</strong>님!</p>
        <p style="color: #3d5a56;">아래 인증코드를 입력해주세요.</p>
        <div style="background: #f0f9f7; border: 2px solid #1a7a6e; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0;">
          <span style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #1a7a6e;">${code}</span>
        </div>
        <p style="color: #aab8b5; font-size: 13px;">• 인증코드는 <strong>10분간</strong> 유효합니다.</p>
        <p style="color: #aab8b5; font-size: 13px;">• 본인이 요청하지 않았다면 이 메일을 무시해주세요.</p>
      </div>
    `,
  })
}

export async function sendMail({ to, subject, html }: { to: string; subject: string; html: string }) {
  await transporter.sendMail({
    from: `"Harang 학교 소통 플랫폼" <${process.env.MAIL_USER}>`,
    to,
    subject,
    html,
  })
}