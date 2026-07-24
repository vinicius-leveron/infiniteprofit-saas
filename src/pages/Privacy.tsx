import { PublicPageLayout } from "@/components/PublicPageLayout";
import { publicConfig } from "@/lib/publicConfig";

export default function Privacy() {
  return (
    <PublicPageLayout
      eyebrow="Documento preliminar"
      title="Privacidade"
      description={`Resumo preliminar das práticas de dados de ${publicConfig.legalEntityName}. O texto jurídico final depende de aprovação antes da publicação externa.`}
    >
      <h2>Dados tratados</h2>
      <p>
        A plataforma trata dados de conta, acesso, configuração de fontes e sinais
        operacionais necessários para apresentar e acompanhar os funis autorizados.
      </p>
      <h2>Credenciais e conteúdo sensível</h2>
      <p>
        Secrets e tokens são utilizados somente para executar integrações autorizadas. Eles
        não devem aparecer em telemetria de produto, eventos de auditoria ou mensagens de suporte.
      </p>
      <h2>Telemetria</h2>
      <p>
        Eventos de uso são limitados a nomes e propriedades permitidos, como conclusão de
        etapas e tempo até o primeiro sinal. Emails, arquivos importados e payloads de
        provedores não fazem parte dessa telemetria.
      </p>
      <h2>Acesso e correção</h2>
      <p>
        Solicitações relacionadas a dados pessoais ou acesso podem ser enviadas para{" "}
        <a href={`mailto:${publicConfig.supportEmail}`}>{publicConfig.supportEmail}</a>.
      </p>
    </PublicPageLayout>
  );
}
