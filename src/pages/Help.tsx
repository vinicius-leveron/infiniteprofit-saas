import { ExternalLink, LifeBuoy, Mail } from "lucide-react";
import { PublicPageLayout } from "@/components/PublicPageLayout";
import { Button } from "@/components/ui/button";
import { publicConfig } from "@/lib/publicConfig";

export default function Help() {
  return (
    <PublicPageLayout
      eyebrow="Suporte"
      title="Como podemos ajudar?"
      description="O piloto é assistido. Fale diretamente com o time quando algo bloquear sua operação ou quando precisar configurar uma fonte."
    >
      <section className="not-prose grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card p-5">
          <Mail className="h-5 w-5 text-primary" />
          <h2 className="mt-4 text-lg font-semibold">Atendimento</h2>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Inclua o nome do cliente e do funil. Nunca envie senha, token ou secret por email.
          </p>
          <Button asChild className="mt-5 min-h-11">
            <a href={`mailto:${publicConfig.supportEmail}`}>
              Enviar email
            </a>
          </Button>
          <p className="mt-3 break-all text-xs text-muted-foreground">
            {publicConfig.supportEmail}
          </p>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-5">
          <LifeBuoy className="h-5 w-5 text-primary" />
          <h2 className="mt-4 text-lg font-semibold">Status da plataforma</h2>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Consulte incidentes conhecidos antes de repetir importações ou sincronizações.
          </p>
          {publicConfig.statusUrl ? (
            <Button asChild variant="outline" className="mt-5 min-h-11">
              <a href={publicConfig.statusUrl} target="_blank" rel="noreferrer">
                Abrir página de status
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          ) : (
            <p className="mt-5 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              A página pública de status será habilitada antes da abertura do piloto.
            </p>
          )}
        </div>
      </section>
    </PublicPageLayout>
  );
}
