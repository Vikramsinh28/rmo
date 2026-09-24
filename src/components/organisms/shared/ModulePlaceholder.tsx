interface ModulePlaceholderProps {
  title: string;
  description: string;
}

/**
 * Empty screen for an RMO area that has no business logic yet.
 */
export function ModulePlaceholder({ title, description }: ModulePlaceholderProps) {
  return (
    <section className="flex flex-col gap-2 px-4 py-6 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
    </section>
  );
}
