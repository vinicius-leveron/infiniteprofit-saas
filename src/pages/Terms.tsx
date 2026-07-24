import { PublicPageLayout } from "@/components/PublicPageLayout";
import { publicConfig } from "@/lib/publicConfig";

export default function Terms() {
  return (
    <PublicPageLayout
      eyebrow="Documento preliminar"
      title="Termos de uso"
      description={`Condições preliminares do piloto assistido operado por ${publicConfig.legalEntityName}. A versão jurídica final será publicada após aprovação do responsável legal.`}
    >
      <h2>Escopo do piloto</h2>
      <p>
        O acesso é concedido por convite e acompanhado pelo time da Infinite Profit.
        Funcionalidades, limites e disponibilidade podem ser ajustados durante o piloto.
      </p>
      <h2>Uso autorizado</h2>
      <p>
        Cada usuário deve utilizar sua própria conta e manter suas credenciais protegidas.
        É proibido tentar acessar clientes, funis ou dados para os quais não exista autorização.
      </p>
      <h2>Dados e integrações</h2>
      <p>
        O cliente é responsável por possuir autorização para conectar provedores e importar
        dados. Tokens, secrets e credenciais não devem ser enviados pelos canais de suporte.
      </p>
      <h2>Disponibilidade</h2>
      <p>
        Incidentes devem ser comunicados ao suporte. Durante o piloto, medidas corretivas e
        janelas de manutenção podem ser combinadas diretamente com os participantes.
      </p>
      <h2>Contato</h2>
      <p>
        Dúvidas sobre estes termos podem ser enviadas para{" "}
        <a href={`mailto:${publicConfig.supportEmail}`}>{publicConfig.supportEmail}</a>.
      </p>
    </PublicPageLayout>
  );
}
