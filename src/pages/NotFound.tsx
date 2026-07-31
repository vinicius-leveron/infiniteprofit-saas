import { ArrowLeft, SearchX } from "lucide-react";
import { Link } from "react-router-dom";

const NotFound = () => {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="section-card w-full max-w-md px-6 py-10 text-center md:px-8">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <SearchX className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Erro 404
        </p>
        <h1 className="mt-2 text-2xl font-bold leading-8">Página não encontrada</h1>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">
          O endereço pode estar incorreto ou esta página não está mais disponível.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para o início
        </Link>
      </section>
    </main>
  );
};

export default NotFound;
