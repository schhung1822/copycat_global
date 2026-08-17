import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env.js';

/**
 * Gửi mail qua SMTP.
 *
 * Transporter được tạo MỘT LẦN rồi dùng lại cho mọi mail: nodemailer giữ sẵn kết
 * nối trong pool, tạo mới mỗi lần gửi thì mỗi mail phải bắt tay TLS lại từ đầu.
 *
 * Tạo lười (chỉ khi gửi mail đầu tiên) để server vẫn khởi động được khi chưa cấu
 * hình SMTP — mọi chức năng khác không liên quan gì tới mail.
 */

let transporter: Transporter | null = null;

export const isMailConfigured = (): boolean => Boolean(env.smtp.host && env.smtp.user);

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
      pool: true,
    });
  }
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  /** Bản chữ thuần cho trình đọc mail không hiện HTML, và để bớt bị coi là spam. */
  text: string;
}

export async function sendMail(mail: MailInput): Promise<void> {
  if (!isMailConfigured()) {
    throw new Error('Chưa cấu hình SMTP_HOST / SMTP_USER trong .env.');
  }

  await getTransporter().sendMail({
    from: `"${env.smtp.fromName}" <${env.smtp.from}>`,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

/**
 * Kiểm tra cấu hình SMTP bằng cách bắt tay thật với máy chủ mail.
 *
 * Dùng ở trang Quản trị để admin biết ngay mình điền đúng hay sai, thay vì phải
 * đợi một khách nào đó bấm quên mật khẩu rồi mới phát hiện ra.
 */
export async function verifyMailConnection(): Promise<void> {
  if (!isMailConfigured()) throw new Error('Chưa cấu hình SMTP_HOST / SMTP_USER trong .env.');
  await getTransporter().verify();
}

/** Chèn giá trị vào HTML — chặn thẻ và dấu nháy do người dùng nhập. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Mail đặt lại mật khẩu.
 *
 * Viết HTML thủ công với style nội tuyến chứ không dùng thư viện template: phần
 * lớn ứng dụng mail bỏ hết thẻ <style>, nên style phải nằm ngay trên từng thẻ.
 * Bố cục một cột, bảng lồng bảng — đây vẫn là cách duy nhất hiển thị đúng trên
 * cả Outlook lẫn Gmail.
 */
export function buildPasswordResetMail(input: { name: string | null; link: string; minutes: number }): MailInput {
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : 'Hi there,';
  const link = escapeHtml(input.link);

  const html = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:32px 12px;font-family:Arial,Helvetica,sans-serif">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#E60023;padding:20px 28px">
        <span style="color:#ffffff;font-size:17px;font-weight:bold">Design Copycat AI</span>
      </td></tr>

      <tr><td style="padding:28px">
        <p style="margin:0 0 14px;font-size:15px;color:#1a1a18">${greeting}</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3f3e3a">
          We received a request to reset the password for your account.
          Click the button below to choose a new one.
        </p>

        <p style="margin:24px 0">
          <a href="${link}" style="display:inline-block;background:#E60023;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 28px;border-radius:999px">
            Reset password
          </a>
        </p>

        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#5c5b56">
          This link works <strong>once</strong> and expires in
          <strong>${input.minutes} minutes</strong>.
        </p>
        <p style="margin:0 0 6px;font-size:13px;color:#75736d">Button not working? Paste this address into your browser:</p>
        <p style="margin:0 0 20px;font-size:12px;word-break:break-all"><a href="${link}" style="color:#E60023">${link}</a></p>

        <p style="margin:0;padding-top:18px;border-top:1px solid #ebebe9;font-size:13px;line-height:1.6;color:#75736d">
          If you did not ask for a password reset, just ignore this email — your current password stays unchanged.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`.trim();

  const text = [
    input.name ? `Hi ${input.name},` : 'Hi there,',
    '',
    'We received a request to reset the password for your account.',
    'Open this link to choose a new one:',
    input.link,
    '',
    `The link works once and expires in ${input.minutes} minutes.`,
    'If you did not ask for a password reset, just ignore this email.',
  ].join('\n');

  return { to: '', subject: 'Reset your Design Copycat AI password', html, text };
}
