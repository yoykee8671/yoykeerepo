// 우프 CS 메일(Gmail)로 보낸다. 계정·앱 비밀번호는 pay 알림 설정에서 넣고(암호화 저장),
// 없으면 환경변수 MAIL_GMAIL_USER / MAIL_GMAIL_APP_PASSWORD 를 쓴다.
import nodemailer from "nodemailer";

let configured = { user: "", pass: "" };
let transport = null;
export function setMailConfig({ user = "", pass = "" } = {}) {
  const next = { user: String(user || "").trim(), pass: String(pass || "").replace(/\s+/g, "") };
  if (next.user !== configured.user || next.pass !== configured.pass) transport = null;
  configured = next;
}
function current() {
  return {
    user: configured.user || process.env.MAIL_GMAIL_USER || "",
    pass: configured.pass || process.env.MAIL_GMAIL_APP_PASSWORD || ""
  };
}
export function mailConfigured() {
  const c = current();
  return Boolean(c.user && c.pass);
}
export function mailFrom() {
  return current().user;
}
export async function sendMail({ to, subject, text, replyTo }) {
  const c = current();
  if (!c.user || !c.pass) throw new Error("메일 발송 설정(Gmail 앱 비밀번호)이 아직 없습니다. 관리/설정 › 알림 설정에서 넣어 주세요.");
  if (!transport) {
    transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: c.user, pass: c.pass } });
  }
  try {
    const info = await transport.sendMail({ from: `"우프 CS" <${c.user}>`, to, subject, text, replyTo: replyTo || c.user });
    return { messageId: info.messageId };
  } catch (error) {
    transport = null;
    if (/Invalid login|Username and Password not accepted|535/i.test(error.message)) throw new Error("Gmail 로그인 실패 — 앱 비밀번호가 맞는지, 2단계 인증이 켜져 있는지 확인하세요.");
    throw error;
  }
}
