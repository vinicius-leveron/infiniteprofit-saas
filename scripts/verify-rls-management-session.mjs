#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const projectRef = required("SUPABASE_PROJECT_REF");
if (process.env.RLS_MANAGEMENT_SESSION_ACK !== projectRef) {
  throw new Error(
    "Defina RLS_MANAGEMENT_SESSION_ACK com o project ref para executar o gate RLS.",
  );
}

const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (await readFile(join(homedir(), ".supabase", "access-token"), "utf8")).trim();
const endpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

const candidates = await runQuery(
  `
    with member_candidate as (
      select
        member.workspace_id,
        member.user_id as member_user_id,
        project.id as project_id,
        coalesce(
          (
            select workspace_admin.user_id
            from public.workspace_members workspace_admin
            where workspace_admin.workspace_id = member.workspace_id
              and workspace_admin.role in ('owner', 'admin')
            order by
              case workspace_admin.role
                when 'owner' then 1
                when 'admin' then 2
                else 3
              end,
              workspace_admin.created_at
            limit 1
          ),
          (
            select organization_admin.user_id
            from public.workspaces workspace
            join public.organization_members organization_admin
              on organization_admin.organization_id =
                workspace.organization_id
            where workspace.id = member.workspace_id
              and organization_admin.role in ('owner', 'admin')
            order by
              case organization_admin.role
                when 'owner' then 1
                when 'admin' then 2
                else 3
              end,
              organization_admin.created_at
            limit 1
          )
        ) as admin_user_id,
        exists (
          select 1
          from public.workspace_integrations integration
          where integration.workspace_id = member.workspace_id
        ) as has_integration,
        exists (
          select 1
          from public.project_checkout_bindings binding
          where binding.project_id = project.id
        ) as has_checkout,
        exists (
          select 1
          from public.workspace_meta_accounts account
          where account.workspace_id = member.workspace_id
        ) as has_meta
      from public.workspace_members member
      join public.projects project
        on project.workspace_id = member.workspace_id
      where member.role = 'member'
      order by
        (
          exists (
            select 1
            from public.workspace_integrations integration
            where integration.workspace_id = member.workspace_id
          )
        ) desc,
        project.updated_at desc
      limit 1
    )
    select *
    from member_candidate
    where admin_user_id is not null
  `,
  { readOnly: true },
);

const candidate = candidates[0];
if (!candidate) {
  throw new Error(
    "Nenhum Cliente com Member, Admin efetivo e Funil foi encontrado para o gate RLS.",
  );
}

for (const value of [
  candidate.workspace_id,
  candidate.member_user_id,
  candidate.admin_user_id,
  candidate.project_id,
]) {
  assertUuid(value);
}

const memberRows = await runAsAuthenticated(
  candidate.member_user_id,
  `
    select
      auth.uid() = ${uuidLiteral(candidate.member_user_id)} as claim_ok,
      app_private.is_workspace_member(
        ${uuidLiteral(candidate.workspace_id)}
      ) as is_member,
      not app_private.is_workspace_admin(
        ${uuidLiteral(candidate.workspace_id)}
      ) as is_not_admin,
      exists (
        select 1
        from public.projects project
        where project.id = ${uuidLiteral(candidate.project_id)}
      ) as project_visible,
      not exists (
        select 1
        from public.get_workspace_integration_safe(
          ${uuidLiteral(candidate.workspace_id)}
        ) integration
        where integration.gateway_webhook_token is not null
      ) as integration_token_redacted,
      not exists (
        select 1
        from public.get_funnel_checkout_binding_safe(
          ${uuidLiteral(candidate.project_id)}
        ) binding
        where binding.webhook_token is not null
      ) as checkout_token_redacted,
      not exists (
        select 1
        from public.list_workspace_meta_accounts_safe(
          ${uuidLiteral(candidate.workspace_id)}
        ) account
        where pg_catalog.to_jsonb(account) ? 'access_token'
      ) as meta_secret_absent
  `,
);
assertAllTrue(memberRows[0], "Member");

await assertPermissionDenied(
  candidate.member_user_id,
  `
    select *
    from public.get_project_sync_settings_safe(
      ${uuidLiteral(candidate.project_id)}
    )
  `,
  "Member project sync settings",
);

