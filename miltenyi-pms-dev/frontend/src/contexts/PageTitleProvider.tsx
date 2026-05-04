import { useMemo, useState, type ReactNode } from "react";
import { PageTitleContext } from "./PageTitleContext";

export function PageTitleProvider({ children }: { readonly children: ReactNode }) {
  const [override, setOverride] = useState<string | null>(null);
  const value = useMemo(() => ({ override, setOverride }), [override]);
  return (
    <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>
  );
}
