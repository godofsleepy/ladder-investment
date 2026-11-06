import nodemailer, { type Transporter } from "nodemailer";

export type Send = (message: { to: string; subject: string; text: string }) => Promise<void>;

/** Email goes over SMTP (SMTP_URL, from EMAIL_FROM). Without SMTP_URL, Ladder sends nothing and says so. */
export const canEmail = () => Boolean(process.env.SMTP_URL);

let transport: Transporter | undefined;

export const sendMail: Send = async ({ to, subject, text }) => {
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from: process.env.EMAIL_FROM ?? "Ladder <no-reply@localhost>", to, subject, text });
};