const adminRows = await runAsAuthenticated(
  candidate.admin_user_id,
  `
    select
      auth.uid() = ${uuidLiteral(candidate.admin_user_id)} as claim_ok,
      app_private.is_workspace_member(
        ${uuidLiteral(candidate.workspace_id)}
      ) as is_member,
      app_private.is_workspace_admin(
        ${uuidLiteral(candidate.workspace_id)}
      ) as is_admin,
      (
        select pg_catalog.count(*) >= 0
        from public.get_workspace_integration_safe(
          ${uuidLiteral(candidate.workspace_id)}
        )
      ) as integration_contract_available,
      (
        select pg_catalog.count(*) >= 0
        from public.get_funnel_checkout_binding_safe(
          ${uuidLiteral(candidate.project_id)}
        )
      ) as checkout_contract_available,
      (
        select pg_catalog.count(*) = 1
        from public.get_project_sync_settings_safe(
          ${uuidLiteral(candidate.project_id)}
        )
      ) as sync_settings_available,
      not exists (
        select 1
        from public.list_workspace_meta_accounts_safe(
          ${uuidLiteral(candidate.workspace_id)}
        ) account
        where pg_catalog.to_jsonb(account) ? 'access_token'
      ) as meta_secret_absent
  `,
);
assertAllTrue(adminRows[0], "Admin");

const directSecretQueries = [
  [
    "workspace_integrations",
    "select workspace_id from public.workspace_integrations limit 1",
  ],
  [
    "workspace_meta_accounts",
    "select id from public.workspace_meta_accounts limit 1",
  ],
  [
    "project_checkout_bindings",
    "select project_id from public.project_checkout_bindings limit 1",
  ],
  [
    "projects.sync_token",
    `
      select id, sync_token
      from public.projects
      where id = ${uuidLiteral(candidate.project_id)}
    `,
  ],
];

for (const [label, query] of directSecretQueries) {
  await assertPermissionDenied(
    candidate.member_user_id,
    query,
    `Member direct ${label}`,
  );
  await assertPermissionDenied(
    candidate.admin_user_id,
    query,
    `Admin direct ${label}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: "management_read_only_impersonation",
      candidate: {
        has_integration: candidate.has_integration === true,
        has_checkout: candidate.has_checkout === true,
        has_meta: candidate.has_meta === true,
      },
      checks: [
        "member effective role",
        "member webhook tokens redacted",
        "member project sync settings denied",
        "admin safe contracts available",
        "direct credential tables denied to Member and Admin",
        "projects.sync_token denied to Member and Admin",
        "Meta access_token absent from safe contracts",
      ],
    },
    null,
    2,
  ),
);

async function runAsAuthenticated(userId, statement) {
  const claims = sqlText(
    JSON.stringify({ sub: userId, role: "authenticated" }),
  );
  return await runQuery(
    `
      begin read only;
      select pg_catalog.set_config(
        'request.jwt.claims',
        ${claims},
        true
      );
      set local role authenticated;
      ${statement};
      rollback;
    `,
    { readOnly: false },
  );
}

async function assertPermissionDenied(userId, statement, label) {
  try {
    await runAsAuthenticated(userId, statement);
  } catch (error) {
    if (isPermissionDenied(error)) return;
    throw new Error(`${label} falhou por motivo inesperado: ${safeMessage(error)}`);
  }
  throw new Error(`${label} foi permitido indevidamente.`);
}

async function runQuery(query, { readOnly }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      String(body?.message ?? body?.error ?? response.statusText),
    );
    error.status = response.status;
    error.code = body?.code ?? body?.sql_state_code ?? null;
    throw error;
  }
  return Array.isArray(body) ? body : [];
}

function assertAllTrue(row, label) {
  if (!row || Object.values(row).some((value) => value !== true)) {
    const failed = Object.entries(row ?? {})
      .filter(([, value]) => value !== true)
      .map(([key]) => key);
    throw new Error(`${label} RLS checks failed: ${failed.join(", ")}`);
  }
}

function isPermissionDenied(error) {
  return error?.code === "42501" ||
    /permission denied|access denied|42501/i.test(String(error?.message ?? ""));
}

function safeMessage(error) {
  return String(error?.message ?? error ?? "erro desconhecido")
    .replaceAll(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "[uuid]")
    .slice(0, 300);
}

function uuidLiteral(value) {
  assertUuid(value);
  return `'${value}'::uuid`;
}

function assertUuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value))) {
    throw new Error("O gate recebeu um identificador inválido.");
  }
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} é obrigatório.`);
  return value;
}
