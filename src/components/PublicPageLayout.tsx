import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BarChart3 } from "lucide-react";

interface PublicPageLayoutProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function PublicPageLayout({
  eyebrow,
  title,
  description,
  children,
}: PublicPageLayoutProps) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 md:px-6 md:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <nav className="mb-10 flex items-center justify-between" aria-label="Navegação pública">
          <Link
            to="/auth"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
          <Link
            to="/auth"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BarChart3 className="h-4 w-4" />
            </span>
            Infinite Profit
          </Link>
        </nav>

        <header className="border-b border-border/70 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
            {description}
          </p>
        </header>

        <article className="prose prose-sm mt-8 max-w-none text-foreground prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground">
          {children}
        </article>

        <footer className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t border-border/70 pt-6 text-xs text-muted-foreground">
          <Link className="hover:text-foreground" to="/help">Ajuda</Link>
          <Link className="hover:text-foreground" to="/terms">Termos</Link>
          <Link className="hover:text-foreground" to="/privacy">Privacidade</Link>
        </footer>
      </div>
    </main>
  );
}
