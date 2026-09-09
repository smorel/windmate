const nodemailer = require('nodemailer');
const { formatRideAlert } = require('../utils/copy');

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.ALERT_EMAIL_TO);
}

function createTransport() {
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const auth = process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
    : undefined;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth,
  });
}

/**
 * @param {{ subject: string, text: string, html: string }} alert
 */
async function sendAlert(alert) {
  if (!isConfigured()) {
    console.warn('[email] Skipping alert — SMTP_HOST or ALERT_EMAIL_TO not set');
    return false;
  }

  const transport = createTransport();
  await transport.sendMail({
    from: process.env.ALERT_EMAIL_FROM ?? process.env.SMTP_USER ?? 'windmate@localhost',
    to: process.env.ALERT_EMAIL_TO,
    subject: alert.subject,
    text: alert.text,
    html: alert.html,
  });
  return true;
}

/**
 * @param {string} spotName
 * @param {{ startHour: string, endHour: string, maxWind: number, direction: string }} window
 */
function formatAlert(spotName, window) {
  return formatRideAlert(spotName, window);
}

module.exports = { sendAlert, formatAlert, isConfigured };
