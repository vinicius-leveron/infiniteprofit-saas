import { useState } from "react";
import {
  ExternalLink,
  Eye,
  EyeOff,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type HotmartCredentialsFieldsProps = {
  idPrefix: string;
  clientId: string;
  clientSecret: string;
  basicToken: string;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onBasicTokenChange: (value: string) => void;
  disabled?: boolean;
};

export function HotmartCredentialsFields({
  idPrefix,
  clientId,
  clientSecret,
  basicToken,
  onClientIdChange,
  onClientSecretChange,
  onBasicTokenChange,
  disabled = false,
}: HotmartCredentialsFieldsProps) {
  return (
    <div className="space-y-5 rounded-xl border bg-muted/20 p-4 md:p-5">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          <p className="text-sm font-semibold">
            Credenciais Developers da Hotmart
          </p>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          A conexão é validada diretamente com a Hotmart. Os valores seguem
          para o Vault e não voltam a aparecer nesta tela.
        </p>
      </div>

      <ol className="space-y-2 text-xs leading-5 text-muted-foreground">
        <li className="flex gap-2">
          <StepNumber value={1} />
          <span>
            Na Hotmart, abra <strong className="text-foreground">Ferramentas</strong>
            {" → "}
            <strong className="text-foreground">Credenciais Developers</strong>.
          </span>
        </li>
        <li className="flex gap-2">
          <StepNumber value={2} />
          <span>
            Crie uma credencial chamada{" "}
            <strong className="text-foreground">
              Infinite Profit — nome do cliente
            </strong>{" "}
            e deixe <strong className="text-foreground">Sandbox desmarcado</strong>.
          </span>
        </li>
        <li className="flex gap-2">
          <StepNumber value={3} />
          <span>
            Copie <strong className="text-foreground">Client ID</strong>,{" "}
            <strong className="text-foreground">Client Secret</strong> e{" "}
            <strong className="text-foreground">Basic</strong> da mesma
            credencial.
          </span>
        </li>
      </ol>

      <a
        href="https://developers.hotmart.com/docs/pt-BR/start/app-auth/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-2 rounded-md text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Ver instruções oficiais da Hotmart
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>

      <div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-amber-200">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Use os três valores da mesma credencial de produção. Não use Hottok,
          Access Token ou uma credencial Sandbox nesta etapa.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SecretField
          id={`${idPrefix}-client-id`}
          label="Client ID"
          value={clientId}
          onChange={onClientIdChange}
          disabled={disabled}
          autoComplete="off"
        />
        <SecretField
          id={`${idPrefix}-client-secret`}
          label="Client Secret"
          value={clientSecret}
          onChange={onClientSecretChange}
          disabled={disabled}
          autoComplete="off"
        />
      </div>
      <SecretField
        id={`${idPrefix}-basic-token`}
        label="Token Basic"
        value={basicToken}
        onChange={onBasicTokenChange}
        disabled={disabled}
        autoComplete="off"
        placeholder="Basic ..."
        hint="Você pode colar com ou sem o prefixo “Basic”."
      />
    </div>
  );
}

function StepNumber({ value }: { value: number }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
      aria-hidden="true"
    >
      {value}
    </span>
  );
}

function SecretField({
  id,
  label,
  value,
  onChange,
  disabled,
  autoComplete,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoComplete: string;
  placeholder?: string;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-describedby={hintId}
          className="min-h-11 pr-12 font-mono text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-11 w-11 text-muted-foreground"
          disabled={disabled}
          aria-label={visible ? `Ocultar ${label}` : `Mostrar ${label}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
      {hint ? (
        <p id={hintId} className="text-xs leading-4 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
