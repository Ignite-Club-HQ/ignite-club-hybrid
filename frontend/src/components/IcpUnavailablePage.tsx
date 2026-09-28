interface IcpUnavailablePageProps {
  title: string;
  description: string;
}

export function IcpUnavailablePage({ title, description }: IcpUnavailablePageProps) {
  return (
    <div className="container max-w-2xl mx-auto px-4 py-10">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-3 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
