const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const API_BASE_URL = "https://api.supabase.com/v1";
const SUPPORT_EMAIL = "suporte@infiniteprofit.com.br";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

function paragraph(content) {
  return `<p style="margin:0 0 18px;color:#526071;font-size:15px;line-height:1.7;">${content}</p>`;
}

function securityNotice(content) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border-collapse:separate;">
    <tr>
      <td style="padding:14px 16px;border:1px solid #f4c56a;border-radius:10px;background:#fff8e8;color:#725118;font-size:13px;line-height:1.6;">
        ${content}
      </td>
    </tr>
  </table>`;
}

function emailLayout({
  preheader,
  eyebrow,
  title,
  content,
  action,
  footer = "Este é um e-mail automático de segurança.",
}) {
  const actionMarkup = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 24px;">
        <tr>
          <td bgcolor="#47d7a2" style="border-radius:10px;">
            <a href="${action.url}" style="display:inline-block;padding:14px 22px;color:#0d1728;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">${action.label}</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 8px;color:#7b8794;font-size:12px;line-height:1.6;">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
      <p style="margin:0;color:#526071;font-size:12px;line-height:1.6;word-break:break-all;"><a href="${action.url}" style="color:#168b69;text-decoration:underline;">${action.url}</a></p>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f6f5;font-family:Arial,'Helvetica Neue',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f6f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:separate;">
            <tr>
              <td style="padding:22px 26px;border-radius:16px 16px 0 0;background:#0d1728;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="38" height="38" align="center" bgcolor="#47d7a2" style="width:38px;height:38px;border-radius:10px;color:#0d1728;font-size:14px;font-weight:800;">IP</td>
                    <td style="padding-left:12px;color:#f4f8f7;font-size:17px;font-weight:700;letter-spacing:-.2px;">Infinite Profit</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 30px 30px;border:1px solid #dfe7e4;border-top:0;border-radius:0 0 16px 16px;background:#ffffff;">
                <p style="margin:0 0 10px;color:#168b69;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">${eyebrow}</p>
                <h1 style="margin:0 0 18px;color:#0d1728;font-size:25px;line-height:1.25;letter-spacing:-.4px;">${title}</h1>
                ${content}
                ${actionMarkup}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:30px;border-top:1px solid #e7ecea;">
                  <tr>
                    <td style="padding-top:20px;color:#89948f;font-size:12px;line-height:1.6;">
                      ${footer}<br>
                      Precisa de ajuda? <a href="mailto:${SUPPORT_EMAIL}" style="color:#526071;text-decoration:underline;">${SUPPORT_EMAIL}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:18px;color:#95a09b;font-size:11px;line-height:1.5;">
                Infinite Profit · Inteligência para operações de performance
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export const authEmailConfiguration = {
  mailer_subjects_confirmation: "Confirme seu e-mail | Infinite Profit",
  mailer_templates_confirmation_content: emailLayout({
    preheader: "Confirme seu e-mail para ativar sua conta no Infinite Profit.",
    eyebrow: "Ativação da conta",
    title: "Confirme seu e-mail",
    content:
      paragraph("Você está a um passo de acessar seus funis, fontes de dados e dashboards.") +
      paragraph("Confirme este endereço para concluir a criação da sua conta."),
    action: {
      label: "Confirmar meu e-mail",
      url: "{{ .ConfirmationURL }}",
    },
    footer: "Se você não criou esta conta, pode ignorar esta mensagem.",
  }),

  mailer_subjects_invite: "Seu convite para o Infinite Profit",
  mailer_templates_invite_content: emailLayout({
    preheader: "Você recebeu um convite para acessar o Infinite Profit.",
    eyebrow: "Convite de acesso",
    title: "Você foi convidado",
    content:
      paragraph("Você recebeu acesso ao Infinite Profit para acompanhar uma operação de performance.") +
      paragraph("Aceite o convite para configurar sua conta e entrar na plataforma."),
    action: {
      label: "Aceitar convite",
      url: "{{ .ConfirmationURL }}",
    },
    footer: "Se você não esperava este convite, pode ignorar esta mensagem.",
  }),

  mailer_subjects_magic_link: "Seu acesso ao Infinite Profit",
  mailer_templates_magic_link_content: emailLayout({
    preheader: "Use este link seguro para entrar no Infinite Profit.",
    eyebrow: "Acesso seguro",
    title: "Entre no Infinite Profit",
    content:
      paragraph("Use o botão abaixo para acessar sua conta sem digitar a senha.") +
      paragraph("Por segurança, este link só pode ser usado uma vez e expira em breve."),
    action: {
      label: "Entrar na plataforma",
      url: "{{ .ConfirmationURL }}",
    },
    footer: "Se você não solicitou este acesso, ignore esta mensagem.",
  }),

  mailer_subjects_recovery: "Redefina sua senha | Infinite Profit",
  mailer_templates_recovery_content: emailLayout({
    preheader: "Recebemos uma solicitação para redefinir sua senha.",
    eyebrow: "Recuperação de acesso",
    title: "Redefina sua senha",
    content:
      paragraph("Recebemos uma solicitação para criar uma nova senha para sua conta.") +
      paragraph("Use o botão abaixo para continuar. O link é temporário e só pode ser usado uma vez."),
    action: {
      label: "Criar nova senha",
      url: "{{ .ConfirmationURL }}",
    },
    footer: "Se você não solicitou a troca, ignore esta mensagem e sua senha continuará igual.",
  }),

  mailer_subjects_email_change: "Confirme seu novo e-mail | Infinite Profit",
  mailer_templates_email_change_content: emailLayout({
    preheader: "Confirme a alteração do endereço de e-mail da sua conta.",
    eyebrow: "Segurança da conta",
    title: "Confirme seu novo e-mail",
    content:
      paragraph("Recebemos uma solicitação para alterar o endereço usado para entrar no Infinite Profit.") +
      paragraph("Confirme a mudança para concluir a atualização com segurança."),
    action: {
      label: "Confirmar novo e-mail",
      url: "{{ .ConfirmationURL }}",
    },
    footer: "Se você não solicitou esta alteração, não confirme e fale com nosso suporte.",
  }),

  mailer_subjects_reauthentication: "Seu código de segurança | Infinite Profit",
  mailer_templates_reauthentication_content: emailLayout({
    preheader: "Use este código para confirmar uma ação sensível.",
    eyebrow: "Verificação de segurança",
    title: "Confirme que é você",
    content:
      paragraph("Use o código abaixo para concluir a ação solicitada:") +
      `<p style="margin:24px 0;padding:16px;border:1px solid #cfe1da;border-radius:12px;background:#f4faf7;color:#0d1728;font-family:'Courier New',monospace;font-size:28px;font-weight:700;letter-spacing:7px;text-align:center;">{{ .Token }}</p>` +
      paragraph("O código expira em breve. Não compartilhe com ninguém."),
    footer: "Se você não iniciou esta ação, altere sua senha e fale com nosso suporte.",
  }),

  mailer_subjects_password_changed_notification: "Sua senha foi alterada | Infinite Profit",
  mailer_templates_password_changed_notification_content: emailLayout({
    preheader: "A senha da sua conta foi alterada.",
    eyebrow: "Aviso de segurança",
    title: "Sua senha foi alterada",
    content:
      paragraph("A alteração da senha da sua conta foi concluída.") +
      securityNotice("Não reconhece esta atividade? Redefina sua senha imediatamente e fale com nosso suporte."),
  }),

  mailer_subjects_email_changed_notification: "Seu e-mail foi alterado | Infinite Profit",
  mailer_templates_email_changed_notification_content: emailLayout({
    preheader: "O e-mail de acesso da sua conta foi alterado.",
    eyebrow: "Aviso de segurança",
    title: "Seu e-mail foi alterado",
    content:
      paragraph("O endereço usado para entrar na sua conta foi atualizado com sucesso.") +
      securityNotice("Não reconhece esta atividade? Fale com nosso suporte imediatamente para proteger sua conta."),
  }),

  mailer_subjects_phone_changed_notification: "Seu telefone foi alterado | Infinite Profit",
  mailer_templates_phone_changed_notification_content: emailLayout({
    preheader: "O telefone associado à sua conta foi alterado.",
    eyebrow: "Aviso de segurança",
    title: "Seu telefone foi alterado",
    content:
      paragraph("O telefone associado à sua conta foi atualizado com sucesso.") +
      securityNotice("Não reconhece esta atividade? Fale com nosso suporte imediatamente."),
  }),

  mailer_subjects_mfa_factor_enrolled_notification: "Nova verificação adicionada | Infinite Profit",
  mailer_templates_mfa_factor_enrolled_notification_content: emailLayout({
    preheader: "Uma nova verificação em duas etapas foi adicionada.",
    eyebrow: "Aviso de segurança",
    title: "Nova verificação adicionada",
    content:
      paragraph("Um novo método de verificação em duas etapas foi ativado na sua conta.") +
      securityNotice("Não reconhece esta atividade? Altere sua senha e fale com nosso suporte imediatamente."),
  }),

  mailer_subjects_mfa_factor_unenrolled_notification: "Verificação removida | Infinite Profit",
  mailer_templates_mfa_factor_unenrolled_notification_content: emailLayout({
    preheader: "Uma verificação em duas etapas foi removida.",
    eyebrow: "Aviso de segurança",
    title: "Verificação removida",
    content:
      paragraph("Um método de verificação em duas etapas foi removido da sua conta.") +
      securityNotice("Não reconhece esta atividade? Altere sua senha e fale com nosso suporte imediatamente."),
  }),

  mailer_subjects_identity_linked_notification: "Novo acesso conectado | Infinite Profit",
  mailer_templates_identity_linked_notification_content: emailLayout({
    preheader: "Um novo método de acesso foi conectado à sua conta.",
    eyebrow: "Aviso de segurança",
    title: "Novo acesso conectado",
    content:
      paragraph("Um novo provedor de login foi conectado à sua conta.") +
      securityNotice("Não reconhece esta atividade? Altere sua senha e fale com nosso suporte imediatamente."),
  }),

  mailer_subjects_identity_unlinked_notification: "Acesso desconectado | Infinite Profit",
  mailer_templates_identity_unlinked_notification_content: emailLayout({
    preheader: "Um método de acesso foi desconectado da sua conta.",
    eyebrow: "Aviso de segurança",
    title: "Acesso desconectado",
    content:
      paragraph("Um provedor de login foi desconectado da sua conta.") +
      securityNotice("Não reconhece esta atividade? Altere sua senha e fale com nosso suporte imediatamente."),
  }),
};

function validateConfiguration(configuration) {
  const requiredActions = [
    "confirmation",
    "invite",
    "magic_link",
    "recovery",
    "email_change",
  ];

  for (const name of requiredActions) {
    const template = configuration[`mailer_templates_${name}_content`];
    if (!template?.includes("{{ .ConfirmationURL }}")) {
      throw new Error(`Template ${name} não contém {{ .ConfirmationURL }}.`);
    }
  }

  if (!configuration.mailer_templates_reauthentication_content.includes("{{ .Token }}")) {
    throw new Error("Template de reautenticação não contém {{ .Token }}.");
  }

  for (const [key, value] of Object.entries(configuration)) {
    if (!value || typeof value !== "string") {
      throw new Error(`Configuração inválida em ${key}.`);
    }
  }
}

async function main() {
  validateConfiguration(authEmailConfiguration);

  if (process.argv.includes("--validate")) {
    console.log(`Templates válidos: ${Object.keys(authEmailConfiguration).length / 2} fluxos.`);
    return;
  }

  if (!PROJECT_REF || !ACCESS_TOKEN) {
    throw new Error(
      "Defina SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN para publicar os templates.",
    );
  }

  let response;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    response = await fetch(`${API_BASE_URL}/projects/${PROJECT_REF}/config/auth`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(authEmailConfiguration),
    });

    if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status)) break;
    if (attempt === MAX_ATTEMPTS) break;

    const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 8_000);
    console.warn(
      `Supabase respondeu HTTP ${response.status}; nova tentativa em ${delayMs / 1_000}s.`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!response?.ok) {
    if (!response) throw new Error("A API do Supabase não respondeu.");
    throw new Error(`Supabase respondeu HTTP ${response.status}: ${await response.text()}`);
  }

  const applied = await response.json();
  const subjectKeys = Object.keys(authEmailConfiguration).filter((key) =>
    key.startsWith("mailer_subjects_")
  );
  const confirmed = subjectKeys.filter(
    (key) => applied[key] === authEmailConfiguration[key],
  );

  if (confirmed.length !== subjectKeys.length) {
    throw new Error("O Supabase não confirmou todos os assuntos publicados.");
  }

  console.log(`Templates publicados: ${confirmed.length} fluxos.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
