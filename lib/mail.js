const path = require("path");
const nodemailer = require("nodemailer");
const ejs = require("ejs");
const { readProjectEnv } = require("./env");

function mailConfig() {
  const env = readProjectEnv();
  return {
    host: env.EMAIL_HOST || "smtp.dreamhost.com",
    user: env.EMAIL_USER || "",
    pass: env.EMAIL_PASS || "",
    adminEmail: env.ADMIN_EMAIL || "",
    thisUrl: String(env.THIS_URL || "http://localhost:3000").replace(/\/$/, ""),
  };
}

function createTransporter() {
  const { host, user, pass } = mailConfig();
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: 465,
    secure: true,
    auth: { user, pass },
  });
}

async function renderTemplate(template, data) {
  const file = path.join(__dirname, "..", "views", "emails", template);
  return ejs.renderFile(file, data);
}

async function sendMail({ to, subject, template, data, text }) {
  const { user } = mailConfig();
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("[mail] EMAIL_USER/EMAIL_PASS not configured; skipping send.");
    return false;
  }
  if (!to) {
    console.warn(`[mail] No recipient for "${subject}"; skipping send.`);
    return false;
  }
  const html = await renderTemplate(template, data);
  await transporter.sendMail({
    from: user,
    to,
    subject,
    text,
    html,
  });
  return true;
}

async function notifyAdminNewPrint(job) {
  const { adminEmail, thisUrl } = mailConfig();
  const url = `${thisUrl}/`;
  try {
    await sendMail({
      to: adminEmail,
      subject: `New print queued: ${job.title}`,
      template: "admin-new-print.ejs",
      data: { job, url },
      text: [
        `A new print was added to the queue.`,
        ``,
        `Title: ${job.title}`,
        `Ordered by: ${job.userName} (${job.userEmail || "no email"})`,
        `Cost: ${job.amount} digipogs`,
        `Job #${job.id}`,
        ``,
        `View the queue: ${url}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("[mail] Failed to notify admin of new print:", err.message);
  }
}

async function notifyUserPrintComplete(job) {
  const { thisUrl } = mailConfig();
  const url = `${thisUrl}/`;
  try {
    await sendMail({
      to: job.user_email || job.userEmail,
      subject: `Your print is ready: ${job.title}`,
      template: "print-complete.ejs",
      data: {
        job,
        userName: job.user_name || job.userName,
        url,
      },
      text: [
        `Hi ${job.user_name || job.userName || "there"},`,
        ``,
        `Your print "${job.title}" is done and ready for pickup.`,
        ``,
        `Open the print site: ${url}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("[mail] Failed to notify user of completed print:", err.message);
  }
}

module.exports = {
  notifyAdminNewPrint,
  notifyUserPrintComplete,
};
