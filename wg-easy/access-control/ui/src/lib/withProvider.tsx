import type { FC, PropsWithChildren } from "react";

export default function withProvider<P extends object>(
  Component: FC<P>,
  Providers: FC<PropsWithChildren>[] = [],
) {
  const ComponentWithProvider: FC<P> = (props) =>
    Providers.reduceRight(
      (children, Provider) => <Provider>{children}</Provider>,
      <Component {...props} />,
    );

  const displayName = Component.displayName || Component.name || "Component";
  ComponentWithProvider.displayName = `withProvider(${displayName})`;

  return ComponentWithProvider;
}
