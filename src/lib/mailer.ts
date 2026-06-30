import { BrevoClient } from '@getbrevo/brevo'

if (!process.env.BREVO_API_KEY) {
  console.warn('[mailer] ⚠️  BREVO_API_KEY 환경변수가 설정되지 않았습니다. 이메일 전송이 실패합니다.')
}

const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY || '' })

const FROM = { email: 'bagj96792@gmail.com', name: 'Harang 학교 소통 플랫폼' }

export async function sendPasswordResetEmail(to: string, code: string, name: string) {
  await client.transactionalEmails.sendTransacEmail({
    sender: FROM,
    to: [{ email: to }],
    subject: '[Harang] 비밀번호 재설정 인증코드',
    htmlContent: `
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
  await client.transactionalEmails.sendTransacEmail({
    sender: FROM,
    to: [{ email: to }],
    subject,
    htmlContent: html,
  })
}