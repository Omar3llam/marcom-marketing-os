// ============================================================
// MARCOM — Email Notification Utility
// Transporter is created lazily so the server starts even when
// Gmail is not configured. All interpolated values are HTML-escaped
// before insertion into email templates.
// ============================================================
import nodemailer from 'nodemailer';
import { logger } from './logger.js';

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

// ── ONBOARDING COMPLETE NOTIFICATION ─────────────────────────
export async function sendNotification({ subject, sessionId, contextSummary }) {
  const transporter = getTransporter();
  if (!transporter) {
    logger.info('[EMAIL] Not configured — skipping onboarding notification');
    return;
  }

  await transporter.sendMail({
    from: `"MARCOM" <${process.env.GMAIL_USER}>`,
    to: process.env.NOTIFICATION_EMAIL,
    subject: escHtml(subject),
    html: `
      <div style="font-family: monospace; background: #080808; color: #f2f0eb; padding: 32px; border-radius: 4px;">
        <h2 style="color: #c9a84c; border-bottom: 1px solid #2a2a2a; padding-bottom: 12px;">
          🎯 New Client Onboarding Complete
        </h2>
        <p><strong>Session ID:</strong> ${escHtml(sessionId)}</p>
        <p><strong>Completed At:</strong> ${escHtml(new Date().toLocaleString())}</p>
        <h3 style="color: #c9a84c; margin-top: 24px;">Context Summary:</h3>
        <pre style="background: #111; padding: 16px; border-left: 2px solid #c9a84c; white-space: pre-wrap; font-size: 13px; line-height: 1.6;">${escHtml(contextSummary || 'Not available')}</pre>
        <p style="color: #666; margin-top: 24px; font-size: 12px;">View full session in the database.</p>
      </div>
    `,
  });
}

// ── TEAM INVITE ───────────────────────────────────────────────
// Sends the workspace invitation to the invitee. Returns { sent: boolean } so
// callers can honestly report whether the mail actually went out — when Gmail
// is not configured this no-ops gracefully (the invite still works: the join is
// email-matched in the firebaseAuth seam, the email is just the delivery hint).
export async function sendInviteEmail({ to, workspaceName, inviterName, role, acceptUrl, expiresInDays = 7 }) {
  const transporter = getTransporter();
  if (!transporter) {
    logger.info({ to }, '[EMAIL] Not configured — skipping team invite email');
    return { sent: false };
  }

  await transporter.sendMail({
    from: `"MARCOM" <${process.env.GMAIL_USER}>`,
    to,
    subject: `You've been invited to ${escHtml(workspaceName)} on Lumi`,
    html: `
      <div style="font-family: monospace; background: #080808; color: #f2f0eb; padding: 32px; border-radius: 4px;">
        <h2 style="color: #c9a84c; border-bottom: 1px solid #2a2a2a; padding-bottom: 12px;">
          You've been invited to Lumi
        </h2>
        <p><strong>${escHtml(inviterName)}</strong> invited you to join
           <strong>${escHtml(workspaceName)}</strong> as <strong>${escHtml(role)}</strong>.</p>
        <p style="margin-top: 24px;">
          <a href="${escHtml(acceptUrl)}" style="background: #c9a84c; color: #080808; padding: 12px 20px; border-radius: 4px; text-decoration: none; font-weight: bold;">
            Accept invitation
          </a>
        </p>
        <p style="color: #666; margin-top: 24px; font-size: 12px;">
          This invitation expires in ${escHtml(expiresInDays)} days. If you weren't expecting it, you can ignore this email.
        </p>
      </div>
    `,
  });
  return { sent: true };
}

// ── ERROR ALERT ───────────────────────────────────────────────
export async function sendErrorAlert({ error, sessionId, mode }) {
  const transporter = getTransporter();
  if (!transporter) {
    logger.info('[EMAIL] Not configured — skipping error alert');
    return;
  }

  await transporter.sendMail({
    from: `"MARCOM Alerts" <${process.env.GMAIL_USER}>`,
    to: process.env.NOTIFICATION_EMAIL,
    subject: `MARCOM Error | ${escHtml(mode)} | Session ${escHtml(sessionId)}`,
    html: `
      <div style="font-family: monospace; background: #080808; color: #f2f0eb; padding: 32px; border-radius: 4px;">
        <h2 style="color: #c0392b; border-bottom: 1px solid #2a2a2a; padding-bottom: 12px;">
          System Error Detected
        </h2>
        <p><strong>Mode:</strong> ${escHtml(mode)}</p>
        <p><strong>Session ID:</strong> ${escHtml(sessionId)}</p>
        <p><strong>Time:</strong> ${escHtml(new Date().toLocaleString())}</p>
        <h3 style="color: #c0392b; margin-top: 24px;">Error:</h3>
        <pre style="background: #111; padding: 16px; border-left: 2px solid #c0392b; white-space: pre-wrap; font-size: 13px;">${escHtml(error)}</pre>
        <p style="color: #666; margin-top: 24px; font-size: 12px;">Check server logs for full stack trace.</p>
      </div>
    `,
  });
}
