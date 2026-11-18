// 우프 CS 메일(Gmail)로 보낸다. Gmail 앱 비밀번호가 환경변수에 있어야 한다:
//   MAIL_GMAIL_USER=wooof.betters@gmail.com
//   MAIL_GMAIL_APP_PASSWORD=(16자리 앱 비밀번호)
import nodemailer from "nodemailer";

let transport = null;
export function mailConfigured() {
  return Boolean(process.env.MAIL_GMAIL_USER && process.env.MAIL_GMAIL_APP_PASSWORD);
}
export function mailFrom() {
  return process.env.MAIL_GMAIL_USER || "";
}
export async function sendMail({ to, subject, text, replyTo }) {
  if (!mailConfigured()) throw new Error("메일 발송 설정(Gmail 앱 비밀번호)이 아직 없습니다.");
  if (!transport) {
    transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: process.env.MAIL_GMAIL_USER, pass: process.env.MAIL_GMAIL_APP_PASSWORD }
    });
  }
  const info = await transport.sendMail({
    from: `"우프 CS" <${process.env.MAIL_GMAIL_USER}>`,
    to, subject, text, replyTo: replyTo || process.env.MAIL_GMAIL_USER
  });
  return { messageId: info.messageId };
}
